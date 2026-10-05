import { Tag } from "../../casework.js";
import { describeHostError } from "../host_errors.js";
import { closeFailed, closedSessionOutcome, delay, describeInterfaceSessionFailure, hasCleanupFailures, unexpectedSessionFailure, } from "../session.js";
import { parseWebSocketDecodeBatch } from "./decode_batch.js";
const BUFFER_POLL_MS = 4;
const MIN_BUFFER_LIMIT = 1024 * 1024;
const WEBSOCKET_CONNECTING = 0;
const WEBSOCKET_OPEN = 1;
export class BrowserWebSocketSession {
    name = "websocket";
    interfaceId;
    url;
    framing;
    #host;
    #socket;
    #frameCap;
    #codec;
    #bufferLimit;
    #release;
    #framingWaiters = new Set();
    #statusListeners = new Set();
    #readQueue = Promise.resolve();
    #ingressQueue = Promise.resolve();
    #writeQueue = Promise.resolve(Tag("Written"));
    #closed = false;
    #released = false;
    #status = Tag("Active");
    #closePromise;
    constructor(host, socket, interfaceId, url, frameCap, framing, codec, release) {
        this.#host = host;
        this.#socket = socket;
        this.interfaceId = interfaceId;
        this.url = url;
        this.#frameCap = frameCap;
        this.framing = framing;
        this.#codec = codec;
        this.#bufferLimit = Math.max(MIN_BUFFER_LIMIT, codec.messageCap() * 2);
        this.#release = release;
    }
    get status() {
        return this.#status;
    }
    subscribeStatus(changed) {
        this.#statusListeners.add(changed);
        let subscribed = true;
        return () => {
            if (!subscribed) {
                return;
            }
            subscribed = false;
            this.#statusListeners.delete(changed);
        };
    }
    start() {
        this.#socket.addEventListener("message", (event) => {
            this.#enqueueMessage(event);
        });
        this.#socket.addEventListener("close", () => {
            this.#handleClose();
        });
        this.#socket.addEventListener("error", () => {
            void this.#fail(Tag("Disconnected", {
                detail: `WebSocket connection failed for ${this.url}`,
            }));
        });
        void this.#outboundLoop();
    }
    close() {
        if (this.#closePromise !== undefined) {
            return this.#closePromise;
        }
        if (this.#closed) {
            return Promise.resolve(closedSessionOutcome(this.#status));
        }
        this.#closePromise = this.#performClose().finally(() => {
            this.#closePromise = undefined;
        });
        return this.#closePromise;
    }
    async #performClose() {
        this.#closed = true;
        this.#resolveFramingWaiters();
        const causes = [];
        await this.#readQueue;
        await this.#ingressQueue;
        const detached = await this.#host.deactivateInterface(this.interfaceId);
        if (detached.tag !== "Detached") {
            causes.push(Tag("RuntimeDetachFailed", { detail: detached.data.detail }));
        }
        this.#releaseOnce();
        const socketFailure = closeBrowserWebSocket(this.#socket);
        if (socketFailure) {
            causes.push(socketFailure);
        }
        const pendingWrite = await this.#writeQueue;
        if (pendingWrite.tag !== "Written") {
            causes.push(Tag("TransportCloseFailed", {
                detail: describeInterfaceSessionFailure(pendingWrite),
            }));
        }
        if (hasCleanupFailures(causes)) {
            const failed = closeFailed(causes);
            this.#replaceStatus(Tag("Failed", failed));
            return failed;
        }
        this.#replaceStatus(Tag("Closed"));
        return Tag("Closed");
    }
    #enqueueMessage(event) {
        this.#readQueue = this.#readQueue
            .then(async () => {
            const handled = await this.#handleMessage(event);
            if (handled.tag !== "Handled" && !this.#closed) {
                await this.#fail(handled);
            }
        })
            .catch(async (error) => {
            if (!this.#closed) {
                await this.#fail(unexpectedSessionFailure(error));
            }
        });
    }
    async #handleMessage(event) {
        const decoded = await websocketMessageBytes(event.data, this.#codec.messageCap());
        if (decoded.tag !== "Decoded") {
            return decoded;
        }
        if (this.framing === "RawPacket" ||
            this.#codec.canPassRawInbound?.() === true) {
            if (decoded.data.length === 0) {
                return Tag("Handled");
            }
            void this.#submitIngress([decoded.data]);
            return Tag("Handled");
        }
        const packed = this.#codec.decodePacked?.(decoded.data);
        const batch = packed === undefined
            ? this.#codec.decode(decoded.data)
            : parseWebSocketDecodeBatch(packed);
        if (this.#codec.canReadOutbound()) {
            this.#resolveFramingWaiters();
        }
        if (this.#closed) {
            return Tag("Handled");
        }
        const pending = batch.resolvedOutbound?.slice();
        const ingress = this.#submitIngress(batch.packets);
        if (pending !== undefined) {
            const ingested = await ingress;
            if (ingested.tag !== "Handled") {
                return ingested;
            }
            const written = await this.#writeEncodedFrame(pending);
            if (written.tag !== "Written") {
                return written;
            }
        }
        return Tag("Handled");
    }
    #handleClose() {
        if (this.#closed) {
            return;
        }
        this.#closed = true;
        this.#resolveFramingWaiters();
        void this.#finishRemoteClose();
    }
    async #finishRemoteClose() {
        await this.#readQueue;
        await this.#ingressQueue;
        const detached = await this.#host.deactivateInterface(this.interfaceId);
        this.#replaceStatus(detached.tag === "Detached" ? Tag("Closed") : Tag("Failed", detached));
        this.#releaseOnce();
    }
    #submitIngress(packets) {
        if (packets.length === 0) {
            return Promise.resolve(Tag("Handled"));
        }
        const settlement = Promise.all(packets.map((packet) => Promise.resolve(this.#host.webSocketIngest(this.interfaceId, packet)))).then((outcomes) => firstIngressFailure(outcomes) ?? Tag("Handled"));
        const observed = settlement
            .then(async (outcome) => {
            if (outcome.tag !== "Handled" && !this.#closed) {
                await this.#fail(outcome);
            }
        })
            .catch(async (error) => {
            if (!this.#closed) {
                await this.#fail(unexpectedSessionFailure(error));
            }
        });
        this.#ingressQueue = Promise.all([this.#ingressQueue, observed]).then(() => undefined);
        return settlement;
    }
    async #outboundLoop() {
        try {
            while (!this.#closed) {
                if (this.framing !== "RawPacket") {
                    if (this.#codec.rawFallbackIsArmed()) {
                        const wait = await this.#waitForRawFallback();
                        if (this.#closed) {
                            return;
                        }
                        if (wait.tag === "FallbackDue" &&
                            this.#codec.rawFallbackIsArmed()) {
                            const pending = this.#codec.releaseRawFallback();
                            if (pending !== undefined) {
                                const written = await this.#writeEncodedFrame(pending);
                                if (written.tag !== "Written") {
                                    await this.#fail(written);
                                    return;
                                }
                            }
                        }
                        continue;
                    }
                    if (!this.#codec.canReadOutbound()) {
                        await this.#waitForFramingReadiness();
                        continue;
                    }
                }
                const maximumFrames = this.framing === "RawPacket" ||
                    this.#codec.canStageMultipleOutbound()
                    ? Number.MAX_SAFE_INTEGER
                    : 1;
                const outbound = await this.#host.nextOutboundFor(this.interfaceId, maximumFrames);
                if (outbound.tag === "InterfaceDetached") {
                    return;
                }
                if (outbound.tag !== "Outbound") {
                    await this.#fail(outbound);
                    return;
                }
                for (const frame of outbound.data) {
                    const written = await this.#writeFrame(frame.bytes);
                    if (written.tag !== "Written") {
                        await this.#fail(written);
                        return;
                    }
                }
            }
        }
        catch (error) {
            if (!this.#closed) {
                await this.#fail(unexpectedSessionFailure(error));
            }
        }
    }
    async #fail(sessionFailure) {
        if (this.#closed) {
            return;
        }
        this.#replaceStatus(Tag("Failed", sessionFailure));
        this.#closed = true;
        this.#resolveFramingWaiters();
        await this.#host.deactivateInterface(this.interfaceId);
        this.#releaseOnce();
        await this.#writeQueue;
        closeBrowserWebSocket(this.#socket);
    }
    #waitForFramingReadiness() {
        if (this.#closed || this.#codec.canReadOutbound()) {
            return Promise.resolve();
        }
        return new Promise((resolve) => {
            this.#framingWaiters.add(resolve);
            if (this.#closed || this.#codec.canReadOutbound()) {
                this.#framingWaiters.delete(resolve);
                resolve();
            }
        });
    }
    #waitForRawFallback() {
        if (this.#closed || !this.#codec.rawFallbackIsArmed()) {
            return Promise.resolve(Tag("FramingReady"));
        }
        return new Promise((resolve) => {
            let settled = false;
            const framingReady = () => {
                settle(Tag("FramingReady"));
            };
            const timer = globalThis.setTimeout(() => {
                settle(Tag("FallbackDue"));
            }, this.#codec.rawFallbackDelayMillis());
            const settle = (outcome) => {
                if (settled) {
                    return;
                }
                settled = true;
                globalThis.clearTimeout(timer);
                this.#framingWaiters.delete(framingReady);
                resolve(outcome);
            };
            this.#framingWaiters.add(framingReady);
            if (this.#closed || !this.#codec.rawFallbackIsArmed()) {
                framingReady();
            }
        });
    }
    #resolveFramingWaiters() {
        const waiters = [...this.#framingWaiters];
        this.#framingWaiters.clear();
        for (const resolve of waiters) {
            resolve();
        }
    }
    #replaceStatus(status) {
        this.#status = status;
        for (const changed of this.#statusListeners) {
            changed(status);
        }
    }
    async #writeFrame(frame) {
        if (this.#closed || frame.length === 0) {
            return Tag("Written");
        }
        if (frame.length > this.#frameCap) {
            return Tag("FrameTooLarge", {
                length: frame.length,
                maximum: this.#frameCap,
            });
        }
        if (this.framing === "RawPacket" ||
            this.#codec.canPassRawOutbound?.() === true) {
            return this.#writeEncodedFrame(frame);
        }
        let encoded;
        try {
            encoded = this.#codec.stageOutbound(frame);
        }
        catch (error) {
            return Tag("TransferFailed", {
                direction: "Outbound",
                detail: describeHostError(error),
            });
        }
        if (encoded === undefined) {
            return Tag("Written");
        }
        return this.#writeEncodedFrame(encoded);
    }
    async #writeEncodedFrame(frame) {
        if (this.#closed || frame.length === 0) {
            return Tag("Written");
        }
        const write = this.#writeQueue
            .then(async (previous) => {
            if (previous.tag !== "Written" || this.#closed) {
                return previous;
            }
            while (!this.#closed && this.#socket.bufferedAmount > this.#bufferLimit) {
                await delay(BUFFER_POLL_MS);
            }
            if (this.#closed) {
                return Tag("Written");
            }
            if (this.#socket.readyState !== WEBSOCKET_OPEN) {
                return Tag("Disconnected", {
                    detail: `WebSocket is not open for ${this.url}`,
                });
            }
            try {
                this.#socket.send(frame);
                return Tag("Written");
            }
            catch (error) {
                return Tag("Disconnected", { detail: describeHostError(error) });
            }
        })
            .catch((error) => unexpectedSessionFailure(error));
        this.#writeQueue = write;
        return write;
    }
    #releaseOnce() {
        if (!this.#released) {
            this.#released = true;
            this.#release();
        }
    }
}
function firstIngressFailure(outcomes) {
    return outcomes.find((outcome) => outcome.tag !== "Accepted");
}
async function websocketMessageBytes(data, frameCap) {
    if (data instanceof ArrayBuffer) {
        return data.byteLength > frameCap
            ? frameTooLarge(data.byteLength, frameCap)
            : Tag("Decoded", new Uint8Array(data));
    }
    if (ArrayBuffer.isView(data)) {
        return data.byteLength > frameCap
            ? frameTooLarge(data.byteLength, frameCap)
            : Tag("Decoded", new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
    }
    if (typeof Blob !== "undefined" && data instanceof Blob) {
        if (data.size > frameCap) {
            return frameTooLarge(data.size, frameCap);
        }
        try {
            return Tag("Decoded", new Uint8Array(await data.arrayBuffer()));
        }
        catch (error) {
            return Tag("TransferFailed", {
                direction: "Inbound",
                detail: describeHostError(error),
            });
        }
    }
    return Tag("UnsupportedFrame", {
        format: typeof data === "string" ? "Text" : "Unknown",
    });
}
function frameTooLarge(length, maximum) {
    return Tag("FrameTooLarge", { length, maximum });
}
export function closeBrowserWebSocket(socket) {
    try {
        if (socket &&
            (socket.readyState === WEBSOCKET_CONNECTING ||
                socket.readyState === WEBSOCKET_OPEN)) {
            socket.close();
        }
    }
    catch (error) {
        return Tag("TransportCloseFailed", {
            detail: describeHostError(error),
        });
    }
    return undefined;
}
