/**
 * INC-5 — Internal Accounting Base posting boundary for issued Income documents.
 * Uses forCommand* entry/link services only (no direct table writes from Income module).
 */
import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { badRequest } from '../../shared/errors.js';
import { forCommandCreateEntry, forCommandUpdateEntry } from './entry.service.js';
import { forCommandCreateLink } from './link.service.js';
import { forCommandCreatePeriod } from './period.service.js';
import { forCommandCreateCategory } from './category.service.js';
import { forSystemRecomputeDerivedSummaries } from './summary.service.js';
import { buildAccountingPostingSignature, extractPostingAmountFromTotals, resolveIncomeAccountingPostingPlan, } from '../income/income-accounting-posting.mapping.js';
const INCOME_CATEGORY_CODE = 'income_module_revenue';
const INCOME_CATEGORY_NAME = 'Income module revenue';
async function findExistingPosting(organizationId, incomeDocumentId) {
    const { data: links } = await supabaseAdmin
        .from('accounting_entry_links')
        .select('id, accounting_entry_id')
        .eq('organization_id', organizationId)
        .eq('target_entity_type', 'module_entity')
        .eq('target_entity_id', incomeDocumentId)
        .eq('relation_type', 'source')
        .limit(1);
    const link = (links ?? [])[0];
    if (!link)
        return null;
    return { entry_id: link.accounting_entry_id, link_id: link.id };
}
async function resolvePeriodForIssueDate(ctx, organizationId, issueDate, currency) {
    const { data: periods } = await supabaseAdmin
        .from('accounting_periods')
        .select('id, status, period_start, period_end')
        .eq('organization_id', organizationId)
        .lte('period_start', issueDate)
        .gte('period_end', issueDate)
        .in('status', ['open', 'locked'])
        .order('period_start', { ascending: false })
        .limit(1);
    const existing = (periods ?? [])[0];
    if (existing?.id)
        return existing.id;
    const year = issueDate.slice(0, 4);
    const created = await forCommandCreatePeriod(ctx, organizationId, {
        period_start: `${year}-01-01`,
        period_end: `${year}-12-31`,
        period_label: `${year}`,
        base_currency: currency,
        status: 'open',
    });
    return created.id;
}
async function resolveIncomeCategoryId(ctx, organizationId) {
    const { data: existing } = await supabaseAdmin
        .from('accounting_categories')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('code', INCOME_CATEGORY_CODE)
        .eq('status', 'active')
        .maybeSingle();
    if (existing?.id)
        return existing.id;
    const created = await forCommandCreateCategory(ctx, organizationId, {
        code: INCOME_CATEGORY_CODE,
        name: INCOME_CATEGORY_NAME,
        category_type: 'income',
        status: 'active',
    });
    return created.id;
}
async function finalizeEntry(ctx, organizationId, entryId) {
    await forCommandUpdateEntry(ctx, organizationId, entryId, {
        posting_state: 'finalized',
        finalized_at: new Date().toISOString(),
        finalized_by: ctx.user.id,
    });
}
async function auditAccountingEntry(ctx, organizationId, entryId, payload) {
    await writeAudit({
        organizationId,
        actorUserId: ctx.user.id,
        moduleCode: 'accounting_base',
        entityType: 'accounting_entry',
        entityId: entryId,
        action: AUDIT_ACTIONS.ACCOUNTING_BASE_ENTRY_CREATED,
        payload,
    });
}
async function postRequiredEntries(ctx, input, plan) {
    const amount = extractPostingAmountFromTotals(input.totals_snapshot_json, input.lines_snapshot_json);
    if (amount <= 0) {
        throw badRequest('Cannot post to Accounting Base without a positive amount');
    }
    const existing = await findExistingPosting(input.organization_id, input.income_document_id);
    if (existing) {
        return {
            requires_posting: true,
            accounting_posting_status: 'posted',
            accounting_entry_id: existing.entry_id,
            accounting_entry_link_id: existing.link_id,
            accounting_posting_signature: buildAccountingPostingSignature(input.income_document_id),
            accounting_entry_ids: [existing.entry_id],
        };
    }
    const periodId = await resolvePeriodForIssueDate(ctx, input.organization_id, input.issue_date, input.currency);
    const categoryId = await resolveIncomeCategoryId(ctx, input.organization_id);
    const entryIds = [];
    let primaryLinkId = null;
    for (const spec of plan.entries) {
        const description = [
            `Income ${input.document_type}`,
            input.document_number,
            spec.description_suffix,
            input.description_note?.trim() || null,
        ]
            .filter(Boolean)
            .join(' — ');
        const entry = await forCommandCreateEntry(ctx, input.organization_id, {
            period_id: periodId,
            category_id: categoryId,
            client_id: input.client_id,
            entry_type: spec.entry_type,
            posting_state: 'draft',
            description,
            entry_date: input.issue_date,
            amount,
            currency: input.currency,
            direction: spec.direction,
            source_type: spec.source_type,
        });
        await finalizeEntry(ctx, input.organization_id, entry.id);
        entryIds.push(entry.id);
        const link = await forCommandCreateLink(ctx, input.organization_id, {
            accounting_entry_id: entry.id,
            target_entity_type: 'module_entity',
            target_entity_id: input.income_document_id,
            relation_type: 'source',
        });
        if (!primaryLinkId)
            primaryLinkId = link.id;
        await auditAccountingEntry(ctx, input.organization_id, entry.id, {
            income_document_id: input.income_document_id,
            document_type: input.document_type,
            document_number: input.document_number,
            role: spec.role,
            amount,
        });
    }
    await forSystemRecomputeDerivedSummaries(ctx, input.organization_id, { period_id: periodId });
    return {
        requires_posting: true,
        accounting_posting_status: 'posted',
        accounting_entry_id: entryIds[0] ?? null,
        accounting_entry_link_id: primaryLinkId,
        accounting_posting_signature: buildAccountingPostingSignature(input.income_document_id),
        accounting_entry_ids: entryIds,
    };
}
/**
 * Posts (or skips) Accounting Base entries for an issued income document.
 * Idempotent per income_document_id via existing links + posting signature.
 */
export async function postIncomeDocumentToAccountingBase(ctx, input) {
    const plan = resolveIncomeAccountingPostingPlan(input.document_type);
    if (!plan.requires_posting) {
        return {
            requires_posting: false,
            accounting_posting_status: 'not_required',
            accounting_entry_id: null,
            accounting_entry_link_id: null,
            accounting_posting_signature: null,
            accounting_entry_ids: [],
        };
    }
    return postRequiredEntries(ctx, input, plan);
}
