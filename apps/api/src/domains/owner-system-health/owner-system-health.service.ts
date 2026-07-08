/**
 * Platform owner — system health aggregate service.
 */

import type { RequestContext } from '../../shared/context.js';
import { assertPlatformOwner } from '../../shared/platform-owner.js';
import {
  buildOwnerSystemHealthAggregate as shapeOwnerSystemHealthAggregate,
  type CustomerHealthFilters,
} from './owner-system-health.pure.js';
import { loadOwnerSystemHealthData } from './owner-system-health.read.js';

export async function buildOwnerSystemHealthAggregate(
  ctx: RequestContext,
  customerFilters?: Partial<CustomerHealthFilters> | null,
) {
  assertPlatformOwner(ctx);
  const lastCheckedAt = new Date().toISOString();
  const { platformHealthRows, customerHealthRows, legacyRows, sourceNotes } =
    await loadOwnerSystemHealthData(lastCheckedAt);
  return shapeOwnerSystemHealthAggregate({
    legacyRows,
    lastCheckedAt,
    sourceNotes,
    platformHealthRows,
    customerHealthRows,
    customerFilters,
  });
}
