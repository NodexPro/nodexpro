import { supabaseAdmin } from '../../db/client.js';
import { AUDIT_ACTIONS, writeAudit } from '../../shared/audit-events.js';
import { AppError, badRequest, conflict, forbidden } from '../../shared/errors.js';
import type { RequestContext } from '../../shared/context.js';
import {
  AGREEMENT_STATUS_LABELS,
  BUILT_IN_BY_CODE,
  BUILT_IN_FEE_SERVICES,
  CHANGE_REASON_LABELS,
  CHARGING_TYPE_LABELS,
  DEFAULT_END_ACTION_LABELS,
  MAX_BUILT_IN_LINES,
  MAX_CUSTOM_LINES,
  BILLING_DAY_RANGE_LABELS,
  BILLING_DAY_RANGE_ORDER,
  isAllowedBillingDayRange,
} from './client-fees-catalog.js';

function assertOrg(ctx: RequestContext): string {
  const orgId = ctx.organizationId;
  if (!orgId) throw forbidden('Active organization required');
  return orgId;
}

function hasPermission(ctx: RequestContext, p: string): boolean {
  return (ctx.membership?.permissions ?? []).includes(p);
}

function canViewFeesTab(ctx: RequestContext): boolean {
  return hasPermission(ctx, 'fees_tab.view') || hasPermission(ctx, 'client_operations.view');
}

function canEditFeesTab(ctx: RequestContext): boolean {
  return hasPermission(ctx, 'fees_tab.edit') || hasPermission(ctx, 'client_operations.edit');
}

async function ensureClientInOrg(orgId: string, clientId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('clients')
    .select('id')
    .eq('organization_id', orgId)
    .eq('id', clientId)
    .maybeSingle();
  if (error) throw new AppError(500, error.message ?? 'clients query failed', 'SUPABASE_ERROR');
  if (!data) throw forbidden('Client not found');
}

export type FeesTabMetaStrip = {
  updated_last_label_he: string;
  updated_last_display_he: string;
  updated_by_label_he: string;
  updated_by_display_he: string;
};

export type FeesTabVisibility = {
  show_agreement_details: boolean;
  show_service_sections: boolean;
  show_discount_block: boolean;
  show_financial_summary: boolean;
  show_renew_section: boolean;
  show_price_history: boolean;
  show_recent_history: boolean;
};

export type FeesModalFieldGroup = 'agreement' | 'discount' | 'renewal';

/** תנאי תצוגה במודאל בלבד — מול טיוטה מקומית; כל הסעיפים ב-AND (השרת בלבד) */
export type FeesModalFieldVisibleWhenClause = {
  field_key: string;
  any_of: string[];
};

export type FeesAgreementFieldDto = {
  key: string;
  label_he: string;
  type: 'text' | 'textarea' | 'date' | 'radio' | 'select' | 'number';
  value: string | boolean | null;
  options?: Array<{ value: string; label_he: string }>;
  visible: boolean;
  editable: boolean;
  /** מיפוי ל-PATCH / מודאל — מגיע מהשרת בלבד */
  modal_group?: FeesModalFieldGroup;
  /**
   * Modal-only: show if server visible flag is true, or if every clause matches the edit draft.
   * (Discount detail fields after choosing yes, before save.)
   */
  modal_visible_when?: FeesModalFieldVisibleWhenClause[];
};

export type FeesAgreementSummaryDto = {
  card_title_he: string;
  no_agreement_summary_he: string | null;
  status_chip: { label_he: string; token: string } | null;
  lines: Array<{ label_he: string; value_he: string }>;
};

/** מפתח יציב ללוגיקת UI — לא מבוסס על מחרוזת כותרת */
export type FeesEditModalSectionKey = 'fees_agreement' | 'fees_discount' | 'fees_renewal';

export type FeesEditModalSectionDto = {
  section_key: FeesEditModalSectionKey;
  section_title_he: string;
  fields: FeesAgreementFieldDto[];
};

export type FeesModalLinesEditorDto = {
  section_title_he: string;
  section_subtitle_he: string;
  max_lines: number;
  add_button: { label_he: string; enabled: boolean; action_key: string } | null;
  rows: Array<{ persist_line: Record<string, unknown> }>;
};

export type FeesEditModalDto = {
  modal_title_he: string;
  save_hint_he: string;
  sections: FeesEditModalSectionDto[];
  /** עריכת שורות שירות כלולים — רק במודאל; הלשונית מציגה תאים מסכם בלבד */
  included_lines_editor: FeesModalLinesEditorDto;
  custom_lines_editor: FeesModalLinesEditorDto;
};

export type FeesLineEditorLabelsDto = {
  modal_title_he: string;
  catalog_service_label_he: string;
  custom_name_label_he: string;
  charging_type_label_he: string;
  price_label_he: string;
  /** שורות כלולים — בחירת מצב מע"מ */
  vat_mode_label_he: string;
  payslip_count_label_he: string;
  unit_price_label_he: string;
  quantity_label_he: string;
  currency_label_he: string;
  line_total_label_he: string;
  active_label_he: string;
  active_option_yes_he: string;
  active_option_no_he: string;
};

export type FeesServiceRowDto = {
  line_id: string;
  /** ערכים גולמיים להחזרה ב-PATCH — ללא חישובי UI בצד לקוח. */
  persist_line: Record<string, unknown>;
  /** תאי תצוגה בלבד — מיושרים ל-column_headers_he של הטבלה */
  cells_he: string[];
  /** סה״כ לפני מע״מ בשקלים — מחושב בשרת */
  line_total_before_vat_ils: number | null;
  line_total_display_he: string;
  /** מטבע זר ללא שער תקף — ה-UI יפתח דיאלוג שער */
  exchange_rate_required: boolean;
  /** בלשונית תצוגה בלבד — ללא פעולות שורה */
  edit_action: { label_he: string; enabled: boolean } | null;
  deactivate_action: { label_he: string; enabled: boolean } | null;
};

export type FeesLineExchangeRateModalDto = {
  title_template_he: string;
  input_label_he: string;
  /** קישור קצר בטבלה כשחסר שער */
  prompt_link_he: string;
  confirm_he: string;
  cancel_he: string;
};

export type FeesTableSectionDto = {
  section_title_he: string;
  section_subtitle_he: string;
  column_headers_he: string[];
  add_button: { label_he: string; enabled: boolean; action_key: string } | null;
  rows: FeesServiceRowDto[];
  empty_state_he: string;
};

export type FeesKeyValueCardDto = {
  card_title_he: string;
  lines: Array<{ label_he: string; value_he: string; emphasize?: boolean }>;
  primary_value_he: string | null;
};

/** סיכום כספי בלבד — כולל שדות מספריים ל-DTO אגרגט */
export type FeesFinancialSummaryCardDto = FeesKeyValueCardDto & {
  total_before_vat: number;
  total_vat: number;
  total_with_vat: number;
};

export type FeesRenewalCardDto = {
  card_title_he: string;
  banner: { variant: 'neutral' | 'success' | 'warning' | 'danger'; text_he: string } | null;
  lines: Array<{ label_he: string; value_he: string }>;
};

export type FeesRecentEventDto = {
  occurred_at_he: string;
  actor_he: string;
  summary_he: string;
};

export type FeesRecentHistoryCardDto = {
  card_title_he: string;
  view_full_link: { label_he: string; anchor_element_id: string };
  events: FeesRecentEventDto[];
  empty_state_he: string;
};

export type FeesPriceHistoryRowDto = {
  service_he: string;
  old_price_he: string;
  new_price_he: string;
  valid_from_he: string;
  valid_to_he: string;
  reason_he: string;
  updated_by_he: string;
  changed_at_he: string;
};

/** עמודה בגרף — כל החישובים כאן; ה-UI רק מצייר לפי bar_height ו-direction */
export type FeesPriceHistoryBarDto = {
  x_label_he: string;
  direction: 'up' | 'down' | 'flat';
  /** 8–100 — גובה יחסי למחיר הסנאפשוט (מחיר אחרי האירוע), לא לגודל ההפרש */
  bar_height_0_100: number;
  /** שינוי בשקלים (מפורמט) — ריק כשההפרש רק ב-tooltip */
  delta_primary_he: string;
  /** לפני / אחרי האירוע (מפורמט) — לא מחושב בלקוח */
  snapshot_before_he: string;
  snapshot_after_he: string;
  /** שורות ל-tooltip — טקסט מוכן מהשרת */
  tooltip_lines_he: string[];
};

export type FeesPriceChartViewMode = 'last_15' | 'all';

export type FeesPriceHistoryChartDto = {
  subtitle_he: string;
  y_axis_hint_he: string;
  bars: FeesPriceHistoryBarDto[];
  empty_state_he: string;
  /** מצב תצוגה שהאגרגט החזיר (לריענון ולפקודות) */
  chart_view_mode: FeesPriceChartViewMode;
  /** שורה ראשונה מעל הגרף — טקסט מוכן מהשרת */
  view_caption_he: string;
  /** כשיש עוד אירועים מעבר לחלון — null כשלא רלוונטי */
  overflow_hint_he: string | null;
  toggle_last_15_label_he: string;
  toggle_all_label_he: string;
};

export type FeesPriceHistoryTableDto = {
  card_title_he: string;
  column_headers_he: string[];
  rows: FeesPriceHistoryRowDto[];
  empty_state_he: string;
  /** גרף עמודות — נתונים מוכנים לתצוגה */
  chart: FeesPriceHistoryChartDto;
  /** עוגן לקישור "היסטוריה מלאה" של מחירים */
  section_anchor_id: string;
};

export type FeesTabResponse = {
  tab_key: 'fees';
  tab_title_he: string;
  read_model_version: number;
  agreement_id: string;
  /** ערך נבחר לאחסון — מחרוזת enum בשרת בלבד */
  billing_day_range: string | null;
  permissions: { can_view: boolean; can_edit: boolean };
  meta: FeesTabMetaStrip;
  visibility: FeesTabVisibility;
  /** כרטיס סיכום בלשונית — תצוגה בלבד */
  agreement_summary: FeesAgreementSummaryDto;
  /** מבנה המודאל לעריכה — כל השדות המאושרים, מקובצים */
  edit_modal: FeesEditModalDto;
  built_in_catalog: Array<{ code: string; label_he: string }>;
  charging_type_options: Array<{ value: string; label_he: string }>;
  line_editor_labels: FeesLineEditorLabelsDto;
  /** ערכי select למצב מע"מ בשורות כלולים */
  vat_mode_options: Array<{ value: string; label_he: string }>;
  /** מטבעות לשורות שירות — מקור יחיד */
  fee_line_currency_options: Array<{ value: string; label_he: string }>;
  fee_line_exchange_rate_modal: FeesLineExchangeRateModalDto;
  included_services: FeesTableSectionDto;
  custom_services: FeesTableSectionDto;
  financial_summary: FeesFinancialSummaryCardDto;
  discount_card: FeesKeyValueCardDto;
  renewal: FeesRenewalCardDto;
  recent_history: FeesRecentHistoryCardDto;
  price_history: FeesPriceHistoryTableDto;
};

type AgreementRow = Record<string, unknown>;

function formatIls(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(Number(n))) return '—';
  return (
    new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'ILS',
      maximumFractionDigits: 0,
    }).format(Number(n)) ?? '—'
  );
}

function formatDateHe(d: string | null | undefined): string {
  if (!d) return '—';
  const dt = new Date(`${d}T00:00:00.000Z`);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('he-IL');
}

/** עמודות boolean מ-PostgREST — לא להשתמש ב-Boolean('false') שהוא true ב-JS */
function readDbBool(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (v === false || v === 0 || v == null) return false;
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === 't' || s === '1' || s === 'yes' || s === 'כן') return true;
    if (s === 'false' || s === 'f' || s === '0' || s === 'no' || s === 'לא') return false;
    return false;
  }
  return false;
}

