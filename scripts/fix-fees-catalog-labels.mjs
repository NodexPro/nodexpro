import fs from 'fs';
const p = new URL('../apps/api/src/domains/client-operations/client-fees-catalog.ts', import.meta.url);
let s = fs.readFileSync(p, 'utf8');
s = s.replace(/\{ code: 'vat_reporting', label_he: '[^']*' \}/, "{ code: 'vat_reporting', label_he: '\\u05D3\\u05D9\\u05D5\\u05D5\\u05D7 \\u05DE\\u05E2\"\\u05DE' }");
s = s.replace(/\{ code: 'meeting_consult', label_he: '[^']*' \}/, "{ code: 'meeting_consult', label_he: '\\u05E4\\u05D2\\u05D9\\u05E9\\u05D4 / \\u05D9\\u05D9\\u05E2\\u05D5\\u05E5' }");
fs.writeFileSync(p, s);
