/**
 * Minimal first-sheet XLSX reader/writer for client import templates.
 * Identifiers are written as inline text so Excel keeps leading zeros.
 */

import { inflateRawSync } from 'node:zlib';
import { formatExcelNumericIdentifier } from './client-import-mapping.pure.js';

const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c >>> 0;
}

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder('utf-8').decode(bytes);
}

function xmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function xmlUnescape(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function zipStore(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const nameBytes = encodeUtf8(file.name);
    const crc = crc32(file.data);
    const local = concat([
      encodeUtf8('PK\u0003\u0004'),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(nameBytes.length),
      u16(0),
      nameBytes,
      file.data,
    ]);
    locals.push(local);
    const central = concat([
      encodeUtf8('PK\u0001\u0002'),
      u16(20),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(file.data.length),
      u32(file.data.length),
      u16(nameBytes.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      nameBytes,
    ]);
    centrals.push(central);
    offset += local.length;
  }
  const centralDir = concat(centrals);
  const eocd = concat([
    encodeUtf8('PK\u0005\u0006'),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(centralDir.length),
    u32(offset),
    u16(0),
  ]);
  return concat([...locals, centralDir, eocd]);
}

function readU16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readU32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function decodeZipEntry(method: number, compressed: Uint8Array, uncompSize: number): Uint8Array {
  let data: Uint8Array;
  if (method === 0) data = compressed;
  else if (method === 8) data = inflateRawSync(compressed);
  else throw new Error('unsupported_zip_method');
  if (uncompSize && data.length > uncompSize) return data.subarray(0, uncompSize);
  return data;
}

function unzip(buffer: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const files = new Map<string, Uint8Array>();
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (readU32(view, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd >= 0) {
    const count = readU16(view, eocd + 10);
    let offset = readU32(view, eocd + 16);
    for (let n = 0; n < count && offset + 46 <= buffer.length; n++) {
      if (readU32(view, offset) !== 0x02014b50) break;
      const method = readU16(view, offset + 10);
      const compSize = readU32(view, offset + 20);
      const uncompSize = readU32(view, offset + 24);
      const nameLen = readU16(view, offset + 28);
      const extraLen = readU16(view, offset + 30);
      const commentLen = readU16(view, offset + 32);
      const localOff = readU32(view, offset + 42);
      const name = decodeUtf8(buffer.subarray(offset + 46, offset + 46 + nameLen)).replace(/\\/g, '/');
      const localNameLen = readU16(view, localOff + 26);
      const localExtraLen = readU16(view, localOff + 28);
      const dataStart = localOff + 30 + localNameLen + localExtraLen;
      const compressed = buffer.subarray(dataStart, dataStart + compSize);
      files.set(name, decodeZipEntry(method, compressed, uncompSize));
      offset += 46 + nameLen + extraLen + commentLen;
    }
    if (files.size) return files;
  }
  let offset = 0;
  while (offset + 30 <= buffer.length) {
    if (readU32(view, offset) !== 0x04034b50) break;
    const method = readU16(view, offset + 8);
    const compSize = readU32(view, offset + 18);
    const uncompSize = readU32(view, offset + 22);
    const nameLen = readU16(view, offset + 26);
    const extraLen = readU16(view, offset + 28);
    const nameStart = offset + 30;
    const name = decodeUtf8(buffer.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    const compressed = buffer.subarray(dataStart, dataStart + compSize);
    files.set(name.replace(/\\/g, '/'), decodeZipEntry(method, compressed, uncompSize));
    offset = dataStart + compSize;
  }
  return files;
}

function colRowFromRef(ref: string): { col: number; row: number } {
  const match = /^([A-Z]+)(\d+)$/i.exec(ref.trim());
  if (!match) return { col: 0, row: 0 };
  let col = 0;
  for (const ch of match[1].toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(match[2]) - 1 };
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siBlocks = xml.match(/<si[\s>][\s\S]*?<\/si>/g) ?? [];
  for (const block of siBlocks) {
    const texts = [...block.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlUnescape(m[1]));
    out.push(texts.join(''));
  }
  return out;
}

function cellText(cellXml: string, shared: string[]): string {
  const type = /t="([^"]+)"/.exec(cellXml)?.[1] ?? '';
  if (type === 'inlineStr' || type === 'str') {
    const texts = [...cellXml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlUnescape(m[1]));
    return texts.join('').trim();
  }
  const value = /<v[^>]*>([\s\S]*?)<\/v>/.exec(cellXml)?.[1] ?? '';
  if (type === 's') {
    const index = Number(value);
    return Number.isFinite(index) ? String(shared[index] ?? '').trim() : '';
  }
  if (!value) return '';
  if (type === 'b') return value === '1' ? '1' : '0';
  const num = Number(value);
  if (Number.isFinite(num) && /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(value.trim())) {
    return formatExcelNumericIdentifier(num);
  }
  return xmlUnescape(value).trim();
}

export function parseXlsxFirstSheet(buffer: Uint8Array): { headers: string[]; rows: string[][] } {
  const files = unzip(buffer);
  const sheetPath =
    [...files.keys()].find((name) => /xl\/worksheets\/sheet1\.xml$/i.test(name)) ??
    [...files.keys()].find((name) => /xl\/worksheets\/sheet\d+\.xml$/i.test(name));
  if (!sheetPath) {
    const err = new Error('SHEET_STRUCTURE_INVALID');
    err.name = 'SHEET_STRUCTURE_INVALID';
    throw err;
  }
  const sharedPath = [...files.keys()].find((name) => /xl\/sharedStrings\.xml$/i.test(name));
  const shared = sharedPath ? parseSharedStrings(decodeUtf8(files.get(sharedPath)!)) : [];
  const xml = decodeUtf8(files.get(sheetPath)!);
  const grid: string[][] = [];
  const rowBlocks = xml.match(/<row\b[^>]*>[\s\S]*?<\/row>/g) ?? [];
  for (const rowXml of rowBlocks) {
    const cells = rowXml.match(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/g) ?? [];
    const line: string[] = [];
    for (const cellXml of cells) {
      const ref = /r="([^"]+)"/.exec(cellXml)?.[1] ?? '';
      const { col } = colRowFromRef(ref);
      while (line.length < col) line.push('');
      line[col] = cellText(cellXml, shared);
    }
    if (line.some((cell) => cell.trim())) grid.push(line);
  }
  if (!grid.length) {
    const err = new Error('SHEET_STRUCTURE_INVALID');
    err.name = 'SHEET_STRUCTURE_INVALID';
    throw err;
  }
  const width = Math.max(...grid.map((row) => row.length), 0);
  const normalized = grid.map((row) => {
    const next = row.slice();
    while (next.length < width) next.push('');
    return next;
  });
  return { headers: normalized[0], rows: normalized.slice(1) };
}

