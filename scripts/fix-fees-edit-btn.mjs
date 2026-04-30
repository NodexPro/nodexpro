import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(__dirname, '../apps/web/src/components/ClientFeesTab.tsx');
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
const idx = lines.findIndex((l) => l.includes('onClick={openEditModal}'));
if (idx < 0) {
  console.error('openEditModal not found');
  process.exit(1);
}
const btnLine = idx + 2;
if (lines[btnLine] && /עריכת/.test(lines[btnLine])) {
  lines[btnLine] = "                  {'עריכת שכ\\u05f4ט'}";
  fs.writeFileSync(p, lines.join('\n'), 'utf8');
  console.log('fixed', btnLine + 1);
} else {
  console.error('expected line not at', btnLine, lines.slice(idx, idx + 6));
  process.exit(1);
}
