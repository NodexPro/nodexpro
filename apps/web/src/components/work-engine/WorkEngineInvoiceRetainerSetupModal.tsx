import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { IncomeWorkspaceAggregate } from '../../income/income-workspace-types';
import type { WorkEngineInvoiceRetainerSetupAggregate } from '../../income/income-workspace-types';
import { executeIncomeCommand } from '../../api/income';
import {
  executeWorkEngineInvoiceRetainerCommand,
  fetchWorkEngineInvoiceRetainerSetupAggregate,
  fetchWorkEngineInvoicesTabAggregate,
} from '../../api/work-engine';
import { mergeIncomeWorkspaceWizardPatch } from '../../income/merge-wizard-workspace-aggregate';
import type { IncomeDocumentDetailsStep } from '../../income/income-document-details-types';
import { WorkEngineDocumentDetailsStep } from './WorkEngineDocumentDetailsStep';
import { WorkEngineInvoiceRetainerNextDocumentPanel } from './WorkEngineInvoiceRetainerNextDocumentPanel';
import { WorkEngineInvoiceRetainerPreviewModal } from './WorkEngineInvoiceRetainerPreviewModal';
import {
  WorkEngineInvoiceRetainerSettingsPanel,
  retainerSettingsToForm,
  type RetainerFormState,
} from './WorkEngineInvoiceRetainerSettingsPanel';
import '../../styles/nx-branding-studio.css';
import '../../styles/nx-work-engine-queue.css';

type RetainerDocumentType = 'quote' | 'deal_invoice' | 'tax_invoice';
type SetupTabKey = 'retainer' | 'next_document';

function resolvePaymentTermsDisplay(
  documentType: RetainerDocumentType | null | undefined,
  step: IncomeDocumentDetailsStep | null | undefined,
): string | null {
  if (documentType !== 'tax_invoice' || !step) return null;
  const field = step.settings_schema.find((item) => item.key === 'payment_terms');
  if (!field?.value) return null;
  return field.options?.find((option) => option.value === field.value)?.label ?? null;
}

type Props = {
  open: boolean;
  aggregate: WorkEngineInvoiceRetainerSetupAggregate | null;
  busy: boolean;
  onBusyChange?: (busy: boolean) => void;
  onClose: () => void;
  onSaved: (aggregate: WorkEngineInvoiceRetainerSetupAggregate, invoicesTabAggregate?: Record<string, unknown>) => void;
  onError?: (message: string) => void;
};

function buildRetainerCommandPayload(
  aggregate: WorkEngineInvoiceRetainerSetupAggregate,
  settings: NonNullable<WorkEngineInvoiceRetainerSetupAggregate['retainer_settings']>,
  form: RetainerFormState,
  sourceDraftTemplateId: string | null,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    represented_client_id: aggregate.represented_client_id,
    end_customer_id: settings.end_customer_id,
    document_type: settings.document_type,
    frequency: form.frequency,
    advance_days: Number(form.advance_days),
    service_period_start: form.service_period_start,
    service_period_end: form.service_period_end,
    auto_advance_period: form.auto_advance_period,
    price_increase_enabled: form.price_increase_enabled,
  };
  if (sourceDraftTemplateId) payload.source_draft_template_id = sourceDraftTemplateId;
  if (settings.profile_id) payload.profile_id = settings.profile_id;
  if (form.price_increase_enabled) {
    payload.price_increase_type = form.price_increase_type;
    payload.price_increase_value = Number(form.price_increase_value);
  }
  return payload;
}

