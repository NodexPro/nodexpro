import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS } from '../../shared/audit-events.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import { buildHistoryReportPdfBuffer } from './client-history-report-pdf.js';
const MODULE_CODE = 'client-operations';
const RETENTION_MONTHS = 12;
const PREVIEW_LIMIT = 3;
const DETAIL_LIMIT = 500;
function assertOrg(ctx) {
    const orgId = ctx.organizationId;
    if (!orgId)
        throw forbidden('Active organization required');
    return orgId;
}
function hasPerm(ctx, code) {
    return (ctx.membership?.permissions ?? []).includes(code);
}
function canViewHistoryTab(ctx) {
    return hasPerm(ctx, 'client_operations.view');
}
function retentionCutoffIso() {
    const d = new Date();
    d.setMonth(d.getMonth() - RETENTION_MONTHS);
    return d.toISOString();
}
function formatDateTimeHe(iso) {
    try {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime()))
            return iso;
        return new Intl.DateTimeFormat('he-IL', {
            dateStyle: 'short',
            timeStyle: 'short',
        }).format(d);
    }
    catch {
        return iso;
    }
}
function parsePayload(p) {
    return p && typeof p === 'object' && !Array.isArray(p) ? p : {};
}
const SECTION_ORDER = [
    { key: 'client_profile', title_he: 'פרטי לקוח' },
    { key: 'taxes', title_he: 'מיסים' },
    { key: 'accounting', title_he: `הגדרות הנה\u05F4ח` },
    { key: 'fees', title_he: `שכ\u05F4ט` },
    { key: 'payroll', title_he: 'שכר' },
    { key: 'annual', title_he: 'דוח שנתי' },
    { key: 'documents', title_he: 'מסמכים' },
    { key: 'history_system', title_he: 'מערכת' },
];
const KNOWN_SECTION_KEYS = new Set(SECTION_ORDER.map((s) => s.key));
function sectionTitleHe(key) {
    return SECTION_ORDER.find((s) => s.key === key)?.title_he ?? key;
}
function csvEscapeCell(value) {
    const s = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (/[",\n]/.test(s))
        return `"${s.replace(/"/g, '""')}"`;
    return s;
}
function formatExportPeriodHe(fromD, toD) {
    if (fromD && toD)
        return `מ-${fromD} עד ${toD}`;
    if (fromD)
        return `מ-${fromD}`;
    if (toD)
        return `עד ${toD}`;
    return `${RETENTION_MONTHS} החודשים האחרונים (לפי תצוגת ההיסטוריה במערכת)`;
}
/** UTF-8 CSV with Hebrew headers — opens in Excel; no raw audit payload. */
function buildHistoryReportCsv(params) {
    const lines = [
        csvEscapeCell('דוח היסטוריית פעולות'),
        `${csvEscapeCell('לקוח')},${csvEscapeCell(params.clientDisplayName)}`,
        `${csvEscapeCell('היקף סקציה')},${csvEscapeCell(params.sectionScopeHe)}`,
        `${csvEscapeCell('תקופה')},${csvEscapeCell(params.periodHe)}`,
        '',
        [
            csvEscapeCell('\u05EA\u05D0\u05E8\u05D9\u05DA \u05D5\u05E9\u05E2\u05D4'),
            csvEscapeCell('משתמש'),
            csvEscapeCell('תיאור הפעולה'),
            csvEscapeCell('סקציה'),
        ].join(','),
    ];
    for (const r of params.rows) {
        lines.push([
            csvEscapeCell(r.occurred_display_he),
            csvEscapeCell(r.actor_display_name || '—'),
            csvEscapeCell(r.summary_he),
            csvEscapeCell(r.section_title_he),
        ].join(','));
    }
    return lines.join('\r\n');
}
/** Map raw audit row → history section + display fields (read model only; nothing persisted). */
export function mapAuditRowToHistoryEvent(row) {
    const action = String(row.action ?? '');
    const entityType = String(row.entity_type ?? '');
    const payload = parsePayload(row.payload_json);
    if (action === AUDIT_ACTIONS.CLIENT_OPERATIONS_WORKSPACE_PROFILE_UPDATED) {
        const changes = payload.changes && typeof payload.changes === 'object' ? payload.changes : {};
        const keys = Object.keys(changes);
        return {
            section_key: 'client_profile',
            action_type: 'client_profile_update',
            summary_he: keys.length > 0 ? `עודכנו פרטי לקוח (${keys.length} שדות)` : 'עודכנו פרטי לקוח',
            metadata_preview: { changes },
        };
    }
    if (action === AUDIT_ACTIONS.PAYMENT_CARD_ACCESS_CODE_SENT ||
        action === AUDIT_ACTIONS.PAYMENT_CARD_ACCESS_VERIFIED) {
        return {
            section_key: 'taxes',
            action_type: action,
            summary_he: 'פעולת גישה מאובטחת לכרטיס תשלום',
            metadata_preview: {},
        };
    }
    if (action === AUDIT_ACTIONS.CLIENT_TAX_SETTINGS_UPDATED || action === AUDIT_ACTIONS.CLIENT_TAX_PAYMENT_SECRET_REVEALED) {
        const rule = payload.rule != null ? String(payload.rule) : '';
        if (action === AUDIT_ACTIONS.CLIENT_TAX_PAYMENT_SECRET_REVEALED) {
            const sk = payload.secret_kind != null ? String(payload.secret_kind) : '';
            return {
                section_key: 'taxes',
                action_type: 'tax_payment_secret_revealed',
                summary_he: sk ? `גילוי נתוני תשלום (${sk})` : 'גילוי נתוני תשלום',
                metadata_preview: { secret_kind: sk || null },
            };
        }
        return {
            section_key: 'taxes',
            action_type: 'tax_settings_update',
            summary_he: rule ? `עודכנו הגדרות מיסים — ${rule}` : 'עודכנו הגדרות מיסים',
            metadata_preview: { rule: rule || null },
        };
    }
    if (action === AUDIT_ACTIONS.CLIENT_ACCOUNTING_SETTINGS_UPDATED ||
        action === AUDIT_ACTIONS.CLIENT_ACCOUNTING_VEHICLES_REPLACED ||
        action === AUDIT_ACTIONS.CLIENT_ACCOUNTING_BUSINESS_PROFILE_CREATED ||
        action === AUDIT_ACTIONS.CLIENT_ACCOUNTING_BUSINESS_PROFILE_UPDATED ||
        action === AUDIT_ACTIONS.ACCOUNTING_SETTINGS_EXPENSES_UPDATED ||
        action === AUDIT_ACTIONS.ACCOUNTING_SETTINGS_INCOME_UPDATED ||
        action === AUDIT_ACTIONS.ACCOUNTING_SETTINGS_DOCUMENTS_UPDATED ||
        action === AUDIT_ACTIONS.ACCOUNTING_SETTINGS_VEHICLES_UPDATED ||
        action === AUDIT_ACTIONS.ACCOUNTING_SETTINGS_EXPENSE_MANAGEMENT_UPDATED) {
        return {
            section_key: 'accounting',
            action_type: action,
            summary_he: `עודכנו הגדרות הנה\u05F4ח`,
            metadata_preview: { entity_type: entityType },
        };
    }
    if (action === AUDIT_ACTIONS.CLIENT_FEE_AGREEMENT_UPDATED) {
        const cmd = payload.command != null ? String(payload.command) : 'update_fee_agreement';
        const summaries = {
            update_fee_agreement: `עודכן הסכם שכ\u05F4ט`,
            add_fee_service_line: 'נוספה שורת שירות בהסכם',
            update_fee_service_line: 'עודכנה שורת שירות בהסכם',
            remove_fee_service_line: 'הוסרה שורת שירות מההסכם',
            add_custom_fee_service_line: 'נוסף שדה מותאם בהסכם',
            update_custom_fee_service_line: 'עודכן שדה מותאם בהסכם',
            remove_custom_fee_service_line: 'הוסר שדה מותאם מההסכם',
        };
        const base = summaries[cmd] ?? `פעולת שכ\u05F4ט: ${cmd}`;
        return {
            section_key: 'fees',
            action_type: cmd,
            summary_he: base,
            metadata_preview: {
                command: cmd,
                agreement_id: payload.agreement_id ?? null,
                line_id: payload.line_id ?? null,
                line_kind: payload.line_kind ?? null,
            },
        };
    }
    if (action === AUDIT_ACTIONS.CLIENT_PAYROLL_UPDATED) {
        const cmd = payload.command != null ? String(payload.command) : 'payroll_update';
        const keys = Array.isArray(payload.changed_keys) ? payload.changed_keys.map(String) : [];
        return {
            section_key: 'payroll',
            action_type: cmd,
            summary_he: keys.length ? `עודכן שכר — ${cmd} (${keys.length} שדות)` : `עודכן שכר — ${cmd}`,
            metadata_preview: { command: cmd, changed_keys: keys },
        };
    }
    if (action === AUDIT_ACTIONS.CLIENT_ANNUAL_REPORT_UPDATED) {
        const cmd = payload.workspace_command != null ? String(payload.workspace_command) : String(payload.command ?? 'annual_update');
        return {
            section_key: 'annual',
            action_type: cmd,
            summary_he: `דוח שנתי — ${cmd}`,
            metadata_preview: { command: cmd },
        };
    }
    if (action === AUDIT_ACTIONS.CLIENT_DOCUMENTS_WORKSPACE_UPDATED) {
        const cmd = payload.workspace_command != null ? String(payload.workspace_command) : String(payload.command ?? '');
        const labels = {
            initialize_client_document_folders: 'אותחלו תיקיות מסמכים',
            create_client_document_folder: 'נוצרה תיקיית מסמכים',
            rename_client_document_folder: 'שונה שם תיקייה',
            archive_or_delete_client_document_folder: 'תיקייה הועברה לארכיון / נמחקה',
            upload_client_document: 'הועלה מסמך ללקוח',
            delete_client_document: 'נמחק מסמך',
        };
        return {
            section_key: 'documents',
            action_type: cmd || 'documents_workspace',
            summary_he: labels[cmd] ?? (cmd ? `מסמכים — ${cmd}` : 'עודכנו מסמכי לקוח'),
            metadata_preview: {
                workspace_command: cmd || null,
                folder_id: payload.folder_id ?? null,
                document_id: payload.document_id ?? null,
                file_asset_id: payload.file_asset_id ?? null,
            },
        };
    }
    if (action === AUDIT_ACTIONS.CLIENT_FILE_ATTACHED) {
        const ctxLabel = payload.context != null ? String(payload.context) : '';
        const fileName = payload.file_name != null ? String(payload.file_name) : '';
        if (ctxLabel === 'annual_report_upload') {
            return {
                section_key: 'annual',
                action_type: 'annual_file_uploaded',
                summary_he: fileName ? `הועלה קובץ לדוח שנתי — ${fileName}` : 'הועלה קובץ לדוח שנתי',
                metadata_preview: { file_asset_id: payload.file_asset_id ?? null, file_name: fileName || null },
            };
        }
        if (ctxLabel === 'client_documents_upload') {
            return {
                section_key: 'documents',
                action_type: 'document_file_staged',
                summary_he: fileName ? `קובץ הועלה (לפני קישור למסמך) — ${fileName}` : 'קובץ הועלה (לפני קישור למסמך)',
                metadata_preview: { file_asset_id: payload.file_asset_id ?? null },
            };
        }
        return {
            section_key: 'documents',
            action_type: 'file_attached',
            summary_he: 'קובץ צורף ללקוח',
            metadata_preview: { context: ctxLabel || null },
        };
    }
    if (action === AUDIT_ACTIONS.FILE_OPENED) {
        if (entityType === 'client_annual_report_file') {
            return {
                section_key: 'annual',
                action_type: 'annual_file_opened',
                summary_he: 'נפתח קובץ דוח שנתי (קישור חתום)',
                metadata_preview: { file_asset_id: payload.file_asset_id ?? null },
            };
        }
        if (entityType === 'client_documents_workspace') {
            return {
                section_key: 'documents',
                action_type: 'document_file_opened',
                summary_he: 'נפתח קובץ מסמך (קישור חתום)',
                metadata_preview: { file_asset_id: payload.file_asset_id ?? null },
            };
        }
        return {
            section_key: 'history_system',
            action_type: 'file_opened',
            summary_he: 'נפתח קובץ',
            metadata_preview: { entity_type: entityType },
        };
    }
    if (action === AUDIT_ACTIONS.CLIENT_OBLIGATION_COMMAND_EXECUTED) {
        const rawCmd = payload.command != null ? String(payload.command) : 'obligation_command';
        const cmd = rawCmd.trim();
        const obligationType = payload.obligation_type != null ? String(payload.obligation_type) : '';
        const periodKey = payload.period_key != null ? String(payload.period_key) : '';
        const niDeductionsCmd = cmd.startsWith('set_ni_deductions') || cmd.startsWith('mark_ni_deductions') || cmd.startsWith('touch_ni_deductions');
        const payrollPeriodCmd = cmd.startsWith('set_payroll_period') || cmd.startsWith('mark_payroll_period');
        const subjectHe = payrollPeriodCmd
            ? 'שכר (תקופה)'
            : niDeductionsCmd
                ? 'ביטוח לאומי ניכויים'
                : obligationType === 'national_insurance_self_employed_payment'
                    ? 'ביטוח לאומי עצמאי'
                    : obligationType === 'vat_report'
                        ? 'מע״מ'
                        : obligationType === 'income_tax_advance'
                            ? 'מקדמות מס הכנסה'
                            : obligationType === 'payroll_data'
                                ? 'שכר'
                                : 'התחייבויות';
        const cmdToHuman = {
            mark_ni_paid: { button_he: 'שולם', result_he: 'סומן כשולם' },
            mark_ni_not_paid: { button_he: 'עדיין לא שולם', result_he: 'סומן כלא שולם' },
            mark_ni_not_relevant: { button_he: 'לא רלוונטי', result_he: 'סומן כלא רלוונטי' },
            set_ni_standing_order: { button_he: 'קיימת הוראת קבע', result_he: 'עודכן סטטוס הוראת קבע' },
            update_ni_payment_amount: { button_he: 'עדכון סכום לתשלום', result_he: 'עודכן סכום לתשלום' },
            set_ni_deductions_reminder_suppressed: { button_he: 'לא להציג תזכורת החודש', result_he: 'עודכן דיכוי תזכורת ניכויים' },
            set_ni_deductions_step: { button_he: 'עדכון שלב ניכויים', result_he: 'עודכן שלב בתהליך ניכויים' },
            mark_ni_deductions_payroll_in_progress: { button_he: 'משכורות בטיפול', result_he: 'נרשם מעקב — משכורות בטיפול' },
            mark_ni_deductions_reported_and_paid: { button_he: 'דווח ושולם', result_he: 'סומן דווח ושולם (ניכויים)' },
            mark_ni_deductions_not_relevant: { button_he: 'לא רלוונטי', result_he: 'סומן לא רלוונטי (ניכויים)' },
            touch_ni_deductions_auto_reminder_shown: { button_he: 'תזכורת ניכויים (אוטומטית)', result_he: 'נרשמה הצגת תזכורת' },
            set_payroll_period_salary_data_received: { button_he: 'נתוני שכר התקבלו', result_he: 'עודכן שלב שכר' },
            set_payroll_period_sent_to_employer: { button_he: 'משכורות נשלחו למעסיק', result_he: 'עודכן שלב שכר' },
            set_payroll_period_no_salaries: { button_he: 'אין משכורות החודש', result_he: 'עודכן שלב שכר' },
            mark_payroll_period_not_relevant: { button_he: 'לא רלוונטי (שכר)', result_he: 'תקופת שכר סומנה לא רלוונטית' },
            mark_obligation_reported: { button_he: 'סמן כהוגש', result_he: 'סומן כהוגש' },
            mark_obligation_reported_and_paid: { button_he: 'סמן כהוגש ושולם', result_he: 'סומן כהוגש ושולם' },
            mark_obligation_not_reported: { button_he: 'סמן כלא דווח', result_he: 'סומן כלא דווח' },
            notify_client_payment_amount: { button_he: 'עדכן סכום לתשלום', result_he: 'נשלח לעדכון סכום לתשלום' },
            send_docflow_request: { button_he: 'שלח בקשת מסמכים (DocFlow)', result_he: 'נשלחה בקשה ללקוח' },
            approve_docflow_reminder_send: { button_he: 'אישור שליחה', result_he: 'אושר ושלח ללקוח' },
            dismiss_docflow_reminder: { button_he: 'ביטול בקשה', result_he: 'בוטלה בקשה ללקוח' },
            mark_material_received: { button_he: 'סמן חומר כהתקבל', result_he: 'סומן כחומר התקבל' },
            mark_salary_data_received: { button_he: 'סמן נתוני שכר כהתקבלו', result_he: 'סומן שנתוני שכר התקבלו' },
            mark_income_data_received: { button_he: 'סמן הכנסות כהתקבלו', result_he: 'סומן שהכנסות התקבלו' },
            mark_material_not_relevant: { button_he: 'סמן חומר לא רלוונטי', result_he: 'סומן כלא רלוונטי' },
            mark_salary_data_not_relevant: { button_he: 'סמן שכר לא רלוונטי', result_he: 'סומן כלא רלוונטי' },
            mark_income_data_not_relevant: { button_he: 'סמן הכנסות לא רלוונטי', result_he: 'סומן כלא רלוונטי' },
        };
        // Backward/legacy aliases (old payloads / UI labels) — map to the same human text.
        const aliases = {
            mark_paid: 'mark_ni_paid',
            mark_not_paid: 'mark_ni_not_paid',
            update_amount: 'update_ni_payment_amount',
            // Hebrew labels that might have been stored historically (if any)
            'שולם': 'mark_ni_paid',
            'עדכן סכום': 'update_ni_payment_amount',
            'עדכון סכום': 'update_ni_payment_amount',
            'קיימת הוראת קבע': 'set_ni_standing_order',
            'עדיין לא שולם': 'mark_ni_not_paid',
            'לא רלוונטי': 'mark_ni_not_relevant',
        };
        const canonical = cmdToHuman[cmd] ? cmd : (aliases[cmd] ?? cmd);
        const human = cmdToHuman[canonical] ?? { button_he: cmd, result_he: 'בוצעה פעולה' };
        const scopeHe = periodKey ? ` (${periodKey})` : '';
        return {
            section_key: 'history_system',
            action_type: canonical,
            summary_he: `לחץ "${human.button_he}" → ${human.result_he} (${subjectHe}${scopeHe})`,
            metadata_preview: {
                command: cmd,
                canonical_command: canonical,
                obligation_id: payload.obligation_id ?? null,
                obligation_type: obligationType || null,
                period_key: periodKey || null,
            },
        };
    }
    if (action === AUDIT_ACTIONS.CLIENT_TASK_COMMAND_EXECUTED) {
        const cmd = payload.command != null ? String(payload.command) : 'task_command';
        const taskId = payload.task_id != null ? String(payload.task_id) : '';
        const cmdToHuman = {
            resolve_task: { button_he: 'סמן כטופל', result_he: 'המשימה נסגרה' },
            snooze_task: { button_he: 'דחייה', result_he: 'המשימה נדחתה' },
            reopen_task: { button_he: 'פתיחה מחדש', result_he: 'המשימה נפתחה מחדש' },
        };
        const human = cmdToHuman[cmd] ?? { button_he: cmd, result_he: 'בוצעה פעולה' };
        const idHe = taskId ? ` (task: ${taskId})` : '';
        return {
            section_key: 'history_system',
            action_type: cmd,
            summary_he: `משימות — לחץ "${human.button_he}" → ${human.result_he}${idHe}`,
            metadata_preview: { command: cmd, task_id: taskId || null },
        };
    }
    if (action === AUDIT_ACTIONS.CLIENT_OPERATIONS_NIGHT_PASS_EXECUTED) {
        const processed = payload.processed_clients != null ? Number(payload.processed_clients) : null;
        const asOf = payload.as_of_date != null ? String(payload.as_of_date) : null;
        return {
            section_key: 'history_system',
            action_type: 'night_pass',
            summary_he: `מערכת — ריצת לילה בוצעה${processed != null ? ` (${processed} לקוחות)` : ''}${asOf ? ` · תאריך: ${asOf}` : ''}`,
            metadata_preview: { processed_clients: processed, as_of_date: asOf },
        };
    }
    return {
        section_key: 'history_system',
        action_type: action || 'unknown',
        summary_he: `אירוע: ${action || '—'}`,
        metadata_preview: { entity_type: entityType },
    };
}
async function loadActorLabels(orgId, userIds) {
    const uniq = [...new Set(userIds.filter(Boolean))];
    const out = new Map();
    if (uniq.length === 0)
        return out;
    const { data, error } = await supabaseAdmin
        .from('organization_users')
        .select('user_id, users!organization_users_user_id_fkey(email, full_name)')
        .eq('organization_id', orgId)
        .in('user_id', uniq);
    if (error)
        return out;
    for (const r of (data ?? [])) {
        const uRaw = r.users;
        const u = Array.isArray(uRaw) ? uRaw[0] : uRaw;
        if (!u)
            continue;
        const name = u.full_name?.trim() ? u.full_name.trim() : (u.email ?? '');
        out.set(r.user_id, name || r.user_id);
    }
    return out;
}
async function fetchClientAuditRows(orgId, clientId, cutoffIso) {
    const orFilter = `entity_id.eq.${clientId},payload_json->>client_id.eq.${clientId}`;
    const { data, error } = await supabaseAdmin
        .from('audit_log')
        .select('id, action, entity_type, entity_id, actor_user_id, payload_json, created_at')
        .eq('organization_id', orgId)
        .eq('module_code', MODULE_CODE)
        .gte('created_at', cutoffIso)
        .or(orFilter)
        .order('created_at', { ascending: false })
        .limit(4000);
    if (error)
        throw new AppError(500, error.message ?? 'audit query failed', 'SUPABASE_ERROR');
    return (data ?? []);
}
function rowToEnvelope(row, mapped, actorLabel) {
    return {
        event_id: row.id,
        occurred_at: row.created_at,
        occurred_display_he: formatDateTimeHe(row.created_at),
        actor_display_name: actorLabel,
        summary_he: mapped.summary_he,
        action_type: mapped.action_type,
        metadata_preview: mapped.metadata_preview,
        section_key: mapped.section_key,
    };
}
export async function getClientHistoryTabReadModel(ctx, clientId, openSection) {
    const orgId = assertOrg(ctx);
    if (!canViewHistoryTab(ctx))
        return null;
    const cutoffIso = retentionCutoffIso();
    const rows = await fetchClientAuditRows(orgId, clientId, cutoffIso);
    const mappedRows = [];
    const actorIds = rows.map((r) => r.actor_user_id).filter((x) => Boolean(x));
    const labels = await loadActorLabels(orgId, actorIds);
    let maxTs = 0;
    for (const row of rows) {
        const mapped = mapAuditRowToHistoryEvent(row);
        if (!mapped)
            continue;
        const label = row.actor_user_id ? labels.get(row.actor_user_id) ?? null : null;
        const env = rowToEnvelope(row, mapped, label);
        mappedRows.push(env);
        const t = Date.parse(row.created_at);
        if (Number.isFinite(t) && t > maxTs)
            maxTs = t;
    }
    const bySection = new Map();
    for (const s of SECTION_ORDER) {
        bySection.set(s.key, []);
    }
    for (const e of mappedRows) {
        bySection.get(e.section_key)?.push(e);
    }
    const sections = SECTION_ORDER.map(({ key, title_he }) => {
        const list = bySection.get(key) ?? [];
        const latest_events = list.slice(0, PREVIEW_LIMIT).map((e) => ({
            event_id: e.event_id,
            occurred_at: e.occurred_at,
            occurred_display_he: e.occurred_display_he,
            actor_display_name: e.actor_display_name,
            summary_he: e.summary_he,
            action_type: e.action_type,
        }));
        return {
            section_key: key,
            title_he: title_he,
            latest_events,
            total_events_in_last_12_months: list.length,
            can_open: list.length > 0,
        };
    });
    let open_section = null;
    if (openSection && KNOWN_SECTION_KEYS.has(openSection.section_key)) {
        const fromD = openSection.from_date?.trim() || null;
        const toD = openSection.to_date?.trim() || null;
        const fromMs = fromD ? Date.parse(`${fromD}T00:00:00.000Z`) : null;
        const toMs = toD ? Date.parse(`${toD}T23:59:59.999Z`) : null;
        const filtered = (bySection.get(openSection.section_key) ?? []).filter((e) => {
            const t = Date.parse(e.occurred_at);
            if (fromMs != null && Number.isFinite(fromMs) && t < fromMs)
                return false;
            if (toMs != null && Number.isFinite(toMs) && t > toMs)
                return false;
            return true;
        });
        const detail = filtered.slice(0, DETAIL_LIMIT).map((e) => ({
            event_id: e.event_id,
            occurred_at: e.occurred_at,
            occurred_display_he: e.occurred_display_he,
            actor_display_name: e.actor_display_name,
            summary_he: e.summary_he,
            action_type: e.action_type,
            metadata_preview: e.metadata_preview,
        }));
        open_section = {
            section_key: openSection.section_key,
            title_he: sectionTitleHe(openSection.section_key),
            range: { from_date: fromD, to_date: toD },
            events: detail,
            total_count: filtered.length,
            can_export: true,
        };
    }
    return {
        tab_key: 'history',
        read_model_version: maxTs > 0 ? maxTs : Date.now(),
        permissions: { can_view: true, can_export: true },
        ui: {
            title_he: 'היסטוריית פעולות',
            empty_state_he: 'אין אירועים בטווח הזמן המוצג.',
            retention_notice_he: `מוצגות פעולות מ-${RETENTION_MONTHS} החודשים האחרונים בלבד.`,
            retention_archival_todo_he: 'TODO: ארכוב / מחיקה פיזית של אירועים ישנים — אינה ממומשת במערכת כרגע.',
        },
        sections,
        open_section,
    };
}
export async function executeClientHistoryTabCommand(ctx, clientId, body) {
    const orgId = assertOrg(ctx);
    if (!canViewHistoryTab(ctx))
        throw forbidden('Insufficient permission');
    const { data: c } = await supabaseAdmin.from('clients').select('id').eq('organization_id', orgId).eq('id', clientId).maybeSingle();
    if (!c)
        throw forbidden('Client not found');
    if (!body?.type)
        throw badRequest('פקודה לא תקינה');
    if (body.type === 'close_history_section') {
        return null;
    }
    if (body.type === 'open_history_section') {
        const p = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : {};
        const sk = String(p.section_key ?? '').trim();
        if (!sk || !KNOWN_SECTION_KEYS.has(sk))
            throw badRequest('section_key לא חוקי');
        const from_date = p.from_date != null && p.from_date !== '' ? String(p.from_date) : null;
        const to_date = p.to_date != null && p.to_date !== '' ? String(p.to_date) : null;
        return { section_key: sk, from_date, to_date };
    }
    throw badRequest('סוג פקודה לא מוכר');
}
/**
 * Human-readable export: Excel (UTF-8 CSV) or PDF (pdf-lib + Noto Sans Hebrew woff).
 * Does not expose raw `payload_json` or technical audit keys to the file content.
 */
export async function exportClientHistoryReport(ctx, clientId, body) {
    const orgId = assertOrg(ctx);
    if (!canViewHistoryTab(ctx))
        throw forbidden('Insufficient permission');
    const fmt = body.format === 'pdf' ? 'pdf' : body.format === 'excel' ? 'excel' : null;
    if (!fmt)
        throw badRequest('יש לבחור פורמט דוח: pdf או excel');
    const { data: clientRow } = await supabaseAdmin
        .from('clients')
        .select('id, display_name')
        .eq('organization_id', orgId)
        .eq('id', clientId)
        .maybeSingle();
    if (!clientRow)
        throw forbidden('Client not found');
    const clientDisplayName = String(clientRow.display_name ?? '').trim() || '—';
    const skFilter = body.section_key && String(body.section_key).trim() ? String(body.section_key).trim() : null;
    if (skFilter && !KNOWN_SECTION_KEYS.has(skFilter))
        throw badRequest('section_key לא חוקי');
    const fromD = body.from_date?.trim() || null;
    const toD = body.to_date?.trim() || null;
    const fromMs = fromD ? Date.parse(`${fromD}T00:00:00.000Z`) : null;
    const toMs = toD ? Date.parse(`${toD}T23:59:59.999Z`) : null;
    const sectionScopeHe = skFilter ? sectionTitleHe(skFilter) : 'כל הסקציות';
    const periodHe = formatExportPeriodHe(fromD, toD);
    const cutoffIso = retentionCutoffIso();
    const rows = await fetchClientAuditRows(orgId, clientId, cutoffIso);
    const actorIds = rows.map((r) => r.actor_user_id).filter((x) => Boolean(x));
    const labels = await loadActorLabels(orgId, actorIds);
    const humanRows = [];
    for (const row of rows) {
        const mapped = mapAuditRowToHistoryEvent(row);
        if (!mapped)
            continue;
        const t = Date.parse(row.created_at);
        if (fromMs != null && Number.isFinite(fromMs) && t < fromMs)
            continue;
        if (toMs != null && Number.isFinite(toMs) && t > toMs)
            continue;
        if (skFilter && mapped.section_key !== skFilter)
            continue;
        const label = row.actor_user_id ? labels.get(row.actor_user_id) ?? null : null;
        const env = rowToEnvelope(row, mapped, label);
        humanRows.push({
            occurred_display_he: env.occurred_display_he,
            actor_display_name: env.actor_display_name,
            summary_he: env.summary_he,
            section_title_he: sectionTitleHe(mapped.section_key),
        });
    }
    const safeSlug = clientId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 12) || 'client';
    if (fmt === 'pdf') {
        try {
            const buf = await buildHistoryReportPdfBuffer({
                clientDisplayName,
                sectionScopeHe,
                periodHe,
                rows: humanRows,
            });
            return {
                contentType: 'application/pdf',
                dispositionFilename: `history-report-${safeSlug}.pdf`,
                body: buf,
            };
        }
        catch (e) {
            console.error('[client-history export pdf]', e);
            throw new AppError(500, 'לא ניתן להפיק את דוח ה-PDF כרגע. נסה שוב או השתמש בייצוא לאקסל.', 'PDF_EXPORT_FAILED');
        }
    }
    const csv = buildHistoryReportCsv({
        clientDisplayName,
        sectionScopeHe,
        periodHe,
        rows: humanRows,
    });
    return {
        contentType: 'text/csv; charset=utf-8',
        dispositionFilename: `history-report-${safeSlug}.csv`,
        body: Buffer.from(`\uFEFF${csv}`, 'utf8'),
    };
}
