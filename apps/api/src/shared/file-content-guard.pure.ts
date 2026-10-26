/**
 * Upload content guard — inspects bytes, not client MIME/extension claims.
 * Presentation-free: returns detected kind + a storage MIME, or rejects.
 */

import { DEFAULT_UPLOAD_MAX_BYTES } from './api-security.pure.js';

export type DetectedUploadKind =
  | 'pdf'
  | 'jpeg'
  | 'png'
  | 'gif'
  | 'webp'
  | 'heic'
  | 'tiff'
  | 'ole'
  | 'zip-office'
  | 'rtf'
  | 'text'
  | 'xml'
  | 'rejected';

export type FileContentGuardResult =
  | { ok: true; kind: Exclude<DetectedUploadKind, 'rejected'>; mime: string; fileName: string }
  | { ok: false; reason: string };

const PDF = Buffer.from('%PDF');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const GIF87 = Buffer.from('GIF87a');
const GIF89 = Buffer.from('GIF89a');
const OLE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const RIFF = Buffer.from('RIFF');
const WEBP = Buffer.from('WEBP');
const RTF = Buffer.from('{\\rtf');
const TIFF_LE = Buffer.from([0x49, 0x49, 0x2a, 0x00]);
const TIFF_BE = Buffer.from([0x4d, 0x4d, 0x00, 0x2a]);
const MZ = Buffer.from('MZ');
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
const FTYP = Buffer.from('ftyp');

const OFFICE_ZIP_EXT = new Set(['.docx', '.xlsx', '.odt']);
const TEXT_EXT = new Set(['.txt', '.csv']);
const PDF_EXT = new Set(['.pdf']);
const OLE_EXT = new Set(['.doc', '.xls']);
const RTF_EXT = new Set(['.rtf']);
const XML_EXT = new Set(['.xml']);
const HEIC_EXT = new Set(['.heic', '.heif']);
const TIFF_EXT = new Set(['.tif', '.tiff']);
const DANGEROUS_EXT = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.com',
  '.js',
  '.mjs',
  '.cjs',
  '.vbs',
  '.ps1',
  '.scr',
  '.pif',
  '.dll',
  '.sh',
  '.html',
  '.htm',
  '.svg',
  '.php',
  '.asp',
  '.jsp',
  '.wsf',
  '.jar',
  '.msi',
  '.docm',
  '.xlsm',
  '.pptm',
  '.dotm',
  '.xltm',
]);

const KIND_MIME: Record<Exclude<DetectedUploadKind, 'rejected'>, string> = {
  pdf: 'application/pdf',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  tiff: 'image/tiff',
  ole: 'application/msword',
  'zip-office': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  rtf: 'application/rtf',
  text: 'text/plain',
  xml: 'application/xml',
};

export { DEFAULT_UPLOAD_MAX_BYTES };

function startsWith(buf: Buffer, sig: Buffer, offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  return buf.subarray(offset, offset + sig.length).equals(sig);
}

function extOf(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? fileName;
  const i = base.lastIndexOf('.');
  return i >= 0 ? base.slice(i).toLowerCase() : '';
}

export function sanitizeUploadFileName(fileName: string): string | null {
  const base = String(fileName ?? '')
    .trim()
    .replace(/[/\\]/g, '')
    .replace(/\0/g, '')
    .replace(/^\.+/, '');
  if (!base || base === '.' || base === '..') return null;
  return base.slice(0, 180);
}

export function hasDangerousDoubleExtension(fileName: string): boolean {
  const tokens = String(fileName ?? '')
    .toLowerCase()
    .split('.')
    .slice(1);
  if (tokens.length < 2) return false;
  return tokens.some((token) => DANGEROUS_EXT.has(`.${token}`));
}

function looksLikeHeic(buf: Buffer): boolean {
  if (buf.length < 12 || !startsWith(buf, FTYP, 4)) return false;
  const brand = buf.subarray(8, 12).toString('ascii').toLowerCase();
  return brand === 'heic' || brand === 'heif' || brand === 'mif1' || brand === 'msf1';
}

function looksLikeXml(buf: Buffer): boolean {
  const head = buf.subarray(0, Math.min(buf.length, 256)).toString('utf8').trim().toLowerCase();
  if (head.startsWith('<!doctype html') || head.startsWith('<html') || head.startsWith('<script') || head.startsWith('<svg')) {
    return false;
  }
  return head.startsWith('<?xml') || /^<[a-zA-Z][\w:-]*[\s>]/.test(head);
}

