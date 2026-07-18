/**
 * Logo visible-content fit — no per-logo magic scale.
 *
 * Pipeline:
 * 1. prepareLogoDataUrlForDocumentRenderDetailed() is called from the HTML renderer.
 * 2. PNG → decode → alpha bbox → crop → new data URL.
 * 3. Renderer sets <img src> to that cropped data URL (never the raw padded canvas when trim applies).
 */
import { decodePngToRgbaDetailed, encodeRgbaPng, } from './income-document-logo-png.pure.js';
import { SECTIONED_LOGO_FRAME } from './income-document-sectioned-logo-frame.pure.js';
/** Alpha below this is treated as empty margin (0–255). */
export const LOGO_ALPHA_THRESHOLD = 10;
/** ~4% inset from each frame edge (within 3–5% target). */
export const LOGO_FRAME_PADDING_RATIO = 0.04;
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
function sourceKind(mime) {
    if (!mime)
        return 'other';
    if (mime === 'image/png' || mime === 'image/x-png')
        return 'png';
    if (mime === 'image/jpeg' || mime === 'image/jpg')
        return 'jpeg';
    if (mime === 'image/webp')
        return 'webp';
    return 'other';
}
function renderedSizeForContent(contentW, contentH) {
    const scale = computeLargestSafeLogoFitScale({
        content_width_px: contentW,
        content_height_px: contentH,
    });
    return {
        width: Math.round(contentW * scale),
        height: Math.round(contentH * scale),
    };
}
function baseDiagnostics(partial) {
    return {
        prepare_called: true,
        frame_width_px: SECTIONED_LOGO_FRAME.width_px,
        frame_height_px: SECTIONED_LOGO_FRAME.height_px,
        fit_padding_ratio: LOGO_FRAME_PADDING_RATIO,
        ...partial,
    };
}
/**
 * Crop transparent margins from a PNG buffer. Returns null if unchanged / not applicable.
 */
