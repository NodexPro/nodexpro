/**
 * מסמכים tab — presentation contract only (no document mutations).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = dirname(fileURLToPath(import.meta.url));
const docsSrc = readFileSync(join(dir, '../src/components/ClientDocumentsTab.tsx'), 'utf8');
const docsCss = readFileSync(join(dir, '../src/styles/nx-workspace-documents-tab.css'), 'utf8');
const baseCss = readFileSync(join(dir, '../src/styles/nx-client-documents-tab.css'), 'utf8');
const premium = readFileSync(join(dir, '../src/styles/nx-workspace-modal-premium.css'), 'utf8');
const panelSrc = readFileSync(join(dir, '../src/components/ClientWorkspacePanel.tsx'), 'utf8');
const taxesCss = readFileSync(join(dir, '../src/styles/nx-workspace-taxes-tab.css'), 'utf8');
const nestedCss = readFileSync(join(dir, '../src/styles/nx-workspace-nested-dialogs.css'), 'utf8');

test('Documents tab still reads the case aggregate and writes named document commands', () => {
  assert.match(docsSrc, /documentsTab\.folders_grid\.folders/);
  assert.match(docsSrc, /documentsTab\.open_folder/);
  assert.match(docsSrc, /documentsTab\.permissions\.can_edit/);
  assert.match(docsSrc, /moduleClientOperationsDocumentsCommands/);
  assert.match(docsSrc, /onCaseUpdated\(out\)/);
  for (const type of [
    'open_client_document_folder',
    'create_client_document_folder',
    'rename_client_document_folder',
    'archive_or_delete_client_document_folder',
    'upload_client_document',
    'delete_client_document',
  ]) {
    assert.match(docsSrc, new RegExp(type));
  }
  assert.doesNotMatch(docsSrc, /method:\s*'PATCH'/);
});

test('Documents premium skin is scoped to the workspace modal Documents interior', () => {
  assert.match(docsSrc, /nx-workspace-documents-tab\.css/);
  assert.match(docsSrc, /nx-cdocs-root nx-ws-documents/);
  assert.match(docsCss, /\.nx-modal\.nx-workspace-modal \.nx-ws-documents/);
  assert.match(docsCss, /background:\s*transparent/);
  assert.match(docsCss, /radial-gradient\(ellipse at 12% 0%, rgba\(255, 255, 255, 0\.2\)/);
  assert.match(docsCss, /overflow-y:\s*auto/);
  assert.doesNotMatch(docsCss, /display:\s*none/);
  assert.doesNotMatch(docsCss, /createPortal|translateY\(max\(-60px/);
  assert.match(baseCss, /\.nx-cdocs-root/);
});

test('Documents folder overlay uses the nested glass close control and Arial', () => {
  assert.match(docsSrc, /nx-cdocs-folder-panel-close/);
  assert.match(docsSrc, /WorkspaceNestedDialogClose/);
  assert.doesNotMatch(docsSrc, /onClick=\{closeFolder\}>\s*סגירה/);
  assert.match(docsCss, /font-family:\s*Arial, sans-serif/i);
  assert.match(nestedCss, /font-family:\s*Arial, sans-serif/);
  assert.match(docsCss, /linear-gradient\(165deg, #04152f 0%, #082652 46%, #124c9a 78%, #04152f 100%\)/);
});

test('Client Details, Taxes, portal and raise are not altered by the Documents restyle', () => {
  assert.match(panelSrc, /createPortal\(\s*overlay,\s*document\.body\s*\)/);
  assert.match(
    premium,
    /transform:\s*translateY\(\s*max\(\s*-60px,\s*calc\(\s*16px\s*-\s*50dvh\s*\+\s*50%\s*\)\s*\)\s*\)/,
  );
  assert.doesNotMatch(premium, /nx-ws-documents/);
  assert.doesNotMatch(taxesCss, /nx-ws-documents/);
  assert.match(panelSrc, /activeTab === 'documents'/);
  assert.match(panelSrc, /ClientDocumentsTab/);
});
