import { badRequest } from './errors.js';
import { scanUploadBuffer } from './document-malware-scan.service.js';
import { recordSecurityEvent, securitySubjectKey } from './security-event.service.js';
import {
  BUSINESS_DOCUMENT_UPLOAD_KINDS,
  DEFAULT_UPLOAD_MAX_BYTES,
  guardUploadContent,
  OFFICE_DOCUMENT_UPLOAD_KINDS,
  IMAGE_UPLOAD_KINDS,
  type DetectedUploadKind,
} from './file-content-guard.pure.js';

export { BUSINESS_DOCUMENT_UPLOAD_KINDS, DEFAULT_UPLOAD_MAX_BYTES, OFFICE_DOCUMENT_UPLOAD_KINDS, IMAGE_UPLOAD_KINDS };

export async function requireGuardedUpload(params: {
  buf: Buffer;
  fileName: string;
  claimedMime?: string | null;
  maxBytes?: number;
  allowedKinds?: Array<Exclude<DetectedUploadKind, 'rejected'>>;
  actorUserId?: string | null;
  organizationId?: string | null;
  sourceIp?: string | null;
}): Promise<{ fileName: string; mime: string; scanStatus: string }> {
  const result = guardUploadContent({
    buf: params.buf,
    fileName: params.fileName,
    claimedMime: params.claimedMime,
    maxBytes: params.maxBytes ?? DEFAULT_UPLOAD_MAX_BYTES,
    allowedKinds: params.allowedKinds ?? OFFICE_DOCUMENT_UPLOAD_KINDS,
  });
  if (!result.ok) {
    if (/macro|scripted|malware|archive|polyglot|executable|dangerous/i.test(result.reason)) {
      await recordSecurityEvent({
        action: 'security.upload_rejected_malicious',
        dedupeKey: securitySubjectKey(`upload:${params.actorUserId ?? params.sourceIp ?? 'anon'}`),
        actorUserId: params.actorUserId ?? null,
        organizationId: params.organizationId ?? null,
        sourceIp: params.sourceIp ?? null,
        payload: { code: 'UPLOAD_REJECTED' },
      });
    }
    throw badRequest(result.reason);
  }
  const scan = await scanUploadBuffer(params.buf);
  return { fileName: result.fileName, mime: result.mime, scanStatus: scan.status };
}
