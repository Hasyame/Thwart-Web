# 01 — Audit of the Android data layer

Audited against `Hasyame/Thwart-dev` at `dev`, version **1.35.0** (`versionCode`
55), Room schema **version 16**. The kickoff brief said 1.22.x; the working copy
is thirteen minor versions further on, so everything below describes 1.35.0.

The headline, before the detail: **the thing you were most worried about is
already fine.** There is not a single auto-increment key in the database. Every
user-owned row is keyed either by a client-generated `UUID.randomUUID()` string
or by a natural code that is already globally meaningful. The migration you were
bracing for does not need to happen.

What *is* missing is smaller and duller: no row anywhere carries an
`updatedAt`, and every delete is a hard `DELETE FROM`. Those two gaps are the
real work, and they are additive column changes Room can migrate itself.

---

## 1. The three kinds of data

The database mixes them in one file, which `MarvelChampionsDatabase.kt` already
says out loud in its class comment. Sync has to take them apart.

| Kind | Tables | Syncs? |
|---|---|---|
| **Reference cache** | `cards`, `cards_fts`, `packs`, `pack_translations` | Never |
| **Reference assets** | `assets/campaigns/*.json`, `pack_metadata.json`, `rules_reference.json`, `scenario_rules.json`, `set_name_overrides.json` | Never |
| **User data** | `owned_packs`, `excluded_modular_sets`, `excluded_scenarios`, `favourite_cards`, `saved_decks`, `campaign_runs`, `campaign_events`, `plays`, `randomizer_history` | Yes |
| **Device-local** | `paused_games`, part of the settings store, the BGG secret | No — see §6 |

### Reference data must never touch the server

`cards` is a cache of MarvelCDB, wiped and rebuilt per locale
(`DELETE FROM cards WHERE locale = :locale`). `cards_fts` is an FTS4
external-content index over it, maintained by Room. `packs` and
`pack_translations` are the same story with a curated overlay from
`pack_metadata.json`.

Beyond being pointless to sync — every client can fetch it — this is the
**copyright line**. The Android `.gitignore` already refuses to commit
`app/src/main/assets/seed/` because it is Fantasy Flight's card text. The server
inherits that rule without exception: it stores card *codes*, never card text,
never images. A sync server that accepted a card row would be re-hosting FFG's
text under your name on your VPS.

The campaign templates are the interesting middle case. They are committed,
deliberately, because they hold mechanics only — the note at the top of
`mts.json` is explicit that there is no rules text and no book text in them.
They are still reference data: shipped with the client, identical for every
user, referenced from `campaign_runs.templateJson`. They should become the
shared package described in doc 04, not sync payload.

---

## 2. User-owned entities, in full

### 2.1 `owned_packs` — the collection

```
packCode  TEXT  PRIMARY KEY   -- natural key, MarvelCDB pack code
quantity  INTEGER NOT NULL    -- 2 is a real answer; a second Core Set exists
```

No foreign key to `packs`, on purpose: announced packs can be owned before
MarvelCDB has entered them. That decision is load-bearing for sync too — it
means the server never has to validate a pack code against anything, which is
exactly what a dumb server wants.

Deletion is `DELETE FROM owned_packs WHERE packCode = :packCode`, so "I no
longer own this" and "I never owned this" are currently the same state. That is
the gap tombstones close.

### 2.2 `excluded_modular_sets` and `excluded_scenarios`

```
setCode      TEXT PRIMARY KEY
scenarioCode TEXT PRIMARY KEY
```

**Presence-only tables**: the row carries no value, the row *is* the value. The
comment on `ExcludedModularSetEntity` says it — absence means owned, only the
exceptions are stored.

This shape is hostile to last-write-wins, because "row absent" is ambiguous
between *never excluded* and *un-excluded on the other device*. Two options,
both workable:

- keep the table as-is and let tombstones disambiguate (a deleted row has a
  tombstone, a never-created row has nothing), or
- add an `excluded BOOLEAN` column and stop deleting rows at all.

