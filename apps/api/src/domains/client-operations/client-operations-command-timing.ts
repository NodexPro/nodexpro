/**
 * Safe Client Operations duration logs.
 * No PII, document names, file contents, or row payloads.
 */

export function logClientOperationsTiming(input: {
  event: string;
  command?: string | null;
  duration_ms: number;
  stage_timings?: Record<string, number> | null;
  organization_id?: string | null;
  result?: 'success' | 'failure';
  http_status?: number | null;
}): void {
  console.info('[client-operations-timing]', {
    event: input.event,
    command: input.command ?? null,
    duration_ms: input.duration_ms,
    stage_timings: input.stage_timings ?? null,
    organization_id: input.organization_id ?? null,
    result: input.result ?? 'success',
    http_status: input.http_status ?? null,
  });
}

export function clientOperationsStageTimer(): {
  mark: (name: string) => void;
  timings: () => Record<string, number>;
  elapsedMs: () => number;
} {
  const started = Date.now();
  const last = { ms: started };
  const stage_timings: Record<string, number> = {};
  return {
    mark(name: string) {
      const now = Date.now();
      stage_timings[name] = now - last.ms;
      last.ms = now;
    },
    timings() {
      return { ...stage_timings, total_ms: Date.now() - started };
    },
    elapsedMs() {
      return Date.now() - started;
    },
  };
}
