import type { DashboardStatus } from './dashboard-status.js';
import type { DashboardPeriodKey } from './dashboard-office-period.pure.js';

export type DashboardOverviewQuery = {
  period?: string | null;
  locale?: string | null;
};

export type OfficeDashboardKpi = {
  key: string;
  title_he: string;
  value_he: string;
  secondary_he: string;
  href: string | null;
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
      points: OfficeDashboardChartPoint[];
    };
    client_growth: {
      title_he: string;
      hint_he: string;
      status: DashboardStatus;
      points: OfficeDashboardChartPoint[];
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
