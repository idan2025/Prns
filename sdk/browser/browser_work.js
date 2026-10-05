import { Tag } from "../casework.js";
import { parseResourceOpenJob, parseResourceSealJob, } from "./resource_crypto.js";
export function parseBrowserWork(raw) {
    if (raw === undefined) {
        return undefined;
    }
    const root = record(raw, "browser work");
    const tag = stringField(root, "tag");
    const data = record(root.data, "browser work data");
    if (tag === "ResourceSeal") {
        return Tag("ResourceSeal", parseResourceSealJob(data));
    }
    if (tag === "WholeResourceOpen") {
        return Tag("WholeResourceOpen", parseResourceOpenJob(data));
    }
    const common = {
        id: positiveIntegerField(data, "id"),
        publicKey: bytesField(data, "publicKey", 32),
        message: bytesField(data, "message"),
        signature: bytesField(data, "signature", 64),
    };
    if (tag === "AnnounceVerify") {
        return Tag("AnnounceVerify", common);
    }
    if (tag === "LinkProofVerify") {
        return Tag("LinkProofVerify", {
            ...common,
            secretScalar: bytesField(data, "secretScalar", 32),
            peerPublicKey: bytesField(data, "peerPublicKey", 32),
        });
    }
    throw new TypeError(`unknown browser work tag ${tag}`);
}
export function parseBrowserWorkLanding(raw) {
    const tag = stringField(record(raw, "browser work landing"), "tag");
    if (tag === "Applied" || tag === "Collision" || tag === "Stale" || tag === "Invalid") {
        return Tag(tag);
    }
    throw new TypeError(`unknown browser work landing tag ${tag}`);
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
    if (!Number.isSafeInteger(field) || field < 1) {
        throw new TypeError(`${key} must be a positive safe integer`);
    }
    return field;
}
function bytesField(value, key, length) {
    const field = value[key];
    if (!(field instanceof Uint8Array) || !(field.buffer instanceof ArrayBuffer)) {
        throw new TypeError(`${key} must be an owned Uint8Array`);
    }
    if (length !== undefined && field.length !== length) {
        throw new TypeError(`${key} must be exactly ${length} bytes`);
    }
    return field;
}
