export type OwnerAiGatewayAction = {
  action_key: string;
  enabled: boolean;
  reason: string | null;
  payload: Record<string, string>;
};

export type OwnerAiGatewayAdapter = {
  adapter_type: string;
  label: string;
  supports_custom_base_url: boolean;
  requires_structured_output: boolean;
  requires_pinned_model: boolean;
};

export type OwnerAiGatewayProviderView = {
  id: string;
  display_name: string;
  adapter_type: string;
  adapter_label: string;
  role: string;
  routing_position: number | null;
  base_url_display: string | null;
  enabled: boolean;
  pinned_model: string | null;
  credential_configured: boolean;
  credential_updated_at: string | null;
  health_status: string;
  health_reason: string;
  connection_test_summary: string;
  last_test_outcome: string | null;
  can_enable: boolean;
  eligible_for_routing: boolean;
};

export type OwnerAiGatewayView = {
  aggregate_key: 'owner_ai_gateway_aggregate';
  overall_status: string;
  overall_reason: string;
  providers: OwnerAiGatewayProviderView[];
  routing: Array<{ position: number; role: string; provider_id: string }>;
  available_adapter_types: OwnerAiGatewayAdapter[];
  allowed_actions: OwnerAiGatewayAction[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function parseOwnerAiGatewayAggregate(raw: unknown): OwnerAiGatewayView | null {
  const rec = asRecord(raw);
  if (!rec || rec.aggregate_key !== 'owner_ai_gateway_aggregate') return null;
  const adapters = Array.isArray(rec.available_adapter_types)
    ? rec.available_adapter_types.flatMap((row) => {
        const item = asRecord(row);
        if (!item || typeof item.adapter_type !== 'string') return [];
        return [
          {
            adapter_type: item.adapter_type,
            label: asText(item.label) || 'Adapter required',
            supports_custom_base_url: item.supports_custom_base_url === true,
            requires_structured_output: item.requires_structured_output === true,
            requires_pinned_model: item.requires_pinned_model === true,
          },
        ];
      })
    : [];
  const providers = Array.isArray(rec.providers)
    ? rec.providers.flatMap((row) => {
        const item = asRecord(row);
        if (!item || typeof item.id !== 'string') return [];
        return [
          {
            id: item.id,
            display_name: asText(item.display_name) || 'Unnamed provider',
            adapter_type: asText(item.adapter_type),
            adapter_label: asText(item.adapter_label) || 'Adapter required',
            role: asText(item.role) || 'Not routed',
            routing_position: typeof item.routing_position === 'number' ? item.routing_position : null,
            base_url_display: typeof item.base_url_display === 'string' ? item.base_url_display : null,
            enabled: item.enabled === true,
            pinned_model: typeof item.pinned_model === 'string' ? item.pinned_model : null,
            credential_configured: item.credential_configured === true,
            credential_updated_at: typeof item.credential_updated_at === 'string' ? item.credential_updated_at : null,
            health_status: asText(item.health_status) || 'not_configured',
            health_reason: asText(item.health_reason),
            connection_test_summary: asText(item.connection_test_summary) || 'Not tested yet.',
            last_test_outcome: typeof item.last_test_outcome === 'string' ? item.last_test_outcome : null,
            can_enable: item.can_enable === true,
            eligible_for_routing: item.eligible_for_routing === true,
          },
        ];
      })
    : [];
  const routing = Array.isArray(rec.routing)
    ? rec.routing.flatMap((row) => {
        const item = asRecord(row);
        if (!item || typeof item.provider_id !== 'string') return [];
        return [
          {
            position: typeof item.position === 'number' ? item.position : 0,
            role: asText(item.role),
            provider_id: item.provider_id,
          },
        ];
      })
    : [];
  const allowed_actions = Array.isArray(rec.allowed_actions)
    ? rec.allowed_actions.flatMap((row) => {
        const item = asRecord(row);
        if (!item || typeof item.action_key !== 'string') return [];
        const payload =
          item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload)
            ? Object.fromEntries(
                Object.entries(item.payload as Record<string, unknown>).filter(
                  (entry): entry is [string, string] => typeof entry[1] === 'string',
                ),
              )
            : {};
        return [
          {
            action_key: item.action_key,
            enabled: item.enabled === true,
            reason: typeof item.reason === 'string' ? item.reason : null,
            payload,
          },
        ];
      })
    : [];
  return {
    aggregate_key: 'owner_ai_gateway_aggregate',
    overall_status: asText(rec.overall_status) || 'not_configured',
    overall_reason: asText(rec.overall_reason),
    providers,
    routing,
    available_adapter_types: adapters,
    allowed_actions,
  };
}

export function ownerAiGatewayAction(
  aggregate: OwnerAiGatewayView | null,
  actionKey: string,
): OwnerAiGatewayAction | null {
  if (!aggregate) return null;
  return aggregate.allowed_actions.find((row) => row.action_key === actionKey) ?? null;
}

export function ownerAiGatewayStatusPresentation(status: string): {
  emoji: string;
  label: string;
  tone: 'ok' | 'warn' | 'bad';
} {
  if (status === 'healthy') return { emoji: '🟢', label: 'Operational', tone: 'ok' };
  if (status === 'degraded') return { emoji: '🟡', label: 'Degraded', tone: 'warn' };
  if (status === 'not_configured') return { emoji: '🔴', label: 'Not configured', tone: 'bad' };
  return { emoji: '🔴', label: 'Unavailable', tone: 'bad' };
}

export function ownerAiGatewayTestPresentation(summary: string, outcome: string | null): {
  emoji: string;
  text: string;
} {
  if (outcome === 'passed') return { emoji: '🟢', text: summary };
  if (outcome === 'failed') return { emoji: '🔴', text: summary };
  return { emoji: '', text: summary };
}

export function ownerAiGatewayRoutingLabel(index: number): string {
  if (index === 0) return 'Primary';
  return `Fallback ${index}`;
}

export function parseOwnerAiGatewayCommandRefreshed(refreshed: unknown): OwnerAiGatewayView | null {
  const direct = parseOwnerAiGatewayAggregate(refreshed);
  if (direct) return direct;
  const rec = asRecord(refreshed);
  return parseOwnerAiGatewayAggregate(rec?.aggregate);
}
