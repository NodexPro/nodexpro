export const AI_GATEWAY_CIRCUIT_FAILURE_THRESHOLD = 3;
export const AI_GATEWAY_CIRCUIT_COOLDOWN_MS = 60_000;

export type AiGatewayCircuitStateName = 'closed' | 'open' | 'half_open';

export type AiGatewayCircuitDecision = 'allow' | 'skip' | 'probe';

type CircuitRecord = {
  state: AiGatewayCircuitStateName;
  consecutive_failures: number;
  opened_at_ms: number | null;
  half_open_probe_in_flight: boolean;
};

export type AiGatewayCircuitSnapshot = {
  state: AiGatewayCircuitStateName;
  consecutive_failures: number;
  process_local: true;
};

export function createAiGatewayCircuitBreaker() {
  const circuits = new Map<string, CircuitRecord>();

  function record(id: string): CircuitRecord {
    const existing = circuits.get(id);
    if (existing) return existing;
    const created: CircuitRecord = {
      state: 'closed',
      consecutive_failures: 0,
      opened_at_ms: null,
      half_open_probe_in_flight: false,
    };
    circuits.set(id, created);
    return created;
  }

  function decide(providerId: string, nowMs: number): AiGatewayCircuitDecision {
    const current = circuits.get(providerId);
    if (!current || current.state === 'closed') return 'allow';
    if (current.state === 'half_open') {
      return current.half_open_probe_in_flight ? 'skip' : 'probe';
    }
    if (current.opened_at_ms != null && nowMs - current.opened_at_ms >= AI_GATEWAY_CIRCUIT_COOLDOWN_MS) {
      return current.half_open_probe_in_flight ? 'skip' : 'probe';
    }
    return 'skip';
  }

  function tryAcquireHalfOpenProbe(providerId: string, nowMs: number): boolean {
    const current = record(providerId);
    if (decide(providerId, nowMs) !== 'probe') return false;
    if (current.half_open_probe_in_flight) return false;
    current.state = 'half_open';
    current.half_open_probe_in_flight = true;
    return true;
  }

  function recordSuccess(providerId: string): void {
    circuits.set(providerId, {
      state: 'closed',
      consecutive_failures: 0,
      opened_at_ms: null,
      half_open_probe_in_flight: false,
    });
  }

  function recordFailure(providerId: string, nowMs: number): void {
    const current = record(providerId);
    current.half_open_probe_in_flight = false;
    current.consecutive_failures += 1;
    if (current.state === 'half_open' || current.consecutive_failures >= AI_GATEWAY_CIRCUIT_FAILURE_THRESHOLD) {
      current.state = 'open';
      current.opened_at_ms = nowMs;
    }
  }

  function snapshot(providerId: string): AiGatewayCircuitSnapshot | null {
    const current = circuits.get(providerId);
    if (!current) return null;
    return {
      state: current.state,
      consecutive_failures: current.consecutive_failures,
      process_local: true,
    };
  }

  function resetForTests(): void {
    circuits.clear();
  }

  return {
    decide,
    tryAcquireHalfOpenProbe,
    recordSuccess,
    recordFailure,
    snapshot,
    resetForTests,
  };
}

export type AiGatewayCircuitBreaker = ReturnType<typeof createAiGatewayCircuitBreaker>;

export const processAiGatewayCircuitBreaker = createAiGatewayCircuitBreaker();
