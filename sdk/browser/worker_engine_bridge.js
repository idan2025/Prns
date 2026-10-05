const hooksByOptions = new WeakMap();
const capabilityDispatchers = new WeakMap();
const snapshotCapturers = new WeakMap();
const networkOutboundDispatchers = new WeakMap();
export function bindWorkerEngineOptions(options, hooks) {
    hooksByOptions.set(options, hooks);
    return options;
}
export function workerEngineHooks(options) {
    return hooksByOptions.get(options);
}
export function registerWorkerCapabilityDispatcher(owner, dispatcher) {
    capabilityDispatchers.set(owner, dispatcher);
}
export function dispatchWorkerCapability(owner, call) {
    const dispatcher = capabilityDispatchers.get(owner);
    if (dispatcher === undefined) {
        return Promise.reject(new Error("worker capability dispatcher is unavailable"));
    }
    return dispatcher(call);
}
export function registerWorkerNetworkOutboundDispatcher(owner, dispatcher) {
    networkOutboundDispatchers.set(owner, dispatcher);
}
export function dispatchWorkerNetworkOutbound(owner, interfaceId, maximumFrames) {
    const dispatcher = networkOutboundDispatchers.get(owner);
    if (dispatcher === undefined) {
        return Promise.reject(new Error("worker network outbound dispatcher is unavailable"));
    }
    return dispatcher(interfaceId, maximumFrames);
}
export function registerWorkerSnapshotCapturer(owner, capture) {
    snapshotCapturers.set(owner, capture);
}
export function captureWorkerSnapshot(owner) {
    const capture = snapshotCapturers.get(owner);
    if (capture === undefined) {
        throw new Error("worker snapshot capturer is unavailable");
    }
    return capture();
}
