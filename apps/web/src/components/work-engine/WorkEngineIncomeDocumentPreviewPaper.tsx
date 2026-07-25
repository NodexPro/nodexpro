import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { IncomeDocumentAllocationNumberField } from '../../income/income-document-details-types';
import { WorkEngineIncomeAllocationNumberModal } from './WorkEngineIncomeAllocationNumberModal';
import {
  INCOME_DOCUMENT_ALLOCATION_ROW_SELECTOR,
  resolveIncomeDocumentAllocationEditChrome,
} from './work-engine-income-document-allocation-edit-chrome.pure';
import {
  PREVIEW_A4_HEIGHT_PX,
  PREVIEW_A4_WIDTH_PX,
  PREVIEW_PAPER_ROOT_SELECTOR,
  PREVIEW_SCREEN_FIT_GUTTER_PX,
  buildIncomePreviewScreenIframeSrcDoc,
  resolveCanvasAvailableBox,
  resolvePreviewPaperRootMatchesA4,
  resolveScreenPreviewFitDiagnostics,
  resolveScreenPreviewPlan,
  type ScreenPreviewPlan,
} from './work-engine-income-document-preview-screen.pure';

type Props = {
  previewHtml: string;
  busy: boolean;
  allocationField?: IncomeDocumentAllocationNumberField | null;
  onSaveAllocationNumber?: (value: string | null) => Promise<void>;
  onAllocationModalOpenChange?: (open: boolean) => void;
  paperClassName?: string;
  contentClassName?: string;
};

const INLINE_LABEL_GROUP_CLASS = 'nx-doc__meta-label-group nx-doc__meta-label-group--injected';
const CANVAS_SELECTOR = '.nx-we-retainer-preview-modal__canvas, .nx-we-preview-canvas';
const SCREEN_FIT_CLASS = 'nx-we-preview-canvas--screen-fit';

const NATURAL_PLAN: ScreenPreviewPlan = {
  mode: 'natural',
  scale: 1,
  shell_width: PREVIEW_A4_WIDTH_PX,
  shell_height: PREVIEW_A4_HEIGHT_PX,
  paper_width: PREVIEW_A4_WIDTH_PX,
  paper_height: PREVIEW_A4_HEIGHT_PX,
};

function clearInjectedAllocationEdit(root: ParentNode) {
  root.querySelectorAll('.nx-we-preview-allocation-edit-btn--inline').forEach((node) => node.remove());
  root.querySelectorAll('.nx-doc__meta-label-group--injected').forEach((group) => {
    const label = group.querySelector('.nx-doc__meta-label');
    const parent = group.parentElement;
    if (label && parent) {
      parent.insertBefore(label, group);
      group.remove();
    }
  });
}

function injectAllocationEdit(
  root: ParentNode,
  editChrome: { render: boolean; disabled: boolean; tooltip: string },
  busy: boolean,
  onOpen: () => void,
) {
  clearInjectedAllocationEdit(root);
  if (!editChrome.render) return;

  const row = root.querySelector(INCOME_DOCUMENT_ALLOCATION_ROW_SELECTOR);
  const label = row?.querySelector('.nx-doc__meta-label');
  if (!row || !label || !label.parentElement) return;

  const group = label.ownerDocument.createElement('span');
  group.className = INLINE_LABEL_GROUP_CLASS;
  label.parentElement.insertBefore(group, label);
  group.appendChild(label);

  const button = label.ownerDocument.createElement('button');
  button.type = 'button';
  button.className = 'nx-we-preview-allocation-edit-btn nx-we-preview-allocation-edit-btn--inline';
  button.disabled = editChrome.disabled || busy;
  button.title = editChrome.tooltip;
  button.setAttribute('aria-label', editChrome.tooltip);
  button.setAttribute('data-testid', 'we-preview-allocation-edit-btn');
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (editChrome.disabled || busy) return;
    onOpen();
  });

  const iconHost = label.ownerDocument.createElement('span');
  iconHost.setAttribute('aria-hidden', 'true');
  iconHost.innerHTML =
    '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
  button.appendChild(iconHost);
  group.appendChild(button);
}

