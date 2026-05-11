import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson, ApiError, userFacingApiMessage } from '../api/client';
import { OWNER } from '../api/endpoints';
import { useAuth } from '../contexts/AuthContext';
import type { AggregateAction, CommandModalState } from './owner-legal-control-panel-actions';
import {
  ActionToolbar,
  btnCompact,
  btnCompactMuted,
  CommandActionModal,
  isPayloadFieldSchema,
  labelFromActionKey,
  normalizeActions,
} from './owner-legal-control-panel-actions';
import type { OwnerCommandResponse, UnknownRecord } from './owner-legal-control-types';

function isForbidden(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 401 || e.status === 403);
}

function ownerAccessReason(e: unknown): string {
  if (!(e instanceof ApiError)) return '';
  const reasonParts: string[] = [];
  if (e.code) reasonParts.push(`code: ${e.code}`);
  if (e.message) reasonParts.push(`message: ${e.message}`);
  return reasonParts.join(' | ');
}

function isYmd(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v.trim());
}

function safeText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function slugifyPart(v: string): string {
  return v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function fmtDateYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

const RULE_TYPE_OPTIONS = [
  { label: 'Отправлять напоминания', code: 'send_reminders' },
  { label: 'Отправить просьбу прислать документы', code: 'request_documents' },
  { label: 'Отправить просьбу прислать данные по зарплатам', code: 'request_payroll_data' },
  { label: 'Отправить просьбу прислать подтверждение об оплате', code: 'request_payment_confirmation' },
  { label: 'Отправить просьбу технического характера', code: 'technical_request' },
  { label: 'Другое', code: 'other' },
] as const;

const TARGET_OPTIONS = [
  { key: 'has_payroll', label: 'у кого есть зарплаты' },
  { key: 'missing_payroll_material_previous_month', label: 'нет данных по зарплате за предыдущий месяц' },
  { key: 'vat_bi_monthly', label: 'у кого маам דו חודשי' },
  { key: 'vat_monthly', label: 'у кого маам חד חודשי' },
  { key: 'income_tax_advance_monthly', label: 'у кого מס הכנסה מקדמות חד חודשי' },
  { key: 'income_tax_bi_monthly', label: 'у кого מס הכנסה דו חודשי' },
  { key: 'all_clients', label: 'все клиенты' },
  { key: 'select_from_list', label: 'выбрать из списка' },
] as const;

const MONTH_OPTIONS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

function ensureCountryName(code: string): string {
  if (code.toUpperCase() === 'IL') return 'Israel';
  return code.toUpperCase();
}

function parseDocflowRulePayload(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (String(r.type ?? '') !== 'docflow_communication') return null;
  return r;
}

function summarizeTargets(p: Record<string, unknown>): string {
  const tf = p.target_filter;
  if (tf === 'all') return 'все клиенты';
  if (!tf || typeof tf !== 'object' || Array.isArray(tf)) return '—';
  const o = tf as Record<string, unknown>;
  const flags = Array.isArray(o.flags) ? o.flags.map((x) => String(x)) : [];
  if (o.mode === 'all') return 'все клиенты';
  const mm = String(o.match_mode ?? 'any').trim().toLowerCase();
  const joiner = mm === 'all' || mm === 'and' ? ' AND ' : ' OR ';
  return flags.length ? flags.join(joiner) : 'filtered';
}

function summarizeSchedule(p: Record<string, unknown>): string {
  const sc = p.schedule_config;
  if (!sc || typeof sc !== 'object' || Array.isArray(sc)) return '—';
  const o = sc as Record<string, unknown>;
  const day = Number(o.day ?? 0);
  const months = Array.isArray(o.months) ? o.months.map((x) => String(x)) : [];
  if (!day) return '—';
  return `day ${day}${months.length ? ` / ${months.join(', ')}` : ''}`;
}

function docflowTemplateRowAction(row: UnknownRecord, actionKey: string): AggregateAction | undefined {
  const raw = row.allowed_actions;
  if (!Array.isArray(raw)) return undefined;
  return (raw as AggregateAction[]).find((a) => String(a.action_key) === actionKey);
}

function adminPackRulesetTablesFromAgg(aggregate: UnknownRecord | null): {
  packs: UnknownRecord[];
  rulesets: UnknownRecord[];
} {
  const cpa = aggregate?.country_packs_admin as UnknownRecord | undefined;
  const tables = (cpa?.tables ?? {}) as UnknownRecord;
  return {
    packs: Array.isArray(tables.country_packs) ? (tables.country_packs as UnknownRecord[]) : [],
    rulesets: Array.isArray(tables.rulesets) ? (tables.rulesets as UnknownRecord[]) : [],
  };
}

function legalValuesTableFromAgg(aggregate: UnknownRecord | null): UnknownRecord[] {
  const legal = aggregate?.legal_values as UnknownRecord | undefined;
  const table = legal?.table;
  return Array.isArray(table) ? (table as UnknownRecord[]) : [];
}

function findDraftVersionIdForTemplate(
  aggregate: UnknownRecord | null,
  countryCode: string,
  valueKey: string,
  rulesetId: string,
  effectiveFrom: string
): string | null {
  const c = countryCode.toUpperCase();
  const k = valueKey.trim();
  const rs = rulesetId.trim();
  const ef = effectiveFrom.trim();
  const row = legalValuesTableFromAgg(aggregate).find(
    (r) => safeText(r.country_code).toUpperCase() === c && safeText(r.value_key) === k
  );
  if (!row) return null;
  const versions = Array.isArray(row.versions) ? (row.versions as UnknownRecord[]) : [];
  const hit = versions.find(
    (v) =>
      safeText(v.country_pack_ruleset_id) === rs &&
      safeText(v.effective_from) === ef &&
      safeText(v.status) === 'draft'
  );
  return hit ? safeText(hit.id) : null;
}

export function PlatformOwnerLegalControl() {
  const auth = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [accessDeniedReason, setAccessDeniedReason] = useState('');
  const [error, setError] = useState('');

  const [panel, setPanel] = useState(null as UnknownRecord | null);

  const [orgSettings, setOrgSettings] = useState(null as UnknownRecord | null);
  const [orgDiagnostics, setOrgDiagnostics] = useState(null as UnknownRecord | null);

  const [commandBusy, setCommandBusy] = useState(false);
  const [commandModal, setCommandModal] = useState(null as CommandModalState | null);
  const [legalValuesModalOpen, setLegalValuesModalOpen] = useState(false);
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [emailProviderModalOpen, setEmailProviderModalOpen] = useState(false);
  const [docflowRequestsModalOpen, setDocflowRequestsModalOpen] = useState(false);
  const [docflowRequestsModalError, setDocflowRequestsModalError] = useState('');
  const [docflowRequestTemplateDraft, setDocflowRequestTemplateDraft] = useState<{
    template_definition_id: string;
    country_code: string;
    name: string;
    items: Array<{ label: string; description: string }>;
  }>({
    template_definition_id: '',
    country_code: '',
    name: '',
    items: [{ label: '', description: '' }],
  });
  const [emailProviderModalError, setEmailProviderModalError] = useState('');
  const [appPublicUrlDraft, setAppPublicUrlDraft] = useState('');
  const appPublicUrlDraftTrimmed = appPublicUrlDraft.trim();
  const appPublicUrlIsValid = (() => {
    if (!appPublicUrlDraftTrimmed) return false;
    if (!/^https?:\/\//i.test(appPublicUrlDraftTrimmed)) return false;
    try {
      // Basic URL validation; rejects email-like strings since they don't start with http(s).
      // eslint-disable-next-line no-new
      new URL(appPublicUrlDraftTrimmed);
      return true;
    } catch {
      return false;
    }
  })();
  const [auditShowAll, setAuditShowAll] = useState(false);
  const [smartBusy, setSmartBusy] = useState(false);
  const [smartError, setSmartError] = useState('');
  const [smartNotice, setSmartNotice] = useState('');
  const [smartChecklist, setSmartChecklist] = useState<string[]>([]);

  const [docflowTemplateForm, setDocflowTemplateForm] = useState<{
    country_code: string;
    pack_code: string;
    country_pack_ruleset_id: string;
    rule_type: string;
    label: string;
    effective_from: string;
    effective_to: string;
    message_template: string;
    review_required: boolean;
    target_flags: string[];
    target_match_mode: 'any' | 'all';
    selected_list_name: string;
    schedule_day: number;
    schedule_months: string[];
    accountant_actions: string[];
    activate_after_create: boolean;
  }>({
    country_code: '',
    pack_code: '',
    country_pack_ruleset_id: '',
    rule_type: RULE_TYPE_OPTIONS[0].code,
    label: 'DocFlow communication rule',
    effective_from: '',
    effective_to: '',
    message_template: '',
    review_required: true,
    target_flags: ['all_clients'] as string[],
    target_match_mode: 'any',
    selected_list_name: '',
    schedule_day: 1,
    schedule_months: [...MONTH_OPTIONS] as string[],
    accountant_actions: ['send', 'edit', 'cancel'] as string[],
    activate_after_create: true,
  });
  const activeOrganizationId = auth.status === 'authenticated' ? auth.me.activeOrganizationId ?? '' : '';

  useEffect(() => {
    if (auth.status === 'unauthenticated') {
      navigate('/platform-owner/login?redirect=/platform-owner/legal-control', { replace: true });
    }
  }, [auth.status, navigate]);

  async function loadCore(): Promise<void> {
    setLoading(true);
    setError('');
    setAccessDenied(false);
    setAccessDeniedReason('');
    try {
      const p = (await apiJson(OWNER.legalControl)) as UnknownRecord;
      setPanel(p);
    } catch (e) {
      if (isForbidden(e)) {
        setAccessDenied(true);
        setAccessDeniedReason(ownerAccessReason(e));
      } else {
        setError(userFacingApiMessage(e));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (auth.status === 'authenticated') {
      void loadCore();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.status]);

  async function loadOrgDiagnostics(): Promise<void> {
    const orgId = activeOrganizationId.trim();
    if (!orgId) return;
    setError('');
    try {
      const [settings, diagnostics] = await Promise.all([apiJson(OWNER.countrySettings(orgId)), apiJson(OWNER.countryDiagnostics(orgId))]);
      setOrgSettings(settings as UnknownRecord);
      setOrgDiagnostics(diagnostics as UnknownRecord);
    } catch (e) {
      setError(userFacingApiMessage(e));
    }
  }

  useEffect(() => {
    if (activeOrganizationId) void loadOrgDiagnostics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrganizationId]);

  async function sendOwnerCommand(command: string, payload: UnknownRecord): Promise<OwnerCommandResponse> {
    setCommandBusy(true);
    setError('');
    try {
      const out = (await apiJson(OWNER.command, {
        method: 'POST',
        body: JSON.stringify({ command, payload }),
      })) as OwnerCommandResponse;
      const refreshed = out.refreshed.aggregate;
      if (out.refreshed.aggregate_key === 'owner_legal_control_panel_aggregate') setPanel(refreshed);
      if (out.refreshed.aggregate_key === 'organization_country_settings_aggregate') setOrgSettings(refreshed);
      return out;
    } catch (e) {
      setError(userFacingApiMessage(e));
      throw e;
    } finally {
      setCommandBusy(false);
    }
  }

  async function ensureCountryPackAndRulesetForCountry(
    aggregate: UnknownRecord | null,
    country: string
  ): Promise<{ aggregate: UnknownRecord | null; packId: string; rulesetId: string; notes: string[] }> {
    let agg = aggregate;
    const notes: string[] = [];
    const countryUp = country.toUpperCase();

    const countries = ((agg?.country_packs_admin as UnknownRecord | undefined)?.tables as UnknownRecord | undefined)?.countries;
    const countryRows = Array.isArray(countries) ? (countries as UnknownRecord[]) : [];
    const hasCountry = countryRows.some((r) => safeText(r.code).toUpperCase() === countryUp);
    if (!hasCountry) {
      const out = await sendOwnerCommand('create_country', {
        code: countryUp,
        name: ensureCountryName(countryUp),
        status: 'active',
      });
      agg = out.refreshed.aggregate as UnknownRecord;
      notes.push(`Country ${countryUp} created`);
    }

    let { packs, rulesets } = adminPackRulesetTablesFromAgg(agg);
    let packRow =
      packs.find((p) => safeText(p.country_code).toUpperCase() === countryUp && safeText(p.status) === 'enabled') ??
      packs.find((p) => safeText(p.country_code).toUpperCase() === countryUp) ??
      null;

    if (!packRow) {
      const defaultPackCode = `default_${countryUp.toLowerCase()}`;
      const out = await sendOwnerCommand('create_country_pack', {
        country_code: countryUp,
        pack_code: defaultPackCode,
        name: `Default ${countryUp} pack`,
        status: 'enabled',
        framework_version: '1.0',
        code_version: '1.0',
      });
      agg = out.refreshed.aggregate as UnknownRecord;
      ({ packs, rulesets } = adminPackRulesetTablesFromAgg(agg));
      packRow = packs.find((p) => safeText(p.country_code).toUpperCase() === countryUp && safeText(p.pack_code) === defaultPackCode) ?? null;
      notes.push(`Default country pack created (${defaultPackCode})`);
    }
    if (!packRow) throw new Error('Failed to resolve country pack');
    const packId = safeText(packRow.id);
    if (!packId) throw new Error('Country pack id is missing');

    if (safeText(packRow.status) !== 'enabled') {
      const out = await sendOwnerCommand('enable_country_pack', { country_pack_id: packId });
      agg = out.refreshed.aggregate as UnknownRecord;
      ({ rulesets } = adminPackRulesetTablesFromAgg(agg));
      notes.push('Country pack enabled');
    }

    const today = fmtDateYmd(new Date());
    const activeRuleset =
      rulesets.find((r) => safeText(r.country_pack_id) === packId && safeText(r.status) === 'active') ?? null;
    if (activeRuleset) return { aggregate: agg, packId, rulesetId: safeText(activeRuleset.id), notes };

    const defaultRulesetCode = `default_${countryUp.toLowerCase()}`;
    let out = await sendOwnerCommand('create_ruleset', {
      country_pack_id: packId,
      ruleset_code: defaultRulesetCode,
      ruleset_version: '1.0',
      effective_from: today,
      status: 'draft',
    });
    agg = out.refreshed.aggregate as UnknownRecord;
    ({ rulesets } = adminPackRulesetTablesFromAgg(agg));
    const createdRuleset =
      rulesets.find((r) => safeText(r.country_pack_id) === packId && safeText(r.ruleset_code) === defaultRulesetCode) ??
      rulesets.find((r) => safeText(r.country_pack_id) === packId) ??
      null;
    if (!createdRuleset) throw new Error('Failed to create ruleset');
    const rulesetId = safeText(createdRuleset.id);
    out = await sendOwnerCommand('activate_ruleset', { ruleset_id: rulesetId });
    agg = out.refreshed.aggregate as UnknownRecord;
    notes.push('Default ruleset created and activated');
    return { aggregate: agg, packId, rulesetId, notes };
  }

  async function toggleDocflowRule(row: { versionId: string; status: string }): Promise<void> {
    if (!row.versionId) return;
    const cmd = row.status === 'active' ? 'deactivate_legal_value_version' : 'activate_legal_value_version';
    try {
      await sendOwnerCommand(cmd, { legal_value_version_id: row.versionId });
    } catch (e) {
      setSmartError(userFacingApiMessage(e));
    }
  }

  async function toggleCountryPack(row: UnknownRecord): Promise<void> {
    const status = safeText(row.status).toLowerCase();
    const isEnableAction = status === 'draft' || status === 'disabled';
    const command = isEnableAction ? 'enable_country_pack' : 'disable_country_pack';
    const packId = safeText(row.id);
    const packCode = safeText(row.pack_code);
    if (!packId && !packCode) {
      setError('Country pack identifier is missing.');
      return;
    }
    const payload: UnknownRecord = packId ? { country_pack_id: packId } : { pack_code: packCode };
    await sendOwnerCommand(command, payload);
  }

  const countryPacksAdmin = useMemo(
    () => (panel?.country_packs_admin as UnknownRecord | undefined) ?? null,
    [panel]
  );
  const legalValues = useMemo(() => (panel?.legal_values as UnknownRecord | undefined) ?? null, [panel]);
  const pricing = useMemo(() => (panel?.platform_pricing as UnknownRecord | undefined) ?? null, [panel]);
  const emailProviderAgg = useMemo(
    () => (panel?.owner_email_provider_config_aggregate as UnknownRecord | undefined) ?? null,
    [panel]
  );
  const [emailProviderForm, setEmailProviderForm] = useState<{
    config_scope: 'platform_default' | 'organization_override';
    organization_id: string;
    provider_type: 'resend' | 'sendgrid' | 'smtp' | 'custom_api';
    provider_display_name: string;
    api_key: string;
    from_email: string;
    from_name: string;
    smtp_host: string;
    smtp_port: string;
    smtp_user: string;
    smtp_password: string;
    api_endpoint_url: string;
    http_method: 'POST';
    auth_type: 'bearer_token' | 'api_key_header';
    auth_header_name: string;
    recipient_field: string;
    subject_field: string;
    html_body_field: string;
    text_body_field: string;
    static_headers: string;
    static_payload: string;
    success_response_path: string;
    error_response_path: string;
  }>({
    config_scope: 'platform_default',
    organization_id: '',
    provider_type: 'resend',
    provider_display_name: '',
    api_key: '',
    from_email: '',
    from_name: '',
    smtp_host: '',
    smtp_port: '',
    smtp_user: '',
    smtp_password: '',
    api_endpoint_url: '',
    http_method: 'POST',
    auth_type: 'bearer_token',
    auth_header_name: 'Authorization',
    recipient_field: 'to',
    subject_field: 'subject',
    html_body_field: 'html',
    text_body_field: 'text',
    static_headers: '{}',
    static_payload: '{}',
    success_response_path: 'id',
    error_response_path: 'error.message',
  });

  const countryPackActions = useMemo(
    () => normalizeActions(panel?.available_actions ? (panel.available_actions as UnknownRecord).country_pack_admin : []),
    [panel]
  );
  const legalActions = useMemo(
    () => normalizeActions(panel?.available_actions ? (panel.available_actions as UnknownRecord).legal_values : []),
    [panel]
  );
  const pricingActions = useMemo(
    () => normalizeActions(panel?.available_actions ? (panel.available_actions as UnknownRecord).platform_pricing : []),
    [panel]
  );
  const ownerEmailProviderActions = useMemo(
    () =>
      normalizeActions(panel?.available_actions ? (panel.available_actions as UnknownRecord).owner_email_provider_config : []),
    [panel]
  );
  const ownerEmailProviderButtonLabel = useMemo(
    () => String(ownerEmailProviderActions[0]?.button_label ?? 'Email Provider'),
    [ownerEmailProviderActions]
  );

  const pricingRowAction = useMemo(() => {
    return (
      pricingActions.find((a) => {
        if (a.enabled === false || !a.payload || !isPayloadFieldSchema(a.payload)) return false;
        return Object.keys(a.payload).includes('module_plan_id');
      }) ?? null
    );
  }, [pricingActions]);

  const panelWarningsCombined = useMemo(() => {
    const w = panel?.warnings as { combined?: unknown[] } | undefined;
    return Array.isArray(w?.combined) ? (w.combined as string[]) : [];
  }, [panel]);

  const auditRecent = useMemo(() => {
    const s = panel?.audit_summary as { recent?: unknown[] } | undefined;
    return Array.isArray(s?.recent) ? (s.recent as UnknownRecord[]) : [];
  }, [panel]);

  useEffect(() => {
    setEmailProviderForm((s) => ({
      ...s,
      config_scope: 'platform_default',
      organization_id: '',
      provider_type:
        (String(emailProviderAgg?.provider_type ?? 'resend') as 'resend' | 'sendgrid' | 'smtp' | 'custom_api') || 'resend',
      provider_display_name: String(emailProviderAgg?.provider_display_name ?? ''),
      from_email: String(emailProviderAgg?.from_email ?? ''),
      from_name: String(emailProviderAgg?.from_name ?? ''),
      api_endpoint_url: String((emailProviderAgg?.custom_api_config_summary as UnknownRecord | undefined)?.api_endpoint_url ?? ''),
      http_method: 'POST',
      auth_type:
        (String((emailProviderAgg?.custom_api_config_summary as UnknownRecord | undefined)?.auth_type ?? 'bearer_token') as
          | 'bearer_token'
          | 'api_key_header') || 'bearer_token',
      auth_header_name: String((emailProviderAgg?.custom_api_config_summary as UnknownRecord | undefined)?.auth_header_name ?? 'Authorization'),
      recipient_field: String((emailProviderAgg?.custom_api_config_summary as UnknownRecord | undefined)?.recipient_field ?? 'to'),
      subject_field: String((emailProviderAgg?.custom_api_config_summary as UnknownRecord | undefined)?.subject_field ?? 'subject'),
      html_body_field: String((emailProviderAgg?.custom_api_config_summary as UnknownRecord | undefined)?.html_body_field ?? 'html'),
      text_body_field: String((emailProviderAgg?.custom_api_config_summary as UnknownRecord | undefined)?.text_body_field ?? 'text'),
      success_response_path: String(
        (emailProviderAgg?.custom_api_config_summary as UnknownRecord | undefined)?.success_response_path ?? 'id'
      ),
      error_response_path: String(
        (emailProviderAgg?.custom_api_config_summary as UnknownRecord | undefined)?.error_response_path ?? 'error.message'
      ),
    }));
    setAppPublicUrlDraft(String(emailProviderAgg?.app_public_url ?? ''));
  }, [emailProviderAgg]);

  const auditPreviewLimit = 3;
  const auditRowsVisible = useMemo(() => {
    if (auditShowAll || auditRecent.length <= auditPreviewLimit) return auditRecent;
    return auditRecent.slice(0, auditPreviewLimit);
  }, [auditRecent, auditShowAll]);
  const auditHasMore = auditRecent.length > auditPreviewLimit;

  const legalRows = useMemo(() => {
    const table = legalValues?.table;
    return Array.isArray(table) ? (table as UnknownRecord[]) : [];
  }, [legalValues]);

  const countryPackTables = useMemo(() => {
    const tables = (countryPacksAdmin?.tables ?? {}) as UnknownRecord;
    return {
      countries: Array.isArray(tables.countries) ? (tables.countries as UnknownRecord[]) : [],
      packs: Array.isArray(tables.country_packs) ? (tables.country_packs as UnknownRecord[]) : [],
      rulesets: Array.isArray(tables.rulesets) ? (tables.rulesets as UnknownRecord[]) : [],
    };
  }, [countryPacksAdmin]);

  const docflowTemplates = useMemo(() => {
    const t = panel?.docflow_communication_templates;
    return Array.isArray(t) ? (t as UnknownRecord[]) : [];
  }, [panel]);

  const ownerDocflowRequestTemplates = useMemo(() => {
    const t = panel?.docflow_request_templates;
    return Array.isArray(t) ? (t as UnknownRecord[]) : [];
  }, [panel]);

  const docflowRuleRows = useMemo(() => {
    return docflowTemplates.map((row) => {
      const payload = parseDocflowRulePayload(row.value_payload_for_edit);
      return {
        raw: row,
        versionId: safeText(row.version_id),
        valueKey: safeText(row.value_key),
        country: safeText(row.country_code).toUpperCase(),
        ruleName: safeText(row.label) || safeText(row.value_key),
        preview: safeText(row.message_template_preview),
        status: safeText(row.status) === 'active' ? 'active' : 'inactive',
        recipientsSummary: payload ? summarizeTargets(payload) : '—',
        scheduleSummary: payload ? summarizeSchedule(payload) : '—',
      };
    });
  }, [docflowTemplates]);

  const pricingRows = useMemo(() => {
    const table = (pricing?.table ?? {}) as UnknownRecord;
    const fromTable = Array.isArray(table.rows) ? (table.rows as UnknownRecord[]) : [];
    if (fromTable.length) return fromTable;
    const legacy = pricing?.rows;
    return Array.isArray(legacy) ? (legacy as UnknownRecord[]) : [];
  }, [pricing]);

  const orgSettingsRows = useMemo(() => {
    const table = (orgSettings?.table ?? {}) as UnknownRecord;
    const rows = Array.isArray(table.eligible_packs)
      ? (table.eligible_packs as UnknownRecord[])
      : [];
    return rows;
  }, [orgSettings]);

  const diagnosticsWarnings = useMemo(() => {
    const warnings = orgDiagnostics?.warnings;
    return Array.isArray(warnings) ? (warnings as UnknownRecord[]) : [];
  }, [orgDiagnostics]);

  const emptyRulesetCreateActions = useMemo(() => {
    if (countryPackTables.rulesets.length > 0) return [];
    return countryPackActions.filter((a) => {
      const k = String(a.action_key ?? '');
      return k.includes('create') && k.includes('ruleset');
    });
  }, [countryPackActions, countryPackTables.rulesets.length]);

  const countryCodeOptions = useMemo(
    () => [...new Set(countryPackTables.packs.map((p) => safeText(p.country_code)).filter(Boolean))].sort(),
    [countryPackTables.packs]
  );

  function normalizeCreateRulesetModal(
    command: string,
    meta: AggregateAction,
    prefilled: UnknownRecord
  ): { actionMeta: AggregateAction; prefilled: UnknownRecord } {
    if (command !== 'create_ruleset') {
      return { actionMeta: meta, prefilled };
    }

    const nextPrefilled = { ...prefilled };
    if (nextPrefilled.country_pack_id !== undefined && nextPrefilled.pack_code === undefined) {
      nextPrefilled.pack_code = nextPrefilled.country_pack_id;
    }
    delete nextPrefilled.country_pack_id;

    if (meta.payload && isPayloadFieldSchema(meta.payload)) {
      const schema = { ...(meta.payload as Record<string, string>) };
      if (schema.country_pack_id !== undefined) {
        schema.pack_code = schema.country_pack_id;
        delete schema.country_pack_id;
      }
      return { actionMeta: { ...meta, payload: schema }, prefilled: nextPrefilled };
    }

    return { actionMeta: meta, prefilled: nextPrefilled };
  }

  function openCommandModal(command: string, meta: AggregateAction, prefilled: UnknownRecord): void {
    const normalized = normalizeCreateRulesetModal(command, meta, prefilled);
    setCommandModal({
      command,
      actionMeta: normalized.actionMeta,
      prefilled: normalized.prefilled,
    });
  }

  async function runSmartCreateDocflowTemplate(): Promise<void> {
    setSmartError('');
    setSmartNotice('');
    setSmartChecklist([]);
    const f = docflowTemplateForm;
    if (!f.country_code) return setSmartError('Country is required.');
    if (!f.label.trim()) return setSmartError('Rule title is required.');
    if (!isYmd(f.effective_from)) return setSmartError('effective_from must be YYYY-MM-DD.');
    if (f.effective_to.trim() && !isYmd(f.effective_to)) return setSmartError('effective_to must be YYYY-MM-DD.');
    if (!f.message_template.trim()) return setSmartError('message_template is required.');
    if (f.target_flags.length === 0) return setSmartError('Select at least one recipient group.');
    if (f.target_flags.includes('select_from_list') && !f.selected_list_name.trim()) {
      return setSmartError('Provide list name for "выбрать из списка".');
    }
    if (!Number.isInteger(f.schedule_day) || f.schedule_day < 1 || f.schedule_day > 31) {
      return setSmartError('Day of month must be between 1 and 31.');
    }
    if (f.schedule_months.length === 0) return setSmartError('Pick at least one month.');
    if (f.accountant_actions.length === 0) return setSmartError('Pick at least one accountant action.');

    const notices: string[] = [];
    const checklist: string[] = [];
    const country = f.country_code.toUpperCase();
    const effFrom = f.effective_from.trim();

    setSmartBusy(true);
    try {
      let agg: UnknownRecord | null = panel;
      const ensured = await ensureCountryPackAndRulesetForCountry(agg, country);
      agg = ensured.aggregate;
      const rulesetId = ensured.rulesetId;
      for (const n of ensured.notes) notices.push(n);
      checklist.push('Country OK');
      checklist.push('Pack OK');
      checklist.push('Ruleset OK');

      const existingKeys = new Set(
        legalValuesTableFromAgg(agg)
          .filter((r) => safeText(r.country_code).toUpperCase() === country)
          .map((r) => safeText(r.value_key))
          .filter(Boolean)
      );
      const ruleTypeSlug = slugifyPart(f.rule_type);
      let idx = 1;
      let key = `docflow.communication.${country.toLowerCase()}.${ruleTypeSlug}.${String(idx).padStart(3, '0')}`;
      while (existingKeys.has(key)) {
        idx += 1;
        key = `docflow.communication.${country.toLowerCase()}.${ruleTypeSlug}.${String(idx).padStart(3, '0')}`;
      }

      const lvOut = await sendOwnerCommand('create_legal_value', {
        country_code: country,
        value_key: key,
        label: f.label.trim(),
        category: 'Modules',
        module_scope: 'docflow',
        value_type: 'json',
        status: 'active',
      });
      notices.push(`Legal value created: ${key}`);
      agg = lvOut.refreshed.aggregate as UnknownRecord;
      checklist.push('Legal Value OK');

      const isAllClients = f.target_flags.includes('all_clients');
      const targetFilter: Record<string, unknown> = {
        mode: isAllClients ? 'all' : 'filtered',
        flags: f.target_flags.filter((x) => x !== 'all_clients'),
      };
      if (!isAllClients && f.target_match_mode === 'all') {
        targetFilter.match_mode = 'all';
      }
      if (f.target_flags.includes('select_from_list')) {
        targetFilter.list_name = f.selected_list_name.trim();
      }
      const conditionConfig: Record<string, unknown> = {
        recipient_flags: f.target_flags.filter((x) => x !== 'all_clients' && x !== 'select_from_list'),
      };
      if (f.target_flags.includes('select_from_list')) {
        conditionConfig.selected_list_name = f.selected_list_name.trim();
      }
      const scheduleConfig: Record<string, unknown> = {
        kind: 'monthly',
        day: f.schedule_day,
        months: f.schedule_months,
      };

      const verOut = await sendOwnerCommand('create_legal_value_version', {
        country_code: country,
        value_key: key,
        country_pack_ruleset_id: rulesetId,
        effective_from: effFrom,
        effective_to: f.effective_to.trim() || null,
        status: 'draft',
        value_payload_json: {
          type: 'docflow_communication',
          rule_type: f.rule_type,
          message_template: f.message_template.trim(),
          review_required: f.review_required,
          message_type: 'reminder',
          target_filter: targetFilter,
          condition_config: conditionConfig,
          schedule_config: scheduleConfig,
          accountant_actions: f.accountant_actions,
        },
      });
      agg = verOut.refreshed.aggregate as UnknownRecord;
      checklist.push('Version Created');

      if (f.activate_after_create) {
        const versionId = findDraftVersionIdForTemplate(agg, country, key, rulesetId, effFrom);
        if (!versionId) {
          setSmartError(
            'Template version was created but activation could not resolve legal_value_version_id. Activate manually from the table.'
          );
          notices.push('Template created (version left draft).');
          setSmartNotice(notices.join('\n'));
          return;
        }
        await sendOwnerCommand('activate_legal_value_version', {
          legal_value_version_id: versionId,
        });
        notices.push('Version activated.');
        checklist.push('Version Activated');
      }

      if (!f.activate_after_create) checklist.push('Version Activated (skipped)');
      notices.push('Template created');
      setSmartNotice(notices.join('\n'));
      setSmartChecklist(checklist);
    } catch (e) {
      setSmartError(userFacingApiMessage(e));
    } finally {
      setSmartBusy(false);
    }
  }

  const smartWarnings = useMemo(() => {
    const out: string[] = [];
    if (docflowTemplateForm.message_template.trim() === '') {
      out.push('Template text is empty.');
    }
    if (docflowTemplateForm.target_flags.length === 0) {
      out.push('Select at least one recipient group.');
    }
    return out;
  }, [
    docflowTemplateForm.country_code,
    docflowTemplateForm.message_template,
    docflowTemplateForm.target_flags,
  ]);

  if (auth.status === 'loading' || loading) {
    return <div style={{ padding: 24 }}>Loading owner panel...</div>;
  }

  if (accessDenied) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Access denied</h1>
        <p>This page is available only for platform owner.</p>
        {accessDeniedReason ? (
          <p style={{ color: '#a94442', marginTop: 10 }}>
            {accessDeniedReason}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div style={{ padding: 20, maxWidth: 1400, margin: '0 auto' }}>
      <h1>Owner Legal Control Panel</h1>
      <p style={{ color: '#666' }}>Platform owner area. Not part of tenant workspace navigation.</p>
      {error ? <p style={{ color: 'red' }}>{error}</p> : null}
      {panelWarningsCombined.length ? (
        <div style={{ marginTop: 12, padding: 12, background: '#fff8e6', border: '1px solid #f0d090', borderRadius: 8 }}>
          <strong>Panel warnings</strong>
          <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
            {panelWarningsCombined.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <section style={{ marginTop: 18, padding: 12, border: '1px solid #dbeafe', borderRadius: 8, background: '#f8fbff' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ margin: 0 }}>DocFlow Rules</h2>
        </div>
        <p style={{ color: '#4b5563', fontSize: 13, marginTop: 8 }}>
          Owner-friendly global rules by country. Technical identifiers are managed automatically.
        </p>
        {smartWarnings.length ? (
          <div style={{ marginTop: 8, padding: 8, border: '1px solid #facc15', borderRadius: 6, background: '#fffbeb' }}>
            <strong>Warnings</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {smartWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {smartError ? <p style={{ color: '#b91c1c', marginTop: 8 }}>{smartError}</p> : null}
        {smartNotice ? (
          <p style={{ color: '#065f46', marginTop: 8, whiteSpace: 'pre-line' }}>{smartNotice}</p>
        ) : null}
        {smartChecklist.length ? (
          <div style={{ marginTop: 8, border: '1px solid #86efac', borderRadius: 6, background: '#f0fdf4', padding: 8 }}>
            <strong style={{ color: '#166534' }}>Submit checklist</strong>
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: '#166534' }}>
              {smartChecklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 10 }}>
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, background: '#fff' }}>
            <h3 style={{ marginTop: 0 }}>Create Rule</h3>
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={{ fontSize: 12, color: '#6b7280' }}>Country</label>
              <select
                value={docflowTemplateForm.country_code}
                onChange={(e) =>
                  setDocflowTemplateForm((s) => ({
                    ...s,
                    country_code: e.target.value,
                  }))
                }
              >
                <option value="">Select country</option>
                {countryCodeOptions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>

              <label style={{ fontSize: 12, color: '#6b7280' }}>Rule type</label>
              <select
                value={docflowTemplateForm.rule_type}
                onChange={(e) => setDocflowTemplateForm((s) => ({ ...s, rule_type: e.target.value }))}
              >
                {RULE_TYPE_OPTIONS.map((rt) => (
                  <option key={rt.code} value={rt.code}>{rt.label}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Rule title"
                value={docflowTemplateForm.label}
                onChange={(e) => setDocflowTemplateForm((s) => ({ ...s, label: e.target.value }))}
              />
              <textarea
                rows={4}
                placeholder="Client message template"
                value={docflowTemplateForm.message_template}
                onChange={(e) => setDocflowTemplateForm((s) => ({ ...s, message_template: e.target.value }))}
              />

              <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 8 }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Recipients / target</div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {TARGET_OPTIONS.map((opt) => {
                    const checked = docflowTemplateForm.target_flags.includes(opt.key);
                    return (
                      <label key={opt.key} style={{ fontSize: 13 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setDocflowTemplateForm((s) => ({
                              ...s,
                              target_flags: e.target.checked
                                ? [...new Set([...s.target_flags, opt.key])]
                                : s.target_flags.filter((x) => x !== opt.key),
                            }))
                          }
                        />{' '}
                        {opt.label}
                      </label>
                    );
                  })}
                </div>
                {!docflowTemplateForm.target_flags.includes('all_clients') ? (
                  <label style={{ fontSize: 13, marginTop: 8, display: 'block' }}>
                    <input
                      type="checkbox"
                      checked={docflowTemplateForm.target_match_mode === 'all'}
                      onChange={(e) =>
                        setDocflowTemplateForm((s) => ({
                          ...s,
                          target_match_mode: e.target.checked ? 'all' : 'any',
                        }))
                      }
                    />{' '}
                    Все выбранные условия (AND); иначе достаточно любого (OR)
                  </label>
                ) : null}
                {docflowTemplateForm.target_flags.includes('select_from_list') ? (
                  <input
                    type="text"
                    placeholder="List name"
                    value={docflowTemplateForm.selected_list_name}
                    onChange={(e) => setDocflowTemplateForm((s) => ({ ...s, selected_list_name: e.target.value }))}
                    style={{ marginTop: 8, width: '100%' }}
                  />
                ) : null}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <input
                  type="text"
                  placeholder="Start date (YYYY-MM-DD)"
                  value={docflowTemplateForm.effective_from}
                  onChange={(e) => setDocflowTemplateForm((s) => ({ ...s, effective_from: e.target.value }))}
                />
                <input
                  type="text"
                  placeholder="End date optional"
                  value={docflowTemplateForm.effective_to}
                  onChange={(e) => setDocflowTemplateForm((s) => ({ ...s, effective_to: e.target.value }))}
                />
              </div>

              <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 8 }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Schedule</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 8, alignItems: 'center' }}>
                  <label style={{ fontSize: 13 }}>Day of month</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={docflowTemplateForm.schedule_day}
                    onChange={(e) => setDocflowTemplateForm((s) => ({ ...s, schedule_day: Number(e.target.value || 1) }))}
                  />
                </div>
                <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 6 }}>
                  {MONTH_OPTIONS.map((m) => {
                    const checked = docflowTemplateForm.schedule_months.includes(m);
                    return (
                      <label key={m} style={{ fontSize: 12 }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setDocflowTemplateForm((s) => ({
                              ...s,
                              schedule_months: e.target.checked
                                ? [...new Set([...s.schedule_months, m])]
                                : s.schedule_months.filter((x) => x !== m),
                            }))
                          }
                        />{' '}
                        {m}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 8 }}>
                <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>Accountant actions before sending</div>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {[
                    { key: 'send', label: 'Отправить' },
                    { key: 'edit', label: 'Исправить текст' },
                    { key: 'cancel', label: 'Отменить' },
                  ].map((act) => (
                    <label key={act.key} style={{ fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={docflowTemplateForm.accountant_actions.includes(act.key)}
                        onChange={(e) =>
                          setDocflowTemplateForm((s) => ({
                            ...s,
                            accountant_actions: e.target.checked
                              ? [...new Set([...s.accountant_actions, act.key])]
                              : s.accountant_actions.filter((x) => x !== act.key),
                          }))
                        }
                      />{' '}
                      {act.label}
                    </label>
                  ))}
                </div>
              </div>
              <label style={{ fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={docflowTemplateForm.review_required}
                  onChange={(e) => setDocflowTemplateForm((s) => ({ ...s, review_required: e.target.checked }))}
                />{' '}
                review_required
              </label>
              <label style={{ fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={docflowTemplateForm.activate_after_create}
                  onChange={(e) => setDocflowTemplateForm((s) => ({ ...s, activate_after_create: e.target.checked }))}
                />{' '}
                activate version after create
              </label>
              <button type="button" style={btnCompact} disabled={smartBusy || commandBusy} onClick={() => void runSmartCreateDocflowTemplate()}>
                {smartBusy ? '...' : 'Create Rule'}
              </button>
            </div>
          </div>
        </div>
        <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 8, marginTop: 12, background: '#fff' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                {['Rule name', 'Country', 'Recipients', 'Schedule', 'Template preview', 'Status', 'Actions'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {docflowRuleRows.map((rule, idx) => {
                const row = rule.raw;
                const updateLvAction = docflowTemplateRowAction(row, 'update_legal_value_version');
                const linkedRuleset =
                  safeText(row.country_pack_ruleset_id) === ''
                    ? null
                    : (countryPackTables.rulesets.find((r) => safeText(r.id) === safeText(row.country_pack_ruleset_id)) ?? null);
                const hasRuleset = safeText(row.country_pack_ruleset_id) !== '';
                const hasActiveVersion = rule.status === 'active';
                const rulesetActive = linkedRuleset !== null && safeText(linkedRuleset.status) === 'active';
                const templateStatus = !hasRuleset ? 'missing version' : hasActiveVersion && rulesetActive ? 'ready' : 'inactive';
                return (
                  <tr key={`top:${String(row.version_id ?? idx)}:${idx}`}>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{rule.ruleName}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{rule.country}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{rule.recipientsSummary}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{rule.scheduleSummary}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8, maxWidth: 300, whiteSpace: 'pre-wrap' }}>
                      {rule.preview}
                    </td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{templateStatus}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        <button
                          type="button"
                          disabled={commandBusy || !rule.versionId}
                          style={btnCompact}
                          onClick={() => void toggleDocflowRule({ versionId: rule.versionId, status: rule.status })}
                        >
                          {rule.status === 'active' ? 'Turn OFF' : 'Turn ON'}
                        </button>
                        <button
                          type="button"
                          disabled={commandBusy || !rule.versionId || updateLvAction?.enabled !== true}
                          style={btnCompactMuted}
                          title={updateLvAction?.note ?? 'Fix payload validation errors before editing.'}
                          onClick={() => {
                            const meta = updateLvAction ?? {
                              action_key: 'update_legal_value_version',
                              enabled: true,
                            };
                            openCommandModal('update_legal_value_version', meta, {
                              legal_value_version_id: rule.versionId,
                              value_payload_json: rule.raw.value_payload_for_edit ?? {},
                              effective_from: rule.raw.effective_from,
                              effective_to: rule.raw.effective_to ?? null,
                            });
                          }}
                        >
                          Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!docflowRuleRows.length ? (
                <tr>
                  <td colSpan={7} style={{ padding: 12, background: '#fafafa', color: '#666' }}>
                    No rules yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" style={btnCompactMuted} onClick={() => setLegalValuesModalOpen(true)}>
          Legal Values
        </button>
        <button type="button" style={btnCompactMuted} onClick={() => setAuditModalOpen(true)}>
          Recent audit (legal / catalog)
        </button>
        <button type="button" style={btnCompactMuted} onClick={() => setEmailProviderModalOpen(true)}>
          {ownerEmailProviderButtonLabel}
        </button>
        <button
          type="button"
          style={btnCompactMuted}
          onClick={() => {
            setDocflowRequestsModalError('');
            setDocflowRequestsModalOpen(true);
          }}
        >
          Requests
        </button>
      </div>

      {docflowRequestsModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => setDocflowRequestsModalOpen(false)}
        >
          <div
            style={{
              background: '#fff',
              width: 'min(980px, 96vw)',
              maxHeight: '90vh',
              overflow: 'auto',
              borderRadius: 14,
              border: '1px solid #E5E7EB',
              boxShadow: '0 10px 30px rgba(15,23,42,0.14)',
              padding: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div>
                <h2 style={{ margin: 0 }}>DocFlow Requests</h2>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
                  Owner-only request templates. Country is required.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  style={btnCompactMuted}
                  onClick={() =>
                    setDocflowRequestTemplateDraft({
                      template_definition_id: '',
                      country_code: '',
                      name: '',
                      items: [{ label: '', description: '' }],
                    })
                  }
                >
                  + New template
                </button>
                <button type="button" style={btnCompactMuted} onClick={() => setDocflowRequestsModalOpen(false)}>
                  X
                </button>
              </div>
            </div>

            {docflowRequestsModalError ? (
              <p style={{ color: '#b91c1c', fontSize: 13, marginTop: 10, marginBottom: 0 }}>{docflowRequestsModalError}</p>
            ) : null}

            <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 12, marginTop: 12 }}>
              <div style={{ border: '1px solid #E5E7EB', borderRadius: 10, overflow: 'hidden' }}>
                <div style={{ padding: 10, borderBottom: '1px solid #E5E7EB', fontWeight: 700 }}>Templates</div>
                <div style={{ maxHeight: 520, overflow: 'auto' }}>
                  {!ownerDocflowRequestTemplates.length ? (
                    <div style={{ padding: 12, color: '#6b7280' }}>No templates yet.</div>
                  ) : (
                    ownerDocflowRequestTemplates.map((t, idx) => {
                      const id = safeText(t.id) || `${idx}`;
                      const isSelected = id && id === docflowRequestTemplateDraft.template_definition_id;
                      return (
                        <button
                          key={id}
                          type="button"
                          style={{
                            display: 'block',
                            width: '100%',
                            textAlign: 'left',
                            padding: 10,
                            border: 'none',
                            borderBottom: '1px solid #F3F4F6',
                            background: isSelected ? '#EFF6FF' : '#fff',
                            cursor: 'pointer',
                          }}
                          onClick={() => {
                            const rawItems = Array.isArray(t.items) ? (t.items as UnknownRecord[]) : [];
                            setDocflowRequestTemplateDraft({
                              template_definition_id: safeText(t.id),
                              country_code: safeText(t.country_code).toUpperCase(),
                              name: safeText(t.name),
                              items:
                                rawItems.length > 0
                                  ? rawItems.map((it) => ({
                                      label: safeText(it.label),
                                      description: safeText(it.description),
                                    }))
                                  : [{ label: '', description: '' }],
                            });
                          }}
                        >
                          <div style={{ fontWeight: 700, color: '#111827' }}>{safeText(t.name) || '—'}</div>
                          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{safeText(t.country_code) || '—'}</div>
                        </button>
                      );
                    })
                  )}
                </div>
              </div>

              <div style={{ border: '1px solid #E5E7EB', borderRadius: 10, padding: 12 }}>
                <div style={{ display: 'grid', gap: 10 }}>
                  <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700, color: '#374151' }}>
                    Country (required)
                    <select
                      value={docflowRequestTemplateDraft.country_code}
                      onChange={(e) => setDocflowRequestTemplateDraft((s) => ({ ...s, country_code: e.target.value }))}
                      style={{ height: 38, borderRadius: 8, border: '1px solid #D1D5DB', padding: '0 12px', fontSize: 14 }}
                    >
                      <option value="">Select country</option>
                      {countryCodeOptions.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label style={{ display: 'grid', gap: 6, fontSize: 13, fontWeight: 700, color: '#374151' }}>
                    Template name (required)
                    <input
                      type="text"
                      value={docflowRequestTemplateDraft.name}
                      onChange={(e) => setDocflowRequestTemplateDraft((s) => ({ ...s, name: e.target.value }))}
                      placeholder="VAT Monthly Documents"
                      style={{ height: 38, borderRadius: 8, border: '1px solid #D1D5DB', padding: '0 12px', fontSize: 14 }}
                    />
                  </label>

                  <div style={{ display: 'grid', gap: 8 }}>
                    <div style={{ fontSize: 13, fontWeight: 800, color: '#111827' }}>Checklist items</div>
                    {docflowRequestTemplateDraft.items.map((it, i) => (
                      <div
                        key={i}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr auto',
                          gap: 8,
                          alignItems: 'center',
                        }}
                      >
                        <input
                          type="text"
                          value={it.label}
                          onChange={(e) =>
                            setDocflowRequestTemplateDraft((s) => ({
                              ...s,
                              items: s.items.map((x, idx) => (idx === i ? { ...x, label: e.target.value } : x)),
                            }))
                          }
                          placeholder="Bank statements"
                          style={{ height: 36, borderRadius: 8, border: '1px solid #D1D5DB', padding: '0 10px', fontSize: 14 }}
                        />
                        <input
                          type="text"
                          value={it.description}
                          onChange={(e) =>
                            setDocflowRequestTemplateDraft((s) => ({
                              ...s,
                              items: s.items.map((x, idx) => (idx === i ? { ...x, description: e.target.value } : x)),
                            }))
                          }
                          placeholder="Optional description"
                          style={{ height: 36, borderRadius: 8, border: '1px solid #D1D5DB', padding: '0 10px', fontSize: 14 }}
                        />
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button
                            type="button"
                            style={btnCompactMuted}
                            disabled={i === 0}
                            onClick={() =>
                              setDocflowRequestTemplateDraft((s) => {
                                const next = s.items.slice();
                                const tmp = next[i - 1];
                                next[i - 1] = next[i];
                                next[i] = tmp;
                                return { ...s, items: next };
                              })
                            }
                            title="Move up"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            style={btnCompactMuted}
                            disabled={i === docflowRequestTemplateDraft.items.length - 1}
                            onClick={() =>
                              setDocflowRequestTemplateDraft((s) => {
                                const next = s.items.slice();
                                const tmp = next[i + 1];
                                next[i + 1] = next[i];
                                next[i] = tmp;
                                return { ...s, items: next };
                              })
                            }
                            title="Move down"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            style={btnCompactMuted}
                            onClick={() =>
                              setDocflowRequestTemplateDraft((s) => ({
                                ...s,
                                items: s.items.length <= 1 ? [{ label: '', description: '' }] : s.items.filter((_, idx) => idx !== i),
                              }))
                            }
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}

                    <div>
                      <button
                        type="button"
                        style={btnCompactMuted}
                        onClick={() => setDocflowRequestTemplateDraft((s) => ({ ...s, items: [...s.items, { label: '', description: '' }] }))}
                      >
                        + Add item
                      </button>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-end', marginTop: 6 }}>
                    {docflowRequestTemplateDraft.template_definition_id ? (
                      <button
                        type="button"
                        style={btnCompactMuted}
                        disabled={commandBusy}
                        onClick={() =>
                          void (async () => {
                            try {
                              setDocflowRequestsModalError('');
                              await sendOwnerCommand('archive_request_template_definition', {
                                template_definition_id: docflowRequestTemplateDraft.template_definition_id,
                              });
                              setDocflowRequestTemplateDraft({
                                template_definition_id: '',
                                country_code: '',
                                name: '',
                                items: [{ label: '', description: '' }],
                              });
                            } catch (e) {
                              setDocflowRequestsModalError(userFacingApiMessage(e));
                            }
                          })()
                        }
                      >
                        Archive
                      </button>
                    ) : null}
                    <button type="button" style={btnCompactMuted} onClick={() => setDocflowRequestsModalOpen(false)}>
                      Cancel
                    </button>
                    <button
                      type="button"
                      style={{ ...btnCompact, borderRadius: 8, minWidth: 96 }}
                      disabled={
                        commandBusy ||
                        !safeText(docflowRequestTemplateDraft.country_code) ||
                        !safeText(docflowRequestTemplateDraft.name) ||
                        docflowRequestTemplateDraft.items.filter((x) => safeText(x.label)).length === 0
                      }
                      onClick={() =>
                        void (async () => {
                          try {
                            setDocflowRequestsModalError('');
                            await sendOwnerCommand('save_request_template_definition', {
                              ...(docflowRequestTemplateDraft.template_definition_id
                                ? { template_definition_id: docflowRequestTemplateDraft.template_definition_id }
                                : {}),
                              country_code: docflowRequestTemplateDraft.country_code,
                              name: docflowRequestTemplateDraft.name,
                              items: docflowRequestTemplateDraft.items
                                .map((x) => ({ label: x.label.trim(), description: x.description.trim() || null }))
                                .filter((x) => x.label),
                            });
                          } catch (e) {
                            setDocflowRequestsModalError(userFacingApiMessage(e));
                          }
                        })()
                      }
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <details style={{ marginTop: 18, border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, background: '#fafafa' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Advanced technical tools</summary>
        <section style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ margin: 0 }}>1. Country Packs</h2>
          <ActionToolbar
            actions={countryPackActions.filter((a) => {
              const key = String(a.action_key ?? '');
              return key !== 'enable_country_pack' && key !== 'disable_country_pack';
            })}
            disabled={commandBusy}
            onPick={(cmd, meta, pre) => openCommandModal(cmd, meta, pre)}
          />
        </div>
        <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button type="button" style={btnCompactMuted} disabled title="Add country support will be available here.">
              Add country — coming soon
            </button>
          </div>
          <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 760 }}>
              <thead>
                <tr>
                  {['Country', 'Name', 'Status', 'Timezone'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {countryPackTables.countries.map((row, idx) => (
                  <tr key={`${String(row.code ?? '')}:${idx}`}>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.code ?? '')}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.name ?? '')}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                      {String((row.status_badge as { label?: string } | undefined)?.label ?? row.status ?? '')}
                    </td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.default_timezone ?? '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
              <thead>
                <tr>
                  {['Pack', 'Country', 'Name', 'Framework', 'Code Version', 'Status', 'Actions'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {countryPackTables.packs.map((row, idx) => {
                  const status = safeText(row.status).toLowerCase();
                  const enableAction = status === 'draft' || status === 'disabled';
                  const disableAction = status === 'active' || status === 'enabled';
                  const buttonLabel = enableAction ? 'Enable' : disableAction ? 'Disable' : null;
                  const buttonDisabled = commandBusy || !buttonLabel;
                  return (
                  <tr key={`${String(row.id ?? '')}:${idx}`}>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.pack_code ?? '')}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.country_code ?? '')}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.name ?? '')}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.framework_version ?? '')}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.code_version ?? '')}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                      {String((row.status_badge as { label?: string } | undefined)?.label ?? row.status ?? '')}
                    </td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                      {buttonLabel ? (
                        <button
                          type="button"
                          disabled={buttonDisabled}
                          style={enableAction ? btnCompact : btnCompactMuted}
                          onClick={() => void toggleCountryPack(row)}
                        >
                          {buttonLabel}
                        </button>
                      ) : (
                        <span style={{ color: '#6b7280', fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 8 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 980 }}>
              <thead>
                <tr>
                  {['Ruleset', 'Pack', 'Version', 'Effective From', 'Effective To', 'Status'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {countryPackTables.rulesets.map((row, idx) => (
                  <tr key={`${String(row.id ?? '')}:${idx}`}>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.ruleset_code ?? '')}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.country_pack_id ?? '')}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.ruleset_version ?? '')}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.effective_from ?? '')}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.effective_to ?? 'open')}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                      {String((row.status_badge as { label?: string } | undefined)?.label ?? row.status ?? '')}
                    </td>
                  </tr>
                ))}
                {!countryPackTables.rulesets.length ? (
                  <tr>
                    <td colSpan={6} style={{ padding: 12, background: '#fafafa' }}>
                      <div style={{ color: '#666', marginBottom: 8 }}>No rulesets</div>
                      <ActionToolbar
                        variant="compact"
                        actions={emptyRulesetCreateActions}
                        disabled={commandBusy}
                        onPick={(cmd, meta, pre) => openCommandModal(cmd, meta, pre)}
                      />
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
        </section>

      </details>

      <details style={{ marginTop: 18, border: '1px solid #e5e7eb', borderRadius: 8, padding: 10, background: '#fafafa' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Advanced Country Pack Tools (Pricing, Audit, Diagnostics)</summary>
        <section style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h2 style={{ margin: 0 }}>4. Pricing</h2>
          <ActionToolbar
            actions={pricingActions}
            disabled={commandBusy}
            onPick={(cmd, meta, pre) => openCommandModal(cmd, meta, pre)}
          />
        </div>
        <p style={{ color: '#666', fontSize: 13, marginBottom: 8 }}>
          Source: <strong>{String(pricing?.source ?? 'module_plans')}</strong>
          {pricing?.pricing_effective_dates === 'not_supported' ? (
            <span>
              {' '}
              — effective-date versioning is <strong>not available</strong> on catalog prices (current row only).
            </span>
          ) : null}
        </p>
        <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 8 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 900 }}>
            <thead>
              <tr>
                {['Module', 'Plan', 'Amount', 'Currency', 'Billing', 'Status', 'Actions'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pricingRows.map((row, idx) => (
                <tr key={`${String(row.module_plan_id ?? row.code ?? idx)}:${idx}`}>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                    {String(row.module_code ?? '')}
                    {row.module_name ? <div style={{ fontSize: 12, color: '#666' }}>{String(row.module_name)}</div> : null}
                  </td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                    <div>{String(row.plan_name ?? row.plan_code ?? '')}</div>
                    {row.plan_code ? <div style={{ fontSize: 12, color: '#666' }}>{String(row.plan_code)}</div> : null}
                  </td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.price_amount ?? row.current_price ?? row.price ?? '')}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.currency ?? '')}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.billing_period ?? '')}</td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                    {String((row.status_badge as { label?: string } | undefined)?.label ?? row.status ?? '')}
                  </td>
                  <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                    {pricingRowAction && pricingRowAction.action_key ? (
                      <button
                        type="button"
                        disabled={commandBusy}
                        style={btnCompact}
                        onClick={() => {
                          const id = String(row.module_plan_id ?? '');
                          if (!id) return;
                          openCommandModal(String(pricingRowAction.action_key), pricingRowAction, {
                            module_plan_id: id,
                            price_amount: row.price_amount,
                            currency: row.currency,
                            billing_period: row.billing_period,
                            is_active: row.is_active,
                          });
                        }}
                      >
                        {labelFromActionKey(String(pricingRowAction.action_key))}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
              {!pricingRows.length ? (
                <tr>
                  <td colSpan={7} style={{ padding: 12, color: '#666' }}>
                    No pricing rows
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        </section>

        <section style={{ marginTop: 18 }}>
        <h2>6. Organization Country Diagnostics</h2>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ padding: '8px 10px', border: '1px solid #ddd', borderRadius: 6, background: '#fafafa', minWidth: 360 }}>
            Organization: {activeOrganizationId || 'No active organization selected'}
          </div>
          <button type="button" onClick={() => void loadOrgDiagnostics()}>
            Reload
          </button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div>
            <h3 style={{ marginTop: 0 }}>Country Settings</h3>
            <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                <thead>
                  <tr>
                    {['Pack', 'Status', 'Ruleset', 'Eligibility'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {orgSettingsRows.map((row, idx) => (
                    <tr key={`${String(row.id ?? row.pack_code ?? '')}:${idx}`}>
                      <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.pack_code ?? row.name ?? '')}</td>
                      <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                        {String((row.status_badge as { label?: string } | undefined)?.label ?? row.status ?? '')}
                      </td>
                      <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                        {String(row.active_ruleset_code ?? row.active_ruleset_id ?? '')}
                      </td>
                      <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                        {String((row.eligibility_badge as { label?: string } | undefined)?.label ?? row.eligibility ?? '')}
                      </td>
                    </tr>
                  ))}
                  {!orgSettingsRows.length ? (
                    <tr>
                      <td colSpan={4} style={{ padding: 12, color: '#666' }}>
                        No organization country settings loaded.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
          <div>
            <h3 style={{ marginTop: 0 }}>Diagnostics</h3>
            <div style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12, background: '#fafafa' }}>
              <div><strong>Isolation:</strong> {String((orgDiagnostics?.isolation_status as string | undefined) ?? '—')}</div>
              <div><strong>Resolved country:</strong> {String((orgDiagnostics?.resolved_country_code as string | undefined) ?? '—')}</div>
              <div><strong>Resolved pack:</strong> {String((orgDiagnostics?.resolved_pack_code as string | undefined) ?? '—')}</div>
              <div><strong>Resolved ruleset:</strong> {String((orgDiagnostics?.resolved_ruleset_code as string | undefined) ?? '—')}</div>
              <div style={{ marginTop: 10 }}><strong>Warnings</strong></div>
              <ul style={{ marginTop: 6, paddingLeft: 20 }}>
                {diagnosticsWarnings.length ? diagnosticsWarnings.map((w, idx) => (
                  <li key={`${String(w.code ?? idx)}:${idx}`}>{String(w.message ?? w.code ?? '')}</li>
                )) : <li>None</li>}
              </ul>
            </div>
          </div>
        </div>
        </section>
      </details>

      {legalValuesModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => setLegalValuesModalOpen(false)}
        >
          <div
            style={{
              background: '#fff',
              width: '88vw',
              maxWidth: 1600,
              maxHeight: '90vh',
              overflow: 'auto',
              borderRadius: 10,
              border: '1px solid #d1d5db',
              padding: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <h2 style={{ margin: 0 }}>2. Legal Values</h2>
              <button type="button" style={btnCompactMuted} onClick={() => setLegalValuesModalOpen(false)}>
                X
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 10 }}>
              <ActionToolbar
                actions={legalActions}
                disabled={commandBusy}
                onPick={(cmd, meta, pre) => openCommandModal(cmd, meta, pre)}
              />
            </div>
            <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 8, marginTop: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
                <thead>
                  <tr>
                    {['Key', 'Label', 'Category', 'Module Scope', 'Current Value', 'Effective', 'Owner Note', 'Usage Hint', 'Status', 'Actions'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {legalRows.map((row) => {
                    const key = String(row.value_key ?? '');
                    const countryCode = String(row.country_code ?? '');
                    const versions = Array.isArray(row.versions) ? (row.versions as UnknownRecord[]) : [];
                    const activeVersion = versions.find((v) => v.status === 'active') ?? null;
                    const effective = activeVersion
                      ? `${String(activeVersion.effective_from ?? '')} -> ${String(activeVersion.effective_to ?? 'open')}`
                      : '—';
                    const rowPrefill = { country_code: countryCode, value_key: key };
                    return (
                      <tr key={`${countryCode}:${key}`}>
                        <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{key}</td>
                        <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.label ?? '')}</td>
                        <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.category ?? '')}</td>
                        <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.module_scope ?? '')}</td>
                        <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{JSON.stringify(row.current_active_value ?? null)}</td>
                        <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{effective}</td>
                        <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.owner_note ?? '')}</td>
                        <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.usage_hint ?? '')}</td>
                        <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String((row.status_badge as { label?: string } | undefined)?.label ?? row.status ?? '')}</td>
                        <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {legalActions.map((a) => {
                              const ak = String(a.action_key ?? '');
                              if (!ak || a.enabled === false) return null;
                              return (
                                <button
                                  key={`${countryCode}:${key}:${ak}`}
                                  type="button"
                                  disabled={commandBusy}
                                  style={btnCompactMuted}
                                  onClick={() => openCommandModal(ak, a, { ...rowPrefill, owner_note: row.owner_note ?? '' })}
                                >
                                  {labelFromActionKey(ak)}
                                </button>
                              );
                            })}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!legalRows.length ? (
                    <tr>
                      <td colSpan={10} style={{ padding: 12, background: '#fafafa', color: '#666' }}>
                        No legal values — use the actions in the section header above.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : null}

      {auditModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => setAuditModalOpen(false)}
        >
          <div
            style={{
              background: '#fff',
              width: '88vw',
              maxWidth: 1600,
              maxHeight: '90vh',
              overflow: 'auto',
              borderRadius: 10,
              border: '1px solid #d1d5db',
              padding: 16,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <h2 style={{ margin: 0 }}>5. Recent audit (legal / catalog)</h2>
              <button type="button" style={btnCompactMuted} onClick={() => setAuditModalOpen(false)}>
                X
              </button>
            </div>
            <p style={{ color: '#666', fontSize: 13, marginBottom: 8 }}>
              Latest platform-owner Country Pack, legal values, and module plan audit entries (no payload).
              {auditRecent.length ? (
                <>
                  {' '}
                  Showing {auditRowsVisible.length} of {auditRecent.length}.
                </>
              ) : null}
            </p>
            <div style={{ overflowX: 'auto', border: '1px solid #ddd', borderRadius: 8 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 720 }}>
                <thead>
                  <tr>
                    {['Time', 'Action', 'Entity', 'Entity ID', 'Org ID'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {auditRowsVisible.map((row, idx) => (
                    <tr key={`${String(row.id ?? idx)}`}>
                      <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.created_at ?? '')}</td>
                      <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.action ?? '')}</td>
                      <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.entity_type ?? '')}</td>
                      <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.entity_id ?? '—')}</td>
                      <td style={{ borderBottom: '1px solid #eee', padding: 8 }}>{String(row.organization_id ?? '—')}</td>
                    </tr>
                  ))}
                  {!auditRecent.length ? (
                    <tr>
                      <td colSpan={5} style={{ padding: 12, color: '#666' }}>
                        No audit rows yet
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            {auditHasMore ? (
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  onClick={() => setAuditShowAll((v) => !v)}
                  style={btnCompactMuted}
                >
                  {auditShowAll ? 'Show latest 3 only' : 'All recent audit'}
                </button>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {emailProviderModalOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
          onClick={() => setEmailProviderModalOpen(false)}
        >
          <div
            style={{
              background: '#fff',
              width: 'min(680px, 92vw)',
              borderRadius: 14,
              border: '1px solid #E5E7EB',
              boxShadow: '0 10px 30px rgba(15,23,42,0.14)',
              padding: 20,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <h2 style={{ margin: 0 }}>Email Provider Configuration</h2>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  style={{ ...btnCompactMuted, borderRadius: 8 }}
                  onClick={() =>
                    setEmailProviderForm((s) => ({
                      ...s,
                      provider_type: 'custom_api',
                      http_method: 'POST',
                    }))
                  }
                >
                  + New Provider
                </button>
                <button type="button" style={btnCompactMuted} onClick={() => setEmailProviderModalOpen(false)}>
                  X
                </button>
              </div>
            </div>
            <p style={{ color: '#4b5563', fontSize: 13, marginBottom: 6 }}>
              Provider: {String(emailProviderAgg?.provider_type ?? '—')}
            </p>
            {emailProviderModalError ? (
              <p style={{ color: '#b91c1c', fontSize: 13, marginTop: 0 }}>{emailProviderModalError}</p>
            ) : null}
            <p style={{ color: '#111827', fontSize: 13, marginTop: 0, marginBottom: 8 }}>
              Configured: {emailProviderAgg?.is_configured ? 'Yes' : 'No'}
            </p>
            {!emailProviderAgg?.is_configured ? (
              <p style={{ color: '#6b7280', fontSize: 13, marginTop: 0 }}>Email provider is not configured.</p>
            ) : null}
            {emailProviderAgg?.is_configured && emailProviderAgg?.masked_api_key ? (
              <p style={{ color: '#374151', fontSize: 12, marginTop: 0 }}>
                API key (masked): {String(emailProviderAgg.masked_api_key)}
              </p>
            ) : null}
            <div style={{ marginBottom: 12, padding: 10, border: '1px solid #E5E7EB', borderRadius: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Application URL</div>
              <div style={{ fontSize: 12, color: '#374151', marginBottom: 6 }}>
                Configured: {emailProviderAgg?.app_public_url_is_configured ? 'Yes' : 'No'}
              </div>
              <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                Public App URL
                <input
                  type="text"
                  value={appPublicUrlDraft}
                  onChange={(e) => setAppPublicUrlDraft(e.target.value)}
                  placeholder="https://app.yourdomain.com"
                  style={{ height: 38, borderRadius: 8, border: '1px solid #D1D5DB', padding: '0 12px', fontSize: 14, color: '#111827' }}
                />
              </label>
              {!appPublicUrlIsValid ? (
                <p style={{ color: '#b91c1c', fontSize: 12, margin: '6px 0 0' }}>Invalid URL format</p>
              ) : null}
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  style={{ ...btnCompact, minWidth: 100, borderRadius: 8 }}
                  disabled={commandBusy || !appPublicUrlIsValid}
                  onClick={() =>
                    void (async () => {
                      try {
                        setEmailProviderModalError('');
                        await sendOwnerCommand('save_platform_public_url', { app_public_url: appPublicUrlDraft });
                      } catch (e) {
                        setEmailProviderModalError(userFacingApiMessage(e));
                      }
                    })()
                  }
                >
                  Save
                </button>
              </div>
            </div>
            {String(emailProviderAgg?.provider_type ?? '') === 'custom_api' ? (
              <div style={{ marginBottom: 10, padding: 10, border: '1px solid #E5E7EB', borderRadius: 8, background: '#F9FAFB' }}>
                <div style={{ fontSize: 12, color: '#374151' }}>
                  Provider display name: {String(emailProviderAgg?.provider_display_name ?? '—')}
                </div>
                <div style={{ fontSize: 12, color: '#374151' }}>
                  Endpoint: {String((emailProviderAgg?.custom_api_config_summary as UnknownRecord | undefined)?.api_endpoint_url ?? '—')}
                </div>
              </div>
            ) : null}
            <div style={{ display: 'grid', gap: 8 }}>
              <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                Configuration scope
                <select
                  value={emailProviderForm.config_scope}
                  onChange={(e) =>
                    setEmailProviderForm((s) => ({
                      ...s,
                      config_scope: e.target.value as 'platform_default' | 'organization_override',
                    }))
                  }
                  style={{
                    height: 38,
                    borderRadius: 8,
                    border: '1px solid #D1D5DB',
                    padding: '0 12px',
                    fontSize: 14,
                    background: '#fff',
                    color: '#111827',
                  }}
                >
                  <option value="platform_default">platform_default</option>
                  <option value="organization_override">organization_override</option>
                </select>
              </label>
              {emailProviderForm.config_scope === 'organization_override' ? (
                <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                  Organization ID
                  <input
                    type="text"
                    value={emailProviderForm.organization_id}
                    onChange={(e) => setEmailProviderForm((s) => ({ ...s, organization_id: e.target.value }))}
                    placeholder="Organization UUID"
                    style={{
                      height: 38,
                      borderRadius: 8,
                      border: '1px solid #D1D5DB',
                      padding: '0 12px',
                      fontSize: 14,
                      color: '#111827',
                    }}
                  />
                </label>
              ) : null}
              <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                Provider type
                <select
                  value={emailProviderForm.provider_type}
                  onChange={(e) =>
                    setEmailProviderForm((s) => ({
                      ...s,
                      provider_type: e.target.value as 'resend' | 'sendgrid' | 'smtp' | 'custom_api',
                    }))
                  }
                  style={{
                    height: 38,
                    borderRadius: 8,
                    border: '1px solid #D1D5DB',
                    padding: '0 12px',
                    fontSize: 14,
                    background: '#fff',
                    color: '#111827',
                  }}
                >
                  <option value="resend">resend</option>
                  <option value="sendgrid">sendgrid</option>
                  <option value="smtp">smtp</option>
                  <option value="custom_api">custom_api</option>
                </select>
              </label>
              {emailProviderForm.provider_type !== 'smtp' ? (
                <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                  API key
                  <input
                    type="password"
                    value={emailProviderForm.api_key}
                    onChange={(e) => setEmailProviderForm((s) => ({ ...s, api_key: e.target.value }))}
                    placeholder="••••••••••••"
                    style={{
                      height: 38,
                      borderRadius: 8,
                      border: '1px solid #D1D5DB',
                      padding: '0 12px',
                      fontSize: 14,
                      color: '#111827',
                    }}
                  />
                </label>
              ) : null}
              {emailProviderForm.provider_type === 'custom_api' ? (
                <>
                  <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                    Provider display name
                    <input
                      type="text"
                      value={emailProviderForm.provider_display_name}
                      onChange={(e) => setEmailProviderForm((s) => ({ ...s, provider_display_name: e.target.value }))}
                      placeholder="Custom Email API"
                      style={{ height: 38, borderRadius: 8, border: '1px solid #D1D5DB', padding: '0 12px', fontSize: 14, color: '#111827' }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                    API endpoint URL
                    <input
                      type="text"
                      value={emailProviderForm.api_endpoint_url}
                      onChange={(e) => setEmailProviderForm((s) => ({ ...s, api_endpoint_url: e.target.value }))}
                      placeholder="https://api.provider.com/send"
                      style={{ height: 38, borderRadius: 8, border: '1px solid #D1D5DB', padding: '0 12px', fontSize: 14, color: '#111827' }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                    HTTP method
                    <input type="text" value="POST" readOnly style={{ height: 38, borderRadius: 8, border: '1px solid #D1D5DB', padding: '0 12px', fontSize: 14, color: '#6B7280', background: '#F9FAFB' }} />
                  </label>
                  <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                    Auth type
                    <select
                      value={emailProviderForm.auth_type}
                      onChange={(e) =>
                        setEmailProviderForm((s) => ({
                          ...s,
                          auth_type: e.target.value as 'bearer_token' | 'api_key_header',
                        }))
                      }
                      style={{ height: 38, borderRadius: 8, border: '1px solid #D1D5DB', padding: '0 12px', fontSize: 14, background: '#fff', color: '#111827' }}
                    >
                      <option value="bearer_token">bearer_token</option>
                      <option value="api_key_header">api_key_header</option>
                    </select>
                  </label>
                  <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                    Auth header name
                    <input
                      type="text"
                      value={emailProviderForm.auth_header_name}
                      onChange={(e) => setEmailProviderForm((s) => ({ ...s, auth_header_name: e.target.value }))}
                      placeholder="Authorization"
                      style={{ height: 38, borderRadius: 8, border: '1px solid #D1D5DB', padding: '0 12px', fontSize: 14, color: '#111827' }}
                    />
                  </label>
                </>
              ) : null}
              <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                From email
                <input
                  type="text"
                  value={emailProviderForm.from_email}
                  onChange={(e) => setEmailProviderForm((s) => ({ ...s, from_email: e.target.value }))}
                  placeholder="noreply@yourfirm.com"
                  style={{
                    height: 38,
                    borderRadius: 8,
                    border: '1px solid #D1D5DB',
                    padding: '0 12px',
                    fontSize: 14,
                    color: '#111827',
                  }}
                />
              </label>
              <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                From name
                <input
                  type="text"
                  value={emailProviderForm.from_name}
                  onChange={(e) => setEmailProviderForm((s) => ({ ...s, from_name: e.target.value }))}
                  placeholder="NodexPro"
                  style={{
                    height: 38,
                    borderRadius: 8,
                    border: '1px solid #D1D5DB',
                    padding: '0 12px',
                    fontSize: 14,
                    color: '#111827',
                  }}
                />
              </label>
              {emailProviderForm.provider_type === 'smtp' ? (
                <>
                  <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                    SMTP host
                    <input
                      type="text"
                      value={emailProviderForm.smtp_host}
                      onChange={(e) => setEmailProviderForm((s) => ({ ...s, smtp_host: e.target.value }))}
                      placeholder="smtp.mailprovider.com"
                      style={{
                        height: 38,
                        borderRadius: 8,
                        border: '1px solid #D1D5DB',
                        padding: '0 12px',
                        fontSize: 14,
                        color: '#111827',
                      }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                    SMTP port
                    <input
                      type="text"
                      value={emailProviderForm.smtp_port}
                      onChange={(e) => setEmailProviderForm((s) => ({ ...s, smtp_port: e.target.value }))}
                      placeholder="587"
                      style={{
                        height: 38,
                        borderRadius: 8,
                        border: '1px solid #D1D5DB',
                        padding: '0 12px',
                        fontSize: 14,
                        color: '#111827',
                      }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                    SMTP user
                    <input
                      type="text"
                      value={emailProviderForm.smtp_user}
                      onChange={(e) => setEmailProviderForm((s) => ({ ...s, smtp_user: e.target.value }))}
                      placeholder="smtp-user"
                      style={{
                        height: 38,
                        borderRadius: 8,
                        border: '1px solid #D1D5DB',
                        padding: '0 12px',
                        fontSize: 14,
                        color: '#111827',
                      }}
                    />
                  </label>
                  <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                    SMTP password
                    <input
                      type="password"
                      value={emailProviderForm.smtp_password}
                      onChange={(e) => setEmailProviderForm((s) => ({ ...s, smtp_password: e.target.value }))}
                      placeholder="••••••••••••"
                      style={{
                        height: 38,
                        borderRadius: 8,
                        border: '1px solid #D1D5DB',
                        padding: '0 12px',
                        fontSize: 14,
                        color: '#111827',
                      }}
                    />
                  </label>
                </>
              ) : null}
              {emailProviderForm.provider_type === 'custom_api' ? (
                <>
                  <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                    Recipient field name
                    <input type="text" value={emailProviderForm.recipient_field} onChange={(e) => setEmailProviderForm((s) => ({ ...s, recipient_field: e.target.value }))} placeholder="to" style={{ height: 38, borderRadius: 8, border: '1px solid #D1D5DB', padding: '0 12px', fontSize: 14, color: '#111827' }} />
                  </label>
                  <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                    Subject field name
                    <input type="text" value={emailProviderForm.subject_field} onChange={(e) => setEmailProviderForm((s) => ({ ...s, subject_field: e.target.value }))} placeholder="subject" style={{ height: 38, borderRadius: 8, border: '1px solid #D1D5DB', padding: '0 12px', fontSize: 14, color: '#111827' }} />
                  </label>
                  <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                    HTML body field name
                    <input type="text" value={emailProviderForm.html_body_field} onChange={(e) => setEmailProviderForm((s) => ({ ...s, html_body_field: e.target.value }))} placeholder="html" style={{ height: 38, borderRadius: 8, border: '1px solid #D1D5DB', padding: '0 12px', fontSize: 14, color: '#111827' }} />
                  </label>
                  <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                    Text body field name
                    <input type="text" value={emailProviderForm.text_body_field} onChange={(e) => setEmailProviderForm((s) => ({ ...s, text_body_field: e.target.value }))} placeholder="text" style={{ height: 38, borderRadius: 8, border: '1px solid #D1D5DB', padding: '0 12px', fontSize: 14, color: '#111827' }} />
                  </label>
                  <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                    Additional static headers (JSON)
                    <input type="text" value={emailProviderForm.static_headers} onChange={(e) => setEmailProviderForm((s) => ({ ...s, static_headers: e.target.value }))} placeholder="{}" style={{ height: 38, borderRadius: 8, border: '1px solid #D1D5DB', padding: '0 12px', fontSize: 14, color: '#111827' }} />
                  </label>
                  <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                    Additional static payload fields (JSON)
                    <input type="text" value={emailProviderForm.static_payload} onChange={(e) => setEmailProviderForm((s) => ({ ...s, static_payload: e.target.value }))} placeholder="{}" style={{ height: 38, borderRadius: 8, border: '1px solid #D1D5DB', padding: '0 12px', fontSize: 14, color: '#111827' }} />
                  </label>
                  <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                    Success response path
                    <input type="text" value={emailProviderForm.success_response_path} onChange={(e) => setEmailProviderForm((s) => ({ ...s, success_response_path: e.target.value }))} placeholder="id" style={{ height: 38, borderRadius: 8, border: '1px solid #D1D5DB', padding: '0 12px', fontSize: 14, color: '#111827' }} />
                  </label>
                  <label style={{ display: 'grid', gap: 6, fontSize: 13, color: '#374151', fontWeight: 600 }}>
                    Error response path
                    <input type="text" value={emailProviderForm.error_response_path} onChange={(e) => setEmailProviderForm((s) => ({ ...s, error_response_path: e.target.value }))} placeholder="error.message" style={{ height: 38, borderRadius: 8, border: '1px solid #D1D5DB', padding: '0 12px', fontSize: 14, color: '#111827' }} />
                  </label>
                </>
              ) : null}
            </div>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 12 }}>
              <button
                type="button"
                style={{ ...btnCompactMuted, minWidth: 100, borderRadius: 8, border: '1px solid #D1D5DB', background: '#fff' }}
                onClick={() => setEmailProviderModalOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                style={{
                  ...btnCompact,
                  minWidth: 100,
                  borderRadius: 8,
                  border: '1px solid #2563EB',
                  background: '#2563EB',
                  color: '#fff',
                }}
                disabled={commandBusy}
                onClick={() =>
                  void (async () => {
                    setEmailProviderModalError('');
                    const payload: UnknownRecord = {
                      config_scope: emailProviderForm.config_scope,
                      organization_id:
                        emailProviderForm.config_scope === 'organization_override'
                          ? emailProviderForm.organization_id || null
                          : null,
                      provider_type: emailProviderForm.provider_type,
                      api_key: emailProviderForm.api_key || null,
                      from_email: emailProviderForm.from_email,
                      from_name: emailProviderForm.from_name,
                    };
                    if (emailProviderForm.provider_type === 'smtp') {
                      payload.smtp_config = {
                        host: emailProviderForm.smtp_host || null,
                        port: emailProviderForm.smtp_port || null,
                        user: emailProviderForm.smtp_user || null,
                        password: emailProviderForm.smtp_password || null,
                      };
                    }
                    try {
                      await sendOwnerCommand('save_email_provider_config', payload);
                      setEmailProviderModalOpen(false);
                    } catch (e) {
                      setEmailProviderModalError(userFacingApiMessage(e));
                    }
                  })()
                }
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <CommandActionModal
        open={!!commandModal}
        state={commandModal}
        busy={commandBusy}
        onClose={() => setCommandModal(null)}
        onSubmit={async (cmd, payload) => {
          await sendOwnerCommand(cmd, payload);
          setCommandModal(null);
        }}
      />
    </div>
  );
}
