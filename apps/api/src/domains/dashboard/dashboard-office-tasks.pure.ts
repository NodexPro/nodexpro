/**
 * Office dashboard Work Engine attention lists: ready-to-render labels and
 * attention membership. Counts and rows stay owned by Work Engine work_items.
 */

import type { DashboardLocale } from './dashboard-office-copy.pure.js';

export const OFFICE_TASK_LIST_KEYS = ['overdue', 'due_today', 'review_pending'] as const;
export type OfficeTaskListKey = (typeof OFFICE_TASK_LIST_KEYS)[number];

export type OfficeTaskAttentionWindow = {
  start_iso: string;
  end_exclusive_iso: string;
};

const TERMINAL_WORK_STATES = new Set(['done', 'archived']);

export function parseOfficeTaskListKey(raw: unknown): OfficeTaskListKey | null {
  const s = String(raw ?? '').trim();
  return (OFFICE_TASK_LIST_KEYS as readonly string[]).includes(s) ? (s as OfficeTaskListKey) : null;
}

export function quotePostgrestOrValue(value: string): string {
  return `"${String(value).replace(/["\\]/g, '')}"`;
}

export function sanitizeOfficeTaskSearchToken(raw: string): string {
  return String(raw ?? '')
    .replace(/[%*,()."'\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function humanizeKey(key: string): string {
  return key
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

const WORK_TYPE_LABELS: Record<DashboardLocale, Record<string, string>> = {
  he: {
    annual_report_docs: 'מסמכי דוח שנתי',
    annual_report_document_collection: 'מסמכי דוח שנתי',
    payroll_document_collection: 'מסמכי שכר',
    vat_document_collection: 'מסמכי מע״מ',
    docflow_thread_followup: 'שיחה',
    invoice_collection_followup: 'גבייה עבור חשבונית באיחור',
    recurring_invoice_review: 'בדיקת חשבונית ריטיינר',
    recurring_generation_failed: 'כשל ביצירת מסמך ריטיינר',
    recurring_document_send_followup: 'שליחת מסמך ריטיינר לאחר אישור',
  },
  en: {
    annual_report_docs: 'Annual report documents',
    annual_report_document_collection: 'Annual report documents',
    payroll_document_collection: 'Payroll documents',
    vat_document_collection: 'VAT documents',
    docflow_thread_followup: 'Conversation',
    invoice_collection_followup: 'Overdue invoice collection',
    recurring_invoice_review: 'Retainer invoice review',
    recurring_generation_failed: 'Retainer document generation failed',
    recurring_document_send_followup: 'Send retainer document after approval',
  },
};

const MODULE_LABELS: Record<DashboardLocale, Record<string, string>> = {
  he: {
    payroll: 'שכר',
    vat: 'מע״מ',
    annual_report: 'דוח שנתי',
    income_tax: 'מס הכנסה',
    national_insurance: 'ביטוח לאומי',
    client_obligations: 'חובות לקוח',
    docflow: 'DocFlow',
    work_engine: 'מנוע עבודה',
    income: 'הכנסות',
    'client-operations': 'ניהול לקוחות',
    client_operations: 'ניהול לקוחות',
  },
  en: {
    payroll: 'Payroll',
    vat: 'VAT',
    annual_report: 'Annual report',
    income_tax: 'Income tax',
    national_insurance: 'National insurance',
    client_obligations: 'Client obligations',
    docflow: 'DocFlow',
    work_engine: 'Work Engine',
    income: 'Income',
    'client-operations': 'Client management',
    client_operations: 'Client management',
  },
};

export function officeWorkTypeLabel(workType: string | null | undefined, locale: DashboardLocale): string {
  const key = String(workType ?? '').trim();
  if (!key) return '';
  return WORK_TYPE_LABELS[locale][key] ?? humanizeKey(key);
}

export function officeModuleLabel(moduleKey: string | null | undefined, locale: DashboardLocale): string {
  const key = String(moduleKey ?? '').trim();
  if (!key) return '';
  return MODULE_LABELS[locale][key] ?? humanizeKey(key);
}

/** Displayable period only — never the technical `module:work_type:period` code. */
export function officePeriodLabel(periodKey: string | null | undefined): string {
  const raw = String(periodKey ?? '').trim();
  if (!raw) return '';
  const last = raw.includes(':') ? (raw.split(':').pop() ?? '') : raw;
  if (/^\d{4}(?:-\d{2}){0,2}$/.test(last)) return last;
  if (/^\d{4}-Q[1-4]$/i.test(last)) return last.toUpperCase();
  if (raw.includes(':')) return '';
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(raw) && /[_-]/.test(raw)) return '';
  return raw;
}

export function officeTaskDescription(params: {
  moduleKey: string | null | undefined;
  periodKey: string | null | undefined;
  locale: DashboardLocale;
}): string {
  const moduleLabel = officeModuleLabel(params.moduleKey, params.locale);
  const period = officePeriodLabel(params.periodKey);
  return [moduleLabel, period].filter(Boolean).join(' · ');
}

export function officeTaskAttentionOrFilter(
  listKey: OfficeTaskListKey,
  today: OfficeTaskAttentionWindow,
): {
  or: string | null;
  dueGte: string | null;
  dueLt: string | null;
  excludeTerminal: boolean;
  workStateEq: string | null;
} {
  if (listKey === 'review_pending') {
    return {
      or: null,
      dueGte: null,
      dueLt: null,
      excludeTerminal: false,
      workStateEq: 'review_pending',
    };
  }
  if (listKey === 'due_today') {
    return {
      or: null,
      dueGte: today.start_iso,
      dueLt: today.end_exclusive_iso,
      excludeTerminal: true,
      workStateEq: null,
    };
  }
  const start = quotePostgrestOrValue(today.start_iso);
  return {
    or: `work_state.eq.overdue,work_state.eq.escalated,sla_status.eq.overdue,sla_status.eq.breached,due_at.lt.${start}`,
    dueGte: null,
    dueLt: null,
    excludeTerminal: true,
    workStateEq: null,
  };
}

export function workItemMatchesOfficeAttention(params: {
  listKey: OfficeTaskListKey;
  workState: string | null | undefined;
  slaStatus: string | null | undefined;
  dueAt: string | null | undefined;
  today: OfficeTaskAttentionWindow;
}): boolean {
  const state = String(params.workState ?? '').trim();
  if (params.listKey === 'review_pending') return state === 'review_pending';
  if (TERMINAL_WORK_STATES.has(state)) return false;
  if (params.listKey === 'due_today') {
    const due = params.dueAt;
    return Boolean(due && due >= params.today.start_iso && due < params.today.end_exclusive_iso);
  }
  if (state === 'overdue' || state === 'escalated') return true;
  const sla = String(params.slaStatus ?? '').trim();
  if (sla === 'overdue' || sla === 'breached') return true;
  const due = params.dueAt;
  return Boolean(due && due < params.today.start_iso);
}
