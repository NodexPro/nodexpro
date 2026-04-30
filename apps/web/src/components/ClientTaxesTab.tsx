import { useCallback, useEffect, useRef, useState } from 'react';
import '../styles/nx-modal.css';
import { ApiError, apiJson } from '../api/client';
import { isCardExpiryInPast } from '../utils/card-expiry';
import { inferCardBrand as inferCardBrandClient } from '../utils/card-brand';
import {
  moduleClientOperationsTaxCommands,
  moduleClientOperationsTaxSettingsPaymentCardRequestCode,
  moduleClientOperationsTaxSettingsPaymentCardVerifyCode,
  moduleClientOperationsTaxSettingsRevealPaymentSecret,
} from '../api/endpoints';
import type { ClientOperationsCaseResponse } from './ClientWorkspacePanel';
import type {
  ClientTaxSettingsPublic,
  TaxTabCommandType,
  TaxTabPaymentPanelModel,
  TaxTabSectionKey,
  TaxTabSectionReadModel,
  TaxTabWorkspaceResponse,
} from './tax-tab-types';

export type {
  ClientTaxSettingsBundle,
  ClientTaxSettingsPublic,
  ClientTaxUiHints,
  OsekPaturVatDueUi,
  TaxTabCommandType,
} from './tax-tab-types';

type CardPayload = { card_number: string; expiry: string; card_holder_name?: string | null };

type PaymentType = 'vat' | 'income_tax';
type SecretKind = 'card_number' | 'expiry';

function CopySecretIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function EditPencilIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

/** Small scheme mark — geometric hints only; brand from server `payment_masked.brand` or live PAN heuristic in modal. */
function PaymentCardBrandMark({ brand }: { brand: string | null | undefined }) {
  const b = (brand ?? 'unknown').toLowerCase();
  const common = {
    className: 'payment-card-brand-mark',
    width: 34,
    height: 22,
    viewBox: '0 0 34 22',
    'aria-hidden': true as const,
  };
  switch (b) {
    case 'visa':
      return (
        <svg {...common}>
          <rect x="1" y="3" width="32" height="16" rx="3" fill="#1a1f71" />
          <text
            x="17"
            y="14.5"
            textAnchor="middle"
            fill="#fff"
            fontSize="9"
            fontWeight="700"
            fontFamily="system-ui, sans-serif"
            letterSpacing="0.06em"
          >
            VISA
          </text>
        </svg>
      );
    case 'mastercard':
      return (
        <svg {...common}>
          <rect x="1" y="3" width="32" height="16" rx="3" fill="#f8fafc" stroke="#e2e8f0" />
          <circle cx="14" cy="11" r="6.5" fill="#eb001b" opacity="0.92" />
          <circle cx="20" cy="11" r="6.5" fill="#f79e1b" opacity="0.92" />
        </svg>
      );
    case 'amex':
      return (
        <svg {...common}>
          <rect x="1" y="3" width="32" height="16" rx="3" fill="#006fcf" />
          <text
            x="17"
            y="14.5"
            textAnchor="middle"
            fill="#fff"
            fontSize="8"
            fontWeight="800"
            fontFamily="system-ui, sans-serif"
          >
            AMEX
          </text>
        </svg>
      );
    case 'diners':
      return (
        <svg {...common}>
          <rect x="1" y="3" width="32" height="16" rx="3" fill="#0079be" />
          <text
            x="17"
            y="14.5"
            textAnchor="middle"
            fill="#fff"
            fontSize="7"
            fontWeight="700"
            fontFamily="system-ui, sans-serif"
          >
            DINERS
          </text>
        </svg>
      );
    case 'jcb':
      return (
        <svg {...common}>
          <rect x="1" y="3" width="32" height="16" rx="3" fill="#0b5f2a" />
          <text
            x="17"
            y="14.5"
            textAnchor="middle"
            fill="#fff"
            fontSize="9"
            fontWeight="800"
            fontFamily="system-ui, sans-serif"
          >
            JCB
          </text>
        </svg>
      );
    case 'isracard':
      return (
        <svg {...common}>
          <rect x="1" y="3" width="32" height="16" rx="3" fill="#0f766e" />
          <text
            x="17"
            y="14.5"
            textAnchor="middle"
            fill="#fff"
            fontSize="7"
            fontWeight="800"
            fontFamily="system-ui, sans-serif"
          >
            ISR
          </text>
        </svg>
      );
    default:
      return (
        <svg {...common} role="img">
          <title>לא זוהתה רשת אשראי — אמקס מתחיל ב־34 או 37, ויזה ב־4</title>
          <rect x="1" y="3" width="32" height="16" rx="4" fill="#f8fafc" stroke="#94a3b8" strokeWidth="1" />
          <rect x="5" y="6" width="10" height="7" rx="1.5" fill="#e2e8f0" />
          <text
            x="23"
            y="14.5"
            textAnchor="middle"
            fill="#64748b"
            fontSize="11"
            fontWeight="800"
            fontFamily="system-ui, sans-serif"
          >
            ?
          </text>
        </svg>
      );
  }
}

function TaxTabPaymentPanelBlock({
  panel,
  revealBusy,
  onPlainCopy,
  onSecureCopy,
}: {
  panel: TaxTabPaymentPanelModel;
  revealBusy: string | null;
  onPlainCopy: (raw: string | null | undefined) => void;
  onSecureCopy: (paymentType: PaymentType, secretKind: SecretKind) => void;
}) {
  return (
    <div style={{ marginTop: 12 }}>
      <div className="payment-summary-card">
        {panel.rows.map((row) => {
          const busyKey = row.secure ? `${row.secure.payment_channel}:${row.secure.secret_kind}` : null;
          const copyDisabled =
            !row.copy_control.show ||
            (row.interaction === 'plain_clipboard' && Boolean(row.copy_control.disabled)) ||
            (row.interaction === 'secure_reveal_clipboard' && Boolean(row.secure_state?.disabled));
          return (
            <div className="payment-summary-row" key={row.row_key}>
              <div className="payment-summary-label">{row.label_he}</div>
              <div
                className={
                  row.value_cell_layout === 'card_with_brand'
                    ? 'payment-summary-value payment-summary-value--mono payment-summary-value--with-brand'
                    : 'payment-summary-value'
                }
              >
                {row.value_cell_layout === 'card_with_brand' ? (
                  <>
                    <span>{row.value_display_he}</span>
                    <PaymentCardBrandMark brand={row.card_brand} />
                  </>
                ) : (
                  row.value_display_he
                )}
              </div>
              {row.copy_control.show ? (
                <button
                  type="button"
                  className="payment-copy-btn"
                  disabled={copyDisabled}
                  aria-label={row.copy_control.aria_label_he}
                  title="העתקה"
                  onClick={() => {
                    if (row.interaction === 'plain_clipboard') {
                      void onPlainCopy(row.clipboard_plain_text);
                    } else if (row.secure) {
                      void onSecureCopy(row.secure.payment_channel, row.secure.secret_kind);
                    }
                  }}
                >
                  {busyKey && revealBusy === busyKey ? '…' : <CopySecretIcon />}
                </button>
              ) : null}
            </div>
          );
        })}
        {panel.card_expired_warning ? (
          <div className="payment-summary-expired" role="alert">
            כרטיס פג תוקף
          </div>
        ) : null}
      </div>
      <p style={{ fontSize: 11, color: '#94a3b8', margin: '8px 0 0', lineHeight: 1.4 }}>
        {panel.cvv_footer_he}
      </p>
    </div>
  );
}

