import { AppError } from './errors.js';

export type SupabaseErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

export function supabaseErrorMessage(error: SupabaseErrorLike | null | undefined): string {
  return String(error?.message ?? 'Database error');
}

export const PG_UNIQUE_VIOLATION = '23505';

export const PUBLIC_DATABASE_ERROR_MESSAGE =
  'לא ניתן להשלים את הפעולה כרגע. נסו שוב. אם הבעיה חוזרת — פנו לתמיכה.';

/** Postgres / PostgREST diagnostics that must never reach the browser. */
export function looksLikePostgresErrorMessage(message: string): boolean {
  const m = String(message ?? '');
  if (!m) return false;
  return /duplicate key|violates unique constraint|violates check constraint|violates foreign key|null value in column|does not exist|undefined_column|undefined_table|relation |column |syntax error at|PGRST\d+|postgres|supabase/i.test(
    m,
  );
}

export function publicSafeErrorMessage(
  message: string | null | undefined,
  fallback = PUBLIC_DATABASE_ERROR_MESSAGE,
): string {
  const m = String(message ?? '').trim();
  if (!m) return fallback;
  if (looksLikePostgresErrorMessage(m)) return fallback;
  return m;
}

export function isSupabaseUniqueViolation(error: SupabaseErrorLike | null | undefined): boolean {
  if (!error) return false;
  const code = String(error.code ?? '');
  if (code === PG_UNIQUE_VIOLATION) return true;
  return /duplicate key value violates unique constraint/i.test(supabaseErrorMessage(error));
}

/** Strip Postgres diagnostics from AppError.details before the HTTP body. */
export function publicErrorDetails(
  details: Record<string, unknown> | undefined | null,
): Record<string, unknown> | undefined {
  if (!details) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (key.startsWith('pg_') || key === 'migration_hint') continue;
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/** PostgREST: column not in schema cache. Postgres: undefined_column. */
export function isSupabaseMissingColumnError(
  error: SupabaseErrorLike | null | undefined,
  columnName?: string,
): boolean {
  if (!error) return false;
  const code = String(error.code ?? '');
  const message = supabaseErrorMessage(error).toLowerCase();
  if (code === 'PGRST204' || code === '42703') {
    if (!columnName) return true;
    return message.includes(columnName.toLowerCase());
  }
  if (columnName && message.includes(`column "${columnName.toLowerCase()}"`)) return true;
  if (columnName && message.includes(`'${columnName.toLowerCase()}' column`)) return true;
  return false;
}

/** PostgREST: table not in schema cache. Postgres: undefined_table. */
export function isSupabaseMissingTableError(
  error: SupabaseErrorLike | null | undefined,
  tableName?: string,
): boolean {
  if (!error) return false;
  const code = String(error.code ?? '');
  const message = supabaseErrorMessage(error).toLowerCase();
  if (code === 'PGRST205' || code === '42P01') {
    if (!tableName) return true;
    return message.includes(tableName.toLowerCase());
  }
  if (tableName && message.includes(tableName.toLowerCase())) return true;
  return false;
}

function schemaDriftAppError(context: string, error: SupabaseErrorLike, migrationHint?: string): AppError {
  const message = supabaseErrorMessage(error);
  const hint =
    migrationHint ??
    'Apply pending Supabase migrations for income_document_branding_profiles (130, 131).';
  return new AppError(503, `${context}: ${message}. ${hint}`, 'DB_SCHEMA_DRIFT', {
    context,
    pg_code: error.code,
    pg_details: error.details,
    pg_hint: error.hint,
    migration_hint: hint,
  });
}

/** Map PostgREST / Postgres errors to domain-safe AppError (never raw throw to HTTP 500/502). */
export function throwIfSupabaseError(
  error: SupabaseErrorLike | null | undefined,
  context: string,
  options?: { migrationHint?: string },
): void {
  if (!error) return;

  const code = String(error.code ?? '');
  const message = supabaseErrorMessage(error);
  const details = {
    context,
    pg_code: code || undefined,
    pg_details: error.details,
    pg_hint: error.hint,
  };

  if (code === 'PGRST116') {
    throw new AppError(409, `${context}: expected a single row`, 'DB_AMBIGUOUS_ROW', details);
  }
  if (code === '22P02' || code === '22023') {
    throw new AppError(400, `${context}: invalid identifier or value`, 'DB_INVALID_INPUT', details);
  }
  if (code === '23503') {
    throw new AppError(400, `${context}: related record missing`, 'DB_FOREIGN_KEY', details);
  }
  if (isSupabaseMissingColumnError(error) || isSupabaseMissingTableError(error)) {
    throw schemaDriftAppError(context, error, options?.migrationHint);
  }
  if (code === '42703') {
    throw schemaDriftAppError(context, error, options?.migrationHint);
  }
  if (code === '42501') {
    throw new AppError(403, `${context}: database permission denied`, 'DB_PERMISSION', details);
  }
  if (message.includes('income_documents business fields are immutable after issue')) {
    throw new AppError(409, `${context}: ${message}`, 'INCOME_DOCUMENT_IMMUTABLE_AFTER_ISSUE', details);
  }

  throw new AppError(500, `${context}: ${message}`, 'SUPABASE_ERROR', details);
}
