export type EdgeProtectionStatus = 'not_configured' | 'configured_unverified' | 'verified';

export function edgeProtectionStatus(input: {
  cloudflareOriginProtection: boolean;
  originPullConfigured: boolean;
  verifiedByOwner: boolean;
}): EdgeProtectionStatus {
  if (input.verifiedByOwner && input.cloudflareOriginProtection && input.originPullConfigured) {
    return 'verified';
  }
  if (input.cloudflareOriginProtection || input.originPullConfigured) return 'configured_unverified';
  return 'not_configured';
}

/** WAF is never reported active from code flags alone. Owner verification is mandatory. */
export function edgeProtectionAggregate(input: {
  cloudflareOriginProtection: boolean;
  originPullConfigured: boolean;
  verifiedByOwner: boolean;
  coversWeb: boolean;
  coversApi: boolean;
}) {
  const status = edgeProtectionStatus(input);
  return {
    status,
    waf_active: status === 'verified',
    covers_web: input.coversWeb && status === 'verified',
    covers_api: input.coversApi && status === 'verified',
    origin_bypass_protected: input.originPullConfigured && status === 'verified',
  };
}
