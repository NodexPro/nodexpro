import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiJson, ApiError, userFacingApiMessage } from '../api/client';
import { OWNER } from '../api/endpoints';
import { useAuth } from '../contexts/AuthContext';
import type { AggregateAction, CommandModalState } from './owner-legal-control-panel-actions';
import { CommandActionModal, isPayloadFieldSchema, normalizeActions } from './owner-legal-control-panel-actions';
import {
  ownerLegalControlCountryQueryParams,
  type OwnerCommandResponse,
  type UnknownRecord,
} from './owner-legal-control-types';
import { OwnerTaxKnowledgePanel, parseTaxKnowledgeAggregate } from './owner-tax-knowledge-panel';
import { OwnerStrategyEnginePanel, parseStrategyEngineAggregate } from './owner-strategy-engine-panel';
import { OwnerLegalControlRenderBoundary, ownerLegalControlWarningTexts } from './owner-legal-control-render-safety';
import {
  BUSINESS_SETUP_AI_OWNER_NAV,
  businessSetupAiOwnerSectionFromHash,
  parseOwnerWorkspaceNavigation,
  type BusinessSetupAiOwnerSectionId,
} from './owner-business-setup-ai-nav';
import { OwnerAccessExpertsPanel, OwnerLegalAccessRequestForm } from './owner-access-experts-panel';
import { OwnerBusinessSetupAiWorkspace } from './owner-business-setup-ai-workspace';
import { OwnerLegalValuesPanel } from './owner-legal-values-panel';
import { OwnerCountryContextPanel } from './owner-country-context-panel';
import { OwnerFactDictionaryPanel, parseFactDictionaryAggregate } from './owner-fact-dictionary-panel';
import { OwnerAddCountryControl } from './owner-add-country-control';
import { mergeOwnerCountrySelectorOptions } from './owner-iso-country-options';

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

