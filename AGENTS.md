# AGENTS.md: Thwart Web

Handover notes for a coding agent taking over this repository without the
conversation history that produced it. Facts below were read from the
repository and from the live host on 2026-09-19; anything not verifiable
from the repository is marked **Unknown / requires confirmation**.

Thwart is a fan-made companion for *Marvel Champions: The Card Game*
(Fantasy Flight Games / Marvel). It exists twice: this repository (the web
app at https://thwart.app plus its account/sync API) and an Android app in
a separate repository, `Hasyame/Thwart` (checked out locally at
`C:\MarvelChampionsCompanion` on the author's machine). **The Android app
is the master of every shared contract** (record shapes, sync protocol,
backup format, campaign templates). Never modify the Android repository from
here.

---

## 1. Architecture

### 1.1 Layout

| path | what |
|---|---|
| `web/` | The site: Vite 7 + Svelte 5 (runes) + TypeScript (strict, no `any`), Dexie (IndexedDB). Static output, PWA with a hand-written service worker. |
| `server/` | The account + sync API: Go 1.25, single binary, one SQLite file (`modernc.org/sqlite`, pure Go, no cgo needed except for `-race`). |
| `deploy/` | Everything that runs on the VPS: nginx configs, systemd units and timers, the release/update/backup scripts, hardening script, fail2ban jail, a live probe. These are **references**; the host's live copies are hand-carried (see §5). |
| `docs/deployment.md` | The operator's guide to the VPS. Partly stale (see §8). |
| `docs/design/*.md` | Design records (01 data audit, 02 sync protocol, 03 stack ADRs, 04 roadmap, 05 operations, 06/08 Android briefs, 07 live sync). 02 is the sync contract with Android. |
| `docs/spec/*.md`, `docs/spec/achievements/` | Feature specifications shared with the Android app: statistics, campaigns, ratings and modular sets, synergy + draft, Fear No Evil one-off, achievements (five files incl. `test-vectors.json`). |
| `.github/workflows/ci.yml`, `release-api.yml` | CI and the release handshake (§3). |
| `README.md` | User- and developer-facing overview; the test table there is kept in step with `web/package.json`. |

### 1.2 The web app

- **Entry**: `web/index.html` carries the home page as static HTML (SEO: what
  a crawler sees before JS runs) plus head metadata and JSON-LD; `src/main.ts`
  loads the string bundle for the locale, then mounts `App.svelte`, which
  replaces the prerendered content.
- **Routing**: hand-rolled in `src/lib/router.ts` (`Route` union,
  `routeFromPath`, `pathForRoute`). Routes: `/` home, `/cards` (search,
  `?q=`), `/card/:code`, `/collection`, `/decks`, `/decks/:id[/edit]`,
  `/draft`, `/play`, `/hub` (Play hub), `/randomizer`, `/versus`,
  `/campaigns`, `/history`, `/stats`, `/achievements`, `/rules`, `/account`,
  `/settings/bgg`, `/verify`, else `notFound`. **Adding a route requires
  editing nginx's route regex on the host by hand** (§5.6).
- **Navigation model**: `src/lib/nav.ts` (destinations, tab bar of four +
  More sheet, "grouped play" arrangement where one Play tab opens the hub;
  grouped is the default since 2026-09-10, stored per device in
  `localStorage`).
- **Pages** are lazy chunks (`src/lib/lazy.ts`, `lazy()`/`warm()`), strings
  are split per locale (`src/lib/strings/en.ts`, `fr.ts`, interface in
  `src/lib/i18n.ts`). Every user-facing string must exist in both.
- **Head/SEO**: `src/lib/head.ts` sets title/description/canonical/OG/robots
  per route; private routes (history, stats, decks, account, achievements…)
  and card pages are `noindex`. Sitemap: `web/public/sitemap.xml`.
- **Data**: card data is **fetched at build time from MarvelCDB** by
  `web/scripts/fetch-cards.mjs` into `web/public/data/` (git-ignored, never
  committed, never re-hosted beyond serving the JSON; card images are
  referenced from marvelcdb.com URLs). `fetch-campaigns.mjs` fetches the
  campaign templates from the Android repo (`Hasyame/Thwart`,
  `app/src/main/assets/campaigns`, branch `THWART_BRANCH` or `main`) via the
  GitHub API. `meta.json` records a `scriptDigest` (sha256 of the fetch
  script + `scripts/lib/*`) so the host refetches when the script changes.
  The index rows carry derived fields the app depends on: `synergy`,
  `traitKeys`, `quantity`, `deckLimit`, `duplicateOf`, `hidden`, `res`,
  `deckRules`, and `img` (on hero, villain, leader and main-scheme rows).
- **Local storage**: Dexie database `thwart` (`src/lib/db.ts`, schema v10).
  Record shapes are in `src/lib/records.ts` and mirror the Android entities
  field for field. `completePlay` (`src/lib/playShape.ts`) fills a play
  record and keeps unknown fields in `extra`; `playWire` puts them back.
- **Sync**: `src/lib/sync/` implements docs/design/02. Collections are
  listed in `collections.ts` (owned_packs, excluded sets/scenarios,
  favourites, deck folders, ratings, saved decks, campaign runs/events,
  plays, settings, randomizer history); bodies are opaque JSON, merge is
  last-write by `updatedAt`, tombstones are kept. `live.svelte.ts` uses SSE
  (`/api/v1/sync/stream`). Sync runs after writes (`auto.svelte.ts`).
- **Feature engines** (all pure, all tested by scripts): campaigns
  (`src/lib/campaign/`: template types, condition evaluator, engine fold,
  dealing, text), draft (`src/lib/draft/`), achievements
  (`src/lib/achievements/`, derived from history, never stored), synergy
  (`src/lib/synergy.ts`), randomizer, deck rules, encounter tracker,
  Fear No Evil one-off (`src/lib/fearNoEvil.ts`), replay, ratings, BGG.
- **Service worker**: `src/sw.js`, emitted by a Vite plugin that injects the
  hashed asset list and a build id. Shell is precached; `/data/` is
  stale-while-revalidate; `/api/` is never cached. Consequence: after a
  release users need two loads to see fresh data.

### 1.3 The server

`server/` (module `github.com/Hasyame/Thwart-Web/server`). `main.go` flags:
`-addr` (default `127.0.0.1:8787`), `-db`, `-registration`, `-backup` (write
a snapshot and exit), `-mail-from`, `-smtp` (local Postfix, send-only),
`-site`, `-rating-threshold`, `-bgg-relay`. No secrets in flags or env; the
process reads no environment variables. Endpoints (`api.go`): auth
(register/login/recover/password/verify/resend/devices), sync
(`GET|POST /v1/sync/changes`, `GET /v1/sync/stream`), account export and
delete, `GET /v1/ratings/summary`, BGG relay (`/v1/bgg/verify`,
`/v1/bgg/plays`: the server logs in to BoardGameGeek with the user's
credentials per request and stores nothing), `/v1/health`, `/v1/version`.
Passwords: Argon2id. Schema migrations are in `store.go` and are
forward-only. nginx proxies `/api/` → `127.0.0.1:8787` and strips the prefix.

### 1.4 Decisions and why (short)

- Static site + one Go binary + SQLite, no containers (docs/design/03):
  cheapest thing that runs on a small VPS and can be rebuilt from git.
- Data minimisation (author is in France, GDPR): the server knows accounts,
  devices and opaque record bodies; BGG relay keeps nothing.
- Card text/images are never committed or uploaded as CI artifacts (FFG's
  IP); the host fetches its own copy.
- Deployment is **pull-based via branch pointers**, not push-based SSH from
  GitHub (§3, §5): nothing in GitHub can reach the machine.

---

## 2. Development environment

- **Node** ≥ 20.19 (Vite 7); CI uses Node 24. **Go** 1.25 (`server/go.mod`).
  Package manager: npm with `web/package-lock.json` (`npm ci` in CI).
- Windows is a first-class dev platform (the author works there;
  `.gitattributes` forces LF).

```bash
cd web
npm ci
npm run data        # fetch cards (MarvelCDB, ~1 min) + campaign templates (GitHub) into public/data/
npm run dev         # http://127.0.0.1:5173 ; /api is proxied to https://thwart.app unless THWART_API is set
npm run check       # svelte-check, strict: must be 0 errors 0 warnings (CI runs exactly this)
npm run build       # regenerates icons (sharp) then vite build → web/dist/
npm run test:<name> # each test is a plain script under scripts/, run with vite-node or node
```

Run every test (bash; in PowerShell loop over `npm run | Select-String test:`
instead):

```bash
for t in $(node -e "console.log(Object.keys(require('./package.json').scripts).filter(k=>k.startsWith('test:')).join(' '))"); do npm run --silent $t || echo "$t FAILED"; done
```

Most tests need `public/data/` (run `npm run data` first) and some need
`public/data/campaigns/`.

Server:

```bash
cd server
go vet ./... && gofmt -l .      # CI fails on any gofmt diff
go test ./...
CGO_ENABLED=1 go test -race ./...   # what CI runs
go run . -addr 127.0.0.1:8787 -db ./thwart.sqlite
```

There is no ESLint/Prettier; formatting is by hand, `svelte-check` is the
lint. Never test against a real account: use throwaway accounts on a local
server.

Gotcha on Windows/Git Bash: heredocs mangle backslashes and quotes. For
multi-line edits write a script file and run it, rather than piping through
a heredoc.

---

## 3. CI/CD

Two workflows. Both are pinned to action SHAs. **Neither workflow can reach
the server**: there is no SSH key, host or deploy secret in GitHub. The
server pulls.

### 3.1 `ci.yml` (name "CI")

- Triggers: `push` to `main`, every `pull_request`, `workflow_dispatch` with
  input `fetchCardData` (boolean, forces a MarvelCDB fetch).
- `concurrency`: one run per ref, `cancel-in-progress: true`.
- Top-level `permissions: contents: read`.
- Job **Web** (ubuntu-latest, 15 min): checkout → setup-node 24 with npm
  cache keyed on `web/package-lock.json` → `npm ci` → `npm run check` →
  `npm run build` → tests that need no data (contrast, sync, engine-sync,
  plays, merge, adoption, filters, sw, backup, settings) → **restore card
  data from `actions/cache`** (path `web/public/data`, key
  `data-${hashFiles(fetch-cards.mjs, scripts/lib/synergy.mjs,
  fetch-campaigns.mjs)}`) → `npm run data` only on cache miss or when
  `fetchCardData` is set → **campaign templates are fetched every run**
  (they change without the scripts changing; a cached copy went stale once)
  → the data-dependent tests (deckbuilder, parity, device, safe-area, nav,
  head, replay, randomizer, ratings, bgg, encounter, paused, setup,
  campaign, engine, text, deal, tracker, fne, fne-solo, tile, synergy, draft,
  achievements).
  **Why the step order matters**: a test that reads `public/data` placed
  before the data steps fails in CI while passing locally (this happened on
  2026-09-17 and blocked releases for a day).
- Job **Server** (ubuntu-latest, 15 min): setup-go from `go.mod` with module
  cache → `go vet` → gofmt check → `CGO_ENABLED=1 go test -race ./...`.
- Job **Mark tested** (`release`): `needs: [web, server]`, only on push to
  `main`, `permissions: contents: write`, full-depth checkout, then
  `git push origin <sha>:refs/heads/release` (fast-forward only; a
  force-pushed main fails here on purpose) and writes the step summary.
- No artifacts are uploaded (card text is FFG's). No scheduled runs.
- External services: GitHub Actions cache, marvelcdb.com (fetch),
  api.github.com (campaign templates from `Hasyame/Thwart`).
- Secrets: **none**. Environment variables: none beyond the workflow inputs.

### 3.2 `release-api.yml` (name "Release the API")

- Trigger: `workflow_dispatch` only (a person presses the button).
  `concurrency: release-api`, not cancelled.
- Job **Promote release to api-release** (`contents: write`): refuses if no
  `release` branch; computes `origin/release` as target; if `api-release`
  exists it must be an ancestor (no moving backwards); writes a summary of
  the commits and the `server/` diff; then
  `git push origin <target>:refs/heads/api-release`.
- It promotes `release`, never `main`, so an untested commit cannot be
  shipped even if pressed while CI runs.

### 3.3 The handshake, end to end

```
push main ──CI green──▶ release branch ──(host timer, 5 min)──▶ site published
                                   │
                    button "Release the API" ──▶ api-release ──▶ API rebuilt+restarted,
                                                                  then site follows
```

Rule enforced by `deploy/release.sh`: the **site is published only when
`server/` at `release` equals `server/` of the running API**. A site newer
than its API broke registration on 2026-09-04 (new field refused by
`DisallowUnknownFields`). So: **any commit touching `server/` holds the
site until someone presses "Release the API"**; say so when you make one.

Failure handling: each half builds into a temporary name and swaps; a failed
build leaves the previous binary/site serving. There is no automatic
rollback and no alerting (see §8).

---

## 4. Docker and infrastructure

**There is no Docker.** No Dockerfile, no compose file; `docs/design/05`
sketches a container layout that was never built. The infrastructure is one
Debian VPS with nginx, systemd, Postfix (send-only), certbot, fail2ban and
sqlite3. Health check: `GET https://thwart.app/api/v1/health` and
`/api/v1/version` (reports the commit the API was built from).

---

## 5. Deployment and operations

### 5.1 Environments

Only **production** (`thwart.app`, VPS `92.222.65.177`). No staging. Local
dev proxies `/api` to production by default (read the warning in
`vite.config.ts`); set `THWART_API=http://127.0.0.1:8787` to use a local
server.

### 5.2 Host layout (facts from the host)

- User `thwart` (system, nologin). `/srv/thwart/repo` (git clone, checked
  out detached at the deployed ref), `/srv/thwart/releases/<stamp>/` (last
  three builds, each with a sibling `<stamp>.commit`), `/srv/thwart/current`
  → symlink nginx serves, `/srv/thwart/bin/thwart-api` (+ `thwart-api.commit`,
  `thwart-site.commit`), `/srv/thwart/db/thwart.sqlite` (WAL),
  `/srv/thwart/backups/`.
- nginx site file: `/etc/nginx/sites-available/thwart.app`: **certbot has
  rewritten it**; it differs from `deploy/nginx-thwart.app.conf`.
- SSH: port **57022**, root, key `~/.ssh/thwart_vps` on the author's machine
  (**Unknown / requires confirmation** for any other machine). Password auth
  status: `harden.sh` turns it off only when a key is present.

### 5.3 systemd units (from `deploy/`, installed on the host)

| unit | what |
|---|---|
| `thwart-api.service` | The API, heavily sandboxed; flags in the unit; memory capped 512M. |
| `thwart-release.timer/.service` | Every 5 min: `deploy/release.sh` (pull-half of the handshake). |
| `thwart-update.timer/.service` | Nightly 01:23: `deploy/update.sh` (refetch card data if older than 20 h or if `scriptDigest` changed, rebuild, publish only if something changed). |
| `thwart-backup.timer/.service` | Daily 03:14: `deploy/backup.sh` snapshots the DB via `thwart-api -backup`, verifies, gzips, keeps 30 days, optional `OFFSITE` rsync (**not configured: Unknown / requires confirmation**). |
| `thwart-release.sudoers` | Lets `thwart` run exactly `systemctl restart thwart-api`. |

### 5.4 Deploying

Normal path: push to `main`, wait for CI, wait ≤5 min. Manual:
`sudo -H -u thwart /srv/thwart/repo/deploy/release.sh` (or `update.sh
--force` to republish the site). For the API: press "Release the API" in the
Actions tab; the timer builds (`update-api.sh` runs `go test` first) and
restarts the service.

Verify: `cat "$(readlink -f /srv/thwart/current).commit"`,
`curl -s https://thwart.app/api/v1/version`, `journalctl -u
thwart-release.service --since "30 min ago"`.

### 5.5 Rollback

Site: point `/srv/thwart/current` at an older `/srv/thwart/releases/<stamp>`
(`ln -sfn … current.new && mv -Tf current.new current`). API: check out the
previous commit, `update-api.sh`, restart; schema migrations do not roll
back: restore a backup from `/srv/thwart/backups/`. Note that the release
timer will re-deploy whatever `release`/`api-release` point at within five
minutes, so a rollback must also move the branch (or stop the timer).

### 5.6 Hand-carried host edits (important)

- **nginx SPA route list**: `location ~ ^/(card|cards|collection|…|achievements)(/|$)`.
  Every new page must be added to the **live** file with `sed`, then
  `nginx -t && systemctl reload nginx`. Never `cp` the repo's conf over the
  live one (that took HTTPS down once; certbot's TLS lines live only there).
- nginx `add_header` inheritance: any new `location` with its own header
  must re-include the security header snippet (comment in the conf).
- Migrations run at API start; back up first for anything schema-related.

### 5.7 Inspecting

`journalctl -u thwart-api -f`, `journalctl -u thwart-update.service`,
`sqlite3 -readonly /srv/thwart/db/thwart.sqlite` (accounts: `account`,
devices with `last_seen`: `device`, timestamps in ms). Probe accounts
`liveprobe-a/-b` are created by `deploy/live-probe.py`, not real users.

---

## 6. Git and GitHub

- Repository `Hasyame/Thwart-Web`, default branch `main`. Branches
  `release` and `api-release` are **pointers written by CI/the button; never
  push them by hand**. Old feature branches `feat/synergie`, `feat/draft`
  remain on origin (merged).
- Workflow in practice: small commits straight to `main`; feature branches
  + PRs were used for bigger work (PR #1, #2) and merged locally with
  `--no-ff` (stacked PRs: merge the top branch once, locally).
- Commit messages: English, imperative first line, a body explaining why;
  **authored as the repository owner with no AI attribution/trailer**
  (explicit owner rule). CI is required to move `release`; there is no
  branch protection configured that the repository reveals
  (**Unknown / requires confirmation**).
- Dependencies on other repositories: campaign templates and the achievement
  definitions are shared with `Hasyame/Thwart` (Android). The spec requires
  Android to bundle `web/public/achievements.json` byte-identically and to
  run the same vectors (port pending); the web copies campaign templates
  from Android at build time.

---

## 7. Technical decisions and constraints (do not change casually)

- **Android is master of shared contracts**: `Play`/`PlayHero` and every
  synced record shape, the sync protocol (docs/design/02), the backup format
  (`formatVersion` 2 since achievements; read 1 and 2, write 2, **preserve
  unknown fields**), the BGG comment format (`Win — Rhino`, tested in
  `test:bgg`), the campaign templates, `statistics.md` numbers
  (`test:parity`).
- **Never commit or re-host card data or card images.** `public/data/` is
  ignored; only `web/public/art/campaigns/fne.jpg` (FFG announcement art,
  a deliberate single exception, © Marvel) is bundled.
- **Deployment is pull-based by design** (no SSH from GitHub). Keep it.
- **Site waits for API** rule in `release.sh`. Keep it.
- **Data minimisation**: no analytics, no third-party scripts, images from
  MarvelCDB only, BGG relay stores nothing.
- Achievements are **derived, never stored** (spec in
  `docs/spec/achievements/`); every seat at the table counts (decided
  2026-09-19; `isOwner` is recorded but decides nothing); distinct days are
  UTC; a play's `mode: 'draft'` comes from the deck's `draft` tag.
- Draft: packs are built before the first pick, one physical copy in one
  pack, only full packs, rebuilt from the shelf when exhausted; the shelf
  shows a card as the printing you own (reprints fold to the owned one).
- Difficulty scale for achievements: `unknown < standard < expert`,
  unrecognised strings are `unknown`, never Standard.
- Typography: prose measure `--prose-max: 60rem`; **no em dash in any
  user-facing text** (owner's rule; code comments may keep them).
- Bottom safe-area inset is applied only under `display-mode: standalone`
  (Chrome Android moves the value with its toolbar; caused a jumping tab
  bar).
- Grouped Play tab is the default; Home is in the top bar and the More
  sheet, not a tab.
- `.app` is HSTS-preloaded: there is no plain-HTTP mode, ever.

---

## 8. Known issues and technical debt

- `docs/deployment.md` opens with "the account API does not exist yet" and
  lists "no automatic backups": both stale; the sections on nginx, TLS,
  release flow and rollback are still right.
- The nginx route regex is duplicated (repo conf vs live file) and must be
  edited by hand on the host for each new route.
- No monitoring/alerting: a failed nightly build or a stuck release is only
  visible in `journalctl`.
- The service worker needs two loads after a release to show new data
  (stale-while-revalidate). Nothing tells the user; the owner knows.
- The API has never been load-tested; Argon2 costs 64 MiB per login.
- The card-data cache in CI is keyed on the fetch scripts only; a MarvelCDB
  data change is picked up only when the cache is evicted (≈7 days) or via
  the manual trigger.
- Test scripts are a home-grown harness (`check(label, ok)`), not a
  framework; failures print `FAIL` lines and exit 1.
- Some villains and heroes have no image on MarvelCDB; the UI falls back
  to a blank tile rather than a broken image.
- `web/src/lib/changelog.ts` is hand-maintained; add an entry per release.
- Password SSH auth on the VPS: status **Unknown / requires confirmation**.
- `.gitignore` says a real `.env` "holds the session signing key" and that
  `.env.example` is shipped. Neither is true today: the server reads no
  environment variable and no `.env.example` exists. Whether a signing key
  was ever planned: **Unknown / requires confirmation**.
- "No em dash" rule: check both the literal character and the `\u2014`
  escape when adding strings; the sweep missed the escape once.

---

## 9. Recent development history (Sept 2026)

Chronological, all on `main`:

1. Fear No Evil aligned to the English rulebook; BGG connection with
   server relay (`server/bgg.go`); SEO pass (per-route heads, JSON-LD,
   sitemap, Search Console tag, static prerendered home, real 404s, code
   splitting, lazy strings); campaign tiles with villain faces; footer
   links (Patreon, Android, GitHub, mailbox).
2. Synergy (deck editor warning, `synergy.json` fixture shared with Android)
   and the draft (engine mirrors Android's `domain/draft`, then reworked to
   pre-built packs, spec `docs/spec/synergie-et-draft.md` decisions section).
3. Release plumbing incidents and fixes: stale card data shipped because the
   host skipped a refetch → `scriptDigest` guard in `update.sh`; `/draft` 404
   in production → nginx route list (hand edit); a `cp` of nginx conf broke
   HTTPS → rule in §5.6; a test reading the index ran before CI's data step
   → moved to a later test (`test:tile`).
4. History with villain faces and the tracker's rounds/villain stage written
   as notes lines (`Rounds: n`, `Villain stage: X`, parsed by
   `lib/playNotes.ts`); FNE key art on campaign tiles.
5. Play hub gains Draft; grouped Play tab by default.
6. Fear No Evil outside the campaign (`lib/fearNoEvil.ts`, codes
   `fne_<job>__<villain>`, spec `docs/spec/fear-no-evil-one-off.md` copied
   from Android, `test:fne-solo`).
7. Home page at `/` (search moved to `/cards?q=`), changelog block,
   achievements strip.
8. **Achievements**: spec (5 files, 31 shared vectors), backup format 2 with
   unknown-field preservation (`extra`), definitions file
   `web/public/achievements.json` (schemaVersion 1, definitionsVersion 1),
   pure derivation, `/achievements` page (portrait tiles + "sticker album"
   of villains per hero), hub tile, toast after a game. The Android port is
   pending and is expected to use the same vectors.
9. Phone fixes: layout overflow from tooltips, tab-bar height flicker
   (inset only when installed).

Deliberately unfinished: Android port of achievements and of the pack-based
draft; monitoring; optional network override of the achievements
definitions (spec says not in v1).

---

## 10. Remaining work

Known requirements (agreed with the owner):
- Keep `docs/spec/achievements/` and `web/public/achievements.json` in sync
  with the Android port when it lands (byte-identical snapshot test on
  Android; the web fixture `web/scripts/fixtures/backup-android-v2.json`
  should be replaced by a real Android export).
- Add a changelog entry for each release.
- Hand-edit nginx on the host for any new route.

Speculative improvements (not requested):
- Monitoring/alerting for the nightly build and the release timer.
- Bilingual URLs with `hreflang`; content pages per scenario/hero.
- Reduce TBT of the first load (Svelte/Dexie/sync in the entry chunk).
- Fetch achievement definitions over the network as an override (v2 idea).
- Feats achievements needing duration/end-state fields (parked in the spec).
- Fix `docs/deployment.md`'s stale intro and "not here yet" list.

---

## 11. Instructions for coding agents

- Read the relevant spec in `docs/spec/` before touching a feature engine;
  the Android app implements the same rules and the vectors are the
  contract. Changing a shared rule means changing the spec, the reference
  vectors and telling the owner.
- Never modify the Android repository; never break record shapes; unknown
  fields must survive import → export and sync.
- `npm run check` must be 0 errors and 0 warnings (unused CSS selectors are
  warnings and fail CI). Run the affected `test:*` scripts and, before
  pushing, the whole set plus `go vet`, `gofmt -l .` and `go test ./...`.
- A test that needs `public/data` must be wired **after** the "Fetch card
  data" step in `ci.yml`, or it will fail in CI only.
- Commit as the owner, English imperative subject, explanatory body, no AI
  co-author trailer. Tell the owner before pushing; the owner says "push".
- Any change under `server/` holds the site until "Release the API" is
  pressed: say so explicitly.
- Never `git add -A` (a sibling session may be working in the same
  checkout); add named paths.
- Never commit secrets, card data, or card images; `.gitignore` already
  blocks the usual paths.
- On the host: read-only inspection over SSH is fine; never `cp` the nginx
  conf, never run migrations without a fresh backup, never touch
  `release`/`api-release` by hand, restart the API only through the release
  flow unless rolling back.
- UI text: both languages, no em dash, French typographic apostrophe and
  narrow spaces as in the existing strings; prose stays within
  `--prose-max`.
- Adding a page: `router.ts` (route + `pathForRoute`), `App.svelte` (lazy
  chunk), `nav.ts` if it has a menu entry, `head.ts` (title, description,
  `noindex` if private), both string bundles, `sitemap.xml` if public,
  `deploy/nginx-thwart.app.conf` **and** the live nginx file on the host,
  then `test:nav` and `test:head`.
- Dexie: never edit an existing `db.version(n)` block in `src/lib/db.ts`;
  add version n+1 with an upgrade step. Existing installs must open.
- Files needing extra caution: `web/src/lib/records.ts`, `playShape.ts`,
  `sync/collections.ts`, `backup.ts` (contracts); `server/store.go`
  (migrations); `deploy/release.sh`, `update.sh` (deployment);
  `.github/workflows/*` (the handshake); `src/sw.js` (caching).
