/**
 * TEST-ONLY fixture. Do not import from production platform-localization.service.
 * A permanent Hebrew system label that is not a catalog key and is not user data.
 */
import type { HardcodedSurface } from '../../../src/domains/platform-localization/platform-localization-audit.pure.js';

export const TEST_ONLY_HARDCODED_HE_SYSTEM_LABEL: HardcodedSurface = {
  id: 'test-only:registry-toolbar-hebrew-chrome',
  tab: 'Registry',
  location: 'Toolbar test chrome',
  displayed_text: 'כפתור מערכת לבדיקה',
  localization_key: null,
  requires_code_fix: true,
  reason: 'Permanent system chrome rendered in Hebrew with no localization key. User-entered Hebrew is not this issue.',
  target_locales: ['en'],
  usage_locations: [{ tab: 'Registry', location: 'ClientOperationsRegistryView toolbar' }],
};

export const TEST_ONLY_USER_HEBREW_TEXT = 'שם לקוח שהמשתמש הקליד';
