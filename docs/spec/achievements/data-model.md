# Achievements — data model

Decided with the author on 2026-09-18. Implemented twice, on Thwart Web
(first) and on Android, against this one specification. Web is the master
of the definitions file; Android bundles a snapshot (see `sync.md`).

Everything an achievement says is **derived from the game history**. There
is no achievement table, no unlock row, nothing written when one is earned:
the state is a pure, idempotent function of the plays, the campaign runs
and the collection, recomputed whenever any of them changes. What *is*
stored is the play record, and this feature adds to it the few facts the
derivation needs and did not have. See `algorithm.md` for the function and
`sync.md` for the record changes.

## 1. Identifiers

| thing | identifier | example | notes |
|---|---|---|---|
| hero | hero **card** code, as MarvelCDB prints it | `01001a` | Not the hero set: each printing of Spider-Man is its own column. |
| scenario | scenario key, a string | `rhino`, `fne_s1_musee`, `s1_hydra_camp` | The card-set code of a one-off game, or the key a campaign play resolves to (§3). |
| pack | MarvelCDB pack code | `core`, `trors`, `fne` | Used for grouping and for the `owned` scope. |
| aspect | lowercase aspect code | `aggression`, `justice`, `leadership`, `protection`, `pool` | As the play record spells it. |
| achievement | stable slug, `[a-z0-9_]+` | `beat_every_scenario_core` | Never renamed once shipped; retired entries are removed from the file, never reused. |
| play | the play's `id` (UUID) | | Unlock provenance points at it. |

## 2. Difficulty scale

A play records its difficulty as a free string (`standard_i`, `expert_ii`,
`standard`, `expert`, `Standard I`, …), and the game's own scale has moved
once already (Standard II and III, Expert II arrived with later boxes). The
derivation therefore works on a **level**, an enum with an explicit total
order, and the scale carries a version so a future rung (Heroic) can be
added without reinterpreting old data.

```
difficultyScaleVersion = 1

DifficultyLevel   rank
  unknown          0     nothing usable recorded (see below)
  standard         1     any Standard set: Standard I, II or III
  expert           2     any Expert set: Expert I or II
```

`level(play)` reads `play.difficulty`, trimmed, lowercased, `-`/space
folded to `_`:

- starts with `expert` → `expert`
- starts with `standard` → `standard`
- anything else, including the empty string → `unknown`

The `standardSet` field never changes the level: an Expert game is played
with a Standard set shuffled in, and remains Expert.

**Migration rule.** A play from before this specification whose
`difficulty` is empty or unrecognised is `unknown`, **never** defaulted to
`standard`, so an old play can never wrongly satisfy a difficulty
achievement. `unknown` counts as played (and as won, for the tri-state
grid) but satisfies no `minDifficulty` above 0.

## 3. Play record additions (backup `formatVersion` 2)

The play record is the phone's contract (`PlayEntity`). Three facts are
added; every other field is unchanged. Field names are final.

```
Play (v2)
  ... every v1 field ...
  roster: PlayHero[]           existing; each seat gains:
      isOwner?: boolean        true on the device owner's seat
  difficulty: string           existing; interpreted by §2
  campaignRunId: string|null   existing; kept as is
  mode?: string                new, optional: 'draft' | 'sealed' | 'daily' | 'shared'
```

- **Seats.** The roster already lists every hero at the table with its
  aspect. `isOwner` marks the seat of the person whose device recorded the
  game. Exactly one seat carries `isOwner: true` in a v2 record; when no
  seat carries it (v1 record, or a record from a client that did not set
  it), **the first seat is the owner**. A record whose `roster` is empty
  has one implicit seat: `{ code: heroCode, aspect: aspects, isOwner: true }`.
- **Aspects of a seat.** `PlayHero.aspect` is a string; it may name two
  aspects (`Leadership, Justice`, `leadership,justice`). It is read as a
  **set** of aspect codes: split on `,`, trim, lowercase; empty entries
  dropped. A seat with two aspects counts under both for the aspect
  filter and for "all four aspects" coverage.
- **`mode`.** Which of Thwart's own modes produced the game. Absent means
  an ordinary game. Only `draft` is written in v1 (when the owner's deck
  carries the `draft` tag at recording time — see §5); the other values
  are reserved so a later mode needs no schema change. An unknown value is
  kept and treated as absent by the derivation.
- **Deleted plays.** A play with a non-null `deletedAt` is a tombstone: it
  is excluded from the derivation and **kept in storage and in sync**, so a
  device that was offline does not resurrect it.

