export function Tag(tag, data) {
    return { tag, data };
}
export function match(value, handlers) {
    if (typeof value === "string") {
        return handlers[value]();
    }
    if (typeof value === "object" &&
        value !== null &&
        "tag" in value &&
        "data" in value &&
        typeof value.tag === "string" &&
        Object.keys(value).length === 2) {
        return handlers[value.tag](value.data);
    }
    return handlers.UNTAGGED(value);
}
export function match_into() {
    return {
        from: function (tagged, handlers) {
            return handlers[tagged.tag](tagged.data);
        },
    };
}
export function from() {
    function MakeTag(tag, ...args) {
        return { tag: tag, data: args[0] };
    }
    return {
        MakeTag,
    };
}
