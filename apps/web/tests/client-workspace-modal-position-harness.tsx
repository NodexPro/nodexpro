/**
 * Mounts the real ClientWorkspaceModal (פרטי לקוח) inside the Client Operations
 * clipping ancestors (sheet backdrop-filter + overflow-hidden shell) so layout,
 * stacking and overflow can be measured with getBoundingClientRect.
 *
 * CSS order matches production: nx-modal.css, shell, spreadsheet, then premium
 * via ClientWorkspacePanel.
 */
import '../src/styles/nx-modal.css';
import '../src/templates/template-1/tokens.css';
import '../src/styles/nx-client-operations-shell.css';
import '../src/styles/nx-client-operations-spreadsheet.css';
import { createRoot } from 'react-dom/client';
import {
  ClientWorkspaceModal,
  buildPlaceholderClientCaseFromRegistryRow,
} from '../src/components/ClientWorkspacePanel';

const workspace = buildPlaceholderClientCaseFromRegistryRow({
  client_id: 'layout-harness-client',
  client_name: 'חברת בדיקה בע״מ',
  tax_id: '512345678',
  business_type: 'עוסק מורשה',
  payroll_flag: true,
  material_brought_flag: false,
  vat_status: 'מורשה',
  income_tax_advance_status: null,
  national_insurance_status: null,
  national_insurance_deductions_status: null,
  income_tax_deductions_status: null,
  assigned_handler_user_id: null,
  vat_due_registry_display_he: null,
});

createRoot(document.getElementById('root')!).render(
  <div className="t1-appShell t1-appShell--client-operations" style={{ display: 'flex', minHeight: '100vh' }}>
    <aside className="t1-sidebar" data-testid="harness-sidebar" style={{ width: 64, flex: '0 0 64px' }}>
      ניווט
    </aside>
    <div className="t1-shellColumn" style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
      <header className="nx-co-app-header" data-testid="client-operations-app-header">
        ניהול לקוחות
      </header>
      <main className="t1-pageMain">
        <div>
          <div className="nx-co-sheet" data-testid="client-operations-spreadsheet">
            <ClientWorkspaceModal
              open
              workspace={workspace}
              loading={false}
              error=""
              onClose={() => undefined}
            />
          </div>
        </div>
      </main>
    </div>
  </div>,
);

type MeasureDump = {
  innerWidth: number;
  innerHeight: number;
  devicePixelRatio: number;
  href: string;
  selectorMatches: boolean;
  portaledToBody: boolean;
  overlayParentClass: string;
  overlay: Record<string, unknown> | null;
  modal: Record<string, unknown> | null;
  header: Record<string, unknown> | null;
  sidebar: Record<string, unknown> | null;
  sheet: Record<string, unknown> | null;
  content: Record<string, unknown> | null;
  stacking: Record<string, unknown>;
  after: Record<string, string>;
  math: Record<string, number> | null;
};

function box(el: Element) {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    top: r.top,
    right: r.right,
    bottom: r.bottom,
    left: r.left,
    width: r.width,
    height: r.height,
    display: cs.display,
    position: cs.position,
    zIndex: cs.zIndex,
    flexDirection: cs.flexDirection,
    justifyContent: cs.justifyContent,
    alignItems: cs.alignItems,
    heightComputed: cs.height,
    maxHeight: cs.maxHeight,
    overflow: cs.overflow,
    overflowX: cs.overflowX,
    overflowY: cs.overflowY,
    overflowYScroll: (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 1,
    scrollHeight: (el as HTMLElement).scrollHeight,
    clientHeight: (el as HTMLElement).clientHeight,
    backdropFilter: cs.backdropFilter || cs.webkitBackdropFilter,
    transform: cs.transform,
    isolation: cs.isolation,
    inset: `${cs.top} ${cs.right} ${cs.bottom} ${cs.left}`,
    padding: cs.padding,
    margin: cs.margin,
    flex: `${cs.flexGrow} ${cs.flexShrink} ${cs.flexBasis}`,
  };
}

