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

**Revised 2026-08-30.** The original ordering put the sync server first and the
web app second. Benoît has reversed that: **the website comes first, and it
mirrors the app.** Sync is deferred, not cancelled — docs 01 and 02 stand
unchanged and are picked up when it returns.

### What the reversal costs, honestly

The original ordering had one strong argument behind it: validating the sync
protocol against a single client before a second one exists. That argument is
now moot rather than defeated — there is no protocol running to validate,
because there is no server. Nothing is lost today.

The real risk arrives later. Building a second full client *before* sync means
that when sync does come, there are two independently grown local data models
to reconcile instead of one, and the web app will have had a year to drift.

**The mitigation is cheap and must be adopted from the first line of storage
code:** the web app's local database stores the *same record shapes* as the
Android app's `Backup` bundle — same field names, same types, same ids. Not a
similar shape, the same one. Doc 01 §7 already establishes that bundle as the
interchange format. If that discipline holds, adding sync later is adding a
transport to a data model that already matches, which is the easy version of
this problem. If it slips, sync becomes a migration project.

### What the reversal makes easier, which is more than it costs

- **The Android app is not touched at all.** Phase 0a — schema 17, twenty-one
  deletes becoming soft deletes, every read query gaining a filter — was the
  riskiest diff in the whole programme, and it is now off the table until sync
  is real. The app keeps shipping as it does today, and F-Droid's open merge
  request is undisturbed.
- **No server means no operations.** Doc 05 describes a thing you have promised
  to keep running. Deferring it defers the backups, the TLS renewal, the rate
  limiting, the tombstone cleanup job, and the standing obligation. The web app
  is static files.
- **No Go yet.** ADR-201 stands, but the language you have not learned is not on
  the critical path. Everything in the next several months is TypeScript.
- **The repository name stops being wrong.** ADR-301 noted that `Thwart-Web`
  undersells a repository whose first deliverable was a sync server. Under the
  new ordering the first deliverable *is* the web app, so the name is simply
  accurate.
- **It suits the machine you are on.** The deferred half — Docker, nginx,
  SQLite backup timers, a Debian VPS — is the Linux-shaped work. The web app is
  Node and a browser, which is the most Windows-native part of the whole
  programme. Vite, TypeScript and Svelte need nothing but a Node install, and
  the Android app already builds on Windows through `gradlew.bat`.

### The bridge, while there is no sync

Without a server the web app's data lives in one browser and goes nowhere. That
would make it a demo rather than a companion.

**Use the bundle the app already writes.** `BackupRepository` exports the whole
of a user's data as JSON, and `Backup` is already the agreed interchange shape.
The web app imports it and exports it back. That gives real cross-device data
movement on day one, by way of a file the user moves themselves — the poor
relation of sync, but honest about what it is, and it needs nothing from a
server.

It also forces the shared-data-model discipline described above, at exactly the
point where it is cheapest to enforce: if the web app can round-trip a real
backup from a real phone, its record shapes are correct by demonstration rather
than by intention.

---

## W0 — Foundations

No user-visible feature. The scaffolding everything else stands on.

- Vite + TypeScript + Svelte project; ESLint, Prettier, `tsc --noEmit` in CI.
- M3 tokens generated at build time from the app's seed colours — `IronRed
  #E30022`, `BrassGold #D3AF37`, `ArcGold #FCC200`, `PanelInk #1A1113`,
  `PaperWarm #FFF8F6` — via `@material/material-color-utilities` (ADR-204).
  Light and dark, emitted as CSS custom properties.
- FR/EN from the start, as a plain typed dictionary module. Two languages and no
  pluralisation worth the name does not justify an i18n framework; a `Record<Lang,
  Record<Key, string>>` with a `tsc` error on a missing key is smaller, faster
  and impossible to get subtly wrong.
- A build step fetching card data from MarvelCDB into `web/public/data/`,
  **never committed** — the Android `.gitignore` already refuses the same thing
  for the same copyright reason, and this repository's `.gitignore` was written
  to match.

**Done when** a page renders in both themes and both languages, and CI builds it
from a clean clone.

### One sizing decision to make here

The generated card dumps are 2.3 MB (`cards.en.json`) and 2.5 MB
(`cards.fr.json`). Shipping either to a browser as one blob is not acceptable
on a phone.

Split them: a **trimmed search index** carrying only what a result row needs —
code, name, faction, type, pack, cost — which compresses to a couple of hundred
kilobytes and can load up front; and the **full card records** fetched per card,
or baked into pre-rendered pages. Decide this in W0, because both W1 and W2
build on top of whatever it is.

---

## W1 — Public card browser

The app's card search and card detail, on the web. No account, no local state,
nothing to persist.

- Card search with the same accent- and case-insensitive behaviour as the app.
  `SearchNormalizer` already defines the rule — fold accents and case at write
  time and again on the query — and the web implementation should match it
  exactly, not approximately, or the two apps will disagree about whether
  `strategie` finds `Stratégie`.
- Card detail pages, pre-rendered so each card is a real indexable URL in both
  languages.
- Pack and scenario listings.
- Links out to MarvelCDB. **No card images re-hosted** — reference the existing
  public sources exactly as the app does.

