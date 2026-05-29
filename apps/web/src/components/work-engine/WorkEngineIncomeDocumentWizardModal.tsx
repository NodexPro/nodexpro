import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  IncomeAvailableDocumentType,
  IncomeWorkspaceAggregate,
  IncomeWorkspaceContextAggregate,
  SelectIncomeIssuerContextCommandResponse,
} from '../../api/income';
import {
  WorkEngineRecipientSearchField,
  type WorkEngineRecipientSearchFieldHandle,
} from './WorkEngineRecipientSearchField';
import { WorkEngineDocumentDetailsStep } from './WorkEngineDocumentDetailsStep';
import { WorkEngineIncomePreviewStep } from './WorkEngineIncomePreviewStep';
import { executeIncomeCommand } from '../../api/income';
import { mergeIncomeWorkspaceWizardPatch } from '../../income/merge-wizard-workspace-aggregate';
import type { WorkEngineInvoicesDocumentCreationEntrypoint } from '../../api/work-engine';
import '../../styles/nx-modal.css';

type FormState = {
  document_type: string;
};

function recipientFieldsForBegin(
  workspaceAgg: IncomeWorkspaceAggregate | null,
): Record<string, unknown> {
  const selected = workspaceAgg?.recipient_search?.selected ?? null;
  if (!selected) return {};
  if (selected.kind === 'saved') {
    return { income_customer_id: selected.income_customer_id };
  }
  return { one_time_customer_snapshot_json: selected.snapshot };
}

function settingValue(step: IncomeWorkspaceAggregate['document_details_step'], key: string): string | null {
  const field = step?.settings_schema.find((f) => f.key === key);
  return field?.value ?? null;
}

type Props = {
  open: boolean;
  busy: boolean;
  entrypoint: WorkEngineInvoicesDocumentCreationEntrypoint;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onCompleted: () => void;
  initialWorkspaceAgg?: IncomeWorkspaceAggregate | null;
};

function stepIndexForKey(steps: { key: string }[], key: string | null | undefined): number | null {
  if (!key) return null;
  const idx = steps.findIndex((s) => s.key === key);
  return idx >= 0 ? idx : null;
}

