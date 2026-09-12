# Android brief: starred games, difficulty ratings, and the `rejected` outcome

A prompt for a session working in `C:\MarvelChampionsCompanion` (Thwart for
Android). Paste it whole. It assumes the web repository is available read-only
at `C:\Thwart Web` for the contracts it cites.

---

You are working in `C:\MarvelChampionsCompanion`, the Android app **Thwart**
(Kotlin, Jetpack Compose, Room, WorkManager), a fan-made Marvel Champions LCG
companion. It syncs with a Go server at `https://thwart.app/api` through the
protocol in `C:\Thwart Web\docs\design\02-sync-protocol.md`. The web client in
`C:\Thwart Web\web` (Svelte 5 + Dexie) has shipped three things the phone does
not have yet, and one change to the protocol the phone must handle before it
can carry one of them. **Android is the declared master of the sync contract**:
where this brief and the phone's existing code disagree about a shape that is
already live, stop and say so rather than changing the phone.

Read first, in this order, before writing code:

1. `C:\Thwart Web\docs\design\06-android-sync-brief.md` — the standing
   Android brief; §6 is `favourite_plays`, and the section on the server's
   collection allowlist was corrected recently.
2. `C:\Thwart Web\docs\spec\ratings-and-modular-sets.md` — the ratings
   contract. §2.2 subject keys, §2.3 the record, §2.4 gating and the
   `rejected` outcome, §2.5 rating again, §2.6 campaigns, §3.3 the read API,
   §4 sync order, §8.1 anonymous users (local only), §8.4 (current opinion
   only, no history), §9 what was learned building the web side.
3. `C:\Thwart Web\server\ratings.go` — the judge. `validateRating`,
   `scenarioMatches`, `templateListsSet` are exactly what a rating is checked
   against; `handleRatingSummary` is the read endpoint.
4. `C:\Thwart Web\web\src\lib\ratings.ts`, `replay.ts`,
   `sync/collections.ts`, `sync/merge.ts`, `sync/ports.ts`, `sync/engine.ts`
   (`cursorAfterPush`) — the web's implementation, to mirror, not to copy.
5. `C:\Thwart Web\web\scripts\test-ratings.mjs` — what the web asserts.

Working rules for this repository, all of them standing:

- Commit as the repository's author, in English, imperative subject, a body
  that says why. **No `Co-Authored-By` trailer of any kind.**
- Say what you are about to push and wait for "push"; never push on your own.
- Never bundle or re-host card images or text; card data comes from MarvelCDB
  at runtime as it does today.
- Data minimisation: store and send only what the contract names.
- Never test against a real account. Register throwaway accounts on a local
  server (`C:\Thwart Web\server`, `go run . -addr 127.0.0.1:8790 -db
  /tmp/x.sqlite -rating-threshold 2`; no `-mail-from` means registration
  confirms at once) and point a debug build at it.
- This is stored-data work (a Room migration). Do not build a release or
  tag; the owner checks a debug build on the device first. Keep the F-Droid
  MR note in mind: every release is hand-carried into the MR as well.
- Verify against live sources — the server code and the web's tests — rather
  than assuming a shape. When a fact here contradicts what you find, report
  the gap.

## Tasks, in this order

### 1. Handle the `rejected` push outcome — before anything else

`data/sync/SyncEngine.kt`, the loop over `response.results` in the push
(around line 355), treats every result as a success: it counts
`applied_over_conflict`, adds every `result.revision` to `assigned`, and calls
`syncState.markSynced` for every record. The server now answers a record it
refuses with a fourth outcome:

```json
{ "id": "scenario:klaw", "collection": "ratings", "revision": 0,
  "outcome": "rejected", "reason": "subject_mismatch" }
```

`reason` is one of `not_played`, `subject_mismatch`, `invalid_score`,
`run_unfinished`, `rate_limited`. Today only `ratings` records can be
rejected, and the batch as a whole still succeeds (HTTP 200). As written the
phone would mark a rejected rating synced, never send it again, and show a
rating the server never stored — permanently.

