import { Tag } from "../casework.js";
const RESOURCE_KEY_CACHE_CAPACITY = 64;
const RESOURCE_NONCE_BYTES = 4;
const RESOURCE_SEAL_IV_BYTES = 16;
const RESOURCE_AUTH_TAG_BYTES = 32;
const RESOURCE_CIPHER_BLOCK_BYTES = 16;
const RESOURCE_TOKEN_OVERHEAD_BYTES = RESOURCE_SEAL_IV_BYTES + RESOURCE_AUTH_TAG_BYTES;
const RESOURCE_MINIMUM_TOKEN_BYTES = RESOURCE_TOKEN_OVERHEAD_BYTES + RESOURCE_CIPHER_BLOCK_BYTES;
const WEB_CRYPTO_RESOURCE_DIGEST_MIN_BYTES = 768 * 1_024;
export function resourceDigestExecution(noncePrefixedByteLength, totalSegments) {
    const streamByteLength = noncePrefixedByteLength - RESOURCE_NONCE_BYTES;
    return streamByteLength >= WEB_CRYPTO_RESOURCE_DIGEST_MIN_BYTES || totalSegments >= 3
        ? Tag("WebCrypto")
        : Tag("PortableWasm");
}
export function resourceOpenDigestExecution(sealedTokenByteLength, totalSegments) {
    return resourceDigestExecution(Math.max(RESOURCE_NONCE_BYTES, sealedTokenByteLength - RESOURCE_TOKEN_OVERHEAD_BYTES), totalSegments);
}
export class WebCryptoResourceDigester {
    async digest(noncePrefixedPlaintext, salt) {
        if (salt.length !== RESOURCE_NONCE_BYTES) {
            throw new TypeError("resource digest salt must be exactly 4 bytes");
        }
        if (noncePrefixedPlaintext.length < RESOURCE_NONCE_BYTES) {
            throw new TypeError("resource digest plaintext must include its 4-byte nonce");
        }
        const stream = noncePrefixedPlaintext.subarray(RESOURCE_NONCE_BYTES);
        const input = new Uint8Array(stream.length + 32);
        input.set(stream);
        input.set(salt, stream.length);
        const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", input.subarray(0, stream.length + salt.length)));
        input.set(hash, stream.length);
        const proof = new Uint8Array(await crypto.subtle.digest("SHA-256", input));
        return { hash, proof };
    }
}
export class WebCryptoResourceSealer {
    #keys = new Map();
    async seal(job) {
        const keys = await this.#keysFor(job);
        const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-CBC", iv: job.sealIv }, keys.encryption, job.plaintext));
        const token = new Uint8Array(RESOURCE_SEAL_IV_BYTES + encrypted.length + RESOURCE_AUTH_TAG_BYTES);
        token.set(job.sealIv);
        token.set(encrypted, RESOURCE_SEAL_IV_BYTES);
        const tag = new Uint8Array(await crypto.subtle.sign("HMAC", keys.signing, token.subarray(0, token.length - RESOURCE_AUTH_TAG_BYTES)));
        token.set(tag, token.length - RESOURCE_AUTH_TAG_BYTES);
        return token;
    }
    #keysFor(job) {
        const key = byteKey(job.linkId);
        const existing = this.#keys.get(key);
        if (existing !== undefined) {
            return existing;
        }
        const imported = Promise.all([
            crypto.subtle.importKey("raw", job.signingKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
            crypto.subtle.importKey("raw", job.encryptionKey, "AES-CBC", false, ["encrypt"]),
        ]).then(([signing, encryption]) => ({ signing, encryption }));
        rememberImportedKeys(this.#keys, key, imported);
        return imported;
    }
}
export class WebCryptoResourceOpener {
    #keys = new Map();
    async open(job) {
        if (job.sealed.length < RESOURCE_MINIMUM_TOKEN_BYTES ||
            (job.sealed.length - RESOURCE_TOKEN_OVERHEAD_BYTES) %
                RESOURCE_CIPHER_BLOCK_BYTES !== 0) {
            return Tag("Refused");
        }
        const keys = await this.#keysFor(job);
        const signed = job.sealed.subarray(0, job.sealed.length - RESOURCE_AUTH_TAG_BYTES);
        const tag = job.sealed.subarray(job.sealed.length - RESOURCE_AUTH_TAG_BYTES);
        const authentic = await crypto.subtle.verify("HMAC", keys.signing, tag, signed);
        if (!authentic) {
            return Tag("Refused");
        }
        try {
            const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-CBC", iv: job.sealed.subarray(0, RESOURCE_SEAL_IV_BYTES) }, keys.encryption, job.sealed.subarray(RESOURCE_SEAL_IV_BYTES, job.sealed.length - RESOURCE_AUTH_TAG_BYTES)));
            return Tag("Opened", plaintext);
        }
        catch {
            return Tag("Refused");
        }
    }
    #keysFor(job) {
        const key = byteKey(job.linkId);
        const existing = this.#keys.get(key);
        if (existing !== undefined) {
            return existing;
        }
        const imported = Promise.all([
            crypto.subtle.importKey("raw", job.signingKey, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]),
            crypto.subtle.importKey("raw", job.encryptionKey, "AES-CBC", false, ["decrypt"]),
        ]).then(([signing, encryption]) => ({ signing, encryption }));
        rememberImportedKeys(this.#keys, key, imported);
        return imported;
    }
}
export function parseResourceSealJob(raw) {
    const data = record(raw, "resource seal job");
    const job = {
        id: positiveIntegerField(data, "id"),
        linkId: bytesField(data, "linkId", 16),
        noncePrefixedBytes: positiveIntegerField(data, "noncePrefixedBytes"),
        totalSegments: positiveIntegerField(data, "totalSegments"),
        plaintext: bytesField(data, "plaintext"),
        signingKey: bytesField(data, "signingKey", 32),
        encryptionKey: bytesField(data, "encryptionKey", 32),
        sealIv: bytesField(data, "sealIv", 16),
        salts: bytesField(data, "salts", 32),
    };
    if (job.plaintext.length !== job.noncePrefixedBytes) {
        throw new TypeError("plaintext length must equal noncePrefixedBytes");
    }
    return job;
}
export function parseResourceOpenJob(raw) {
    const job = record(raw, "resource open job");
    const hashPlan = record(job.hashPlan, "resource open hash plan");
    const hashPlanTag = stringField(hashPlan, "tag");
    const parsedHashPlan = hashPlanTag === "OpenedStream"
        ? Tag("OpenedStream", {
            salt: bytesField(record(hashPlan.data, "resource open hash plan data"), "salt", 4),
        })
        : hashPlanTag === "AfterDecompression"
            ? Tag("AfterDecompression")
            : undefined;
    if (parsedHashPlan === undefined) {
        throw new TypeError(`unknown resource open hash plan tag ${hashPlanTag}`);
    }
    return {
        id: positiveIntegerField(job, "id"),
        linkId: bytesField(job, "linkId", 16),
        hash: bytesField(job, "hash", 32),
        signingKey: bytesField(job, "signingKey", 32),
        encryptionKey: bytesField(job, "encryptionKey", 32),
        sealed: bytesField(job, "sealed"),
        hashPlan: parsedHashPlan,
        totalSegments: positiveIntegerField(job, "totalSegments"),
    };
}
export function parseResourceDigestLanding(raw) {
    const tag = stringField(record(raw, "resource digest landing"), "tag");
    if (tag === "Applied" || tag === "Collision" || tag === "Stale" || tag === "Invalid") {
        return Tag(tag);
    }
    throw new TypeError(`unknown resource digest landing tag ${tag}`);
}
function record(value, name) {
    if (typeof value !== "object" || value === null) {
        throw new TypeError(`${name} must be an object`);
    }
    return value;
}
function stringField(value, key) {
    const field = value[key];
    if (typeof field !== "string") {
        throw new TypeError(`${key} must be a string`);
    }
    return field;
}
function positiveIntegerField(value, key) {
    const field = value[key];
    if (typeof field !== "number" || !Number.isSafeInteger(field) || field <= 0) {
        throw new TypeError(`${key} must be a positive safe integer`);
    }
    return field;
}
function bytesField(value, key, length) {
    const field = value[key];
    if (!(field instanceof Uint8Array) ||
        !(field.buffer instanceof ArrayBuffer) ||
        (length !== undefined && field.length !== length)) {
        throw new TypeError(length === undefined
            ? `${key} must be a Uint8Array`
            : `${key} must be a ${length}-byte Uint8Array`);
    }
    return field;
}
function byteKey(bytes) {
    let key = "";
    for (const byte of bytes) {
        key += byte.toString(16).padStart(2, "0");
    }
    return key;
}
function rememberImportedKeys(cache, key, imported) {
    if (cache.size >= RESOURCE_KEY_CACHE_CAPACITY) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) {
            cache.delete(oldest);
        }
    }
    cache.set(key, imported);
}
