/**
 * Client Operations — annual report tax-year resolver + operational date cell builders.
 * Product rule: for operational workspace year Y, annual report tax_year = Y - 1.
 * Backend-owned; React must not compute this.
 */

import { parseOperationalPeriodKey } from './client-operations-operational-period.pure.js';

export type AnnualReportOperationalDateCell = {
  applicable: boolean;
  editable: boolean;
  tax_year: number | null;
  instance_id: string | null;
  operational_target_date: string | null;
};

export type CapitalDeclarationOperationalDateCell = {
  applicable: boolean;
  editable: boolean;
  instance_id: string | null;
  tax_year: number | null;
  operational_target_date: string | null;
  /** Backend-owned: show compact + when no open instance and user may edit. */
  can_open: boolean;
};

/** Format YYYY-MM-DD → DD/MM/YYYY without timezone shift (date-only). */
export function formatOperationalDateDisplayHe(isoDate: string | null | undefined): string {
  if (!isoDate) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate).trim());
  if (!m) return '—';
  return `${m[3]}/${m[2]}/${m[1]}`;
}

export function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, mo, d] = value.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return false;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/**
 * Resolve annual-report tax year for a Client Operations operational period (YYYY-MM).
 * Rule: tax_year = operational year - 1.
 */
export function resolveAnnualReportTaxYearForOperationalPeriod(operationalPeriodKey: string): number {
  const parts = parseOperationalPeriodKey(operationalPeriodKey);
  if (!parts) {
    throw new Error(`Invalid operational_period_key: ${operationalPeriodKey}`);
  }
  return parts.year - 1;
}

export function buildAnnualReportCell(input: {
  taxYear: number;
  instanceId: string | null;
  operationalTargetDate: string | null;
  canEdit: boolean;
}): AnnualReportOperationalDateCell {
  return {
    applicable: true,
    editable: input.canEdit,
    tax_year: input.taxYear,
    instance_id: input.instanceId,
    operational_target_date: input.operationalTargetDate,
  };
}

export function buildCapitalDeclarationCell(input: {
  openInstance: {
    id: string;
    tax_year: number | null;
    operational_target_date: string | null;
  } | null;
  canEdit: boolean;
}): CapitalDeclarationOperationalDateCell {
  if (!input.openInstance) {
    return {
      applicable: false,
      editable: false,
      instance_id: null,
      tax_year: null,
      operational_target_date: null,
      can_open: input.canEdit,
    };
  }
  return {
    applicable: true,
    editable: input.canEdit,
    instance_id: input.openInstance.id,
    tax_year: input.openInstance.tax_year,
    operational_target_date: input.openInstance.operational_target_date,
    can_open: false,
  };
}