Required:

- `RecordResultDto` (`data/sync/SyncModels.kt`) gains `reason: String? =
  null` and `OUTCOME_REJECTED = "rejected"`.
- In the push loop: on `rejected`, **delete the local row and its sync-state
  entry in the same transaction** (the web does this in `confirmPushed`),
  do not add its `revision` (it is `0`) to `assigned`, and do not
  `markSynced`. Nothing else in the batch changes.
- Surface it once, in plain words, and keep it until dismissed: the live
  stream pulls again within seconds, so a notice that lives only in the last
  sync's result is gone before it is read (the web learned this the hard
  way; see the ratings spec §9). Suggested French: *« Une note a été refusée
  par le serveur : elle ne correspondait à aucune de vos parties. »* — you
  choose the wording, the owner will read it.
- A unit test: a push response with one `applied` play, one `rejected`
  rating and one more `applied` play leaves the two plays synced, the rating
  row gone, and the cursor advanced past both plays. The web's
  `cursorAfterPush` test is the model.

Ship this even if nothing else in this brief ships: it is a protocol change
the server has already made.

### 2. `favourite_plays` — starred games

A game somebody starred, to find again and play again. Same shape and same
handling as `favourite_cards`, which already exists end to end
(`data/db/entity/FavouriteEntity.kt`, `dao/FavouriteDao.kt`, the
`FAVOURITE_CARDS` entry in `SyncCollection`, its branch in
`SyncRecordCodec.kt` and `SyncMerge.kt`). Doc 06 §6 has the contract.

Record, keyed by the play's id:

```json
{ "playId": "<play id>", "addedAt": 1757600000000 }
```

Rules:

- Collection name `favourite_plays`; id = `playId`; `updatedAt` = `addedAt`
  as ISO-8601.