function createEmptyTaxSettingsPublic(): ClientTaxSettingsPublic {
  return {
    vat_type: null,
    vat_frequency: null,
    vat_due_type: null,
    income_tax_advance_enabled: false,
    income_tax_advance_percent: null,
    income_tax_advance_frequency: null,
    income_tax_advance_ui_selection: 'choose',
    income_tax_deductions_enabled: false,
    income_tax_deductions_file_number: null,
    income_tax_deductions_frequency: null,
    income_tax_deductions_ui_selection: 'choose',
    national_insurance_type: null,
    national_insurance_monthly_amount: null,
    national_insurance_deductions_file_number: null,
    vat_payment_method: null,
    vat_payment_masked: { last4: null, expiry: null, card_number_masked: null, brand: null },
    income_tax_payment_method: null,
    income_tax_payment_masked: { last4: null, expiry: null, card_number_masked: null, brand: null },
    vat_card_holder_name: null,
    income_tax_card_holder_name: null,
    client_tax_id: null,
    client_display_name: null,
    payment_secure_sessions: {
      vat: { active: false, expires_at: null },
      income_tax: { active: false, expires_at: null },
    },
    vat_other_payment_text: null,
    income_tax_other_payment_text: null,
    notes: null,
    vat_divuach_next_due_at: null,
    vat_divuach_next_due_display_he: null,
    vat_due_registry_display_he: null,
  };
}

function cloneSettings(s: ClientTaxSettingsPublic): ClientTaxSettingsPublic {
  const selection =
    s.income_tax_advance_ui_selection ??
    (s.income_tax_advance_enabled ? 'yes' : 'choose');
  const dedSelection =
    s.income_tax_deductions_ui_selection ??
    (s.income_tax_deductions_enabled ? 'yes' : 'choose');
  return {
    ...s,
    income_tax_advance_ui_selection: selection,
    income_tax_deductions_ui_selection: dedSelection,
    vat_payment_masked: { ...s.vat_payment_masked },
    income_tax_payment_masked: { ...s.income_tax_payment_masked },
    vat_card_holder_name: s.vat_card_holder_name ?? null,
    income_tax_card_holder_name: s.income_tax_card_holder_name ?? null,
    client_tax_id: s.client_tax_id ?? null,
    client_display_name: s.client_display_name ?? null,
    payment_secure_sessions: s.payment_secure_sessions ?? {
      vat: { active: false, expires_at: null },
      income_tax: { active: false, expires_at: null },
    },
  };
}

function TaxWorkspaceSectionCard({
  sec,
  isSaving,
  onOpenEditor,
  revealBusy,
  onPlainCopy,
  onSecureCopy,
}: {
  sec: TaxTabSectionReadModel;
  isSaving: boolean;
  onOpenEditor: (key: TaxTabSectionKey) => void;
  revealBusy: string | null;
  onPlainCopy: (raw: string | null | undefined) => void;
  onSecureCopy: (paymentType: PaymentType, secretKind: SecretKind) => void;
}) {
  return (
    <section
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        padding: 14,
        background: '#fafafa',
        minWidth: 0,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 10,
          marginBottom: 10,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>{sec.title_he}</h3>
        {sec.edit.enabled ? (
          <button
            type="button"
            className="nx-taxes-section-edit-btn"
            onClick={() => onOpenEditor(sec.section_key)}
            disabled={isSaving}
            aria-label={sec.edit.button_label_he}
            title={sec.edit.button_label_he}
          >
            <EditPencilIcon />
          </button>
        ) : null}
      </div>
      <dl style={{ margin: 0 }}>
        {sec.display_rows.map((row) => (
          <div
            key={row.row_key}
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr)',
              gap: 8,
              padding: '6px 0',
              borderBottom: '1px solid #f1f5f9',
            }}
          >
            <dt style={{ margin: 0, fontSize: 13, color: '#64748b' }}>{row.label_he}</dt>
            <dd
              style={{
                margin: 0,
                fontSize: 14,
                fontWeight: 600,
                color: row.tone === 'not_relevant' || row.tone === 'muted' ? '#94a3b8' : '#0f172a',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {row.value_he}
            </dd>
          </div>
        ))}
      </dl>
      {sec.payment_panel?.visible ? (
        <TaxTabPaymentPanelBlock
          panel={sec.payment_panel}
          revealBusy={revealBusy}
          onPlainCopy={onPlainCopy}
          onSecureCopy={onSecureCopy}
        />
      ) : null}
    </section>
  );
}

