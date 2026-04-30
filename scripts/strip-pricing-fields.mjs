import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(__dirname, '../apps/api/src/domains/client-operations/client-fees-tab.service.ts');
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
const k = lines.findIndex((l) => l.includes("key: 'pricing_basis'"));
if (k === -1) throw new Error('pricing_basis not found');
const blockStart = k - 1;
let blockEnd = -1;
for (let i = k; i < lines.length; i++) {
  if (lines[i].includes("key: 'agreement_notes'")) {
    for (let j = i; j < lines.length; j++) {
      if (lines[j].trim() === '},') {
        blockEnd = j;
        break;
      }
    }
    break;
  }
}
if (blockEnd === -1) throw new Error('agreement_notes close not found');
const next = [...lines.slice(0, blockStart), ...lines.slice(blockEnd + 1)];
fs.writeFileSync(p, next.join('\n'));
