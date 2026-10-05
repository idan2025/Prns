import { Tag } from "../casework.js";
import { COMMAND_FAILURE_KIND_CODES, COMMAND_OUTCOME_KIND_CODES, DELIVERY_EVIDENCE_KIND_CODES, DESTINATION_HASH_LENGTH, IDENTITY_HASH_LENGTH, INTERFACE_ID_LENGTH, LINK_ID_LENGTH, PACKET_HASH_LENGTH, REQUEST_ID_LENGTH, REQUEST_PATH_HASH_LENGTH, } from "../contract.js";
import { MAXIMUM_WIRE_BATCH_ITEMS, } from "../worker_wire/wire_batch.js";
const WORKER_INVOCATION_MAGIC = 0x5052_4951;
const WORKER_SETTLEMENT_MAGIC = 0x5052_5351;
export const MINIMUM_WORKER_CODEC_ITEMS = 10;
const SETTLEMENT_CALL_CODES = {
    Execute: 0,
    SendResourceBlob: 1,
    Snapshot: 2,
};
const COMMAND_CODES = {
    Announce: 0,
    SendSinglePacket: 1,
    CloseLink: 2,
    DetachInterface: 3,
    EstablishLink: 4,
    RequestPath: 5,
    Identify: 6,
    SendLinkPacket: 7,
    Request: 8,
    Respond: 9,
    SendResource: 10,
    SetLinkResourceStrategy: 11,
    SetDestinationResourceStrategy: 12,
    SendChannelMessage: 13,
    AllowRequester: 14,
};
const OUTCOME_CODES = COMMAND_OUTCOME_KIND_CODES;
const FAILURE_FORMATS = {
    NodeStopped: { code: COMMAND_FAILURE_KIND_CODES.NodeStopped, data: "Unit" },
    Busy: { code: COMMAND_FAILURE_KIND_CODES.Busy, data: "Unit" },
    PayloadTooLarge: { code: COMMAND_FAILURE_KIND_CODES.PayloadTooLarge, data: "Unit" },
    UnknownDestination: { code: COMMAND_FAILURE_KIND_CODES.UnknownDestination, data: "Unit" },
    NotSingleDestination: { code: COMMAND_FAILURE_KIND_CODES.NotSingleDestination, data: "Unit" },
    AnnounceAppDataTooLong: { code: COMMAND_FAILURE_KIND_CODES.AnnounceAppDataTooLong, data: "Unit" },
    UnknownInterface: { code: COMMAND_FAILURE_KIND_CODES.UnknownInterface, data: "Unit" },
    NoRouteToDestination: { code: COMMAND_FAILURE_KIND_CODES.NoRouteToDestination, data: "Unit" },
    NotDirectlyReachable: { code: COMMAND_FAILURE_KIND_CODES.NotDirectlyReachable, data: "Unit" },
    PacketCulled: { code: COMMAND_FAILURE_KIND_CODES.PacketCulled, data: "Unit" },
    DeliveryTimedOut: { code: COMMAND_FAILURE_KIND_CODES.DeliveryTimedOut, data: "Unit" },
    InvalidBitrate: { code: COMMAND_FAILURE_KIND_CODES.InvalidBitrate, data: "Unit" },
    BindFailed: { code: COMMAND_FAILURE_KIND_CODES.BindFailed, data: "Detail" },
    WriteFailed: { code: COMMAND_FAILURE_KIND_CODES.WriteFailed, data: "Detail" },
    UnsupportedByBackend: { code: COMMAND_FAILURE_KIND_CODES.UnsupportedByBackend, data: "Unit" },
    UnknownLink: { code: COMMAND_FAILURE_KIND_CODES.UnknownLink, data: "Unit" },
    LinkNotActive: { code: COMMAND_FAILURE_KIND_CODES.LinkNotActive, data: "Unit" },
    EntropyUnavailable: { code: COMMAND_FAILURE_KIND_CODES.EntropyUnavailable, data: "Unit" },
    NotLinkInitiator: { code: COMMAND_FAILURE_KIND_CODES.NotLinkInitiator, data: "Unit" },
    IdentityNotHeld: { code: COMMAND_FAILURE_KIND_CODES.IdentityNotHeld, data: "Unit" },
    UnknownRequestHandler: { code: COMMAND_FAILURE_KIND_CODES.UnknownRequestHandler, data: "Unit" },
    RequestPolicyNotAllowList: { code: COMMAND_FAILURE_KIND_CODES.RequestPolicyNotAllowList, data: "Unit" },
    RequestAllowListFull: { code: COMMAND_FAILURE_KIND_CODES.RequestAllowListFull, data: "Unit" },
    LinkBusy: { code: COMMAND_FAILURE_KIND_CODES.LinkBusy, data: "Unit" },
    ResourceTableFull: { code: COMMAND_FAILURE_KIND_CODES.ResourceTableFull, data: "Unit" },
    ResourceMetadataTooLarge: { code: COMMAND_FAILURE_KIND_CODES.ResourceMetadataTooLarge, data: "Unit" },
    ResourceRejectedByPeer: { code: COMMAND_FAILURE_KIND_CODES.ResourceRejectedByPeer, data: "Unit" },
    ResourceSequencingFailed: { code: COMMAND_FAILURE_KIND_CODES.ResourceSequencingFailed, data: "Unit" },
    ResourcePredecessorFailed: { code: COMMAND_FAILURE_KIND_CODES.ResourcePredecessorFailed, data: "Unit" },
    ChannelWindowFull: { code: COMMAND_FAILURE_KIND_CODES.ChannelWindowFull, data: "Unit" },
    ChannelUntrackable: { code: COMMAND_FAILURE_KIND_CODES.ChannelUntrackable, data: "Unit" },
    InvalidChannelMessageType: { code: COMMAND_FAILURE_KIND_CODES.InvalidChannelMessageType, data: "Unit" },
    InvalidConfiguration: { code: COMMAND_FAILURE_KIND_CODES.InvalidConfiguration, data: "Detail" },
    ResourceUploadCancelled: { code: COMMAND_FAILURE_KIND_CODES.ResourceUploadCancelled, data: "Unit" },
    ResourceEarlyEof: { code: COMMAND_FAILURE_KIND_CODES.ResourceEarlyEof, data: "Unit" },
    ResourceLengthOverrun: { code: COMMAND_FAILURE_KIND_CODES.ResourceLengthOverrun, data: "Unit" },
    PermissionDenied: { code: COMMAND_FAILURE_KIND_CODES.PermissionDenied, data: "Detail" },
    DeviceUnavailable: { code: COMMAND_FAILURE_KIND_CODES.DeviceUnavailable, data: "Detail" },
    ConnectFailed: { code: COMMAND_FAILURE_KIND_CODES.ConnectFailed, data: "Detail" },
    BackendFailed: { code: COMMAND_FAILURE_KIND_CODES.BackendFailed, data: "Detail" },
    ResponseTooLarge: { code: COMMAND_FAILURE_KIND_CODES.ResponseTooLarge, data: "Unit" },
    LinkClosed: { code: COMMAND_FAILURE_KIND_CODES.LinkClosed, data: "Unit" },
    ResponseCancelledBySender: { code: COMMAND_FAILURE_KIND_CODES.ResponseCancelledBySender, data: "Unit" },
    ResponseHashmapBeyondPartCount: { code: COMMAND_FAILURE_KIND_CODES.ResponseHashmapBeyondPartCount, data: "Unit" },
    ResponseHashmapSkipsAhead: { code: COMMAND_FAILURE_KIND_CODES.ResponseHashmapSkipsAhead, data: "Unit" },
    ResponseHashmapTooLong: { code: COMMAND_FAILURE_KIND_CODES.ResponseHashmapTooLong, data: "Unit" },
    ResponseHashmapRagged: { code: COMMAND_FAILURE_KIND_CODES.ResponseHashmapRagged, data: "Unit" },
    ResponseRetriesExhausted: { code: COMMAND_FAILURE_KIND_CODES.ResponseRetriesExhausted, data: "Unit" },
    ResponseLinkVanished: { code: COMMAND_FAILURE_KIND_CODES.ResponseLinkVanished, data: "Unit" },
    ResponseTransferUnopenable: { code: COMMAND_FAILURE_KIND_CODES.ResponseTransferUnopenable, data: "Unit" },
    ResponseTransferCorrupt: { code: COMMAND_FAILURE_KIND_CODES.ResponseTransferCorrupt, data: "Unit" },
    ResponseProofUnsendable: { code: COMMAND_FAILURE_KIND_CODES.ResponseProofUnsendable, data: "Unit" },
    ResponseDecompressionFailed: { code: COMMAND_FAILURE_KIND_CODES.ResponseDecompressionFailed, data: "Unit" },
    ResponseDecompressionTimedOut: { code: COMMAND_FAILURE_KIND_CODES.ResponseDecompressionTimedOut, data: "Unit" },
    ResponseOpenTimedOut: { code: COMMAND_FAILURE_KIND_CODES.ResponseOpenTimedOut, data: "Unit" },
    ResponseMetadataOverrun: { code: COMMAND_FAILURE_KIND_CODES.ResponseMetadataOverrun, data: "Unit" },
};
const COMMAND_TAGS = invertCodes(COMMAND_CODES, "worker command");
const OUTCOME_TAGS = invertCodes(OUTCOME_CODES, "command outcome", 1);
const FAILURE_TAGS = invertFormats(FAILURE_FORMATS, "command failure", 1);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder("utf-8", { fatal: true });
export const workerInvocationCodec = {
    id: "prns-worker-invocation-v1",
    accepts: (values) => values.every(isEncodableInvocation),
    encode: encodeInvocations,
    decode: decodeInvocations,
};
export const workerSettlementCodec = {
    id: "prns-worker-settlement-v1",
    accepts: (values) => values.every(isEncodableSettlement),
    encode: encodeSettlements,
    decode: decodeSettlements,
};
export function workerInvocationWireBytes(value) {
    if (isEncodableInvocation(value)) {
        return 16 + encodedCommandSize(value.call.data);
    }
    if (value.call.tag === "RegisterNodePage") {
        return 32 + value.call.data.byteLength;
    }
    return 256;
}
export function workerSettlementWireBytes(value) {
    if (isPackedSnapshotSettlement(value)) {
        return 17 + bytesSize(value.outcome.data);
    }
    if (isEncodableSettlement(value)) {
        return 17 + encodedSettlementSize(value.outcome);
    }
    return 256;
}
function isEncodableInvocation(value) {
    return Number.isSafeInteger(value.id) && value.id > 0 &&
        value.call.tag === "Execute" && isEncodedCommand(value.call.data);
}
function isEncodableSettlement(value) {
    if (!Number.isSafeInteger(value.id) || value.id <= 0) {
        return false;
    }
    return isPackedSnapshotSettlement(value) ||
        ((value.call === "Execute" || value.call === "SendResourceBlob") &&
            isCommandSettlement(value.outcome));
}
function isPackedSnapshotSettlement(value) {
    return value.call === "Snapshot" &&
        typeof value.outcome === "object" &&
        value.outcome !== null &&
        value.outcome.tag === "PackedSnapshot" &&
        value.outcome.data instanceof Uint8Array;
}
function isEncodedCommand(value) {
    return Object.hasOwn(COMMAND_CODES, value.tag);
}
function isCommandSettlement(value) {
    if (typeof value !== "object" || value === null) {
        return false;
    }
    const settlement = value;
    if (typeof settlement.data !== "object" || settlement.data === null) {
        return false;
    }
    const outcomeTag = settlement.data.tag;
    return (settlement.tag === "Succeeded" &&
        typeof outcomeTag === "string" && Object.hasOwn(OUTCOME_CODES, outcomeTag)) ||
        (settlement.tag === "Failed" &&
            typeof outcomeTag === "string" && Object.hasOwn(FAILURE_FORMATS, outcomeTag));
}
function encodeInvocations(values) {
    requireItemCount(values.length);
    let byteLength = 8;
    for (const value of values) {
        if (!isEncodableInvocation(value)) {
            throw new TypeError("worker invocation codec received an unsupported call");
        }
        byteLength = addSize(byteLength, 8 + encodedCommandSize(value.call.data));
    }
    const writer = new WireWriter(byteLength);
    writer.u32(WORKER_INVOCATION_MAGIC);
    writer.u32(values.length);
    for (const value of values) {
        writer.f64(value.id);
        encodeCommand(value.call.data, writer);
    }
    return writer.finish();
}
function decodeInvocations(buffer) {
    const reader = new WireReader(buffer);
    reader.magic(WORKER_INVOCATION_MAGIC);
    const count = reader.count();
    const values = new Array(count);
    for (let index = 0; index < count; index += 1) {
        const id = reader.safeId();
        values[index] = {
            id,
            call: Tag("Execute", decodeCommand(reader)),
        };
    }
    reader.requireFinished();
    return values;
}
function encodedCommandSize(command) {
    switch (command.tag) {
        case "Announce":
            return 1 + DESTINATION_HASH_LENGTH + 1 +
                (command.data.interface === undefined ? 0 : INTERFACE_ID_LENGTH);
        case "SendSinglePacket":
            return 1 + DESTINATION_HASH_LENGTH + bytesSize(command.data.payload);
        case "CloseLink":
            return 1 + LINK_ID_LENGTH;
        case "DetachInterface":
            return 1 + INTERFACE_ID_LENGTH;
        case "EstablishLink":
        case "RequestPath":
            return 1 + DESTINATION_HASH_LENGTH;
        case "Identify":
            return 1 + LINK_ID_LENGTH + IDENTITY_HASH_LENGTH;
        case "SendLinkPacket":
            return 1 + LINK_ID_LENGTH + bytesSize(command.data.payload);
        case "Request":
            return 1 + LINK_ID_LENGTH + REQUEST_PATH_HASH_LENGTH +
                bytesSize(command.data.payload) + responseTimeoutSize(command.data.timeout) + 1 +
                (command.data.maximumResponseBytes === undefined ? 0 : 8);
        case "Respond":
            return 1 + LINK_ID_LENGTH + REQUEST_ID_LENGTH + 8 + bytesSize(command.data.payload);
        case "SendResource":
            return 1 + LINK_ID_LENGTH + bytesSize(command.data.payload) + 1 +
                (command.data.packedMetadata === undefined ? 0 : bytesSize(command.data.packedMetadata)) +
                1;
        case "SetLinkResourceStrategy":
            return 1 + LINK_ID_LENGTH + resourceStrategySize(command.data.strategy);
        case "SetDestinationResourceStrategy":
            return 1 + DESTINATION_HASH_LENGTH + resourceStrategySize(command.data.strategy);
        case "SendChannelMessage":
            return 1 + LINK_ID_LENGTH + 8 + bytesSize(command.data.payload);
        case "AllowRequester":
            return 1 + DESTINATION_HASH_LENGTH + REQUEST_PATH_HASH_LENGTH + IDENTITY_HASH_LENGTH;
    }
}
function encodeCommand(command, writer) {
    writer.u8(COMMAND_CODES[command.tag]);
    switch (command.tag) {
        case "Announce":
            writer.fixed(command.data.destination, DESTINATION_HASH_LENGTH, "destination hash");
            writer.optionalFixed(command.data.interface, INTERFACE_ID_LENGTH, "interface id");
            return;
        case "SendSinglePacket":
            writer.fixed(command.data.destination, DESTINATION_HASH_LENGTH, "destination hash");
            writer.bytes(command.data.payload);
            return;
        case "CloseLink":
            writer.fixed(command.data.linkId, LINK_ID_LENGTH, "link id");
            return;
        case "DetachInterface":
            writer.fixed(command.data.interface, INTERFACE_ID_LENGTH, "interface id");
            return;
        case "EstablishLink":
        case "RequestPath":
            writer.fixed(command.data.destination, DESTINATION_HASH_LENGTH, "destination hash");
            return;
        case "Identify":
            writer.fixed(command.data.linkId, LINK_ID_LENGTH, "link id");
            writer.fixed(command.data.identity, IDENTITY_HASH_LENGTH, "identity hash");
            return;
        case "SendLinkPacket":
            writer.fixed(command.data.linkId, LINK_ID_LENGTH, "link id");
            writer.bytes(command.data.payload);
            return;
        case "Request":
            writer.fixed(command.data.linkId, LINK_ID_LENGTH, "link id");
            writer.fixed(command.data.pathHash, REQUEST_PATH_HASH_LENGTH, "request path hash");
            writer.bytes(command.data.payload);
            encodeResponseTimeout(command.data.timeout, writer);
            writer.optionalNumber(command.data.maximumResponseBytes);
            return;
        case "Respond":
            writer.fixed(command.data.linkId, LINK_ID_LENGTH, "link id");
            writer.fixed(command.data.requestId, REQUEST_ID_LENGTH, "request id");
            writer.f64(command.data.requestRttMillis);
            writer.bytes(command.data.payload);
            return;
        case "SendResource":
            writer.fixed(command.data.linkId, LINK_ID_LENGTH, "link id");
            writer.bytes(command.data.payload);
            writer.optionalBytes(command.data.packedMetadata);
            encodeResourceCompression(command.data.compression, writer);
            return;
        case "SetLinkResourceStrategy":
            writer.fixed(command.data.linkId, LINK_ID_LENGTH, "link id");
            encodeResourceStrategy(command.data.strategy, writer);
            return;
        case "SetDestinationResourceStrategy":
            writer.fixed(command.data.destination, DESTINATION_HASH_LENGTH, "destination hash");
            encodeResourceStrategy(command.data.strategy, writer);
            return;
        case "SendChannelMessage":
            writer.fixed(command.data.linkId, LINK_ID_LENGTH, "link id");
            writer.f64(command.data.messageType);
            writer.bytes(command.data.payload);
            return;
        case "AllowRequester":
            writer.fixed(command.data.destination, DESTINATION_HASH_LENGTH, "destination hash");
            writer.fixed(command.data.pathHash, REQUEST_PATH_HASH_LENGTH, "request path hash");
            writer.fixed(command.data.identity, IDENTITY_HASH_LENGTH, "identity hash");
            return;
    }
}
function decodeCommand(reader) {
    const tag = reader.code(COMMAND_TAGS, "worker command");
    switch (tag) {
        case "Announce": {
            const destination = reader.fixed(DESTINATION_HASH_LENGTH);
            const interfaceId = reader.optionalFixed(INTERFACE_ID_LENGTH);
            return Tag("Announce", interfaceId === undefined
                ? { destination }
                : { destination, interface: interfaceId });
        }
        case "SendSinglePacket":
            return Tag("SendSinglePacket", {
                destination: reader.fixed(DESTINATION_HASH_LENGTH),
                payload: reader.bytes(),
            });
        case "CloseLink":
            return Tag("CloseLink", { linkId: reader.fixed(LINK_ID_LENGTH) });
        case "DetachInterface":
            return Tag("DetachInterface", {
                interface: reader.fixed(INTERFACE_ID_LENGTH),
            });
        case "EstablishLink":
            return Tag("EstablishLink", {
                destination: reader.fixed(DESTINATION_HASH_LENGTH),
            });
        case "RequestPath":
            return Tag("RequestPath", {
                destination: reader.fixed(DESTINATION_HASH_LENGTH),
            });
        case "Identify":
            return Tag("Identify", {
                linkId: reader.fixed(LINK_ID_LENGTH),
                identity: reader.fixed(IDENTITY_HASH_LENGTH),
            });
        case "SendLinkPacket":
            return Tag("SendLinkPacket", {
                linkId: reader.fixed(LINK_ID_LENGTH),
                payload: reader.bytes(),
            });
        case "Request": {
            const linkId = reader.fixed(LINK_ID_LENGTH);
            const pathHash = reader.fixed(REQUEST_PATH_HASH_LENGTH);
            const payload = reader.bytes();
            const timeout = decodeResponseTimeout(reader);
            const maximumResponseBytes = reader.optionalNumber();
            return Tag("Request", maximumResponseBytes === undefined
                ? { linkId, pathHash, payload, timeout }
                : { linkId, pathHash, payload, timeout, maximumResponseBytes });
        }
        case "Respond":
            return Tag("Respond", {
                linkId: reader.fixed(LINK_ID_LENGTH),
                requestId: reader.fixed(REQUEST_ID_LENGTH),
                requestRttMillis: reader.f64(),
                payload: reader.bytes(),
            });
        case "SendResource": {
            const linkId = reader.fixed(LINK_ID_LENGTH);
            const payload = reader.bytes();
            const packedMetadata = reader.optionalBytes();
            const compression = decodeResourceCompression(reader);
            return Tag("SendResource", packedMetadata === undefined
                ? { linkId, payload, compression }
                : { linkId, payload, packedMetadata, compression });
        }
        case "SetLinkResourceStrategy":
            return Tag("SetLinkResourceStrategy", {
                linkId: reader.fixed(LINK_ID_LENGTH),
                strategy: decodeResourceStrategy(reader),
            });
        case "SetDestinationResourceStrategy":
            return Tag("SetDestinationResourceStrategy", {
                destination: reader.fixed(DESTINATION_HASH_LENGTH),
                strategy: decodeResourceStrategy(reader),
            });
        case "SendChannelMessage":
            return Tag("SendChannelMessage", {
                linkId: reader.fixed(LINK_ID_LENGTH),
                messageType: reader.f64(),
                payload: reader.bytes(),
            });
        case "AllowRequester":
            return Tag("AllowRequester", {
                destination: reader.fixed(DESTINATION_HASH_LENGTH),
                pathHash: reader.fixed(REQUEST_PATH_HASH_LENGTH),
                identity: reader.fixed(IDENTITY_HASH_LENGTH),
            });
    }
}
function encodeSettlements(values) {
    requireItemCount(values.length);
    let byteLength = 8;
    for (const value of values) {
        if (!isEncodableSettlement(value)) {
            throw new TypeError("worker settlement codec received an unsupported outcome");
        }
        byteLength = addSize(byteLength, 8 + 1 + (isPackedSnapshotSettlement(value)
            ? bytesSize(value.outcome.data)
            : encodedSettlementSize(value.outcome)));
    }
    const writer = new WireWriter(byteLength);
    writer.u32(WORKER_SETTLEMENT_MAGIC);
    writer.u32(values.length);
    for (const value of values) {
        writer.f64(value.id);
        if (isPackedSnapshotSettlement(value)) {
            writer.u8(SETTLEMENT_CALL_CODES.Snapshot);
            writer.bytes(value.outcome.data);
            continue;
        }
        writer.u8(SETTLEMENT_CALL_CODES[value.call]);
        encodeSettlement(value.outcome, writer);
    }
    return writer.finish();
}
function decodeSettlements(buffer) {
    const reader = new WireReader(buffer);
    reader.magic(WORKER_SETTLEMENT_MAGIC);
    const count = reader.count();
    const values = new Array(count);
    for (let index = 0; index < count; index += 1) {
        const id = reader.safeId();
        const callCode = reader.u8();
        if (callCode === SETTLEMENT_CALL_CODES.Execute) {
            values[index] = { id, call: "Execute", outcome: decodeSettlement(reader) };
            continue;
        }
        if (callCode === SETTLEMENT_CALL_CODES.SendResourceBlob) {
            values[index] = { id, call: "SendResourceBlob", outcome: decodeSettlement(reader) };
            continue;
        }
        if (callCode === SETTLEMENT_CALL_CODES.Snapshot) {
            values[index] = {
                id,
                call: "Snapshot",
                outcome: Tag("PackedSnapshot", reader.bytes()),
            };
            continue;
        }
        throw new TypeError("worker settlement contains an unknown call code");
    }
    reader.requireFinished();
    return values;
}
function encodedSettlementSize(settlement) {
    return 1 + (settlement.tag === "Succeeded"
        ? encodedOutcomeSize(settlement.data)
        : encodedFailureSize(settlement.data));
}
function encodeSettlement(settlement, writer) {
    if (settlement.tag === "Succeeded") {
        writer.u8(0);
        encodeOutcome(settlement.data, writer);
        return;
    }
    writer.u8(1);
    encodeFailure(settlement.data, writer);
}
function decodeSettlement(reader) {
    const code = reader.u8();
    if (code === 0) {
        return Tag("Succeeded", decodeOutcome(reader));
    }
    if (code === 1) {
        return Tag("Failed", decodeFailure(reader));
    }
    throw new TypeError("worker settlement contains an unknown result code");
}
function encodedOutcomeSize(outcome) {
    switch (outcome.tag) {
        case "Announced":
        case "LinkCloseQueued":
        case "Identified":
        case "ResourceSent":
        case "ResourceStrategySet":
        case "RequesterAllowed":
            return 1;
        case "PacketDelivered":
            return 1 + 8 + 1 + 1 +
                (outcome.data.packetHash === undefined ? 0 : PACKET_HASH_LENGTH);
        case "InterfaceAttached":
        case "InterfaceDetached":
            return 1 + INTERFACE_ID_LENGTH;
        case "LinkEstablished":
            return 1 + LINK_ID_LENGTH + 8;
        case "PathDiscovered":
        case "ResponseSent":
            return 1 + 8;
        case "ResponseReceived":
            return 1 + bytesSize(outcome.data.data) + 8;
    }
}
function encodeOutcome(outcome, writer) {
    writer.u8(OUTCOME_CODES[outcome.tag]);
    switch (outcome.tag) {
        case "Announced":
        case "LinkCloseQueued":
        case "Identified":
        case "ResourceSent":
        case "ResourceStrategySet":
        case "RequesterAllowed":
            return;
        case "PacketDelivered":
            writer.f64(outcome.data.rttMillis);
            writer.u8(encodeEvidence(outcome.data.evidence));
            writer.optionalFixed(outcome.data.packetHash, PACKET_HASH_LENGTH, "packet hash");
            return;
        case "InterfaceAttached":
        case "InterfaceDetached":
            writer.fixed(outcome.data.interface, INTERFACE_ID_LENGTH, "interface id");
            return;
        case "LinkEstablished":
            writer.fixed(outcome.data.linkId, LINK_ID_LENGTH, "link id");
            writer.f64(outcome.data.rttMillis);
            return;
        case "PathDiscovered":
            writer.f64(outcome.data.hops);
            return;
        case "ResponseReceived":
            writer.bytes(outcome.data.data);
            writer.f64(outcome.data.rttMillis);
            return;
        case "ResponseSent":
            writer.f64(outcome.data.rttMillis);
            return;
    }
}
function decodeOutcome(reader) {
    const tag = reader.code(OUTCOME_TAGS, "command outcome");
    switch (tag) {
        case "Announced":
            return Tag("Announced");
        case "PacketDelivered": {
            const rttMillis = reader.f64();
            const evidence = decodeEvidence(reader.u8());
            const packetHash = reader.optionalFixed(PACKET_HASH_LENGTH);
            return Tag("PacketDelivered", packetHash === undefined
                ? { rttMillis, evidence }
                : { rttMillis, evidence, packetHash });
        }
        case "LinkCloseQueued":
            return Tag("LinkCloseQueued");
        case "InterfaceAttached":
            return Tag("InterfaceAttached", {
                interface: reader.fixed(INTERFACE_ID_LENGTH),
            });
        case "InterfaceDetached":
            return Tag("InterfaceDetached", {
                interface: reader.fixed(INTERFACE_ID_LENGTH),
            });
        case "LinkEstablished":
            return Tag("LinkEstablished", {
                linkId: reader.fixed(LINK_ID_LENGTH),
                rttMillis: reader.f64(),
            });
        case "PathDiscovered":
            return Tag("PathDiscovered", { hops: reader.f64() });
        case "Identified":
            return Tag("Identified");
        case "ResponseReceived":
            return Tag("ResponseReceived", { data: reader.bytes(), rttMillis: reader.f64() });
        case "ResponseSent":
            return Tag("ResponseSent", { rttMillis: reader.f64() });
        case "ResourceSent":
            return Tag("ResourceSent");
        case "ResourceStrategySet":
            return Tag("ResourceStrategySet");
        case "RequesterAllowed":
            return Tag("RequesterAllowed");
    }
}
function encodedFailureSize(failure) {
    const format = FAILURE_FORMATS[failure.tag];
    return 1 + (format.data === "Detail"
        ? stringSize(failure.data.detail)
        : 0);
}
function encodeFailure(failure, writer) {
    const format = FAILURE_FORMATS[failure.tag];
    writer.u8(format.code);
    if (format.data === "Detail") {
        const detail = failure.data.detail;
        if (typeof detail !== "string") {
            throw new TypeError("command failure detail is not a string");
        }
        writer.string(detail);
    }
}
function decodeFailure(reader) {
    const tag = reader.code(FAILURE_TAGS, "command failure");
    const format = FAILURE_FORMATS[tag];
    return format.data === "Detail"
        ? Tag(tag, { detail: reader.string() })
        : Tag(tag);
}
function responseTimeoutSize(value) {
    return value.tag === "LinkDefault" ? 1 : 9;
}
function encodeResponseTimeout(value, writer) {
    if (value.tag === "LinkDefault") {
        writer.u8(0);
        return;
    }
    if (value.tag === "Exact") {
        writer.u8(1);
        writer.f64(value.data.millis);
        return;
    }
    throw new TypeError("worker command contains an unknown response timeout");
}
function decodeResponseTimeout(reader) {
    const code = reader.u8();
    if (code === 0) {
        return Tag("LinkDefault");
    }
    if (code === 1) {
        return Tag("Exact", { millis: reader.f64() });
    }
    throw new TypeError("worker command contains an unknown response timeout");
}
function resourceStrategySize(value) {
    return value.tag === "Refuse" ? 1 : 10;
}
function encodeResourceStrategy(value, writer) {
    if (value.tag === "Refuse") {
        writer.u8(0);
        return;
    }
    if (value.tag === "Accept") {
        writer.u8(1);
        writer.f64(value.data.maximumUncompressedBytes);
        writer.u8(value.data.acceptCompressed ? 1 : 0);
        return;
    }
    throw new TypeError("worker command contains an unknown resource strategy");
}
function decodeResourceStrategy(reader) {
    const code = reader.u8();
    if (code === 0) {
        return Tag("Refuse");
    }
    if (code === 1) {
        const maximumUncompressedBytes = reader.f64();
        const acceptCompressed = reader.boolean();
        return Tag("Accept", { maximumUncompressedBytes, acceptCompressed });
    }
    throw new TypeError("worker command contains an unknown resource strategy");
}
function encodeResourceCompression(value, writer) {
    if (value.tag === "Auto") {
        writer.u8(0);
        return;
    }
    if (value.tag === "Never") {
        writer.u8(1);
        return;
    }
    throw new TypeError("worker command contains an unknown resource compression");
}
function decodeResourceCompression(reader) {
    const code = reader.u8();
    if (code === 0) {
        return Tag("Auto");
    }
    if (code === 1) {
        return Tag("Never");
    }
    throw new TypeError("worker command contains an unknown resource compression");
}
function encodeEvidence(value) {
    if (value === "ExplicitProof") {
        return DELIVERY_EVIDENCE_KIND_CODES.ExplicitProof;
    }
    if (value === "ImplicitProof") {
        return DELIVERY_EVIDENCE_KIND_CODES.ImplicitProof;
    }
    if (value === "Response") {
        return DELIVERY_EVIDENCE_KIND_CODES.Response;
    }
    throw new TypeError("command outcome contains an unknown delivery evidence kind");
}
function decodeEvidence(code) {
    if (code === DELIVERY_EVIDENCE_KIND_CODES.ExplicitProof) {
        return "ExplicitProof";
    }
    if (code === DELIVERY_EVIDENCE_KIND_CODES.ImplicitProof) {
        return "ImplicitProof";
    }
    if (code === DELIVERY_EVIDENCE_KIND_CODES.Response) {
        return "Response";
    }
    throw new TypeError("command outcome contains an unknown delivery evidence kind");
}
function bytesSize(value) {
    if (!(value instanceof Uint8Array) || value.byteLength > 0xffff_ffff) {
        throw new TypeError("worker codec byte field is invalid");
    }
    return 4 + value.byteLength;
}
function stringSize(value) {
    return 4 + textEncoder.encode(value).byteLength;
}
function addSize(left, right) {
    const sum = left + right;
    if (!Number.isSafeInteger(sum) || sum > 0xffff_ffff) {
        throw new TypeError("worker codec frame exceeds its byte bound");
    }
    return sum;
}
function requireItemCount(count) {
    if (!Number.isSafeInteger(count) || count > MAXIMUM_WIRE_BATCH_ITEMS) {
        throw new TypeError("worker codec frame exceeds its item bound");
    }
}
function invertCodes(codes, label, firstCode = 0) {
    const names = [];
    for (const name of Object.keys(codes)) {
        const code = codes[name];
        if (!Number.isSafeInteger(code) || code < 0 || code > 0xff || names[code] !== undefined) {
            throw new TypeError(`${label} codes are invalid`);
        }
        names[code] = name;
    }
    for (let code = firstCode; code < names.length; code += 1) {
        if (names[code] === undefined) {
            throw new TypeError(`${label} codes are not contiguous`);
        }
    }
    return names;
}
function invertFormats(formats, label, firstCode = 0) {
    const codes = Object.fromEntries(Object.keys(formats).map((name) => [name, formats[name].code]));
    return invertCodes(codes, label, firstCode);
}
class WireWriter {
    #buffer;
    #bytes;
    #view;
    #offset = 0;
    constructor(byteLength) {
        if (!Number.isSafeInteger(byteLength) || byteLength < 0 || byteLength > 0xffff_ffff) {
            throw new TypeError("worker codec frame has an invalid byte length");
        }
        this.#buffer = new ArrayBuffer(byteLength);
        this.#bytes = new Uint8Array(this.#buffer);
        this.#view = new DataView(this.#buffer);
    }
    u8(value) {
        if (!Number.isSafeInteger(value) || value < 0 || value > 0xff) {
            throw new TypeError("worker codec byte value is invalid");
        }
        this.#view.setUint8(this.#offset, value);
        this.#offset += 1;
    }
    u32(value) {
        if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
            throw new TypeError("worker codec u32 value is invalid");
        }
        this.#view.setUint32(this.#offset, value, true);
        this.#offset += 4;
    }
    f64(value) {
        if (typeof value !== "number") {
            throw new TypeError("worker codec number value is invalid");
        }
        this.#view.setFloat64(this.#offset, value, true);
        this.#offset += 8;
    }
    fixed(value, length, label) {
        if (!(value instanceof Uint8Array) || value.byteLength !== length) {
            throw new TypeError(`${label} has the wrong byte length`);
        }
        this.#rawBytes(value);
    }
    optionalFixed(value, length, label) {
        this.u8(value === undefined ? 0 : 1);
        if (value !== undefined) {
            this.fixed(value, length, label);
        }
    }
    bytes(value) {
        this.u32(bytesSize(value) - 4);
        this.#rawBytes(value);
    }
    optionalBytes(value) {
        this.u8(value === undefined ? 0 : 1);
        if (value !== undefined) {
            this.bytes(value);
        }
    }
    optionalNumber(value) {
        this.u8(value === undefined ? 0 : 1);
        if (value !== undefined) {
            this.f64(value);
        }
    }
    string(value) {
        const bytes = textEncoder.encode(value);
        this.u32(bytes.byteLength);
        this.#rawBytes(bytes);
    }
    finish() {
        if (this.#offset !== this.#buffer.byteLength) {
            throw new TypeError("worker codec did not fill its frame");
        }
        return this.#buffer;
    }
    #rawBytes(value) {
        if (value.byteLength > this.#bytes.byteLength - this.#offset) {
            throw new TypeError("worker codec write exceeds its frame");
        }
        this.#bytes.set(value, this.#offset);
        this.#offset += value.byteLength;
    }
}
class WireReader {
    #buffer;
    #bytes;
    #view;
    #offset = 0;
    constructor(buffer) {
        if (!(buffer instanceof ArrayBuffer)) {
            throw new TypeError("worker codec payload is not an ArrayBuffer");
        }
        this.#buffer = buffer;
        this.#bytes = new Uint8Array(buffer);
        this.#view = new DataView(buffer);
    }
    magic(expected) {
        if (this.u32() !== expected) {
            throw new TypeError("worker codec frame has an unknown format");
        }
    }
    count() {
        const count = this.u32();
        if (count > MAXIMUM_WIRE_BATCH_ITEMS) {
            throw new TypeError("worker codec frame exceeds its item bound");
        }
        return count;
    }
    safeId() {
        const value = this.f64();
        if (!Number.isSafeInteger(value) || value <= 0) {
            throw new TypeError("worker codec frame contains an invalid call id");
        }
        return value;
    }
    u8() {
        this.#require(1);
        const value = this.#view.getUint8(this.#offset);
        this.#offset += 1;
        return value;
    }
    u32() {
        this.#require(4);
        const value = this.#view.getUint32(this.#offset, true);
        this.#offset += 4;
        return value;
    }
    f64() {
        this.#require(8);
        const value = this.#view.getFloat64(this.#offset, true);
        this.#offset += 8;
        return value;
    }
    boolean() {
        const value = this.u8();
        if (value !== 0 && value !== 1) {
            throw new TypeError("worker codec frame contains an invalid boolean");
        }
        return value === 1;
    }
    fixed(length) {
        return this.#copy(length);
    }
    optionalFixed(length) {
        const present = this.boolean();
        return present ? this.fixed(length) : undefined;
    }
    bytes() {
        return this.#copy(this.u32());
    }
    optionalBytes() {
        return this.boolean() ? this.bytes() : undefined;
    }
    optionalNumber() {
        return this.boolean() ? this.f64() : undefined;
    }
    string() {
        return textDecoder.decode(this.#copy(this.u32()));
    }
    code(names, label) {
        const name = names[this.u8()];
        if (name === undefined) {
            throw new TypeError(`${label} code is unknown`);
        }
        return name;
    }
    requireFinished() {
        if (this.#offset !== this.#buffer.byteLength) {
            throw new TypeError("worker codec frame contains trailing bytes");
        }
    }
    #copy(length) {
        this.#require(length);
        const value = this.#bytes.slice(this.#offset, this.#offset + length);
        this.#offset += length;
        return value;
    }
    #require(length) {
        if (!Number.isSafeInteger(length) ||
            length < 0 ||
            length > this.#buffer.byteLength - this.#offset) {
            throw new TypeError("worker codec read exceeds its frame");
        }
    }
}
