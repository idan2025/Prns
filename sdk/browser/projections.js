import { Tag, from, match } from "../casework.js";
export class PrnsProjectionCapacityError extends RangeError {
    maximumEvents;
    configuredMaximum;
    constructor(maximumEvents, configuredMaximum) {
        super(`diagnostic projection capacity ${maximumEvents} must be a positive integer no greater than ${configuredMaximum}`);
        this.name = "PrnsProjectionCapacityError";
        this.maximumEvents = maximumEvents;
        this.configuredMaximum = configuredMaximum;
    }
}
export const { MakeTag: prnsView } = from();
export class PrnsProjectionStore {
    #maximumDiagnostics;
    #hooks;
    #entries = new Map();
    #values = new Map();
    #acceptedRevisions = new Map();
    #diagnostics = [];
    #dirty = new Set();
    #revision;
    #acceptedDiagnosticRevision;
    #diagnosticCapacity = 0;
    #notificationScheduled = false;
    constructor(snapshot, lifecycle, maximumDiagnostics, hooks = {}) {
        const revision = asProjectionRevision(snapshot.revision);
        this.#revision = revision;
        this.#maximumDiagnostics = maximumDiagnostics;
        this.#hooks = hooks;
        this.#seed("Lifecycle", lifecycle, revision);
        this.#seed("Interfaces", Object.freeze([...snapshot.interfaces]), revision);
        this.#seed("Routes", Object.freeze([...snapshot.routes]), revision);
        this.#values.set("Links", {
            revision,
            value: Object.freeze([]),
        });
    }
    projection(view) {
        const key = projectionKey(view, this.#maximumDiagnostics);
        let entry = this.#entries.get(key);
        if (entry === undefined) {
            const listeners = new Set();
            let stable;
            const projection = {
                latest: () => stable.snapshot,
                synchronize: () => this.#synchronize(stable),
                subscribe: (changed) => {
                    const first = stable.listeners.size === 0;
                    const listener = () => changed();
                    stable.listeners.add(listener);
                    if (first) {
                        this.#hooks.observed?.(stable.view);
                        if (stable.view.tag === "Diagnostics") {
                            this.#diagnosticSubscriptionsChanged();
                        }
                    }
                    let subscribed = true;
                    return () => {
                        if (!subscribed) {
                            return;
                        }
                        subscribed = false;
                        stable.listeners.delete(listener);
                        if (stable.listeners.size !== 0) {
                            return;
                        }
                        this.#hooks.unobserved?.(stable.view);
                        if (stable.view.tag === "Diagnostics") {
                            this.#diagnosticSubscriptionsChanged();
                        }
                    };
                },
            };
            stable = {
                key,
                view,
                listeners,
                snapshot: this.#snapshotFor(view),
                projection,
            };
            entry = stable;
            this.#entries.set(key, entry);
        }
        return entry.projection;
    }
    replaceLifecycle(lifecycle, revision) {
        this.#replaceReplicated("Lifecycle", lifecycle, equalLifecycle, revision);
    }
    replaceHostSnapshot(snapshot) {
        const revision = asProjectionRevision(snapshot.revision);
        this.replaceInterfaces(snapshot.interfaces, revision);
        this.replaceRoutes(snapshot.routes, revision);
    }
    replaceInterfaces(interfaces, revision) {
        this.#replaceReplicated("Interfaces", Object.freeze([...interfaces]), equalInterfaces, revision);
    }
    replaceRoutes(routes, revision) {
        this.#replaceReplicated("Routes", Object.freeze([...routes]), equalRoutes, revision);
    }
    replaceLinks(links, revision) {
        this.#replaceReplicated("Links", Object.freeze([...links]), equalLinks, revision);
    }
    publishDiagnostic(event) {
        if (this.#diagnosticCapacity === 0) {
            return;
        }
        this.#diagnostics.push(event);
        if (this.#diagnostics.length > this.#diagnosticCapacity) {
            this.#diagnostics.splice(0, this.#diagnostics.length - this.#diagnosticCapacity);
        }
        this.#refreshDiagnosticEntries();
    }
    replaceDiagnostics(events, revision) {
        if (!this.#acceptDiagnosticRevision(revision)) {
            return;
        }
        this.#diagnostics.length = 0;
        if (this.#diagnosticCapacity > 0) {
            this.#diagnostics.push(...events.slice(-this.#diagnosticCapacity));
        }
        this.#refreshDiagnosticEntries(revision);
    }
    appendDiagnostics(dropped, events, revision) {
        if (!Number.isSafeInteger(dropped) || dropped < 0) {
            throw new RangeError("diagnostic delta drop count must be a non-negative safe integer");
        }
        if (!this.#acceptDiagnosticRevision(revision)) {
            return;
        }
        if (this.#diagnosticCapacity === 0) {
            return;
        }
        if (dropped > 0) {
            this.#diagnostics.splice(0, Math.min(dropped, this.#diagnostics.length));
        }
        this.#diagnostics.push(...events);
        if (this.#diagnostics.length > this.#diagnosticCapacity) {
            this.#diagnostics.splice(0, this.#diagnostics.length - this.#diagnosticCapacity);
        }
        this.#refreshDiagnosticEntries(revision);
    }
    get diagnosticCapacity() {
        return this.#diagnosticCapacity;
    }
    #seed(key, value, revision) {
        this.#values.set(key, { revision, value });
        this.#acceptedRevisions.set(key, revision);
    }
    #snapshotFor(view) {
        if (view.tag !== "Diagnostics") {
            const snapshot = this.#values.get(view.tag);
            if (snapshot === undefined) {
                throw new Error(`projection state ${view.tag} is unavailable`);
            }
            return snapshot;
        }
        return {
            revision: this.#revision,
            value: Object.freeze(this.#diagnostics.slice(-view.data.maximumEvents)),
        };
    }
    async #synchronize(entry) {
        const synchronize = this.#hooks.synchronize;
        if (synchronize === undefined) {
            return Tag("Synchronized", entry.snapshot);
        }
        const outcome = await synchronize(entry.view);
        if (outcome.tag !== "Synchronized") {
            return outcome;
        }
        this.#applySynchronized(entry.view, outcome.data);
        return Tag("Synchronized", entry.snapshot);
    }
    #applySynchronized(view, snapshot) {
        match(view, {
            Lifecycle: () => this.replaceLifecycle(snapshot.value, snapshot.revision),
            Interfaces: () => this.replaceInterfaces(snapshot.value, snapshot.revision),
            Routes: () => this.replaceRoutes(snapshot.value, snapshot.revision),
            Links: () => this.replaceLinks(snapshot.value, snapshot.revision),
            Diagnostics: () => this.replaceDiagnostics(snapshot.value, snapshot.revision),
        });
    }
    #replaceReplicated(key, value, equal, receivedRevision) {
        const current = this.#values.get(key);
        if (current === undefined) {
            throw new Error(`projection state ${key} is unavailable`);
        }
        const accepted = this.#acceptedRevisions.get(key);
        if (receivedRevision !== undefined &&
            accepted !== undefined &&
            receivedRevision <= accepted) {
            return;
        }
        if (receivedRevision !== undefined) {
            this.#acceptedRevisions.set(key, receivedRevision);
            if (receivedRevision > this.#revision) {
                this.#revision = receivedRevision;
            }
        }
        if (equal(current.value, value)) {
            return;
        }
        const revision = receivedRevision ?? this.#nextRevision();
        if (receivedRevision === undefined) {
            this.#acceptedRevisions.set(key, revision);
        }
        const snapshot = { revision, value };
        this.#values.set(key, snapshot);
        const entry = this.#entries.get(key);
        if (entry === undefined) {
            return;
        }
        entry.snapshot = snapshot;
        this.#dirty.add(key);
        this.#scheduleNotifications();
    }
    #nextRevision() {
        this.#revision = asProjectionRevision(this.#revision + 1n);
        return this.#revision;
    }
    #acceptDiagnosticRevision(revision) {
        if (revision === undefined) {
            return true;
        }
        if (this.#acceptedDiagnosticRevision !== undefined &&
            revision <= this.#acceptedDiagnosticRevision) {
            return false;
        }
        this.#acceptedDiagnosticRevision = revision;
        if (revision > this.#revision) {
            this.#revision = revision;
        }
        return true;
    }
    #refreshDiagnosticEntries(receivedRevision) {
        let revision = receivedRevision;
        for (const entry of this.#entries.values()) {
            if (entry.view.tag !== "Diagnostics") {
                continue;
            }
            const value = Object.freeze(this.#diagnostics.slice(-entry.view.data.maximumEvents));
            if (equalDiagnostics(entry.snapshot.value, value)) {
                continue;
            }
            if (revision === undefined) {
                revision = this.#nextRevision();
                this.#acceptedDiagnosticRevision = revision;
            }
            entry.snapshot = { revision, value };
            this.#dirty.add(entry.key);
        }
        this.#scheduleNotifications();
    }
    #diagnosticSubscriptionsChanged() {
        let maximum = 0;
        for (const entry of this.#entries.values()) {
            if (entry.view.tag === "Diagnostics" && entry.listeners.size > 0) {
                maximum = Math.max(maximum, entry.view.data.maximumEvents);
            }
        }
        if (maximum === this.#diagnosticCapacity) {
            return;
        }
        this.#diagnosticCapacity = maximum;
        if (maximum === 0) {
            this.#diagnostics.length = 0;
            this.#refreshDiagnosticEntries();
        }
        else if (this.#diagnostics.length > maximum) {
            this.#diagnostics.splice(0, this.#diagnostics.length - maximum);
            this.#refreshDiagnosticEntries();
        }
        this.#hooks.diagnosticCapacityChanged?.(maximum);
    }
    #scheduleNotifications() {
        if (this.#notificationScheduled || this.#dirty.size === 0) {
            return;
        }
        this.#notificationScheduled = true;
        queueMicrotask(() => {
            this.#notificationScheduled = false;
            const dirty = [...this.#dirty];
            this.#dirty.clear();
            for (const key of dirty) {
                const entry = this.#entries.get(key);
                if (entry === undefined) {
                    continue;
                }
                for (const listener of entry.listeners) {
                    listener();
                }
            }
        });
    }
}
export function asProjectionRevision(revision) {
    return revision;
}
function projectionKey(view, maximumDiagnostics) {
    if (view.tag !== "Diagnostics") {
        return view.tag;
    }
    const maximumEvents = view.data.maximumEvents;
    if (!Number.isSafeInteger(maximumEvents) ||
        maximumEvents <= 0 ||
        maximumEvents > maximumDiagnostics) {
        throw new PrnsProjectionCapacityError(maximumEvents, maximumDiagnostics);
    }
    return `Diagnostics:${maximumEvents}`;
}
function equalLifecycle(left, right) {
    return match(left, {
        Starting: () => right.tag === "Starting",
        Running: () => right.tag === "Running",
        Stopping: () => right.tag === "Stopping",
        Stopped: ({ reason }) => right.tag === "Stopped" && right.data.reason === reason,
        Failed: (failure) => {
            if (right.tag !== "Failed" || right.data.cause !== failure.cause) {
                return false;
            }
            if (failure.cause === "EventBackpressureExceeded") {
                return right.data.cause === "EventBackpressureExceeded" &&
                    right.data.rejectedEventBytes === failure.rejectedEventBytes &&
                    equalLimits(right.data.limits, failure.limits);
            }
            return right.data.cause !== "EventBackpressureExceeded" &&
                right.data.detail === failure.detail;
        },
    });
}
function equalLimits(left, right) {
    return left.pendingCommands === right.pendingCommands &&
        left.applicationEvents === right.applicationEvents &&
        left.retainedEventBytes === right.retainedEventBytes &&
        left.diagnostics === right.diagnostics;
}
function equalInterfaces(left, right) {
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index += 1) {
        const a = left[index];
        const b = right[index];
        if (a === undefined ||
            b === undefined ||
            !equalBytes(a.interfaceId, b.interfaceId) ||
            a.name !== b.name ||
            a.kind !== b.kind ||
            a.health !== b.health ||
            a.failureDetail !== b.failureDetail ||
            a.rxBytes !== b.rxBytes ||
            a.txBytes !== b.txBytes ||
            a.rxBps !== b.rxBps ||
            a.txBps !== b.txBps ||
            a.routeCount !== b.routeCount ||
            a.linkCount !== b.linkCount ||
            a.transportedLinkCount !== b.transportedLinkCount) {
            return false;
        }
    }
    return true;
}
function equalRoutes(left, right) {
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index += 1) {
        const a = left[index];
        const b = right[index];
        if (a === undefined ||
            b === undefined ||
            !equalBytes(a.destination, b.destination) ||
            a.hops !== b.hops ||
            !equalOptionalBytes(a.viaIdentity, b.viaIdentity) ||
            !equalBytes(a.interfaceId, b.interfaceId) ||
            a.learnedAtMillis !== b.learnedAtMillis ||
            a.lastRouteActivityAtMillis !== b.lastRouteActivityAtMillis ||
            a.expiresAtMillis !== b.expiresAtMillis) {
            return false;
        }
    }
    return true;
}
function equalLinks(left, right) {
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index += 1) {
        const a = left[index];
        const b = right[index];
        if (a === undefined ||
            b === undefined ||
            !equalBytes(a.linkId, b.linkId) ||
            a.rttMillis !== b.rttMillis ||
            !equalOptionalBytes(a.peerIdentity, b.peerIdentity)) {
            return false;
        }
    }
    return true;
}
function equalDiagnostics(left, right) {
    return left.length === right.length && left.every((event, index) => event === right[index]);
}
function equalOptionalBytes(left, right) {
    if (left === undefined || right === undefined) {
        return left === right;
    }
    return equalBytes(left, right);
}
function equalBytes(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
