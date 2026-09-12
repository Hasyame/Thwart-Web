# Extra modular sets, and difficulty ratings

**Status.** Decided 2026-09-11, with one answer outstanding. §8.1, §8.2 and
§8.5 are settled as recommended; §8.3, §8.6, §8.7 and §8.8 stand as recommended
unless the operator says otherwise; **§8.4 (rating history) awaits one word**,
and the `ratings` record's key depends on it. Feature 1 does not, and is being
built. Where a rule leans on something that already exists in the code, the
file is named so it can be checked rather than trusted.

**Audience.** Both clients. Thwart Android implements this against the same
server and the same rules; if the two ever disagree about what a rating means,
the averages are meaningless. Android reads this rather than inventing its
own, and where this document is silent, Android is the reference, as
`docs/spec/statistics.md` establishes.

**Vocabulary.**

- A **subject** is the thing a rating is about: a scenario, a modular set, or a
  campaign.
- A **rating** is one player's current opinion of one subject: an integer from
  0 to 5.
- A **mandated** modular set is one the scenario's rules require; an **extra**
  is one added on top, by the randomiser or by hand.
- The **mode** of a game is what both clients already record as a play's
  `difficulty`: `standard_i`, `standard_ii`, `standard_iii`, `expert_i`,
  `expert_ii`, with `standardSet` beside it for an expert game. See §8.7 on
  Heroic, which neither client records today.

---

## 1. Extra modular sets

### 1.1 In the randomiser — *Rule*

The player states how many extra modular sets they want, **0 to 5, default 0**.
The default is what the randomiser does today, and must keep doing: a player
who never touches the control sees no change.

The draw is today's draw plus the extras, in the same pool and under the same
rules. Concretely, from `web/src/lib/randomizer.ts` `roll()` and the matching
Android `RandomizerModels`:

1. **Mandated sets come first, unchanged.** A scenario's `mandatoryModulars`
   are placed as they are now.
2. **The scenario's own count is honoured, unchanged.** `modularCount` plus
   `modularCountPerHero × players` — MojoMania's one-plus-one-per-hero, for
   instance — is drawn as it is now.
3. **Extras are drawn after, from the same candidate pool.** The pool is what it
   is today: owned sets, minus the mandated ones, minus the player's
   `excludedModularSets`, restricted to `modularPacks` when the scenario names
   its own pool. Civil War and She-Hulk sets never turn up as extras elsewhere,
   and a MojoMania scenario's extras come only from MojoMania — because the
   pool already says so, not because extras carry a rule of their own.
4. **No set is drawn twice.** Mandated, counted and extra sets are one list
   with no repeats. This falls out of drawing without replacement from a pool
   that excludes the mandated sets; it is stated here so a client that builds
   the draw differently still guarantees it.
5. **A collection that cannot supply the request is told so before the roll,
   and the randomiser never silently draws fewer than asked.** The scenario is
   drawn, not known, so this has three cases, all decided from
   `modularShortfall(pools, rule, players, extras)`:
   - **Scenario locked and short:** the roll button is replaced by the
     sentence *"Your collection has N modular sets for this scenario; it
     cannot add K."* The player chose it; drawing it short would be the silent
     shortfall this rule forbids.
   - **Scenario free, some short:** those scenarios are **left out of this
     draw**, and a line under the button says how many: *"3 scenarios cannot
     take 4 extras and are left out of this draw."*
   - **Scenario free, all short:** the button is replaced by *"No scenario in
     your collection can take K extra modular sets."*

   Locking the modular sets and rerolling the rest keeps the locked list,
   extras included, as locking works today.

The extras count is **a device preference, not synced**, like the auto-sync
toggle: it is an answer to "how do I like to play on this device", and the
`settings` record is fixed at five keys by the contract with the phone.

### 1.2 In a custom game — *Rule, with one Open point*

No cap. The player adds as many modular sets as they like. The picker must stay
usable at twenty selections, which means, at minimum:

- a **search box** over set names, in the card language;
- the **selected count** visible without scrolling, as *"7 modular sets"*;
- the **selected sets listed first**, each with its own remove control, so
  taking one out never means finding it again in the full list;
