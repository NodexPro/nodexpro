import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(__dirname, '../apps/api/src/domains/client-operations/client-fees-tab.service.ts');
let s = fs.readFileSync(p, 'utf8');
const start = s.indexOf('function mapAgreementFields(');
const end = s.indexOf('\nfunction buildDiscountSection(');
if (start === -1 || end === -1) throw new Error('markers not found');

const replacement = `function feesTabVisibility(hasAgreement: boolean): FeesTabVisibility {
  return {
    show_agreement_details: true,
    show_service_sections: hasAgreement,
    show_discount_block: hasAgreement,
    show_financial_summary: hasAgreement,
    show_renew_section: hasAgreement,
    show_price_history: hasAgreement,
    show_recent_history: hasAgreement,
  };
}

function buildAgreementSummary(a: AgreementRow): FeesAgreementSummaryDto {
  const hasAgreement = readDbBool(a.has_agreement);
  const renewalPeriod = (a.renewal_period as string | null) ?? null;
  const st = (a.agreement_status as string | null) ?? null;
  const statusLabel = st && AGREEMENT_STATUS_LABELS[st] ? AGREEMENT_STATUS_LABELS[st] : null;
  const lines: Array<{ label_he: string; value_he: string }> = [];
  lines.push({ label_he: 'יש הסכם שכ\\"ט', value_he: hasAgreement ? 'כן' : 'לא' });
  if (hasAgreement) {
    lines.push({ label_he: 'תארי�� תחילת ההסכם', value_he: formatDateHe((a.agreement_start_date as string | null) ?? null) });
    lines.push({ label_he: 'תארי�� סיום ההסכם', value_he: formatDateHe((a.agreement_end_date as string | null) ?? null) });
    lines.push({ label_he: 'חידוש אוטומטי', value_he: readDbBool(a.auto_renewal) ? 'כן' : 'לא' });
    const rpLab = renewalPeriod && RENEWAL_PERIOD_LABELS[renewalPeriod] ? RENEWAL_PERIOD_LABELS[renewalPeriod] : '—';
    lines.push({
      label_he: 'תקופת חידוש',
      value_he: renewalPeriod === 'other' && a.renewal_period_other ? \`\${rpLab} (\${String(a.renewal_period_other)})\` : rpLab,
    });
    lines.push({ label_he: 'סטטוס הסכם', value_he: statusLabel ?? '—' });
  }
  return {
    card_title_he: 'הסכם שכ\\"ט',
    no_agreement_summary_he: hasAgreement ? null : 'לא הוגדר הסכם שכ\\"ט',
    status_chip: hasAgreement && statusLabel ? { label_he: statusLabel, token: st ?? 'unknown' } : null,
    lines,
  };
}

function buildEditModal(a: AgreementRow, canEdit: boolean): FeesEditModalDto {
  const hasAgreement = readDbBool(a.has_agreement);
  const renewalPeriod = (a.renewal_period as string | null) ?? null;
  const discountHas = readDbBool(a.discount_has);
  const discountType = (a.discount_type as string | null) ?? null;
  const defEnd = (a.default_end_action as string | null) ?? null;

  const agreementFields: FeesAgreementFieldDto[] = [
    {
      key: 'has_agreement',
      label_he: 'יש הסכם שכ\\"ט',
      type: 'radio',
      value: hasAgreement ? 'yes' : 'no',
      options: [
        { value: 'yes', label_he: 'כן' },
        { value: 'no', label_he: 'לא' },
      ],
      visible: true,
      editable: canEdit,
      modal_group: 'agreement',
    },
    {
      key: 'agreement_start_date',
      label_he: 'תארי�� תחילת ההסכם',
      type: 'date',
      value: (a.agreement_start_date as string | null) ?? null,
      visible: hasAgreement,
      editable: canEdit,
      modal_group: 'agreement',
    },
    {
      key: 'agreement_end_date',
      label_he: 'תארי�� סיום ההסכם',
      type: 'date',
      value: (a.agreement_end_date as string | null) ?? null,
      visible: hasAgreement,
      editable: canEdit,
      modal_group: 'agreement',
    },
    {
      key: 'auto_renewal',
      label_he: 'חידוש אוטומטי',
      type: 'radio',
      value: readDbBool(a.auto_renewal) ? 'yes' : 'no',
      options: [
        { value: 'yes', label_he: 'כן' },
        { value: 'no', label_he: 'לא' },
      ],
      visible: hasAgreement,
      editable: canEdit,
      modal_group: 'agreement',
    },
    {
      key: 'renewal_period',
      label_he: 'תקופת חידוש',
      type: 'select',
      value: renewalPeriod,
      options: Object.entries(RENEWAL_PERIOD_LABELS).map(([value, label_he]) => ({ value, label_he })),
      visible: hasAgreement,
      editable: canEdit,
      modal_group: 'agreement',
    },
    {
      key: 'renewal_period_other',
      label_he: 'פרטי תקופת חידוש',
      type: 'text',
      value: (a.renewal_period_other as string | null) ?? null,
      visible: hasAgreement && renewalPeriod === 'other',
      editable: canEdit,
      modal_group: 'agreement',
    },
    {
      key: 'agreement_status',
      label_he: 'סטטוס הסכם',
      type: 'select',
      value: (a.agreement_status as string | null) ?? null,
      options: Object.entries(AGREEMENT_STATUS_LABELS).map(([value, label_he]) => ({ value, label_he })),
      visible: hasAgreement,
      editable: canEdit,
      modal_group: 'agreement',
    },
  ];

  const discountFields: FeesAgreementFieldDto[] = [
    {
      key: 'discount_has',
      label_he: 'יש הנחה',
      type: 'radio',
      value: discountHas ? 'yes' : 'no',
      options: [
        { value: 'yes', label_he: 'כן' },
        { value: 'no', label_he: 'לא' },
      ],
      visible: hasAgreement,
      editable: canEdit,
      modal_group: 'discount',
    },
    {
      key: 'discount_type',
      label_he: 'סוג הנחה',
      type: 'select',
      value: discountType,
      options: [
        { value: 'percent', label_he: 'אחוז' },
        { value: 'amount', label_he: 'סכום' },
      ],
      visible: hasAgreement && discountHas,
      editable: canEdit,
      modal_group: 'discount',
    },
    {
      key: 'discount_percent',
      label_he: 'אחוז הנחה',
      type: 'number',
      value: a.discount_percent != null ? String(a.discount_percent) : null,
      visible: hasAgreement && discountHas && discountType === 'percent',
      editable: canEdit,
      modal_group: 'discount',
    },
    {
      key: 'discount_amount_ils',
      label_he: 'סכום הנחה',
      type: 'number',
      value: a.discount_amount_ils != null ? String(a.discount_amount_ils) : null,
      visible: hasAgreement && discountHas && discountType === 'amount',
      editable: canEdit,
      modal_group: 'discount',
    },
  ];

  const renewalFields: FeesAgreementFieldDto[] = [
    {
      key: 'reminder_days_before',
      label_he: 'ימים להתראה',
      type: 'number',
      value: a.reminder_days_before != null ? String(a.reminder_days_before) : null,
      visible: hasAgreement,
      editable: canEdit,
      modal_group: 'renewal',
    },
    {
      key: 'default_end_action',
      label_he: 'פעולה בסיום',
      type: 'select',
      value: defEnd,
      options: Object.entries(DEFAULT_END_ACTION_LABELS).map(([value, label_he]) => ({ value, label_he })),
      visible: hasAgreement,
      editable: canEdit,
      modal_group: 'renewal',
    },
    {
      key: 'end_action_increase_percent',
      label_he: 'אחוז העלאה',
      type: 'number',
      value: a.end_action_increase_percent != null ? String(a.end_action_increase_percent) : null,
      visible: hasAgreement && defEnd === 'increase_price_percent',
      editable: canEdit,
      modal_group: 'renewal',
    },
    {
      key: 'end_action_increase_amount_ils',
      label_he: 'סכום העלאה',
      type: 'number',
      value: a.end_action_increase_amount_ils != null ? String(a.end_action_increase_amount_ils) : null,
      visible: hasAgreement && defEnd === 'increase_price_amount',
      editable: canEdit,
      modal_group: 'renewal',
    },
  ];

  return {
    modal_title_he: 'עריכת שכ\\"ט',
    save_hint_he: 'לחצו שמירה כדי לעדכן את הלשונית מהשרת.',
    sections: [
      { section_title_he: 'הסכם שכ\\"ט', fields: agreementFields },
      { section_title_he: 'הנחה', fields: discountFields },
      { section_title_he: 'חידוש והתראות', fields: renewalFields },
    ],
  };
}
`;

s = s.slice(0, start) + replacement + s.slice(end);
fs.writeFileSync(p, s);
