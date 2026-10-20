import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');

const clientsSrc = read('../src/pages/Clients.tsx');
const modulesSrc = read('../src/pages/Modules.tsx');
const documentsSrc = read('../src/pages/Documents.tsx');
const documentCardSrc = read('../src/pages/DocumentCard.tsx');
const settingsSrc = read('../src/pages/Settings.tsx');
const billingSrc = read('../src/pages/Billing.tsx');
const usersRolesSrc = read('../src/pages/UsersRoles.tsx');
const urModalsSrc = read('../src/components/users-roles/UsersRolesModals.tsx');
const glassModalSrc = read('../src/components/glass/GlassModal.tsx');
const requiredMarkSrc = read('../src/components/glass/AccountRequiredMark.tsx');
const helperSrc = read('../src/components/glass/account-deep-ocean.ts');
const oceanCss = read('../src/styles/nx-account-deep-ocean-glass.css');
const createOceanCss = read('../src/styles/nx-client-create-deep-ocean-glass.css');
const glassSurfaceCss = read('../src/styles/nx-glass-surface.css');
const drilldownSrc = read('../src/components/dashboard/DashboardDrilldownModal.tsx');
const feeModalSrc = read('../src/components/dashboard/DashboardFeeBreakdownModal.tsx');
const workEngineSrc = read('../src/pages/WorkEngineQueue.tsx');
const incomeSrc = read('../src/pages/IncomeWorkspacePage.tsx');
const ownerLegalSrc = read('../src/pages/PlatformOwnerLegalControl.tsx');
const loginSrc = read('../src/pages/Login.tsx');
const registerSrc = read('../src/pages/Register.tsx');