function safeText(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

export function PlatformOwnerLegalControl() {
  const auth = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [accessDeniedReason, setAccessDeniedReason] = useState('');
  const [accessRequestSubmitted, setAccessRequestSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [panel, setPanel] = useState(null as UnknownRecord | null);
  const [taxKnowledgeCountryQuery, setTaxKnowledgeCountryQuery] = useState('');
  const [pendingTaxKnowledgeCountry, setPendingTaxKnowledgeCountry] = useState(null as string | null);
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandModal, setCommandModal] = useState(null as CommandModalState | null);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<BusinessSetupAiOwnerSectionId>(() =>
    typeof window === 'undefined' ? 'tax-knowledge' : businessSetupAiOwnerSectionFromHash(window.location.hash),
  );

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
      const qs = new URLSearchParams();
      const countryParams = ownerLegalControlCountryQueryParams(taxKnowledgeCountryQuery);
      if (countryParams) {
        qs.set('tax_knowledge_country_code', countryParams.tax_knowledge_country_code);
        qs.set('strategy_engine_country_code', countryParams.strategy_engine_country_code);
      }

      const path = qs.toString() ? `${OWNER.legalControl}?${qs.toString()}` : OWNER.legalControl;
      const p = (await apiJson(path)) as UnknownRecord;
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
  }, [auth.status, taxKnowledgeCountryQuery]);

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
      return out;
    } catch (e) {
      setError(userFacingApiMessage(e));
      throw e;
    } finally {
      setCommandBusy(false);
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
    [panel],
  );
  const legalValues = useMemo(() => (panel?.legal_values as UnknownRecord | undefined) ?? null, [panel]);
  const countryPackActions = useMemo(
    () => normalizeActions(panel?.available_actions ? (panel.available_actions as UnknownRecord).country_pack_admin : []),
    [panel],
  );
  const legalActions = useMemo(
    () => normalizeActions(panel?.available_actions ? (panel.available_actions as UnknownRecord).legal_values : []),
    [panel],
  );
  const panelWarningsCombined = useMemo(() => ownerLegalControlWarningTexts(panel), [panel]);
  const taxKnowledge = useMemo(() => parseTaxKnowledgeAggregate(panel?.tax_knowledge), [panel]);
  const strategyEngine = useMemo(() => parseStrategyEngineAggregate(panel?.strategy_engine), [panel]);
  const factDictionary = useMemo(() => parseFactDictionaryAggregate(panel?.fact_dictionary), [panel]);

  useEffect(() => {
    if (loading) return;
    setPendingTaxKnowledgeCountry(null);
    const selected = taxKnowledge.selected_country_code ?? '';
    if (selected && selected !== taxKnowledgeCountryQuery) {
      setTaxKnowledgeCountryQuery(selected);
    }
  }, [loading, panel, taxKnowledge.selected_country_code, taxKnowledgeCountryQuery]);

  const countryPackTables = useMemo(() => {
    const tables = (countryPacksAdmin?.tables ?? {}) as UnknownRecord;
    return {
      countries: Array.isArray(tables.countries) ? (tables.countries as UnknownRecord[]) : [],
      packs: Array.isArray(tables.country_packs) ? (tables.country_packs as UnknownRecord[]) : [],
      rulesets: Array.isArray(tables.rulesets) ? (tables.rulesets as UnknownRecord[]) : [],
    };
  }, [countryPacksAdmin]);

  const legalRows = useMemo(() => {
    const tax = panel?.legal_tax_values as UnknownRecord | undefined;
    if (tax && Array.isArray(tax.table)) return tax.table as UnknownRecord[];
    const table = legalValues?.table;
    const rows = Array.isArray(table) ? (table as UnknownRecord[]) : [];
    return rows.filter((r) => String(r.category ?? '') !== 'Operational Communication Policies');
  }, [legalValues, panel]);

  const emptyRulesetCreateActions = useMemo(() => {
    if (countryPackTables.rulesets.length > 0) return [];
    return countryPackActions.filter((a) => {
      const k = String(a.action_key ?? '');
      return k.includes('create') && k.includes('ruleset');
    });
  }, [countryPackActions, countryPackTables.rulesets.length]);

  const countryOptions = useMemo(
    () =>
      mergeOwnerCountrySelectorOptions(
        taxKnowledge.countries.map((row) => ({
          code: row.code.trim(),
          name: row.name.trim() || row.code.trim(),
        })),
        countryPackTables.countries.map((row) => ({
          code: safeText(row.code),
          name: safeText(row.name) || safeText(row.code),
        })),
      ),
    [taxKnowledge.countries, countryPackTables.countries],
  );

  const createCountryAction = useMemo(
    () => countryPackActions.find((a) => String(a.action_key ?? '') === 'create_country') ?? null,
    [countryPackActions],
  );
  const navGroups = useMemo(
    () => parseOwnerWorkspaceNavigation(panel?.owner_workspace_navigation) ?? BUSINESS_SETUP_AI_OWNER_NAV,
    [panel],
  );
  const canShowAccessExperts = navGroups.some((group) => group.items.some((item) => item.id === 'access-experts'));

  const selectedCountryCode = pendingTaxKnowledgeCountry ?? taxKnowledgeCountryQuery;

  function normalizeCreateRulesetModal(
    command: string,
    meta: AggregateAction,
    prefilled: UnknownRecord,
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

  function selectSection(id: BusinessSetupAiOwnerSectionId): void {
    setActiveSection(id);
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `#${id}`);
    }
  }

  if (auth.status === 'loading' || loading) {
    return <div style={{ padding: 24 }}>Loading owner panel...</div>;
  }

  if (accessDenied) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Access denied</h1>
        <p>This page is available only for platform owner or assigned country legal maintainers.</p>
        {accessDeniedReason ? (
          <p style={{ color: '#a94442', marginTop: 10 }}>
            {accessDeniedReason}
          </p>
        ) : null}
        {auth.status === 'authenticated' && accessRequestSubmitted ? (
          <p>Request submitted. No access is granted until Platform Owner approval.</p>
        ) : null}
        {auth.status === 'authenticated' && !accessRequestSubmitted ? (
          <OwnerLegalAccessRequestForm
            busy={commandBusy}
            onSubmit={async (payload) => {
              await sendOwnerCommand('request_country_legal_access', payload);
              setAccessRequestSubmitted(true);
            }}
          />
        ) : null}
      </div>
    );
  }

  if (error && !panel) {
    return (
      <div style={{ padding: 24, maxWidth: 720 }}>
        <h1>Owner Legal Control Panel</h1>
        <p>Legal Control could not be loaded from the server. Legal data was not replaced with empty defaults.</p>
        <p style={{ color: '#a94442', marginTop: 10 }}>{error}</p>
        <button
          type="button"
          className="nx-btn nx-btn-taxes-compact"
          style={{ marginTop: 12 }}
          onClick={() => {
            void loadCore();
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <OwnerLegalControlRenderBoundary>
      <OwnerBusinessSetupAiWorkspace
        activeSection={canShowAccessExperts ? activeSection : activeSection === 'access-experts' ? 'tax-knowledge' : activeSection}
        onSelectSection={selectSection}
        countryCode={selectedCountryCode}
        countries={countryOptions}
        countryBusy={commandBusy}
        onSelectCountry={(countryCode) => {
          setPendingTaxKnowledgeCountry(countryCode);
          setTaxKnowledgeCountryQuery(countryCode);
        }}
        navGroups={navGroups}
        addCountryControl={
          <OwnerAddCountryControl
            action={createCountryAction}
            existingCountryCodes={countryOptions.map((row) => row.code)}
            busy={commandBusy}
            onSubmit={async (command, payload) => {
              await sendOwnerCommand(command, payload);
            }}
          />
        }
        countryWorkspace={
          <details className="nx-bsai-country-workspace">
            <summary>Country workspace</summary>
            <OwnerCountryContextPanel
              countries={countryPackTables.countries}
              packs={countryPackTables.packs}
              rulesets={countryPackTables.rulesets}
              countryPackActions={countryPackActions}
              emptyRulesetCreateActions={emptyRulesetCreateActions}
              busy={commandBusy}
              selectedCountryCode={selectedCountryCode}
              onOpenCommand={openCommandModal}
              onToggleCountryPack={(row) => void toggleCountryPack(row)}
            />
          </details>
        }
        warningCount={panelWarningsCombined.length}
        warningsOpen={warningsOpen}
        onToggleWarnings={() => setWarningsOpen((open) => !open)}
        warnings={panelWarningsCombined}
        error={error}
      >
        {activeSection === 'tax-knowledge' ? (
          <OwnerTaxKnowledgePanel
            taxKnowledge={taxKnowledge}
            countryPacks={panel?.country_packs}
            rulesets={panel?.rulesets}
            legalValues={panel?.legal_values}
            pendingCountryCode={pendingTaxKnowledgeCountry}
            busy={commandBusy}
            showCountryPicker={false}
            onSelectCountry={(countryCode) => {
              setPendingTaxKnowledgeCountry(countryCode);
              setTaxKnowledgeCountryQuery(countryCode);
            }}
            onCommand={async (command, payload) => {
              await sendOwnerCommand(command, payload);
            }}
          />
        ) : null}

        {activeSection === 'legal-values' ? (
          <OwnerLegalValuesPanel
            rows={legalRows}
            actions={legalActions}
            busy={commandBusy}
            onOpenCommand={openCommandModal}
          />
        ) : null}

        {activeSection === 'fact-dictionary' ? (
          <OwnerFactDictionaryPanel
            factDictionary={factDictionary}
            busy={commandBusy}
            onOpenCommand={openCommandModal}
          />
        ) : null}

        {activeSection === 'strategy-engine' ? (
          <OwnerStrategyEnginePanel
            strategyEngine={strategyEngine}
            taxKnowledge={taxKnowledge}
            busy={commandBusy}
            onCommand={async (command, payload) => {
              await sendOwnerCommand(command, payload);
            }}
          />
        ) : null}

        {activeSection === 'access-experts' && canShowAccessExperts ? (
          <OwnerAccessExpertsPanel
            access={panel?.country_legal_access}
            countries={countryOptions}
            busy={commandBusy}
            onCommand={async (command, payload) => {
              await sendOwnerCommand(command, payload);
            }}
          />
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
      </OwnerBusinessSetupAiWorkspace>
    </OwnerLegalControlRenderBoundary>
  );
}