export function WorkEngineInvoiceRetainerSetupModal({
  open,
  aggregate,
  busy,
  onBusyChange,
  onClose,
  onSaved,
  onError,
}: Props) {
  const [workspaceAgg, setWorkspaceAgg] = useState<IncomeWorkspaceAggregate | null>(null);
  const [retainerForm, setRetainerForm] = useState<RetainerFormState | null>(null);
  const [computedSettings, setComputedSettings] = useState<
    NonNullable<WorkEngineInvoiceRetainerSetupAggregate['retainer_settings']> | null
  >(null);
  const [displayIdentity, setDisplayIdentity] = useState<
    WorkEngineInvoiceRetainerSetupAggregate['identity'] | null
  >(null);
  const [draftBusy, setDraftBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewModalOpen, setPreviewModalOpen] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [pendingDocumentType, setPendingDocumentType] = useState<RetainerDocumentType | null>(null);
  const [activeSetupTab, setActiveSetupTab] = useState<SetupTabKey>('retainer');
  const [error, setError] = useState<string | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewInFlight = useRef(false);
  const aggregateRef = useRef(aggregate);
  const workspaceAggRef = useRef(workspaceAgg);
  const pendingDocumentTypeRef = useRef(pendingDocumentType);
  const documentTypeCommandRef = useRef<Promise<void> | null>(null);
  aggregateRef.current = aggregate;
  workspaceAggRef.current = workspaceAgg;
  pendingDocumentTypeRef.current = pendingDocumentType;

  useEffect(() => {
    if (!open || !aggregate?.document_draft_workspace || !aggregate.retainer_settings) {
      setWorkspaceAgg(null);
      setRetainerForm(null);
      setComputedSettings(null);
      return;
    }
    setWorkspaceAgg(aggregate.document_draft_workspace.income_workspace_aggregate);
    setRetainerForm(retainerSettingsToForm(aggregate.retainer_settings));
    setComputedSettings(aggregate.retainer_settings);
    setDisplayIdentity(aggregate.identity);
    setActiveSetupTab(aggregate.setup_tabs?.default_tab_key ?? 'retainer');
    setPendingDocumentType(null);
    setPreviewModalOpen(false);
    setPreviewBusy(false);
  }, [aggregate?.represented_client_id, aggregate?.selected_end_customer_id, aggregate?.retainer_settings?.profile_id, open]);

  useEffect(() => {
    const confirmed = workspaceAgg?.document_details_step?.document_type_key;
    if (pendingDocumentType != null && confirmed === pendingDocumentType) {
      setPendingDocumentType(null);
    }
  }, [pendingDocumentType, workspaceAgg?.document_details_step?.document_type_key]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy || draftBusy || profileBusy) return;
      if (previewModalOpen) {
        setPreviewModalOpen(false);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, draftBusy, onClose, open, previewModalOpen, profileBusy]);

  useEffect(() => {
    return () => {
      if (previewTimer.current) clearTimeout(previewTimer.current);
    };
  }, []);

  const draftWorkspace = aggregate?.document_draft_workspace ?? null;
  const embeddedWorkspace = draftWorkspace?.income_workspace_aggregate ?? null;
  const settings = aggregate?.retainer_settings ?? null;
  const incomeCommands = draftWorkspace?.income_commands ?? {};
  const documentDetailsStep =
    embeddedWorkspace?.document_details_step ?? workspaceAgg?.document_details_step ?? null;
  const activeDraftId =
    embeddedWorkspace?.active_wizard_draft_id ?? workspaceAgg?.active_wizard_draft_id ?? null;
  const allowed = aggregate?.allowed_actions ?? [];
  const isCreate = !settings?.profile_id;
  const canSave = isCreate
    ? allowed.includes('create_income_recurring_document_profile')
    : allowed.includes('update_income_recurring_document_profile');
  const canPreview = allowed.includes('preview_income_recurring_document_profile_settings');

  const applyRetainerAggregate = useCallback((next: WorkEngineInvoiceRetainerSetupAggregate) => {
    if (next.document_draft_workspace) {
      setWorkspaceAgg(next.document_draft_workspace.income_workspace_aggregate);
    }
    if (next.retainer_settings) {
      setComputedSettings(next.retainer_settings);
    }
  }, []);

  const refreshSetupAggregate = useCallback(async () => {
    const current = aggregateRef.current;
    const endCustomerId = current?.selected_end_customer_id;
    if (!current?.represented_client_id || !endCustomerId) return;
    const refreshed = await fetchWorkEngineInvoiceRetainerSetupAggregate({
      representedClientId: current.represented_client_id,
      endCustomerId,
    });
    if (refreshed.document_draft_workspace) {
      const mergedWorkspace = refreshed.document_draft_workspace.income_workspace_aggregate;
      workspaceAggRef.current = mergedWorkspace;
      setWorkspaceAgg(mergedWorkspace);
    }
    if (refreshed.retainer_settings) {
      setRetainerForm(retainerSettingsToForm(refreshed.retainer_settings));
      setComputedSettings(refreshed.retainer_settings);
    }
    applyRetainerAggregate(refreshed);
    onSaved(refreshed);
  }, [applyRetainerAggregate, onSaved]);

  const persistDocumentType = useCallback(
    async (documentType: RetainerDocumentType): Promise<void> => {
      const cmd = incomeCommands.update_draft_settings;
      const draftId = workspaceAggRef.current?.active_wizard_draft_id ?? activeDraftId;
      if (!cmd || !draftId) throw new Error('חסרה פקודת סוג מסמך');
      const res = await executeIncomeCommand(cmd, {
        draft_id: draftId,
        setting_key: 'document_type',
        setting_value: documentType,
      });
      if ('income_workspace_aggregate' in res) {
        const merged = mergeIncomeWorkspaceWizardPatch(
          workspaceAggRef.current,
          res.income_workspace_aggregate,
        );
        workspaceAggRef.current = merged;
        setWorkspaceAgg(merged);
      }
      await refreshSetupAggregate();
    },
    [activeDraftId, incomeCommands.update_draft_settings, refreshSetupAggregate],
  );

  const runDocumentTypeChange = useCallback(
    (documentType: RetainerDocumentType) => {
      const promise = persistDocumentType(documentType)
        .catch((e) => {
          setPendingDocumentType(null);
          onError?.(e instanceof Error ? e.message : String(e));
          throw e;
        })
        .finally(() => {
          if (documentTypeCommandRef.current === promise) {
            documentTypeCommandRef.current = null;
          }
        });
      documentTypeCommandRef.current = promise;
      return promise;
    },
    [onError, persistDocumentType],
  );

  const ensureDocumentTypeSynced = useCallback(async (): Promise<void> => {
    if (documentTypeCommandRef.current) {
      await documentTypeCommandRef.current;
    }
    const pending = pendingDocumentTypeRef.current;
    if (!pending) return;
    const confirmed = workspaceAggRef.current?.document_details_step?.document_type_key;
    if (confirmed === pending) return;
    await runDocumentTypeChange(pending);
  }, [runDocumentTypeChange]);

  const runPreview = useCallback(
    async (form: RetainerFormState) => {
      const current = aggregateRef.current;
      if (!current?.retainer_settings || !activeDraftId || !canPreview) return;
      if (previewInFlight.current) return;
      previewInFlight.current = true;
      try {
        const payload = buildRetainerCommandPayload(
          current,
          current.retainer_settings,
          form,
          activeDraftId,
        );
        const res = await executeWorkEngineInvoiceRetainerCommand(
          'preview_income_recurring_document_profile_settings',
          payload,
        );
        if (res.work_engine_invoice_retainer_setup_aggregate.retainer_settings) {
          setComputedSettings(res.work_engine_invoice_retainer_setup_aggregate.retainer_settings);
        }
        if (res.work_engine_invoice_retainer_setup_aggregate.identity) {
          setDisplayIdentity(res.work_engine_invoice_retainer_setup_aggregate.identity);
        }
      } catch {
        // Preview is best-effort; form remains editable.
      } finally {
        previewInFlight.current = false;
      }
    },
    [activeDraftId, canPreview],
  );

  const handleFormChange = useCallback(
    (patch: Partial<RetainerFormState>) => {
      setRetainerForm((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...patch };
        if (previewTimer.current) clearTimeout(previewTimer.current);
        previewTimer.current = setTimeout(() => {
          void runPreview(next);
        }, 400);
        return next;
      });
    },
    [runPreview],
  );

  const handleDocumentTypeChange = useCallback(
    (documentType: RetainerDocumentType) => {
      const currentType =
        pendingDocumentType ??
        workspaceAgg?.document_details_step?.document_type_key ??
        computedSettings?.document_type;
      if (!activeDraftId || currentType === documentType) return;

      setPendingDocumentType(documentType);
      setError(null);
      void runDocumentTypeChange(documentType);
    },
    [
      activeDraftId,
      computedSettings?.document_type,
      pendingDocumentType,
      runDocumentTypeChange,
      workspaceAgg?.document_details_step?.document_type_key,
    ],
  );

  const runRetainerCommand = async (command: string, extra: Record<string, unknown> = {}) => {
    if (!aggregate || !settings || !retainerForm) return;
    setProfileBusy(true);
    onBusyChange?.(true);
    try {
      const payload = {
        ...buildRetainerCommandPayload(aggregate, settings, retainerForm, activeDraftId),
        ...extra,
      };
      const res = await executeWorkEngineInvoiceRetainerCommand(command, payload);
      if (res.work_engine_invoice_retainer_setup_aggregate.retainer_settings) {
        setRetainerForm(
          retainerSettingsToForm(res.work_engine_invoice_retainer_setup_aggregate.retainer_settings),
        );
      }
      applyRetainerAggregate(res.work_engine_invoice_retainer_setup_aggregate);
      setDisplayIdentity(res.work_engine_invoice_retainer_setup_aggregate.identity);
      onSaved(res.work_engine_invoice_retainer_setup_aggregate, res.work_engine_invoices_tab_aggregate);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setProfileBusy(false);
      onBusyChange?.(false);
    }
  };

  const handleSaveDraft = async () => {
    const cmd = incomeCommands.save_draft;
    if (!cmd || !activeDraftId) return;
    setDraftBusy(true);
    try {
      const res = await executeIncomeCommand(cmd, { draft_id: activeDraftId });
      if ('income_workspace_aggregate' in res) {
        setWorkspaceAgg((prev) => mergeIncomeWorkspaceWizardPatch(prev, res.income_workspace_aggregate));
      }
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setDraftBusy(false);
    }
  };

  const handleGeneratePreview = async () => {
    const cmd = incomeCommands.generate_preview;
    if (!cmd || !activeDraftId) return;
    setPreviewModalOpen(true);
    setPreviewBusy(true);
    setError(null);
    try {
      await ensureDocumentTypeSynced();
      const res = await executeIncomeCommand(cmd, { draft_id: activeDraftId });
      if ('income_workspace_aggregate' in res) {
        const merged = mergeIncomeWorkspaceWizardPatch(workspaceAggRef.current, res.income_workspace_aggregate);
        workspaceAggRef.current = merged;
        setWorkspaceAgg(merged);
      }
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewBusy(false);
    }
  };

  const handleBeginTemplateDraft = async () => {
    const templateDraft = aggregate?.template_draft;
    const cmd = incomeCommands.begin_wizard_draft;
    if (!templateDraft || !cmd || !settings) return;
    setDraftBusy(true);
    setError(null);
    try {
      const res = await executeIncomeCommand(cmd, {
        document_type: templateDraft.begin_document_type,
        income_customer_id: templateDraft.begin_income_customer_id,
        wizard_context: 'retainer_template',
      });
      if ('income_workspace_aggregate' in res) {
        const merged = mergeIncomeWorkspaceWizardPatch(workspaceAggRef.current, res.income_workspace_aggregate);
        workspaceAggRef.current = merged;
        setWorkspaceAgg(merged);
      }
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setDraftBusy(false);
    }
  };

  const handleIssueDocument = async () => {
    const cmd = incomeCommands.issue_document;
    if (!cmd || !activeDraftId || !aggregate || !settings) return;
    setDraftBusy(true);
    onBusyChange?.(true);
    setError(null);
    try {
      await executeIncomeCommand(cmd, { draft_id: activeDraftId });
      const refreshed = await fetchWorkEngineInvoiceRetainerSetupAggregate({
        representedClientId: aggregate.represented_client_id,
        endCustomerId: settings.end_customer_id,
      });
      const invoicesTab = await fetchWorkEngineInvoicesTabAggregate();
      applyRetainerAggregate(refreshed);
      if (refreshed.retainer_settings) {
        setRetainerForm(retainerSettingsToForm(refreshed.retainer_settings));
        setComputedSettings(refreshed.retainer_settings);
      }
      setDisplayIdentity(refreshed.identity);
      onSaved(refreshed, invoicesTab);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setDraftBusy(false);
      onBusyChange?.(false);
    }
  };

  const handleSaveProfile = async () => {
    const prompt = aggregate?.save_profile_without_template_prompt;
    if (!activeDraftId && prompt) {
      const createDraft = window.confirm(
        `${prompt.message}\n\n${prompt.confirm_label}\n${prompt.cancel_label}`,
      );
      if (createDraft) {
        await handleBeginTemplateDraft();
        return;
      }
    }
    await runRetainerCommand(
      isCreate ? 'create_income_recurring_document_profile' : 'update_income_recurring_document_profile',
    );
  };

  if (!open || !aggregate || !settings || !retainerForm || !computedSettings) return null;

  const footerLocked = busy || draftBusy || profileBusy || previewBusy;
  const sidebarLocked = profileBusy;
  const showTemplateDraftPrompt = Boolean(aggregate.template_draft && !activeDraftId);
  const issueAction = aggregate.issue_document_action;
  const confirmedDocumentType =
    (embeddedWorkspace?.document_details_step?.document_type_key as
      | 'quote'
      | 'deal_invoice'
      | 'tax_invoice'
      | null
      | undefined) ??
    (workspaceAgg?.document_details_step?.document_type_key as
      | 'quote'
      | 'deal_invoice'
      | 'tax_invoice'
      | null
      | undefined) ??
    computedSettings.document_type;
  const selectedDocumentType = pendingDocumentType ?? confirmedDocumentType;
  const setupTabs = aggregate.setup_tabs?.tabs ?? [
    { key: 'retainer' as const, label: 'ריטיינר', enabled: true, disabled_reason: null },
    {
      key: 'next_document' as const,
      label: 'המסמך הבא',
      enabled: false,
      disabled_reason: aggregate.next_document_preview?.unavailable_message ?? null,
    },
  ];
  const nextDocumentPreview = aggregate.next_document_preview;
  const isRetainerTab = activeSetupTab === 'retainer';
  const isNextDocumentTab = activeSetupTab === 'next_document';
  const paymentTermsDisplay = resolvePaymentTermsDisplay(
    selectedDocumentType,
    isNextDocumentTab ? nextDocumentPreview?.document_details_step ?? null : documentDetailsStep,
  );

  const dialog = (
    <div
      className="nx-we-retainer-overlay nx-we-retainer-overlay--setup nx-income-branding-overlay nx-income-branding-overlay--studio nx-invoice-ui"
      role="dialog"
      aria-modal="true"
      aria-labelledby="we-retainer-setup-title"
      onClick={() => {
        if (!footerLocked) onClose();
      }}
    >
      <div
        className="nx-we-retainer-modal nx-we-retainer-modal--setup nx-income-branding-modal nx-income-branding-modal--studio"
        dir="rtl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="nx-income-branding-modal__head">
          <div className="nx-income-branding-modal__head-brand">
            <span className="nx-income-branding-modal__head-icon" aria-hidden>
              <span className="nx-income-branding-modal__head-icon-glyph">ר</span>
            </span>
            <div className="nx-income-branding-modal__head-text">
              <h2 id="we-retainer-setup-title" className="nx-income-branding-modal__title nx-modal-title">
                ריטיינר חשבוניות
              </h2>
              <p className="nx-income-branding-modal__subtitle">הגדרת מסמך חוזר ללקוח</p>
            </div>
          </div>
          <div className="nx-income-branding-modal__head-actions">
            <button
              type="button"
              className="nx-income-branding-modal__close"
              aria-label="סגירה"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>

        <nav className="nx-we-retainer-setup__tabs" aria-label="ריטיינר">
          {setupTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              className={`nx-we-retainer-setup__tab${
                activeSetupTab === tab.key ? ' nx-we-retainer-setup__tab--active' : ''
              }`}
              disabled={footerLocked || !tab.enabled}
              title={tab.disabled_reason ?? undefined}
              aria-current={activeSetupTab === tab.key ? 'page' : undefined}
              onClick={() => setActiveSetupTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="nx-we-retainer-setup__body">
          <div className="nx-we-retainer-setup__main nx-we-retainer-scroll">
            {error ? <div className="nx-we-banner-error">{error}</div> : null}
            {isNextDocumentTab && nextDocumentPreview ? (
              <WorkEngineInvoiceRetainerNextDocumentPanel
                preview={nextDocumentPreview}
                busy={draftBusy}
                onBusyChange={setDraftBusy}
                onError={setError}
              />
            ) : isRetainerTab ? (
              showTemplateDraftPrompt && aggregate.template_draft ? (
              <div className="nx-we-retainer-template-prompt">
                <p className="nx-we-retainer-template-prompt__message">{aggregate.template_draft.prompt_message}</p>
                <div className="nx-we-retainer-template-prompt__actions">
                  <button
                    type="button"
                    className="nx-btn nx-btn-primary nx-btn-taxes-compact"
                    disabled={footerLocked}
                    onClick={() => void handleBeginTemplateDraft()}
                  >
                    {aggregate.template_draft.confirm_begin_label}
                  </button>
                  <button
                    type="button"
                    className="nx-btn nx-btn-taxes-compact"
                    disabled={footerLocked}
                    onClick={onClose}
                  >
                    {aggregate.template_draft.cancel_label}
                  </button>
                </div>
              </div>
            ) : !documentDetailsStep ? (
              aggregate.template_draft || aggregate.save_profile_without_template_prompt ? (
                <div className="nx-we-retainer-template-prompt">
                  <p className="nx-we-retainer-template-prompt__message">
                    {aggregate.template_draft?.prompt_message ?? 'אין טיוטת מסמך פעילה.'}
                  </p>
                  {aggregate.template_draft ? (
                    <div className="nx-we-retainer-template-prompt__actions">
                      <button
                        type="button"
                        className="nx-btn nx-btn-primary nx-btn-taxes-compact"
                        disabled={footerLocked}
                        onClick={() => void handleBeginTemplateDraft()}
                      >
                        {aggregate.template_draft.confirm_begin_label}
                      </button>
                      <button
                        type="button"
                        className="nx-btn nx-btn-taxes-compact"
                        disabled={footerLocked}
                        onClick={onClose}
                      >
                        {aggregate.template_draft.cancel_label}
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : activeDraftId ? (
                <p className="nx-we-retainer-note">טוען פרטי מסמך…</p>
              ) : (
                <p className="nx-we-retainer-note">טוען טיוטת מסמך…</p>
              )
            ) : (
              <WorkEngineDocumentDetailsStep
                step={documentDetailsStep}
                commands={incomeCommands}
                workspaceAgg={workspaceAgg}
                busy={draftBusy}
                hideHeader
                onBusyChange={setDraftBusy}
                onWorkspaceAgg={setWorkspaceAgg}
                onError={setError}
              />
            )
            ) : null}
          </div>

          <WorkEngineInvoiceRetainerSettingsPanel
            aggregate={aggregate}
            identity={displayIdentity}
            form={retainerForm}
            computedSettings={computedSettings}
            selectedDocumentType={selectedDocumentType}
            paymentTermsDisplay={paymentTermsDisplay}
            busy={sidebarLocked}
            readOnly={isNextDocumentTab}
            allowedActions={allowed}
            onFormChange={handleFormChange}
            onDocumentTypeChange={(documentType) => void handleDocumentTypeChange(documentType)}
            onPause={() => void runRetainerCommand('pause_income_recurring_document_profile', { profile_id: settings.profile_id })}
            onResume={() => void runRetainerCommand('resume_income_recurring_document_profile', { profile_id: settings.profile_id })}
            onCancelProfile={() => void runRetainerCommand('cancel_income_recurring_document_profile', { profile_id: settings.profile_id })}
          />
        </div>

        <div className="nx-we-retainer-modal__footer nx-we-retainer-setup__footer">
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={footerLocked}
            onClick={onClose}
          >
            ביטול
          </button>
          {isNextDocumentTab ? null : (
            <>
          {incomeCommands.save_draft ? (
            <button
              type="button"
              className="nx-btn nx-btn-taxes-compact"
              disabled={footerLocked || !activeDraftId}
              onClick={() => void handleSaveDraft()}
            >
              שמירת טיוטה
            </button>
          ) : null}
          {incomeCommands.generate_preview ? (
            <button
              type="button"
              className="nx-btn nx-btn-taxes-compact"
              disabled={footerLocked || !activeDraftId}
              onClick={() => void handleGeneratePreview()}
            >
              תצוגה מקדימה
            </button>
          ) : null}
          {issueAction?.visible ? (
            <button
              type="button"
              className="nx-btn nx-btn-primary nx-btn-taxes-compact"
              disabled={footerLocked || Boolean(issueAction.disabled_reason) || !activeDraftId}
              title={issueAction.disabled_reason ?? undefined}
              onClick={() => void handleIssueDocument()}
            >
              {issueAction.label}
            </button>
          ) : null}
          <button
            type="button"
            className="nx-btn nx-btn-primary nx-btn-taxes-compact"
            disabled={footerLocked || !canSave}
            onClick={() => void handleSaveProfile()}
          >
            שמירה
          </button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {createPortal(dialog, document.body)}
      <WorkEngineInvoiceRetainerPreviewModal
        open={previewModalOpen}
        preview={documentDetailsStep?.document_preview}
        busy={previewBusy}
        onClose={() => setPreviewModalOpen(false)}
      />
    </>
  );
}
