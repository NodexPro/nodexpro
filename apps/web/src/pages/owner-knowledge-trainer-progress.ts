const PAGE_EXTRACT_IN_FLIGHT = new Set(['uploaded', 'queued', 'extracting']);

export function shouldPollKnowledgeTrainerProgress(input: {
  job_status?: string | null;
  layout_readiness?: string | null;
}): boolean {
  if (PAGE_EXTRACT_IN_FLIGHT.has(String(input.job_status ?? ''))) return true;
  return input.layout_readiness === 'processing';
}
