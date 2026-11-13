import { FilePolicyError } from './errors';

/** Check content independently of the client-controlled MIME type. Files are
 * opaque attachments, never executed, previewed, or extracted on the server. */
export function validateFileContent(name: string, bytes: Uint8Array) {
  const extension = name.split('.').at(-1)?.toLowerCase();
  const startsWith = (signature: number[]) => signature.every((byte, index) => bytes[index] === byte);
  let valid = false;
  switch (extension) {
    case 'pdf': valid = startsWith([0x25, 0x50, 0x44, 0x46, 0x2d]); break;
    case 'png': valid = startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); break;
    case 'jpg': case 'jpeg': valid = startsWith([0xff, 0xd8, 0xff]); break;
    case 'txt': case 'csv': case 'json':
      try { new TextDecoder('utf-8', { fatal: true }).decode(bytes); valid = !bytes.includes(0); }
      catch { /* Non-text bytes are not accepted as text uploads. */ }
  }
  if (!valid) throw new FilePolicyError('INVALID_FILE_CONTENT', 422);
}