### Scenario key

The grid's rows are scenarios. A play names one in `scenarioCode`, in one
of three dialects, and the derivation folds them to one **scenario key**:

| play | `scenarioCode` | key |
|---|---|---|
| one-off game | the card-set code, `rhino` | `rhino` |
| Fear No Evil one-off, job with villain | `fne_s1_musee__fne_villain_electro` | `fne_s1_musee` (the villain half is dropped; the job is the scenario) |
| Fear No Evil one-off, finale | `fne_s6_caid` | `fne_s6_caid` |
| campaign play (`campaignRunId` set) | the template's scenario id, `s1_crossbones` | resolved through the run's template, §3.1 |
| versus game | `a__b` (not `fne_`) | `a__b`, unchanged |

#### 3.1 Campaign plays

A campaign play records the template scenario id, which is not a card set.
The key is resolved from the run's template (both clients hold the
templates, and the run carries a snapshot of its own):

1. If the template id is `fne`: key = `fne_` + scenario id (`s1_musee` →
   `fne_s1_musee`), so a job played in the campaign and the same job played
   on its own share a row.
2. Otherwise: take the scenario's `baseSetup.villainDeck` for the run's
   difficulty (`standard`/`expert`), or, when the template deals the villain
   (`villainDeckFromDraw`), the villain drawn in the run's log; the key is
   the **card-set code of the first villain card** named there (the same
   resolution the campaign tracker and the ratings already use).
3. If nothing resolves (run missing, template unreadable, no villain), the
   key is the recorded `scenarioCode` unchanged, prefixed: `campaign:<id>`.
   Such a play still counts for volume, table-size and campaign
   achievements; it simply has no row in the grid.

The resolution is a pure function of (play, run, template); test vectors
give the resolved key as an input fact (see `algorithm.md` §1).

## 4. Definitions file

`web/public/data/achievements.json`, fetched with the card data on the
web, bundled as a snapshot on Android. Master copy: the web repository.

```json
{
  "schemaVersion": 1,
  "definitionsVersion": 1,
  "difficultyScaleVersion": 1,
  "achievements": [ ...AchievementDefinition ]
}
```

- `schemaVersion` changes when the **shape** of a definition changes and
  the code must adapt. A client refuses to load a file whose
  `schemaVersion` is higher than it understands, and says so.
- `definitionsVersion` changes when entries are **added or amended** and
  the code does not. A client loads any `definitionsVersion`. Android
  records the one it shipped with; a test asserts its bundled copy is
  byte-identical to the web file at the tagged commit.
- `difficultyScaleVersion` must equal the scale the client implements
  (§2); a mismatch is refused like a schema mismatch.

### AchievementDefinition

```
id            string      stable slug
category      'coverage' | 'difficulty' | 'volume' | 'table' | 'campaign' | 'mode'
scope         'owned' | 'global'
hidden        boolean     v1: always false (hidden ones are excluded from the rate)
tiers?        Tier[]      counting achievements only; ascending thresholds
predicate     Predicate   one of the kinds below
```

`Tier = { tier: 'bronze' | 'silver' | 'gold' | 'platinum', n: number }`, at most four, thresholds strictly ascending.

Names and descriptions are **not** in the file: they are translation keys
`achievement.<id>.title` / `achievement.<id>.description` (see `i18n.md`),
so a wording change is not a definitions change.

### Predicate kinds

Every predicate is data; the derivation interprets the kinds and nothing
else. Unknown kinds are refused at load (they would need a `schemaVersion`
bump).

```
{ kind: 'scenarios_won',   pack: string | '*', minDifficulty?: Level }
    every scenario of the pack (or of the whole catalogue) has a won cell
    at or above the level; owner seat only (the "any seat" toggle is a
    display filter and never changes unlocks)

{ kind: 'heroes_won',      pack: string | '*', minDifficulty?: Level }
    every hero of the pack has at least one won cell at or above the level

{ kind: 'aspects_won',     scenario?: string, minDifficulty?: Level }
    a win with each of the four classic aspects (aggression, justice,
    leadership, protection); with `scenario`, all four against that one
    scenario. 'pool' never counts toward "all four".

{ kind: 'first_win',       minDifficulty: Level }
    at least one win at or above the level

{ kind: 'count',           what: 'plays' | 'wins' | 'heroes_played' | 'distinct_days' }
    tiered by `tiers`; `heroes_played` counts distinct owner-seat hero
    codes over live plays; `distinct_days` counts distinct UTC calendar
    days of `playedAt`

{ kind: 'table_win',       players: 1 | 2 | 3 | 4, distinctAspects?: boolean }
    a win at exactly that table size; with `distinctAspects`, every seat's
    aspect set is disjoint from every other's (the owner's seat included)

{ kind: 'campaign',        finished: true, noDefeat?: boolean, minDifficulty?: Level }
    a campaign run that finished and was not lost (`campaignLost` false
    in its folded state); `noDefeat`: no play of the run was lost;
    `minDifficulty`: the run's difficulty level (§2 applied to the run's
    `difficulty` string)

{ kind: 'mode_win',        mode: 'draft' | 'sealed' | 'daily' | 'shared' }
    a win whose play carries that `mode`
```

