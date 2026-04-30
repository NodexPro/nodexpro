import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiJson, userFacingApiMessage } from '../api/client';
import { OWNER, docflowCommunicationRuleRunReviewAggregate, docflowOfficeCommands, orgCountrySettings } from '../api/endpoints';
import { useAuth } from '../contexts/AuthContext';

type UnknownRecord = Record<string, unknown>;

type DraftAction = { command?: string; enabled?: boolean; reason?: string | null };
type TemplateOption = { value_key: string; label: string; preview: string; message_type: string };

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

export function DocflowCommunicationReviewPage() {
  const auth = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [aggregate, setAggregate] = useState<UnknownRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');

  const [ruleRunIdInput, setRuleRunIdInput] = useState(() => searchParams.get('rule_run_id')?.trim() ?? '');
  const [templateKey, setTemplateKey] = useState('');
  const [runDate, setRunDate] = useState(todayYmd);
  const [templateOptions, setTemplateOptions] = useState<TemplateOption[]>([]);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState('');
  const [countryConfigWarning, setCountryConfigWarning] = useState('');
  const [resolvedCountryCode, setResolvedCountryCode] = useState('');
  const [resolvedPackCode, setResolvedPackCode] = useState('');
  const [resolvedRulesetCode, setResolvedRulesetCode] = useState('');
  const [autoSelectedPackCode, setAutoSelectedPackCode] = useState('');

  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState('');

  const orgId = auth.status === 'authenticated' ? auth.me.activeOrganizationId ?? '' : '';

  useEffect(() => {
    let alive = true;
    async function loadResolvedContext(): Promise<void> {
      if (!orgId) {
        setTemplateOptions([]);
        setTemplateKey('');
        setCountryConfigWarning('');
        setResolvedCountryCode('');
        setResolvedPackCode('');
        setResolvedRulesetCode('');
        setAutoSelectedPackCode('');
        return;
      }
      setContextLoading(true);
      setContextError('');
      setCountryConfigWarning('');
      setTemplateOptions([]);
      setTemplateKey('');
      setAutoSelectedPackCode('');
      try {
        const settings = (await apiJson(orgCountrySettings(orgId))) as {
          organization?: { country_code?: string | null };
          eligible_packs?: Array<{ pack_code?: string; status?: string; id?: string }>;
          active_pack?: { pack_code?: string; id?: string } | null;
          active_ruleset?: { ruleset_code?: string; id?: string } | null;
        };
        if (!alive) return;
        const eligible = Array.isArray(settings.eligible_packs) ? settings.eligible_packs : [];
        const activePackCode = String(settings.active_pack?.pack_code ?? '').trim();
        const activeRulesetCode = String(settings.active_ruleset?.ruleset_code ?? '').trim();
        const countryCode = String(settings.organization?.country_code ?? '').trim();
        setResolvedCountryCode(countryCode);
        setResolvedPackCode(activePackCode);
        setResolvedRulesetCode(activeRulesetCode);
        if (!activePackCode && eligible.length === 1) {
          setAutoSelectedPackCode(String(eligible[0]?.pack_code ?? '').trim());
        }
        if (!activePackCode || !activeRulesetCode) {
          setCountryConfigWarning('No active country configuration. Please configure organization once.');
          return;
        }
        const ctx = (await apiJson(OWNER.activeRulesetContext(orgId, runDate || todayYmd()))) as {
          resolved_legal_values_map?: Record<string, unknown>;
        };
        if (!alive) return;
        const map = ctx?.resolved_legal_values_map ?? {};
        const nextOptions: TemplateOption[] = [];
        for (const [key, raw] of Object.entries(map)) {
          if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
          const payload = raw as Record<string, unknown>;
          if (String(payload.type ?? '') !== 'docflow_communication') continue;
          const messageTemplate = String(payload.message_template ?? '').trim();
          const preview = messageTemplate.length > 100 ? `${messageTemplate.slice(0, 100)}…` : messageTemplate;
          const mt = String(payload.message_type ?? 'reminder');
          nextOptions.push({
            value_key: key,
            label: key,
            preview,
            message_type: mt === 'system' ? 'system' : 'reminder',
          });
        }
        nextOptions.sort((a, b) => a.value_key.localeCompare(b.value_key));
        setTemplateOptions(nextOptions);
        if (nextOptions.length === 1) setTemplateKey(nextOptions[0].value_key);
      } catch (e) {
        if (!alive) return;
        setContextError(userFacingApiMessage(e));
      } finally {
        if (alive) setContextLoading(false);
      }
    }
    void loadResolvedContext();
    return () => {
      alive = false;
    };
  }, [orgId, runDate]);

  const runInfo = useMemo(() => {
    const r = aggregate?.run;
    return r && typeof r === 'object' ? (r as UnknownRecord) : null;
  }, [aggregate]);

  const sourceRule = useMemo(() => {
    const s = aggregate?.source_rule;
    return s && typeof s === 'object' ? (s as UnknownRecord) : null;
  }, [aggregate]);

  const drafts = useMemo(() => {
    const d = aggregate?.drafts;
    return Array.isArray(d) ? (d as UnknownRecord[]) : [];
  }, [aggregate]);

  const skippedClients = useMemo(() => {
    const s = aggregate?.skipped_clients;
    return Array.isArray(s) ? (s as UnknownRecord[]) : [];
  }, [aggregate]);

  const clientSummary = useMemo(() => {
    const c = aggregate?.client_summary;
    return c && typeof c === 'object' ? (c as UnknownRecord) : null;
  }, [aggregate]);

  const selectedDraft = useMemo(() => {
    if (!selectedDraftId) return null;
    return drafts.find((d) => String(d.id) === selectedDraftId) ?? null;
  }, [drafts, selectedDraftId]);

  const draftActions = useMemo(() => {
    const a = selectedDraft?.allowed_actions;
    return Array.isArray(a) ? (a as DraftAction[]) : [];
  }, [selectedDraft]);

  const applyReviewAggregate = useCallback((data: UnknownRecord): void => {
    if (data.aggregate_key !== 'communication_rule_run_review_aggregate') {
      setError('Unexpected aggregate from server');
      return;
    }
    setAggregate(data);
    setError('');
    const rid = String((data.run as UnknownRecord | undefined)?.id ?? '').trim();
    if (rid) {
      setRuleRunIdInput(rid);
      setSearchParams({ rule_run_id: rid }, { replace: true });
    }
  }, [setSearchParams]);

  const loadByRuleRunId = useCallback(
    async (ruleRunId: string): Promise<void> => {
      const id = ruleRunId.trim();
      if (!id) {
        setError('rule_run_id is required');
        return;
      }
      if (!orgId) {
        setError('No active organization selected');
        return;
      }
      setLoading(true);
      setError('');
      try {
        const data = (await apiJson(docflowCommunicationRuleRunReviewAggregate(id))) as UnknownRecord;
        applyReviewAggregate(data);
      } catch (e) {
        setError(userFacingApiMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [orgId, applyReviewAggregate]
  );

  useEffect(() => {
    const fromUrl = searchParams.get('rule_run_id')?.trim() ?? '';
    if (fromUrl && orgId) void loadByRuleRunId(fromUrl);
  }, [orgId, searchParams, loadByRuleRunId]);

  useEffect(() => {
    if (!selectedDraftId) {
      setEditBody('');
      return;
    }
    const d = drafts.find((x) => String(x.id) === selectedDraftId);
    if (d) setEditBody(String(d.message_body ?? ''));
  }, [aggregate, drafts, selectedDraftId]);

  async function postCommand(command: string, payload: UnknownRecord): Promise<void> {
    if (!orgId) {
      setError('No active organization selected');
      return;
    }
    setBusy(command);
    setError('');
    try {
      const out = (await apiJson(docflowOfficeCommands, {
        method: 'POST',
        body: JSON.stringify({ command, payload: { org_id: orgId, ...payload } }),
      })) as {
        refreshed?: { aggregate_key?: string; aggregate?: UnknownRecord };
      };
      const key = out.refreshed?.aggregate_key;
      const agg = out.refreshed?.aggregate;
      if (key !== 'communication_rule_run_review_aggregate' || !agg || typeof agg !== 'object') {
        throw new Error('DocFlow review aggregate missing in command response');
      }
      applyReviewAggregate(agg as UnknownRecord);
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setBusy('');
    }
  }

  async function handleRunRule(): Promise<void> {
    const vk = templateKey.trim();
    if (!vk) {
      setError('Template is required');
      return;
    }
    const payload: UnknownRecord = { value_key: vk };
    if (runDate.trim()) payload.run_date = runDate.trim();
    await postCommand('run_communication_rule', payload);
  }

  async function handleLoadRun(): Promise<void> {
    await loadByRuleRunId(ruleRunIdInput);
  }

  const currentRunId = String(runInfo?.id ?? ruleRunIdInput.trim() ?? '');

  async function handleSaveEdit(): Promise<void> {
    if (!selectedDraftId || !currentRunId) return;
    const body = editBody.trim();
    if (!body) {
      setError('message_body cannot be empty');
      return;
    }
    await postCommand('edit_draft_message', {
      rule_run_id: currentRunId,
      draft_id: selectedDraftId,
      message_body: body,
    });
  }

  function isDraftActionEnabled(command: string): { ok: boolean; reason: string | null } {
    const list = draftActions.filter((a) => String(a.command ?? '') === command);
    const a = list[0];
    if (!a) return { ok: false, reason: 'Not available for this draft' };
    if (a.enabled === false) return { ok: false, reason: (a.reason as string | null) ?? 'Disabled' };
    return { ok: true, reason: null };
  }

  const sectionStyle = { marginTop: 16, padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, background: '#fff' };
  const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 4, color: '#374151' };
  const inputStyle: CSSProperties = {
    padding: '8px 10px',
    fontSize: 14,
    borderRadius: 6,
    border: '1px solid #d1d5db',
    width: '100%',
    maxWidth: 420,
    boxSizing: 'border-box',
  };
  const btnPrimary: CSSProperties = {
    padding: '8px 20px',
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1.2,
    borderRadius: 6,
    border: 'none',
    background: '#2563eb',
    color: '#fff',
    cursor: 'pointer',
  };
  const btnSecondary: CSSProperties = {
    ...btnPrimary,
    background: '#fff',
    color: '#2563eb',
    border: '1px solid #2563eb',
  };
  const btnMuted: CSSProperties = {
    padding: '8px 16px',
    fontSize: 14,
    fontWeight: 600,
    lineHeight: 1.2,
    borderRadius: 6,
    border: '1px solid #9ca3af',
    background: '#fff',
    color: '#374151',
    cursor: 'pointer',
  };

  return (
    <div style={{ padding: 24, maxWidth: 1200 }}>
      <h1 style={{ marginTop: 0 }}>DocFlow — communication review</h1>
      <p style={{ color: '#6b7280', fontSize: 14, maxWidth: 720 }}>
        Pick a communication template and run it. Organization, country, pack and ruleset are resolved from your current session context.
        Client-facing text here is the <strong>draft copy</strong> for this run; editing does not change the Owner legal value template.
      </p>
      {!orgId ? <p style={{ color: '#b45309' }}>Select an organization to continue.</p> : null}
      {countryConfigWarning ? (
        <p style={{ color: '#b45309' }}>
          {countryConfigWarning} <Link to="/settings">Open setup</Link>
        </p>
      ) : null}
      {contextError ? <p style={{ color: '#b45309' }}>{contextError}</p> : null}

      <div style={sectionStyle}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Run rule</h2>
        <p style={{ marginTop: 0, color: '#6b7280', fontSize: 13 }}>
          Context: country <strong>{resolvedCountryCode || '—'}</strong>, pack <strong>{resolvedPackCode || autoSelectedPackCode || '—'}</strong>,
          ruleset <strong>{resolvedRulesetCode || '—'}</strong>
        </p>
        <div style={{ display: 'grid', gap: 12, maxWidth: 480 }}>
          <div>
            <label style={labelStyle}>Template</label>
            <select
              style={inputStyle}
              value={templateKey}
              onChange={(e) => setTemplateKey(e.target.value)}
              disabled={contextLoading || !templateOptions.length || !!countryConfigWarning}
            >
              <option value="">{contextLoading ? 'Loading templates…' : 'Select template'}</option>
              {templateOptions.map((t) => (
                <option key={t.value_key} value={t.value_key}>
                  {t.label} ({t.message_type})
                </option>
              ))}
            </select>
            {templateKey ? (
              <p style={{ marginTop: 6, color: '#6b7280', fontSize: 12 }}>
                {templateOptions.find((t) => t.value_key === templateKey)?.preview ?? ''}
              </p>
            ) : null}
          </div>
          <div>
            <label style={labelStyle}>run_date (optional)</label>
            <input style={inputStyle} type="date" value={runDate} onChange={(e) => setRunDate(e.target.value)} />
          </div>
          <div>
            <button
              type="button"
              style={btnPrimary}
              disabled={!orgId || busy.length > 0 || !templateKey || !!countryConfigWarning}
              onClick={() => void handleRunRule()}
            >
              {busy === 'run_communication_rule' ? 'Running…' : 'Run communication rule'}
            </button>
          </div>
        </div>
      </div>

      <div style={sectionStyle}>
        <h2 style={{ marginTop: 0, fontSize: 16 }}>Load existing run</h2>
        <p style={{ fontSize: 13, color: '#6b7280', marginTop: 0 }}>
          GET <code style={{ fontSize: 12 }}>/docflow/aggregates/communication-rule-run-review</code> — read-only until you change drafts via
          commands.
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <input
            style={{ ...inputStyle, maxWidth: 360 }}
            value={ruleRunIdInput}
            onChange={(e) => setRuleRunIdInput(e.target.value)}
            placeholder="rule_run_id (uuid)"
          />
          <button type="button" style={btnSecondary} disabled={!orgId || loading || busy.length > 0} onClick={() => void handleLoadRun()}>
            {loading ? 'Loading…' : 'Load aggregate'}
          </button>
        </div>
      </div>

      {error ? (
        <p style={{ color: '#b91c1c', marginTop: 12 }} role="alert">
          {error}
        </p>
      ) : null}

      {aggregate ? (
        <>
          <div style={sectionStyle}>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>Run</h2>
            <pre style={{ fontSize: 12, background: '#f9fafb', padding: 12, borderRadius: 6, overflow: 'auto' }}>
              {JSON.stringify(runInfo, null, 2)}
            </pre>
            {sourceRule ? (
              <>
                <h3 style={{ fontSize: 14 }}>Source rule (Owner legal value)</h3>
                <pre style={{ fontSize: 12, background: '#f9fafb', padding: 12, borderRadius: 6, overflow: 'auto' }}>
                  {JSON.stringify(sourceRule, null, 2)}
                </pre>
              </>
            ) : null}
            {clientSummary ? (
              <p style={{ fontSize: 14 }}>
                <strong>Summary:</strong> draft {String(clientSummary.draft_count ?? 0)}, approved {String(clientSummary.approved_count ?? '')},
                sent {String(clientSummary.sent_count ?? '')}, cancelled {String(clientSummary.cancelled_count ?? '')}
              </p>
            ) : null}
          </div>

          {skippedClients.length ? (
            <div style={sectionStyle}>
              <h2 style={{ marginTop: 0, fontSize: 16 }}>Skipped clients</h2>
              <ul style={{ margin: 0, paddingLeft: 20 }}>
                {skippedClients.map((row, i) => (
                  <li key={`${String(row.client_id ?? i)}`} style={{ fontSize: 14 }}>
                    {String(row.client_id ?? '')}: {String(row.reason ?? '')}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div style={sectionStyle}>
            <h2 style={{ marginTop: 0, fontSize: 16 }}>Draft messages</h2>
            <p style={{ fontSize: 13, color: '#6b7280' }}>
              Clients only see messages after <strong>send</strong> (published in DocFlow). Draft / approved / cancelled are office-only.
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr>
                    {['Client', 'Status', 'Type', 'Preview', 'Select'].map((h) => (
                      <th key={h} style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb', padding: 8 }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((d) => {
                    const id = String(d.id ?? '');
                    const body = String(d.message_body ?? '');
                    const preview = body.length > 80 ? `${body.slice(0, 80)}…` : body;
                    const sel = selectedDraftId === id;
                    return (
                      <tr key={id} style={{ background: sel ? '#eff6ff' : undefined }}>
                        <td style={{ borderBottom: '1px solid #f3f4f6', padding: 8 }}>
                          {String(d.client_display_name ?? d.client_id ?? '')}
                        </td>
                        <td style={{ borderBottom: '1px solid #f3f4f6', padding: 8 }}>{String(d.status ?? '')}</td>
                        <td style={{ borderBottom: '1px solid #f3f4f6', padding: 8 }}>{String(d.message_type ?? '')}</td>
                        <td style={{ borderBottom: '1px solid #f3f4f6', padding: 8, maxWidth: 280 }}>{preview}</td>
                        <td style={{ borderBottom: '1px solid #f3f4f6', padding: 8 }}>
                          <button type="button" style={btnMuted} onClick={() => setSelectedDraftId(id)}>
                            Select
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {selectedDraft ? (
            <div style={sectionStyle}>
              <h2 style={{ marginTop: 0, fontSize: 16 }}>Selected draft</h2>
              <p style={{ fontSize: 13, color: '#6b7280' }}>
                Editing updates <strong>this draft only</strong>. The Owner Panel template is unchanged.
              </p>
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                rows={8}
                style={{
                  width: '100%',
                  maxWidth: 720,
                  padding: 10,
                  fontSize: 14,
                  borderRadius: 6,
                  border: '1px solid #d1d5db',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
                disabled={String(selectedDraft.status) !== 'draft'}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                <button
                  type="button"
                  style={btnPrimary}
                  disabled={busy.length > 0 || !isDraftActionEnabled('edit_draft_message').ok || String(selectedDraft.status) !== 'draft'}
                  title={isDraftActionEnabled('edit_draft_message').reason ?? undefined}
                  onClick={() => void handleSaveEdit()}
                >
                  {busy === 'edit_draft_message' ? 'Saving…' : 'Save draft body'}
                </button>
                <button
                  type="button"
                  style={btnSecondary}
                  disabled={busy.length > 0 || !isDraftActionEnabled('approve_draft_message').ok}
                  title={isDraftActionEnabled('approve_draft_message').reason ?? undefined}
                  onClick={() =>
                    void postCommand('approve_draft_message', { rule_run_id: currentRunId, draft_id: selectedDraftId })
                  }
                >
                  Approve
                </button>
                <button
                  type="button"
                  style={btnMuted}
                  disabled={busy.length > 0 || !isDraftActionEnabled('cancel_draft_message').ok}
                  title={isDraftActionEnabled('cancel_draft_message').reason ?? undefined}
                  onClick={() =>
                    void postCommand('cancel_draft_message', { rule_run_id: currentRunId, draft_id: selectedDraftId })
                  }
                >
                  Cancel draft
                </button>
                <button
                  type="button"
                  style={{ ...btnPrimary, background: '#059669' }}
                  disabled={busy.length > 0 || !isDraftActionEnabled('send_approved_message').ok}
                  title={isDraftActionEnabled('send_approved_message').reason ?? undefined}
                  onClick={() =>
                    void postCommand('send_approved_message', { rule_run_id: currentRunId, draft_id: selectedDraftId })
                  }
                >
                  {busy === 'send_approved_message' ? 'Sending…' : 'Send to client'}
                </button>
              </div>
              <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 8 }}>
                Buttons follow <code>allowed_actions</code> from the aggregate for this draft.
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
