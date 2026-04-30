import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(__dirname, '../apps/api/src/domains/client-operations/client-fees-tab.service.ts');
let s = fs.readFileSync(p, 'utf8');

const g = '\u05F4';
const start = '\u05EA\u05D0\u05E8\u05D9\u05DA \u05EA\u05D7\u05D9\u05DC\u05EA \u05D4\u05D4\u05E1\u05DB\u05DD';
const end = '\u05EA\u05D0\u05E8\u05D9\u05DA \u05E1\u05D9\u05D5\u05DD \u05D4\u05D4\u05E1\u05DB\u05DD';
const summaryRe =
  /if \(hasAgreement\) \{\s*lines\.push\(\{ label_he: '[^']+', value_he: formatDateHe\(\(a\.agreement_start_date as string \| null\) \?\? null\) \}\);\s*lines\.push\(\{ label_he: '[^']+', value_he: formatDateHe\(\(a\.agreement_end_date as string \| null\) \?\? null\) \}\);/;
if (!summaryRe.test(s)) {
  console.error('summary block not found');
  process.exit(1);
}
s = s.replace(
  summaryRe,
  `if (hasAgreement) {
    lines.push({ label_he: '${start}', value_he: formatDateHe((a.agreement_start_date as string | null) ?? null) });
    lines.push({ label_he: '${end}', value_he: formatDateHe((a.agreement_end_date as string | null) ?? null) });`
);

const oldHdr = `column_headers_he: ['שירות', 'סוג חיוב', 'מחיר', 'פעיל', 'הערה לשורה', 'תלושים', 'מחיר ליחידה', 'סה${g}ד שורה', 'פעולות']`;
const newHdr = `column_headers_he: ['שירות', 'סוג חיוב', 'מחיר', 'פעיל', 'מספר תלושים', 'מחיר ליחידה', 'פעולות']`;
if (!s.includes(oldHdr)) {
  console.error('included headers not found');
  process.exit(1);
}
s = s.replace(oldHdr, newHdr);

const monthlyLine = `      { label_he: 'סה${g}כ חודשי משוער', value_he: formatIls(fin.monthlyEstimate) },\n`;
if (!s.includes(monthlyLine)) {
  console.error('monthly line not found');
  process.exit(1);
}
s = s.replace(monthlyLine, '');

const phRe =
  /(column_headers_he: \['שירות', 'מחיר קודם', 'מחיר חדש', 'תוקף מ-', 'תוקף עד', 'סיבה', 'עודכן ע\u05F4י', '[^']+'), 'הערות'\]/;
if (!phRe.test(s)) {
  console.error('price history headers not found');
  process.exit(1);
}
s = s.replace(phRe, '$1]');

fs.writeFileSync(p, s, 'utf8');
console.log('patched', p);
