import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { apiJson } from '../api/client';
import {
  moduleClientOperationsRegistry,
  moduleClientOperationsNoteTypes,
} from '../api/endpoints';
import {
  ClientOperationsRegistryView,
  type ClientOperationsRegistryRow,
  type ClientOperationsNoteTypeRow,
} from '../components/client-operations/ClientOperationsRegistryView';

export function ClientOperationsRegistry() {
  const auth = useAuth();
  const canEdit =
    auth.status === 'authenticated' && auth.me.permissions.includes('client_operations.edit');

  const [rows, setRows] = useState<ClientOperationsRegistryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [noteTypes, setNoteTypes] = useState<ClientOperationsNoteTypeRow[]>([]);

  const reloadRegistry = useCallback(() => {
    apiJson<{ rows: ClientOperationsRegistryRow[] }>(moduleClientOperationsRegistry())
      .then((data) => setRows(Array.isArray(data?.rows) ? data.rows : []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (auth.status !== 'authenticated') return;
    const ac = new AbortController();
    let cancelled = false;
    setLoading(true);
    setError('');

    const opts = { signal: ac.signal };

    Promise.all([
      apiJson<{ rows: ClientOperationsRegistryRow[] }>(moduleClientOperationsRegistry(), opts),
      apiJson<{ types: ClientOperationsNoteTypeRow[] }>(moduleClientOperationsNoteTypes(), opts),
    ])
      .then(([reg, nt]) => {
        if (!cancelled) {
          setRows(Array.isArray(reg?.rows) ? reg.rows : []);
          setNoteTypes(Array.isArray(nt?.types) ? nt.types : []);
        }
      })
      .catch((e) => {
        if (e instanceof Error && e.name === 'AbortError') return;
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [auth.status]);

  if (auth.status !== 'authenticated') return null;

  return (
    <ClientOperationsRegistryView
      rows={rows}
      onRowsChange={setRows}
      noteTypes={noteTypes}
      loading={loading}
      error={error}
      canEdit={canEdit}
      showPageHeader
      onReloadRegistry={reloadRegistry}
    />
  );
}
