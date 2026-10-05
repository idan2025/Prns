import { Tag } from "../casework.js";
import { retainApplicationEventBatchProjection, retainDiagnosticEventBatchProjection, summarizeEventBatchProjection, } from "../event_projection.js";
export class BoundedWorkerEventSender {
    #port;
    #limits;
    #failure;
    #queued = [];
    #inFlight;
    #applicationEvents = 0;
    #diagnostics = 0;
    #retainedEventBytes = 0;
    #droppedDiagnostics = 0n;
    #nextId = 1;
    #failed = false;
    #applicationClaimed = false;
    #diagnosticsClaimed = false;
    constructor(port, limits, failure) {
        this.#port = port;
        this.#limits = limits;
        this.#failure = failure;
        port.addEventListener("message", (event) => {
            this.#receive(event.data);
        });
    }
    sendBatch(batch) {
        this.#requireActive();
        let summary;
        try {
            summary = summarizeEventBatchProjection(batch);
        }
        catch (error) {
            this.#failProtocol(error instanceof Error ? error.message : String(error));
            throw error;
        }
        this.#flushDiagnosticGap();
        if (summary.applicationEvents > 0) {
            const application = retainApplicationEventBatchProjection(batch);
            this.#enqueue({
                lane: "Application",
                message: Tag("Batch", {
                    id: this.#mintId(),
                    buffer: transferableBuffer(application),
                }),
                applicationEvents: summary.applicationEvents,
                diagnostics: 0,
                retainedEventBytes: summary.retainedEventBytes,
            });
        }
        if (this.#diagnostics + summary.diagnostics > this.#limits.diagnostics) {
            this.#droppedDiagnostics += BigInt(summary.diagnostics);
            return;
        }
        if (summary.diagnostics > 0) {
            const diagnostics = retainDiagnosticEventBatchProjection(batch);
            this.#enqueue({
                lane: "Diagnostics",
                message: Tag("Batch", {
                    id: this.#mintId(),
                    buffer: transferableBuffer(diagnostics),
                }),
                applicationEvents: 0,
                diagnostics: summary.diagnostics,
                retainedEventBytes: 0,
            });
        }
    }
    sendDiagnostic(event) {
        this.#requireActive();
        this.#flushDiagnosticGap();
        if (this.#diagnostics === this.#limits.diagnostics) {
            this.#droppedDiagnostics += 1n;
            return;
        }
        this.#enqueue({
            lane: "Diagnostics",
            message: Tag("Diagnostic", { id: this.#mintId(), event }),
            applicationEvents: 0,
            diagnostics: 1,
            retainedEventBytes: 0,
        });
    }
    #enqueue(queued) {
        if (this.#applicationEvents + queued.applicationEvents >
            this.#limits.applicationEvents ||
            this.#retainedEventBytes + queued.retainedEventBytes >
                this.#limits.retainedEventBytes) {
            this.#failBackpressure(queued.retainedEventBytes);
            throw new Error("DedicatedWorker application event queue exceeded its bounds");
        }
        this.#applicationEvents += queued.applicationEvents;
        this.#diagnostics += queued.diagnostics;
        this.#retainedEventBytes += queued.retainedEventBytes;
        this.#queued.push(queued);
        this.#dispatch();
    }
    #dispatch() {
        if (this.#failed || this.#inFlight !== undefined) {
            return;
        }
        const index = this.#queued.findIndex((queued) => queued.lane === "Application"
            ? this.#applicationClaimed
            : this.#diagnosticsClaimed);
        if (index < 0) {
            return;
        }
        const next = this.#queued.splice(index, 1)[0];
        if (next === undefined) {
            return;
        }
        this.#inFlight = next;
        if (next.message.tag === "Batch") {
            this.#port.postMessage(next.message, [next.message.data.buffer]);
            return;
        }
        this.#port.postMessage(next.message);
    }
    #receive(message) {
        if (this.#failed) {
            return;
        }
        if (message?.tag === "ClaimApplicationEvents") {
            this.#applicationClaimed = true;
            this.#dispatch();
            return;
        }
        if (message?.tag === "ClaimDiagnostics") {
            this.#diagnosticsClaimed = true;
            this.#dispatch();
            return;
        }
        const inFlight = this.#inFlight;
        if (message?.tag !== "Acknowledge" ||
            !Number.isSafeInteger(message.data.id) ||
            inFlight === undefined ||
            message.data.id !== inFlight.message.data.id) {
            this.#failProtocol("DedicatedWorker event channel received an invalid acknowledgement");
            return;
        }
        this.#inFlight = undefined;
        this.#applicationEvents -= inFlight.applicationEvents;
        this.#diagnostics -= inFlight.diagnostics;
        this.#retainedEventBytes -= inFlight.retainedEventBytes;
        this.#flushDiagnosticGap();
        this.#dispatch();
    }
    #flushDiagnosticGap() {
        if (this.#droppedDiagnostics === 0n ||
            this.#diagnostics === this.#limits.diagnostics) {
            return;
        }
        const count = this.#droppedDiagnostics;
        this.#droppedDiagnostics = 0n;
        this.#enqueue({
            lane: "Diagnostics",
            message: Tag("Diagnostic", {
                id: this.#mintId(),
                event: Tag("DiagnosticsDropped", { count }),
            }),
            applicationEvents: 0,
            diagnostics: 1,
            retainedEventBytes: 0,
        });
    }
    #mintId() {
        const id = this.#nextId;
        this.#nextId = id === Number.MAX_SAFE_INTEGER ? 1 : id + 1;
        return id;
    }
    #requireActive() {
        if (this.#failed) {
            throw new Error("DedicatedWorker event sender has failed");
        }
    }
    #failBackpressure(rejectedEventBytes) {
        if (this.#failed) {
            return;
        }
        this.#failed = true;
        this.#queued.length = 0;
        this.#failure.backpressure(rejectedEventBytes);
    }
    #failProtocol(detail) {
        if (this.#failed) {
            return;
        }
        this.#failed = true;
        this.#queued.length = 0;
        this.#failure.protocol(detail);
    }
}
function transferableBuffer(bytes) {
    if (bytes.byteOffset === 0 &&
        bytes.byteLength === bytes.buffer.byteLength &&
        bytes.buffer instanceof ArrayBuffer) {
        return bytes.buffer;
    }
    return bytes.slice().buffer;
}
