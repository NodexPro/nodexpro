import { useMemo, useState } from 'react';
import type { UnknownRecord } from './owner-legal-control-types';

type CapabilityOption = { code: string; label: string; is_activation?: boolean };
type PendingRequest = {
  request_id: string;
  email: string;
  requested_country_codes: string[];
  note: string | null;
  status: string;
  requested_at: string;
};
type Assignment = {
  assignment_id: string;
  email: string;
  name: string | null;
  country_code: string;
  capabilities: string[];
  status: string;
  granted_by: string;
  granted_at: string;
  last_changed: string;
};
type Expert = {
  email: string;
  name: string | null;
  user_id: string | null;
  assignments: Assignment[];
};

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function parseAccessSlice(raw: unknown): {
  capability_catalog: CapabilityOption[];
  pending_requests: PendingRequest[];
  experts: Expert[];
} {
  const slice = raw && typeof raw === 'object' ? (raw as UnknownRecord) : {};
  const catalog = Array.isArray(slice.capability_catalog)
    ? (slice.capability_catalog as CapabilityOption[]).filter((row) => typeof row?.code === 'string')
    : [];
  const pending = Array.isArray(slice.pending_requests)
    ? (slice.pending_requests as PendingRequest[])
    : [];
  const experts = Array.isArray(slice.experts) ? (slice.experts as Expert[]) : [];
  return { capability_catalog: catalog, pending_requests: pending, experts };
}

const DEFAULT_GRANT_CAPS = ['legal_knowledge.view', 'legal_knowledge.draft_create', 'legal_knowledge.draft_edit'];