`Level` in predicates is written as the enum name (`"expert"`), never the
rank.

### Catalogue inputs

Predicates that say `pack` need to know which scenarios and heroes a pack
holds. That comes from the card data, not from the definitions file:

- heroes of a pack: index rows of type `hero` whose `packCode` is the pack
  (one per hero card code);
- scenarios of a pack: the scenario keys whose pack is the pack — the
  scenario-rules file's entries (`code`, `packCode`), plus, for `fne`, the
  six one-off keys `fne_<scenarioId>` from the template.
- `'*'` means every hero / every scenario the catalogue knows.

The catalogue is an input to the derivation (`algorithm.md` §1), so a
test vector carries its own small catalogue and both clients read the same
one.

## 5. Web-side facts the record needs

- The draft's finish page tags the decks it saves with `draft` (the deck
  record's `tags` field, comma-separated as the phone stores it). When a
  game is recorded and the owner's seat was played from a deck tagged
  `draft`, the play is written with `mode: 'draft'`. Android does the same
  when its draft lands; until then its plays carry no `mode`.
- The recording client sets `isOwner: true` on its own seat: on the web,
  the first seat of the setup screen; on Android, the seat the app calls
  the player's own.

## 6. Derived state (never stored)

```
AchievementState
  definitionsVersion    number      the file the state was computed from
  scaleVersion          number
  cells                 Cell[]      one per (heroCode, scenarioKey) with any live play
  achievements          Status[]    one per definition, in file order
  completion
      owned   { won: number, cells: number }   cells = owned heroes × owned scenarios
      global  { won: number, cells: number }   cells = all heroes × all scenarios in the catalogue
  recent                Unlock[]    unlocked achievements, newest first

Cell
  heroCode, scenarioKey
  best                  'played' | 'won'
  bestLevelWon          Level | null     highest level among wins
  attempts, wins        numbers          live plays counted
  firstWonAt            number | null    playedAt of the earliest win
  lastPlayedAt          number
  anySeat               same fields again, counting every seat at the table
                        (the owner-only fields are the default view)

Status
  id
  status                'locked' | 'unlocked' | 'unavailable'
                        unavailable: scope 'owned' and the collection lacks
                        what the predicate ranges over; progress still shown
  progress              { current: number, target: number }
  tier                  Tier name | null    highest tier reached, counting kinds only
  unlockedAt            number | null       playedAt of the play that completed it
  unlockedByPlayId      string | null

Unlock = { id, unlockedAt, unlockedByPlayId }
```

Completion rate = `won / cells`, wins only, both views always shown with
their absolute counts. Hidden achievements (none in v1) are excluded from
any achievement count shown as a rate.

## 7. Test vectors

`test-vectors.json` holds 31 cases of `DeriveInput` → `AchievementState`
over a five-scenario, four-hero catalogue and a subset of the definitions.
Both clients must reproduce every `expected` block exactly: arrays in
order, object keys in any order, `null` distinct from absent. A case's
`note` says what it pins down.

## 8. Constraints

- The derivation must be **idempotent**: the same inputs give the same
  state, field for field, in the same order (see `algorithm.md` §5 for the
  ordering rules).
- Nothing in this feature makes a network request or needs an account.
- Never delete or reduce progress because the collection shrank: `scope`
  changes only the `unavailable` flag and the `owned` denominator.
- The grid credits the **owner's seat** by default; "any hero at the
  table" is a display toggle over the `anySeat` fields. Unlocks are always
  computed from the owner's seat.
- Losses count as `played` in the grid by default (tri-state); a toggle
  may hide them, and the completion rate counts wins only in either case.
