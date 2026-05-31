import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isSupabaseMissingColumnError,
  isSupabaseMissingTableError,
} from '../../src/shared/supabase-errors.js';
import { applyDocumentStyleToColorColumns } from '../../src/domains/income/income-document-branding.pure.js';
import { resolveDocumentStylePreset } from '../../src/domains/income/income-document-branding.pure.js';

test('isSupabaseMissingColumnError detects PGRST204 for document_style_key', () => {
  assert.equal(
    isSupabaseMissingColumnError(
      {
        code: 'PGRST204',
        message:
          "Could not find the 'document_style_key' column of 'income_document_branding_profiles' in the schema cache",
      },
      'document_style_key',
    ),
    true,
  );
});

test('isSupabaseMissingTableError detects missing branding table', () => {
  assert.equal(
    isSupabaseMissingTableError(
      {
        code: 'PGRST205',
        message: "Could not find the table 'public.income_document_branding_profiles' in the schema cache",
      },
      'income_document_branding_profiles',
    ),
    true,
  );
});

test('modal save patch includes document_style_key and legacy color columns', () => {
  const style = resolveDocumentStylePreset('elegant_purple')!;
  const patch = applyDocumentStyleToColorColumns(style);
  assert.equal(patch.document_style_key, 'elegant_purple');
  assert.equal(patch.table_header_color, '#4c3d6e');
  assert.equal(patch.primary_color, style.gradient.from);
});
