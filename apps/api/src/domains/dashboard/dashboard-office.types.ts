import type { DashboardStatus } from './dashboard-status.js';
import type { DashboardPeriodKey } from './dashboard-office-period.pure.js';

export type DashboardOverviewQuery = {
  period?: string | null;
  locale?: string | null;
};

export type DashboardFeeBreakdownQuery = DashboardOverviewQuery & {
  q?: string | null;
  page?: string | number | null;
  page_size?: string | number | null;
  sort?: string | null;
  sort_dir?: string | null;
  filter?: string | null;
};

export type OfficeDashboardKpiAction = 'open_fee_breakdown' | 'navigate' | null;

export type OfficeDashboardKpi = {
  key: string;
  title_he: string;
  value_he: string;
  secondary_he: string;
  href: string | null;
  action_key: OfficeDashboardKpiAction;
  status: DashboardStatus;
  note_he: string | null;
};

export type OfficeDashboardMissingFeeClient = {
  client_id: string;
  display_name: string;
  indicator_he: string;
  href: string;
};

export type OfficeDashboardAttentionItem = {
  key: string;
  title_he: string;
  count: number | null;
  href: string | null;
  status: DashboardStatus;
  unavailable_he: string | null;
};

export type OfficeDashboardDeadlineRow = {
  type_he: string;
  due_date_he: string;
  clients_count: number | null;
  href: string | null;
  severity_he: string | null;
};

export type OfficeDashboardChartPoint = {
  month: string;
  label_he: string;
  value: number | null;
  established: boolean;
};

export type OfficeDashboardStatusSegment = {
  key: string;
  label_he: string;
  count: number;
  color: string;
};

export type OfficeDashboardQuickAction = {
  key: string;
  label_he: string;
  href: string;
  enabled: boolean;
};

export type OfficeDashboardSection = {
  title_he: string;
  subtitle_he: string;
  period: {
    key: DashboardPeriodKey;
    label_he: string;
    start_date: string;
    end_date: string;
    options: Array<{ key: DashboardPeriodKey; label_he: string; selected: boolean }>;
  };
  kpis: {
    active_clients: OfficeDashboardKpi;
    expected_fees: OfficeDashboardKpi;
    office_debtors: OfficeDashboardKpi;
    new_clients: OfficeDashboardKpi;
    clients_left: OfficeDashboardKpi;
  };
  expected_fees_diagnostics: {
    completeness: 'complete' | 'incomplete' | 'unavailable';
    completeness_he: string;
    total_before_discount_he: string | null;
    discount_total_he: string | null;
    opens_breakdown: boolean;
  };
  missing_fees: {
    title_he: string;
    status: DashboardStatus;
    count: number;
    count_label_he: string;
    list_cap: number;
    truncated: boolean;
    truncated_he: string | null;
    empty_he: string;
    view_all_label_he: string;
    view_all_action: OfficeDashboardKpiAction;
    clients: OfficeDashboardMissingFeeClient[];
  };
  attention: {
    title_he: string;
    items: OfficeDashboardAttentionItem[];
  };
  deadlines: {
    title_he: string;
    status: DashboardStatus;
    unavailable_he: string;
    rows: OfficeDashboardDeadlineRow[];
  };
  charts: {
    expected_fees_by_month: {
      title_he: string;
      status: DashboardStatus;
      historical_basis_he: string;
      currency: 'ILS';
      occupy_primary: boolean;
      points: OfficeDashboardChartPoint[];
    };
    client_growth: {
      title_he: string;
      hint_he: string;
      status: DashboardStatus;
      points: OfficeDashboardChartPoint[];
      departed_points: OfficeDashboardChartPoint[];
    };
  };
  client_status: {
    title_he: string;
    segments: OfficeDashboardStatusSegment[];
  };
  recent_activity: {
    title_he: string;
    status: DashboardStatus;
    unavailable_he: string;
    events: [];
  };
  quick_actions: {
    title_he: string;
    collected_cash_note_he: string;
    actions: OfficeDashboardQuickAction[];
  };
};

export type OfficeFeeBreakdownRow = {
  client_id: string;
  display_name: string;
  href: string;
  agreement_status_he: string;
  billing_frequency_he: string;
  recurring_before_discount_he: string;
  discount_he: string;
  monthly_before_vat_he: string;
  calculation_status_he: string;
  category: string;
  expandable: boolean;
  lines: Array<{
    charging_type_he: string;
    monthly_before_vat_he: string;
  }>;
};

export type OfficeFeeBreakdownAggregate = {
  title_he: string;
  period: OfficeDashboardSection['period'];
  office_total: {
    status: DashboardStatus;
    completeness: 'complete' | 'incomplete' | 'unavailable';
    completeness_he: string;
    value_he: string;
    before_discount_he: string | null;
    discount_he: string | null;
    note_he: string | null;
  };
  columns: Array<{ key: string; label_he: string }>;
  filters: Array<{ key: string; label_he: string }>;
  search_placeholder_he: string;
  empty_he: string;
  page_label_he: string;
  rows: OfficeFeeBreakdownRow[];
  pagination: {
    page: number;
    page_size: number;
    total: number;
    total_pages: number;
    sort: string;
    sort_dir: 'asc' | 'desc';
    filter: string;
    q: string;
  };
};
