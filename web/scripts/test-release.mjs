// Run the real release scripts in an isolated filesystem with fake external tools.
// Never connects to a host, runs Go/npm, or touches a production database.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const deploy = resolve(root, 'deploy');
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : 'bash';
const shellPath = path => path.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, d) => `/${d.toLowerCase()}`);
const old = 'a'.repeat(40), target = 'b'.repeat(40), site = 'c'.repeat(40);
const mocks = {
  git: `case "$1" in
fetch) echo "fetch $*" >> "$WORLD/log" ;;
checkout) printf '%s' "\${COMMIT:-$TEST_RELEASE}" > "$WORLD/head" ;;
rev-parse)
 case "$*" in
 *refs/remotes/origin/api-release*) printf '%s' "$TEST_API" ;;
 *refs/remotes/origin/release*) printf '%s' "$TEST_RELEASE" ;;
 *--short*) for arg in "$@"; do last="$arg"; done; [ "$last" = HEAD ] && last="$(cat "$WORLD/head")"; printf '%s' "$last" | cut -c1-12 ;;
 *) cat "$WORLD/head" ;;
 esac ;;
diff) [ "$TEST_COMPAT" = 1 ] ;;
*) exit 1 ;;
esac`,
  curl: `for arg in "$@"; do last="$arg"; done
[ "$TEST_HEALTH" = 1 ] || exit 22
case "$last" in
 */health) printf '{}';;
 */version) printf '{"build":"%s"}' "$(cat "$WORLD/running")";;
 *) exit 1;;
esac`,
  sudo: `echo restart >> "$WORLD/log"
[ "$TEST_RESTART" = 1 ] || exit 1
[ "$TEST_WRONG" = 1 ] || printf '%s' "$TEST_API" | cut -c1-12 > "$WORLD/running"`,
  sleep: ':',
  go: `echo "go $*" >> "$WORLD/log"
[ "$TEST_BUILD" = 1 ] || exit 1
if [ "$1" = build ]; then
 while [ "$#" -gt 0 ]; do
  if [ "$1" = -o ]; then shift; : > "$1"; break; fi
  shift
 done
fi`,
  npm: `echo "npm $*" >> "$WORLD/log"
if [ "$*" = 'run --silent build' ]; then mkdir -p dist; printf 'test shell' > dist/index.html; fi`,
};

function scenario(name, overrides, expected) {
  const world = mkdtempSync(join(tmpdir(), 'thwart-release-test-'));
  try {
    for (const dir of ['tools', 'repo/deploy', 'repo/server', 'repo/web/scripts/lib', 'repo/web/public/data', 'bin', 'releases']) mkdirSync(join(world, dir), { recursive: true });
    for (const file of ['release.sh', 'update.sh', 'update-api.sh', 'api-ready.sh']) copyFileSync(join(deploy, file), join(world, 'repo/deploy', file));
    for (const [name, body] of Object.entries(mocks)) writeFileSync(join(world, 'tools', name), `#!/bin/sh\nset -eu\n${body}\n`, { mode: 0o755 });
    writeFileSync(join(world, 'bin/thwart-api.commit'), old);
    writeFileSync(join(world, 'running'), old.slice(0, 12));
    writeFileSync(join(world, 'head'), old);
    writeFileSync(join(world, 'log'), '');
    const env = { ...process.env, WORLD: shellPath(world), REPO: shellPath(join(world, 'repo')), BIN: shellPath(join(world, 'bin')), DATA: shellPath(join(world, 'db')), RELEASES: shellPath(join(world, 'releases')), CURRENT: shellPath(join(world, 'current')), TEST_API: target, TEST_RELEASE: site, TEST_COMPAT: '1', TEST_HEALTH: '1', TEST_RESTART: '1', TEST_WRONG: '0', TEST_BUILD: '1', ...overrides };
    delete env.THWART_RELEASE_SNAPSHOT;
    delete env.REF;
    delete env.COMMIT;
    const script = overrides.TEST_SCRIPT ?? 'release.sh';
    const run = spawnSync(bash, ['--noprofile', '--norc', '-c', `export PATH="$WORLD/tools:$PATH"; chmod +x "$REPO/deploy/"*.sh; exec sh "$REPO/deploy/${script}"`], { env, encoding: 'utf8', timeout: 30000 });
    const log = readFileSync(join(world, 'log'), 'utf8');
    assert.equal(run.status === 0, expected.success, `${name}: ${run.stdout}\n${run.stderr}\n${run.error ?? ''}`);
    assert.equal(readFileSync(join(world, 'bin/thwart-api.commit'), 'utf8').trim(), expected.promoted ? target : old, `${name}: confirmed API stamp`);
    assert.equal(log.includes('npm run --silent build'), expected.published, `${name}: site publication\n${log}`);
    if (expected.published) {
      assert.ok(log.includes('fetch fetch --quiet origin release'), 'site builds the tested branch');
      assert.equal(readFileSync(join(world, 'bin/thwart-site.commit'), 'utf8'), site);
    }
    if (expected.built) assert.equal(readFileSync(join(world, 'bin/thwart-api.built'), 'utf8').trim(), target);
    if (!expected.published) assert.equal(existsSync(join(world, 'bin/thwart-site.commit')), false);
    if (expected.retry) {
      const retry = spawnSync(bash, ['--noprofile', '--norc', '-c', 'export PATH="$WORLD/tools:$PATH"; exec sh "$REPO/deploy/release.sh"'], { env: { ...env, TEST_RESTART: '1' }, encoding: 'utf8', timeout: 30000 });
      assert.equal(retry.status, 0, retry.stdout + retry.stderr);
      assert.equal(readFileSync(join(world, 'bin/thwart-api.commit'), 'utf8').trim(), target);
      const retriedLog = readFileSync(join(world, 'log'), 'utf8');
      assert.equal(retriedLog.split('go test').length - 1, 1, 'retry reuses the built binary');
      assert.equal(retriedLog.split('restart').length - 1, 2, 'retry actually restarts again');
    }
    console.log(`ok   ${name}`);
  } finally {
    // Only this test's freshly-created temporary directory may be removed.
    assert.equal(dirname(resolve(world)), resolve(tmpdir()));
    assert.ok(world.includes('thwart-release-test-'));
    rmSync(world, { recursive: true, force: true });
  }
}

scenario('healthy approved API is confirmed before the site publishes', {}, { success: true, promoted: true, published: true, built: true });
scenario('failed API build keeps both published stamps unchanged', { TEST_BUILD: '0' }, { success: false, promoted: false, published: false });
scenario('failed restart cannot promote a built binary; the next run retries it', { TEST_RESTART: '0' }, { success: false, promoted: false, published: false, built: true, retry: true });
scenario('wrong running version holds the site after restart', { TEST_WRONG: '1' }, { success: false, promoted: false, published: false, built: true });
scenario('an unhealthy API cannot publish the site', { TEST_HEALTH: '0' }, { success: false, promoted: false, published: false, built: true });
scenario('server difference holds the site for API approval', { TEST_API: old, TEST_COMPAT: '0' }, { success: true, promoted: false, published: false });
scenario('nightly builder defaults to release and refuses an incompatible API', { TEST_SCRIPT: 'update.sh', TEST_COMPAT: '0' }, { success: false, promoted: false, published: false });
