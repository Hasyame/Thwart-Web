/**
 * Checks the backup reader against both shapes the Android app produces.
 *
 * `BackupRepository` picks the format from whether photographs exist, while the
 * suggested filename comes from what the user asked for, so a file named `.zip`
 * routinely holds plain JSON. Both have to work, and neither can be told apart
 * by its name.
 *
 * The archive fixture is built here rather than committed, so the test needs no
 * binary in the repository. Pass a path as the first argument to additionally
 * run a real export through it:
 *
 *     node scripts/test-backup-archive.mjs path/to/export.zip
 */
import { deflateRawSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { readBackupDocument, readBackupArchive, writeBackupArchive, writeBackupDocument, crc32, ArchiveError } from '../src/lib/backupArchive.ts';

let failures = 0;

function check(label, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) {
    failures += 1;
  }
}

/**
 * Writes a minimal zip holding one deflated entry.
 *
 * Deliberately hand-built: this mirrors what java.util.zip emits, including the
 * detail that matters most here, that a streamed entry leaves the sizes at zero
 * in the local header and states them only in the central directory.
 */
function makeZip(entries, { zeroLocalSizes = false } = {}) {
  const encoder = new TextEncoder();
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const [name, text] of entries) {
    const nameBytes = encoder.encode(name);
    const raw = encoder.encode(text);
    const data = deflateRawSync(raw);

    const local = Buffer.alloc(30 + nameBytes.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(zeroLocalSizes ? 0x08 : 0, 6); // data-descriptor flag
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(zeroLocalSizes ? 0 : crc32(raw), 14);
    local.writeUInt32LE(zeroLocalSizes ? 0 : data.length, 18);
    local.writeUInt32LE(zeroLocalSizes ? 0 : raw.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    local.set(nameBytes, 30);

    const central = Buffer.alloc(46 + nameBytes.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(zeroLocalSizes ? 0x08 : 0, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    central.set(nameBytes, 46);

    locals.push(local, Buffer.from(data));
    centrals.push(central);
    offset += local.length + data.length;
  }

  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, directory, end]);
}

const document = JSON.stringify({ appVersion: '1.38.0', decks: [{ id: 'a' }], plays: [] });

// Plain JSON, whatever the file is called.
check(
  'plain JSON named .zip is read as JSON',
  JSON.parse(await readBackupDocument(new File([document], 'export.zip'))).appVersion === '1.38.0',
);

// A real archive, with the photo folder alongside so the entry walk has to skip
// past something before it finds the document.
const archive = makeZip([
  ['photos/one.jpg', 'not really a photograph'],
  ['backup.json', document],
]);
check(
  'document found past other entries',
  JSON.parse(await readBackupDocument(new File([archive], 'export.zip'))).decks.length === 1,
);

// The java.util.zip streaming case: sizes present only in the central
// directory. Reading them from the local header would give a zero-length entry.
const streamed = makeZip([['backup.json', document]], { zeroLocalSizes: true });
check(
  'sizes taken from the central directory',
  JSON.parse(await readBackupDocument(new File([streamed], 'export.zip'))).appVersion === '1.38.0',
);

// An archive with no document must say so rather than return something odd.
try {
  await readBackupDocument(new File([makeZip([['photos/one.jpg', 'x']])], 'export.zip'));
  check('archive without a document rejected', false);
} catch (error) {
  check('archive without a document rejected', error instanceof ArchiveError, error.message);
}

// Truncated: the signature says zip, the rest is missing.
try {
  await readBackupDocument(new File([new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])], 'broken.zip'));
  check('truncated zip rejected', false);
} catch (error) {
  check('truncated zip rejected', error instanceof ArchiveError, error.message);
}

check('CRC reference vector', crc32(new TextEncoder().encode('123456789')) === 0xcbf43926);
try { writeBackupDocument('x'.repeat(16 * 1024 * 1024 + 1)); check('oversize document export refused', false); }
catch (error) { check('oversize document export refused', error instanceof ArchiveError); }
const decoded = await readBackupArchive(new File([archive], 'a.zip'));
check('photo bytes extracted', new TextDecoder().decode(decoded.photos[0].data) === 'not really a photograph');
const output = writeBackupArchive(document, decoded.photos);
const roundtrip = await readBackupArchive(new File([output], 'roundtrip.zip'));
check('photo export round trip', roundtrip.document === document && Buffer.from(roundtrip.photos[0].data).equals(Buffer.from(decoded.photos[0].data)));
for (const [label, bytes] of [
  ['path traversal', makeZip([['backup.json', document], ['photos/../outside.jpg', 'x']])],
  ['duplicate file', makeZip([['backup.json', document], ['photos/a.jpg', 'a'], ['photos/a.jpg', 'b']])],
]) {
  try { await readBackupArchive(new File([bytes], 'bad.zip')); check(label, false); }
  catch (error) { check(label, error instanceof ArchiveError); }
}
const corrupt = new Uint8Array(await output.arrayBuffer());
corrupt[30 + 'backup.json'.length] ^= 1;
try { await readBackupArchive(new File([corrupt], 'corrupt.zip')); check('CRC mismatch rejected', false); }
catch (error) { check('CRC mismatch rejected', error instanceof ArchiveError); }

const real = process.argv.find((arg, i) => i > 1 && !arg.startsWith('-') && arg.endsWith('.zip'));
if (real !== undefined) {
  const doc = JSON.parse(await readBackupDocument(new File([await readFile(real)], 'real.zip')));
  check('real export parses', typeof doc.appVersion === 'string', doc.appVersion);
  check('real export carries decks', Array.isArray(doc.decks), `${doc.decks?.length} decks`);
  check('real export carries plays', Array.isArray(doc.plays), `${doc.plays?.length} plays`);
}

process.exit(failures === 0 ? 0 : 1);