test('Create Client V3 selector, two-column layout, and validation stay unchanged', () => {
  assert.match(clientsSrc, /CREATE_CLIENT_MODAL_APPEARANCE: CreateClientModalAppearance = 'deep-ocean-glass'/);
  assert.match(clientsSrc, /\| 'current'/);
  assert.match(clientsSrc, /\| 'royal-glass'/);
  assert.match(clientsSrc, /\| 'navy-royal-glass'/);
  assert.match(clientsSrc, /nx-client-create--deep-ocean-glass/);
  assert.doesNotMatch(clientsSrc, /withAccountDeepOceanClass/);
  assert.match(createOceanCss, /grid-template-columns: 1fr 1fr/);
  assert.match(createOceanCss, /backdrop-filter:\s*blur\(/);
  assert.match(clientsSrc, /validateCreateClientDraft/);
  assert.match(clientsSrc, /canonicalCreatedClientId/);
});

test('Create form required markers are semantic cyan asterisks, not gray label text', () => {
  assert.match(requiredMarkSrc, /nx-account-required-mark/);
  assert.match(requiredMarkSrc, /aria-hidden="true"/);
  assert.match(oceanCss, /\.nx-account-required-mark\s*\{[^}]*display:\s*inline/);
  assert.match(oceanCss, /\.nx-account-required-mark\s*\{[^}]*color:\s*#00d9ff/i);
  assert.match(createOceanCss, /\.nx-account-required-mark/);
  assert.match(clientsSrc, /<AccountRequiredMark \/>/);
  assert.equal((clientsSrc.match(/<AccountRequiredMark \/>/g) ?? []).length, 3);
  assert.doesNotMatch(clientsSrc, /className="nx-clients-required"/);
  assert.match(clientsSrc, /clients\.create\.type/);
  assert.doesNotMatch(
    clientsSrc.slice(clientsSrc.indexOf("t('clients.create.type')"), clientsSrc.indexOf("t('clients.contact.website')")),
    /AccountRequiredMark/,
  );
});

test('Create Client required asterisk stays inline with its label text', () => {
  assert.match(clientsSrc, /nx-clients-form__label-line/);
  assert.match(createOceanCss, /\.nx-clients-form__label-line\s*\{[^}]*display:\s*block/);
  assert.match(createOceanCss, /\.nx-account-required-mark[\s\S]*display:\s*inline/);
  const taxBlock = clientsSrc.slice(
    clientsSrc.indexOf("t('clients.create.taxId')"),
    clientsSrc.indexOf("t('clients.create.displayName')"),
  );
  assert.match(taxBlock, /nx-clients-form__label-line/);
  assert.match(taxBlock, /AccountRequiredMark/);
  assert.doesNotMatch(requiredMarkSrc, /display:\s*block/);
});

test('Dashboard modal search is a complete glass field on one desktop toolbar', () => {
  assert.match(oceanCss, /\.nx-account-deep-ocean \.nx-dashboard-breakdown__toolbar\s*\{[^}]*flex-direction:\s*row/);
  assert.match(oceanCss, /\.nx-account-deep-ocean \.nx-dashboard-breakdown__search\s*\{[^}]*height:\s*36px/);
  assert.match(oceanCss, /\.nx-account-deep-ocean \.nx-dashboard-breakdown__search\s*\{[^}]*overflow:\s*visible/);
  assert.match(oceanCss, /\.nx-account-deep-ocean \.nx-dashboard-breakdown__search\s*\{[^}]*flex:\s*1 1 12rem/);
  assert.match(oceanCss, /@media \(max-width: 640px\)[\s\S]*flex-direction:\s*column/);
  assert.match(drilldownSrc, /nx-dashboard-breakdown__search/);
  assert.match(feeModalSrc, /nx-dashboard-breakdown__search/);
  assert.match(feeModalSrc, /nx-dashboard-period__chip/);
  assert.match(feeModalSrc, /setFilter\(f\.key\)/);
  assert.match(drilldownSrc, /dir=\{dir\}/);
  assert.match(feeModalSrc, /dir=\{dir\}/);
});

test('Dashboard fee filters use turquoise glass and selected state stays distinct', () => {
  assert.match(feeModalSrc, /nx-dashboard-chip--purple/);
  assert.match(oceanCss, /\.nx-account-deep-ocean \.nx-dashboard-chip--purple\s*\{[^}]*#ffffff/);
  assert.match(oceanCss, /rgba\(19, 191, 208/);
  assert.match(oceanCss, /\.nx-account-deep-ocean \.nx-dashboard-chip--purple\.is-selected/);
  assert.doesNotMatch(oceanCss, /(?:^|\n)\.nx-dashboard-chip--purple\s*\{/);
});

test('Dashboard modal client names are white; action links keep the accent', () => {
  assert.match(feeModalSrc, /nx-dashboard-breakdown__name/);
  assert.match(oceanCss, /\.nx-account-deep-ocean \.nx-dashboard-breakdown__name\s*\{[^}]*color:\s*#ffffff/);
  const clientCell = feeModalSrc.slice(
    feeModalSrc.indexOf("columnKey === 'client'"),
    feeModalSrc.indexOf("columnKey === 'frequency'"),
  );
  assert.match(clientCell, /nx-dashboard-breakdown__name/);
  assert.doesNotMatch(clientCell, /nx-dashboard-breakdown__link/);
  assert.match(drilldownSrc, /nx-dashboard-breakdown__link/);
  assert.match(oceanCss, /\.nx-account-deep-ocean \.nx-dashboard-breakdown__link[\s\S]*#13bfd0/);
});

test('Dashboard empty states keep search, message, and pagination footer', () => {
  assert.match(drilldownSrc, /nx-dashboard-breakdown__empty/);
  assert.match(feeModalSrc, /nx-dashboard-breakdown__empty/);
  assert.match(drilldownSrc, /data\.empty_he/);
  assert.match(feeModalSrc, /data\.empty_he/);
  assert.match(drilldownSrc, /nx-dashboard-breakdown__footer/);
  assert.match(feeModalSrc, /nx-dashboard-breakdown__footer/);
  assert.match(oceanCss, /\.nx-account-deep-ocean \.nx-dashboard-breakdown__empty/);
  assert.doesNotMatch(drilldownSrc, /fabricat|dummyRows|placeholderRows/i);
  assert.match(feeModalSrc, /dashboardOfficeFeeBreakdown\(\)/);
  assert.match(feeModalSrc, /page_label_he/);
});

test('Modules select modal opts into account Deep Ocean and keeps checkout disabled', () => {
  assert.match(modulesSrc, /appearance="account-deep-ocean"/);
  assert.match(glassModalSrc, /appearance = 'default'/);
  assert.match(glassModalSrc, /Escape/);
  assert.match(glassModalSrc, /createPortal/);
  assert.match(modulesSrc, /checkoutUnavailable/);
  assert.doesNotMatch(modulesSrc, /orgModuleSelectPlan/);
  assert.doesNotMatch(modulesSrc, /orgModuleChangePlan/);
  assert.match(modulesSrc, /disabled/);
});

test('Users & Roles edit, selection, role, and confirmation overlays share ModalShell Deep Ocean', () => {
  assert.match(urModalsSrc, /withAccountDeepOceanClass\('nx-ur-overlay'\)/);
  assert.match(urModalsSrc, /function MemberProfileModal/);
  assert.match(urModalsSrc, /function MemberClientsModal/);
  assert.match(urModalsSrc, /function MemberModulesModal/);
  assert.match(urModalsSrc, /function CloseAccessModal/);
  assert.match(urModalsSrc, /setMemberProfileCommand/);
  assert.match(urModalsSrc, /setMemberClientAccessCommand/);
  assert.match(urModalsSrc, /setMemberModuleAccessCommand/);
  assert.match(urModalsSrc, /closeMemberAccessCommand/);
  assert.match(urModalsSrc, /dir=\{props\.ui\.direction\}/);
  assert.match(usersRolesSrc, /showInvite/);
  assert.doesNotMatch(usersRolesSrc, /nx-account-deep-ocean/);
});

test('Dashboard details overlays opt into account Deep Ocean without restyling page widgets', () => {
  assert.match(drilldownSrc, /withAccountDeepOceanClass\('nx-dashboard-breakdown-overlay'\)/);
  assert.match(feeModalSrc, /withAccountDeepOceanClass\('nx-dashboard-breakdown-overlay'\)/);
  assert.match(drilldownSrc, /Escape/);
  assert.match(feeModalSrc, /Escape/);
  assert.doesNotMatch(drilldownSrc, /nx-modal-overlay/);
  const dashPage = read('../src/pages/Dashboard.tsx');
  assert.doesNotMatch(dashPage, /nx-account-deep-ocean/);
});

test('Document actions stay native/inline; Settings and Billing have no overlay restyle', () => {
  assert.doesNotMatch(documentsSrc, /nx-account-deep-ocean|role="dialog"/);
  assert.match(documentCardSrc, /window\.confirm/);
  assert.doesNotMatch(documentCardSrc, /nx-account-deep-ocean|role="dialog"/);
  assert.doesNotMatch(settingsSrc, /nx-account-deep-ocean|role="dialog"/);
  assert.doesNotMatch(billingSrc, /nx-account-deep-ocean|role="dialog"/);
});

test('Shared Deep Ocean CSS is account-scoped and does not replace GlassModal defaults', () => {
  assert.match(helperSrc, /ACCOUNT_DEEP_OCEAN_CLASS = 'nx-account-deep-ocean'/);
  assert.match(oceanCss, /\.nx-account-deep-ocean \.nx-glass-modal/);
  assert.match(oceanCss, /\.nx-account-deep-ocean \.nx-ur-modal/);
  assert.match(oceanCss, /\.nx-account-deep-ocean \.nx-dashboard-breakdown/);
  assert.match(oceanCss, /backdrop-filter:\s*blur\(22px\)/);
  assert.match(oceanCss, /rgba\(23, 84, 122, 0\.38\)/);
  assert.doesNotMatch(oceanCss, /(?:^|\n)\.nx-glass-modal\s*\{/);
  assert.doesNotMatch(oceanCss, /(?:^|\n)\.nx-ur-overlay\s*\{/);
  assert.doesNotMatch(oceanCss, /(?:^|\n)\.nx-dashboard-breakdown\s*\{/);
  assert.doesNotMatch(oceanCss, /\.nx-we-modal|\.nx-income-|\.nx-owner-|\.nx-modal-overlay/);
  assert.match(glassSurfaceCss, /\.nx-glass-modal-overlay \{/);
  assert.match(glassSurfaceCss, /\.nx-glass-modal \{/);
});

test('Business-module, owner, and public pages are not opted into account Deep Ocean', () => {
  assert.doesNotMatch(workEngineSrc, /nx-account-deep-ocean|withAccountDeepOceanClass/);
  assert.doesNotMatch(incomeSrc, /nx-account-deep-ocean|withAccountDeepOceanClass/);
  assert.doesNotMatch(ownerLegalSrc, /nx-account-deep-ocean|withAccountDeepOceanClass/);
  assert.doesNotMatch(loginSrc, /nx-account-deep-ocean|AccountRequiredMark/);
  assert.doesNotMatch(registerSrc, /nx-account-deep-ocean|AccountRequiredMark/);
});
