/**
 * Minimal PNG decode/encode for logo visible-bounds trim.
 * Supports 8-bit gray/RGB/RGBA and indexed (PLTE + optional tRNS).
 */
import { deflateSync, inflateSync } from 'node:zlib';
const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function readChunk(buf, offset) {
    if (offset + 8 > buf.length)
        return null;
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + len;
    if (dataEnd + 4 > buf.length)
        return null;
    return { type, data: buf.subarray(dataStart, dataEnd), next: dataEnd + 4 };
}
function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc)
        return a;
    if (pb <= pc)
        return b;
    return c;
}
function unfilterScanlines(inflated, width, height, bytesPerPixel) {
    const rowBytes = width * bytesPerPixel;
    const out = Buffer.alloc(height * rowBytes);
    let src = 0;
    const bpp = Math.max(1, bytesPerPixel);
    for (let y = 0; y < height; y += 1) {
        const filter = inflated[src++];
        const row = inflated.subarray(src, src + rowBytes);
        src += rowBytes;
        const dst = y * rowBytes;
        const prev = y === 0 ? null : out.subarray(dst - rowBytes, dst);
        for (let i = 0; i < rowBytes; i += 1) {
            const x = row[i];
            const left = i >= bpp ? out[dst + i - bpp] : 0;
            const up = prev ? prev[i] : 0;
            const upLeft = prev && i >= bpp ? prev[i - bpp] : 0;
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
function channelsForColorType(colorType) {
    switch (colorType) {
        case 0:
            return 1;
        case 2:
            return 3;
        case 3:
            return 1;
        case 4:
            return 2;
        case 6:
            return 4;
        default:
            return 0;
    }
}
function expandIndexedToRgba(raw, width, height, palette, trns) {
    const out = Buffer.alloc(width * height * 4);
    const n = Math.floor(palette.length / 3);
    for (let i = 0; i < width * height; i += 1) {
        const idx = raw[i] ?? 0;
        const p = Math.min(idx, n - 1) * 3;
        out[i * 4] = palette[p] ?? 0;
        out[i * 4 + 1] = palette[p + 1] ?? 0;
        out[i * 4 + 2] = palette[p + 2] ?? 0;
        out[i * 4 + 3] = trns && idx < trns.length ? trns[idx] : 255;
    }
    return out;
}
function toRgba(raw, width, height, colorType) {
    const px = width * height;
    if (colorType === 6)
        return Buffer.from(raw);
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
export function decodePngToRgbaDetailed(buffer) {
    if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIG)) {
        return {
            ok: false,
            reason: 'not_png_signature',
            color_type: null,
            bit_depth: null,
            interlaced: null,
            width: null,
            height: null,
        };
    }
    let offset = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 0;
    let colorType = -1;
    let interlaced = 0;
    let palette = null;
    let trns = null;
    const idat = [];
    while (offset < buffer.length) {
        const chunk = readChunk(buffer, offset);
        if (!chunk)
            break;
        offset = chunk.next;
        if (chunk.type === 'IHDR') {
            width = chunk.data.readUInt32BE(0);
            height = chunk.data.readUInt32BE(4);
            bitDepth = chunk.data[8];
            colorType = chunk.data[9];
            if (chunk.data[10] !== 0 || chunk.data[11] !== 0) {
                return {
                    ok: false,
                    reason: 'unsupported_compression_or_filter_method',
                    color_type: colorType,
                    bit_depth: bitDepth,
                    interlaced: chunk.data[12] === 1,
                    width,
                    height,
                };
            }
            interlaced = chunk.data[12];
        }
        else if (chunk.type === 'PLTE') {
            palette = chunk.data;
        }
        else if (chunk.type === 'tRNS') {
            trns = chunk.data;
        }
        else if (chunk.type === 'IDAT') {
            idat.push(chunk.data);
        }
        else if (chunk.type === 'IEND') {
            break;
        }
    }
    if (!(width > 0) || !(height > 0)) {
        return {
            ok: false,
            reason: 'invalid_dimensions',
            color_type: colorType,
            bit_depth: bitDepth,
            interlaced: interlaced === 1,
            width,
            height,
        };
    }
    if (interlaced !== 0) {
        return {
            ok: false,
            reason: 'interlaced_not_supported',
            color_type: colorType,
            bit_depth: bitDepth,
            interlaced: true,
            width,
            height,
        };
    }
    if (bitDepth !== 8) {
        return {
            ok: false,
            reason: `bit_depth_${bitDepth}_not_supported`,
            color_type: colorType,
            bit_depth: bitDepth,
            interlaced: false,
            width,
            height,
        };
    }
    if (![0, 2, 3, 4, 6].includes(colorType)) {
        return {
            ok: false,
            reason: `color_type_${colorType}_not_supported`,
            color_type: colorType,
            bit_depth: bitDepth,
            interlaced: false,
            width,
            height,
        };
    }
    if (colorType === 3 && (!palette || palette.length < 3)) {
        return {
            ok: false,
            reason: 'indexed_missing_plte',
            color_type: colorType,
            bit_depth: bitDepth,
            interlaced: false,
            width,
            height,
        };
    }
    const channels = channelsForColorType(colorType);
    try {
        const inflated = inflateSync(Buffer.concat(idat));
        const raw = unfilterScanlines(inflated, width, height, channels);
        const data = colorType === 3
            ? expandIndexedToRgba(raw, width, height, palette, trns)
            : toRgba(raw, width, height, colorType);
        return {
            ok: true,
            image: { width, height, data, color_type: colorType, bit_depth: bitDepth },
        };
    }
    catch (err) {
        return {
            ok: false,
            reason: `decode_exception:${err instanceof Error ? err.message : 'unknown'}`,
            color_type: colorType,
            bit_depth: bitDepth,
            interlaced: false,
            width,
            height,
        };
    }
}
export function decodePngToRgba(buffer) {
    const result = decodePngToRgbaDetailed(buffer);
    return result.ok ? result.image : null;
}
function pngCrc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i += 1) {
        c ^= buf[i];
        for (let k = 0; k < 8; k += 1) {
            c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        }
    }
    return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
    const typeBuf = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(pngCrc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function filterNone(rgba, width, height) {
    const stride = width * 4;
    const out = Buffer.alloc(height * (1 + stride));
    for (let y = 0; y < height; y += 1) {
        const o = y * (1 + stride);
        out[o] = 0;
        rgba.copy(out, o + 1, y * stride, y * stride + stride);
    }
    return out;
}
export function encodeRgbaPng(rgba, width, height) {
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