I recommend the first. It needs no schema change beyond the tombstone columns
every other table is getting anyway, and it keeps the "a clean collection costs
no rows" property the comment is proud of.

### 2.3 `favourite_cards`

```
cardCode TEXT PRIMARY KEY   -- natural key
addedAt  INTEGER NOT NULL
```

Natural key, single scalar, no conflict worth the name. `addedAt` gives a free
tie-break: on a merge, keep the earlier one, because the card was in fact
starred then.

### 2.4 `saved_decks`

```
id                    TEXT PRIMARY KEY   -- 'decklist-12345' | 'deck-12345' | 'local-<uuid>'
marvelCdbId           INTEGER
kind, url, name       TEXT
heroCode, heroName    TEXT
aspects               TEXT               -- comma separated
slots                 TEXT               -- 'code=qty' pairs, comma separated
ignoreDeckLimitSlots  TEXT
descriptionMd         TEXT NULL
version, tags         TEXT NULL
rawJson               TEXT               -- untouched API response
lastSyncedAt          INTEGER
locallyEdited         BOOLEAN DEFAULT 0
```

The key is **semi-natural**, and this is the one place the key scheme has a real
consequence. Two devices importing MarvelCDB decklist 12345 both produce the row
`decklist-12345`. Within one account that is a happy accident: the import is
idempotent and you get one deck, not two.

It stops being happy when `locallyEdited` is true on both sides with different
contents. Then last-write-wins silently discards somebody's edits to a deck they
think of as theirs. `rawJson` softens it — the original import is always
recoverable — but the local edits are not. Handled in doc 02 §6.

Locally created decks use `local-<uuid>` (`DeckRepository.kt:153`) and have no
such problem.

`rawJson` is also the largest user-owned field in the schema. A deck's raw
MarvelCDB response is a few kilobytes; a heavy user with a hundred saved decks is
still well under a megabyte. Nothing here needs blob storage.

### 2.5 `campaign_runs`

```
id                     TEXT PRIMARY KEY   -- UUIDv4
templateId             TEXT
templateName           TEXT
name                   TEXT DEFAULT ''
difficulty             TEXT
standardSet            TEXT DEFAULT ''
createdAt              INTEGER
finished               BOOLEAN
templateJson           TEXT               -- the template as imported
timerAccumulatedMillis INTEGER
timerRunningSince      INTEGER NULL
timerScenarioId        TEXT NULL
```

`CampaignRunEntity`'s comment is the single most useful thing in the schema for
our purposes:

> **All campaign state is derived from `CampaignEventEntity`** by folding, so
> nothing about counters, flags or progress is stored — storing it would let the
> two disagree.

An event-sourced campaign is a campaign that merges for free. Whoever wrote that
comment solved half the sync problem eighteen months early.

Two caveats on the header row:

- `templateJson` embeds a copy of the whole template — tens of kilobytes per
  run. Correct for the app (a run stays readable if the file moves), wasteful
  over the wire. Push it once; it never changes after creation.
- **The timer fields are not user data, they are device data.**
  `timerRunningSince` is a wall-clock instant on *one* phone. Syncing a running
  timer between two devices produces a number that is wrong on both. Either
  exclude the three timer columns from the synced body, or merge
  `timerAccumulatedMillis` with `max()` rather than last-write-wins. I would
  exclude them; a campaign timer is a thing you look at on the device in front
  of you.

### 2.6 `campaign_events` — the append-only log

```
id        TEXT PRIMARY KEY   -- UUIDv4, generated once, stable
runId     TEXT  -> campaign_runs.id  ON DELETE CASCADE
timestamp INTEGER
payload   TEXT               -- serialised CampaignEvent
```

The comment says it outright: *"[id] is stable and generated once, which is what
makes merging two devices' logs idempotent."* Exactly right, and it means union
merge is not merely possible here but already anticipated.

Fifteen event types are defined in `CampaignEvent.kt`, discriminated by
`@SerialName`: `setup`, `scenario_result`, `purchase`, `purchase_refund`,
`continued`, `setup_action`, `setup_draw`, `setup_choice`,
`environments_offered`, `environment_chosen`, `campaign_conceded`,
`scenario_chosen`, `manual`, `revoke`, `timer`.

