import { createContext, createElement, useContext, useSyncExternalStore, } from "react";
import { PrnsProviderMissingError, requireClientBoundary, } from "./client.js";
const PrnsContext = createContext(undefined);
export function PrnsProvider(props) {
    requireClientBoundary("personal-rns/react");
    return createElement(PrnsContext.Provider, { value: props.prns }, props.children);
}
export function usePrns() {
    requireClientBoundary("personal-rns/react");
    const prns = useContext(PrnsContext);
    if (prns === undefined) {
        throw new PrnsProviderMissingError("personal-rns/react");
    }
    return prns;
}
export function usePrnsProjection(view) {
    const projection = usePrns().projection(view);
    return useSyncExternalStore((changed) => projection.subscribe(changed), () => projection.latest().value);
}
export { PrnsClientBoundaryRequiredError, PrnsProviderMissingError, } from "./client.js";