/** שורת שירות אחרי normalize — לחישוב סה״כ כמו ב-read model */
function finLineFromPersistNorm(norm: Record<string, unknown>): {
  line_kind: string;
  catalog_code: string | null;
  charging_type: string;
  price_ils: number;
  payslip_count: number | null;
  unit_price_ils: number | null;
  line_total_ils: number | null;
  is_active: boolean;
  vat_mode: string | null;
  quantity: number;
  currency_code: string;
  exchange_rate_to_ils: number | null;
} {
  return {
    line_kind: String(norm.line_kind ?? ''),
    catalog_code: norm.catalog_code != null ? String(norm.catalog_code) : null,
    charging_type: String(norm.charging_type ?? 'monthly'),
    price_ils: Number(norm.price_ils ?? 0),
    payslip_count: norm.payslip_count != null ? Number(norm.payslip_count) : null,
    unit_price_ils: norm.unit_price_ils != null ? Number(norm.unit_price_ils) : null,
    line_total_ils: norm.line_total_ils != null ? Number(norm.line_total_ils) : null,
    is_active: Boolean(norm.is_active),
    vat_mode: norm.vat_mode != null ? String(norm.vat_mode) : null,
    quantity: feeLineQuantityFromRow(norm.quantity),
    currency_code: normalizeFeeCurrencyCode(norm.currency_code),
    exchange_rate_to_ils:
      norm.exchange_rate_to_ils != null && norm.exchange_rate_to_ils !== ''
        ? Number(norm.exchange_rate_to_ils)
        : null,
  };
}

function formatDateTimeHe(iso: string | null | undefined): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleString('he-IL');
}

function formatChartShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '—';
  return dt.toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' });
}

/** הפרש בשקלים לתצוגה על העמודה (+/−) */
function formatDeltaIlsHe(delta: number): string {
  const n = Math.round(delta);
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0,
    signDisplay: 'always',
  }).format(n);
}

/** מקסימום עמודות בגרף במצב ברירת מחדל — חיתוך רק באגרגט, לא בלקוח */
const PRICE_HISTORY_CHART_DEFAULT_LIMIT = 15;

function snapshotBarHeightsFromEffNews(effNews: number[]): number[] {
  const maxSnapshot = Math.max(1, ...effNews);
  return effNews.map((effNew) =>
    effNew <= 0 ? 8 : Math.max(8, Math.min(100, Math.round((100 * effNew) / maxSnapshot)))
  );
}

function buildPriceHistoryChart(
  history: Record<string, unknown>[],
  userLabels: Map<string, string>,
  chartView: FeesPriceChartViewMode
): FeesPriceHistoryChartDto {
  const sortedAll = [...history].sort((a, b) => {
    const ta = new Date(String(a.changed_at ?? 0)).getTime();
    const tb = new Date(String(b.changed_at ?? 0)).getTime();
    if (ta !== tb) return ta - tb;
    return String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });

  /** עדיפות: שורות totals_change — old/new = סה״כ אחרי הנחה לפני מע״מ (כמו financial_summary). אם אין (היסטוריה ישנה), גרף מכל הרשומות — ברמת שורה (ברוטו שורה) */
  const totalsRows = sortedAll.filter((h) => String(h.change_reason ?? '') === 'totals_change');
  const chartUsesTotalsOnly = totalsRows.length > 0;
  const sorted = chartUsesTotalsOnly ? totalsRows : sortedAll;

  /** null = אין ערך בצד הזה → נחשב 0 (הוספה/הסרה/רשומות ישנות) */
  function effectivePrices(h: Record<string, unknown>): { effOld: number; effNew: number; skip: boolean } {
    const ro = h.old_price_ils;
    const rn = h.new_price_ils;
    if (ro == null && rn == null) return { effOld: 0, effNew: 0, skip: true };
    const effOld = ro != null ? Number(ro) : 0;
    const effNew = rn != null ? Number(rn) : 0;
    return { effOld, effNew, skip: false };
  }

  /** רק אירועים עם הפרש סכום — רשומות 0→0 או ישנות מייצרות רעש בגרף */
  const rowsForBars = sorted.filter((h) => {
    const { effOld, effNew, skip } = effectivePrices(h);
    if (skip) return false;
    return Math.abs(effNew - effOld) > 0.01;
  });

  type BarPartial = Omit<FeesPriceHistoryBarDto, 'bar_height_0_100'>;
  const partialBars: BarPartial[] = [];
  const effNewsFull: number[] = [];

  for (const h of rowsForBars) {
    const { effOld, effNew, skip } = effectivePrices(h);
    if (skip) continue;

    const x_label_he = formatChartShortDate(String(h.changed_at ?? ''));
    const deltaNum = effNew - effOld;
    const direction: 'up' | 'down' | 'flat' = 'flat';
    const delta_primary_he = '';
    const delta_tooltip_he = formatDeltaIlsHe(deltaNum);

    const updater = userLabels.get(String(h.changed_by ?? '')) ?? '—';
    const reasonRaw = CHANGE_REASON_LABELS[String(h.change_reason)] ?? String(h.change_reason ?? '').trim();
    const service = String(h.service_display_name ?? '—').trim();
    const snapshot_before_he = formatIls(effOld);
    const snapshot_after_he = formatIls(effNew);

    const tooltip_lines_he: string[] = chartUsesTotalsOnly
      ? [
          'סה״כ אחרי הנחה לפני מע״מ',
          `היה: ${snapshot_before_he}`,
          `נהיה: ${snapshot_after_he}`,
          `השינוי: ${delta_tooltip_he}`,
          `תאריך: ${formatDateTimeHe(String(h.changed_at ?? ''))}`,
        ]
      : [
          `שירות: ${service}`,
          `היה: ${snapshot_before_he}`,
          `נהיה: ${snapshot_after_he}`,
          `השינוי: ${delta_tooltip_he} (ברוטו שורה בהיסטוריה)`,
          `תאריך: ${formatDateTimeHe(String(h.changed_at ?? ''))}`,
        ];
    if (reasonRaw && reasonRaw !== '—') {
      tooltip_lines_he.push(`סיבה: ${reasonRaw}`);
    }
    if (updater && updater !== '—') {
      tooltip_lines_he.push(`עודכן ע״י: ${updater}`);
    }

    partialBars.push({
      x_label_he,
      direction,
      delta_primary_he,
      snapshot_before_he,
      snapshot_after_he,
      tooltip_lines_he,
    });
    effNewsFull.push(effNew);
  }

  const totalBarEvents = partialBars.length;
  const takeLast =
    chartView === 'last_15' && totalBarEvents > PRICE_HISTORY_CHART_DEFAULT_LIMIT
      ? PRICE_HISTORY_CHART_DEFAULT_LIMIT
      : totalBarEvents;
  const fromIdx = totalBarEvents - takeLast;
  const slicedPartials = partialBars.slice(fromIdx);
  const slicedEff = effNewsFull.slice(fromIdx);
  const heights = snapshotBarHeightsFromEffNews(slicedEff);
  const bars: FeesPriceHistoryBarDto[] = slicedPartials.map((p, i) => ({
    ...p,
    bar_height_0_100: heights[i] ?? 8,
  }));

  const shownCount = bars.length;
  const isTruncated = chartView === 'last_15' && totalBarEvents > PRICE_HISTORY_CHART_DEFAULT_LIMIT;
  const view_caption_he =
    chartView === 'all'
      ? totalBarEvents === 0
        ? ''
        : `מוצגים כל ${totalBarEvents} השינויים`
      : isTruncated
        ? `מוצגים ${PRICE_HISTORY_CHART_DEFAULT_LIMIT} שינויים אחרונים`
        : totalBarEvents === 0
          ? ''
          : `מוצגים ${shownCount} שינויים אחרונים`;

  const overflow_hint_he = isTruncated ? 'יש עוד היסטוריה להצגה' : null;

  const subtitle_he =
    bars.length === 0
      ? ''
      : chartUsesTotalsOnly
        ? `סה״כ אחרי הנחה לפני מע״מ — ${shownCount} נקודות (כל עמודה: מחיר אחרי השינוי)`
        : `שינויי מחיר מההיסטוריה (${shownCount}) — נתונים ישנים ללא סנאפשוט סה״כ; שמירה חדשה תעדכן גרף מדויק`;

  const empty_state_he =
    sortedAll.length === 0 ? 'אין היסטוריית מחירים' : 'אין שינוי בסכום ברשומות (הפרש 0)';

  return {
    subtitle_he,
    y_axis_hint_he: chartUsesTotalsOnly
      ? 'גובה העמודה = מחיר אחרי הנחה לפני מע״מ (יחסי למחיר המקסימלי בגרף); ההפרש רק ב-tooltip'
      : 'גובה העמודה = מחיר אחרי האירוע (יחסי למקסימום בגרף); ייתכן מחיר שורה — שמירה חדשה מסנכרנת סה״כ',
    bars,
    empty_state_he,
    chart_view_mode: chartView,
    view_caption_he,
    overflow_hint_he,
    toggle_last_15_label_he: '15 אחרונים',
    toggle_all_label_he: 'הצג הכל',
  };
}

function monthlyEquivalent(price: number, chargingType: string): number {
  switch (chargingType) {
    case 'monthly':
      return price;
    case 'bi_monthly':
      return price / 2;
    case 'quarterly':
      return price / 3;
    case 'yearly':
      return price / 12;
    case 'one_time':
      return 0;
    default:
      return price;
  }
}

/** שיעור מע"מ לשכ״ט — בעתיד ניתן להזין מקונפיג */
const FEES_VAT_RATE = 0.18;

export type FeeVatMode = 'before_vat' | 'incl_vat' | 'vat_exempt';

const VAT_MODE_LABEL_HE: Record<FeeVatMode, string> = {
  before_vat: 'לפני מע"מ',
  incl_vat: 'כולל מע"מ',
  vat_exempt: 'מע"מ פטור',
};

/** אפשרויות מטבע לשורות — מקור יחיד לאגרגט ול-UI */
export const FEE_LINE_CURRENCY_OPTIONS: Array<{ value: string; label_he: string }> = [
  { value: 'ILS', label_he: 'שקל' },
  { value: 'USD', label_he: 'דולר' },
  { value: 'EUR', label_he: 'אירו' },
  { value: 'RUB', label_he: 'רובל' },
  { value: 'AED', label_he: 'דירהם' },
  { value: 'CAD', label_he: 'דולר קנדי' },
  { value: 'CHF', label_he: 'פרנק שווייצרי' },
  { value: 'JPY', label_he: 'ין יפני' },
  { value: 'CNY', label_he: 'יואן סיני' },
];

const FEE_CURRENCY_CODES = new Set(FEE_LINE_CURRENCY_OPTIONS.map((o) => o.value));

function currencyLabelHe(code: string): string {
  const c = code.trim().toUpperCase();
  return FEE_LINE_CURRENCY_OPTIONS.find((o) => o.value === c)?.label_he ?? c;
}

function normalizeFeeCurrencyCode(v: unknown): string {
  const c = String(v ?? 'ILS')
    .trim()
    .toUpperCase();
  return FEE_CURRENCY_CODES.has(c) ? c : 'ILS';
}

function normalizeFeeVatMode(v: unknown): FeeVatMode {
  const s = String(v ?? '').trim();
  if (s === 'incl_vat') return 'incl_vat';
  if (s === 'vat_exempt') return 'vat_exempt';
  return 'before_vat';
}

