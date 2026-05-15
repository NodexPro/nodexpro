import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ApiError, userFacingApiMessage } from '../api/client';
import type { AggregateAction } from './owner-legal-control-panel-actions';
import { btnCompact, btnGhost, btnPrimary } from './owner-legal-control-panel-actions';
import type { OwnerCommandResponse, UnknownRecord } from './owner-legal-control-types';

type EditorOption = { code: string; label: string; token?: string };
type PresetPeriodOption = { label: string; amount: number; unit: string; period_slug: string };

type EditorOptions = {
  workflow_types: EditorOption[];
  channels: EditorOption[];
  severities: EditorOption[];
  languages: EditorOption[];
  template_variables: EditorOption[];
  preset_periods: PresetPeriodOption[];
  allowed_units: EditorOption[];
};

type ReminderForm = {
  period_ref: string;
  custom_amount: number;
  custom_unit: string;
  severity: string;
  channels: string[];
  language: string;
  subject: string;
  message: string;
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

function normalizeCountryCode(raw: unknown): string {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return '';
  const row = raw as UnknownRecord;
  return safeText(row.country_code).toUpperCase() || safeText(row.code).toUpperCase();
}

function parsePickerOptions(cp: UnknownRecord | null) {
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
          token: safeText(x.token) || undefined,
        }))
      : [];
  return {
    workflow_types: mapOpts(e.workflow_types),
    channels: mapOpts(e.channels),
    severities: mapOpts(e.severities),
    languages: mapOpts(e.languages),
    template_variables: mapOpts(e.template_variables),
    preset_periods: Array.isArray(e.preset_periods)
      ? (e.preset_periods as UnknownRecord[]).map((x) => ({
          label: safeText(x.label),
          amount: Number(x.amount),
          unit: safeText(x.unit),
          period_slug: safeText(x.period_slug),
        }))
      : [],
    allowed_units: mapOpts(e.allowed_units),
  };
}

