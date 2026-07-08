/**
 * Platform owner — system health aggregate service.
 */
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import { buildOwnerSystemHealthAggregate as shapeOwnerSystemHealthAggregate } from './owner-system-health.pure.js';
import { loadOwnerSystemHealthData } from './owner-system-health.read.js';
export async function buildOwnerSystemHealthAggregate(ctx) {
    assertPlatformOwner(ctx);
    const lastCheckedAt = new Date().toISOString();
    const { platformHealthRows, customerHealthRows, legacyRows, sourceNotes } = await loadOwnerSystemHealthData(lastCheckedAt);
    return shapeOwnerSystemHealthAggregate({
        legacyRows,
        lastCheckedAt,
        sourceNotes,
        platformHealthRows,
        customerHealthRows,
    });
}
