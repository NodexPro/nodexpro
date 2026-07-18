/**
 * Logo visible-content fit — no per-logo magic scale.
 *
 * Algorithm:
 * 1. Decode image pixels (PNG with alpha; opaque formats pass through).
 * 2. Find the axis-aligned bounding box of pixels with alpha > threshold
 *    (ignores near-transparent fringe).
 * 3. Crop the bitmap to that box so the data URL contains only visible content.
 * 4. CSS fits the cropped image with object-fit:contain inside the fixed frame,
 *    leaving LOGO_FRAME_PADDING_RATIO inset on each side (~4%).
 *
 * Equivalent scale (for docs/tests) after crop:
 *   scale = min(frameW / contentW, frameH / contentH) * (1 - 2 * paddingRatio)
 * After crop, contentW/H == image size, so CSS max ~92% realizes that fit.
 */
import { decodePngToRgba, encodeRgbaPng } from './income-document-logo-png.pure.js';
import { SECTIONED_LOGO_FRAME } from './income-document-sectioned-logo-frame.pure.js';
/** Alpha below this is treated as empty margin (0–255). */
export const LOGO_ALPHA_THRESHOLD = 10;
/** ~4% inset from each frame edge (within 3–5% target). */
export const LOGO_FRAME_PADDING_RATIO = 0.04;
/**
 * Scan RGBA buffer (4 bytes/pixel) for non-transparent content bounds.
 */
export function findVisibleLogoBounds(rgba, width, height, alphaThreshold = LOGO_ALPHA_THRESHOLD) {
    if (width <= 0 || height <= 0 || rgba.length < width * height * 4)
        return null;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const a = rgba[(y * width + x) * 4 + 3] ?? 0;
            if (a > alphaThreshold) {
                if (x < minX)
                    minX = x;
                if (y < minY)
                    minY = y;
                if (x > maxX)
                    maxX = x;
                if (y > maxY)
                    maxY = y;
            }
        }
    }
    if (maxX < minX || maxY < minY)
        return null;
    return {
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
    };
}
/**
 * Largest uniform scale that fits content into the frame with edge padding.
 * Documents the fit math; CSS uses cropped image + fit fraction instead of a fixed scale.
 */
export function computeLargestSafeLogoFitScale(input) {
    const frameW = input.frame_width_px ?? SECTIONED_LOGO_FRAME.width_px;
    const frameH = input.frame_height_px ?? SECTIONED_LOGO_FRAME.height_px;
    const pad = input.padding_ratio ?? LOGO_FRAME_PADDING_RATIO;
    const cw = input.content_width_px;
    const ch = input.content_height_px;
    if (!(cw > 0) || !(ch > 0) || !(frameW > 0) || !(frameH > 0))
        return 1;
    const innerW = frameW * (1 - 2 * pad);
    const innerH = frameH * (1 - 2 * pad);
    return Math.min(innerW / cw, innerH / ch);
}
export function cropRgbaToBounds(rgba, srcWidth, bounds) {
    const out = Buffer.alloc(bounds.width * bounds.height * 4);
    for (let y = 0; y < bounds.height; y += 1) {
        const srcRow = ((bounds.minY + y) * srcWidth + bounds.minX) * 4;
        const dstRow = y * bounds.width * 4;
        out.set(rgba.subarray(srcRow, srcRow + bounds.width * 4), dstRow);
    }
    return out;
}
function parseDataUrl(dataUrl) {
    const m = /^data:([^;,]+);base64,(.+)$/s.exec(dataUrl.trim());
    if (!m)
        return null;
    try {
        return { mime: m[1].split(';')[0].trim().toLowerCase(), buffer: Buffer.from(m[2], 'base64') };
    }
    catch {
        return null;
    }
}
/**
 * Crop transparent margins from a PNG buffer. Returns null if unchanged / not applicable.
 */
export function trimTransparentMarginsFromPngBuffer(buffer) {
    const decoded = decodePngToRgba(buffer);
    if (!decoded)
        return null;
    const bounds = findVisibleLogoBounds(decoded.data, decoded.width, decoded.height);
    if (!bounds)
        return null;
    if (bounds.width === decoded.width &&
        bounds.height === decoded.height &&
        bounds.minX === 0 &&
        bounds.minY === 0) {
        return null;
    }
    const croppedRgba = cropRgbaToBounds(decoded.data, decoded.width, bounds);
    return {
        buffer: encodeRgbaPng(croppedRgba, bounds.width, bounds.height),
        bounds,
        source_width: decoded.width,
        source_height: decoded.height,
    };
}
/**
 * Prepare a logo data URL so rendering uses visible content, not canvas padding.
 * Opaque JPEG/WebP and already-tight PNGs are returned unchanged.
 */
export function prepareLogoDataUrlForDocumentRender(dataUrl) {
    if (dataUrl == null)
        return null;
    const trimmed = String(dataUrl).trim();
    if (!trimmed)
        return null;
    const parsed = parseDataUrl(trimmed);
    if (!parsed)
        return trimmed;
    if (parsed.mime !== 'image/png' && parsed.mime !== 'image/x-png') {
        return trimmed;
    }
    const result = trimTransparentMarginsFromPngBuffer(parsed.buffer);
    if (!result)
        return trimmed;
    return `data:image/png;base64,${result.buffer.toString('base64')}`;
}
/** CSS fraction of the frame used for the logo after padding (e.g. 0.92). */
export function logoCssFitFraction(paddingRatio = LOGO_FRAME_PADDING_RATIO) {
    return Math.max(0.5, Math.min(1, 1 - 2 * paddingRatio));
}
export function logoCssFitPercent(paddingRatio = LOGO_FRAME_PADDING_RATIO) {
    return `${(logoCssFitFraction(paddingRatio) * 100).toFixed(0)}%`;
}
