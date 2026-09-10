# Statistics — the shared specification

The single source of truth for the statistics screen in **both** Thwart clients:
the Android app (`C:\MarvelChampionsCompanion`) and Thwart Web (`web/`).

If the two disagree about "win rate", a user reports a bug and somebody has to
debug two codebases to find out which one is lying. This document exists so that
question has an answer that is not "read both implementations".

**Status.** Written 2026-09-09 from an audit of the Android implementation
(`PlayDao.kt`, `PlayStats.kt`, `PlaysViewModel.summarise`) and the web one
(`web/src/lib/plays.ts`). Where the two diverged, the operator chose; every
choice is recorded at the point it matters. Android is the reference
implementation and the web is being brought to it, except where this document
says Android is wrong.

---

## 1. The universe of rows

Every metric below counts **plays**. A play is one game at one table: one
scenario, one difficulty, one table size, one result.

```sql
-- The row set every metric starts from.
SELECT * FROM plays
WHERE deletedAt IS NULL
ORDER BY playedAt DESC
```

### Inclusions and exclusions

| Rule | Reason |
|---|---|
| **Excluded**: `deletedAt IS NOT NULL` | A deleted play is not a played game. The row survives so the delete can travel to other devices and be undone; it counts for nothing. |
| **Included**: campaign scenarios | A campaign scenario is a game that was played. It is also counted separately (§2.7) so the split is visible, but it is never removed from the totals. |
| **Included**: games with no clock (`elapsedMillis = 0`) | A game nobody timed is still a game. It counts everywhere except the average (§2.4). |
| **Included**: unfinished-looking rows | There is no "abandoned" state in either client. A row exists because somebody pressed the button that records a result, so every row has a result. |

### What is *not* excluded, and why

There is no "set aside" or "does not count" flag. The web briefly had one
(`Play.ignored`) and it is being removed: Android has no equivalent, drops the
field on any round-trip through the phone, and so the same account showed
different totals on the two devices. **If the idea is wanted, it has to land on
Android first**, in the sync contract, and then in this document — not as a
web-side flag that a phone silently discards.

---

## 2. The headline figures

Shown above the tables. All are per **game**, never per seat: a four-player win
is one win.

### 2.1 Games played · *Parties jouées*

```sql
SELECT COUNT(*) FROM plays WHERE deletedAt IS NULL
```

No data: `0`.

### 2.2 Games won, and the win rate · *Parties gagnées*, *taux de victoire*

```sql
SELECT SUM(won) FROM plays WHERE deletedAt IS NULL
```

Win rate is `won / played`, rounded to the nearest whole percent for display.

**No data: show no percentage at all**, not `0%`. Nobody with no games has a
nought per cent win rate; they have no win rate. The clients show the empty
state instead.

### 2.3 Total time · *Temps total* (`plays_stat_total_time`)

```sql
SELECT SUM(elapsedMillis) FROM plays WHERE deletedAt IS NULL
```

Over **every** play, untimed ones contributing zero.

### 2.4 Average game · *Moyenne* (`plays_stat_average`)

```sql
SELECT SUM(elapsedMillis) / COUNT(*)
FROM plays WHERE deletedAt IS NULL AND elapsedMillis > 0
```

**Over the timed games only.** A play recorded after the fact carries no clock,
and folding it in as zero drags the average towards a length nobody played.

> **Consequence worth stating**: `average × games ≠ total`. The two figures have
> deliberately different denominators. This is not a rounding error and neither
> client should "fix" it.

No timed game: `0`.

### 2.5 Longest game · *Plus longue* (`plays_stat_longest`)

```sql
SELECT MAX(elapsedMillis) FROM plays WHERE deletedAt IS NULL
```

No data: `0`.

### 2.6 Current streak · *Série en cours* (`plays_stat_streak`), best streak · *Meilleure série* (`plays_stat_best_streak`)

Consecutive wins, counted **per game**, ordered by `playedAt`.

- **Current**: wins running back from the most recent game. The first loss ends
  it. A single loss as the newest game means a current streak of `0`.
- **Best**: the longest run of consecutive wins anywhere in the history.

```sql
-- Ordered by when they were played, not by when they were entered.
-- Somebody recording last week's loss today has not broken this week's run.
SELECT won FROM plays WHERE deletedAt IS NULL ORDER BY playedAt ASC
-- then: running = won ? running + 1 : 0;  best = max(best, running)
--       current = running after the last row
```

> **Android note.** `summarise` iterates a **newest-first** list and computes
> `bestStreak` from it. That happens to be correct — a run of *n* is a run of
> *n* read backwards — but it is correct by accident, and it reads as though it
> were computing the same thing as `currentStreak`. Both clients should order
> ascending and say so.

No data: `0` for both.

### 2.7 Campaign games · *Campagne* (`plays_stat_campaign`)

```sql
SELECT COUNT(*) FROM plays
WHERE deletedAt IS NULL AND campaignRunId IS NOT NULL
```

