import { Tag, match_into } from "../casework.js";
import { loadBundledWasm, loadWasmModule, } from "./bootstrap.js";
import { describeHostError } from "./host_errors.js";
import { WebSocketInterface, } from "./websocket/index.js";
import { prepareIngressTransfer, receiveTransferredOutboundFrames, } from "./worker_network_protocol.js";
import { workerCapabilityCall, } from "./worker_protocol.js";
import { bitrateBps, hardwareMtu, positiveInteger, } from "./values.js";
const MAXIMUM_INGRESS_BATCH_ITEMS = 256;
const MAXIMUM_INGRESS_BATCH_BYTES = 1024 * 1024;
const MAXIMUM_OUTSTANDING_INGRESS_ITEMS = 4096;
const MAXIMUM_OUTSTANDING_INGRESS_BYTES = 4 * 1024 * 1024;
const workerScope = globalThis;
workerScope.addEventListener("message", ({ data }) => {
    if (data?.tag === "InitializeNetworkWorker") {
        void initialize(data);
    }
});
async function initialize(message) {
    const port = message.data.port;
    port.start();
    try {
        const loaded = message.data.wasmModuleUrl === undefined
            ? await loadBundledWasm()
            : await loadWasmModule(new URL(message.data.wasmModuleUrl));
        if (loaded.tag !== "Loaded") {
            post(port, Tag("ProtocolFailed", { detail: loaded.data.detail }));
            return;
        }
        const host = new NetworkRuntimeHost(port, loaded.data);
        const sockets = new WebSocketInterface(host);
        const sessions = new Map();
        port.addEventListener("message", (event) => {
            try {
                match_into().from(event.data, {
                    Connect: ({ id, sessionId, url, options }) => {
                        void connect(port, sockets, sessions, id, sessionId, url, options);
                    },
                    Close: ({ id, sessionId }) => {
                        void closeSession(port, sessions, id, sessionId);
                    },
                    HostSettlement: ({ id, outcome }) => {
                        host.settle(id, outcome);
                    },
                    IngressSettled: ({ id, count, failures }) => {
                        host.settleIngress(id, count, failures);
                    },
                });
            }
            catch (error) {
                const detail = describeHostError(error);
                host.fail(detail);
                post(port, Tag("ProtocolFailed", { detail }));
            }
        });
        post(port, Tag("Ready"));
    }
    catch (error) {
        post(port, Tag("ProtocolFailed", { detail: describeHostError(error) }));
    }
}
async function connect(port, sockets, sessions, id, sessionId, url, options) {
    try {
        if (sessions.has(sessionId)) {
            throw new Error(`network worker already tracks session ${sessionId}`);
        }
        const outcome = await sockets.connect(url, options);
        if (outcome.tag !== "Connected") {
            post(port, Tag("ConnectSettled", { id, outcome }));
            return;
        }
        const session = outcome.data;
        const releaseStatus = session.subscribeStatus((status) => {
            post(port, Tag("StatusChanged", { sessionId, status }));
            if (status.tag === "Closed" || status.tag === "Failed") {
                releaseStatus();
                sessions.delete(sessionId);
            }
        });
        sessions.set(sessionId, { session, releaseStatus });
        const projection = {
            id: sessionId,
            name: "websocket",
            interfaceId: session.interfaceId,
            status: session.status,
            url: session.url,
            framing: session.framing,
        };
        post(port, Tag("ConnectSettled", {
            id,
            outcome: Tag("Connected", projection),
        }));
    }
    catch (error) {
        post(port, Tag("ProtocolFailed", { detail: describeHostError(error) }));
    }
}
async function closeSession(port, sessions, id, sessionId) {
    try {
        const tracked = sessions.get(sessionId);
        const outcome = tracked === undefined
            ? Tag("Closed")
            : await tracked.session.close();
        if (sessions.get(sessionId) === tracked) {
            tracked?.releaseStatus();
            sessions.delete(sessionId);
        }
        post(port, Tag("CloseSettled", { id, outcome }));
    }
    catch (error) {
        post(port, Tag("ProtocolFailed", { detail: describeHostError(error) }));
    }
}
class NetworkRuntimeHost {
    #port;
    #wasm;
    #pending = new Map();
    #pendingIngress = [];
    #pendingIngressBytes = 0;
    #ingressState = Tag("Idle");
    #nextId = 1;
    #nextIngressId = 1;
    constructor(port, wasm) {
        this.#port = port;
        this.#wasm = wasm;
    }
    runtimeReadiness() {
        return Tag("Ready");
    }
    webSocketRegister(options) {
        return this.#call(workerCapabilityCall("RegisterWebSocket", options));
    }
    deactivateInterface(interfaceId) {
        return this.#call(workerCapabilityCall("DeactivateInterface", interfaceId));
    }
    webSocketIngest(interfaceId, bytes) {
        if (this.#ingressState.tag === "Failed") {
            return Promise.resolve(networkIngressFailed(this.#ingressState.data.detail));
        }
        const inFlight = this.#ingressState.tag === "InFlight"
            ? this.#ingressState.data
            : undefined;
        if (this.#pendingIngress.length + (inFlight?.items.length ?? 0) >=
            MAXIMUM_OUTSTANDING_INGRESS_ITEMS ||
            this.#pendingIngressBytes + (inFlight?.bytes ?? 0) + bytes.byteLength >
                MAXIMUM_OUTSTANDING_INGRESS_BYTES) {
            return Promise.resolve(networkIngressBusy());
        }
        return new Promise((settle) => {
            this.#pendingIngress.push({ interfaceId, bytes, settle });
            this.#pendingIngressBytes += bytes.byteLength;
            this.#scheduleIngress();
        });
    }
    async nextOutboundFor(interfaceId, maximumFrames) {
        const outcome = await this.#call(workerCapabilityCall("NextOutbound", maximumFrames === undefined
            ? { interfaceId }
            : { interfaceId, maximumFrames }));
        if (outcome.tag === "TransferredOutbound") {
            return Tag("Outbound", receiveTransferredOutboundFrames(interfaceId, outcome));
        }
        return outcome;
    }
    createWebSocketFramingCodec(selection) {
        return new this.#wasm.WebSocketFramingCodec(wasmFramingSelection(selection));
    }
    websocketBitrateBps() {
        return bitrateBps(this.#wasm.websocketBitrateBps());
    }
    websocketHardwareMtu() {
        return hardwareMtu(this.#wasm.websocketHardwareMtu());
    }
    websocketFrameCap() {
        return positiveInteger(this.#wasm.websocketFrameCap(), "WebSocket frame cap");
    }
    settle(id, outcome) {
        const pending = this.#pending.get(id);
        if (pending === undefined) {
            throw new Error(`network worker received unknown host settlement ${id}`);
        }
        this.#pending.delete(id);
        pending.settle(outcome);
    }
    settleIngress(id, count, failures) {
        if (this.#ingressState.tag === "Failed") {
            return;
        }
        if (this.#ingressState.tag !== "InFlight" ||
            this.#ingressState.data.id !== id) {
            throw new Error(`network worker received unknown ingress settlement ${id}`);
        }
        const inFlight = this.#ingressState.data;
        if (count !== inFlight.items.length) {
            throw new Error(`network worker ingress settlement ${id} has count ${count}, expected ${inFlight.items.length}`);
        }
        const outcomes = new Map();
        for (const failure of failures) {
            if (!Number.isSafeInteger(failure.index) ||
                failure.index < 0 ||
                failure.index >= count ||
                failure.outcome.tag === "Accepted" ||
                outcomes.has(failure.index)) {
                throw new Error(`network worker ingress settlement ${id} has an invalid failure`);
            }
            outcomes.set(failure.index, failure.outcome);
        }
        this.#ingressState = Tag("Idle");
        for (let index = 0; index < inFlight.items.length; index += 1) {
            const item = inFlight.items[index];
            if (item === undefined) {
                throw new Error(`network worker ingress settlement ${id} is sparse`);
            }
            item.settle(outcomes.get(index) ?? Tag("Accepted"));
        }
        this.#scheduleIngress();
    }
    #scheduleIngress() {
        if (this.#ingressState.tag !== "Idle" ||
            this.#pendingIngress.length === 0) {
            return;
        }
        this.#ingressState = Tag("Scheduled");
        queueMicrotask(() => {
            try {
                this.#flushIngress();
            }
            catch (error) {
                const detail = describeHostError(error);
                this.fail(detail);
                post(this.#port, Tag("ProtocolFailed", { detail }));
            }
        });
    }
    #flushIngress() {
        if (this.#ingressState.tag !== "Scheduled") {
            throw new Error("network worker ingress flush was not scheduled");
        }
        if (this.#pendingIngress.length === 0) {
            this.#ingressState = Tag("Idle");
            return;
        }
        let count = 0;
        let bytes = 0;
        while (count < this.#pendingIngress.length &&
            count < MAXIMUM_INGRESS_BATCH_ITEMS) {
            const item = this.#pendingIngress[count];
            if (item === undefined) {
                throw new Error("network worker ingress queue is sparse");
            }
            if (count > 0 &&
                bytes + item.bytes.byteLength > MAXIMUM_INGRESS_BATCH_BYTES) {
                break;
            }
            count += 1;
            bytes += item.bytes.byteLength;
        }
        const items = this.#pendingIngress.splice(0, count);
        this.#pendingIngressBytes -= bytes;
        const id = this.#nextIngressId;
        this.#nextIngressId = id === Number.MAX_SAFE_INTEGER ? 1 : id + 1;
        this.#ingressState = Tag("InFlight", { id, items, bytes });
        const batch = prepareIngressTransfer(items);
        post(this.#port, Tag("IngressBatch", { id, batch }), batch.bytes.buffers);
    }
    fail(detail) {
        if (this.#ingressState.tag === "Failed") {
            return;
        }
        const inFlight = this.#ingressState.tag === "InFlight"
            ? this.#ingressState.data.items
            : [];
        const ingress = [...inFlight, ...this.#pendingIngress];
        this.#pendingIngress.length = 0;
        this.#pendingIngressBytes = 0;
        this.#ingressState = Tag("Failed", { detail });
        const outcome = networkIngressFailed(detail);
        for (const item of ingress) {
            item.settle(outcome);
        }
        const error = new Error(detail);
        for (const pending of this.#pending.values()) {
            pending.fail(error);
        }
        this.#pending.clear();
    }
    #call(call, transfer = []) {
        if (this.#ingressState.tag === "Failed") {
            return Promise.reject(new Error(this.#ingressState.data.detail));
        }
        const id = this.#nextId;
        this.#nextId = id === Number.MAX_SAFE_INTEGER ? 1 : id + 1;
        return new Promise((settle, fail) => {
            this.#pending.set(id, {
                settle: settle,
                fail,
            });
            const message = Tag("HostCall", { id, call });
            try {
                this.#port.postMessage(message, [...transfer]);
            }
            catch (error) {
                this.#pending.delete(id);
                fail(error);
            }
        });
    }
}
function networkIngressBusy() {
    return Tag("RuntimeRejected", {
        operation: "worker-admission",
        detail: "network Worker ingress channel is busy",
    });
}
function networkIngressFailed(detail) {
    return Tag("RuntimeRejected", {
        operation: "ingest",
        detail,
    });
}
function wasmFramingSelection(selection) {
    return match_into().from(Tag(selection), {
        Auto: () => "auto",
        RawPacket: () => "raw",
        Hdlc: () => "hdlc",
        Kiss: () => "kiss",
    });
}
function post(port, message, transfer = []) {
    port.postMessage(message, [...transfer]);
}
