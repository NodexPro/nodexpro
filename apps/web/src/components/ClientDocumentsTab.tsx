import { useEffect, useRef, useState } from 'react';
import { apiJson, userFacingApiMessage } from '../api/client';
import {
  moduleClientOperationsDocumentsCommands,
  moduleClientOperationsDocumentsFileOpen,
  moduleClientOperationsDocumentsUpload,
} from '../api/endpoints';
import type { ClientDocumentsTabModel, ClientDocumentsTabFolderCardDto } from './client-documents-tab-types';
import type { ClientOperationsCaseResponse } from './ClientWorkspacePanel';
import '../styles/nx-client-documents-tab.css';

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : '';
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function IconFolderLarge() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="40" height="40" fill="currentColor" aria-hidden>
      <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z" />
    </svg>
  );
}

function IconDocSmall() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden>
      <path d="M14 2H6c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z" />
    </svg>
  );
}

function IconEyeBlue() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
      <path d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z" />
    </svg>
  );
}

function IconTrashBlue() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden>
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
    </svg>
  );
}

type FolderDialog =
  | null
  | { mode: 'create' }
  | { mode: 'rename'; folder: ClientDocumentsTabFolderCardDto };

export function ClientDocumentsTab({
  clientId,
  documentsTab,
  onCaseUpdated,
}: {
  clientId: string;
  documentsTab: ClientDocumentsTabModel;
  onCaseUpdated: (next: ClientOperationsCaseResponse) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [folderDlg, setFolderDlg] = useState<FolderDialog>(null);
  const [folderNameDraft, setFolderNameDraft] = useState('');
  const [pendingOpenFolder, setPendingOpenFolder] = useState<{ folder_id: string; folder_name_he: string } | null>(null);
  /** Hide folder panel immediately on סגירה; server case catches up in background. */
  const [folderPanelDismissed, setFolderPanelDismissed] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const canEdit = documentsTab.permissions.can_edit;

  useEffect(() => {
    if (!folderDlg) setFolderNameDraft('');
    else if (folderDlg.mode === 'rename') setFolderNameDraft(folderDlg.folder.name_he);
    else setFolderNameDraft('');
  }, [folderDlg]);

  const serverOpenFolderId = documentsTab.open_folder?.folder_id ?? null;
  useEffect(() => {
    setPendingOpenFolder(null);
    setFolderPanelDismissed(false);
  }, [serverOpenFolderId]);

  const runCommand = async (
    type: string,
    payload: Record<string, unknown>,
    opts?: { skipBusy?: boolean }
  ): Promise<boolean> => {
    if (!opts?.skipBusy) setBusy(true);
    setErr('');
    try {
      const out = await apiJson<ClientOperationsCaseResponse>(moduleClientOperationsDocumentsCommands(clientId), {
        method: 'POST',
        body: JSON.stringify({
          type,
          payload,
          expected_version: documentsTab.read_model_version,
        }),
      });
      onCaseUpdated(out);
      return true;
    } catch (e) {
      setErr(userFacingApiMessage(e));
      return false;
    } finally {
      if (!opts?.skipBusy) setBusy(false);
    }
  };

  const openFolder = (folder: ClientDocumentsTabFolderCardDto) => {
    setFolderPanelDismissed(false);
    setPendingOpenFolder({ folder_id: folder.folder_id, folder_name_he: folder.name_he });
    void runCommand('open_client_document_folder', { folder_id: folder.folder_id }).then((ok) => {
      if (!ok) setPendingOpenFolder(null);
    });
  };

  const closeFolder = () => {
    setFolderPanelDismissed(true);
    setPendingOpenFolder(null);
    void runCommand('open_client_document_folder', {}, { skipBusy: true }).then((ok) => {
      if (!ok) {
        setFolderPanelDismissed(false);
        if (documentsTab.open_folder) {
          setPendingOpenFolder({
            folder_id: documentsTab.open_folder.folder_id,
            folder_name_he: documentsTab.open_folder.folder_name_he,
          });
        }
      }
    });
  };

  const openFile = async (fileAssetId: string) => {
    setErr('');
    try {
      const { url } = await apiJson<{ url: string }>(moduleClientOperationsDocumentsFileOpen(clientId, fileAssetId), {
        method: 'GET',
      });
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setErr(userFacingApiMessage(e));
    }
  };

  const onPickDocument = () => {
    fileRef.current?.click();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    const of = documentsTab.open_folder;
    if (!file || !of || !canEdit) return;
    setBusy(true);
    setErr('');
    try {
      const file_base64 = await fileToBase64(file);
      const { file_asset_id } = await apiJson<{ file_asset_id: string }>(moduleClientOperationsDocumentsUpload(clientId), {
        method: 'POST',
        body: JSON.stringify({
          file_name: file.name,
          mime_type: file.type || null,
          file_base64,
        }),
      });
      const out = await apiJson<ClientOperationsCaseResponse>(moduleClientOperationsDocumentsCommands(clientId), {
        method: 'POST',
        body: JSON.stringify({
          type: 'upload_client_document',
          payload: { folder_id: of.folder_id, file_asset_id, display_label_he: null },
          expected_version: documentsTab.read_model_version,
        }),
      });
      onCaseUpdated(out);
    } catch (err2) {
      setErr(userFacingApiMessage(err2));
    } finally {
      setBusy(false);
    }
  };

  const submitFolderDialog = async () => {
    const name = folderNameDraft.trim();
    if (!folderDlg) return;
    const ok =
      folderDlg.mode === 'create'
        ? await runCommand('create_client_document_folder', { name_he: name })
        : await runCommand('rename_client_document_folder', { folder_id: folderDlg.folder.folder_id, name_he: name });
    if (ok) setFolderDlg(null);
  };

  const confirmArchiveFolder = (folder: ClientDocumentsTabFolderCardDto) => {
    if (!folder.actions.can_archive_or_delete) return;
    if (!window.confirm('למחוק את התיקייה? פעולה זו בלתי הפיכה.')) return;
    void runCommand('archive_or_delete_client_document_folder', { folder_id: folder.folder_id });
  };

  const confirmDeleteDocument = (documentId: string) => {
    if (!window.confirm('למחוק את המסמך?')) return;
    void runCommand('delete_client_document', { document_id: documentId });
  };

  const folders = documentsTab.folders_grid.folders;
  const openFolderView = documentsTab.open_folder;
  const folderPanelTitle = openFolderView?.folder_name_he ?? pendingOpenFolder?.folder_name_he ?? '';
  const showFolderPanel = Boolean((openFolderView || pendingOpenFolder) && !folderPanelDismissed);
  const folderPanelLoading = !openFolderView && Boolean(pendingOpenFolder);

  return (
    <div className="nx-cdocs-root">
      <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={onFileChange} />

      {err ? (
        <p className="nx-cdocs-err" role="alert">
          {err}
        </p>
      ) : null}

      <div className="nx-cdocs-surface">
        <div className="nx-cdocs-head">
          <h2 className="nx-cdocs-title">{documentsTab.ui.tab_title_he}</h2>
          {canEdit ? (
            <button
              type="button"
              className="nx-btn nx-btn-primary nx-btn-taxes-compact"
              disabled={busy}
              onClick={() => setFolderDlg({ mode: 'create' })}
            >
              + {documentsTab.ui.add_folder_label_he}
            </button>
          ) : null}
        </div>

        {folders.length === 0 ? (
          <p className="nx-cdocs-empty">{documentsTab.ui.empty_folders_state_he}</p>
        ) : (
          <div className="nx-cdocs-folder-grid">
            {folders.map((f) => (
              <div
                key={f.folder_id}
                className="nx-cdocs-folder-card"
                role="presentation"
              >
                <button
                  type="button"
                  className="nx-cdocs-folder-card-main"
                  disabled={busy || !f.actions.can_open}
                  onClick={() => openFolder(f)}
                >
                  <span className="nx-cdocs-folder-icon-wrap" aria-hidden>
                    <IconFolderLarge />
                  </span>
                  <span className="nx-cdocs-folder-name">{f.name_he}</span>
                  <span className="nx-cdocs-folder-meta">
                    <span className="nx-cdocs-folder-count">{f.document_count} מסמכים</span>
                    <span className="nx-cdocs-folder-updated">{f.last_updated_display_he}</span>
                  </span>
                </button>
                {(f.actions.can_rename || f.actions.can_archive_or_delete) && canEdit ? (
                  <div className="nx-cdocs-folder-actions">
                    {f.actions.can_rename ? (
                      <button
                        type="button"
                        className="nx-cdocs-linkish"
                        disabled={busy}
                        onClick={() => setFolderDlg({ mode: 'rename', folder: f })}
                      >
                        שינוי שם
                      </button>
                    ) : null}
                    {f.actions.can_archive_or_delete ? (
                      <button
                        type="button"
                        className="nx-cdocs-icon-action"
                        disabled={busy}
                        onClick={() => confirmArchiveFolder(f)}
                        aria-label="מחיקת תיקייה"
                        title="מחיקה"
                      >
                        <IconTrashBlue />
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {showFolderPanel ? (
        <div className="nx-cdocs-folder-overlay" role="presentation">
          <div className="nx-cdocs-folder-panel" role="dialog" aria-modal="true" aria-labelledby="nx-cdocs-folder-panel-title">
            <div className="nx-cdocs-folder-panel-head">
              <div>
                <h3 id="nx-cdocs-folder-panel-title" className="nx-cdocs-folder-panel-title">
                  {folderPanelTitle}
                </h3>
              </div>
              <div className="nx-cdocs-folder-panel-head-actions">
                {canEdit && openFolderView ? (
                  <button type="button" className="nx-btn nx-btn-primary nx-btn-taxes-compact" disabled={busy} onClick={onPickDocument}>
                    + {documentsTab.ui.add_document_label_he}
                  </button>
                ) : null}
                <button type="button" className="nx-btn nx-btn-secondary nx-btn-taxes-compact" disabled={busy} onClick={closeFolder}>
                  סגירה
                </button>
              </div>
            </div>

            {folderPanelLoading ? (
              <p className="nx-cdocs-panel-loading">טוען מסמכים…</p>
            ) : openFolderView && openFolderView.documents.length === 0 ? (
              <p className="nx-cdocs-empty nx-cdocs-empty--in-panel">{documentsTab.ui.empty_documents_state_he}</p>
            ) : openFolderView ? (
              <ul className="nx-cdocs-doc-list">
                {openFolderView.documents.map((d) => {
                  const label = d.display_label_he?.trim() || d.file_name_he?.trim() || '—';
                  return (
                    <li key={d.document_id} className="nx-cdocs-doc-row">
                      <span className="nx-cdocs-doc-icon" aria-hidden>
                        <IconDocSmall />
                      </span>
                      <div className="nx-cdocs-doc-main">
                        <span className="nx-cdocs-doc-label">{label}</span>
                        <span className="nx-cdocs-doc-sub">{d.uploaded_display_he}</span>
                      </div>
                      <div className="nx-cdocs-doc-actions">
                        {d.actions.can_view && d.file_asset_id ? (
                          <button
                            type="button"
                            className="nx-cdocs-icon-action"
                            disabled={busy || !d.file_open_allowed}
                            onClick={() => void openFile(d.file_asset_id!)}
                            aria-label="צפייה במסמך"
                            title="צפייה"
                          >
                            <IconEyeBlue />
                          </button>
                        ) : null}
                        {d.actions.can_delete ? (
                          <button
                            type="button"
                            className="nx-cdocs-icon-action"
                            disabled={busy}
                            onClick={() => confirmDeleteDocument(d.document_id)}
                            aria-label="מחיקת מסמך"
                            title="מחיקה"
                          >
                            <IconTrashBlue />
                          </button>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </div>
      ) : null}

      {folderDlg ? (
        <div
          className="nx-modal-overlay"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget && !busy) setFolderDlg(null);
          }}
        >
          <div className="nx-modal nx-cdocs-folder-name-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="nx-modal-header">
              <h2 className="nx-modal-title">{folderDlg.mode === 'create' ? 'תיקייה חדשה' : 'שינוי שם תיקייה'}</h2>
              <button type="button" className="nx-modal-close" aria-label="סגירה" disabled={busy} onClick={() => setFolderDlg(null)}>
                ×
              </button>
            </div>
            <div className="nx-modal-body">
              <label className="nx-cdocs-field-label" htmlFor="nx-cdocs-folder-name-inp">
                שם
              </label>
              <input
                id="nx-cdocs-folder-name-inp"
                className="nx-cdocs-text-inp"
                value={folderNameDraft}
                onChange={(e) => setFolderNameDraft(e.target.value)}
                disabled={busy}
                dir="rtl"
              />
            </div>
            <div className="nx-modal-footer nx-tax-nested-modal-footer">
              <button type="button" className="nx-btn nx-btn-primary nx-btn-taxes-compact" disabled={busy} onClick={() => void submitFolderDialog()}>
                שמירה
              </button>
              <button type="button" className="nx-btn nx-btn-secondary nx-btn-taxes-compact" disabled={busy} onClick={() => setFolderDlg(null)}>
                ביטול
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
