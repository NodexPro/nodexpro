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

type EditorOptions = {
  workflow_types: EditorOption[];
  channels: EditorOption[];
  anchors: EditorOption[];
  severities: EditorOption[];
  languages: EditorOption[];
  template_variables: EditorOption[];
};

type CadenceStepForm = {
  step_key: string;
  offset_minutes: number;
  template_key: string;
  channels: string[];
  severity: string;
};

type WorkflowForm = {
  workflow_type: string;
  enabled: boolean;
  anchor: string;
  cadence_steps: CadenceStepForm[];
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

function emptyCadenceStep(): CadenceStepForm {
  return { step_key: '', offset_minutes: 60, template_key: '', channels: [], severity: '' };
}

function emptyWorkflow(editor: EditorOptions | null): WorkflowForm {
  return {
    workflow_type: editor?.workflow_types[0]?.code ?? 'waiting_client',
    enabled: true,
    anchor: editor?.anchors[0]?.code ?? 'obligation_starts_at',
    cadence_steps: [emptyCadenceStep()],
  };
}

function parsePickerOptions(cp: UnknownRecord | null) {
  const po = cp?.picker_options;
  const o = po && typeof po === 'object' && !Array.isArray(po) ? (po as UnknownRecord) : {};
  return {
    countries: (Array.isArray(o.countries) ? o.countries : []) as PickerCountry[],
    country_packs: (Array.isArray(o.country_packs) ? o.country_packs : []) as PickerPack[],
    rulesets: (Array.isArray(o.rulesets) ? o.rulesets : []) as PickerRuleset[],
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
  return {
    workflow_types: mapOpts(e.workflow_types),
    channels: mapOpts(e.channels),
    anchors: mapOpts(e.anchors),
    severities: mapOpts(e.severities),
    languages: mapOpts(e.languages),
    template_variables: mapOpts(e.template_variables),
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
  const packs = useMemo(
    () => picker.country_packs.filter((p) => p.country_code === countryCode),
    [picker.country_packs, countryCode],
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
            <div style={{ fontWeight: 500, fontSize: 13, marginBottom: 6 }}>Cadence steps</div>
            {wf.cadence_steps.map((step, si) => (
              <div
                key={si}
                style={{ border: '1px solid #e5e7eb', borderRadius: 6, padding: 8, marginBottom: 8, background: '#fff' }}
              >
                <div style={{ display: 'grid', gap: 6 }}>
                  <input
                    placeholder="Step key (e.g. nudge_1h)"
                    value={step.step_key}
                    style={inputStyle}
                    onChange={(e) => {
                      const next = [...workflows];
                      const steps = [...wf.cadence_steps];
                      steps[si] = { ...step, step_key: e.target.value };
                      next[wi] = { ...wf, cadence_steps: steps };
                      onWorkflows(next);
                    }}
                  />
                  <input
                    type="number"
                    placeholder="Offset minutes"
                    value={step.offset_minutes}
                    style={inputStyle}
                    onChange={(e) => {
                      const next = [...workflows];
                      const steps = [...wf.cadence_steps];
                      steps[si] = { ...step, offset_minutes: Number(e.target.value) };
                      next[wi] = { ...wf, cadence_steps: steps };
                      onWorkflows(next);
                    }}
                  />
                  <input
                    placeholder="Template key (comm.reminder.template.*)"
                    value={step.template_key}
                    style={inputStyle}
                    onChange={(e) => {
                      const next = [...workflows];
                      const steps = [...wf.cadence_steps];
                      steps[si] = { ...step, template_key: e.target.value };
                      next[wi] = { ...wf, cadence_steps: steps };
                      onWorkflows(next);
                    }}
                  />
                  <select
                    value={step.severity}
                    style={inputStyle}
                    onChange={(e) => {
                      const next = [...workflows];
                      const steps = [...wf.cadence_steps];
                      steps[si] = { ...step, severity: e.target.value };
                      next[wi] = { ...wf, cadence_steps: steps };
                      onWorkflows(next);
                    }}
                  >
                    <option value="">Severity (optional)</option>
                    {(editor?.severities ?? []).map((s) => (
                      <option key={s.code} value={s.code}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                {wf.cadence_steps.length > 1 ? (
                  <button
                    type="button"
                    style={{ ...btnCompact, marginTop: 6, padding: '4px 10px', fontSize: 12 }}
                    onClick={() => {
                      const next = [...workflows];
                      next[wi] = { ...wf, cadence_steps: wf.cadence_steps.filter((_, i) => i !== si) };
                      onWorkflows(next);
                    }}
                  >
                    Remove step
                  </button>
                ) : null}
              </div>
            ))}
            <button
              type="button"
              style={{ ...btnCompact, padding: '4px 12px', fontSize: 12 }}
              onClick={() => {
                const next = [...workflows];
                next[wi] = { ...wf, cadence_steps: [...wf.cadence_steps, emptyCadenceStep()] };
                onWorkflows(next);
              }}
            >
              Add cadence step
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
  language: string;
  channel: string;
  subjectTemplate: string;
  bodyTemplate: string;
  variables: string[];
  tone: string;
  onChange: (patch: Partial<{
    workflowType: string;
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
    setLanguage(editor?.languages[0]?.code ?? 'he');
    setChannel(editor?.channels[0]?.code ?? 'docflow');
    setSubjectTemplate('');
    setBodyTemplate('');
    setVariables(['client_name']);
    setTone('');
  }, [open, kind, editor, picker.countries, picker.country_packs, picker.rulesets]);

  function onCountryChange(code: string) {
    setCountryCode(code);
    const pack = picker.country_packs.find((p) => p.country_code === code);
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
        cadence_steps: wf.cadence_steps.map((s) => ({
          step_key: s.step_key,
          offset_minutes: s.offset_minutes,
          template_key: s.template_key,
          ...(s.channels.length ? { channels: s.channels } : {}),
          ...(s.severity ? { severity: s.severity } : {}),
        })),
      })),
    };
  }

  function buildTemplatePayload() {
    return {
      workflow_type: workflowType,
      language,
      channel,
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
            language={language}
            channel={channel}
            subjectTemplate={subjectTemplate}
            bodyTemplate={bodyTemplate}
            variables={variables}
            tone={tone}
            onChange={(patch) => {
              if (patch.workflowType !== undefined) setWorkflowType(patch.workflowType);
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