function hit(x: number, y: number) {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  return {
    className: typeof el.className === 'string' ? el.className : el.nodeName,
    tag: el.tagName,
    inOverlay: Boolean(el.closest('.nx-modal-overlay')),
    inModal: Boolean(el.closest('.nx-modal.nx-workspace-modal')),
    inHeader: Boolean(el.closest('.nx-co-app-header')),
    inSidebar: Boolean(el.closest('.t1-sidebar')),
    inSheet: Boolean(el.closest('.nx-co-sheet')),
  };
}

(window as unknown as { __measureClientDetailsModal: () => MeasureDump }).__measureClientDetailsModal =
  function measureClientDetailsModal(): MeasureDump {
    const overlay = document.querySelector('.nx-modal-overlay');
    const modal = document.querySelector('.nx-modal.nx-workspace-modal');
    const header = document.querySelector('.nx-co-app-header');
    const sidebar = document.querySelector('.t1-sidebar');
    const sheet = document.querySelector('.nx-co-sheet');
    const content = document.querySelector('.nx-modal.nx-workspace-modal .nx-workspace-content');
    const selectorMatches = Boolean(overlay?.querySelector(':scope > .nx-modal.nx-workspace-modal'));
    const afterCs = overlay ? getComputedStyle(overlay, '::after') : null;
    const overlayBox = overlay ? box(overlay) : null;
    const modalBox = modal ? box(modal) : null;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const math = modalBox
      ? {
          viewportTopToModalTop: modalBox.top,
          modalBottomToViewportBottom: vh - modalBox.bottom,
          geometricCenterTop: (vh - modalBox.height) / 2,
          raiseVsGeometricCenter: (vh - modalBox.height) / 2 - modalBox.top,
          modalMid: modalBox.top + modalBox.height / 2,
          viewportMid: vh / 2,
        }
      : null;
    return {
      innerWidth: vw,
      innerHeight: vh,
      devicePixelRatio: window.devicePixelRatio,
      href: location.href,
      selectorMatches,
      portaledToBody: overlay?.parentElement === document.body,
      overlayParentClass: overlay?.parentElement?.className ?? overlay?.parentElement?.nodeName ?? '',
      overlay: overlayBox,
      modal: modalBox,
      header: header ? box(header) : null,
      sidebar: sidebar ? box(sidebar) : null,
      sheet: sheet ? box(sheet) : null,
      content: content ? box(content) : null,
      stacking: {
        headerCenter: header ? hit(header.getBoundingClientRect().left + header.getBoundingClientRect().width / 2, header.getBoundingClientRect().top + 20) : null,
        sidebarMid: sidebar ? hit(sidebar.getBoundingClientRect().left + 16, vh / 2) : null,
        overlayCoversViewport:
          Boolean(overlayBox) &&
          overlayBox!.top <= 1 &&
          overlayBox!.left <= 1 &&
          overlayBox!.height >= vh - 2 &&
          overlayBox!.width >= vw - 2,
      },
      after: afterCs
        ? {
            content: afterCs.content,
            display: afterCs.display,
            flexGrow: afterCs.flexGrow,
            flexShrink: afterCs.flexShrink,
            flexBasis: afterCs.flexBasis,
            width: afterCs.width,
            height: afterCs.height,
            minHeight: afterCs.minHeight,
            pointerEvents: afterCs.pointerEvents,
            position: afterCs.position,
          }
        : {},
      math,
    };
  };

function writeLayoutDump(): void {
  const pre = document.getElementById('nx-layout-dump');
  const measure = (window as unknown as { __measureClientDetailsModal?: () => unknown })
    .__measureClientDetailsModal;
  if (!pre || !measure || !document.querySelector('.nx-modal.nx-workspace-modal')) {
    requestAnimationFrame(writeLayoutDump);
    return;
  }
  pre.textContent = JSON.stringify(measure());
}

requestAnimationFrame(writeLayoutDump);
