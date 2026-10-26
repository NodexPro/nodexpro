import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectUploadKind,
  guardUploadContent,
  hasDangerousDoubleExtension,
  OFFICE_DOCUMENT_UPLOAD_KINDS,
  IMAGE_UPLOAD_KINDS,
  BUSINESS_DOCUMENT_UPLOAD_KINDS,
} from '../../src/shared/file-content-guard.pure.js';

const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('1 0 obj')]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const gif = Buffer.from('GIF89a........');
const html = Buffer.from('<!DOCTYPE html><script>alert(1)</script>');
const text = Buffer.from('plain client note\n');
const oversized = Buffer.alloc(11 * 1024 * 1024, 0x20);

test('detects real signatures and rejects html disguised as text', () => {
  assert.equal(detectUploadKind(pdf), 'pdf');
  assert.equal(detectUploadKind(png), 'png');
  assert.equal(detectUploadKind(jpeg), 'jpeg');
  assert.equal(detectUploadKind(gif), 'gif');
  assert.equal(detectUploadKind(html), 'rejected');
  assert.equal(detectUploadKind(text), 'text');
});

test('accepts valid office document bytes with matching extension', () => {
  const ok = guardUploadContent({
    buf: pdf,
    fileName: 'invoice.pdf',
    claimedMime: 'application/pdf',
    maxBytes: 10 * 1024 * 1024,
    allowedKinds: OFFICE_DOCUMENT_UPLOAD_KINDS,
  });
  assert.equal(ok.ok, true);
  if (ok.ok) assert.equal(ok.mime, 'application/pdf');
});

test('rejects spoofed MIME, wrong extension, oversized and path-traversal names', () => {
  const spoofed = guardUploadContent({
    buf: jpeg,
    fileName: 'photo.jpg',
    claimedMime: 'application/pdf',
    maxBytes: 10 * 1024 * 1024,
    allowedKinds: OFFICE_DOCUMENT_UPLOAD_KINDS,
  });
  assert.equal(spoofed.ok, false);

  const wrongExt = guardUploadContent({
    buf: jpeg,
    fileName: 'photo.pdf',
    claimedMime: 'image/jpeg',
    maxBytes: 10 * 1024 * 1024,
    allowedKinds: OFFICE_DOCUMENT_UPLOAD_KINDS,
  });
  assert.equal(wrongExt.ok, false);

  const big = guardUploadContent({
    buf: oversized,
    fileName: 'huge.txt',
    claimedMime: 'text/plain',
    maxBytes: 10 * 1024 * 1024,
    allowedKinds: OFFICE_DOCUMENT_UPLOAD_KINDS,
  });
  assert.equal(big.ok, false);

  const traversal = guardUploadContent({
    buf: pdf,
    fileName: '../secret.pdf',
    claimedMime: 'application/pdf',
    maxBytes: 10 * 1024 * 1024,
    allowedKinds: OFFICE_DOCUMENT_UPLOAD_KINDS,
  });
  assert.equal(traversal.ok, true);
  if (traversal.ok) assert.equal(traversal.fileName, 'secret.pdf');

  const gifNotForBranding = guardUploadContent({
    buf: gif,
    fileName: 'logo.gif',
    claimedMime: 'image/gif',
    maxBytes: 5 * 1024 * 1024,
    allowedKinds: IMAGE_UPLOAD_KINDS.filter((k) => k !== 'gif'),
  });
  assert.equal(gifNotForBranding.ok, false);
});

function zipEntry(name: string, body: Buffer, uncompressed = body.length): Buffer {
  const nameBuf = Buffer.from(name);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(0, 6);
  header.writeUInt32LE(body.length, 18);
  header.writeUInt32LE(uncompressed, 22);
  header.writeUInt16LE(nameBuf.length, 26);
  return Buffer.concat([header, nameBuf, body]);
}

test('rejects double extensions, macros, scripted PDFs, zip bombs and executables', () => {
  assert.equal(hasDangerousDoubleExtension('invoice.pdf.exe'), true);
  assert.equal(hasDangerousDoubleExtension('report.final.pdf'), false);
  const jsPdf = Buffer.from('%PDF-1.4\n/JavaScript /S /JavaScript');
  assert.equal(
    guardUploadContent({
      buf: jsPdf,
      fileName: 'invoice.pdf',
      claimedMime: 'application/pdf',
      maxBytes: 20 * 1024 * 1024,
      allowedKinds: BUSINESS_DOCUMENT_UPLOAD_KINDS,
    }).ok,
    false,
  );
  const macro = zipEntry('word/vbaProject.bin', Buffer.from('x'));
  assert.equal(
    guardUploadContent({
      buf: macro,
      fileName: 'invoice.docx',
      claimedMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      maxBytes: 20 * 1024 * 1024,
      allowedKinds: OFFICE_DOCUMENT_UPLOAD_KINDS,
    }).ok,
    false,
  );
  const bomb = zipEntry('word/document.xml', Buffer.from('x'), 90 * 1024 * 1024);
  assert.equal(
    guardUploadContent({
      buf: bomb,
      fileName: 'invoice.docx',
      claimedMime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      maxBytes: 20 * 1024 * 1024,
      allowedKinds: OFFICE_DOCUMENT_UPLOAD_KINDS,
    }).ok,
    false,
  );
  const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(32, 1)]);
  assert.equal(detectUploadKind(exe), 'rejected');
  const xml = Buffer.from('<?xml version="1.0"?><Invoice id="1"/>');
  const xmlOk = guardUploadContent({
    buf: xml,
    fileName: 'invoice.xml',
    claimedMime: 'application/xml',
    maxBytes: 20 * 1024 * 1024,
    allowedKinds: BUSINESS_DOCUMENT_UPLOAD_KINDS,
  });
  assert.equal(xmlOk.ok, true);
});