/** מחיר בשורה (או סה״כ תלושים) → בסיס לפני מע"מ, מע"מ, סה״כ כולל מע"מ */
function splitFeeLineVat(inputAmount: number, mode: FeeVatMode): { base: number; vat: number; gross: number } {
  if (!Number.isFinite(inputAmount) || inputAmount < 0) return { base: 0, vat: 0, gross: 0 };
  if (mode === 'vat_exempt') {
    const base = inputAmount;
    return { base, vat: 0, gross: base };
  }
  if (mode === 'incl_vat') {
    const gross = inputAmount;
    const base = gross / (1 + FEES_VAT_RATE);
    const vat = gross - base;
    return { base, vat, gross };
  }
  const base = inputAmount;
  const vat = base * FEES_VAT_RATE;
  const gross = base + vat;
  return { base, vat, gross };
}

function feeLineQuantityFromRow(q: unknown): number {
  const n = Number(q);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/** סכום בשקלים לפני פיצול מע״מ בשורה (יחידה × כמות × שער) */
function feeLineAmountIlsBeforeVatSplit(line: Record<string, unknown>): number {
  const lineKind = String(line.line_kind ?? '');
  const code = line.catalog_code != null ? String(line.catalog_code) : null;
  if (lineKind === 'built_in' && code === 'salary_by_payslips') {
    const total =
      line.line_total_ils != null && Number.isFinite(Number(line.line_total_ils))
        ? Number(line.line_total_ils)
        : Number(line.payslip_count ?? 0) * Number(line.unit_price_ils ?? 0);
    return total;
  }
  const qty = feeLineQuantityFromRow(line.quantity);
  const unit = Number(line.price_ils ?? 0);
  const cur = normalizeFeeCurrencyCode(line.currency_code);
  if (cur === 'ILS') return unit * qty;
  const rate = line.exchange_rate_to_ils != null ? Number(line.exchange_rate_to_ils) : NaN;
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return unit * qty * rate;
}

function exchangeRateRequiredForRow(r: Record<string, unknown>): boolean {
  const cur = normalizeFeeCurrencyCode(r.currency_code);
  if (cur === 'ILS') return false;
  const rate = r.exchange_rate_to_ils != null ? Number(r.exchange_rate_to_ils) : NaN;
  return !Number.isFinite(rate) || rate <= 0;
}

function feeLineRowTotalBeforeVatMeta(
  r: Record<string, unknown>,
  kind: 'built_in' | 'custom'
): { line_total_before_vat_ils: number; line_total_display_he: string } {
  const mode: FeeVatMode = kind === 'custom' ? 'before_vat' : normalizeFeeVatMode(r.vat_mode);
  const amountIls = feeLineAmountIlsBeforeVatSplit(r);
  const { base } = splitFeeLineVat(amountIls, mode);
  return { line_total_before_vat_ils: base, line_total_display_he: formatIls(base) };
}

/** ברוטו בשקלים לשורה (כמו ב-computeFinancialSummary) — לגרף ולהיסטוריה */
function lineGrossForFeesHistory(line: Record<string, unknown>): number {
  const lineKind = String(line.line_kind ?? '');
  const mode: FeeVatMode = lineKind === 'custom' ? 'before_vat' : normalizeFeeVatMode(line.vat_mode);
  const amountIls = feeLineAmountIlsBeforeVatSplit(line);
  return splitFeeLineVat(amountIls, mode).gross;
}

function yesNoHe(v: boolean | null | undefined): string {
  if (v == null) return '—';
  return v ? 'כן' : 'לא';
}

function computeFinancialSummary(
  lines: Array<{
    line_kind: string;
    catalog_code: string | null;
    charging_type: string;
    price_ils: number;
    payslip_count: number | null;
    unit_price_ils: number | null;
    line_total_ils: number | null;
    is_active: boolean;
    vat_mode: string | null;
    quantity?: number;
    currency_code?: string | null;
    exchange_rate_to_ils?: number | null;
  }>,
  discountHas: boolean,
  discountType: string | null,
  discountPercent: number | null,
  discountAmount: number | null
): {
  total_before_vat: number;
  total_vat: number;
  total_with_vat: number;
  primary_display_he: string;
  line_breakdown: Array<{ label_he: string; value_he: string }>;
} {
  let sumBase = 0;
  let sumVat = 0;

  for (const r of lines) {
    if (!r.is_active) continue;
    const mode: FeeVatMode = r.line_kind === 'custom' ? 'before_vat' : normalizeFeeVatMode(r.vat_mode);
    const rowAsLine: Record<string, unknown> = {
      line_kind: r.line_kind,
      catalog_code: r.catalog_code,
      price_ils: r.price_ils,
      payslip_count: r.payslip_count,
      unit_price_ils: r.unit_price_ils,
      line_total_ils: r.line_total_ils,
      quantity: r.quantity,
      currency_code: r.currency_code,
      exchange_rate_to_ils: r.exchange_rate_to_ils,
    };
    const amountIls = feeLineAmountIlsBeforeVatSplit(rowAsLine);
    const { base, vat } = splitFeeLineVat(amountIls, mode);
    sumBase += base;
    sumVat += vat;
  }

  let discountAmt = 0;
  if (discountHas) {
    if (discountType === 'percent' && discountPercent != null) {
      discountAmt = (sumBase * Number(discountPercent)) / 100;
    } else if (discountType === 'amount' && discountAmount != null) {
      discountAmt = Math.min(Number(discountAmount), sumBase);
    }
  }
  const factor = sumBase > 0 ? Math.max(0, sumBase - discountAmt) / sumBase : 0;
  const adjBase = sumBase * factor;
  const adjVat = sumVat * factor;
  const totalWithVat = adjBase + adjVat;

  /** פירוט לכרטיס: לפני מע"מ = בסיס לפני הנחה; הנחה = סכום בשקלים (גם כשאחוזים — מחושב מסכום הנטו לפני מע"מ); מע"מ = אחרי הנחה */
  const line_breakdown: Array<{ label_he: string; value_he: string }> = [
    { label_he: 'לפני מע"מ', value_he: formatIls(sumBase) },
  ];
  if (discountHas && discountAmt > 0) {
    line_breakdown.push({ label_he: 'הנחה', value_he: formatIls(-discountAmt) });
  }
  line_breakdown.push({ label_he: 'מע"מ', value_he: formatIls(adjVat) });

  return {
    total_before_vat: adjBase,
    total_vat: adjVat,
    total_with_vat: totalWithVat,
    primary_display_he: formatIls(totalWithVat),
    line_breakdown,
  };
}

function renewalBanner(
  hasAgreement: boolean,
  endDate: string | null,
  reminderDays: number | null
): { variant: 'neutral' | 'success' | 'warning' | 'danger'; text_he: string } | null {
  if (!hasAgreement || !endDate) return null;
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(end.getTime())) return null;
  const now = new Date();
  const msPerDay = 86400000;
  const days = Math.ceil((end.getTime() - now.getTime()) / msPerDay);
  const remind = reminderDays ?? 30;
  if (days < 0) return { variant: 'danger', text_he: `הסכם פג תוקף לפני ${Math.abs(days)} ימים` };
  if (days <= remind) return { variant: 'warning', text_he: `הסכם יפוג בעוד ${days} ימים` };
  return { variant: 'success', text_he: `הסכם פעיל; סיום ב-${formatDateHe(endDate)}` };
}

async function ensureAgreement(orgId: string, clientId: string, userId: string): Promise<AgreementRow> {
  const { data: row } = await supabaseAdmin
    .from('client_fee_agreements')
    .select('*')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .maybeSingle();
  if (row) return row as AgreementRow;
  const { data: ins, error } = await supabaseAdmin
    .from('client_fee_agreements')
    .insert({
      organization_id: orgId,
      client_id: clientId,
      updated_by: userId,
    })
    .select('*')
    .single();
  if (error || !ins) throw new AppError(500, error?.message ?? 'fee agreement insert failed', 'SUPABASE_ERROR');
  return ins as AgreementRow;
}

function buildAgreementSummary(a: AgreementRow): FeesAgreementSummaryDto {
  const hasAgreement = readDbBool(a.has_agreement);
  const billingRange = (a.billing_day_range as string | null) ?? null;
  const st = (a.agreement_status as string | null) ?? null;
  /** אם אין ערך ב-DB — מציגים פעיל (ברירת מחדל תצוגה), לא מקף */
  const statusLabel =
    st && AGREEMENT_STATUS_LABELS[st]
      ? AGREEMENT_STATUS_LABELS[st]
      : !st || String(st).trim() === ''
        ? AGREEMENT_STATUS_LABELS.active
        : '—';
  const lines: Array<{ label_he: string; value_he: string }> = [];
  if (hasAgreement) {
    lines.push({ label_he: 'סטטוס הסכם', value_he: statusLabel });
    lines.push({ label_he: 'תאריך תחילת ההסכם', value_he: formatDateHe((a.agreement_start_date as string | null) ?? null) });
    lines.push({ label_he: 'תאריך סיום ההסכם', value_he: formatDateHe((a.agreement_end_date as string | null) ?? null) });
    lines.push({ label_he: 'חידוש אוטומטי', value_he: readDbBool(a.auto_renewal) ? 'כן' : 'לא' });
    const brLab =
      billingRange && BILLING_DAY_RANGE_LABELS[billingRange] ? BILLING_DAY_RANGE_LABELS[billingRange] : '—';
    lines.push({ label_he: 'תאריך חיוב', value_he: brLab });
  }
  return {
    card_title_he: 'הסכם שכ"ט',
    no_agreement_summary_he: hasAgreement ? null : 'לא הוגדר הסכם שכ"ט',
    status_chip:
      hasAgreement && statusLabel && statusLabel !== '—'
        ? { label_he: statusLabel, token: st && AGREEMENT_STATUS_LABELS[st] ? st : 'active' }
        : null,
    lines,
  };
}

