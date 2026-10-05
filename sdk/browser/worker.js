import { Tag, match } from "../casework.js";
import { loadWasmModule } from "./bootstrap.js";
import { describeHostError } from "./host_errors.js";
import { describeInterfaceSessionFailure } from "./session.js";
import { Prns } from "./index.js";
import { bindWorkerEngineOptions, captureWorkerSnapshot, dispatchWorkerCapability, } from "./worker_engine_bridge.js";
import { WORKER_WIRE_MAXIMUM_BYTES } from "./worker_protocol.js";
import { BoundedWorkerEventSender } from "./worker_event_sender.js";
import { BatchedPortReceiver, BatchedPortSender, messageTaskScheduler, } from "../worker_wire/batched_port.js";
import { MAXIMUM_WIRE_BATCH_ITEMS } from "../worker_wire/wire_batch.js";
import { MINIMUM_WORKER_CODEC_ITEMS, workerInvocationCodec, workerSettlementCodec, workerSettlementWireBytes, } from "./worker_codecs.js";
import { WorkerProjectionServer } from "./worker_projection_server.js";
import { WorkerNetworkClient } from "./worker_network_client.js";
const workerScope = globalThis;
workerScope.addEventListener("message", (event) => {
    if (tagOf(event.data) === "Initialize") {
        void initialize(event.data);
    }
});
async function initialize(message) {
    const { control, events, capabilities, projections, shutdown } = message.data;
    control.start();
    events.start();
    capabilities.start();
    projections.start();
    shutdown.start();
    let eventFlowFailed = false;
    const eventSender = new BoundedWorkerEventSender(events, message.data.initialization.limits, {
        protocol: (detail) => {
            if (!eventFlowFailed) {
                eventFlowFailed = true;
                postControl(control, Tag("ProtocolFailed", { detail }));
            }
        },
        backpressure: (rejectedEventBytes) => {
            if (!eventFlowFailed) {
                eventFlowFailed = true;
                postControl(control, Tag("EventBackpressureExceeded", {
                    rejectedEventBytes,
                }));
            }
        },
    });
    let started;
    try {
        started = await startEngine(message, eventSender);
    }
    catch (error) {
        if (!eventFlowFailed) {
            postControl(control, Tag("ProtocolFailed", {
                detail: describeHostError(error),
            }));
        }
        return;
    }
    if (started.tag !== "Ready") {
        postControl(control, Tag("Started", { outcome: started }));
        return;
    }
    const state = started.data;
    const sessions = new Map();
    const autoWifi = {
        controller: undefined,
        releaseStatus: undefined,
    };
    let nextSessionId = 1;
    let network;
    if (message.data.initialization.networkExecution === "NetworkWorker") {
        const created = await WorkerNetworkClient.create(message.data.initialization, state.engine, (id, status) => {
            postControl(control, Tag("SessionStatusChanged", { id, status }));
            if (status.tag === "Closed" || status.tag === "Failed") {
                sessions.delete(id);
            }
        }, (detail) => {
            postControl(control, Tag("ProtocolFailed", { detail }));
        });
        if (created.tag !== "Ready") {
            await state.engine.stop();
            postControl(control, Tag("ProtocolFailed", {
                detail: created.data.detail,
            }));
            return;
        }
        network = created.data;
    }
    const initialSnapshot = await state.engine.hostSnapshot();
    if (initialSnapshot.tag !== "Captured") {
        postControl(control, Tag("ProtocolFailed", {
            detail: initialSnapshot.data.detail,
        }));
        return;
    }
    postControl(control, Tag("Started", {
        outcome: Tag("Ready", {
            backendInfo: state.engine.backendInfo,
            lifecycle: state.engine.lifecycle,
            hostSnapshot: initialSnapshot.data,
        }),
    }));
    new WorkerProjectionServer(projections, state.engine);
    let shutdownStarted = false;
    shutdown.addEventListener("message", (event) => {
        if (tagOf(event.data) !== "Stop") {
            shutdown.postMessage(Tag("ProtocolFailed", {
                detail: "worker shutdown channel received an unknown message",
            }));
            return;
        }
        if (shutdownStarted) {
            return;
        }
        shutdownStarted = true;
        void stopEngine(state.engine, sessions, autoWifi, network)
            .then(async (stopOutcome) => {
            const persistedState = state.persistenceState();
            const response = Tag("Stopped", {
                stopOutcome,
                ...(persistedState === undefined ? {} : { persistedState }),
                snapshot: await state.engine.snapshot(),
                hostSnapshot: await state.engine.hostSnapshot(),
            });
            shutdown.postMessage(response);
        })
            .catch((error) => {
            shutdown.postMessage(Tag("ProtocolFailed", {
                detail: describeHostError(error),
            }));
        });
    });
    const settlementSender = new BatchedPortSender({
        port: control,
        wrap: (batch) => Tag("Settlements", { batch }),
        maximumItems: MAXIMUM_WIRE_BATCH_ITEMS,
        maximumQueuedItems: MAXIMUM_WIRE_BATCH_ITEMS * 2,
        maximumBytes: WORKER_WIRE_MAXIMUM_BYTES,
        measureBytes: workerSettlementWireBytes,
        scheduleTask: messageTaskScheduler(),
        failed: (error) => {
            postControl(control, Tag("ProtocolFailed", {
                detail: describeHostError(error),
            }));
        },
        codec: workerSettlementCodec,
        codecPolicy: { minimumCodecItems: MINIMUM_WORKER_CODEC_ITEMS },
    });
    const capabilitySettlementSender = new BatchedPortSender({
        port: capabilities,
        wrap: (batch) => Tag("CapabilitySettlements", { batch }),
        maximumItems: MAXIMUM_WIRE_BATCH_ITEMS,
        maximumQueuedItems: MAXIMUM_WIRE_BATCH_ITEMS * 2,
        maximumBytes: WORKER_WIRE_MAXIMUM_BYTES,
        measureBytes: workerCapabilitySettlementWireBytes,
        scheduleTask: messageTaskScheduler(),
        failed: (error) => {
            postControl(capabilities, Tag("ProtocolFailed", {
                detail: describeHostError(error),
            }));
        },
    });
    const callReceiver = new BatchedPortReceiver((invocation) => {
        if (shutdownStarted) {
            return;
        }
        void settleCall(invocation);
    }, [workerInvocationCodec]);
    const capabilityReceiver = new BatchedPortReceiver((invocation) => {
        if (shutdownStarted) {
            return;
        }
        void settleCapability(invocation);
    });
    control.addEventListener("message", (request) => {
        if (shutdownStarted) {
            return;
        }
        try {
            if (tagOf(request.data) !== "Calls") {
                throw new TypeError("worker control channel received an unknown message");
            }
            callReceiver.receive(request.data.data.batch);
        }
        catch (error) {
            postControl(control, Tag("ProtocolFailed", {
                detail: describeHostError(error),
            }));
        }
    });
    capabilities.addEventListener("message", (request) => {
        if (shutdownStarted) {
            return;
        }
        try {
            if (tagOf(request.data) !== "CapabilityCalls") {
                throw new TypeError("worker capability channel received an unknown message");
            }
            capabilityReceiver.receive(request.data.data.batch);
        }
        catch (error) {
            postControl(capabilities, Tag("ProtocolFailed", {
                detail: describeHostError(error),
            }));
        }
    });
    async function settleCall(request) {
        if (shutdownStarted) {
            return;
        }
        try {
            const outcome = await performCall(state.engine, request.call, sessions, () => nextSessionId++, network, autoWifi, (id, status) => {
                postControl(control, Tag("SessionStatusChanged", { id, status }));
            }, (status) => {
                postControl(control, Tag("AutoWifiStatusChanged", status));
            });
            if (shutdownStarted) {
                return;
            }
            const admission = settlementSender.send({
                id: request.id,
                call: request.call.tag,
                outcome,
            });
            if (admission.tag !== "Sent") {
                postControl(control, Tag("ProtocolFailed", {
                    id: request.id,
                    detail: admission.tag === "Busy"
                        ? "worker settlement channel is busy"
                        : "worker settlement channel has failed",
                }));
            }
        }
        catch (error) {
            if (shutdownStarted) {
                return;
            }
            postControl(control, Tag("ProtocolFailed", {
                id: request.id,
                detail: describeHostError(error),
            }));
        }
    }
    async function settleCapability(request) {
        if (shutdownStarted) {
            return;
        }
        try {
            const outcome = await dispatchWorkerCapability(state.engine, request.call);
            if (shutdownStarted) {
                return;
            }
            const admission = capabilitySettlementSender.send({
                id: request.id,
                call: request.call.tag,
                outcome,
            });
            if (admission.tag !== "Sent") {
                postControl(capabilities, Tag("ProtocolFailed", {
                    id: request.id,
                    detail: admission.tag === "Busy"
                        ? "worker capability settlement channel is busy"
                        : "worker capability settlement channel has failed",
                }));
            }
        }
        catch (error) {
            if (shutdownStarted) {
                return;
            }
            postControl(capabilities, Tag("ProtocolFailed", {
                id: request.id,
                detail: describeHostError(error),
            }));
        }
    }
}
async function startEngine(message, events) {
    const initialization = message.data.initialization;
    const identityStore = {
        load: async () => Tag("Loaded", initialization.identity),
        save: async () => Tag("Saved"),
    };
    const bleIdentityStore = initialization.bleIdentity === undefined
        ? {
            load: async () => Tag("Missing"),
            save: async () => Tag("Saved"),
        }
        : {
            load: async () => Tag("Loaded", initialization.bleIdentity),
            save: async () => Tag("Saved"),
        };
    let savedState;
    const persistenceStore = initialization.persistenceEnabled
        ? {
            load: async () => initialization.persistedState === undefined
                ? Tag("Missing")
                : Tag("Loaded", initialization.persistedState),
            save: async (state) => {
                savedState = state;
                return Tag("Saved");
            },
        }
        : undefined;
    const loaded = initialization.wasmModuleUrl === undefined
        ? undefined
        : await loadWasmModule(new URL(initialization.wasmModuleUrl));
    if (loaded !== undefined && loaded.tag !== "Loaded") {
        return loaded;
    }
    const engineOptions = bindWorkerEngineOptions({
        execution: "MainThread",
        ...(loaded === undefined ? {} : { wasm: loaded.data }),
        identityStore,
        bleIdentityStore,
        ...(persistenceStore === undefined ? {} : { persistenceStore }),
        limits: initialization.limits,
        crypto: initialization.crypto,
        ...(initialization.portableWasmModuleUrl === undefined
            ? {}
            : {
                portableWasmModuleUrl: new URL(initialization.portableWasmModuleUrl),
            }),
        ...(initialization.resourceCompressionModuleUrl === undefined
            ? {}
            : {
                resourceCompressionModuleUrl: new URL(initialization.resourceCompressionModuleUrl),
            }),
    }, {
        eventBatchSink: (batch) => {
            events.sendBatch(batch);
        },
        directDiagnosticSink: (diagnostic) => {
            events.sendDiagnostic(diagnostic);
        },
        ...(initialization.autoWifiSelectionSeed === undefined
            ? {}
            : { autoWifiSelectionSeed: initialization.autoWifiSelectionSeed }),
    });
    const created = await Prns.create(engineOptions);
    if (created.tag !== "Ready") {
        return created;
    }
    return Tag("Ready", {
        engine: created.data,
        persistenceState: () => savedState,
    });
}
async function performCall(engine, call, sessions, mintSessionId, network, autoWifi, sessionStatusChanged, autoWifiStatusChanged) {
    return match(call, {
        RegisterSingleDestination: (options) => engine.registerSingleDestination(options),
        RegisterNodePage: (appData) => engine.registerNodePage(appData),
        Execute: (command) => engine.execute(command),
        SendResourceBlob: ({ linkId, blob, options }) => engine.sendResourceBlob(linkId, blob, options),
        Snapshot: () => captureWorkerSnapshot(engine),
        HostSnapshot: () => engine.hostSnapshot(),
        WebSocketConnect: async ({ url, options }) => {
            if (network !== undefined) {
                const id = mintSessionId();
                const outcome = await network.connect(id, url, options);
                if (outcome.tag === "Connected") {
                    sessions.set(id, {
                        close: () => network.closeSession(id),
                        releaseStatus: () => undefined,
                    });
                }
                return outcome;
            }
            const outcome = await engine.interfaces.webSocket.connect(url, options);
            if (outcome.tag !== "Connected") {
                return outcome;
            }
            const id = mintSessionId();
            let releaseStatus = () => undefined;
            releaseStatus = outcome.data.subscribeStatus((status) => {
                sessionStatusChanged(id, status);
                if (status.tag === "Closed" || status.tag === "Failed") {
                    releaseStatus();
                    sessions.delete(id);
                }
            });
            sessions.set(id, {
                close: () => outcome.data.close(),
                releaseStatus,
            });
            return Tag("Connected", {
                id,
                name: outcome.data.name,
                interfaceId: outcome.data.interfaceId,
                status: outcome.data.status,
                url: outcome.data.url,
                framing: outcome.data.framing,
            });
        },
        AutoWifiStart: () => {
            const controller = engine.interfaces.autoWifi.start();
            if (autoWifi.controller !== controller) {
                autoWifi.releaseStatus?.();
                autoWifi.controller = controller;
                autoWifi.releaseStatus = controller.subscribeStatus(autoWifiStatusChanged);
            }
            return autoWifi.controller.status;
        },
        AutoWifiClose: async () => {
            const controller = autoWifi.controller;
            if (controller === undefined) {
                return Tag("Closed");
            }
            const outcome = await controller.close();
            if (autoWifi.controller === controller) {
                autoWifi.controller = undefined;
                autoWifi.releaseStatus?.();
                autoWifi.releaseStatus = undefined;
            }
            return outcome;
        },
        InterfaceSessionClose: async (id) => {
            const tracked = sessions.get(id);
            if (tracked === undefined) {
                return Tag("Closed");
            }
            const outcome = await tracked.close();
            if (sessions.get(id) === tracked) {
                sessions.delete(id);
                tracked.releaseStatus();
            }
            return outcome;
        },
    });
}
async function stopEngine(engine, sessions, autoWifi, network) {
    const failures = [];
    const activeSessions = [...sessions.values()];
    sessions.clear();
    const sessionOutcomes = await Promise.all(activeSessions.map(async (tracked) => {
        try {
            tracked.releaseStatus();
            const outcome = await tracked.close();
            return outcome.tag === "Closed"
                ? undefined
                : describeInterfaceSessionFailure(outcome);
        }
        catch (error) {
            return describeHostError(error);
        }
    }));
    failures.push(...sessionOutcomes.filter((outcome) => outcome !== undefined));
    const autoWifiController = autoWifi.controller;
    autoWifi.controller = undefined;
    autoWifi.releaseStatus?.();
    autoWifi.releaseStatus = undefined;
    if (autoWifiController !== undefined) {
        try {
            const closed = await autoWifiController.close();
            if (closed.tag === "RuntimeRejected") {
                failures.push(closed.data.detail);
            }
        }
        catch (error) {
            failures.push(describeHostError(error));
        }
    }
    network?.terminate();
    const stopped = await engine.stop();
    if (stopped.tag === "OperationFailed") {
        failures.push(stopped.data.detail);
    }
    if (failures.length === 0) {
        return stopped;
    }
    return Tag("OperationFailed", {
        operation: "stop",
        detail: failures.join("; "),
    });
}
function postControl(port, message) {
    port.postMessage(message);
}
function workerCapabilitySettlementWireBytes(value) {
    if (value.outcome instanceof Uint8Array) {
        return 64 + value.outcome.byteLength;
    }
    if (Array.isArray(value.outcome)) {
        return 64 + value.outcome.length * 64;
    }
    return 256;
}
function tagOf(value) {
    if (typeof value !== "object" || value === null || !("tag" in value)) {
        return undefined;
    }
    return typeof value.tag === "string" ? value.tag : undefined;
}