export function ClientTaxesTab({
  clientId,
  taxTab,
  onTaxSettingsUpdated,
  feesPriceChartView,
}: {
  clientId: string;
  /** Workspace aggregate (`tax_tab`) — display, payment panel, `baseline.settings` for modals, `ui` flags. */
  taxTab: TaxTabWorkspaceResponse | null | undefined;
  /** Full refreshed client case after tax command (same as fees/obligations pattern). */
  onTaxSettingsUpdated: (next: ClientOperationsCaseResponse) => void;
  /** Keeps fees chart slice stable when the full case is rebuilt (from workspace `fees_tab`). */
  feesPriceChartView?: 'last_15' | 'all';
}) {
  /** Edit-layer draft (modals) — synced from `tax_tab.baseline.settings` only. */
  const [modalDraft, setModalDraft] = useState<ClientTaxSettingsPublic>(() => createEmptyTaxSettingsPublic());
  const [activeSectionModal, setActiveSectionModal] = useState<TaxTabSectionKey | null>(null);
  const [vatCard, setVatCard] = useState<CardPayload>({ card_number: '', expiry: '', card_holder_name: '' });
  const [itCard, setItCard] = useState<CardPayload>({ card_number: '', expiry: '', card_holder_name: '' });
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  /** e.g. `vat:card_number` — only one reveal at a time */
  const [revealBusy, setRevealBusy] = useState<string | null>(null);
  const [verifyModalOpen, setVerifyModalOpen] = useState(false);
  const [verifyCodeInput, setVerifyCodeInput] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [pendingVerify, setPendingVerify] = useState<{
    paymentType: PaymentType;
    secretKind: SecretKind;
    challengeId: string;
  } | null>(null);
  const advanceModalOpen = activeSectionModal === 'income_tax_advances';
  const deductionsModalOpen = activeSectionModal === 'income_tax_deductions';
  const nationalInsuranceModalOpen = activeSectionModal === 'national_insurance';
  const vatPaymentEditorOpen = activeSectionModal === 'vat_payment';
  const incomeTaxPaymentEditorOpen = activeSectionModal === 'income_tax_payment';
  const vatRegistrationModalOpen = activeSectionModal === 'vat_registration';
  const notesModalOpen = activeSectionModal === 'notes';
  const [vatPaymentCreditModalOpen, setVatPaymentCreditModalOpen] = useState(false);
  const [vatPaymentOtherModalOpen, setVatPaymentOtherModalOpen] = useState(false);
  const [incomeTaxPaymentCreditModalOpen, setIncomeTaxPaymentCreditModalOpen] = useState(false);
  const [incomeTaxPaymentOtherModalOpen, setIncomeTaxPaymentOtherModalOpen] = useState(false);
  /** מסתיר חלון שרת-מוביל מיד בלחיצת שמירה (כל עוד ui עדיין מסמן חוסר) */
  const [vatCreditServerModalDismissed, setVatCreditServerModalDismissed] = useState(false);
  const [itCreditServerModalDismissed, setItCreditServerModalDismissed] = useState(false);
  /** true = ביטול בחלון מחזיר את draft לפני בחירת אשראי/אחר; false = רק סגירה (עריכה מכרטיס סיכום) */
  const vatCreditModalCancelReverts = useRef(true);
  const vatOtherModalCancelReverts = useRef(true);
  const itCreditModalCancelReverts = useRef(true);
  const itOtherModalCancelReverts = useRef(true);

  /** Server snapshot for cancel / revert — from `tax_tab` aggregate only. */
  const snapshot = taxTab?.baseline.settings ?? createEmptyTaxSettingsPublic();

  useEffect(() => {
    if (!taxTab) return;
    setModalDraft(cloneSettings(taxTab.baseline.settings));
    setSaveError('');
    setSaveSuccess('');
    setActiveSectionModal(null);
    setVatPaymentCreditModalOpen(false);
    setVatPaymentOtherModalOpen(false);
    setIncomeTaxPaymentCreditModalOpen(false);
    setIncomeTaxPaymentOtherModalOpen(false);
  }, [taxTab]);

  useEffect(() => {
    if (!taxTab?.ui.vat_credit_modal) setVatCreditServerModalDismissed(false);
  }, [taxTab?.ui.vat_credit_modal]);

  useEffect(() => {
    if (!taxTab?.ui.income_tax_credit_modal) setItCreditServerModalDismissed(false);
  }, [taxTab?.ui.income_tax_credit_modal]);

  useEffect(() => {
    setVatCreditServerModalDismissed(false);
    setItCreditServerModalDismissed(false);
  }, [clientId]);

  const runTaxCommand = useCallback(
    async (
      type: TaxTabCommandType,
      payload: Record<string, unknown>,
      options?: { reopenCreditOnError?: 'vat' | 'income_tax' }
    ) => {
      setSaveError('');
      setIsSaving(true);
      try {
        const out = await apiJson<ClientOperationsCaseResponse>(moduleClientOperationsTaxCommands(clientId), {
          method: 'POST',
          body: JSON.stringify({
            type,
            payload,
            fees_price_chart_view: feesPriceChartView ?? 'last_15',
          }),
        });
        onTaxSettingsUpdated(out);
        if (out.tax_tab?.baseline.settings) {
          setModalDraft(cloneSettings(out.tax_tab.baseline.settings));
        }
        setSaveSuccess('נשמר בהצלחה');
        setVatCard({ card_number: '', expiry: '', card_holder_name: '' });
        setItCard({ card_number: '', expiry: '', card_holder_name: '' });
        setActiveSectionModal(null);
        setVatPaymentCreditModalOpen(false);
        setVatPaymentOtherModalOpen(false);
        setIncomeTaxPaymentCreditModalOpen(false);
        setIncomeTaxPaymentOtherModalOpen(false);
      } catch (e) {
        if (options?.reopenCreditOnError === 'vat') {
          setVatCreditServerModalDismissed(false);
          setVatPaymentCreditModalOpen(true);
        }
        if (options?.reopenCreditOnError === 'income_tax') {
          setItCreditServerModalDismissed(false);
          setIncomeTaxPaymentCreditModalOpen(true);
        }
        setSaveError(e instanceof Error ? e.message : 'שמירה נכשלה');
      } finally {
        setIsSaving(false);
      }
    },
    [clientId, feesPriceChartView, onTaxSettingsUpdated]
  );

  const handleSaveVatRegistration = () => {
    void runTaxCommand('update_tax_vat_registration', {
      vat_type: modalDraft.vat_type,
      vat_frequency: modalDraft.vat_frequency,
      vat_due_type: modalDraft.vat_due_type,
    });
  };

  const handleSaveVatPaymentEditor = () => {
    const m = modalDraft;
    if (!m.vat_payment_method) {
      setSaveError('נא לבחור שיטת תשלום מע״מ');
      return;
    }
    if (m.vat_payment_method === 'other') {
      void runTaxCommand('update_tax_vat_payment', {
        vat_payment_method: 'other',
        vat_other_payment_text: m.vat_other_payment_text,
      });
      return;
    }
    if (m.vat_payment_method === 'credit' && vatCard.card_number.trim()) {
      void runTaxCommand('update_tax_vat_payment', {
        vat_payment_method: 'credit',
        vat_credit_card: {
          card_number: vatCard.card_number,
          expiry: vatCard.expiry,
          card_holder_name: vatCard.card_holder_name?.trim() || null,
        },
      });
      return;
    }
    void runTaxCommand('update_tax_vat_payment', {
      vat_payment_method: m.vat_payment_method,
      vat_other_payment_text: null,
    });
  };

  const handleSaveIncomeTaxPaymentEditor = () => {
    const m = modalDraft;
    if (!m.income_tax_payment_method) {
      setSaveError('נא לבחור שיטת תשלום מס הכנסה');
      return;
    }
    if (m.income_tax_payment_method === 'other') {
      void runTaxCommand('update_tax_income_tax_payment', {
        income_tax_payment_method: 'other',
        income_tax_other_payment_text: m.income_tax_other_payment_text,
      });
      return;
    }
    if (m.income_tax_payment_method === 'credit' && itCard.card_number.trim()) {
      void runTaxCommand('update_tax_income_tax_payment', {
        income_tax_payment_method: 'credit',
        income_tax_credit_card: {
          card_number: itCard.card_number,
          expiry: itCard.expiry,
          card_holder_name: itCard.card_holder_name?.trim() || null,
        },
      });
      return;
    }
    void runTaxCommand('update_tax_income_tax_payment', {
      income_tax_payment_method: m.income_tax_payment_method,
      income_tax_other_payment_text: null,
    });
  };

  const handleSaveNotes = () => {
    void runTaxCommand('update_tax_notes', { notes: modalDraft.notes });
  };

  const handleSaveVatOtherPayment = () => {
    void runTaxCommand('update_tax_vat_payment', {
      vat_payment_method: 'other',
      vat_other_payment_text: modalDraft.vat_other_payment_text,
    });
  };

  const handleSaveIncomeOtherPayment = () => {
    void runTaxCommand('update_tax_income_tax_payment', {
      income_tax_payment_method: 'other',
      income_tax_other_payment_text: modalDraft.income_tax_other_payment_text,
    });
  };

  const handleVatPaymentMethodChange = (value: string) => {
    setSaveError('');
    const v = value || null;
    if (v === 'credit') {
      vatCreditModalCancelReverts.current = true;
      setModalDraft((s) => ({
        ...s,
        vat_payment_method: 'credit',
        vat_other_payment_text: null,
      }));
      setVatCard({
        card_number: '',
        expiry: '',
        card_holder_name:
          snapshot.vat_card_holder_name ?? snapshot.client_display_name ?? '',
      });
      setVatPaymentCreditModalOpen(true);
      return;
    }
    if (v === 'other') {
      vatOtherModalCancelReverts.current = true;
      setModalDraft((s) => ({
        ...s,
        vat_payment_method: 'other',
      }));
      setVatPaymentOtherModalOpen(true);
      return;
    }
    setVatPaymentCreditModalOpen(false);
    setVatPaymentOtherModalOpen(false);
    setModalDraft((s) => ({
      ...s,
      vat_payment_method: v,
      vat_other_payment_text: v === 'other' ? s.vat_other_payment_text : null,
    }));
    setVatCard({ card_number: '', expiry: '', card_holder_name: '' });
  };

  const handleVatCreditModalCancel = () => {
    setVatPaymentCreditModalOpen(false);
    if (vatCreditModalCancelReverts.current) {
      setModalDraft((s) => ({
        ...s,
        vat_payment_method: snapshot.vat_payment_method,
        vat_other_payment_text: snapshot.vat_other_payment_text,
      }));
    }
    vatCreditModalCancelReverts.current = true;
    setVatCard({ card_number: '', expiry: '', card_holder_name: '' });
  };

  const handleVatOtherModalCancel = () => {
    setVatPaymentOtherModalOpen(false);
    if (vatOtherModalCancelReverts.current) {
      setModalDraft((s) => ({
        ...s,
        vat_payment_method: snapshot.vat_payment_method,
        vat_other_payment_text: snapshot.vat_other_payment_text,
      }));
    }
    vatOtherModalCancelReverts.current = true;
  };

  const handleIncomeTaxPaymentMethodChange = (value: string) => {
    setSaveError('');
    const v = value || null;
    if (v === 'credit') {
      itCreditModalCancelReverts.current = true;
      setModalDraft((s) => ({
        ...s,
        income_tax_payment_method: 'credit',
        income_tax_other_payment_text: null,
      }));
      setItCard({
        card_number: '',
        expiry: '',
        card_holder_name:
          snapshot.income_tax_card_holder_name ??
          snapshot.client_display_name ??
          '',
      });
      setIncomeTaxPaymentCreditModalOpen(true);
      return;
    }
    if (v === 'other') {
      itOtherModalCancelReverts.current = true;
      setModalDraft((s) => ({
        ...s,
        income_tax_payment_method: 'other',
      }));
      setIncomeTaxPaymentOtherModalOpen(true);
      return;
    }
    setIncomeTaxPaymentCreditModalOpen(false);
    setIncomeTaxPaymentOtherModalOpen(false);
    setModalDraft((s) => ({
      ...s,
      income_tax_payment_method: v,
      income_tax_other_payment_text: v === 'other' ? s.income_tax_other_payment_text : null,
    }));
    setItCard({ card_number: '', expiry: '', card_holder_name: '' });
  };

  const handleItCreditModalCancel = () => {
    setIncomeTaxPaymentCreditModalOpen(false);
    if (itCreditModalCancelReverts.current) {
      setModalDraft((s) => ({
        ...s,
        income_tax_payment_method: snapshot.income_tax_payment_method,
        income_tax_other_payment_text: snapshot.income_tax_other_payment_text,
      }));
    }
    itCreditModalCancelReverts.current = true;
    setItCard({ card_number: '', expiry: '', card_holder_name: '' });
  };

  const handleItOtherModalCancel = () => {
    setIncomeTaxPaymentOtherModalOpen(false);
    if (itOtherModalCancelReverts.current) {
      setModalDraft((s) => ({
        ...s,
        income_tax_payment_method: snapshot.income_tax_payment_method,
        income_tax_other_payment_text: snapshot.income_tax_other_payment_text,
      }));
    }
    itOtherModalCancelReverts.current = true;
  };

  const handleIncomeTaxAdvanceSelectChange = (v: 'choose' | 'yes' | 'no') => {
    setSaveError('');
    if (v === 'yes') {
      setModalDraft((s) => ({
        ...s,
        income_tax_advance_ui_selection: 'yes',
        income_tax_advance_enabled: true,
      }));
      setActiveSectionModal('income_tax_advances');
      return;
    }
    setActiveSectionModal(null);
    // Optimistic draft; `update_tax_income_advances` persists server-side.
    setModalDraft((s) => ({
      ...s,
      income_tax_advance_ui_selection: v,
      income_tax_advance_enabled: false,
      income_tax_advance_percent: null,
      income_tax_advance_frequency: null,
    }));
    void runTaxCommand('update_tax_income_advances', {
      income_tax_advance_ui_selection: v,
      income_tax_advance_enabled: false,
      income_tax_advance_percent: null,
      income_tax_advance_frequency: null,
    });
  };

  const handleAdvanceModalSave = () => {
    void runTaxCommand('update_tax_income_advances', {
      income_tax_advance_ui_selection: 'yes',
      income_tax_advance_enabled: true,
      income_tax_advance_percent: modalDraft.income_tax_advance_percent,
      income_tax_advance_frequency: modalDraft.income_tax_advance_frequency,
    });
  };

  const handleAdvanceModalCancel = () => {
    setActiveSectionModal(null);
    setModalDraft((s) => ({
      ...s,
      income_tax_advance_enabled: snapshot.income_tax_advance_enabled,
      income_tax_advance_percent: snapshot.income_tax_advance_percent,
      income_tax_advance_frequency: snapshot.income_tax_advance_frequency,
      income_tax_advance_ui_selection:
        snapshot.income_tax_advance_ui_selection ??
        (snapshot.income_tax_advance_enabled ? 'yes' : 'choose'),
    }));
  };

  const handleIncomeTaxDeductionsSelectChange = (v: 'choose' | 'yes' | 'no') => {
    setSaveError('');
    if (v === 'yes') {
      setModalDraft((s) => ({
        ...s,
        income_tax_deductions_ui_selection: 'yes',
        income_tax_deductions_enabled: true,
      }));
      setActiveSectionModal('income_tax_deductions');
      return;
    }
    setActiveSectionModal(null);
    setModalDraft((s) => ({
      ...s,
      income_tax_deductions_ui_selection: v,
      income_tax_deductions_enabled: false,
      income_tax_deductions_file_number: null,
      income_tax_deductions_frequency: null,
    }));
    void runTaxCommand('update_tax_income_deductions', {
      income_tax_deductions_ui_selection: v,
      income_tax_deductions_enabled: false,
      income_tax_deductions_file_number: null,
      income_tax_deductions_frequency: null,
    });
  };

  const handleDeductionsModalSave = () => {
    void runTaxCommand('update_tax_income_deductions', {
      income_tax_deductions_ui_selection: 'yes',
      income_tax_deductions_enabled: true,
      income_tax_deductions_file_number: modalDraft.income_tax_deductions_file_number,
      income_tax_deductions_frequency: modalDraft.income_tax_deductions_frequency,
    });
  };

  const handleDeductionsModalCancel = () => {
    setActiveSectionModal(null);
    setModalDraft((s) => ({
      ...s,
      income_tax_deductions_enabled: snapshot.income_tax_deductions_enabled,
      income_tax_deductions_file_number: snapshot.income_tax_deductions_file_number,
      income_tax_deductions_frequency: snapshot.income_tax_deductions_frequency,
      income_tax_deductions_ui_selection:
        snapshot.income_tax_deductions_ui_selection ??
        (snapshot.income_tax_deductions_enabled ? 'yes' : 'choose'),
    }));
  };

  const handleNationalInsuranceSelectChange = (v: string) => {
    setSaveError('');
    if (v === 'yes') {
      setModalDraft((s) => ({
        ...s,
        national_insurance_type: 'yes',
      }));
      setActiveSectionModal('national_insurance');
      return;
    }
    setActiveSectionModal(null);
    if (v === 'not_applicable') {
      setModalDraft((s) => ({
        ...s,
        national_insurance_type: 'not_applicable',
        national_insurance_monthly_amount: null,
      }));
      void runTaxCommand('update_tax_national_insurance', {
        national_insurance_type: 'not_applicable',
        national_insurance_monthly_amount: null,
      });
      return;
    }
    setModalDraft((s) => ({
      ...s,
      national_insurance_type: null,
      national_insurance_monthly_amount: null,
    }));
    void runTaxCommand('update_tax_national_insurance', {
      national_insurance_type: null,
      national_insurance_monthly_amount: null,
    });
  };

  const handleNationalInsuranceModalSave = () => {
    if (
      modalDraft.national_insurance_monthly_amount == null ||
      Number.isNaN(Number(modalDraft.national_insurance_monthly_amount))
    ) {
      setSaveError('נא להזין סכום חודשי');
      return;
    }
    setSaveError('');
    void runTaxCommand('update_tax_national_insurance', {
      national_insurance_type: 'yes',
      national_insurance_monthly_amount: modalDraft.national_insurance_monthly_amount,
    });
  };

  const handleNationalInsuranceModalCancel = () => {
    setActiveSectionModal(null);
    setModalDraft((s) => ({
      ...s,
      national_insurance_type: snapshot.national_insurance_type,
      national_insurance_monthly_amount: snapshot.national_insurance_monthly_amount,
    }));
  };

  const doRevealPaymentSecret = useCallback(
    async (paymentType: PaymentType, secretKind: SecretKind) => {
      const { value } = await apiJson<{ value: string }>(
        moduleClientOperationsTaxSettingsRevealPaymentSecret(clientId),
        {
          method: 'POST',
          body: JSON.stringify({ type: paymentType, secret_kind: secretKind }),
        }
      );
      await navigator.clipboard.writeText(value);
    },
    [clientId]
  );

  const handleSecureCopySecret = async (paymentType: PaymentType, secretKind: SecretKind) => {
    const busyKey = `${paymentType}:${secretKind}`;
    setRevealBusy(busyKey);
    setSaveError('');
    try {
      await doRevealPaymentSecret(paymentType, secretKind);
      setSaveSuccess('הועתק ללוח (גישה נרשמה ביומן)');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'SECURE_SESSION_REQUIRED') {
        try {
          const { challenge_id } = await apiJson<{ challenge_id: string; expires_in_seconds: number }>(
            moduleClientOperationsTaxSettingsPaymentCardRequestCode(clientId),
            {
              method: 'POST',
              body: JSON.stringify({ type: paymentType }),
            }
          );
          setPendingVerify({ paymentType, secretKind, challengeId: challenge_id });
          setVerifyCodeInput('');
          setVerifyModalOpen(true);
          setSaveSuccess('נשלח קוד אימות לטלפון הארגון');
        } catch (e2) {
          setSaveError(e2 instanceof Error ? e2.message : 'שגיאה');
        }
        return;
      }
      setSaveError(e instanceof Error ? e.message : 'שגיאה');
    } finally {
      setRevealBusy(null);
    }
  };

  const handleVerifyCodeSubmit = async () => {
    if (!pendingVerify) return;
    const pv = pendingVerify;
    setVerifyBusy(true);
    setSaveError('');
    try {
      await apiJson(moduleClientOperationsTaxSettingsPaymentCardVerifyCode(clientId), {
        method: 'POST',
        body: JSON.stringify({
          type: pv.paymentType,
          challenge_id: pv.challengeId,
          code: verifyCodeInput.trim(),
        }),
      });
      setVerifyModalOpen(false);
      setPendingVerify(null);
      setVerifyCodeInput('');
      await doRevealPaymentSecret(pv.paymentType, pv.secretKind);
      setSaveSuccess('הועתק ללוח (גישה נרשמה ביומן)');
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'שגיאה');
    } finally {
      setVerifyBusy(false);
    }
  };

  const handlePlainFieldCopy = async (raw: string | null | undefined) => {
    const t = (raw ?? '').trim();
    if (!t) return;
    setSaveError('');
    try {
      await navigator.clipboard.writeText(t);
      setSaveSuccess('הועתק ללוח');
    } catch {
      setSaveError('העתקה נכשלה');
    }
  };

  const ui = taxTab?.ui;
  const showVatCreditModal =
    ((ui?.vat_credit_modal ?? false) && !vatCreditServerModalDismissed) || vatPaymentCreditModalOpen;
  const showItCreditModal =
    ((ui?.income_tax_credit_modal ?? false) && !itCreditServerModalDismissed) || incomeTaxPaymentCreditModalOpen;
  /** סוג עסק עוסק פטור — מהשרת (תדירות מע״מ נעולה); לשאר: placeholder «בחר» עם class אחיד */
  const isOsekPaturBusiness = Boolean(ui?.vat_frequency_disabled);

  /** תדירות דיווח ניכויים — רק מ־`tax_tab` aggregate (`edit_model`). */
  const incomeTaxDeductionsFreqField = taxTab?.sections
    .find((sec) => sec.section_key === 'income_tax_deductions')
    ?.edit_model.fields.find((f) => f.field_key === 'income_tax_deductions_frequency');

  const visibleSections = taxTab?.sections.filter((s) => s.visible) ?? [];
  const vatRegSection = visibleSections.find((s) => s.section_key === 'vat_registration');
  const itAdvSection = visibleSections.find((s) => s.section_key === 'income_tax_advances');
  const dedSection = visibleSections.find((s) => s.section_key === 'income_tax_deductions');
  const niSection = visibleSections.find((s) => s.section_key === 'national_insurance');
  const vatPaySection = visibleSections.find((s) => s.section_key === 'vat_payment');
  const itPaySection = visibleSections.find((s) => s.section_key === 'income_tax_payment');
  const notesSection = visibleSections.find((s) => s.section_key === 'notes');

  const openSectionEditor = (key: TaxTabSectionKey) => {
    setModalDraft(cloneSettings(snapshot));
    setActiveSectionModal(key);
    setSaveError('');
  };

  const sectionCardProps = {
    isSaving,
    onOpenEditor: openSectionEditor,
    revealBusy,
    onPlainCopy: handlePlainFieldCopy,
    onSecureCopy: handleSecureCopySecret,
  } as const;

  /** שתי סעיפים בשורה (50%/50%); אם רק אחד קיים — רוחב מלא. */
  const renderPairedSections = (
    a: TaxTabSectionReadModel | undefined,
    b: TaxTabSectionReadModel | undefined
  ) => {
    if (a && b) {
      return (
        <div className="nx-taxes-section-pair-row" key={`pair-${a.section_key}-${b.section_key}`}>
          <TaxWorkspaceSectionCard sec={a} {...sectionCardProps} />
          <TaxWorkspaceSectionCard sec={b} {...sectionCardProps} />
        </div>
      );
    }
    return (
      <>
        {a ? <TaxWorkspaceSectionCard key={a.section_key} sec={a} {...sectionCardProps} /> : null}
        {b ? <TaxWorkspaceSectionCard key={b.section_key} sec={b} {...sectionCardProps} /> : null}
      </>
    );
  };

  return (
    <div className="client-profile-card">
      {!taxTab ? (
        <p style={{ padding: 16, color: '#64748b', fontWeight: 600 }}>טוען תצוגת מיסים מהשרת…</p>
      ) : (
        <div className="nx-taxes-workspace" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div
            style={{
              paddingBottom: 12,
              borderBottom: '1px solid #e2e8f0',
            }}
          >
            <h2 style={{ margin: '0 0 10px', fontSize: 18, fontWeight: 700 }}>{taxTab.header.title_he}</h2>
            <dl style={{ margin: 0 }}>
              {taxTab.header.summary_rows.map((row) => (
                <div
                  key={row.row_key}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr)',
                    gap: 8,
                    padding: '6px 0',
                    borderBottom: '1px solid #f1f5f9',
                  }}
                >
                  <dt style={{ margin: 0, fontSize: 13, color: '#64748b' }}>{row.label_he}</dt>
                  <dd style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>{row.value_he}</dd>
                </div>
              ))}
            </dl>
          </div>
          {saveSuccess ? (
            <span className="nx-workspace-save-success" role="status" aria-live="polite">
              {saveSuccess}
            </span>
          ) : null}
          {renderPairedSections(vatRegSection, itAdvSection)}
          {renderPairedSections(dedSection, niSection)}
          {renderPairedSections(vatPaySection, itPaySection)}
          {notesSection ? (
            <TaxWorkspaceSectionCard key={notesSection.section_key} sec={notesSection} {...sectionCardProps} />
          ) : null}
        </div>
      )}

      {saveError ? (
        <p style={{ color: '#b91c1c', fontWeight: 700, margin: '10px 0 0', fontSize: 14 }}>{saveError}</p>
      ) : null}

      {vatRegistrationModalOpen ? (
        <div className="nx-modal-overlay" style={{ zIndex: 10000 }} role="presentation">
          <div className="nx-modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="nx-modal-header">
              <h3 className="nx-modal-title">רישום מע״מ</h3>
            </div>
            <div className="nx-modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label style={{ fontSize: 13, fontWeight: 600 }}>
                  מע״מ
                  <select
                    value={modalDraft.vat_type ?? ''}
                    onChange={(e) =>
                      setModalDraft((s) => ({ ...s, vat_type: e.target.value ? e.target.value : null }))
                    }
                    className={!isOsekPaturBusiness && !modalDraft.vat_type ? 'client-field-select-choose' : undefined}
                    style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db' }}
                  >
                    <option value="">{isOsekPaturBusiness ? '—' : 'בחר'}</option>
                    <option value="yes">כן</option>
                    <option value="no">לא</option>
                    <option value="patur">פטור</option>
                  </select>
                </label>
                <label style={{ fontSize: 13, fontWeight: 600 }}>
                  תדירות מע״מ
                  <select
                    value={modalDraft.vat_frequency ?? ''}
                    onChange={(e) =>
                      setModalDraft((s) => ({ ...s, vat_frequency: e.target.value ? e.target.value : null }))
                    }
                    disabled={Boolean(ui?.vat_frequency_disabled)}
                    style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db' }}
                  >
                    <option value="">{isOsekPaturBusiness ? '—' : 'בחר'}</option>
                    <option value="monthly">חודשי</option>
                    <option value="bi_monthly">דו-חודשי</option>
                    <option value="not_relevant">לא רלוונטי</option>
                  </select>
                </label>
                {!ui?.osek_patur_vat_due ? (
                  <label style={{ fontSize: 13, fontWeight: 600 }}>
                    יום יעד למע״מ
                    <select
                      value={modalDraft.vat_due_type ?? ''}
                      onChange={(e) =>
                        setModalDraft((s) => ({ ...s, vat_due_type: e.target.value ? e.target.value : null }))
                      }
                      style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db' }}
                    >
                      <option value="">{isOsekPaturBusiness ? '—' : 'בחר'}</option>
                      <option value="pcn">PCN</option>
                      <option value="regular">רגיל</option>
                      <option value="not_relevant">לא רלוונטי</option>
                    </select>
                  </label>
                ) : (
                  <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
                    {ui?.osek_patur_vat_due?.date_display_he}
                  </p>
                )}
              </div>
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer">
              <button
                type="button"
                className="nx-btn nx-btn-primary"
                onClick={() => void handleSaveVatRegistration()}
                disabled={isSaving}
              >
                שמירה
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-secondary"
                onClick={() => setActiveSectionModal(null)}
                disabled={isSaving}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {notesModalOpen ? (
        <div className="nx-modal-overlay" style={{ zIndex: 10000 }} role="presentation">
          <div className="nx-modal" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
            <div className="nx-modal-header">
              <h3 className="nx-modal-title">הערות</h3>
            </div>
            <div className="nx-modal-body">
              <textarea
                value={modalDraft.notes ?? ''}
                onChange={(e) => setModalDraft((s) => ({ ...s, notes: e.target.value || null }))}
                rows={6}
                style={{ width: '100%', padding: 10, borderRadius: 6, border: '1px solid #d1d5db' }}
              />
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer">
              <button
                type="button"
                className="nx-btn nx-btn-primary"
                onClick={() => void handleSaveNotes()}
                disabled={isSaving}
              >
                שמירה
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-secondary"
                onClick={() => setActiveSectionModal(null)}
                disabled={isSaving}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {vatPaymentEditorOpen ? (
        <div className="nx-modal-overlay" style={{ zIndex: 10000 }} role="presentation">
          <div className="nx-modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="nx-modal-header">
              <h3 className="nx-modal-title">תשלום מע״מ</h3>
            </div>
            <div className="nx-modal-body">
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 12 }}>
                שיטת תשלום
                <select
                  value={modalDraft.vat_payment_method ?? ''}
                  onChange={(e) => handleVatPaymentMethodChange(e.target.value)}
                  style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db' }}
                >
                  <option value="">בחר</option>
                  <option value="credit">אשראי</option>
                  <option value="bank_order">הוראת קבע</option>
                  <option value="voucher">שובר</option>
                  <option value="other">אחר</option>
                </select>
              </label>
              {modalDraft.vat_payment_method === 'other' ? (
                <textarea
                  value={modalDraft.vat_other_payment_text ?? ''}
                  onChange={(e) =>
                    setModalDraft((s) => ({ ...s, vat_other_payment_text: e.target.value || null }))
                  }
                  rows={3}
                  placeholder="תיאור"
                  style={{ width: '100%', marginTop: 8 }}
                />
              ) : null}
              <p style={{ fontSize: 12, color: '#64748b', marginTop: 10 }}>
                לאשראי: אחרי בחירה ייפתח חלון להזנת כרטיס (אם נדרש).
              </p>
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer">
              <button
                type="button"
                className="nx-btn nx-btn-primary"
                onClick={() => void handleSaveVatPaymentEditor()}
                disabled={isSaving}
              >
                שמירה
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-secondary"
                onClick={() => {
                  setActiveSectionModal(null);
                  setModalDraft(cloneSettings(snapshot));
                }}
                disabled={isSaving}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {incomeTaxPaymentEditorOpen ? (
        <div className="nx-modal-overlay" style={{ zIndex: 10000 }} role="presentation">
          <div className="nx-modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <div className="nx-modal-header">
              <h3 className="nx-modal-title">תשלום מס הכנסה</h3>
            </div>
            <div className="nx-modal-body">
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 12 }}>
                שיטת תשלום
                <select
                  value={modalDraft.income_tax_payment_method ?? ''}
                  onChange={(e) => handleIncomeTaxPaymentMethodChange(e.target.value)}
                  style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db' }}
                >
                  <option value="">בחר</option>
                  <option value="credit">אשראי</option>
                  <option value="bank_order">הוראת קבע</option>
                  <option value="voucher">שובר</option>
                  <option value="other">אחר</option>
                </select>
              </label>
              {modalDraft.income_tax_payment_method === 'other' ? (
                <textarea
                  value={modalDraft.income_tax_other_payment_text ?? ''}
                  onChange={(e) =>
                    setModalDraft((s) => ({ ...s, income_tax_other_payment_text: e.target.value || null }))
                  }
                  rows={3}
                  style={{ width: '100%', marginTop: 8 }}
                />
              ) : null}
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer">
              <button
                type="button"
                className="nx-btn nx-btn-primary"
                onClick={() => void handleSaveIncomeTaxPaymentEditor()}
                disabled={isSaving}
              >
                שמירה
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-secondary"
                onClick={() => {
                  setActiveSectionModal(null);
                  setModalDraft(cloneSettings(snapshot));
                }}
                disabled={isSaving}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* מקדמות — חלון מרכזי (שרת מסמן חוסר / או בחירת כן) */}
      {(ui?.income_tax_advance_modal ?? false) || advanceModalOpen ? (
        <div
          className="nx-modal-overlay"
          style={{ zIndex: 10000 }}
          role="presentation"
          onClick={() => handleAdvanceModalCancel()}
        >
          <div
            className="nx-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tax-advance-modal-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 400,
              width: 'min(92vw, 400px)',
              margin: '0 auto',
              WebkitFontSmoothing: 'antialiased',
              MozOsxFontSmoothing: 'grayscale',
              textRendering: 'optimizeLegibility',
              color: '#111827',
            }}
          >
            <div className="nx-modal-header" style={{ paddingBottom: 8 }}>
              <h3
                id="tax-advance-modal-title"
                className="nx-modal-title"
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                  color: '#0f172a',
                  margin: 0,
                }}
              >
                מקדמות מס הכנסה
              </h3>
            </div>
            <div className="nx-modal-body" style={{ paddingTop: 4 }}>
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#1f2937',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  marginBottom: 12,
                }}
              >
                מקדמות
                <select
                  value={
                    modalDraft.income_tax_advance_ui_selection ??
                    (modalDraft.income_tax_advance_enabled ? 'yes' : 'choose')
                  }
                  onChange={(e) =>
                    handleIncomeTaxAdvanceSelectChange(e.target.value as 'choose' | 'yes' | 'no')
                  }
                  style={{
                    padding: '7px 10px',
                    borderRadius: 6,
                    border: '1px solid #d1d5db',
                    fontSize: 13.5,
                  }}
                >
                  <option value="choose">בחר</option>
                  <option value="yes">כן</option>
                  <option value="no">לא</option>
                </select>
              </label>
              <p
                style={{
                  fontSize: 13,
                  lineHeight: 1.45,
                  color: '#374151',
                  marginBottom: 14,
                  fontWeight: 500,
                }}
              >
                יש להזין את האחוז שנקבע על ידי מס הכנסה
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#1f2937',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  אחוז
                  <input
                    type="number"
                    value={modalDraft.income_tax_advance_percent ?? ''}
                    onChange={(e) =>
                      setModalDraft((s) => ({
                        ...s,
                        income_tax_advance_percent: e.target.value === '' ? null : Number(e.target.value),
                      }))
                    }
                    style={{
                      padding: '7px 10px',
                      borderRadius: 6,
                      border: '1px solid #d1d5db',
                      fontSize: 13.5,
                      fontWeight: 500,
                      color: '#111827',
                    }}
                  />
                </label>
                <label
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#1f2937',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  תדירות דיווח
                  <select
                    value={modalDraft.income_tax_advance_frequency ?? ''}
                    onChange={(e) =>
                      setModalDraft((s) => ({
                        ...s,
                        income_tax_advance_frequency: e.target.value ? e.target.value : null,
                      }))
                    }
                    style={{
                      padding: '7px 10px',
                      borderRadius: 6,
                      border: '1px solid #d1d5db',
                      fontSize: 13.5,
                      fontWeight: 500,
                      color: '#111827',
                    }}
                  >
                    <option value="">—</option>
                    <option value="monthly">חד חודשי</option>
                    <option value="bi_monthly">דו חודשי</option>
                  </select>
                </label>
              </div>
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer">
              <button
                type="button"
                className="nx-btn nx-btn-primary"
                onClick={handleAdvanceModalSave}
                disabled={isSaving}
              >
                שמירה
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-secondary"
                onClick={handleAdvanceModalCancel}
                disabled={isSaving}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ניכויים — חלון מרכזי (שרת מסמן חוסר / או בחירת כן) */}
      {(ui?.income_tax_deductions_modal ?? false) || deductionsModalOpen ? (
        <div
          className="nx-modal-overlay"
          style={{ zIndex: 10000 }}
          role="presentation"
          onClick={() => handleDeductionsModalCancel()}
        >
          <div
            className="nx-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tax-deductions-modal-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 400,
              width: 'min(92vw, 400px)',
              margin: '0 auto',
              WebkitFontSmoothing: 'antialiased',
              MozOsxFontSmoothing: 'grayscale',
              textRendering: 'optimizeLegibility',
              color: '#111827',
            }}
          >
            <div className="nx-modal-header" style={{ paddingBottom: 8 }}>
              <h3
                id="tax-deductions-modal-title"
                className="nx-modal-title"
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                  color: '#0f172a',
                  margin: 0,
                }}
              >
                מס הכנסה ניכויים
              </h3>
            </div>
            <div className="nx-modal-body" style={{ paddingTop: 4 }}>
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#1f2937',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  marginBottom: 12,
                }}
              >
                מס הכנסה ניכויים
                <select
                  value={
                    modalDraft.income_tax_deductions_ui_selection ??
                    (modalDraft.income_tax_deductions_enabled ? 'yes' : 'choose')
                  }
                  onChange={(e) =>
                    handleIncomeTaxDeductionsSelectChange(e.target.value as 'choose' | 'yes' | 'no')
                  }
                  style={{
                    padding: '7px 10px',
                    borderRadius: 6,
                    border: '1px solid #d1d5db',
                    fontSize: 13.5,
                  }}
                >
                  <option value="choose">בחר</option>
                  <option value="yes">כן</option>
                  <option value="no">לא</option>
                </select>
              </label>
              <p
                style={{
                  fontSize: 13,
                  lineHeight: 1.45,
                  color: '#374151',
                  marginBottom: 14,
                  fontWeight: 500,
                }}
              >
                יש להזין את מספר תיק הניכויים ואת תדירות הדיווח
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#1f2937',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  תיק ניכויים
                  <input
                    value={modalDraft.income_tax_deductions_file_number ?? ''}
                    onChange={(e) =>
                      setModalDraft((s) => ({ ...s, income_tax_deductions_file_number: e.target.value || null }))
                    }
                    style={{
                      padding: '7px 10px',
                      borderRadius: 6,
                      border: '1px solid #d1d5db',
                      fontSize: 13.5,
                      fontWeight: 500,
                      color: '#111827',
                    }}
                    aria-label="תיק ניכויים"
                  />
                </label>
                <label
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: '#1f2937',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  תדירות דיווח
                  <select
                    value={modalDraft.income_tax_deductions_frequency ?? ''}
                    onChange={(e) =>
                      setModalDraft((s) => ({
                        ...s,
                        income_tax_deductions_frequency: e.target.value ? e.target.value : null,
                      }))
                    }
                    style={{
                      padding: '7px 10px',
                      borderRadius: 6,
                      border: '1px solid #d1d5db',
                      fontSize: 13.5,
                      fontWeight: 500,
                      color: '#111827',
                    }}
                  >
                    <option value="">—</option>
                    {(incomeTaxDeductionsFreqField?.options ?? []).map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label_he}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer">
              <button
                type="button"
                className="nx-btn nx-btn-primary"
                onClick={handleDeductionsModalSave}
                disabled={isSaving}
              >
                שמירה
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-secondary"
                onClick={handleDeductionsModalCancel}
                disabled={isSaving}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {(ui?.national_insurance_modal ?? false) || nationalInsuranceModalOpen ? (
        <div
          className="nx-modal-overlay"
          style={{ zIndex: 10000 }}
          role="presentation"
          onClick={() => handleNationalInsuranceModalCancel()}
        >
          <div
            className="nx-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="national-insurance-modal-title"
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: 400,
              width: 'min(92vw, 400px)',
              margin: '0 auto',
              WebkitFontSmoothing: 'antialiased',
              MozOsxFontSmoothing: 'grayscale',
              textRendering: 'optimizeLegibility',
              color: '#111827',
            }}
          >
            <div className="nx-modal-header" style={{ paddingBottom: 8 }}>
              <h3
                id="national-insurance-modal-title"
                className="nx-modal-title"
                style={{
                  fontSize: 15,
                  fontWeight: 600,
                  letterSpacing: '-0.01em',
                  color: '#0f172a',
                  margin: 0,
                }}
              >
                ביטוח לאומי עצמאי
              </h3>
            </div>
            <div className="nx-modal-body" style={{ paddingTop: 4 }}>
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#1f2937',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  marginBottom: 12,
                }}
              >
                ביטוח לאומי עצמאי
                <select
                  value={modalDraft.national_insurance_type ?? ''}
                  onChange={(e) => handleNationalInsuranceSelectChange(e.target.value)}
                  style={{
                    padding: '7px 10px',
                    borderRadius: 6,
                    border: '1px solid #d1d5db',
                    fontSize: 13.5,
                  }}
                >
                  <option value="">בחר</option>
                  <option value="yes">כן</option>
                  <option value="not_applicable">לא עונה להגדרות</option>
                </select>
              </label>
              <p
                style={{
                  fontSize: 13,
                  lineHeight: 1.45,
                  color: '#374151',
                  marginBottom: 14,
                  fontWeight: 500,
                }}
              >
                יש להזין את הסכום החודשי
              </p>
              <label
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: '#1f2937',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                }}
              >
                סכום חודשי
                <input
                  type="number"
                  value={modalDraft.national_insurance_monthly_amount ?? ''}
                  onChange={(e) =>
                    setModalDraft((s) => ({
                      ...s,
                      national_insurance_monthly_amount: e.target.value === '' ? null : Number(e.target.value),
                    }))
                  }
                  style={{
                    padding: '7px 10px',
                    borderRadius: 6,
                    border: '1px solid #d1d5db',
                    fontSize: 13.5,
                    fontWeight: 500,
                    color: '#111827',
                  }}
                />
              </label>
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer">
              <button
                type="button"
                className="nx-btn nx-btn-primary"
                onClick={handleNationalInsuranceModalSave}
                disabled={isSaving}
              >
                שמירה
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-secondary"
                onClick={handleNationalInsuranceModalCancel}
                disabled={isSaving}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showVatCreditModal ? (
        <div className="nx-modal-overlay" style={{ zIndex: 10000 }} role="presentation">
          <div className="nx-modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="nx-modal-header">
              <h3 className="nx-modal-title">פרטי אשראי — מע״מ</h3>
              <button
                type="button"
                className="nx-modal-close"
                onClick={handleVatCreditModalCancel}
                disabled={isSaving}
                aria-label="סגור"
                title="סגור"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M5 5L15 15M15 5L5 15"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            <div className="nx-modal-body">
              <p style={{ fontSize: 12, color: '#374151', margin: '0 0 10px' }}>
                ת.ז / ח.פ: <strong>{modalDraft.client_tax_id ?? '—'}</strong>
              </p>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                שם בעל הכרטיס
                <input
                  placeholder="שם כפי שמופיע על הכרטיס"
                  value={vatCard.card_holder_name ?? ''}
                  onChange={(e) => setVatCard((c) => ({ ...c, card_holder_name: e.target.value }))}
                  style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db' }}
                  autoComplete="off"
                />
              </label>
              <div className="payment-modal-card-row">
                <input
                  placeholder="מספר כרטיס"
                  value={vatCard.card_number}
                  onChange={(e) => setVatCard((c) => ({ ...c, card_number: e.target.value }))}
                  style={{ flex: 1, minWidth: 0, marginBottom: 0, padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db' }}
                  autoComplete="off"
                />
                <div className="payment-modal-card-row-brand" aria-hidden="true">
                  <PaymentCardBrandMark brand={inferCardBrandClient(vatCard.card_number)} />
                </div>
              </div>
              <input
                placeholder="תוקף MM/YY"
                value={vatCard.expiry}
                onChange={(e) => setVatCard((c) => ({ ...c, expiry: e.target.value }))}
                style={{ width: '100%', marginBottom: 4, marginTop: 8, padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db' }}
              />
              {isCardExpiryInPast(vatCard.expiry) ? (
                <p className="payment-modal-expired-hint" role="alert">
                  כרטיס פג תוקף
                </p>
              ) : null}
              <p style={{ fontSize: 12, color: '#6b7280', margin: '8px 0 0', lineHeight: 1.45 }}>
                קוד CVV אינו נשמר במערכת ויש לבקשו מהלקוח בעת התשלום
              </p>
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer">
              <button
                type="button"
                className="nx-btn nx-btn-primary"
                onClick={() => {
                  setVatCreditServerModalDismissed(true);
                  setVatPaymentCreditModalOpen(false);
                  vatCreditModalCancelReverts.current = false;
                  void runTaxCommand(
                    'update_tax_vat_payment',
                    {
                      vat_payment_method: 'credit',
                      vat_credit_card: {
                        card_number: vatCard.card_number,
                        expiry: vatCard.expiry,
                        card_holder_name: vatCard.card_holder_name?.trim() || null,
                      },
                    },
                    { reopenCreditOnError: 'vat' }
                  );
                }}
                disabled={isSaving}
              >
                שמירה
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-secondary"
                onClick={handleVatCreditModalCancel}
                disabled={isSaving}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showItCreditModal ? (
        <div className="nx-modal-overlay" style={{ zIndex: 10000 }} role="presentation">
          <div className="nx-modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="nx-modal-header">
              <h3 className="nx-modal-title">פרטי אשראי — מס הכנסה</h3>
              <button
                type="button"
                className="nx-modal-close"
                onClick={handleItCreditModalCancel}
                disabled={isSaving}
                aria-label="סגור"
                title="סגור"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path
                    d="M5 5L15 15M15 5L5 15"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </div>
            <div className="nx-modal-body">
              <p style={{ fontSize: 12, color: '#374151', margin: '0 0 6px' }}>
                ת.ז / ח.פ: <strong>{modalDraft.client_tax_id ?? '—'}</strong>
              </p>
              <p style={{ fontSize: 12, color: '#374151', margin: '0 0 10px' }}>
                תיק ניכויים: <strong>{modalDraft.income_tax_deductions_file_number ?? '—'}</strong>
              </p>
              <label style={{ fontSize: 13, fontWeight: 600, display: 'block', marginBottom: 6 }}>
                שם בעל הכרטיס
                <input
                  placeholder="שם כפי שמופיע על הכרטיס"
                  value={itCard.card_holder_name ?? ''}
                  onChange={(e) => setItCard((c) => ({ ...c, card_holder_name: e.target.value }))}
                  style={{ width: '100%', marginTop: 6, padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db' }}
                  autoComplete="off"
                />
              </label>
              <div className="payment-modal-card-row">
                <input
                  placeholder="מספר כרטיס"
                  value={itCard.card_number}
                  onChange={(e) => setItCard((c) => ({ ...c, card_number: e.target.value }))}
                  style={{ flex: 1, minWidth: 0, marginBottom: 0, padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db' }}
                  autoComplete="off"
                />
                <div className="payment-modal-card-row-brand" aria-hidden="true">
                  <PaymentCardBrandMark brand={inferCardBrandClient(itCard.card_number)} />
                </div>
              </div>
              <input
                placeholder="תוקף MM/YY"
                value={itCard.expiry}
                onChange={(e) => setItCard((c) => ({ ...c, expiry: e.target.value }))}
                style={{ width: '100%', marginBottom: 4, marginTop: 8, padding: '8px 10px', borderRadius: 6, border: '1px solid #d1d5db' }}
              />
              {isCardExpiryInPast(itCard.expiry) ? (
                <p className="payment-modal-expired-hint" role="alert">
                  כרטיס פג תוקף
                </p>
              ) : null}
              <p style={{ fontSize: 12, color: '#6b7280', margin: '8px 0 0', lineHeight: 1.45 }}>
                קוד CVV אינו נשמר במערכת ויש לבקשו מהלקוח בעת התשלום
              </p>
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer">
              <button
                type="button"
                className="nx-btn nx-btn-primary"
                onClick={() => {
                  setItCreditServerModalDismissed(true);
                  setIncomeTaxPaymentCreditModalOpen(false);
                  itCreditModalCancelReverts.current = false;
                  void runTaxCommand(
                    'update_tax_income_tax_payment',
                    {
                      income_tax_payment_method: 'credit',
                      income_tax_credit_card: {
                        card_number: itCard.card_number,
                        expiry: itCard.expiry,
                        card_holder_name: itCard.card_holder_name?.trim() || null,
                      },
                    },
                    { reopenCreditOnError: 'income_tax' }
                  );
                }}
                disabled={isSaving}
              >
                שמירה
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-secondary"
                onClick={handleItCreditModalCancel}
                disabled={isSaving}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {(ui?.vat_other_modal ?? false) || vatPaymentOtherModalOpen ? (
        <div className="nx-modal-overlay" style={{ zIndex: 10000 }} role="presentation">
          <div className="nx-modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="nx-modal-header">
              <h3 className="nx-modal-title">תיאור תשלום מע״מ</h3>
            </div>
            <div className="nx-modal-body">
              <textarea
                value={modalDraft.vat_other_payment_text ?? ''}
                onChange={(e) =>
                  setModalDraft((s) => ({ ...s, vat_other_payment_text: e.target.value || null }))
                }
                rows={3}
                style={{ width: '100%' }}
              />
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer">
              <button
                type="button"
                className="nx-btn nx-btn-primary"
                onClick={handleSaveVatOtherPayment}
                disabled={isSaving}
              >
                שמירה
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-secondary"
                onClick={handleVatOtherModalCancel}
                disabled={isSaving}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {(ui?.income_tax_other_modal ?? false) || incomeTaxPaymentOtherModalOpen ? (
        <div className="nx-modal-overlay" style={{ zIndex: 10000 }} role="presentation">
          <div className="nx-modal" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="nx-modal-header">
              <h3 className="nx-modal-title">תיאור תשלום מס הכנסה</h3>
            </div>
            <div className="nx-modal-body">
              <textarea
                value={modalDraft.income_tax_other_payment_text ?? ''}
                onChange={(e) =>
                  setModalDraft((s) => ({
                    ...s,
                    income_tax_other_payment_text: e.target.value || null,
                  }))
                }
                rows={3}
                style={{ width: '100%' }}
              />
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer">
              <button
                type="button"
                className="nx-btn nx-btn-primary"
                onClick={handleSaveIncomeOtherPayment}
                disabled={isSaving}
              >
                שמירה
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-secondary"
                onClick={handleItOtherModalCancel}
                disabled={isSaving}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {verifyModalOpen ? (
        <div className="nx-modal-overlay" style={{ zIndex: 10001 }} role="presentation">
          <div className="nx-modal" style={{ maxWidth: 400 }} onClick={(e) => e.stopPropagation()}>
            <div className="nx-modal-header">
              <h3 className="nx-modal-title">הזן קוד אימות</h3>
            </div>
            <div className="nx-modal-body">
              <p style={{ fontSize: 13, color: '#374151', marginBottom: 12 }}>
                נשלח קוד ב-SMS לטלפון הארגון הרשום בהגדרות.
              </p>
              <input
                value={verifyCodeInput}
                onChange={(e) => setVerifyCodeInput(e.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder="קוד"
                inputMode="numeric"
                autoComplete="one-time-code"
                style={{ width: '100%', padding: '10px 12px', borderRadius: 8, border: '1px solid #d1d5db' }}
              />
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer">
              <button
                type="button"
                className="nx-btn nx-btn-primary"
                onClick={() => void handleVerifyCodeSubmit()}
                disabled={verifyBusy || verifyCodeInput.trim().length < 4}
              >
                {verifyBusy ? 'מאמת…' : 'אישור'}
              </button>
              <button
                type="button"
                className="nx-btn nx-btn-secondary"
                onClick={() => {
                  setVerifyModalOpen(false);
                  setPendingVerify(null);
                  setVerifyCodeInput('');
                }}
                disabled={verifyBusy}
              >
                ביטול
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
