import { Tag, match } from "../casework.js";
import { interfaceId } from "../contract.js";
import { byteKey, interfaceKey } from "./bytes.js";
import { describeHostError } from "./host_errors.js";
import { outboundTargets, parseOutboundFrame, } from "./outbound.js";
import { parseOutboundBatch } from "./outbound_batch.js";
import { prepareByteTransfer } from "./byte_transfer.js";
import { MIN_ENTROPY_BYTES, PrnsValidationError, bitrateBps, channelTag, hardwareMtu, packetFrameView, positiveInteger, } from "./values.js";
import { resourceDigestExecution, resourceOpenDigestExecution, } from "./resource_crypto.js";
import { parseBrowserWork, parseBrowserWorkLanding, } from "./browser_work.js";
const INTERFACE_OUTBOUND_QUEUE_DEPTH = 64;
export class RuntimeHost {
    #wasm;
    #runtime;
    #entropy;
    #now;
    #bleIdentityAvailability;
    #onRuntimeActivity;
    #cryptoExecutor;
    #activeInterfaces = new Map();
    #activeRegistrationKeys = new Set();
    #outboundQueues = new Map();
    #overflowedOutbound = new Set();
    #outboundWaiters = new Map();
    constructor(wasm, runtime, entropy, now, bleIdentityAvailability, cryptoExecutor, onRuntimeActivity) {
        this.#wasm = wasm;
        this.#runtime = runtime;
        this.#entropy = entropy;
        this.#now = now;
        this.#bleIdentityAvailability = bleIdentityAvailability;
        this.#cryptoExecutor = cryptoExecutor;
        this.#onRuntimeActivity = onRuntimeActivity;
        this.#runtime.configureBrowserWork(cryptoExecutor === undefined ? "Inline" : "BrowserWorkers");
    }
    runtimeReadiness() {
        try {
            this.#runtime.snapshot();
            return Tag("Ready");
        }
        catch (error) {
            return runtimeRejected("inspect-readiness", error);
        }
    }
    registerInterface(registration) {
        const { interfaceName, supervisorKind = registration.kind, contractKind = stableInterfaceKind(registration.kind), ...options } = registration;
        const registrationKey = `${options.kind}:${byteKey(options.channelTag)}`;
        if (this.#activeRegistrationKeys.has(registrationKey)) {
            return Tag("AlreadyActive", {
                interface: interfaceName,
                target: registrationKey,
            });
        }
        let id;
        try {
            id = interfaceId(this.#runtime.registerInterface({ ...options, nowMs: this.#now() }));
        }
        catch (error) {
            return runtimeRejected("register-interface", error);
        }
        const key = interfaceKey(id);
        if (this.#activeInterfaces.has(key)) {
            return Tag("AlreadyActive", {
                interface: interfaceName,
                target: byteKey(id),
            });
        }
        this.#activeRegistrationKeys.add(registrationKey);
        this.#activeInterfaces.set(key, {
            id,
            name: interfaceName,
            ...(contractKind === undefined ? {} : { contractKind }),
            registrationKey,
            supervisorKind,
            rxBytes: 0,
            txBytes: 0,
        });
        this.#outboundQueues.set(key, []);
        this.#onRuntimeActivity();
        return Tag("Registered", id);
    }
    deactivateInterface(id) {
        const key = interfaceKey(id);
        const active = this.#activeInterfaces.get(key);
        if (!active) {
            this.#resolveOutboundWaiters(key, Tag("InterfaceDetached"));
            return Tag("Detached");
        }
        try {
            const removed = this.#runtime.removeInterface({
                interfaceId: id,
                nowMs: this.#now(),
            });
            if (!removed) {
                return runtimeRejected("remove-interface", `runtime did not contain interface ${byteKey(id)}`);
            }
        }
        catch (error) {
            return runtimeRejected("remove-interface", error);
        }
        this.#activeInterfaces.delete(key);
        this.#activeRegistrationKeys.delete(active.registrationKey);
        this.#outboundQueues.delete(key);
        this.#overflowedOutbound.delete(key);
        this.#resolveOutboundWaiters(key, Tag("InterfaceDetached"));
        this.#onRuntimeActivity();
        return Tag("Detached");
    }
    setContractKind(id, kind) {
        const active = this.#activeInterfaces.get(interfaceKey(id));
        if (active !== undefined && active.contractKind !== kind) {
            active.contractKind = kind;
            this.#onRuntimeActivity();
        }
    }
    interfaceInspection() {
        return new Map([...this.#activeInterfaces].map(([key, active]) => [
            key,
            {
                id: active.id,
                name: active.name,
                ...(active.contractKind === undefined
                    ? {}
                    : { kind: active.contractKind }),
                rxBytes: active.rxBytes,
                txBytes: active.txBytes,
            },
        ]));
    }
    ingest(interfaceId, bytes) {
        const entropy = this.entropy();
        if (entropy.tag !== "Filled") {
            return entropy;
        }
        try {
            const nowMs = this.#now();
            if (this.#runtime.ingestDirect === undefined) {
                this.#runtime.ingest({
                    interfaceId,
                    bytes,
                    nowMs,
                    entropy: entropy.data,
                });
            }
            else {
                this.#runtime.ingestDirect(interfaceId, bytes, nowMs, entropy.data);
            }
            const active = this.#activeInterfaces.get(interfaceKey(interfaceId));
            if (active !== undefined) {
                active.rxBytes = saturatingAdd(active.rxBytes, bytes.length);
            }
            this.drainBrowserWork();
            this.notifyRuntimeActivity();
            return Tag("Accepted");
        }
        catch (error) {
            return runtimeRejected("ingest", error);
        }
    }
    drainBrowserWork() {
        if (this.#cryptoExecutor === undefined) {
            return;
        }
        while (true) {
            const job = parseBrowserWork(this.#runtime.takeBrowserWork());
            if (job === undefined) {
                return;
            }
            void this.#settleBrowserWork(job);
        }
    }
    async #settleBrowserWork(job) {
        await match(job, {
            AnnounceVerify: (data) => this.#settleProtocolCrypto(Tag("AnnounceVerify", data)),
            LinkProofVerify: (data) => this.#settleProtocolCrypto(Tag("LinkProofVerify", data)),
            ResourceSeal: (data) => this.#settleResourceSeal(data),
            WholeResourceOpen: (data) => this.#settleResourceOpen(data),
        });
    }
    async #settleResourceSeal(job) {
        const executor = this.#cryptoExecutor;
        if (executor === undefined) {
            return;
        }
        try {
            const offloadDigests = resourceDigestExecution(job.noncePrefixedBytes, job.totalSegments).tag === "WebCrypto";
            const outcome = offloadDigests
                ? await executor.sealAndDigest(job, job.salts.subarray(0, 4))
                : await executor.seal(job);
            if (this.#cryptoExecutor !== executor) {
                return;
            }
            if (outcome.tag === "Busy") {
                throw new TypeError("resource crypto pool is busy");
            }
            if (outcome.tag === "Failed") {
                throw new TypeError(outcome.data.detail);
            }
            if (outcome.tag === "Sealed") {
                const landing = parseBrowserWorkLanding(this.#runtime.completeBrowserWork({
                    id: job.id,
                    outcome: "Sealed",
                    sealed: outcome.data.sealed,
                    nowMs: this.#now(),
                    entropy: this.#completionEntropy(),
                }));
                if (landing.tag === "Collision" || landing.tag === "Invalid") {
                    throw new TypeError(`resource seal landing was ${landing.tag}`);
                }
            }
            else {
                let plaintext = outcome.data.plaintext;
                let digests = {
                    hash: outcome.data.hash,
                    proof: outcome.data.proof,
                };
                let landed = false;
                for (let offset = 0; offset < job.salts.length; offset += 4) {
                    const salt = job.salts.subarray(offset, offset + 4);
                    if (offset !== 0) {
                        const digestOutcome = await executor.digest(plaintext, salt);
                        if (this.#cryptoExecutor !== executor) {
                            return;
                        }
                        if (digestOutcome.tag !== "Digested") {
                            throw new TypeError(digestOutcome.tag === "Busy"
                                ? "resource crypto pool is busy"
                                : digestOutcome.data.detail);
                        }
                        plaintext = digestOutcome.data.plaintext;
                        digests = {
                            hash: digestOutcome.data.hash,
                            proof: digestOutcome.data.proof,
                        };
                    }
                    const landing = parseBrowserWorkLanding(this.#runtime.completeBrowserWork({
                        id: job.id,
                        outcome: "SealedAndDigested",
                        sealed: outcome.data.sealed,
                        salt,
                        hash: digests.hash,
                        proof: digests.proof,
                        nowMs: this.#now(),
                        entropy: this.#completionEntropy(),
                    }));
                    if (landing.tag === "Applied" || landing.tag === "Stale") {
                        landed = true;
                        break;
                    }
                    if (landing.tag === "Invalid") {
                        throw new TypeError("resource digest landing was invalid");
                    }
                }
                if (!landed) {
                    throw new TypeError("resource digest salts exhausted");
                }
            }
        }
        catch {
            if (this.#cryptoExecutor !== executor) {
                return;
            }
            this.#runtime.completeBrowserWork({
                id: job.id,
                outcome: "Unavailable",
                nowMs: this.#now(),
                entropy: this.#completionEntropy(),
            });
        }
        this.notifyRuntimeActivity();
        this.drainBrowserWork();
    }
    async #settleResourceOpen(job) {
        const executor = this.#cryptoExecutor;
        if (executor === undefined) {
            return;
        }
        try {
            if (job.hashPlan.tag === "OpenedStream" &&
                resourceOpenDigestExecution(job.sealed.length, job.totalSegments).tag === "WebCrypto") {
                const outcome = await executor.openAndDigest(job, job.hashPlan.data.salt);
                if (this.#cryptoExecutor !== executor) {
                    return;
                }
                await match(outcome, {
                    OpenedAndDigested: ({ plaintext, hash, proof }) => {
                        this.#completeResourceOpen({
                            id: job.id,
                            outcome: "OpenedAndDigested",
                            hash,
                            proof,
                            plaintext,
                            nowMs: this.#now(),
                            entropy: this.#completionEntropy(),
                        });
                    },
                    Refused: () => this.#completeResourceOpen({
                        id: job.id,
                        outcome: "Refused",
                        nowMs: this.#now(),
                        entropy: this.#completionEntropy(),
                    }),
                    Busy: () => {
                        throw new TypeError("resource crypto pool is busy");
                    },
                    Failed: ({ detail }) => {
                        throw new TypeError(detail);
                    },
                });
                this.notifyRuntimeActivity();
                this.drainBrowserWork();
                return;
            }
            const outcome = await executor.open(job);
            if (this.#cryptoExecutor !== executor) {
                return;
            }
            await match(outcome, {
                Opened: (plaintext) => {
                    this.#completeResourceOpen({
                        id: job.id,
                        outcome: "Opened",
                        plaintext,
                        nowMs: this.#now(),
                        entropy: this.#completionEntropy(),
                    });
                },
                Refused: () => this.#completeResourceOpen({
                    id: job.id,
                    outcome: "Refused",
                    nowMs: this.#now(),
                    entropy: this.#completionEntropy(),
                }),
                Busy: () => {
                    throw new TypeError("resource crypto pool is busy");
                },
                Failed: ({ detail }) => {
                    throw new TypeError(detail);
                },
            });
        }
        catch {
            if (this.#cryptoExecutor !== executor) {
                return;
            }
            this.#runtime.completeBrowserWork({
                id: job.id,
                outcome: "Unavailable",
                nowMs: this.#now(),
                entropy: this.#completionEntropy(),
            });
        }
        this.notifyRuntimeActivity();
        this.drainBrowserWork();
    }
    async #settleProtocolCrypto(job) {
        const executor = this.#cryptoExecutor;
        if (executor === undefined) {
            return;
        }
        try {
            await match(job, {
                AnnounceVerify: async ({ id, publicKey, message, signature }) => {
                    const outcome = await executor.verifyEd25519(publicKey, message, signature);
                    if (this.#cryptoExecutor !== executor) {
                        return;
                    }
                    await match(outcome, {
                        Valid: () => {
                            const entropy = this.#completionEntropy();
                            this.#runtime.completeBrowserWork({
                                id,
                                outcome: "Valid",
                                nowMs: this.#now(),
                                entropy,
                            });
                        },
                        Invalid: () => this.#completeBrowserWork(id, "Invalid"),
                        Busy: () => this.#completeBrowserWork(id, "Unavailable"),
                        Unavailable: () => this.#completeBrowserWork(id, "Unavailable"),
                        Failed: () => this.#completeBrowserWork(id, "Unavailable"),
                    });
                },
                LinkProofVerify: async ({ id, publicKey, message, signature, secretScalar, peerPublicKey, }) => {
                    const outcome = await executor.verifyLinkProof(publicKey, message, signature, secretScalar, peerPublicKey);
                    if (this.#cryptoExecutor !== executor) {
                        return;
                    }
                    await match(outcome, {
                        Verified: ({ sharedSecret }) => {
                            const entropy = this.#completionEntropy();
                            this.#runtime.completeBrowserWork({
                                id,
                                outcome: "Verified",
                                sharedSecret,
                                nowMs: this.#now(),
                                entropy,
                            });
                        },
                        Invalid: () => this.#completeBrowserWork(id, "Invalid"),
                        Busy: () => this.#completeBrowserWork(id, "Unavailable"),
                        Unavailable: () => this.#completeBrowserWork(id, "Unavailable"),
                        Failed: () => this.#completeBrowserWork(id, "Unavailable"),
                    });
                },
            });
        }
        catch {
            if (this.#cryptoExecutor === executor) {
                this.#completeBrowserWork(job.data.id, "Unavailable");
            }
        }
        if (this.#cryptoExecutor !== executor) {
            return;
        }
        this.notifyRuntimeActivity();
        this.drainBrowserWork();
    }
    #completeBrowserWork(id, outcome) {
        const entropy = this.#completionEntropy();
        this.#runtime.completeBrowserWork({ id, outcome, nowMs: this.#now(), entropy });
    }
    #completeResourceOpen(completion) {
        const landing = parseBrowserWorkLanding(this.#runtime.completeBrowserWork(completion));
        if (landing.tag === "Collision" || landing.tag === "Invalid") {
            throw new TypeError(`resource open landing was ${landing.tag}`);
        }
    }
    #completionEntropy() {
        const entropy = this.entropy();
        if (entropy.tag !== "Filled") {
            throw new TypeError("protocol crypto completion entropy is unavailable");
        }
        return entropy.data;
    }
    stopCrypto() {
        this.#cryptoExecutor = undefined;
    }
    drainOutbound() {
        try {
            const packed = this.#runtime.drainOutboundBatch?.();
            return Tag("Drained", packed === undefined
                ? this.#runtime.drainOutbound().map(parseOutboundFrame)
                : parseOutboundBatch(packed));
        }
        catch (error) {
            return runtimeRejected("drain-outbound", error);
        }
    }
    async nextOutboundFor(interfaceId, maximumFrames = Number.MAX_SAFE_INTEGER) {
        return this.#nextOutboundFor(interfaceId, maximumFrames, (frames) => Tag("Outbound", frames));
    }
    async nextTransferredOutboundFor(interfaceId, maximumFrames = Number.MAX_SAFE_INTEGER) {
        return this.#nextOutboundFor(interfaceId, maximumFrames, (frames) => Tag("TransferredOutbound", prepareByteTransfer(frames.map((frame) => frame.bytes), this.#retainedOutboundBuffers())));
    }
    async #nextOutboundFor(interfaceId, maximumFrames, ready) {
        const key = interfaceKey(interfaceId);
        while (this.#activeInterfaces.has(key)) {
            const outbound = this.#takeOutboundFor(interfaceId, maximumFrames);
            if (outbound.tag !== "Outbound") {
                return outbound;
            }
            if (outbound.data.length > 0) {
                return ready(outbound.data);
            }
            const wake = await this.#waitForOutbound(key);
            if (wake.tag === "InterfaceDetached") {
                return wake;
            }
        }
        return Tag("InterfaceDetached");
    }
    #takeOutboundFor(interfaceId, maximumFrames = Number.MAX_SAFE_INTEGER) {
        let frameLimit;
        try {
            frameLimit = positiveInteger(maximumFrames, "maximum outbound frames");
        }
        catch (error) {
            return runtimeRejected("drain-outbound", error);
        }
        const selectedInterfaceKey = interfaceKey(interfaceId);
        const direct = [];
        const drained = this.drainOutbound();
        if (drained.tag !== "Drained") {
            return drained;
        }
        for (const frame of drained.data) {
            for (const [key, active] of this.#activeInterfaces) {
                if (outboundTargets(frame.target, active.id, active.supervisorKind)) {
                    if (key === selectedInterfaceKey) {
                        direct.push(frame);
                        continue;
                    }
                    const queue = this.#outboundQueues.get(key);
                    if (queue && queue.length < INTERFACE_OUTBOUND_QUEUE_DEPTH) {
                        queue.push(frame);
                        this.#resolveOutboundWaiters(key, Tag("RuntimeAdvanced"));
                    }
                    else if (queue) {
                        this.#overflowedOutbound.add(key);
                        this.#resolveOutboundWaiters(key, Tag("RuntimeAdvanced"));
                    }
                }
            }
        }
        if (this.#overflowedOutbound.delete(selectedInterfaceKey)) {
            this.#outboundQueues.set(selectedInterfaceKey, []);
            return Tag("OutboundQueueFull", {
                capacity: INTERFACE_OUTBOUND_QUEUE_DEPTH,
            });
        }
        const queued = this.#outboundQueues.get(selectedInterfaceKey) ?? [];
        const available = queued.concat(direct);
        const outbound = available.slice(0, frameLimit);
        this.#outboundQueues.set(selectedInterfaceKey, available.slice(frameLimit));
        const active = this.#activeInterfaces.get(selectedInterfaceKey);
        if (active !== undefined) {
            active.txBytes = outbound.reduce((total, frame) => saturatingAdd(total, frame.bytes.length), active.txBytes);
        }
        return Tag("Outbound", outbound);
    }
    #waitForOutbound(key) {
        if (!this.#activeInterfaces.has(key)) {
            return Promise.resolve(Tag("InterfaceDetached"));
        }
        return new Promise((resolve) => {
            const waiters = this.#outboundWaiters.get(key) ?? new Set();
            waiters.add(resolve);
            this.#outboundWaiters.set(key, waiters);
        });
    }
    #retainedOutboundBuffers() {
        const retained = new Set();
        for (const queue of this.#outboundQueues.values()) {
            for (const frame of queue) {
                retained.add(frame.bytes.buffer);
            }
        }
        return retained;
    }
    notifyRuntimeActivity() {
        const keys = [...this.#outboundWaiters.keys()];
        for (const key of keys) {
            this.#resolveOutboundWaiters(key, Tag("RuntimeAdvanced"));
        }
        this.#onRuntimeActivity();
    }
    #resolveOutboundWaiters(key, outcome) {
        const waiters = this.#outboundWaiters.get(key);
        if (waiters === undefined) {
            return;
        }
        this.#outboundWaiters.delete(key);
        for (const resolve of waiters) {
            resolve(outcome);
        }
    }
    createUsbAutoDecoder() {
        const decoder = new this.#wasm.UsbAutoDecoder();
        return {
            feed: (chunk) => decoder.feed(chunk),
            release: () => {
                decoder.free?.();
            },
        };
    }
    createBluetoothReassembler() {
        const reassembler = new this.#wasm.BluetoothReassembler();
        return {
            absorb: (bytes) => reassembler.absorb(bytes),
            release: () => {
                reassembler.free?.();
            },
        };
    }
    createWebSocketFramingCodec(selection) {
        return new this.#wasm.WebSocketFramingCodec(wasmWebSocketFramingSelection(selection));
    }
    bluetoothServiceUuid() {
        return this.#wasm.bluetoothServiceUuid();
    }
    bluetoothIdentityReadiness() {
        return this.#bleIdentityAvailability.tag === "Available"
            ? Tag("Ready")
            : this.#bleIdentityAvailability;
    }
    bluetoothControlUuid() {
        return this.#wasm.bluetoothControlUuid();
    }
    bluetoothDataUuid() {
        return this.#wasm.bluetoothDataUuid();
    }
    bluetoothBitrateBps() {
        return bitrateBps(this.#wasm.bluetoothBitrateBps());
    }
    bluetoothHardwareMtu() {
        return hardwareMtu(this.#wasm.bluetoothHardwareMtu());
    }
    bluetoothDialerHello() {
        return this.#wasm.bluetoothDialerHello(this.#runtime.bluetoothIdentity());
    }
    bluetoothDecodeControl(bytes) {
        return this.#wasm.bluetoothDecodeControl(bytes);
    }
    bluetoothDataFragments(packet) {
        return this.#wasm.bluetoothDataFragments(packet);
    }
    websocketBitrateBps() {
        return bitrateBps(this.#wasm.websocketBitrateBps());
    }
    websocketFrameCap() {
        return positiveInteger(this.#wasm.websocketFrameCap(), "WebSocket frame cap");
    }
    websocketHardwareMtu() {
        return hardwareMtu(this.#wasm.websocketHardwareMtu());
    }
    webSocketRegister(options) {
        try {
            return this.registerInterface({
                interfaceName: "websocket",
                kind: "websocket-client",
                channelTag: channelTag(options.channelTag),
                bitrateBps: options.bitrateBps,
                hardwareMtu: options.hardwareMtu,
                ...runtimeInterfaceRouting(options.routing),
            });
        }
        catch (error) {
            return runtimeRejected("register-interface", error);
        }
    }
    webSocketIngest(id, bytes) {
        try {
            return this.ingest(id, packetFrameView(bytes));
        }
        catch (error) {
            return runtimeRejected("ingest", error);
        }
    }
    autoWifiReady() {
        return this.runtimeReadiness();
    }
    autoWifiRegister(id, bitrate) {
        try {
            return this.registerInterface({
                interfaceName: "auto-wifi",
                kind: "auto-wifi",
                channelTag: channelTag(id),
                bitrateBps: bitrate,
                hardwareMtu: this.websocketHardwareMtu(),
            });
        }
        catch (error) {
            return runtimeRejected("register-interface", error);
        }
    }
    autoWifiDeactivate(id) {
        return this.deactivateInterface(id);
    }
    autoWifiIngest(id, bytes) {
        try {
            return this.ingest(id, packetFrameView(bytes));
        }
        catch (error) {
            return runtimeRejected("ingest", error);
        }
    }
    autoWifiBitrateBps() {
        return this.websocketBitrateBps();
    }
    autoWifiHardwareMtu() {
        return this.websocketHardwareMtu();
    }
    autoWifiFrameCap() {
        return this.websocketFrameCap();
    }
    usbAutoHostBitrateBps() {
        return bitrateBps(this.#wasm.usbAutoHostBitrateBps());
    }
    usbAutoHostHardwareMtu() {
        return hardwareMtu(this.#wasm.usbAutoHostHardwareMtu());
    }
    defaultUsbAutoFilters() {
        return [
            {
                vendorId: this.#wasm.usbAutoWebUsbVendorId(),
                productId: this.#wasm.usbAutoWebUsbProductId(),
            },
        ];
    }
    usbAutoNodeTagFor(interfaceId) {
        return this.#wasm.usbAutoNodeTagFor(interfaceId);
    }
    usbAutoHostHelloFrame() {
        return this.#wasm.usbAutoHostHelloFrame();
    }
    usbAutoHostHelloAckFrame(nodeTag) {
        return this.#wasm.usbAutoHostHelloAckFrame(nodeTag);
    }
    usbAutoDataFrame(packet) {
        return this.#wasm.usbAutoDataFrame(packet);
    }
    entropy() {
        return fillEntropy(this.#entropy, MIN_ENTROPY_BYTES);
    }
}
export function runtimeRejected(operation, error) {
    return Tag("RuntimeRejected", {
        operation,
        detail: describeHostError(error),
    });
}
export function fillEntropy(source, length) {
    let outcome;
    try {
        outcome = source(length);
    }
    catch (error) {
        return Tag("EntropySourceFailed", { detail: describeHostError(error) });
    }
    if (outcome.tag !== "Filled") {
        return outcome;
    }
    if (outcome.data.length < length) {
        return Tag("InsufficientEntropy", {
            minimum: length,
            actual: outcome.data.length,
        });
    }
    return outcome;
}
export function saturatingAdd(left, right) {
    return Math.min(Number.MAX_SAFE_INTEGER, left + right);
}
function runtimeInterfaceRouting(routing) {
    if (routing === undefined)
        return {};
    if (routing.gravity !== undefined && !Number.isSafeInteger(routing.gravity)) {
        throw new PrnsValidationError("invalid-number", "gravity must be a safe integer");
    }
    return {
        ...(routing.mode === undefined ? {} : { mode: routing.mode }),
        ...(routing.gravity === undefined ? {} : { gravity: routing.gravity }),
        ...(routing.recursivePathRequests === undefined
            ? {}
            : { recursivePathRequests: routing.recursivePathRequests }),
        ...(routing.announcesFromInternal === undefined
            ? {}
            : { announcesFromInternal: routing.announcesFromInternal }),
        ...(routing.announcesToInternal === undefined
            ? {}
            : { announcesToInternal: routing.announcesToInternal }),
    };
}
function stableInterfaceKind(kind) {
    return {
        "auto-usb-host": "AutomaticUsb",
        "auto-usb-device": "AutomaticUsb",
        rnode: "RNode",
        "bluetooth-auto": "AutomaticBluetoothLe",
        "bluetooth-peer": "AutomaticBluetoothLe",
        "auto-wifi": "BrowserRendezvous",
        "websocket-client": "WebSocketClient",
        "websocket-server": "WebSocketServer",
        "websocket-server-peer": "WebSocketServer",
        serial: "Serial",
        kiss: "Kiss",
        pipe: "Pipe",
    }[kind];
}
function wasmWebSocketFramingSelection(selection) {
    switch (selection) {
        case "Auto":
            return "auto";
        case "RawPacket":
            return "raw";
        case "Hdlc":
            return "hdlc";
        case "Kiss":
            return "kiss";
    }
    const unreachable = selection;
    return unreachable;
}