**Done when** a card page loads in under a second on a phone, is indexed under
both its French and English names, and search results match what the Android app
returns for the same query. That last one is the real acceptance test, and it is
worth building a small fixture of tricky queries — accents, partial names,
traits — and asserting both clients agree.

This is also the phase that quietly retires the stale `.gitignore` comment noted
in doc 01 §9, which describes exactly this browser as something that was planned
and never built.

---

## W2 — Collection, local persistence, and the backup bridge

The first phase with user data in it, and the one that sets the data model for
everything after.

- IndexedDB via Dexie, with **record shapes identical to the `Backup` bundle**.
- Collection management: owned packs with quantities, excluded modular sets,
  excluded scenarios — matching the app's semantics, including "absence means
  owned" for the exclusion tables.
- Favourites.
- **Import a `Backup` file exported from the Android app**, and export one back
  that the app can restore.
- A plain statement in the UI that data lives in this browser only, with the
  export as the answer.

**Done when** a backup exported from a real phone imports cleanly, the
collection matches what the phone shows, and exporting from the browser produces
a file the phone restores without complaint. Round-tripping a real device's data
is the acceptance test; a synthetic fixture is not sufficient here, because the
fixtures will be written from the same misreading as the code.

Worth fixing in the app around now: `Backup` omits `excludedScenarios` entirely
(doc 01 §7), so a round trip silently loses them. That is a genuine bug in the
existing backup feature, independent of any of this, and W2 is where it would
first be noticed.

---

## W3 — Randomizer, play history and statistics

- Scenario and hero randomiser, honouring the collection and the exclusions.
- Play logging, matching `PlayEntity` field for field — including `roster`,
  which is what the app's statistics were rebuilt to count.
- **The richer statistics.** This is the reason a web app is worth building at
  all: a laptop screen has room the phone does not. Win rate by hero, by aspect,
  by hero-and-aspect pairing, by scenario, by player count, over time.
- Randomizer history with the `beaten` flag.

**Done when** the statistics agree with the Android app's for the same imported
data. Any disagreement is a real bug in one of the two, and finding out which is
the point.

---

## W4 — Deck import

- Import from marvelcdb.com by URL or id, matching the app's id scheme
  (`decklist-12345`, `deck-12345`, `local-<uuid>`).
- Deck view with the card list.
- `rawJson` retained exactly as the app retains it.

**Done when** a deck imported on the web and the same deck imported on the phone
produce the same record, id included. That equality is what makes them merge
cleanly when sync eventually arrives.

---

## W5 — Campaign engine

By a distance the largest piece, and the one to do last.

The Android engine is data-driven: a template of counters, flag sets, card lists
and scenarios, folded over an append-only event log of fifteen event types. The
whole of a campaign's state is derived, never stored — which is excellent design
and does not make the port small. It means reimplementing the fold in TypeScript
and keeping two implementations in agreement about the semantics of every event
type, indefinitely.

- **Extract `Hasyame/Thwart-Data` here**, not before. This is the phase with a
  genuine second consumer of the campaign templates, `pack_metadata.json`,
  `scenario_rules.json` and `rules_reference.json`. Extracting earlier buys a
  submodule dance and a version-skew problem for nothing.
- Write the JSON Schema for the campaign template format first. The prose exists
  in `docs/campaign-templates/QUESTIONNAIRE.md` and `TEMPLATE_BLANK.json`,
  `schemaVersion` is already a field, and `data.yml` already validates every
  bundled campaign in CI. Turning that into a schema is what makes the port
  mechanical instead of interpretive.
- Port the fold. Then **test it against the Kotlin implementation** by running
  both over the same event logs and asserting identical derived state. Nine
  campaigns are bundled; that is nine free test cases, and they are the only
  thing that will keep the two engines honest.

**Done when** a campaign started on the phone, exported and imported, shows
identical state on the web — and vice versa.

If this phase looks too large when you reach it, it is entirely reasonable to
stop at W4 and leave campaigns to the Android app. The web app is useful without
them; the statistics alone justify it.

---

## Deferred — sync

Docs 01 and 02 are unchanged and remain the plan. When sync returns, it runs in
this order:

1. **Android schema 17** — `updatedAt`, `deletedAt`, soft deletes, `sync_state`.
   Shipped as a release with no user-visible change, allowed to bake.
2. **The Go server** — doc 02, deployed per doc 05.
3. **Android sign-in and sync**, including the adoption flow.
4. **Web sign-in and sync**, which by then is adding a transport to a data model
   that already matches — provided W2's discipline held.

The web app should be built so that this is an addition rather than a rewrite:
storage behind a small interface, no assumption that the local database is the
only copy, and record shapes that already match the bundle. None of that costs
anything now, and all of it is expensive to retrofit.

---

## What this ordering protects

- After **W1** there is a public, indexable card browser — the thing most likely
  to bring people to the Android app, depending on no server and no account.
- After **W2** the web app is genuinely useful, and data moves between phone and
  browser by a file the user controls.
- After **W3** the statistics exist, which is the feature the phone cannot do
  justice to and the clearest reason for the web app to exist.
- After **W4** everything except campaigns is covered.
- **W5** is optional, and can be abandoned without stranding anything.
- **Sync**, whenever it comes, arrives to find two clients that already agree
  about what a play is.