function readComputedBox(style: CSSStyleDeclaration) {
  return {
    width: style.width,
    height: style.height,
    minHeight: style.minHeight,
    maxHeight: style.maxHeight,
    margin: style.margin,
    padding: style.padding,
    overflow: style.overflow,
    display: style.display,
    alignItems: style.alignItems,
    justifyContent: style.justifyContent,
    transform: style.transform,
    position: style.position,
    top: style.top,
    translate: style.translate,
  };
}

async function waitForIframeAssets(doc: Document): Promise<void> {
  const fontsReady = doc.fonts?.ready?.catch?.(() => undefined) ?? Promise.resolve();
  const images = Array.from(doc.images ?? []);
  await Promise.all([
    fontsReady,
    ...images.map(
      (img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              const done = () => resolve();
              img.addEventListener('load', done, { once: true });
              img.addEventListener('error', done, { once: true });
            }),
    ),
  ]);
}

function resetIframeScroll(iframe: HTMLIFrameElement) {
  try {
    iframe.contentWindow?.scrollTo(0, 0);
    const doc = iframe.contentDocument;
    if (doc) {
      doc.documentElement.scrollTop = 0;
      doc.documentElement.scrollLeft = 0;
      doc.body.scrollTop = 0;
      doc.body.scrollLeft = 0;
    }
  } catch {
    /* ignore cross-origin / detached */
  }
}

function lockIframeViewportToA4(doc: Document) {
  const html = doc.documentElement;
  const body = doc.body;
  if (!html || !body) return;
  const lock = (el: HTMLElement) => {
    el.style.setProperty('width', `${PREVIEW_A4_WIDTH_PX}px`, 'important');
    el.style.setProperty('height', `${PREVIEW_A4_HEIGHT_PX}px`, 'important');
    el.style.setProperty('min-height', `${PREVIEW_A4_HEIGHT_PX}px`, 'important');
    el.style.setProperty('max-height', `${PREVIEW_A4_HEIGHT_PX}px`, 'important');
    el.style.setProperty('overflow', 'hidden', 'important');
    el.style.setProperty('display', 'block', 'important');
    el.style.setProperty('margin', '0', 'important');
    el.style.setProperty('padding', '0', 'important');
    el.style.setProperty('transform', 'none', 'important');
  };
  lock(html);
  lock(body);
}

function logInnerDiagnostics(iframe: HTMLIFrameElement) {
  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc?.body || !win) return;

  const paperRoot = doc.querySelector(PREVIEW_PAPER_ROOT_SELECTOR) as HTMLElement | null;
  const bodyRect = doc.body.getBoundingClientRect();
  const paperRootRect = paperRoot?.getBoundingClientRect() ?? null;
  const paperStyle = paperRoot ? readComputedBox(win.getComputedStyle(paperRoot)) : null;

  console.info('[we-preview-inner]', {
    iframeClientWidth: iframe.clientWidth,
    iframeClientHeight: iframe.clientHeight,
    iframeScrollX: win.scrollX,
    iframeScrollY: win.scrollY,
    documentClientWidth: doc.documentElement.clientWidth,
    documentClientHeight: doc.documentElement.clientHeight,
    documentScrollWidth: doc.documentElement.scrollWidth,
    documentScrollHeight: doc.documentElement.scrollHeight,
    bodyRect: {
      x: bodyRect.x,
      y: bodyRect.y,
      width: bodyRect.width,
      height: bodyRect.height,
      top: bodyRect.top,
    },
    bodyScrollWidth: doc.body.scrollWidth,
    bodyScrollHeight: doc.body.scrollHeight,
    paperRootRect: paperRootRect
      ? {
          x: paperRootRect.x,
          y: paperRootRect.y,
          width: paperRootRect.width,
          height: paperRootRect.height,
          top: paperRootRect.top,
        }
      : null,
    paperRootComputedStyle: paperStyle,
    htmlComputedStyle: readComputedBox(win.getComputedStyle(doc.documentElement)),
    bodyComputedStyle: readComputedBox(win.getComputedStyle(doc.body)),
  });
}

/**
 * Preview chrome:
 * - Live natural A4 paper always mounts preview_html (never scaled) — source + fallback + print.
 * - Separate same-origin iframe is the screen-fit representation.
 * - Scale is on `.nx-we-preview-fit-scaler` only; available box from full canvas rect.
 */
