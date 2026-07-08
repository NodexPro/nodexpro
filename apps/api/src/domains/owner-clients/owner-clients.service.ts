/**
 * Platform owner — Clients aggregates service.
 */

import type { RequestContext } from '../../shared/context.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { loadOwnerClientDetailData } from './owner-clients-detail.read.js';
import { loadOwnerClientsListData } from './owner-clients.read.js';
import type { OwnerClientFilters } from './owner-clients.pure.js';

export async function buildOwnerClientsListAggregate(
  ctx: RequestContext,
  filters?: Partial<OwnerClientFilters> | null,
) {
  assertPlatformOwner(ctx);
  return loadOwnerClientsListData(filters);
}

export async function buildOwnerClientDetailAggregate(ctx: RequestContext, organizationId: string) {
  assertPlatformOwner(ctx);
  return loadOwnerClientDetailData(organizationId);
}
