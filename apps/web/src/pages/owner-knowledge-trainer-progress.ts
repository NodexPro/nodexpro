const PAGE_EXTRACT_IN_FLIGHT = new Set(['uploaded', 'queued', 'extracting']);
const FILE_ACCESS_REFRESH_SKEW_MS = 90_000;

export function shouldPollKnowledgeTrainerProgress(input: {
  job_status?: string | null;
  layout_readiness?: string | null;
}): boolean {
  if (PAGE_EXTRACT_IN_FLIGHT.has(String(input.job_status ?? ''))) return true;
  return input.layout_readiness === 'processing';
}

export function originalFileAccessNeedsRefresh(
  access: { url?: string | null; expires_at?: string | null } | null | undefined,
  nowMs = Date.now(),
  refreshSkewMs = FILE_ACCESS_REFRESH_SKEW_MS,
): boolean {
  if (!access?.url || !access.expires_at) return true;
  const expires = Date.parse(access.expires_at);
  if (!Number.isFinite(expires)) return true;
  return expires - nowMs <= refreshSkewMs;
}
