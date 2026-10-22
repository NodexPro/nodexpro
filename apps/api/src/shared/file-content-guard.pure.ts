/**
 * Upload content guard — inspects bytes, not client MIME/extension claims.
 * Presentation-free: returns detected kind + a storage MIME, or rejects.
 */

export type DetectedUploadKind =
  | 'pdf'
  | 'jpeg'
  | 'png'
  | 'gif'
  | 'webp'
  | 'ole'
  | 'zip-office'
  | 'rtf'
  | 'text'
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

const OFFICE_ZIP_EXT = new Set(['.docx', '.xlsx', '.odt']);
const TEXT_EXT = new Set(['.txt', '.csv']);
const PDF_EXT = new Set(['.pdf']);
const OLE_EXT = new Set(['.doc', '.xls']);
const RTF_EXT = new Set(['.rtf']);

const KIND_MIME: Record<Exclude<DetectedUploadKind, 'rejected'>, string> = {
  pdf: 'application/pdf',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  ole: 'application/msword',
  'zip-office': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  rtf: 'application/rtf',
  text: 'text/plain',
};

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

export function detectUploadKind(buf: Buffer): DetectedUploadKind {
  if (!buf.length) return 'rejected';
  if (startsWith(buf, PDF)) return 'pdf';
  if (startsWith(buf, PNG)) return 'png';
  if (startsWith(buf, JPEG)) return 'jpeg';
  if (startsWith(buf, GIF87) || startsWith(buf, GIF89)) return 'gif';
  if (startsWith(buf, RIFF) && buf.length >= 12 && startsWith(buf, WEBP, 8)) return 'webp';
  if (startsWith(buf, OLE)) return 'ole';
  if (startsWith(buf, ZIP)) return 'zip-office';
  if (startsWith(buf, RTF)) return 'rtf';
  if (looksLikeText(buf)) return 'text';
  return 'rejected';
}

function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 4096));
  if (sample.includes(0)) return false;
  const head = sample.subarray(0, Math.min(sample.length, 256)).toString('utf8').trim().toLowerCase();
  if (head.startsWith('<!doctype') || head.startsWith('<html') || head.startsWith('<script')) return false;
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
  return KIND_MIME[kind];
}

function extMatchesKind(kind: Exclude<DetectedUploadKind, 'rejected'>, ext: string): boolean {
  if (kind === 'pdf') return PDF_EXT.has(ext);
  if (kind === 'jpeg') return ext === '.jpg' || ext === '.jpeg';
  if (kind === 'png') return ext === '.png';
  if (kind === 'gif') return ext === '.gif';
  if (kind === 'webp') return ext === '.webp';
  if (kind === 'ole') return OLE_EXT.has(ext);
  if (kind === 'zip-office') return OFFICE_ZIP_EXT.has(ext);
  if (kind === 'rtf') return RTF_EXT.has(ext);
  if (kind === 'text') return TEXT_EXT.has(ext);
  return false;
}

export function guardUploadContent(params: {
  buf: Buffer;
  fileName: string;
  claimedMime?: string | null;
  maxBytes: number;
  allowedKinds: Array<Exclude<DetectedUploadKind, 'rejected'>>;
}): FileContentGuardResult {
  const fileName = sanitizeUploadFileName(params.fileName);
  if (!fileName) return { ok: false, reason: 'Invalid file name' };
  if (!params.buf.length) return { ok: false, reason: 'File is empty' };
  if (params.buf.length > params.maxBytes) {
    return { ok: false, reason: `File too large. Max ${Math.floor(params.maxBytes / 1024 / 1024)}MB` };
  }

  const kind = detectUploadKind(params.buf);
  if (kind === 'rejected') return { ok: false, reason: 'Unsupported or disguised file content' };
  if (!params.allowedKinds.includes(kind)) return { ok: false, reason: `File type not allowed: ${kind}` };

  const ext = extOf(fileName);
  if (!extMatchesKind(kind, ext)) {
    return { ok: false, reason: 'File extension does not match file content' };
  }

  const claimed = (params.claimedMime ?? '').toLowerCase().split(';')[0].trim();
  const mime = mimeFor(kind, ext);
  if (claimed && claimed !== 'application/octet-stream' && claimed !== mime) {
    const compatible =
      (kind === 'jpeg' && (claimed === 'image/jpg' || claimed === 'image/jpeg')) ||
      (kind === 'text' && (claimed === 'text/plain' || claimed === 'text/csv'));
    if (!compatible) return { ok: false, reason: 'Declared file type does not match file content' };
  }

  return { ok: true, kind, mime, fileName };
}

export const OFFICE_DOCUMENT_UPLOAD_KINDS: Array<Exclude<DetectedUploadKind, 'rejected'>> = [
  'pdf',
  'jpeg',
  'png',
  'gif',
  'webp',
  'ole',
  'zip-office',
  'rtf',
  'text',
];

export const IMAGE_UPLOAD_KINDS: Array<Exclude<DetectedUploadKind, 'rejected'>> = ['jpeg', 'png', 'gif', 'webp'];
