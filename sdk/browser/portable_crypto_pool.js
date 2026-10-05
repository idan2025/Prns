import { Tag, match } from "../casework.js";
const MAXIMUM_PORTABLE_CRYPTO_WORKERS = 16;
const MAXIMUM_PENDING_PORTABLE_CRYPTO_JOBS = 64;
const MAXIMUM_PENDING_PORTABLE_CRYPTO_BYTES = 1024 * 1024;
const MAXIMUM_PORTABLE_CRYPTO_BATCH_JOBS = 16;
const PORTABLE_CRYPTO_WORKER_START_TIMEOUT_MILLIS = 10_000;
export class PortableCryptoWorkerPool {
    #slots = [];
    #queue = [];
    #wasmModuleUrl;
    #readiness;
    #settleReadiness;
    #nextId = 1;
    #retainedJobs = 0;
    #retainedBytes = 0;
    #starting;
    #readyWorkers = 0;
    #dispatchScheduled = false;
    #closed = false;
    constructor(workers, wasmModuleUrl) {
        if (!Number.isSafeInteger(workers) ||
            workers < 1 ||
            workers > MAXIMUM_PORTABLE_CRYPTO_WORKERS) {
            throw new RangeError(`portable crypto workers must be between 1 and ${MAXIMUM_PORTABLE_CRYPTO_WORKERS}`);
        }
        this.#wasmModuleUrl = wasmModuleUrl;
        this.#starting = workers;
        this.#readiness = new Promise((settle) => {
            this.#settleReadiness = settle;
        });
        if (typeof Worker !== "function") {
            this.#starting = 0;
            this.#finishReadiness();
            return;
        }
        for (let index = 0; index < workers; index += 1) {
            this.#startWorker(index);
        }
    }
    ready() {
        return this.#readiness;
    }
    verifyEd25519(publicKeyBytes, messageBytes, signatureBytes) {
        const publicKey = ownedBytes(publicKeyBytes);
        const message = ownedBytes(messageBytes);
        const signature = ownedBytes(signatureBytes);
        const id = this.#takeId();
        const job = Tag("AnnounceVerify", { id, publicKey, message, signature });
        return this.#submit(Tag("AnnounceVerify", {
            id,
            job,
            bytes: publicKey.byteLength + message.byteLength + signature.byteLength,
            settle: () => undefined,
        }));
    }
    verifyLinkProof(publicKeyBytes, messageBytes, signatureBytes, secretScalarBytes, peerPublicKeyBytes) {
        const publicKey = ownedBytes(publicKeyBytes);
        const message = ownedBytes(messageBytes);
        const signature = ownedBytes(signatureBytes);
        const secretScalar = ownedBytes(secretScalarBytes);
        const peerPublicKey = ownedBytes(peerPublicKeyBytes);
        const id = this.#takeId();
        const job = Tag("LinkProofVerify", {
            id,
            publicKey,
            message,
            signature,
            secretScalar,
            peerPublicKey,
        });
        return this.#submit(Tag("LinkProofVerify", {
            id,
            job,
            bytes: publicKey.byteLength +
                message.byteLength +
                signature.byteLength +
                secretScalar.byteLength +
                peerPublicKey.byteLength,
            settle: () => undefined,
        }));
    }
    close() {
        if (this.#closed) {
            return;
        }
        this.#closed = true;
        for (const slot of this.#slots) {
            globalThis.clearTimeout(slot.startupTimeout);
            match(slot.state, {
                Starting: () => undefined,
                Ready: () => undefined,
                Running: ({ jobs }) => {
                    for (const job of jobs) {
                        eraseSecret(job);
                        this.#settle(job, Tag("Failed", {
                            detail: "portable crypto Worker terminated during an operation",
                        }));
                    }
                },
                Failed: () => undefined,
            });
            slot.state = Tag("Failed");
            slot.worker.terminate();
        }
        for (const job of this.#queue.splice(0)) {
            this.#settle(job, Tag("Unavailable"));
        }
        this.#starting = 0;
        this.#readyWorkers = 0;
        this.#finishReadiness();
    }
    #submit(job) {
        if (this.#closed || this.#availableWorkers() === 0) {
            return Promise.resolve(Tag("Unavailable"));
        }
        if (this.#retainedJobs >= MAXIMUM_PENDING_PORTABLE_CRYPTO_JOBS ||
            this.#retainedBytes + job.data.bytes > MAXIMUM_PENDING_PORTABLE_CRYPTO_BYTES) {
            return Promise.resolve(Tag("Busy"));
        }
        return new Promise((settle) => {
            const admitted = match(job, {
                AnnounceVerify: (queued) => Tag("AnnounceVerify", { ...queued, settle }),
                LinkProofVerify: (queued) => Tag("LinkProofVerify", { ...queued, settle }),
            });
            this.#retainedJobs += 1;
            this.#retainedBytes += job.data.bytes;
            this.#queue.push(admitted);
            this.#scheduleDispatch();
        });
    }
    #startWorker(index) {
        let worker;
        try {
            worker = new Worker(new URL("./portable_crypto_worker.js", import.meta.url), {
                type: "module",
                name: `prns-portable-crypto-${index + 1}`,
            });
        }
        catch {
            this.#starting -= 1;
            this.#finishReadiness();
            return;
        }
        let slot;
        const startupTimeout = globalThis.setTimeout(() => {
            this.#fail(slot);
        }, PORTABLE_CRYPTO_WORKER_START_TIMEOUT_MILLIS);
        slot = { worker, startupTimeout, state: Tag("Starting") };
        this.#slots.push(slot);
        worker.addEventListener("message", (event) => {
            this.#receive(slot, event.data);
        });
        worker.addEventListener("error", () => {
            this.#fail(slot);
        });
        worker.addEventListener("messageerror", () => {
            this.#fail(slot);
        });
        const request = Tag("Initialize", {
            ...(this.#wasmModuleUrl === undefined
                ? {}
                : { wasmModuleUrl: this.#wasmModuleUrl }),
        });
        try {
            worker.postMessage(request);
        }
        catch {
            this.#fail(slot);
        }
    }
    #receive(slot, raw) {
        if (!isWorkerResponse(raw)) {
            this.#fail(slot);
            return;
        }
        match(raw, {
            Ready: () => {
                if (slot.state.tag !== "Starting") {
                    this.#fail(slot);
                    return;
                }
                globalThis.clearTimeout(slot.startupTimeout);
                slot.state = Tag("Ready");
                this.#starting -= 1;
                this.#readyWorkers += 1;
                this.#finishReadiness();
                this.#scheduleDispatch();
            },
            Settled: ({ outcomes }) => {
                if (slot.state.tag !== "Running") {
                    this.#fail(slot);
                    return;
                }
                const jobs = slot.state.data.jobs;
                if (!settlementsMatch(jobs, outcomes)) {
                    this.#fail(slot);
                    return;
                }
                slot.state = Tag("Ready");
                for (let index = 0; index < jobs.length; index += 1) {
                    this.#settleOutcome(jobs[index], outcomes[index]);
                }
                this.#scheduleDispatch();
            },
            InitializationFailed: () => {
                this.#fail(slot);
            },
        });
    }
    #scheduleDispatch() {
        if (this.#closed || this.#dispatchScheduled) {
            return;
        }
        this.#dispatchScheduled = true;
        globalThis.queueMicrotask(() => {
            this.#dispatchScheduled = false;
            this.#dispatch();
        });
    }
    #dispatch() {
        if (this.#closed || this.#queue.length === 0) {
            return;
        }
        const readySlots = this.#slots.filter((slot) => slot.state.tag === "Ready");
        for (let index = 0; index < readySlots.length && this.#queue.length > 0; index += 1) {
            const slot = readySlots[index];
            const remainingSlots = readySlots.length - index;
            const batchLength = Math.min(MAXIMUM_PORTABLE_CRYPTO_BATCH_JOBS, Math.ceil(this.#queue.length / remainingSlots));
            const jobs = this.#queue.splice(0, batchLength);
            slot.state = Tag("Running", { jobs });
            const request = Tag("Perform", {
                jobs: jobs.map((job) => job.data.job),
            });
            try {
                slot.worker.postMessage(request);
                for (const job of jobs) {
                    eraseSecret(job);
                }
            }
            catch {
                this.#fail(slot);
            }
        }
    }
    #settleOutcome(job, outcome) {
        const settlement = match(outcome, {
            AnnounceValid: () => Tag("Valid"),
            AnnounceInvalid: () => Tag("Invalid"),
            LinkProofVerified: ({ sharedSecret }) => Tag("Verified", { sharedSecret }),
            LinkProofInvalid: () => Tag("Invalid"),
            OperationFailed: ({ detail }) => Tag("Failed", { detail }),
        });
        this.#settle(job, settlement);
    }
    #fail(slot) {
        if (slot.state.tag === "Failed") {
            return;
        }
        globalThis.clearTimeout(slot.startupTimeout);
        match(slot.state, {
            Starting: () => {
                this.#starting -= 1;
            },
            Ready: () => {
                this.#readyWorkers -= 1;
            },
            Running: ({ jobs }) => {
                this.#readyWorkers -= 1;
                for (const job of jobs) {
                    eraseSecret(job);
                    this.#settle(job, Tag("Failed", {
                        detail: "portable crypto Worker became unavailable during an operation",
                    }));
                }
            },
            Failed: () => undefined,
        });
        slot.state = Tag("Failed");
        slot.worker.terminate();
        this.#finishReadiness();
        if (this.#availableWorkers() === 0) {
            for (const job of this.#queue.splice(0)) {
                this.#settle(job, Tag("Unavailable"));
            }
        }
        else {
            this.#scheduleDispatch();
        }
    }
    #settle(job, settlement) {
        this.#retainedJobs -= 1;
        this.#retainedBytes -= job.data.bytes;
        job.data.settle(settlement);
    }
    #availableWorkers() {
        return this.#slots.reduce((count, slot) => count + (slot.state.tag === "Failed" ? 0 : 1), 0);
    }
    #finishReadiness() {
        if (this.#starting !== 0 || this.#settleReadiness === undefined) {
            return;
        }
        this.#settleReadiness(this.#readyWorkers === 0
            ? Tag("Unavailable")
            : Tag("Ready", { workers: this.#readyWorkers }));
        this.#settleReadiness = undefined;
    }
    #takeId() {
        const id = this.#nextId;
        this.#nextId = id === Number.MAX_SAFE_INTEGER ? 1 : id + 1;
        return id;
    }
}
function settlementsMatch(jobs, outcomes) {
    if (jobs.length !== outcomes.length) {
        return false;
    }
    return jobs.every((job, index) => {
        const outcome = outcomes[index];
        if (job.data.id !== outcome.data.id) {
            return false;
        }
        if (outcome.tag === "OperationFailed") {
            return true;
        }
        return job.tag === "AnnounceVerify"
            ? outcome.tag === "AnnounceValid" || outcome.tag === "AnnounceInvalid"
            : outcome.tag === "LinkProofVerified" || outcome.tag === "LinkProofInvalid";
    });
}
function eraseSecret(job) {
    if (job.tag === "LinkProofVerify") {
        job.data.job.data.secretScalar.fill(0);
    }
}
function ownedBytes(bytes) {
    if (bytes.buffer instanceof ArrayBuffer &&
        bytes.byteOffset === 0 &&
        bytes.byteLength === bytes.buffer.byteLength) {
        return bytes;
    }
    return bytes.slice();
}
function isWorkerResponse(raw) {
    if (typeof raw !== "object" || raw === null || !("tag" in raw)) {
        return false;
    }
    const response = raw;
    if (response.tag === "Ready") {
        return response.data === undefined;
    }
    if (typeof response.data !== "object" || response.data === null) {
        return false;
    }
    const data = response.data;
    if (response.tag === "InitializationFailed") {
        return typeof data.detail === "string";
    }
    if (response.tag !== "Settled" || !Array.isArray(data.outcomes)) {
        return false;
    }
    return data.outcomes.every(isWorkerOutcome);
}
function isWorkerOutcome(raw) {
    if (typeof raw !== "object" || raw === null || !("tag" in raw)) {
        return false;
    }
    const outcome = raw;
    if (typeof outcome.data !== "object" || outcome.data === null) {
        return false;
    }
    const data = outcome.data;
    if (!Number.isSafeInteger(data.id) || data.id < 1) {
        return false;
    }
    if (outcome.tag === "AnnounceValid" ||
        outcome.tag === "AnnounceInvalid" ||
        outcome.tag === "LinkProofInvalid") {
        return true;
    }
    if (outcome.tag === "OperationFailed") {
        return typeof data.detail === "string";
    }
    return outcome.tag === "LinkProofVerified" &&
        data.sharedSecret instanceof Uint8Array &&
        data.sharedSecret.buffer instanceof ArrayBuffer &&
        data.sharedSecret.byteLength === 32;
}
