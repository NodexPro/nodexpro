/**
 * P11.1 — Platform work-event catalog types.
 *
 * Registry metadata only. Runtime intake/mapping behavior is unchanged.
 */

export type PlatformEventOwnerModule =
  | 'income'
  | 'work_engine'
  | 'docflow'
  | 'client_operations'
  | 'client_obligations'
  | 'payroll'
  | 'vat'
  | 'annual_report';

export type PlatformEventConsumerModule = 'work_engine';

export type PlatformEventCatalogEntry = {
  event_type: string;
  owner_module: PlatformEventOwnerModule;
  schema_version: number;
  description: string;
  consumer_modules: readonly PlatformEventConsumerModule[];
};
