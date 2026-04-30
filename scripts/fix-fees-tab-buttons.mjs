import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(__dirname, '../apps/web/src/components/ClientFeesTab.tsx');
let s = fs.readFileSync(p, 'utf8');

const inner = "\n                                    >\n                                      {'\\u270E'}\n                                    </button>";

s = s.replace(
  /onClick=\{\(\) => setLineModal\(\{ kind: 'custom', index: idx \}\)\}\s*[\s\S]*?<\/button>/,
  `onClick={() => setLineModal({ kind: 'custom', index: idx })}${inner}`
);

s = s.replace(
  /onClick=\{\(\) => setLineModal\(\{ kind: 'included', index: idx \}\)\}\s*[\s\S]*?<\/button>/,
  `onClick={() => setLineModal({ kind: 'included', index: idx })}${inner}`
);

fs.writeFileSync(p, s, 'utf8');
console.log('fixed buttons');
