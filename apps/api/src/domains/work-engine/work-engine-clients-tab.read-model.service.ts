/**
 * Work Engine Clients tab — embeds Client Operations registry (first screen).
 *
 * Reuses existing Client Operations read models; no duplicate client truth.
 */

import type { RequestContext } from '../../shared/context.js';
import { forbidden } from '../../shared/errors.js';
import {
  listClientOperationsRegistry,
  type ClientOperationsRegistryRow,
} from '../client-operations/client-operations.service.js';
import { listOperationalNoteTypes } from '../client-operations/client-operations-notes.service.js';
import { buildAccountantWorkspaceTabs } from './work-engine.read-models.service.js';

export type WorkEngineClientsTabAggregate = {
  aggregate_key: 'work_engine_clients_tab_aggregate';
  org_id: string;
  workspace_tabs: ReturnType<typeof buildAccountantWorkspaceTabs>;
  title: string;
  description: string;
  source_module: 'client_operations';
  embedded_view: 'client_operations_first_screen';
  client_operations_aggregate: {
    rows: ClientOperationsRegistryRow[];
    note_types: Array<{
      code: string;
      label_he: string;
      sort_order: number;
      allows_reminder: boolean;
    }>;
  };
  allowed_actions: string[];
};

function buildAllowedActions(permissions: string[]): string[] {
  const actions: string[] = [];
  if (permissions.includes('client_operations.view')) {
    actions.push('view_client_operations_registry');
  }
  if (permissions.includes('client_operations.edit')) {
    actions.push('client_operations.edit');
  }
  return actions;
}

export async function buildWorkEngineClientsTabAggregate(params: {
  ctx: RequestContext;
}): Promise<WorkEngineClientsTabAggregate> {
  const orgId = params.ctx.organizationId;
  if (!orgId) throw forbidden('Organization context required');

  const permissions = params.ctx.membership?.permissions ?? [];
  if (!permissions.includes('client_operations.view')) {
    throw forbidden('client_operations.view permission required');
  }

  const [registry, noteTypes] = await Promise.all([
    listClientOperationsRegistry(params.ctx),
    listOperationalNoteTypes(),
  ]);

  return {
    aggregate_key: 'work_engine_clients_tab_aggregate',
    org_id: orgId,
    workspace_tabs: buildAccountantWorkspaceTabs('clients'),
    title: 'Nodex לקוחות',
    description: 'Client registry (module v1 skeleton)',
    source_module: 'client_operations',
    embedded_view: 'client_operations_first_screen',
    client_operations_aggregate: {
      rows: registry.rows,
      note_types: noteTypes.types,
    },
    allowed_actions: buildAllowedActions(permissions),
  };
}
