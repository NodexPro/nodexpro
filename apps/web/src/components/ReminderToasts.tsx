import { useCallback, useEffect, useRef, useState } from 'react';
import { apiJson } from '../api/client';
import { moduleClientOperationsRemindersDue } from '../api/endpoints';
import { ReminderToast } from './ReminderToast';
import '../styles/nx-modal.css';

type DueReminder = {
  id: string;
  body: string;
  reminder_at: string;
  client_id: string;
  client_name: string | null;
  type_label_he: string;
};

/** Defer first fetch slightly so it does not stack with registry / session on cold load. */
const INITIAL_FETCH_DELAY_MS = 800;

function formatReminderDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function ReminderToasts({ enabled }: { enabled: boolean }) {
  const [toasts, setToasts] = useState<DueReminder[]>([]);
  // IDs that were already shown to the user.
  const shownIds = useRef<Set<string>>(new Set());
  const fetchInFlight = useRef(false);

  const fetchDue = useCallback(async () => {
    if (!enabled || fetchInFlight.current) return;
    fetchInFlight.current = true;
    try {
      const data = await apiJson<{ reminders: DueReminder[] }>(moduleClientOperationsRemindersDue());
      const list = Array.isArray(data?.reminders) ? data.reminders : [];

      const nowMs = Date.now();
      const toleranceMs = 0; // show only when reminder_at already arrived
      const newOnes = list.filter((r) => {
        if (shownIds.current.has(r.id)) return false;
        const reminderMs = new Date(r.reminder_at).getTime();
        if (Number.isNaN(reminderMs)) return false;
        // only show when the reminder time has already arrived
        return reminderMs <= nowMs + toleranceMs;
      });
      if (newOnes.length) {
        newOnes.forEach((r) => shownIds.current.add(r.id));
        setToasts((prev) => [...prev, ...newOnes]);
      }
    } catch {
      // ignore
    } finally {
      fetchInFlight.current = false;
    }
  }, [enabled]);

  /** Single due fetch when reminders are enabled — no polling (avoids repeated /reminders/due traffic). */
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const delayId = setTimeout(() => {
      if (!cancelled) void fetchDue();
    }, INITIAL_FETCH_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(delayId);
    };
  }, [enabled, fetchDue]);

  const dismiss = (noteId: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== noteId));
  };

  const dismissAll = () => setToasts([]);

  if (!toasts.length) return null;

  return (
    <div className="nx-reminder-toast-stack" role="alert" aria-live="polite">
      {toasts.map((r) => (
        <ReminderToast
          key={r.id}
          open
          clientName={r.client_name ?? ''}
          title={r.type_label_he}
          description={r.body}
          reminderTypeLabel={r.type_label_he}
          reminderDateLabel={formatReminderDate(r.reminder_at)}
          onOpen={() => {}}
          onDismiss={() => dismiss(r.id)}
          onClose={() => dismiss(r.id)}
        />
      ))}
      {toasts.length > 1 && (
        <button
          type="button"
          onClick={dismissAll}
          className="nx-reminder-dismiss-all"
          style={{
            alignSelf: 'flex-start',
            padding: '6px 12px',
            fontSize: 13,
            color: '#64748b',
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          סגור הכל
        </button>
      )}
    </div>
  );
}