`revoke` (`EventRevoked`) is the part that matters: **the log already handles
undo as an appended event rather than a deletion.** That is a tombstone living
inside the log, which is the property that makes union merge safe. The engine
folds a revoked event away; the row stays. So `campaign_events` needs no
tombstone column and can never conflict.

The one real hazard is the `ON DELETE CASCADE`. Deleting a run destroys its
events locally; if the events are then re-pulled from the server they resurrect
orphaned. The tombstone on the run has to imply tombstones on its events —
spelled out in doc 02 §5.

### 2.7 `plays` — the play history

```
id             TEXT PRIMARY KEY   -- UUIDv4
playedAt       INTEGER            -- indexed
scenarioCode, scenarioName  TEXT
difficulty     TEXT
standardSet    TEXT DEFAULT ''
modularSets    TEXT DEFAULT ''    -- codes, comma separated (added later, for "play again")
heroCode, heroName TEXT           -- indexed on heroCode
aspects        TEXT               -- comma separated
otherHeroes    TEXT
roster         TEXT DEFAULT '[]'  -- JSON List<PlayHero>, via PlayHeroConverters
players        INTEGER
won            BOOLEAN
elapsedMillis  INTEGER
notes          TEXT
location       TEXT DEFAULT ''
victoryPoints  INTEGER DEFAULT 0
campaignRunId  TEXT NULL          -- soft reference, no FK
reportedToBgg  BOOLEAN
photos         TEXT DEFAULT ''    -- file names, comma separated
```

Deliberately flat and self-describing — hero and scenario *names* are stored
next to their codes so a two-year-old play stays legible after a card database
rebuild. That is also what makes a play safe to sync: the row means something on
its own, without a join against reference data the server does not have.

**It is not append-only, despite reading like it.** `PlayDao` has
`DELETE FROM plays WHERE id = :id`, and `notes`, `photos`, `victoryPoints` and
`reportedToBgg` are all edited after the fact. Classify it as mutable. In
practice conflicts here are close to non-existent — two people do not edit the
same finished game's notes on two phones in the same offline window — but the
protocol should not assume it.

`reportedToBgg` deserves its own rule. It exists to stop a play being sent to
BoardGameGeek twice. Merge it as **true wins**, not last-write-wins, or a stale
`false` arriving from a second device causes a duplicate BGG submission — an
outward-facing side effect, which is worse than a lost note.

`campaignRunId` is a soft reference with no foreign key, so it survives its run
being deleted. Good; nothing to do.

### 2.8 `randomizer_history`

```
id              TEXT PRIMARY KEY   -- UUIDv4
createdAt       INTEGER
scenarioCode    TEXT
difficulty      TEXT
playerCount     INTEGER
heroes          TEXT   -- 'heroCode:aspect' pairs, comma separated
modularSetCodes TEXT
beaten          BOOLEAN
```

Mixed: written once and never rewritten, except `beaten`, which the user ticks
later. So it is append-only with one mutable flag. Simplest correct handling is
to treat the whole row as mutable with last-write-wins; the only field that can
be lost is a boolean the user can tick again.

---

## 3. Primary keys — the answer to the critical question

**No table uses an auto-increment integer key.** There is no
`autoGenerate = true` anywhere in the schema, and no `@PrimaryKey val id: Long`.

Two schemes are in use.

**Client-generated UUIDv4**, via `java.util.UUID.randomUUID().toString()`:
`campaign_runs`, `campaign_events`, `plays`, `randomizer_history`,
`paused_games`, and `saved_decks` when created locally. Generation sites are
`CampaignRepository` (nine call sites, plus `newEventId()`), `PlayRepository`
(`newPlayId()`), `RandomizerRepository:254`, `DeckRepository:153` and
`GameSessionViewModel:475`.

**Natural keys**: `owned_packs.packCode`, `favourite_cards.cardCode`,
`excluded_modular_sets.setCode`, `excluded_scenarios.scenarioCode`, and
`saved_decks.id` for imported decks. These are already unique within a user's
data, which is the only scope that matters once rows are partitioned by account.

