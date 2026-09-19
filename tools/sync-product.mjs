/** Distribute reviewed product instructions without overwriting independently edited copies. */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(repo, 'docs/product');
const args = process.argv.slice(2);
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : null;
const android = option('--android');
const workspace = option('--workspace');
const write = args.includes('--write');
if (!android) throw new Error('Pass --android <checkout>; optionally --workspace <root> and --write. Default is verification only.');
const destination = resolve(android, 'docs/product');
if (destination === source || !existsSync(resolve(android, '.git'))) throw new Error('Expected a separate Android Git checkout.');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  return entry.isDirectory() ? files(path) : [relative(source, path).replaceAll('\\', '/')];
});
const paths = files(source).filter((path) => path.endsWith('.md')).sort();
const manifestPath = join(destination, 'snapshot.json');
const previous = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { files: {} };
const next = Object.fromEntries(paths.map((path) => [path, hash(readFileSync(join(source, path)))]));
const obsolete = Object.keys(previous.files).filter((path) => !(path in next));
if (obsolete.length) throw new Error(`Review obsolete snapshot documents before redistribution: ${obsolete.join(', ')}`);
const outputs = paths.map((path) => ({ path: join(destination, path), source: join(source, path), previous: previous.files[path] }));
if (workspace) outputs.push({ path: resolve(workspace, 'AGENTS.md'), source: join(source, 'AGENTS.md'), previous: previous.files['AGENTS.md'] });

// Check every target before writing any of them, including a locally edited root entry point.
const mismatches = [];
for (const output of outputs) {
  const wanted = hash(readFileSync(output.source));
  const current = existsSync(output.path) ? hash(readFileSync(output.path)) : null;
  if (current === wanted) continue;
  if (!write) mismatches.push(output.path);
  else if (current !== null && current !== output.previous) throw new Error(`Local edits need reconciliation: ${output.path}`);
}
if (!write) {
  if (!existsSync(manifestPath) || JSON.stringify(previous.files) !== JSON.stringify(next)) mismatches.push(manifestPath);
  if (mismatches.length) throw new Error(`Product snapshot drift:\n${mismatches.join('\n')}`);
  console.log(`Product instructions and ${paths.length} documents agree.`);
} else {
  for (const output of outputs) {
    mkdirSync(dirname(output.path), { recursive: true });
    writeFileSync(output.path, readFileSync(output.source));
  }
  writeFileSync(manifestPath, JSON.stringify({
    sourceRepository: 'https://github.com/Hasyame/Thwart-Web',
    sourceBaseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
    provenance: 'Content pinned by SHA-256; sourceBaseCommit identifies the base checkout, including when documents are uncommitted.',
    files: next,
  }, null, 2) + '\n');
  console.log(`Distributed ${paths.length} product documents. Removed source files require explicit review of obsolete snapshot files.`);
}
