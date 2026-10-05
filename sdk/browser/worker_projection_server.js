import { Tag, match, match_into } from "../casework.js";
import { describeHostError } from "./host_errors.js";
import { prnsView } from "./projections.js";
import { MAXIMUM_PENDING_PROJECTION_SYNCHRONIZATIONS, } from "./worker_protocol.js";
import { WorkerProjectionSender } from "./worker_projection_sender.js";
import { parseWorkerProjectionRequest } from "./worker_projection_validation.js";
export class WorkerProjectionServer {
    #port;
    #engine;
    #sender;
    #observed = new Map();
    #releaseDiagnostics;
    #pendingSynchronizations = 0;
    constructor(port, engine) {
        this.#port = port;
        this.#engine = engine;
        this.#sender = new WorkerProjectionSender(port, (detail) => {
            this.#post(Tag("ProjectionProtocolFailed", { detail }));
        });
        bindProjectionChanges(engine.projection(prnsView("Lifecycle")), (snapshot) => this.#sender.send(Tag("Lifecycle", snapshot)));
        port.addEventListener("message", (event) => {
            this.#receive(event.data);
        });
        port.start();
    }
    #receive(raw) {
        try {
            const request = parseWorkerProjectionRequest(raw);
            match_into().from(request, {
                AcknowledgeProjection: ({ id }) => {
                    this.#sender.receive(Tag("AcknowledgeProjection", { id }));
                },
                Observe: ({ view }) => {
                    if (!this.#observed.has(view.tag)) {
                        this.#observed.set(view.tag, bindProjection(this.#engine, view, this.#sender));
                    }
                },
                Unobserve: ({ view }) => {
                    this.#observed.get(view.tag)?.();
                    this.#observed.delete(view.tag);
                },
                ObserveDiagnostics: ({ maximumEvents }) => {
                    this.#releaseDiagnostics?.();
                    this.#releaseDiagnostics = undefined;
                    if (maximumEvents > 0) {
                        this.#releaseDiagnostics = bindProjection(this.#engine, prnsView("Diagnostics", { maximumEvents }), this.#sender);
                    }
                },
                Synchronize: ({ id, view }) => this.#synchronize(id, view),
            });
        }
        catch (error) {
            this.#post(Tag("ProjectionProtocolFailed", {
                detail: describeHostError(error),
            }));
        }
    }
    #synchronize(id, view) {
        if (this.#pendingSynchronizations >=
            MAXIMUM_PENDING_PROJECTION_SYNCHRONIZATIONS) {
            this.#post(Tag("ProjectionSynchronized", {
                id,
                outcome: Tag("Busy"),
            }));
            return;
        }
        this.#pendingSynchronizations += 1;
        void this.#engine.projection(view).synchronize()
            .then((outcome) => {
            this.#post(Tag("ProjectionSynchronized", { id, outcome }));
        })
            .catch((error) => {
            this.#post(Tag("ProjectionProtocolFailed", {
                detail: describeHostError(error),
            }));
        })
            .finally(() => {
            this.#pendingSynchronizations -= 1;
        });
    }
    #post(message) {
        this.#port.postMessage(message);
    }
}
function bindProjectionChanges(projection, send) {
    return projection.subscribe(() => send(projection.latest()));
}
function bindProjection(engine, view, sender) {
    return match(view, {
        Lifecycle: () => bind(engine.projection(prnsView("Lifecycle")), (snapshot) => sender.send(Tag("Lifecycle", snapshot))),
        Interfaces: () => bind(engine.projection(prnsView("Interfaces")), (snapshot) => sender.send(Tag("Interfaces", snapshot))),
        Routes: () => bind(engine.projection(prnsView("Routes")), (snapshot) => sender.send(Tag("Routes", snapshot))),
        Links: () => bind(engine.projection(prnsView("Links")), (snapshot) => sender.send(Tag("Links", snapshot))),
        Diagnostics: ({ maximumEvents }) => bindDiagnostics(engine.projection(prnsView("Diagnostics", { maximumEvents })), sender),
    });
}
function bind(projection, send) {
    send(projection.latest());
    return projection.subscribe(() => send(projection.latest()));
}
function bindDiagnostics(projection, sender) {
    let previous;
    const send = () => {
        const snapshot = projection.latest();
        if (previous === undefined) {
            previous = snapshot.value;
            sender.send(Tag("DiagnosticsReset", snapshot));
            return;
        }
        const delta = diagnosticDelta(previous, snapshot.value);
        if (delta === undefined) {
            previous = snapshot.value;
            sender.send(Tag("DiagnosticsReset", snapshot));
            return;
        }
        sender.send(Tag("DiagnosticsDelta", {
            revision: snapshot.revision,
            dropped: delta.dropped,
            appended: snapshot.value.slice(delta.overlap),
        }));
        previous = snapshot.value;
    };
    send();
    return projection.subscribe(send);
}
function diagnosticDelta(previous, current) {
    if (current.length === 0) {
        return { dropped: previous.length, overlap: 0 };
    }
    let dropped = 0;
    while (dropped < previous.length && previous[dropped] !== current[0]) {
        dropped += 1;
    }
    const overlap = Math.min(previous.length - dropped, current.length);
    for (let index = 0; index < overlap; index += 1) {
        if (previous[dropped + index] !== current[index]) {
            return undefined;
        }
    }
    return { dropped, overlap };
}
