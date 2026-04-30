import { supabaseAdmin } from '../../db/client.js';
import { AppError, forbidden, badRequest } from '../../shared/errors.js';
import type { RequestContext } from '../../shared/context.js';

export type OperationalNoteTypeDto = {
  code: string;
  label_he: string;
  sort_order: number;
  allows_reminder: boolean;
};

export type OperationalNoteDto = {
  id: string;
  client_id: string;
  type_code: string;
  type_label_he: string;
  body: string;
  reminder_at: string | null;
  created_at: string;
  updated_at: string;
};

function assertOrg(ctx: RequestContext): string {
  const orgId = ctx.organizationId;
  if (!orgId) throw forbidden('Active organization required');
  return orgId;
}

export async function listOperationalNoteTypes(): Promise<{ types: OperationalNoteTypeDto[] }> {
  const { data, error } = await supabaseAdmin
    .from('client_operational_note_types')
    .select('code, label_he, sort_order, allows_reminder')
    .order('sort_order', { ascending: true });
  if (error) throw new AppError(500, error.message ?? 'Database error', 'SUPABASE_ERROR');
  const types = (data ?? []) as OperationalNoteTypeDto[];
  return { types };
}

async function ensureClientInOrg(orgId: string, clientId: string): Promise<void> {
  const { data } = await supabaseAdmin.from('clients').select('id').eq('organization_id', orgId).eq('id', clientId).maybeSingle();
  if (!data) throw forbidden('Client not found');
}

function truncateBody(s: string, max: number): string {
  const t = (s ?? '').trim();
  if (t.length <= max) return t;
  return t.slice(0, max) + '…';
}

function formatReminderHe(iso: string): string {
  try {
    return new Date(iso).toLocaleString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

/** Build cell text for registry (Hebrew), fully server-side. */
export function buildNotesCellDisplayHe(
  notes: Array<{ body: string; reminder_at: string | null; updated_at: string }>,
): { count: number; cell_text_he: string | null } {
  if (!notes.length) return { count: 0, cell_text_he: null };
  const sorted = [...notes].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  const last = sorted[0];
  const now = Date.now();
  const upcoming = notes
    .filter((n) => n.reminder_at && new Date(n.reminder_at).getTime() >= now - 60_000)
    .sort((a, b) => new Date(a.reminder_at!).getTime() - new Date(b.reminder_at!).getTime())[0];
  let cell = truncateBody(last.body, 48);
  if (upcoming?.reminder_at) {
    cell += ` · תזכורת ${formatReminderHe(upcoming.reminder_at)}`;
  }
  if (notes.length > 1) {
    cell = `(${notes.length}) ${cell}`;
  }
  return { count: notes.length, cell_text_he: cell };
}

async function getClientNotesRegistryPreviewHe(
  orgId: string,
  clientId: string,
): Promise<{ notes_cell_text_he: string | null; operational_notes_count: number }> {
  const { data, error } = await supabaseAdmin
    .from('client_operational_notes')
    .select('body, reminder_at, updated_at')
    .eq('organization_id', orgId)
    .eq('client_id', clientId);
  if (error) throw new AppError(500, error.message ?? 'Database error', 'SUPABASE_ERROR');
  const agg = buildNotesCellDisplayHe((data ?? []) as Array<{ body: string; reminder_at: string | null; updated_at: string }>);
  return { notes_cell_text_he: agg.cell_text_he, operational_notes_count: agg.count };
}

export async function loadNotesAggregatesByClient(
  orgId: string,
  clientIds: string[],
): Promise<Map<string, Array<{ body: string; reminder_at: string | null; updated_at: string }>>> {
  const map = new Map<string, Array<{ body: string; reminder_at: string | null; updated_at: string }>>();
  if (!clientIds.length) return map;
  const { data, error } = await supabaseAdmin
    .from('client_operational_notes')
    .select('client_id, body, reminder_at, updated_at')
    .eq('organization_id', orgId)
    .in('client_id', clientIds);
  if (error) throw new AppError(500, error.message ?? 'client_operational_notes query failed', 'SUPABASE_ERROR');
  for (const row of (data ?? []) as Array<{ client_id: string; body: string; reminder_at: string | null; updated_at: string }>) {
    if (!map.has(row.client_id)) map.set(row.client_id, []);
    map.get(row.client_id)!.push({
      body: row.body,
      reminder_at: row.reminder_at,
      updated_at: row.updated_at,
    });
  }
  return map;
}

export async function listOperationalNotes(ctx: RequestContext, clientId: string): Promise<{ notes: OperationalNoteDto[] }> {
  const orgId = assertOrg(ctx);
  await ensureClientInOrg(orgId, clientId);

  const { types } = await listOperationalNoteTypes();
  const labelByCode = new Map(types.map((t) => [t.code, t.label_he]));

  const { data, error } = await supabaseAdmin
    .from('client_operational_notes')
    .select('id, client_id, type_code, body, reminder_at, created_at, updated_at')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  if (error) throw new AppError(500, error.message ?? 'Database error', 'SUPABASE_ERROR');

  const notes: OperationalNoteDto[] = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id as string,
    client_id: row.client_id as string,
    type_code: row.type_code as string,
    type_label_he: labelByCode.get(row.type_code as string) ?? (row.type_code as string),
    body: row.body as string,
    reminder_at: (row.reminder_at as string | null) ?? null,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  }));

  return { notes };
}

