import { useCallback, useEffect, useRef, useState } from 'react';
import { apiJson } from '../api/client';
import { moduleClientOperationsRemindersDue } from '../api/endpoints';
import { useI18n } from '../i18n/I18nProvider';
import { localizeSystemLabel } from '../lib/co-display-label.pure';
import { ReminderToast } from './ReminderToast';
import '../styles/nx-modal.css';

type DueReminder = {
  id: string;
  body: string;
  reminder_at: string;
  client_id: string;
  client_name: string | null;
  type_code?: string;
  type_label_he: string;
  type_label_key?: string | null;
};

/** Defer first fetch slightly so it does not stack with registry / session on cold load. */
const INITIAL_FETCH_DELAY_MS = 800;

function formatReminderDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale === 'he' ? 'he-IL' : 'en-GB', {
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

function noteTypeLabelKey(code: string | undefined): string | null {
  if (code === 'call') return 'clientOperations.notes.call';
  if (code === 'reminder') return 'clientOperations.notes.reminder';
  if (code === 'greeting') return 'clientOperations.notes.greeting';
  if (code === 'text') return 'clientOperations.notes.text';
  return null;
}

export function ReminderToasts({ enabled }: { enabled: boolean }) {
  const { t, lang } = useI18n();
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

      const newOnes = list.filter((r) => !shownIds.current.has(r.id));
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
          title={localizeSystemLabel(t, r.type_label_key ?? noteTypeLabelKey(r.type_code), r.type_label_he, lang)}
          description={r.body}
          reminderTypeLabel={localizeSystemLabel(t, r.type_label_key ?? noteTypeLabelKey(r.type_code), r.type_label_he, lang)}
          reminderDateLabel={formatReminderDate(r.reminder_at, lang)}
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
          {t('clientOperations.reminders.dismissAll')}
        </button>
      )}
    </div>
  );
}
