/* @ts-self-types="./prns_wasm.d.ts" */

export class BluetoothReassembler {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        BluetoothReassemblerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_bluetoothreassembler_free(ptr, 0);
    }
    /**
     * @param {Uint8Array} bytes
     * @returns {Uint8Array | undefined}
     */
    absorb(bytes) {
        const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.bluetoothreassembler_absorb(this.__wbg_ptr, ptr0, len0);
        let v2;
        if (ret[0] !== 0) {
            v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
    }
    constructor() {
        const ret = wasm.bluetoothreassembler_new();
        this.__wbg_ptr = ret;
        BluetoothReassemblerFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) BluetoothReassembler.prototype[Symbol.dispose] = BluetoothReassembler.prototype.free;

export class PrnsRuntime {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PrnsRuntimeFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_prnsruntime_free(ptr, 0);
    }
    /**
     * @param {any} options
     * @returns {bigint}
     */
    allowRequester(options) {
        const ret = wasm.prnsruntime_allowRequester(this.__wbg_ptr, options);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return BigInt.asUintN(64, ret[0]);
    }
    /**
     * @param {any} options
     * @returns {bigint}
     */
    announce(options) {
        const ret = wasm.prnsruntime_announce(this.__wbg_ptr, options);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return BigInt.asUintN(64, ret[0]);
    }
    /**
     * @returns {Uint8Array}
     */
    bluetoothIdentity() {
        const ret = wasm.prnsruntime_bluetoothIdentity(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @param {any} options
     * @returns {bigint}
     */
    closeLink(options) {
        const ret = wasm.prnsruntime_closeLink(this.__wbg_ptr, options);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return BigInt.asUintN(64, ret[0]);
    }
    /**
     * @param {any} options
     * @returns {any}
     */
    completeBrowserWork(options) {
        const ret = wasm.prnsruntime_completeBrowserWork(this.__wbg_ptr, options);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {string} execution
     */
    configureBrowserWork(execution) {
        const ptr0 = passStringToWasm0(execution, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.prnsruntime_configureBrowserWork(this.__wbg_ptr, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @returns {Uint8Array}
     */
    drainCommandSettlementBatch() {
        const ret = wasm.prnsruntime_drainCommandSettlementBatch(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {Uint8Array}
     */
    drainEventBatch() {
        const ret = wasm.prnsruntime_drainEventBatch(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {Array<any>}
     */
    drainEvents() {
        const ret = wasm.prnsruntime_drainEvents(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Array<any>}
     */
    drainOutbound() {
        const ret = wasm.prnsruntime_drainOutbound(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Uint8Array}
     */
    drainOutboundBatch() {
        const ret = wasm.prnsruntime_drainOutboundBatch(this.__wbg_ptr);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @param {any} options
     * @returns {bigint}
     */
    establishLink(options) {
        const ret = wasm.prnsruntime_establishLink(this.__wbg_ptr, options);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return BigInt.asUintN(64, ret[0]);
    }
    /**
     * @param {any} options
     * @returns {bigint}
     */
    identify(options) {
        const ret = wasm.prnsruntime_identify(this.__wbg_ptr, options);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return BigInt.asUintN(64, ret[0]);
    }
    /**
     * @param {any} options
     */
    ingest(options) {
        const ret = wasm.prnsruntime_ingest(this.__wbg_ptr, options);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {Uint8Array} interface_id
     * @param {Uint8Array} bytes
     * @param {number} now_ms
     * @param {Uint8Array} entropy
     */
    ingestDirect(interface_id, bytes, now_ms, entropy) {
        const ptr0 = passArray8ToWasm0(interface_id, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(entropy, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.prnsruntime_ingestDirect(this.__wbg_ptr, ptr0, len0, ptr1, len1, now_ms, ptr2, len2);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * @param {Uint8Array} identity_secret_key
     * @param {Uint8Array | null} [ble_identity]
     */
    constructor(identity_secret_key, ble_identity) {
        const ptr0 = passArray8ToWasm0(identity_secret_key, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(ble_identity) ? 0 : passArray8ToWasm0(ble_identity, wasm.__wbindgen_malloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.prnsruntime_new(ptr0, len0, ptr1, len1);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        PrnsRuntimeFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @param {any} options
     * @returns {any}
     */
    persistedState(options) {
        const ret = wasm.prnsruntime_persistedState(this.__wbg_ptr, options);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {any} request
     * @returns {any}
     */
    projectionSnapshot(request) {
        const ret = wasm.prnsruntime_projectionSnapshot(this.__wbg_ptr, request);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {any} options
     * @returns {Uint8Array}
     */
    registerInterface(options) {
        const ret = wasm.prnsruntime_registerInterface(this.__wbg_ptr, options);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @param {any} options
     * @returns {Uint8Array}
     */
    registerNodePage(options) {
        const ret = wasm.prnsruntime_registerNodePage(this.__wbg_ptr, options);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @param {any} options
     * @returns {Uint8Array}
     */
    registerSingleDestination(options) {
        const ret = wasm.prnsruntime_registerSingleDestination(this.__wbg_ptr, options);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @param {any} options
     * @returns {boolean}
     */
    removeInterface(options) {
        const ret = wasm.prnsruntime_removeInterface(this.__wbg_ptr, options);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * @param {any} options
     * @returns {bigint}
     */
    request(options) {
        const ret = wasm.prnsruntime_request(this.__wbg_ptr, options);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return BigInt.asUintN(64, ret[0]);
    }
    /**
     * @param {any} options
     * @returns {bigint}
     */
    requestPath(options) {
        const ret = wasm.prnsruntime_requestPath(this.__wbg_ptr, options);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return BigInt.asUintN(64, ret[0]);
    }
    /**
     * @param {any} options
     * @returns {any}
     */
    resourceSegmentPlan(options) {
        const ret = wasm.prnsruntime_resourceSegmentPlan(this.__wbg_ptr, options);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {any} options
     * @returns {bigint}
     */
    respond(options) {
        const ret = wasm.prnsruntime_respond(this.__wbg_ptr, options);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return BigInt.asUintN(64, ret[0]);
    }
    /**
     * @param {any} options
     * @returns {any}
     */
    restorePersistedState(options) {
        const ret = wasm.prnsruntime_restorePersistedState(this.__wbg_ptr, options);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {any} options
     * @returns {bigint}
     */
    sendChannelMessage(options) {
        const ret = wasm.prnsruntime_sendChannelMessage(this.__wbg_ptr, options);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return BigInt.asUintN(64, ret[0]);
    }
    /**
     * @param {any} options
     * @returns {bigint}
     */
    sendLinkPacket(options) {
        const ret = wasm.prnsruntime_sendLinkPacket(this.__wbg_ptr, options);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return BigInt.asUintN(64, ret[0]);
    }
    /**
     * @param {Uint8Array} link_id
     * @param {Uint8Array} payload
     * @param {number} now_ms
     * @param {Uint8Array} entropy
     * @returns {bigint}
     */
    sendLinkPacketDirect(link_id, payload, now_ms, entropy) {
        const ptr0 = passArray8ToWasm0(link_id, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(payload, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArray8ToWasm0(entropy, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.prnsruntime_sendLinkPacketDirect(this.__wbg_ptr, ptr0, len0, ptr1, len1, now_ms, ptr2, len2);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return BigInt.asUintN(64, ret[0]);
    }
    /**
     * @param {any} options
     * @returns {bigint}
     */
    sendResourceSegment(options) {
        const ret = wasm.prnsruntime_sendResourceSegment(this.__wbg_ptr, options);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return BigInt.asUintN(64, ret[0]);
    }
    /**
     * @param {any} options
     * @returns {bigint}
     */
    sendSinglePacket(options) {
        const ret = wasm.prnsruntime_sendSinglePacket(this.__wbg_ptr, options);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return BigInt.asUintN(64, ret[0]);
    }
    /**
     * @param {any} options
     * @returns {boolean}
     */
    setDestinationResourceStrategy(options) {
        const ret = wasm.prnsruntime_setDestinationResourceStrategy(this.__wbg_ptr, options);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * @param {any} options
     * @returns {bigint}
     */
    setLinkResourceStrategy(options) {
        const ret = wasm.prnsruntime_setLinkResourceStrategy(this.__wbg_ptr, options);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return BigInt.asUintN(64, ret[0]);
    }
    /**
     * @returns {any}
     */
    snapshot() {
        const ret = wasm.prnsruntime_snapshot(this.__wbg_ptr);
        return ret;
    }
    /**
     * @returns {Uint8Array}
     */
    snapshotPacked() {
        const ret = wasm.prnsruntime_snapshotPacked(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * @returns {any}
     */
    takeBrowserWork() {
        const ret = wasm.prnsruntime_takeBrowserWork(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) PrnsRuntime.prototype[Symbol.dispose] = PrnsRuntime.prototype.free;

export class UsbAutoDecoder {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        UsbAutoDecoderFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_usbautodecoder_free(ptr, 0);
    }
    /**
     * @param {Uint8Array} chunk
     * @returns {Array<any>}
     */
    feed(chunk) {
        const ptr0 = passArray8ToWasm0(chunk, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.usbautodecoder_feed(this.__wbg_ptr, ptr0, len0);
        return ret;
    }
    constructor() {
        const ret = wasm.usbautodecoder_new();
        this.__wbg_ptr = ret;
        UsbAutoDecoderFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
}
if (Symbol.dispose) UsbAutoDecoder.prototype[Symbol.dispose] = UsbAutoDecoder.prototype.free;

export class WebSocketFramingCodec {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WebSocketFramingCodecFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_websocketframingcodec_free(ptr, 0);
    }
    /**
     * @returns {boolean}
     */
    canPassRawInbound() {
        const ret = wasm.websocketframingcodec_canPassRawInbound(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    canPassRawOutbound() {
        const ret = wasm.websocketframingcodec_canPassRawOutbound(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    canReadOutbound() {
        const ret = wasm.websocketframingcodec_canReadOutbound(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    canStageMultipleOutbound() {
        const ret = wasm.websocketframingcodec_canStageMultipleOutbound(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @param {Uint8Array} message
     * @returns {any}
     */
    decode(message) {
        const ptr0 = passArray8ToWasm0(message, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.websocketframingcodec_decode(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * @param {Uint8Array} message
     * @returns {Uint8Array}
     */
    decodePacked(message) {
        const ptr0 = passArray8ToWasm0(message, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.websocketframingcodec_decodePacked(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v2;
    }
    /**
     * @returns {boolean}
     */
    isDetecting() {
        const ret = wasm.websocketframingcodec_isDetecting(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    messageCap() {
        const ret = wasm.websocketframingcodec_messageCap(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @param {string} selection
     */
    constructor(selection) {
        const ptr0 = passStringToWasm0(selection, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.websocketframingcodec_new(ptr0, len0);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        WebSocketFramingCodecFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {number}
     */
    rawFallbackDelayMillis() {
        const ret = wasm.websocketframingcodec_rawFallbackDelayMillis(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {boolean}
     */
    rawFallbackIsArmed() {
        const ret = wasm.websocketframingcodec_rawFallbackIsArmed(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {Uint8Array | undefined}
     */
    releaseRawFallback() {
        const ret = wasm.websocketframingcodec_releaseRawFallback(this.__wbg_ptr);
        let v1;
        if (ret[0] !== 0) {
            v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
    }
    /**
     * @param {Uint8Array} packet
     * @returns {Uint8Array | undefined}
     */
    stageOutbound(packet) {
        const ptr0 = passArray8ToWasm0(packet, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.websocketframingcodec_stageOutbound(this.__wbg_ptr, ptr0, len0);
        if (ret[3]) {
            throw takeFromExternrefTable0(ret[2]);
        }
        let v2;
        if (ret[0] !== 0) {
            v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
            wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v2;
    }
}
if (Symbol.dispose) WebSocketFramingCodec.prototype[Symbol.dispose] = WebSocketFramingCodec.prototype.free;

/**
 * @returns {number}
 */
export function bluetoothBitrateBps() {
    const ret = wasm.bluetoothBitrateBps();
    return ret >>> 0;
}

/**
 * @returns {string}
 */
export function bluetoothControlUuid() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.bluetoothControlUuid();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * @param {Uint8Array} packet
 * @returns {Array<any>}
 */
export function bluetoothDataFragments(packet) {
    const ptr0 = passArray8ToWasm0(packet, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.bluetoothDataFragments(ptr0, len0);
    return ret;
}

/**
 * @returns {string}
 */
export function bluetoothDataUuid() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.bluetoothDataUuid();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * @param {Uint8Array} bytes
 * @returns {any}
 */
export function bluetoothDecodeControl(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.bluetoothDecodeControl(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * @param {Uint8Array} identity
 * @returns {Uint8Array}
 */
export function bluetoothDialerHello(identity) {
    const ptr0 = passArray8ToWasm0(identity, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.bluetoothDialerHello(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @returns {number}
 */
export function bluetoothHardwareMtu() {
    const ret = wasm.bluetoothHardwareMtu();
    return ret >>> 0;
}

/**
 * @returns {string}
 */
export function bluetoothServiceUuid() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.bluetoothServiceUuid();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * @returns {number}
 */
export function browserPersistenceVersion() {
    const ret = wasm.browserPersistenceVersion();
    return ret >>> 0;
}

/**
 * @param {any} options
 * @returns {Uint8Array | undefined}
 */
export function compressResourceCandidate(options) {
    const ret = wasm.compressResourceCandidate(options);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v1;
    if (ret[0] !== 0) {
        v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
}

/**
 * @returns {number}
 */
export function destinationHashLength() {
    const ret = wasm.destinationHashLength();
    return ret >>> 0;
}

/**
 * @returns {number}
 */
export function hostContractAbi() {
    const ret = wasm.hostContractAbi();
    return ret >>> 0;
}

/**
 * @returns {number}
 */
export function hostSchemaVersion() {
    const ret = wasm.hostSchemaVersion();
    return ret >>> 0;
}

/**
 * @returns {number}
 */
export function identitySecretKeyLength() {
    const ret = wasm.identitySecretKeyLength();
    return ret >>> 0;
}

/**
 * @returns {number}
 */
export function interfaceIdLength() {
    const ret = wasm.interfaceIdLength();
    return ret >>> 0;
}

/**
 * @param {Uint8Array} public_key
 * @param {Uint8Array} message
 * @param {Uint8Array} signature
 * @returns {boolean}
 */
export function portableEd25519Verify(public_key, message, signature) {
    const ptr0 = passArray8ToWasm0(public_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(message, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(signature, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.portableEd25519Verify(ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * @param {Uint8Array} public_key
 * @param {Uint8Array} message
 * @param {Uint8Array} signature
 * @param {Uint8Array} secret_scalar
 * @param {Uint8Array} peer_public_key
 * @returns {Uint8Array | undefined}
 */
export function portableLinkProofVerify(public_key, message, signature, secret_scalar, peer_public_key) {
    const ptr0 = passArray8ToWasm0(public_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(message, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(signature, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(secret_scalar, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passArray8ToWasm0(peer_public_key, wasm.__wbindgen_malloc);
    const len4 = WASM_VECTOR_LEN;
    const ret = wasm.portableLinkProofVerify(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v6;
    if (ret[0] !== 0) {
        v6 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v6;
}

/**
 * @returns {string}
 */
export function productVersion() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.productVersion();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * @param {number} iterations
 * @returns {number}
 */
export function profileEd25519Sign(iterations) {
    const ret = wasm.profileEd25519Sign(iterations);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @returns {Uint8Array}
 */
export function profileEd25519Vector() {
    const ret = wasm.profileEd25519Vector();
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {number} iterations
 * @returns {number}
 */
export function profileEd25519Verify(iterations) {
    const ret = wasm.profileEd25519Verify(iterations);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {number} iterations
 * @returns {number}
 */
export function profileHkdfSha256(iterations) {
    const ret = wasm.profileHkdfSha256(iterations);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @returns {Uint8Array}
 */
export function profileHkdfSha256Vector() {
    const ret = wasm.profileHkdfSha256Vector();
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {number} bytes
 * @param {number} iterations
 * @returns {number}
 */
export function profileSha256(bytes, iterations) {
    const ret = wasm.profileSha256(bytes, iterations);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {number} bytes
 * @param {number} iterations
 * @returns {number}
 */
export function profileTokenOpen(bytes, iterations) {
    const ret = wasm.profileTokenOpen(bytes, iterations);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {number} bytes
 * @param {number} iterations
 * @returns {number}
 */
export function profileTokenSeal(bytes, iterations) {
    const ret = wasm.profileTokenSeal(bytes, iterations);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @param {number} bytes
 * @returns {Uint8Array}
 */
export function profileTokenVector(bytes) {
    const ret = wasm.profileTokenVector(bytes);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {number} iterations
 * @returns {number}
 */
export function profileX25519(iterations) {
    const ret = wasm.profileX25519(iterations);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * @returns {Uint8Array}
 */
export function profileX25519Vector() {
    const ret = wasm.profileX25519Vector();
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * Decode any Remote Control response into `{ kind, ... }`.
 * @param {Uint8Array} bytes
 * @returns {any}
 */
export function rcDecodeResponse(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.rcDecodeResponse(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * The 16-byte identity hash of a 64-byte public key.
 * @param {Uint8Array} public_key
 * @returns {Uint8Array}
 */
export function rcIdentityHash(public_key) {
    const ptr0 = passArray8ToWasm0(public_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.rcIdentityHash(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * The 64-byte public key of a 64-byte identity secret (the browser node's own identity).
 * @param {Uint8Array} secret
 * @returns {Uint8Array}
 */
export function rcIdentityPublicKey(secret) {
    const ptr0 = passArray8ToWasm0(secret, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.rcIdentityPublicKey(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @returns {Array<any>}
 */
export function rcInterfaceModes() {
    const ret = wasm.rcInterfaceModes();
    return ret;
}

/**
 * The named modem presets as `{ label, spreadingFactor, bandwidthKhz, codingRate }`.
 * @returns {Array<any>}
 */
export function rcLoRaPresets() {
    const ret = wasm.rcLoRaPresets();
    return ret;
}

/**
 * @returns {Array<any>}
 */
export function rcLoRaRegions() {
    const ret = wasm.rcLoRaRegions();
    return ret;
}

/**
 * Decode an interface config string (compact `L,...` or verbose `LoRa,...`), or `null`.
 * @param {string} text
 * @returns {any}
 */
export function rcParseLoRaConfig(text) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.rcParseLoRaConfig(ptr0, len0);
    return ret;
}

/**
 * The region's built-in Auto LoRa profile, or `null` when the region has none.
 * @param {string} label
 * @returns {any}
 */
export function rcRegionAutoProfile(label) {
    const ptr0 = passStringToWasm0(label, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.rcRegionAutoProfile(ptr0, len0);
    return ret;
}

/**
 * @returns {Uint8Array}
 */
export function rcRequestAnnounceSelf() {
    const ret = wasm.rcRequestAnnounceSelf();
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * Grants another controller full control. `public_key` is its 64-byte public key.
 * @param {Uint8Array} public_key
 * @returns {Uint8Array}
 */
export function rcRequestAuthorizeController(public_key) {
    const ptr0 = passArray8ToWasm0(public_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.rcRequestAuthorizeController(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @returns {Uint8Array}
 */
export function rcRequestDescribe() {
    const ret = wasm.rcRequestDescribe();
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @returns {Uint8Array}
 */
export function rcRequestDescribeBuild() {
    const ret = wasm.rcRequestDescribeBuild();
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @returns {Uint8Array}
 */
export function rcRequestDescribeNodeName() {
    const ret = wasm.rcRequestDescribeNodeName();
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @returns {Uint8Array}
 */
export function rcRequestDescribePower() {
    const ret = wasm.rcRequestDescribePower();
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * `after` is the last controller identity hash of the previous page, or empty for the first.
 * @param {Uint8Array} after
 * @returns {Uint8Array}
 */
export function rcRequestInventoryControllers(after) {
    const ptr0 = passArray8ToWasm0(after, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.rcRequestInventoryControllers(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {Uint8Array} id
 * @returns {Uint8Array}
 */
export function rcRequestInventoryInterfaceConfig(id) {
    const ptr0 = passArray8ToWasm0(id, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.rcRequestInventoryInterfaceConfig(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {Uint8Array} id
 * @returns {Uint8Array}
 */
export function rcRequestInventoryInterfaceDiscoveryGroups(id) {
    const ptr0 = passArray8ToWasm0(id, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.rcRequestInventoryInterfaceDiscoveryGroups(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {Uint8Array} id
 * @param {Uint8Array} after
 * @returns {Uint8Array}
 */
export function rcRequestInventoryInterfacePeers(id, after) {
    const ptr0 = passArray8ToWasm0(id, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(after, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.rcRequestInventoryInterfacePeers(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * `after` is the last interface id of the previous page, or empty for the first page.
 * @param {Uint8Array} after
 * @returns {Uint8Array}
 */
export function rcRequestInventoryInterfaces(after) {
    const ptr0 = passArray8ToWasm0(after, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.rcRequestInventoryInterfaces(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * The request path hash every Remote Control request is sent to.
 * @returns {Uint8Array}
 */
export function rcRequestPathHash() {
    const ret = wasm.rcRequestPathHash();
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {Uint8Array} id
 * @param {string[]} groups
 * @returns {Uint8Array}
 */
export function rcRequestReplaceInterfaceDiscoveryGroups(id, groups) {
    const ptr0 = passArray8ToWasm0(id, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayJsValueToWasm0(groups, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.rcRequestReplaceInterfaceDiscoveryGroups(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * @param {Uint8Array} hash
 * @returns {Uint8Array}
 */
export function rcRequestRevokeController(hash) {
    const ptr0 = passArray8ToWasm0(hash, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.rcRequestRevokeController(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {boolean} enabled
 * @returns {Uint8Array}
 */
export function rcRequestSetDisplayAutoOff(enabled) {
    const ret = wasm.rcRequestSetDisplayAutoOff(enabled);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {boolean} visible
 * @returns {Uint8Array}
 */
export function rcRequestSetDisplayVisibility(visible) {
    const ret = wasm.rcRequestSetDisplayVisibility(visible);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {boolean} on
 * @returns {Uint8Array}
 */
export function rcRequestSetGnssPower(on) {
    const ret = wasm.rcRequestSetGnssPower(on);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {Uint8Array} id
 * @param {string} group
 * @returns {Uint8Array}
 */
export function rcRequestSetInterfaceGroup(id, group) {
    const ptr0 = passArray8ToWasm0(id, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(group, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.rcRequestSetInterfaceGroup(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * `profile` is the inventory text form: `LoRa,<region>,<hz>,<sf>,<bw kHz>,<cr>,<dBm>,<preamble>`.
 * @param {Uint8Array} id
 * @param {string} profile
 * @returns {Uint8Array}
 */
export function rcRequestSetInterfaceLoRaProfile(id, profile) {
    const ptr0 = passArray8ToWasm0(id, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(profile, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.rcRequestSetInterfaceLoRaProfile(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * @param {Uint8Array} id
 * @param {string} mode
 * @returns {Uint8Array}
 */
export function rcRequestSetInterfaceMode(id, mode) {
    const ptr0 = passArray8ToWasm0(id, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.rcRequestSetInterfaceMode(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * @param {Uint8Array} id
 * @param {boolean} on
 * @returns {Uint8Array}
 */
export function rcRequestSetInterfacePower(id, on) {
    const ptr0 = passArray8ToWasm0(id, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.rcRequestSetInterfacePower(ptr0, len0, on);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * Rename the node. Names are 1..=32 bytes of UTF-8 without surrounding spaces.
 * @param {string} name
 * @returns {Uint8Array}
 */
export function rcRequestSetNodeName(name) {
    const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.rcRequestSetNodeName(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @param {boolean} awake
 * @returns {Uint8Array}
 */
export function rcRequestSetSystemPower(awake) {
    const ret = wasm.rcRequestSetSystemPower(awake);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @returns {Uint8Array}
 */
export function rcRequestSleepRadios() {
    const ret = wasm.rcRequestSleepRadios();
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @returns {Uint8Array}
 */
export function rcRequestWakeRadios() {
    const ret = wasm.rcRequestWakeRadios();
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * The target's Remote Control endpoint destination for its public key.
 * @param {Uint8Array} target_public_key
 * @returns {Uint8Array}
 */
export function rcTargetEndpoint(target_public_key) {
    const ptr0 = passArray8ToWasm0(target_public_key, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.rcTargetEndpoint(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * One flash page holding the target identity and the controller as its factory owner.
 * @param {Uint8Array} target_secret
 * @param {Uint8Array} controller_public_key
 * @returns {Uint8Array}
 */
export function rcVaultPage(target_secret, controller_public_key) {
    const ptr0 = passArray8ToWasm0(target_secret, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(controller_public_key, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.rcVaultPage(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v3;
}

/**
 * @param {Uint8Array} packet
 * @returns {Uint8Array}
 */
export function usbAutoDataFrame(packet) {
    const ptr0 = passArray8ToWasm0(packet, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.usbAutoDataFrame(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @returns {number}
 */
export function usbAutoHostBitrateBps() {
    const ret = wasm.usbAutoHostBitrateBps();
    return ret >>> 0;
}

/**
 * @returns {number}
 */
export function usbAutoHostHardwareMtu() {
    const ret = wasm.usbAutoHostHardwareMtu();
    return ret >>> 0;
}

/**
 * @param {Uint8Array} node_tag
 * @returns {Uint8Array}
 */
export function usbAutoHostHelloAckFrame(node_tag) {
    const ptr0 = passArray8ToWasm0(node_tag, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.usbAutoHostHelloAckFrame(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @returns {Uint8Array}
 */
export function usbAutoHostHelloFrame() {
    const ret = wasm.usbAutoHostHelloFrame();
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * @param {Uint8Array} interface_id
 * @returns {Uint8Array}
 */
export function usbAutoNodeTagFor(interface_id) {
    const ptr0 = passArray8ToWasm0(interface_id, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.usbAutoNodeTagFor(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * @returns {number}
 */
export function usbAutoWebUsbProductId() {
    const ret = wasm.usbAutoWebUsbProductId();
    return ret;
}

/**
 * @returns {number}
 */
export function usbAutoWebUsbVendorId() {
    const ret = wasm.usbAutoWebUsbVendorId();
    return ret;
}

/**
 * @returns {number}
 */
export function websocketBitrateBps() {
    const ret = wasm.websocketBitrateBps();
    return ret >>> 0;
}

/**
 * @returns {number}
 */
export function websocketFrameCap() {
    const ret = wasm.websocketFrameCap();
    return ret >>> 0;
}

/**
 * @returns {number}
 */
export function websocketHardwareMtu() {
    const ret = wasm.websocketHardwareMtu();
    return ret >>> 0;
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg___wbindgen_boolean_get_fa956cfa2d1bd751: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_is_null_ea9085d691f535d3: function(arg0) {
            const ret = arg0 === null;
            return ret;
        },
        __wbg___wbindgen_is_undefined_c05833b95a3cf397: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_number_get_394265ed1e1b84ee: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_b0ca35b86a603356: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_344f42d3211c4765: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_from_13e323c65fc8f464: function(arg0) {
            const ret = Array.from(arg0);
            return ret;
        },
        __wbg_get_78f252d074a84d0b: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_unchecked_6e0ad6d2a41b06f6: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_instanceof_Uint8Array_309b927aaf7a3fc7: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isArray_0677c962b281d01a: function(arg0) {
            const ret = Array.isArray(arg0);
            return ret;
        },
        __wbg_length_1f0964f4a5e2c6d8: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_370319915dc99107: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_new_32b398fb48b6d94a: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_new_da52cf8fe3429cb2: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_from_slice_77cdfb7977362f3c: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_prototypesetcall_4770620bbe4688a0: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_push_d2ae3af0c1217ae6: function(arg0, arg1) {
            const ret = arg0.push(arg1);
            return ret;
        },
        __wbg_set_8535240470bf2500: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(arg0, arg1, arg2);
            return ret;
        }, arguments); },
        __wbindgen_cast_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_cast_0000000000000003: function(arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./prns_wasm_bg.js": import0,
    };
}

const BluetoothReassemblerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_bluetoothreassembler_free(ptr, 1));
const PrnsRuntimeFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_prnsruntime_free(ptr, 1));
const UsbAutoDecoderFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_usbautodecoder_free(ptr, 1));
const WebSocketFramingCodecFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_websocketframingcodec_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = module.ok && expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('prns_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