type ConflictRow = {
  note_id: string;
  client_id: string;
  client_display_name: string | null;
  reminder_at: string;
  type_label_he: string;
  body_preview: string;
};

export async function findReminderConflicts(
  orgId: string,
  excludeClientId: string,
  reminderAt: Date,
): Promise<ConflictRow[]> {
  const minuteStart = new Date(reminderAt);
  minuteStart.setSeconds(0, 0);
  const minuteEnd = new Date(minuteStart.getTime() + 60_000);

  const { data, error } = await supabaseAdmin
    .from('client_operational_notes')
    .select('id, client_id, reminder_at, body, type_code')
    .eq('organization_id', orgId)
    .neq('client_id', excludeClientId)
    .not('reminder_at', 'is', null)
    .gte('reminder_at', minuteStart.toISOString())
    .lt('reminder_at', minuteEnd.toISOString());

  if (error) throw new AppError(500, error.message ?? 'Database error', 'SUPABASE_ERROR');

  const rows = (data ?? []) as Array<{ id: string; client_id: string; reminder_at: string; body: string; type_code: string }>;
  if (!rows.length) return [];

  const clientIds = [...new Set(rows.map((r) => r.client_id))];
  const { data: clientsData } = await supabaseAdmin.from('clients').select('id, display_name').in('id', clientIds);
  const nameById = new Map((clientsData ?? []).map((c: { id: string; display_name: string | null }) => [c.id, c.display_name]));

  const typeCodes = [...new Set(rows.map((r) => r.type_code))];
  const { data: typesData } = await supabaseAdmin.from('client_operational_note_types').select('code, label_he').in('code', typeCodes);
  const labelByCode = new Map((typesData ?? []).map((t: { code: string; label_he: string }) => [t.code, t.label_he]));

  return rows.map((row) => ({
    note_id: row.id,
    client_id: row.client_id,
    client_display_name: nameById.get(row.client_id) ?? null,
    reminder_at: row.reminder_at,
    type_label_he: labelByCode.get(row.type_code) ?? row.type_code,
    body_preview: truncateBody(row.body, 80),
  }));
}

/**
 * Reminders for toast candidate rendering.
 * We keep a moderate lookback/lookahead window so polling doesn't miss the due moment.
 */
export type DueReminderDto = {
  id: string;
  body: string;
  reminder_at: string;
  client_id: string;
  client_name: string | null;
  type_label_he: string;
};

