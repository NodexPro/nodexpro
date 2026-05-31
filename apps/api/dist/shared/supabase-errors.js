import { AppError } from './errors.js';
export function supabaseErrorMessage(error) {
    return String(error?.message ?? 'Database error');
}
/** PostgREST: column not in schema cache. Postgres: undefined_column. */
export function isSupabaseMissingColumnError(error, columnName) {
    if (!error)
        return false;
    const code = String(error.code ?? '');
    const message = supabaseErrorMessage(error).toLowerCase();
    if (code === 'PGRST204' || code === '42703') {
        if (!columnName)
            return true;
        return message.includes(columnName.toLowerCase());
    }
    if (columnName && message.includes(`column "${columnName.toLowerCase()}"`))
        return true;
    if (columnName && message.includes(`'${columnName.toLowerCase()}' column`))
        return true;
    return false;
}
/** PostgREST: table not in schema cache. Postgres: undefined_table. */
export function isSupabaseMissingTableError(error, tableName) {
    if (!error)
        return false;
    const code = String(error.code ?? '');
    const message = supabaseErrorMessage(error).toLowerCase();
    if (code === 'PGRST205' || code === '42P01') {
        if (!tableName)
            return true;
        return message.includes(tableName.toLowerCase());
    }
    if (tableName && message.includes(tableName.toLowerCase()))
        return true;
    return false;
}
function schemaDriftAppError(context, error, migrationHint) {
    const message = supabaseErrorMessage(error);
    const hint = migrationHint ??
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
export function throwIfSupabaseError(error, context, options) {
    if (!error)
        return;
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
    throw new AppError(500, `${context}: ${message}`, 'SUPABASE_ERROR', details);
}