export function buildXlsxTwoColumnTemplate(headers: [string, string]): Uint8Array {
  const [nameHeader, taxHeader] = headers;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <cols>
    <col min="1" max="1" width="24" customWidth="1"/>
    <col min="2" max="2" width="22" customWidth="1" style="1"/>
  </cols>
  <sheetData>
    <row r="1">
      <c r="A1" t="inlineStr"><is><t>${xmlEscape(nameHeader)}</t></is></c>
      <c r="B1" s="1" t="inlineStr"><is><t>${xmlEscape(taxHeader)}</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="inlineStr"><is><t/></is></c>
      <c r="B2" s="1" t="inlineStr"><is><t/></is></c>
    </row>
  </sheetData>
</worksheet>`;
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Clients" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://www.schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://www.schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="@"/></numFmts>
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" applyNumberFormat="1"/>
  </cellXfs>
</styleSheet>`;
  return zipStore([
    { name: '[Content_Types].xml', data: encodeUtf8(contentTypes) },
    { name: '_rels/.rels', data: encodeUtf8(rels) },
    { name: 'xl/workbook.xml', data: encodeUtf8(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', data: encodeUtf8(workbookRels) },
    { name: 'xl/worksheets/sheet1.xml', data: encodeUtf8(sheet) },
    { name: 'xl/styles.xml', data: encodeUtf8(styles) },
  ]);
}
