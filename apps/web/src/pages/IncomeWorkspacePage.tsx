/**
 * INC-7 — Income workspace (aggregate-only read, command-only write).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { userFacingApiMessage } from '../api/client';
import {
  downloadIncomeDocumentPdf,
  executeIncomeCommand,
  fetchIncomeWorkspaceAggregate,
  fetchIncomeWorkspaceContextAggregate,
  pickDraftIdAfterSave,
  type IncomeCommandResponse,
  type IncomeDraftsTableRow,
  type IncomeIssuedDocumentsTableRow,
  type IncomeWorkspaceAggregate,
  type IncomeWorkspaceCard,
  type IncomeWorkspaceContextAggregate,
  type SelectIncomeIssuerContextCommandResponse,
} from '../api/income';
import { IncomeCardsGrid } from '../components/income/IncomeCardsGrid';
import { IncomeCustomersTable } from '../components/income/IncomeCustomersTable';
import { IncomeDocumentBrandingGearButton } from '../components/income/IncomeDocumentBrandingGearButton';
import { IncomeDocumentBrandingSettingsModal } from '../components/income/IncomeDocumentBrandingSettingsModal';
import { IncomeDocumentWizardModal } from '../components/income/IncomeDocumentWizardModal';
import { IncomeDocumentsTable } from '../components/income/IncomeDocumentsTable';
import { IncomeDraftsTable } from '../components/income/IncomeDraftsTable';
import { IncomeIssuerContextSwitcher } from '../components/income/IncomeIssuerContextSwitcher';
import { IncomeItemsTable } from '../components/income/IncomeItemsTable';
import '../styles/nx-income-workspace.css';
import '../styles/nx-modal.css';

type Toast = { kind: 'ok' | 'err'; message: string } | null;

type SimpleFormModal =
  | { kind: 'customer' }
  | { kind: 'item' }
  | null;

const CARD_PANEL_SCROLL: Record<string, string> = {
  customers: 'income-panel-customers',
  items: 'income-panel-items',
  drafts: 'income-panel-drafts',
  documents: 'income-panel-documents',
  posted_documents: 'income-panel-documents',
  posting_failed: 'income-panel-documents',
};

function isSelectIssuerResponse(
  res: IncomeCommandResponse | SelectIncomeIssuerContextCommandResponse,
): res is SelectIncomeIssuerContextCommandResponse {
  return res.command === 'select_income_issuer_context' && 'income_workspace_context_aggregate' in res;
}

export function IncomeWorkspacePage() {
  const [context, setContext] = useState<IncomeWorkspaceContextAggregate | null>(null);
  const [workspace, setWorkspace] = useState<IncomeWorkspaceAggregate | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  const [wizardOpen, setWizardOpen] = useState(false);
  const [editingDraft, setEditingDraft] = useState<IncomeDraftsTableRow | null>(null);
  const [presetDocumentType, setPresetDocumentType] = useState<string | null>(null);
  const [simpleModal, setSimpleModal] = useState<SimpleFormModal>(null);
  const [brandingOpen, setBrandingOpen] = useState(false);

  const [customerForm, setCustomerForm] = useState({ display_name: '', phone: '', email: '', tax_id: '' });
  const [itemForm, setItemForm] = useState({
    item_type: 'service',
    name: '',
    description: '',
    default_unit_price_reference: '',
    currency: 'ILS',
  });

  const draftIdsBeforeSave = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [ctx, ws] = await Promise.all([
        fetchIncomeWorkspaceContextAggregate(),
        fetchIncomeWorkspaceAggregate(),
      ]);
      setContext(ctx);
      setWorkspace(ws);
      draftIdsBeforeSave.current = new Set(ws.drafts_table_model.rows.map((r) => r.draft_id));
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const applyWorkspace = useCallback((ws: IncomeWorkspaceAggregate) => {
    setWorkspace(ws);
    draftIdsBeforeSave.current = new Set(ws.drafts_table_model.rows.map((r) => r.draft_id));
  }, []);

  const runCommand = useCallback(
    async (
      command: string,
      body: Record<string, unknown>,
    ): Promise<IncomeCommandResponse | SelectIncomeIssuerContextCommandResponse> => {
      setBusy(true);
      setError(null);
      try {
        const res = await executeIncomeCommand(command, body);
        if (isSelectIssuerResponse(res)) {
          setContext(res.income_workspace_context_aggregate);
          applyWorkspace(res.income_workspace_aggregate);
        } else {
          applyWorkspace(res.income_workspace_aggregate);
        }
        setToast({ kind: 'ok', message: 'הפעולה בוצעה בהצלחה' });
        return res;
      } catch (e) {
        const msg = userFacingApiMessage(e);
        setToast({ kind: 'err', message: msg });
        setError(msg);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [applyWorkspace],
  );

  const scrollToPanel = (panelId: string) => {
    document.getElementById(panelId)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const openWizard = (draft: IncomeDraftsTableRow | null, docType: string | null) => {
    setEditingDraft(draft);
    setPresetDocumentType(docType);
    setWizardOpen(true);
  };

  const handleCardAction = (card: IncomeWorkspaceCard, action: string) => {
    if (action === 'create_income_document_draft') {
      openWizard(null, null);
      return;
    }
    if (action === 'create_income_customer') {
      setSimpleModal({ kind: 'customer' });
      return;
    }
    if (action === 'create_income_item') {
      setSimpleModal({ kind: 'item' });
      return;
    }
    if (action === 'open') {
      const panel = CARD_PANEL_SCROLL[card.key];
      if (panel) scrollToPanel(panel);
    }
  };

  const handleIssuerSelect = async (option: {
    acting_mode: string;
    issuer_business_id: string;
    represented_client_id: string | null;
  }) => {
    await runCommand('select_income_issuer_context', {
      acting_mode: option.acting_mode,
      issuer_business_id: option.issuer_business_id,
      represented_client_id: option.represented_client_id,
    });
  };

  const handleDraftAction = async (row: IncomeDraftsTableRow, action: string) => {
    if (action === 'update_income_document_draft') {
      openWizard(row, row.document_type);
      return;
    }
    if (action === 'cancel_income_document_draft') {
      if (!window.confirm('לבטל את הטיוטה?')) return;
      await runCommand('cancel_income_document_draft', { draft_id: row.draft_id });
      return;
    }
    if (action === 'issue_income_document') {
      await runCommand('issue_income_document', { draft_id: row.draft_id });
    }
  };

  const handleIssuedAction = async (row: IncomeIssuedDocumentsTableRow, action: string) => {
    if (action === 'download_pdf' && row.pdf_download_path) {
      setBusy(true);
      try {
        await downloadIncomeDocumentPdf(row.pdf_download_path, `income-${row.document_number}.pdf`);
        setToast({ kind: 'ok', message: 'הורדת PDF החלה' });
      } catch (e) {
        setToast({ kind: 'err', message: userFacingApiMessage(e) });
      } finally {
        setBusy(false);
      }
      return;
    }
    if (action === 'retry_income_document_accounting_posting') {
      await runCommand('retry_income_document_accounting_posting', { income_document_id: row.document_id });
      return;
    }
    if (action === 'retry_income_document_pdf_render') {
      await runCommand('retry_income_document_pdf_render', { income_document_id: row.document_id });
    }
  };

  const handleSaveDraft = async (payload: Record<string, unknown>, draftId: string | null) => {
    const before = new Set(draftIdsBeforeSave.current);
    if (draftId) {
      await runCommand('update_income_document_draft', { draft_id: draftId, ...payload });
      return draftId;
    }
    const res = (await runCommand('create_income_document_draft', payload)) as IncomeCommandResponse;
    return pickDraftIdAfterSave(res.income_workspace_aggregate, before);
  };

  const handleIssueFromWizard = async (draftId: string) => {
    await runCommand('issue_income_document', { draft_id: draftId });
    setWizardOpen(false);
    setEditingDraft(null);
  };

  const workspaceAllowed = workspace?.allowed_actions ?? [];
  const canCreateCustomer = workspaceAllowed.includes('create_income_customer');
  const canCreateItem = workspaceAllowed.includes('create_income_item');

  const warnings = useMemo(() => {
    const w = [...(context?.warnings ?? []), ...(workspace?.warnings ?? [])];
    return w;
  }, [context?.warnings, workspace?.warnings]);

  if (loading) {
    return (
      <div className="nx-income-workspace" dir="rtl" lang="he">
        <div className="nx-income-skeleton-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="nx-income-skeleton-card" />
          ))}
        </div>
        <div className="nx-income-skeleton-block" />
      </div>
    );
  }

  if (error && !workspace) {
    return (
      <div className="nx-income-workspace" dir="rtl" lang="he">
        <p role="alert" style={{ color: '#b91c1c' }}>
          {error}
        </p>
        <button type="button" className="nx-btn nx-btn-taxes-compact" onClick={() => void load()}>
          נסה שוב
        </button>
      </div>
    );
  }

  if (!workspace || !context) return null;

  return (
    <div className="nx-income-workspace" dir="rtl" lang="he">
      <header className="nx-income-workspace__header">
        <div className="nx-income-workspace__title-row">
          <div>
            <h1 className="nx-income-workspace__title">
              <span>חשבוניות</span>
              <IncomeDocumentBrandingGearButton
                entrypoint={workspace.document_branding_settings_entrypoint}
                disabled={busy}
                onClick={() => setBrandingOpen(true)}
              />
            </h1>
            <p className="nx-income-workspace__subtitle">ניהול מסמכים, לקוחות ופריטים — נתונים מהשרת בלבד</p>
          </div>
        </div>
        <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => void load()}>
          רענון
        </button>
      </header>

      {warnings.length > 0 ? (
        <div role="status" style={{ padding: 12, borderRadius: 10, background: '#fffbeb', border: '1px solid #fde68a' }}>
          {warnings.map((w) => (
            <p key={w.code} style={{ margin: '4px 0', fontSize: 13 }}>
              {w.message}
            </p>
          ))}
        </div>
      ) : null}

      <IncomeIssuerContextSwitcher context={context} busy={busy} onSelectOption={(o) => void handleIssuerSelect(o)} />

      <IncomeCardsGrid cards={workspace.cards} onCardAction={handleCardAction} />

      <IncomeCustomersTable
        model={workspace.customers_table_model}
        canCreate={canCreateCustomer}
        busy={busy}
        onCreateCustomer={() => setSimpleModal({ kind: 'customer' })}
      />

      <IncomeItemsTable
        model={workspace.items_table_model}
        canCreate={canCreateItem}
        busy={busy}
        onCreateItem={() => setSimpleModal({ kind: 'item' })}
      />

      <IncomeDraftsTable model={workspace.drafts_table_model} busy={busy} onRowAction={(r, a) => void handleDraftAction(r, a)} />

      <IncomeDocumentsTable
        model={workspace.issued_documents_table_model}
        busy={busy}
        onRowAction={(r, a) => void handleIssuedAction(r, a)}
      />

      <IncomeDocumentWizardModal
        open={wizardOpen}
        busy={busy}
        workspace={workspace}
        issuerContext={workspace.issuer_context}
        editingDraft={editingDraft}
        presetDocumentType={presetDocumentType}
        customers={workspace.customers_table_model.rows}
        items={workspace.items_table_model.rows}
        schema={workspace.document_creation_schema}
        documentTypes={workspace.available_document_types}
        onClose={() => {
          setWizardOpen(false);
          setEditingDraft(null);
          setPresetDocumentType(null);
        }}
        onSaveDraft={handleSaveDraft}
        onIssueDraft={handleIssueFromWizard}
      />

      {simpleModal?.kind === 'customer' ? (
        <div className="nx-income-wizard-overlay" role="dialog" aria-modal="true">
          <div className="nx-income-wizard nx-accounting-editor-modal" style={{ maxWidth: 440 }}>
            <div className="nx-income-wizard__head">
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>לקוח חדש</h2>
            </div>
            <div className="nx-income-wizard__body">
              <div className="nx-income-field">
                <label>שם</label>
                <input
                  value={customerForm.display_name}
                  disabled={busy}
                  onChange={(e) => setCustomerForm((f) => ({ ...f, display_name: e.target.value }))}
                />
              </div>
              <div className="nx-income-field">
                <label>טלפון</label>
                <input
                  value={customerForm.phone}
                  disabled={busy}
                  onChange={(e) => setCustomerForm((f) => ({ ...f, phone: e.target.value }))}
                />
              </div>
              <div className="nx-income-field">
                <label>אימייל</label>
                <input
                  value={customerForm.email}
                  disabled={busy}
                  onChange={(e) => setCustomerForm((f) => ({ ...f, email: e.target.value }))}
                />
              </div>
              <div className="nx-income-field">
                <label>מספר זיהוי</label>
                <input
                  value={customerForm.tax_id}
                  disabled={busy}
                  onChange={(e) => setCustomerForm((f) => ({ ...f, tax_id: e.target.value }))}
                />
              </div>
            </div>
            <div className="nx-income-wizard__footer nx-modal-footer nx-tax-nested-modal-footer">
              <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => setSimpleModal(null)}>
                סגירה
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact nx-btn-primary"
                disabled={busy || !customerForm.display_name.trim()}
                onClick={() =>
                  void runCommand('create_income_customer', {
                    display_name: customerForm.display_name.trim(),
                    phone: customerForm.phone.trim() || null,
                    email: customerForm.email.trim() || null,
                    tax_id: customerForm.tax_id.trim() || null,
                  }).then(() => {
                    setSimpleModal(null);
                    setCustomerForm({ display_name: '', phone: '', email: '', tax_id: '' });
                  })
                }
              >
                שמירה
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {simpleModal?.kind === 'item' ? (
        <div className="nx-income-wizard-overlay" role="dialog" aria-modal="true">
          <div className="nx-income-wizard nx-accounting-editor-modal" style={{ maxWidth: 440 }}>
            <div className="nx-income-wizard__head">
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>פריט חדש</h2>
            </div>
            <div className="nx-income-wizard__body">
              <div className="nx-income-field">
                <label>סוג</label>
                <select
                  value={itemForm.item_type}
                  disabled={busy}
                  onChange={(e) => setItemForm((f) => ({ ...f, item_type: e.target.value }))}
                >
                  <option value="service">שירות</option>
                  <option value="product">מוצר</option>
                </select>
              </div>
              <div className="nx-income-field">
                <label>שם</label>
                <input value={itemForm.name} disabled={busy} onChange={(e) => setItemForm((f) => ({ ...f, name: e.target.value }))} />
              </div>
              <div className="nx-income-field">
                <label>תיאור</label>
                <input
                  value={itemForm.description}
                  disabled={busy}
                  onChange={(e) => setItemForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>
              <div className="nx-income-field">
                <label>מחיר ברירת מחדל</label>
                <input
                  value={itemForm.default_unit_price_reference}
                  disabled={busy}
                  onChange={(e) => setItemForm((f) => ({ ...f, default_unit_price_reference: e.target.value }))}
                />
              </div>
            </div>
            <div className="nx-income-wizard__footer nx-modal-footer nx-tax-nested-modal-footer">
              <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => setSimpleModal(null)}>
                סגירה
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-taxes-compact nx-btn-primary"
                disabled={busy || !itemForm.name.trim()}
                onClick={() =>
                  void runCommand('create_income_item', {
                    item_type: itemForm.item_type,
                    name: itemForm.name.trim(),
                    description: itemForm.description.trim() || null,
                    default_unit_price_reference: itemForm.default_unit_price_reference.trim()
                      ? Number(itemForm.default_unit_price_reference)
                      : null,
                    currency: itemForm.currency,
                  }).then(() => {
                    setSimpleModal(null);
                    setItemForm({
                      item_type: 'service',
                      name: '',
                      description: '',
                      default_unit_price_reference: '',
                      currency: 'ILS',
                    });
                  })
                }
              >
                שמירה
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <IncomeDocumentBrandingSettingsModal
        open={brandingOpen}
        title={workspace.document_branding_settings_entrypoint?.modal_title ?? 'הגדרות מסמך'}
        profile={workspace.document_branding_profile}
        commands={
          workspace.document_branding_settings_entrypoint?.commands ?? {
            update_branding_profile: 'update_income_document_branding_profile',
            upload_document_logo: 'upload_income_document_logo',
            upload_document_signature: 'upload_income_document_signature',
          }
        }
        busy={busy}
        onClose={() => setBrandingOpen(false)}
        onCommand={async (command, body) => {
          await runCommand(command, body);
        }}
      />

      {toast ? (
        <div className={`nx-income-toast nx-income-toast--${toast.kind}`} role="status">
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}
