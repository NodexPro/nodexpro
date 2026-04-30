import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError, badRequest, forbidden } from '../../shared/errors.js';
import { businessDayOfMonth, businessMonthKey, businessPreviousMonthKey, businessYmd } from '../../shared/business-time.js';
function assertOrg(ctx) {
    const orgId = ctx.organizationId;
    if (!orgId)
        throw forbidden('Active organization required');
    return orgId;
}
async function ensureClientInOrg(orgId, clientId) {
    const { data } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('organization_id', orgId)
        .eq('id', clientId)
        .maybeSingle();
    if (!data)
        throw forbidden('Client not found');
}
function fmtDateHe(dateLike) {
    if (!dateLike)
        return null;
    const d = new Date(`${dateLike}T00:00:00.000Z`);
    if (Number.isNaN(d.getTime()))
        return null;
    return d.toLocaleDateString('he-IL');
}
function ymd(d) {
    return businessYmd(d);
}
function monthKey(d) {
    return businessMonthKey(d);
}
function periodKeyToDisplayHe(periodKey) {
    const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
    if (!m)
        return periodKey;
    return `${m[2]}/${m[1]}`;
}
function incomeTaxDeductionsPeriodDisplayHe(periodKey) {
    const parts = periodKey.split('_');
    if (parts.length === 2 && /^\d{4}-\d{2}$/.test(parts[0]) && /^\d{4}-\d{2}$/.test(parts[1])) {
        return `${periodKeyToDisplayHe(parts[0])}–${periodKeyToDisplayHe(parts[1])}`;
    }
    return periodKeyToDisplayHe(periodKey);
}
function normalizeIncomeTaxDeductionsFrequency(raw) {
    const s = String(raw ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '_');
    if (!s)
        return null;
    if (s === 'monthly' || s === 'חד_חודשי')
        return 'monthly';
    if (s === 'bi_monthly' || s === 'דו_חודשי')
        return 'bi_monthly';
    if (s === 'semi_annual' || s === 'חצי_שנתי')
        return 'semi_annual';
    return null;
}
function joinIncomeTaxDeductionsPeriodKey(a, b) {
    return a <= b ? `${a}_${b}` : `${b}_${a}`;
}
/** Asia/Jerusalem; payroll_period_key for monthly = previous month; composite keys for bi-monthly / semi-annual. */
function resolveIncomeTaxDeductionsRequirement(now, frequency) {
    const ymdStr = businessYmd(now);
    const y = Number(ymdStr.slice(0, 4));
    const m = Number(ymdStr.slice(5, 7));
    const curMonthKey = businessMonthKey(now);
    const prevKey = businessPreviousMonthKey(now);
    if (frequency === 'monthly') {
        const due = `${curMonthKey}-15`;
        return {
            is_required: true,
            due_date: due,
            period_key: prevKey,
            period_label: periodKeyToDisplayHe(prevKey),
        };
    }
    if (frequency === 'bi_monthly') {
        const reportingMonths = new Set([1, 3, 5, 7, 9, 11]);
        if (!reportingMonths.has(m)) {
            return { is_required: false, due_date: '', period_key: '', period_label: '' };
        }
        let y1;
        let m1;
        let y2;
        let m2;
        if (m === 1) {
            y1 = y - 1;
            m1 = 11;
            y2 = y - 1;
            m2 = 12;
        }
        else {
            m2 = m - 1;
            m1 = m - 2;
            y1 = y;
            y2 = y;
            if (m1 < 1) {
                m1 += 12;
                y1 -= 1;
            }
        }
        const pk1 = `${y1}-${String(m1).padStart(2, '0')}`;
        const pk2 = `${y2}-${String(m2).padStart(2, '0')}`;
        const period_key = joinIncomeTaxDeductionsPeriodKey(pk1, pk2);
        const due = `${y}-${String(m).padStart(2, '0')}-15`;
        const period_label = `${periodKeyToDisplayHe(pk1)}–${periodKeyToDisplayHe(pk2)}`;
        return { is_required: true, due_date: due, period_key, period_label };
    }
    if (m !== 1 && m !== 7) {
        return { is_required: false, due_date: '', period_key: '', period_label: '' };
    }
    if (m === 7) {
        const pk1 = `${y}-01`;
        const pk2 = `${y}-06`;
        const period_key = joinIncomeTaxDeductionsPeriodKey(pk1, pk2);
        const due = `${y}-07-15`;
        const period_label = `${periodKeyToDisplayHe(pk1)}–${periodKeyToDisplayHe(pk2)}`;
        return { is_required: true, due_date: due, period_key, period_label };
    }
    const py = y - 1;
    const pk1 = `${py}-07`;
    const pk2 = `${py}-12`;
    const period_key = joinIncomeTaxDeductionsPeriodKey(pk1, pk2);
    const due = `${y}-01-15`;
    const period_label = `${periodKeyToDisplayHe(pk1)}–${periodKeyToDisplayHe(pk2)}`;
    return { is_required: true, due_date: due, period_key, period_label };
}
function defaultIncomeTaxDeductionsPeriodRow() {
    return { reported: false, paid: false, not_relevant: false };
}
function incomeTaxDeductionsRowFromDb(r) {
    if (!r)
        return defaultIncomeTaxDeductionsPeriodRow();
    return {
        reported: Boolean(r.reported),
        paid: Boolean(r.paid),
        not_relevant: Boolean(r.not_relevant),
    };
}
async function fetchIncomeTaxDeductionsPeriodRow(orgId, clientId, periodKey) {
    const { data, error } = await supabaseAdmin
        .from('client_income_tax_deductions_period')
        .select('*')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .eq('period_key', periodKey)
        .maybeSingle();
    if (error)
        throw new AppError(500, error.message ?? 'client_income_tax_deductions_period read failed', 'SUPABASE_ERROR');
    const base = incomeTaxDeductionsRowFromDb((data ?? null));
    return data ? { ...base, id: String(data.id) } : base;
}
async function persistIncomeTaxDeductionsRow(orgId, clientId, periodKey, next, nowIso) {
    const { error } = await supabaseAdmin.from('client_income_tax_deductions_period').upsert({
        organization_id: orgId,
        client_id: clientId,
        period_key: periodKey,
        reported: next.reported,
        paid: next.paid,
        not_relevant: next.not_relevant,
        updated_at: nowIso,
    }, { onConflict: 'organization_id,client_id,period_key' });
    if (error)
        throw new AppError(500, error.message ?? 'client_income_tax_deductions_period upsert failed', 'SUPABASE_ERROR');
}
function resolveIncomeTaxDeductionsCell(args) {
    const { requirement, payrollReady, row } = args;
    if (!requirement.is_required) {
        return {
            state: 'itd_not_required',
            display_value: 'לא נדרש',
            status_label_he: 'לא נדרש',
            status_tone: 'neutral',
            icon_key: 'gray_dot',
        };
    }
    if (row.not_relevant) {
        return {
            state: 'itd_not_relevant',
            display_value: 'לא רלוונטי',
            status_label_he: 'לא רלוונטי',
            status_tone: 'neutral',
            icon_key: 'gray_dot',
        };
    }
    if (!payrollReady) {
        return {
            state: 'itd_blocked',
            display_value: 'חסום',
            status_label_he: 'חסום',
            status_tone: 'blocked',
            icon_key: 'black_dot',
        };
    }
    if (row.paid) {
        return {
            state: 'itd_paid',
            display_value: 'שולם',
            status_label_he: 'שולם',
            status_tone: 'ok',
            icon_key: 'green_dot',
        };
    }
    if (row.reported) {
        return {
            state: 'itd_reported',
            display_value: 'דווח',
            status_label_he: 'דווח',
            status_tone: 'warning',
            icon_key: 'yellow_dot',
        };
    }
    return {
        state: 'itd_not_started',
        display_value: 'לא התחיל',
        status_label_he: 'לא התחיל',
        status_tone: 'blocked',
        icon_key: 'black_dot',
    };
}
function buildIncomeTaxDeductionsManualModal(req, row, cell, payrollReady) {
    const p = { period_key: req.period_key };
    const actions = [];
    if (payrollReady && !row.not_relevant && cell.state !== 'itd_blocked' && cell.state !== 'itd_not_required') {
        if (!row.reported && !row.paid) {
            actions.push({
                action_key: 'mark_reported',
                action_label_he: 'סמן דווח',
                interaction: { type: 'command', command_type: 'mark_income_tax_deductions_reported', payload: p },
            });
        }
        if (!row.paid) {
            actions.push({
                action_key: 'mark_paid',
                action_label_he: 'שולם',
                interaction: { type: 'command', command_type: 'mark_income_tax_deductions_paid', payload: p },
            });
        }
        actions.push({
            action_key: 'mark_not_relevant',
            action_label_he: 'לא רלוונטי',
            interaction: { type: 'command', command_type: 'mark_income_tax_deductions_not_relevant', payload: p },
        });
    }
    let message_he = `תקופת דיווח: ${req.period_label}. יעד: ${fmtDateHe(req.due_date) ?? req.due_date}.`;
    if (cell.state === 'itd_blocked') {
        message_he = 'נדרש להשלים את מצב השכר (תקין או אין משכורות החודש) לפני דיווח ניכויים.';
    }
    if (cell.state === 'itd_not_required') {
        message_he = 'לפי התדירות — לא נדרש דיווח החודש.';
    }
    return {
        modal_key: 'income_tax_deductions_manual_modal',
        title_he: 'מס הכנסה ניכויים',
        message_he,
        period_key: req.period_key,
        period_label_he: req.period_label,
        status_label_he: cell.status_label_he,
        actions,
    };
}
async function loadIncomeTaxDeductionsCommandContext(orgId, clientId, commandNow, periodKey) {
    const { data: taxRow, error } = await supabaseAdmin
        .from('client_tax_settings')
        .select('income_tax_deductions_enabled,income_tax_deductions_file_number,income_tax_deductions_frequency')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .maybeSingle();
    if (error)
        throw new AppError(500, error.message ?? 'client_tax_settings read failed', 'SUPABASE_ERROR');
    const t = (taxRow ?? null);
    if (!Boolean(t?.income_tax_deductions_enabled))
        throw badRequest('מס הכנסה ניכויים לא מופעל');
    if (!String(t?.income_tax_deductions_file_number ?? '').trim())
        throw badRequest('חסר מספר תיק ניכויים');
    const freq = normalizeIncomeTaxDeductionsFrequency(String(t?.income_tax_deductions_frequency ?? ''));
    if (!freq)
        throw badRequest('חסרה תדירות דיווח ניכויים');
    const req = resolveIncomeTaxDeductionsRequirement(commandNow, freq);
    if (!req.is_required)
        throw badRequest('דיווח ניכויים לא נדרש לתקופה זו');
    if (periodKey !== req.period_key)
        throw badRequest('period_key mismatch');
    return { freq, req };
}
async function patchIncomeTaxDeductionsComputedStatuses(orgId, clientId, now, relevant) {
    if (!relevant.some((r) => r.obligation_type === 'income_tax_deductions'))
        return relevant;
    const { data: taxRow, error: taxErr } = await supabaseAdmin
        .from('client_tax_settings')
        .select('income_tax_deductions_enabled,income_tax_deductions_file_number,income_tax_deductions_frequency')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .maybeSingle();
    if (taxErr)
        throw new AppError(500, taxErr.message ?? 'client_tax_settings read failed', 'SUPABASE_ERROR');
    const t = (taxRow ?? null);
    const freq = normalizeIncomeTaxDeductionsFrequency(String(t?.income_tax_deductions_frequency ?? ''));
    if (!freq || !Boolean(t?.income_tax_deductions_enabled) || !String(t?.income_tax_deductions_file_number ?? '').trim()) {
        return relevant;
    }
    const mm = businessPreviousMonthKey(now);
    const payrollSt = await fetchPayrollPeriodState(orgId, clientId, mm);
    const payrollReady = isPayrollReadyForNiDeductionsFlow(computePayrollProcessStatus(payrollSt));
    const { data: itdRows, error: itdErr } = await supabaseAdmin
        .from('client_income_tax_deductions_period')
        .select('period_key,reported,paid,not_relevant')
        .eq('organization_id', orgId)
        .eq('client_id', clientId);
    if (itdErr)
        throw new AppError(500, itdErr.message ?? 'client_income_tax_deductions_period read failed', 'SUPABASE_ERROR');
    const byKey = new Map();
    for (const r of (itdRows ?? [])) {
        byKey.set(String(r.period_key), incomeTaxDeductionsRowFromDb(r));
    }
    return relevant.map((rel) => {
        if (rel.obligation_type !== 'income_tax_deductions')
            return rel;
        const req = resolveIncomeTaxDeductionsRequirement(now, freq);
        if (!req.is_required || rel.period_key !== req.period_key)
            return rel;
        const row = byKey.get(rel.period_key) ?? defaultIncomeTaxDeductionsPeriodRow();
        let st = 'ready_to_process';
        if (!payrollReady)
            st = 'waiting_for_salary_data';
        else if (row.not_relevant)
            st = 'not_relevant';
        else if (row.paid)
            st = 'paid_on_time';
        else if (row.reported)
            st = 'reported';
        else
            st = 'ready_to_process';
        return { ...rel, computed_status: st };
    });
}
function defaultPayrollPeriodStateRow() {
    return {
        salary_data_received: false,
        sent_to_employer: false,
        no_salaries_this_month: false,
        not_relevant: false,
    };
}
function payrollPeriodStateFromDb(r) {
    if (!r)
        return defaultPayrollPeriodStateRow();
    return {
        salary_data_received: Boolean(r.salary_data_received),
        sent_to_employer: Boolean(r.sent_to_employer),
        no_salaries_this_month: Boolean(r.no_salaries_this_month),
        not_relevant: Boolean(r.not_relevant),
    };
}
function computePayrollProcessStatus(row) {
    if (row.not_relevant)
        return 'payroll_not_relevant';
    if (row.no_salaries_this_month)
        return 'payroll_no_salaries';
    if (row.sent_to_employer)
        return 'payroll_ok';
    if (row.salary_data_received)
        return 'payroll_ready_to_process';
    return 'payroll_missing_data';
}
function payrollProcessPresentation(s) {
    switch (s) {
        case 'payroll_not_relevant':
            return { display_value: 'לא רלוונטי', status_label_he: 'לא רלוונטי', status_tone: 'neutral', icon_key: 'gray_dot' };
        case 'payroll_no_salaries':
            return {
                display_value: 'אין משכורות החודש',
                status_label_he: 'אין משכורות החודש',
                status_tone: 'neutral',
                icon_key: 'gray_dot',
            };
        case 'payroll_ok':
            return { display_value: 'תקין', status_label_he: 'תקין', status_tone: 'ok', icon_key: 'green_dot' };
        case 'payroll_ready_to_process':
            return { display_value: 'חומר התקבל', status_label_he: 'חומר התקבל', status_tone: 'ok', icon_key: 'green_dot' };
        case 'payroll_missing_data':
        default:
            return { display_value: 'חסר נתונים', status_label_he: 'חסר נתונים', status_tone: 'blocked', icon_key: 'yellow_dot' };
    }
}
function payrollProcessToPriorityStatus(s) {
    switch (s) {
        case 'payroll_missing_data':
            return 'missing_data';
        case 'payroll_ready_to_process':
            return 'ready_to_process';
        case 'payroll_ok':
            return 'reported';
        case 'payroll_no_salaries':
        case 'payroll_not_relevant':
            return 'not_relevant';
        default:
            return 'not_relevant';
    }
}
/** NI ניכויים flow only when שכר process is תקין or אין משכורות (same payroll_period_key). */
function isPayrollReadyForNiDeductionsFlow(payrollProcess) {
    return payrollProcess === 'payroll_ok' || payrollProcess === 'payroll_no_salaries';
}
async function fetchPayrollPeriodState(orgId, clientId, payrollPeriodKey) {
    const { data, error } = await supabaseAdmin
        .from('client_payroll_period_state')
        .select('*')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .eq('payroll_period_key', payrollPeriodKey)
        .maybeSingle();
    if (error)
        throw new AppError(500, error.message ?? 'client_payroll_period_state read failed', 'SUPABASE_ERROR');
    return payrollPeriodStateFromDb((data ?? null));
}
async function persistPayrollPeriodState(orgId, clientId, payrollPeriodKey, row, nowIso) {
    const { error } = await supabaseAdmin.from('client_payroll_period_state').upsert({
        organization_id: orgId,
        client_id: clientId,
        payroll_period_key: payrollPeriodKey,
        salary_data_received: row.salary_data_received,
        sent_to_employer: row.sent_to_employer,
        no_salaries_this_month: row.no_salaries_this_month,
        not_relevant: row.not_relevant,
        updated_at: nowIso,
    }, { onConflict: 'organization_id,client_id,payroll_period_key' });
    if (error)
        throw new AppError(500, error.message ?? 'client_payroll_period_state upsert failed', 'SUPABASE_ERROR');
}
/**
 * Checkbox «שכר» under הביא חומר uses client_operational_profiles.salary_data_received_flag.
 * Align it with the same payroll period row that drives the שכר column (previous month, business calendar).
 */
