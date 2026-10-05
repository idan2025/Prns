import { Tag, from, match, match_into } from "../casework.js";
import { BoundedAsyncLane } from "../async_lanes.js";
import { DESTINATION_HASH_LENGTH, HOST_CONTRACT_ABI, HOST_SCHEMA_VERSION, INTERFACE_ID_LENGTH, PRODUCT_VERSION, RESOURCE_HASH_LENGTH, SAFE_INT_MAX, SAFE_INT_MIN, balancedLimits, destinationHash, identityHash, interfaceId, linkId, packetHash, requestId, requestPathHash, resourceHash, } from "../contract.js";
import { browserLimits, bundledWasmModuleUrl, cooperativeBackendInfo, loadBundledWasm, loadOrCreateBleIdentity, webCryptoEntropy, webCryptoIdentity, } from "./bootstrap.js";
import { byteKey, interfaceKey } from "./bytes.js";
import { commandFailed, } from "./command_settlement.js";
import { parseCorrelatedEventBatch, parseDiagnosticEventBatch, parseEvent, parseEventBatch, retainedApplicationEventBytes, } from "./events.js";
import { PrnsInterfaces } from "./interfaces.js";
import { PrnsProjectionStore } from "./projections.js";
import { parseRuntimeProjectionSnapshot } from "./projection_snapshot.js";
import { RuntimeHost, fillEntropy, runtimeRejected, saturatingAdd, } from "./runtime.js";
import { describeHostError } from "./host_errors.js";
import { BROWSER_PERSISTENCE_VERSION, BrowserLocalStorageBleIdentityStore, browserPersistenceStores, describePersistenceStoreFailure, parseBrowserPersistedState, parsePersistenceRestoreReport, } from "./persistence.js";
import { blobResourceSource, byteResourceSource, sendResourceFromSource, } from "./resource_send.js";
import { browserResourceCompressor } from "./resource_compressor.js";
import { BrowserCryptoExecutor } from "./crypto_pool.js";
import { parseCommandSettlementBatch } from "./command_settlement_batch.js";
import { describeInterfaceSessionFailure } from "./session.js";
import { parsePackedSnapshot } from "./packed_snapshot.js";
import { parseSnapshot } from "./snapshot.js";
import { BROWSER_RENDEZVOUS_FRAMING_SELECTION, } from "./websocket/index.js";
import { BLE_IDENTITY_LENGTH, MIN_ENTROPY_BYTES, PrnsValidationError, appData, appName, aspect, bitrateBps, bleIdentity, channelTag, commandId, entropyBytes, hardwareMtu, hopCount, identitySecretKey, nonNegativeInteger, nowMillis, packetFrame, packetFrameView, positiveInteger, } from "./values.js";
import { registerWorkerCapabilityDispatcher, registerWorkerNetworkOutboundDispatcher, registerWorkerSnapshotCapturer, workerEngineHooks, } from "./worker_engine_bridge.js";
export { Tag, from, match, match_into };
export { DESTINATION_HASH_LENGTH, HOST_CONTRACT_ABI, HOST_SCHEMA_VERSION, INTERFACE_ID_LENGTH, PRODUCT_VERSION, RESOURCE_HASH_LENGTH, SAFE_INT_MAX, SAFE_INT_MIN, balancedLimits, destinationHash, identityHash, interfaceId, linkId, packetHash, requestId, requestPathHash, resourceHash, };
export { AutoWifiController, AutoWifiInterface, parseBrowserGatewayCatalog, validateBrowserGatewayUrl, } from "./auto_wifi/index.js";
export { webCryptoEntropy } from "./bootstrap.js";
export { PrnsInterfaces } from "./interfaces.js";
export { BluetoothInterface } from "./bluetooth/index.js";
export { UsbAutoInterface } from "./usb_auto/index.js";
export { BROWSER_PERSISTENCE_VERSION, BrowserLocalStorageBleIdentityStore, BrowserLocalStorageIdentityStore, BrowserLocalStoragePersistenceStore, } from "./persistence.js";
export { RNodeInterface } from "./rnode.js";
export { WebSocketInterface } from "./websocket/index.js";
export { BLE_IDENTITY_LENGTH, MIN_ENTROPY_BYTES, PrnsValidationError, appData, appName, aspect, bitrateBps, bleIdentity, channelTag, commandId, entropyBytes, hardwareMtu, hopCount, identitySecretKey, nowMillis, packetFrame, } from "./values.js";
export { PrnsProjectionCapacityError, prnsView, } from "./projections.js";
const WEB_CRYPTO_WORKERS = 2;
const PORTABLE_WASM_CRYPTO_WORKERS = 4;
export function persistentBrowser(root = "prns") {
    return browserPersistenceStores(root);
}
export class Prns {
    interfaces;
    #runtime;
    #host;
    #entropy;
    #now;
    #startedAtMillis;
    #limits;
    #resourceCompressionModuleUrl;
    #cryptoExecutor;
    #events;
    #diagnostics;
    #pendingCommands = new Map();
    #responseParts = new Map();
    #attachedInterfaces = new Map();
    #lifecycle = Tag("Running");
    #stopCompleted = false;
    #stopPromise;
    #persistenceStore;
    #persistenceRestored;
    #lastPersistenceFlushCause;
    #persistenceFailureDetail;
    #eventBatchSink;
    #directDiagnosticSink;
    #pageBluetoothReassemblers = new Map();
    #pageUsbAutoDecoders = new Map();
    #nextPageCodecId = 1;
    #projections;
    #observedProjectionViews = new Set();
    #projectionRefreshScheduled = false;
    constructor(wasm, runtime, entropy, now, bleIdentityAvailability, limits, resourceCompressionModuleUrl, crypto, portableWasmModuleUrl, persistenceStore, persistenceRestored, restorationReport, eventBatchSink, directDiagnosticSink, autoWifiSelectionSeed) {
        this.#runtime = runtime;
        this.#entropy = entropy;
        this.#now = now;
        this.#startedAtMillis = now();
        this.#limits = limits;
        this.#resourceCompressionModuleUrl =
            resourceCompressionModuleUrl.href;
        this.#cryptoExecutor = match(crypto, {
            PortableWasm: () => undefined,
            WebCrypto: () => new BrowserCryptoExecutor(WEB_CRYPTO_WORKERS),
            ParallelWorkers: () => new BrowserCryptoExecutor(WEB_CRYPTO_WORKERS, {
                workers: PORTABLE_WASM_CRYPTO_WORKERS,
                ...(portableWasmModuleUrl === undefined
                    ? {}
                    : { moduleUrl: portableWasmModuleUrl.href }),
            }),
        });
        this.#persistenceStore = persistenceStore;
        this.#persistenceRestored = persistenceRestored;
        this.#eventBatchSink = eventBatchSink;
        this.#directDiagnosticSink = directDiagnosticSink;
        this.#events = new BoundedAsyncLane({
            name: "ApplicationEvents",
            maximumValues: limits.applicationEvents,
            maximumBytes: limits.retainedEventBytes,
            measure: retainedApplicationEventBytes,
            onRejected: (rejectedEventBytes) => this.#failBackpressure(rejectedEventBytes),
            onBeforeNext: () => this.#pumpEvents(),
        });
        this.#diagnostics = new BoundedAsyncLane({
            name: "Diagnostics",
            maximumValues: limits.diagnostics,
            maximumBytes: Number.MAX_SAFE_INTEGER,
            measure: () => 0,
            gap: (count) => Tag("DiagnosticsDropped", { count }),
            onBeforeNext: () => this.#pumpEvents(),
        });
        this.#host = new RuntimeHost(wasm, runtime, entropy, now, bleIdentityAvailability, this.#cryptoExecutor, () => {
            this.#pumpEvents();
            this.#scheduleProjectionRefresh();
        });
        registerWorkerCapabilityDispatcher(this, (call) => this.#dispatchPageCapability(call));
        registerWorkerNetworkOutboundDispatcher(this, (interfaceId, maximumFrames) => this.#host.nextTransferredOutboundFor(interfaceId, maximumFrames));
        registerWorkerSnapshotCapturer(this, () => this.#captureWorkerSnapshot());
        this.interfaces = new PrnsInterfaces(this.#host, autoWifiSelectionSeed);
        this.#projections = new PrnsProjectionStore(this.#captureHostSnapshot(), this.#lifecycle, limits.diagnostics, {
            observed: (view) => this.#observeProjection(view),
            unobserved: (view) => this.#unobserveProjection(view),
            synchronize: (view) => this.#synchronizeProjection(view),
        });
        if (restorationReport !== undefined) {
            this.#publishDiagnostic(Tag("PersistenceRestored", restorationReport));
        }
    }
    static async create(options) {
        if (options.execution !== "MainThread") {
            const { createDedicatedWorkerPrns } = await import("./worker_client.js");
            return createDedicatedWorkerPrns(options);
        }
        const engineHooks = workerEngineHooks(options);
        const loaded = options.wasm
            ? Tag("Loaded", options.wasm)
            : await loadBundledWasm();
        if (loaded.tag !== "Loaded") {
            return loaded;
        }
        const wasm = loaded.data;
        let actualAbi;
        let actualSchemaVersion;
        let actualPersistenceVersion;
        let actualProductVersion;
        try {
            actualAbi = wasm.hostContractAbi();
            actualSchemaVersion = wasm.hostSchemaVersion();
            actualPersistenceVersion = wasm.browserPersistenceVersion();
            actualProductVersion = wasm.productVersion();
        }
        catch (error) {
            return runtimeRejected("initialize", error);
        }
        if (actualAbi !== HOST_CONTRACT_ABI ||
            actualSchemaVersion !== HOST_SCHEMA_VERSION ||
            actualProductVersion !== PRODUCT_VERSION) {
            return Tag("ContractMismatch", {
                requiredAbi: HOST_CONTRACT_ABI,
                actualAbi,
                requiredSchemaVersion: HOST_SCHEMA_VERSION,
                actualSchemaVersion,
                requiredProductVersion: PRODUCT_VERSION,
                actualProductVersion,
            });
        }
        if (actualPersistenceVersion !== BROWSER_PERSISTENCE_VERSION) {
            return runtimeRejected("initialize", `browser persistence version ${actualPersistenceVersion} does not match ${BROWSER_PERSISTENCE_VERSION}`);
        }
        let identityLength;
        try {
            identityLength = positiveInteger(wasm.identitySecretKeyLength(), "identity secret key length");
        }
        catch (error) {
            return runtimeRejected("initialize", error);
        }
        const store = options.identityStore;
        let identity;
        if (store) {
            let loaded;
            try {
                loaded = await store.load(identityLength);
            }
            catch (error) {
                return Tag("IdentityStoreFailed", {
                    operation: "Load",
                    detail: describeHostError(error),
                });
            }
            if (loaded.tag === "Loaded") {
                try {
                    identity = identitySecretKey(loaded.data, identityLength);
                }
                catch (error) {
                    return Tag("StoredIdentityInvalid", {
                        detail: describeHostError(error),
                    });
                }
            }
            else if (loaded.tag !== "Missing") {
                return loaded;
            }
        }
        if (!identity) {
            const generated = webCryptoIdentity(identityLength);
            if (generated.tag !== "Generated") {
                return generated;
            }
            identity = generated.data;
            if (store) {
                let saved;
                try {
                    saved = await store.save(identity);
                }
                catch (error) {
                    return Tag("IdentityStoreFailed", {
                        operation: "Save",
                        detail: describeHostError(error),
                    });
                }
                if (saved.tag !== "Saved") {
                    return saved;
                }
            }
        }
        const bleIdentityAvailability = await loadOrCreateBleIdentity(options.bleIdentityStore ?? new BrowserLocalStorageBleIdentityStore());
        const bleIdentity = bleIdentityAvailability.tag === "Available"
            ? bleIdentityAvailability.data
            : undefined;
        const persistenceStore = options.persistenceStore;
        let persistedState;
        if (persistenceStore !== undefined) {
            let loaded;
            try {
                loaded = await persistenceStore.load();
            }
            catch (error) {
                return Tag("PersistenceStoreFailed", {
                    operation: "Load",
                    detail: describeHostError(error),
                });
            }
            if (loaded.tag === "Loaded") {
                try {
                    persistedState = parseBrowserPersistedState(loaded.data);
                }
                catch (error) {
                    return Tag("StoredPersistenceInvalid", {
                        detail: describeHostError(error),
                    });
                }
            }
            else if (loaded.tag !== "Missing") {
                return loaded;
            }
        }
        let limits;
        let now;
        let runtime;
        try {
            limits = browserLimits(options.limits ?? balancedLimits());
            now = options.now ?? nowMillis;
            runtime = new wasm.PrnsRuntime(identity, bleIdentity);
        }
        catch (error) {
            return runtimeRejected("initialize", error);
        }
        let restorationReport;
        if (persistedState !== undefined) {
            try {
                restorationReport = parsePersistenceRestoreReport(runtime.restorePersistedState({
                    ...persistedState,
                    nowMs: nowMillis(Math.max(now(), persistedState.takenAtMillis)),
                }));
            }
            catch (error) {
                return Tag("StoredPersistenceInvalid", {
                    detail: describeHostError(error),
                });
            }
        }
        try {
            return Tag("Ready", new Prns(wasm, runtime, options.entropy ?? webCryptoEntropy, now, bleIdentityAvailability, limits, options.resourceCompressionModuleUrl ??
                bundledWasmModuleUrl(), options.crypto ?? options.resourceCrypto ?? Tag("PortableWasm"), options.portableWasmModuleUrl, persistenceStore, persistedState !== undefined, restorationReport, engineHooks?.eventBatchSink, engineHooks?.directDiagnosticSink, engineHooks?.autoWifiSelectionSeed));
        }
        catch (error) {
            return runtimeRejected("initialize", error);
        }
    }
    async registerSingleDestination(options) {
        try {
            return Tag("Registered", destinationHash(this.#runtime.registerSingleDestination(options)));
        }
        catch (error) {
            return runtimeRejected("register-destination", error);
        }
    }
    async #dispatchPageCapability(call) {
        return match(call, {
            RegisterWebSocket: (registration) => this.#host.webSocketRegister(registration),
            RegisterInterface: (registration) => this.#host.registerInterface(registration),
            DeactivateInterface: (value) => this.#host.deactivateInterface(interfaceId(value)),
            Ingest: ({ interfaceId: id, bytes }) => this.#host.ingest(interfaceId(id), packetFrameView(bytes)),
            NextOutbound: ({ interfaceId: id, maximumFrames }) => this.#host.nextOutboundFor(interfaceId(id), maximumFrames),
            CreateBluetoothReassembler: () => {
                const id = this.#mintPageCodecId();
                this.#pageBluetoothReassemblers.set(id, this.#host.createBluetoothReassembler());
                return id;
            },
            AbsorbBluetoothFragment: ({ id, bytes }) => {
                const reassembler = this.#pageBluetoothReassemblers.get(id);
                if (reassembler === undefined) {
                    throw new Error(`unknown Bluetooth reassembler ${id}`);
                }
                return reassembler.absorb(bytes);
            },
            ReleaseBluetoothReassembler: (id) => {
                this.#pageBluetoothReassemblers.delete(id);
            },
            CreateUsbAutoDecoder: () => {
                const id = this.#mintPageCodecId();
                this.#pageUsbAutoDecoders.set(id, this.#host.createUsbAutoDecoder());
                return id;
            },
            FeedUsbAutoDecoder: ({ id, bytes }) => {
                const decoder = this.#pageUsbAutoDecoders.get(id);
                if (decoder === undefined) {
                    throw new Error(`unknown USB Auto decoder ${id}`);
                }
                return decoder.feed(bytes);
            },
            ReleaseUsbAutoDecoder: (id) => {
                this.#pageUsbAutoDecoders.delete(id);
            },
        });
    }
    #mintPageCodecId() {
        const id = this.#nextPageCodecId;
        this.#nextPageCodecId = id === Number.MAX_SAFE_INTEGER ? 1 : id + 1;
        return id;
    }
    async registerNodePage(appData) {
        try {
            return Tag("Registered", destinationHash(this.#runtime.registerNodePage({ appData })));
        }
        catch (error) {
            return runtimeRejected("register-node-page", error);
        }
    }
    execute(command) {
        return this.#execute(command);
    }
    #execute(command) {
        if (this.#lifecycle.tag !== "Running") {
            return Promise.resolve(commandFailed(Tag("NodeStopped")));
        }
        return match_into().from(command, {
            Announce: ({ destination, interface: interfaceId }) => this.#issueCommand("announce", command, (entropy) => this.#runtime.announce({
                destination,
                ...(interfaceId === undefined ? {} : { interfaceId }),
                nowMs: this.#now(),
                entropy,
            })),
            SendSinglePacket: ({ destination, payload }) => this.#issueCommand("send-single-packet", command, (entropy) => this.#runtime.sendSinglePacket({
                destination,
                payload,
                nowMs: this.#now(),
                entropy,
            })),
            CloseLink: ({ linkId: value }) => this.#issueCommand("close-link", command, (entropy) => this.#runtime.closeLink({
                linkId: value,
                nowMs: this.#now(),
                entropy,
            })),
            AttachTcpServer: async () => commandFailed(Tag("UnsupportedByBackend")),
            AttachTcpClient: async () => commandFailed(Tag("UnsupportedByBackend")),
            AttachUdp: async () => commandFailed(Tag("UnsupportedByBackend")),
            AttachInterface: ({ config, routing }) => this.#attachInterface(config, routing),
            DetachInterface: ({ interface: interfaceId }) => this.#detachInterface(interfaceId),
            EstablishLink: ({ destination }) => this.#issueCommand("establish-link", command, (entropy) => this.#runtime.establishLink({
                destination,
                nowMs: this.#now(),
                entropy,
            })),
            RequestPath: ({ destination }) => this.#issueCommand("request-path", command, (entropy) => this.#runtime.requestPath({
                destination,
                nowMs: this.#now(),
                entropy,
            })),
            Identify: ({ linkId: value, identity }) => this.#issueCommand("identify", command, (entropy) => this.#runtime.identify({
                linkId: value,
                identity,
                nowMs: this.#now(),
                entropy,
            })),
            SendLinkPacket: ({ linkId: value, payload }) => this.#issueCommand("send-link-packet", command, (entropy) => {
                const nowMs = this.#now();
                return this.#runtime.sendLinkPacketDirect === undefined
                    ? this.#runtime.sendLinkPacket({
                        linkId: value,
                        payload,
                        nowMs,
                        entropy,
                    })
                    : this.#runtime.sendLinkPacketDirect(value, payload, nowMs, entropy);
            }),
            Request: ({ linkId: value, pathHash, payload, timeout, maximumResponseBytes, }) => this.#issueCommand("request", command, (entropy) => this.#runtime.request({
                linkId: value,
                pathHash,
                payload,
                nowMs: this.#now(),
                entropy,
                ...runtimeResponseTimeout(timeout),
                ...(maximumResponseBytes === undefined
                    ? {}
                    : {
                        maximumResponseBytes: nonNegativeInteger(maximumResponseBytes, "maximumResponseBytes"),
                    }),
            })),
            Respond: ({ linkId: value, requestId: responseRequestId, requestRttMillis, payload, }) => this.#issueCommand("respond", command, (entropy) => this.#runtime.respond({
                linkId: value,
                requestId: responseRequestId,
                requestRttMillis,
                payload,
                nowMs: this.#now(),
                entropy,
            })),
            SendResource: ({ linkId: value, payload, packedMetadata, compression, }) => this.#sendResourceSource(value, byteResourceSource(payload), compression, packedMetadata),
            SetLinkResourceStrategy: ({ linkId: value, strategy }) => this.#issueCommand("set-link-resource-strategy", command, (entropy) => this.#runtime.setLinkResourceStrategy({
                linkId: value,
                nowMs: this.#now(),
                entropy,
                ...runtimeResourceStrategy(strategy),
            })),
            SetDestinationResourceStrategy: async ({ destination, strategy, }) => {
                try {
                    const configured = this.#runtime.setDestinationResourceStrategy({
                        destination,
                        ...runtimeResourceStrategy(strategy),
                    });
                    return configured
                        ? Tag("Succeeded", Tag("ResourceStrategySet"))
                        : commandFailed(Tag("UnknownDestination"));
                }
                catch (error) {
                    return commandFailed(browserCommandFailure("set-destination-resource-strategy", error));
                }
            },
            SendChannelMessage: ({ linkId: value, messageType, payload, }) => {
                if (!Number.isSafeInteger(messageType) ||
                    messageType < 0 ||
                    messageType > 0xefff) {
                    return Promise.resolve(commandFailed(Tag("InvalidChannelMessageType")));
                }
                return this.#issueCommand("send-channel-message", command, (entropy) => this.#runtime.sendChannelMessage({
                    linkId: value,
                    messageType,
                    payload,
                    nowMs: this.#now(),
                    entropy,
                }));
            },
            AllowRequester: ({ destination, pathHash, identity }) => this.#issueCommand("allow-requester", command, (entropy) => this.#runtime.allowRequester({
                destination,
                pathHash,
                identity,
                nowMs: this.#now(),
                entropy,
            })),
        });
    }
    announce(destination, interfaceId) {
        return this.execute(Tag("Announce", interfaceId === undefined
            ? { destination }
            : { destination, interface: interfaceId }));
    }
    sendSinglePacket(destination, payload) {
        return this.execute(Tag("SendSinglePacket", { destination, payload }));
    }
    closeLink(value) {
        return this.execute(Tag("CloseLink", { linkId: value }));
    }
    attachInterface(config, routing) {
        return this.execute(routing === undefined
            ? Tag("AttachInterface", { config })
            : Tag("AttachInterface", { config, routing }));
    }
    detachInterface(interfaceId) {
        return this.execute(Tag("DetachInterface", { interface: interfaceId }));
    }
    establishLink(destination) {
        return this.execute(Tag("EstablishLink", { destination }));
    }
    requestPath(destination) {
        return this.execute(Tag("RequestPath", { destination }));
    }
    identify(value, identity) {
        return this.execute(Tag("Identify", { linkId: value, identity }));
    }
    sendLinkPacket(value, payload) {
        return this.execute(Tag("SendLinkPacket", { linkId: value, payload }));
    }
    request(value, pathHash, payload, timeout = Tag("LinkDefault"), maximumResponseBytes) {
        return this.execute(Tag("Request", {
            linkId: value,
            pathHash,
            payload,
            timeout,
            ...(maximumResponseBytes === undefined
                ? {}
                : { maximumResponseBytes }),
        }));
    }
    respond(value, responseRequestId, requestRttMillis, payload) {
        return this.execute(Tag("Respond", {
            linkId: value,
            requestId: responseRequestId,
            requestRttMillis,
            payload,
        }));
    }
    sendResource(value, payload, options = {}) {
        return this.execute(Tag("SendResource", {
            linkId: value,
            payload,
            compression: options.compression ?? Tag("Auto"),
            ...(options.packedMetadata === undefined
                ? {}
                : { packedMetadata: options.packedMetadata }),
        }));
    }
    sendResourceBlob(value, blob, options = {}) {
        return this.#sendResourceSource(value, blobResourceSource(blob), options.compression ?? Tag("Auto"), options.packedMetadata);
    }
    setLinkResourceStrategy(value, strategy) {
        return this.execute(Tag("SetLinkResourceStrategy", { linkId: value, strategy }));
    }
    setDestinationResourceStrategy(destination, strategy) {
        return this.execute(Tag("SetDestinationResourceStrategy", {
            destination,
            strategy,
        }));
    }
    sendChannelMessage(value, messageType, payload) {
        return this.execute(Tag("SendChannelMessage", {
            linkId: value,
            messageType,
            payload,
        }));
    }
    allowRequester(destination, pathHash, identity) {
        return this.execute(Tag("AllowRequester", { destination, pathHash, identity }));
    }
    get lifecycle() {
        return this.#lifecycle;
    }
    get execution() {
        return "MainThread";
    }
    get backendInfo() {
        return cooperativeBackendInfo();
    }
    get capabilities() {
        const info = this.backendInfo;
        return Tag("Cooperative", {
            available: new Set(info.capabilities),
            interfaceKinds: new Set(info.interfaceKinds),
        });
    }
    projection(view) {
        return this.#projections.projection(view);
    }
    stop() {
        if (this.#stopCompleted) {
            return Promise.resolve(Tag("AlreadyStopped"));
        }
        if (this.#stopPromise !== undefined) {
            return this.#stopPromise;
        }
        this.#stopPromise = this.#performStop();
        return this.#stopPromise;
    }
    claimEvents() {
        this.#pumpEvents();
        return this.#events.claim();
    }
    claimDiagnostics() {
        this.#pumpEvents();
        return this.#diagnostics.claim();
    }
    async snapshot() {
        const outcome = this.#captureWorkerSnapshot();
        if (outcome.tag !== "PackedSnapshot") {
            return outcome;
        }
        try {
            return Tag("Captured", parsePackedSnapshot(outcome.data));
        }
        catch (error) {
            return runtimeRejected("snapshot", error);
        }
    }
    async hostSnapshot() {
        try {
            return Tag("Captured", this.#captureHostSnapshot());
        }
        catch (error) {
            return runtimeRejected("snapshot", error);
        }
    }
    async #performStop() {
        const preserveFailure = this.#lifecycle.tag === "Failed";
        if (!preserveFailure) {
            this.#setLifecycle(Tag("Stopping"));
        }
        for (const pending of this.#pendingCommands.values()) {
            pending.settle(commandFailed(Tag("NodeStopped")));
        }
        this.#pendingCommands.clear();
        this.#responseParts.clear();
        this.#host.stopCrypto();
        this.#cryptoExecutor?.close();
        this.#cryptoExecutor = undefined;
        const sessions = [...this.#attachedInterfaces.values()];
        for (const reassembler of this.#pageBluetoothReassemblers.values()) {
            reassembler.release?.();
        }
        for (const decoder of this.#pageUsbAutoDecoders.values()) {
            decoder.release?.();
        }
        this.#pageBluetoothReassemblers.clear();
        this.#pageUsbAutoDecoders.clear();
        this.#attachedInterfaces.clear();
        const failures = (await Promise.all(sessions.map(async (session) => {
            try {
                const closed = await session.close();
                return closed.tag === "Closed"
                    ? undefined
                    : describeInterfaceSessionFailure(closed);
            }
            catch (error) {
                return describeHostError(error);
            }
        }))).filter((failure) => failure !== undefined);
        if (this.#persistenceStore !== undefined) {
            let failure;
            try {
                const state = parseBrowserPersistedState(this.#runtime.persistedState({ nowMs: this.#now() }));
                const saved = await this.#persistenceStore.save(state);
                if (saved.tag !== "Saved") {
                    failure = describePersistenceStoreFailure(saved);
                }
            }
            catch (error) {
                failure = describeHostError(error);
            }
            if (failure === undefined) {
                this.#lastPersistenceFlushCause = "Shutdown";
                this.#persistenceFailureDetail = undefined;
                this.#publishDiagnostic(Tag("PersistenceFlushed", {
                    cause: "Shutdown",
                    target: "RoutingState",
                }));
                this.#publishDiagnostic(Tag("PersistenceFlushed", {
                    cause: "Shutdown",
                    target: "Ratchets",
                }));
            }
            else {
                this.#persistenceFailureDetail = failure;
                this.#publishDiagnostic(Tag("PersistenceFlushFailed", {
                    cause: "Shutdown",
                    target: "RoutingState",
                }));
                this.#publishDiagnostic(Tag("PersistenceFlushFailed", {
                    cause: "Shutdown",
                    target: "Ratchets",
                }));
                failures.push(`flush persistence: ${failure}`);
            }
        }
        this.#events.finish();
        this.#diagnostics.finish();
        this.#stopCompleted = true;
        if (failures.length > 0) {
            const detail = failures.join("; ");
            this.#setLifecycle(Tag("Failed", { cause: "BackendFailed", detail }));
            return Tag("OperationFailed", { operation: "stop", detail });
        }
        if (!preserveFailure) {
            this.#setLifecycle(Tag("Stopped", { reason: "Requested" }));
        }
        return Tag("Stopped");
    }
    #attachInterface(config, routing) {
        const unsupported = async () => commandFailed(Tag("UnsupportedByBackend"));
        return match_into().from(config, {
            AutoLan: unsupported,
            TcpClient: unsupported,
            TcpServer: unsupported,
            Udp: unsupported,
            Serial: unsupported,
            Kiss: unsupported,
            Ax25Kiss: unsupported,
            RNode: unsupported,
            MultiRNode: unsupported,
            Pipe: unsupported,
            BackboneClient: unsupported,
            BackboneServer: unsupported,
            I2p: unsupported,
            Weave: unsupported,
            AutomaticUsb: unsupported,
            AutomaticBluetoothLe: unsupported,
            WebSocketClient: ({ target, framing }) => this.#attachWebSocket(target, "WebSocketClient", framing, routing),
            WebSocketServer: unsupported,
            BrowserRendezvous: ({ url }) => this.#attachWebSocket(url, "BrowserRendezvous", BROWSER_RENDEZVOUS_FRAMING_SELECTION, routing),
        });
    }
    async #attachWebSocket(target, kind, framing, routing) {
        const connected = await this.interfaces.webSocket.connect(target, routing === undefined ? { framing } : { framing, routing });
        if (connected.tag !== "Connected") {
            return commandFailed(webSocketCommandFailure(connected));
        }
        const session = connected.data;
        const key = interfaceKey(session.interfaceId);
        if (this.#attachedInterfaces.has(key)) {
            await session.close();
            return commandFailed(Tag("BackendFailed", {
                detail: `runtime reused active interface identifier ${byteKey(session.interfaceId)}`,
            }));
        }
        this.#host.setContractKind(session.interfaceId, kind);
        this.#attachedInterfaces.set(key, session);
        return Tag("Succeeded", Tag("InterfaceAttached", { interface: session.interfaceId }));
    }
    async #detachInterface(interfaceId) {
        const key = interfaceKey(interfaceId);
        const session = this.#attachedInterfaces.get(key);
        if (session === undefined) {
            return commandFailed(Tag("UnknownInterface"));
        }
        this.#attachedInterfaces.delete(key);
        const closed = await session.close();
        if (closed.tag !== "Closed") {
            return commandFailed(Tag("BackendFailed", {
                detail: describeInterfaceSessionFailure(closed),
            }));
        }
        return Tag("Succeeded", Tag("InterfaceDetached", { interface: interfaceId }));
    }
    #entropyBytes() {
        return fillEntropy(this.#entropy, MIN_ENTROPY_BYTES);
    }
    #issueCommand(operation, command, issue) {
        return this.#issuePendingCommand(operation, Tag("HostCommand", { command }), issue);
    }
    #issueResourceSegment(input) {
        return this.#issuePendingCommand("send-resource", Tag("ResourceSegment"), (entropy) => this.#runtime.sendResourceSegment({
            ...input,
            nowMs: this.#now(),
            entropy,
        }));
    }
    #issuePendingCommand(operation, pending, issue) {
        if (this.#lifecycle.tag !== "Running") {
            return Promise.resolve(commandFailed(Tag("NodeStopped")));
        }
        if (this.#pendingCommands.size >= this.#limits.pendingCommands) {
            return Promise.resolve(commandFailed(Tag("Busy")));
        }
        const entropy = this.#entropyBytes();
        if (entropy.tag !== "Filled") {
            return Promise.resolve(commandFailed(Tag("EntropyUnavailable")));
        }
        let id;
        try {
            id = commandId(issue(entropy.data));
        }
        catch (error) {
            return Promise.resolve(commandFailed(browserCommandFailure(operation, error)));
        }
        return new Promise((settle) => {
            this.#pendingCommands.set(id, { pending, settle });
            this.#host.drainBrowserWork();
            this.#host.notifyRuntimeActivity();
        });
    }
    #sendResourceSource(value, source, compression, packedMetadata) {
        if (this.#lifecycle.tag !== "Running") {
            return Promise.resolve(Tag("Failed", Tag("NodeStopped")));
        }
        return sendResourceFromSource(value, source, compression, packedMetadata, {
            maximumInFlightSegments: this.#limits.pendingCommands,
            plan: (input) => this.#runtime.resourceSegmentPlan(input),
            compress: (payload, metadata) => browserResourceCompressor.compress(payload, metadata, this.#resourceCompressionModuleUrl),
            issue: (input) => this.#issueResourceSegment(input),
        });
    }
    #pumpEvents() {
        if (this.#lifecycle.tag === "Failed" || this.#lifecycle.tag === "Stopped") {
            return;
        }
        let parsed;
        let hadBatch = false;
        try {
            const batch = this.#runtime.drainEventBatch();
            hadBatch = batch.byteLength > 16;
            const drainCommandSettlementBatch = this.#runtime.drainCommandSettlementBatch;
            const controlEvents = drainCommandSettlementBatch === undefined
                ? this.#runtime.drainEvents().map(parseEvent)
                : parseCommandSettlementBatch(drainCommandSettlementBatch.call(this.#runtime));
            parsed = [
                ...(this.#eventBatchSink === undefined
                    ? parseEventBatch(batch)
                    : parseCorrelatedEventBatch(batch)),
                ...controlEvents,
            ];
            if (batch.byteLength > 16) {
                if (this.#eventBatchSink !== undefined) {
                    for (const diagnostic of parseDiagnosticEventBatch(batch)) {
                        this.#projections.publishDiagnostic(diagnostic);
                    }
                }
                this.#eventBatchSink?.(batch);
            }
        }
        catch (error) {
            this.#failContract(describeHostError(error));
            return;
        }
        for (const event of parsed) {
            match(event, {
                Application: (application) => {
                    this.#publishApplication(application);
                },
                Diagnostic: (diagnostic) => {
                    this.#publishDiagnostic(diagnostic);
                },
                CommandResponse: ({ commandId: responseCommandId, event }) => {
                    this.#publishApplication(event);
                    this.#responseParts.set(responseCommandId, [event.data.data]);
                },
                CommandResponseSegment: ({ commandId: responseCommandId, event, }) => {
                    this.#publishApplication(event);
                    const parts = this.#responseParts.get(responseCommandId) ?? [];
                    parts.push(event.data.data);
                    this.#responseParts.set(responseCommandId, parts);
                },
                CommandSettled: ({ commandId, settlement }) => {
                    if (settlement === undefined) {
                        return;
                    }
                    const pending = this.#pendingCommands.get(commandId);
                    if (pending === undefined) {
                        return;
                    }
                    this.#pendingCommands.delete(commandId);
                    pending.settle(match(pending.pending, {
                        HostCommand: ({ command }) => this.#commandSettlement(commandId, command, settlement),
                        ResourceSegment: () => settlement,
                    }));
                },
            });
        }
        if (parsed.length > 0 || hadBatch) {
            this.#scheduleProjectionRefresh();
        }
    }
    #publishApplication(event) {
        if (this.#eventBatchSink === undefined) {
            this.#events.push(event);
        }
    }
    #publishDiagnostic(event) {
        this.#projections.publishDiagnostic(event);
        if (this.#eventBatchSink === undefined) {
            this.#diagnostics.push(event);
            return;
        }
        this.#directDiagnosticSink?.(event);
    }
    #commandSettlement(id, command, settlement) {
        if (settlement.tag === "Failed") {
            this.#responseParts.delete(id);
            return settlement;
        }
        if (command.tag === "Request") {
            if (settlement.data.tag !== "PacketDelivered") {
                this.#responseParts.delete(id);
                return commandFailed(Tag("WriteFailed", {
                    detail: "request settled without delivery evidence",
                }));
            }
            const parts = this.#responseParts.get(id);
            this.#responseParts.delete(id);
            if (parts === undefined) {
                return commandFailed(Tag("WriteFailed", {
                    detail: "request settled without response data",
                }));
            }
            return Tag("Succeeded", Tag("ResponseReceived", {
                data: concatenateBytes(parts),
                rttMillis: settlement.data.data.rttMillis,
            }));
        }
        if (command.tag === "Respond") {
            if (settlement.data.tag !== "ResponseSent") {
                return commandFailed(Tag("WriteFailed", {
                    detail: "response settled with an unexpected outcome",
                }));
            }
            return Tag("Succeeded", Tag("ResponseSent", {
                rttMillis: command.data.requestRttMillis,
            }));
        }
        return settlement;
    }
    #failBackpressure(rejectedEventBytes) {
        this.#setLifecycle(Tag("Failed", {
            cause: "EventBackpressureExceeded",
            limits: this.#limits,
            rejectedEventBytes,
        }));
        this.#events.finish();
        this.#diagnostics.finish();
        this.#settleFailedCommands("application event backpressure exceeded");
    }
    #failContract(detail) {
        this.#setLifecycle(Tag("Failed", {
            cause: "ContractViolated",
            detail,
        }));
        const error = new Error(detail);
        this.#events.fail(error);
        this.#diagnostics.fail(error);
        this.#settleFailedCommands(detail);
    }
    #settleFailedCommands(detail) {
        for (const pending of this.#pendingCommands.values()) {
            pending.settle(commandFailed(Tag("WriteFailed", { detail })));
        }
        this.#pendingCommands.clear();
        this.#responseParts.clear();
    }
    #observeProjection(view) {
        if (view.tag === "Diagnostics" ||
            view.tag === "Lifecycle") {
            return;
        }
        this.#observedProjectionViews.add(view.tag);
        this.#scheduleProjectionRefresh();
    }
    #unobserveProjection(view) {
        if (view.tag === "Diagnostics" ||
            view.tag === "Lifecycle") {
            return;
        }
        this.#observedProjectionViews.delete(view.tag);
    }
    async #synchronizeProjection(view) {
        if (this.#lifecycle.tag !== "Running") {
            return Tag("Unavailable", { lifecycle: this.#lifecycle });
        }
        if (view.tag === "Lifecycle" || view.tag === "Diagnostics") {
            return Tag("Synchronized", this.#projections.projection(view).latest());
        }
        try {
            this.#refreshProjectionViews(new Set([view.tag]));
            return Tag("Synchronized", this.#projections.projection(view).latest());
        }
        catch (error) {
            this.#failContract(describeHostError(error));
            return this.#lifecycle.tag === "Running"
                ? Tag("Busy")
                : Tag("Unavailable", { lifecycle: this.#lifecycle });
        }
    }
    #refreshProjectionViews(views) {
        if (views.size === 0) {
            return;
        }
        const snapshot = parseRuntimeProjectionSnapshot(this.#runtime.projectionSnapshot({
            interfaces: views.has("Interfaces"),
            routes: views.has("Routes"),
            links: views.has("Links"),
        }));
        this.#applyRuntimeProjectionSnapshot(snapshot, views);
    }
    #applyRuntimeProjectionSnapshot(snapshot, views) {
        if (views.has("Interfaces")) {
            if (snapshot.interfaces === undefined) {
                throw new Error("runtime omitted requested interface projection");
            }
            this.#projections.replaceInterfaces(this.#projectInterfaces(snapshot.interfaces));
        }
        if (views.has("Routes")) {
            if (snapshot.routes === undefined) {
                throw new Error("runtime omitted requested route projection");
            }
            this.#projections.replaceRoutes(snapshot.routes);
        }
        if (views.has("Links")) {
            if (snapshot.links === undefined) {
                throw new Error("runtime omitted requested link projection");
            }
            this.#projections.replaceLinks(snapshot.links);
        }
    }
    #projectInterfaces(interfaces) {
        const inspection = this.#host.interfaceInspection();
        const running = this.#lifecycle.tag === "Running";
        const health = running ? "Connected" : "Disabled";
        return interfaces.map((entry) => {
            const active = inspection.get(interfaceKey(entry.id));
            return {
                interfaceId: entry.id,
                ...(active === undefined ? {} : { name: active.name }),
                ...(active?.kind === undefined ? {} : { kind: active.kind }),
                health,
                rxBytes: BigInt(active?.rxBytes ?? 0),
                txBytes: BigInt(active?.txBytes ?? 0),
                routeCount: entry.routes,
                linkCount: entry.links,
                transportedLinkCount: entry.transportedLinks,
            };
        });
    }
    #captureHostSnapshot() {
        const captured = this.#captureWorkerSnapshot();
        if (captured.tag === "RuntimeRejected") {
            throw new Error(captured.data.detail);
        }
        const snapshot = captured.tag === "PackedSnapshot"
            ? parsePackedSnapshot(captured.data)
            : captured.data;
        const interfaces = this.#projectInterfaces(snapshot.interfaces);
        const running = this.#lifecycle.tag === "Running";
        const interfaceCount = interfaces.length;
        const transportedLinkCount = interfaces.reduce((total, entry) => saturatingAdd(total, entry.transportedLinkCount), 0);
        const rxBytes = interfaces.reduce((total, entry) => total + entry.rxBytes, 0n);
        const txBytes = interfaces.reduce((total, entry) => total + entry.txBytes, 0n);
        return {
            revision: snapshot.revision,
            backend: this.backendInfo,
            interfaces,
            routes: snapshot.routeSnapshots,
            activeLinkCount: snapshot.activeLinkCount,
            destinationIdentities: snapshot.destinationIdentities,
            runtime: {
                running,
                uptimeMillis: Math.max(0, this.#now() - this.#startedAtMillis),
                interfaceCount,
                onlineInterfaceCount: running ? interfaceCount : 0,
                routeCount: snapshot.routeSnapshots.length,
                linkCount: snapshot.activeLinkCount,
                transportedLinkCount,
                rxBytes,
                txBytes,
                rxBps: 0,
                txBps: 0,
            },
            persistence: {
                persistent: this.#persistenceStore !== undefined,
                restored: this.#persistenceRestored,
                ...(this.#lastPersistenceFlushCause === undefined
                    ? {}
                    : { lastFlushCause: this.#lastPersistenceFlushCause }),
                ...(this.#persistenceFailureDetail === undefined
                    ? {}
                    : { lastFailureDetail: this.#persistenceFailureDetail }),
            },
        };
    }
    #captureWorkerSnapshot() {
        try {
            const snapshotPacked = this.#runtime.snapshotPacked;
            if (snapshotPacked === undefined) {
                return Tag("Captured", parseSnapshot(this.#runtime.snapshot()));
            }
            const bytes = snapshotPacked.call(this.#runtime);
            if (!(bytes instanceof Uint8Array)) {
                throw new TypeError("runtime packed snapshot is not a Uint8Array");
            }
            return Tag("PackedSnapshot", bytes);
        }
        catch (error) {
            return runtimeRejected("snapshot", error);
        }
    }
    #scheduleProjectionRefresh() {
        if (this.#projectionRefreshScheduled ||
            this.#observedProjectionViews.size === 0) {
            return;
        }
        this.#projectionRefreshScheduled = true;
        queueMicrotask(() => {
            this.#projectionRefreshScheduled = false;
            if (this.#lifecycle.tag === "Failed") {
                return;
            }
            try {
                this.#refreshProjectionViews(this.#observedProjectionViews);
            }
            catch (error) {
                this.#failContract(describeHostError(error));
            }
        });
    }
    #setLifecycle(lifecycle) {
        this.#lifecycle = lifecycle;
        this.#projections.replaceLifecycle(lifecycle);
        this.#scheduleProjectionRefresh();
    }
}
function browserCommandFailure(operation, error) {
    const detail = describeHostError(error);
    if (detail.includes("payload exceeds")) {
        return Tag("PayloadTooLarge");
    }
    return Tag("WriteFailed", { detail: `${operation}: ${detail}` });
}
function runtimeResponseTimeout(timeout) {
    return match(timeout, {
        LinkDefault: () => ({}),
        Exact: ({ millis }) => ({
            timeoutMillis: nonNegativeInteger(millis, "timeoutMillis"),
        }),
    });
}
function runtimeResourceStrategy(strategy) {
    return match(strategy, {
        Refuse: () => ({ strategy: "refuse" }),
        Accept: ({ maximumUncompressedBytes, acceptCompressed, }) => ({
            strategy: "accept",
            maximumUncompressedBytes: nonNegativeInteger(maximumUncompressedBytes, "maximumUncompressedBytes"),
            acceptCompressed,
        }),
    });
}
function concatenateBytes(parts) {
    const length = parts.reduce((total, part) => total + part.length, 0);
    const joined = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        joined.set(part, offset);
        offset += part.length;
    }
    return joined;
}
function webSocketCommandFailure(failure) {
    return match_into().from(failure, {
        HostApiUnavailable: ({ api }) => Tag("DeviceUnavailable", { detail: `${api} is unavailable` }),
        PermissionDenied: ({ detail }) => Tag("PermissionDenied", { detail }),
        Cancelled: ({ stage }) => Tag("ConnectFailed", { detail: `WebSocket ${stage} was cancelled` }),
        AlreadyActive: ({ target }) => Tag("BackendFailed", { detail: `${target} is already active` }),
        InvalidTarget: ({ detail }) => Tag("InvalidConfiguration", { detail }),
        TimedOut: ({ stage, timeoutMs }) => Tag("ConnectFailed", {
            detail: `WebSocket ${stage} timed out after ${timeoutMs}ms`,
        }),
        ConnectionFailed: ({ detail }) => Tag("ConnectFailed", { detail }),
        RuntimeRejected: ({ operation, detail }) => Tag("BackendFailed", { detail: `${operation}: ${detail}` }),
    });
}