function buildFeesTabAgreementUi(
  a: AgreementRow,
  canEdit: boolean
): {
  agreement_summary: FeesAgreementSummaryDto;
  visibility: FeesTabVisibility;
  modal_title_he: string;
  save_hint_he: string;
  sections: FeesEditModalSectionDto[];
} {
  const hasAgreement = readDbBool(a.has_agreement);
  const billingRange = (a.billing_day_range as string | null) ?? null;
  const billingRangeOptions = BILLING_DAY_RANGE_ORDER.map((value) => ({
    value,
    label_he: BILLING_DAY_RANGE_LABELS[value],
  }));

  const fields: FeesAgreementFieldDto[] = [
    {
      key: 'has_agreement',
      label_he: 'יש הסכם שכ״ט',
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
      label_he: 'תאריך תחילת ההסכם',
      type: 'date',
      value: (a.agreement_start_date as string | null) ?? null,
      visible: hasAgreement,
      editable: canEdit,
      modal_group: 'agreement',
    },
    {
      key: 'agreement_end_date',
      label_he: 'תאריך סיום ההסכם',
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
      key: 'billing_day_range',
      label_he: 'תאריך חיוב',
      type: 'select',
      value: billingRange,
      options: billingRangeOptions,
      visible: hasAgreement,
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

  const visibility: FeesTabVisibility = {
    show_agreement_details: true,
    show_service_sections: hasAgreement,
    show_discount_block: hasAgreement,
    show_financial_summary: hasAgreement,
    show_renew_section: hasAgreement,
    show_price_history: hasAgreement,
    show_recent_history: hasAgreement,
  };

  const discountSec = buildDiscountSection(a, canEdit, hasAgreement);
  const renewalSec = buildRenewalSection(a, canEdit, hasAgreement);
  const discountFields = discountSec.fields.map((f) => ({ ...f, modal_group: 'discount' as const }));
  const renewalFields = renewalSec.fields.map((f) => ({ ...f, modal_group: 'renewal' as const }));

  return {
    agreement_summary: buildAgreementSummary(a),
    visibility,
    modal_title_he: 'עריכת שכ"ט',
    save_hint_he: 'שמירה מעדכנת את הלשונית לפי הנתונים מהשרת.',
    sections: [
      { section_key: 'fees_agreement', section_title_he: 'הסכם שכ"ט', fields },
      { section_key: 'fees_discount', section_title_he: 'הנחות', fields: discountFields },
      { section_key: 'fees_renewal', section_title_he: 'חידוש והתראות', fields: renewalFields },
    ],
  };
}

function buildDiscountSection(
  a: AgreementRow,
  canEdit: boolean,
  hasAgreement: boolean
): { card: FeesKeyValueCardDto; fields: FeesAgreementFieldDto[] } {
  const discountHas = readDbBool(a.discount_has);
  const discountType = (a.discount_type as string | null) ?? null;
  const fields: FeesAgreementFieldDto[] = [
    {
      key: 'discount_has',
      label_he: 'יש הנחה',
      type: 'radio',
      value: discountHas ? 'yes' : 'no',
      options: [
        { value: 'no', label_he: 'לא' },
        { value: 'yes', label_he: 'כן' },
      ],
      visible: hasAgreement,
      editable: canEdit,
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
      modal_visible_when: [{ field_key: 'discount_has', any_of: ['yes'] }],
    },
    {
      key: 'discount_percent',
      label_he: 'אחוז הנחה',
      type: 'number',
      value: a.discount_percent != null ? String(a.discount_percent) : null,
      visible: hasAgreement && discountHas && discountType === 'percent',
      editable: canEdit,
      modal_visible_when: [
        { field_key: 'discount_has', any_of: ['yes'] },
        { field_key: 'discount_type', any_of: ['percent'] },
      ],
    },
    {
      key: 'discount_amount_ils',
      label_he: 'סכום הנחה',
      type: 'number',
      value: a.discount_amount_ils != null ? String(a.discount_amount_ils) : null,
      visible: hasAgreement && discountHas && discountType === 'amount',
      editable: canEdit,
      modal_visible_when: [
        { field_key: 'discount_has', any_of: ['yes'] },
        { field_key: 'discount_type', any_of: ['amount'] },
      ],
    },
  ];
  const lines: Array<{ label_he: string; value_he: string; emphasize?: boolean }> = fields
    .filter((f) => f.visible)
    .map((f) => {
      let v = '—';
      if (f.type === 'radio') v = f.value === 'yes' ? 'כן' : f.value === 'no' ? 'לא' : '—';
      else if (f.type === 'select') {
        const opt = f.options?.find((o) => o.value === f.value);
        v = opt?.label_he ?? '—';
      } else v = f.value != null && f.value !== '' ? String(f.value) : '—';
      return { label_he: f.label_he, value_he: v };
    });
  return {
    card: {
      card_title_he: 'הנחות',
      lines,
      primary_value_he: discountHas
        ? discountType === 'percent'
          ? `${a.discount_percent ?? 0}%`
          : formatIls(Number(a.discount_amount_ils))
        : '—',
    },
    fields,
  };
}

function buildRenewalSection(
  a: AgreementRow,
  canEdit: boolean,
  hasAgreement: boolean
): { card: FeesRenewalCardDto; fields: FeesAgreementFieldDto[] } {
  const reminder = a.reminder_days_before != null ? Number(a.reminder_days_before) : null;
  const defEnd = (a.default_end_action as string | null) ?? null;
  const fields: FeesAgreementFieldDto[] = [
    {
      key: 'reminder_days_before',
      label_he: 'ימים להתראה',
      type: 'number',
      value: reminder != null ? String(reminder) : null,
      visible: hasAgreement,
      editable: canEdit,
    },
    {
      key: 'default_end_action',
      label_he: 'פעולה בסיום',
      type: 'select',
      value: defEnd,
      options: Object.entries(DEFAULT_END_ACTION_LABELS).map(([value, label_he]) => ({ value, label_he })),
      visible: hasAgreement,
      editable: canEdit,
    },
    {
      key: 'end_action_increase_percent',
      label_he: 'אחוז העלאה',
      type: 'number',
      value: a.end_action_increase_percent != null ? String(a.end_action_increase_percent) : null,
      visible: hasAgreement && defEnd === 'increase_price_percent',
      editable: canEdit,
    },
    {
      key: 'end_action_increase_amount_ils',
      label_he: 'סכום העלאה',
      type: 'number',
      value: a.end_action_increase_amount_ils != null ? String(a.end_action_increase_amount_ils) : null,
      visible: hasAgreement && defEnd === 'increase_price_amount',
      editable: canEdit,
    },
  ];
  const lines = fields
    .filter((f) => f.visible)
    .map((f) => {
      let v = '—';
      if (f.type === 'select') {
        const opt = f.options?.find((o) => o.value === f.value);
        v = opt?.label_he ?? '—';
      } else v = f.value != null && f.value !== '' ? String(f.value) : '—';
      return { label_he: f.label_he, value_he: v };
    });

  const banner = renewalBanner(
    readDbBool(a.has_agreement),
    (a.agreement_end_date as string | null) ?? null,
    reminder
  );

  return {
    card: { card_title_he: 'מעקב חידוש', banner, lines },
    fields,
  };
}

/** שורת תצוגה בלשונית — כלולים: שירות, חיוב, מחיר, מצב מע"מ, פעיל; מותאם אישית: 4 עמודות ללא מע"מ */
function tabServiceRowDto(
  r: Record<string, unknown>,
  catalogLabel: string,
  kind: 'built_in' | 'custom'
): FeesServiceRowDto {
  const catalogCode = (r.catalog_code as string | null) ?? null;
  const isPayroll = kind === 'built_in' && catalogCode === 'salary_by_payslips';
  const price = Number(r.price_ils ?? 0);
  const lineTotalPayroll =
    r.line_total_ils != null
      ? Number(r.line_total_ils)
      : Number(r.payslip_count ?? 0) * Number(r.unit_price_ils ?? 0);
  const qty = feeLineQuantityFromRow(r.quantity);
  const cur = normalizeFeeCurrencyCode(r.currency_code);
  const nameHe = kind === 'built_in' ? String((r.display_name_he as string) || catalogLabel) : String(r.display_name_he ?? '');
  const chHe = CHARGING_TYPE_LABELS[String(r.charging_type)] ?? String(r.charging_type ?? '—');
  const priceHe = isPayroll
    ? formatIls(lineTotalPayroll)
    : cur === 'ILS'
      ? formatIls(price)
      : `${price} ${currencyLabelHe(cur)}`;
  const qtyHe = isPayroll ? '—' : String(qty);
  const curHe = isPayroll ? 'שקל' : currencyLabelHe(cur);
  const activeHe = yesNoHe(Boolean(r.is_active));
  const vatMode = normalizeFeeVatMode(r.vat_mode);
  const vatModeHe = kind === 'built_in' ? VAT_MODE_LABEL_HE[vatMode] : '—';
  const tot = feeLineRowTotalBeforeVatMeta(r, kind);
  const cells_he: string[] =
    kind === 'built_in'
      ? [nameHe, chHe, priceHe, qtyHe, curHe, vatModeHe, tot.line_total_display_he, activeHe]
      : [nameHe, chHe, priceHe, qtyHe, curHe, tot.line_total_display_he, activeHe];
  const persist_line: Record<string, unknown> = {
    line_id: String(r.id),
    catalog_code: catalogCode,
    display_name_he: r.display_name_he,
    charging_type: String(r.charging_type ?? 'monthly'),
    price_ils: Number(r.price_ils ?? 0),
    payslip_count: r.payslip_count,
    unit_price_ils: r.unit_price_ils,
    is_active: Boolean(r.is_active),
    quantity: qty,
    currency_code: cur,
    exchange_rate_to_ils:
      cur === 'ILS' ? null : r.exchange_rate_to_ils != null ? Number(r.exchange_rate_to_ils) : null,
  };
  if (kind === 'built_in') {
    persist_line.vat_mode = vatMode;
  }
  return {
    line_id: String(r.id),
    persist_line,
    cells_he,
    line_total_before_vat_ils: tot.line_total_before_vat_ils,
    line_total_display_he: tot.line_total_display_he,
    exchange_rate_required: exchangeRateRequiredForRow(r),
    edit_action: null,
    deactivate_action: null,
  };
}

function persistLineFromDbRow(r: Record<string, unknown>, kind: 'built_in' | 'custom'): Record<string, unknown> {
  const qty = feeLineQuantityFromRow(r.quantity);
  const cur = normalizeFeeCurrencyCode(r.currency_code);
  const rate =
    cur === 'ILS' ? null : r.exchange_rate_to_ils != null ? Number(r.exchange_rate_to_ils) : null;
  if (kind === 'custom') {
    return {
      line_id: String(r.id),
      catalog_code: null,
      display_name_he: r.display_name_he,
      charging_type: String(r.charging_type ?? 'monthly'),
      price_ils: Number(r.price_ils ?? 0),
      payslip_count: null,
      unit_price_ils: null,
      is_active: Boolean(r.is_active),
      quantity: qty,
      currency_code: cur,
      exchange_rate_to_ils: rate,
    };
  }
  const catalogCode = (r.catalog_code as string | null) ?? null;
  return {
    line_id: String(r.id),
    catalog_code: catalogCode,
    display_name_he: r.display_name_he,
    charging_type: String(r.charging_type ?? 'monthly'),
    price_ils: Number(r.price_ils ?? 0),
    payslip_count: r.payslip_count,
    unit_price_ils: r.unit_price_ils,
    is_active: Boolean(r.is_active),
    vat_mode: normalizeFeeVatMode(r.vat_mode),
    quantity: qty,
    currency_code: cur,
    exchange_rate_to_ils: rate,
  };
}

async function loadUserLabels(userIds: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(userIds.filter(Boolean))];
  if (uniq.length === 0) return new Map();
  const { data } = await supabaseAdmin.from('users').select('id, full_name, email').in('id', uniq);
  const m = new Map<string, string>();
  for (const u of (data ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>) {
    m.set(u.id, u.full_name?.trim() ? u.full_name.trim() : u.email ?? u.id);
  }
  return m;
}

export function parseFeesPriceChartView(raw: unknown): FeesPriceChartViewMode {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (v === 'all') return 'all';
  return 'last_15';
}

export async function getFeesTabReadModel(
  ctx: RequestContext,
  clientId: string,
  feesPriceChartView: FeesPriceChartViewMode = 'last_15'
): Promise<FeesTabResponse | null> {
  const orgId = assertOrg(ctx);
  if (!canViewFeesTab(ctx)) return null;
  await ensureClientInOrg(orgId, clientId);

  const canEdit = canEditFeesTab(ctx);
  const a = await ensureAgreement(orgId, clientId, ctx.user.id);
  const agreementId = String(a.id);

  const { data: lineRows } = await supabaseAdmin
    .from('client_fee_service_lines')
    .select('*')
    .eq('agreement_id', agreementId)
    .order('sort_order', { ascending: true });

  const lines = (lineRows ?? []) as Record<string, unknown>[];
  const builtInLines = lines.filter((l) => l.line_kind === 'built_in');
  const customLines = lines.filter((l) => l.line_kind === 'custom');

  const { data: histRows } = await supabaseAdmin
    .from('client_fee_price_history')
    .select('*')
    .eq('organization_id', orgId)
    .eq('client_id', clientId)
    .order('changed_at', { ascending: false })
    .limit(400);

  const history = (histRows ?? []) as Record<string, unknown>[];
  const histUserIds = history.map((h) => String(h.changed_by ?? '')).filter(Boolean);
  const metaUserId = a.updated_by ? String(a.updated_by) : '';
  const userLabels = await loadUserLabels([...histUserIds, metaUserId]);

  const agreementUi = buildFeesTabAgreementUi(a, canEdit);
  const { agreement_summary, visibility, modal_title_he, save_hint_he, sections } = agreementUi;
  const hasAgreement = visibility.show_service_sections;

  const charging_type_options = Object.entries(CHARGING_TYPE_LABELS).map(([value, label_he]) => ({ value, label_he }));

  const included: FeesTableSectionDto = {
    section_title_he: 'שירותים כלולים',
    section_subtitle_he: `עד ${MAX_BUILT_IN_LINES} שורות`,
    column_headers_he: ['שירות', 'סוג חיוב', 'מחיר', 'כמות', 'מטבע', 'מצב מע"מ', 'סה״כ', 'פעיל', ''],
    add_button: null,
    rows: builtInLines.map((r) => {
      const code = (r.catalog_code as string | null) ?? '';
      const cat = code ? BUILT_IN_BY_CODE.get(code) : undefined;
      return tabServiceRowDto(r, cat?.label_he ?? String(r.display_name_he ?? ''), 'built_in');
    }),
    empty_state_he: 'אין שורות שירות כלולים',
  };

  const custom: FeesTableSectionDto = {
    section_title_he: 'שדות נוספים',
    section_subtitle_he: `עד ${MAX_CUSTOM_LINES} שורות`,
    column_headers_he: ['שם השירות', 'סוג חיוב', 'מחיר', 'כמות', 'מטבע', 'סה״כ', 'פעיל', ''],
    add_button: null,
    rows: customLines.map((r) => tabServiceRowDto(r, String(r.display_name_he ?? ''), 'custom')),
    empty_state_he: 'אין שדות נוספים',
  };

  const edit_modal: FeesEditModalDto = {
    modal_title_he,
    save_hint_he,
    sections,
    included_lines_editor: {
      section_title_he: 'שירותים כלולים',
      section_subtitle_he: `עד ${MAX_BUILT_IN_LINES} שורות`,
      max_lines: MAX_BUILT_IN_LINES,
      add_button: canEdit
        ? {
            label_he: 'הוסף שירות',
            enabled: builtInLines.length < MAX_BUILT_IN_LINES,
            action_key: 'add_built_in',
          }
        : null,
      rows: builtInLines.map((r) => ({ persist_line: persistLineFromDbRow(r, 'built_in') })),
    },
    custom_lines_editor: {
      section_title_he: 'שדות נוספים',
      section_subtitle_he: `עד ${MAX_CUSTOM_LINES} שורות`,
      max_lines: MAX_CUSTOM_LINES,
      add_button: canEdit
        ? {
            label_he: 'הוסף שדה',
            enabled: customLines.length < MAX_CUSTOM_LINES,
            action_key: 'add_custom',
          }
        : null,
      rows: customLines.map((r) => ({ persist_line: persistLineFromDbRow(r, 'custom') })),
    },
  };

  const fin = computeFinancialSummary(
    lines.map((l) => finLineFromPersistNorm(l)),
    readDbBool(a.discount_has),
    (a.discount_type as string | null) ?? null,
    a.discount_percent != null ? Number(a.discount_percent) : null,
    a.discount_amount_ils != null ? Number(a.discount_amount_ils) : null
  );

  const financial_summary: FeesFinancialSummaryCardDto = {
    card_title_he: 'סיכום כספי',
    primary_value_he: fin.primary_display_he,
    lines: fin.line_breakdown,
    total_before_vat: fin.total_before_vat,
    total_vat: fin.total_vat,
    total_with_vat: fin.total_with_vat,
  };

  const discountSec = buildDiscountSection(a, canEdit, hasAgreement);
  const renewalSec = buildRenewalSection(a, canEdit, hasAgreement);

  const recent_history: FeesRecentHistoryCardDto = {
    card_title_he: 'היסטוריית שינויים',
    view_full_link: { label_he: 'צפה בהיסטוריה מלאה', anchor_element_id: 'fees-recent-history-anchor' },
    events: history.map((h) => ({
      occurred_at_he: formatDateTimeHe(h.changed_at as string),
      actor_he: userLabels.get(String(h.changed_by ?? '')) ?? '—',
      summary_he: buildHistorySummaryHe(h),
    })),
    empty_state_he: 'אין אירועים אחרונים',
  };

  const price_history: FeesPriceHistoryTableDto = {
    card_title_he: 'היסטוריית מחירים',
    column_headers_he: ['שירות', 'מחיר קודם', 'מחיר חדש', 'תוקף מ-', 'תוקף עד', 'סיבה', 'עודכן ע״י', 'תאריך שינוי'],
    rows: history.map((h) => ({
      service_he: String(h.service_display_name ?? '—'),
      old_price_he: h.old_price_ils != null ? formatIls(Number(h.old_price_ils)) : '—',
      new_price_he: h.new_price_ils != null ? formatIls(Number(h.new_price_ils)) : '—',
      valid_from_he: formatDateHe(h.effective_from as string | null),
      valid_to_he: formatDateHe(h.effective_to as string | null),
      reason_he: CHANGE_REASON_LABELS[String(h.change_reason)] ?? String(h.change_reason ?? '—'),
      updated_by_he: userLabels.get(String(h.changed_by ?? '')) ?? '—',
      changed_at_he: formatDateTimeHe(h.changed_at as string),
    })),
    empty_state_he: 'אין היסטוריית מחירים',
    chart: buildPriceHistoryChart(history, userLabels, feesPriceChartView),
    section_anchor_id: 'fees-price-history-chart',
  };

  const updatedBy = a.updated_by ? userLabels.get(String(a.updated_by)) ?? '—' : '—';

  return {
    tab_key: 'fees',
    tab_title_he: 'שכ״ט',
    read_model_version: Number(a.read_model_version ?? 1),
    agreement_id: agreementId,
    billing_day_range: (a.billing_day_range as string | null) ?? null,
    permissions: { can_view: true, can_edit: canEdit },
    meta: {
      updated_last_label_he: 'עודכן לאחרונה:',
      updated_last_display_he: a.updated_at ? formatDateTimeHe(String(a.updated_at)) : '—',
      updated_by_label_he: 'מאת:',
      updated_by_display_he: updatedBy,
    },
    visibility,
    agreement_summary,
    edit_modal,
    built_in_catalog: BUILT_IN_FEE_SERVICES.map((s) => ({ code: s.code, label_he: s.label_he })),
    charging_type_options,
    vat_mode_options: [
      { value: 'before_vat', label_he: 'לפני מע"מ' },
      { value: 'incl_vat', label_he: 'כולל מע"מ' },
      { value: 'vat_exempt', label_he: 'מע"מ פטור' },
    ],
    fee_line_currency_options: FEE_LINE_CURRENCY_OPTIONS,
    fee_line_exchange_rate_modal: {
      title_template_he: '1 יחידה של {currency} =',
      input_label_he: 'שער בשקלים ליחידה',
      prompt_link_he: 'שער',
      confirm_he: 'אישור',
      cancel_he: 'ביטול',
    },
    line_editor_labels: {
      modal_title_he: 'עריכת שכ"ט',
      catalog_service_label_he: 'שירות',
      custom_name_label_he: 'שם השירות',
      charging_type_label_he: 'סוג חיוב',
      price_label_he: 'מחיר',
      vat_mode_label_he: 'מצב מע"מ',
      payslip_count_label_he: 'מספר תלושים',
      unit_price_label_he: 'מחיר ליחידה',
      quantity_label_he: 'כמות',
      currency_label_he: 'מטבע',
      line_total_label_he: 'סה״כ',
      active_label_he: 'פעיל',
      active_option_yes_he: 'כן',
      active_option_no_he: 'לא',
    },
    included_services: included,
    custom_services: custom,
    financial_summary,
    discount_card: discountSec.card,
    renewal: renewalSec.card,
    recent_history: recent_history,
    price_history,
  };
}

function buildHistorySummaryHe(h: Record<string, unknown>): string {
  const reason = String(h.change_reason ?? '');
  const reasonHe = CHANGE_REASON_LABELS[reason] ?? reason;
  const svc = String(h.service_display_name ?? '').trim();
  return svc ? `${reasonHe} — ${svc}` : reasonHe;
}

/** פקודות שכ״ט — גוף אחיד; ביצוע בשרת בלבד, ללא לוגיקה בלקוח */
export type FeesTabCommandBody = {
  type: string;
  payload: Record<string, unknown>;
  expected_version: number;
  /** נראות גרף מחירים באגרגט המוחזר אחרי הפקודה */
  fees_price_chart_view?: FeesPriceChartViewMode;
};

/** אחרי מיזוג כמו ב-PATCH — ניקוי שדות הנחה/חידוש שלא רלוונטיים (לוגיקה בשרת בלבד) */
function normalizeFeeAgreementDiscountFields(row: Record<string, unknown>): void {
  const has = readDbBool(row.discount_has);
  if (!has) {
    row.discount_type = null;
    row.discount_percent = null;
    row.discount_amount_ils = null;
    return;
  }
  let t = row.discount_type != null ? String(row.discount_type) : '';
  if (t !== 'percent' && t !== 'amount') {
    const amt = row.discount_amount_ils != null ? Number(row.discount_amount_ils) : NaN;
    const pct = row.discount_percent != null ? Number(row.discount_percent) : NaN;
    if (Number.isFinite(amt) && amt > 0) {
      row.discount_type = 'amount';
      row.discount_percent = null;
      t = 'amount';
    } else if (Number.isFinite(pct) && pct > 0) {
      row.discount_type = 'percent';
      row.discount_amount_ils = null;
      t = 'percent';
    }
  }
  if (t === 'percent') {
    row.discount_amount_ils = null;
  } else if (t === 'amount') {
    row.discount_percent = null;
  }
}

function normalizeFeeAgreementRenewalFields(row: Record<string, unknown>): void {
  const endAct = String(row.default_end_action ?? '');
  if (endAct !== 'increase_price_percent') {
    row.end_action_increase_percent = null;
  }
  if (endAct !== 'increase_price_amount') {
    row.end_action_increase_amount_ils = null;
  }
}

const FEE_AGREEMENT_AUDIT_KEYS = [
  'has_agreement',
  'agreement_start_date',
  'agreement_end_date',
  'auto_renewal',
  'billing_day_range',
  'agreement_status',
  'discount_has',
  'discount_type',
  'discount_percent',
  'discount_amount_ils',
  'reminder_days_before',
  'default_end_action',
  'end_action_increase_percent',
  'end_action_increase_amount_ils',
] as const;

function feeAgreementFieldCategory(key: string): 'agreement' | 'discount' | 'renewal' {
  if (
    key === 'has_agreement' ||
    key === 'agreement_start_date' ||
    key === 'agreement_end_date' ||
    key === 'auto_renewal' ||
    key === 'billing_day_range' ||
    key === 'agreement_status'
  ) {
    return 'agreement';
  }
  if (key === 'discount_has' || key === 'discount_type' || key === 'discount_percent' || key === 'discount_amount_ils') {
    return 'discount';
  }
  return 'renewal';
}

function agreementRowValueForAudit(row: AgreementRow, key: string): unknown {
  if (key === 'has_agreement' || key === 'auto_renewal' || key === 'discount_has') return readDbBool(row[key]);
  return row[key];
}

async function auditFeesTabLineCommand(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  agreementId: string,
  command: string,
  payload: Record<string, unknown>
): Promise<void> {
  await writeAudit({
    organizationId: orgId,
    actorUserId: ctx.user.id,
    moduleCode: 'client-operations',
    entityType: 'client_fee_agreement',
    entityId: agreementId,
    action: AUDIT_ACTIONS.CLIENT_FEE_AGREEMENT_UPDATED,
    payload: {
      command,
      client_id: clientId,
      agreement_id: agreementId,
      domain: 'client_fee_agreement',
      ...payload,
    },
  });
}

function buildFeeAgreementAuditPayload(
  clientId: string,
  agreementId: string,
  before: AgreementRow,
  after: Record<string, unknown>
): { categories: string[]; changes: Array<{ field: string; from: unknown; to: unknown; scope: string }> } | null {
  const changes: Array<{ field: string; from: unknown; to: unknown; scope: string }> = [];
  const catSet = new Set<string>();
  for (const key of FEE_AGREEMENT_AUDIT_KEYS) {
    const from = agreementRowValueForAudit(before, key);
    const to = after[key];
    if (JSON.stringify(from ?? null) === JSON.stringify(to ?? null)) continue;
    const scope = feeAgreementFieldCategory(key);
    catSet.add(scope);
    changes.push({ field: key, from, to, scope });
  }
  if (changes.length === 0) return null;
  return {
    categories: [...catSet],
    changes,
  };
}

async function updateFeeAgreementCommand(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  payload: Record<string, unknown>,
  expectedVersion: number
): Promise<void> {
  const rawAg = payload.agreement;
  if (rawAg == null || typeof rawAg !== 'object' || Array.isArray(rawAg)) {
    throw badRequest('חסר agreement בפקודה');
  }
  const ag = rawAg as Record<string, unknown>;

  const a = await ensureAgreement(orgId, clientId, ctx.user.id);
  const curV = Number(a.read_model_version ?? 1);
  if (Number(expectedVersion) !== curV) throw conflict('גרסה לא עדכנית', 'VERSION_CONFLICT');

  const agreementId = String(a.id);
  const linesForTotals = await loadServiceLinesForAgreement(agreementId);
  const totalBeforeNet = totalNetAfterDiscountBeforeVatFromDbLinesAndAgreement(a, linesForTotals);

  const prevBilling = (a.billing_day_range as string | null) ?? null;
  let nextBilling: string | null;
  if (ag.billing_day_range === undefined) {
    nextBilling = prevBilling;
  } else if (ag.billing_day_range === '' || ag.billing_day_range == null) {
    nextBilling = null;
  } else if (!isAllowedBillingDayRange(ag.billing_day_range)) {
    throw badRequest('תאריך חיוב לא חוקי');
  } else {
    nextBilling = ag.billing_day_range as string;
  }

  const nextAgreement: Record<string, unknown> = {
    has_agreement: ag.has_agreement !== undefined ? readDbBool(ag.has_agreement) : readDbBool(a.has_agreement),
    agreement_start_date: ag.agreement_start_date ?? a.agreement_start_date,
    agreement_end_date: ag.agreement_end_date ?? a.agreement_end_date,
    auto_renewal: ag.auto_renewal !== undefined ? readDbBool(ag.auto_renewal) : readDbBool(a.auto_renewal),
    billing_day_range: nextBilling,
    agreement_status: ag.agreement_status ?? a.agreement_status,
    pricing_basis: null,
    pricing_basis_other: null,
    price_set_by: null,
    not_included_in_price: null,
    last_price_update_date: null,
    agreement_notes: null,
    discount_has: ag.discount_has !== undefined ? readDbBool(ag.discount_has) : readDbBool(a.discount_has),
    discount_type: ag.discount_type !== undefined ? ag.discount_type : a.discount_type,
    discount_percent: ag.discount_percent !== undefined ? ag.discount_percent : a.discount_percent,
    discount_amount_ils: ag.discount_amount_ils !== undefined ? ag.discount_amount_ils : a.discount_amount_ils,
    reminder_days_before: ag.reminder_days_before !== undefined ? ag.reminder_days_before : a.reminder_days_before,
    default_end_action: ag.default_end_action !== undefined ? ag.default_end_action : a.default_end_action,
    end_action_increase_percent:
      ag.end_action_increase_percent !== undefined ? ag.end_action_increase_percent : a.end_action_increase_percent,
    end_action_increase_amount_ils:
      ag.end_action_increase_amount_ils !== undefined ? ag.end_action_increase_amount_ils : a.end_action_increase_amount_ils,
    read_model_version: curV + 1,
    updated_by: ctx.user.id,
  };

  normalizeFeeAgreementDiscountFields(nextAgreement);
  normalizeFeeAgreementRenewalFields(nextAgreement);

  /** אותו סנאפשוט כמו אחרי השמירה — לא תלוי ב-select חוזר (טיפוסים/זמינות) */
  const agreementAfterSave: AgreementRow = { ...a, ...nextAgreement } as AgreementRow;
  const totalAfterNet = totalNetAfterDiscountBeforeVatFromDbLinesAndAgreement(agreementAfterSave, linesForTotals);

  const { data: updatedRows, error: upErr } = await supabaseAdmin
    .from('client_fee_agreements')
    .update(nextAgreement)
    .eq('id', agreementId)
    .eq('organization_id', orgId)
    .eq('read_model_version', curV)
    .select('id');
  if (upErr) throw new AppError(500, upErr.message ?? 'agreement update failed', 'SUPABASE_ERROR');
  if (!updatedRows?.length) throw conflict('גרסה לא עדכנית', 'VERSION_CONFLICT');

  if (Math.abs(totalAfterNet - totalBeforeNet) > 0.01) {
    const { data: priorTotals } = await supabaseAdmin
      .from('client_fee_price_history')
      .select('id')
      .eq('agreement_id', agreementId)
      .eq('change_reason', 'totals_change')
      .limit(1);
    const hasPriorTotalsChange = (priorTotals?.length ?? 0) > 0;
    const roundedBefore = Math.round(totalBeforeNet * 100) / 100;
    const roundedAfter = Math.round(totalAfterNet * 100) / 100;
    const rows: Array<Record<string, unknown>> = [];
    if (!hasPriorTotalsChange && roundedBefore > 0.01) {
      rows.push({
        organization_id: orgId,
        client_id: clientId,
        agreement_id: agreementId,
        service_line_id: null,
        service_display_name: 'סה״כ אחרי הנחה לפני מע״מ',
        old_price_ils: 0,
        new_price_ils: roundedBefore,
        effective_from: effectiveFromToday(),
        effective_to: null,
        change_reason: 'totals_change',
        changed_by: ctx.user.id,
        notes: null,
      });
    }
    rows.push({
      organization_id: orgId,
      client_id: clientId,
      agreement_id: agreementId,
      service_line_id: null,
      service_display_name: 'סה״כ אחרי הנחה לפני מע״מ',
      old_price_ils: roundedBefore,
      new_price_ils: roundedAfter,
      effective_from: effectiveFromToday(),
      effective_to: null,
      change_reason: 'totals_change',
      changed_by: ctx.user.id,
      notes: null,
    });
    await insertClientFeePriceHistoryRows(rows);
  }

  const auditPayload = buildFeeAgreementAuditPayload(clientId, agreementId, a, nextAgreement);
  if (auditPayload) {
    await writeAudit({
      organizationId: orgId,
      actorUserId: ctx.user.id,
      moduleCode: 'client-operations',
      entityType: 'client_fee_agreement',
      entityId: agreementId,
      action: AUDIT_ACTIONS.CLIENT_FEE_AGREEMENT_UPDATED,
      payload: {
        command: 'update_fee_agreement',
        client_id: clientId,
        agreement_id: agreementId,
        domain: 'client_fee_agreement',
        categories: auditPayload.categories,
        changes: auditPayload.changes,
      },
    });
  }
}

function normalizeFeeServiceLineRow(
  orgId: string,
  clientId: string,
  agreementId: string,
  raw: Record<string, unknown>,
  kind: 'built_in' | 'custom',
  sortOrder: number
): Record<string, unknown> {
  const catalogCode = kind === 'built_in' ? (raw.catalog_code != null ? String(raw.catalog_code) : null) : null;
  if (kind === 'built_in' && catalogCode && !BUILT_IN_BY_CODE.has(catalogCode)) throw badRequest('שירות לא חוקי');
  const built = catalogCode ? BUILT_IN_BY_CODE.get(catalogCode) : null;
  const displayName =
    kind === 'custom'
      ? String(raw.display_name_he ?? raw.name ?? '').trim() || 'שירות מותאם'
      : String(raw.display_name_he ?? built?.label_he ?? '').trim() || built?.label_he || '';
  const chargingType = String(raw.charging_type ?? 'monthly');
  if (!CHARGING_TYPE_LABELS[chargingType]) throw badRequest('סוג חיוב לא חוקי');
  const price = Number(raw.price_ils ?? 0);
  const isActive = raw.is_active !== undefined ? Boolean(raw.is_active) : true;
  let payslipCount: number | null = null;
  let unitPrice: number | null = null;
  let lineTotal: number | null = null;
  if (catalogCode === 'salary_by_payslips') {
    payslipCount = raw.payslip_count != null ? Number(raw.payslip_count) : 0;
    unitPrice = raw.unit_price_ils != null ? Number(raw.unit_price_ils) : 0;
    lineTotal = payslipCount * (unitPrice ?? 0);
  }
  const quantity = feeLineQuantityFromRow(raw.quantity);
  const currencyCode = normalizeFeeCurrencyCode(raw.currency_code);
  let exchangeRateToIls: number | null =
    raw.exchange_rate_to_ils != null && raw.exchange_rate_to_ils !== '' ? Number(raw.exchange_rate_to_ils) : null;
  if (currencyCode === 'ILS') {
    exchangeRateToIls = null;
  } else if (!Number.isFinite(Number(exchangeRateToIls)) || Number(exchangeRateToIls) <= 0) {
    throw badRequest('נדרש שער המרה חיובי לשקל עבור מטבע זר');
  }
  return {
    organization_id: orgId,
    client_id: clientId,
    agreement_id: agreementId,
    line_kind: kind,
    catalog_code: catalogCode,
    display_name_he: displayName,
    charging_type: chargingType,
    price_ils: price,
    payslip_count: payslipCount,
    unit_price_ils: unitPrice,
    line_total_ils: lineTotal,
    is_active: isActive,
    vat_mode: kind === 'built_in' ? normalizeFeeVatMode(raw.vat_mode) : 'before_vat',
    quantity,
    currency_code: currencyCode,
    exchange_rate_to_ils: exchangeRateToIls,
    line_note: null,
    sort_order: sortOrder,
  };
}

/** סה״כ אחרי הנחה, לפני מע״מ — אותו מקור כמו financial_summary.total_before_vat */
function totalNetAfterDiscountBeforeVatFromDbLinesAndAgreement(a: AgreementRow, dbLines: Record<string, unknown>[]): number {
  const finLines = dbLines.map((row) => finLineFromPersistNorm(row));
  return computeFinancialSummary(
    finLines,
    readDbBool(a.discount_has),
    (a.discount_type as string | null) ?? null,
    a.discount_percent != null ? Number(a.discount_percent) : null,
    a.discount_amount_ils != null ? Number(a.discount_amount_ils) : null
  ).total_before_vat;
}

async function loadServiceLinesForAgreement(agreementId: string): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabaseAdmin.from('client_fee_service_lines').select('*').eq('agreement_id', agreementId);
  if (error) throw new AppError(500, error.message ?? 'lines load failed', 'SUPABASE_ERROR');
  return (data ?? []) as Record<string, unknown>[];
}

async function bumpClientFeeAgreementVersion(
  orgId: string,
  agreementId: string,
  curV: number,
  userId: string
): Promise<void> {
  const { data: updatedRows, error: upErr } = await supabaseAdmin
    .from('client_fee_agreements')
    .update({ read_model_version: curV + 1, updated_by: userId })
    .eq('id', agreementId)
    .eq('organization_id', orgId)
    .eq('read_model_version', curV)
    .select('id');
  if (upErr) throw new AppError(500, upErr.message ?? 'agreement version bump failed', 'SUPABASE_ERROR');
  if (!updatedRows?.length) throw conflict('גרסה לא עדכנית', 'VERSION_CONFLICT');
}

async function insertClientFeePriceHistoryRows(rows: Array<Record<string, unknown>>): Promise<void> {
  if (rows.length === 0) return;
  const { error: hErr } = await supabaseAdmin.from('client_fee_price_history').insert(rows);
  if (hErr) throw new AppError(500, hErr.message ?? 'history insert failed', 'SUPABASE_ERROR');
}

function effectiveFromToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function appendTotalsChangeRowIfNeeded(
  histInserts: Array<Record<string, unknown>>,
  orgId: string,
  clientId: string,
  agreementId: string,
  userId: string,
  totalBefore: number,
  totalAfter: number
): void {
  const hadLine = histInserts.length > 0;
  if (Math.abs(totalBefore - totalAfter) > 0.01 || hadLine) {
    histInserts.push({
      organization_id: orgId,
      client_id: clientId,
      agreement_id: agreementId,
      service_line_id: null,
      service_display_name: 'סה״כ אחרי הנחה לפני מע״מ',
      old_price_ils: Math.round(totalBefore * 100) / 100,
      new_price_ils: Math.round(totalAfter * 100) / 100,
      effective_from: effectiveFromToday(),
      effective_to: null,
      change_reason: 'totals_change',
      changed_by: userId,
      notes: null,
    });
  }
}

const FEE_LINE_PATCH_KEYS = [
  'catalog_code',
  'display_name_he',
  'charging_type',
  'price_ils',
  'vat_mode',
  'is_active',
  'payslip_count',
  'unit_price_ils',
  'quantity',
  'currency_code',
  'exchange_rate_to_ils',
] as const;

function dbLineToPersistRaw(row: Record<string, unknown>): Record<string, unknown> {
  return {
    catalog_code: row.catalog_code,
    display_name_he: row.display_name_he,
    charging_type: row.charging_type,
    price_ils: row.price_ils,
    vat_mode: row.vat_mode,
    is_active: row.is_active,
    payslip_count: row.payslip_count,
    unit_price_ils: row.unit_price_ils,
    quantity: row.quantity,
    currency_code: row.currency_code,
    exchange_rate_to_ils: row.exchange_rate_to_ils,
  };
}

function mergeFeeLinePatch(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base };
  for (const k of FEE_LINE_PATCH_KEYS) {
    if (patch[k] !== undefined) out[k] = patch[k];
  }
  return out;
}