function operationalProfileSalaryReceivedFlagFromPayrollRow(row) {
    if (row.not_relevant)
        return true;
    if (row.no_salaries_this_month)
        return true;
    if (row.salary_data_received)
        return true;
    return false;
}
async function syncSalaryReceivedProfileFlagWithPayrollPeriodIfCurrent(orgId, clientId, payrollPeriodKey, row, now, nowIso) {
    if (payrollPeriodKey !== businessPreviousMonthKey(now))
        return;
    const salary_data_received_flag = operationalProfileSalaryReceivedFlagFromPayrollRow(row);
    const { error } = await supabaseAdmin.from('client_operational_profiles').upsert({
        organization_id: orgId,
        client_id: clientId,
        salary_data_received_flag,
        updated_at: nowIso,
    }, { onConflict: 'organization_id,client_id' });
    if (error)
        throw new AppError(500, error.message ?? 'client_operational_profiles upsert failed', 'SUPABASE_ERROR');
}
/** הביא חומר · שכר sets profile flag; aggregate read keeps client_payroll_period_state aligned (single DB truth). */
function shouldPersistPayrollSalaryReceivedFromProfileFlag(profileSalaryReceived, row) {
    if (!profileSalaryReceived)
        return false;
    if (row.not_relevant || row.no_salaries_this_month)
        return false;
    if (row.salary_data_received)
        return false;
    return true;
}
async function persistPayrollSalaryReceivedWhenProfileSaysSo(orgId, clientId, payrollPeriodKey, prev, now) {
    const nowIso = now.toISOString();
    const next = {
        ...prev,
        not_relevant: false,
        salary_data_received: true,
        no_salaries_this_month: false,
    };
    await persistPayrollPeriodState(orgId, clientId, payrollPeriodKey, next, nowIso);
    await syncSalaryReceivedProfileFlagWithPayrollPeriodIfCurrent(orgId, clientId, payrollPeriodKey, next, now, nowIso);
    return next;
}
function payrollStateSnapshot(row) {
    return {
        salary_data_received: row.salary_data_received,
        sent_to_employer: row.sent_to_employer,
        no_salaries_this_month: row.no_salaries_this_month,
        not_relevant: row.not_relevant,
    };
}
function buildPayrollManualModal(payrollPeriodKey, row) {
    const st = computePayrollProcessStatus(row);
    const pres = payrollProcessPresentation(st);
    const p = { payroll_period_key: payrollPeriodKey };
    return {
        modal_key: 'payroll_manual_modal',
        title_he: 'עדכון שכר',
        payroll_period_key: payrollPeriodKey,
        payroll_period_display_he: periodKeyToDisplayHe(payrollPeriodKey),
        status_label_he: pres.status_label_he,
        checkboxes: [
            {
                key: 'salary_data_received',
                label_he: 'נתוני שכר התקבלו',
                is_checked: row.salary_data_received,
                interaction: {
                    type: 'command',
                    command_type: 'set_payroll_period_salary_data_received',
                    payload: { ...p, enabled: !row.salary_data_received },
                },
            },
            {
                key: 'sent_to_employer',
                label_he: 'משכורות נשלחו למעסיק',
                is_checked: row.sent_to_employer,
                interaction: {
                    type: 'command',
                    command_type: 'set_payroll_period_sent_to_employer',
                    payload: { ...p, enabled: !row.sent_to_employer },
                },
            },
            {
                key: 'no_salaries_this_month',
                label_he: 'אין משכורות החודש',
                is_checked: row.no_salaries_this_month,
                interaction: {
                    type: 'command',
                    command_type: 'set_payroll_period_no_salaries',
                    payload: { ...p, enabled: !row.no_salaries_this_month },
                },
            },
        ],
        actions: [
            {
                action_key: 'close',
                action_label_he: 'שמירה',
                interaction: { type: 'close_modal' },
            },
            {
                action_key: 'not_relevant',
                action_label_he: 'לא רלוונטי',
                interaction: { type: 'command', command_type: 'mark_payroll_period_not_relevant', payload: p },
            },
        ],
    };
}
function defaultNiDeductionsRow() {
    return {
        reported_102: false,
        reported_100: false,
        paid: false,
        payroll_in_progress: false,
        reminder_suppressed: false,
        not_relevant: false,
        auto_reminder_last_shown_at: null,
        all_completed_at: null,
    };
}
function niDeductionsRowFromDb(r) {
    if (!r)
        return defaultNiDeductionsRow();
    return {
        reported_102: Boolean(r.reported_102),
        reported_100: Boolean(r.reported_100),
        paid: Boolean(r.paid),
        payroll_in_progress: Boolean(r.payroll_in_progress),
        reminder_suppressed: Boolean(r.reminder_suppressed),
        not_relevant: Boolean(r.not_relevant),
        auto_reminder_last_shown_at: r.auto_reminder_last_shown_at ?? null,
        all_completed_at: r.all_completed_at ?? null,
    };
}
function computeNiDeductionsState(row, periodKey, now, sentToEmployer) {
    if (row.not_relevant)
        return 'not_relevant';
    const closed = isNiDeductionsPeriodClosed(now, periodKey);
    const S = sentToEmployer;
    const { reported_102: A, reported_100: B, paid: P } = row;
    if (P) {
        const doneAt = row.all_completed_at ? new Date(row.all_completed_at) : now;
        const doneDay = businessDayOfMonth(doneAt);
        return doneDay <= 15 ? 'paid_on_time' : 'paid_late';
    }
    if (closed)
        return 'not_paid';
    if (S && A && B && !P)
        return 'ready';
    if (row.payroll_in_progress)
        return 'in_progress';
    const c = Number(S) + Number(A) + Number(B) + Number(P);
    if (c === 0)
        return 'not_started';
    return 'in_progress';
}
function niDeductionsPresentation(state) {
    switch (state) {
        case 'not_relevant':
            return { display_value: 'לא רלוונטי', status_label_he: 'לא רלוונטי', status_tone: 'neutral', icon_key: 'gray_dot' };
        case 'not_started':
            return { display_value: 'לא התחיל', status_label_he: 'לא התחיל', status_tone: 'blocked', icon_key: 'black_dot' };
        case 'in_progress':
            return { display_value: 'בטיפול', status_label_he: 'בטיפול', status_tone: 'warning', icon_key: 'yellow_dot' };
        case 'ready':
            return { display_value: 'מוכן לתשלום', status_label_he: 'מוכן לתשלום', status_tone: 'warning', icon_key: 'yellow_dot' };
        case 'paid_on_time':
        case 'paid_late':
            return { display_value: 'שולם', status_label_he: 'שולם', status_tone: 'ok', icon_key: 'green_dot' };
        case 'not_paid':
            return { display_value: 'לא שולם', status_label_he: 'לא שולם', status_tone: 'critical', icon_key: 'red_dot' };
        default:
            return { display_value: '—', status_label_he: '—', status_tone: 'neutral', icon_key: 'gray_dot' };
    }
}
async function fetchNiDeductionsPeriodRow(orgId, clientId, periodKey) {
    const { data, error } = await supabaseAdmin
        .from('client_ni_deductions_period')
        .select('*')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .eq('period_key', periodKey)
        .maybeSingle();
    if (error)
        throw new AppError(500, error.message ?? 'client_ni_deductions_period read failed', 'SUPABASE_ERROR');
    const base = niDeductionsRowFromDb((data ?? null));
    return data ? { ...base, id: String(data.id) } : base;
}
async function persistNiDeductionsRow(orgId, clientId, periodKey, next, nowIso) {
    const { error } = await supabaseAdmin.from('client_ni_deductions_period').upsert({
        organization_id: orgId,
        client_id: clientId,
        period_key: periodKey,
        reported_102: next.reported_102,
        reported_100: next.reported_100,
        paid: next.paid,
        payroll_in_progress: next.payroll_in_progress,
        reminder_suppressed: next.reminder_suppressed,
        not_relevant: next.not_relevant,
        auto_reminder_last_shown_at: next.auto_reminder_last_shown_at,
        all_completed_at: next.all_completed_at,
        updated_at: nowIso,
    }, { onConflict: 'organization_id,client_id,period_key' });
    if (error)
        throw new AppError(500, error.message ?? 'client_ni_deductions_period upsert failed', 'SUPABASE_ERROR');
}
/** After payroll profile flags טופס 102/100 — mirror into ניכויים flags (same payroll_period_key = previous month, Asia/Jerusalem). */
export async function syncNiDeductionsReportingFromPayrollProfile(orgId, clientId) {
    const now = new Date();
    const nowIso = now.toISOString();
    const mm = businessPreviousMonthKey(now);
    const { data: taxRow } = await supabaseAdmin
        .from('client_tax_settings')
        .select('income_tax_deductions_enabled, national_insurance_deductions_file_number')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .maybeSingle();
    const t = (taxRow ?? null);
    const niTaxApplicable = Boolean(t?.income_tax_deductions_enabled) && String(t?.national_insurance_deductions_file_number ?? '').trim() !== '';
    if (!niTaxApplicable)
        return;
    const { data: prof } = await supabaseAdmin
        .from('client_payroll_profiles')
        .select('form_102_reported, form_100_reported')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .maybeSingle();
    const p = (prof ?? null);
    const f102 = Boolean(p?.form_102_reported);
    const f100 = Boolean(p?.form_100_reported);
    if (!f102 && !f100)
        return;
    const cur = await fetchNiDeductionsPeriodRow(orgId, clientId, mm);
    if (cur.not_relevant)
        return;
    const next = { ...cur };
    let changed = false;
    if (f102 && !next.reported_102) {
        next.reported_102 = true;
        changed = true;
    }
    if (f100 && !next.reported_100) {
        next.reported_100 = true;
        changed = true;
    }
    if (!changed)
        return;
    const payrollRow = await fetchPayrollPeriodState(orgId, clientId, mm);
    const S = payrollRow.sent_to_employer;
    const allFour = S && next.reported_102 && next.reported_100 && next.paid;
    if (!allFour) {
        next.all_completed_at = null;
    }
    else {
        next.payroll_in_progress = false;
        const wasAllFour = S && cur.reported_102 && cur.reported_100 && cur.paid;
        if (!wasAllFour)
            next.all_completed_at = nowIso;
    }
    await persistNiDeductionsRow(orgId, clientId, mm, next, nowIso);
}
async function touchNiDeductionsAutoReminderShown(orgId, clientId, periodKey, now) {
    const day = businessDayOfMonth(now);
    if (day <= 15)
        return;
    const nowIso = now.toISOString();
    const { data: ex, error: rErr } = await supabaseAdmin
        .from('client_ni_deductions_period')
        .select('id')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .eq('period_key', periodKey)
        .maybeSingle();
    if (rErr)
        throw new AppError(500, rErr.message ?? 'client_ni_deductions_period read failed', 'SUPABASE_ERROR');
    if (ex) {
        const { error: uErr } = await supabaseAdmin
            .from('client_ni_deductions_period')
            .update({ auto_reminder_last_shown_at: nowIso, updated_at: nowIso })
            .eq('id', String(ex.id));
        if (uErr)
            throw new AppError(500, uErr.message ?? 'client_ni_deductions_period update failed', 'SUPABASE_ERROR');
    }
    else {
        const { error: iErr } = await supabaseAdmin.from('client_ni_deductions_period').insert({
            organization_id: orgId,
            client_id: clientId,
            period_key: periodKey,
            auto_reminder_last_shown_at: nowIso,
            updated_at: nowIso,
        });
        if (iErr)
            throw new AppError(500, iErr.message ?? 'client_ni_deductions_period insert failed', 'SUPABASE_ERROR');
    }
}
function niDeductionsCheckboxDefs(periodKey, row, payrollRow) {
    const p = { period_key: periodKey };
    return [
        {
            key: 'sent_to_employer',
            label_he: 'משכורות נשלחו למעסיק',
            is_checked: payrollRow.sent_to_employer,
            interaction: { type: 'open_modal', modal_key: 'payroll_manual_modal' },
        },
        {
            key: 'reported_102',
            label_he: 'טופס 102 דווח',
            is_checked: row.reported_102,
            interaction: {
                type: 'command',
                command_type: 'set_ni_deductions_step',
                payload: { ...p, step: 'reported_102', enabled: !row.reported_102 },
            },
        },
        {
            key: 'reported_100',
            label_he: 'טופס 100 דווח',
            is_checked: row.reported_100,
            interaction: {
                type: 'command',
                command_type: 'set_ni_deductions_step',
                payload: { ...p, step: 'reported_100', enabled: !row.reported_100 },
            },
        },
        {
            key: 'paid',
            label_he: 'ביטוח לאומי ניכויים שולם',
            is_checked: row.paid,
            interaction: {
                type: 'command',
                command_type: 'set_ni_deductions_step',
                payload: { ...p, step: 'paid', enabled: !row.paid },
            },
        },
    ];
}
function niDeductionsModalActions(periodKey, ndState) {
    if (ndState === 'paid_on_time' || ndState === 'paid_late')
        return [];
    const p = { period_key: periodKey };
    return [
        {
            action_key: 'payroll_in_progress',
            action_label_he: 'משכורות בטיפול',
            interaction: { type: 'command', command_type: 'mark_ni_deductions_payroll_in_progress', payload: p },
        },
        {
            action_key: 'reported_and_paid',
            action_label_he: 'דווח ושולם',
            interaction: { type: 'command', command_type: 'mark_ni_deductions_reported_and_paid', payload: p },
        },
        {
            action_key: 'not_relevant',
            action_label_he: 'לא רלוונטי',
            interaction: { type: 'command', command_type: 'mark_ni_deductions_not_relevant', payload: p },
        },
    ];
}
function shiftUtcMonth(year, month1to12, delta) {
    const dt = new Date(Date.UTC(year, month1to12 - 1, 1));
    dt.setUTCMonth(dt.getUTCMonth() + delta);
    return { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1 };
}
function isNiDeductionsPeriodClosed(now, periodKey) {
    return businessMonthKey(now) > periodKey;
}
function vatReportingPeriodMonthly(now) {
    const curYear = now.getUTCFullYear();
    const curMonth = now.getUTCMonth() + 1;
    const prev = shiftUtcMonth(curYear, curMonth, -1);
    return {
        period_key: `${prev.year}-${String(prev.month).padStart(2, '0')}`,
        reporting_end_year: prev.year,
        reporting_end_month: prev.month,
    };
}
function vatReportingPeriodBiMonthly(now) {
    const curYear = now.getUTCFullYear();
    const curMonth = now.getUTCMonth() + 1;
    const prev = shiftUtcMonth(curYear, curMonth, -1);
    const end = prev.month % 2 === 0 ? { year: prev.year, month: prev.month } : shiftUtcMonth(prev.year, prev.month, -1);
    const start = shiftUtcMonth(end.year, end.month, -1);
    return {
        period_key: `${start.year}-${String(start.month).padStart(2, '0')}-${String(end.month).padStart(2, '0')}`,
        reporting_end_year: end.year,
        reporting_end_month: end.month,
    };
}
function vatPeriodDisplayHe(periodKey) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodKey);
    if (!m)
        return periodKey;
    return `${m[2]}–${m[3]}/${m[1]}`;
}
function addDays(d, n) {
    const out = new Date(d.getTime());
    out.setUTCDate(out.getUTCDate() + n);
    return out;
}
function statusLabelHe(status) {
    switch (status) {
        case 'not_relevant':
            return 'לא רלוונטי';
        case 'waiting_for_material':
            return 'ממתין לחומר';
        case 'waiting_for_salary_data':
            return 'ממתין לנתוני שכר';
        case 'waiting_for_income_data':
            return 'ממתין להכנסות';
        case 'waiting_client_response':
            return 'ממתין לתשובת לקוח';
        case 'missing_data':
            return 'חסר נתונים';
        case 'ready_to_report':
            return 'מוכן לדיווח';
        case 'ready_to_process':
            return 'מוכן לטיפול';
        case 'pending_payment_confirmation':
            return 'ממתין לאישור תשלום';
        case 'not_reported':
            return 'לא דווח';
        case 'reported':
            return 'דווח';
        case 'reported_late':
            return 'הוגש באיחור';
        case 'reported_and_paid':
            return 'דווח ושולם';
        case 'not_paid':
            return 'לא שולם';
        case 'paid_on_time':
            return 'תקין';
        case 'paid_late':
            return 'באיחור';
        default:
            return '—';
    }
}
function computePriorityScore(status, obligationType, hasMissingData) {
    void obligationType;
    if (status === 'not_reported' || status === 'reported_late')
        return 100;
    if (status === 'not_paid')
        return 92;
    if (status === 'missing_data')
        return hasMissingData ? 95 : 80;
    if (status === 'paid_late')
        return 98;
    if (status === 'paid_on_time')
        return 20;
    if (status === 'pending_payment_confirmation')
        return 75;
    if (status === 'waiting_client_response' || status.startsWith('waiting_for_'))
        return 65;
    if (status === 'ready_to_report' || status === 'ready_to_process')
        return 55;
    if (status === 'reported' || status === 'reported_and_paid')
        return 20;
    return 10;
}
function scoreToLevel(score) {
    if (score >= 80)
        return 'high';
    if (score >= 50)
        return 'medium';
    return 'low';
}
function statusTone(status) {
    if (status === 'missing_data')
        return 'blocked';
    if (status === 'not_reported' || status === 'reported_late' || status === 'not_paid' || status === 'paid_late')
        return 'critical';
    if (status === 'waiting_client_response' || status.startsWith('waiting_for_') || status === 'pending_payment_confirmation')
        return 'warning';
    if (status === 'reported' || status === 'reported_and_paid' || status === 'ready_to_report' || status === 'ready_to_process' || status === 'paid_on_time')
        return 'ok';
    return 'neutral';
}
function statusIconKey(status) {
    if (status === 'missing_data')
        return 'black_dot';
    if (status === 'not_reported' || status === 'reported_late' || status === 'not_paid' || status === 'paid_late')
        return 'red_dot';
    if (status === 'waiting_client_response' || status.startsWith('waiting_for_') || status === 'pending_payment_confirmation')
        return 'yellow_dot';
    if (status === 'reported' || status === 'reported_and_paid' || status === 'ready_to_report' || status === 'ready_to_process' || status === 'paid_on_time')
        return 'green_dot';
    return 'gray_dot';
}
function cellsToPriorityState(states) {
    if (states.some((s) => s === 'not_reported' || s === 'reported_late' || s === 'missing_data' || s === 'not_paid' || s === 'paid_late')) {
        return { code: 'high_today', label_he: 'דחוף היום', tone: 'critical', icon_key: 'red_dot' };
    }
    if (states.some((s) => s === 'waiting_client_response' || s.startsWith('waiting_for_') || s === 'pending_payment_confirmation')) {
        return { code: 'warning', label_he: 'לטיפול בקרוב', tone: 'warning', icon_key: 'yellow_dot' };
    }
    return { code: 'ok', label_he: 'תקין', tone: 'ok', icon_key: 'green_dot' };
}
function isVatBiMonthlyReportingMonth(now) {
    const m = now.getUTCMonth() + 1;
    return m === 1 || m === 3 || m === 5 || m === 7 || m === 9 || m === 11;
}
function requestPriorityForMissingData(checkboxKey, dayOfMonth) {
    if (dayOfMonth < 1)
        return null;
    if (checkboxKey === 'payroll') {
        if (dayOfMonth >= 10)
            return 'critical';
        if (dayOfMonth >= 4)
            return 'warning';
        return 'info';
    }
    if (checkboxKey === 'vat') {
        if (dayOfMonth >= 10)
            return 'critical';
        if (dayOfMonth >= 4)
            return 'warning';
        return 'info';
    }
    if (dayOfMonth >= 10)
        return 'critical';
    if (dayOfMonth >= 8)
        return 'warning';
    return 'info';
}
function requestStageForMissingData(dayOfMonth) {
    if (dayOfMonth >= 10)
        return 'day_10_plus';
    if (dayOfMonth >= 8)
        return 'day_8';
    if (dayOfMonth >= 4)
        return 'day_4';
    if (dayOfMonth >= 1)
        return 'day_1';
    return null;
}
function requestTextHe(checkboxKey, stage) {
    if (checkboxKey === 'payroll') {
        if (stage === 'day_1')
            return 'נא לשלוח נתוני שכר';
        if (stage === 'day_4')
            return 'תזכורת: חסרים נתוני שכר';
        if (stage === 'day_8')
            return 'דחוף: יש לשלוח נתוני שכר היום';
        return 'קריטי: נתוני שכר באיחור';
    }
    if (checkboxKey === 'vat') {
        if (stage === 'day_1')
            return 'נא להעביר חומר למע"מ';
        if (stage === 'day_4')
            return 'תזכורת: חסר חומר למע"מ';
        if (stage === 'day_8')
            return 'דחוף: חסר חומר למע"מ';
        return 'סיכון איחור: מע"מ ללא חומר';
    }
    if (stage === 'day_1')
        return 'נא לעדכן האם היו הכנסות';
    if (stage === 'day_4')
        return 'תזכורת: עדכון הכנסות נדרש';
    if (stage === 'day_8')
        return 'בדיקה: היו הכנסות החודש?';
    return 'דחוף: חסרים נתוני הכנסות';
}
function isVatReportingPipelineStatus(status) {
    return (status === 'ready_to_report' ||
        status === 'reported' ||
        status === 'reported_late' ||
        status === 'reported_and_paid' ||
        status === 'not_reported' ||
        status === 'pending_payment_confirmation');
}
function isVatBlockedByMaterialPrerequisite(status) {
    return status === 'waiting_for_material' || status === 'waiting_client_response' || status === 'missing_data';
}
function isNationalInsuranceSelfEmployedObligation(obligationType) {
    return obligationType === 'national_insurance_self_employed_payment';
}
function cellInteractionForObligation(obligation, columnKey) {
    if (columnKey === 'payroll')
        return { type: 'open_module', action_key: 'open_payroll' };
    if (columnKey === 'ni' && isNationalInsuranceSelfEmployedObligation(obligation.obligation_type)) {
        return { type: 'open_modal', modal_key: 'ni_manual_modal' };
    }
    if (columnKey === 'vat' && isVatBlockedByMaterialPrerequisite(obligation.status_code)) {
        return { type: 'open_module', action_key: 'report_vat' };
    }
    if (obligation.can_mark_reported) {
        return {
            type: 'command',
            action_key: columnKey === 'material' ? 'request_documents' : 'report_vat',
            command_type: 'mark_obligation_reported',
            payload: { obligation_id: obligation.obligation_id },
        };
    }
    if (obligation.can_mark_reported_and_paid) {
        return {
            type: 'command',
            action_key: 'mark_reported_and_paid',
            command_type: 'mark_obligation_reported_and_paid',
            payload: { obligation_id: obligation.obligation_id },
        };
    }
    if (columnKey === 'material')
        return { type: 'open_module', action_key: 'request_documents' };
    if (columnKey === 'vat')
        return { type: 'open_module', action_key: 'report_vat' };
    if (columnKey === 'income_advances')
        return { type: 'open_module', action_key: 'open_income_tax' };
    if (columnKey === 'ni')
        return { type: 'open_module', action_key: 'open_national_insurance' };
    if (columnKey === 'income_tax_deductions')
        return { type: 'open_module', action_key: 'open_income_tax_deductions' };
    return { type: 'none' };
}
function availableActionsForCell(columnKey, obligation) {
    const out = [];
    if (!obligation)
        return out;
    if (columnKey === 'ni' && isNationalInsuranceSelfEmployedObligation(obligation.obligation_type))
        return out;
    const obIdPayload = { obligation_id: obligation.obligation_id };
    if (columnKey === 'material') {
        out.push({
            action_key: 'request_data',
            action_label_he: 'בקש מסמכים מהלקוח',
            interaction: {
                type: 'command',
                action_key: 'request_data',
                command_type: 'send_docflow_request',
                payload: { ...obIdPayload, type: 'material' },
            },
        }, {
            action_key: 'mark_received',
            action_label_he: 'סמן חומר כהתקבל',
            interaction: { type: 'command', action_key: 'mark_received', command_type: 'mark_material_received', payload: obIdPayload },
        }, {
            action_key: 'mark_not_relevant',
            action_label_he: 'סמן לא רלוונטי',
            interaction: { type: 'command', action_key: 'mark_not_relevant', command_type: 'mark_material_not_relevant', payload: obIdPayload },
        });
    }
    else if (columnKey === 'payroll') {
        out.push({
            action_key: 'request_data',
            action_label_he: 'בקש נתוני שכר',
            interaction: {
                type: 'command',
                action_key: 'request_data',
                command_type: 'send_docflow_request',
                payload: { ...obIdPayload, type: 'salary' },
            },
        }, {
            action_key: 'mark_received',
            action_label_he: 'סמן נתוני שכר כהתקבלו',
            interaction: { type: 'command', action_key: 'mark_received', command_type: 'mark_salary_data_received', payload: obIdPayload },
        }, {
            action_key: 'mark_not_relevant',
            action_label_he: 'סמן לא רלוונטי',
            interaction: { type: 'command', action_key: 'mark_not_relevant', command_type: 'mark_salary_data_not_relevant', payload: obIdPayload },
        });
    }
    else if (columnKey === 'income_advances') {
        out.push({
            action_key: 'request_data',
            action_label_he: 'בקש הכנסות',
            interaction: {
                type: 'command',
                action_key: 'request_data',
                command_type: 'send_docflow_request',
                payload: { ...obIdPayload, type: 'income' },
            },
        }, {
            action_key: 'mark_received',
            action_label_he: 'סמן הכנסות כהתקבלו',
            interaction: { type: 'command', action_key: 'mark_received', command_type: 'mark_income_data_received', payload: obIdPayload },
        }, {
            action_key: 'mark_not_relevant',
            action_label_he: 'סמן לא רלוונטי',
            interaction: { type: 'command', action_key: 'mark_not_relevant', command_type: 'mark_income_data_not_relevant', payload: obIdPayload },
        });
    }
    else if (columnKey === 'vat') {
        if (isVatBlockedByMaterialPrerequisite(obligation.status_code))
            return out;
        out.push({
            action_key: 'mark_reported',
            action_label_he: 'סמן כהוגש',
            interaction: { type: 'command', action_key: 'mark_reported', command_type: 'mark_obligation_reported', payload: obIdPayload },
        }, {
            action_key: 'mark_reported_and_paid',
            action_label_he: 'סמן כהוגש ושולם',
            interaction: {
                type: 'command',
                action_key: 'mark_reported_and_paid',
                command_type: 'mark_obligation_reported_and_paid',
                payload: obIdPayload,
            },
        }, {
            action_key: 'mark_not_reported',
            action_label_he: 'סמן כלא דווח',
            interaction: { type: 'command', action_key: 'mark_not_reported', command_type: 'mark_obligation_not_reported', payload: obIdPayload },
        });
        if (obligation.status_code === 'reported' || obligation.status_code === 'reported_late') {
            out.push({
                action_key: 'notify_payment',
                action_label_he: 'עדכן סכום לתשלום',
                interaction: { type: 'command', action_key: 'notify_payment', command_type: 'notify_client_payment_amount', payload: obIdPayload },
            });
        }
    }
    else if (columnKey === 'ni' && isNationalInsuranceSelfEmployedObligation(obligation.obligation_type)) {
        out.push({
            action_key: 'mark_paid',
            action_label_he: 'שולם',
            interaction: { type: 'command', action_key: 'mark_paid', command_type: 'mark_ni_paid', payload: obIdPayload },
        }, {
            action_key: 'mark_not_paid',
            action_label_he: 'עדיין לא שולם',
            interaction: { type: 'command', action_key: 'mark_not_paid', command_type: 'mark_ni_not_paid', payload: obIdPayload },
        }, {
            action_key: 'update_amount',
            action_label_he: 'לעדכן סכום לתשלום',
            interaction: { type: 'open_module', action_key: 'open_national_insurance' },
        }, {
            action_key: 'mark_not_relevant',
            action_label_he: 'לא רלוונטי',
            interaction: { type: 'command', action_key: 'mark_not_relevant', command_type: 'mark_ni_not_relevant', payload: obIdPayload },
        });
    }
    return out;
}
function niDeductionsStateToPriorityStatus(s) {
    switch (s) {
        case 'not_paid':
            return s;
        case 'paid_late':
        case 'paid_on_time':
        case 'not_relevant':
            return 'paid_on_time';
        case 'ready':
            return 'ready_to_process';
        case 'in_progress':
        case 'not_started':
            return 'waiting_client_response';
        default:
            return 'not_relevant';
    }
}
function niSelfEmployedPriorityStatus(ob, todayYmd) {
    if (ob.status_code === 'not_paid' && ob.due_date && todayYmd > ob.due_date)
        return 'paid_late';
    return ob.status_code;
}
function nationalInsuranceSelfEmployedCellPresentation(ob, todayYmd) {
    if (ob.status_code === 'paid_on_time' || ob.status_code === 'paid_late') {
        return {
            display_value: 'שולם',
            status_label_he: 'שולם',
            status_tone: 'ok',
            icon_key: 'green_dot',
        };
    }
    if (ob.status_code === 'not_paid' && ob.due_date && todayYmd > ob.due_date) {
        return {
            display_value: 'באיחור',
            status_label_he: 'באיחור',
            status_tone: 'critical',
            icon_key: 'red_dot',
        };
    }
    return {
        display_value: statusLabelHe(ob.status_code),
        status_label_he: statusLabelHe(ob.status_code),
        status_tone: statusTone(ob.status_code),
        icon_key: statusIconKey(ob.status_code),
    };
}
/** ביטוח לאומי עצמאים — אותו period_key כמו ב-buildRelevantObligations (מועבר מהאגרגט). */
function pickNiSelfEmployedObligation(obligations, now, preferredPeriodKey) {
    const pk = (preferredPeriodKey ?? '').trim() || monthKey(now);
    return (obligations.find((o) => o.obligation_type === 'national_insurance_self_employed_payment' && o.period_key === pk) ??
        obligations.find((o) => o.obligation_type === 'national_insurance_self_employed_payment') ??
        null);
}
function buildObligationsTable(obligations, taxSnapshot, profileSnapshot, now, niDeductionsCtx, payrollProcessCtx, niSelfEmployedPeriodKey, incomeTaxDeductionsCtx) {
    const columns = [
        { key: 'payroll', label_he: 'שכר', kind: 'status', order: 1 },
        { key: 'material', label_he: 'הביא חומר', kind: 'multi_checkbox', order: 2 },
        { key: 'vat', label_he: 'מע״מ', kind: 'status', order: 3 },
        { key: 'vat_due_day', label_he: 'יום יעד דיווח מע״מ', kind: 'date', order: 4 },
        { key: 'income_advances', label_he: 'מקדמות מס הכנסה', kind: 'status', order: 5 },
        { key: 'ni', label_he: 'ביטוח לאומי', kind: 'status', order: 6 },
        { key: 'ni_deductions', label_he: 'ביטוח לאומי ניכויים', kind: 'status', order: 7 },
        { key: 'income_tax_deductions', label_he: 'מס הכנסה ניכויים', kind: 'status', order: 8 },
        { key: 'priority', label_he: 'עדיפות', kind: 'status', order: 9 },
    ];
    const pick = (pred) => obligations.find(pred) ?? null;
    const vat = pick((o) => o.obligation_type === 'vat_report');
    const payroll = pick((o) => o.obligation_type === 'payroll_data' || o.obligation_type === 'payroll_submission');
    const incomeAdvances = pick((o) => o.obligation_type === 'income_tax_advance');
    const niSelf = pickNiSelfEmployedObligation(obligations, now, niSelfEmployedPeriodKey);
    const todayYmd = ymd(now);
    const rowPeriod = vat ?? obligations[0] ?? null;
    const fallbackDisplayByColumn = (columnKey) => {
        if (columnKey === 'payroll')
            return 'אין עובדים';
        if (columnKey === 'material')
            return 'לא נדרש';
        return 'לא רלוונטי';
    };
    const statusCell = (columnKey, ob) => {
        if (!ob) {
            const interactionByColumn = {
                payroll: { type: 'open_module', action_key: 'open_payroll' },
                material: { type: 'open_module', action_key: 'request_documents' },
                vat: { type: 'open_module', action_key: 'report_vat' },
                income_advances: { type: 'open_module', action_key: 'open_income_tax' },
                ni: { type: 'open_module', action_key: 'open_national_insurance' },
                ni_deductions: { type: 'open_module', action_key: 'open_national_insurance_deductions' },
                income_tax_deductions: { type: 'open_module', action_key: 'open_income_tax_deductions' },
                priority: { type: 'open_module', action_key: 'open_tasks' },
            };
            return {
                column_key: columnKey,
                kind: 'status',
                display_value: fallbackDisplayByColumn(columnKey),
                status_code: 'not_relevant',
                status_label_he: fallbackDisplayByColumn(columnKey),
                status_tone: 'neutral',
                icon_key: 'gray_dot',
                action_label_he: 'פתח מודול',
                interaction: interactionByColumn[columnKey] ?? { type: 'none' },
                available_actions: [],
            };
        }
        const interaction = cellInteractionForObligation(ob, columnKey);
        const availableActions = availableActionsForCell(columnKey, ob);
        const vatBlockedByMaterial = columnKey === 'vat' && isVatBlockedByMaterialPrerequisite(ob.status_code);
        const niSelfCell = columnKey === 'ni' && isNationalInsuranceSelfEmployedObligation(ob.obligation_type);
        const amountNum = Number(taxSnapshot?.national_insurance_monthly_amount ?? 0);
        const amountDisplay = Number.isFinite(amountNum) && amountNum > 0 ? `${amountNum.toLocaleString('he-IL')} ₪` : 'לא הוגדר סכום';
        const standingOrderUntil = String(taxSnapshot?.national_insurance_standing_order_until ?? '');
        const standingOrderActive = Boolean(standingOrderUntil) && standingOrderUntil >= ymd(now);
        const niPres = niSelfCell ? nationalInsuranceSelfEmployedCellPresentation(ob, todayYmd) : null;
        const niDisplay = niPres?.display_value ?? statusLabelHe(ob.status_code);
        return {
            column_key: columnKey,
            kind: 'status',
            display_value: niDisplay,
            status_code: ob.status_code,
            status_label_he: niPres?.status_label_he ?? statusLabelHe(ob.status_code),
            status_tone: niPres?.status_tone ?? statusTone(ob.status_code),
            icon_key: niPres?.icon_key ?? statusIconKey(ob.status_code),
            action_label_he: vatBlockedByMaterial
                ? null
                : niSelfCell
                    ? null
                    : availableActions[0]?.action_label_he ?? (interaction.action_key ? (interaction.type === 'command' ? 'בצע פעולה' : 'פתח מודול') : null),
            interaction,
            available_actions: niSelfCell ? undefined : availableActions,
        };
    };
    const dueDateCell = (columnKey, ob) => ({
        column_key: columnKey,
        kind: 'date',
        display_value: ob ? ob.due_date_display_he || ob.due_date : 'לא נדרש',
        action_label_he: 'פתח מע״מ',
        interaction: {
            type: 'open_module',
            action_key: ob ? 'report_vat' : 'open_vat',
        },
        available_actions: [],
    });
    const materialCell = () => {
        const vatFrequency = String(taxSnapshot?.vat_frequency ?? '');
        const vatActive = vatFrequency === 'bi_monthly' || vatFrequency === 'דו חודשי' ? isVatBiMonthlyReportingMonth(now) : true;
        const incomeAdvancesActive = Boolean(taxSnapshot?.income_tax_advance_enabled);
        const payrollActive = Boolean(taxSnapshot?.income_tax_deductions_enabled) || String(taxSnapshot?.national_insurance_deductions_file_number ?? '').trim() !== '';
        const materialChecked = Boolean(profileSnapshot?.material_brought_flag);
        const incomeChecked = Boolean(profileSnapshot?.income_data_received_flag);
        const salaryChecked = Boolean(profileSnapshot?.salary_data_received_flag);
        const dayOfMonth = businessDayOfMonth(now);
        const checkbox = (key, label_he, is_active, is_checked, obligation) => {
            const payloadBase = { obligation_id: obligation?.obligation_id ?? null };
            const requestType = key === 'vat' ? 'material' : key === 'income_advances' ? 'income' : 'salary';
            const markReceivedCommand = key === 'vat'
                ? 'mark_material_received'
                : key === 'income_advances'
                    ? 'mark_income_data_received'
                    : 'mark_salary_data_received';
            const markNotRelevantCommand = key === 'vat'
                ? 'mark_material_not_relevant'
                : key === 'income_advances'
                    ? 'mark_income_data_not_relevant'
                    : 'mark_salary_data_not_relevant';
            const shouldShowRequestIcon = is_active && !is_checked;
            const reqPriority = shouldShowRequestIcon ? requestPriorityForMissingData(key, dayOfMonth) : null;
            const reqStage = shouldShowRequestIcon ? requestStageForMissingData(dayOfMonth) : null;
            return {
                key,
                label_he,
                is_active,
                is_checked,
                show_request_icon: shouldShowRequestIcon,
                request_priority: reqPriority ?? undefined,
                request_stage_code: reqStage ?? undefined,
                request_text_he: reqStage ? requestTextHe(key, reqStage) : undefined,
                request_interaction: shouldShowRequestIcon
                    ? {
                        type: 'command',
                        action_key: 'request_data',
                        command_type: 'send_docflow_request',
                        payload: { ...payloadBase, type: requestType },
                    }
                    : { type: 'none' },
                interaction: !is_active
                    ? { type: 'none' }
                    : !is_checked
                        ? {
                            type: 'command',
                            action_key: 'mark_received',
                            command_type: markReceivedCommand,
                            payload: payloadBase,
                        }
                        : { type: 'none' },
                available_actions: !is_active
                    ? []
                    : [
                        {
                            action_key: 'request_data',
                            action_label_he: 'בקש נתונים',
                            interaction: {
                                type: 'command',
                                action_key: 'request_data',
                                command_type: 'send_docflow_request',
                                payload: { ...payloadBase, type: requestType },
                            },
                        },
                        {
                            action_key: 'mark_received',
                            action_label_he: 'סמן כהתקבל',
                            interaction: {
                                type: 'command',
                                action_key: 'mark_received',
                                command_type: markReceivedCommand,
                                payload: payloadBase,
                            },
                        },
                        {
                            action_key: 'mark_not_relevant',
                            action_label_he: 'סמן לא רלוונטי',
                            interaction: {
                                type: 'command',
                                action_key: 'mark_not_relevant',
                                command_type: markNotRelevantCommand,
                                payload: payloadBase,
                            },
                        },
                    ],
            };
        };
        return {
            column_key: 'material',
            kind: 'multi_checkbox',
            display_value: '',
            action_label_he: null,
            interaction: { type: 'none' },
            available_actions: [],
            checkboxes: [
                checkbox('vat', 'מע"מ', vatActive, materialChecked, vat),
                checkbox('income_advances', 'מקדמות', incomeAdvancesActive, incomeChecked, incomeAdvances),
                checkbox('payroll', 'שכר', payrollActive, salaryChecked, payroll),
            ],
        };
    };
    const payrollProcessCell = () => {
        if (!payroll || !payrollProcessCtx) {
            return statusCell('payroll', null);
        }
        const pres = payrollProcessPresentation(payrollProcessCtx.payrollProcess);
        return {
            column_key: 'payroll',
            kind: 'status',
            display_value: pres.display_value,
            status_code: payrollProcessCtx.payrollProcess,
            status_label_he: pres.status_label_he,
            status_tone: pres.status_tone,
            icon_key: pres.icon_key,
            action_label_he: 'עדכון',
            interaction: { type: 'open_modal', modal_key: 'payroll_manual_modal' },
            available_actions: [],
        };
    };
    const cells = [
        payrollProcessCell(),
        materialCell(),
        statusCell('vat', vat),
        dueDateCell('vat_due_day', vat),
        statusCell('income_advances', pick((o) => o.obligation_type === 'income_tax_advance')),
        statusCell('ni', niSelf),
        (() => {
            const incomeTaxDeductionsEnabled = Boolean(taxSnapshot?.income_tax_deductions_enabled);
            if (!incomeTaxDeductionsEnabled) {
                return {
                    column_key: 'ni_deductions',
                    kind: 'status',
                    display_value: 'לא רלוונטי',
                    status_code: 'not_relevant',
                    status_label_he: 'לא רלוונטי',
                    status_tone: 'neutral',
                    icon_key: 'gray_dot',
                    action_label_he: 'פתח מיסים',
                    interaction: { type: 'open_module', action_key: 'open_national_insurance_deductions' },
                    available_actions: [],
                };
            }
            const fileNumber = String(taxSnapshot?.national_insurance_deductions_file_number ?? '').trim();
            const hasFileNumber = fileNumber.length > 0;
            if (!hasFileNumber) {
                return {
                    column_key: 'ni_deductions',
                    kind: 'status',
                    display_value: 'ממתין',
                    status_code: 'missing_data',
                    status_label_he: 'חסר נתונים',
                    status_tone: 'blocked',
                    icon_key: 'yellow_dot',
                    action_label_he: 'פתח מיסים',
                    interaction: { type: 'open_module', action_key: 'open_national_insurance_deductions' },
                    available_actions: [],
                };
            }
            if (!niDeductionsCtx) {
                return {
                    column_key: 'ni_deductions',
                    kind: 'status',
                    display_value: 'ממתין לשכר',
                    status_code: 'waiting_for_salary_data',
                    status_label_he: 'ממתין לשכר',
                    status_tone: 'blocked',
                    icon_key: 'black_dot',
                    action_label_he: null,
                    interaction: { type: 'none' },
                    available_actions: [],
                };
            }
            if (niDeductionsCtx.row.paid) {
                const ndStatePaid = computeNiDeductionsState(niDeductionsCtx.row, niDeductionsCtx.periodKey, now, niDeductionsCtx.sentToEmployer);
                const presPaid = niDeductionsPresentation(ndStatePaid);
                if (ndStatePaid === 'not_relevant') {
                    return {
                        column_key: 'ni_deductions',
                        kind: 'status',
                        display_value: presPaid.display_value,
                        status_code: ndStatePaid,
                        status_label_he: presPaid.status_label_he,
                        status_tone: presPaid.status_tone,
                        icon_key: presPaid.icon_key,
                        action_label_he: null,
                        interaction: { type: 'none' },
                        available_actions: [],
                    };
                }
                return {
                    column_key: 'ni_deductions',
                    kind: 'status',
                    display_value: presPaid.display_value,
                    status_code: ndStatePaid,
                    status_label_he: presPaid.status_label_he,
                    status_tone: presPaid.status_tone,
                    icon_key: presPaid.icon_key,
                    action_label_he: 'עדכון',
                    interaction: { type: 'open_modal', modal_key: 'ni_deductions_manual_modal' },
                    available_actions: [],
                };
            }
            if (!niDeductionsCtx.payrollReady) {
                return {
                    column_key: 'ni_deductions',
                    kind: 'status',
                    display_value: 'ממתין לשכר',
                    status_code: 'waiting_for_salary_data',
                    status_label_he: 'ממתין לשכר',
                    status_tone: 'blocked',
                    icon_key: 'black_dot',
                    action_label_he: null,
                    interaction: { type: 'none' },
                    available_actions: [],
                };
            }
            const ndState = computeNiDeductionsState(niDeductionsCtx.row, niDeductionsCtx.periodKey, now, niDeductionsCtx.sentToEmployer);
            const pres = niDeductionsPresentation(ndState);
            if (ndState === 'not_relevant') {
                return {
                    column_key: 'ni_deductions',
                    kind: 'status',
                    display_value: pres.display_value,
                    status_code: ndState,
                    status_label_he: pres.status_label_he,
                    status_tone: pres.status_tone,
                    icon_key: pres.icon_key,
                    action_label_he: null,
                    interaction: { type: 'none' },
                    available_actions: [],
                };
            }
            return {
                column_key: 'ni_deductions',
                kind: 'status',
                display_value: pres.display_value,
                status_code: ndState,
                status_label_he: pres.status_label_he,
                status_tone: pres.status_tone,
                icon_key: pres.icon_key,
                action_label_he: 'עדכון',
                interaction: { type: 'open_modal', modal_key: 'ni_deductions_manual_modal' },
                available_actions: [],
            };
        })(),
        (() => {
            const enabled = Boolean(taxSnapshot?.income_tax_deductions_enabled);
            if (!enabled) {
                return {
                    column_key: 'income_tax_deductions',
                    kind: 'status',
                    display_value: 'לא רלוונטי',
                    status_code: 'not_relevant',
                    status_label_he: 'לא רלוונטי',
                    status_tone: 'neutral',
                    icon_key: 'gray_dot',
                    action_label_he: 'פתח מיסים',
                    interaction: { type: 'open_module', action_key: 'open_income_tax_deductions' },
                    available_actions: [],
                };
            }
            const fileNumber = String(taxSnapshot?.income_tax_deductions_file_number ?? '').trim();
            if (!fileNumber) {
                return {
                    column_key: 'income_tax_deductions',
                    kind: 'status',
                    display_value: 'ממתין',
                    status_code: 'missing_data',
                    status_label_he: 'חסר נתונים',
                    status_tone: 'blocked',
                    icon_key: 'yellow_dot',
                    action_label_he: 'פתח מיסים',
                    interaction: { type: 'open_module', action_key: 'open_income_tax_deductions' },
                    available_actions: [],
                };
            }
            if (!incomeTaxDeductionsCtx) {
                return {
                    column_key: 'income_tax_deductions',
                    kind: 'status',
                    display_value: 'ממתין',
                    status_code: 'missing_data',
                    status_label_he: 'חסר תדירות דיווח',
                    status_tone: 'blocked',
                    icon_key: 'yellow_dot',
                    action_label_he: 'פתח מיסים',
                    interaction: { type: 'open_module', action_key: 'open_income_tax_deductions' },
                    available_actions: [],
                };
            }
            const cell = resolveIncomeTaxDeductionsCell(incomeTaxDeductionsCtx);
            const openItdModal = incomeTaxDeductionsCtx.requirement.is_required && cell.state !== 'itd_not_required';
            return {
                column_key: 'income_tax_deductions',
                kind: 'status',
                display_value: cell.display_value,
                status_code: cell.state,
                status_label_he: cell.status_label_he,
                status_tone: cell.status_tone,
                icon_key: cell.icon_key,
                action_label_he: openItdModal ? 'עדכון' : 'פתח מיסים',
                interaction: openItdModal
                    ? { type: 'open_modal', modal_key: 'income_tax_deductions_manual_modal' }
                    : { type: 'open_module', action_key: 'open_income_tax_deductions' },
                available_actions: [],
            };
        })(),
        (() => {
            const ndState = niDeductionsCtx && (niDeductionsCtx.row.paid || niDeductionsCtx.payrollReady)
                ? computeNiDeductionsState(niDeductionsCtx.row, niDeductionsCtx.periodKey, now, niDeductionsCtx.sentToEmployer)
                : null;
            const priorityInputs = [
                pick((o) => o.obligation_type === 'vat_report')?.status_code ?? 'not_relevant',
                payrollProcessCtx ? payrollProcessToPriorityStatus(payrollProcessCtx.payrollProcess) : 'not_relevant',
                pick((o) => o.obligation_type === 'income_tax_advance')?.status_code ?? 'not_relevant',
            ];
            if (niSelf)
                priorityInputs.push(niSelfEmployedPriorityStatus(niSelf, todayYmd));
            if (ndState)
                priorityInputs.push(niDeductionsStateToPriorityStatus(ndState));
            const scoringStates = cellsToPriorityState(priorityInputs);
            return {
                column_key: 'priority',
                kind: 'status',
                display_value: scoringStates.label_he,
                status_label_he: scoringStates.label_he,
                status_tone: scoringStates.tone,
                icon_key: scoringStates.icon_key,
                action_label_he: 'הצג משימות',
                priority_code: scoringStates.code,
                interaction: { type: 'open_module', action_key: 'open_tasks' },
                available_actions: [],
            };
        })(),
    ];
    return {
        columns,
        rows: [
            {
                row_key: rowPeriod ? `period:${rowPeriod.period_key}` : 'period:none',
                period_key: rowPeriod?.period_key ?? '',
                period_display_he: rowPeriod?.period_display_he ?? '—',
                cells,
            },
        ],
    };
}
function obligationActionList(obligationType) {
    if (obligationType === 'vat_report') {
        return [
            { action_key: 'open_documents', label_he: 'פתח מסמכים' },
            { action_key: 'request_documents', label_he: 'בקש מסמכים מהלקוח' },
            { action_key: 'mark_reported', label_he: 'סמן כהוגש' },
        ];
    }
    if (obligationType === 'payroll_data') {
        return [
            { action_key: 'open_payroll', label_he: 'פתח שכר' },
            { action_key: 'request_salary_data', label_he: 'בקש נתוני שכר' },
        ];
    }
    return [{ action_key: 'open_related_module', label_he: 'פתח מודול קשור' }];
}
function taskSuggestedActionByType(taskType) {
    switch (taskType) {
        case 'verify_report_submitted':
            return { action_key: 'open_obligations', label_he: 'פתח התחייבויות' };
        case 'ask_why_no_salary_data':
            return { action_key: 'open_payroll', label_he: 'פתח שכר' };
        case 'recurring_missing_income_data':
            return { action_key: 'open_income_tax', label_he: 'בדוק הכנסות' };
        case 'call_client_missing_material':
            return { action_key: 'open_obligations', label_he: 'פתח התחייבויות' };
        default:
            return null;
    }
}
function vatDueDateFromPeriod(reportingEndYear, reportingEndMonth, vatDueType) {
    const dueDay = vatDueType === 'pcn' ? 23 : 19;
    const due = shiftUtcMonth(reportingEndYear, reportingEndMonth, 1);
    const dueMonth = due.month;
    const dueYear = due.year;
    return `${dueYear}-${String(dueMonth).padStart(2, '0')}-${String(dueDay).padStart(2, '0')}`;
}
function annualDueDate(now) {
    const y = Number(businessYmd(now).slice(0, 4));
    return `${y}-05-31`;
}
async function buildRelevantObligations(orgId, clientId, now) {
    const [{ data: profRow }, { data: taxRow }] = await Promise.all([
        supabaseAdmin
            .from('client_operational_profiles')
            .select('business_type,payroll_flag,material_brought_flag,salary_data_received_flag,income_data_received_flag')
            .eq('organization_id', orgId)
            .eq('client_id', clientId)
            .maybeSingle(),
        supabaseAdmin
            .from('client_tax_settings')
            .select('vat_type,vat_frequency,vat_due_type,income_tax_advance_enabled,income_tax_deductions_enabled,income_tax_deductions_file_number,income_tax_deductions_frequency,national_insurance_type,national_insurance_monthly_amount,national_insurance_standing_order_until')
            .eq('organization_id', orgId)
            .eq('client_id', clientId)
            .maybeSingle(),
    ]);
    const p = (profRow ?? {});
    const t = (taxRow ?? {});
    const out = [];
    const mm = monthKey(now);
    const yyyy = businessYmd(now).slice(0, 4);
    const day = businessDayOfMonth(now);
    const materialBrought = Boolean(p.material_brought_flag);
    const salaryReceived = Boolean(p.salary_data_received_flag);
    const incomeReceived = Boolean(p.income_data_received_flag);
    const businessType = String(p.business_type ?? '');
    if (String(t.vat_type ?? '') === 'yes') {
        const vatFrequency = String(t.vat_frequency ?? '');
        const isBiMonthlyVat = vatFrequency === 'bi_monthly' || vatFrequency === 'דו חודשי';
        const vatPeriod = isBiMonthlyVat ? vatReportingPeriodBiMonthly(now) : vatReportingPeriodMonthly(now);
        const due = vatDueDateFromPeriod(vatPeriod.reporting_end_year, vatPeriod.reporting_end_month, t.vat_due_type ?? null);
        const periodKey = vatPeriod.period_key;
        const missingMaterialState = day > 6 ? 'missing_data' : 'waiting_for_material';
        const status = materialBrought ? 'ready_to_report' : missingMaterialState;
        out.push({
            obligation_type: 'vat_report',
            period_key: periodKey,
            due_date: due,
            related_module: 'vat',
            computed_status: status,
        });
    }
    if (businessType === 'עוסק פטור') {
        const due = `${yyyy}-12-31`;
        out.push({
            obligation_type: 'exempt_declaration',
            period_key: yyyy,
            due_date: due,
            related_module: 'vat',
            computed_status: 'ready_to_report',
        });
    }
    const hasDeductionsFile = String(t.income_tax_deductions_file_number ?? '').trim() !== '';
    if (hasDeductionsFile || Boolean(p.payroll_flag)) {
        const due = `${mm}-10`;
        const status = salaryReceived ? 'ready_to_process' : day >= 10 ? 'missing_data' : 'waiting_for_salary_data';
        out.push({
            obligation_type: 'payroll_data',
            period_key: mm,
            due_date: due,
            related_module: 'payroll',
            computed_status: status,
        });
    }
    if (Boolean(t.income_tax_advance_enabled)) {
        const due = `${mm}-10`;
        const status = incomeReceived ? 'ready_to_report' : day >= 10 ? 'missing_data' : 'waiting_for_income_data';
        out.push({
            obligation_type: 'income_tax_advance',
            period_key: mm,
            due_date: due,
            related_module: 'tax',
            computed_status: status,
        });
    }
    {
        const hasItdFile = String(t.income_tax_deductions_file_number ?? '').trim() !== '';
        if (Boolean(t.income_tax_deductions_enabled) && hasItdFile) {
            const freq = normalizeIncomeTaxDeductionsFrequency(String(t.income_tax_deductions_frequency ?? ''));
            if (freq) {
                const req = resolveIncomeTaxDeductionsRequirement(now, freq);
                if (req.is_required) {
                    out.push({
                        obligation_type: 'income_tax_deductions',
                        period_key: req.period_key,
                        due_date: req.due_date,
                        related_module: 'tax',
                        computed_status: 'ready_to_process',
                    });
                }
            }
        }
    }
    const niType = String(t.national_insurance_type ?? '');
    const niEnabled = niType === 'yes' || niType === 'כן';
    if (niEnabled) {
        const due = `${mm}-15`;
        const standingOrderUntil = String(t.national_insurance_standing_order_until ?? '');
        const standingOrderActive = Boolean(standingOrderUntil) && standingOrderUntil >= ymd(now);
        const status = standingOrderActive ? 'paid_on_time' : 'not_paid';
        out.push({
            obligation_type: 'national_insurance_self_employed_payment',
            period_key: mm,
            due_date: due,
            related_module: 'tax',
            computed_status: status,
        });
    }
    {
        const due = annualDueDate(now);
        out.push({
            obligation_type: 'annual_report',
            period_key: yyyy,
            due_date: due,
            related_module: 'annual',
            computed_status: 'ready_to_report',
        });
    }
    return out;
}
async function loadNiSelfEmployedRelevantObligation(orgId, clientId, now) {
    const relevant = await buildRelevantObligations(orgId, clientId, now);
    return relevant.find((r) => r.obligation_type === 'national_insurance_self_employed_payment') ?? null;
}
async function upsertNiSelfEmployedRowFromRelevant(orgId, clientId, niRel, status, nowIso) {
    const { data: row } = await supabaseAdmin
        .from('client_obligations')
        .select('docflow_message_sent_at, last_reported_at')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .eq('obligation_type', niRel.obligation_type)
        .eq('period_key', niRel.period_key)
        .maybeSingle();
    const r = row;
    const closeNow = status === 'reported_and_paid';
    const { error: upErr } = await supabaseAdmin.from('client_obligations').upsert({
        organization_id: orgId,
        client_id: clientId,
        obligation_type: niRel.obligation_type,
        period_key: niRel.period_key,
        due_date: niRel.due_date,
        status,
        blocking_reason: null,
        docflow_message_sent_at: r?.docflow_message_sent_at ?? null,
        last_reported_at: r?.last_reported_at ?? null,
        related_module: niRel.related_module,
        is_active: true,
        closed_at: closeNow ? nowIso : null,
        updated_at: nowIso,
    }, { onConflict: 'organization_id,client_id,obligation_type,period_key' });
    if (upErr)
        throw new AppError(500, upErr.message ?? 'client_obligations upsert failed', 'SUPABASE_ERROR');
}
export async function recomputeClientObligationsAndTasks(ctx, clientId, now = new Date()) {
    const orgId = assertOrg(ctx);
    await ensureClientInOrg(orgId, clientId);
    await recomputeClientObligationsAndTasksForOrg(orgId, clientId, now);
}
async function recomputeClientObligationsAndTasksForOrg(orgId, clientId, now) {
    const relevant = await patchIncomeTaxDeductionsComputedStatuses(orgId, clientId, now, await buildRelevantObligations(orgId, clientId, now));
    const { data: profileRow } = await supabaseAdmin
        .from('client_operational_profiles')
        .select('material_brought_flag')
        .eq('organization_id', orgId)
        .eq('client_id', clientId)
        .maybeSingle();
    const materialBrought = Boolean(profileRow?.material_brought_flag);
    const { data: currentRows, error } = await supabaseAdmin
        .from('client_obligations')
        .select('*')
        .eq('organization_id', orgId)
        .eq('client_id', clientId);
    if (error)
        throw new AppError(500, error.message ?? 'client_obligations read failed', 'SUPABASE_ERROR');
    const current = (currentRows ?? []);
    const keyOf = (o) => `${o.obligation_type}::${o.period_key}`;
    const currentByKey = new Map(current.map((r) => [keyOf({ obligation_type: String(r.obligation_type), period_key: String(r.period_key) }), r]));
    const nextKeys = new Set(relevant.map((r) => keyOf(r)));
    for (const rel of relevant) {
        const row = currentByKey.get(keyOf(rel));
        const existingStatus = row ? String(row.status) : null;
        const niStandingOrderOverridesNotPaid = rel.obligation_type === 'national_insurance_self_employed_payment' && rel.computed_status === 'paid_on_time';
        const commandOwned = existingStatus === 'reported' ||
            existingStatus === 'reported_late' ||
            existingStatus === 'reported_and_paid' ||
            existingStatus === 'not_reported' ||
            existingStatus === 'pending_payment_confirmation' ||
            existingStatus === 'paid_on_time' ||
            existingStatus === 'paid_late' ||
            (existingStatus === 'not_paid' && !niStandingOrderOverridesNotPaid) ||
            existingStatus === 'not_relevant';
        const vatPrerequisiteMissing = rel.obligation_type === 'vat_report' && !materialBrought;
        const keepCommandOwned = commandOwned && existingStatus ? !(vatPrerequisiteMissing && isVatReportingPipelineStatus(existingStatus)) : false;
        let status = keepCommandOwned && existingStatus ? existingStatus : rel.computed_status;
        const docflowSentAt = row?.docflow_message_sent_at ?? null;
        if (!keepCommandOwned &&
            (status === 'waiting_for_material' || status === 'waiting_for_salary_data' || status === 'waiting_for_income_data') &&
            docflowSentAt) {
            status = 'waiting_client_response';
        }
        if (vatPrerequisiteMissing && isVatReportingPipelineStatus(status)) {
            status = docflowSentAt ? 'waiting_client_response' : rel.computed_status;
        }
        const closeNow = status === 'reported_and_paid';
        const nextBlockingReason = status === 'missing_data' ? 'חסר חומר מהלקוח' : null;
        const payload = {
            organization_id: orgId,
            client_id: clientId,
            obligation_type: rel.obligation_type,
            period_key: rel.period_key,
            due_date: rel.due_date,
            status,
            blocking_reason: nextBlockingReason,
            docflow_message_sent_at: docflowSentAt,
            last_reported_at: row?.last_reported_at ?? null,
            related_module: rel.related_module,
            is_active: true,
            closed_at: closeNow ? new Date().toISOString() : null,
            updated_at: new Date().toISOString(),
        };
        const { error: upErr } = await supabaseAdmin
            .from('client_obligations')
            .upsert(payload, { onConflict: 'organization_id,client_id,obligation_type,period_key' });
        if (upErr)
            throw new AppError(500, upErr.message ?? 'client_obligations upsert failed', 'SUPABASE_ERROR');
    }
    for (const old of current) {
        const key = keyOf({ obligation_type: String(old.obligation_type), period_key: String(old.period_key) });
        if (nextKeys.has(key))
            continue;
        await supabaseAdmin
            .from('client_obligations')
            .update({ is_active: false, updated_at: new Date().toISOString() })
            .eq('id', String(old.id))
            .eq('organization_id', orgId);
    }
    await syncTasksFromObligations(orgId, clientId, now);
}
function taskTypeByState(status, obligationType) {
    if (status === 'missing_data') {
        if (obligationType === 'payroll_data')
            return { task_type: 'missing_salary_data', title_he: 'חסרים נתוני שכר', action: 'פתח שכר' };
        if (obligationType === 'income_tax_advance')
            return { task_type: 'missing_income_data', title_he: 'חסרות הכנסות למקדמות', action: 'בדוק הכנסות' };
        return { task_type: 'missing_material', title_he: 'חסר חומר מהלקוח', action: 'פתח מסמכים' };
    }
    if (status === 'not_reported')
        return { task_type: 'not_reported', title_he: 'לא דווח', action: 'פתח התחייבויות' };
    if (status === 'reported_late')
        return { task_type: 'reported_late', title_he: 'הוגש באיחור', action: 'פתח התחייבויות' };
    if (status === 'not_paid')
        return { task_type: 'ni_not_paid', title_he: 'ביטוח לאומי לא שולם', action: 'בדוק עם הלקוח' };
    if (status === 'paid_late')
        return { task_type: 'ni_not_paid', title_he: 'ביטוח לאומי לא שולם (באיחור)', action: 'בדוק עם הלקוח' };
    if (status === 'pending_payment_confirmation')
        return { task_type: 'payment_pending_confirmation', title_he: 'ממתין לאישור תשלום', action: 'בדוק תשלום' };
    if (status === 'waiting_client_response' || status.startsWith('waiting_for_')) {
        return { task_type: 'waiting_client_response', title_he: 'ממתין לתשובת לקוח', action: 'בצע מעקב לקוח' };
    }
    return { task_type: 'none', title_he: 'ללא פעולה', action: '—' };
}
async function syncTasksFromObligations(orgId, clientId, now) {
    const [{ data: obligations }, { data: profile }, { data: tasks }] = await Promise.all([
        supabaseAdmin
            .from('client_obligations')
            .select('id,obligation_type,due_date,status,blocking_reason,is_active')
            .eq('organization_id', orgId)
            .eq('client_id', clientId)
            .eq('is_active', true),
        supabaseAdmin
            .from('client_operational_profiles')
            .select('assigned_handler_user_id,material_brought_flag,salary_data_received_flag,income_data_received_flag')
            .eq('organization_id', orgId)
            .eq('client_id', clientId)
            .maybeSingle(),
        supabaseAdmin
            .from('client_tasks')
            .select('id,source_id,task_type,status')
            .eq('organization_id', orgId)
            .eq('client_id', clientId)
            .eq('source_type', 'obligation'),
    ]);
    const p = (profile ?? {});
    const existingTasks = (tasks ?? []);
    const obligationsRows = (obligations ?? []);
    const taskByProblem = new Map();
    for (const t of existingTasks) {
        if (!t.source_id)
            continue;
        const k = `${t.source_id}::${t.task_type}`;
        if (!taskByProblem.has(k))
            taskByProblem.set(k, { id: t.id, status: t.status });
    }
    for (const ob of obligationsRows) {
        const obId = String(ob.id);
        const status = String(ob.status);
        const actionable = status === 'missing_data' ||
            status === 'not_reported' ||
            status === 'reported_late' ||
            status === 'not_paid' ||
            status === 'paid_late' ||
            status === 'pending_payment_confirmation' ||
            status === 'waiting_client_response' ||
            status.startsWith('waiting_for_');
        const hasMissingData = !Boolean(p.material_brought_flag) || !Boolean(p.salary_data_received_flag) || !Boolean(p.income_data_received_flag);
        const priorityScore = computePriorityScore(status, String(ob.obligation_type), hasMissingData);
        const priorityLevel = scoreToLevel(priorityScore);
        const dueDate = String(ob.due_date);
        const { task_type, title_he, action } = taskTypeByState(status, String(ob.obligation_type));
        const key = `${obId}::${task_type}`;
        const existing = taskByProblem.get(key);
        if (!actionable) {
            for (const [k, ex] of taskByProblem.entries()) {
                if (!k.startsWith(`${obId}::`))
                    continue;
                if (ex.status !== 'open' && ex.status !== 'snoozed')
                    continue;
                await supabaseAdmin
                    .from('client_tasks')
                    .update({ status: 'resolved', resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
                    .eq('id', ex.id)
                    .eq('organization_id', orgId);
            }
            continue;
        }
        if (existing && (existing.status === 'open' || existing.status === 'snoozed')) {
            await supabaseAdmin
                .from('client_tasks')
                .update({
                title_he,
                description_he: ob.blocking_reason ?? null,
                priority_score: priorityScore,
                priority_level: priorityLevel,
                due_at: `${dueDate}T00:00:00.000Z`,
                updated_at: new Date().toISOString(),
            })
                .eq('id', existing.id)
                .eq('organization_id', orgId);
            continue;
        }
        const { error: insErr } = await supabaseAdmin.from('client_tasks').insert({
            organization_id: orgId,
            assignee_user_id: p.assigned_handler_user_id ?? null,
            client_id: clientId,
            source_type: 'obligation',
            source_id: obId,
            task_type,
            title_he,
            description_he: ob.blocking_reason ?? null,
            priority_score: priorityScore,
            priority_level: priorityLevel,
            due_at: `${dueDate}T00:00:00.000Z`,
            status: 'open',
            resolved_at: null,
        });
        if (insErr)
            throw new AppError(500, insErr.message ?? 'client_tasks insert failed', 'SUPABASE_ERROR');
        await supabaseAdmin
            .from('client_tasks')
            .update({ updated_at: now.toISOString(), description_he: action })
            .eq('organization_id', orgId)
            .eq('client_id', clientId)
            .eq('source_type', 'obligation')
            .eq('source_id', obId)
            .eq('status', 'open');
    }
}
export async function getClientObligationsTabReadModel(ctx, clientId) {
    const orgId = assertOrg(ctx);
    await ensureClientInOrg(orgId, clientId);
    const now = new Date();
    const [{ data: rows, error }, { data: taxRow }, { data: profileRow }] = await Promise.all([
        supabaseAdmin
            .from('client_obligations')
            .select('*')
            .eq('organization_id', orgId)
            .eq('client_id', clientId)
            .eq('is_active', true)
            .order('due_date', { ascending: true }),
        supabaseAdmin
            .from('client_tax_settings')
            .select('national_insurance_type,national_insurance_monthly_amount,national_insurance_deductions_file_number,income_tax_deductions_enabled,income_tax_deductions_file_number,income_tax_deductions_frequency,vat_frequency,income_tax_advance_enabled,national_insurance_standing_order_until')
            .eq('organization_id', orgId)
            .eq('client_id', clientId)
            .maybeSingle(),
        supabaseAdmin
            .from('client_operational_profiles')
            .select('material_brought_flag,salary_data_received_flag,income_data_received_flag')
            .eq('organization_id', orgId)
            .eq('client_id', clientId)
            .maybeSingle(),
    ]);
    if (error)
        throw new AppError(500, error.message ?? 'obligations read failed', 'SUPABASE_ERROR');
    const all = (rows ?? []);
    const taxSnapshot = (taxRow ?? null);
    const profileSnapshot = (profileRow ?? null);
    const obligations = all.map((r) => {
        const status = String(r.status);
        const blockingReason = r.blocking_reason ?? null;
        const hasMissingData = Boolean(r.blocking_reason);
        const priorityScore = computePriorityScore(status, String(r.obligation_type), hasMissingData);
        const priorityLevel = scoreToLevel(priorityScore);
        return {
            obligation_id: String(r.id),
            obligation_type: String(r.obligation_type),
            period_key: String(r.period_key),
            period_display_he: String(r.obligation_type) === 'vat_report'
                ? vatPeriodDisplayHe(String(r.period_key))
                : String(r.obligation_type) === 'income_tax_deductions'
                    ? incomeTaxDeductionsPeriodDisplayHe(String(r.period_key))
                    : String(r.period_key),
            due_date: String(r.due_date),
            due_date_display_he: fmtDateHe(String(r.due_date)) ?? String(r.due_date),
            status_code: status,
            status_label_he: statusLabelHe(status),
            blocking_reason_he: blockingReason,
            related_module: String(r.related_module ?? ''),
            priority_score: priorityScore,
            priority_level: priorityLevel,
            suggested_actions: obligationActionList(String(r.obligation_type)),
            can_mark_reported: status !== 'reported_and_paid',
            can_mark_reported_and_paid: status !== 'reported_and_paid',
            can_mark_not_reported: true,
        };
    });
    const mm = businessPreviousMonthKey(now);
    const payrollOblForScope = obligations.find((o) => o.obligation_type === 'payroll_data' || o.obligation_type === 'payroll_submission') ?? null;
    let payrollRowForPeriod = await fetchPayrollPeriodState(orgId, clientId, mm);
    const profileSalaryFlagForPayroll = Boolean(profileSnapshot?.salary_data_received_flag);
    if (payrollOblForScope &&
        shouldPersistPayrollSalaryReceivedFromProfileFlag(profileSalaryFlagForPayroll, payrollRowForPeriod)) {
        payrollRowForPeriod = await persistPayrollSalaryReceivedWhenProfileSaysSo(orgId, clientId, mm, payrollRowForPeriod, now);
    }
    const payrollProcessForPeriod = computePayrollProcessStatus(payrollRowForPeriod);
    let niDeductionsRow = await fetchNiDeductionsPeriodRow(orgId, clientId, mm);
    const payrollReadyForNi = isPayrollReadyForNiDeductionsFlow(payrollProcessForPeriod);
    const niTaxApplicable = Boolean(taxSnapshot?.income_tax_deductions_enabled) &&
        String(taxSnapshot?.national_insurance_deductions_file_number ?? '').trim() !== '';
    const niFlowActive = niTaxApplicable && payrollReadyForNi;
    let niDeductionsAutoReminderModal = null;
    let niDeductionsManualModal = null;
    if (niFlowActive) {
        const ndStateLive = computeNiDeductionsState(niDeductionsRow, mm, now, payrollRowForPeriod.sent_to_employer);
        const dayBiz = businessDayOfMonth(now);
        let autoVisible = false;
        if (ndStateLive !== 'paid_on_time' &&
            ndStateLive !== 'paid_late' &&
            ndStateLive !== 'not_relevant' &&
            !niDeductionsRow.reminder_suppressed &&
            dayBiz >= 11 &&
            dayBiz <= 31) {
            if (dayBiz <= 15) {
                autoVisible = true;
            }
            else {
                const last = niDeductionsRow.auto_reminder_last_shown_at ? new Date(niDeductionsRow.auto_reminder_last_shown_at) : null;
                if (!last || ymd(last) !== ymd(now)) {
                    autoVisible = true;
                }
            }
        }
        if (autoVisible) {
            niDeductionsAutoReminderModal = {
                is_visible: true,
                modal_key: 'ni_deductions_auto_reminder_modal',
                title_he: 'תזכורת — ביטוח לאומי ניכויים',
                message_he: 'יש להשלים דיווח ותשלום ניכויים עד ה-15 לחודש.',
                period_key: mm,
                checkboxes: niDeductionsCheckboxDefs(mm, niDeductionsRow, payrollRowForPeriod),
                suppress_checkbox: {
                    is_visible: true,
                    is_checked: niDeductionsRow.reminder_suppressed,
                    interaction: {
                        type: 'command',
                        command_type: 'set_ni_deductions_reminder_suppressed',
                        payload: { period_key: mm, enabled: !niDeductionsRow.reminder_suppressed },
                    },
                },
                actions: niDeductionsModalActions(mm, ndStateLive),
            };
        }
        const ndManualState = computeNiDeductionsState(niDeductionsRow, mm, now, payrollRowForPeriod.sent_to_employer);
        if (ndManualState !== 'not_relevant') {
            niDeductionsManualModal = {
                modal_key: 'ni_deductions_manual_modal',
                title_he: 'עדכון ביטוח לאומי ניכויים',
                message_he: 'מעקב אחר שלבי משכורות, טפסים 100/102 ותשלום ניכויים.',
                period_key: mm,
                status_label_he: niDeductionsPresentation(ndManualState).status_label_he,
                checkboxes: niDeductionsCheckboxDefs(mm, niDeductionsRow, payrollRowForPeriod),
                actions: niDeductionsModalActions(mm, ndManualState),
            };
        }
    }
    const niDeductionsCtxForTable = niTaxApplicable
        ? {
            periodKey: mm,
            payrollReady: payrollReadyForNi,
            row: niDeductionsRow,
            sentToEmployer: payrollRowForPeriod.sent_to_employer,
        }
        : null;
    const payrollProcessCtxForTable = payrollOblForScope
        ? { payrollPeriodKey: mm, payrollProcess: payrollProcessForPeriod }
        : null;
    let incomeTaxDeductionsManualModal = null;
    let incomeTaxDeductionsCtxForTable = null;
    if (Boolean(taxSnapshot?.income_tax_deductions_enabled) && String(taxSnapshot?.income_tax_deductions_file_number ?? '').trim()) {
        const freqItd = normalizeIncomeTaxDeductionsFrequency(String(taxSnapshot?.income_tax_deductions_frequency ?? ''));
        if (freqItd) {
            const reqItd = resolveIncomeTaxDeductionsRequirement(now, freqItd);
            const rowItd = reqItd.is_required
                ? await fetchIncomeTaxDeductionsPeriodRow(orgId, clientId, reqItd.period_key)
                : defaultIncomeTaxDeductionsPeriodRow();
            incomeTaxDeductionsCtxForTable = {
                requirement: reqItd,
                payrollReady: payrollReadyForNi,
                row: rowItd,
            };
            if (reqItd.is_required) {
                const cellItd = resolveIncomeTaxDeductionsCell(incomeTaxDeductionsCtxForTable);
                incomeTaxDeductionsManualModal = buildIncomeTaxDeductionsManualModal(reqItd, rowItd, cellItd, payrollReadyForNi);
            }
        }
    }
    const vatObForLabels = obligations.find((o) => o.obligation_type === 'vat_report') ?? null;
    const payrollManualModal = payrollOblForScope
        ? buildPayrollManualModal(mm, payrollRowForPeriod)
        : null;
    const annual = obligations.find((o) => o.obligation_type === 'annual_report') ?? null;
    const today = ymd(now);
    const soonBorder = ymd(addDays(new Date(now.getTime()), 3));
    const overdueCount = obligations.filter((o) => o.status_code === 'not_reported' ||
        o.status_code === 'reported_late' ||
        o.status_code === 'paid_late' ||
        (o.status_code === 'not_paid' && Boolean(o.due_date) && today > o.due_date)).length;
    const dueTodayCount = obligations.filter((o) => (o.status_code === 'waiting_client_response' ||
        o.status_code === 'waiting_for_material' ||
        o.status_code === 'waiting_for_salary_data' ||
        o.status_code === 'waiting_for_income_data' ||
        o.status_code === 'ready_to_report' ||
        o.status_code === 'ready_to_process' ||
        o.status_code === 'not_paid') &&
        o.due_date === today).length;
    const dueSoonCount = obligations.filter((o) => (o.status_code === 'waiting_client_response' ||
        o.status_code === 'waiting_for_material' ||
        o.status_code === 'waiting_for_salary_data' ||
        o.status_code === 'waiting_for_income_data' ||
        o.status_code === 'ready_to_report' ||
        o.status_code === 'ready_to_process' ||
        o.status_code === 'not_paid') &&
        o.due_date > today &&
        o.due_date <= soonBorder).length;
    const niRelSpec = await loadNiSelfEmployedRelevantObligation(orgId, clientId, now);
    const niObFromDb = niRelSpec
        ? obligations.find((o) => o.obligation_type === 'national_insurance_self_employed_payment' && o.period_key === niRelSpec.period_key) ?? null
        : null;
    const niPlaceholderObligationId = '00000000-0000-0000-0000-000000000001';
    const niOb = (() => {
        if (niObFromDb)
            return niObFromDb;
        if (!niRelSpec)
            return null;
        const st = niRelSpec.computed_status;
        return {
            obligation_id: niPlaceholderObligationId,
            obligation_type: niRelSpec.obligation_type,
            period_key: niRelSpec.period_key,
            period_display_he: niRelSpec.period_key,
            due_date: niRelSpec.due_date,
            due_date_display_he: fmtDateHe(niRelSpec.due_date) ?? niRelSpec.due_date,
            status_code: st,
            status_label_he: statusLabelHe(st),
            blocking_reason_he: null,
            related_module: niRelSpec.related_module,
            priority_score: 0,
            priority_level: 'low',
            suggested_actions: obligationActionList(niRelSpec.obligation_type),
            can_mark_reported: false,
            can_mark_reported_and_paid: false,
            can_mark_not_reported: true,
        };
    })();
    const niAmountNum = Number(taxSnapshot?.national_insurance_monthly_amount ?? 0);
    const niAmount = Number.isFinite(niAmountNum) && niAmountNum > 0 ? niAmountNum : null;
    const niAmountDisplayHe = niAmount != null ? `${niAmount.toLocaleString('he-IL')} ₪` : 'לא הוגדר סכום';
    const standingOrderUntil = String(taxSnapshot?.national_insurance_standing_order_until ?? '');
    const standingOrderActive = Boolean(standingOrderUntil) && standingOrderUntil >= ymd(now);
    const niRelevant = Boolean(niRelSpec) && (niObFromDb == null || niObFromDb.status_code !== 'not_relevant');
    const niAutoReminderModal = null;
    const niManualModal = niRelevant && niOb
        ? {
            title_he: 'תשלום לביטוח לאומי',
            status_label_he: nationalInsuranceSelfEmployedCellPresentation(niOb, ymd(now)).status_label_he,
            monthly_amount: niAmount,
            monthly_amount_display_he: niAmountDisplayHe,
            standing_order_checkbox: {
                is_visible: true,
                is_checked: standingOrderActive,
                interaction: {
                    type: 'command',
                    action_key: 'set_standing_order',
                    command_type: 'set_ni_standing_order',
                    payload: { enabled: true, obligation_id: niOb.obligation_id },
                },
            },
            actions: [
                {
                    action_key: 'mark_paid',
                    action_label_he: 'שולם',
                    interaction: { type: 'command', action_key: 'mark_paid', command_type: 'mark_ni_paid', payload: { obligation_id: niOb.obligation_id } },
                },
                {
                    action_key: 'mark_not_paid',
                    action_label_he: 'עדיין לא שולם',
                    interaction: { type: 'command', action_key: 'mark_not_paid', command_type: 'mark_ni_not_paid', payload: { obligation_id: niOb.obligation_id } },
                },
                {
                    action_key: 'update_amount',
                    action_label_he: 'עדכן סכום לתשלום',
                    interaction: { type: 'open_module', action_key: 'open_national_insurance', payload: { mode: 'update_amount' } },
                },
                {
                    action_key: 'mark_not_relevant',
                    action_label_he: 'לא רלוונטי',
                    interaction: { type: 'command', action_key: 'mark_not_relevant', command_type: 'mark_ni_not_relevant', payload: { obligation_id: niOb.obligation_id } },
                },
            ],
        }
        : null;
    return {
        tab_key: 'client_obligations',
        read_model_version: 1,
        summary: {
            overdue_count: overdueCount,
            due_today_count: dueTodayCount,
            due_soon_count: dueSoonCount,
        },
        period_labels: {
            payroll_salary_period: { period_key: mm, display_he: periodKeyToDisplayHe(mm) },
            vat_reporting_period: {
                period_key: vatObForLabels?.period_key ?? '',
                display_he: vatObForLabels?.period_display_he ?? '—',
            },
        },
        payroll_ready_for_ni_deductions: payrollReadyForNi,
        payroll_manual_modal: payrollManualModal,
        ni_auto_reminder_modal: niAutoReminderModal,
        ni_manual_modal: niManualModal,
        ni_deductions_auto_reminder_modal: niDeductionsAutoReminderModal,
        ni_deductions_manual_modal: niDeductionsManualModal,
        income_tax_deductions_manual_modal: incomeTaxDeductionsManualModal,
        table: buildObligationsTable(obligations, taxSnapshot, profileSnapshot, now, niDeductionsCtxForTable, payrollProcessCtxForTable, niRelSpec?.period_key ?? null, incomeTaxDeductionsCtxForTable),
        obligations,
        period_summary: (() => {
            const base = obligations.slice(0, 12).map((o) => {
                if (o.obligation_type === 'national_insurance_self_employed_payment') {
                    const periodKey = 'תקופת דיווח - ביטוח לאומי עצמאים';
                    if (o.status_code === 'paid_late')
                        return { period_key: periodKey, status_label_he: 'שולם עם איחור' };
                    if (o.status_code === 'paid_on_time')
                        return { period_key: periodKey, status_label_he: 'שולם במועד' };
                }
                return { period_key: o.period_display_he || o.period_key, status_label_he: o.status_label_he };
            });
            if (niTaxApplicable && payrollReadyForNi) {
                const stNi = computeNiDeductionsState(niDeductionsRow, mm, now, payrollRowForPeriod.sent_to_employer);
                if (stNi === 'paid_on_time' || stNi === 'paid_late') {
                    return [
                        ...base,
                        {
                            period_key: `תקופת משכורת נוכחית — ${periodKeyToDisplayHe(mm)}`,
                            status_label_he: stNi === 'paid_on_time' ? 'שולם ודווח במועד' : 'שולם עם איחור',
                        },
                    ];
                }
                if (isNiDeductionsPeriodClosed(now, mm) && stNi === 'not_paid') {
                    return [
                        ...base,
                        {
                            period_key: `${periodKeyToDisplayHe(mm)} — ביטוח לאומי ניכויים`,
                            status_label_he: 'לא שולם',
                        },
                    ];
                }
            }
            return base;
        })(),
        annual_report_summary: annual
            ? {
                period_display_he: annual.period_display_he,
                due_date_display_he: annual.due_date_display_he,
                status_code: annual.status_code,
                status_label_he: annual.status_label_he,
                status_tone: statusTone(annual.status_code),
                icon_key: statusIconKey(annual.status_code),
            }
            : null,
        labels: { tab_title_he: 'התחייבויות' },
    };
}
export async function getClientTasksTabReadModel(ctx, clientId) {
    const orgId = assertOrg(ctx);
    await ensureClientInOrg(orgId, clientId);
    const [{ data: tasksRows, error }, { data: client }] = await Promise.all([
        supabaseAdmin
            .from('client_tasks')
            .select('*')
            .eq('organization_id', orgId)
            .eq('client_id', clientId)
            .order('priority_score', { ascending: false })
            .order('due_at', { ascending: true }),
        supabaseAdmin.from('clients').select('display_name').eq('organization_id', orgId).eq('id', clientId).maybeSingle(),
    ]);
    if (error)
        throw new AppError(500, error.message ?? 'tasks read failed', 'SUPABASE_ERROR');
    const rows = (tasksRows ?? []);
    const clientName = client?.display_name ?? null;
    const tasks = rows.map((r) => ({
        task_id: String(r.id),
        title_he: String(r.title_he ?? ''),
        description_he: r.description_he ?? null,
        client_display_name: clientName,
        priority_level: String(r.priority_level) ?? 'low',
        priority_score: Number(r.priority_score ?? 0),
        task_type: String(r.task_type ?? ''),
        status: String(r.status ?? ''),
        suggested_action: taskSuggestedActionByType(String(r.task_type ?? '')),
        due_at: r.due_at ?? null,
        due_display_he: r.due_at ? new Date(String(r.due_at)).toLocaleDateString('he-IL') : null,
    }));
    return {
        tab_key: 'client_tasks',
        read_model_version: 1,
        summary: {
            high: tasks.filter((t) => t.priority_level === 'high').length,
            medium: tasks.filter((t) => t.priority_level === 'medium').length,
            low: tasks.filter((t) => t.priority_level === 'low').length,
        },
        tasks,
        labels: { tab_title_he: 'משימות' },
    };
}
function readObligationId(payload) {
    const id = String(payload.obligation_id ?? '').trim();
    if (!id)
        throw badRequest('obligation_id required');
    return id;
}
function readTaskId(payload) {
    const id = String(payload.task_id ?? '').trim();
    if (!id)
        throw badRequest('task_id required');
    return id;
}
function readPeriodKey(payload) {
    const p = String(payload.period_key ?? '').trim();
    if (!p)
        throw badRequest('period_key required');
    return p;
}
function readPayrollPeriodKey(payload) {
    const p = String(payload.payroll_period_key ?? payload.period_key ?? '').trim();
    if (!p)
        throw badRequest('payroll_period_key required');
    return p;
}
export async function executeClientObligationsCommand(ctx, clientId, body) {
    const orgId = assertOrg(ctx);
    await ensureClientInOrg(orgId, clientId);
    const payload = (body.payload ?? {});
    const commandNow = new Date();
    const nowIso = commandNow.toISOString();
    let skipRecomputeAfterCommand = false;
    let obligationAuditExtra = {};
    switch (body.type) {
        case 'mark_obligation_reported': {
            const id = readObligationId(payload);
            const [{ data: ob }, { data: profile }] = await Promise.all([
                supabaseAdmin
                    .from('client_obligations')
                    .select('due_date,obligation_type,status')
                    .eq('organization_id', orgId)
                    .eq('client_id', clientId)
                    .eq('id', id)
                    .maybeSingle(),
                supabaseAdmin
                    .from('client_operational_profiles')
                    .select('material_brought_flag,salary_data_received_flag,income_data_received_flag')
                    .eq('organization_id', orgId)
                    .eq('client_id', clientId)
                    .maybeSingle(),
            ]);
            const obRow = (ob ?? null);
            if (!obRow)
                throw badRequest('obligation not found');
            const currentState = String(obRow.status ?? '');
            if (currentState !== 'ready_to_report' && currentState !== 'ready_to_process') {
                throw badRequest('obligation is not ready to report');
            }
            const obligationType = String(obRow.obligation_type ?? '');
            const p = (profile ?? {});
            if (obligationType === 'vat_report' && !Boolean(p.material_brought_flag)) {
                throw badRequest('cannot report VAT without material');
            }
            if (obligationType === 'payroll_data' && !Boolean(p.salary_data_received_flag)) {
                throw badRequest('cannot report payroll without salary data');
            }
            if (obligationType === 'income_tax_advance' && !Boolean(p.income_data_received_flag)) {
                throw badRequest('cannot report income advances without income data');
            }
            const dueDate = String(obRow.due_date ?? '');
            const reportDate = businessYmd(new Date(nowIso));
            const nextStatus = dueDate && reportDate > dueDate ? 'reported_late' : 'reported';
            await supabaseAdmin
                .from('client_obligations')
                .update({ status: nextStatus, last_reported_at: nowIso, updated_at: nowIso })
                .eq('id', id)
                .eq('organization_id', orgId)
                .eq('client_id', clientId)
                .eq('status', currentState);
            break;
        }
        case 'mark_obligation_reported_and_paid': {
            const id = readObligationId(payload);
            await supabaseAdmin
                .from('client_obligations')
                .update({ status: 'reported_and_paid', closed_at: nowIso, last_reported_at: nowIso, updated_at: nowIso })
                .eq('organization_id', orgId)
                .eq('client_id', clientId)
                .eq('id', id);
            break;
        }
        case 'mark_obligation_not_reported': {
            const id = readObligationId(payload);
            await supabaseAdmin
                .from('client_obligations')
                .update({ status: 'not_reported', updated_at: nowIso })
                .eq('organization_id', orgId)
                .eq('client_id', clientId)
                .eq('id', id);
            break;
        }
        case 'notify_client_payment_amount': {
            const id = readObligationId(payload);
            await supabaseAdmin
                .from('client_obligations')
                .update({ status: 'pending_payment_confirmation', updated_at: nowIso })
                .eq('organization_id', orgId)
                .eq('client_id', clientId)
                .eq('id', id);
            break;
        }
        case 'send_docflow_request':
        case 'approve_docflow_reminder_send':
        case 'dismiss_docflow_reminder': {
            const id = readObligationId(payload);
            await supabaseAdmin
                .from('client_obligations')
                .update({
                docflow_message_sent_at: body.type === 'dismiss_docflow_reminder' ? null : nowIso,
                updated_at: nowIso,
            })
                .eq('organization_id', orgId)
                .eq('client_id', clientId)
                .eq('id', id);
            break;
        }
        case 'mark_material_received':
        case 'mark_material_not_relevant':
        case 'mark_material_received_not_relevant': {
            await supabaseAdmin
                .from('client_operational_profiles')
                .upsert({
                organization_id: orgId,
                client_id: clientId,
                material_brought_flag: true,
                updated_at: nowIso,
            }, { onConflict: 'organization_id,client_id' });
            break;
        }
        case 'mark_salary_data_received':
        case 'mark_salary_data_received_not_relevant': {
            await supabaseAdmin
                .from('client_operational_profiles')
                .upsert({
                organization_id: orgId,
                client_id: clientId,
                salary_data_received_flag: true,
                updated_at: nowIso,
            }, { onConflict: 'organization_id,client_id' });
            const pk = businessPreviousMonthKey(commandNow);
            const prev = await fetchPayrollPeriodState(orgId, clientId, pk);
            await persistPayrollSalaryReceivedWhenProfileSaysSo(orgId, clientId, pk, prev, commandNow);
            break;
        }
        case 'mark_salary_data_not_relevant': {
            await supabaseAdmin
                .from('client_operational_profiles')
                .upsert({
                organization_id: orgId,
                client_id: clientId,
                salary_data_received_flag: true,
                updated_at: nowIso,
            }, { onConflict: 'organization_id,client_id' });
            const pk = businessPreviousMonthKey(commandNow);
            const next = {
                salary_data_received: false,
                sent_to_employer: false,
                no_salaries_this_month: false,
                not_relevant: true,
            };
            await persistPayrollPeriodState(orgId, clientId, pk, next, nowIso);
            await syncSalaryReceivedProfileFlagWithPayrollPeriodIfCurrent(orgId, clientId, pk, next, commandNow, nowIso);
            break;
        }
        case 'mark_income_data_received':
        case 'mark_income_data_not_relevant':
        case 'mark_income_data_received_not_relevant': {
            await supabaseAdmin
                .from('client_operational_profiles')
                .upsert({
                organization_id: orgId,
                client_id: clientId,
                income_data_received_flag: true,
                updated_at: nowIso,
            }, { onConflict: 'organization_id,client_id' });
            break;
        }
        case 'mark_ni_paid': {
            const niRel = await loadNiSelfEmployedRelevantObligation(orgId, clientId, commandNow);
            if (!niRel)
                throw badRequest('לא חל ביטוח לאומי לעצמאי ללקוח');
            const paidDayYmd = businessYmd(new Date(nowIso));
            const status = niRel.due_date && paidDayYmd > niRel.due_date ? 'paid_late' : 'paid_on_time';
            await upsertNiSelfEmployedRowFromRelevant(orgId, clientId, niRel, status, nowIso);
            break;
        }
        case 'mark_ni_not_paid': {
            const niRel = await loadNiSelfEmployedRelevantObligation(orgId, clientId, commandNow);
            if (!niRel)
                throw badRequest('לא חל ביטוח לאומי לעצמאי ללקוח');
            const todayYmd = businessYmd(new Date(nowIso));
            const status = niRel.due_date && todayYmd > niRel.due_date ? 'paid_late' : 'not_paid';
            await upsertNiSelfEmployedRowFromRelevant(orgId, clientId, niRel, status, nowIso);
            break;
        }
        case 'mark_ni_not_relevant': {
            const niRel = await loadNiSelfEmployedRelevantObligation(orgId, clientId, commandNow);
            if (!niRel)
                throw badRequest('לא חל ביטוח לאומי לעצמאי ללקוח');
            await upsertNiSelfEmployedRowFromRelevant(orgId, clientId, niRel, 'not_relevant', nowIso);
            break;
        }
        case 'set_ni_standing_order': {
            const enabled = payload.enabled !== false;
            const yearEnd = `${new Date(nowIso).getUTCFullYear()}-12-31`;
            await supabaseAdmin
                .from('client_tax_settings')
                .upsert({
                organization_id: orgId,
                client_id: clientId,
                national_insurance_standing_order_until: enabled ? yearEnd : null,
                updated_at: nowIso,
            }, { onConflict: 'organization_id,client_id' });
            if (enabled) {
                await supabaseAdmin
                    .from('client_obligations')
                    .update({ status: 'paid_on_time', updated_at: nowIso })
                    .eq('organization_id', orgId)
                    .eq('client_id', clientId)
                    .eq('obligation_type', 'national_insurance_self_employed_payment')
                    .eq('is_active', true);
            }
            break;
        }
        case 'update_ni_payment_amount': {
            const amount = Number(payload.amount ?? NaN);
            if (!Number.isFinite(amount) || amount <= 0)
                throw badRequest('invalid amount');
            await supabaseAdmin
                .from('client_tax_settings')
                .upsert({
                organization_id: orgId,
                client_id: clientId,
                national_insurance_monthly_amount: amount,
                updated_at: nowIso,
            }, { onConflict: 'organization_id,client_id' });
            break;
        }
        case 'set_ni_deductions_reminder_suppressed': {
            const periodKey = readPeriodKey(payload);
            const enabled = payload.enabled !== false;
            const cur = await fetchNiDeductionsPeriodRow(orgId, clientId, periodKey);
            await persistNiDeductionsRow(orgId, clientId, periodKey, { ...cur, reminder_suppressed: enabled }, nowIso);
            break;
        }
        case 'set_ni_deductions_step': {
            const periodKey = readPeriodKey(payload);
            const step = String(payload.step ?? '');
            const enabled = payload.enabled !== false;
            if (!['reported_102', 'reported_100', 'paid'].includes(step))
                throw badRequest('invalid ni_deductions step');
            const cur = await fetchNiDeductionsPeriodRow(orgId, clientId, periodKey);
            if (cur.not_relevant)
                throw badRequest('ni_deductions marked not relevant for period');
            const payrollSt = await fetchPayrollPeriodState(orgId, clientId, periodKey);
            if (step === 'paid' && enabled) {
                const missingSteps = [];
                if (!payrollSt.sent_to_employer)
                    missingSteps.push('sent_to_employer');
                if (!cur.reported_102)
                    missingSteps.push('reported_102');
                if (!cur.reported_100)
                    missingSteps.push('reported_100');
                if (missingSteps.length) {
                    throw new AppError(400, 'נדרשים משכורות וטפסי 100/102 לפני סימון תשלום ניכויים', 'NI_DEDUCTIONS_NOT_READY_FOR_PAYMENT', { missing_steps: missingSteps });
                }
            }
            const next = { ...cur };
            if (step === 'reported_102')
                next.reported_102 = enabled;
            if (step === 'reported_100')
                next.reported_100 = enabled;
            if (step === 'paid')
                next.paid = enabled;
            if (!enabled && (step === 'reported_102' || step === 'reported_100')) {
                next.paid = false;
            }
            const allFour = payrollSt.sent_to_employer && next.reported_102 && next.reported_100 && next.paid;
            if (!allFour) {
                next.all_completed_at = null;
            }
            else {
                next.payroll_in_progress = false;
                const wasAllFour = payrollSt.sent_to_employer && cur.reported_102 && cur.reported_100 && cur.paid;
                if (!wasAllFour)
                    next.all_completed_at = nowIso;
            }
            await persistNiDeductionsRow(orgId, clientId, periodKey, next, nowIso);
            break;
        }
        case 'mark_ni_deductions_payroll_in_progress': {
            const periodKey = businessPreviousMonthKey(commandNow);
            const cur = await fetchNiDeductionsPeriodRow(orgId, clientId, periodKey);
            if (cur.not_relevant)
                throw badRequest('ni_deductions marked not relevant for period');
            await persistNiDeductionsRow(orgId, clientId, periodKey, { ...cur, payroll_in_progress: true }, nowIso);
            break;
        }
        case 'mark_ni_deductions_reported_and_paid': {
            const periodKey = readPeriodKey(payload);
            const cur = await fetchNiDeductionsPeriodRow(orgId, clientId, periodKey);
            const payrollSt = await fetchPayrollPeriodState(orgId, clientId, periodKey);
            if (!(payrollSt.sent_to_employer && cur.reported_102 && cur.reported_100)) {
                throw badRequest('דווח ושולם — נדרשים שלבי משכורות וטפסי 100/102');
            }
            await persistNiDeductionsRow(orgId, clientId, periodKey, {
                ...cur,
                paid: true,
                reported_102: true,
                reported_100: true,
                payroll_in_progress: false,
                all_completed_at: nowIso,
                not_relevant: false,
            }, nowIso);
            break;
        }
        case 'mark_ni_deductions_not_relevant': {
            const periodKey = readPeriodKey(payload);
            const cur = await fetchNiDeductionsPeriodRow(orgId, clientId, periodKey);
            await persistNiDeductionsRow(orgId, clientId, periodKey, {
                ...defaultNiDeductionsRow(),
                reminder_suppressed: cur.reminder_suppressed,
                auto_reminder_last_shown_at: cur.auto_reminder_last_shown_at,
                not_relevant: true,
            }, nowIso);
            break;
        }
        case 'set_payroll_period_salary_data_received': {
            const pk = readPayrollPeriodKey(payload);
            const enabled = payload.enabled !== false;
            const prev = await fetchPayrollPeriodState(orgId, clientId, pk);
            const next = { ...prev };
            if (enabled) {
                next.not_relevant = false;
                next.salary_data_received = true;
            }
            else {
                next.salary_data_received = false;
                next.sent_to_employer = false;
            }
            obligationAuditExtra = {
                payroll_period_key: pk,
                previous_payroll_state: payrollStateSnapshot(prev),
                next_payroll_state: payrollStateSnapshot(next),
            };
            await persistPayrollPeriodState(orgId, clientId, pk, next, nowIso);
            await syncSalaryReceivedProfileFlagWithPayrollPeriodIfCurrent(orgId, clientId, pk, next, commandNow, nowIso);
            break;
        }
        case 'set_payroll_period_sent_to_employer': {
            const pk = readPayrollPeriodKey(payload);
            const enabled = payload.enabled !== false;
            const prev = await fetchPayrollPeriodState(orgId, clientId, pk);
            if (enabled && !prev.salary_data_received)
                throw badRequest('נדרשים נתוני שכר לפני סימון משכורות נשלחו');
            const next = { ...prev };
            if (enabled) {
                next.not_relevant = false;
                next.sent_to_employer = true;
                next.no_salaries_this_month = false;
            }
            else {
                next.sent_to_employer = false;
            }
            obligationAuditExtra = {
                payroll_period_key: pk,
                previous_payroll_state: payrollStateSnapshot(prev),
                next_payroll_state: payrollStateSnapshot(next),
            };
            await persistPayrollPeriodState(orgId, clientId, pk, next, nowIso);
            await syncSalaryReceivedProfileFlagWithPayrollPeriodIfCurrent(orgId, clientId, pk, next, commandNow, nowIso);
            break;
        }
        case 'set_payroll_period_no_salaries': {
            const pk = readPayrollPeriodKey(payload);
            const enabled = payload.enabled !== false;
            const prev = await fetchPayrollPeriodState(orgId, clientId, pk);
            const next = { ...prev };
            if (enabled) {
                next.not_relevant = false;
                next.no_salaries_this_month = true;
                next.salary_data_received = false;
                next.sent_to_employer = false;
            }
            else {
                next.no_salaries_this_month = false;
            }
            obligationAuditExtra = {
                payroll_period_key: pk,
                previous_payroll_state: payrollStateSnapshot(prev),
                next_payroll_state: payrollStateSnapshot(next),
            };
            await persistPayrollPeriodState(orgId, clientId, pk, next, nowIso);
            await syncSalaryReceivedProfileFlagWithPayrollPeriodIfCurrent(orgId, clientId, pk, next, commandNow, nowIso);
            break;
        }
        case 'mark_payroll_period_not_relevant': {
            const pk = readPayrollPeriodKey(payload);
            const prev = await fetchPayrollPeriodState(orgId, clientId, pk);
            const next = {
                salary_data_received: false,
                sent_to_employer: false,
                no_salaries_this_month: false,
                not_relevant: true,
            };
            obligationAuditExtra = {
                payroll_period_key: pk,
                previous_payroll_state: payrollStateSnapshot(prev),
                next_payroll_state: payrollStateSnapshot(next),
            };
            await persistPayrollPeriodState(orgId, clientId, pk, next, nowIso);
            await syncSalaryReceivedProfileFlagWithPayrollPeriodIfCurrent(orgId, clientId, pk, next, commandNow, nowIso);
            break;
        }
        case 'touch_ni_deductions_auto_reminder_shown': {
            const periodKey = readPeriodKey(payload);
            await touchNiDeductionsAutoReminderShown(orgId, clientId, periodKey, new Date());
            skipRecomputeAfterCommand = true;
            break;
        }
        case 'mark_income_tax_deductions_reported': {
            const periodKey = readPeriodKey(payload);
            await loadIncomeTaxDeductionsCommandContext(orgId, clientId, commandNow, periodKey);
            const payrollMm = businessPreviousMonthKey(commandNow);
            const payrollSt = await fetchPayrollPeriodState(orgId, clientId, payrollMm);
            if (!isPayrollReadyForNiDeductionsFlow(computePayrollProcessStatus(payrollSt))) {
                throw badRequest('נדרש מצב שכר מתאים לפני דיווח ניכויים');
            }
            const cur = await fetchIncomeTaxDeductionsPeriodRow(orgId, clientId, periodKey);
            if (cur.not_relevant)
                throw badRequest('סומן לא רלוונטי לתקופה');
            await persistIncomeTaxDeductionsRow(orgId, clientId, periodKey, { reported: true, paid: cur.paid, not_relevant: false }, nowIso);
            break;
        }
        case 'mark_income_tax_deductions_paid': {
            const periodKey = readPeriodKey(payload);
            await loadIncomeTaxDeductionsCommandContext(orgId, clientId, commandNow, periodKey);
            const payrollMm = businessPreviousMonthKey(commandNow);
            const payrollSt = await fetchPayrollPeriodState(orgId, clientId, payrollMm);
            if (!isPayrollReadyForNiDeductionsFlow(computePayrollProcessStatus(payrollSt))) {
                throw badRequest('נדרש מצב שכר מתאים לפני דיווח ניכויים');
            }
            const cur = await fetchIncomeTaxDeductionsPeriodRow(orgId, clientId, periodKey);
            if (cur.not_relevant)
                throw badRequest('סומן לא רלוונטי לתקופה');
            await persistIncomeTaxDeductionsRow(orgId, clientId, periodKey, { reported: true, paid: true, not_relevant: false }, nowIso);
            break;
        }
        case 'mark_income_tax_deductions_not_relevant': {
            const periodKey = readPeriodKey(payload);
            await loadIncomeTaxDeductionsCommandContext(orgId, clientId, commandNow, periodKey);
            await persistIncomeTaxDeductionsRow(orgId, clientId, periodKey, { reported: false, paid: false, not_relevant: true }, nowIso);
            break;
        }
        default:
            throw badRequest('Unknown obligations command');
    }
    if (!skipRecomputeAfterCommand) {
        await recomputeClientObligationsAndTasksForOrg(orgId, clientId, new Date());
    }
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        moduleCode: 'client-operations',
        entityType: 'client_obligations',
        entityId: clientId,
        action: AUDIT_ACTIONS.CLIENT_OBLIGATION_COMMAND_EXECUTED,
        payload: {
            client_id: clientId,
            command: body.type,
            obligation_id: payload.obligation_id ?? null,
            obligation_type: payload.obligation_type ?? null,
            period_key: payload.period_key ?? null,
            payroll_period_key: payload.payroll_period_key ?? null,
            amount: payload.amount ?? null,
            ...obligationAuditExtra,
        },
    });
}
export async function executeClientTasksCommand(ctx, clientId, body) {
    const orgId = assertOrg(ctx);
    await ensureClientInOrg(orgId, clientId);
    const payload = (body.payload ?? {});
    const taskId = readTaskId(payload);
    const nowIso = new Date().toISOString();
    if (body.type === 'resolve_task') {
        await supabaseAdmin
            .from('client_tasks')
            .update({ status: 'resolved', resolved_at: nowIso, updated_at: nowIso })
            .eq('organization_id', orgId)
            .eq('client_id', clientId)
            .eq('id', taskId);
    }
    else if (body.type === 'snooze_task') {
        const hours = Number(payload.hours ?? 24);
        const dueAt = new Date(Date.now() + Math.max(1, hours) * 60 * 60 * 1000).toISOString();
        await supabaseAdmin
            .from('client_tasks')
            .update({ status: 'snoozed', due_at: dueAt, updated_at: nowIso })
            .eq('organization_id', orgId)
            .eq('client_id', clientId)
            .eq('id', taskId);
    }
    else if (body.type === 'reopen_task') {
        await supabaseAdmin
            .from('client_tasks')
            .update({ status: 'open', resolved_at: null, updated_at: nowIso })
            .eq('organization_id', orgId)
            .eq('client_id', clientId)
            .eq('id', taskId);
    }
    else {
        throw badRequest('Unknown task command');
    }
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        moduleCode: 'client-operations',
        entityType: 'client_tasks',
        entityId: clientId,
        action: AUDIT_ACTIONS.CLIENT_TASK_COMMAND_EXECUTED,
        payload: { client_id: clientId, command: body.type, task_id: taskId },
    });
}
export async function runClientOperationsNightPass(ctx, asOfDate) {
    const orgId = assertOrg(ctx);
    const now = asOfDate ? new Date(`${asOfDate}T00:00:00.000Z`) : new Date();
    if (Number.isNaN(now.getTime()))
        throw badRequest('Invalid as_of_date');
    const { data: clients, error } = await supabaseAdmin
        .from('clients')
        .select('id')
        .eq('organization_id', orgId)
        .eq('is_archived', false);
    if (error)
        throw new AppError(500, error.message ?? 'clients read failed', 'SUPABASE_ERROR');
    let processed = 0;
    for (const c of (clients ?? [])) {
        await recomputeClientObligationsAndTasksForOrg(orgId, c.id, now);
        processed += 1;
    }
    await writeAudit({
        organizationId: orgId,
        actorUserId: ctx.user.id,
        moduleCode: 'client-operations',
        entityType: 'client_operations_night_pass',
        entityId: orgId,
        action: AUDIT_ACTIONS.CLIENT_OPERATIONS_NIGHT_PASS_EXECUTED,
        payload: { processed_clients: processed, as_of_date: ymd(now) },
    });
    return { processed_clients: processed, organization_id: orgId, as_of_date: ymd(now) };
}
