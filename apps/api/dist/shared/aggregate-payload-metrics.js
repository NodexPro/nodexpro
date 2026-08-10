/**
 * Dev/ops helper — log JSON payload size breakdown for aggregate responses.
 * P11.5-D — emit [slow-aggregate] when duration exceeds threshold (never fails request).
 */
import { emitSlowAggregateWarning, jsonByteLength } from './observability.js';
function formatKb(bytes) {
    return `${(bytes / 1024).toFixed(1)}KB`;
}
/** Log top-level field sizes for an aggregate object. */
export function logAggregatePayloadBreakdown(label, aggregate, options) {
    const totalBytes = jsonByteLength(aggregate);
    const parts = Object.entries(aggregate)
        .map(([key, value]) => ({ key, bytes: jsonByteLength(value) }))
        .sort((a, b) => b.bytes - a.bytes);
    const top = parts.slice(0, 8).map((p) => `${p.key}=${formatKb(p.bytes)}`).join(', ');
    console.info(`[aggregate-payload] ${label} total=${formatKb(totalBytes)} top: ${top}`);
    if (options?.duration_ms != null) {
        emitSlowAggregateWarning({
            aggregate_key: label,
            correlation_id: options.correlation_id,
            organization_id: options.organization_id,
            duration_ms: options.duration_ms,
            payload_bytes: totalBytes,
            stage_timings: options.stage_timings ?? null,
        });
    }
}
