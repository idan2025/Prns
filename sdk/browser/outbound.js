import { Tag, match_into } from "../casework.js";
import { interfaceId } from "../contract.js";
import { bytesField, field, optionalNumber, record, stringField, } from "./decoding.js";
import { runtimeInterfaceKind } from "./interface_kind.js";
import { PrnsValidationError, hopCount, packetFrameView, } from "./values.js";
export function outboundTargets(target, interfaceId, supervisorKind) {
    return match_into().from(target, {
        Interface: (targetInterface) => equalBytes(targetInterface, interfaceId),
        Broadcast: ({ supervisorKind: targetKind, fan }) => targetKind === supervisorKind &&
            match_into().from(fan, {
                All: () => true,
                Only: (targetInterface) => equalBytes(targetInterface, interfaceId),
                AllExcept: (targetInterface) => !equalBytes(targetInterface, interfaceId),
            }),
    });
}
export function parseOutboundFrame(raw) {
    const object = record(raw, "PrnsOutboundFrame");
    const type = stringField(object, "type");
    if (type !== "frame" && type !== "announce") {
        throw new PrnsValidationError("unknown-outbound-target", `unknown outbound frame type ${type}`);
    }
    const frame = {
        type,
        target: parseOutboundTarget(field(object, "target")),
        bytes: packetFrameView(bytesField(object, "bytes")),
    };
    const hops = optionalNumber(object, "hops", hopCount);
    if (hops !== undefined) {
        frame.hops = hops;
    }
    return frame;
}
function parseOutboundTarget(raw) {
    const object = record(raw, "OutboundTarget");
    const type = stringField(object, "type");
    if (type === "interface") {
        return Tag("Interface", interfaceId(bytesField(object, "interfaceId")));
    }
    if (type === "broadcast") {
        return Tag("Broadcast", {
            supervisorKind: runtimeInterfaceKind(stringField(object, "supervisorKind")),
            fan: parseFanTarget(field(object, "fan")),
        });
    }
    throw new PrnsValidationError("unknown-outbound-target", `unknown outbound target ${type}`);
}
function parseFanTarget(raw) {
    const object = record(raw, "FanTarget");
    const type = stringField(object, "type");
    if (type === "all") {
        return Tag("All");
    }
    if (type === "only") {
        return Tag("Only", interfaceId(bytesField(object, "interfaceId")));
    }
    if (type === "allExcept") {
        return Tag("AllExcept", interfaceId(bytesField(object, "interfaceId")));
    }
    throw new PrnsValidationError("unknown-outbound-target", `unknown fan target ${type}`);
}
function equalBytes(left, right) {
    if (left.length !== right.length) {
        return false;
    }
    for (let i = 0; i < left.length; i += 1) {
        if (left[i] !== right[i]) {
            return false;
        }
    }
    return true;
}
