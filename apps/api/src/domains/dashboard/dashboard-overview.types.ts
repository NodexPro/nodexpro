import type { DashboardStatus } from './dashboard-status.js';

export interface DashboardOverview {
  summary: {
    new_clients_this_month: number;
    new_clients_last_month: number;
    new_clients_vs_last_month_pct: number | null;
    new_clients_vs_last_month_abs: number;
    total_clients: number;
    total_clients_secondary_line: string | null;

    debtors_status: DashboardStatus;
    debtors_count: number | null;
    debtors_amount: { amount: number; currency: string } | null;

    monthly_revenue_status: DashboardStatus;
    monthly_revenue: { amount: number; currency: string } | null;
  };
  charts: {
    new_clients_by_month: Array<{ month: string; count: number }>; // YYYY-MM (UTC)
    filing_schedules: {
      monthly: number | null;
      every_2_months: number | null;
      mikdamot: number | null;
      status: DashboardStatus;
    };
  };
  operations: {
    clients_per_worker: Array<{ worker_name: string; clients_count: number }> | null;
    clients_per_worker_status: DashboardStatus;
    report_deadlines: {
      as_of_date: string | null;
      overdue_total: number | null;
      monthly_overdue: number | null;
      bimonthly_overdue: number | null;
      mikdamot_overdue: number | null;
      status: DashboardStatus;
    };
  };
  organization: {
    name: string;
    trial_status: string;
    trial_ends_at: string | null;
    active_plan: string;
  };
  quick_actions: {
    can_create_client: boolean;
    can_upload_document: boolean;
    can_invite_member: boolean;
  };
}

export type DashboardOverviewPartial = {
  summary?: Partial<DashboardOverview['summary']>;
  charts?: Partial<DashboardOverview['charts']>;
  operations?: Partial<DashboardOverview['operations']>;
  organization?: Partial<DashboardOverview['organization']>;
  quick_actions?: Partial<DashboardOverview['quick_actions']>;
};

