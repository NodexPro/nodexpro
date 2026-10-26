import { forbidden } from './errors.js';
import { documentScanRequired } from './document-malware-scan.service.js';
import { isFileAssetDownloadable } from './document-malware-scan.pure.js';

export function assertFileAssetDownloadable(scanStatus: string | null | undefined): void {
  if (!isFileAssetDownloadable(scanStatus, documentScanRequired())) {
    throw forbidden('File is not available for download');
  }
}