export async function getDueReminders(ctx: RequestContext): Promise<{ reminders: DueReminderDto[] }> {
  const orgId = assertOrg(ctx);
  const now = Date.now();
  const windowStart = new Date(now - 120_000); // look back 2 minutes
  const windowEnd = new Date(now + 5_000); // small lookahead to account for jitter

  const { data, error } = await supabaseAdmin
    .from('client_operational_notes')
    .select('id, body, reminder_at, client_id, type_code')
    .eq('organization_id', orgId)
    .not('reminder_at', 'is', null)
    .gte('reminder_at', windowStart.toISOString())
    .lt('reminder_at', windowEnd.toISOString())
    .order('reminder_at', { ascending: true })
    .limit(200);

  if (error) throw new AppError(500, error.message ?? 'Database error', 'SUPABASE_ERROR');
  const rows = (data ?? []) as Array<{ id: string; body: string; reminder_at: string; client_id: string; type_code: string }>;
  if (!rows.length) return { reminders: [] };

  const clientIds = [...new Set(rows.map((r) => r.client_id))];
  const typeCodes = [...new Set(rows.map((r) => r.type_code))];
  const [clientsRes, typesRes] = await Promise.all([
    supabaseAdmin.from('clients').select('id, display_name').in('id', clientIds),
    supabaseAdmin.from('client_operational_note_types').select('code, label_he').in('code', typeCodes),
  ]);

  if (clientsRes.error) throw clientsRes.error;
  if (typesRes.error) throw typesRes.error;

  const nameById = new Map(
    ((clientsRes.data ?? []) as Array<{ id: string; display_name: string | null }>).map((c) => [c.id, c.display_name]),
  );
  const labelByCode = new Map(
    ((typesRes.data ?? []) as Array<{ code: string; label_he: string }>).map((t) => [t.code, t.label_he]),
  );

  const reminders: DueReminderDto[] = rows.map((row) => ({
    id: row.id,
    body: row.body,
    reminder_at: row.reminder_at,
    client_id: row.client_id,
    client_name: nameById.get(row.client_id) ?? null,
    type_label_he: labelByCode.get(row.type_code) ?? row.type_code,
  }));

  return { reminders };
}

const CONFLICT_UI = {
  title_he: 'התנגשות בתזכורת',
  message_he:
    'במועד שבחרת כבר קיימת תזכורת ללקוח אחר. האם ליצור בכל זאת, או לשנות תאריך/שעה?',
  button_create_anyway_he: 'ליצור בכל זאת',
  button_change_time_he: 'לשנות מועד',
} as const;

export async function createOperationalNote(
  ctx: RequestContext,
  clientId: string,
  body: {
    type_code: string;
    body: string;
    reminder_at?: string | null;
    ignore_reminder_conflict?: boolean;
  },
): Promise<
  | { note: OperationalNoteDto; registryPreview: { notes_cell_text_he: string | null; operational_notes_count: number } }
  | { conflict: true; ui: typeof CONFLICT_UI; conflicts: ConflictRow[] }
> {
  const orgId = assertOrg(ctx);
  await ensureClientInOrg(orgId, clientId);
  const text = (body.body ?? '').trim();
  if (!text) throw badRequest('body required');

  const { data: typeRow } = await supabaseAdmin
    .from('client_operational_note_types')
    .select('code, allows_reminder, label_he')
    .eq('code', body.type_code)
    .maybeSingle();
  if (!typeRow) throw badRequest('Invalid type_code');

  let reminderAt: Date | null = null;
  if (body.reminder_at) {
    if (!typeRow.allows_reminder) throw badRequest('This note type does not allow a reminder time');
    reminderAt = new Date(body.reminder_at);
    if (Number.isNaN(reminderAt.getTime())) throw badRequest('Invalid reminder_at');
  }

  if (reminderAt && !body.ignore_reminder_conflict) {
    const conflicts = await findReminderConflicts(orgId, clientId, reminderAt);
    if (conflicts.length) {
      return { conflict: true, ui: CONFLICT_UI, conflicts };
    }
  }

  const insert = {
    organization_id: orgId,
    client_id: clientId,
    type_code: body.type_code,
    body: text,
    reminder_at: reminderAt ? reminderAt.toISOString() : null,
    created_by_user_id: ctx.user.id,
  };

  const { data: created, error } = await supabaseAdmin.from('client_operational_notes').insert(insert).select('id').single();
  if (error) throw new AppError(500, error.message ?? 'Database error', 'SUPABASE_ERROR');

  // Fetch only the created row (no full client notes list).
  const { data: createdRow, error: noteError } = await supabaseAdmin
    .from('client_operational_notes')
    .select('id, client_id, type_code, body, reminder_at, created_at, updated_at, client_operational_note_types(label_he)')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('id', created.id)
    .single();
  if (noteError) throw noteError;
  if (!createdRow) throw new Error('Note created but not found');

  const typeEmbedded = (createdRow as any).client_operational_note_types;
  const typeLabel = Array.isArray(typeEmbedded) ? typeEmbedded[0]?.label_he : typeEmbedded?.label_he;

  const note: OperationalNoteDto = {
    id: createdRow.id as string,
    client_id: createdRow.client_id as string,
    type_code: createdRow.type_code as string,
    type_label_he: (typeLabel as string | null | undefined) ?? (createdRow.type_code as string),
    body: createdRow.body as string,
    reminder_at: (createdRow.reminder_at as string | null) ?? null,
    created_at: createdRow.created_at as string,
    updated_at: createdRow.updated_at as string,
  };

  const registryPreview = await getClientNotesRegistryPreviewHe(orgId, clientId);
  return { note, registryPreview };
}

