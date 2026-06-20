/**
 * Dev/ops helper — log JSON payload size breakdown for aggregate responses.
 */
function jsonByteSize(value) {
    try {
        return Buffer.byteLength(JSON.stringify(value), 'utf8');
    }
    catch {
        return 0;
    }
}
function formatKb(bytes) {
    return `${(bytes / 1024).toFixed(1)}KB`;
}
/** Log top-level field sizes for an aggregate object. */
export function logAggregatePayloadBreakdown(label, aggregate) {
    const totalBytes = jsonByteSize(aggregate);
    const parts = Object.entries(aggregate)
        .map(([key, value]) => ({ key, bytes: jsonByteSize(value) }))
        .sort((a, b) => b.bytes - a.bytes);
    const top = parts.slice(0, 8).map((p) => `${p.key}=${formatKb(p.bytes)}`).join(', ');
    console.info(`[aggregate-payload] ${label} total=${formatKb(totalBytes)} top: ${top}`);
}
