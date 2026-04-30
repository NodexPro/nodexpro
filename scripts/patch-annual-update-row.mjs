import fs from 'fs';
const p = 'apps/api/src/domains/client-operations/client-annual-report-tab.service.ts';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);

const guardIdx = lines.findIndex((l) => l.includes("!== 'custom'") && l.includes('badRequest') && l.includes('source_type'));
if (guardIdx < 0) throw new Error('guard line not found');
lines[guardIdx] = '      const isCustom = String(row.source_type) === \'custom\';';

const docOpen = lines.findIndex((l) => l.trim() === 'if (payload.document_name_he !== undefined) {');
if (docOpen < 0) throw new Error('document_name if not found');
lines.splice(
  docOpen + 1,
  0,
  "        if (!isCustom) throw badRequest('\u05dc\u05d0 \u05e0\u05d9\u05ea\u05df \u05dc\u05e2\u05e8\u05d5\u05da \u05e9\u05dd \u05dc\u05e9\u05d5\u05e8\u05ea \u05de\u05e2\u05e8\u05db\u05ea');"
);

const sortOpen = lines.findIndex((l) => l.trim() === 'if (payload.sort_order !== undefined) {');
if (sortOpen < 0) throw new Error('sort_order if not found');
lines.splice(
  sortOpen + 1,
  0,
  "        if (!isCustom) throw badRequest('\u05dc\u05d0 \u05e0\u05d9\u05ea\u05df \u05dc\u05e9\u05e0\u05d5\u05ea \u05e1\u05d3\u05e8 \u05dc\u05e9\u05d5\u05e8\u05ea \u05de\u05e2\u05e8\u05db\u05ea');"
);

fs.writeFileSync(p, lines.join('\n'), 'utf8');
console.log('patched');
