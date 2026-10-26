import test from 'node:test';
import assert from 'node:assert/strict';
import {
  displaySourceIp,
  isCloudflareIp,
  isVercelIp,
  originPullSecretMatches,
  resolveEdgeTrustedIp,
  resolvePublicClientIp,
  shouldRejectUnprotectedOrigin,
} from '../../src/shared/trusted-proxy.pure.js';
import { edgeProtectionAggregate } from '../../src/shared/edge-protection.pure.js';

test('Render private hops expose the public client and ignore spoofed leftmost XFF', () => {
  const render = resolvePublicClientIp({
    peerIp: '10.193.150.1',
    reqIp: '10.193.150.1',
    forwardedFor: '8.8.8.8, 1.2.3.4, 10.193.150.1',
    cfConnectingIp: '9.9.9.9',
    originPullVerified: false,
  });
  assert.equal(render.ip, '1.2.3.4');
  assert.equal(render.display, '1.2.3.4');
  assert.equal(
    resolvePublicClientIp({
      peerIp: '10.193.150.1',
      reqIp: '10.193.150.1',
      forwardedFor: null,
    }).display,
    'Unknown',
  );
  assert.equal(displaySourceIp('10.193.150.1'), 'Unknown');
  assert.equal(
    resolvePublicClientIp({
      peerIp: '8.8.8.8',
      reqIp: '8.8.8.8',
      forwardedFor: '1.1.1.1',
      cfConnectingIp: '9.9.9.9',
      originPullVerified: false,
    }).ip,
    '8.8.8.8',
  );
});

test('Vercel rewrite through Render private hop uses the visitor, not Frankfurt egress', () => {
  const israel = resolvePublicClientIp({
    peerIp: '10.193.150.1',
    reqIp: '10.193.150.1',
    forwardedFor: '79.176.10.20, 3.64.1.20',
    vercelForwardedFor: '79.176.10.20',
    vercelId: 'fra1::abc',
    realIp: '79.176.10.20',
  });
  assert.equal(israel.ip, '79.176.10.20');
  assert.equal(israel.display, '79.176.10.20');
  assert.equal(israel.source, 'vercel_forwarded_for');
  assert.equal(
    resolvePublicClientIp({
      peerIp: '10.193.150.1',
      reqIp: '10.193.150.1',
      forwardedFor: '79.176.10.20, 3.64.1.20',
      vercelId: 'fra1::abc',
    }).display,
    'Unknown',
  );
  assert.equal(
    resolvePublicClientIp({
      peerIp: '10.193.150.1',
      reqIp: '3.64.1.20',
      forwardedFor: '3.64.1.20',
    }).ip,
    '3.64.1.20',
  );
});

test('Vercel rewrite rotating egress still exposes the visitor and ignores spoofed XFF', () => {
  assert.equal(isVercelIp('76.76.21.21'), true);
  const first = resolvePublicClientIp({
    peerIp: '3.64.1.20',
    reqIp: '3.64.1.20',
    forwardedFor: '5.6.7.8, 3.64.1.20',
    vercelForwardedFor: '5.6.7.8',
    vercelId: 'fra1::abc',
    realIp: '5.6.7.8',
  });
  const second = resolvePublicClientIp({
    peerIp: '3.127.9.40',
    reqIp: '3.127.9.40',
    forwardedFor: '5.6.7.8, 3.127.9.40',
    vercelForwardedFor: '5.6.7.8',
    vercelId: 'fra1::def',
    realIp: '5.6.7.8',
  });
  assert.equal(first.ip, '5.6.7.8');
  assert.equal(second.ip, '5.6.7.8');
  assert.equal(first.source, 'vercel_forwarded_for');
  assert.equal(
    resolvePublicClientIp({
      peerIp: '8.8.8.8',
      reqIp: '8.8.8.8',
      forwardedFor: '1.1.1.1',
      vercelForwardedFor: '9.9.9.9',
      vercelId: null,
    }).ip,
    '8.8.8.8',
  );
});

test('never trusts CF-Connecting-IP without a verified proxy chain', () => {
  assert.equal(isCloudflareIp('104.16.1.1'), true);
  assert.equal(isCloudflareIp('8.8.8.8'), false);
  assert.equal(
    resolveEdgeTrustedIp({
      reqIp: '1.2.3.4',
      cfConnectingIp: '8.8.4.4',
      peerIp: '9.9.9.9',
      originPullVerified: false,
    }).source,
    'req_ip',
  );
  assert.equal(
    resolveEdgeTrustedIp({
      reqIp: '1.2.3.4',
      cfConnectingIp: '8.8.4.4',
      peerIp: '104.16.1.1',
      originPullVerified: false,
    }).ip,
    '8.8.4.4',
  );
  assert.equal(originPullSecretMatches('abc', 'abc'), true);
  assert.equal(originPullSecretMatches('abc', 'abd'), false);
});

test('origin protection and WAF status never self-claim live protection', () => {
  assert.equal(
    shouldRejectUnprotectedOrigin({
      enabled: true,
      path: '/api/v1/auth/login',
      originPullConfigured: true,
      originPullVerified: false,
    }),
    true,
  );
  assert.equal(
    shouldRejectUnprotectedOrigin({
      enabled: true,
      path: '/api/v1/health',
      originPullConfigured: true,
      originPullVerified: false,
    }),
    false,
  );
  const unverified = edgeProtectionAggregate({
    cloudflareOriginProtection: true,
    originPullConfigured: true,
    verifiedByOwner: false,
    coversWeb: true,
    coversApi: true,
  });
  assert.equal(unverified.waf_active, false);
  assert.equal(unverified.status, 'configured_unverified');
});
