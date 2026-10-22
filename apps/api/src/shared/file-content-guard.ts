import { badRequest } from './errors.js';
import {
  guardUploadContent,
  OFFICE_DOCUMENT_UPLOAD_KINDS,
  IMAGE_UPLOAD_KINDS,
  type DetectedUploadKind,
} from './file-content-guard.pure.js';

export { OFFICE_DOCUMENT_UPLOAD_KINDS, IMAGE_UPLOAD_KINDS };

export function requireGuardedUpload(params: {
  buf: Buffer;
  fileName: string;
  claimedMime?: string | null;
  maxBytes: number;
  allowedKinds?: Array<Exclude<DetectedUploadKind, 'rejected'>>;
}): { fileName: string; mime: string } {
  const result = guardUploadContent({
    buf: params.buf,
    fileName: params.fileName,
    claimedMime: params.claimedMime,
    maxBytes: params.maxBytes,
    allowedKinds: params.allowedKinds ?? OFFICE_DOCUMENT_UPLOAD_KINDS,
  });
  if (!result.ok) throw badRequest(result.reason);
  return { fileName: result.fileName, mime: result.mime };
}