async function addFeeServiceLineCommand(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  payload: Record<string, unknown>,
  expectedVersion: number
): Promise<void> {
  const a = await ensureAgreement(orgId, clientId, ctx.user.id);
  const curV = Number(a.read_model_version ?? 1);
  if (expectedVersion !== curV) throw conflict('גרסה לא עדכנית', 'VERSION_CONFLICT');
  const agreementId = String(a.id);

  const lines = await loadServiceLinesForAgreement(agreementId);
  const builtIns = lines.filter((l) => String(l.line_kind) === 'built_in');
  if (builtIns.length >= MAX_BUILT_IN_LINES) throw badRequest(`לכל היותר ${MAX_BUILT_IN_LINES} שירותים כלולים`);

  let catalogCode = payload.catalog_code != null ? String(payload.catalog_code) : BUILT_IN_FEE_SERVICES[0]?.code ?? null;
  if (!catalogCode || !BUILT_IN_BY_CODE.has(catalogCode)) throw badRequest('שירות לא חוקי');

  const maxSort = builtIns.reduce((m, r) => Math.max(m, Number(r.sort_order ?? 0)), -1);
  const raw: Record<string, unknown> = {
    catalog_code: catalogCode,
    charging_type: 'monthly',
    price_ils: 0,
    vat_mode: 'before_vat',
    is_active: true,
    payslip_count: null,
    unit_price_ils: null,
    quantity: 1,
    currency_code: 'ILS',
    exchange_rate_to_ils: null,
  };
  const norm = normalizeFeeServiceLineRow(orgId, clientId, agreementId, raw, 'built_in', maxSort + 1);

  const totalBefore = totalNetAfterDiscountBeforeVatFromDbLinesAndAgreement(a, lines);

  const { error: insErr } = await supabaseAdmin.from('client_fee_service_lines').insert(norm);
  if (insErr) throw new AppError(500, insErr.message ?? 'insert line failed', 'SUPABASE_ERROR');

  const linesAfter = await loadServiceLinesForAgreement(agreementId);
  const totalAfter = totalNetAfterDiscountBeforeVatFromDbLinesAndAgreement(a, linesAfter);

  const histInserts: Array<Record<string, unknown>> = [];
  const gNew = lineGrossForFeesHistory(norm);
  histInserts.push({
    organization_id: orgId,
    client_id: clientId,
    agreement_id: agreementId,
    service_line_id: null,
    service_display_name: String(norm.display_name_he ?? ''),
    old_price_ils: 0,
    new_price_ils: Math.round(gNew * 100) / 100,
    effective_from: effectiveFromToday(),
    effective_to: null,
    change_reason: 'service_added',
    changed_by: ctx.user.id,
    notes: null,
  });
  appendTotalsChangeRowIfNeeded(histInserts, orgId, clientId, agreementId, ctx.user.id, totalBefore, totalAfter);
  await insertClientFeePriceHistoryRows(histInserts);
  await bumpClientFeeAgreementVersion(orgId, agreementId, curV, ctx.user.id);
  await auditFeesTabLineCommand(ctx, orgId, clientId, agreementId, 'add_fee_service_line', {
    line_kind: 'built_in',
    catalog_code: norm.catalog_code ?? null,
    display_name_he: norm.display_name_he ?? null,
    price_ils: norm.price_ils ?? null,
    charging_type: norm.charging_type ?? null,
  });
}

