import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(__dirname, '../apps/api/src/domains/client-operations/client-fees-tab.service.ts');
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
let start = -1;
for (let i = 0; i < lines.length - 1; i++) {
  if (lines[i].trim() === 'return {' && lines[i + 1].trim().startsWith('card:')) {
    start = i;
    break;
  }
}
if (start === -1) throw new Error('no return card');
let depth = 0;
let end = start;
for (let k = start; k < lines.length; k++) {
  const L = lines[k];
  if (L.includes('{')) depth += (L.match(/\{/g) || []).length;
  if (L.includes('}')) depth -= (L.match(/\}/g) || []).length;
  if (k > start && depth === 0 && L.trim() === '};') {
    end = k;
    break;
  }
}
const insert = `  const discountSec = buildDiscountSection(a, canEdit, hasAgreement);
  const renewalSec = buildRenewalSection(a, canEdit, hasAgreement);
  const discountFields = discountSec.fields.map((f) => ({ ...f, modal_group: 'discount' as const }));
  const renewalFields = renewalSec.fields.map((f) => ({ ...f, modal_group: 'renewal' as const }));

  const edit_modal: FeesEditModalDto = {
    modal_title_he: 'עריכת שכ"ט',
    save_hint_he: 'שמירה מעדכנת את הלשונית לפי הנתונים מהשרת.',
    sections: [
      { section_title_he: 'הסכם שכ"ט', fields },
      { section_title_he: 'הנחה', fields: discountFields },
      { section_title_he: 'חידוש והתראות', fields: renewalFields },
    ],
  };

  return {
    agreement_summary: buildAgreementSummary(a),
    visibility,
    edit_modal,
  };`.split('\n');
const out = [...lines.slice(0, start), ...insert, ...lines.slice(end + 1)];
fs.writeFileSync(p, out.join('\n'));
console.log('lines', start + 1, end + 1);
