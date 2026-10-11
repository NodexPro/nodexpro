import { apiJsonPublic } from './client';

/** Public landing aggregate — backend-owned module/price/trial truth (render-only on the client). */
export interface LandingShowcaseModule {
  module_code: string;
  name: string;
  tagline: string;
  availability: 'available' | 'coming_soon';
  availability_label: string;
  price: { amount: number; currency: string; billing_period: string; display: string } | null;
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

export function fetchLandingModuleShowcase(): Promise<LandingModuleShowcaseAggregate> {
  return apiJsonPublic<LandingModuleShowcaseAggregate>('/public/landing-module-showcase');
}
