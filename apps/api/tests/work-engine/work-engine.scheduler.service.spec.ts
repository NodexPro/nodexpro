import test from 'node:test';
import assert from 'node:assert/strict';
import { PENDING_MAPPING_PROCESSING_OUTCOMES } from '../../src/domains/work-engine/work-engine.event-mapping.service.js';
import { shouldAutoEscalateForSla } from '../../src/domains/work-engine/work-engine.escalation.logic.js';

test('PENDING_MAPPING_PROCESSING_OUTCOMES includes legacy umbrella string', () => {
  assert.ok(PENDING_MAPPING_PROCESSING_OUTCOMES.includes('accepted_pending_mapping'));
  assert.ok(PENDING_MAPPING_PROCESSING_OUTCOMES.includes('unknown_event_mapping'));
});

test('scheduler escalation hook predicate stays SLA-only for MVP', () => {
  assert.equal(
    shouldAutoEscalateForSla({
      work_state: 'assigned',
      sla_status: 'breached',
      has_breached_obligation: false,
    }),
    true,
  );
  assert.equal(
    shouldAutoEscalateForSla({
      work_state: 'waiting_client',
      sla_status: 'on_track',
      has_breached_obligation: false,
    }),
    false,
  );
});
