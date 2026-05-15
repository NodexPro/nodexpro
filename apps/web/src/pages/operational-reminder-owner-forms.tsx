import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { ApiError, userFacingApiMessage } from '../api/client';
import type { AggregateAction } from './owner-legal-control-panel-actions';
import { btnCompact, btnGhost, btnPrimary } from './owner-legal-control-panel-actions';
import type { OwnerCommandResponse, UnknownRecord } from './owner-legal-control-types';

export type ReminderSmartFormKind = 'reminder_policy' | 'reminder_template' | 'reminder_version';

type PickerCountry = { country_code: string; name: string; status: string };
type PickerPack = { id: string; country_code: string; pack_code: string; name: string; status: string };
type PickerRuleset = {
  id: string;
  country_pack_id: string;
  ruleset_code: string;
  ruleset_version: string;
  status: string;
  effective_window: string;
};

type EditorOption = { code: string; label: string };

type PresetPeriodOption = {
  label: string;
  amount: number;
  unit: string;
  period_slug: string;
};

type ExistingTemplateOption = {
  template_key: string;
  display_name: string;
  workflow_type: string;
  period_slug: string;
  period_label: string;
  language: string;
  channel: string;
  country_code: string;
};

type EditorOptions = {
  workflow_types: EditorOption[];
  channels: EditorOption[];
  anchors: EditorOption[];
  severities: EditorOption[];
  languages: EditorOption[];
  template_variables: EditorOption[];
  preset_periods: PresetPeriodOption[];
  allowed_units: EditorOption[];
  existing_templates: ExistingTemplateOption[];
};

type CadencePeriodForm = {
  period_ref: string;
  custom_amount: number;
  custom_unit: string;
  channels: string[];
  severity: string;
  template_ref: string;
};

type WorkflowForm = {
  workflow_type: string;
  enabled: boolean;
  anchor: string;
  cadence_periods: CadencePeriodForm[];
};

const inputStyle: CSSProperties = {
  display: 'block',
  width: '100%',
  marginTop: 4,
  padding: 8,
  borderRadius: 6,
  border: '1px solid #d1d5db',
  boxSizing: 'border-box',
};

const labelStyle: CSSProperties = { display: 'block', fontSize: 14, fontWeight: 500 };

function safeText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function fmtToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyCadencePeriod(editor: EditorOptions | null): CadencePeriodForm {
  const firstPreset = editor?.preset_periods[0]?.period_slug ?? '1h';
  const firstChannel = editor?.channels[0]?.code ?? 'docflow';
  return {
    period_ref: firstPreset,
    custom_amount: 1,
    custom_unit: editor?.allowed_units[0]?.code ?? 'hours',
    channels: [firstChannel],
    severity: editor?.severities[0]?.code ?? 'info',
    template_ref: '',
  };
}

function emptyWorkflow(editor: EditorOptions | null): WorkflowForm {
  return {
    workflow_type: editor?.workflow_types[0]?.code ?? 'waiting_client',
    enabled: true,
    anchor: editor?.anchors[0]?.code ?? 'obligation_starts_at',
    cadence_periods: [emptyCadencePeriod(editor)],
  };
}

function periodLabelForRef(editor: EditorOptions | null, periodRef: string, customAmount: number, customUnit: string): string {
  if (periodRef !== '__custom__') {
    const preset = editor?.preset_periods.find((p) => p.period_slug === periodRef);
    if (preset) return preset.label;
  }
  return `${customAmount} ${customUnit}`;
}

function normalizeCountryCode(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';
  const row = raw as UnknownRecord;
  return safeText(row.country_code).toUpperCase() || safeText(row.code).toUpperCase();
}

