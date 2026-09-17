export const AI_GATEWAY_CONTROL_PLANE_COMMANDS = [
  'create_ai_provider',
  'update_ai_provider_configuration',
  'set_ai_provider_credential',
  'remove_ai_provider_credential',
  'enable_ai_provider',
  'disable_ai_provider',
  'set_ai_provider_routing',
] as const;

export type AiGatewayControlPlaneCommandName = (typeof AI_GATEWAY_CONTROL_PLANE_COMMANDS)[number];

export function isAiGatewayControlPlaneCommand(
  command: string,
): command is AiGatewayControlPlaneCommandName {
  return (AI_GATEWAY_CONTROL_PLANE_COMMANDS as readonly string[]).includes(command);
}

export const AI_GATEWAY_MAX_ROUTING_LENGTH = 3;

export const AI_GATEWAY_PROVIDER_HEALTH_STATUSES = [
  'healthy',
  'degraded',
  'unavailable',
  'disabled',
  'incompatible',
  'not_configured',
] as const;

export type AiGatewayProviderHealthStatus = (typeof AI_GATEWAY_PROVIDER_HEALTH_STATUSES)[number];

export type AiGatewayControlPlaneProviderRow = {
  id: string;
  display_name: string;
  adapter_type: string;
  base_url: string | null;
  enabled: boolean;
  pinned_model: string | null;
  credential_configured: boolean;
  structured_output_certified: boolean;
  compatibility_status: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_failure_category: string | null;
  last_test_at: string | null;
  last_test_outcome: string | null;
  last_test_configuration_digest: string | null;
  credential_updated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AiGatewayRoutingRow = {
  position: number;
  provider_id: string;
};

export type OwnerAiGatewayProviderCard = {
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
  structured_output_certified: boolean;
  compatibility_status: string;
  health_status: AiGatewayProviderHealthStatus;
  health_reason: string;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_failure_category: string | null;
  last_test_at: string | null;
  last_test_outcome: string | null;
  eligible_for_routing: boolean;
};

export type OwnerAiGatewayAggregate = {
  aggregate_key: 'owner_ai_gateway_aggregate';
  overall_status: AiGatewayProviderHealthStatus;
  overall_reason: string;
  providers: OwnerAiGatewayProviderCard[];
  routing: Array<{ position: number; role: string; provider_id: string }>;
  available_adapter_types: Array<{
    adapter_type: string;
    label: string;
    supports_custom_base_url: boolean;
    requires_structured_output: boolean;
    requires_pinned_model: boolean;
    addable: true;
  }>;
  env_bootstrap: {
    configured: boolean;
    provider: string | null;
    model: string | null;
    api_key_configured: boolean;
    used_for_owner_routing: false;
  };
  allowed_actions: Array<{
    action_key: string;
    enabled: boolean;
    reason: string | null;
    payload: Record<string, string>;
  }>;
};

export type AiGatewayControlPlaneCommandResponse = {
  ok: true;
  command: AiGatewayControlPlaneCommandName;
  refreshed: OwnerAiGatewayAggregate;
};
