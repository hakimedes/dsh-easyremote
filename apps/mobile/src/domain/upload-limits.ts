import type { LocalUpload } from './types';

export const UPLOAD_CHUNK_BYTES = 4 * 1024 * 1024;
export const IMAGE_UPLOAD_BYTES = 20 * 1024 * 1024;
export const FILE_UPLOAD_BYTES = 50 * 1024 * 1024;
export const MESSAGE_UPLOAD_BYTES = 100 * 1024 * 1024;
export const MESSAGE_IMAGE_BYTES = 60 * 1024 * 1024;
export const MESSAGE_UPLOAD_COUNT = 10;

export function validateLocalUploads(uploads: LocalUpload[]) {
  if (uploads.length > MESSAGE_UPLOAD_COUNT) throw new Error('A message can include at most 10 files.');
  let total = 0;
  let imageTotal = 0;
  for (const upload of uploads) {
    if (!Number.isSafeInteger(upload.byteSize) || upload.byteSize <= 0) throw new Error(`${upload.displayName} has an invalid size.`);
    if (upload.kind === 'image' && upload.byteSize > IMAGE_UPLOAD_BYTES) throw new Error(`${upload.displayName} exceeds the 20 MiB image limit.`);
    if (upload.kind === 'file' && upload.byteSize > FILE_UPLOAD_BYTES) throw new Error(`${upload.displayName} exceeds the 50 MiB file limit.`);
    total += upload.byteSize;
    if (upload.kind === 'image') imageTotal += upload.byteSize;
  }
  if (total > MESSAGE_UPLOAD_BYTES) throw new Error('Attachments exceed the 100 MiB message limit.');
  if (imageTotal > MESSAGE_IMAGE_BYTES) throw new Error('Images exceed the 60 MiB message limit.');
}

export function decodeBase64(value: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = value.replace(/\s/g, '').replace(/=+$/, '');
  const output = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let offset = 0;
  for (const character of clean) {
    const index = alphabet.indexOf(character);
    if (index < 0) throw new Error('Invalid base64 data');
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output[offset++] = (buffer >> bits) & 0xff;
    }
  }
  return offset === output.length ? output : output.slice(0, offset);
}
