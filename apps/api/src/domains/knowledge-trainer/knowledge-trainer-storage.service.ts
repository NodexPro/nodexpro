import { randomUUID } from 'node:crypto';
import { supabaseAdmin } from '../../db/client.js';
import { badRequest } from '../../shared/errors.js';
import {
  buildRandomizedStorageKey,
  sanitizeOriginalFilename,
  sha256Hex,
} from './knowledge-trainer.pure.js';
import {
  OWNER_LEGAL_MATERIALS_BUCKET,
  OWNER_LEGAL_MATERIALS_MAX_BYTES,
} from './knowledge-trainer.types.js';

export function decodeLegalTrainingUpload(fileBase64: unknown, filename: unknown): {
  bytes: Buffer;
  original_filename: string;
  content_sha256: string;
} {
  if (typeof fileBase64 !== 'string' || !fileBase64.trim()) {
    throw badRequest('file_base64 is required');
  }
  const maxB64 = Math.ceil(OWNER_LEGAL_MATERIALS_MAX_BYTES / 3) * 4 + 32;
  if (fileBase64.length > maxB64) {
    throw badRequest('File too large', 'FILE_TOO_LARGE');
  }
  const bytes = Buffer.from(fileBase64, 'base64');
  if (!bytes.length) throw badRequest('file_base64 is required');
  if (bytes.length > OWNER_LEGAL_MATERIALS_MAX_BYTES) {
    throw badRequest('File too large', 'FILE_TOO_LARGE');
  }
  return {
    bytes,
    original_filename: sanitizeOriginalFilename(filename),
    content_sha256: sha256Hex(bytes),
  };
}

export async function storeOwnerLegalMaterial(params: {
  countryCode: string;
  taxSourceId: string;
  bytes: Buffer;
  mimeType: string;
}): Promise<{ bucket: string; key: string }> {
  const key = buildRandomizedStorageKey(params.countryCode, params.taxSourceId, randomUUID());
  const { error } = await supabaseAdmin.storage.from(OWNER_LEGAL_MATERIALS_BUCKET).upload(key, params.bytes, {
    contentType: params.mimeType,
    upsert: false,
  });
  if (error) throw new Error('Failed to store legal training material');
  return { bucket: OWNER_LEGAL_MATERIALS_BUCKET, key };
}

export async function downloadOwnerLegalMaterial(bucket: string, key: string): Promise<Buffer> {
  if (bucket !== OWNER_LEGAL_MATERIALS_BUCKET) {
    throw new Error('Unexpected legal material bucket');
  }
  const { data, error } = await supabaseAdmin.storage.from(bucket).download(key);
  if (error || !data) throw new Error('Failed to download legal training material');
  const bytes = Buffer.from(await data.arrayBuffer());
  return bytes;
}

export async function createOwnerLegalMaterialSignedUrl(
  bucket: string,
  key: string,
  expiresSec = 120,
): Promise<string> {
  if (bucket !== OWNER_LEGAL_MATERIALS_BUCKET) {
    throw new Error('Unexpected legal material bucket');
  }
  const { data, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(key, expiresSec);
  if (error || !data?.signedUrl) throw new Error('Failed to open legal training material');
  return data.signedUrl;
}
