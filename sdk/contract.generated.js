export const HOST_CONTRACT_ABI = 1;
export const HOST_SCHEMA_VERSION = 1;
export const PRODUCT_VERSION = "0.3.8";
export const DESTINATION_HASH_LENGTH = 16;
export const IDENTITY_HASH_LENGTH = 16;
export const INTERFACE_ID_LENGTH = 8;
export const LINK_ID_LENGTH = 16;
export const PACKET_HASH_LENGTH = 32;
export const REQUEST_ID_LENGTH = 16;
export const REQUEST_PATH_HASH_LENGTH = 16;
export const RESOURCE_HASH_LENGTH = 32;
export const IDENTITY_SECRET_LENGTH = 64;
export const SAFE_INT_MIN = -9007199254740991;
export const SAFE_INT_MAX = 9007199254740991;
export const SAFE_UINT_MAX = 9007199254740991;
export const CAPABILITY_NAME_VALUES = Object.freeze([
    "Loopback",
    "TcpClient",
    "TcpServer",
    "Udp",
    "Serial",
    "Usb",
    "Bluetooth",
    "Wifi",
    "WebSocket",
    "BrowserRendezvous",
    "I2p",
    "Weave",
    "SuppliedPipe",
]);
export function isCapabilityName(value) {
    return typeof value === "string" && CAPABILITY_NAME_VALUES.includes(value);
}
export const LINK_CLOSED_REASON_VALUES = Object.freeze([
    "Timeout",
    "PeerClosed",
    "MalformedRtt",
    "LocallyClosed",
]);
export function isLinkClosedReason(value) {
    return typeof value === "string" && LINK_CLOSED_REASON_VALUES.includes(value);
}
export const HOST_ROLE_NAME_VALUES = Object.freeze([
    "Endpoint",
    "Transport",
]);
export function isHostRoleName(value) {
    return typeof value === "string" && HOST_ROLE_NAME_VALUES.includes(value);
}
export const DELIVERY_EVIDENCE_KIND_VALUES = Object.freeze([
    "ExplicitProof",
    "ImplicitProof",
    "Response",
]);
export function isDeliveryEvidenceKind(value) {
    return typeof value === "string" && DELIVERY_EVIDENCE_KIND_VALUES.includes(value);
}
export const REQUEST_POLICY_VALUES = Object.freeze([
    "AllowNone",
    "AllowAll",
    "AllowList",
]);
export function isRequestPolicy(value) {
    return typeof value === "string" && REQUEST_POLICY_VALUES.includes(value);
}
export const PERSISTENCE_FLUSH_CAUSE_VALUES = Object.freeze([
    "Startup",
    "Interval",
    "RouteChange",
    "RatchetRotation",
    "Shutdown",
]);
export function isPersistenceFlushCause(value) {
    return typeof value === "string" && PERSISTENCE_FLUSH_CAUSE_VALUES.includes(value);
}
export const PERSISTENCE_FLUSH_TARGET_VALUES = Object.freeze([
    "RoutingState",
    "Ratchets",
]);
export function isPersistenceFlushTarget(value) {
    return typeof value === "string" && PERSISTENCE_FLUSH_TARGET_VALUES.includes(value);
}
export function balancedLimits() {
    return {
        pendingCommands: 256,
        applicationEvents: 1024,
        retainedEventBytes: 8388608,
        diagnostics: 1024,
    };
}
export const BACKEND_KIND_VALUES = Object.freeze([
    "Native",
    "Browser",
    "Cooperative",
]);
export function isBackendKind(value) {
    return typeof value === "string" && BACKEND_KIND_VALUES.includes(value);
}
export const INTERFACE_KIND_VALUES = Object.freeze([
    "AutoLan",
    "TcpClient",
    "TcpServer",
    "Udp",
    "Serial",
    "Kiss",
    "Ax25Kiss",
    "RNode",
    "MultiRNode",
    "Pipe",
    "BackboneClient",
    "BackboneServer",
    "I2p",
    "Weave",
    "AutomaticUsb",
    "AutomaticBluetoothLe",
    "WebSocketClient",
    "WebSocketServer",
    "BrowserRendezvous",
]);
export function isInterfaceKind(value) {
    return typeof value === "string" && INTERFACE_KIND_VALUES.includes(value);
}
export const INTERFACE_MODE_VALUES = Object.freeze([
    "Full",
    "PointToPoint",
    "AccessPoint",
    "Roaming",
    "Boundary",
    "Gateway",
    "Internal",
]);
export function isInterfaceMode(value) {
    return typeof value === "string" && INTERFACE_MODE_VALUES.includes(value);
}
export const WEB_SOCKET_FRAMING_SELECTION_VALUES = Object.freeze([
    "RawPacket",
    "Hdlc",
    "Kiss",
    "Auto",
]);
export function isWebSocketFramingSelection(value) {
    return typeof value === "string" && WEB_SOCKET_FRAMING_SELECTION_VALUES.includes(value);
}
export const INTERFACE_HEALTH_VALUES = Object.freeze([
    "Initializing",
    "Connected",
    "Degraded",
    "Reconnecting",
    "Failed",
    "Disconnected",
    "Disabled",
    "Unknown",
]);
export function isInterfaceHealth(value) {
    return typeof value === "string" && INTERFACE_HEALTH_VALUES.includes(value);
}
export const DISCOVERY_SCOPE_VALUES = Object.freeze([
    "Link",
    "Admin",
    "Site",
    "Organization",
    "Global",
]);
export function isDiscoveryScope(value) {
    return typeof value === "string" && DISCOVERY_SCOPE_VALUES.includes(value);
}
export const MULTICAST_ADDRESS_TYPE_VALUES = Object.freeze([
    "Temporary",
    "Permanent",
]);
export function isMulticastAddressType(value) {
    return typeof value === "string" && MULTICAST_ADDRESS_TYPE_VALUES.includes(value);
}
export const SERIAL_DATA_BITS_VALUES = Object.freeze([
    "Five",
    "Six",
    "Seven",
    "Eight",
]);
export function isSerialDataBits(value) {
    return typeof value === "string" && SERIAL_DATA_BITS_VALUES.includes(value);
}
export const SERIAL_PARITY_VALUES = Object.freeze([
    "None",
    "Even",
    "Odd",
]);
export function isSerialParity(value) {
    return typeof value === "string" && SERIAL_PARITY_VALUES.includes(value);
}
export const SERIAL_STOP_BITS_VALUES = Object.freeze([
    "One",
    "Two",
]);
export function isSerialStopBits(value) {
    return typeof value === "string" && SERIAL_STOP_BITS_VALUES.includes(value);
}
export const APPLICATION_EVENT_KIND_CODES = Object.freeze({
    SingleDelivery: 100,
    Request: 101,
    Response: 102,
    ResponseSegment: 103,
    ResourceAvailable: 104,
    ResourceSegment: 105,
    ResourceNeedsDecompression: 106,
    ChannelMessage: 107,
    LinkDelivery: 108,
});
export const DIAGNOSTIC_EVENT_KIND_CODES = Object.freeze({
    AnnounceHeard: 200,
    LinkEstablished: 201,
    PeerIdentified: 202,
    LinkClosed: 203,
    LinkInterfaceMismatch: 204,
    ResourceAssembled: 205,
    ResourceFailed: 206,
    ResourceSendProgress: 207,
    SelfRatchetRotated: 208,
    AnnounceHeldDropped: 209,
    Delivered: 210,
    RouteExpired: 211,
    RouteEvicted: 212,
    RouteInterfaceGone: 213,
    RouteDropped: 214,
    BackendDiagnostic: 215,
    DiagnosticsDropped: 216,
    PersistenceRestored: 217,
    PersistenceFlushed: 218,
    PersistenceFlushFailed: 219,
});
export const EVENT_FIELD_CODES = Object.freeze({
    Destination: 1,
    SourceInterface: 2,
    Plaintext: 3,
    LinkId: 4,
    RequestId: 5,
    Requester: 6,
    PathHash: 7,
    RttMillis: 8,
    Data: 9,
    SegmentIndex: 10,
    TotalSegments: 11,
    Hash: 12,
    OriginalHash: 13,
    Metadata: 14,
    TotalBytes: 15,
    StreamId: 16,
    UncompressedDataBytes: 17,
    MessageType: 18,
    Identity: 19,
    Reason: 20,
    AttachedInterface: 21,
    ArrivedOn: 22,
    TotalSizeBytes: 23,
    Cause: 24,
    TransferredBytes: 25,
    PhysicalTransferredBytes: 26,
    Detail: 27,
    Kind: 28,
    DroppedCount: 29,
    Hops: 30,
    Stream: 31,
    Routes: 32,
    DestinationIdentities: 33,
    Tunnels: 34,
    Ratchets: 35,
    Refused: 36,
    Dropped: 37,
    PersistenceCause: 38,
    PersistenceTarget: 39,
    AppData: 40,
});
export const COMMAND_OUTCOME_KIND_CODES = Object.freeze({
    Announced: 1,
    PacketDelivered: 2,
    LinkCloseQueued: 3,
    InterfaceAttached: 4,
    InterfaceDetached: 5,
    LinkEstablished: 6,
    PathDiscovered: 7,
    Identified: 8,
    ResponseReceived: 9,
    ResponseSent: 10,
    ResourceSent: 11,
    ResourceStrategySet: 12,
    RequesterAllowed: 13,
});
export const COMMAND_FAILURE_KIND_CODES = Object.freeze({
    NodeStopped: 1,
    Busy: 2,
    PayloadTooLarge: 3,
    UnknownDestination: 4,
    NotSingleDestination: 5,
    AnnounceAppDataTooLong: 6,
    UnknownInterface: 7,
    NoRouteToDestination: 8,
    NotDirectlyReachable: 9,
    PacketCulled: 10,
    DeliveryTimedOut: 11,
    InvalidBitrate: 12,
    BindFailed: 13,
    WriteFailed: 14,
    UnsupportedByBackend: 15,
    UnknownLink: 16,
    LinkNotActive: 17,
    EntropyUnavailable: 18,
    NotLinkInitiator: 19,
    IdentityNotHeld: 20,
    UnknownRequestHandler: 21,
    RequestPolicyNotAllowList: 22,
    RequestAllowListFull: 23,
    LinkBusy: 24,
    ResourceTableFull: 25,
    ResourceMetadataTooLarge: 26,
    ResourceRejectedByPeer: 27,
    ResourceSequencingFailed: 28,
    ResourcePredecessorFailed: 29,
    ChannelWindowFull: 30,
    ChannelUntrackable: 31,
    InvalidChannelMessageType: 32,
    InvalidConfiguration: 33,
    ResourceUploadCancelled: 34,
    ResourceEarlyEof: 35,
    ResourceLengthOverrun: 36,
    PermissionDenied: 37,
    DeviceUnavailable: 38,
    ConnectFailed: 39,
    BackendFailed: 40,
    ResponseTooLarge: 41,
    LinkClosed: 42,
    ResponseCancelledBySender: 43,
    ResponseHashmapBeyondPartCount: 44,
    ResponseHashmapSkipsAhead: 45,
    ResponseHashmapTooLong: 46,
    ResponseHashmapRagged: 47,
    ResponseRetriesExhausted: 48,
    ResponseLinkVanished: 49,
    ResponseTransferUnopenable: 50,
    ResponseTransferCorrupt: 51,
    ResponseProofUnsendable: 52,
    ResponseDecompressionFailed: 53,
    ResponseDecompressionTimedOut: 54,
    ResponseOpenTimedOut: 55,
    ResponseMetadataOverrun: 56,
});
export const DELIVERY_EVIDENCE_KIND_CODES = Object.freeze({
    ExplicitProof: 1,
    ImplicitProof: 2,
    Response: 3,
});
const HOST_OPERATION_NAMES = [
    "contractInfo",
    "backendInfo",
    "hostCreate",
    "hostRelease",
    "hostLifecycle",
    "hostSnapshot",
    "hostSnapshotRead",
    "hostSnapshotRelease",
    "hostIdentityHash",
    "hostDestinationCount",
    "hostDestinationHash",
    "hostAttachSuppliedPipe",
    "suppliedPipeClaimAttachment",
    "suppliedPipeNextOpenRequest",
    "suppliedPipeRegisterReadiness",
    "suppliedPipeInterruptWait",
    "suppliedPipeRelease",
    "suppliedPipeOpenRequestProvide",
    "suppliedPipeOpenRequestDecline",
    "suppliedPipeOpenRequestRelease",
    "hostBeginResourceUpload",
    "resourceUploadWrite",
    "resourceUploadIsWritable",
    "resourceUploadFinish",
    "resourceUploadAbort",
    "resourceUploadRelease",
    "hostStop",
    "commandWait",
    "commandRegisterReadiness",
    "commandInterruptWait",
    "commandRelease",
    "hostClaimApplicationEvents",
    "hostClaimDiagnostics",
    "eventStreamRegisterReadiness",
    "readinessRegistrationRelease",
    "eventStreamInterruptWait",
    "eventStreamRelease",
    "eventStreamNext",
    "eventRelease",
    "eventKind",
    "eventBytes",
    "eventString",
    "eventU64",
    "eventU128",
    "eventResourceStream",
    "resourceStreamRelease",
    "resourceStreamNext",
    "hostAnnounce",
    "hostSendSinglePacket",
    "hostCloseLink",
    "hostAttachTcpServer",
    "hostAttachTcpClient",
    "hostAttachUdp",
    "hostDetachInterface",
    "hostEstablishLink",
    "hostRequestPath",
    "hostIdentify",
    "hostSendLinkPacket",
    "hostRequest",
    "hostRespond",
    "hostSendResource",
    "hostSetLinkResourceStrategy",
    "hostSetDestinationResourceStrategy",
    "hostSendChannelMessage",
    "hostAllowRequester",
    "hostAttachInterface",
];
