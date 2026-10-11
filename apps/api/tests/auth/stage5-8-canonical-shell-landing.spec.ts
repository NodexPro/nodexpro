/**
 * Stage 5.8 — consolidated UI polish: canonical shell for all destinations, Owner workspace selector,
 * employee CO grid/header, ToDo typography, public landing module showcase.
 * Presentation only: no access semantics, command, schema or pricing change.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildMyWorkspaceOption,
  buildOfficeWorkspaceOption,
  buildStaffWorkspaceOption,
  buildWorkspaceSelectorOptions,
} from '../../src/domains/client-operations/client-operations-workspace.pure.js';
import {
  LANDING_MODULE_SHOWCASE_DEFINITIONS,
  buildLandingModuleShowcase,
  trialLabelForMonths,
  type LandingShowcaseModuleRow,
  type LandingShowcasePlanRow,
} from '../../src/domains/public-catalog/landing-module-showcase.pure.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const repo = (rel: string): string => readFileSync(join(root, rel), 'utf8');
const web = (rel: string): string => repo(`apps/web/src/${rel}`);

const staffOption = buildStaffWorkspaceOption({ userId: 'u-2', displayName: 'דנה', roleCode: 'staff' });
const ownerScopes = [buildOfficeWorkspaceOption(), buildMyWorkspaceOption(), staffOption];

// ── Owner workspace selector (backend-owned presentation) ─────────────────────

test('1. Owner selector: office only (labelled משרד), personal option hidden, staff inspection kept', () => {
  const options = buildWorkspaceSelectorOptions({
    roleCode: 'owner',
    allowedScopes: ownerScopes,
    selectedScopeKind: 'OFFICE',
  });
  assert.deepEqual(
    options.map((o) => o.scope_kind),
    ['OFFICE', 'STAFF'],
  );
  assert.equal(options[0].label_he, 'משרד');
});

test('2. Owner selector keeps MY only when it is the currently selected scope (no dead selection)', () => {
  const options = buildWorkspaceSelectorOptions({
    roleCode: 'owner',
    allowedScopes: ownerScopes,
    selectedScopeKind: 'MY',
  });
  assert.ok(options.some((o) => o.scope_kind === 'MY'));
});

test('3. Employee / admin selectors are not narrowed: MY capability and labels untouched', () => {
  const employee = buildWorkspaceSelectorOptions({
    roleCode: 'staff',
    allowedScopes: [buildMyWorkspaceOption()],
    selectedScopeKind: 'MY',
  });
  assert.deepEqual(employee, [buildMyWorkspaceOption()]);
  const admin = buildWorkspaceSelectorOptions({
    roleCode: 'admin',
    allowedScopes: ownerScopes,
    selectedScopeKind: 'OFFICE',
  });
  assert.deepEqual(admin, ownerScopes);
});

test('4. selector projection never mutates the authorization scopes', () => {
  const before = JSON.stringify(ownerScopes);
  buildWorkspaceSelectorOptions({ roleCode: 'owner', allowedScopes: ownerScopes, selectedScopeKind: 'OFFICE' });
  assert.equal(JSON.stringify(ownerScopes), before);
  const service = repo('apps/api/src/domains/client-operations/client-operations-workspace.service.ts');
  assert.match(service, /allowed_scopes: workspace\.allowed_scopes,/);
  assert.match(service, /show_handler: workspace\.allowed_scopes\.some\(\(s\) => s\.scope_kind === 'OFFICE'\)/);
});

test('5. web selector renders the backend selector_options and infers no authorization', () => {
  const view = web('components/client-operations/ClientOperationsRegistryView.tsx');
  assert.match(view, /workspace\?\.selector_options \?\? workspace\?\.allowed_scopes/);
  assert.doesNotMatch(view, /role_code\s*===\s*'owner'|roleCode\s*===\s*'owner'/);
});

// ── Canonical shell for every destination ─────────────────────────────────────

test('6. every destination uses the canonical shell + AppSidebar; no second sidebar', () => {
  const layout = web('templates/template-1/TemplateLayout.tsx');
  assert.match(layout, /const usesCanonicalWorkingShell = true;/);
  assert.match(layout, /isNavyNativeSurface \? '' : ' t1-appShell--general'/);
  assert.match(layout, /appearance=\{usesCanonicalWorkingShell \? 'co-navy-glass' : 'default'\}/);
  assert.equal((layout.match(/<AppSidebar/g) ?? []).length, 1);
  const css = web('styles/nx-client-operations-shell.css');
  assert.match(css, /\.t1-appShell--client-operations\.t1-appShell--general \.t1-shellColumn \{/);
  // The navy-native page padding does not leak onto general destinations' own spacing.
  assert.match(css, /\.t1-appShell--client-operations:not\(\.t1-appShell--general\) \.t1-pageMain \{/);
});

test('7. "Nodex לקוחות" nav label: text colour only, hover/active keep their colours', () => {
  const css = web('styles/nx-client-operations-shell.css');
  const rule = css.match(
    /\.t1-appShell--client-operations\s+\.t1-sidebar__link:not\(:hover\):not\(\.is-active\)\s+\.t1-sidebar__label\[data-nav-path\^='\/m\/client-operations'\] \{([^}]*)\}/,
  );
  assert.ok(rule, 'label rule exists');
  assert.equal(rule![1].trim(), 'color: #ffffff;');
  const sidebar = web('templates/template-1/components/AppSidebar.tsx');
  assert.match(sidebar, /className=\{coGlass \? 't1-sidebar__label' : undefined\}/);
  assert.match(sidebar, /data-nav-path=\{coGlass \? child\.to : undefined\}/);
  assert.doesNotMatch(css, /\/\* \\\s*\n/); // regression: truncated comment must never come back
});

// ── Owner section, employee header/grid, ToDo ─────────────────────────────────

test('8. Owner section: plain violet text (existing token), larger, no pill for status / owner tag', () => {
  const css = web('components/users-roles/UsersRoles.css');
  assert.match(css, /\.nx-ur-owner__tag,\s*\.nx-ur-owner__status \{[^}]*color: var\(--nx-violet-500, #6657e8\);[^}]*font-size: 16px;/);
  assert.doesNotMatch(css, /\.nx-ur-owner__tag \{[^}]*(linear-gradient|border-radius)/);
  const page = web('pages/UsersRoles.tsx');
  assert.match(page, /nx-ur-owner__status/);
  assert.doesNotMatch(page.match(/data-testid="users-roles-owner-section"[\s\S]*?<\/section>/)![0], /nx-ur-badge/);
});

test('9. employee header: greeting kept, module title beneath in the active month-tab accent', () => {
  const header = web('templates/template-1/components/ClientOperationsAppHeader.tsx');
  assert.match(header, /data-testid="client-operations-greeting"/);
  assert.match(header, /nx-co-app-header__module-title/);
  const css = web('styles/nx-client-operations-shell.css');
  const rule = css.match(/\.nx-co-app-header__module-title \{([^}]*)\}/);
  assert.ok(rule);
  assert.match(rule![1], /color: #7decf7;/); // same edge colour as the active month tab
  const sheet = web('styles/nx-client-operations-spreadsheet.css');
  assert.match(sheet, /\.nx-co-sheet__period-tab\.is-current-working-period \{[^}]*border: 1px solid #7decf7;/);
});

test('10. employee/owner grid is one continuous cell grid via the single spreadsheet renderer', () => {
  const view = web('components/client-operations/ClientOperationsRegistryView.tsx');
  assert.match(view, /data-row-kind="filler"/);
  assert.equal((view.match(/<table className=\{`nx-co-sheet__table/g) ?? []).length, 1);
  const css = web('styles/nx-client-operations-spreadsheet.css');
  assert.match(css, /\.nx-co-sheet__table tbody tr\.nx-co-sheet__filler-row td \{/);
});

test('11. ToDo surface is Arial throughout with Owner weights (no 800 weights)', () => {
  const css = web('styles/nx-client-operations-todo.css');
  assert.match(css, /font-family: Arial, sans-serif !important;/);
  assert.match(css, /\.nx-co-todo-form-overlay \*,/);
  assert.match(css, /\.nx-co-app-header__todo-btn \{\s*font-family: Arial, sans-serif !important;/);
  assert.doesNotMatch(css, /font-weight: 800/);
  assert.doesNotMatch(css, /font-family:(?![^;]*Arial)/);
});

// ── Landing module showcase (commercial truth from the backend) ───────────────

const moduleRows: LandingShowcaseModuleRow[] = [
  { code: 'client-operations', name: 'Client Operations', is_active: true, is_sellable: true },
  { code: 'docflow', name: 'DocFlow', is_active: true, is_sellable: true },
  { code: 'invoice', name: 'Invoice / Hashboniot', is_active: true, is_sellable: true },
];
const planRows: LandingShowcasePlanRow[] = [
  { module_code: 'client-operations', currency: 'ILS', price_amount: 99, billing_period: 'month', sort_order: 1, is_active: true },
  { module_code: 'docflow', currency: 'ILS', price_amount: 49, billing_period: 'month', sort_order: 10, is_active: true },
  { module_code: 'invoice', currency: 'ILS', price_amount: 60, billing_period: 'month', sort_order: 1, is_active: true },
  { module_code: 'invoice', currency: 'ILS', price_amount: 5, billing_period: 'month', sort_order: 9, is_active: false },
];

test('12. showcase: three cards in order; price + trial come from inputs, never from the web client', () => {
  const agg = buildLandingModuleShowcase({ modules: moduleRows, plans: planRows, trialMonths: 2 });
  assert.deepEqual(
    agg.modules.map((m) => m.module_code),
    ['client-operations', 'docflow', 'invoice'],
  );
  const [co, docflow, invoice] = agg.modules;
  assert.equal(co.name, 'Client Operations'); // canonical registry name
  assert.equal(co.availability, 'available');
  assert.equal(co.price?.amount, 99);
  assert.equal(co.trial_label, 'First 2 months free');
  assert.equal(docflow.price?.amount, 49);
  assert.equal(invoice.price?.amount, 60); // inactive plan ignored
  assert.equal(agg.trial.months, 2);
});

test('13. DocFlow / Invoices are Coming soon: no trial claim, no activation surface', () => {
  const agg = buildLandingModuleShowcase({ modules: moduleRows, plans: planRows, trialMonths: 2 });
  for (const code of ['docflow', 'invoice']) {
    const m = agg.modules.find((x) => x.module_code === code)!;
    assert.equal(m.availability, 'coming_soon');
    assert.equal(m.availability_label, 'Coming soon');
    assert.equal(m.trial_label, null);
    assert.ok(m.details.planned.length > 0);
  }
  const routes = repo('apps/api/src/domains/public-catalog/public-catalog.routes.ts');
  assert.doesNotMatch(routes, /\.(post|put|patch|delete)\(/);
  const component = web('components/landing/LandingModuleShowcase.tsx');
  assert.doesNotMatch(component, /activate|subscribe|checkout|apiJson\(/i);
});

test('14. showcase degrades safely: not sellable → coming soon; missing plan → no price; no trial months → no trial', () => {
  const agg = buildLandingModuleShowcase({
    modules: moduleRows.map((m) => (m.code === 'client-operations' ? { ...m, is_sellable: false } : m)),
    plans: planRows.filter((p) => p.module_code !== 'docflow'),
    trialMonths: 0,
  });
  assert.equal(agg.modules[0].availability, 'coming_soon');
  assert.equal(agg.modules[0].trial_label, null);
  assert.equal(agg.modules[1].price, null);
  assert.equal(trialLabelForMonths(1), 'First 1 month free');
});

test('15. trial length is the canonical trial-domain constant; landing web code hardcodes no price or trial', () => {
  const trial = repo('apps/api/src/domains/trial/trial.service.ts');
  assert.match(trial, /export const TRIAL_MONTHS = 2;/);
  const service = repo('apps/api/src/domains/public-catalog/landing-module-showcase.service.ts');
  assert.match(service, /trialMonths: TRIAL_MONTHS/);
  assert.match(service, /from\('module_plans'\)/);
  for (const rel of ['components/landing/LandingModuleShowcase.tsx', 'api/public-catalog.ts']) {
    const src = web(rel);
    assert.doesNotMatch(src, /₪|\bILS\b|\$\d|\b(99|49|60)\b|\bfree\b/i, rel);
  }
  // VITE_API_URL already ends with /api/v1 — the client path must be relative to it.
  assert.match(web('api/public-catalog.ts'), /apiJsonPublic<LandingModuleShowcaseAggregate>\('\/public\/landing-module-showcase'\)/);
  assert.match(repo('apps/api/src/index.ts'), /app\.use\('\/api\/v1\/public', publicCatalogRoutes\);/);
  assert.ok(LANDING_MODULE_SHOWCASE_DEFINITIONS.every((d) => !/\d+\s*(ILS|₪|\$)/.test(d.tagline + d.summary)));
});

test('16. showcase sits directly below the existing hero (no new page, hero untouched)', () => {
  const page = web('pages/LandingPage.tsx');
  assert.match(page, /<\/section>\s*<LandingModuleShowcase \/>\s*<section className="nx-landing__modules"/);
  const css = web('styles/nx-landing.css');
  assert.match(css, /\.nx-landing__showcase-grid \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(css, /@media \(max-width: 960px\) \{\s*\.nx-landing__showcase-grid \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 720px\) \{[^@]*\.nx-landing__showcase-grid \{[^}]*grid-template-columns: minmax\(0, 1fr\);/);
});
