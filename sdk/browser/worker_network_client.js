import { Tag, match_into } from "../casework.js";
import { interfaceId } from "../contract.js";
import { describeHostError } from "./host_errors.js";
import { dispatchWorkerCapability, dispatchWorkerNetworkOutbound, } from "./worker_engine_bridge.js";
import { receiveIngressTransfer, } from "./worker_network_protocol.js";
import { workerCapabilityCall } from "./worker_protocol.js";
export class WorkerNetworkClient {
    #worker;
    #port;
    #engine;
    #statusChanged;
    #networkFailed;
    #pending = new Map();
    #nextId = 1;
    #startSettled = false;
    #startResolve;
    #failed = false;
    static async create(initialization, engine, statusChanged, networkFailed) {
        let worker;
        try {
            worker = new Worker(new URL("./worker_network.js", import.meta.url), {
                type: "module",
                name: "prns-network",
            });
        }
        catch (error) {
            return Tag("Failed", { detail: describeHostError(error) });
        }
        const channel = new MessageChannel();
        const client = new WorkerNetworkClient(worker, channel.port1, engine, statusChanged, networkFailed);
        const started = client.started();
        const message = Tag("InitializeNetworkWorker", {
            port: channel.port2,
            ...(initialization.wasmModuleUrl === undefined
                ? {}
                : { wasmModuleUrl: initialization.wasmModuleUrl }),
        });
        worker.postMessage(message, [channel.port2]);
        return started;
    }
    constructor(worker, port, engine, statusChanged, networkFailed) {
        this.#worker = worker;
        this.#port = port;
        this.#engine = engine;
        this.#statusChanged = statusChanged;
        this.#networkFailed = networkFailed;
        port.addEventListener("message", (event) => {
            this.#receive(event.data);
        });
        port.start();
        worker.addEventListener("error", (event) => {
            this.#fail(event.message || "network Worker failed");
        });
        worker.addEventListener("messageerror", () => {
            this.#fail("network Worker message could not be decoded");
        });
    }
    started() {
        return new Promise((resolve) => {
            this.#startResolve = resolve;
        });
    }
    connect(sessionId, url, options) {
        return this.#call("Connect", (id) => Tag("Connect", { id, sessionId, url, options }));
    }
    closeSession(sessionId) {
        return this.#call("Close", (id) => Tag("Close", { id, sessionId }));
    }
    terminate() {
        this.#failed = true;
        this.#port.close();
        this.#worker.terminate();
        this.#failPending("network Worker terminated");
    }
    #call(operation, request) {
        if (this.#failed) {
            return Promise.reject(new Error("network Worker is unavailable"));
        }
        const id = this.#nextId;
        this.#nextId = id === Number.MAX_SAFE_INTEGER ? 1 : id + 1;
        return new Promise((settle, fail) => {
            this.#pending.set(id, {
                operation,
                settle: settle,
                fail,
            });
            this.#port.postMessage(request(id));
        });
    }
    #receive(message) {
        try {
            match_into().from(message, {
                Ready: () => {
                    if (this.#startSettled || this.#startResolve === undefined) {
                        throw new Error("network Worker sent duplicate readiness");
                    }
                    this.#startSettled = true;
                    this.#startResolve(Tag("Ready", this));
                    this.#startResolve = undefined;
                },
                ConnectSettled: ({ id, outcome }) => {
                    this.#settle(id, "Connect", outcome);
                },
                CloseSettled: ({ id, outcome }) => {
                    this.#settle(id, "Close", outcome);
                },
                StatusChanged: ({ sessionId, status }) => {
                    this.#statusChanged(sessionId, status);
                },
                HostCall: ({ id, call }) => {
                    void this.#performHostCall(id, call);
                },
                IngressBatch: ({ id, batch }) => {
                    void this.#performIngressBatch(id, batch);
                },
                ProtocolFailed: ({ detail }) => {
                    this.#fail(detail);
                },
            });
        }
        catch (error) {
            this.#fail(describeHostError(error));
        }
    }
    async #performHostCall(id, call) {
        try {
            if (call.tag === "NextOutbound") {
                const outcome = await dispatchWorkerNetworkOutbound(this.#engine, interfaceId(call.data.interfaceId), call.data.maximumFrames);
                const response = Tag("HostSettlement", {
                    id,
                    outcome,
                });
                this.#port.postMessage(response, outcome.tag === "TransferredOutbound"
                    ? [...outcome.data.buffers]
                    : []);
                return;
            }
            const outcome = await dispatchWorkerCapability(this.#engine, call);
            const response = Tag("HostSettlement", {
                id,
                outcome,
            });
            this.#port.postMessage(response);
        }
        catch (error) {
            this.#fail(describeHostError(error));
        }
    }
    async #performIngressBatch(id, batch) {
        try {
            const items = receiveIngressTransfer(batch);
            const outcomes = await Promise.all(items.map(({ interfaceId, bytes }) => dispatchWorkerCapability(this.#engine, workerCapabilityCall("Ingest", { interfaceId, bytes }))));
            const failures = [];
            for (let index = 0; index < outcomes.length; index += 1) {
                const outcome = outcomes[index];
                if (outcome !== undefined && outcome.tag !== "Accepted") {
                    failures.push({ index, outcome });
                }
            }
            const response = Tag("IngressSettled", {
                id,
                count: items.length,
                failures,
            });
            this.#port.postMessage(response);
        }
        catch (error) {
            this.#fail(describeHostError(error));
        }
    }
    #settle(id, operation, outcome) {
        const pending = this.#pending.get(id);
        if (pending === undefined || pending.operation !== operation) {
            throw new Error(`network Worker settled unknown ${operation} call ${id}`);
        }
        this.#pending.delete(id);
        pending.settle(outcome);
    }
    #fail(detail) {
        if (this.#failed) {
            return;
        }
        const running = this.#startSettled;
        this.#failed = true;
        if (!this.#startSettled && this.#startResolve !== undefined) {
            this.#startSettled = true;
            this.#startResolve(Tag("Failed", { detail }));
            this.#startResolve = undefined;
        }
        this.#failPending(detail);
        this.#port.close();
        this.#worker.terminate();
        if (running) {
            this.#networkFailed(detail);
        }
    }
    #failPending(detail) {
        const error = new Error(detail);
        for (const pending of this.#pending.values()) {
            pending.fail(error);
        }
        this.#pending.clear();
    }
}
