/**
 * Work Engine -> client_tasks projection service (placeholder).
 *
 * Stage 2 scope: skeleton only.
 *
 * Per the approved migration plan (Option B, Phases 1-5 in
 * docs/work-engine-schema-design.md §10), Work Engine writes a projection into
 * the legacy `client_tasks` table starting at Phase 3, and the legacy
 * obligations -> tasks reconciler is removed at Phase 4.
 *
 * Stage 2 does NOT implement the projection. This file exists so the domain
 * layout is in place and any accidental caller fails loudly with a clear code
 * rather than silently no-op-ing or mutating legacy data.
 */

import { AppError } from '../../shared/errors.js';

export function projectWorkItemToClientTasks(_workItemId: string): never {
  throw new AppError(
    501,
    'Work Engine projection to client_tasks is not implemented in Stage 2',
    'WORK_ENGINE_PROJECTION_PENDING',
  );
}

export function projectAllOrgWorkItemsToClientTasks(_orgId: string): never {
  throw new AppError(
    501,
    'Work Engine bulk projection to client_tasks is not implemented in Stage 2',
    'WORK_ENGINE_PROJECTION_PENDING',
  );
}
