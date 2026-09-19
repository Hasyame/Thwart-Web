# Achievements — derivation algorithm

`derive(input) → AchievementState`. Pure, total, idempotent: no clock, no
randomness, no storage. Both clients implement it step for step; the
vectors in `test-vectors.json` are the contract. No RNG is named because
nothing here draws anything (decided 2026-09-18).

## 1. Input

```
DeriveInput
  definitions      the definitions file (data-model.md §4), already validated
  catalogue        { heroes: HeroRef[], scenarios: ScenarioRef[] }
                   HeroRef     = { code, packCode }
                   ScenarioRef = { key, packCode }
  ownedPacks       string[]     pack codes with quantity > 0
  facts            PlayFact[]   the plays, normalised (§2), any order
  runs             RunFact[]    the campaign runs, normalised (§2), any order
```

The normalisation of raw records into facts is part of the specification
(§2) but is **not** what the vectors exercise: vectors carry facts, so a
client's storage shape never leaks into the contract.

```
PlayFact
  id               string
  playedAt         number       epoch milliseconds
  scenarioKey      string       data-model.md §3
  level            'unknown' | 'standard' | 'expert'
  won              boolean
  players          number       1..4
  seats            Seat[]       at least one; exactly one isOwner
      heroCode     string
      aspects      string[]     lowercase codes, deduplicated, sorted
      isOwner      boolean
  campaignRunId    string | null
  mode             string | null

RunFact
  id               string
  templateId       string
  level            'unknown' | 'standard' | 'expert'
  finished         boolean      the run reached its end
  lost             boolean      the engine says the campaign was lost
```

## 2. Normalisation (raw record → fact)

Applied by each client to its own records before `derive`. Deterministic
given the record, the run and the template.

1. **Skip tombstones.** A play whose `deletedAt` is neither null nor
   absent produces no fact. Same for a run flagged deleted, if the client
   has such a flag.
2. **Scenario key.** As data-model.md §3: FNE one-off codes lose their
   `__villain` half; campaign plays resolve through the run's template;
   an unresolved campaign play gets `campaign:<scenarioCode>`.
3. **Level.** As data-model.md §2, from `play.difficulty`. For a run, from
   the run's `difficulty` string by the same rule.
4. **Seats.** From `roster`; if empty, one seat from `heroCode`/`aspects`.
   Each seat's aspect string is split on `,`, trimmed, lowercased,
   deduplicated and sorted; empty entries dropped. `isOwner` copied; if no
   seat has it, the first seat gets it; if several have it, the first of
   them keeps it and the others are cleared.
5. **Players.** `max(1, min(4, play.players))`; if `play.players` is not a
   number, the number of seats.
6. **Mode.** `play.mode` if it is one of the four known values, else null.
7. **Run facts.** `finished` is the run's `finished` flag; `lost` is the
   folded campaign state's `campaignLost` (the engine's answer, the same
   one the campaign tile shows). A run whose template cannot be read has
   `lost = false`.

## 3. Ordering

Schema-2 milestone predicates count matching facts once per play, cap displayed
progress at their threshold, and date the unlock from the nth matching fact in
the ordering below. `mode_win` filters wins by mode; `loss_count` filters defeats
across every mode. The latter has no game-setup shortcut: it celebrates
perseverance without proposing an intentional defeat.

Before anything is counted, facts are sorted by `(playedAt ascending, id
ascending, code points)`; runs by `(id ascending)`. Every "first" below
means first in this order, which is what makes an unlock date and its
provenance reproducible whatever order storage handed the records over in.

## 4. Steps

### 4.1 Cells

For each fact, for each seat, the cell `(seat.heroCode, fact.scenarioKey)`
is touched. Two tallies are kept per cell: **owner** (only seats with
`isOwner`) and **any** (every seat). For a tally:

```
attempts   += 1
wins       += won ? 1 : 0
best        = wins > 0 ? 'won' : 'played'
bestLevelWon = won ? max(bestLevelWon, level) : bestLevelWon      (by rank; null when no win)
firstWonAt  = won && firstWonAt == null ? playedAt : firstWonAt
lastPlayedAt = playedAt                                            (facts are in order)
```

A cell exists in the output if its **any** tally has attempts > 0. The
owner tally may be empty (attempts 0, best `played` is not emitted: fields
are `attempts: 0, wins: 0, best: null`). **Every seat counts** (decided
2026-09-19): completion and every predicate read the **any** tally and
every seat of a fact; the owner tally and `isOwner` are kept for reading
and decide nothing.

### 4.2 Completion

```
ownedHeroes     = catalogue.heroes    whose packCode ∈ ownedPacks
ownedScenarios  = catalogue.scenarios whose packCode ∈ ownedPacks
owned.cells     = |ownedHeroes| × |ownedScenarios|
owned.won       = number of cells with any.wins > 0 whose hero ∈ ownedHeroes and scenario ∈ ownedScenarios
global.cells    = |catalogue.heroes| × |catalogue.scenarios|
global.won      = number of cells with any.wins > 0 whose hero and scenario are both in the catalogue
```