- the mandated sets shown **as already in play and not removable**, so nobody
  can build a game that the scenario's own rules would refuse.

Same rule against duplicates: a set the scenario mandates cannot be added
again, and the picker does not offer it.

**Ownership is Open — see §8.8.** The rule as written today is *owned sets
only*, which is what the picker offers now.

### 1.3 On the completed game — *Rule*

Whatever was on the table is recorded on the play, codes not names, in the
`modularSets` field that both clients now carry (web commit `8dd778e`, Android
1.49.0): comma-separated set codes, mandated and extra together, in the order
they were laid out. The notes line by name stays for readers, as it is now.

No distinction is stored between a mandated set and an extra one. The history,
the statistics and the ratings all want to know what was played, not why; and
a client can always re-derive which were mandated from the scenario's rules.

---

## 2. Difficulty ratings

### 2.1 The scale — *Rule*

An integer, **0 to 5**. Each value has a word in each language, and the words
are real translations of a feeling, not of each other:

| score | en | fr |
|---|---|---|
| 0 | Effortless | Une formalité |
| 1 | Easy | Facile |
| 2 | Fair | Équilibré |
| 3 | Hard | Difficile |
| 4 | Brutal | Brutal |
| 5 | Impossible | Impossible |

Both clients show the word beside the number. The number is what is stored
and averaged; the words are for the person choosing. *Proposed: see §8.7.*

### 2.2 Subjects and their keys — *Rule, with one Open point*

A subject is identified by a key, and the key is the rating record's id, so
**one record per player per subject is the data model** rather than a rule
someone has to enforce:

| subject | key | what identifies it |
|---|---|---|
| a scenario | `scenario:<setCode>` | the villain set code, e.g. `scenario:rhino` |
| a modular set | `modular:<setCode>@<scenarioCode>` | the set **and the scenario it was played with** |
| a campaign | `campaign:<templateId>` | the template, e.g. `campaign:gmw` |

**Why a modular set's key carries the scenario.** The brief asks that the
pairing be stored because a set's difficulty is mostly a function of what it
is combined with. Putting the pairing *in the key* rather than beside it does
two things at once: it means "rate again after replaying" replaces the rating
for *that pairing* and leaves the others standing, so per-pairing statistics
are possible from day one with no history table; and it means the bare
per-set average is simply the mean over every pairing — cheaper to compute,
and honest about what it is. The alternative, `modular:<setCode>` with the
scenario as context, loses every earlier pairing on re-rate. *This is Open —
see §8.3.*

A campaign scenario is rated by its **card set**, not by the campaign's own
scenario id, so a scenario played inside a campaign and the same scenario
played on its own are one subject. The set follows from the villain by the
same resolution the campaign tracker uses (`web/src/lib/ratings.ts`
`campaignLayoutOf`). Modular sets mandated by a campaign scenario are rated by
the same pairing key as anywhere else.

### 2.3 The rating record — *Rule*

A new **sync collection, `ratings`**, user-owned, synced exactly as every
other record: pushed and pulled by revision, tombstoned on removal, adopted on
first sign-in, released on sign-out, carried by the live stream. That is what
makes "rate on the phone, see it on the web, no reload" true with no new
transport.

```
collection  "ratings"
id          the subject key, verbatim        e.g. "modular:bomb_scare@rhino"
body        {
  "subject":   "modular:bomb_scare@rhino",   the key again, for readers
  "score":     3,                            integer 0..5
  "ratedAt":   1789100000000,                epoch millis, the client's clock

  "evidence":  { "playId": "<uuid>" }        OR { "runId": "<uuid>" } for a campaign

  "context": {
    "players":   2,
    "heroes":    [ { "code": "spiderman", "aspect": "justice" },
                   { "code": "captain_america", "aspect": "leadership, protection" } ],
    "mode":      "expert_i",                 the play's difficulty, as recorded
    "standardSet": "standard_ii",            "" for a standard game
    "scenario":  "rhino"                     for a modular set: the pairing, again
  }
}
```

