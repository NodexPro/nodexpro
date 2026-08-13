/** Production-safe command stage timings (milliseconds from request start). */
export type IncomeCommandTimings = {
  request_received_ms: number;
  auth_org_issuer_ms?: number;
  draft_load_ms?: number;
  draft_mutation_ms?: number;
  totals_validation_ms?: number;
  branding_assets_ms?: number;
  preview_renderer_ms?: number;
  wizard_patch_aggregate_ms?: number;
  invoices_tab_aggregate_ms?: number;
  documents_by_type_aggregate_ms?: number;
  response_ready_ms?: number;
  total_ms: number;
};

export function createIncomeCommandTimings(): {
  mark: (key: keyof Omit<IncomeCommandTimings, 'request_received_ms' | 'total_ms'>) => void;
  snapshot: () => IncomeCommandTimings;
} {
  const started = Date.now();
  const marks: Partial<IncomeCommandTimings> = { request_received_ms: 0 };
  return {
    mark(key) {
      marks[key] = Date.now() - started;
    },
    snapshot() {
      const total_ms = Date.now() - started;
      return { ...marks, request_received_ms: 0, total_ms };
    },
  };
}

export function logIncomeCommandTimings(
  command: string,
  timings: IncomeCommandTimings,
  extras?: Record<string, unknown>,
): void {
  console.info('[income-command-timings]', {
    command,
    ...timings,
    ...extras,
  });
}