export function detectUploadKind(buf: Buffer): DetectedUploadKind {
  if (!buf.length) return 'rejected';
  if (startsWith(buf, MZ) || startsWith(buf, ELF) || startsWith(buf, Buffer.from('#!'))) return 'rejected';
  if (startsWith(buf, PDF)) return 'pdf';
  if (startsWith(buf, PNG)) return 'png';
  if (startsWith(buf, JPEG)) return 'jpeg';
  if (startsWith(buf, GIF87) || startsWith(buf, GIF89)) return 'gif';
  if (startsWith(buf, RIFF) && buf.length >= 12 && startsWith(buf, WEBP, 8)) return 'webp';
  if (looksLikeHeic(buf)) return 'heic';
  if (startsWith(buf, TIFF_LE) || startsWith(buf, TIFF_BE)) return 'tiff';
  if (startsWith(buf, OLE)) return 'ole';
  if (startsWith(buf, ZIP)) return 'zip-office';
  if (startsWith(buf, RTF)) return 'rtf';
  if (looksLikeXml(buf)) return 'xml';
  if (looksLikeText(buf)) return 'text';
  return 'rejected';
}

function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  if (sample.includes(0)) return false;
  const head = sample.subarray(0, Math.min(sample.length, 256)).toString('utf8').trim().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<script') || head.startsWith('<svg')) {
    return false;
  }
  let suspicious = 0;
  for (const b of sample) {
    if (b < 9 || (b > 13 && b < 32) || b === 0x7f) suspicious += 1;
  }
  return suspicious / sample.length <= 0.02;
}

function mimeFor(kind: Exclude<DetectedUploadKind, 'rejected'>, ext: string): string {
  if (kind === 'zip-office') {
    if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (ext === '.odt') return 'application/vnd.oasis.opendocument.text';
    return KIND_MIME['zip-office'];
  }
  if (kind === 'ole') {
    if (ext === '.xls') return 'application/vnd.ms-excel';
    return KIND_MIME.ole;
  }
  if (kind === 'text') {
    if (ext === '.csv') return 'text/csv';
    return 'text/plain';
  }
  if (kind === 'heic' && ext === '.heif') return 'image/heif';
  return KIND_MIME[kind];
}

function extMatchesKind(kind: Exclude<DetectedUploadKind, 'rejected'>, ext: string): boolean {
  if (kind === 'pdf') return PDF_EXT.has(ext);
  if (kind === 'jpeg') return ext === '.jpg' || ext === '.jpeg';
  if (kind === 'png') return ext === '.png';
  if (kind === 'gif') return ext === '.gif';
  if (kind === 'webp') return ext === '.webp';
  if (kind === 'heic') return HEIC_EXT.has(ext);
  if (kind === 'tiff') return TIFF_EXT.has(ext);
  if (kind === 'ole') return OLE_EXT.has(ext);
  if (kind === 'zip-office') return OFFICE_ZIP_EXT.has(ext);
  if (kind === 'rtf') return RTF_EXT.has(ext);
  if (kind === 'text') return TEXT_EXT.has(ext);
  if (kind === 'xml') return XML_EXT.has(ext);
  return false;
}

export function inspectZipOfficeThreat(buf: Buffer): string | null {
  if (!startsWith(buf, ZIP)) return 'Unsupported or disguised file content';
  const flag = buf.readUInt16LE(6);
  if (flag & 0x1) return 'Encrypted archives are not allowed';
  let offset = 0;
  let entries = 0;
  let uncompressedTotal = 0;
  while (offset + 30 <= buf.length && entries < 250) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) break;
    const compressed = buf.readUInt32LE(offset + 18);
    const uncompressed = buf.readUInt32LE(offset + 22);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const name = buf.subarray(offset + 30, offset + 30 + nameLen).toString('utf8').toLowerCase();
    if (name.includes('..') || name.startsWith('/') || name.includes('\\')) return 'Archive path is not allowed';
    if (name.includes('vbaproject.bin') || name.includes('vbaData.xml'.toLowerCase()) || name.includes('xl/macrosheets')) {
      return 'Macro-enabled Office documents are not allowed';
    }
    if (uncompressed > 80 * 1024 * 1024 || (compressed > 0 && uncompressed / compressed > 100)) {
      return 'Archive expansion limit exceeded';
    }
    uncompressedTotal += uncompressed;
    if (uncompressedTotal > 120 * 1024 * 1024) return 'Archive expansion limit exceeded';
    entries += 1;
    offset += 30 + nameLen + extraLen + compressed;
  }
  if (entries > 200) return 'Archive expansion limit exceeded';
  return null;
}

