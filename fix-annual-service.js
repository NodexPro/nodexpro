const fs = require('fs');
const p =
  'c:/Users/hatoo/OneDrive/שולחן העבודה/Zentax/apps/api/src/domains/client-operations/client-annual-report-tab.service.ts';
let s = fs.readFileSync(p, 'utf8');

// Fix corrupted total_label in const summary (line ~527)
const badPatterns = [
  /total_label_he: 'סה\uFFFD\uFFFDכ מסמכים'/,
  /total_label_he: 'סה\?\?כ מסמכים'/,
];
for (const re of badPatterns) {
  if (re.test(s)) {
    s = s.replace(re, "total_label_he: 'סה��כ מסמכים'");
    break;
  }
}

const block = `      summary: {
        total_label_he: 'סה��כ מסמכים',
        total_count: rows.length,
        received_label_he: 'התקבלו',
        received_count: rows.filter((r) => r.received).length,
        missing_label_he: 'חסרים',
        missing_count: rows.filter((r) => r.status === 'missing').length,
        updated_label_he: 'עודכן לאחרונה',
        updated_display_he: p?.updated_at ? formatDateTimeHe(p.updated_at) : '—',
      },`;

if (!s.includes(block)) {
  console.error('documents_table summary block not found');
  process.exit(1);
}
s = s.replace(block, '      summary,');

fs.writeFileSync(p, s, 'utf8');
console.log('patched', p);
