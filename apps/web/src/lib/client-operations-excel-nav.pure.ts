/**
 * Excel-like Tab navigation across editable Client Operations cells.
 * Presentation order only — does not encode save/domain rules.
 */

export type ClientOperationsExcelNavTarget = {
  rowKind: 'client' | 'manual';
  rowId: string;
  columnKey: string;
};

export function listClientOperationsExcelEditableCells(input: {
  clientRows: Array<{ client_id: string }>;
  manualRows: Array<{
    row_key: string;
    cell_presentation?: Record<string, { cell_kind?: string; editable?: boolean } | undefined>;
  }>;
  columns: Array<{ key: string; cell_kind: string; editable?: boolean }>;
}): ClientOperationsExcelNavTarget[] {
  const customKeys = input.columns
    .filter((column) => column.cell_kind === 'custom' && column.editable !== false)
    .map((column) => column.key);
  const cells: ClientOperationsExcelNavTarget[] = [];
  for (const row of input.clientRows) {
    for (const columnKey of customKeys) {
      cells.push({ rowKind: 'client', rowId: row.client_id, columnKey });
    }
  }
  for (const row of input.manualRows) {
    for (const column of input.columns) {
      const presentation = row.cell_presentation?.[column.key];
      if (presentation?.cell_kind === 'manual_text' && presentation.editable) {
        cells.push({ rowKind: 'manual', rowId: row.row_key, columnKey: column.key });
      }
    }
  }
  return cells;
}

export function nextClientOperationsExcelEditableCell(input: {
  current: ClientOperationsExcelNavTarget;
  cells: ClientOperationsExcelNavTarget[];
}): ClientOperationsExcelNavTarget | null {
  const index = input.cells.findIndex(
    (cell) =>
      cell.rowKind === input.current.rowKind &&
      cell.rowId === input.current.rowId &&
      cell.columnKey === input.current.columnKey,
  );
  if (index < 0) return input.cells[0] ?? null;
  return input.cells[index + 1] ?? null;
}