export function inspectPdfThreat(buf: Buffer): string | null {
  const sample = buf.subarray(0, Math.min(buf.length, 2 * 1024 * 1024)).toString('latin1');
  if (/\/JavaScript\b|\/JS\b|\/RichMedia\b|\/Launch\b/.test(sample) || /app\s*\.\s*alert/i.test(sample)) {
    return 'PDF contains active or scripted content';
  }
  const head = buf.subarray(0, Math.min(buf.length, 64)).toString('utf8').toLowerCase();
  if (head.includes('<html') || head.includes('<script') || head.includes('%pdf') && head.includes('<!doctype')) {
    return 'Polyglot or scripted file content is not allowed';
  }
  return null;
}

export function inspectOleThreat(buf: Buffer): string | null {
  if (buf.includes(Buffer.from('_VBA_PROJECT')) || buf.includes(Buffer.from('V\0B\0A\0'))) {
    return 'Macro-enabled Office documents are not allowed';
  }
  return null;
}

export function inspectStructuralThreat(kind: Exclude<DetectedUploadKind, 'rejected'>, buf: Buffer): string | null {
  if (kind === 'pdf') return inspectPdfThreat(buf);
  if (kind === 'zip-office') return inspectZipOfficeThreat(buf);
  if (kind === 'ole') return inspectOleThreat(buf);
  if (kind === 'xml') {
    const head = buf.subarray(0, Math.min(buf.length, 256)).toString('utf8').toLowerCase();
    if (head.includes('<svg') || head.includes('<!entity')) return 'XML content is not allowed';
  }
  return null;
}

export function guardUploadContent(params: {
  buf: Buffer;
  fileName: string;
  claimedMime?: string | null;
  maxBytes?: number;
  allowedKinds: Array<Exclude<DetectedUploadKind, 'rejected'>>;
}): FileContentGuardResult {
  const fileName = sanitizeUploadFileName(params.fileName);
  if (!fileName) return { ok: false, reason: 'Invalid file name' };
  if (hasDangerousDoubleExtension(fileName)) return { ok: false, reason: 'Dangerous or double file extension' };
  if (!params.buf.length) return { ok: false, reason: 'File is empty' };
  const maxBytes = params.maxBytes ?? DEFAULT_UPLOAD_MAX_BYTES;
  if (params.buf.length > maxBytes) {
    return { ok: false, reason: `File too large. Max ${Math.floor(maxBytes / 1024 / 1024)}MB` };
  }

  const kind = detectUploadKind(params.buf);
  if (kind === 'rejected') return { ok: false, reason: 'Unsupported or disguised file content' };
  if (!params.allowedKinds.includes(kind)) return { ok: false, reason: `File type not allowed: ${kind}` };

  const ext = extOf(fileName);
  if (DANGEROUS_EXT.has(ext)) return { ok: false, reason: 'Executable or script files are not allowed' };
  if (!extMatchesKind(kind, ext)) {
    return { ok: false, reason: 'File extension does not match file content' };
  }

  const structural = inspectStructuralThreat(kind, params.buf);
  if (structural) return { ok: false, reason: structural };

  const claimed = (params.claimedMime ?? '').toLowerCase().split(';')[0].trim();
  const mime = mimeFor(kind, ext);
  if (claimed && claimed !== 'application/octet-stream' && claimed !== mime) {
    const compatible =
      (kind === 'jpeg' && (claimed === 'image/jpg' || claimed === 'image/jpeg')) ||
      (kind === 'heic' && (claimed === 'image/heic' || claimed === 'image/heif')) ||
      (kind === 'tiff' && (claimed === 'image/tiff' || claimed === 'image/tif')) ||
      (kind === 'xml' && (claimed === 'text/xml' || claimed === 'application/xml')) ||
      (kind === 'text' && (claimed === 'text/plain' || claimed === 'text/csv'));
    if (!compatible) return { ok: false, reason: 'Declared file type does not match file content' };
  }

  return { ok: true, kind, mime, fileName };
}

/** Default business evidence formats. Workflows must pass a narrower list when needed. */
export const BUSINESS_DOCUMENT_UPLOAD_KINDS: Array<Exclude<DetectedUploadKind, 'rejected'>> = [
  'pdf',
  'jpeg',
  'png',
  'webp',
  'heic',
  'tiff',
  'zip-office',
  'text',
  'xml',
];

/** Existing office/DocFlow allowlist — keeps GIF/OLE/RTF for current workflows. */
export const OFFICE_DOCUMENT_UPLOAD_KINDS: Array<Exclude<DetectedUploadKind, 'rejected'>> = [
  'pdf',
  'jpeg',
  'png',
  'gif',
  'webp',
  'heic',
  'tiff',
  'ole',
  'zip-office',
  'rtf',
  'text',
  'xml',
];

export const IMAGE_UPLOAD_KINDS: Array<Exclude<DetectedUploadKind, 'rejected'>> = ['jpeg', 'png', 'gif', 'webp'];
