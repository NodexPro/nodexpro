import fs from 'fs';
const lines = fs.readFileSync('apps/api/src/domains/client-operations/client-annual-report-tab.service.ts', 'utf8').split(/\r?\n/);
const line = lines.find((l) => l.includes("column_headers_he:") && l.includes('שנת מס'));
if (!line) {
  console.log('not found');
  process.exit(1);
}
const i = line.indexOf('שנת מס');
const sub = line.slice(i, i + 90);
console.log(sub);
console.log(
  [...sub]
    .map((c) => `${c} U+${c.codePointAt(0).toString(16)}`)
    .join('\n')
);
