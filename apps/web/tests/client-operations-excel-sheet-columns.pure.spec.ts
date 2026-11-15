import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const viewSource = readFileSync(
  join(dir, '../src/components/client-operations/ClientOperationsRegistryView.tsx'),
  'utf8',
);
const cssSource = readFileSync(
  join(dir, '../src/styles/nx-client-operations-spreadsheet.css'),
  'utf8',
);
const widthsPure = readFileSync(
  join(dir, '../src/lib/client-operations-column-widths.pure.ts'),
  'utf8',
);

test('custom header ellipsizes long titles and keeps a tooltip', () => {
  assert.match(
    cssSource,
    /\.nx-co-sheet__custom-header \.nx-co-sheet__header-label\s*\{[^}]*text-overflow:\s*ellipsis/s,
  );
  assert.match(cssSource, /\.nx-co-sheet__custom-cell\s*\{[^}]*text-overflow:\s*ellipsis/s);
  assert.match(viewSource, /title=\{\s*column\.label\.trim\(\)/);
});

test('custom columns persist width through named command, not localStorage truth', () => {
  assert.match(viewSource, /set_client_operations_custom_column_width/);
  assert.match(viewSource, /omitClientOperationsCustomColumnKeys/);
  assert.match(widthsPure, /CUSTOM_COLUMN_WIDTH_MIN = 96/);
  assert.match(widthsPure, /CUSTOM_COLUMN_WIDTH_DEFAULT = 160/);
  assert.doesNotMatch(viewSource, /command:\s*'patch_client_operations/);
});

test('RTL resize uses both inline edges without overlapping neighbors', () => {
  assert.match(cssSource, /\.nx-co-sheet__resize-handle\.is-end\s*\{[^}]*inset-inline-end:\s*0/s);
  assert.match(viewSource, /handleEdge: ClientOperationsResizeHandleEdge/);
  assert.match(viewSource, /beginResize\(event, column, 'inline-start'\)/);
  assert.match(viewSource, /beginResize\(event, column, 'inline-end'\)/);
});
