import fs from 'fs';
const p = 'apps/web/src/components/ClientAnnualReportTab.tsx';
let s = fs.readFileSync(p, 'utf8');
const addTitle = '\u05d4\u05d5\u05e1\u05e4\u05ea \u05ea\u05d0\u05e8\u05d9\u05da \u05d4\u05d2\u05e9\u05d4';
const dateLbl = '\u05ea\u05d0\u05e8\u05d9\u05da \u05d4\u05d2\u05e9\u05d4';
s = s.replace(
  /<h4>\{isEdit \? 'עריכת הגשה' : '[^']+'\}<\/h4>/,
  `<h4>{isEdit ? 'עריכת הגשה' : '${addTitle}'}</h4>`
);
s = s.replace(
  /<label>[^<]*הגשה<\/label>\s*\n\s*<input type="date"/,
  `<label>${dateLbl}</label>\n        <input type="date"`
);
fs.writeFileSync(p, s, 'utf8');
console.log('ok');
