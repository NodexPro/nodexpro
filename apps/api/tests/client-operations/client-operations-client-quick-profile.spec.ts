/**
 * Client Operations — Client Quick Profile source contracts (no network).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const service = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-client-quick-profile.service.ts'),
  'utf8'
);
const pure = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations-client-quick-profile.pure.ts'),
  'utf8'
);
const routes = readFileSync(
  join(dir, '../../src/domains/client-operations/client-operations.routes.ts'),
  'utf8'
);
const registryView = readFileSync(
  join(dir, '../../../web/src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8'
);
const popover = readFileSync(
  join(
    dir,
    '../../../web/src/components/client-operations/ClientOperationsClientQuickProfilePopover.tsx'
  ),
  'utf8'
);
const resolver = readFileSync(
  join(dir, '../../src/domains/country-pack/reporting-calendar-resolver.service.ts'),
  'utf8'
);

test('ONE aggregate GET under client-operations view chain; no write command', () => {
  assert.match(routes, /\/clients\/:clientId\/quick-profile/);
  assert.match(routes, /getClientOperationsClientQuickProfile/);
  assert.match(routes, /\.\.\.withView/);
  assert.doesNotMatch(service, /router\.post|writeAudit|AUDIT_ACTIONS/);
});

test('canonical identity + accounting sources', () => {
  assert.match(service, /display_name/);
  assert.match(service, /tax_id/);
  assert.match(service, /client_contacts/);
  assert.match(service, /is_primary/);
  assert.match(service, /business_type/);
  assert.match(service, /income_management_system/);
  assert.match(service, /client_accounting_expense_items/);
  assert.match(service, /business_use_percent/);
  assert.match(service, /has_vehicles/);
});

test('reporting dates from ACTIVE calendar batch resolver; no invented NI date', () => {
  assert.match(service, /resolveReportingDueDatesBatch/);
  assert.match(service, /resolveQuickProfileReportingDueDates/);
  assert.match(service, /resolveVatOperationalCalendarLookupPeriodKey/);
  assert.match(service, /resolveNationalInsuranceDeductionsDueDate/);
  assert.match(service, /ni\.resolved/);
  assert.doesNotMatch(service, /filing_due_date:\s*['"]15/);
  assert.match(resolver, /draft_not_runtime_truth/);
  assert.match(resolver, /national_insurance_not_in_tax_authority_calendar/);
  assert.match(pure, /Asia\/Jerusalem/);
});

test('VAT due-type resolution is backend-owned; frontend has no applicability branching', () => {
  assert.match(service, /vat_due_type/);
  assert.doesNotMatch(popover, /vat_due_type|payroll_flag|business_percent\s*===/);
  assert.doesNotMatch(registryView, /vat_due_type\s*===|income_tax_advance_enabled/);
});

test('frontend: name opens quick profile; folder still opens full case; single GET', () => {
  assert.match(registryView, /openQuickProfile/);
  assert.match(registryView, /moduleClientOperationsClientQuickProfile/);
  assert.match(registryView, /setQuickProfileAnchor\(anchorEl\)/);
  assert.match(registryView, /setQuickProfileLoading\(true\)/);
  assert.match(popover, /nx-co-client-quick-profile__skeleton/);
  assert.match(registryView, /col\.key === 'client_name'/);
  assert.match(registryView, /openClientModal/);
  assert.match(registryView, /📁/);
  assert.match(registryView, /ClientOperationsClientQuickProfilePopover/);
  assert.equal(
    (registryView.match(/moduleClientOperationsClientQuickProfile\(/g) ?? []).length,
    1
  );
});

test('copy metadata only for name/tax_id/phone; Escape closes', () => {
  assert.match(service, /key: 'client_name'[\s\S]*?copyable: true/);
  assert.match(service, /key: 'tax_id'[\s\S]*?copyable: true/);
  assert.match(service, /key: 'phone'[\s\S]*?copyable: true/);
  assert.match(service, /key: 'business_type'[\s\S]*?copyable: false/);
  assert.match(popover, /navigator\.clipboard\.writeText/);
  assert.match(popover, /Escape/);
});

test('cross-org fail-closed via organization_id scoping', () => {
  assert.match(service, /\.eq\('organization_id', orgId\)/);
  assert.match(service, /forbidden\('Client not found'\)/);
});

test('הכנסות is income software — not a financial amount', () => {
  assert.match(service, /label_he: 'הכנסות'/);
  assert.match(service, /income_management_system/);
  assert.doesNotMatch(
    service,
    /label_he: 'הכנסות'[\s\S]{0,160}(monthly_amount|total_income|income_amount)/
  );
});