**`campaignRunId = ''` counts as a campaign game**, matching Android: the test is
`IS NOT NULL` and nothing else. The web previously also excluded the empty
string, which meant a row written with `''` was a campaign game on the phone and
not on the web. Neither client should ever write `''` — but when one does, both
must agree about what it means.

> **Three states, not two, and this bit in production.** On the wire the field
> can be a run id, an empty string, or **absent**. Android serialises with
> `explicitNulls = false`, so a play with no campaign arrives with no
> `campaignRunId` key at all — missing, not null. In SQLite a missing column
> reads as NULL and Android's query is right; in a client that spreads the JSON
> body onto a record, the field is `undefined`, and `undefined !== null` is
> true. That put an "in a campaign" badge on every standalone game anybody had
> synced from their phone, and counted them all here.
>
> **Absent and null mean the same thing: no campaign.** An empty string does
> not. Any client reading this field must collapse absent and null before
> testing, once, in one place.

No data: `0`.

---

## 3. The breakdown tables

Six tables. Every row is `{ key, played, won, totalMillis }`, and every table is
ordered the same way:

```sql
ORDER BY played DESC, key ASC
```

A table with no rows is not rendered. A table with exactly one row is not worth
rendering either — the point of a breakdown is the comparison — but that is a
presentation choice, not part of this specification.

### 3.0 Seats: how a play becomes rows

Three of the six tables count **per seat** rather than per game, because "how
does this hero do" is a question about heroes, not about evenings. A four-player
game is one game and four seats.

```
seats(play):
  if play.roster is not empty:        -> play.roster            (code, name, aspect each)
  else if play.otherHeroes is empty:  -> [ (heroCode, heroName, all of play.aspects) ]
  else:                               -> [ (heroCode, heroName, "") ]
                                       + [ ("", name, "") for each of otherHeroes ]
```

The last branch is the important one. A play recorded before the roster column
existed kept the first hero's code and name, the other heroes' *names*, and
every aspect at the table in one flat list. That is enough to say **who was
there** and not enough to say **who played what** — so the aspect is left blank
for those seats, and §3.3 skips them rather than inventing pairings nobody
played.

Solo is the exception: one hero means the listed aspects are necessarily that
hero's, so they are attached.

> **This was a real divergence.** The web ignored `otherHeroes` entirely,
> credited only the first hero, and paired that hero with the first listed
> aspect — inventing exactly the pairings Android refuses to invent. Web adopts
> Android's reconstruction.

**Grouping key for a seat**: `code` where there is one, `name` otherwise. Old
rows have no code for the other heroes.

**Label**: the seat's `name`. Since rows arrive newest first, the label kept for
a group is the most recent one it was recorded under — the name the player
currently sees the hero by, in the interface language they currently use.

**Tallies sharing a label are merged.** One hero played before the roster column
existed is grouped by name; the same hero after it is grouped by card code. Both
come out labelled "Magneto". Without the merge that is two rows for one hero,
and on Android it crashed the screen outright with a duplicate key.

### 3.1 By hero · *Par héros* (`plays_by_hero`)

Per **seat**. Every seat of every game credits its hero.

```sql
-- conceptually, after expanding seats:
SELECT seat_key AS key, COUNT(*) AS played, SUM(won) AS won,
       SUM(elapsedMillis) AS totalMillis
FROM seats_of(plays) WHERE seat.name != ''
GROUP BY seat_key
```

Seats with a blank name are dropped — there is nothing to show.

### 3.2 By aspect · *Par aspect* (`plays_by_aspect`)

Per **game**, not per seat. An aspect is counted **once per play** however many
seats brought it: two players both on Justice is one Justice game.

```
aspects_of(play):
  from_seats = flatten(split(seat.aspect, ",")) for seat in seats(play)
  if from_seats is empty: split(play.aspects, ",")   -- old group rows
  distinct, trimmed, non-empty
```

**Aspect strings are split on commas.** A seat holding `"justice, leadership"`
is two aspects, not one. The web keyed on the whole string, so a dual-aspect
deck produced a phantom aspect called *"justice, leadership"*; `buildCampaignPlay`
writes exactly that shape, so this was not hypothetical. Fixed on the web.

The fallback to `play.aspects` exists for old group rows, whose seats carry no
aspect (§3.0) but whose play still lists what was at the table.

### 3.3 Hero and aspect together · *Héros et affinité ensemble* (`plays_by_hero_aspect`)

Per **seat**, and only pairings actually recorded together.

```
pairs_of(play): for each named seat, for each aspect in split(seat.aspect, ","):
    key = seat_key + " · " + aspect
```

**Minimum two plays.** A pairing played once is an anecdote, and a table full of
one-game hundred-per-cent rows buries the rows that mean something.

Old group rows contribute nothing here, by construction: their seats have no
aspect. That is the intended behaviour, not a gap.

### 3.4 By scenario · *Par scénario* (`plays_by_scenario`)