async function updateFeeServiceLineCommand(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  payload: Record<string, unknown>,
  expectedVersion: number
): Promise<void> {
  const lineId = payload.line_id != null ? String(payload.line_id) : '';
  if (!lineId) throw badRequest('חסר מזהה שורה');

  const a = await ensureAgreement(orgId, clientId, ctx.user.id);
  const curV = Number(a.read_model_version ?? 1);
  if (expectedVersion !== curV) throw conflict('גרסה לא עדכנית', 'VERSION_CONFLICT');
  const agreementId = String(a.id);

  const lines = await loadServiceLinesForAgreement(agreementId);
  const old = lines.find((r) => String(r.id) === lineId);
  if (!old) throw badRequest('שורה לא נמצאה');
  if (String(old.line_kind) !== 'built_in') throw badRequest('סוג שורה לא תואם');

  const patch = { ...payload };
  delete patch.line_id;
  const merged = mergeFeeLinePatch(dbLineToPersistRaw(old), patch);
  const sortOrder = Number(old.sort_order ?? 0);
  const norm = normalizeFeeServiceLineRow(orgId, clientId, agreementId, merged, 'built_in', sortOrder);

  const totalBefore = totalNetAfterDiscountBeforeVatFromDbLinesAndAgreement(a, lines);

  const { error: upErr } = await supabaseAdmin
    .from('client_fee_service_lines')
    .update(norm)
    .eq('id', lineId)
    .eq('agreement_id', agreementId)
    .eq('organization_id', orgId);
  if (upErr) throw new AppError(500, upErr.message ?? 'update line failed', 'SUPABASE_ERROR');

  const linesAfter = await loadServiceLinesForAgreement(agreementId);
  const totalAfter = totalNetAfterDiscountBeforeVatFromDbLinesAndAgreement(a, linesAfter);

  const histInserts: Array<Record<string, unknown>> = [];
  const wasActive = Boolean(old.is_active);
  const nowActive = Boolean(norm.is_active);
  if (wasActive && !nowActive) {
    const gOld = lineGrossForFeesHistory(old);
    histInserts.push({
      organization_id: orgId,
      client_id: clientId,
      agreement_id: agreementId,
      service_line_id: lineId,
      service_display_name: String(norm.display_name_he ?? ''),
      old_price_ils: Math.round(gOld * 100) / 100,
      new_price_ils: 0,
      effective_from: effectiveFromToday(),
      effective_to: null,
      change_reason: 'service_deactivated',
      changed_by: ctx.user.id,
      notes: null,
    });
  } else if (wasActive && nowActive) {
    const gOld = lineGrossForFeesHistory(old);
    const gNew = lineGrossForFeesHistory(norm);
    if (Math.abs(gOld - gNew) > 0.01) {
      histInserts.push({
        organization_id: orgId,
        client_id: clientId,
        agreement_id: agreementId,
        service_line_id: lineId,
        service_display_name: String(norm.display_name_he ?? ''),
        old_price_ils: Math.round(gOld * 100) / 100,
        new_price_ils: Math.round(gNew * 100) / 100,
        effective_from: effectiveFromToday(),
        effective_to: null,
        change_reason: 'manual',
        changed_by: ctx.user.id,
        notes: null,
      });
    }
  }
  appendTotalsChangeRowIfNeeded(histInserts, orgId, clientId, agreementId, ctx.user.id, totalBefore, totalAfter);
  await insertClientFeePriceHistoryRows(histInserts);
  await bumpClientFeeAgreementVersion(orgId, agreementId, curV, ctx.user.id);
  await auditFeesTabLineCommand(ctx, orgId, clientId, agreementId, 'update_fee_service_line', {
    line_kind: 'built_in',
    line_id: lineId,
    price_ils: norm.price_ils ?? null,
    is_active: norm.is_active ?? null,
    charging_type: norm.charging_type ?? null,
    currency_code: norm.currency_code ?? null,
  });
}