### On UUIDv7

Your brief prefers v7 so keys sort by creation time. I would **not** migrate the
existing v4 ids, and I do not think you need v7 at all:

1. **Rewriting ids is the one genuinely dangerous migration available here.**
   `campaign_events.runId` is a real foreign key with `ON DELETE CASCADE`, and
   `plays.campaignRunId` is a soft one. A rewrite means rewriting both sides
   consistently, in one transaction, on installs whose contents you cannot see.
   Real risk, in exchange for a sorting property you can have for free.
2. **Every table already has an explicit time column** — `playedAt`,
   `createdAt`, `addedAt`, `timestamp`, `savedAt`, `lastSyncedAt` — and every
   index that matters is on those, not on `id`. Nothing sorts by primary key
   today and nothing needs to.
3. **Backup files in the wild contain v4 ids.** `Backup` serialises the entity
   classes directly, so a restore from any existing export reintroduces them
   regardless of what the schema does afterwards. A v7-only invariant would be
   violated on the first restore.

If you like v7 for new rows, switching `newPlayId()` and friends is a one-line
change per call site and costs nothing — mixed v4/v7 is perfectly legal, they
are all just 128-bit values. Just do not build anything that *depends* on id
ordering, because the old rows will never satisfy it.

**Recommendation: keep the keys exactly as they are.** Optionally adopt v7 for
newly created rows, as a nicety, with no invariant attached.

---

## 4. Append-only versus mutable

| Entity | Class | Notes |
|---|---|---|
| `campaign_events` | **Append-only, truly** | Undo is a `revoke` event, not a delete. Union merge. Conflicts impossible. |
| `plays` | Mutable, rarely | Reads append-only; `notes`, `photos`, `victoryPoints`, `reportedToBgg` are edited, and rows can be deleted. |
| `randomizer_history` | Mutable, barely | One mutable flag (`beaten`) on an otherwise write-once row. |
| `campaign_runs` | **Mutable** | `name`, `finished`, timer. State itself is derived, so the mutable surface is tiny. |
| `owned_packs` | **Mutable** | `quantity` changes; rows added and deleted freely. |
| `excluded_modular_sets` | **Mutable** | Presence-only; toggled on and off. |
| `excluded_scenarios` | **Mutable** | Ditto. |
| `favourite_cards` | **Mutable** | Presence-only plus `addedAt`. Toggled on and off. |
| `saved_decks` | **Mutable** | Editable in place; `locallyEdited` records it. |

Only one entity is genuinely append-only — but it is the one with by far the
most rows and the most complicated semantics, so the win is real. The mutable
set is nine tables of small, flat, scalar rows, which is close to the easiest
possible case for last-write-wins.

---

## 5. What is missing, and where to add it

**No table has an `updatedAt`.** Grepping the whole of `app/src/main` for
`updatedAt`, `deletedAt`, `isDeleted` or `softDelete` returns nothing. The time
columns that exist are *event* times — when the game was played, when the run
was created — not *modification* times. Editing a play's notes changes no
timestamp at all today.

**No table has a soft-delete flag.** Every delete is a hard `DELETE FROM`;
`PackDao`, `PlayDao`, `CampaignDao`, `FavouriteDao`, `SavedDeckDao` and
`RandomizerHistoryDao` between them hold twenty-one of them. A deleted row is
indistinguishable from a row that never existed, which means a naive sync would
resurrect everything the user has ever thrown away.

### The migration: schema 16 to 17

Add to each of the nine user tables:

```sql
updatedAt INTEGER NOT NULL DEFAULT 0
deletedAt INTEGER          DEFAULT NULL
```

except `campaign_events`, which needs neither: it is append-only and its undo is
already in the log.

Room can generate this as an `AutoMigration` — every added column has a SQL
default, which is precisely the condition the codebase already relies on
(`@ColumnInfo(defaultValue = ...)` appears on `name`, `standardSet`, `roster`,
`location`, `victoryPoints`, `photos` and `locallyEdited`). So it is one more
entry in the `autoMigrations` list, consistent with the fifteen already there.

