import { useMemo, useState } from 'react';
import '../../styles/nx-clients.css';
import '../../styles/nx-client-operations-spreadsheet.css';

type ClientDocumentListModel = {
  title_key: string;
  generate_label_key: string;
  preview_label_key: string;
  download_label_key: string;
  send_label_key: string;
  email_label_key: string;
  include_label_key: string;
  empty_key: string;
  can_generate: boolean;
  can_send: boolean;
  can_send_email: boolean;
  recipient_email: string | null;
  items: Array<{
    row_id: string;
    client_facing_name: string;
    client_facing_description: string | null;
    include_in_client_list: boolean;
  }>;
  preview: {
    file_asset_id: string | null;
    generated_at: string | null;
    can_open: boolean;
  };
  send_history: Array<{ send_id: string; file_asset_id: string }>;
  docflow_threads: Array<{ thread_id: string; label: string }>;
};

export function ClientAnnualClientDocumentListModal(props: {
  list: ClientDocumentListModel;
  dir: 'rtl' | 'ltr';
  t: (key: string) => string;
  busy: boolean;
  threadId: string;
  onThreadIdChange: (threadId: string) => void;
  onClose: () => void;
  onGenerate: (selectedRowIds: string[]) => void;
  onPreview: (fileAssetId: string) => void;
  onDownload: (fileAssetId: string) => void;
  onSendDocflow: (threadId: string, sendId: string | null) => void;
  onSendEmail: (sendId: string | null) => void;
}) {
  const { list, dir, t, busy } = props;
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(list.items.filter((item) => item.include_in_client_list).map((item) => item.row_id)),
  );

  const selectedIds = useMemo(() => list.items.map((item) => item.row_id).filter((id) => selected.has(id)), [list.items, selected]);
  const previewId = list.preview.file_asset_id;
  const latestSendId = list.send_history[0]?.send_id ?? null;

  const toggle = (rowId: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  };

  return (
    <div
      className="nx-clients-overlay nx-co-ni-overlay"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) props.onClose();
      }}
    >
      <div
        className="nx-glass-card nx-clients-modal nx-co-ops-modal nx-co-ni-modal nx-co-pdf-list-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="nx-co-pdf-list-title"
        dir={dir}
        data-testid="annual-client-document-list"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="nx-clients-modal__head">
          <h3 id="nx-co-pdf-list-title">{t(list.generate_label_key)}</h3>
          <button
            type="button"
            className="nx-clients-modal__close"
            aria-label={t('clientOperations.close')}
            disabled={busy}
            onClick={() => !busy && props.onClose()}
          >
            ×
          </button>
        </div>
        <div className="nx-clients-form">
          <div className="nx-clients-form__body nx-co-ni-modal__body nx-co-pdf-list-modal__body">
            {list.items.length === 0 ? (
              <p className="nx-co-pdf-list-modal__empty">{t(list.empty_key)}</p>
            ) : (
              <ul className="nx-co-pdf-list-modal__grid">
                {list.items.map((item) => (
                  <li key={item.row_id} className="nx-co-pdf-list-modal__item">
                    <label>
                      <input
                        type="checkbox"
                        checked={selected.has(item.row_id)}
                        disabled={busy || !list.can_generate}
                        onChange={() => toggle(item.row_id)}
                      />
                      <span>
                        <strong>{item.client_facing_name}</strong>
                        {item.client_facing_description ? <em>{item.client_facing_description}</em> : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {list.docflow_threads.length ? (
              <label className="nx-co-pdf-list-modal__thread">
                {t('clientOperations.annual.clientDocumentListThread')}
                <select
                  value={props.threadId}
                  disabled={busy || !list.can_send}
                  onChange={(event) => props.onThreadIdChange(event.target.value)}
                >
                  <option value=""> </option>
                  {list.docflow_threads.map((thread) => (
                    <option key={thread.thread_id} value={thread.thread_id}>
                      {thread.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {list.recipient_email ? (
              <p className="nx-co-pdf-list-modal__email">{list.recipient_email}</p>
            ) : null}
          </div>
          <div className="nx-clients-form__footer nx-tax-nested-modal-footer nx-co-pdf-list-modal__footer">
            <button
              type="button"
              className="nx-btn nx-btn-primary nx-btn-taxes-compact"
              disabled={busy || !list.can_generate || selectedIds.length === 0}
              onClick={() => props.onGenerate(selectedIds)}
            >
              {t(list.generate_label_key)}
            </button>
            <button
              type="button"
              className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
              disabled={busy || !list.preview.can_open || !previewId}
              onClick={() => previewId && props.onPreview(previewId)}
            >
              {t(list.preview_label_key)}
            </button>
            <button
              type="button"
              className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
              disabled={busy || !list.preview.can_open || !previewId}
              onClick={() => previewId && props.onDownload(previewId)}
            >
              {t(list.download_label_key)}
            </button>
            <button
              type="button"
              className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
              disabled={busy || !list.can_send || !props.threadId}
              onClick={() => props.onSendDocflow(props.threadId, latestSendId)}
            >
              {t(list.send_label_key)}
            </button>
            <button
              type="button"
              className="nx-btn nx-btn-secondary nx-btn-taxes-compact"
              disabled={busy || !list.can_send_email}
              onClick={() => props.onSendEmail(latestSendId)}
            >
              {t(list.email_label_key)}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