- Merge: **the earlier `addedAt` wins** while both sides are live; a tombstone
  wins over a live row as everywhere else. (The opposite of ratings — read
  the comment in the web's `merge.ts`.)
- Unstarring is a tombstone, as for a favourite card.
- Deleting a play does not delete its star record on its own; the row simply
  points at nothing and the UI ignores it. (Match what the web does; check
  `web/src/lib/db.ts` `toggleFavouritePlay` and the history page.)
- Adoption (signing in with local data present) treats it like
  `favourite_cards`.

UI, minimum:

- A star toggle on the play detail screen.
- A "starred" filter in the plays list.
- If the phone has a "play again" affordance, a starred list on the setup
  screen with one-tap replay is what the web does; if it does not, leave that
  for a later brief and say so.

Room migration: new table, `deletedAt`/`updatedAt` columns as
`favourite_cards` has them, so tombstones and sync state work unchanged.

### 3. `ratings` — how hard was it

One current opinion per subject, from a signed-in account; **anonymous users
rate locally and nothing leaves the phone** (spec §8.1). No history: rating
again replaces (spec §8.4, decided "current").

Subject keys (spec §2.2), which are also the record ids:

- `scenario:<villain set code>` e.g. `scenario:rhino`
- `modular:<modular set code>@<villain set code>` e.g.
  `modular:bomb_scare@rhino` — a set is rated *with* the scenario it was
  paired with
- `campaign:<template id>` e.g. `campaign:gmw`

Record (spec §2.3):

```json
{
  "subject": "modular:bomb_scare@rhino",
  "score": 3,
  "ratedAt": 1757600000000,
  "evidence": { "playId": "<play id>" },
  "context": {
    "players": 2,
    "heroes": [ { "code": "spiderman", "aspect": "justice" },
                { "code": "captain_america", "aspect": "leadership" } ],
    "mode": "expert_i",
    "standardSet": "standard_ii",
    "scenario": "rhino"
  }
}
```

`evidence` is `{ "playId" }` for a scenario or modular rating and
`{ "runId" }` for a campaign rating. `context.scenario` is present only on a
modular rating. `score` is an integer 0..5. `updatedAt` on the wire is
`ratedAt` as ISO-8601.

The scale, six words, English / French (spec §2.1, §8.7): 0 Effortless /
Une formalité · 1 Easy / Facile · 2 Fair / Équilibré · 3 Hard / Difficile ·
4 Brutal / Brutal · 5 Impossible / Impossible. Nothing preselected; a rating
is never required; clearing is a tombstone.

**The server checks every rating against the play or run it cites** (spec
§2.4, `server/ratings.go`), and answers `rejected` when it does not match —
which is why task 1 comes first. To be accepted:

- the play or run must exist in this account, not tombstoned — pushed
  earlier, **or earlier in the same batch**. Therefore **`ratings` must be
  the last collection in the push order**, after `plays` and
  `campaign_runs`. The web had every rating refused on its first run because
  of this (spec §9); put a comment on the ordering saying why.
- `scenario:<S>`: the play's `scenarioCode` is `S`, or the play belongs to a
  campaign run whose template resolves that scenario to set `S`;
- `modular:<M>@<S>`: as above for `S`, and `M` is in the play's
  `modularSets` or in the template scenario's encounter/modular sets;
- `campaign:<T>`: the run's `templateId` is `T` and it is `finished`.

Campaign scenarios: a campaign play is recorded under the campaign's own
scenario id, not a card set, so the subject's set has to be resolved through
the run's template. Mirror `web/src/lib/replay.ts` (`campaignLayoutOf`) and
`ratings.ts` (`subjectsOfPlay`) exactly; the web's `test-ratings.mjs` asserts
`brotherhood_of_badoon` for the first *Galaxy's Most Wanted* scenario with
`band_of_badoon` and `ship_command` as its paired sets — reproduce that
assertion. *Fear No Evil* draws its villain, so its template names no
encounter set and the server takes the client's `scenario:<S>` as claimed
(spec §2.4, the paragraph added after the web build).

Merge: **the later `ratedAt` wins**; on a tie, the incoming.

Push gating: a rating is written to the sync queue only when signed in. A
rating made while signed out stays local; on sign-in, adoption decides with
the rest (treat as any other collection — the server will check it then).

Rate limit: 200 ratings per account per day; excess comes back
`rejected`/`rate_limited`. No client-side handling beyond task 1.

Reading the community's opinion (spec §3.3): `GET
/v1/ratings/summary?subject=<key>&subject=<key>…`, no token, at most 50
subjects per call, answer is a map keyed by subject:

```json
{ "scenario:rhino": { "count": 7, "mean": 2.4, "histogram": [0,1,3,2,1,0] },
  "modular:bomb_scare@rhino": { "count": 1 } }
```

`mean` and `histogram` are **absent below the server's threshold** (5 in
production): show the count only, or nothing, never a mean the server did
not send. Responses carry `Cache-Control: public, max-age=60` and an ETag;
memoise for a minute and batch subjects in fifties. A bare `modular:<M>`
(no `@`) may be asked for and is served as the sum over every pairing —
useful beside a set when the pairing itself has too few.

UI, minimum:

- After a play is saved, and on the play detail screen: one row per subject
  — the scenario, then each modular set "with <scenario>" — six choices each,
  the player's own shown, a clear control. Never show the community mean on
  the rating row itself (it anchors the answer); show it beside choices — a
  drawn scenario or set in the randomiser, a scenario in the custom setup, a
  campaign to start.
- On a finished campaign: one row, `campaign:<templateId>`.
- Wherever a badge is shown: the player's own score (★ n) regardless of the
  threshold, and the community mean with count only when the server sent one.

Room migration: `ratings` table keyed by subject, `ratedAt`, `score`, the
evidence and context as columns or a JSON blob (choose what the codec makes
simplest; the wire shape is what matters), tombstone columns as the other
tables have.

### 4. `plays_by_scenario` label

`data/db/dao/PlayDao.kt` line ~79 groups by `scenarioCode` while selecting a
bare `scenarioName`; a scenario ever recorded under two spellings (a language
switch, a renamed set) gets an undefined label. Take the name from the most
recent play in the group, as the hero labels do. `C:\Thwart
Web\docs\spec\statistics.md` records this; the web's parity test
(`web/scripts/test-android-parity.mjs`) runs the phone's own statistics
cases against the web, so keep the phone's test fixtures the source of truth
and add a case for two spellings.

### 5. Extra modular sets in the randomiser — lower priority

The web's randomiser can add up to five modular sets beyond a scenario's own,
from the same pool, and tells a collection that cannot supply them so before
the roll; a custom game takes as many as the player likes. Contract in the
spec §1; implementation in `web/src/lib/randomizer.ts`
(`MAX_EXTRA_MODULARS`, `modularCandidatesFor`, `modularShortfall`,
`scenariosShortOfExtras`); tests in `web/scripts/test-randomizer.mjs`. The
play record already has `modularSets` on the phone. Do this last, and only
after 1–4 are on the device.

### 6. Check, don't build: address confirmation

The web's README says the phone knows `email_not_verified` and can ask for a
new link (`SyncApi.resendVerification` exists) but not open `/v1/auth/verify`
itself. The confirmation link is meant to be opened in a browser at
`https://thwart.app/verify?token=…`, so there may be nothing left to do here.
Confirm what the phone does when the link is tapped on the device, and report
whether the README paragraph is still true; do not add an in-app verify
endpoint unless something is actually broken.

### 7. Signature cards: do not require a back side

Found while building the web editor on 12 September 2026, and the phone's
rule is the same one. `DeckBuilderRepository` builds `requiredCards` from
the hero's set minus encounter, hero and alter-ego cards. MarvelCDB also
lists the *flipped face* of a double-sided card under its own code, flagged
`hidden: true` — Phoenix Force is `34002a` and `34002b` — and a decklist
names the front only. Requiring the back calls every published Phoenix deck
illegal by one card that cannot be put in a deck (also Jubilee's and Nick
Fury's flip cards). Exclude `hidden` cards from `requiredCards` and from the
candidate list. Not every lettered code is a back side: Black Panther's
Wakanda Forever! is `01043a`–`01043d`, four printings, none hidden, all
required. The web asserts both with MarvelCDB decklist 40000 as a fixture
(`web/scripts/fixtures/decklist-40000-phoenix.json`); reuse it.

### 8. Sync on every write, on by default

On 12 September 2026 the web stopped syncing at named moments only and
hooks every write to a synced table (`web/src/lib/sync/auto.svelte.ts`,
`watchWrites`): a deck edited, a card starred, a pack ticked, all push after
a two-second settle, and the switch is on unless turned off. The phone's
`AutoSync` still fires on its named triggers (`SyncTrigger` enum), which do
not include a deck *edited* or a rating changed from a play's page, and its
switch defaults are its own. Bring it level: a trigger on every Room write
to a synced table (a `RoomDatabase.Callback`/`InvalidationTracker` on the
synced tables is the phone's equivalent of the Dexie hooks), writes made by
the sync engine itself excluded, and on by default once signed in. The
stream and `RETURNED_TO_APP` already cover the other direction.

Also found: the web never restored "this browser has adopted" at startup, so
its auto-sync was silent after every reload until the account page was
opened. Check the phone has no equivalent gap: that `adopted`/cursor state
is read before the first trigger can fire after a cold start.

## Definition of done

- Unit tests for: the `rejected` branch (task 1); both merge rules
  (favourite earliest-wins, rating latest-wins); subject resolution for a
  plain play, a campaign play (`brotherhood_of_badoon` case), and a play
  with no scenario; push ordering puts `ratings` last.
- A debug build against a local server, with two throwaway accounts: star a
  play on the phone, see it on the web; rate a scenario on the web, see the
  score on the phone; push a deliberately wrong rating (edit the subject in a
  test) and see it refused, gone, and the notice shown once; second account
  rates the same subject and, with the local server at `-rating-threshold
  2`, both clients show the mean.
- Doc 06 amended where the phone's shapes settle anything this brief left
  open, and a short report back: what shipped, what was left, and any place
  the phone's existing contract disagreed with the web.