**Then follow it with one handwritten statement per table**, because
`updatedAt = 0` on every pre-existing row is a lie that costs you the first
sync's ordering. Seed each from the natural timestamp the row already carries:

```sql
UPDATE plays              SET updatedAt = playedAt     WHERE updatedAt = 0;
UPDATE campaign_runs      SET updatedAt = createdAt    WHERE updatedAt = 0;
UPDATE randomizer_history SET updatedAt = createdAt    WHERE updatedAt = 0;
UPDATE favourite_cards    SET updatedAt = addedAt      WHERE updatedAt = 0;
UPDATE saved_decks        SET updatedAt = lastSyncedAt WHERE updatedAt = 0;
```

`owned_packs`, `excluded_modular_sets` and `excluded_scenarios` carry no
timestamp at all, so those rows keep `updatedAt = 0`, meaning "older than
anything". That is the right answer: on a first merge they lose to any dated row
and win over nothing, which matches the truth that we do not know when they were
set.

Two behavioural changes go with the columns, and they are the part that is easy
to forget:

- **Every write sets `updatedAt`.** Best enforced in the repositories rather
  than left to call sites — there are more insert and update paths than you
  would guess, and one that forgets is a row that never syncs again.
- **Every user-data delete becomes a soft delete.** The DAO queries change from
  `DELETE FROM x WHERE id = :id` to
  `UPDATE x SET deletedAt = :now, updatedAt = :now WHERE id = :id`, and every
  read query grows `AND deletedAt IS NULL`. This is the largest single diff in
  the whole exercise and the one most likely to leak a deleted row into a screen
  if a query is missed. Worth a test that asserts every user-table read filters
  tombstones.

`campaign_runs` deletion also has to stop relying on `ON DELETE CASCADE`, since
soft-deleting the parent fires no cascade. Its events are tombstoned by
implication instead — doc 02 §5.

### A third column: `dirty`

Sync also needs to know which rows have local changes not yet pushed. Two
choices: a `dirty BOOLEAN` on each table, or a separate
`sync_state(collection, id, serverRevision, dirty)` table.

**Recommend the separate table.** It keeps sync bookkeeping out of the domain
entities — which matters, because those entities are serialised directly into
the backup format and a `dirty` flag has no business travelling in an export
file. It also means the whole sync feature can be reasoned about, and removed,
in one place.

---

## 6. Data that must not sync

**`paused_games`.** A game put down mid-play, one at a time by design. It
describes the physical table in front of one device — hero life totals, which
villain card is face up, which villain-phase step you stopped in — plus
`photos`, which are file names in that device's private storage. Syncing it
would mean a tablet claiming there is a game in progress that is physically
sitting on somebody else's coffee table. Leave it local. If you later want it,
it wants explicit "hand this off to my other device" semantics, not background
sync.

**The BoardGameGeek credentials.** `SecretStore` encrypts one BGG password with
a key held in the Android Keystore, because BGG offers no token or OAuth flow.
That key **cannot leave the device** — that is the entire point of a Keystore.
Uploading the password would mean decrypting it and handing plaintext to a
server, turning a hardware-protected secret into a database column. Never sync
it. If a second device wants to post to BGG, the user types the password there.
This is also the only third-party credential in the app and the only field in
the whole system that would count as sensitive personal data under the GDPR;
keeping it off the server keeps the server's exposure at nil.

**Photographs.** `plays.photos` and `paused_games.photos` hold comma-separated
file names, with the files in app-private storage via `PhotoStore`. They are the
only binary user content in the app, the only content with a meaningful size,
and the only content that could contain a person's face. Out of scope for the
first sync release: sync the file *names* (they are part of the play row) and
accept that a photo taken on the phone is not on the tablet, with the UI saying
so rather than showing a broken frame. Doc 04 puts blob sync in a later phase
where it can be opt-in and separately budgeted.

**Part of the settings store.** `AppPreferences` is a DataStore, not Room, with
six keys:

