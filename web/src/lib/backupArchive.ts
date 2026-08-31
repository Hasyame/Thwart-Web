/**
 * Getting the backup document out of whatever the app handed you.
 *
 * The Android app writes one of two things:
 *
 * - **Plain JSON**, when there are no photographs to carry.
 * - **A zip**, when there are, holding `backup.json` and a `photos/` folder.
 *   Photographs are full camera JPEGs; inside the JSON they would have to be
 *   base64, costing a third again and building the whole file in memory.
 *
 * The extension does not reliably tell you which. `suggestedFileName` picks
 * `.zip` or `.json` from what the user *asked* for, while the writer picks the
 * format from whether any photographs actually exist, so asking for photos and
 * having none produces a file named `.zip` containing JSON. A real export from
 * a real phone does exactly that.
 *
 * So the content is sniffed, never the name, which is what the app's own
 * importer does too.
 *
 * Only the document is read. Photographs are skipped deliberately: doc 01 §6
 * keeps them out of scope, and a browser has nowhere sensible to put them.
 */

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04]; // "PK\x03\x04"
const DOCUMENT_ENTRY = 'backup.json';

export class ArchiveError extends Error {}

function looksLikeZip(bytes: Uint8Array<ArrayBuffer>): boolean {
  return ZIP_SIGNATURE.every((b, i) => bytes[i] === b);
}

/**
 * Reads the backup document from a file, zipped or not.
 *
 * Returns the JSON text, for the existing parser to validate.
 */
export async function readBackupDocument(file: File): Promise<string> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  if (!looksLikeZip(buffer)) {
    return new TextDecoder().decode(buffer);
  }
  return extractFromZip(buffer);
}

/**
 * Pulls one named entry out of a zip.
 *
 * A deliberately small reader rather than a library: the archives this has to
 * open are written by one known program, hold a handful of entries, and are
 * never encrypted or spanned. Inflating is the browser's job via
 * DecompressionStream, so the only work here is walking the central directory.
 */
async function extractFromZip(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // The end-of-central-directory record is last, but may be followed by a
  // comment of up to 64 KB, so it is searched for backwards.
  const EOCD_SIGNATURE = 0x06054b50;
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 65535; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    throw new ArchiveError('no-central-directory');
  }

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);

  for (let i = 0; i < entryCount; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) {
      throw new ArchiveError('bad-central-directory');
    }
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    if (name === DOCUMENT_ENTRY) {
      return readLocalEntry(bytes, view, localOffset, method, compressedSize);
    }
    offset += 46 + nameLength + extraLength + commentLength;
  }

  throw new ArchiveError('no-document');
}

async function readLocalEntry(
  bytes: Uint8Array<ArrayBuffer>,
  view: DataView,
  localOffset: number,
  method: number,
  compressedSize: number,
): Promise<string> {
  if (view.getUint32(localOffset, true) !== 0x04034b50) {
    throw new ArchiveError('bad-local-header');
  }
  // The local header repeats the name and extra lengths, and they can differ
  // from the central directory's, so they are read again here rather than
  // reused.
  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  const start = localOffset + 30 + nameLength + extraLength;
  const data = bytes.subarray(start, start + compressedSize);

  if (method === 0) {
    return new TextDecoder().decode(data);
  }
  if (method !== 8) {
    throw new ArchiveError('unsupported-compression');
  }

  // Raw deflate: a zip entry carries no zlib header, which is why this is
  // deflate-raw rather than deflate.
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}
