import { useEffect, useState } from 'react';
import { apiJson, userFacingApiMessage } from '../api/client';
import { OWNER } from '../api/endpoints';
import type { UnknownRecord } from './owner-legal-control-types';
import {
  ownerAiGatewayAction,
  ownerAiGatewayRoutingLabel,
  ownerAiGatewayStatusPresentation,
  ownerAiGatewayTestPresentation,
  parseOwnerAiGatewayAggregate,
  parseOwnerAiGatewayCommandRefreshed,
  type OwnerAiGatewayAdapter,
  type OwnerAiGatewayProviderView,
  type OwnerAiGatewayView,
} from './owner-ai-gateway-panel.pure';

type GatewayCommandResult = {
  ok?: boolean;
  command?: string;
  refreshed?: unknown;
};

function providerById(aggregate: OwnerAiGatewayView, id: string): OwnerAiGatewayProviderView | null {
  return aggregate.providers.find((row) => row.id === id) ?? null;
}

function adapterFor(aggregate: OwnerAiGatewayView, adapterType: string): OwnerAiGatewayAdapter | null {
  return aggregate.available_adapter_types.find((row) => row.adapter_type === adapterType) ?? null;
}

export function OwnerAiGatewayControlCenter({
  aggregate,
  busy,
  testingProviderId,
  error,
  onCommand,
}: {
  aggregate: OwnerAiGatewayView;
  busy: boolean;
  testingProviderId: string | null;
  error: string;
  onCommand: (command: string, payload: UnknownRecord) => Promise<void>;
}) {
  const overall = ownerAiGatewayStatusPresentation(aggregate.overall_status);
  const createAction = ownerAiGatewayAction(aggregate, 'create_ai_provider');
  const routingAction = ownerAiGatewayAction(aggregate, 'set_ai_provider_routing');
  const credentialAction = ownerAiGatewayAction(aggregate, 'set_ai_provider_credential');
  const enableAction = ownerAiGatewayAction(aggregate, 'enable_ai_provider');
  const disableAction = ownerAiGatewayAction(aggregate, 'disable_ai_provider');
  const testAction = ownerAiGatewayAction(aggregate, 'test_ai_provider_connection');
  const editAction = ownerAiGatewayAction(aggregate, 'update_ai_provider_configuration');

  const [routingIds, setRoutingIds] = useState(aggregate.routing.map((row) => row.provider_id));
  const [createOpen, setCreateOpen] = useState(false);
  const [credentialFor, setCredentialFor] = useState<string | null>(null);
  const [editFor, setEditFor] = useState<string | null>(null);

  useEffect(() => {
    setRoutingIds(aggregate.routing.map((row) => row.provider_id));
  }, [aggregate]);

  const addableToRouting = aggregate.providers.filter(
    (row) => row.eligible_for_routing && !routingIds.includes(row.id),
  );

  function moveRouting(index: number, direction: -1 | 1): void {
    const next = index + direction;
    if (next < 0 || next >= routingIds.length) return;
    const copy = [...routingIds];
    const current = copy[index];
    const swap = copy[next];
    if (!current || !swap) return;
    copy[index] = swap;
    copy[next] = current;
    setRoutingIds(copy);
  }

  return (
    <section className="nx-bsai-gateway">
      <header className="nx-bsai-gateway-hero">
        <div>
          <h2>AI Gateway</h2>
          <p className={`nx-bsai-gateway-status nx-bsai-gateway-status--${overall.tone}`}>
            <span aria-hidden="true">{overall.emoji}</span> Overall status: {overall.label}
          </p>
          {aggregate.overall_reason ? <p className="nx-bsai-muted">{aggregate.overall_reason}</p> : null}
        </div>
        {createAction?.enabled ? (
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={busy}
            data-action-key="create_ai_provider"
            onClick={() => setCreateOpen(true)}
          >
            + Add provider
          </button>
        ) : null}
      </header>
      {error ? <p className="nx-bsai-error">{error}</p> : null}

      <div className="nx-bsai-access-card nx-bsai-gateway-routing">
        <h3>Routing</h3>
        <p className="nx-bsai-muted">
          Primary, then Fallback 1 and Fallback 2. The server assigns positions from this order.
        </p>
        {!routingIds.length ? <p>No routing target yet.</p> : null}
        {routingIds.map((id, index) => {
          const provider = providerById(aggregate, id);
          return (
            <div key={`${id}-${index}`} className="nx-bsai-gateway-route-row">
              <strong>{ownerAiGatewayRoutingLabel(index)}</strong>
              <span>{provider?.display_name ?? 'Unknown provider'}</span>
              <div className="nx-bsai-access-actions">
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy || index === 0}
                  onClick={() => moveRouting(index, -1)}
                >
                  Up
                </button>
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy || index === routingIds.length - 1}
                  onClick={() => moveRouting(index, 1)}
                >
                  Down
                </button>
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy || routingAction?.enabled === false}
                  onClick={() => setRoutingIds(routingIds.filter((row) => row !== id))}
                >
                  Remove
                </button>
              </div>
            </div>
          );
        })}
        {routingAction?.enabled && addableToRouting.length && routingIds.length < 3 ? (
          <label className="nx-bsai-field">
            Add to routing
            <select
              disabled={busy}
              defaultValue=""
              onChange={(event) => {
                const id = event.target.value;
                if (!id || routingIds.includes(id) || routingIds.length >= 3) return;
                setRoutingIds([...routingIds, id]);
                event.target.value = '';
              }}
            >
              <option value="">Select a provider</option>
              {addableToRouting.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.display_name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {routingAction?.enabled ? (
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={busy || routingIds.length === 0}
            data-action-key="set_ai_provider_routing"
            onClick={() => void onCommand('set_ai_provider_routing', { provider_ids: routingIds })}
          >
            Save routing
          </button>
        ) : routingAction?.reason ? (
          <p className="nx-bsai-muted">{routingAction.reason}</p>
        ) : null}
      </div>

      <div className="nx-bsai-gateway-cards">
        {!aggregate.providers.length ? (
          <p className="nx-bsai-muted">No Owner-managed AI providers yet.</p>
        ) : null}
        {aggregate.providers.map((provider) => {
          const health = ownerAiGatewayStatusPresentation(provider.health_status);
          const test = ownerAiGatewayTestPresentation(
            provider.connection_test_summary,
            provider.last_test_outcome,
          );
          const adapter = adapterFor(aggregate, provider.adapter_type);
          return (
            <article key={provider.id} className="nx-bsai-access-card nx-bsai-gateway-card">
              <div className="nx-bsai-gateway-card__head">
                <div>
                  <h3>{provider.display_name}</h3>
                  <p className="nx-bsai-muted">
                    {provider.adapter_label} · {provider.role}
                  </p>
                </div>
                <p className={`nx-bsai-gateway-status nx-bsai-gateway-status--${health.tone}`}>
                  <span aria-hidden="true">{health.emoji}</span> {health.label}
                </p>
              </div>
              <p>{provider.health_reason}</p>
              <dl className="nx-bsai-gateway-meta">
                <div>
                  <dt>Pinned model</dt>
                  <dd>{provider.pinned_model || 'Not set'}</dd>
                </div>
                <div>
                  <dt>Enabled</dt>
                  <dd>{provider.enabled ? 'Enabled' : 'Disabled'}</dd>
                </div>
                <div>
                  <dt>Credential</dt>
                  <dd>
                    {provider.credential_configured ? 'Configured' : 'Not configured'}
                    {provider.credential_updated_at ? ` · ${provider.credential_updated_at}` : ''}
                  </dd>
                </div>
                {provider.base_url_display ? (
                  <div>
                    <dt>Endpoint</dt>
                    <dd>{provider.base_url_display}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>Last connection test</dt>
                  <dd>
                    {test.emoji ? <span aria-hidden="true">{test.emoji} </span> : null}
                    {testingProviderId === provider.id ? 'Testing connection…' : test.text}
                  </dd>
                </div>
              </dl>
              <div className="nx-bsai-access-actions">
                {credentialAction ? (
                  <button
                    type="button"
                    className="nx-btn nx-btn-taxes-compact"
                    disabled={busy || credentialAction.enabled === false}
                    data-action-key="set_ai_provider_credential"
                    onClick={() => setCredentialFor(provider.id)}
                  >
                    {provider.credential_configured ? 'Replace credential' : 'Set credential'}
                  </button>
                ) : null}
                {testAction && provider.credential_configured ? (
                  <button
                    type="button"
                    className="nx-btn nx-btn-taxes-compact"
                    disabled={busy || testAction.enabled === false}
                    data-action-key="test_ai_provider_connection"
                    onClick={() =>
                      void onCommand('test_ai_provider_connection', { ai_provider_id: provider.id })
                    }
                  >
                    Test connection
                  </button>
                ) : null}
                {editAction ? (
                  <button
                    type="button"
                    className="nx-btn nx-btn-taxes-compact"
                    disabled={busy || editAction.enabled === false}
                    data-action-key="update_ai_provider_configuration"
                    onClick={() => setEditFor(provider.id)}
                  >
                    Edit
                  </button>
                ) : null}
                {provider.can_enable && enableAction?.enabled ? (
                  <button
                    type="button"
                    className="nx-btn nx-btn-taxes-compact"
                    disabled={busy}
                    data-action-key="enable_ai_provider"
                    onClick={() => void onCommand('enable_ai_provider', { ai_provider_id: provider.id })}
                  >
                    Enable
                  </button>
                ) : null}
                {provider.enabled && disableAction?.enabled ? (
                  <button
                    type="button"
                    className="nx-btn nx-btn-taxes-compact"
                    disabled={busy}
                    data-action-key="disable_ai_provider"
                    onClick={() => void onCommand('disable_ai_provider', { ai_provider_id: provider.id })}
                  >
                    Disable
                  </button>
                ) : null}
              </div>
              {adapter ? null : <p className="nx-bsai-muted">Adapter required</p>}
            </article>
          );
        })}
      </div>

      {createOpen && createAction ? (
        <CreateProviderModal
          adapters={aggregate.available_adapter_types}
          busy={busy}
          onClose={() => setCreateOpen(false)}
          onSubmit={async (payload) => {
            await onCommand('create_ai_provider', payload);
            setCreateOpen(false);
          }}
        />
      ) : null}
      {credentialFor ? (
        <CredentialModal
          busy={busy}
          onClose={() => setCredentialFor(null)}
          onSubmit={async (credential) => {
            await onCommand('set_ai_provider_credential', {
              ai_provider_id: credentialFor,
              credential,
            });
            setCredentialFor(null);
          }}
        />
      ) : null}
      {editFor ? (
        <EditProviderModal
          provider={providerById(aggregate, editFor)}
          adapter={adapterFor(aggregate, providerById(aggregate, editFor)?.adapter_type ?? '')}
          busy={busy}
          onClose={() => setEditFor(null)}
          onSubmit={async (payload) => {
            await onCommand('update_ai_provider_configuration', {
              ai_provider_id: editFor,
              ...payload,
            });
            setEditFor(null);
          }}
        />
      ) : null}
    </section>
  );
}

export function CreateProviderModal({
  adapters,
  busy,
  onClose,
  onSubmit,
}: {
  adapters: OwnerAiGatewayAdapter[];
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: UnknownRecord) => Promise<void>;
}) {
  const [adapterType, setAdapterType] = useState(adapters[0]?.adapter_type ?? '');
  const [displayName, setDisplayName] = useState('');
  const [pinnedModel, setPinnedModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [localError, setLocalError] = useState('');
  const selected = adapters.find((row) => row.adapter_type === adapterType) ?? null;

  async function submit(): Promise<void> {
    setLocalError('');
    const payload: UnknownRecord = {
      adapter_type: adapterType,
      display_name: displayName.trim(),
    };
    if (pinnedModel.trim()) payload.pinned_model = pinnedModel.trim();
    if (selected?.supports_custom_base_url && baseUrl.trim()) payload.base_url = baseUrl.trim();
    try {
      await onSubmit(payload);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Request failed');
    }
  }

  return (
    <div className="nx-bsai-add-country-backdrop" role="presentation" onClick={onClose}>
      <div
        className="nx-bsai-add-country-modal"
        role="dialog"
        aria-labelledby="nx-ai-gateway-create-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="nx-ai-gateway-create-title">Add provider</h3>
        <p className="nx-bsai-muted">
          The provider starts disabled. Set a credential and test the connection before enabling.
        </p>
        <label className="nx-bsai-field">
          Adapter
          <select value={adapterType} disabled={busy} onChange={(event) => setAdapterType(event.target.value)}>
            {!adapters.length ? <option value="">Adapter required</option> : null}
            {adapters.map((row) => (
              <option key={row.adapter_type} value={row.adapter_type}>
                {row.label}
              </option>
            ))}
          </select>
        </label>
        <label className="nx-bsai-field">
          Display name
          <input value={displayName} disabled={busy} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        {selected?.requires_pinned_model !== false ? (
          <label className="nx-bsai-field">
            Pinned model
            <input value={pinnedModel} disabled={busy} onChange={(event) => setPinnedModel(event.target.value)} />
          </label>
        ) : null}
        {selected?.supports_custom_base_url ? (
          <label className="nx-bsai-field">
            Custom endpoint
            <input value={baseUrl} disabled={busy} onChange={(event) => setBaseUrl(event.target.value)} />
          </label>
        ) : null}
        {localError ? <p className="nx-bsai-error">{localError}</p> : null}
        <div className="nx-bsai-access-actions" style={{ marginTop: 16 }}>
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={busy || !adapterType}
            onClick={() => void submit()}
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

export function CredentialModal({
  busy,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  onClose: () => void;
  onSubmit: (credential: string) => Promise<void>;
}) {
  const [credential, setCredential] = useState('');
  const [localError, setLocalError] = useState('');

  async function submit(): Promise<void> {
    setLocalError('');
    const value = credential;
    setCredential('');
    try {
      await onSubmit(value);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Request failed');
    }
  }

  return (
    <div className="nx-bsai-add-country-backdrop" role="presentation" onClick={onClose}>
      <div
        className="nx-bsai-add-country-modal"
        role="dialog"
        aria-labelledby="nx-ai-gateway-credential-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="nx-ai-gateway-credential-title">Set credential</h3>
        <p className="nx-bsai-muted">Write-only. The stored secret is never shown again.</p>
        <label className="nx-bsai-field">
          API credential
          <input
            type="password"
            name="nx-ai-provider-credential"
            autoComplete="new-password"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            data-lpignore="true"
            data-1p-ignore="true"
            value={credential}
            disabled={busy}
            onChange={(event) => setCredential(event.target.value)}
          />
        </label>
        {localError ? <p className="nx-bsai-error">{localError}</p> : null}
        <div className="nx-bsai-access-actions" style={{ marginTop: 16 }}>
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={busy}
            onClick={() => {
              setCredential('');
              onClose();
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={busy || !credential.trim()}
            onClick={() => void submit()}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function EditProviderModal({
  provider,
  adapter,
  busy,
  onClose,
  onSubmit,
}: {
  provider: OwnerAiGatewayProviderView | null;
  adapter: OwnerAiGatewayAdapter | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: UnknownRecord) => Promise<void>;
}) {
  const [displayName, setDisplayName] = useState(provider?.display_name ?? '');
  const [pinnedModel, setPinnedModel] = useState(provider?.pinned_model ?? '');
  const [baseUrl, setBaseUrl] = useState('');
  const [localError, setLocalError] = useState('');
  if (!provider) return null;

  async function submit(): Promise<void> {
    setLocalError('');
    const payload: UnknownRecord = {
      display_name: displayName.trim(),
      pinned_model: pinnedModel.trim() || null,
    };
    if (adapter?.supports_custom_base_url) {
      payload.base_url = baseUrl.trim() || null;
    }
    try {
      await onSubmit(payload);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Request failed');
    }
  }

  return (
    <div className="nx-bsai-add-country-backdrop" role="presentation" onClick={onClose}>
      <div
        className="nx-bsai-add-country-modal"
        role="dialog"
        aria-labelledby="nx-ai-gateway-edit-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="nx-ai-gateway-edit-title">Edit provider</h3>
        <p className="nx-bsai-muted">
          Changing the model or endpoint requires a new connection test before the provider can be enabled. The
          server remains the source of truth.
        </p>
        <label className="nx-bsai-field">
          Display name
          <input value={displayName} disabled={busy} onChange={(event) => setDisplayName(event.target.value)} />
        </label>
        <label className="nx-bsai-field">
          Pinned model
          <input value={pinnedModel} disabled={busy} onChange={(event) => setPinnedModel(event.target.value)} />
        </label>
        {adapter?.supports_custom_base_url ? (
          <label className="nx-bsai-field">
            Custom endpoint
            <input
              value={baseUrl}
              disabled={busy}
              placeholder={provider.base_url_display ?? ''}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </label>
        ) : null}
        {localError ? <p className="nx-bsai-error">{localError}</p> : null}
        <div className="nx-bsai-access-actions" style={{ marginTop: 16 }}>
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => void submit()}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

export function OwnerAiGatewayPanel() {
  const [aggregate, setAggregate] = useState<OwnerAiGatewayView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testingProviderId, setTestingProviderId] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function loadAggregate(): Promise<void> {
    setLoading(true);
    setError('');
    try {
      const raw = await apiJson(OWNER.aiGateway);
      const parsed = parseOwnerAiGatewayAggregate(raw);
      if (!parsed) {
        setError('AI Gateway could not be loaded.');
        setAggregate(null);
        return;
      }
      setAggregate(parsed);
    } catch (caught) {
      setError(userFacingApiMessage(caught));
      setAggregate(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAggregate();
  }, []);

  async function runCommand(command: string, payload: UnknownRecord): Promise<void> {
    setBusy(true);
    setError('');
    if (command === 'test_ai_provider_connection' && typeof payload.ai_provider_id === 'string') {
      setTestingProviderId(payload.ai_provider_id);
    }
    try {
      const out = (await apiJson(OWNER.command, {
        method: 'POST',
        body: JSON.stringify({ command, payload }),
      })) as GatewayCommandResult;
      const parsed = parseOwnerAiGatewayCommandRefreshed(out.refreshed);
      if (!parsed) {
        setError('AI Gateway could not be refreshed.');
        return;
      }
      setAggregate(parsed);
    } catch (caught) {
      setError(userFacingApiMessage(caught));
      throw caught;
    } finally {
      setBusy(false);
      setTestingProviderId(null);
    }
  }

  if (loading && !aggregate) {
    return <p>Loading AI Gateway…</p>;
  }
  if (!aggregate) {
    return (
      <div>
        <p className="nx-bsai-error">{error || 'AI Gateway could not be loaded.'}</p>
        <button type="button" className="nx-btn nx-btn-taxes-compact" onClick={() => void loadAggregate()}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <OwnerAiGatewayControlCenter
      aggregate={aggregate}
      busy={busy || loading}
      testingProviderId={testingProviderId}
      error={error}
      onCommand={runCommand}
    />
  );
}
