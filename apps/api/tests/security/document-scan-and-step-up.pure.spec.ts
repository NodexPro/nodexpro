import test from 'node:test';
import assert from 'node:assert/strict';
import { decideMalwareScanGate, isFileAssetDownloadable, parseClamAvResponse } from '../../src/shared/document-malware-scan.pure.js';
import { classifySensitiveCommand, decideSensitiveCommandStepUp } from '../../src/shared/step-up-auth.pure.js';

test('required scanner fails closed and never labels an unscanned file clean', () => {
  assert.equal(
    decideMalwareScanGate({ required: true, configured: false, available: false, infected: null }).allow,
    false,
  );
  assert.equal(
    decideMalwareScanGate({ required: true, configured: true, available: false, infected: null }).status,
    'unavailable',
  );
  assert.equal(
    decideMalwareScanGate({ required: false, configured: false, available: false, infected: null }).status,
    'not_configured',
  );
  assert.equal(isFileAssetDownloadable('blocked', false), false);
  assert.equal(isFileAssetDownloadable('not_configured', false), true);
  assert.equal(isFileAssetDownloadable('not_configured', true), false);
  assert.equal(isFileAssetDownloadable('clean', true), true);
  assert.equal(parseClamAvResponse('stream: OK').infected, false);
  assert.equal(parseClamAvResponse('stream: Eicar-Test-Signature FOUND').infected, true);
});

test('step-up is required only when a factor already exists', () => {
  assert.equal(classifySensitiveCommand('/api/v1/organizations/x/commands/change_user_role'), 'membership_write');
  assert.equal(
    decideSensitiveCommandStepUp({ commandClass: 'membership_write', assurance: 'aal1', mfaEnrolled: false }),
    'allow',
  );
  assert.equal(
    decideSensitiveCommandStepUp({ commandClass: 'membership_write', assurance: 'aal1', mfaEnrolled: true }),
    'require_aal2',
  );
  assert.equal(
    decideSensitiveCommandStepUp({ commandClass: 'ordinary', assurance: 'aal1', mfaEnrolled: true }),
    'allow',
  );
});