| Key | Sync? |
|---|---|
| `card_locale` | Yes — a genuine preference |
| `theme_choice` | Yes |
| `play_location` | Yes — free text, "Home", "Chez Marc" |
| `track_encounter` | Yes |
| `dismissed_packs` | Yes — union merge, it is a set of codes |
| `last_card_sync` | **No** — when *this device* last fetched MarvelCDB |

Note `play_location` is free text a person typed, so it can contain anything,
including a home address if somebody is unusual about it. It syncs as opaque
text and, like everything else, is covered by export and deletion.

Settings are a separate concern from the row-oriented protocol; simplest is one
`settings` record per account holding a JSON object, last-write-wins per key.
That is a single row and needs no schema of its own on the server.

---

## 7. The existing export format, and why it is not enough

`Backup` (`data/backup/BackupModels.kt`) already serialises exactly the right
set: `ownedPacks`, `excludedModularSets`, `decks`, `campaignRuns`,
`campaignEvents`, `plays`, `randomizerHistory`, `favouriteCards`, plus a
`photos` manifest, with `formatVersion = 1`, `createdAt` and `appVersion`. Its
class comment states the principle the server should inherit verbatim: *"The
card database is deliberately absent: it is a cache of MarvelCDB and is
re-downloadable on any device."*

Three gaps for sync purposes:

- **`excludedScenarios` is missing.** The table exists and is exported nowhere,
  so a restore loses it silently. Worth fixing regardless of sync.
- **Settings are not in it.** A restore returns your decks but not your language
  or theme.
- **It is a snapshot, not a change feed.** It says what is, never what was
  deleted, so it can merge two devices only by union — which resurrects
  deletions.

The right relationship between the two: `Backup` stays exactly as it is, as the
no-account escape hatch and the GDPR export artefact. The server's
`GET /v1/account/export` should emit **the same JSON shape**, so an export from
the server restores into the app through the code path that already exists and
is already tested. That is a free win, and it means the account can never become
a place your data is trapped.

---

## 8. Summary of required Android changes

Ordered by how early they must ship.

1. **Schema 17: `updatedAt` and `deletedAt` on nine tables** (auto-migration),
   plus the seeding `UPDATE`s.  Ship this *before* any server exists — doc 04.
2. **Soft delete throughout.** Twenty-one DAO deletes become updates; every read
   gains `AND deletedAt IS NULL`.
3. **`updatedAt` set on every write**, enforced in the repositories.
4. **`sync_state` table** for `serverRevision` and `dirty`, separate from the
   entities.
5. **Add `excludedScenarios` to `Backup`**, bumping nothing — the format already
   tolerates unknown keys by design, and the comment on `excludedModularSets`
   explains why.
6. **Add settings to `Backup`** on the same reasoning.
7. Optionally, **UUIDv7 for new ids**, with no invariant depending on it.

Nothing on that list requires a data rewrite, a key change, or a migration that
could lose a row. That is a much better starting position than the brief
assumed.

---

## 9. Two things noticed in passing

Neither is a sync concern; both are small and worth knowing.

- **`.gitignore` refers to tooling that does not exist.** It ignores
  `/web/data/` and describes it as "built by `python tools/build_web_data.py`,
  which the Pages workflow runs before it deploys". There is no
  `tools/build_web_data.py` and no Pages workflow in `.github/workflows/` (only
  `ci.yml`, `data.yml`, `release.yml`). The `web/data/` directory does exist
  locally with 4.8 MB of card JSON in it, untracked. So the rule is doing its
  job — no card text is in git — but the comment describes a pipeline that was
  never built, or was removed. Worth correcting once the real web app lands,
  since this new project is what that comment was anticipating.
- **The repository has had no outside contributors.** `Hasyame/Thwart` shows
  three merged pull requests, all dependabot, and two contributors, one of which
  is dependabot. That does not make "outside contributors can help" a bad goal,
  but it means it should be weighted as an aspiration rather than an observed
  constraint when choosing a stack — which changes my recommendation in doc 03,
  so I am flagging it rather than burying it.
