/**
 * Client Operations ToDo board presentation helpers (no business authorization).
 * Groups backend semantic priorities into display lanes — never invents priority 5.
 */

export type TodoPriorityLaneId = 'p1' | 'p2' | 'p3' | 'p4' | 'none';

export const TODO_PRIORITY_LANES: Array<{
  id: TodoPriorityLaneId;
  priority: 1 | 2 | 3 | 4 | null;
  label_he: string;
  accent: 'red' | 'orange' | 'gold' | 'green' | 'blue';
}> = [
  { id: 'p1', priority: 1, label_he: 'עדיפות 1', accent: 'red' },
  { id: 'p2', priority: 2, label_he: 'עדיפות 2', accent: 'orange' },
  { id: 'p3', priority: 3, label_he: 'עדיפות 3', accent: 'gold' },
  { id: 'p4', priority: 4, label_he: 'עדיפות 4', accent: 'green' },
  { id: 'none', priority: null, label_he: 'ללא עדיפות', accent: 'blue' },
];

export function todoPriorityToLaneId(priority: number | null | undefined): TodoPriorityLaneId {
  if (priority === 1) return 'p1';
  if (priority === 2) return 'p2';
  if (priority === 3) return 'p3';
  if (priority === 4) return 'p4';
  return 'none';
}

export function groupTodosByPriorityLane<T extends { priority: number | null }>(
  tasks: T[],
): Record<TodoPriorityLaneId, T[]> {
  const out: Record<TodoPriorityLaneId, T[]> = {
    p1: [],
    p2: [],
    p3: [],
    p4: [],
    none: [],
  };
  for (const t of tasks) {
    out[todoPriorityToLaneId(t.priority)].push(t);
  }
  return out;
}

export function encodeTodoPriorityForSubmit(raw: string): number | null {
  const v = String(raw ?? '').trim();
  if (!v || v === 'none') return null;
  const n = Number(v);
  if (n === 1 || n === 2 || n === 3 || n === 4) return n;
  return null;
}

export function formatTodoPriorityLabelHe(priority: number | null | undefined): string {
  if (priority === 1) return '1';
  if (priority === 2) return '2';
  if (priority === 3) return '3';
  if (priority === 4) return '4';
  return 'ללא עדיפות';
}

export const CLIENT_OPERATIONS_TODO_TASK_TEXT_MAX = 2000;
