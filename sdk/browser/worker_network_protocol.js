import { Tag } from "../casework.js";
import { interfaceId } from "../contract.js";
import { prepareByteTransfer, receiveByteTransfer, } from "./byte_transfer.js";
import { packetFrameView } from "./values.js";
export function receiveTransferredOutboundFrames(interfaceId, outcome) {
    return receiveByteTransfer(outcome.data).map((bytes) => ({
        type: "frame",
        target: Tag("Interface", interfaceId),
        bytes: packetFrameView(bytes),
    }));
}
export function prepareIngressTransfer(items) {
    return {
        interfaceIds: items.map((item) => item.interfaceId),
        bytes: prepareByteTransfer(items.map((item) => item.bytes)),
    };
}
export function receiveIngressTransfer(batch) {
    if (!Array.isArray(batch.interfaceIds)) {
        throw new TypeError("ingress transfer interfaces are malformed");
    }
    const bytes = receiveByteTransfer(batch.bytes);
    if (bytes.length !== batch.interfaceIds.length) {
        throw new TypeError("ingress transfer columns have different lengths");
    }
    return bytes.map((value, index) => {
        const rawInterfaceId = batch.interfaceIds[index];
        if (rawInterfaceId === undefined) {
            throw new TypeError("ingress transfer contains a missing interface");
        }
        return {
            interfaceId: interfaceId(rawInterfaceId),
            bytes: value,
        };
    });
}
