/**
 * Public landing — module showcase (backend-owned presentation).
 *
 * Truth sources (nothing is hardcoded in the web client):
 *   - module identity + sellable/active flags → `modules` registry
 *   - price → active `module_plans` row (lowest sort_order)
 *   - free-trial length → trial domain (`TRIAL_MONTHS` in trial.service.ts, full-platform trial)
 *
 * TEMPORARY_COMMERCIAL_CATALOG_PENDING: the *release* state (available vs coming soon) and the
 * marketing copy are not stored in the module registry yet. They live in
 * LANDING_MODULE_SHOWCASE_DEFINITIONS below until the registry owns a release-status field.
 * A registry row that is not active+sellable always downgrades a module to `coming_soon`.
 */

export type LandingModuleAvailability = 'available' | 'coming_soon';

export interface LandingShowcaseModuleRow {
  code: string;
  name: string;
  is_active: boolean;
  is_sellable: boolean;
}

export interface LandingShowcasePlanRow {
  module_code: string;
  currency: string;
  price_amount: number;
  billing_period: string;
  sort_order: number;
  is_active: boolean;
}

export interface LandingShowcaseModule {
  module_code: string;
  name: string;
  tagline: string;
  availability: LandingModuleAvailability;
  availability_label: string;
  price: {
    amount: number;
    currency: string;
    billing_period: string;
    display: string;
  } | null;
  trial_label: string | null;
  details: {
    summary: string;
    existing_heading: string;
    existing: string[];
    planned_heading: string | null;
    planned: string[];
  };
}

export interface LandingModuleShowcaseAggregate {
  aggregate_key: 'landing_module_showcase';
  locale: 'en';
  direction: 'ltr';
  trial: { months: number; label: string };
  labels: { details: string; hide_details: string; price_unavailable: string };
  modules: LandingShowcaseModule[];
}

interface ShowcaseDefinition {
  module_code: string;
  /** null → use the registry name. */
  display_name: string | null;
  release: LandingModuleAvailability;
  trial_applies: boolean;
  tagline: string;
  summary: string;
  existing: string[];
  planned: string[];
}

export const LANDING_MODULE_SHOWCASE_DEFINITIONS: readonly ShowcaseDefinition[] = [
  {
    module_code: 'client-operations',
    display_name: null,
    release: 'available',
    trial_applies: true,
    tagline: 'Run your whole client roster from one live monthly spreadsheet.',
    summary:
      'Client Operations gives accounting offices a single working grid for every client and every reporting period.',
    existing: [
      'Client registry spreadsheet with monthly period tabs',
      'Status tracking for VAT, income-tax advances, national insurance and deductions',
      'Custom columns and manual rows for work specific to your office',
      'Search, filters and printable client lists',
      'ToDo board with priorities and an archive',
      'Office and per-employee workspaces with client-level access control',
    ],
    planned: [],
  },
  {
    module_code: 'docflow',
    display_name: null,
    release: 'coming_soon',
    trial_applies: false,
    tagline: 'One place for every conversation and document request with your clients.',
    summary:
      'DocFlow connects your office and your clients around the work itself, so requests, files and replies stop living in scattered inboxes.',
    existing: [
      'Client portal invitations',
      'Client conversation threads and an office inbox',
      'Document requests and file attachments',
      'Automatic communication rules and reminders',
    ],
    planned: ['Self-serve activation and billing', 'Wider rollout to all offices'],
  },
  {
    module_code: 'invoice',
    display_name: 'Invoices',
    release: 'coming_soon',
    trial_applies: false,
    tagline: 'Issue and track income documents for your office and your clients.',
    summary:
      'Invoices lets you create income documents, deliver them and follow payment status from one workspace.',
    existing: [
      'Quotes, tax invoices and receipts',
      'Branded PDF documents',
      'Email delivery with delivery history',
      'Recurring invoices for retainer clients',
      'Payment recording against documents',
    ],
    planned: ['Self-serve activation and billing', 'Wider rollout to all offices'],
  },
];

const BILLING_PERIOD_LABEL: Record<string, string> = { month: 'month', year: 'year' };

export function formatShowcasePrice(amount: number, currency: string, billingPeriod: string): string {
  let money: string;
  try {
    money = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    money = `${amount} ${currency}`;
  }
  return `${money} / ${BILLING_PERIOD_LABEL[billingPeriod] ?? billingPeriod}`;
}

export function trialLabelForMonths(months: number): string {
  return `First ${months} ${months === 1 ? 'month' : 'months'} free`;
}

export function buildLandingModuleShowcase(input: {
  modules: LandingShowcaseModuleRow[];
  plans: LandingShowcasePlanRow[];
  trialMonths: number;
}): LandingModuleShowcaseAggregate {
  const trialLabel = trialLabelForMonths(input.trialMonths);
  const modules: LandingShowcaseModule[] = LANDING_MODULE_SHOWCASE_DEFINITIONS.map((def) => {
    const row = input.modules.find((m) => m.code === def.module_code) ?? null;
    const sellable = Boolean(row && row.is_active && row.is_sellable);
    const availability: LandingModuleAvailability =
      def.release === 'available' && sellable ? 'available' : 'coming_soon';
    const plan =
      input.plans
        .filter((p) => p.module_code === def.module_code && p.is_active)
        .sort((a, b) => a.sort_order - b.sort_order)[0] ?? null;
    const available = availability === 'available';
    return {
      module_code: def.module_code,
      name: def.display_name ?? row?.name ?? def.module_code,
      tagline: def.tagline,
      availability,
      availability_label: available ? 'Available now' : 'Coming soon',
      price: plan
        ? {
            amount: plan.price_amount,
            currency: plan.currency,
            billing_period: plan.billing_period,
            display: formatShowcasePrice(plan.price_amount, plan.currency, plan.billing_period),
          }
        : null,
      trial_label: available && def.trial_applies && input.trialMonths > 0 ? trialLabel : null,
      details: {
        summary: def.summary,
        existing_heading: available ? 'What you get today' : 'Already built',
        existing: def.existing,
        planned_heading: def.planned.length > 0 ? 'Coming next' : null,
        planned: def.planned,
      },
    };
  });
  return {
    aggregate_key: 'landing_module_showcase',
    locale: 'en',
    direction: 'ltr',
    trial: { months: input.trialMonths, label: trialLabel },
    labels: { details: 'Details', hide_details: 'Hide details', price_unavailable: 'Pricing soon' },
    modules,
  };
}
