/**
 * Incremental pre-search materialization splice.
 *
 * After a single-client registry write the mutated client is rematerialized from the
 * database; unchanged rows are reused from the process-local pre-search materialization
 * that GET /registry already served. The command response stays a full aggregate.
 *
 * The mutated row is never taken from cache. Filter-out (row no longer matches) removes it.
 */

export type RegistryMaterializationSlice<TRow extends { client_id: string }> = {
  built_rows: TRow[];
  stage_timings?: Record<string, number>;
  materialized_at_ms?: number;
};

export function spliceClientRowIntoRegistryMaterialization<
  TRow extends { client_id: string },
  TMat extends RegistryMaterializationSlice<TRow>,
>(cached: TMat, rebuilt: TMat, clientId: string): TMat {
  const id = String(clientId ?? '').trim();
  if (!id) return cached;
  const rebuiltRow = rebuilt.built_rows.find((row) => row.client_id === id);
  const existingIndex = cached.built_rows.findIndex((row) => row.client_id === id);
  const nextRows = cached.built_rows.slice();
  if (existingIndex >= 0) nextRows.splice(existingIndex, 1);
  if (rebuiltRow) {
    nextRows.splice(existingIndex >= 0 ? existingIndex : nextRows.length, 0, rebuiltRow);
  }
  return {
    ...cached,
    built_rows: nextRows,
    materialized_at_ms: rebuilt.materialized_at_ms ?? Date.now(),
    stage_timings: {
      ...(cached.stage_timings ?? {}),
      ...(rebuilt.stage_timings ?? {}),
      incremental_client_refresh: 1,
    },
  };
}

export const SINGLE_CLIENT_REGISTRY_REFRESH_COMMANDS = new Set([
  'set_material_brought',
  'set_income_tax_advance_material_brought',
  'set_payroll_material_brought',
  'set_annual_report_operational_target_date',
  'open_capital_declaration_instance',
  'set_capital_declaration_operational_target_date',
  'complete_capital_declaration_instance',
  'set_ni_deductions_reported_102',
  'set_ni_deductions_reported_100',
  'complete_ni_deductions_126_cycle',
  'set_income_tax_deductions_reported',
  'set_client_operations_custom_column_value',
  'set_client_operations_cell_manual_status',
]);
