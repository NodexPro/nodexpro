/**
 * ToDo progress note (שלב טיפול) — debounced auto-save scheduler (presentation plumbing only).
 *
 * It decides WHEN to send the named backend command, never WHAT the note means:
 *  - typing is debounced (no request per keystroke);
 *  - saves are strictly SERIALIZED (one request in flight), so a slower earlier response can never land after
 *    a newer one and the server always ends with the latest value;
 *  - if the value changed while a request was in flight, the latest value is sent right after it completes;
 *  - a failed save keeps the value dirty and visible as an error; the next change or flush retries it;
 *  - nothing is persisted optimistically — `saved` is reported only after the backend command succeeded.
 */

export type ProgressNoteSaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

export type ProgressNoteSaveState = { status: ProgressNoteSaveStatus; error: string | null };

export const TODO_PROGRESS_NOTE_AUTOSAVE_DEBOUNCE_MS = 700;

export type ProgressNoteAutosaver = {
  /** The user edited the field. */
  change: (value: string) => void;
  /** Send any unsaved value now. Resolves true when everything is saved, false when the save failed. */
  flush: () => Promise<boolean>;
  /** Teardown: cancels the timer; an unsaved value is still sent (fire-and-forget, no UI updates). */
  dispose: () => void;
  getState: () => ProgressNoteSaveState;
};

export function createProgressNoteAutosaver(options: {
  initialValue: string;
  save: (value: string) => Promise<void>;
  onState: (state: ProgressNoteSaveState) => void;
  debounceMs?: number;
  errorMessage?: string;
}): ProgressNoteAutosaver {
  const debounceMs = options.debounceMs ?? TODO_PROGRESS_NOTE_AUTOSAVE_DEBOUNCE_MS;
  let latest = options.initialValue;
  let saved = options.initialValue;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pumping: Promise<boolean> | null = null;
  let disposed = false;
  let state: ProgressNoteSaveState = { status: 'idle', error: null };

  const emit = (next: ProgressNoteSaveState) => {
    state = next;
    if (!disposed) options.onState(next);
  };
  const dirty = () => latest !== saved;
  const clearTimer = () => {
    if (timer != null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const pump = (): Promise<boolean> => {
    if (pumping) return pumping;
    pumping = (async () => {
      try {
        while (dirty()) {
          const value = latest;
          emit({ status: 'saving', error: null });
          try {
            await options.save(value);
            saved = value;
          } catch (e) {
            emit({
              status: 'error',
              error: e instanceof Error && e.message ? e.message : (options.errorMessage ?? 'שגיאה בשמירה'),
            });
            return false;
          }
        }
        emit({ status: 'saved', error: null });
        return true;
      } finally {
        pumping = null;
      }
    })();
    return pumping;
  };

  return {
    change(value) {
      latest = value;
      clearTimer();
      if (pumping) return; // the running loop re-checks `latest` after the current request
      if (!dirty()) {
        emit({ status: state.status === 'idle' ? 'idle' : 'saved', error: null });
        return;
      }
      emit({ status: 'pending', error: null });
      timer = setTimeout(() => {
        timer = null;
        void pump();
      }, debounceMs);
    },
    async flush() {
      clearTimer();
      if (!dirty() && !pumping) return state.status !== 'error';
      return pump();
    },
    dispose() {
      clearTimer();
      disposed = true; // no UI updates after teardown, but an unsaved value is still delivered
      if (dirty() && !pumping) void pump();
    },
    getState: () => state,
  };
}

/** Hebrew status line shown under the field (null = nothing to show). */
export function progressNoteSaveStateLabelHe(state: ProgressNoteSaveState): string | null {
  switch (state.status) {
    case 'pending':
    case 'saving':
      return 'שומר…';
    case 'saved':
      return 'נשמר';
    case 'error':
      return state.error ?? 'שגיאה בשמירה';
    default:
      return null;
  }
}
