import { Tag } from "../../casework.js";
import { prnsView } from "../projections.js";
import { PrnsClientBoundaryRequiredError, requireClientBoundary, } from "./client.js";
export const PRNS_BRIDGE_ELEMENT_NAME = "prns-bridge";
export const PRNS_BRIDGE_CHANGE_EVENT = "prns-change";
export class PrnsBridgeUnconfiguredError extends Error {
    constructor() {
        super("prns-bridge must be configured before executing commands");
        this.name = "PrnsBridgeUnconfiguredError";
    }
}
export function definePrnsBridgeElement(registry = globalThis.customElements) {
    requireClientBoundary("personal-rns/web-component");
    if (registry.get(PRNS_BRIDGE_ELEMENT_NAME) !== undefined) {
        return Tag("AlreadyDefined");
    }
    class BrowserPrnsBridgeElement extends HTMLElement {
        #configuration;
        #state;
        #release = [];
        #scheduled = false;
        #version = 0;
        configure(configuration) {
            this.#unbind();
            this.#configuration = configuration;
            this.#state = this.#readState();
            if (this.isConnected) {
                this.#bind();
                this.#schedule();
            }
        }
        snapshot() {
            return this.#state === undefined
                ? Tag("Unconfigured")
                : Tag("Ready", this.#state);
        }
        execute(command) {
            if (this.#configuration === undefined) {
                return Promise.reject(new PrnsBridgeUnconfiguredError());
            }
            return this.#configuration.prns.execute(command);
        }
        connectedCallback() {
            if (this.#configuration !== undefined) {
                this.#bind();
                this.#schedule();
            }
        }
        disconnectedCallback() {
            this.#unbind();
        }
        #bind() {
            this.#unbind();
            const projections = this.#projections();
            for (const projection of projections) {
                this.#release.push(projection.subscribe(() => this.#schedule()));
            }
        }
        #unbind() {
            for (const release of this.#release.splice(0)) {
                release();
            }
        }
        #schedule() {
            if (this.#scheduled) {
                return;
            }
            this.#scheduled = true;
            queueMicrotask(() => {
                this.#scheduled = false;
                if (!this.isConnected || this.#configuration === undefined) {
                    return;
                }
                this.#state = this.#readState();
                this.dispatchEvent(new CustomEvent(PRNS_BRIDGE_CHANGE_EVENT, { detail: this.#state, bubbles: true, composed: true }));
            });
        }
        #readState() {
            const [lifecycle, interfaces, routes, links, diagnostics] = this.#projections();
            this.#version += 1;
            return Object.freeze({
                version: this.#version,
                lifecycle: lifecycle.latest().value,
                interfaces: interfaces.latest().value,
                routes: routes.latest().value,
                links: links.latest().value,
                diagnostics: diagnostics.latest().value,
            });
        }
        #projections() {
            const configuration = this.#configuration;
            if (configuration === undefined) {
                throw new PrnsBridgeUnconfiguredError();
            }
            const prns = configuration.prns;
            return [
                prns.projection(prnsView("Lifecycle")),
                prns.projection(prnsView("Interfaces")),
                prns.projection(prnsView("Routes")),
                prns.projection(prnsView("Links")),
                prns.projection(prnsView("Diagnostics", {
                    maximumEvents: configuration.diagnosticMaximumEvents,
                })),
            ];
        }
    }
    registry.define(PRNS_BRIDGE_ELEMENT_NAME, BrowserPrnsBridgeElement);
    return Tag("Defined");
}
export { PrnsClientBoundaryRequiredError } from "./client.js";