function parsePickerOptions(cp: UnknownRecord | null): {
  countries: PickerCountry[];
  country_packs: PickerPack[];
  rulesets: PickerRuleset[];
} {
  const po = cp?.picker_options;
  const o = po && typeof po === 'object' && !Array.isArray(po) ? (po as UnknownRecord) : {};
  const countriesRaw = Array.isArray(o.countries) ? o.countries : [];
  return {
    countries: countriesRaw.map((row) => {
      const countryCode = normalizeCountryCode(row);
      const r = row as UnknownRecord;
      return {
        country_code: countryCode,
        name: safeText(r.name) || countryCode,
        status: safeText(r.status),
      };
    }),
    country_packs: (Array.isArray(o.country_packs) ? o.country_packs : []).map((row) => {
      const r = row as UnknownRecord;
      return {
        id: safeText(r.id),
        country_code: safeText(r.country_code).toUpperCase(),
        pack_code: safeText(r.pack_code),
        name: safeText(r.name),
        status: safeText(r.status),
      };
    }),
    rulesets: (Array.isArray(o.rulesets) ? o.rulesets : []).map((row) => {
      const r = row as UnknownRecord;
      return {
        id: safeText(r.id),
        country_pack_id: safeText(r.country_pack_id),
        ruleset_code: safeText(r.ruleset_code),
        ruleset_version: safeText(r.ruleset_version),
        status: safeText(r.status),
        effective_from: safeText(r.effective_from),
        effective_to: r.effective_to == null ? null : safeText(r.effective_to),
        effective_window: safeText(r.effective_window),
      };
    }),
  };
}

function parseEditorOptions(cp: UnknownRecord | null): EditorOptions | null {
  const eo = cp?.editor_options;
  if (!eo || typeof eo !== 'object' || Array.isArray(eo)) return null;
  const e = eo as UnknownRecord;
  const mapOpts = (raw: unknown): EditorOption[] =>
    Array.isArray(raw)
      ? (raw as UnknownRecord[]).map((x) => ({
          code: safeText(x.code),
          label: safeText(x.label) || safeText(x.code),
        }))
      : [];
  const presetPeriods = Array.isArray(e.preset_periods)
    ? (e.preset_periods as UnknownRecord[]).map((x) => ({
        label: safeText(x.label),
        amount: Number(x.amount),
        unit: safeText(x.unit),
        period_slug: safeText(x.period_slug),
      }))
    : [];
  const existingTemplates = Array.isArray(e.existing_templates)
    ? (e.existing_templates as UnknownRecord[]).map((x) => ({
        template_key: safeText(x.template_key),
        display_name: safeText(x.display_name) || safeText(x.template_key),
        workflow_type: safeText(x.workflow_type),
        period_slug: safeText(x.period_slug),
        period_label: safeText(x.period_label),
        language: safeText(x.language),
        channel: safeText(x.channel),
        country_code: safeText(x.country_code).toUpperCase(),
      }))
    : [];
  return {
    workflow_types: mapOpts(e.workflow_types),
    channels: mapOpts(e.channels),
    anchors: mapOpts(e.anchors),
    severities: mapOpts(e.severities),
    languages: mapOpts(e.languages),
    template_variables: mapOpts(e.template_variables),
    preset_periods: presetPeriods,
    allowed_units: mapOpts(e.allowed_units),
    existing_templates: existingTemplates,
  };
}

