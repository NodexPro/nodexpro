/**
 * INV-3D — accounts_receivable_portfolio_aggregate composer.
 * Complete financial totals via SQL grain RPC; paginated rows via separate RPC.
 * Org from RequestContext only. No AR_CANDIDATE_MAX truncation of totals.
 */
import { supabaseAdmin } from '../../db/client.js';
import { forbidden } from '../../shared/errors.js';
import { throwIfSupabaseError } from '../../shared/supabase-errors.js';
import { backendTodayIsoDate } from '../income/invoice-lifecycle.pure.js';
import { ACCOUNTING_BASE_PAYMENT_WRITE_PERMISSION, ACCOUNTING_BASE_VIEW_PERMISSION, } from './accounting-base-income-payment.pure.js';
import { accountsReceivableSupportedDocumentTypes, accountsReceivableUnsupportedCollectibleTypes, clampArPagination, parseArCurrencyFilter, parseArOptionalIsoDate, parseArOverdueFilter, parseArPaymentStateFilter, } from './accounting-base-accounts-receivable.pure.js';
import { accountsReceivableAgingLabel, accountsReceivableAgingLabelHe, parseArAgingBucketFilter, } from './accounting-base-accounts-receivable-aging.pure.js';
import { buildPortfolioAgingFromGrain, buildPortfolioClientsFromGrain, buildPortfolioSummaryFromGrain, parseOptionalUuid, } from './accounting-base-accounts-receivable-portfolio.pure.js';
import { ACCOUNTING_BASE_AR_PORTFOLIO_GRAIN_RPC, ACCOUNTING_BASE_AR_PORTFOLIO_ROWS_RPC, ACCOUNTS_RECEIVABLE_PORTFOLIO_AGGREGATE_KEY, } from './accounting-base-accounts-receivable-portfolio.types.js';
import { assertOrgInContext } from './accounting-base.guards.js';
function hasPerm(ctx, code) {
    return (ctx.membership?.permissions ?? []).includes(code);
}
function assertPortfolioPermissions(ctx) {
    const canFinance = hasPerm(ctx, ACCOUNTING_BASE_VIEW_PERMISSION) ||
        hasPerm(ctx, ACCOUNTING_BASE_PAYMENT_WRITE_PERMISSION);
    const canOfficeClients = hasPerm(ctx, 'clients:read') || hasPerm(ctx, 'income.view');
    if (!canFinance)
        throw forbidden('accounting_base.view required');
    if (!canOfficeClients)
        throw forbidden('clients:read or income.view required for office portfolio');
}
const AGING_KEYS = new Set(['current', '1_30', '31_60', '61_90', '90_plus']);
function mapGrainRow(raw) {
    const clientId = String(raw.represented_client_id ?? '').trim();
    const aging = String(raw.aging_bucket_key ?? '').trim();
    const payment = String(raw.payment_state_key ?? '').trim();
    if (!clientId || !AGING_KEYS.has(aging))
        return null;
    if (payment !== 'unpaid' && payment !== 'partial')
        return null;
    return {
        represented_client_id: clientId,
        currency: String(raw.currency ?? 'ILS').trim().toUpperCase() || 'ILS',
        aging_bucket_key: aging,
        payment_state_key: payment,
        overdue: Boolean(raw.overdue),
        invoice_count: Number(raw.invoice_count ?? 0) || 0,
        original_amount: Number(raw.original_amount ?? 0) || 0,
        paid_amount: Number(raw.paid_amount ?? 0) || 0,
        remaining_balance: Number(raw.remaining_balance ?? 0) || 0,
        overdue_remaining_balance: Number(raw.overdue_remaining_balance ?? 0) || 0,
    };
}
async function batchLoadClientDisplayNames(orgId, clientIds) {
    const map = new Map();
    const unique = [...new Set(clientIds.filter(Boolean))];
    if (unique.length === 0)
        return map;
    // Chunk to stay under bulk .in limits.
    const CHUNK = 500;
    for (let i = 0; i < unique.length; i += CHUNK) {
        const chunk = unique.slice(i, i + CHUNK);
        const { data, error } = await supabaseAdmin
            .from('clients')
            .select('id, display_name')
            .eq('organization_id', orgId)
            .in('id', chunk);
        throwIfSupabaseError(error, 'accountsReceivablePortfolioLoadClients');
        for (const row of data ?? []) {
            const id = String(row.id);
            const name = row.display_name;
            map.set(id, name?.trim() ? name.trim() : null);
        }
    }
    return map;
}
function toPortfolioRow(raw, displayName) {
    const id = String(raw.income_document_id ?? '').trim();
    const clientId = String(raw.represented_client_id ?? '').trim();
    const aging = String(raw.aging_bucket_key ?? '').trim();
    const payment = String(raw.payment_state_key ?? '').trim();
    if (!id || !clientId || !AGING_KEYS.has(aging))
        return null;
    if (payment !== 'unpaid' && payment !== 'partial')
        return null;
    const dueState = String(raw.due_state_key ?? 'not_applicable');
    const daysRaw = raw.days_overdue;
    const days = daysRaw == null || daysRaw === ''
        ? null
        : Number.isFinite(Number(daysRaw))
            ? Number(daysRaw)
            : null;
    return {
        income_document_id: id,
        represented_client_id: clientId,
        client_display_name: displayName,
        document_number: String(raw.document_number ?? ''),
        document_type: String(raw.document_type ?? ''),
        issue_date: raw.issue_date != null ? String(raw.issue_date).slice(0, 10) : null,
        due_date: raw.due_date != null ? String(raw.due_date).slice(0, 10) : null,
        currency: String(raw.currency ?? 'ILS').trim().toUpperCase() || 'ILS',
        original_amount: Number(raw.original_amount ?? 0) || 0,
        paid_amount: Number(raw.paid_amount ?? 0) || 0,
        remaining_balance: Number(raw.remaining_balance ?? 0) || 0,
        payment_state_key: payment,
        financial_source: 'accounting_base',
        due_state_key: dueState === 'overdue' || dueState === 'not_due' || dueState === 'not_applicable'
            ? dueState
            : 'not_applicable',
        overdue: Boolean(raw.overdue),
        overdue_since: raw.overdue_since != null ? String(raw.overdue_since).slice(0, 10) : null,
        days_overdue: days,
        aging_bucket_key: aging,
        aging_label: accountsReceivableAgingLabel(aging),
        aging_label_he: accountsReceivableAgingLabelHe(aging),
    };
}
/**
 * GET /api/v1/accounting-base/aggregates/accounts-receivable-portfolio
 */
