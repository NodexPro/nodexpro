/**
 * Client Operations ToDo — שלב טיפול (progress note), סיבת סגירה (completion reason), completion dialog,
 * archive column, priority-square glass finish (CSS only) and the redundant-request fixes.
 * Source/contract checks + the pure auto-save scheduler (fake timers).
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createProgressNoteAutosaver,
  progressNoteSaveStateLabelHe,
  TODO_PROGRESS_NOTE_AUTOSAVE_DEBOUNCE_MS,
  type ProgressNoteSaveState,
} from '../src/lib/client-operations-todo-progress-note-autosave.pure.js';

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, rel), 'utf8');
const modal = read('../src/components/client-operations/ClientOperationsTodoBoardModal.tsx');
const completeModal = read('../src/components/client-operations/ClientOperationsTodoCompleteModal.tsx');
const popover = read('../src/components/client-operations/ClientOperationsTodoNotePopover.tsx');
const css = read('../src/styles/nx-client-operations-todo.css');

const tick = () => new Promise<void>((r) => setImmediate(r));
const DEBOUNCE = TODO_PROGRESS_NOTE_AUTOSAVE_DEBOUNCE_MS;

// ── auto-save scheduler ──────────────────────────────────────────────────────────────────────────────

function harness(opts: { save?: (v: string) => Promise<void>; initial?: string } = {}) {
  const sent: string[] = [];
  const states: ProgressNoteSaveState[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const saver = createProgressNoteAutosaver({
    initialValue: opts.initial ?? '',
    onState: (s) => states.push(s),
    save: async (v) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      sent.push(v);
      try {
        await (opts.save ? opts.save(v) : Promise.resolve());
      } finally {
        inFlight--;
      }
    },
  });
  return { saver, sent, states, maxInFlight: () => maxInFlight };
}

test('autosave: typing is debounced — one command with the last value, none per keystroke', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const h = harness();
    h.saver.change('ב');
    h.saver.change('בב');
    mock.timers.tick(DEBOUNCE - 1);
    h.saver.change('בבדיקה');
    mock.timers.tick(DEBOUNCE - 1);
    await tick();
    assert.deepEqual(h.sent, []);
    assert.equal(h.saver.getState().status, 'pending');
    mock.timers.tick(1);
    await tick();
    assert.deepEqual(h.sent, ['בבדיקה']);
    assert.equal(h.saver.getState().status, 'saved');
    assert.deepEqual(h.states.map((s) => s.status), ['pending', 'pending', 'pending', 'saving', 'saved']);
  } finally {
    mock.timers.reset();
  }
});

test('autosave: serialized — never two requests in flight; the latest value is always sent last (no stale overwrite)', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const gates: Array<() => void> = [];
    const h = harness({ save: () => new Promise<void>((resolve) => gates.push(resolve)) });
    h.saver.change('v1');
    mock.timers.tick(DEBOUNCE);
    await tick();
    assert.deepEqual(h.sent, ['v1']);
    // User keeps typing while v1 is still in flight (even past another debounce window).
    h.saver.change('v2');
    mock.timers.tick(DEBOUNCE * 3);
    await tick();
    assert.deepEqual(h.sent, ['v1'], 'v2 waits for v1 to finish');
    gates.shift()!(); // v1 answered
    await tick();
    assert.deepEqual(h.sent, ['v1', 'v2']);
    assert.equal(h.maxInFlight(), 1);
    gates.shift()!(); // v2 answered
    await tick();
    assert.equal(h.saver.getState().status, 'saved');
    // Typing back to the already-saved value sends nothing.
    h.saver.change('v2');
    mock.timers.tick(DEBOUNCE * 2);
    await tick();
    assert.deepEqual(h.sent, ['v1', 'v2']);
  } finally {
    mock.timers.reset();
  }
});

test('autosave: failure is visible, keeps the value dirty, and the next change / flush retries it', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    let fail = true;
    const h = harness({
      save: async () => {
        if (fail) throw new Error('שרת לא זמין');
      },
    });
    h.saver.change('ממתין לחתימה');
    mock.timers.tick(DEBOUNCE);
    await tick();
    assert.deepEqual(h.saver.getState(), { status: 'error', error: 'שרת לא זמין' });
    assert.equal(progressNoteSaveStateLabelHe(h.saver.getState()), 'שרת לא זמין');
    fail = false;
    assert.equal(await h.saver.flush(), true);
    assert.deepEqual(h.sent, ['ממתין לחתימה', 'ממתין לחתימה']);
    assert.equal(h.saver.getState().status, 'saved');
  } finally {
    mock.timers.reset();
  }
});

test('autosave: flush sends immediately; clean flush is a no-op; dispose still delivers an unsaved value silently', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const h = harness({ initial: 'old' });
    assert.equal(await h.saver.flush(), true);
    assert.deepEqual(h.sent, []);
    h.saver.change('new');
    assert.equal(await h.saver.flush(), true); // no timer advance needed
    assert.deepEqual(h.sent, ['new']);

    const d = harness({ initial: 'a' });
    d.saver.change('b');
    const before = d.states.length;
    d.saver.dispose();
    await tick();
    assert.deepEqual(d.sent, ['b']);
    assert.equal(d.states.length, before, 'no UI updates after dispose');
  } finally {
    mock.timers.reset();
  }
});

test('autosave: status labels (Hebrew) — nothing shown when idle', () => {
  assert.equal(progressNoteSaveStateLabelHe({ status: 'idle', error: null }), null);
  assert.equal(progressNoteSaveStateLabelHe({ status: 'pending', error: null }), 'שומר…');
  assert.equal(progressNoteSaveStateLabelHe({ status: 'saving', error: null }), 'שומר…');
  assert.equal(progressNoteSaveStateLabelHe({ status: 'saved', error: null }), 'נשמר');
  assert.equal(progressNoteSaveStateLabelHe({ status: 'error', error: null }), 'שגיאה בשמירה');
});

// ── A. progress note UI ──────────────────────────────────────────────────────────────────────────────

test('A — שלב טיפול: labelled field, named command, create payload, backend limits, no status enum', () => {
  assert.match(modal, /<span>שלב טיפול<\/span>/);
  assert.match(modal, /command: 'update_client_operations_todo_progress_note'/);
  assert.match(modal, /progress_note: progressNote\.trim\(\) \|\| null/); // create command payload
  assert.match(modal, /maxLength=\{fieldLimits\?\.progress_note_max_length\}/);
  assert.match(modal, /field_limits\?: \{ progress_note_max_length: number; completion_reason_max_length: number \}/);
  // Autosave plumbing: debounce scheduler, visible state, serialized, settles before submit / close / complete.
  assert.match(modal, /createProgressNoteAutosaver\(/);
  assert.match(modal, /data-testid="client-operations-todo-progress-note-state"/);
  assert.match(modal, /role=\{noteSave\.status === 'error' \? 'alert' : 'status'\}/);
  assert.match(modal, /saverRef\.current\.flush\(\)/);
  assert.match(modal, /const requestClose = /);
  // Truth flow: the command's full aggregate goes to the board; the field keeps what the user typed.
  assert.match(modal, /onBoardRefreshed\(data\)/);
  assert.equal((modal.match(/setProgressNote\(/g) ?? []).length, 1, 'onChange only — never written from the aggregate');
  // The refreshed view is not reset by a background save.
  assert.match(modal, /page: boardView\.page,\s*q: boardView\.q,/);
  // Not a status: no frontend enum / transition / completion coupling.
  assert.doesNotMatch(modal, /progress_status|PROGRESS_STATUSES|nextStage|workflow/i);
  assert.doesNotMatch(modal, /progressNote[^;\n]*(priority|completed_at)/);
});

test('A — card popover: hover / keyboard focus / tap, Escape closes only the popover, portal, tooltip semantics', () => {
  assert.match(modal, /const note = task\.progress_note;/);
  assert.match(modal, /tabIndex=\{note \? 0 : undefined\}/);
  assert.match(modal, /aria-describedby=\{noteVisible \? popoverId : undefined\}/);
  assert.match(modal, /onMouseEnter=/);
  assert.match(modal, /onFocus=/);
  assert.match(modal, /setPinned\(\(p\) => !p\)/); // tap / click toggles (touch has no hover)
  assert.match(modal, /e\.key === 'Escape' && noteVisible[\s\S]*?e\.stopPropagation\(\)/);
  assert.match(popover, /createPortal\(/);
  assert.match(popover, /role="tooltip"/);
  assert.match(popover, /document\.addEventListener\('pointerdown'/); // outside tap dismisses a pinned popover
  assert.match(popover, /<div className="nx-co-todo-note-popover__label">שלב טיפול<\/div>/);
  assert.match(css, /\.nx-co-todo-note-popover \{[^}]*position: fixed;/);
  // Same font family as the rest of the module (the portal lives outside the overlay, so it is listed explicitly).
  assert.match(css, /\.nx-co-todo-note-popover,\s*\.nx-co-todo-note-popover \*,[\s\S]*?font-family: Arial, sans-serif !important;/);
});

// ── B. completion dialog ─────────────────────────────────────────────────────────────────────────────

test('B — completion dialog: texts, X, Cancel, Escape, accessibility', () => {
  assert.match(completeModal, /<h3 id=\{titleId\}>סיום משימה<\/h3>/);
  assert.match(completeModal, /<span>סיבת סגירה<\/span>/);
  assert.match(completeModal, /סיום והעברה לארכיון/);
  assert.match(completeModal, /ביטול/);
  assert.match(completeModal, /className="nx-co-todo-board__close"[\s\S]*?aria-label="סגור"[\s\S]*?×/); // visible X
  assert.match(completeModal, /role="dialog"/);
  assert.match(completeModal, /aria-modal="true"/);
  assert.match(completeModal, /aria-labelledby=\{titleId\}/);
  // X, Cancel, Escape and a click outside all CANCEL (only the submit path confirms).
  assert.match(completeModal, /e\.key === 'Escape'[\s\S]*?e\.stopPropagation\(\)[\s\S]*?onCancel\(\)/);
  assert.equal((completeModal.match(/onClick=\{onCancel\}/g) ?? []).length, 2); // X + Cancel
  assert.match(completeModal, /e\.target === e\.currentTarget && !busy\) onCancel\(\)/);
  assert.equal((completeModal.match(/onConfirm\(\)/g) ?? []).length, 1);
  assert.match(completeModal, /onSubmit=\{onSubmit\}/);
  // Focus: reason field on open, focus restored on close, Tab trapped.
  assert.match(completeModal, /inputRef\.current\?\.focus\(\)/);
  assert.match(completeModal, /opener\?\.focus\?\.\(\)/);
  assert.match(completeModal, /e\.key !== 'Tab'/);
  // Empty reason is valid; the input is optional and bounded by the backend limit.
  assert.doesNotMatch(completeModal, /required/);
  assert.match(completeModal, /maxLength=\{reasonMaxLength\}/);
  // Presentation only: no network, no business logic.
  assert.doesNotMatch(completeModal, /apiJson|fetch\(|moduleClientOperations/);
});

test('B — completion only after explicit confirmation, one command carrying the optional reason', () => {
  // The card ✓ / edit-form button only OPEN the dialog.
  assert.match(modal, /const onComplete = \(task: ClientOperationsTodoCard\) => \{[\s\S]*?setCompleteTask\(task\);\s*\};/);
  const onCompleteBody = modal.slice(modal.indexOf('const onComplete = '), modal.indexOf('const cancelComplete'));
  assert.doesNotMatch(onCompleteBody, /runCommand|apiJson/);
  const cancelBody = modal.slice(modal.indexOf('const cancelComplete'), modal.indexOf('const confirmComplete'));
  assert.doesNotMatch(cancelBody, /runCommand|apiJson/);
  // Confirm: single existing command; empty reason → null; aggregate applied, dialog + edit form closed.
  const confirmBody = modal.slice(modal.indexOf('const confirmComplete'), modal.indexOf('const onReopen'));
  assert.match(confirmBody, /command: 'complete_client_operations_todo'/);
  assert.match(confirmBody, /completion_reason: completeReason\.trim\(\) \|\| null/);
  assert.match(confirmBody, /applyBoardAggregate\(data\)/);
  assert.equal((confirmBody.match(/runCommand\(/g) ?? []).length, 1);
  assert.match(confirmBody, /if \(!task \|\| completeBusy\) return;/); // no double submit
  // The edit form never completes by itself any more.
  assert.doesNotMatch(modal, /command: 'complete_client_operations_todo',\s*todo_id: task\.id,\s*query/);
  assert.match(modal, /onRequestComplete\(task\)/);
  // Escape priority: the dialog first, and it never completes.
  assert.match(modal, /if \(completeTask\) \{[\s\S]*?cancelComplete\(\)/);
  assert.match(modal, /<ClientOperationsTodoCompleteModal/);
});

test('B — reopen contract unchanged (single command, board + archive truth); closure reason is rendered, never derived', () => {
  assert.match(modal, /command: 'reopen_client_operations_todo'/);
  assert.match(modal, /applyBoardAggregate\(data\.board\);\s*setArchive\(data\.archive\);/);
  assert.doesNotMatch(modal, /completion_reason\s*=\s*null|delete .*completion_reason/);
});

// ── archive column ───────────────────────────────────────────────────────────────────────────────────

test('archive: separate סיבת סגירה column (before actions); green only for non-empty values; null stays neutral', () => {
  assert.match(modal, /<th>הושלם על ידי<\/th>\s*<th>סיבת סגירה<\/th>\s*<th>פעולות<\/th>/);
  assert.match(modal, /t\.completion_reason\s*\?\s*'nx-co-todo-archive__reason nx-co-todo-archive__reason--set'\s*:\s*'nx-co-todo-archive__reason'/);
  assert.match(modal, /\{t\.completion_reason \?\? '—'\}/);
  assert.match(css, /\.nx-co-todo-archive__reason--set \{\s*color: #15803d;\s*\}/);
  // Card + aggregate types carry the backend fields.
  assert.match(modal, /completion_reason: string \| null;/);
  assert.match(modal, /progress_note: string \| null;/);
});

// ── visual consistency (F) ───────────────────────────────────────────────────────────────────────────

test('F — new UI reuses the module classes (no new fonts, libraries or button styles)', () => {
  for (const cls of ['nx-co-todo-form-overlay', 'nx-co-todo-form__header', 'nx-co-todo-form__field', 'nx-co-todo-form__footer', 'nx-co-todo-board__close', 'nx-btn nx-btn-taxes-compact nx-btn-secondary nx-co-todo-btn', 'nx-btn nx-btn-taxes-compact nx-btn-primary nx-co-todo-btn']) {
    assert.ok(completeModal.includes(cls), `complete modal reuses ${cls}`);
  }
  assert.doesNotMatch(completeModal + popover, /style=\{\{[^}]*font/);
  const newCss = css.slice(css.indexOf('שלב טיפול (progress note)'));
  assert.doesNotMatch(newCss, /font-family|@import|url\(|@font-face/);
  assert.doesNotMatch(modal + completeModal + popover, /from '(?!react|react-dom|\.|\.\.)[^']*'/);
});

// ── D. priority squares: glass finish only ───────────────────────────────────────────────────────────

test('D — priority squares keep colors / size / meaning; glass finish is CSS-only and non-destructive', () => {
  // Colors, size, radius untouched.
  assert.match(css, /\.nx-co-todo-priority__btn--red \{ background: #ef4444; \}/);
  assert.match(css, /\.nx-co-todo-priority__btn--orange \{ background: #f97316; \}/);
  assert.match(css, /\.nx-co-todo-priority__btn--gold \{ background: #eab308; color: #3b2f0b; \}/);
  assert.match(css, /\.nx-co-todo-priority__btn--green \{ background: #22c55e; \}/);
  assert.match(css, /\.nx-co-todo-priority__btn--blue \{ background: #3b82f6; \}/);
  assert.match(css, /\.nx-co-todo-priority__btn \{\s*width: 36px;\s*height: 36px;\s*border-radius: 6px;/);
  const glass = css.slice(css.lastIndexOf('/*', css.indexOf('Priority squares 1–5: glass finish ONLY'))).replace(/\/\*[\s\S]*?\*\//g, '');
  // Never repaints the base color (only background-image) and never resizes / repositions.
  assert.doesNotMatch(glass, /(^|[^-])background:\s*#|background-color/m);
  assert.doesNotMatch(glass, /\b(width|height|margin|padding|top:|left:|display|flex|gap|transform|animation|transition)\b/);
  // Layered finish: gloss cap + reflection pseudo-elements behind the label, inner highlight, refined border.
  assert.match(glass, /\.nx-co-todo-priority__btn::before/);
  assert.match(glass, /\.nx-co-todo-priority__btn::after/);
  assert.match(glass, /z-index: -1;/);
  assert.match(glass, /isolation: isolate;/);
  assert.match(glass, /inset 0 1px 0 rgba\(255, 255, 255, 0\.5\)/);
  assert.match(glass, /border-color: rgba\(255, 255, 255, 0\.4\)/);
  // Selected state still shows the selection ring + dark border.
  assert.match(glass, /\.nx-co-todo-priority__btn\.is-selected \{\s*border-color: #0a2d55;[\s\S]*?0 0 0 2px rgba\(29, 125, 255, 0\.35\)/);
  // No generated images / icon libraries; the markup (numbers, order, roles) is unchanged.
  assert.doesNotMatch(glass, /url\(|\.png|\.svg/);
  assert.match(modal, /\{lane\.visual_number\}/);
  assert.match(modal, /role="radio"/);
});

// ── C. redundant-request fixes ───────────────────────────────────────────────────────────────────────

test('C — workspace identity is two primitives (no refetch / form reset on every parent render); no duplicate board load', () => {
  assert.match(modal, /workspaceQuery: workspaceQueryProp/);
  assert.match(modal, /useMemo<ClientOperationsTodoWorkspaceQuery>\(\s*\(\) => \(\{ workspace_scope: wsScope, workspace_subject_user_id: wsSubject \}\),\s*\[wsScope, wsSubject\],\s*\)/);
  assert.match(modal, /if \(next === searchQ\) return;/);
  // Still exactly one board GET entry point and no hidden extra reads.
  assert.equal((modal.match(/moduleClientOperationsTodoBoard\(/g) ?? []).length, 1);
  assert.equal((modal.match(/moduleClientOperationsTodoArchive\(/g) ?? []).length, 1);
  assert.equal((modal.match(/moduleClientOperationsTodoClientOptions\(/g) ?? []).length, 1);
});