function CountryPackRulesetFields({
  picker,
  countryCode,
  packId,
  rulesetId,
  onCountry,
  onPack,
  onRuleset,
}: {
  picker: ReturnType<typeof parsePickerOptions>;
  countryCode: string;
  packId: string;
  rulesetId: string;
  onCountry: (v: string) => void;
  onPack: (v: string) => void;
  onRuleset: (v: string) => void;
}) {
  const countryUp = countryCode.trim().toUpperCase();
  const packs = useMemo(
    () => picker.country_packs.filter((p) => p.country_code === countryUp),
    [picker.country_packs, countryUp],
  );
  const rulesets = useMemo(
    () => picker.rulesets.filter((r) => r.country_pack_id === packId),
    [picker.rulesets, packId],
  );

  return (
    <div style={{ display: 'grid', gap: 10 }}>
      <label style={labelStyle}>
        Country
        <select value={countryCode} onChange={(e) => onCountry(e.target.value)} style={inputStyle}>
          <option value="">Select country</option>
          {picker.countries.map((c) => (
            <option key={c.country_code} value={c.country_code}>
              {c.country_code} — {c.name}
            </option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        Country pack
        <select value={packId} onChange={(e) => onPack(e.target.value)} style={inputStyle} disabled={!countryCode}>
          <option value="">Select pack</option>
          {packs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.pack_code} — {p.name} ({p.status})
            </option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        Ruleset
        <select value={rulesetId} onChange={(e) => onRuleset(e.target.value)} style={inputStyle} disabled={!packId}>
          <option value="">Select ruleset</option>
          {rulesets.map((r) => (
            <option key={r.id} value={r.id}>
              {r.ruleset_code} v{r.ruleset_version} ({r.status}) — {r.effective_window}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function PolicyEditor({
  editor,
  approvalRequired,
  defaultChannels,
  workflows,
  onApproval,
  onChannels,
  onWorkflows,
}: {
  editor: EditorOptions | null;
  approvalRequired: boolean;
  defaultChannels: string[];
  workflows: WorkflowForm[];
  onApproval: (v: boolean) => void;
  onChannels: (v: string[]) => void;
  onWorkflows: (v: WorkflowForm[]) => void;
}) {
  function toggleChannel(code: string) {
    onChannels(defaultChannels.includes(code) ? defaultChannels.filter((c) => c !== code) : [...defaultChannels, code]);
  }

  return (
    <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
      <label style={{ fontSize: 14 }}>
        <input type="checkbox" checked={approvalRequired} onChange={(e) => onApproval(e.target.checked)} /> Approval
        required before send
      </label>
      <div>
        <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 6 }}>Default channels</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {(editor?.channels ?? []).map((ch) => (
            <label key={ch.code} style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={defaultChannels.includes(ch.code)}
                onChange={() => toggleChannel(ch.code)}
              />{' '}
              {ch.label}
            </label>
          ))}
        </div>
      </div>
      {workflows.map((wf, wi) => (
        <div key={wi} style={{ border: '1px solid #e9d5ff', borderRadius: 8, padding: 10, background: '#faf5ff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <strong style={{ fontSize: 14 }}>Workflow {wi + 1}</strong>
            {workflows.length > 1 ? (
              <button
                type="button"
                style={{ ...btnCompact, padding: '4px 10px', fontSize: 12 }}
                onClick={() => onWorkflows(workflows.filter((_, i) => i !== wi))}
              >
                Remove
              </button>
            ) : null}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={labelStyle}>
              Workflow type
              <select
                value={wf.workflow_type}
                style={inputStyle}
                onChange={(e) => {
                  const next = [...workflows];
                  next[wi] = { ...wf, workflow_type: e.target.value };
                  onWorkflows(next);
                }}
              >
                {(editor?.workflow_types ?? []).map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={labelStyle}>
              Anchor
              <select
                value={wf.anchor}
                style={inputStyle}
                onChange={(e) => {
                  const next = [...workflows];
                  next[wi] = { ...wf, anchor: e.target.value };
                  onWorkflows(next);
                }}
              >
                {(editor?.anchors ?? []).map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={wf.enabled}
                onChange={(e) => {
                  const next = [...workflows];
                  next[wi] = { ...wf, enabled: e.target.checked };
                  onWorkflows(next);
                }}
              />{' '}
              Enabled
            </label>
          </div>
          <div style={{ marginTop: 10 }}>
            <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 6 }}>Reminder periods</div>
            {wf.cadence_periods.map((period, pi) => {
              const templatesForWorkflow = (editor?.existing_templates ?? []).filter(
                (t) => t.workflow_type === wf.workflow_type,
              );
              return (
                <div
                  key={pi}
                  style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 10, marginBottom: 8, background: '#fff' }}
                >
                  <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 6 }}>
                    Period: {periodLabelForRef(editor, period.period_ref, period.custom_amount, period.custom_unit)}
                  </div>
                  <div style={{ display: 'grid', gap: 8 }}>
                    <label style={labelStyle}>
                      Period
                      <select
                        value={period.period_ref}
                        style={inputStyle}
                        onChange={(e) => {
                          const next = [...workflows];
                          const periods = [...wf.cadence_periods];
                          periods[pi] = { ...period, period_ref: e.target.value };
                          next[wi] = { ...wf, cadence_periods: periods };
                          onWorkflows(next);
                        }}
                      >
                        {(editor?.preset_periods ?? []).map((p) => (
                          <option key={p.period_slug} value={p.period_slug}>
                            {p.label}
                          </option>
                        ))}
                        <option value="__custom__">Custom period…</option>
                      </select>
                    </label>
                    {period.period_ref === '__custom__' ? (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                        <label style={labelStyle}>
                          Amount
                          <input
                            type="number"
                            min={1}
                            value={period.custom_amount}
                            style={inputStyle}
                            onChange={(e) => {
                              const next = [...workflows];
                              const periods = [...wf.cadence_periods];
                              periods[pi] = { ...period, custom_amount: Number(e.target.value) };
                              next[wi] = { ...wf, cadence_periods: periods };
                              onWorkflows(next);
                            }}
                          />
                        </label>
                        <label style={labelStyle}>
                          Unit
                          <select
                            value={period.custom_unit}
                            style={inputStyle}
                            onChange={(e) => {
                              const next = [...workflows];
                              const periods = [...wf.cadence_periods];
                              periods[pi] = { ...period, custom_unit: e.target.value };
                              next[wi] = { ...wf, cadence_periods: periods };
                              onWorkflows(next);
                            }}
                          >
                            {(editor?.allowed_units ?? []).map((u) => (
                              <option key={u.code} value={u.code}>
                                {u.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : null}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Channels</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {(editor?.channels ?? []).map((ch) => {
                          const checked = period.channels.includes(ch.code);
                          return (
                            <label key={ch.code} style={{ fontSize: 13 }}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  const next = [...workflows];
                                  const periods = [...wf.cadence_periods];
                                  const channels = checked
                                    ? period.channels.filter((c) => c !== ch.code)
                                    : [...period.channels, ch.code];
                                  periods[pi] = { ...period, channels };
                                  next[wi] = { ...wf, cadence_periods: periods };
                                  onWorkflows(next);
                                }}
                              />{' '}
                              {ch.label}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                    <label style={labelStyle}>
                      Severity
                      <select
                        value={period.severity}
                        style={inputStyle}
                        onChange={(e) => {
                          const next = [...workflows];
                          const periods = [...wf.cadence_periods];
                          periods[pi] = { ...period, severity: e.target.value };
                          next[wi] = { ...wf, cadence_periods: periods };
                          onWorkflows(next);
                        }}
                      >
                        {(editor?.severities ?? []).map((sev) => (
                          <option key={sev.code} value={sev.code}>
                            {sev.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label style={labelStyle}>
                      Template
                      <select
                        value={period.template_ref}
                        style={inputStyle}
                        onChange={(e) => {
                          const next = [...workflows];
                          const periods = [...wf.cadence_periods];
                          periods[pi] = { ...period, template_ref: e.target.value };
                          next[wi] = { ...wf, cadence_periods: periods };
                          onWorkflows(next);
                        }}
                      >
                        <option value="">Select template</option>
                        {templatesForWorkflow.map((t) => (
                          <option key={t.template_key} value={t.template_key}>
                            {t.display_name} ({t.period_label} · {t.language})
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  {wf.cadence_periods.length > 1 ? (
                    <button
                      type="button"
                      style={{ ...btnCompact, marginTop: 8, padding: '4px 10px', fontSize: 12 }}
                      onClick={() => {
                        const next = [...workflows];
                        next[wi] = {
                          ...wf,
                          cadence_periods: wf.cadence_periods.filter((_, i) => i !== pi),
                        };
                        onWorkflows(next);
                      }}
                    >
                      Remove period
                    </button>
                  ) : null}
                </div>
              );
            })}
            <button
              type="button"
              style={{ ...btnCompact, padding: '4px 12px', fontSize: 12 }}
              onClick={() => {
                const next = [...workflows];
                next[wi] = { ...wf, cadence_periods: [...wf.cadence_periods, emptyCadencePeriod(editor)] };
                onWorkflows(next);
              }}
            >
              + Add period
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        style={btnCompact}
        onClick={() => onWorkflows([...workflows, emptyWorkflow(editor)])}
      >
        Add workflow
      </button>
    </div>
  );
}

function TemplateEditor({
  editor,
  workflowType,
  periodRef,
  customAmount,
  customUnit,
  templateDisplayName,
  language,
  channel,
  subjectTemplate,
  bodyTemplate,
  variables,
  tone,
  onChange,
}: {
  editor: EditorOptions | null;
  workflowType: string;
  periodRef: string;
  customAmount: number;
  customUnit: string;
  templateDisplayName: string;
  language: string;
  channel: string;
  subjectTemplate: string;
  bodyTemplate: string;
  variables: string[];
  tone: string;
  onChange: (patch: Partial<{
    workflowType: string;
    periodRef: string;
    customAmount: number;
    customUnit: string;
    templateDisplayName: string;
    language: string;
    channel: string;
    subjectTemplate: string;
    bodyTemplate: string;
    variables: string[];
    tone: string;
  }>) => void;
}) {
  function toggleVar(code: string) {
    onChange({
      variables: variables.includes(code) ? variables.filter((v) => v !== code) : [...variables, code],
    });
  }

  return (
    <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
      <label style={labelStyle}>
        Workflow type
        <select value={workflowType} style={inputStyle} onChange={(e) => onChange({ workflowType: e.target.value })}>
          {(editor?.workflow_types ?? []).map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        Period
        <select value={periodRef} style={inputStyle} onChange={(e) => onChange({ periodRef: e.target.value })}>
          {(editor?.preset_periods ?? []).map((p) => (
            <option key={p.period_slug} value={p.period_slug}>
              {p.label}
            </option>
          ))}
          <option value="__custom__">Custom period…</option>
        </select>
      </label>
      {periodRef === '__custom__' ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <label style={labelStyle}>
            Amount
            <input
              type="number"
              min={1}
              value={customAmount}
              style={inputStyle}
              onChange={(e) => onChange({ customAmount: Number(e.target.value) })}
            />
          </label>
          <label style={labelStyle}>
            Unit
            <select value={customUnit} style={inputStyle} onChange={(e) => onChange({ customUnit: e.target.value })}>
              {(editor?.allowed_units ?? []).map((u) => (
                <option key={u.code} value={u.code}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
      <label style={labelStyle}>
        Template display name
        <input
          type="text"
          value={templateDisplayName}
          style={inputStyle}
          placeholder="e.g. Waiting client — 1 hour nudge"
          onChange={(e) => onChange({ templateDisplayName: e.target.value })}
        />
      </label>
      <label style={labelStyle}>
        Language
        <select value={language} style={inputStyle} onChange={(e) => onChange({ language: e.target.value })}>
          {(editor?.languages ?? []).map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        Channel
        <select value={channel} style={inputStyle} onChange={(e) => onChange({ channel: e.target.value })}>
          {(editor?.channels ?? []).map((o) => (
            <option key={o.code} value={o.code}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label style={labelStyle}>
        Subject template
        <input
          type="text"
          value={subjectTemplate}
          style={inputStyle}
          onChange={(e) => onChange({ subjectTemplate: e.target.value })}
        />
      </label>
      <label style={labelStyle}>
        Body template
        <textarea
          rows={5}
          value={bodyTemplate}
          style={{ ...inputStyle, fontFamily: 'inherit' }}
          onChange={(e) => onChange({ bodyTemplate: e.target.value })}
        />
      </label>
      <div>
        <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 6 }}>Variables used</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {(editor?.template_variables ?? []).map((v) => (
            <label key={v.code} style={{ fontSize: 13 }}>
              <input type="checkbox" checked={variables.includes(v.code)} onChange={() => toggleVar(v.code)} />{' '}
              {`{{${v.code}}}`}
            </label>
          ))}
        </div>
      </div>
      <label style={labelStyle}>
        Tone (optional)
        <input type="text" value={tone} style={inputStyle} onChange={(e) => onChange({ tone: e.target.value })} />
      </label>
    </div>
  );
}

export function CommunicationPoliciesToolbar({
  actions,
  disabled,
  onSmartForm,
}: {
  actions: AggregateAction[];
  disabled: boolean;
  onSmartForm: (kind: ReminderSmartFormKind) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {actions.map((a) => {
        const key = String(a.action_key ?? '');
        const smart = safeText((a as UnknownRecord).smart_form);
        if (!key || a.enabled === false) return null;
        if (!smart) return null;
        return (
          <button
            key={key}
            type="button"
            disabled={disabled}
            style={btnCompact}
            onClick={() => onSmartForm(smart as ReminderSmartFormKind)}
          >
            {a.button_label?.trim() ? a.button_label : key}
          </button>
        );
      })}
    </div>
  );
}

export function OperationalReminderOwnerModal({
  kind,
  open,
  busy,
  communicationPolicies,
  onClose,
  onSubmit,
}: {
  kind: ReminderSmartFormKind | null;
  open: boolean;
  busy: boolean;
  communicationPolicies: UnknownRecord | null;
  onClose: () => void;
  onSubmit: (command: string, payload: UnknownRecord) => Promise<OwnerCommandResponse>;
}) {
  const picker = useMemo(() => parsePickerOptions(communicationPolicies), [communicationPolicies]);
  const editor = useMemo(() => parseEditorOptions(communicationPolicies), [communicationPolicies]);

  const [countryCode, setCountryCode] = useState('');
  const [packId, setPackId] = useState('');
  const [rulesetId, setRulesetId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(fmtToday());
  const [effectiveTo, setEffectiveTo] = useState('');
  const [activateAfterCreate, setActivateAfterCreate] = useState(true);
  const [versionKind, setVersionKind] = useState<'policy' | 'template'>('policy');

  const [approvalRequired, setApprovalRequired] = useState(true);
  const [defaultChannels, setDefaultChannels] = useState<string[]>(['docflow', 'email']);
  const [workflows, setWorkflows] = useState<WorkflowForm[]>([]);

  const [workflowType, setWorkflowType] = useState('waiting_client');
  const [templatePeriodRef, setTemplatePeriodRef] = useState('1h');
  const [templateCustomAmount, setTemplateCustomAmount] = useState(1);
  const [templateCustomUnit, setTemplateCustomUnit] = useState('hours');
  const [templateDisplayName, setTemplateDisplayName] = useState('');
  const [language, setLanguage] = useState('he');
  const [channel, setChannel] = useState('docflow');
  const [subjectTemplate, setSubjectTemplate] = useState('');
  const [bodyTemplate, setBodyTemplate] = useState('');
  const [variables, setVariables] = useState<string[]>(['client_name']);
  const [tone, setTone] = useState('');

  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !kind) return;
    setError('');
    setEffectiveFrom(fmtToday());
    setEffectiveTo('');
    setActivateAfterCreate(true);
    setVersionKind('policy');
    const firstCountry = picker.countries[0]?.country_code ?? '';
    setCountryCode(firstCountry);
    const firstPack = picker.country_packs.find((p) => p.country_code === firstCountry);
    setPackId(firstPack?.id ?? '');
    const firstRs = picker.rulesets.find((r) => r.country_pack_id === (firstPack?.id ?? ''));
    setRulesetId(firstRs?.id ?? '');
    setApprovalRequired(true);
    setDefaultChannels(editor?.channels.slice(0, 2).map((c) => c.code) ?? ['docflow', 'email']);
    setWorkflows([emptyWorkflow(editor)]);
    setWorkflowType(editor?.workflow_types[0]?.code ?? 'waiting_client');
    setTemplatePeriodRef(editor?.preset_periods[0]?.period_slug ?? '1h');
    setTemplateCustomAmount(1);
    setTemplateCustomUnit(editor?.allowed_units[0]?.code ?? 'hours');
    setTemplateDisplayName('');
    setLanguage(editor?.languages[0]?.code ?? 'he');
    setChannel(editor?.channels[0]?.code ?? 'docflow');
    setSubjectTemplate('');
    setBodyTemplate('');
    setVariables(['client_name']);
    setTone('');
    // Reset only when modal opens or kind changes — not when picker option arrays are re-derived.
  }, [open, kind]);

  function onCountryChange(code: string) {
    const countryUp = code.trim().toUpperCase();
    setCountryCode(countryUp);
    const pack = picker.country_packs.find((p) => p.country_code === countryUp);
    setPackId(pack?.id ?? '');
    const rs = picker.rulesets.find((r) => r.country_pack_id === (pack?.id ?? ''));
    setRulesetId(rs?.id ?? '');
  }

  function onPackChange(id: string) {
    setPackId(id);
    const rs = picker.rulesets.find((r) => r.country_pack_id === id);
    setRulesetId(rs?.id ?? '');
  }

  function buildScopePayload(): UnknownRecord {
    return {
      country_code: countryCode,
      country_pack_id: packId,
      country_pack_ruleset_id: rulesetId,
      effective_from: effectiveFrom,
      effective_to: effectiveTo.trim() || null,
      activate_after_create: activateAfterCreate,
    };
  }

  function buildPolicyPayload() {
    return {
      approval_required: approvalRequired,
      default_channels: defaultChannels,
      workflows: workflows.map((wf) => ({
        workflow_type: wf.workflow_type,
        enabled: wf.enabled,
        anchor: wf.anchor,
        cadence_periods: wf.cadence_periods.map((p) => {
          const base = {
            channels: p.channels,
            severity: p.severity,
            template_ref: p.template_ref,
          };
          if (p.period_ref === '__custom__') {
            return { ...base, period: { amount: p.custom_amount, unit: p.custom_unit } };
          }
          return { ...base, period_slug: p.period_ref };
        }),
      })),
    };
  }

  function buildTemplatePayload() {
    const periodPart =
      templatePeriodRef === '__custom__'
        ? { period: { amount: templateCustomAmount, unit: templateCustomUnit } }
        : { period_slug: templatePeriodRef };
    return {
      workflow_type: workflowType,
      language,
      channel,
      template_display_name: templateDisplayName.trim(),
      ...periodPart,
      subject_template: subjectTemplate,
      body_template: bodyTemplate,
      variables,
      ...(tone.trim() ? { tone: tone.trim() } : {}),
    };
  }

  async function handleSave(): Promise<void> {
    setError('');
    if (!countryCode || !packId || !rulesetId) {
      setError('Select country, country pack, and ruleset.');
      return;
    }
    if (!effectiveFrom) {
      setError('Effective from date is required.');
      return;
    }
    if (
      (kind === 'reminder_template' || (kind === 'reminder_version' && versionKind === 'template')) &&
      !templateDisplayName.trim()
    ) {
      setError('Template display name is required.');
      return;
    }
    try {
      if (kind === 'reminder_policy') {
        await onSubmit('save_operational_reminder_policy', {
          ...buildScopePayload(),
          policy: buildPolicyPayload(),
        });
      } else if (kind === 'reminder_template') {
        await onSubmit('save_operational_reminder_template', {
          ...buildScopePayload(),
          template: buildTemplatePayload(),
        });
      } else if (kind === 'reminder_version') {
        if (versionKind === 'policy') {
          await onSubmit('save_operational_reminder_policy_version', {
            ...buildScopePayload(),
            policy: buildPolicyPayload(),
          });
        } else {
          await onSubmit('save_operational_reminder_template_version', {
            ...buildScopePayload(),
            template: buildTemplatePayload(),
          });
        }
      }
      onClose();
    } catch (e) {
      const detail =
        e instanceof ApiError
          ? [e.message, e.code ? `code: ${e.code}` : null].filter(Boolean).join(' — ')
          : userFacingApiMessage(e);
      setError(detail);
    }
  }

  if (!open || !kind) return null;

  const title =
    kind === 'reminder_policy'
      ? 'New reminder policy'
      : kind === 'reminder_template'
        ? 'New reminder template'
        : 'New policy or template version';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        zIndex: 55,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#fff',
          width: 640,
          maxWidth: '100%',
          borderRadius: 8,
          padding: 16,
          maxHeight: '92vh',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <p style={{ color: '#666', fontSize: 13, marginTop: 0 }}>
          Country → Country pack → Ruleset. Technical legal identifiers are managed by the backend.
        </p>
        {error ? <p style={{ color: '#b91c1c', fontSize: 14 }}>{error}</p> : null}

        <CountryPackRulesetFields
          picker={picker}
          countryCode={countryCode}
          packId={packId}
          rulesetId={rulesetId}
          onCountry={onCountryChange}
          onPack={onPackChange}
          onRuleset={setRulesetId}
        />

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
          <label style={labelStyle}>
            Effective from
            <input type="date" value={effectiveFrom} style={inputStyle} onChange={(e) => setEffectiveFrom(e.target.value)} />
          </label>
          <label style={labelStyle}>
            Effective to (optional)
            <input type="date" value={effectiveTo} style={inputStyle} onChange={(e) => setEffectiveTo(e.target.value)} />
          </label>
        </div>
        <label style={{ fontSize: 13, display: 'block', marginTop: 8 }}>
          <input
            type="checkbox"
            checked={activateAfterCreate}
            onChange={(e) => setActivateAfterCreate(e.target.checked)}
          />{' '}
          Activate version after create
        </label>

        {kind === 'reminder_version' ? (
          <label style={{ ...labelStyle, marginTop: 12 }}>
            Version kind
            <select value={versionKind} style={inputStyle} onChange={(e) => setVersionKind(e.target.value as 'policy' | 'template')}>
              <option value="policy">Policy version</option>
              <option value="template">Template version</option>
            </select>
          </label>
        ) : null}

        {(kind === 'reminder_policy' || (kind === 'reminder_version' && versionKind === 'policy')) && (
          <PolicyEditor
            editor={editor}
            approvalRequired={approvalRequired}
            defaultChannels={defaultChannels}
            workflows={workflows}
            onApproval={setApprovalRequired}
            onChannels={setDefaultChannels}
            onWorkflows={setWorkflows}
          />
        )}

        {(kind === 'reminder_template' || (kind === 'reminder_version' && versionKind === 'template')) && (
          <TemplateEditor
            editor={editor}
            workflowType={workflowType}
            periodRef={templatePeriodRef}
            customAmount={templateCustomAmount}
            customUnit={templateCustomUnit}
            templateDisplayName={templateDisplayName}
            language={language}
            channel={channel}
            subjectTemplate={subjectTemplate}
            bodyTemplate={bodyTemplate}
            variables={variables}
            tone={tone}
            onChange={(patch) => {
              if (patch.workflowType !== undefined) setWorkflowType(patch.workflowType);
              if (patch.periodRef !== undefined) setTemplatePeriodRef(patch.periodRef);
              if (patch.customAmount !== undefined) setTemplateCustomAmount(patch.customAmount);
              if (patch.customUnit !== undefined) setTemplateCustomUnit(patch.customUnit);
              if (patch.templateDisplayName !== undefined) setTemplateDisplayName(patch.templateDisplayName);
              if (patch.language !== undefined) setLanguage(patch.language);
              if (patch.channel !== undefined) setChannel(patch.channel);
              if (patch.subjectTemplate !== undefined) setSubjectTemplate(patch.subjectTemplate);
              if (patch.bodyTemplate !== undefined) setBodyTemplate(patch.bodyTemplate);
              if (patch.variables !== undefined) setVariables(patch.variables);
              if (patch.tone !== undefined) setTone(patch.tone);
            }}
          />
        )}

        <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onClose} disabled={busy} style={btnGhost}>
            Cancel
          </button>
          <button type="button" disabled={busy} style={btnPrimary} onClick={() => void handleSave()}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
