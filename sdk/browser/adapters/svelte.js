import { getContext, setContext } from "svelte";
import { readable } from "svelte/store";
import { PrnsProviderMissingError, requireClientBoundary, } from "./client.js";
const prnsKey = Symbol("personal-rns/svelte");
export function setPrnsContext(prns) {
    requireClientBoundary("personal-rns/svelte");
    return setContext(prnsKey, prns);
}
export function getPrnsContext() {
    requireClientBoundary("personal-rns/svelte");
    const prns = getContext(prnsKey);
    if (prns === undefined) {
        throw new PrnsProviderMissingError("personal-rns/svelte");
    }
    return prns;
}
export function prnsReadable(view) {
    const projection = getPrnsContext().projection(view);
    return readable(projection.latest().value, (set) => projection.subscribe(() => set(projection.latest().value)));
}
export { PrnsClientBoundaryRequiredError, PrnsProviderMissingError, } from "./client.js";