A cell for a hero or a scenario the catalogue does not know (an old code,
an unresolved campaign key) is kept in `cells` and counted in neither
denominator nor numerator.

### 4.3 Predicates

Each predicate yields `{ done: boolean, current, target, unlockedAt,
unlockedByPlayId }`. `unlockedAt` is the `playedAt` of the fact that made
`done` true for the first time in order, and `unlockedByPlayId` its id;
both null while not done. Every seat of a fact counts, everywhere.

Let `wins` = facts with `won`, `atLeast(level, min)` = rank(level) ≥
rank(min), `min` defaulting to `unknown` (rank 0, always satisfied).

**scenarios_won { pack, minDifficulty }**
- targets = scenarios of the catalogue whose packCode is `pack`, or all if `'*'`.
- A target is met by the first winning fact with that key and
  `atLeast(level, min)`.
- `current` = met targets, `target` = |targets|, done when equal and
  target > 0. Unlock = the fact that met the last target (the latest
  `playedAt` among the meeting facts, ties by id).

**heroes_won { pack, minDifficulty }**
- targets = heroes of the pack (or all). A target is met by the first
  winning fact with a seat of that hero and `atLeast(level, min)`.
- Rest as above.

**aspects_won { scenario?, minDifficulty }**
- targets = `[aggression, justice, leadership, protection]`.
- A target is met by the first winning fact (with that `scenarioKey` when
  `scenario` is given) with a seat whose `aspects` contains it and
  `atLeast(level, min)`. A two-aspect seat meets both of its aspects.
- Rest as above.

**first_win { minDifficulty }**
- `target = 1`; `current = 1` from the first winning fact with
  `atLeast(level, min)`; that fact is the unlock.

**count { what }** with tiers `t1 < t2 < …`
- value over all facts: `plays` = |facts|; `wins` = |wins|;
  `heroes_played` = |distinct heroCodes over every seat|; `distinct_days` =
  |distinct `floor(playedAt / 86_400_000)`| (UTC days).
- `target` = the highest tier's `n`; `current = min(value, target)`.
- `tier` = the highest tier whose `n` ≤ value, or null.
- done when value ≥ highest tier; the unlock is the fact at which the
  running value first reached it (walk the facts in order, recomputing
  the value incrementally).

**table_win { players, distinctAspects }**
- A fact qualifies if `won`, `fact.players == players`, and, when
  `distinctAspects`, every pair of seats has disjoint aspect sets and no
  seat has an empty aspect set.
- `target = 1`, first qualifying fact is the unlock.

**campaign { finished, noDefeat, minDifficulty }**
- A run qualifies if `finished && !lost && atLeast(run.level, min)`, and,
  when `noDefeat`, no fact with that `campaignRunId` has `won == false`.
- `target = 1`. The unlock is the **last fact of the qualifying run**
  (latest `playedAt`, ties by id) for the first qualifying run in run
  order; if the run has no facts, `unlockedAt = null` with `done = true`.

**mode_win { mode }**
- First winning fact with `fact.mode == mode`. `target = 1`.

### 4.4 Status

```
unavailable = scope == 'owned' && the predicate's targets are not all owned:
    scenarios_won / heroes_won with a pack: pack ∉ ownedPacks
    scenarios_won / heroes_won with '*':   some target's packCode ∉ ownedPacks
    aspects_won with a scenario:           that scenario's packCode ∉ ownedPacks
    every other kind:                      never unavailable
status = done ? 'unlocked' : unavailable ? 'unavailable' : 'locked'
```

`unavailable` never hides progress: `current`, `target`, `tier` are
reported the same. An achievement once `done` stays `unlocked` whatever
the collection.

### 4.5 Recent

`recent` = every `unlocked` status with a non-null `unlockedAt`, sorted by
`(unlockedAt descending, id ascending)`.

## 5. Output ordering

- `cells`: sorted by `(scenarioKey, heroCode)`, code-point order.
- `achievements`: the definitions file's order.
- `recent`: §4.5.
- Arrays inside a cell or status: as specified; no other arrays.

Two runs of `derive` on equal inputs produce equal JSON.

## 6. Unlock toast (client behaviour, not part of the vectors)

After a game is recorded, the client derives the state before and after
and shows the achievements whose status went from not-`unlocked` to
`unlocked`, at most three, newest first; more than three are summarised as
a count. On a backup import nothing is shown. This is display logic; the
state itself never records what was shown.

## 7. Caching (allowed, never a contract)

A client may memoise the state keyed by a hash of (definitionsVersion,
ownedPacks, the sorted fact ids with their `playedAt`, `won`, `level`,
`mode`, seats, and the runs). The cache is a cache: it is dropped on any
mismatch, never exported, never synced.
