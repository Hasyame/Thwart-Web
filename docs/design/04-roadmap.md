# 04 — Repository layout and roadmap

---

## ADR-301 — The server and web app live in their own repository

**Status:** Accepted, 2026-08-30.

### Context

Three candidate homes: inside `Hasyame/Thwart`; in a new monorepo holding all
three components; or in a separate repository, which is what this document is
being written in.

There is an existing arrangement to respect. `Hasyame/Thwart` is public — what
users, F-Droid and any contributor see — and `Hasyame/Thwart-dev` is private,
where work happens. `docs/REPO_SETUP.md` in the Android repository explains why:
nobody can fork a repository they cannot see, so contributions have to arrive
somewhere public.

### Options considered

**Everything in `Thwart`.** One clone, one issue tracker, atomic commits across
Android and server. Against it, decisively: **the Android repository is under
F-Droid's build pipeline.** Merge request !45283 is still open and being
reviewed by hand, and any change to *how the app builds* — a new module, a new
dependency source, a restructured Gradle layout — needs a fresh merge request
and another wait in that queue. Dropping a Go server and a Node toolchain into
that repository puts a side project on the critical path of an app release. It
also means every contributor cloning the app for a one-line string fix pulls the
server with it.

**A new monorepo containing all three.** Solves the shared-data problem
elegantly and gives one CI pipeline. Requires migrating the Android app out of a
repository that F-Droid builds from by commit hash, which is precisely the
change that costs another review cycle. The benefit does not come close to
paying for that.

**A separate repository** — `Hasyame/Thwart-Web`, this one. The server and web
app share a language boundary with each other and almost nothing with Android
except data definitions. They ship on their own cadence, they have their own
CI, and their failures cannot reach the app.

### Decision

**A separate repository**, as set up. The Android app stays exactly where it is
and is not restructured.

Two notes on the arrangement:

- **The name is slightly wrong and we are keeping it.** `Thwart-Web` holds the
  sync server as well, and the server is arguably the more important half —
  Phase 0 ships it with no web app at all. `Thwart-Sync` or `Thwart-Server`
  would describe the contents better. Raised on 2026-08-30 and settled in favour
  of keeping `Thwart-Web`. Renaming a GitHub repository is cheap and redirects
  old URLs, so this stays reversible if it ever starts to grate.
- **One repository here, not a dev/public pair.** The Android split exists
  because F-Droid builds from the public repository and releases need a clean
  public history. Neither applies here. Keep `Thwart-Web` private until Phase 0
  is running, then make it public in place — the whole history was written to be
  read, and there are no signing keys or credentials in it.

### The shared data package: not yet

The campaign templates, `pack_metadata.json`, `scenario_rules.json`,
`rules_reference.json`, `set_name_overrides.json` and the four seed colours in
`Color.kt` should eventually be one source of truth consumed by three clients.
Today they live in `app/src/main/assets/`, which makes Android the de facto
owner.

**Do not extract them now.** Phase 0 does not read a single one of them — the
server is dumb by design and would not know a campaign template from a
photograph. Extracting a shared package before there is a second consumer buys a
submodule dance, a version-skew question and a release ordering problem, in
exchange for nothing.

**Extract at the start of Phase 1**, when the web app becomes a real second
consumer, as `Hasyame/Thwart-Data`: a small repository holding the JSON, a JSON
Schema for the campaign template format (`schemaVersion` is already in the
files, so the format is half-declared already), and the theme seed colours.
Android consumes it as a git submodule copied into assets at build time; the web
app consumes it as an npm dependency or a submodule; the server consumes it not
at all. Version it with plain semver tags so a client can pin.

The one thing worth doing *before* then is writing the JSON Schema for the
campaign template. `docs/campaign-templates/TEMPLATE_BLANK.json` and
`QUESTIONNAIRE.md` already document the format in prose, and the `data.yml`
workflow already validates every bundled campaign in CI. Turning that into a
schema file makes the eventual extraction mechanical instead of archaeological.