export function WorkEngineIncomeDocumentPreviewPaper({
  previewHtml,
  busy,
  allocationField,
  onSaveAllocationNumber,
  onAllocationModalOpenChange,
  paperClassName = 'nx-we-preview-paper',
  contentClassName = 'nx-we-preview-paper__content',
}: Props) {
  const screenRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const [allocationModalOpen, setAllocationModalOpen] = useState(false);
  const [allocationError, setAllocationError] = useState<string | null>(null);
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [plan, setPlan] = useState<ScreenPreviewPlan>(NATURAL_PLAN);

  const srcDoc = useMemo(() => buildIncomePreviewScreenIframeSrcDoc(previewHtml), [previewHtml]);

  const editChrome = resolveIncomeDocumentAllocationEditChrome({
    field: allocationField,
    has_on_save_handler: onSaveAllocationNumber != null,
    busy,
  });

  useEffect(() => {
    onAllocationModalOpenChange?.(allocationModalOpen);
  }, [allocationModalOpen, onAllocationModalOpenChange]);

  useEffect(() => {
    setIframeLoaded(false);
    setPlan(NATURAL_PLAN);
  }, [previewHtml]);

  useEffect(() => {
    const screen = screenRef.current;
    if (!screen) return;

    const canvas =
      (screen.closest(CANVAS_SELECTOR) as HTMLElement | null) ??
      (screen.parentElement as HTMLElement | null);
    if (!canvas) return;

    const applyPlan = (next: ScreenPreviewPlan) => {
      setPlan(next);
      canvas.classList.toggle(SCREEN_FIT_CLASS, next.mode === 'fitted');
    };

    const measure = () => {
      try {
        const rect = canvas.getBoundingClientRect();
        const { available_width, available_height } = resolveCanvasAvailableBox({
          canvas_width: rect.width,
          canvas_height: rect.height,
          horizontal_gutter_px: PREVIEW_SCREEN_FIT_GUTTER_PX,
          vertical_gutter_px: PREVIEW_SCREEN_FIT_GUTTER_PX,
        });

        const next = resolveScreenPreviewPlan({
          iframe_loaded: iframeLoaded,
          available_width,
          available_height,
          gutter_px: 0,
        });
        applyPlan(next);

        if (import.meta.env.DEV) {
          const diag = resolveScreenPreviewFitDiagnostics({
            canvas_width: rect.width,
            canvas_height: rect.height,
            horizontal_gutter_px: PREVIEW_SCREEN_FIT_GUTTER_PX,
            vertical_gutter_px: PREVIEW_SCREEN_FIT_GUTTER_PX,
          });
          const shellRect = shellRef.current?.getBoundingClientRect();
          console.info('[we-preview-fit]', {
            canvas_width: diag.canvas_width,
            canvas_height: diag.canvas_height,
            available_width: diag.available_width,
            available_height: diag.available_height,
            width_scale: diag.width_scale,
            height_scale: diag.height_scale,
            selected_scale: diag.selected_scale,
            limiting_axis: diag.limiting_axis,
            shell_plan_width: next.shell_width,
            shell_plan_height: next.shell_height,
            shell_rendered_width: shellRect?.width ?? null,
            shell_rendered_height: shellRect?.height ?? null,
            mode: next.mode,
          });
        }
      } catch {
        applyPlan(NATURAL_PLAN);
      }
    };

    measure();
    const raf = requestAnimationFrame(() => {
      measure();
      requestAnimationFrame(measure);
    });
    const ro = new ResizeObserver(() => measure());
    ro.observe(canvas);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.classList.remove(SCREEN_FIT_CLASS);
    };
  }, [iframeLoaded, previewHtml]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframeLoaded || !iframe) return;
    let cancelled = false;

    const prepareInner = async () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc?.body) return;

        resetIframeScroll(iframe);
        await waitForIframeAssets(doc);
        if (cancelled) return;

        resetIframeScroll(iframe);

        const paperRoot = doc.querySelector(PREVIEW_PAPER_ROOT_SELECTOR) as HTMLElement | null;
        const paperRect = paperRoot?.getBoundingClientRect();
        const matchesA4 = paperRect
          ? resolvePreviewPaperRootMatchesA4({
              width: paperRect.width,
              height: paperRect.height,
              top: paperRect.top,
            })
          : false;

        if (matchesA4) {
          lockIframeViewportToA4(doc);
          resetIframeScroll(iframe);
        }

        /* Temporary production markers — remove after confirmation. */
        console.info('[we-preview-build]', {
          fix: 'sectioned-iframe-height-v2',
        });
        logInnerDiagnostics(iframe);
      } catch {
        /* keep outer natural fallback */
      }
    };

    void prepareInner();
    return () => {
      cancelled = true;
    };
  }, [iframeLoaded, previewHtml]);

  useEffect(() => {
    const contentEl = contentRef.current;
    if (!contentEl) return;

    const openAllocation = () => {
      setAllocationError(null);
      setAllocationModalOpen(true);
    };

    injectAllocationEdit(contentEl, editChrome, busy, openAllocation);

    const iframe = iframeRef.current;
    const iframeDoc = iframe?.contentDocument;
    if (iframeLoaded && iframeDoc?.body) {
      injectAllocationEdit(iframeDoc.body, editChrome, busy, openAllocation);
      resetIframeScroll(iframe!);
    }

    return () => {
      clearInjectedAllocationEdit(contentEl);
      if (iframeDoc?.body) clearInjectedAllocationEdit(iframeDoc.body);
    };
  }, [previewHtml, editChrome.render, editChrome.disabled, editChrome.tooltip, busy, iframeLoaded, plan.mode]);

  const handleSaveAllocation = async (value: string | null) => {
    if (!onSaveAllocationNumber || !allocationField) return;
    setAllocationError(null);
    try {
      await onSaveAllocationNumber(value);
      setAllocationModalOpen(false);
    } catch (e) {
      setAllocationError(e instanceof Error ? e.message : 'שגיאה בשמירה');
    }
  };

  const fitted = plan.mode === 'fitted';

  const iframeShellStyle = {
    ['--preview-scale' as string]: fitted ? String(plan.scale) : '1',
  } as CSSProperties;

  return (
    <>
      <div
        ref={screenRef}
        className="nx-we-preview-screen"
        data-testid="we-income-preview-screen"
        data-screen-mode={plan.mode}
      >
        <div
          className={`${paperClassName}${fitted ? ' nx-we-preview-paper--source-parked' : ''}`}
          data-testid="we-income-preview-paper"
          data-print-source="true"
        >
          <div
            ref={contentRef}
            className={contentClassName}
            data-testid="we-income-preview-html"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
          />
        </div>

        <div
          className={`nx-we-preview-fit-viewport${fitted ? ' nx-we-preview-fit-viewport--ready' : ' nx-we-preview-fit-viewport--pending'}`}
          data-testid="we-income-preview-fit-viewport"
          aria-hidden={!fitted}
        >
          <div
            ref={shellRef}
            className="nx-we-preview-fit-iframe-shell"
            data-testid="we-income-preview-fit-shell"
            data-shell-width={fitted ? plan.shell_width : PREVIEW_A4_WIDTH_PX}
            data-shell-height={fitted ? plan.shell_height : PREVIEW_A4_HEIGHT_PX}
            data-preview-scale={fitted ? plan.scale : 1}
            style={iframeShellStyle}
          >
            <div className="nx-we-preview-fit-scaler" data-testid="we-income-preview-fit-scaler">
              <iframe
                ref={iframeRef}
                className="nx-we-preview-fit-iframe"
                title="תצוגת מסמך"
                srcDoc={srcDoc}
                sandbox="allow-same-origin"
                data-testid="we-income-preview-fit-iframe"
                width={PREVIEW_A4_WIDTH_PX}
                height={PREVIEW_A4_HEIGHT_PX}
                onLoad={() => {
                  try {
                    const iframe = iframeRef.current;
                    const doc = iframe?.contentDocument;
                    if (!iframe || !doc?.body) {
                      setIframeLoaded(false);
                      setPlan(NATURAL_PLAN);
                      return;
                    }
                    resetIframeScroll(iframe);
                    setIframeLoaded(true);
                  } catch {
                    setIframeLoaded(false);
                    setPlan(NATURAL_PLAN);
                  }
                }}
              />
            </div>
          </div>
        </div>
      </div>

      {allocationField && allocationModalOpen ? (
        <WorkEngineIncomeAllocationNumberModal
          open={allocationModalOpen}
          field={allocationField}
          busy={busy}
          error={allocationError}
          onClose={() => {
            if (!busy) setAllocationModalOpen(false);
          }}
          onSave={(value) => void handleSaveAllocation(value)}
        />
      ) : null}
    </>
  );
}
