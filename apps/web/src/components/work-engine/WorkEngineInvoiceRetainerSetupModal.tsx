import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { IncomeWorkspaceAggregate } from '../../income/income-workspace-types';
import type { WorkEngineInvoiceRetainerSetupAggregate } from '../../income/income-workspace-types';
import { executeIncomeCommand } from '../../api/income';
import { executeWorkEngineInvoiceRetainerCommand } from '../../api/work-engine';
import { mergeIncomeWorkspaceWizardPatch } from '../../income/merge-wizard-workspace-aggregate';
import { WorkEngineDocumentDetailsStep } from './WorkEngineDocumentDetailsStep';
import { WorkEngineIncomePreviewStep } from './WorkEngineIncomePreviewStep';
import {
  WorkEngineInvoiceRetainerSettingsPanel,
  retainerSettingsToForm,
  type RetainerFormState,
} from './WorkEngineInvoiceRetainerSettingsPanel';
import '../../styles/nx-branding-studio.css';
import '../../styles/nx-work-engine-queue.css';

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
  sourceDraftTemplateId: string,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    represented_client_id: aggregate.represented_client_id,
    end_customer_id: settings.end_customer_id,
    source_draft_template_id: sourceDraftTemplateId,
    frequency: form.frequency,
    advance_days: Number(form.advance_days),
    service_period_start: form.service_period_start,
    service_period_end: form.service_period_end,
    auto_advance_period: form.auto_advance_period,
    price_increase_enabled: form.price_increase_enabled,
  };
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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, [aggregate, open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose, open, submitting]);

  const draftWorkspace = aggregate?.document_draft_workspace ?? null;
  const settings = aggregate?.retainer_settings ?? null;
  const incomeCommands = draftWorkspace?.income_commands ?? {};
  const documentDetailsStep = workspaceAgg?.document_details_step ?? null;
  const activeDraftId = workspaceAgg?.active_wizard_draft_id ?? null;
  const allowed = aggregate?.allowed_actions ?? [];
  const isCreate = !settings?.profile_id;
  const canSave = isCreate
    ? allowed.includes('create_income_recurring_document_profile')
    : allowed.includes('update_income_recurring_document_profile');

  const applyAggregate = (next: WorkEngineInvoiceRetainerSetupAggregate) => {
    if (next.document_draft_workspace) {
      setWorkspaceAgg(next.document_draft_workspace.income_workspace_aggregate);
    }
    if (next.retainer_settings) {
      setRetainerForm(retainerSettingsToForm(next.retainer_settings));
      setComputedSettings(next.retainer_settings);
    }
  };

  const runRetainerCommand = async (command: string, extra: Record<string, unknown> = {}) => {
    if (!aggregate || !settings || !retainerForm || !activeDraftId) return;
    setSubmitting(true);
    onBusyChange?.(true);
    try {
      const payload = {
        ...buildRetainerCommandPayload(aggregate, settings, retainerForm, activeDraftId),
        ...extra,
      };
      const res = await executeWorkEngineInvoiceRetainerCommand(command, payload);
      applyAggregate(res.work_engine_invoice_retainer_setup_aggregate);
      onSaved(res.work_engine_invoice_retainer_setup_aggregate, res.work_engine_invoices_tab_aggregate);
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
      onBusyChange?.(false);
    }
  };

  const handleSaveDraft = async () => {
    const cmd = incomeCommands.save_draft;
    if (!cmd || !activeDraftId) return;
    setSubmitting(true);
    onBusyChange?.(true);
    try {
      const res = await executeIncomeCommand(cmd, { draft_id: activeDraftId });
      if ('income_workspace_aggregate' in res) {
        setWorkspaceAgg((prev) => mergeIncomeWorkspaceWizardPatch(prev, res.income_workspace_aggregate));
      }
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
      onBusyChange?.(false);
    }
  };

  const handleGeneratePreview = async () => {
    const cmd = incomeCommands.generate_preview;
    if (!cmd || !activeDraftId) return;
    setSubmitting(true);
    onBusyChange?.(true);
    try {
      const res = await executeIncomeCommand(cmd, { draft_id: activeDraftId });
      if ('income_workspace_aggregate' in res) {
        setWorkspaceAgg((prev) => mergeIncomeWorkspaceWizardPatch(prev, res.income_workspace_aggregate));
      }
    } catch (e) {
      onError?.(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
      onBusyChange?.(false);
    }
  };

  const handleSaveProfile = async () => {
    await runRetainerCommand(
      isCreate ? 'create_income_recurring_document_profile' : 'update_income_recurring_document_profile',
    );
  };

  if (!open || !aggregate || !settings || !retainerForm || !draftWorkspace || !computedSettings) return null;

  const interactionLocked = busy || submitting;

  const dialog = (
    <div
      className="nx-we-retainer-overlay nx-we-retainer-overlay--setup nx-income-branding-overlay nx-income-branding-overlay--studio nx-invoice-ui"
      role="dialog"
      aria-modal="true"
      aria-labelledby="we-retainer-setup-title"
      onClick={() => {
        if (!interactionLocked) onClose();
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

        <div className="nx-we-retainer-setup__body">
          <div className="nx-we-retainer-setup__main">
            {error ? <div className="nx-we-banner-error">{error}</div> : null}
            {!documentDetailsStep ? (
              <p className="nx-we-retainer-note">טוען טיוטת מסמך…</p>
            ) : (
              <>
                <WorkEngineDocumentDetailsStep
                  step={documentDetailsStep}
                  commands={incomeCommands}
                  workspaceAgg={workspaceAgg}
                  busy={interactionLocked}
                  onBusyChange={(v) => onBusyChange?.(v)}
                  onWorkspaceAgg={setWorkspaceAgg}
                  onError={setError}
                />
                {documentDetailsStep.document_preview?.visible ? (
                  <div className="nx-we-retainer-setup__preview">
                    <WorkEngineIncomePreviewStep
                      step={documentDetailsStep}
                      busy={interactionLocked}
                      onGeneratePreview={() => void handleGeneratePreview()}
                    />
                  </div>
                ) : null}
              </>
            )}
          </div>

          <WorkEngineInvoiceRetainerSettingsPanel
            aggregate={aggregate}
            settings={settings}
            form={retainerForm}
            computedSettings={computedSettings}
            busy={interactionLocked}
            allowedActions={allowed}
            onFormChange={(patch) => setRetainerForm((prev) => (prev ? { ...prev, ...patch } : prev))}
            onPause={() => void runRetainerCommand('pause_income_recurring_document_profile', { profile_id: settings.profile_id })}
            onResume={() => void runRetainerCommand('resume_income_recurring_document_profile', { profile_id: settings.profile_id })}
            onCancelProfile={() => void runRetainerCommand('cancel_income_recurring_document_profile', { profile_id: settings.profile_id })}
          />
        </div>

        <div className="nx-we-retainer-modal__footer nx-we-retainer-setup__footer">
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={interactionLocked}
            onClick={onClose}
          >
            ביטול
          </button>
          {incomeCommands.save_draft ? (
            <button
              type="button"
              className="nx-btn nx-btn-taxes-compact"
              disabled={interactionLocked || !activeDraftId}
              onClick={() => void handleSaveDraft()}
            >
              שמירת טיוטה
            </button>
          ) : null}
          <button
            type="button"
            className="nx-btn nx-btn-primary nx-btn-taxes-compact"
            disabled={interactionLocked || !canSave || !activeDraftId}
            onClick={() => void handleSaveProfile()}
          >
            שמירה
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}
