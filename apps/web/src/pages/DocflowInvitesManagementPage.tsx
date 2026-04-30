import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { apiJson, userFacingApiMessage } from '../api/client';
import { docflowInvitesManagementAggregate, docflowOfficeCommands } from '../api/endpoints';

type UnknownRecord = Record<string, unknown>;

function DocflowInvitesTitle({ title }: { title: string }) {
  const m = title.match(/^(.*?)(DocFlow)\s*$/is);
  if (!m) {
    return <span lang="he">{title}</span>;
  }
  const before = m[1].replace(/[\s\-–—]+$/u, '').trimEnd();
  return (
    <>
      <span lang="he">{before} </span>
      <span dir="ltr" lang="en" style={{ unicodeBidi: 'embed' }}>
        {m[2]}
      </span>
    </>
  );
}

type RowModel = {
  invitation_id?: string | null;
  client_id: string;
  client_name: string;
  phone: string | null;
  email: string | null;
  invite_status: string;
  invite_status_label: string;
  delivery_status?: string | null;
  delivery_status_label?: string | null;
  delivery_channel?: 'email' | 'sms' | null;
  delivery_error?: string | null;
  invite_sent_at: string | null;
  allowed_actions?: {
    can_invite?: boolean;
    can_resend?: boolean;
    can_revoke?: boolean;
    can_send_invite_delivery?: boolean;
  };
};

function statusPillStyle(status: string): CSSProperties {
  if (status === 'joined') return { background: '#DCFCE7', color: '#166534' };
  if (status === 'invited') return { background: '#FEF3C7', color: '#92400E' };
  if (status === 'expired') return { background: '#F3F4F6', color: '#6B7280' };
  if (status === 'revoked') return { background: '#FEE2E2', color: '#991B1B' };
  return { background: '#F3F4F6', color: '#374151' };
}

