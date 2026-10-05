import { Tag, match, match_into } from "../casework.js";
import { destinationHash, identityHash, interfaceId, linkId, requestId, requestPathHash, resourceHash, } from "../contract.js";
import { APPLICATION_EVENT_KIND_CODES, DIAGNOSTIC_EVENT_KIND_CODES, EVENT_FIELD_CODES, } from "../contract.generated.js";
import { decodeEventBatchProjection, } from "../event_projection.js";
import { MemoryResourceStream } from "../memory_resource.js";
import { parseCommandSettlement } from "./command_settlement.js";
import { bigintField, bytesField, nonNegativeBigIntField, numberField, optionalBytesField, record, stringField, } from "./decoding.js";
import { PrnsValidationError, commandId, copyBytes, hopCount, nonNegativeInteger, positiveInteger, } from "./values.js";
const RAW_EVENT_TYPES = new Set([
    "announce",
    "selfRatchetRotated",
    "announceHeldDropped",
    "commandSettled",
    "linkEstablished",
    "peerIdentified",
    "request",
    "response",
    "responseSegment",
    "channelMessage",
    "singleDelivery",
    "linkDelivery",
    "delivered",
    "backendDiagnostic",
    "linkClosed",
    "linkInterfaceMismatch",
    "resourceReceived",
    "resourceFailed",
    "resourceNeedsDecompression",
    "resourceSegment",
    "resourceAssembled",
    "routeExpired",
    "routeEvicted",
    "routeInterfaceGone",
    "routeDropped",
    "persistenceFlushed",
    "persistenceFlushFailed",
]);
const RAW_LINK_CLOSED_REASONS = new Set([
    "timeout",
    "peerClosed",
    "malformedRtt",
    "locallyClosed",
]);
const COMMAND_ID_PROJECTION_FIELD = 32_768;
const CORRELATED_EVENT_KINDS = new Set([
    APPLICATION_EVENT_KIND_CODES.Response,
    APPLICATION_EVENT_KIND_CODES.ResponseSegment,
]);
const DIAGNOSTIC_EVENT_KINDS_SET = new Set(Object.values(DIAGNOSTIC_EVENT_KIND_CODES));
export function parseEventBatch(bytes) {
    return decodeEventBatchProjection(bytes).map((event) => parseEvent(rawProjectedEvent(event)));
}
export function parseDiagnosticEventBatch(bytes) {
    const diagnostics = [];
    for (const projected of decodeEventBatchProjection(bytes, DIAGNOSTIC_EVENT_KINDS_SET)) {
        match(parseEvent(rawProjectedEvent(projected)), {
            Diagnostic: (diagnostic) => diagnostics.push(diagnostic),
            Application: () => undefined,
            CommandResponse: () => undefined,
            CommandResponseSegment: () => undefined,
            CommandSettled: () => undefined,
        });
    }
    return diagnostics;
}
export function parseCorrelatedEventBatch(bytes) {
    return decodeEventBatchProjection(bytes, CORRELATED_EVENT_KINDS)
        .map((event) => parseEvent(rawProjectedEvent(event)));
}
export function retainedApplicationEventBytes(event) {
    return match_into().from(event, {
        SingleDelivery: ({ plaintext }) => plaintext.length,
        LinkDelivery: ({ plaintext }) => plaintext.length,
        Request: ({ data }) => data.length,
        Response: ({ data }) => data.length,
        ResponseSegment: ({ data }) => data.length,
        ResourceAvailable: ({ resource, metadata }) => exactBytesAsSafeNumber(resource.totalBytes, "resource.totalBytes") +
            (metadata?.length ?? 0),
        ResourceSegment: ({ data, metadata }) => data.length + (metadata?.length ?? 0),
        ResourceNeedsDecompression: ({ stream }) => stream.length,
        ChannelMessage: ({ data }) => data.length,
    });
}
export function parseEvent(raw) {
    const object = record(raw, "PrnsEvent");
    const event = Tag(rawEventType(stringField(object, "type")), object);
    return match_into().from(event, {
        announce: (data) => Tag("Diagnostic", Tag("AnnounceHeard", {
            appData: copyBytes(bytesField(data, "appData")),
            destination: destinationHash(bytesField(data, "destination")),
            hops: hopCount(numberField(data, "hops")),
            sourceInterface: interfaceId(bytesField(data, "sourceInterface")),
        })),
        selfRatchetRotated: (data) => Tag("Diagnostic", Tag("SelfRatchetRotated", {
            destination: destinationHash(bytesField(data, "destination")),
        })),
        announceHeldDropped: (data) => Tag("Diagnostic", Tag("AnnounceHeldDropped", {
            destination: destinationHash(bytesField(data, "destination")),
            sourceInterface: interfaceId(bytesField(data, "sourceInterface")),
            cause: stringField(data, "cause"),
        })),
        commandSettled: (data) => {
            const commandIdValue = commandId(bigintField(data, "id"));
            const settlement = parseCommandSettlement(data);
            return Tag("CommandSettled", settlement === undefined
                ? { commandId: commandIdValue }
                : { commandId: commandIdValue, settlement });
        },
        linkEstablished: (data) => Tag("Diagnostic", Tag("LinkEstablished", {
            linkId: linkId(bytesField(data, "linkId")),
            rttMillis: nonNegativeInteger(numberField(data, "rttMillis"), "rttMillis"),
        })),
        peerIdentified: (data) => Tag("Diagnostic", Tag("PeerIdentified", {
            linkId: linkId(bytesField(data, "linkId")),
            identity: identityHash(bytesField(data, "identity")),
        })),
        request: (data) => {
            const request = {
                destination: destinationHash(bytesField(data, "destination")),
                linkId: linkId(bytesField(data, "linkId")),
                requestId: requestId(bytesField(data, "requestId")),
                pathHash: requestPathHash(bytesField(data, "pathHash")),
                rttMillis: nonNegativeInteger(numberField(data, "rttMillis"), "rttMillis"),
                data: copyBytes(bytesField(data, "data")),
            };
            const requester = optionalBytesField(data, "requester");
            return Tag("Application", Tag("Request", requester
                ? { ...request, requester: identityHash(requester) }
                : request));
        },
        response: (data) => {
            const responseCommandId = commandId(bigintField(data, "commandId"));
            return Tag("CommandResponse", {
                commandId: responseCommandId,
                event: Tag("Response", {
                    linkId: linkId(bytesField(data, "linkId")),
                    requestId: requestId(bytesField(data, "requestId")),
                    data: copyBytes(bytesField(data, "data")),
                }),
            });
        },
        responseSegment: (data) => {
            const responseCommandId = commandId(bigintField(data, "commandId"));
            return Tag("CommandResponseSegment", {
                commandId: responseCommandId,
                event: Tag("ResponseSegment", {
                    linkId: linkId(bytesField(data, "linkId")),
                    requestId: requestId(bytesField(data, "requestId")),
                    segmentIndex: nonNegativeInteger(numberField(data, "segmentIndex"), "segmentIndex"),
                    totalSegments: positiveInteger(numberField(data, "totalSegments"), "totalSegments"),
                    data: copyBytes(bytesField(data, "data")),
                }),
            });
        },
        channelMessage: (data) => Tag("Application", Tag("ChannelMessage", {
            linkId: linkId(bytesField(data, "linkId")),
            messageType: nonNegativeInteger(numberField(data, "messageType"), "messageType"),
            data: copyBytes(bytesField(data, "data")),
        })),
        singleDelivery: (data) => Tag("Application", Tag("SingleDelivery", {
            destination: destinationHash(bytesField(data, "destination")),
            plaintext: copyBytes(bytesField(data, "plaintext")),
            sourceInterface: interfaceId(bytesField(data, "sourceInterface")),
        })),
        linkDelivery: (data) => Tag("Application", Tag("LinkDelivery", {
            linkId: linkId(bytesField(data, "linkId")),
            plaintext: copyBytes(bytesField(data, "plaintext")),
            sourceInterface: interfaceId(bytesField(data, "sourceInterface")),
        })),
        delivered: (data) => Tag("Diagnostic", Tag("Delivered", { detail: stringField(data, "detail") })),
        backendDiagnostic: (data) => Tag("Diagnostic", Tag("BackendDiagnostic", {
            kind: stringField(data, "kind"),
            detail: stringField(data, "detail"),
        })),
        linkClosed: (data) => Tag("Diagnostic", Tag("LinkClosed", {
            linkId: linkId(bytesField(data, "linkId")),
            reason: linkClosedReason(stringField(data, "reason")),
        })),
        linkInterfaceMismatch: (data) => Tag("Diagnostic", Tag("LinkInterfaceMismatch", {
            linkId: linkId(bytesField(data, "linkId")),
            attachedInterface: interfaceId(bytesField(data, "attachedInterface")),
            arrivedOn: interfaceId(bytesField(data, "arrivedOn")),
        })),
        resourceReceived: (data) => {
            const details = {
                linkId: linkId(bytesField(data, "linkId")),
                hash: resourceHash(bytesField(data, "hash")),
                resource: new MemoryResourceStream(bytesField(data, "data")),
            };
            const metadata = optionalBytesField(data, "metadata");
            return Tag("Application", Tag("ResourceAvailable", metadata
                ? { ...details, metadata: copyBytes(metadata) }
                : details));
        },
        resourceFailed: (data) => Tag("Diagnostic", Tag("ResourceFailed", {
            linkId: linkId(bytesField(data, "linkId")),
            hash: resourceHash(bytesField(data, "hash")),
            cause: stringField(data, "cause"),
        })),
        resourceNeedsDecompression: (data) => Tag("Application", Tag("ResourceNeedsDecompression", {
            linkId: linkId(bytesField(data, "linkId")),
            hash: resourceHash(bytesField(data, "hash")),
            stream: copyBytes(bytesField(data, "stream")),
            uncompressedDataBytes: nonNegativeBigIntField(data, "uncompressedDataBytes"),
        })),
        resourceSegment: (data) => {
            const details = {
                linkId: linkId(bytesField(data, "linkId")),
                originalHash: resourceHash(bytesField(data, "originalHash")),
                segmentIndex: nonNegativeInteger(numberField(data, "segmentIndex"), "segmentIndex"),
                totalSegments: positiveInteger(numberField(data, "totalSegments"), "totalSegments"),
                data: copyBytes(bytesField(data, "data")),
            };
            const metadata = optionalBytesField(data, "metadata");
            return Tag("Application", Tag("ResourceSegment", metadata
                ? { ...details, metadata: copyBytes(metadata) }
                : details));
        },
        resourceAssembled: (data) => Tag("Diagnostic", Tag("ResourceAssembled", {
            linkId: linkId(bytesField(data, "linkId")),
            originalHash: resourceHash(bytesField(data, "originalHash")),
            totalSizeBytes: nonNegativeBigIntField(data, "totalSizeBytes"),
        })),
        routeExpired: (data) => Tag("Diagnostic", Tag("RouteExpired", {
            destination: destinationHash(bytesField(data, "destination")),
        })),
        routeEvicted: (data) => Tag("Diagnostic", Tag("RouteEvicted", {
            destination: destinationHash(bytesField(data, "destination")),
        })),
        routeInterfaceGone: (data) => Tag("Diagnostic", Tag("RouteInterfaceGone", {
            destination: destinationHash(bytesField(data, "destination")),
        })),
        routeDropped: (data) => Tag("Diagnostic", Tag("RouteDropped", {
            destination: destinationHash(bytesField(data, "destination")),
        })),
        persistenceFlushed: (data) => Tag("Diagnostic", Tag("PersistenceFlushed", {
            cause: persistenceCause(stringField(data, "cause")),
            target: persistenceTarget(stringField(data, "target")),
        })),
        persistenceFlushFailed: (data) => Tag("Diagnostic", Tag("PersistenceFlushFailed", {
            cause: persistenceCause(stringField(data, "cause")),
            target: persistenceTarget(stringField(data, "target")),
        })),
    });
}
function rawProjectedEvent(event) {
    const raw = projectedEventFields(event);
    switch (event.kind) {
        case APPLICATION_EVENT_KIND_CODES.SingleDelivery:
            return { type: "singleDelivery", ...raw };
        case APPLICATION_EVENT_KIND_CODES.Request:
            return { type: "request", ...raw };
        case APPLICATION_EVENT_KIND_CODES.Response:
            return { type: "response", ...raw };
        case APPLICATION_EVENT_KIND_CODES.ResponseSegment:
            return { type: "responseSegment", ...raw };
        case APPLICATION_EVENT_KIND_CODES.ResourceAvailable:
            return { type: "resourceReceived", ...raw };
        case APPLICATION_EVENT_KIND_CODES.ResourceSegment:
            return { type: "resourceSegment", ...raw };
        case APPLICATION_EVENT_KIND_CODES.ResourceNeedsDecompression:
            return { type: "resourceNeedsDecompression", ...raw };
        case APPLICATION_EVENT_KIND_CODES.ChannelMessage:
            return { type: "channelMessage", ...raw };
        case APPLICATION_EVENT_KIND_CODES.LinkDelivery:
            return { type: "linkDelivery", ...raw };
        case DIAGNOSTIC_EVENT_KIND_CODES.AnnounceHeard:
            return { type: "announce", ...raw };
        case DIAGNOSTIC_EVENT_KIND_CODES.LinkEstablished:
            return { type: "linkEstablished", ...raw };
        case DIAGNOSTIC_EVENT_KIND_CODES.PeerIdentified:
            return { type: "peerIdentified", ...raw };
        case DIAGNOSTIC_EVENT_KIND_CODES.LinkClosed:
            return { type: "linkClosed", ...raw };
        case DIAGNOSTIC_EVENT_KIND_CODES.LinkInterfaceMismatch:
            return { type: "linkInterfaceMismatch", ...raw };
        case DIAGNOSTIC_EVENT_KIND_CODES.ResourceAssembled:
            return { type: "resourceAssembled", ...raw };
        case DIAGNOSTIC_EVENT_KIND_CODES.ResourceFailed:
            return { type: "resourceFailed", ...raw };
        case DIAGNOSTIC_EVENT_KIND_CODES.SelfRatchetRotated:
            return { type: "selfRatchetRotated", ...raw };
        case DIAGNOSTIC_EVENT_KIND_CODES.AnnounceHeldDropped:
            return { type: "announceHeldDropped", ...raw };
        case DIAGNOSTIC_EVENT_KIND_CODES.Delivered:
            return { type: "delivered", ...raw };
        case DIAGNOSTIC_EVENT_KIND_CODES.BackendDiagnostic:
            return { type: "backendDiagnostic", ...raw };
        case DIAGNOSTIC_EVENT_KIND_CODES.RouteExpired:
            return { type: "routeExpired", ...raw };
        case DIAGNOSTIC_EVENT_KIND_CODES.RouteEvicted:
            return { type: "routeEvicted", ...raw };
        case DIAGNOSTIC_EVENT_KIND_CODES.RouteInterfaceGone:
            return { type: "routeInterfaceGone", ...raw };
        case DIAGNOSTIC_EVENT_KIND_CODES.RouteDropped:
            return { type: "routeDropped", ...raw };
        case DIAGNOSTIC_EVENT_KIND_CODES.PersistenceFlushed:
            return { type: "persistenceFlushed", ...raw };
        case DIAGNOSTIC_EVENT_KIND_CODES.PersistenceFlushFailed:
            return { type: "persistenceFlushFailed", ...raw };
        default:
            throw new PrnsValidationError("invalid-component", `runtime emitted projected event kind outside host contract: ${event.kind}`);
    }
}
function projectedEventFields(event) {
    const fields = {};
    for (const [id, value] of event.fields) {
        const name = projectedFieldName(id);
        fields[name] = projectedFieldValue(name, value);
    }
    return fields;
}
function projectedFieldName(id) {
    switch (id) {
        case EVENT_FIELD_CODES.Destination:
            return "destination";
        case EVENT_FIELD_CODES.SourceInterface:
            return "sourceInterface";
        case EVENT_FIELD_CODES.Plaintext:
            return "plaintext";
        case EVENT_FIELD_CODES.LinkId:
            return "linkId";
        case EVENT_FIELD_CODES.RequestId:
            return "requestId";
        case EVENT_FIELD_CODES.Requester:
            return "requester";
        case EVENT_FIELD_CODES.PathHash:
            return "pathHash";
        case EVENT_FIELD_CODES.RttMillis:
            return "rttMillis";
        case EVENT_FIELD_CODES.Data:
            return "data";
        case EVENT_FIELD_CODES.SegmentIndex:
            return "segmentIndex";
        case EVENT_FIELD_CODES.TotalSegments:
            return "totalSegments";
        case EVENT_FIELD_CODES.Hash:
            return "hash";
        case EVENT_FIELD_CODES.OriginalHash:
            return "originalHash";
        case EVENT_FIELD_CODES.Metadata:
            return "metadata";
        case EVENT_FIELD_CODES.UncompressedDataBytes:
            return "uncompressedDataBytes";
        case EVENT_FIELD_CODES.MessageType:
            return "messageType";
        case EVENT_FIELD_CODES.Identity:
            return "identity";
        case EVENT_FIELD_CODES.Reason:
            return "reason";
        case EVENT_FIELD_CODES.AttachedInterface:
            return "attachedInterface";
        case EVENT_FIELD_CODES.ArrivedOn:
            return "arrivedOn";
        case EVENT_FIELD_CODES.TotalSizeBytes:
            return "totalSizeBytes";
        case EVENT_FIELD_CODES.Cause:
            return "cause";
        case EVENT_FIELD_CODES.Detail:
            return "detail";
        case EVENT_FIELD_CODES.Kind:
            return "kind";
        case EVENT_FIELD_CODES.Hops:
            return "hops";
        case EVENT_FIELD_CODES.Stream:
            return "stream";
        case EVENT_FIELD_CODES.PersistenceCause:
            return "cause";
        case EVENT_FIELD_CODES.PersistenceTarget:
            return "target";
        case EVENT_FIELD_CODES.AppData:
            return "appData";
        case COMMAND_ID_PROJECTION_FIELD:
            return "commandId";
        default:
            throw new PrnsValidationError("invalid-component", `runtime emitted projected field outside host contract: ${id}`);
    }
}
function projectedFieldValue(name, value) {
    if (typeof value !== "bigint" ||
        name === "commandId" ||
        name === "uncompressedDataBytes" ||
        name === "totalSizeBytes") {
        return value;
    }
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new PrnsValidationError("invalid-number", `runtime emitted ${name} outside JavaScript's safe integer range`);
    }
    return Number(value);
}
function rawEventType(value) {
    if (!RAW_EVENT_TYPES.has(value)) {
        throw new PrnsValidationError("invalid-component", `runtime emitted event outside host contract: ${value}`);
    }
    return value;
}
function linkClosedReason(value) {
    if (!RAW_LINK_CLOSED_REASONS.has(value)) {
        throw new PrnsValidationError("invalid-component", `unknown link close reason ${value}`);
    }
    return match(value, {
        timeout: () => "Timeout",
        peerClosed: () => "PeerClosed",
        malformedRtt: () => "MalformedRtt",
        locallyClosed: () => "LocallyClosed",
    });
}
function exactBytesAsSafeNumber(value, name) {
    if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new PrnsValidationError("invalid-number", `${name} exceeds the JavaScript safe-integer limit`);
    }
    return Number(value);
}
function persistenceCause(value) {
    switch (value) {
        case "startup":
            return "Startup";
        case "interval":
            return "Interval";
        case "route_change":
            return "RouteChange";
        case "ratchet_rotation":
            return "RatchetRotation";
        case "shutdown":
            return "Shutdown";
        default:
            throw new PrnsValidationError("invalid-component", `unknown persistence flush cause ${value}`);
    }
}
function persistenceTarget(value) {
    switch (value) {
        case "routing_state":
            return "RoutingState";
        case "ratchets":
            return "Ratchets";
        default:
            throw new PrnsValidationError("invalid-component", `unknown persistence flush target ${value}`);
    }
}
