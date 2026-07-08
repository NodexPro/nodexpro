/**
 * Platform owner — Clients aggregates service.
 */
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { loadOwnerClientDetailData } from './owner-clients-detail.read.js';
import { loadOwnerClientsListData } from './owner-clients.read.js';
export async function buildOwnerClientsListAggregate(ctx, filters) {
    assertPlatformOwner(ctx);
    return loadOwnerClientsListData(filters);
}
export async function buildOwnerClientDetailAggregate(ctx, organizationId) {
    assertPlatformOwner(ctx);
    return loadOwnerClientDetailData(organizationId);
}