export function trimTransparentMarginsFromPngBuffer(buffer) {
    const decoded = decodePngToRgbaDetailed(buffer);
    if (!decoded.ok)
        return null;
    const { image } = decoded;
    const bounds = findVisibleLogoBounds(image.data, image.width, image.height);
    if (!bounds)
        return null;
    if (bounds.width === image.width &&
        bounds.height === image.height &&
        bounds.minX === 0 &&
        bounds.minY === 0) {
        return null;
    }
    const croppedRgba = cropRgbaToBounds(image.data, image.width, bounds);
    return {
        buffer: encodeRgbaPng(croppedRgba, bounds.width, bounds.height),
        bounds,
        source_width: image.width,
        source_height: image.height,
    };
}
export function prepareLogoDataUrlForDocumentRenderDetailed(dataUrl) {
    if (dataUrl == null || !String(dataUrl).trim()) {
        return baseDiagnostics({
            mime: null,
            source_kind: 'missing',
            trim_status: 'missing',
            decode_reason: null,
            color_type: null,
            bit_depth: null,
            interlaced: null,
            original_width: null,
            original_height: null,
            bounds: null,
            cropped_width: null,
            cropped_height: null,
            src_changed: false,
            final_src_is_cropped: false,
            final_src_byte_length: null,
            final_src_prefix: null,
            final_rendered_width_px: null,
            final_rendered_height_px: null,
            data_url: null,
        });
    }
    const trimmed = String(dataUrl).trim();
    const parsed = parseDataUrl(trimmed);
    if (!parsed) {
        return baseDiagnostics({
            mime: null,
            source_kind: 'invalid_data_url',
            trim_status: 'invalid_data_url',
            decode_reason: 'data_url_parse_failed',
            color_type: null,
            bit_depth: null,
            interlaced: null,
            original_width: null,
            original_height: null,
            bounds: null,
            cropped_width: null,
            cropped_height: null,
            src_changed: false,
            final_src_is_cropped: false,
            final_src_byte_length: trimmed.length,
            final_src_prefix: trimmed.slice(0, 48),
            final_rendered_width_px: null,
            final_rendered_height_px: null,
            data_url: trimmed,
        });
    }
    const kind = sourceKind(parsed.mime);
    if (kind !== 'png') {
        return baseDiagnostics({
            mime: parsed.mime,
            source_kind: kind,
            trim_status: 'skipped_opaque_format',
            decode_reason: null,
            color_type: null,
            bit_depth: null,
            interlaced: null,
            original_width: null,
            original_height: null,
            bounds: null,
            cropped_width: null,
            cropped_height: null,
            src_changed: false,
            final_src_is_cropped: false,
            final_src_byte_length: trimmed.length,
            final_src_prefix: trimmed.slice(0, 48),
            final_rendered_width_px: null,
            final_rendered_height_px: null,
            data_url: trimmed,
        });
    }
    const decoded = decodePngToRgbaDetailed(parsed.buffer);
    if (!decoded.ok) {
        return baseDiagnostics({
            mime: parsed.mime,
            source_kind: 'png',
            trim_status: 'failed_decode',
            decode_reason: decoded.reason,
            color_type: decoded.color_type,
            bit_depth: decoded.bit_depth,
            interlaced: decoded.interlaced,
            original_width: decoded.width,
            original_height: decoded.height,
            bounds: null,
            cropped_width: null,
            cropped_height: null,
            src_changed: false,
            final_src_is_cropped: false,
            final_src_byte_length: trimmed.length,
            final_src_prefix: trimmed.slice(0, 48),
            final_rendered_width_px: null,
            final_rendered_height_px: null,
            data_url: trimmed,
        });
    }
    const { image } = decoded;
    const bounds = findVisibleLogoBounds(image.data, image.width, image.height);
    if (!bounds ||
        (bounds.width === image.width &&
            bounds.height === image.height &&
            bounds.minX === 0 &&
            bounds.minY === 0)) {
        const rendered = renderedSizeForContent(image.width, image.height);
        return baseDiagnostics({
            mime: parsed.mime,
            source_kind: 'png',
            trim_status: 'skipped_no_margin',
            decode_reason: null,
            color_type: image.color_type,
            bit_depth: image.bit_depth,
            interlaced: false,
            original_width: image.width,
            original_height: image.height,
            bounds: bounds ?? {
                minX: 0,
                minY: 0,
                maxX: image.width - 1,
                maxY: image.height - 1,
                width: image.width,
                height: image.height,
            },
            cropped_width: image.width,
            cropped_height: image.height,
            src_changed: false,
            final_src_is_cropped: false,
            final_src_byte_length: trimmed.length,
            final_src_prefix: trimmed.slice(0, 48),
            final_rendered_width_px: rendered.width,
            final_rendered_height_px: rendered.height,
            data_url: trimmed,
        });
    }
    const croppedRgba = cropRgbaToBounds(image.data, image.width, bounds);
    const croppedPng = encodeRgbaPng(croppedRgba, bounds.width, bounds.height);
    const croppedUrl = `data:image/png;base64,${croppedPng.toString('base64')}`;
    const rendered = renderedSizeForContent(bounds.width, bounds.height);
    return baseDiagnostics({
        mime: parsed.mime,
        source_kind: 'png',
        trim_status: 'applied',
        decode_reason: null,
        color_type: image.color_type,
        bit_depth: image.bit_depth,
        interlaced: false,
        original_width: image.width,
        original_height: image.height,
        bounds,
        cropped_width: bounds.width,
        cropped_height: bounds.height,
        src_changed: true,
        final_src_is_cropped: true,
        final_src_byte_length: croppedUrl.length,
        final_src_prefix: croppedUrl.slice(0, 48),
        final_rendered_width_px: rendered.width,
        final_rendered_height_px: rendered.height,
        data_url: croppedUrl,
    });
}
export function prepareLogoDataUrlForDocumentRender(dataUrl) {
    return prepareLogoDataUrlForDocumentRenderDetailed(dataUrl).data_url;
}
export function logoCssFitFraction(paddingRatio = LOGO_FRAME_PADDING_RATIO) {
    return Math.max(0.5, Math.min(1, 1 - 2 * paddingRatio));
}
export function logoCssFitPercent(paddingRatio = LOGO_FRAME_PADDING_RATIO) {
    return `${(logoCssFitFraction(paddingRatio) * 100).toFixed(0)}%`;
}