```sql
SELECT scenarioName AS key, COUNT(*) AS played, SUM(won) AS won,
       SUM(elapsedMillis) AS totalMillis
FROM plays WHERE deletedAt IS NULL
GROUP BY scenarioCode ORDER BY played DESC, key ASC
```

Grouped by **code**, labelled by **name**, so the same scenario under two
spellings is one row.

> **Android is loose here and should be tightened.** `GROUP BY scenarioCode`
> while selecting a bare `scenarioName` leaves SQLite free to return the name
> from *any* row in the group. If a scenario was ever recorded under two names —
> a language change, a corrected typo — which one appears is undefined and can
> change between runs. **Both clients should take the name from the most recent
> play in the group**, which is the same rule §3.0 uses for hero labels.

### 3.5 By difficulty · *Par difficulté* (`plays_by_difficulty`)

```sql
SELECT difficulty AS key, COUNT(*) AS played, SUM(won) AS won,
       SUM(elapsedMillis) AS totalMillis
FROM plays WHERE deletedAt IS NULL
GROUP BY difficulty ORDER BY played DESC, key ASC
```

**By `difficulty` alone.** The web additionally folded in `standardSet`,
producing rows labelled *"Standard + standard"* — more information, but not what
the phone shows, and the question the table answers is "how do I do on expert".
Web drops the compound key.

### 3.6 By table size · *Par nombre de joueurs* (`plays_by_players`)

Five fixed buckets, never the raw number:

| Key | Label EN | Label FR |
|---|---|---|
| `players_1` | Solo | Solo |
| `players_2` | Two players or two hands | Deux joueurs ou deux mains |
| `players_3` | Three players | Trois joueurs |
| `players_4` | Four players | Quatre joueurs |
| `players_5plus` | More than four | Plus de quatre |

```sql
SELECT CASE WHEN players <= 1 THEN 'players_1'
            WHEN players = 2  THEN 'players_2'
            WHEN players = 3  THEN 'players_3'
            WHEN players = 4  THEN 'players_4'
            ELSE 'players_5plus' END AS key,
       COUNT(*) AS played, SUM(won) AS won, SUM(elapsedMillis) AS totalMillis
FROM plays WHERE deletedAt IS NULL GROUP BY key ORDER BY key
```

Ordered by key, not by count, because the buckets have a natural order.

**`players_5plus` should never appear.** Marvel Champions is a one-to-four
player game, so a row there is a game recorded wrongly — and a visible row
saying so is more use than silently folding it into the fours. The web used the
raw player count as the key, so a corrupt `7` quietly got its own row.

---

## 4. Naming

The two clients disagree in French about what an *aspect* is called: the web
says **aspect** throughout, Android says **affinité**.

**Corrected 2026-09-10.** This section previously said Android used *affinité*
in `plays_by_hero_aspect` and *aspect* elsewhere, and called it an
inconsistency to be tidied by changing one string. That was checked and is
wrong. Of the French values in `values-fr/strings.xml`, **fifteen say
*affinité* and none say *aspect*** — the filter, the randomiser, the deck
builder's prompts, the statistics heading, all of them. Android is entirely
consistent; the two apps simply chose different words. Changing the one string
would *create* the inconsistency this section set out to remove.

So this is not a typo to fix but a terminology decision across two apps, and it
is Benoît's to make rather than either client's:

- **Both say *aspect*** — fifteen Android strings change, and it matches what
  the French edition prints on the cards.
- **Both say *affinité*** — the web changes instead, and the phone's released
  wording is left alone.

Until it is decided, neither client should change: a released app's user-facing
noun is not worth churning on a premise nobody has confirmed. What must not
happen is the half-measure of changing `plays_by_hero_aspect` alone.

---

## 5. Empty and single-game histories

| Situation | Behaviour |
|---|---|
| No plays at all | No figures, no tables. One empty state explaining that recording a game fills this page. Never a wall of zeroes and `0%`. |
| One play | Headline figures all render. Win rate is `0%` or `100%` and that is honest. Tables render but every one has a single row; §3 says a one-row table adds nothing, so the clients may omit them. Hero-and-aspect (§3.3) is empty by its two-play floor. |
| Plays but none timed | Total and average are both `0`. Longest is `0`. Everything else is unaffected. |
| Every play deleted | Identical to no plays at all. |

---

## 6. What this document does not cover

- **Campaign statistics** (`campaign_stat_*`: victory points, market cards
  bought, credits left). Those are per-run figures derived from the campaign
  event log, not from `plays`, and belong in a campaign specification.
- **Presentation**: sorting controls, measures (win rate against share),
  collapsing, charts. Both clients may present these numbers however suits their
  platform. They may not compute different ones.
- **The history list**: filters, paging, detail. Same rows, no aggregates.

---

## 7. Changing a metric

Change this document first, in the same commit as the implementation, and change
both clients within the same release cycle. A metric that means one thing on the
phone and another in the browser is worse than a metric that is wrong in the
same way in both places: the second is a bug report, the first is an argument.
