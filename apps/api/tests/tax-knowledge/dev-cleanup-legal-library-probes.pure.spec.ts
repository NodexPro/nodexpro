import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyProbeRow,
  isProvenProbeFactKey,
  isProvenProbeLegalValue,
  isProvenProbePackCode,
} from '../../scripts/dev-cleanup-legal-library-probes.pure.ts';

test('DEV cleanup classifier accepts only proven probe codes/titles', () => {
  assert.equal(classifyProbeRow('tk3a-1788621623402-1761ry_il_src', 'tk3a-1788621623402-1761ry IL source'), 'A');
  assert.equal(classifyProbeRow('tk14a-1789140002522-2v3qx6_il_src', 'K1.4A IL source'), 'A');
  assert.equal(classifyProbeRow('tk649a-verify-1789842276377-xs2pfk_il_src', 'TAX-649A verify source'), 'A');
  assert.equal(classifyProbeRow('src_dev_622_2026_09_12t07_28_05z_source_788c5aa56279', 'DEV-622 2026-09-12T07:28:05Z source'), 'A');
  assert.equal(classifyProbeRow('e3b-1789140000616-6cy27o', 'E3B probe'), 'A');
  assert.equal(classifyProbeRow('node_dev_624_manual_079f476c_a7d922bf3089', 'DEV-624-MANUAL-079f476c'), 'A');
  assert.equal(isProvenProbeFactKey('f2a2a_dev_probe_happy'), true);
  assert.equal(isProvenProbeLegalValue('tk12-1788620629258-cth6h4_il_vat', 'module:tax-knowledge-test'), true);
  assert.equal(isProvenProbeLegalValue('comm_docflow-comm-1789736614578-9s9n3g', 'docflow'), true);
  assert.equal(isProvenProbePackCode('pack_docflow-comm-1789736614578-9s9n3g'), true);
  assert.equal(isProvenProbePackCode('tk3a-1788621623402-1761ry_il_pack'), true);
});

test('DEV cleanup classifier rejects real or unknown legal content', () => {
  assert.equal(classifyProbeRow('ito_income_tax_ordinance', 'פקודת מס הכנסה'), 'C');
  assert.equal(classifyProbeRow('src_ab12cd', 'מס הכנסה'), 'C');
  assert.equal(classifyProbeRow('src_bbcdc0ecf838', 'פקודת מס הכנסה [נוסח חדש]'), 'C');
  assert.equal(classifyProbeRow('node_45db5127f8ef', 'הגדרות'), 'C');
  assert.equal(isProvenProbeFactKey('date_of_birth'), false);
  assert.equal(isProvenProbeLegalValue('vat_standard_rate', 'module:tax'), false);
  assert.equal(isProvenProbeLegalValue('tk12-1788620629258-cth6h4_il_vat', 'module:tax'), false);
  assert.equal(isProvenProbePackCode('il-income-tax-2026'), false);
});
