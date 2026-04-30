import fs from 'fs';
const p = 'apps/api/src/domains/client-operations/client-annual-report-tab.service.ts';
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
const out = [];
let prev = '';
for (const line of lines) {
  if (line === prev && line.includes('if (!isCustom) throw badRequest')) continue;
  out.push(line);
  prev = line;
}
fs.writeFileSync(p, out.join('\n'), 'utf8');
console.log('done');
