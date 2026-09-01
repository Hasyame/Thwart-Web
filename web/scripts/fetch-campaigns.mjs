/**
 * Campaign templates, fetched from the Android repository.
 *
 * They live in `app/src/main/assets/campaigns/` in Hasyame/Thwart, which is
 * public. Fetched rather than copied so there is one source of truth: a
 * campaign corrected on the app arrives here on the next build, with nobody
 * having to remember to bring it across.
 *
 * They carry no rules text and no text from any campaign book. Their own note
 * says so: "Mechanics only, written for this app". Card codes are MarvelCDB
 * codes and names are resolved from the card database at runtime, so nothing
 * copyrighted is stored here either.
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', 'public', 'data', 'campaigns');

const REPO = 'Hasyame/Thwart';
const BRANCH = process.env.THWART_BRANCH ?? 'main';
const ASSETS = 'app/src/main/assets/campaigns';

/**
 * The smallest a template can plausibly be.
 *
 * A guard, not a formality. The raw endpoint answers 404 with an HTML page and
 * a bad day upstream can answer 200 with nothing useful; writing either over a
 * working set of templates would break every campaign at once, and the failure
 * would not show until somebody tried to start one.
 */
const MIN_BYTES = 500;

async function getJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'thwart-web-build' },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`);
  }
  return response.json();
}

async function main() {
  console.log(`Fetching campaign templates from ${REPO}@${BRANCH}`);

  // The directory listing, so a campaign added on the app is picked up without
  // this script naming them one by one.
  const listing = await getJson(
    `https://api.github.com/repos/${REPO}/contents/${ASSETS}?ref=${BRANCH}`,
  );
  const files = listing.filter(
    (entry) => entry.type === 'file' && entry.name.endsWith('.json'),
  );
  if (files.length === 0) {
    throw new Error('the campaigns directory is empty; refusing to write');
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const templates = [];
  for (const file of files) {
    const raw = await fetch(file.download_url).then((r) => {
      if (!r.ok) {
        throw new Error(`${r.status} for ${file.name}`);
      }
      return r.text();
    });
    if (raw.length < MIN_BYTES) {
      throw new Error(`${file.name} came back as ${raw.length} bytes; refusing to write`);
    }

    // Parsed before it is written, so a truncated download fails here rather
    // than in somebody's browser halfway through a campaign.
    const template = JSON.parse(raw);
    if (typeof template.id !== 'string' || template.id === '') {
      throw new Error(`${file.name} has no id`);
    }

    writeFileSync(join(OUT_DIR, `${template.id}.json`), raw, 'utf8');
    templates.push({
      id: template.id,
      name: template.name ?? { en: template.id },
      packCode: template.packCode ?? null,
      scenarios: Array.isArray(template.scenarios) ? template.scenarios.length : 0,
    });
    console.log(`  ${template.id}: ${raw.length} bytes`);
  }

  templates.sort((a, b) => a.id.localeCompare(b.id));

  const digest = createHash('sha256')
    .update(templates.map((t) => t.id).join('\n'))
    .digest('hex');

  const indexPath = join(OUT_DIR, 'index.json');
  const previous = existsSync(indexPath)
    ? JSON.parse(readFileSync(indexPath, 'utf8'))
    : null;

  writeFileSync(
    indexPath,
    JSON.stringify({
      fetchedAt: new Date().toISOString(),
      source: `https://github.com/${REPO}/tree/${BRANCH}/${ASSETS}`,
      digest,
      templates,
    }),
    'utf8',
  );

  console.log(
    previous?.digest === digest
      ? `\nCampaigns unchanged. ${templates.length} templates.`
      : `\nCampaigns changed. ${templates.length} templates, digest=${digest.slice(0, 12)}`,
  );
}

main().catch((error) => {
  console.error(`\nFailed: ${error.message}`);
  console.error('Nothing was written; the previous templates are untouched.');
  process.exit(1);
});