async function removeFeeServiceLineCommand(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  payload: Record<string, unknown>,
  expectedVersion: number
): Promise<void> {
  const lineId = payload.line_id != null ? String(payload.line_id) : '';
  if (!lineId) throw badRequest('חסר מזהה שורה');

  const a = await ensureAgreement(orgId, clientId, ctx.user.id);
  const curV = Number(a.read_model_version ?? 1);
  if (expectedVersion !== curV) throw conflict('גרסה לא עדכנית', 'VERSION_CONFLICT');
  const agreementId = String(a.id);

  const lines = await loadServiceLinesForAgreement(agreementId);
  const old = lines.find((r) => String(r.id) === lineId);
  if (!old) throw badRequest('שורה לא נמצאה');
  if (String(old.line_kind) !== 'built_in') throw badRequest('סוג שורה לא תואם');

  const totalBefore = totalNetAfterDiscountBeforeVatFromDbLinesAndAgreement(a, lines);
  const gOld = lineGrossForFeesHistory(old);

  const histInserts: Array<Record<string, unknown>> = [
    {
      organization_id: orgId,
      client_id: clientId,
      agreement_id: agreementId,
      service_line_id: lineId,
      service_display_name: String(old.display_name_he ?? ''),
      old_price_ils: Math.round(gOld * 100) / 100,
      new_price_ils: 0,
      effective_from: effectiveFromToday(),
      effective_to: null,
      change_reason: 'service_removed',
      changed_by: ctx.user.id,
      notes: null,
    },
  ];

  const { error: delErr } = await supabaseAdmin
    .from('client_fee_service_lines')
    .delete()
    .eq('id', lineId)
    .eq('agreement_id', agreementId)
    .eq('organization_id', orgId);
  if (delErr) throw new AppError(500, delErr.message ?? 'delete line failed', 'SUPABASE_ERROR');

  const linesAfter = await loadServiceLinesForAgreement(agreementId);
  const totalAfter = totalNetAfterDiscountBeforeVatFromDbLinesAndAgreement(a, linesAfter);
  appendTotalsChangeRowIfNeeded(histInserts, orgId, clientId, agreementId, ctx.user.id, totalBefore, totalAfter);
  await insertClientFeePriceHistoryRows(histInserts);
  await bumpClientFeeAgreementVersion(orgId, agreementId, curV, ctx.user.id);
  await auditFeesTabLineCommand(ctx, orgId, clientId, agreementId, 'remove_fee_service_line', {
    line_kind: 'built_in',
    line_id: lineId,
    display_name_he: old.display_name_he ?? null,
  });
}

