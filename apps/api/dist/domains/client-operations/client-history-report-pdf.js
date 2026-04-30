import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb } from 'pdf-lib';
const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** Hebrew subset WOFF has no Latin digits / punctuation — embed Latin + Hebrew and draw mixed runs RTL. */
function resolveNotoWoffPaths() {
    const base = path.join(API_ROOT, 'node_modules/@fontsource/noto-sans-hebrew/files');
    const hebrew = path.join(base, 'noto-sans-hebrew-hebrew-400-normal.woff');
    const latin = path.join(base, 'noto-sans-hebrew-latin-400-normal.woff');
    if (!fs.existsSync(hebrew)) {
        throw new Error(`PDF Hebrew font missing (install @fontsource/noto-sans-hebrew): ${hebrew}`);
    }
    if (!fs.existsSync(latin)) {
        throw new Error(`PDF Latin font missing (install @fontsource/noto-sans-hebrew): ${latin}`);
    }
    return { hebrew, latin };
}
function isHebrewScriptCodePoint(cp) {
    return (cp >= 0x0590 && cp <= 0x05ff) || (cp >= 0xfb1d && cp <= 0xfb4f);
}
function fontForCodePoint(cp, he, lat) {
    return isHebrewScriptCodePoint(cp) ? he : lat;
}
function widthOfMixedText(text, size, he, lat) {
    let w = 0;
    for (const ch of text) {
        const cp = ch.codePointAt(0);
        const f = fontForCodePoint(cp, he, lat);
        w += f.widthOfTextAtSize(ch, size);
    }
    return w;
}
function splitFontRuns(text, he, lat) {
    const runs = [];
    let cur = '';
    let curF = null;
    for (const ch of text) {
        const cp = ch.codePointAt(0);
        const f = fontForCodePoint(cp, he, lat);
        if (curF === null) {
            cur = ch;
            curF = f;
        }
        else if (f === curF) {
            cur += ch;
        }
        else {
            runs.push({ text: cur, font: curF });
            cur = ch;
            curF = f;
        }
    }
    if (cur && curF)
        runs.push({ text: cur, font: curF });
    return runs;
}
function wrapLines(text, size, maxWidth, he, lat) {
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length === 0)
        return [text];
    const lines = [];
    let cur = '';
    for (const w of words) {
        const trial = cur ? `${cur} ${w}` : w;
        if (widthOfMixedText(trial, size, he, lat) <= maxWidth)
            cur = trial;
        else {
            if (cur)
                lines.push(cur);
            cur = w;
        }
    }
    if (cur)
        lines.push(cur);
    return lines;
}
/**
 * Human-readable RTL-oriented PDF (A4). Same facts as CSV export; no raw audit payload.
 */
export async function buildHistoryReportPdfBuffer(params) {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);
    const { hebrew: hePath, latin: latPath } = resolveNotoWoffPaths();
    const [fontHe, fontLat] = await Promise.all([
        pdfDoc.embedFont(fs.readFileSync(hePath), { subset: false }),
        pdfDoc.embedFont(fs.readFileSync(latPath), { subset: false }),
    ]);
    const pageWidth = 595;
    const pageHeight = 842;
    const margin = 50;
    const maxTextW = pageWidth - 2 * margin;
    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;
    const newPageIfNeeded = (minY) => {
        if (y >= minY)
            return;
        page = pdfDoc.addPage([pageWidth, pageHeight]);
        y = pageHeight - margin;
    };
    const lineHeight = (size) => size * 1.35;
    const drawRtlMixedLine = (line, size, color) => {
        const runs = splitFontRuns(line, fontHe, fontLat);
        let x = pageWidth - margin;
        for (let i = runs.length - 1; i >= 0; i--) {
            const run = runs[i];
            const w = run.font.widthOfTextAtSize(run.text, size);
            x -= w;
            page.drawText(run.text, {
                x,
                y: y - size,
                size,
                font: run.font,
                color,
            });
        }
        y -= lineHeight(size);
    };
    const drawRtlParagraph = (text, size, color, gapAfter = 8) => {
        const lines = wrapLines(text, size, maxTextW, fontHe, fontLat);
        for (const line of lines) {
            newPageIfNeeded(margin + lineHeight(size) + 8);
            drawRtlMixedLine(line, size, color);
        }
        y -= gapAfter;
    };
    drawRtlParagraph('דוח היסטוריית פעולות', 16, rgb(0.05, 0.09, 0.16), 10);
    drawRtlParagraph(`לקוח: ${params.clientDisplayName}`, 12, rgb(0.1, 0.15, 0.2), 4);
    drawRtlParagraph(`היקף סקציה: ${params.sectionScopeHe}`, 12, rgb(0.1, 0.15, 0.2), 4);
    drawRtlParagraph(`תקופה: ${params.periodHe}`, 12, rgb(0.1, 0.15, 0.2), 14);
    drawRtlParagraph('-'.repeat(52), 10, rgb(0.75, 0.78, 0.82), 12);
    for (const r of params.rows) {
        newPageIfNeeded(margin + lineHeight(12) + lineHeight(10) + 24);
        drawRtlParagraph(r.summary_he, 12, rgb(0.05, 0.09, 0.16), 6);
        const meta = `${r.occurred_display_he} · ${r.actor_display_name ?? '—'} · ${r.section_title_he}`;
        drawRtlParagraph(meta, 10, rgb(0.35, 0.4, 0.45), 14);
    }
    const bytes = await pdfDoc.save();
    return Buffer.from(bytes);
}
