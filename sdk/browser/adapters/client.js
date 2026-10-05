export class PrnsClientBoundaryRequiredError extends Error {
    constructor(adapter) {
        super(`${adapter} requires a client-rendered browser boundary with a ready Prns instance`);
        this.name = "PrnsClientBoundaryRequiredError";
    }
}
export class PrnsProviderMissingError extends Error {
    constructor(adapter) {
        super(`${adapter} requires a Prns provider above the current consumer`);
        this.name = "PrnsProviderMissingError";
    }
}
export function requireClientBoundary(adapter) {
    if (typeof globalThis.window === "undefined") {
        throw new PrnsClientBoundaryRequiredError(adapter);
    }
}