async function addCustomFeeServiceLineCommand(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  payload: Record<string, unknown>,
  expectedVersion: number
): Promise<void> {
  const a = await ensureAgreement(orgId, clientId, ctx.user.id);
  const curV = Number(a.read_model_version ?? 1);
  if (expectedVersion !== curV) throw conflict('גרסה לא עדכנית', 'VERSION_CONFLICT');
  const agreementId = String(a.id);

  const lines = await loadServiceLinesForAgreement(agreementId);
  const customs = lines.filter((l) => String(l.line_kind) === 'custom');
  if (customs.length >= MAX_CUSTOM_LINES) throw badRequest(`לכל היותר ${MAX_CUSTOM_LINES} שדות נוספים`);

  const maxSort = customs.reduce((m, r) => Math.max(m, Number(r.sort_order ?? 0)), 999);
  const raw: Record<string, unknown> = {
    display_name_he: payload.display_name_he != null ? String(payload.display_name_he) : '',
    charging_type: 'monthly',
    price_ils: 0,
    is_active: true,
    quantity: 1,
    currency_code: 'ILS',
    exchange_rate_to_ils: null,
  };
  const norm = normalizeFeeServiceLineRow(orgId, clientId, agreementId, raw, 'custom', maxSort + 1);

  const totalBefore = totalNetAfterDiscountBeforeVatFromDbLinesAndAgreement(a, lines);

  const { error: insErr } = await supabaseAdmin.from('client_fee_service_lines').insert(norm);
  if (insErr) throw new AppError(500, insErr.message ?? 'insert custom line failed', 'SUPABASE_ERROR');

  const linesAfter = await loadServiceLinesForAgreement(agreementId);
  const totalAfter = totalNetAfterDiscountBeforeVatFromDbLinesAndAgreement(a, linesAfter);

  const histInserts: Array<Record<string, unknown>> = [];
  const gNew = lineGrossForFeesHistory(norm);
  histInserts.push({
    organization_id: orgId,
    client_id: clientId,
    agreement_id: agreementId,
    service_line_id: null,
    service_display_name: String(norm.display_name_he ?? ''),
    old_price_ils: 0,
    new_price_ils: Math.round(gNew * 100) / 100,
    effective_from: effectiveFromToday(),
    effective_to: null,
    change_reason: 'service_added',
    changed_by: ctx.user.id,
    notes: null,
  });
  appendTotalsChangeRowIfNeeded(histInserts, orgId, clientId, agreementId, ctx.user.id, totalBefore, totalAfter);
  await insertClientFeePriceHistoryRows(histInserts);
  await bumpClientFeeAgreementVersion(orgId, agreementId, curV, ctx.user.id);
  await auditFeesTabLineCommand(ctx, orgId, clientId, agreementId, 'add_custom_fee_service_line', {
    line_kind: 'custom',
    display_name_he: norm.display_name_he ?? null,
    price_ils: norm.price_ils ?? null,
    charging_type: norm.charging_type ?? null,
  });
}

async function updateCustomFeeServiceLineCommand(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  payload: Record<string, unknown>,
  expectedVersion: number
): Promise<void> {
  const lineId = payload.line_id != null ? String(payload.line_id) : '';
  if (!lineId) throw badRequest('חסר מזהה שורה');

  const a = await ensureAgreement(orgId, clientId, ctx.user.id);
  const curV = Number(a.read_model_version ?? 1);
  if (expectedVersion !== curV) throw conflict('גרסה לא עדכנית', 'VERSION_CONFLICT');
  const agreementId = String(a.id);

  const lines = await loadServiceLinesForAgreement(agreementId);
  const old = lines.find((r) => String(r.id) === lineId);
  if (!old) throw badRequest('שורה לא נמצאה');
  if (String(old.line_kind) !== 'custom') throw badRequest('סוג שורה לא תואם');

  const patch = { ...payload };
  delete patch.line_id;
  const merged = mergeFeeLinePatch(dbLineToPersistRaw(old), patch);
  const sortOrder = Number(old.sort_order ?? 1000);
  const norm = normalizeFeeServiceLineRow(orgId, clientId, agreementId, merged, 'custom', sortOrder);

  const totalBefore = totalNetAfterDiscountBeforeVatFromDbLinesAndAgreement(a, lines);

  const { error: upErr } = await supabaseAdmin
    .from('client_fee_service_lines')
    .update(norm)
    .eq('id', lineId)
    .eq('agreement_id', agreementId)
    .eq('organization_id', orgId);
  if (upErr) throw new AppError(500, upErr.message ?? 'update custom line failed', 'SUPABASE_ERROR');

  const linesAfter = await loadServiceLinesForAgreement(agreementId);
  const totalAfter = totalNetAfterDiscountBeforeVatFromDbLinesAndAgreement(a, linesAfter);

  const histInserts: Array<Record<string, unknown>> = [];
  const wasActive = Boolean(old.is_active);
  const nowActive = Boolean(norm.is_active);
  if (wasActive && !nowActive) {
    const gOld = lineGrossForFeesHistory(old);
    histInserts.push({
      organization_id: orgId,
      client_id: clientId,
      agreement_id: agreementId,
      service_line_id: lineId,
      service_display_name: String(norm.display_name_he ?? ''),
      old_price_ils: Math.round(gOld * 100) / 100,
      new_price_ils: 0,
      effective_from: effectiveFromToday(),
      effective_to: null,
      change_reason: 'service_deactivated',
      changed_by: ctx.user.id,
      notes: null,
    });
  } else if (wasActive && nowActive) {
    const gOld = lineGrossForFeesHistory(old);
    const gNew = lineGrossForFeesHistory(norm);
    if (Math.abs(gOld - gNew) > 0.01) {
      histInserts.push({
        organization_id: orgId,
        client_id: clientId,
        agreement_id: agreementId,
        service_line_id: lineId,
        service_display_name: String(norm.display_name_he ?? ''),
        old_price_ils: Math.round(gOld * 100) / 100,
        new_price_ils: Math.round(gNew * 100) / 100,
        effective_from: effectiveFromToday(),
        effective_to: null,
        change_reason: 'manual',
        changed_by: ctx.user.id,
        notes: null,
      });
    }
  }
  appendTotalsChangeRowIfNeeded(histInserts, orgId, clientId, agreementId, ctx.user.id, totalBefore, totalAfter);
  await insertClientFeePriceHistoryRows(histInserts);
  await bumpClientFeeAgreementVersion(orgId, agreementId, curV, ctx.user.id);
  await auditFeesTabLineCommand(ctx, orgId, clientId, agreementId, 'update_custom_fee_service_line', {
    line_kind: 'custom',
    line_id: lineId,
    price_ils: norm.price_ils ?? null,
    is_active: norm.is_active ?? null,
    charging_type: norm.charging_type ?? null,
    currency_code: norm.currency_code ?? null,
  });
}

async function removeCustomFeeServiceLineCommand(
  ctx: RequestContext,
  orgId: string,
  clientId: string,
  payload: Record<string, unknown>,
  expectedVersion: number
): Promise<void> {
  const lineId = payload.line_id != null ? String(payload.line_id) : '';
  if (!lineId) throw badRequest('חסר מזהה שורה');

  const a = await ensureAgreement(orgId, clientId, ctx.user.id);
  const curV = Number(a.read_model_version ?? 1);
  if (expectedVersion !== curV) throw conflict('גרסה לא עדכנית', 'VERSION_CONFLICT');
  const agreementId = String(a.id);

  const lines = await loadServiceLinesForAgreement(agreementId);
  const old = lines.find((r) => String(r.id) === lineId);
  if (!old) throw badRequest('שורה לא נמצאה');
  if (String(old.line_kind) !== 'custom') throw badRequest('סוג שורה לא תואם');

  const totalBefore = totalNetAfterDiscountBeforeVatFromDbLinesAndAgreement(a, lines);
  const gOld = lineGrossForFeesHistory(old);

  const histInserts: Array<Record<string, unknown>> = [
    {
      organization_id: orgId,
      client_id: clientId,
      agreement_id: agreementId,
      service_line_id: lineId,
      service_display_name: String(old.display_name_he ?? ''),
      old_price_ils: Math.round(gOld * 100) / 100,
      new_price_ils: 0,
      effective_from: effectiveFromToday(),
      effective_to: null,
      change_reason: 'service_removed',
      changed_by: ctx.user.id,
      notes: null,
    },
  ];

  const { error: delErr } = await supabaseAdmin
    .from('client_fee_service_lines')
    .delete()
    .eq('id', lineId)
    .eq('agreement_id', agreementId)
    .eq('organization_id', orgId);
  if (delErr) throw new AppError(500, delErr.message ?? 'delete custom line failed', 'SUPABASE_ERROR');

  const linesAfter = await loadServiceLinesForAgreement(agreementId);
  const totalAfter = totalNetAfterDiscountBeforeVatFromDbLinesAndAgreement(a, linesAfter);
  appendTotalsChangeRowIfNeeded(histInserts, orgId, clientId, agreementId, ctx.user.id, totalBefore, totalAfter);
  await insertClientFeePriceHistoryRows(histInserts);
  await bumpClientFeeAgreementVersion(orgId, agreementId, curV, ctx.user.id);
  await auditFeesTabLineCommand(ctx, orgId, clientId, agreementId, 'remove_custom_fee_service_line', {
    line_kind: 'custom',
    line_id: lineId,
    display_name_he: old.display_name_he ?? null,
  });
}

/**
 * פקודות שכ״ט — כל פעולה = פקודה אחת; אחרי הביצוע הנתיב קורא getClientOperationsCase.
 */
export async function executeFeesTabCommand(ctx: RequestContext, clientId: string, body: FeesTabCommandBody): Promise<void> {
  const orgId = assertOrg(ctx);
  if (!canEditFeesTab(ctx)) throw forbidden('Insufficient permission');
  await ensureClientInOrg(orgId, clientId);

  if (body == null || typeof body.type !== 'string') throw badRequest('פקודה לא תקינה');
  const ev = Number(body.expected_version);
  if (!Number.isFinite(ev)) throw badRequest('גרסה לא תקינה');
  const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : {};

  switch (body.type) {
    case 'update_fee_agreement':
      await updateFeeAgreementCommand(ctx, orgId, clientId, payload, ev);
      return;
    case 'add_fee_service_line':
      await addFeeServiceLineCommand(ctx, orgId, clientId, payload, ev);
      return;
    case 'update_fee_service_line':
      await updateFeeServiceLineCommand(ctx, orgId, clientId, payload, ev);
      return;
    case 'remove_fee_service_line':
      await removeFeeServiceLineCommand(ctx, orgId, clientId, payload, ev);
      return;
    case 'add_custom_fee_service_line':
      await addCustomFeeServiceLineCommand(ctx, orgId, clientId, payload, ev);
      return;
    case 'update_custom_fee_service_line':
      await updateCustomFeeServiceLineCommand(ctx, orgId, clientId, payload, ev);
      return;
    case 'remove_custom_fee_service_line':
      await removeCustomFeeServiceLineCommand(ctx, orgId, clientId, payload, ev);
      return;
    default:
      throw badRequest('סוג פקודה לא מוכר');
  }
}
