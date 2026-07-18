/**
 * Branding Studio guidance for logos destined for the wide sectioned frame.
 * Warn-only — never reject uploads based on aspect ratio.
 */

import {
  SECTIONED_LOGO_FRAME,
  SECTIONED_LOGO_RECOMMENDED_UPLOAD,
} from './income-document-sectioned-logo-frame.pure.js';

/** Preferred upload canvas (≈ frame aspect × 4). */
export const WIDE_LOGO_RECOMMENDED_UPLOAD = SECTIONED_LOGO_RECOMMENDED_UPLOAD;

/** Logos narrower than this (width/height) get a Studio warning for the wide frame. */
export const WIDE_LOGO_MIN_ASPECT_RATIO = 3;

export type LogoImageDimensions = {
  width_px: number;
  height_px: number;
};

export type WideLogoAspectAssessment = {
  width_px: number | null;
  height_px: number | null;
  /** width / height when known */
  aspect_ratio: number | null;
  aspect_ratio_label: string | null;
  /** True when measured aspect is below the wide-frame warning threshold. */
  narrow_for_wide_frame: boolean;
  /** Hebrew warning for Branding Studio; null when no warning. */
  aspect_ratio_warning: string | null;
};

function parseDataUrl(dataUrl: string): { mime: string; buffer: Buffer } | null {
  const m = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl.trim());
  if (!m) return null;
  try {
    return { mime: m[1].split(';')[0].trim().toLowerCase(), buffer: Buffer.from(m[2], 'base64') };
  } catch {
    return null;
  }
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function readPngDimensions(buffer: Buffer): LogoImageDimensions | null {
  if (buffer.length < 24) return null;
  if (buffer.compare(PNG_SIG, 0, 8, 0, 8) !== 0) return null;
  // IHDR is the first chunk after the 8-byte signature
  if (buffer.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width_px = buffer.readUInt32BE(16);
  const height_px = buffer.readUInt32BE(20);
  if (!(width_px > 0) || !(height_px > 0)) return null;
  return { width_px, height_px };
}

function readJpegDimensions(buffer: Buffer): LogoImageDimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd9) {
      offset += 2;
      continue;
    }
    if (offset + 4 > buffer.length) break;
    const segLen = buffer.readUInt16BE(offset + 2);
    if (segLen < 2) break;
    // SOF0 / SOF1 / SOF2 … (baseline / extended / progressive)
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (offset + 9 >= buffer.length) break;
      const height_px = buffer.readUInt16BE(offset + 5);
      const width_px = buffer.readUInt16BE(offset + 7);
      if (!(width_px > 0) || !(height_px > 0)) return null;
      return { width_px, height_px };
    }
    offset += 2 + segLen;
  }
  return null;
}

function readWebpDimensions(buffer: Buffer): LogoImageDimensions | null {
  if (buffer.length < 30) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') {
    return null;
  }
  const chunk = buffer.toString('ascii', 12, 16);
  if (chunk === 'VP8X' && buffer.length >= 30) {
    const width_px = 1 + buffer.readUIntLE(24, 3);
    const height_px = 1 + buffer.readUIntLE(27, 3);
    if (!(width_px > 0) || !(height_px > 0)) return null;
    return { width_px, height_px };
  }
  if (chunk === 'VP8L' && buffer.length >= 25) {
    const b0 = buffer[21]!;
    const b1 = buffer[22]!;
    const b2 = buffer[23]!;
    const b3 = buffer[24]!;
    const width_px = 1 + (((b1 & 0x3f) << 8) | b0);
    const height_px = 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
    if (!(width_px > 0) || !(height_px > 0)) return null;
    return { width_px, height_px };
  }
  if (chunk === 'VP8 ' && buffer.length >= 30) {
    // Lossy start code 0x9d 0x01 0x2a at offset 23
    if (buffer[23] !== 0x9d || buffer[24] !== 0x01 || buffer[25] !== 0x2a) return null;
    const width_px = buffer.readUInt16LE(26) & 0x3fff;
    const height_px = buffer.readUInt16LE(28) & 0x3fff;
    if (!(width_px > 0) || !(height_px > 0)) return null;
    return { width_px, height_px };
  }
  return null;
}

export function probeLogoImageDimensions(
  mime: string | null | undefined,
  buffer: Buffer,
): LogoImageDimensions | null {
  const m = (mime || '').toLowerCase();
  if (m === 'image/png' || m === 'image/x-png' || (!m && buffer[0] === 0x89)) {
    return readPngDimensions(buffer);
  }
  if (m === 'image/jpeg' || m === 'image/jpg' || (!m && buffer[0] === 0xff && buffer[1] === 0xd8)) {
    return readJpegDimensions(buffer);
  }
  if (m === 'image/webp' || (!m && buffer.toString('ascii', 0, 4) === 'RIFF')) {
    return readWebpDimensions(buffer);
  }
  return (
    readPngDimensions(buffer) || readJpegDimensions(buffer) || readWebpDimensions(buffer)
  );
}

export function formatLogoAspectRatioLabel(aspect: number): string {
  if (!(aspect > 0) || !Number.isFinite(aspect)) return '—';
  const rounded = Math.round(aspect * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${text}∶1`;
}

export function buildWideLogoAspectRatioWarning(aspect: number): string {
  return [
    `יחס הלוגו שהועלה (${formatLogoAspectRatioLabel(aspect)}) צר מדי למסגרת הרחבה של המסמך.`,
    `מומלץ לוגו אופקי ביחס של כ־${SECTIONED_LOGO_FRAME.aspect_ratio_label} (למשל ${WIDE_LOGO_RECOMMENDED_UPLOAD.width_px}×${WIDE_LOGO_RECOMMENDED_UPLOAD.height_px} פיקסלים).`,
    'הלוגו עדיין יישמר ויוצג — זו אזהרה בלבד.',
  ].join(' ');
}

export function assessLogoAspectForWideFrame(
  dataUrl: string | null | undefined,
): WideLogoAspectAssessment {
  const empty: WideLogoAspectAssessment = {
    width_px: null,
    height_px: null,
    aspect_ratio: null,
    aspect_ratio_label: null,
    narrow_for_wide_frame: false,
    aspect_ratio_warning: null,
  };
  if (dataUrl == null || !String(dataUrl).trim()) return empty;
  const parsed = parseDataUrl(String(dataUrl).trim());
  if (!parsed) return empty;
  const dims = probeLogoImageDimensions(parsed.mime, parsed.buffer);
  if (!dims) return empty;
  const aspect_ratio = dims.width_px / dims.height_px;
  const narrow_for_wide_frame = aspect_ratio < WIDE_LOGO_MIN_ASPECT_RATIO;
  return {
    width_px: dims.width_px,
    height_px: dims.height_px,
    aspect_ratio,
    aspect_ratio_label: formatLogoAspectRatioLabel(aspect_ratio),
    narrow_for_wide_frame,
    aspect_ratio_warning: narrow_for_wide_frame
      ? buildWideLogoAspectRatioWarning(aspect_ratio)
      : null,
  };
}