export function OwnerAccessExpertsPanel({
  access,
  countries,
  busy,
  onCommand,
}: {
  access: unknown;
  countries: Array<{ code: string; name: string }>;
  busy: boolean;
  onCommand: (command: string, payload: UnknownRecord) => Promise<unknown>;
}) {
  const parsed = useMemo(() => parseAccessSlice(access), [access]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteCountries, setInviteCountries] = useState<string[]>([]);
  const [inviteNote, setInviteNote] = useState('');
  const [grantEmail, setGrantEmail] = useState('');
  const [grantCountry, setGrantCountry] = useState('');
  const [grantCaps, setGrantCaps] = useState<string[]>(DEFAULT_GRANT_CAPS);
  const [approveRequestId, setApproveRequestId] = useState<string | null>(null);
  const [approveCountries, setApproveCountries] = useState<string[]>([]);
  const [approveCaps, setApproveCaps] = useState<string[]>(DEFAULT_GRANT_CAPS);
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);

  const selectedExpert = parsed.experts.find((row) => row.email === selectedEmail) ?? null;

  function toggle(list: string[], value: string): string[] {
    return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
  }

  function capabilityBoxes(
    selected: string[],
    onChange: (next: string[]) => void,
  ) {
    return parsed.capability_catalog.map((cap) => (
      <label key={cap.code} className="nx-bsai-access-check">
        <input
          type="checkbox"
          checked={selected.includes(cap.code)}
          disabled={busy || cap.code === 'legal_knowledge.view'}
          onChange={() => {
            if (cap.code === 'legal_knowledge.view') return;
            onChange(toggle(selected, cap.code));
          }}
        />
        {cap.label}
        {cap.is_activation ? ' (default off)' : ''}
      </label>
    ));
  }

  return (
    <section className="nx-bsai-access">
      <h2>Access & Experts</h2>
      <p className="nx-bsai-toolbar__subtitle">
        Platform Owner grants country-scoped legal maintainer access. Activate/Publish is never implied.
      </p>

      <div className="nx-bsai-access-grid">
        <div className="nx-bsai-access-card">
          <h3>Pending Requests</h3>
          {!parsed.pending_requests.length ? <p>No pending requests.</p> : null}
          {parsed.pending_requests.map((request) => (
            <div key={request.request_id} className="nx-bsai-access-row">
              <div>
                <strong>{request.email}</strong>
                <div>{request.requested_country_codes.join(', ')}</div>
                <div>{request.requested_at}</div>
                {request.note ? <div>{request.note}</div> : null}
                <div>Status: {request.status}</div>
              </div>
              <div className="nx-bsai-access-actions">
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy}
                  onClick={() => {
                    setApproveRequestId(request.request_id);
                    setApproveCountries(request.requested_country_codes);
                    setApproveCaps(DEFAULT_GRANT_CAPS);
                  }}
                >
                  Approve
                </button>
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy}
                  onClick={() => void onCommand('reject_country_legal_access_request', { request_id: request.request_id })}
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="nx-bsai-access-card">
          <h3>Invite</h3>
          <label className="nx-bsai-field">
            Email
            <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} disabled={busy} />
          </label>
          <div className="nx-bsai-access-checks">
            {countries.map((country) => (
              <label key={country.code} className="nx-bsai-access-check">
                <input
                  type="checkbox"
                  checked={inviteCountries.includes(country.code)}
                  disabled={busy}
                  onChange={() => setInviteCountries(toggle(inviteCountries, country.code))}
                />
                {country.code} — {country.name}
              </label>
            ))}
          </div>
          <label className="nx-bsai-field">
            Note
            <input value={inviteNote} onChange={(e) => setInviteNote(e.target.value)} disabled={busy} />
          </label>
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={busy}
            onClick={() =>
              void onCommand('invite_country_legal_maintainer', {
                email: inviteEmail,
                requested_country_codes: inviteCountries,
                note: inviteNote,
              })
            }
          >
            Send invite
          </button>
        </div>

        <div className="nx-bsai-access-card">
          <h3>Grant assignment</h3>
          <label className="nx-bsai-field">
            Email
            <input value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)} disabled={busy} />
          </label>
          <label className="nx-bsai-field">
            Country
            <select value={grantCountry} disabled={busy} onChange={(e) => setGrantCountry(e.target.value)}>
              <option value="">Select country</option>
              {countries.map((country) => (
                <option key={country.code} value={country.code}>
                  {country.code} — {country.name}
                </option>
              ))}
            </select>
          </label>
          <div className="nx-bsai-access-checks">{capabilityBoxes(grantCaps, setGrantCaps)}</div>
          <button
            type="button"
            className="nx-btn nx-btn-taxes-compact"
            disabled={busy}
            onClick={() =>
              void onCommand('grant_country_legal_assignment', {
                email: grantEmail,
                country_code: grantCountry,
                capabilities: grantCaps.includes('legal_knowledge.view')
                  ? grantCaps
                  : ['legal_knowledge.view', ...grantCaps],
              })
            }
          >
            Grant
          </button>
        </div>
      </div>

      {approveRequestId ? (
        <div className="nx-bsai-access-card">
          <h3>Approve request</h3>
          <div className="nx-bsai-access-checks">
            {countries.map((country) => (
              <label key={country.code} className="nx-bsai-access-check">
                <input
                  type="checkbox"
                  checked={approveCountries.includes(country.code)}
                  disabled={busy}
                  onChange={() => setApproveCountries(toggle(approveCountries, country.code))}
                />
                {country.code} — {country.name}
              </label>
            ))}
          </div>
          <div className="nx-bsai-access-checks">{capabilityBoxes(approveCaps, setApproveCaps)}</div>
          <div className="nx-bsai-access-actions">
            <button
              type="button"
              className="nx-btn nx-btn-taxes-compact"
              disabled={busy}
              onClick={() =>
                void onCommand('approve_country_legal_access_request', {
                  request_id: approveRequestId,
                  country_codes: approveCountries,
                  capabilities: approveCaps.includes('legal_knowledge.view')
                    ? approveCaps
                    : ['legal_knowledge.view', ...approveCaps],
                }).then(() => setApproveRequestId(null))
              }
            >
              Confirm approve
            </button>
            <button type="button" className="nx-btn nx-btn-taxes-compact" disabled={busy} onClick={() => setApproveRequestId(null)}>
              Close
            </button>
          </div>
        </div>
      ) : null}

      <div className="nx-bsai-access-card">
        <h3>Country Experts</h3>
        {!parsed.experts.length ? <p>No country experts yet.</p> : null}
        {parsed.experts.map((expert) => (
          <button
            key={expert.email}
            type="button"
            className={`nx-bsai-access-row nx-bsai-access-row--button${selectedEmail === expert.email ? ' is-active' : ''}`}
            onClick={() => setSelectedEmail(expert.email)}
          >
            <strong>{expert.name || expert.email}</strong>
            <div>{expert.assignments.map((row) => `${row.country_code} (${row.status})`).join(' · ')}</div>
          </button>
        ))}
      </div>

      {selectedExpert ? (
        <div className="nx-bsai-access-card">
          <h3>Expert detail</h3>
          <p>{selectedExpert.name || '—'} · {selectedExpert.email}</p>
          {selectedExpert.assignments.map((row) => (
            <div key={row.assignment_id} className="nx-bsai-access-row">
              <div>
                <strong>{row.country_code}</strong>
                <div>Status: {row.status}</div>
                <div>Capabilities: {row.capabilities.join(', ')}</div>
                <div>Granted by: {row.granted_by}</div>
                <div>Granted at: {row.granted_at}</div>
                <div>Last changed: {row.last_changed}</div>
              </div>
              <div className="nx-bsai-access-actions">
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy || row.status === 'revoked'}
                  onClick={() => {
                    const next = window.prompt(
                      'Comma-separated capabilities',
                      row.capabilities.join(','),
                    );
                    if (!next) return;
                    void onCommand('update_country_legal_assignment_permissions', {
                      assignment_id: row.assignment_id,
                      capabilities: next.split(',').map((item) => item.trim()).filter(Boolean),
                    });
                  }}
                >
                  Edit permissions
                </button>
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy || row.status !== 'active'}
                  onClick={() => void onCommand('suspend_country_legal_assignment', { assignment_id: row.assignment_id })}
                >
                  Suspend
                </button>
                <button
                  type="button"
                  className="nx-btn nx-btn-taxes-compact"
                  disabled={busy || row.status === 'revoked'}
                  onClick={() => void onCommand('revoke_country_legal_assignment', { assignment_id: row.assignment_id })}
                >
                  Revoke
                </button>
              </div>
            </div>
          ))}
          <label className="nx-bsai-field">
            Add country
            <select
              disabled={busy}
              defaultValue=""
              onChange={(e) => {
                const country = e.target.value;
                e.target.value = '';
                if (!country) return;
                void onCommand('grant_country_legal_assignment', {
                  email: selectedExpert.email,
                  country_code: country,
                  capabilities: DEFAULT_GRANT_CAPS,
                });
              }}
            >
              <option value="">Select country</option>
              {countries
                .filter((country) => !selectedExpert.assignments.some((row) => row.country_code === country.code && row.status !== 'revoked'))
                .map((country) => (
                  <option key={country.code} value={country.code}>
                    {country.code} — {country.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
      ) : null}
    </section>
  );
}

export function OwnerLegalAccessRequestForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (payload: UnknownRecord) => Promise<unknown>;
}) {
  const [countries, setCountries] = useState('IL');
  const [note, setNote] = useState('');
  return (
    <form
      className="nx-bsai-access-card"
      onSubmit={(e) => {
        e.preventDefault();
        void onSubmit({
          requested_country_codes: countries
            .split(',')
            .map((item) => item.trim().toUpperCase())
            .filter(Boolean),
          note,
        });
      }}
    >
      <h3>Request country legal access</h3>
      <p>No access is granted until Platform Owner approval.</p>
      <label className="nx-bsai-field">
        Country codes
        <input value={countries} onChange={(e) => setCountries(e.target.value)} disabled={busy} />
      </label>
      <label className="nx-bsai-field">
        Note
        <input value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} />
      </label>
      <button type="submit" className="nx-btn nx-btn-taxes-compact" disabled={busy}>
        Submit request
      </button>
    </form>
  );
}

export { asText };
