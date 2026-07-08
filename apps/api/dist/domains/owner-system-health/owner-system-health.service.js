/**
 * Platform owner — system health aggregate service.
 */
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { buildOwnerSystemHealthAggregate as shapeOwnerSystemHealthAggregate } from './owner-system-health.pure.js';
import { loadOwnerSystemHealthRows } from './owner-system-health.read.js';
export async function buildOwnerSystemHealthAggregate(ctx) {
    assertPlatformOwner(ctx);
    const lastCheckedAt = new Date().toISOString();
    const { rows, sourceNotes } = await loadOwnerSystemHealthRows();
    return shapeOwnerSystemHealthAggregate({ rows, lastCheckedAt, sourceNotes });
}