`context` is a snapshot of the game the rating was given after, copied from
the play at the moment of rating. It is **write-once**: a later edit to the
play does not update it, and neither client displays it yet. It exists so the
data is not lost. `heroes` is the play's roster in seat order, aspects as the
play records them.

`evidence` is the play or run the rating was given after. It is what the
server checks (§2.4). It is not shown.

**Absent keys mean absent**, never zero: a rating with no `context` is an old
one, not one from a zero-player game.

### 2.4 Gating: you can only rate what you played — *Rule*

**Enforced on the server, at push, on every `ratings` record**, with a new
per-record outcome. The rule is checked against the referenced play or run
**as the server holds it** — pushed earlier, or earlier in the same batch,
which is why a client sends its plays before its ratings.

The server accepts a `ratings` record only if all of these hold:

1. `score` is an integer 0..5, and `subject` equals the record id.
2. `evidence.playId` (or `runId`) names a record in this account's `plays`
   (or `campaign_runs`) collection that is **not tombstoned**.
3. The subject matches the evidence:
   - `scenario:<S>` — the play's `scenarioCode` is `S`, **or** the play belongs
     to a campaign whose template resolves that scenario id to set `S`;
   - `modular:<M>@<S>` — the play's `modularSets` contains `M` and its
     scenario resolves to `S` as above;
   - `campaign:<T>` — the run's `templateId` is `T` and its `finished` is `true`.

   One campaign shape the resolution cannot check: a template scenario whose
   `baseSetup.encounterSets` is empty, because the campaign *draws* the
   villain at the table — every scenario of *Fear No Evil* (`fne`) does.
   The template names no set, so the server takes the client's `scenario:<S>`
   as claimed for such a play, after the play and run have been found and
   found live. A player could name any set there; it is a bounded hole (one
   rating per subject, from a logged-in account that did push a finished
   campaign play) and the alternative — refusing every rating of a drawn
   villain — was judged worse. The modular check is not relaxed the same way:
   `modular:<M>@<S>` still needs `M` in the template's encounter or modular
   sets, or in the play's own `modularSets`.

A record that fails is **not stored**, and the push result carries it as:

```
{ "id": "...", "collection": "ratings", "outcome": "rejected",
  "reason": "not_played" | "invalid_score" | "subject_mismatch" | "run_unfinished" }
```

`rejected` is a new outcome beside `applied`, `applied_over_conflict` and
`already_present`. **A client that sees it deletes its local copy and says so
once**, in plain words; it does not retry. The batch as a whole still
succeeds: one bad rating must not hold a hundred good plays hostage.

This is the one place the server reads inside a body, and it reads exactly
four fields: a play's `scenarioCode`, `modularSets` and `campaignRunId`, and a
run's `templateId`, `finished` and `templateJson` (for the resolution in §2.2).
It reads them to check, never to store or to serve, and every other collection
stays opaque. The departure is deliberate and this paragraph is its boundary.

*A test in `server/` proves that a rating whose evidence is a play this
account never pushed, a play that is tombstoned, a play of a different
scenario, or an unfinished run, is rejected with the right reason — and that
one rejected rating does not stop the plays beside it from applying.*

### 2.5 Rating again — *Rule, and Open*

Rating again is a new record with the **same id**, so it replaces the previous
one by ordinary sync: last write wins per the `ratings` merge rule below. The
evidence and context are those of the new game.

**Merge rule for `ratings`:** the later `ratedAt` wins; on a tie, the incoming.
A rating is an opinion, and the newer opinion is the current one — the
opposite of `favourite_cards`, where the *earlier* date is the truth.

Whether the previous opinion is kept anywhere is **Open — §8.4.**

### 2.6 Campaigns — *Rule, and Open*

A campaign is rated as a whole, once its run is **finished**, by the key
`campaign:<templateId>`, with `evidence.runId`. It is independent of the
scenario and modular ratings given inside it; finishing a campaign unlocks
nothing else and requires nothing else.

Whether replaying the campaign replaces the rating or adds one is **Open —
§8.5.**

### 2.7 When and where the client asks — *Rule*

