/**
 * Minimal PNG decode/encode for logo visible-bounds trim (8-bit gray/RGB/RGBA).
 * No native image dependency — works in any API runtime.
 */

import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export type DecodedPngRgba = {
  width: number;
  height: number;
  data: Buffer;
};

function readChunk(buf: Buffer, offset: number): { type: string; data: Buffer; next: number } | null {
  if (offset + 8 > buf.length) return null;
  const len = buf.readUInt32BE(offset);
  const type = buf.toString('ascii', offset + 4, offset + 8);
  const dataStart = offset + 8;
  const dataEnd = dataStart + len;
  if (dataEnd + 4 > buf.length) return null;
  return { type, data: buf.subarray(dataStart, dataEnd), next: dataEnd + 4 };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterScanlines(
  inflated: Buffer,
  width: number,
  height: number,
  bytesPerPixel: number,
): Buffer {
  const stride = width * bytesPerPixel;
  const out = Buffer.alloc(height * stride);
  let src = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = inflated[src++];
    const row = inflated.subarray(src, src + stride);
    src += stride;
    const dst = y * stride;
    const prev = y === 0 ? null : out.subarray(dst - stride, dst);
    for (let i = 0; i < stride; i += 1) {
      const x = row[i];
      const left = i >= bytesPerPixel ? out[dst + i - bytesPerPixel] : 0;
      const up = prev ? prev[i] : 0;
      const upLeft = prev && i >= bytesPerPixel ? prev[i - bytesPerPixel] : 0;
      let val = 0;
      switch (filter) {
        case 0:
          val = x;
          break;
        case 1:
          val = (x + left) & 255;
          break;
        case 2:
          val = (x + up) & 255;
          break;
        case 3:
          val = (x + Math.floor((left + up) / 2)) & 255;
          break;
        case 4:
          val = (x + paeth(left, up, upLeft)) & 255;
          break;
        default:
          throw new Error(`Unsupported PNG filter ${filter}`);
      }
      out[dst + i] = val;
    }
  }
  return out;
}

function toRgba(raw: Buffer, width: number, height: number, colorType: number): Buffer {
  const px = width * height;
  if (colorType === 6) return Buffer.from(raw);
  if (colorType === 2) {
    const out = Buffer.alloc(px * 4);
    for (let i = 0, j = 0; i < px; i += 1, j += 3) {
      out[i * 4] = raw[j];
      out[i * 4 + 1] = raw[j + 1];
      out[i * 4 + 2] = raw[j + 2];
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  if (colorType === 4) {
    const out = Buffer.alloc(px * 4);
    for (let i = 0, j = 0; i < px; i += 1, j += 2) {
      const g = raw[j];
      out[i * 4] = g;
      out[i * 4 + 1] = g;
      out[i * 4 + 2] = g;
      out[i * 4 + 3] = raw[j + 1];
    }
    return out;
  }
  if (colorType === 0) {
    const out = Buffer.alloc(px * 4);
    for (let i = 0; i < px; i += 1) {
      const g = raw[i];
      out[i * 4] = g;
      out[i * 4 + 1] = g;
      out[i * 4 + 2] = g;
      out[i * 4 + 3] = 255;
    }
    return out;
  }
  throw new Error(`Unsupported PNG color type ${colorType}`);
}

export function decodePngToRgba(buffer: Buffer): DecodedPngRgba | null {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIG)) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  const idat: Buffer[] = [];
  while (offset < buffer.length) {
    const chunk = readChunk(buffer, offset);
    if (!chunk) break;
    offset = chunk.next;
    if (chunk.type === 'IHDR') {
      width = chunk.data.readUInt32BE(0);
      height = chunk.data.readUInt32BE(4);
      bitDepth = chunk.data[8];
      colorType = chunk.data[9];
      if (chunk.data[10] !== 0 || chunk.data[11] !== 0 || chunk.data[12] !== 0) return null;
    } else if (chunk.type === 'IDAT') {
      idat.push(chunk.data);
    } else if (chunk.type === 'IEND') {
      break;
    }
  }
  if (!(width > 0) || !(height > 0) || bitDepth !== 8) return null;
  if (![0, 2, 4, 6].includes(colorType)) return null;
  const bytesPerPixel = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  try {
    const inflated = inflateSync(Buffer.concat(idat));
    const raw = unfilterScanlines(inflated, width, height, bytesPerPixel);
    return { width, height, data: toRgba(raw, width, height, colorType) };
  } catch {
    return null;
  }
}

/** CRC32 for PNG chunks (ISO 3309). */
function pngCrc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c ^= buf[i];
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(pngCrc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function filterNone(rgba: Buffer, width: number, height: number): Buffer {
  const stride = width * 4;
  const out = Buffer.alloc(height * (1 + stride));
  for (let y = 0; y < height; y += 1) {
    const o = y * (1 + stride);
    out[o] = 0;
    rgba.copy(out, o + 1, y * stride, y * stride + stride);
  }
  return out;
}

export function encodeRgbaPng(rgba: Buffer, width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const filtered = filterNone(rgba, width, height);
  const idat = deflateSync(filtered);
  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}
