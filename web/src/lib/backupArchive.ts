/** Android-compatible backup archives. Photo bytes stay local and travel only in exports. */
export class ArchiveError extends Error {}
export interface BackupPhoto { readonly name: string; readonly data: Uint8Array<ArrayBuffer> }
export interface BackupArchive { readonly document: string; readonly photos: readonly BackupPhoto[] }
const MAX_DOCUMENT = 16 * 1024 * 1024;
const MAX_PHOTO = 20 * 1024 * 1024;
const MAX_ARCHIVE = 512 * 1024 * 1024;
const MAX_ENTRIES = 4096;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
export function safePhotoName(name: string): boolean {
  return /^[A-Za-z0-9._-]{1,80}\.jpg$/i.test(name);
}
export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function requireArchive(ok: boolean, reason: string): asserts ok {
  if (!ok) throw new ArchiveError(reason);
}
export async function readBackupDocument(file: File): Promise<string> {
  return (await readBackupArchive(file)).document;
}
export async function readBackupArchive(file: File): Promise<BackupArchive> {
  requireArchive(file.size <= MAX_ARCHIVE, 'archive-too-large');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(bytes.buffer);
  if (bytes.length < 4 || view.getUint32(0, true) !== 0x04034b50) {
    requireArchive(bytes.length <= MAX_DOCUMENT, 'document-too-large');
    return { document: decoder.decode(bytes), photos: [] };
  }
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) {
    if (view.getUint32(i, true) === 0x06054b50 && i + 22 + view.getUint16(i + 20, true) === bytes.length) {
      end = i;
      break;
    }
  }
  requireArchive(end >= 0, 'no-central-directory');
  const count = view.getUint16(end + 10, true);
  requireArchive(count <= MAX_ENTRIES && view.getUint16(end + 8, true) === count &&
    view.getUint16(end + 4, true) === 0 && view.getUint16(end + 6, true) === 0, 'unsupported-archive');
  let offset = view.getUint32(end + 16, true);
  const directoryStart = offset;
  requireArchive(offset + view.getUint32(end + 12, true) === end, 'bad-central-directory');
  const seen = new Set<string>();
  const photos: BackupPhoto[] = [];
  let document: string | undefined;
  let totalSize = 0;
  for (let i = 0; i < count; i++) {
    requireArchive(offset + 46 <= end && view.getUint32(offset, true) === 0x02014b50, 'bad-central-directory');
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const compressed = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const next = offset + 46 + nameLength + view.getUint16(offset + 30, true) + view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    requireArchive(next <= end, 'bad-central-directory');
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    requireArchive(!seen.has(name), 'duplicate-entry');
    seen.add(name);
    totalSize += size;
    requireArchive(totalSize <= MAX_ARCHIVE, 'archive-too-large');
    offset = next;
    const photoName = name.startsWith('photos/') && name !== 'photos/' ? name.slice(7) : null;
    if (photoName !== null) requireArchive(safePhotoName(photoName), 'unsafe-photo-name');
    if (name !== 'backup.json' && photoName === null) continue;
    const limit = photoName === null ? MAX_DOCUMENT : MAX_PHOTO;
    requireArchive(size <= limit && (flags & 1) === 0, 'unsupported-entry');
    requireArchive(local + 30 <= directoryStart && view.getUint32(local, true) === 0x04034b50, 'bad-local-header');
    const localNameLength = view.getUint16(local + 26, true);
    const start = local + 30 + localNameLength + view.getUint16(local + 28, true);
    requireArchive(start + compressed <= directoryStart &&
      view.getUint16(local + 8, true) === method &&
      decoder.decode(bytes.subarray(local + 30, local + 30 + localNameLength)) === name, 'bad-local-header');
    const packed = bytes.slice(start, start + compressed);
    let data: Uint8Array<ArrayBuffer>;
    if (method === 0) data = packed;
    else {
      requireArchive(method === 8, 'unsupported-compression');
      const reader = new Blob([packed]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
      const chunks: Uint8Array<ArrayBuffer>[] = [];
      let length = 0;
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.length;
          requireArchive(length <= size && length <= limit, 'entry-too-large');
          chunks.push(part.value);
        }
      } catch {
        await reader.cancel().catch(() => {});
        throw new ArchiveError('corrupt-entry');
      }
      data = new Uint8Array(length);
      let position = 0;
      for (const chunk of chunks) { data.set(chunk, position); position += chunk.length; }
    }
    requireArchive(data.length === size && crc32(data) === crc, 'corrupt-entry');
    if (photoName === null) document = decoder.decode(data);
    else photos.push({ name: photoName, data });
  }
  requireArchive(offset === end, 'bad-central-directory');
  requireArchive(document !== undefined, 'no-document');
  return { document, photos };
}

/** Refuse a document our bounded importer could not restore. */
export function writeBackupDocument(document: string): Blob {
  const bytes = encoder.encode(document);
  requireArchive(bytes.length <= MAX_DOCUMENT, 'document-too-large');
  return new Blob([bytes], { type: 'application/json' });
}

/** Stored entries avoid recompressing JPEGs and are readable by java.util.zip. */
export function writeBackupArchive(document: string, photos: readonly BackupPhoto[]): Blob {
  const json = encoder.encode(document);
  requireArchive(json.length <= MAX_DOCUMENT && photos.length + 1 <= MAX_ENTRIES, 'archive-too-large');
  const seen = new Set<string>();
  for (const photo of photos) {
    requireArchive(safePhotoName(photo.name) && !seen.has(photo.name), 'unsafe-photo-name');
    requireArchive(photo.data.length <= MAX_PHOTO, 'photo-too-large');
    seen.add(photo.name);
  }
  const entries = [{ name: 'backup.json', data: json }, ...photos.map(p => ({ name: `photos/${p.name}`, data: p.data }))];
  const parts: BlobPart[] = [];
  const directory: Uint8Array<ArrayBuffer>[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x800, true); lv.setUint16(12, 33, true);
    lv.setUint32(14, crc, true); lv.setUint32(18, entry.data.length, true);
    lv.setUint32(22, entry.data.length, true); lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x800, true); cv.setUint16(14, 33, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, entry.data.length, true);
    cv.setUint32(24, entry.data.length, true); cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true); central.set(name, 46);
    parts.push(local, entry.data); directory.push(central);
    offset += local.length + entry.data.length;
  }
  const directorySize = directory.reduce((sum, entry) => sum + entry.length, 0);
  requireArchive(offset + directorySize + 22 <= MAX_ARCHIVE, 'archive-too-large');
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true);
  ev.setUint32(12, directorySize, true); ev.setUint32(16, offset, true);
  return new Blob([...parts, ...directory, end], { type: 'application/zip' });
}