- **After a game is recorded**, on the same screen that shows the result, as
  an optional row: the scenario, then each modular set that was in play, each
  with six choices and a *skip*. Nothing is preselected. Closing the screen
  without rating is not a state anyone has to confirm.
- **From the history**, on any completed game's detail: the same row, showing
  the player's current rating for each subject and letting them change it.
- **From a finished campaign's page**, for the campaign rating.

Never as a modal, never as a step, never before the result is saved.

### 2.8 What the player sees — *Rule*

- **Their own rating, always**, wherever a subject is shown and they have one.
  Their data is theirs; the threshold does not apply to it.
- **The community average only from 5 ratings**, and always with its count:
  *"3.2 · 7 ratings"*. Below 5, nothing is shown for the community — not
  *"not enough yet"*, not a greyed number. See §8.6 for whether the count
  alone may be shown.
- **The distribution** as five bars beside the mean, when the average is
  shown. It is one small element and it is where the truth of a bimodal
  subject lives.
- **Where it helps a decision:** the scenario browser (each scenario's
  average), the modular set list (each set's overall average), the randomiser
  result (the drawn scenario's average, and each drawn set's average *for that
  pairing* when it has one, its overall average otherwise), and the campaign
  list. Not on the rating row itself, where it would anchor the answer.

---

## 3. Aggregates

### 3.1 Not per-user data — *Rule*

Community averages are **never pushed through the per-user change feed** and
never appear on the live stream. They are served from a cached aggregate.

### 3.2 Server storage — *Rule*

Two tables beside `record`, both **derived** from the `ratings` collection and
rebuildable from it:

```
rating          -- one row per accepted ratings record, the structured index
  account_id, subject, score, kind ('scenario'|'modular'|'campaign'),
  set_code, scenario_code (nullable), rated_at
  PRIMARY KEY (account_id, subject)

rating_summary  -- one row per subject, maintained incrementally
  subject, count, sum, h0, h1, h2, h3, h4, h5
```

`rating_summary` is updated **by delta** inside the same transaction that
applies the record: an insert adds one; a replacement subtracts the old score
and adds the new; a tombstone subtracts. **Account deletion** subtracts every
rating the account held before the cascade removes them, in the same
transaction, so an average never counts a player who no longer exists. A
periodic reconciliation job may recompute a summary from `rating` and log any
drift; it must never be the normal path.

The per-set overall average (`modular:<M>` with no scenario) is a **view over
the pairings**: the sum of every `modular:<M>@*` row. It is computed on read
and cached like everything else; it is not a subject anyone rates.

### 3.3 The read API — *Rule*

```
GET /v1/ratings/summary?subject=scenario:rhino&subject=modular:bomb_scare@rhino&subject=modular:bomb_scare
-> 200 {
     "scenario:rhino":              { "count": 12, "mean": 3.25, "histogram": [0,1,3,4,3,1] },
     "modular:bomb_scare@rhino":    { "count": 3 },
     "modular:bomb_scare":          { "count": 41, "mean": 2.9, "histogram": [...] }
   }
```

- **No authentication.** Averages are community data and the scenario browser
  shows them to people with no account. Rate-limited per IP.
- **The threshold is enforced here**, not only in the UI: below 5, the entry
  carries `count` and nothing else, so no client can display a mean the
  contract says not to. (Whether `count` itself is returned below threshold is
  §8.6.)
- Up to **50 subjects per request**; more is `400`. A client asks for what a
  screen shows, not for everything.
- `Cache-Control: public, max-age=60` and an `ETag` over the response body,
  so a client can re-validate for free and a screen revisited within a minute
  costs nothing. The server keeps its own in-memory cache of summaries with
  the same TTL, invalidated per subject on write.
- `mean` is rounded to two decimals; `histogram` is six integers, index =
  score.

### 3.4 In the export and on deletion — *Rule*

`GET /v1/account/export` gains a `ratings` list, and `server/sync.go`'s
`collections` map gains `"ratings": {backupField: "ratings"}` — the same map
that decides what the export carries, and that today does not yet list
`favourite_plays` either (see §9). `DELETE /v1/account` removes the account's
ratings by the existing cascade and adjusts the summaries as §3.2 says.

### 3.5 Rate limits — *Rule*

Ratings ride the push endpoint, which is already limited. Two additions:

- `GET /v1/ratings/summary`: **120 per hour per IP**, generous because the
  scenario browser asks on every visit, and cheap because it is cached.
- **Ratings per account per day: 200.** Nobody rates two hundred subjects in a
  day; a client that does is a bug or a script, and the excess is `rejected`
  with reason `rate_limited` rather than the batch failing.

---

## 4. Sync and live — *Rule*

Nothing new. `ratings` is a collection, so:

- a rating made on the phone reaches the web by the ordinary pull, and the
  live stream says when to pull, as it does for a play;
- the adoption flow on first sign-in offers local ratings like any other local
  data, and they are validated on push like any other — an anonymous rating
  that turns out not to match a play the server holds is `rejected` then, and
  the client tells the person once;
- signing out releases the account's ratings with the rest.

The client's **own** rating for a subject is read from its local `ratings`
table, never from the summary endpoint. The two are different questions.

---

## 5. Self-hosted instances — *Open, §8.2*

Laid out there with the trade-offs.

---

## 6. What Android adds

- The `ratings` collection in `SyncCollection`, a table, and the merge rule
  (§2.5).
- Handling of the `rejected` outcome: delete the local record, say so once.
- The extras control on the randomiser (§1.1) and the picker requirements on
  the custom game (§1.2).
- The rating row after a game and in the history (§2.7), the campaign rating
  on a finished run (§2.6), and the displays in §2.8 backed by the summary
  endpoint (§3.3).
- The six words in each language (§2.1), once agreed.

---

## 7. Definition of done, as tests

- Randomiser: extras 0..5, the pool respected, no duplicate, the supply check
  before the roll. *Unit tests over `roll()` with a fixed seed.*
- Custom game: an arbitrary number of sets; the picker's search, count,
  selected-first and remove. *Driven in a browser at 375px.*
- Ratings given, changed, and left blank for a scenario, a modular set, and a
  finished campaign; a rating never required. *Unit tests over the record
  builder; the flow driven in a browser.*
- Threshold: below 5 no mean is served or shown; the player's own rating shown
  regardless. *A server test on the summary endpoint; a unit test on the
  display.*
- Server gating with the four rejection reasons and the batch surviving one
  rejection. *`server/ratings_test.go`.*
- Own ratings live to a second client. *`deploy/live-probe.py` gains a rating.*
- Export carries ratings; deletion removes them and corrects the summary. *A
  server test that rates, deletes the account, and reads the summary.*
- FR and EN complete, the six words included.
- 375px, iOS Safari: the six-choice row fits one line or wraps to two evenly,
  and the picker's search does not zoom the page (16px input).

---

## 8. Open questions

Each with the options, what each costs, and a recommendation. **Nothing
below is decided.**

### 8.1 Anonymous users — *Decided: local only*

Only a signed-in player's ratings reach the server; an anonymous player's stay
on the device and never count. Stated reason: to limit what a bot or a troll
can do to the averages, since the gating in §2.4 needs an account to check
against.

**Recommendation, as adopted: as your instinct says.** A person with no account records
ratings locally, sees their own everywhere the contract says, and nothing is
uploaded or counted. An endpoint that accepts unauthenticated ratings is an
invitation to stuff them, and the gating in §2.4 is meaningless without an
account to check the evidence against.

Two consequences worth stating:

- **On sign-in, their local ratings are adopted** with everything else, and
  validated on push like everything else. So a rating given anonymously for a
  game they also played anonymously *does* count, later, once both are on the
  server — which is right: the evidence exists.
- **A self-hosted single user is the same case** with a different reason
  (§8.2).

No disagreement.

### 8.2 Self-hosted instances — *Decided: (b) now, (c) in bulk form if asked*

A self-hosted instance has one user and never reaches five ratings. Three
options:

**(a) Accept it.** The rating row still works; the player sees their own; the
community average never appears. Zero cost. The feature is *diminished* there,
not dead — a self-hoster still gets "how did this feel last time".

**(b) A configurable threshold**, `-rating-threshold N`, default 5, on the
server. Cost: one flag, ten lines. A self-hoster sets 1 and sees their own
mean, which is their own rating restated; a small group instance sets 3 and
gets something real. Harmless, and it makes the threshold a stated policy
rather than a constant. **Recommended regardless of (c).**

**(c) Read aggregates from the canonical instance**, `-ratings-from
https://thwart.app`, while keeping every rating local. The self-hosted server
proxies `GET /v1/ratings/summary` to thwart.app and caches it; nothing is ever
sent upstream but the request.

The privacy question is exactly what that request reveals. **Per-subject
queries reveal what the instance's users play** — thwart.app would see that
one IP asks about *Rhino* and *Bomb Scare* on Tuesday evenings. That is a
fingerprint of a household's games, sent to a third party, and it is more than
a self-hoster signed up for. The mitigation is to **make the upstream read a
bulk one**: the self-hosted server fetches the whole summary table — a few
kilobytes — on a timer, and answers its own users from that copy. Then
thwart.app learns only that an instance exists and how often it refreshes,
which is the same as being a public website. **If (c) is wanted, it must be
the bulk form**, and `GET /v1/ratings/summary` should therefore also offer a
`?all=1` variant, rate-limited harder and cached longer.

Contributing ratings upstream from a self-host is **not** proposed. It would
send personal data to an instance the person has no account on, and the
canonical instance could not gate it (§2.4).

**Recommendation: (b) now, (c) in the bulk form if a self-hoster asks.**

### 8.3 The modular set key

**Recommendation: `modular:<set>@<scenario>`**, for the reasons in §2.2. The
alternative — `modular:<set>` with the scenario in `context` — keeps the
pairing data the brief asks for only until the player rates the set again
after a different scenario, at which point the earlier pairing is gone. With
the pairing in the key nothing is lost and no history table is needed.

Cost: a player who has played Bomb Scare with four villains has four Bomb
Scare ratings, and the history's rating row shows the one for *this* game. The
overall per-set average is a view (§3.2). Nothing else changes.

### 8.4 Rating history — *Awaiting one word: history, or current*

The operator answered "yes" to a question that offered two readings. If
**history**: every rating is its own record, `ratings` is keyed by a UUID,
`current` is the newest `ratedAt` per subject, and the server index carries a
`current` flag that the summary counts by. If **current**: as §2.3 is written.
Nothing in Feature 1 depends on this.

**What keeping it costs:** the `ratings` record can no longer be keyed by
subject, so "current" becomes a derivation over records rather than a lookup;
every re-rate is a new record that syncs and stays synced forever; the server
index needs a `current` flag and the summary must count only current ones;
the export grows; and the UI needs somewhere to show a line that most subjects
will never have more than one point on. Roughly: one more day on each client
and on the server, and a permanent second concept.

**What it buys:** *"this felt like a 4 the first time and a 2 the third"* —
real, and the kind of thing people enjoy seeing about themselves. But nothing
in the averages needs it, and with §8.3 the pairing case is already covered.

**Recommendation: current only, for now.** The record's `ratedAt` and
`evidence` already say *when* and *after what*; if the line is wanted later,
a `rating_history` collection can be added without touching the current one.
Adding history later costs the same as adding it now; adding it now and not
using it costs every day in between.

### 8.5 Campaign scope — *Decided: one per campaign, replacing, same threshold*

As for a scenario: one rating per player per campaign, the newer replacing
the older, and the community average shown only from five ratings.

Two readings of "replaying the same campaign":

- **One rating per campaign, replacing.** Consistent with scenarios: the key
  is `campaign:<templateId>`, the newest opinion wins. Simple, and the
  average means "how hard is Galaxy's Most Wanted".
- **One rating per run.** Key `campaign:<templateId>@<runId>`. Keeps each
  playthrough's opinion, and the average is over runs rather than players —
  which means one enthusiast who runs it five times counts five times,
  distorting exactly the number the feature exists to produce.

**Recommendation: one per campaign, replacing**, keyed by template, with the
run as evidence. If a per-run line is ever wanted it belongs with rating
history (§8.4), not in the key.

### 8.6 Two small ones

- **Below the threshold, may the count be shown?** The contract says show
  nothing for the community. Returning `count` alone lets a client say *"2
  ratings so far"*, which is honest and mildly motivating, and reveals nothing
  about opinions. It also lets someone watch a count climb as they stuff it,
  which is why the gating in §2.4 has to be real. *Recommendation: return it,
  show it only as a count, never as progress toward a number.*
- **Extras vs mandated on the record.** §1.3 stores one list. If you ever want
  *"how hard is Rhino with two extras"* as a statistic, the count of extras
  would need recording. It can be derived from the scenario's rules for as
  long as the rules do not change; they do change, occasionally, when a data
  fix lands. *Recommendation: one list, and accept that.*

### 8.7 Heroic, and the six words

- The brief lists **Heroic** among the modes. Neither client records a heroic
  level anywhere: `Play.difficulty` is one of five values and Android's
  `Difficulty` enum is the same five. Capturing it means a new play field on
  Android first, per the contract's own rule, and a control on every game
  screen. **Recommendation: leave Heroic out of the first version** and record
  `mode` as the five values that exist. `context` is additive; a
  `heroicLevel` key can join it later with no migration.
- The **six words** in §2.1 are a proposal. *Une formalité* for 0 and
  *Équilibré* for 2 are the two I am least sure read naturally to a French
  player; a native ear should confirm or replace them before they ship in
  both apps.

### 8.8 Custom game and sets outside the collection

Playing with a friend's cards is real. The randomiser's rule is *owned only*,
and it should stay that way — a draw from sets you do not have is a draw you
cannot lay out. A **custom** game is different: the person is telling the app
what is on the table, not asking it to choose.

**Recommendation: allow it, behind one tap.** The picker offers owned sets by
default, with a *"Show all sets"* toggle that opens the rest, marked as not in
the collection. A game recorded with such a set is an ordinary play; the
statistics and ratings do not care where a card was borrowed from. The
alternative — refusing — teaches people to tick packs they do not own, which
poisons the collection for every other feature.

---

## 9. Things noticed while writing and building this

- **`favourite_plays` was not in the server's export map** — and, worse than
  the export, `validateRecords` in `server/sync.go` refuses a whole batch for
  a collection it does not list, so the first push of a starred game would
  have failed with every play beside it. Both `favourite_plays` and `ratings`
  are in the map now (server commit `dbe9201`), which is also why the server
  must be released before a web build that pushes either. Doc 06's allowlist
  section was corrected to say the map is an allowlist and not only an export
  list.
- **The `rejected` outcome is new to the protocol, and Android will
  mis-handle it as written.** Doc 02 lists three outcomes; this adds a fourth.
  Android's `SyncEngine.push` (`data/sync/SyncEngine.kt`, the loop over
  `response.results`) treats every result as a success: it counts
  `applied_over_conflict` and then calls `markSynced` for the record whatever
  the outcome says. A `rejected` rating would therefore be marked synced on
  the phone and never sent again, while the server holds nothing — the phone
  showing a rating that does not exist, permanently. **Android must handle
  `rejected` explicitly** — delete the local record, tell the person once —
  before it ships ratings. The web engine has the branch: `confirmPushed`
  deletes the row and its sync record in one transaction, the cursor steps
  past the refusal (`cursorAfterPush`), and the sync panel keeps the notice
  until dismissed, because the live stream pulls again seconds later and a
  notice that lived only in the last sync's result was gone before it was
  read. `web/scripts/test-ratings.mjs` covers the cursor; the server test in
  §2.4 covers the refusal.
- **Push order is a contract.** `COLLECTIONS` in
  `web/src/lib/sync/collections.ts` is also the push order, and the first
  end-to-end run had every rating refused as `not_played` because `ratings`
  sat before `plays`. It is last now, with a comment saying why; a client that
  reorders it silently breaks §2.4's "earlier in the same batch".
