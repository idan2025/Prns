import { createComponent, createContext, from, useContext, } from "solid-js";
import { PrnsProviderMissingError, requireClientBoundary, } from "./client.js";
const PrnsContext = createContext();
export function PrnsProvider(props) {
    requireClientBoundary("personal-rns/solid");
    return createComponent(PrnsContext.Provider, {
        value: props.prns,
        get children() {
            return props.children;
        },
    });
}
export function usePrns() {
    requireClientBoundary("personal-rns/solid");
    const prns = useContext(PrnsContext);
    if (prns === undefined) {
        throw new PrnsProviderMissingError("personal-rns/solid");
    }
    return prns;
}
export function createPrnsProjection(view) {
    const projection = usePrns().projection(view);
    return from((set) => projection.subscribe(() => set(() => projection.latest().value)), projection.latest().value);
}
export { PrnsClientBoundaryRequiredError, PrnsProviderMissingError, } from "./client.js";