export async function buildAccountsReceivablePortfolioAggregate(params) {
    const orgId = params.ctx.organizationId;
    if (!orgId)
        throw forbidden('Organization context required');
    assertOrgInContext(params.ctx, orgId);
    assertPortfolioPermissions(params.ctx);
    const todayIso = params.todayIso ?? backendTodayIsoDate();
    const { limit, offset } = clampArPagination(params.query.limit, params.query.offset);
    const filters = {
        represented_client_id: parseOptionalUuid(params.query.represented_client_id),
        payment_state: parseArPaymentStateFilter(params.query.payment_state),
        overdue: parseArOverdueFilter(params.query.overdue),
        aging_bucket: parseArAgingBucketFilter(params.query.aging_bucket),
        currency: parseArCurrencyFilter(params.query.currency),
        due_date_from: parseArOptionalIsoDate(params.query.due_date_from),
        due_date_to: parseArOptionalIsoDate(params.query.due_date_to),
        issue_date_from: parseArOptionalIsoDate(params.query.issue_date_from),
        issue_date_to: parseArOptionalIsoDate(params.query.issue_date_to),
    };
    const rpcFilters = {
        p_organization_id: orgId,
        p_today: todayIso,
        p_represented_client_id: filters.represented_client_id,
        p_payment_state: filters.payment_state,
        p_overdue: filters.overdue,
        p_aging_bucket: filters.aging_bucket,
        p_currency: filters.currency,
        p_due_date_from: filters.due_date_from,
        p_due_date_to: filters.due_date_to,
        p_issue_date_from: filters.issue_date_from,
        p_issue_date_to: filters.issue_date_to,
    };
    const [grainRes, rowsRes] = await Promise.all([
        supabaseAdmin.rpc(ACCOUNTING_BASE_AR_PORTFOLIO_GRAIN_RPC, rpcFilters),
        supabaseAdmin.rpc(ACCOUNTING_BASE_AR_PORTFOLIO_ROWS_RPC, {
            ...rpcFilters,
            p_limit: limit,
            p_offset: offset,
        }),
    ]);
    throwIfSupabaseError(grainRes.error, 'accountsReceivablePortfolioGrain');
    throwIfSupabaseError(rowsRes.error, 'accountsReceivablePortfolioRows');
    const grains = (grainRes.data ?? [])
        .map(mapGrainRow)
        .filter((g) => g != null);
    const rawRows = (rowsRes.data ?? []);
    const totalFromGrain = grains.reduce((s, g) => s + g.invoice_count, 0);
    // Window total_count on page rows; if page empty (offset past end), fall back to grain sum.
    const resolvedTotal = rawRows.length > 0 ? Number(rawRows[0]?.total_count ?? 0) || 0 : totalFromGrain;
    const clientIds = [
        ...new Set([
            ...grains.map((g) => g.represented_client_id),
            ...rawRows.map((r) => String(r.represented_client_id ?? '')).filter(Boolean),
        ]),
    ];
    const displayNames = await batchLoadClientDisplayNames(orgId, clientIds);
    const summary = buildPortfolioSummaryFromGrain(grains);
    const aging = buildPortfolioAgingFromGrain(grains);
    const clients = buildPortfolioClientsFromGrain(grains, displayNames);
    const rows = rawRows
        .map((r) => toPortfolioRow(r, displayNames.get(String(r.represented_client_id ?? '')) ?? null))
        .filter((r) => r != null);
    const unsupported = accountsReceivableUnsupportedCollectibleTypes();
    const supported = accountsReceivableSupportedDocumentTypes();
    return {
        aggregate_key: ACCOUNTS_RECEIVABLE_PORTFOLIO_AGGREGATE_KEY,
        scope: {
            organization_id: orgId,
            scope_kind: 'office_portfolio',
        },
        summary,
        aging,
        clients,
        rows,
        filters,
        pagination: {
            limit,
            offset,
            total_count: resolvedTotal,
            has_more: offset + rows.length < resolvedTotal,
        },
        meta: {
            generated_at: new Date().toISOString(),
            financial_source: 'accounting_base',
            document_type_scope: supported,
            clients_totals_complete: true,
            notes: [
                'Office portfolio A/R (INV-3D): org + office-representative docs with represented_client_id; self docs excluded.',
                'Financial totals from SQL grain RPC — not AR_CANDIDATE_MAX hydrate; clients_totals_complete always true.',
                'V1 document types: isSupportedIncomePaymentDocumentType only (tax_invoice).',
                ...unsupported.map((t) => `Collectible type "${t}" excluded — AB payment not supported.`),
                'Legacy panel unpaid_reference / TEMP ledger / invoices-tab stubs are not used.',
                'No Work Engine collection fields in financial totals (INV-4).',
                'No cross-currency grand total; sort clients by overdue_count then name.',
            ],
        },
    };
}
