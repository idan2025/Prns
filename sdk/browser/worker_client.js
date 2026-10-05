import { Tag, match_into } from "../casework.js";
import { BoundedAsyncLane } from "../async_lanes.js";
import { IDENTITY_SECRET_LENGTH, balancedLimits, } from "../contract.js";
import { browserLimits, loadBundledWasm, loadWasmModule, loadOrCreateBleIdentity, webCryptoIdentity, } from "./bootstrap.js";
import { commandFailed } from "./command_settlement.js";
import { parseEventBatch, retainedApplicationEventBytes, } from "./events.js";
import { describeHostError } from "./host_errors.js";
import { describeInterfaceSessionFailure } from "./session.js";
import { parsePackedSnapshot } from "./packed_snapshot.js";
import { parseSnapshot } from "./snapshot.js";
import { BrowserLocalStorageBleIdentityStore, describePersistenceStoreFailure, parseBrowserPersistedState, } from "./persistence.js";
import { BluetoothInterface } from "./bluetooth/index.js";
import { UsbAutoInterface } from "./usb_auto/index.js";
import { RNodeInterface } from "./rnode.js";
import { interfaceKey } from "./bytes.js";
import { bitrateBps, hardwareMtu, packetFrame } from "./values.js";
import { identitySecretKey, } from "./values.js";
import { loadOrCreateAutoWifiSelectionSeed } from "./auto_wifi/index.js";
import { MAXIMUM_PENDING_PROJECTION_SYNCHRONIZATIONS, WORKER_WIRE_MAXIMUM_BYTES, workerCall, workerCapabilityCall, } from "./worker_protocol.js";
import { BatchedPortReceiver, BatchedPortSender, messageTaskScheduler, } from "../worker_wire/batched_port.js";
import { MAXIMUM_WIRE_BATCH_ITEMS } from "../worker_wire/wire_batch.js";
import { MINIMUM_WORKER_CODEC_ITEMS, workerInvocationCodec, workerInvocationWireBytes, workerSettlementCodec, } from "./worker_codecs.js";
import { PrnsProjectionStore } from "./projections.js";
import { parseProjectionSynchronization, parseWorkerDiagnosticEvent, parseWorkerProjectionUpdate, } from "./worker_projection_validation.js";
const WORKER_START_TIMEOUT_MILLIS = 10_000;
const MAXIMUM_PENDING_CONTROL_CALLS = 32;
export async function createDedicatedWorkerPrns(options) {
    if (typeof globalThis.Worker !== "function") {
        return Tag("WorkerStartFailed", {
            detail: "DedicatedWorker is not available in this browser context",
        });
    }
    const prepared = await prepareWorker(options);
    if (prepared.tag !== "Prepared") {
        return prepared;
    }
    let worker;
    try {
        worker = new Worker(new URL("./worker.js", import.meta.url), {
            type: "module",
            name: "prns-engine",
        });
    }
    catch (error) {
        return Tag("WorkerStartFailed", { detail: describeHostError(error) });
    }
    const controlChannel = new MessageChannel();
    const eventChannel = new MessageChannel();
    const capabilityChannel = new MessageChannel();
    const projectionChannel = new MessageChannel();
    const shutdownChannel = new MessageChannel();
    const client = new DedicatedWorkerPrns(worker, controlChannel.port1, eventChannel.port1, capabilityChannel.port1, projectionChannel.port1, shutdownChannel.port1, prepared.data.initialization.limits, prepared.data.persistenceStore, prepared.data.wasm, prepared.data.bleIdentityAvailability);
    const started = client.started();
    const message = Tag("Initialize", {
        initialization: prepared.data.initialization,
        control: controlChannel.port2,
        events: eventChannel.port2,
        capabilities: capabilityChannel.port2,
        projections: projectionChannel.port2,
        shutdown: shutdownChannel.port2,
    });
    worker.postMessage(message, [
        controlChannel.port2,
        eventChannel.port2,
        capabilityChannel.port2,
        projectionChannel.port2,
        shutdownChannel.port2,
    ]);
    const outcome = await started;
    if (outcome.tag !== "Ready") {
        client.terminate();
        return outcome;
    }
    client.acceptStart(outcome.data);
    return Tag("Ready", client);
}
class DedicatedWorkerPrns {
    interfaces;
    #worker;
    #control;
    #eventsPort;
    #capabilitiesPort;
    #projectionsPort;
    #shutdownPort;
    #limits;
    #persistenceStore;
    #events;
    #diagnostics;
    #controlSender;
    #capabilitySender;
    #controlSettlements;
    #capabilitySettlements;
    #projectionUpdates;
    #pending = new Map();
    #ignoredSettlements = new Set();
    #capabilityPending = new Map();
    #pendingProjectionSynchronizations = new Map();
    #pageSessions = new Map();
    #webSocketSessions = new Map();
    #autoWifi;
    #nextCallId = 1;
    #nextProjectionSynchronizationId = 1;
    #startSettled = false;
    #startTimer;
    #startResolve;
    #lifecycle = Tag("Starting");
    #backendInfo;
    #stopPromise;
    #stopCompleted = false;
    #terminated = false;
    #stoppedSnapshot;
    #stoppedHostSnapshot;
    #persistenceFailureDetail;
    #projections;
    #pendingCommandCount = 0;
    #pendingControlCount = 0;
    #shutdownResolve;
    #shutdownReject;
    constructor(worker, control, events, capabilities, projections, shutdown, limits, persistenceStore, wasm, bleIdentityAvailability) {
        this.#worker = worker;
        this.#control = control;
        this.#eventsPort = events;
        this.#capabilitiesPort = capabilities;
        this.#projectionsPort = projections;
        this.#shutdownPort = shutdown;
        this.#limits = limits;
        this.#persistenceStore = persistenceStore;
        this.#events = new BoundedAsyncLane({
            name: "ApplicationEvents",
            maximumValues: limits.applicationEvents,
            maximumBytes: limits.retainedEventBytes,
            measure: retainedApplicationEventBytes,
            onRejected: (rejectedEventBytes) => this.#failBackpressure(rejectedEventBytes),
        });
        this.#diagnostics = new BoundedAsyncLane({
            name: "Diagnostics",
            maximumValues: limits.diagnostics,
            maximumBytes: Number.MAX_SAFE_INTEGER,
            measure: () => 0,
            gap: (count) => Tag("DiagnosticsDropped", { count }),
        });
        this.#controlSender = new BatchedPortSender({
            port: control,
            wrap: (batch) => Tag("Calls", { batch }),
            maximumItems: Math.min(MAXIMUM_WIRE_BATCH_ITEMS, limits.pendingCommands),
            maximumQueuedItems: limits.pendingCommands + MAXIMUM_PENDING_CONTROL_CALLS,
            maximumBytes: WORKER_WIRE_MAXIMUM_BYTES,
            measureBytes: workerInvocationWireBytes,
            scheduleTask: messageTaskScheduler(),
            failed: (error) => this.#failProtocol(describeHostError(error)),
            codec: workerInvocationCodec,
            codecPolicy: { minimumCodecItems: MINIMUM_WORKER_CODEC_ITEMS },
        });
        this.#capabilitySender = new BatchedPortSender({
            port: capabilities,
            wrap: (batch) => Tag("CapabilityCalls", { batch }),
            maximumItems: Math.min(MAXIMUM_WIRE_BATCH_ITEMS, limits.pendingCommands),
            maximumQueuedItems: limits.pendingCommands,
            maximumBytes: WORKER_WIRE_MAXIMUM_BYTES,
            measureBytes: workerCapabilityInvocationWireBytes,
            scheduleTask: messageTaskScheduler(),
            failed: (error) => this.#failProtocol(describeHostError(error)),
        });
        this.#controlSettlements = new BatchedPortReceiver((settlement) => this.#receiveControlSettlement(settlement), [workerSettlementCodec]);
        this.#capabilitySettlements = new BatchedPortReceiver((settlement) => {
            this.#receiveCapabilitySettlement(settlement);
        });
        this.#projectionUpdates = new BatchedPortReceiver((update) => {
            this.#applyProjectionUpdate(parseWorkerProjectionUpdate(update));
        });
        const capabilityHost = new WorkerCapabilityHost(wasm, bleIdentityAvailability, () => this.#lifecycle, (call) => this.#capabilityCall(call));
        this.#autoWifi = new WorkerAutoWifiInterface(this);
        this.interfaces = {
            webSocket: new WorkerWebSocketInterface(this),
            bluetooth: new BluetoothInterface(capabilityHost, (session) => this.#pageSessions.set(interfaceKey(session.interfaceId), session)),
            usbAuto: new UsbAutoInterface(capabilityHost, (session) => this.#pageSessions.set(interfaceKey(session.interfaceId), session)),
            rnode: new RNodeInterface(capabilityHost),
            autoWifi: this.#autoWifi,
        };
        control.addEventListener("message", (event) => {
            this.#receiveWorkerMessage(event.data, (message) => {
                this.#receiveControl(message);
            });
        });
        events.addEventListener("message", (event) => {
            this.#receiveWorkerMessage(event.data, (message) => {
                this.#receiveEvent(message);
            });
        });
        capabilities.addEventListener("message", (event) => {
            this.#receiveWorkerMessage(event.data, (message) => {
                this.#receiveCapability(message);
            });
        });
        projections.addEventListener("message", (event) => {
            this.#receiveWorkerMessage(event.data, (message) => {
                this.#receiveProjection(message);
            });
        });
        shutdown.addEventListener("message", (event) => {
            this.#receiveWorkerMessage(event.data, (message) => {
                this.#receiveShutdown(message);
            });
        });
        control.start();
        events.start();
        capabilities.start();
        projections.start();
        shutdown.start();
        worker.addEventListener("error", (event) => {
            this.#failProtocol(event.message || "DedicatedWorker failed");
        });
        worker.addEventListener("messageerror", () => {
            this.#failProtocol("DedicatedWorker message could not be decoded");
        });
    }
    started() {
        return new Promise((resolve) => {
            this.#startResolve = resolve;
            this.#startTimer = globalThis.setTimeout(() => {
                if (!this.#startSettled) {
                    this.#settleStart(Tag("WorkerStartFailed", {
                        detail: `DedicatedWorker did not start within ${WORKER_START_TIMEOUT_MILLIS} milliseconds`,
                    }));
                }
            }, WORKER_START_TIMEOUT_MILLIS);
        });
    }
    acceptStart(data) {
        this.#backendInfo = data.backendInfo;
        this.#lifecycle = data.lifecycle;
        this.#projections = new PrnsProjectionStore(data.hostSnapshot, data.lifecycle, this.#limits.diagnostics, {
            observed: (view) => {
                if (view.tag !== "Diagnostics" && view.tag !== "Lifecycle") {
                    this.#sendProjectionRequest(Tag("Observe", { view }));
                }
            },
            unobserved: (view) => {
                if (view.tag !== "Diagnostics" && view.tag !== "Lifecycle") {
                    this.#sendProjectionRequest(Tag("Unobserve", { view }));
                }
            },
            synchronize: (view) => this.#synchronizeProjection(view),
            diagnosticCapacityChanged: (maximumEvents) => this.#sendProjectionRequest(Tag("ObserveDiagnostics", { maximumEvents })),
        });
    }
    terminate() {
        if (this.#terminated) {
            return;
        }
        this.#terminated = true;
        if (this.#startTimer !== undefined) {
            globalThis.clearTimeout(this.#startTimer);
            this.#startTimer = undefined;
        }
        this.#controlSender.fail();
        this.#capabilitySender.fail();
        this.#control.close();
        this.#eventsPort.close();
        this.#capabilitiesPort.close();
        this.#projectionsPort.close();
        this.#shutdownPort.close();
        this.#worker.terminate();
    }
    async registerSingleDestination(options) {
        return this.#call(workerCall("RegisterSingleDestination", options));
    }
    async registerNodePage(appData) {
        return this.#call(workerCall("RegisterNodePage", appData));
    }
    execute(command) {
        if (this.#pendingCommandCount >= this.#limits.pendingCommands) {
            return Promise.resolve(commandFailed(Tag("Busy")));
        }
        if (this.#lifecycle.tag !== "Running") {
            return Promise.resolve(commandFailed(Tag("NodeStopped")));
        }
        return this.#call(workerCall("Execute", command));
    }
    announce(destination, interfaceId) {
        return this.execute(Tag("Announce", interfaceId === undefined
            ? { destination }
            : { destination, interface: interfaceId }));
    }
    sendSinglePacket(destination, payload) {
        return this.execute(Tag("SendSinglePacket", { destination, payload }));
    }
    closeLink(linkId) {
        return this.execute(Tag("CloseLink", { linkId }));
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
    identify(linkId, identity) {
        return this.execute(Tag("Identify", { linkId, identity }));
    }
    sendLinkPacket(linkId, payload) {
        return this.execute(Tag("SendLinkPacket", { linkId, payload }));
    }
    request(linkId, pathHash, payload, timeout = Tag("LinkDefault"), maximumResponseBytes) {
        return this.execute(Tag("Request", maximumResponseBytes === undefined
            ? { linkId, pathHash, payload, timeout }
            : { linkId, pathHash, payload, timeout, maximumResponseBytes }));
    }
    respond(linkId, requestId, requestRttMillis, payload) {
        return this.execute(Tag("Respond", { linkId, requestId, requestRttMillis, payload }));
    }
    sendResource(linkId, payload, options = {}) {
        return this.execute(Tag("SendResource", {
            linkId,
            payload,
            ...(options.packedMetadata === undefined ? {} : { packedMetadata: options.packedMetadata }),
            compression: options.compression ?? Tag("Auto"),
        }));
    }
    sendResourceBlob(linkId, blob, options = {}) {
        if (this.#pendingCommandCount >= this.#limits.pendingCommands) {
            return Promise.resolve(commandFailed(Tag("Busy")));
        }
        if (this.#lifecycle.tag !== "Running") {
            return Promise.resolve(commandFailed(Tag("NodeStopped")));
        }
        return this.#call(workerCall("SendResourceBlob", { linkId, blob, options }));
    }
    setLinkResourceStrategy(linkId, strategy) {
        return this.execute(Tag("SetLinkResourceStrategy", { linkId, strategy }));
    }
    setDestinationResourceStrategy(destination, strategy) {
        return this.execute(Tag("SetDestinationResourceStrategy", { destination, strategy }));
    }
    sendChannelMessage(linkId, messageType, payload) {
        return this.execute(Tag("SendChannelMessage", { linkId, messageType, payload }));
    }
    allowRequester(destination, pathHash, identity) {
        return this.execute(Tag("AllowRequester", { destination, pathHash, identity }));
    }
    get lifecycle() {
        return this.#lifecycle;
    }
    get execution() {
        return "DedicatedWorker";
    }
    get backendInfo() {
        if (this.#backendInfo === undefined) {
            throw new Error("DedicatedWorker backend information is not ready");
        }
        return this.#backendInfo;
    }
    get capabilities() {
        const info = this.backendInfo;
        return Tag("Cooperative", {
            available: new Set(info.capabilities),
            interfaceKinds: new Set(info.interfaceKinds),
        });
    }
    projection(view) {
        if (this.#projections === undefined) {
            throw new Error("DedicatedWorker projections are not ready");
        }
        return this.#projections.projection(view);
    }
    claimEvents() {
        const claim = this.#events.claim();
        if (claim.tag === "Claimed") {
            this.#sendEventRequest(Tag("ClaimApplicationEvents"));
        }
        return claim;
    }
    claimDiagnostics() {
        const claim = this.#diagnostics.claim();
        if (claim.tag === "Claimed") {
            this.#sendEventRequest(Tag("ClaimDiagnostics"));
        }
        return claim;
    }
    snapshot() {
        if (this.#stoppedSnapshot !== undefined) {
            return Promise.resolve(this.#stoppedSnapshot);
        }
        return this.#call(workerCall("Snapshot"));
    }
    async hostSnapshot() {
        const outcome = this.#stoppedHostSnapshot ??
            await this.#call(workerCall("HostSnapshot"));
        if (outcome.tag !== "Captured" || this.#persistenceFailureDetail === undefined) {
            return outcome;
        }
        return Tag("Captured", {
            ...outcome.data,
            persistence: {
                ...outcome.data.persistence,
                lastFailureDetail: this.#persistenceFailureDetail,
            },
        });
    }
    stop() {
        if (this.#stopCompleted) {
            return Promise.resolve(Tag("AlreadyStopped"));
        }
        if (this.#stopPromise !== undefined) {
            return this.#stopPromise;
        }
        this.#setLifecycle(Tag("Stopping"));
        this.#cancelPendingCommands();
        this.#stopPromise = this.#performStop();
        return this.#stopPromise;
    }
    webSocketConnect(url, options) {
        return this.#call(workerCall("WebSocketConnect", {
            url: url.toString(),
            options,
        })).then((outcome) => {
            if (outcome.tag !== "Connected") {
                return outcome;
            }
            const session = new WorkerWebSocketSession(this, outcome.data);
            this.#webSocketSessions.set(outcome.data.id, session);
            return Tag("Connected", session);
        });
    }
    async closeSession(id) {
        const outcome = await this.#call(workerCall("InterfaceSessionClose", id));
        if (outcome.tag === "Closed") {
            this.#webSocketSessions.get(id)?.markClosed();
            this.#webSocketSessions.delete(id);
        }
        return outcome;
    }
    startAutoWifi() {
        return this.#call(workerCall("AutoWifiStart"));
    }
    closeAutoWifi() {
        return this.#call(workerCall("AutoWifiClose"));
    }
    async #performStop() {
        this.#autoWifi.finishFromHostStop();
        const pageSessionFailures = await this.#closePageSessions();
        try {
            const stopped = await this.#requestWorkerShutdown();
            this.#stoppedSnapshot = stopped.snapshot;
            this.#stoppedHostSnapshot = stopped.hostSnapshot;
            for (const session of this.#webSocketSessions.values()) {
                session.markClosed();
            }
            this.#webSocketSessions.clear();
            const failures = [...pageSessionFailures];
            if (stopped.persistedState !== undefined && this.#persistenceStore !== undefined) {
                try {
                    const saved = await this.#persistenceStore.save(parseBrowserPersistedState(stopped.persistedState));
                    if (saved.tag !== "Saved") {
                        this.#persistenceFailureDetail = describePersistenceStoreFailure(saved);
                        failures.push(this.#persistenceFailureDetail);
                    }
                }
                catch (error) {
                    this.#persistenceFailureDetail = describeHostError(error);
                    failures.push(this.#persistenceFailureDetail);
                }
            }
            if (stopped.stopOutcome.tag === "OperationFailed") {
                failures.push(stopped.stopOutcome.data.detail);
            }
            this.#events.finish();
            this.#diagnostics.finish();
            if (failures.length > 0) {
                const detail = failures.join("; ");
                this.#setLifecycle(Tag("Failed", { cause: "BackendFailed", detail }));
                return Tag("OperationFailed", { operation: "stop", detail });
            }
            this.#setLifecycle(stopped.stopOutcome.tag === "Stopped"
                ? Tag("Stopped", { reason: "Requested" })
                : this.#lifecycle);
            return stopped.stopOutcome;
        }
        catch (error) {
            const detail = describeHostError(error);
            this.#failProtocol(detail);
            return Tag("OperationFailed", { operation: "stop", detail });
        }
        finally {
            this.#stopCompleted = true;
            this.#failPendingCalls("DedicatedWorker stopped");
            this.terminate();
        }
    }
    #requestWorkerShutdown() {
        return new Promise((resolve, reject) => {
            this.#shutdownResolve = resolve;
            this.#shutdownReject = reject;
            this.#shutdownPort.postMessage(Tag("Stop"));
        });
    }
    #receiveShutdown(response) {
        const resolve = this.#shutdownResolve;
        const reject = this.#shutdownReject;
        if (resolve === undefined || reject === undefined) {
            this.#failProtocol("DedicatedWorker sent an unexpected shutdown response");
            return;
        }
        if (response.tag === "ProtocolFailed") {
            const detail = workerProtocolDetail(response.data.detail);
            this.#shutdownResolve = undefined;
            this.#shutdownReject = undefined;
            reject(new Error(detail));
            return;
        }
        if (response.tag !== "Stopped") {
            throw new TypeError("DedicatedWorker sent an unknown shutdown response");
        }
        if (typeof response.data !== "object" ||
            response.data === null ||
            response.data.stopOutcome === undefined ||
            response.data.snapshot === undefined ||
            response.data.hostSnapshot === undefined) {
            throw new TypeError("DedicatedWorker shutdown response is incomplete");
        }
        this.#shutdownResolve = undefined;
        this.#shutdownReject = undefined;
        resolve(response.data);
    }
    #cancelPendingCommands() {
        for (const [id, pending] of this.#pending) {
            if (pending.call.tag !== "Execute" &&
                pending.call.tag !== "SendResourceBlob") {
                continue;
            }
            this.#pending.delete(id);
            this.#ignoredSettlements.add(id);
            this.#releaseCallCapacity(pending.call);
            pending.settle(commandFailed(Tag("NodeStopped")));
        }
    }
    #releaseCallCapacity(call) {
        if (call.tag === "Execute" || call.tag === "SendResourceBlob") {
            this.#pendingCommandCount = Math.max(0, this.#pendingCommandCount - 1);
            return;
        }
        this.#pendingControlCount = Math.max(0, this.#pendingControlCount - 1);
    }
    async #closePageSessions() {
        const sessions = [...this.#pageSessions.values()];
        this.#pageSessions.clear();
        const outcomes = await Promise.all(sessions.map(async (session) => {
            try {
                const closed = await session.close();
                return closed.tag === "Closed"
                    ? undefined
                    : describeInterfaceSessionFailure(closed);
            }
            catch (error) {
                return describeHostError(error);
            }
        }));
        return outcomes.filter((outcome) => outcome !== undefined);
    }
    #call(call) {
        if (this.#terminated) {
            return Promise.reject(new Error("DedicatedWorker has terminated"));
        }
        const command = call.tag === "Execute" || call.tag === "SendResourceBlob";
        if (command) {
            if (this.#pendingCommandCount >= this.#limits.pendingCommands) {
                return Promise.resolve(workerCallBusyOutcome(call));
            }
        }
        else if (this.#pendingControlCount >= MAXIMUM_PENDING_CONTROL_CALLS) {
            return Promise.resolve(workerCallBusyOutcome(call));
        }
        const id = this.#nextCallId;
        this.#nextCallId = this.#nextCallId === Number.MAX_SAFE_INTEGER ? 1 : this.#nextCallId + 1;
        return new Promise((settle, fail) => {
            this.#pending.set(id, {
                call,
                settle: settle,
                fail,
            });
            if (command) {
                this.#pendingCommandCount += 1;
            }
            else {
                this.#pendingControlCount += 1;
            }
            const admission = this.#controlSender.send({ id, call });
            if (admission.tag === "Sent") {
                return;
            }
            this.#pending.delete(id);
            this.#releaseCallCapacity(call);
            if (admission.tag === "Busy") {
                settle(workerCallBusyOutcome(call));
                return;
            }
            fail(new Error("DedicatedWorker control sender has failed"));
        });
    }
    #capabilityCall(call) {
        if (this.#terminated) {
            return Promise.reject(new Error("DedicatedWorker has terminated"));
        }
        if (this.#capabilityPending.size >= this.#limits.pendingCommands) {
            return Promise.resolve(workerAdmissionRejected("capability"));
        }
        const id = this.#nextCallId;
        this.#nextCallId = this.#nextCallId === Number.MAX_SAFE_INTEGER ? 1 : this.#nextCallId + 1;
        return new Promise((settle, fail) => {
            this.#capabilityPending.set(id, {
                call,
                settle: settle,
                fail,
            });
            const admission = this.#capabilitySender.send({ id, call });
            if (admission.tag === "Sent") {
                return;
            }
            this.#capabilityPending.delete(id);
            if (admission.tag === "Busy") {
                settle(workerAdmissionRejected("capability"));
                return;
            }
            fail(new Error("DedicatedWorker capability sender has failed"));
        });
    }
    #receiveControl(message) {
        match_into().from(message, {
            Started: ({ outcome }) => {
                if (this.#startSettled || this.#startResolve === undefined) {
                    this.#failProtocol("DedicatedWorker sent duplicate startup state");
                    return;
                }
                this.#settleStart(workerStartOutcome(outcome));
            },
            Settlements: ({ batch }) => {
                this.#controlSettlements.receive(batch);
            },
            SessionStatusChanged: ({ id: rawId, status }) => {
                const id = workerMessageId(rawId, "session status");
                const session = this.#webSocketSessions.get(id);
                if (session === undefined) {
                    this.#failProtocol(`DedicatedWorker updated unknown session ${id}`);
                    return;
                }
                const parsed = workerSessionStatus(status);
                session.replaceStatus(parsed);
                if (parsed.tag === "Closed" || parsed.tag === "Failed") {
                    this.#webSocketSessions.delete(id);
                }
            },
            AutoWifiStatusChanged: (status) => {
                if (!this.#autoWifi.replaceStatus(workerAutoWifiStatus(status))) {
                    this.#failProtocol("DedicatedWorker updated inactive Auto Wi-Fi state");
                }
            },
            ProtocolFailed: ({ id, detail }) => {
                if (id !== undefined) {
                    const pending = this.#pending.get(id);
                    if (pending !== undefined) {
                        this.#pending.delete(id);
                        this.#releaseCallCapacity(pending.call);
                        pending.fail(new Error(detail));
                        return;
                    }
                }
                this.#failProtocol(detail);
            },
            EventBackpressureExceeded: ({ rejectedEventBytes }) => {
                this.#failBackpressure(rejectedEventBytes);
            },
        });
    }
    #receiveWorkerMessage(message, receive) {
        try {
            if (typeof message !== "object" ||
                message === null ||
                !("tag" in message) ||
                typeof message.tag !== "string") {
                throw new TypeError("DedicatedWorker message envelope is malformed");
            }
            receive(message);
        }
        catch (error) {
            this.#failProtocol(describeHostError(error));
        }
    }
    #receiveControlSettlement(message) {
        if (this.#ignoredSettlements.delete(message.id)) {
            return;
        }
        const pending = this.#pending.get(message.id);
        if (pending === undefined) {
            this.#failProtocol(`DedicatedWorker settled unknown call ${message.id}`);
            return;
        }
        if (pending.call.tag !== message.call) {
            this.#failProtocol(`DedicatedWorker settled call ${message.id} as ${message.call}`);
            return;
        }
        this.#pending.delete(message.id);
        this.#releaseCallCapacity(pending.call);
        pending.settle(pending.call.tag === "Snapshot"
            ? workerSnapshotOutcome(message.outcome)
            : message.outcome);
    }
    #receiveCapability(message) {
        match_into().from(message, {
            CapabilitySettlements: ({ batch }) => {
                this.#capabilitySettlements.receive(batch);
            },
            ProtocolFailed: ({ id, detail }) => {
                if (id !== undefined) {
                    const pending = this.#capabilityPending.get(id);
                    if (pending !== undefined) {
                        this.#capabilityPending.delete(id);
                        pending.fail(new Error(detail));
                        return;
                    }
                }
                this.#failProtocol(detail);
            },
        });
    }
    #receiveCapabilitySettlement(message) {
        const pending = this.#capabilityPending.get(message.id);
        if (pending === undefined) {
            this.#failProtocol(`DedicatedWorker settled unknown capability call ${message.id}`);
            return;
        }
        if (pending.call.tag !== message.call) {
            this.#failProtocol(`DedicatedWorker settled capability call ${message.id} as ${message.call}`);
            return;
        }
        this.#capabilityPending.delete(message.id);
        pending.settle(message.outcome);
    }
    #receiveProjection(message) {
        if (message.tag === "ProjectionProtocolFailed") {
            this.#failProtocol(workerProtocolDetail(message.data.detail));
            return;
        }
        if (message.tag === "ProjectionSynchronized") {
            const id = workerMessageId(message.data.id, "projection");
            const pending = this.#pendingProjectionSynchronizations.get(id);
            if (pending === undefined) {
                this.#failProtocol(`DedicatedWorker synchronized unknown projection request ${id}`);
                return;
            }
            const outcome = parseProjectionSynchronization(pending.view, message.data.outcome);
            this.#pendingProjectionSynchronizations.delete(id);
            pending.settle(outcome);
            return;
        }
        if (message.tag !== "ProjectionBatch") {
            throw new TypeError("DedicatedWorker sent an unknown projection message");
        }
        const id = workerMessageId(message.data.id, "projection");
        const projections = this.#projections;
        if (projections === undefined) {
            this.#failProtocol("DedicatedWorker sent projections before startup completed");
            return;
        }
        try {
            this.#projectionUpdates.receive(message.data.batch);
            this.#sendProjectionRequest(Tag("AcknowledgeProjection", { id }));
        }
        catch (error) {
            this.#failProtocol(describeHostError(error));
        }
    }
    #sendProjectionRequest(request) {
        if (!this.#terminated) {
            this.#projectionsPort.postMessage(request);
        }
    }
    #synchronizeProjection(view) {
        if (this.#lifecycle.tag !== "Running") {
            return Promise.resolve(Tag("Unavailable", { lifecycle: this.#lifecycle }));
        }
        if (this.#pendingProjectionSynchronizations.size >=
            MAXIMUM_PENDING_PROJECTION_SYNCHRONIZATIONS) {
            return Promise.resolve(Tag("Busy"));
        }
        const id = this.#nextProjectionSynchronizationId;
        this.#nextProjectionSynchronizationId = id === Number.MAX_SAFE_INTEGER
            ? 1
            : id + 1;
        return new Promise((resolve) => {
            this.#pendingProjectionSynchronizations.set(id, {
                view,
                settle: resolve,
            });
            this.#sendProjectionRequest(Tag("Synchronize", { id, view }));
        });
    }
    #applyProjectionUpdate(update) {
        const projections = this.#projections;
        if (projections === undefined) {
            throw new Error("DedicatedWorker projection store is unavailable");
        }
        match_into().from(update, {
            Lifecycle: (snapshot) => {
                this.#lifecycle = snapshot.value;
                projections.replaceLifecycle(snapshot.value, snapshot.revision);
            },
            Interfaces: (snapshot) => projections.replaceInterfaces(snapshot.value, snapshot.revision),
            Routes: (snapshot) => projections.replaceRoutes(snapshot.value, snapshot.revision),
            Links: (snapshot) => projections.replaceLinks(snapshot.value, snapshot.revision),
            DiagnosticsReset: (snapshot) => projections.replaceDiagnostics(snapshot.value, snapshot.revision),
            DiagnosticsDelta: ({ revision, dropped, appended }) => projections.appendDiagnostics(dropped, appended, revision),
        });
    }
    #receiveEvent(message) {
        try {
            if (message.tag === "Batch") {
                const id = workerMessageId(message.data.id, "event");
                if (!(message.data.buffer instanceof ArrayBuffer)) {
                    throw new TypeError("event batch buffer must be an ArrayBuffer");
                }
                for (const event of parseEventBatch(new Uint8Array(message.data.buffer))) {
                    const outcome = match_into().from(event, {
                        Application: (application) => this.#events.push(application),
                        Diagnostic: (diagnostic) => this.#diagnostics.push(diagnostic),
                        CommandResponse: ({ event: response }) => this.#events.push(response),
                        CommandResponseSegment: ({ event: response }) => this.#events.push(response),
                        CommandSettled: () => "Ignored",
                    });
                    if (outcome === "Rejected") {
                        return;
                    }
                }
                this.#acknowledgeEvent(id);
                return;
            }
            if (message.tag !== "Diagnostic") {
                throw new TypeError("DedicatedWorker sent an unknown event message");
            }
            const id = workerMessageId(message.data.id, "event");
            const diagnostic = parseWorkerDiagnosticEvent(message.data.event);
            if (this.#diagnostics.push(diagnostic) !== "Rejected") {
                this.#acknowledgeEvent(id);
            }
        }
        catch (error) {
            this.#failProtocol(describeHostError(error));
        }
    }
    #acknowledgeEvent(id) {
        this.#sendEventRequest(Tag("Acknowledge", { id }));
    }
    #sendEventRequest(request) {
        if (!this.#terminated) {
            this.#eventsPort.postMessage(request);
        }
    }
    #failBackpressure(rejectedEventBytes) {
        if (!this.#startSettled && this.#startResolve !== undefined) {
            this.#settleStart(Tag("WorkerProtocolFailed", {
                detail: "DedicatedWorker application event backpressure exceeded during startup",
            }));
        }
        this.#setLifecycle(Tag("Failed", {
            cause: "EventBackpressureExceeded",
            limits: this.#limits,
            rejectedEventBytes,
        }));
        this.#events.finish();
        this.#diagnostics.finish();
        this.#failPendingCalls("application event backpressure exceeded");
        this.terminate();
    }
    #failProtocol(detail) {
        if (!this.#startSettled && this.#startResolve !== undefined) {
            this.#settleStart(Tag("WorkerProtocolFailed", { detail }));
        }
        this.#setLifecycle(Tag("Failed", { cause: "ContractViolated", detail }));
        const error = new Error(detail);
        this.#failPendingCalls(detail);
        this.#events.fail(error);
        this.#diagnostics.fail(error);
        this.terminate();
    }
    #setLifecycle(lifecycle) {
        this.#lifecycle = lifecycle;
        this.#projections?.replaceLifecycle(lifecycle);
    }
    #failPendingCalls(detail) {
        const error = new Error(detail);
        this.#shutdownReject?.(error);
        this.#shutdownResolve = undefined;
        this.#shutdownReject = undefined;
        for (const pending of this.#pending.values()) {
            if (pending.call.tag === "Execute" ||
                pending.call.tag === "SendResourceBlob") {
                pending.settle(commandFailed(Tag("WriteFailed", { detail })));
            }
            else {
                pending.fail(error);
            }
        }
        this.#pending.clear();
        this.#pendingCommandCount = 0;
        this.#pendingControlCount = 0;
        if (this.#lifecycle.tag !== "Running") {
            const unavailable = Tag("Unavailable", { lifecycle: this.#lifecycle });
            for (const pending of this.#pendingProjectionSynchronizations.values()) {
                pending.settle(unavailable);
            }
            this.#pendingProjectionSynchronizations.clear();
        }
        for (const pending of this.#capabilityPending.values()) {
            pending.fail(error);
        }
        this.#capabilityPending.clear();
    }
    #settleStart(outcome) {
        const resolve = this.#startResolve;
        if (this.#startSettled || resolve === undefined) {
            return;
        }
        this.#startSettled = true;
        this.#startResolve = undefined;
        if (this.#startTimer !== undefined) {
            globalThis.clearTimeout(this.#startTimer);
            this.#startTimer = undefined;
        }
        resolve(outcome);
    }
}
class WorkerCapabilityHost {
    #wasm;
    #bleIdentityAvailability;
    #lifecycle;
    #call;
    constructor(wasm, bleIdentityAvailability, lifecycle, call) {
        this.#wasm = wasm;
        this.#bleIdentityAvailability = bleIdentityAvailability;
        this.#lifecycle = lifecycle;
        this.#call = call;
    }
    runtimeReadiness() {
        return this.#lifecycle().tag === "Running"
            ? Tag("Ready")
            : Tag("RuntimeRejected", {
                operation: "inspect-readiness",
                detail: "DedicatedWorker runtime is not running",
            });
    }
    bluetoothIdentityReadiness() {
        return this.#bleIdentityAvailability.tag === "Available"
            ? Tag("Ready")
            : this.#bleIdentityAvailability;
    }
    bluetoothServiceUuid() {
        return this.#wasm.bluetoothServiceUuid();
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
        return this.#bleIdentityAvailability.tag === "Available"
            ? this.#wasm.bluetoothDialerHello(this.#bleIdentityAvailability.data)
            : new Uint8Array();
    }
    bluetoothDecodeControl(bytes) {
        return this.#wasm.bluetoothDecodeControl(bytes);
    }
    bluetoothDataFragments(bytes) {
        return this.#wasm.bluetoothDataFragments(packetFrame(bytes));
    }
    createBluetoothReassembler() {
        return new WorkerBluetoothReassembler(this.#call);
    }
    defaultUsbAutoFilters() {
        return [{
                vendorId: this.#wasm.usbAutoWebUsbVendorId(),
                productId: this.#wasm.usbAutoWebUsbProductId(),
            }];
    }
    usbAutoHostBitrateBps() {
        return bitrateBps(this.#wasm.usbAutoHostBitrateBps());
    }
    usbAutoHostHardwareMtu() {
        return hardwareMtu(this.#wasm.usbAutoHostHardwareMtu());
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
    usbAutoDataFrame(bytes) {
        return this.#wasm.usbAutoDataFrame(packetFrame(bytes));
    }
    createUsbAutoDecoder() {
        return new WorkerUsbAutoDecoder(this.#call);
    }
    registerInterface(registration) {
        return this.#call(workerCapabilityCall("RegisterInterface", registration));
    }
    deactivateInterface(interfaceId) {
        return this.#call(workerCapabilityCall("DeactivateInterface", interfaceId));
    }
    ingest(interfaceId, bytes) {
        return this.#call(workerCapabilityCall("Ingest", { interfaceId, bytes }));
    }
    nextOutboundFor(interfaceId, maximumFrames) {
        return this.#call(workerCapabilityCall("NextOutbound", {
            interfaceId,
            ...(maximumFrames === undefined ? {} : { maximumFrames }),
        }));
    }
}
class WorkerBluetoothReassembler {
    #call;
    #id;
    #released = false;
    constructor(call) {
        this.#call = call;
        this.#id = call(workerCapabilityCall("CreateBluetoothReassembler"));
    }
    async absorb(bytes) {
        if (this.#released) {
            return undefined;
        }
        const id = await this.#id;
        if (isRuntimeRejected(id)) {
            return id;
        }
        return this.#call(workerCapabilityCall("AbsorbBluetoothFragment", {
            id,
            bytes,
        }));
    }
    release() {
        if (this.#released) {
            return;
        }
        this.#released = true;
        void this.#id.then((id) => isRuntimeRejected(id)
            ? undefined
            : this.#call(workerCapabilityCall("ReleaseBluetoothReassembler", id))).catch(() => undefined);
    }
}
class WorkerUsbAutoDecoder {
    #call;
    #id;
    #released = false;
    constructor(call) {
        this.#call = call;
        this.#id = call(workerCapabilityCall("CreateUsbAutoDecoder"));
    }
    async feed(bytes) {
        if (this.#released) {
            return [];
        }
        const id = await this.#id;
        if (isRuntimeRejected(id)) {
            return id;
        }
        return this.#call(workerCapabilityCall("FeedUsbAutoDecoder", {
            id,
            bytes,
        }));
    }
    release() {
        if (this.#released) {
            return;
        }
        this.#released = true;
        void this.#id.then((id) => isRuntimeRejected(id)
            ? undefined
            : this.#call(workerCapabilityCall("ReleaseUsbAutoDecoder", id))).catch(() => undefined);
    }
}
class WorkerWebSocketInterface {
    name = "websocket";
    #client;
    constructor(client) {
        this.#client = client;
    }
    connect(url, options = {}) {
        return this.#client.webSocketConnect(url, options);
    }
}
class WorkerWebSocketSession {
    name = "websocket";
    interfaceId;
    url;
    framing;
    #client;
    #id;
    #statusListeners = new Set();
    #status;
    #closePromise;
    constructor(client, projection) {
        this.#client = client;
        this.#id = projection.id;
        this.interfaceId = projection.interfaceId;
        this.url = projection.url;
        this.framing = projection.framing;
        this.#status = projection.status;
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
    close() {
        if (this.#closePromise !== undefined) {
            return this.#closePromise;
        }
        this.#closePromise = this.#client.closeSession(this.#id).finally(() => {
            this.#closePromise = undefined;
        });
        return this.#closePromise;
    }
    markClosed() {
        this.replaceStatus(Tag("Closed"));
    }
    replaceStatus(status) {
        this.#status = status;
        for (const changed of this.#statusListeners) {
            changed(status);
        }
    }
}
class WorkerAutoWifiInterface {
    name = "auto-wifi";
    #client;
    #controller;
    constructor(client) {
        this.#client = client;
    }
    start() {
        if (this.#controller !== undefined && !this.#controller.closed) {
            return this.#controller;
        }
        this.#controller = new WorkerAutoWifiController(this.#client);
        return this.#controller;
    }
    finishFromHostStop() {
        this.#controller?.finishFromHostStop();
    }
    replaceStatus(status) {
        const controller = this.#controller;
        if (controller === undefined) {
            return false;
        }
        if (!controller.closed) {
            controller.replaceStatus(status);
        }
        return true;
    }
}
class WorkerAutoWifiController {
    #client;
    #statusListeners = new Set();
    #status = Tag("Starting");
    #statusVersion = 0;
    #closed = false;
    #closePromise;
    constructor(client) {
        this.#client = client;
        void this.#start();
    }
    get status() {
        return this.#status;
    }
    get closed() {
        return this.#closed;
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
    close() {
        if (this.#closed) {
            return Promise.resolve(Tag("Closed"));
        }
        if (this.#closePromise !== undefined) {
            return this.#closePromise;
        }
        this.#closePromise = this.#performClose().finally(() => {
            this.#closePromise = undefined;
        });
        return this.#closePromise;
    }
    finishFromHostStop() {
        if (this.#closed) {
            return;
        }
        this.#closed = true;
        this.replaceStatus(Tag("Closed"));
    }
    replaceStatus(status) {
        if (status.tag === "Closed") {
            this.#closed = true;
        }
        this.#status = status;
        this.#statusVersion += 1;
        for (const changed of this.#statusListeners) {
            changed(status);
        }
    }
    async #start() {
        const version = this.#statusVersion;
        try {
            const status = await this.#client.startAutoWifi();
            if (!this.#closed && this.#statusVersion === version) {
                this.replaceStatus(status);
            }
        }
        catch (error) {
            if (this.#closed || this.#statusVersion !== version) {
                return;
            }
            this.replaceStatus(Tag("Unavailable", Tag("DiscoveryFailed", { detail: describeHostError(error) })));
        }
    }
    async #performClose() {
        const outcome = await this.#client.closeAutoWifi();
        if (outcome.tag === "Closed" && !this.#closed) {
            this.#closed = true;
            this.replaceStatus(Tag("Closed"));
        }
        return outcome;
    }
}
async function prepareWorker(options) {
    const loadedWasm = options.wasmModuleUrl === undefined
        ? await loadBundledWasm()
        : await loadWasmModule(options.wasmModuleUrl);
    if (loadedWasm.tag !== "Loaded") {
        return loadedWasm;
    }
    const identityOutcome = await prepareIdentity(options);
    if (identityOutcome.tag !== "PreparedIdentity") {
        return identityOutcome;
    }
    const bleIdentityAvailability = await loadOrCreateBleIdentity(options.bleIdentityStore ?? new BrowserLocalStorageBleIdentityStore());
    const persistence = await preparePersistence(options.persistenceStore);
    if (persistence.tag !== "PreparedPersistence") {
        return persistence;
    }
    const limits = browserLimits(options.limits ?? balancedLimits());
    const autoWifiSelectionSeed = await loadOrCreateAutoWifiSelectionSeed();
    return Tag("Prepared", {
        initialization: {
            identity: identityOutcome.data,
            ...(bleIdentityAvailability.tag === "Available"
                ? { bleIdentity: bleIdentityAvailability.data }
                : {}),
            ...(persistence.data === undefined ? {} : { persistedState: persistence.data }),
            persistenceEnabled: options.persistenceStore !== undefined,
            limits,
            networkExecution: options.networkExecution ?? "EngineWorker",
            crypto: options.crypto ?? options.resourceCrypto ?? Tag("PortableWasm"),
            ...(options.resourceCompressionModuleUrl === undefined
                ? {}
                : { resourceCompressionModuleUrl: options.resourceCompressionModuleUrl.href }),
            ...(options.wasmModuleUrl === undefined
                ? {}
                : { wasmModuleUrl: options.wasmModuleUrl.href }),
            ...(options.portableWasmModuleUrl === undefined && options.wasmModuleUrl === undefined
                ? {}
                : {
                    portableWasmModuleUrl: (options.portableWasmModuleUrl ?? options.wasmModuleUrl).href,
                }),
            ...(autoWifiSelectionSeed.tag === "Loaded"
                ? { autoWifiSelectionSeed: autoWifiSelectionSeed.data }
                : {}),
        },
        ...(options.persistenceStore === undefined
            ? {}
            : { persistenceStore: options.persistenceStore }),
        wasm: loadedWasm.data,
        bleIdentityAvailability,
    });
}
async function prepareIdentity(options) {
    const store = options.identityStore;
    if (store !== undefined) {
        let loaded;
        try {
            loaded = await store.load(IDENTITY_SECRET_LENGTH);
        }
        catch (error) {
            return Tag("IdentityStoreFailed", {
                operation: "Load",
                detail: describeHostError(error),
            });
        }
        if (loaded.tag === "Loaded") {
            try {
                return Tag("PreparedIdentity", identitySecretKey(loaded.data, IDENTITY_SECRET_LENGTH));
            }
            catch (error) {
                return Tag("StoredIdentityInvalid", { detail: describeHostError(error) });
            }
        }
        if (loaded.tag !== "Missing") {
            return loaded;
        }
    }
    const generated = webCryptoIdentity(IDENTITY_SECRET_LENGTH);
    if (generated.tag !== "Generated") {
        return generated;
    }
    if (store !== undefined) {
        let saved;
        try {
            saved = await store.save(generated.data);
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
    return Tag("PreparedIdentity", generated.data);
}
async function preparePersistence(store) {
    if (store === undefined) {
        return Tag("PreparedPersistence", undefined);
    }
    let loaded;
    try {
        loaded = await store.load();
    }
    catch (error) {
        return Tag("PersistenceStoreFailed", {
            operation: "Load",
            detail: describeHostError(error),
        });
    }
    if (loaded.tag === "Missing") {
        return Tag("PreparedPersistence", undefined);
    }
    if (loaded.tag !== "Loaded") {
        return loaded;
    }
    try {
        return Tag("PreparedPersistence", parseBrowserPersistedState(loaded.data));
    }
    catch (error) {
        return Tag("StoredPersistenceInvalid", { detail: describeHostError(error) });
    }
}
function workerStartOutcome(value) {
    if (typeof value !== "object" || value === null || !("tag" in value)) {
        return Tag("WorkerProtocolFailed", {
            detail: "DedicatedWorker startup response is malformed",
        });
    }
    const outcome = value;
    if (outcome.tag !== "Ready") {
        return outcome;
    }
    const data = outcome.data;
    if (data?.backendInfo === undefined ||
        data.lifecycle === undefined ||
        data.hostSnapshot === undefined) {
        return Tag("WorkerProtocolFailed", {
            detail: "DedicatedWorker ready response is incomplete",
        });
    }
    return readyWorker({
        backendInfo: data.backendInfo,
        lifecycle: data.lifecycle,
        hostSnapshot: data.hostSnapshot,
    });
}
function readyWorker(state) {
    return Tag("Ready", state);
}
function workerMessageId(raw, channel) {
    if (typeof raw !== "number" || !Number.isSafeInteger(raw) || raw <= 0) {
        throw new TypeError(`${channel} message id must be a positive safe integer`);
    }
    return raw;
}
function workerProtocolDetail(raw) {
    if (typeof raw !== "string" || raw.length === 0) {
        throw new TypeError("worker protocol failure detail must be a non-empty string");
    }
    return raw;
}
function workerSessionStatus(raw) {
    const status = workerTaggedValue(raw, "session status");
    return match_into().from(status, {
        Negotiating: () => Tag("Negotiating"),
        Active: () => Tag("Active"),
        Closed: () => Tag("Closed"),
        Failed: (failure) => {
            workerTaggedValue(failure, "session failure");
            return Tag("Failed", failure);
        },
    });
}
function workerAutoWifiStatus(raw) {
    const status = workerTaggedValue(raw, "Auto Wi-Fi status");
    return match_into().from(status, {
        Starting: () => Tag("Starting"),
        Discovering: ({ attempt }) => {
            if (!Number.isSafeInteger(attempt) || attempt < 0) {
                throw new TypeError("Auto Wi-Fi discovery attempt must be a non-negative safe integer");
            }
            return Tag("Discovering", { attempt });
        },
        Active: ({ gateways }) => Tag("Active", {
            gateways: gateways.map((gateway) => {
                if (typeof gateway.id !== "string" ||
                    typeof gateway.url !== "string" ||
                    !(gateway.interfaceId instanceof Uint8Array) ||
                    typeof gateway.localhost !== "boolean") {
                    throw new TypeError("Auto Wi-Fi gateway status is malformed");
                }
                return gateway;
            }),
        }),
        Unavailable: (failure) => {
            workerTaggedValue(failure, "Auto Wi-Fi failure");
            return Tag("Unavailable", failure);
        },
        Closed: () => Tag("Closed"),
    });
}
function workerTaggedValue(raw, label) {
    if (typeof raw !== "object" ||
        raw === null ||
        !("tag" in raw) ||
        typeof raw.tag !== "string") {
        throw new TypeError(`DedicatedWorker ${label} is malformed`);
    }
    return raw;
}
function workerSnapshotOutcome(raw) {
    const outcome = workerTaggedValue(raw, "snapshot outcome");
    return match_into().from(outcome, {
        PackedSnapshot: (bytes) => {
            if (!(bytes instanceof Uint8Array)) {
                throw new TypeError("DedicatedWorker packed snapshot is malformed");
            }
            return Tag("Captured", parsePackedSnapshot(bytes));
        },
        Captured: (snapshot) => Tag("Captured", parseSnapshot(snapshot)),
        RuntimeRejected: (failure) => Tag("RuntimeRejected", failure),
    });
}
function workerCallBusyOutcome(call) {
    const rejected = workerAdmissionRejected("control");
    return match_into().from(call, {
        RegisterSingleDestination: () => rejected,
        RegisterNodePage: () => rejected,
        Execute: () => commandFailed(Tag("Busy")),
        SendResourceBlob: () => commandFailed(Tag("Busy")),
        Snapshot: () => rejected,
        HostSnapshot: () => rejected,
        WebSocketConnect: () => rejected,
        AutoWifiStart: () => Tag("Unavailable", rejected),
        AutoWifiClose: () => rejected,
        InterfaceSessionClose: () => rejected,
    });
}
function workerAdmissionRejected(channel) {
    return Tag("RuntimeRejected", {
        operation: "worker-admission",
        detail: `DedicatedWorker ${channel} channel is busy`,
    });
}
function isRuntimeRejected(value) {
    return typeof value === "object" && value !== null &&
        "tag" in value && value.tag === "RuntimeRejected";
}
function workerCapabilityInvocationWireBytes(value) {
    const call = value.call;
    if (call.tag === "Ingest" ||
        call.tag === "AbsorbBluetoothFragment" ||
        call.tag === "FeedUsbAutoDecoder") {
        return 64 + call.data.bytes.byteLength;
    }
    return 256;
}
