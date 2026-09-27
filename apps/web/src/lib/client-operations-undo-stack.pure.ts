/**
 * Ephemeral Client Operations undo stack (max 10).
 * Invokes canonical inverse writes — not a second business truth store.
 */

import type { ManualStatusPaintIntent } from './client-operations-manual-status-paint.pure.js';

export const CLIENT_OPERATIONS_UNDO_MAX = 10;

export type CoUndoPresentationSnapshot = Record<
  string,
  {
    align?: 'right' | 'center' | 'left';
    wrap?: boolean;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    color?: string;
    fill?: string;
    fontSize?: number;
    numberFormat?: 'general' | 'number' | 'currency' | 'percent' | 'date';
  }
>;

export type CoUndoEntry =
  | {
      kind: 'manual_status';
      organizationId: string;
      periodKey: string;
      clientId: string;
      columnKey: string;
      previousStatus: ManualStatusPaintIntent;
      newStatus: ManualStatusPaintIntent;
    }
  | {
      kind: 'presentation';
      previous: CoUndoPresentationSnapshot;
    }
  | {
      kind: 'custom_cell';
      organizationId: string;
      periodKey: string;
      clientId: string;
      columnId: string;
      columnKey: string;
      previousValue: string;
      newValue: string;
    }
  | {
      kind: 'column_visibility';
      previousHiddenKeys: string[];
    }
  | {
      kind: 'column_width';
      columnKey: string;
      previousWidth: number;
      nextWidth: number;
    };

/** Actions intentionally excluded from undo (no fabricated inverse). */
export const CO_UNDO_EXCLUDED_ACTIONS = [
  'operational_checkbox_toggle',
  'ni_deductions_102_100_126',
  'income_tax_deductions_toggle',
  'operational_target_date',
  'annual_report_date',
  'capital_declaration_open',
  'column_create_rename_settings',
  'period_setup',
  'search_query',
  'fullscreen_toggle',
  'status_paint_mode_select',
  'print',
  'palette_open',
  'popover_open',
] as const;

export function pushClientOperationsUndoEntry(
  stack: CoUndoEntry[],
  entry: CoUndoEntry,
  max = CLIENT_OPERATIONS_UNDO_MAX,
): CoUndoEntry[] {
  const next = [...stack, entry];
  if (next.length <= max) return next;
  return next.slice(next.length - max);
}

export function popClientOperationsUndoEntry(
  stack: CoUndoEntry[],
): { entry: CoUndoEntry | null; stack: CoUndoEntry[] } {
  if (!stack.length) return { entry: null, stack };
  const entry = stack[stack.length - 1]!;
  return { entry, stack: stack.slice(0, -1) };
}

export function clearClientOperationsUndoStack(): CoUndoEntry[] {
  return [];
}
