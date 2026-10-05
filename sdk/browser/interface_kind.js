import { PrnsValidationError } from "./values.js";
const INTERFACE_KIND_NAMES = Object.freeze([
    "loopback",
    "tcp-client",
    "tcp-server",
    "udp",
    "serial",
    "usb-auto-host",
    "usb-auto-device",
    "auto-wifi",
    "wifi-peer",
    "local-server",
    "local-client",
    "tcp-server-peer",
    "bluetooth-auto",
    "bluetooth-peer",
    "lora",
    "kiss",
    "ax25-kiss",
    "pipe",
    "rnode",
    "backbone-server",
    "backbone-server-peer",
    "backbone-client",
    "esp-now",
    "websocket-client",
    "websocket-server",
    "websocket-server-peer",
    "wifi-direct",
    "wifi-direct-peer",
    "wifi-aware",
    "wifi-aware-peer",
    "i2p",
    "i2p-peer",
    "weave",
    "weave-peer",
]);
const BROWSER_RUNTIME_INTERFACE_KINDS = Object.freeze([
    "auto-usb-host",
    "auto-usb-device",
    "rnode",
    "bluetooth-auto",
    "bluetooth-peer",
    "auto-wifi",
    "websocket-client",
    "websocket-server",
    "websocket-server-peer",
    "serial",
    "kiss",
    "pipe",
]);
export function interfaceKindNameFromCode(code) {
    return INTERFACE_KIND_NAMES[code] ?? "unknown";
}
export function runtimeInterfaceKind(value) {
    if (value === "usb-auto-host") {
        return "auto-usb-host";
    }
    if (value === "usb-auto-device") {
        return "auto-usb-device";
    }
    const kind = BROWSER_RUNTIME_INTERFACE_KINDS.find((candidate) => candidate === value);
    if (kind !== undefined) {
        return kind;
    }
    throw new PrnsValidationError("unknown-interface-kind", `unknown interface kind ${value}`);
}
export function runtimeInterfaceKindFromCode(code) {
    const value = INTERFACE_KIND_NAMES[code];
    if (value === undefined) {
        throw new PrnsValidationError("unknown-interface-kind", `unknown interface kind code ${code}`);
    }
    return runtimeInterfaceKind(value);
}