function initials(name: string): string {
  const cleaned = name.trim();
  if (!cleaned) return 'לק';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2);
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`;
}

function avatarPalette(name: string): { background: string; color: string } {
  const variants = [
    { background: '#EEF2FF', color: '#4F46E5' },
    { background: '#E0F2FE', color: '#0369A1' },
    { background: '#DCFCE7', color: '#166534' },
    { background: '#FEF3C7', color: '#92400E' },
  ];
  const idx = Math.abs(name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)) % variants.length;
  return variants[idx];
}

export function DocflowInvitesManagementPage() {
  const [aggregate, setAggregate] = useState<UnknownRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [selectedClientIds, setSelectedClientIds] = useState<string[]>([]);
  const [searchClient, setSearchClient] = useState('');
  const [inviteStatus, setInviteStatus] = useState('');

  async function load(params?: { page?: number; pageSize?: number; searchClient?: string; inviteStatus?: string }) {
    setLoading(true);
    setError('');
    try {
      const out = (await apiJson(docflowInvitesManagementAggregate(params))) as UnknownRecord;
      setAggregate(out);
      setSelectedClientIds([]);
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load({ page: 1, pageSize: 25 });
  }, []);

  const tableRows = useMemo(() => {
    const rows = (aggregate?.table as UnknownRecord | undefined)?.rows;
    return Array.isArray(rows) ? (rows as RowModel[]) : [];
  }, [aggregate]);
  const tableColumns = useMemo(() => {
    const cols = (aggregate?.table as UnknownRecord | undefined)?.columns;
    return Array.isArray(cols) ? (cols as Array<{ key: string; label: string }>) : [];
  }, [aggregate]);

  const pagination = ((aggregate?.pagination as UnknownRecord | undefined) ?? {}) as {
    page?: number;
    page_size?: number;
    total_pages?: number;
  };

  const filterOptions = useMemo(() => {
    const options = (aggregate?.filters as UnknownRecord | undefined)?.invite_status_options;
    return Array.isArray(options) ? (options as Array<{ value: string; label: string }>) : [];
  }, [aggregate]);
  const statusLabels = ((aggregate?.status_labels as UnknownRecord | undefined) ?? {}) as Record<string, unknown>;

  async function runCommand(command: string, payload: UnknownRecord) {
    setBusy(command);
    setError('');
    try {
      const orgId = sessionStorage.getItem('activeOrganizationId') ?? '';
      if (!orgId) throw new Error('No active organization selected');
      const out = (await apiJson(docflowOfficeCommands, {
        method: 'POST',
        body: JSON.stringify({
          command,
          payload: {
            org_id: orgId,
            refresh_target: 'docflow_invites_management',
            page: Number(pagination.page ?? 1) || 1,
            page_size: Number(pagination.page_size ?? 25) || 25,
            search_client: searchClient.trim() || null,
            invite_status: inviteStatus || null,
            ...payload,
          },
        }),
      })) as { refreshed?: { aggregate?: UnknownRecord } };
      const refreshed = out.refreshed?.aggregate;
      if (!refreshed || typeof refreshed !== 'object') throw new Error('DocFlow aggregate refresh missing');
      setAggregate(refreshed);
      setSelectedClientIds([]);
    } catch (e) {
      setError(userFacingApiMessage(e));
    } finally {
      setBusy('');
    }
  }

  if (loading) {
    return (
      <div className="client-profile-card" dir="rtl" lang="he" style={{ padding: 16, direction: 'rtl' }}>
        טוען…
      </div>
    );
  }

  const title = String(aggregate?.title ?? 'הזמנות ל DocFlow');
  const canInviteAll = (aggregate?.allowed_actions as UnknownRecord | undefined)?.invite_all_clients_to_docflow as
    | { enabled?: boolean }
    | undefined;
  const canInviteSelected = (aggregate?.allowed_actions as UnknownRecord | undefined)?.invite_selected_clients_to_docflow as
    | { enabled?: boolean }
    | undefined;

  const cellAlign: CSSProperties = { textAlign: 'start' };

  return (
    <div
      className="client-profile-card"
      dir="rtl"
      lang="he"
      style={{
        padding: 18,
        display: 'grid',
        gap: 10,
        direction: 'rtl',
        textAlign: 'start',
        background: '#fff',
        border: '1px solid #E5E7EB',
        borderRadius: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'grid', gap: 3 }}>
          <h1 style={{ margin: 0, fontSize: 39, lineHeight: 1.02, fontWeight: 800, letterSpacing: '-0.02em' }}>
            <DocflowInvitesTitle title={title} />
          </h1>
          <div style={{ color: '#6B7280', fontSize: 12 }}>הזמן את הלקוחות להצטרף ל DocFlow ונהל את סטטוס ההזמנות.</div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={busy.length > 0}
            style={{ minWidth: 118, background: '#fff', color: '#374151', border: '1px solid #E5E7EB' }}
          >
            יצא לאקסל
          </button>
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={canInviteSelected?.enabled === false || selectedClientIds.length === 0 || busy.length > 0}
            onClick={() => void runCommand('invite_selected_clients_to_docflow', { client_ids: selectedClientIds })}
            style={{ minWidth: 162 }}
          >
            הזמן לקוחות נבחרים
          </button>
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={canInviteAll?.enabled === false || busy.length > 0}
            onClick={() => void runCommand('invite_all_clients_to_docflow', {})}
            style={{ minWidth: 162 }}
          >
            הזמן את כל הלקוחות
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 2 }}>
        <input
          type="text"
          placeholder="חיפוש לקוח"
          value={searchClient}
          onChange={(e) => setSearchClient(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid #E5E7EB',
            borderRadius: 7,
            minWidth: 260,
            background: '#fff',
            fontSize: 13,
          }}
        />
        <select
          value={inviteStatus}
          onChange={(e) => setInviteStatus(e.target.value)}
          style={{ padding: '8px 10px', border: '1px solid #E5E7EB', borderRadius: 7, minWidth: 150, background: '#fff', fontSize: 13 }}
        >
          {filterOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="nx-btn nx-btn-taxes-compact"
          disabled={busy.length > 0}
          onClick={() => void load({ page: 1, pageSize: Number(pagination.page_size ?? 25), searchClient, inviteStatus })}
          style={{ minWidth: 64 }}
        >
          סנן
        </button>
      </div>

      {error ? <p style={{ color: '#b91c1c', margin: 0 }}>{error}</p> : null}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'separate', borderSpacing: 0, direction: 'rtl', fontSize: 13.5 }}>
          <thead>
            <tr>
              <th style={{ ...cellAlign, borderBottom: '1px solid #F3F4F6', color: '#6B7280', padding: '8px 10px', width: 40, fontWeight: 600 }} />
              {tableColumns.map((col) => (
                <th key={col.key} style={{ ...cellAlign, borderBottom: '1px solid #F3F4F6', color: '#6B7280', padding: '8px 10px', fontWeight: 600 }}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.map((row) => {
              const checked = selectedClientIds.includes(row.client_id);
              return (
                <tr key={row.client_id}>
                  <td style={{ ...cellAlign, borderBottom: '1px solid #F9FAFB', padding: '9px 10px', verticalAlign: 'middle' }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        setSelectedClientIds((prev) =>
                          e.target.checked ? [...prev, row.client_id] : prev.filter((id) => id !== row.client_id)
                        )
                      }
                    />
                  </td>
                  {tableColumns.map((col) => {
                    if (col.key === 'actions') {
                      const canInvite = row.allowed_actions?.can_invite === true;
                      const canResend = row.allowed_actions?.can_resend === true;
                      const canRevoke = row.allowed_actions?.can_revoke === true;
                      const canSendDelivery = row.allowed_actions?.can_send_invite_delivery === true;
                      const primaryLabel = canInvite ? 'הזמן' : canResend ? 'שלח תזכורת' : canRevoke ? 'בטל הזמנה' : '—';
                      return (
                        <td key={col.key} style={{ ...cellAlign, borderBottom: '1px solid #F9FAFB', padding: '9px 10px', verticalAlign: 'middle' }}>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'flex-start' }}>
                            <button
                              type="button"
                              className="nx-btn nx-btn-taxes-compact"
                              disabled={!canSendDelivery || !row.invitation_id || busy.length > 0}
                              onClick={() =>
                                void runCommand('issue_docflow_invite_delivery', {
                                  invitation_id: row.invitation_id,
                                })
                              }
                              style={{ minWidth: 92 }}
                            >
                              שלח הזמנה
                            </button>
                            <button
                              type="button"
                              className="nx-btn nx-btn-taxes-compact"
                              disabled={(!canInvite && !canResend && !canRevoke) || busy.length > 0}
                              onClick={() => {
                                if (canInvite) return void runCommand('invite_client_to_docflow', { client_id: row.client_id, email: row.email ?? '' });
                                if (canResend) return void runCommand('resend_invite', { client_id: row.client_id });
                                if (canRevoke) return void runCommand('revoke_invite', { client_id: row.client_id });
                              }}
                              style={{ minWidth: 92 }}
                            >
                              {primaryLabel}
                            </button>
                            <button
                              type="button"
                              className="nx-btn nx-btn-taxes-compact"
                              style={{ minWidth: 34, width: 34, padding: 0, background: '#fff', color: '#6B7280', border: '1px solid #E5E7EB' }}
                              disabled={busy.length > 0}
                              title="אפשרויות נוספות"
                            >
                              ⋯
                            </button>
                          </div>
                        </td>
                      );
                    }
                    const value = (row as unknown as Record<string, unknown>)[col.key];
                    if (col.key === 'client_name') {
                      return (
                        <td key={col.key} style={{ ...cellAlign, borderBottom: '1px solid #F9FAFB', padding: '9px 10px', verticalAlign: 'middle' }}>
                          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
                            <span
                              aria-hidden="true"
                              style={{
                                width: 30,
                                height: 30,
                                borderRadius: 999,
                                ...avatarPalette(String(row.client_name ?? '')),
                                display: 'inline-flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 12,
                                fontWeight: 700,
                              }}
                            >
                              {initials(String(row.client_name ?? ''))}
                            </span>
                            <span>{String(row.client_name ?? '')}</span>
                          </div>
                        </td>
                      );
                    }
                    if (col.key === 'invite_status_label') {
                      return (
                        <td key={col.key} style={{ ...cellAlign, borderBottom: '1px solid #F9FAFB', padding: '9px 10px', verticalAlign: 'middle' }}>
                          <span
                            style={{
                              ...statusPillStyle(String(row.invite_status ?? 'not_invited')),
                              fontSize: 12,
                              fontWeight: 600,
                              padding: '4px 10px',
                              borderRadius: 8,
                              display: 'inline-flex',
                              lineHeight: 1.2,
                            }}
                          >
                            {String(value ?? '')}
                          </span>
                        </td>
                      );
                    }
                    return (
                      <td key={col.key} style={{ ...cellAlign, borderBottom: '1px solid #F9FAFB', padding: '9px 10px', verticalAlign: 'middle' }}>
                        {value === null || value === undefined || value === '' ? '-' : String(value)}
                        {col.key === 'delivery_status_label' && row.delivery_error ? (
                          <div style={{ fontSize: 11, marginTop: 4, color: '#B91C1C' }}>{row.delivery_error}</div>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 8,
          borderTop: '1px solid #F3F4F6',
          paddingTop: 10,
          gap: 10,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', fontSize: 12.5 }}>
          <select
            value={String(Number(pagination.page_size ?? 25))}
            onChange={(e) =>
              void load({
                page: 1,
                pageSize: Number(e.target.value) || 25,
                searchClient,
                inviteStatus,
              })
            }
            style={{ padding: '4px 8px', borderRadius: 6, border: '1px solid #E5E7EB', background: '#fff' }}
          >
            {[10, 25, 50].map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
          <span>שורות בעמוד</span>
          <span>
            עמוד {Number(pagination.page ?? 1)} מתוך {Number(pagination.total_pages ?? 1)}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={Number(pagination.page ?? 1) <= 1 || busy.length > 0}
            onClick={() =>
              void load({
                page: Number(pagination.page ?? 1) - 1,
                pageSize: Number(pagination.page_size ?? 25),
                searchClient,
                inviteStatus,
              })
            }
          >
            הקודם
          </button>
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={Number(pagination.page ?? 1) >= Number(pagination.total_pages ?? 1) || busy.length > 0}
            onClick={() =>
              void load({
                page: Number(pagination.page ?? 1) + 1,
                pageSize: Number(pagination.page_size ?? 25),
                searchClient,
                inviteStatus,
              })
            }
          >
            הבא
          </button>
        </div>
      </div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-start',
          gap: 8,
          flexWrap: 'wrap',
          borderTop: '1px solid #F3F4F6',
          paddingTop: 8,
          marginTop: -2,
        }}
      >
        {(['invited', 'joined', 'expired', 'revoked'] as const).map((s) => {
          const label = String(statusLabels[s] ?? '');
          if (!label) return null;
          return (
            <span
              key={s}
              style={{
                ...statusPillStyle(s),
                fontSize: 11.5,
                fontWeight: 600,
                padding: '4px 10px',
                borderRadius: 999,
                lineHeight: 1.2,
              }}
            >
              {label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