function emptyReminder(editor: EditorOptions | null): ReminderForm {
  return {
    period_ref: editor?.preset_periods[0]?.period_slug ?? '1h',
    custom_amount: 1,
    custom_unit: editor?.allowed_units[0]?.code ?? 'hours',
    severity: editor?.severities[0]?.code ?? 'info',
    channels: [editor?.channels[0]?.code ?? 'docflow'],
    language: editor?.languages[0]?.code ?? 'he',
    subject: '',
    message: '',
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

function ReminderCard({
  editor,
  reminder,
  index,
  canRemove,
  onChange,
  onRemove,
}: {
  editor: EditorOptions | null;
  reminder: ReminderForm;
  index: number;
  canRemove: boolean;
  onChange: (next: ReminderForm) => void;
  onRemove: () => void;
}) {
  const messageRef = useRef<HTMLTextAreaElement | null>(null);
  const showEmailSubject = reminder.channels.includes('email');

  function insertVariable(token: string) {
    const el = messageRef.current;
    if (!el) {
      onChange({ ...reminder, message: `${reminder.message}${token}` });
      return;
    }
    const start = el.selectionStart ?? reminder.message.length;
    const end = el.selectionEnd ?? start;
    const next = reminder.message.slice(0, start) + token + reminder.message.slice(end);
    onChange({ ...reminder, message: next });
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  function toggleChannel(code: string) {
    const has = reminder.channels.includes(code);
    const channels = has ? reminder.channels.filter((c) => c !== code) : [...reminder.channels, code];
    onChange({ ...reminder, channels: channels.length ? channels : [code] });
  }

  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: 12,
        marginBottom: 10,
        background: '#fff',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <strong style={{ fontSize: 14 }}>Reminder {index + 1}</strong>
        {canRemove ? (
          <button type="button" style={{ ...btnCompact, padding: '4px 10px', fontSize: 12 }} onClick={onRemove}>
            Remove
          </button>
        ) : null}
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <label style={labelStyle}>
          Period
          <select
            value={reminder.period_ref}
            style={inputStyle}
            onChange={(e) => onChange({ ...reminder, period_ref: e.target.value })}
          >
            {(editor?.preset_periods ?? []).map((p) => (
              <option key={p.period_slug} value={p.period_slug}>
                {p.label}
              </option>
            ))}
            <option value="__custom__">Custom</option>
          </select>
        </label>
        {reminder.period_ref === '__custom__' ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={labelStyle}>
              Amount
              <input
                type="number"
                min={1}
                value={reminder.custom_amount}
                style={inputStyle}
                onChange={(e) => onChange({ ...reminder, custom_amount: Number(e.target.value) })}
              />
            </label>
            <label style={labelStyle}>
              Unit
              <select
                value={reminder.custom_unit}
                style={inputStyle}
                onChange={(e) => onChange({ ...reminder, custom_unit: e.target.value })}
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
        <label style={labelStyle}>
          Severity
          <select
            value={reminder.severity}
            style={inputStyle}
            onChange={(e) => onChange({ ...reminder, severity: e.target.value })}
          >
            {(editor?.severities ?? []).map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <div>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 4 }}>Channels</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(editor?.channels ?? []).map((ch) => (
              <label key={ch.code} style={{ fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={reminder.channels.includes(ch.code)}
                  onChange={() => toggleChannel(ch.code)}
                />{' '}
                {ch.label}
              </label>
            ))}
          </div>
        </div>
        <label style={labelStyle}>
          Language
          <select
            value={reminder.language}
            style={inputStyle}
            onChange={(e) => onChange({ ...reminder, language: e.target.value })}
          >
            {(editor?.languages ?? []).map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        {showEmailSubject ? (
          <label style={labelStyle}>
            Email subject
            <input
              type="text"
              value={reminder.subject}
              style={inputStyle}
              onChange={(e) => onChange({ ...reminder, subject: e.target.value })}
            />
          </label>
        ) : null}
        <label style={labelStyle}>
          Message
          <textarea
            ref={messageRef}
            rows={5}
            value={reminder.message}
            style={{ ...inputStyle, fontFamily: 'inherit' }}
            placeholder={'שלום {{client_name}},\nאנחנו עדיין ממתינים למסמכים הדרושים.'}
            onChange={(e) => onChange({ ...reminder, message: e.target.value })}
          />
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Insert variable</span>
          <select
            defaultValue=""
            style={{ ...inputStyle, width: 'auto', minWidth: 180, marginTop: 0 }}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return;
              const opt = (editor?.template_variables ?? []).find((x) => x.code === v);
              insertVariable(opt?.token ?? `{{${v}}}`);
              e.target.value = '';
            }}
          >
            <option value="">Choose…</option>
            {(editor?.template_variables ?? []).map((v) => (
              <option key={v.code} value={v.code}>
                {v.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

export function CommunicationPoliciesToolbar({
  actions,
  disabled,
  onOpenWorkflow,
}: {
  actions: AggregateAction[];
  disabled: boolean;
  onOpenWorkflow: () => void;
}) {
  const workflowAction = actions.find((a) => safeText((a as UnknownRecord).smart_form) === 'reminder_workflow');
  if (!workflowAction || workflowAction.enabled === false) return null;
  return (
    <button type="button" disabled={disabled} style={btnCompact} onClick={onOpenWorkflow}>
      {workflowAction.button_label?.trim() || 'New reminder workflow'}
    </button>
  );
}

export function OperationalReminderWorkflowWizard({
  open,
  busy,
  communicationPolicies,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  communicationPolicies: UnknownRecord | null;
  onClose: () => void;
  onSubmit: (command: string, payload: UnknownRecord) => Promise<OwnerCommandResponse>;
}) {
  const picker = useMemo(() => parsePickerOptions(communicationPolicies), [communicationPolicies]);
  const editor = useMemo(() => parseEditorOptions(communicationPolicies), [communicationPolicies]);

  const [step, setStep] = useState<1 | 2>(1);
  const [countryCode, setCountryCode] = useState('');
  const [packId, setPackId] = useState('');
  const [rulesetId, setRulesetId] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState(fmtToday());
  const [effectiveTo, setEffectiveTo] = useState('');
  const [activateAfterCreate, setActivateAfterCreate] = useState(true);
  const [workflowType, setWorkflowType] = useState('waiting_client');
  const [approvalRequired, setApprovalRequired] = useState(true);
  const [defaultChannels, setDefaultChannels] = useState<string[]>(['docflow', 'email']);
  const [reminders, setReminders] = useState<ReminderForm[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setError('');
    setEffectiveFrom(fmtToday());
    setEffectiveTo('');
    setActivateAfterCreate(true);
    const firstCountry = picker.countries[0]?.country_code ?? '';
    setCountryCode(firstCountry);
    const firstPack = picker.country_packs.find((p) => p.country_code === firstCountry);
    setPackId(firstPack?.id ?? '');
    const firstRs = picker.rulesets.find((r) => r.country_pack_id === (firstPack?.id ?? ''));
    setRulesetId(firstRs?.id ?? '');
    setWorkflowType(editor?.workflow_types[0]?.code ?? 'waiting_client');
    setApprovalRequired(true);
    setDefaultChannels(editor?.channels.slice(0, 2).map((c) => c.code) ?? ['docflow', 'email']);
    setReminders([emptyReminder(editor)]);
  }, [open]);

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

  function toggleDefaultChannel(code: string) {
    setDefaultChannels((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  function buildPayload(): UnknownRecord {
    return {
      country_code: countryCode,
      country_pack_id: packId,
      country_pack_ruleset_id: rulesetId,
      effective_from: effectiveFrom,
      effective_to: effectiveTo.trim() || null,
      activate_after_create: activateAfterCreate,
      workflow_type: workflowType,
      approval_required: approvalRequired,
      default_channels: defaultChannels,
      reminders: reminders.map((r) => {
        const periodPart =
          r.period_ref === '__custom__'
            ? { period: { amount: r.custom_amount, unit: r.custom_unit } }
            : { period_slug: r.period_ref };
        return {
          ...periodPart,
          severity: r.severity,
          channels: r.channels,
          language: r.language,
          ...(r.channels.includes('email') && r.subject.trim() ? { subject: r.subject.trim() } : {}),
          message: r.message.trim(),
        };
      }),
    };
  }

  async function handleSave(): Promise<void> {
    setError('');
    if (!countryCode || !packId || !rulesetId) {
      setError('Select country, country pack, and ruleset.');
      return;
    }
    if (!defaultChannels.length) {
      setError('Select at least one default channel.');
      return;
    }
    if (!reminders.length) {
      setError('Add at least one reminder.');
      return;
    }
    for (let i = 0; i < reminders.length; i++) {
      const r = reminders[i];
      if (!r.message.trim()) {
        setError(`Reminder ${i + 1}: message is required.`);
        return;
      }
      if (r.channels.includes('email') && !r.subject.trim()) {
        setError(`Reminder ${i + 1}: email subject is required when Email channel is selected.`);
        return;
      }
    }
    try {
      await onSubmit('save_operational_reminder_workflow', buildPayload());
      onClose();
    } catch (e) {
      setError(
        e instanceof ApiError
          ? [e.message, e.code ? `code: ${e.code}` : null].filter(Boolean).join(' — ')
          : userFacingApiMessage(e),
      );
    }
  }

  if (!open) return null;

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
          width: 680,
          maxWidth: '100%',
          borderRadius: 8,
          padding: 16,
          maxHeight: '92vh',
          overflow: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0 }}>New reminder workflow</h3>
        <p style={{ color: '#666', fontSize: 13, marginTop: 0 }}>
          Step {step} of 2 — templates and policy linkage are created automatically on save.
        </p>
        {error ? <p style={{ color: '#b91c1c', fontSize: 14 }}>{error}</p> : null}

        {step === 1 ? (
          <>
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
                <input
                  type="date"
                  value={effectiveFrom}
                  style={inputStyle}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                />
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
              Activate after create
            </label>
            <label style={{ ...labelStyle, marginTop: 12 }}>
              Workflow type
              <select value={workflowType} style={inputStyle} onChange={(e) => setWorkflowType(e.target.value)}>
                {(editor?.workflow_types ?? []).map((w) => (
                  <option key={w.code} value={w.code}>
                    {w.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 14, display: 'block', marginTop: 8 }}>
              <input
                type="checkbox"
                checked={approvalRequired}
                onChange={(e) => setApprovalRequired(e.target.checked)}
              />{' '}
              Approval required before send
            </label>
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 500, fontSize: 14, marginBottom: 6 }}>Default channels</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {(editor?.channels ?? []).map((ch) => (
                  <label key={ch.code} style={{ fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={defaultChannels.includes(ch.code)}
                      onChange={() => toggleDefaultChannel(ch.code)}
                    />{' '}
                    {ch.label}
                  </label>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: '#4b5563', margin: '8px 0' }}>
              Define when reminders fire and what message is sent. Variables are inserted from the list — no separate
              checkbox matrix.
            </p>
            {reminders.map((r, i) => (
              <ReminderCard
                key={i}
                editor={editor}
                reminder={r}
                index={i}
                canRemove={reminders.length > 1}
                onChange={(next) => {
                  const copy = [...reminders];
                  copy[i] = next;
                  setReminders(copy);
                }}
                onRemove={() => setReminders(reminders.filter((_, j) => j !== i))}
              />
            ))}
            <button
              type="button"
              style={{ ...btnCompact, marginTop: 4 }}
              onClick={() => setReminders([...reminders, emptyReminder(editor)])}
            >
              + Add reminder
            </button>
          </>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            gap: 8,
            marginTop: 16,
            flexWrap: 'wrap',
          }}
        >
          <button type="button" onClick={onClose} disabled={busy} style={btnGhost}>
            Cancel
          </button>
          {step === 2 ? (
            <button type="button" disabled={busy} style={btnGhost} onClick={() => setStep(1)}>
              Back
            </button>
          ) : null}
          {step === 1 ? (
            <button
              type="button"
              disabled={busy || !countryCode || !packId || !rulesetId}
              style={btnPrimary}
              onClick={() => setStep(2)}
            >
              Next — Reminder schedule
            </button>
          ) : (
            <button type="button" disabled={busy} style={btnPrimary} onClick={() => void handleSave()}>
              {busy ? 'Saving…' : 'Save workflow'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
