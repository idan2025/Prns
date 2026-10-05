import { getCurrentScope, inject, onScopeDispose, provide, readonly, shallowRef, } from "vue";
import { PrnsProviderMissingError, requireClientBoundary, } from "./client.js";
const prnsKey = Symbol("personal-rns/vue");
export class PrnsVueScopeRequiredError extends Error {
    constructor() {
        super("personal-rns/vue projections require an active Vue effect scope");
        this.name = "PrnsVueScopeRequiredError";
    }
}
export function providePrns(prns) {
    requireClientBoundary("personal-rns/vue");
    provide(prnsKey, prns);
}
export function usePrns() {
    requireClientBoundary("personal-rns/vue");
    const prns = inject(prnsKey);
    if (prns === undefined) {
        throw new PrnsProviderMissingError("personal-rns/vue");
    }
    return prns;
}
export function usePrnsProjection(view) {
    if (getCurrentScope() === undefined) {
        throw new PrnsVueScopeRequiredError();
    }
    const projection = usePrns().projection(view);
    const current = shallowRef(projection.latest().value);
    const release = projection.subscribe(() => {
        current.value = projection.latest().value;
    });
    onScopeDispose(release);
    return readonly(current);
}
export { PrnsClientBoundaryRequiredError, PrnsProviderMissingError, } from "./client.js";