---

## The roadmap

### Your ordering is right. It needs one phase in front of it.

Your instinct — sync first with one client, then a read-only web view, then a
full PWA — is correct, and for the right reason: **validating the protocol
against one client before a second exists** is the single most valuable
sequencing decision available. Two clients and an unproven protocol is how you
end up debugging a merge bug and a UI bug at the same time, unable to tell which
is which.

Two amendments.

**Amendment 1: a Phase 0 that ships before the server exists.** Accepted
2026-08-30. Doc 01 §5 found
that no table has `updatedAt` and every delete is a hard delete. Those columns
have to be in the field, populated on real installs, before sync can work at
all. If they ship in the same release as sync, then on day one every existing
row has `updatedAt` seeded from a migration and no history of real edits — and
worse, you have shipped the largest and riskiest diff (twenty-one DAO deletes
becoming soft deletes, every read query gaining a filter) simultaneously with a
network feature, so any bug reported in the first week could be either.

Ship the schema change on its own, as an ordinary release that changes no
behaviour a user can see. Let it bake for a few weeks. Then build the server
against a population whose rows already carry honest timestamps.

**Amendment 2: your Phase 1 SEO rationale does not work as stated.** "A
read-only web view: card search, collection, statistics" is described as good
for SEO and discovery. But a collection and statistics are *behind an account* —
crawlers cannot see them, and you would not want them indexed if they could. The
SEO value lives entirely in the part that needs no account: public card pages
and a public card search.

So Phase 1 splits. The public card browser is genuinely low-risk, genuinely
indexable, needs no login and no sync, and is the natural first thing to build
in the new front-end stack. The account view is a separate, later slice. This
also fixes the stale `.gitignore` comment noted in doc 01 §9, which describes a
web card browser that was planned and never built.

---

## Phase 0a — Make the Android schema syncable

**Ships as an ordinary Android release. No server, no account, no visible
change.**

Deliverables:

- Room schema 17: `updatedAt` and `deletedAt` on the nine user tables, as an
  `AutoMigration`, plus the handwritten `UPDATE`s seeding `updatedAt` from each
  table's natural timestamp (doc 01 §5).
- Every user-data delete becomes a soft delete; every read filters
  `deletedAt IS NULL`.
- `updatedAt` written on every mutation, enforced in the repositories.
- `sync_state(collection, id, serverRevision, dirty)` table, unused for now.
- `excludedScenarios` and the settings keys added to the `Backup` format.
- A test asserting that every user-table read query filters tombstones.

**Done when**: the release is out, and a device that upgrades from 1.35 shows
identical data with identical counts on every screen. The riskiest change in the
whole programme is one where success looks like nothing happening.

---

## Phase 0b — Sync server and opt-in accounts

**The phase that solves your actual problem: your own phone and tablet.**

Deliverables:

*Server*
- Go service implementing doc 02: eleven endpoints, SQLite, Argon2id, opaque
  device tokens.
- Registration with no email; recovery code generated, shown once, downloadable.
- The per-account revision transaction, with a test that runs concurrent pushes
  and asserts no puller can skip a revision. **This test is the deliverable**;
  the rest of the server is straightforward.
- Tombstone cleanup job and a published `minCursor`.
- `GET /v1/account/export` emitting the app's own `Backup` shape.
- `DELETE /v1/account`, actually deleting.
- `docker-compose.yml` and `.env.example`; a stranger clones and runs it.
- FR and EN strings for the fixed error-code set.

*Android*
- Settings screen: sign in, sign out, account status, last sync time. Off by
  default and clearly optional.
- Background sync via WorkManager, with manual "sync now".
- The first-sign-in adoption flow from doc 02 §6, **including the confirmation
  screen with counts**, the export-before-replace safeguard, and the fork rule
  for edited decks.
- Full-resync path when the cursor falls below `minCursor` — the same
  reconciliation code as first sign-in.

