import { AppError } from './errors.js';

type SupabaseErrorLike = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

/** Map PostgREST / Postgres errors to domain-safe AppError (never raw throw to HTTP 500). */
export function throwIfSupabaseError(
  error: SupabaseErrorLike | null | undefined,
  context: string,
): void {
  if (!error) return;

  const code = String(error.code ?? '');
  const message = String(error.message ?? 'Database error');
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
  if (code === '42703') {
    throw new AppError(
      500,
      `${context}: database schema is out of date (${message})`,
      'DB_SCHEMA_DRIFT',
      details,
    );
  }
  if (code === '42501') {
    throw new AppError(403, `${context}: database permission denied`, 'DB_PERMISSION', details);
  }

  throw new AppError(502, message, 'SUPABASE_ERROR', details);
}
