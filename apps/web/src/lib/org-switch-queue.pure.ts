/**
 * One-tab office switch sequencer.
 * Named command remains select_active_organization; this only orders user clicks
 * and refuses to paint an aggregate that is no longer the latest requested office.
 */

export type OfficeSwitchQueue = {
  latestRequestedId: string | null;
  inFlightId: string | null;
  appliedId: string | null;
  commandsSent: string[];
};

export function createOfficeSwitchQueue(): OfficeSwitchQueue {
  return {
    latestRequestedId: null,
    inFlightId: null,
    appliedId: null,
    commandsSent: [],
  };
}

export function enqueueOfficeSwitch(queue: OfficeSwitchQueue, organizationId: string | null | undefined): OfficeSwitchQueue {
  const org = String(organizationId ?? '').trim();
  if (!org) return queue;
  return { ...queue, latestRequestedId: org };
}

export function nextOfficeSwitchCommand(queue: OfficeSwitchQueue): {
  queue: OfficeSwitchQueue;
  send: string | null;
} {
  const target = String(queue.latestRequestedId ?? '').trim();
  if (!target || queue.inFlightId) return { queue, send: null };
  return {
    queue: {
      ...queue,
      inFlightId: target,
      commandsSent: [...queue.commandsSent, target],
    },
    send: target,
  };
}

export function shouldApplyOfficeSwitchAggregate(input: {
  commandOrganizationId: string | null | undefined;
  aggregateOrganizationId: string | null | undefined;
  latestRequestedId: string | null | undefined;
}): boolean {
  const command = String(input.commandOrganizationId ?? '').trim();
  const aggregate = String(input.aggregateOrganizationId ?? '').trim();
  const latest = String(input.latestRequestedId ?? '').trim();
  return Boolean(command && aggregate && command === aggregate && command === latest);
}

export function resolveOfficeSwitchCommand(
  queue: OfficeSwitchQueue,
  input: {
    commandOrganizationId: string | null | undefined;
    aggregateOrganizationId: string | null | undefined;
  },
): {
  queue: OfficeSwitchQueue;
  apply: boolean;
  followLatest: boolean;
} {
  const command = String(input.commandOrganizationId ?? '').trim();
  if (!command || queue.inFlightId !== command) {
    return { queue, apply: false, followLatest: false };
  }
  const apply = shouldApplyOfficeSwitchAggregate({
    commandOrganizationId: command,
    aggregateOrganizationId: input.aggregateOrganizationId,
    latestRequestedId: queue.latestRequestedId,
  });
  if (apply) {
    const aggregate = String(input.aggregateOrganizationId ?? '').trim();
    return {
      queue: {
        ...queue,
        inFlightId: null,
        appliedId: aggregate,
        latestRequestedId: queue.latestRequestedId === aggregate ? null : queue.latestRequestedId,
      },
      apply: true,
      followLatest: false,
    };
  }
  return {
    queue: { ...queue, inFlightId: null },
    apply: false,
    followLatest: Boolean(queue.latestRequestedId && queue.latestRequestedId !== command),
  };
}

export function simulateRapidOfficeSwitches(clicks: readonly string[]): {
  commandsSent: string[];
  appliedIds: string[];
  discardedCommandIds: string[];
  finalAppliedId: string | null;
  finalLatestRequestedId: string | null;
} {
  let queue = createOfficeSwitchQueue();
  const appliedIds: string[] = [];
  const discardedCommandIds: string[] = [];
  const sequence = clicks.map((id) => String(id ?? '').trim()).filter(Boolean);
  if (sequence[0]) {
    queue = enqueueOfficeSwitch(queue, sequence[0]);
    const first = nextOfficeSwitchCommand(queue);
    queue = first.queue;
  }
  for (const org of sequence.slice(1)) {
    queue = enqueueOfficeSwitch(queue, org);
  }
  while (queue.inFlightId || queue.latestRequestedId) {
    if (queue.inFlightId) {
      const commandId = queue.inFlightId;
      const resolved = resolveOfficeSwitchCommand(queue, {
        commandOrganizationId: commandId,
        aggregateOrganizationId: commandId,
      });
      queue = resolved.queue;
      if (resolved.apply && queue.appliedId) appliedIds.push(queue.appliedId);
      else discardedCommandIds.push(commandId);
    }
    if (!queue.inFlightId && queue.latestRequestedId) {
      const next = nextOfficeSwitchCommand(queue);
      queue = next.queue;
      if (!next.send) break;
      continue;
    }
    if (!queue.inFlightId) break;
  }
  return {
    commandsSent: queue.commandsSent,
    appliedIds,
    discardedCommandIds,
    finalAppliedId: queue.appliedId,
    finalLatestRequestedId: queue.latestRequestedId,
  };
}