*Operations*
- Deployed on your VPS behind nginx with TLS; doc 05.
- Backup running and, more importantly, a restore actually performed once.

**Done when**: your phone and tablet hold the same data; a play recorded on one
appears on the other; a deck deleted on one stays deleted; both devices can be
flown offline for a week, edited independently, and reconciled without losing a
campaign event. And — the acceptance test that matters — **a fresh install with
existing anonymous data can sign in to an account that already has data and end
up with the union of both, having been asked first.**

Also done when someone who is not you can `git clone`, edit one `.env`, run
`docker compose up`, and register an account.

---

## Phase 1a — Public card browser

**No accounts. No sync. Static, indexable, bilingual.**

This is where the front-end stack gets built and proven on the low-stakes half.

Deliverables:

- Extract `Hasyame/Thwart-Data` (see above) and make Android consume it.
- Vite + TypeScript + Svelte project; M3 tokens generated from the app's seed
  colours (doc 03, ADR-204).
- A build step fetching card data from MarvelCDB — **never committed**, exactly
  as the Android repository already refuses to commit its seed.
- Card search and card detail pages, FR and EN, pre-rendered so each card is a
  real indexable URL.
- Pack and scenario listings.
- Deployed as static files. No server involvement at all.

**Done when**: a card page loads in under a second on a phone, is indexed by
Google under both its French and English names, and links back to MarvelCDB and
to the Android app. And when it re-hosts no card images — link to the existing
public sources exactly as the app does.

---

## Phase 1b — Read-only account view

Deliverables:

- Sign in with the Phase 0b credentials; pull only, never push.
- Collection, decks, play history, campaign list.
- The richer statistics you want: win rates by hero, by aspect, by
  hero-and-aspect pairing from `roster`, by scenario, over time. This is the
  first place the data has room to be shown properly, and the `roster` field
  already carries what the Android statistics screen was rebuilt to use.
- Session in memory, not `localStorage`, while the app is read-only.

**Done when**: you can look at your own statistics on a laptop, and the sync
protocol has been exercised by a second, independently written client — which
is the real point of this phase. Any protocol ambiguity that survived Phase 0b
surfaces here, in a client that cannot push and therefore cannot damage
anything.

---

## Phase 2 — Full read/write PWA

Deliverables:

- IndexedDB persistence via Dexie; the anonymous user is first-class and the
  app works with no account, as the Android app does.
- Service worker, offline shell, installable.
- Write paths: collection, decks, play recording, campaign play.
- Push, including the adoption flow — a browser that has been used anonymously
  and then signs in hits exactly the case doc 02 §6 describes, and this is the
  second implementation of that logic, so it is where a spec ambiguity becomes a
  bug.
- Full conflict handling including the deck fork rule.

**Done when**: the web app is a complete alternative to the Android app for
everything except playing at the table, and three clients can be edited offline
and reconciled.

---

## Later, deliberately unscheduled

- **Photograph sync.** The only binary content, the only content that could hold
  someone's face, and the only thing that would need object storage and a
  bandwidth budget. Opt-in when it happens.
- **Optional email.** As a separate table with no row for most accounts, purely
  for people who want password reset by mail and can run SMTP.
- **Sharing.** A read-only link to a deck or a campaign log. Genuinely useful,
  and a completely different security model — it is the first feature that would
  make any of this data public, so it deserves its own design document rather
  than an afterthought here.

---

## What this ordering protects

Each phase leaves something worth having even if the next never happens.

- After **0a** the app is unchanged but ready, and the schema work has been
  de-risked in isolation.
- After **0b** your phone and tablet sync. If the web app is never built, the
  project has still solved the problem you actually have.
- After **1a** there is a public, indexable card browser — the thing most likely
  to bring people to the Android app, and it depends on none of the sync work.
- After **1b** the protocol has two independent implementations, which is the
  only way to find out whether doc 02 is a specification or a description of
  one program's behaviour.
- **2** is the only phase that is all-or-nothing, and by then everything
  underneath it has been in production for months.