export async function updateOperationalNote(
  ctx: RequestContext,
  clientId: string,
  noteId: string,
  body: {
    type_code?: string;
    body?: string;
    reminder_at?: string | null;
    ignore_reminder_conflict?: boolean;
  },
): Promise<
  | { note: OperationalNoteDto; registryPreview: { notes_cell_text_he: string | null; operational_notes_count: number } }
  | { conflict: true; ui: typeof CONFLICT_UI; conflicts: ConflictRow[] }
> {
  const orgId = assertOrg(ctx);
  await ensureClientInOrg(orgId, clientId);

  const { data: existing } = await supabaseAdmin
    .from('client_operational_notes')
    .select('id, type_code, body, reminder_at')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('id', noteId)
    .maybeSingle();
  if (!existing) throw forbidden('Note not found');

  let typeCode = (body.type_code ?? existing.type_code) as string;
  const { data: typeRow } = await supabaseAdmin
    .from('client_operational_note_types')
    .select('code, allows_reminder, label_he')
    .eq('code', typeCode)
    .maybeSingle();
  if (!typeRow) throw badRequest('Invalid type_code');

  const text = body.body !== undefined ? (body.body ?? '').trim() : existing.body;
  if (!text) throw badRequest('body required');

  let reminderAt: Date | null =
    body.reminder_at === undefined
      ? existing.reminder_at
        ? new Date(existing.reminder_at as string)
        : null
      : body.reminder_at
        ? new Date(body.reminder_at)
        : null;

  if (body.reminder_at === '') reminderAt = null;

  if (reminderAt && Number.isNaN(reminderAt.getTime())) throw badRequest('Invalid reminder_at');
  if (!typeRow.allows_reminder) reminderAt = null;

  const oldMin = existing.reminder_at ? Math.floor(new Date(existing.reminder_at as string).getTime() / 60_000) : null;
  const newMin = reminderAt ? Math.floor(reminderAt.getTime() / 60_000) : null;
  const reminderTimeChanged = oldMin !== newMin;

  if (reminderAt && reminderTimeChanged && !body.ignore_reminder_conflict) {
    const conflicts = await findReminderConflicts(orgId, clientId, reminderAt);
    if (conflicts.length) {
      return { conflict: true, ui: CONFLICT_UI, conflicts };
    }
  }

  const { error } = await supabaseAdmin
    .from('client_operational_notes')
    .update({
      type_code: typeCode,
      body: text,
      reminder_at: reminderAt ? reminderAt.toISOString() : null,
    })
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('id', noteId);
  if (error) throw new AppError(500, error.message ?? 'Database error', 'SUPABASE_ERROR');

  // Fetch only the updated row (no full client notes list).
  const { data: noteRow, error: noteError } = await supabaseAdmin
    .from('client_operational_notes')
    .select('id, client_id, type_code, body, reminder_at, created_at, updated_at, client_operational_note_types(label_he)')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('id', noteId)
    .single();
  if (noteError) throw noteError;
  if (!noteRow) throw new Error('Note not found');

  const typeEmbedded = (noteRow as any).client_operational_note_types;
  const typeLabel = Array.isArray(typeEmbedded) ? typeEmbedded[0]?.label_he : typeEmbedded?.label_he;

  const note: OperationalNoteDto = {
    id: noteRow.id as string,
    client_id: noteRow.client_id as string,
    type_code: noteRow.type_code as string,
    type_label_he: (typeLabel as string | null | undefined) ?? (noteRow.type_code as string),
    body: noteRow.body as string,
    reminder_at: (noteRow.reminder_at as string | null) ?? null,
    created_at: noteRow.created_at as string,
    updated_at: noteRow.updated_at as string,
  };

  const registryPreview = await getClientNotesRegistryPreviewHe(orgId, clientId);
  return { note, registryPreview };
}

export async function deleteOperationalNote(ctx: RequestContext, clientId: string, noteId: string): Promise<void> {
  const orgId = assertOrg(ctx);
  await ensureClientInOrg(orgId, clientId);
  const { error } = await supabaseAdmin
    .from('client_operational_notes')
    .delete()
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .eq('id', noteId);
  if (error) throw new AppError(500, error.message ?? 'Database error', 'SUPABASE_ERROR');
}