export function WorkEngineIncomeDocumentWizardModal({
  open,
  busy,
  entrypoint,
  onClose,
  onBusyChange,
  onCompleted,
  initialWorkspaceAgg,
}: Props) {
  const wizard = entrypoint.wizard;
  const [stepIndex, setStepIndex] = useState(0);
  const [issuerChoice, setIssuerChoice] = useState<'self' | 'office_client' | null>(null);
  const [officeClientId, setOfficeClientId] = useState('');
  const [, setContextAgg] = useState<IncomeWorkspaceContextAggregate | null>(null);
  const [workspaceAgg, setWorkspaceAgg] = useState<IncomeWorkspaceAggregate | null>(
    initialWorkspaceAgg ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [recipientPending, setRecipientPending] = useState(false);
  const recipientFieldRef = useRef<WorkEngineRecipientSearchFieldHandle>(null);
  const [form, setForm] = useState<FormState>(() => ({
    document_type: '',
  }));

  const documentTypes: IncomeAvailableDocumentType[] =
    workspaceAgg?.available_document_types ?? [];

  const visibleSteps = useMemo(() => {
    return wizard.steps.filter((s) => {
      if (s.when === 'office_representative') return issuerChoice === 'office_client';
      return true;
    });
  }, [wizard.steps, issuerChoice]);

  useEffect(() => {
    const startingStepKey = workspaceAgg?.wizard_starting_step_key ?? null;
    const idx = stepIndexForKey(visibleSteps, startingStepKey);
    if (idx != null) setStepIndex(idx);
  }, [visibleSteps, workspaceAgg?.wizard_starting_step_key]);

  useEffect(() => {
    const docTypeFromDraft = (workspaceAgg as any)?.document_details_step?.document_type_key ?? null;
    if (docTypeFromDraft && form.document_type !== docTypeFromDraft) {
      setForm((f) => ({ ...f, document_type: String(docTypeFromDraft) }));
    }
  }, [workspaceAgg, form.document_type]);

  const activeStepKey = visibleSteps[Math.min(stepIndex, visibleSteps.length - 1)]?.key ?? '';
  const isLastStep = stepIndex >= visibleSteps.length - 1;

  const selectedOfficeClient =
    wizard.office_client_issuer_options.find((o) => o.represented_client_id === officeClientId) ??
    null;

  const documentDetailsStep = workspaceAgg?.document_details_step ?? null;
  const activeDraftId = workspaceAgg?.active_wizard_draft_id ?? null;
  const footerLocked = busy || recipientPending;

  const runSelectIssuer = useCallback(async () => {
    const cmds = wizard.income_commands;
    if (issuerChoice === 'self') {
      const opt = wizard.issuer_choice.options.find((o) => o.key === 'self');
      if (!opt?.issuer_business_id) throw new Error('Missing self issuer');
      const res = (await executeIncomeCommand(cmds.select_issuer, {
        acting_mode: 'self',
        issuer_business_id: opt.issuer_business_id,
        represented_client_id: null,
      })) as SelectIncomeIssuerContextCommandResponse;
      setContextAgg(res.income_workspace_context_aggregate);
      setWorkspaceAgg(res.income_workspace_aggregate);
      return;
    }
    if (!selectedOfficeClient) throw new Error('Select office client');
    const res = (await executeIncomeCommand(cmds.select_issuer, {
      acting_mode: 'office_representative',
      issuer_business_id: selectedOfficeClient.issuer_business_id,
      represented_client_id: selectedOfficeClient.represented_client_id,
    })) as SelectIncomeIssuerContextCommandResponse;
    setContextAgg(res.income_workspace_context_aggregate);
    setWorkspaceAgg(res.income_workspace_aggregate);
  }, [issuerChoice, selectedOfficeClient, wizard]);

  const beginWizardDraft = useCallback(
    async (ws: IncomeWorkspaceAggregate) => {
      const cmds = wizard.income_commands;
      const res = await executeIncomeCommand(cmds.begin_wizard_draft, {
        document_type: form.document_type,
        ...recipientFieldsForBegin(ws),
      });
      if ('income_workspace_aggregate' in res) {
        setWorkspaceAgg(res.income_workspace_aggregate);
      }
    },
    [form.document_type, wizard.income_commands],
  );

  const handleNext = async () => {
    setError(null);
    if (activeStepKey === 'issuer_choice') {
      if (!issuerChoice) {
        setError('בחר מנפיק');
        return;
      }
      if (issuerChoice === 'office_client') {
        setStepIndex((i) => i + 1);
        return;
      }
      onBusyChange(true);
      try {
        await runSelectIssuer();
        setStepIndex((i) => i + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'שגיאה');
      } finally {
        onBusyChange(false);
      }
      return;
    }
    if (activeStepKey === 'office_client') {
      if (!officeClientId) {
        setError('בחר לקוח מהמשרד');
        return;
      }
      onBusyChange(true);
      try {
        await runSelectIssuer();
        setStepIndex((i) => i + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'שגיאה');
      } finally {
        onBusyChange(false);
      }
      return;
    }
    if (activeStepKey === 'document_type') {
      if (!form.document_type) {
        setError('בחר סוג מסמך');
        return;
      }
      setStepIndex((i) => i + 1);
      return;
    }
    if (activeStepKey === 'recipient') {
      if (recipientPending) return;
      const alreadySelected = workspaceAgg?.recipient_search?.selected;
      onBusyChange(true);
      try {
        const refreshed = alreadySelected
          ? workspaceAgg
          : await recipientFieldRef.current?.commitPendingCreate();
        const truth = refreshed ?? workspaceAgg;
        if (refreshed && refreshed !== workspaceAgg) {
          setWorkspaceAgg(refreshed);
        }
        if (!truth?.recipient_search?.selected) {
          setError('בחר מקבל למסמך');
          return;
        }
        if (!form.document_type) {
          setError('בחר סוג מסמך');
          return;
        }
        await beginWizardDraft(truth);
        setStepIndex((i) => i + 1);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'שגיאה');
      } finally {
        onBusyChange(false);
      }
      return;
    }
    if (activeStepKey === 'document_details') {
      const nextKey = visibleSteps[stepIndex + 1]?.key;
      if (nextKey === 'preview' && !documentDetailsStep?.document_preview?.visible) {
        await handleGeneratePreview(true);
        return;
      }
      setStepIndex((i) => i + 1);
      return;
    }
    if (activeStepKey === 'preview') {
      setStepIndex((i) => i + 1);
      return;
    }
    if (activeStepKey === 'issue') return;
    setStepIndex((i) => i + 1);
  };

  const handleBack = () => setStepIndex((i) => Math.max(0, i - 1));

  const handleSaveAndIssue = async () => {
    setError(null);
    onBusyChange(true);
    try {
      const cmds = wizard.income_commands;
      const draftId = activeDraftId;
      if (!draftId) throw new Error('טיוטה לא נמצאה');
      const document_date = settingValue(documentDetailsStep, 'document_date');
      await executeIncomeCommand(cmds.issue_document, {
        draft_id: draftId,
        document_date: document_date?.trim() || null,
      });
      onCompleted();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בהפקה');
    } finally {
      onBusyChange(false);
    }
  };

  const handleSaveDraft = async () => {
    setError(null);
    const cmds = wizard.income_commands;
    const draftId = activeDraftId;
    if (!draftId) {
      setError('טיוטה לא נמצאה');
      return;
    }
    onBusyChange(true);
    try {
      const res = await executeIncomeCommand(cmds.save_draft, { draft_id: draftId });
      if ('income_workspace_aggregate' in res) {
        setWorkspaceAgg(res.income_workspace_aggregate);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בשמירה');
    } finally {
      onBusyChange(false);
    }
  };

  const previewStepIndex = useMemo(
    () => visibleSteps.findIndex((s) => s.key === 'preview'),
    [visibleSteps],
  );

  const handleBrandingCommand = async (command: string, body: Record<string, unknown>) => {
    setError(null);
    onBusyChange(true);
    try {
      const res = await executeIncomeCommand(command, body);
      if ('income_workspace_aggregate' in res) {
        setWorkspaceAgg((prev) => mergeIncomeWorkspaceWizardPatch(prev, res.income_workspace_aggregate));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה בעדכון מיתוג');
    } finally {
      onBusyChange(false);
    }
  };

  const handleGeneratePreview = async (advanceToPreview = false) => {
    setError(null);
    const cmds = wizard.income_commands;
    const draftId = activeDraftId;
    if (!draftId) {
      setError('טיוטה לא נמצאה');
      return;
    }
    onBusyChange(true);
    try {
      const res = await executeIncomeCommand(cmds.generate_preview, { draft_id: draftId });
      if ('income_workspace_aggregate' in res) {
        setWorkspaceAgg(res.income_workspace_aggregate);
        if (advanceToPreview && previewStepIndex >= 0) {
          setStepIndex(previewStepIndex);
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'שגיאה ביצירת תצוגה');
    } finally {
      onBusyChange(false);
    }
  };

  if (!open) return null;

  const renderBody = () => {
    if (activeStepKey === 'issuer_choice') {
      return (
        <div className="nx-we-wizard-issuer-grid" dir="rtl">
          {wizard.issuer_choice.options.map((opt) => (
            <button
              key={opt.key}
              type="button"
              className={`nx-we-wizard-issuer-btn ${issuerChoice === opt.key ? 'nx-we-wizard-issuer-btn--selected' : ''}`}
              disabled={!opt.enabled || busy}
              title={opt.disabled_reason ?? undefined}
              onClick={() => setIssuerChoice(opt.key as 'self' | 'office_client')}
            >
              {opt.label}
            </button>
          ))}
        </div>
      );
    }
    if (activeStepKey === 'office_client') {
      return (
        <div className="nx-income-field">
          <label>{wizard.issuer_choice.title}</label>
          <select
            value={officeClientId}
            disabled={busy}
            onChange={(e) => setOfficeClientId(e.target.value)}
          >
            <option value="">בחר לקוח</option>
            {wizard.office_client_issuer_options.map((c) => (
              <option key={c.represented_client_id} value={c.represented_client_id} disabled={!c.enabled}>
                {c.label}
                {c.tax_id ? ` · ${c.tax_id}` : ''}
              </option>
            ))}
          </select>
          {selectedOfficeClient ? (
            <div className="nx-we-wizard-prefill" style={{ marginTop: 12, fontSize: 13 }}>
              <div>{selectedOfficeClient.display_name}</div>
              {selectedOfficeClient.business_type_label ? (
                <div>{selectedOfficeClient.business_type_label}</div>
              ) : null}
              {selectedOfficeClient.tax_id ? (
                <div>
                  {wizard.office_client_display_labels.tax_id_label}: {selectedOfficeClient.tax_id}
                </div>
              ) : null}
              {selectedOfficeClient.phone ? (
                <div>
                  {wizard.office_client_display_labels.phone_label}: {selectedOfficeClient.phone}
                </div>
              ) : null}
              {selectedOfficeClient.email ? (
                <div>
                  {wizard.office_client_display_labels.email_label}: {selectedOfficeClient.email}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      );
    }
    if (activeStepKey === 'document_type') {
      return (
        <div className="nx-income-doc-type-list">
          {documentTypes.map((dt) => (
            <button
              key={dt.key}
              type="button"
              className={`nx-income-doc-type-btn ${form.document_type === dt.key ? 'nx-income-doc-type-btn--selected' : ''}`}
              disabled={!dt.enabled || busy}
              title={dt.disabled_reason ?? dt.legal_hint ?? undefined}
              onClick={() => setForm((f) => ({ ...f, document_type: dt.key }))}
            >
              <strong>{dt.label}</strong>
              {dt.disabled_reason ? (
                <span style={{ fontSize: 12, color: '#6b7280' }}>{dt.disabled_reason}</span>
              ) : null}
            </button>
          ))}
        </div>
      );
    }
    if (activeStepKey === 'recipient') {
      return (
        <WorkEngineRecipientSearchField
          ref={recipientFieldRef}
          wizard={wizard}
          workspaceAgg={workspaceAgg}
          busy={busy}
          onWorkspaceAgg={setWorkspaceAgg}
          onError={setError}
          onPendingChange={setRecipientPending}
        />
      );
    }
    if (activeStepKey === 'document_details') {
      if (!documentDetailsStep) {
        return <p className="nx-we-doc-details__empty">טוען פרטי מסמך…</p>;
      }
      return (
        <WorkEngineDocumentDetailsStep
          step={documentDetailsStep}
          commands={wizard.income_commands}
          workspaceAgg={workspaceAgg}
          busy={busy}
          onBusyChange={onBusyChange}
          onWorkspaceAgg={setWorkspaceAgg}
          onError={setError}
        />
      );
    }
    if (activeStepKey === 'preview') {
      if (!documentDetailsStep) {
        return <p className="nx-we-doc-details__empty">טוען תצוגה מקדימה…</p>;
      }
      return (
        <WorkEngineIncomePreviewStep
          step={documentDetailsStep}
          draftId={activeDraftId ?? documentDetailsStep.draft_id}
          brandingCommands={{
            update_branding_profile: wizard.income_commands.update_branding_profile,
            upload_document_logo: wizard.income_commands.upload_document_logo,
            upload_document_signature: wizard.income_commands.upload_document_signature,
          }}
          busy={busy}
          onGeneratePreview={() => void handleGeneratePreview(false)}
          onBrandingCommand={handleBrandingCommand}
        />
      );
    }
    if (activeStepKey === 'issue') {
      const header = documentDetailsStep?.header;
      return (
        <div className="nx-we-doc-details__preview" dir="rtl">
          {header ? <h3 className="nx-we-doc-details__title">{header.title}</h3> : null}
          <p className="nx-we-doc-details__hint">
            מספר מסמך סופי ואימות ייקבעו בהפקה בשרת בלבד.
          </p>
        </div>
      );
    }
    return null;
  };

  const stepTitle =
    visibleSteps[stepIndex]?.label ?? wizard.issuer_choice.title;

  const modalStepClass =
    activeStepKey === 'recipient'
      ? 'nx-we-income-wizard-modal--recipient-step'
      : activeStepKey === 'preview'
        ? 'nx-we-income-wizard-modal--preview-step'
        : activeStepKey === 'document_details'
          ? 'nx-we-income-wizard-modal--details-step'
          : '';

  return (
    <div className="nx-modal-overlay" role="dialog" aria-modal="true">
      <div
        className={`nx-modal nx-accounting-editor-modal nx-we-income-wizard-modal ${modalStepClass}`.trim()}
        dir="rtl"
      >
        <div className="nx-modal-header">
          <h2>{stepTitle}</h2>
          <button type="button" className="nx-modal-close" onClick={onClose} disabled={footerLocked}>
            סגירה
          </button>
        </div>
        <div className="nx-modal-body">{error ? <div className="nx-we-banner-error">{error}</div> : null}{renderBody()}</div>
        <div className="nx-modal-footer nx-tax-nested-modal-footer">
          {stepIndex > 0 ? (
            <button
              type="button"
              className="nx-btn nx-btn-taxes-compact"
              disabled={footerLocked}
              onClick={handleBack}
            >
              הקודם
            </button>
          ) : null}
          {activeStepKey === 'document_details' ? (
            <button
              type="button"
              className="nx-btn nx-btn-taxes-compact"
              disabled={footerLocked || !activeDraftId}
              onClick={() => void handleSaveDraft()}
              title={documentDetailsStep?.draft_state_display?.label ?? undefined}
            >
              שמירת טיוטה
            </button>
          ) : null}
          {activeStepKey === 'document_details' ? (
            <button
              type="button"
              className="nx-btn nx-btn-taxes-compact"
              disabled={footerLocked || !activeDraftId}
              onClick={() => void handleGeneratePreview(true)}
            >
              תצוגה מקדימה
            </button>
          ) : null}
          {!isLastStep ? (
            <button
              type="button"
              className="nx-btn nx-btn-primary nx-btn-taxes-compact"
              disabled={footerLocked}
              onClick={() => void handleNext()}
            >
              {recipientPending ? 'טוען...' : 'הבא'}
            </button>
          ) : (
            <button
              type="button"
              className="nx-btn nx-btn-primary nx-btn-taxes-compact"
              disabled={footerLocked || !form.document_type || !activeDraftId}
              onClick={() => void handleSaveAndIssue()}
            >
              הפק מסמך
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
