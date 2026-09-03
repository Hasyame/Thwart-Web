# 02 — The sync protocol

**ADR-101 — Shape of the sync protocol**

**Status:** Accepted, 2026-08-30.

## Context

Two or three clients — a phone, a tablet, later a browser — each hold a full
copy of one user's data and each may be written to while offline. There is no
peer-to-peer channel: everything meets at one server. The data is small (a heavy
user is a few megabytes), the write rate is trivial (a handful of rows a day),
and the cost of a wrong merge is somebody's campaign log.

That combination rules out the interesting answers. CRDTs, operational
transforms and vector clocks all solve problems this system does not have, at a
cost in code that one person has to maintain forever. What it needs is the
dullest protocol that is actually correct.

## Options considered

1. **File-level sync** — treat the existing `Backup` bundle as the unit and
   ship whole snapshots. Trivial to build, and wrong: a snapshot cannot express
   a deletion, so merging two devices unions their rows and resurrects
   everything either has thrown away.
2. **Full CRDT** — per-field registers, causal delivery, the lot. Correct under
   any interleaving, and enormously more code than this problem justifies.
   Also very hard to debug alone at 23:00.
3. **Revisioned change feed with last-write-wins** — your proposal. A
   server-assigned monotonic revision per user, pull by cursor, push in
   batches, tombstones for deletes, union merge where the data allows it.

## Decision

**Option 3, essentially as you proposed it**, with five amendments. Your five
starting assumptions are right; the amendments are about the places where a
naive implementation of them is subtly broken.

| Your assumption | Verdict |
|---|---|
| Client-generated UUID primary keys | **Already true.** Doc 01 §3 — nothing to migrate. Do not adopt v7 as an invariant. |
| Server-side monotonic revision counter per user | **Right, and the single easiest thing to get wrong.** §2 |
| Last-write-wins by server revision, not client clock | **Right**, with three per-field exceptions. §4 |
| Tombstones with a documented retention | **Right.** 180 days, and the server must publish its horizon. §5 |
| Union merge for append-only entities | **Right**, and only `campaign_events` qualifies. §4 |

### The one structural decision you did not ask about

**The server does not understand the data.** A record is
`{collection, id, updatedAt, deleted, body}` where `body` is an opaque JSON
object the server stores, indexes by nothing, and never parses.

This is worth stating loudly because it drives everything else. It means:

- adding a field, or a whole new entity, to the Android app needs **no server
  deploy** — a decisive property when the server is a side project and the app
  ships every few weeks;
- the server has no domain model to keep in step with three clients;
- the server cannot leak card text, because it does not know what a card is;
- conflict resolution is per record, not per field, which is the only thing a
  dumb server *can* do — hence the per-field exceptions in §4 living on the
  client.

The cost: the server cannot validate anything beyond size and shape, so a
client bug can store nonsense. Acceptable — the client already validates, and a
validating server would only turn one bug into two.

---

## 1. Endpoints

Everything under `/v1`. JSON in, JSON out, `Authorization: Bearer <token>`
except where noted.

### Accounts

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/auth/register` | Create an account. No email required or requested. |
| `POST` | `/v1/auth/login` | Exchange handle + password for a device token. |
| `POST` | `/v1/auth/recover` | Exchange a recovery code for a password reset. |
| `POST` | `/v1/auth/password` | Change password (authenticated). |
| `GET` | `/v1/auth/devices` | List this account's device tokens. |
| `DELETE` | `/v1/auth/devices/{id}` | Revoke one. Revoking your own is logout. |

### Sync

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/sync/changes?since=<cursor>&limit=<n>` | Pull everything changed after `cursor`. |
| `POST` | `/v1/sync/changes` | Push a batch of dirty records. |

### Account rights and housekeeping

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v1/account/export` | Everything the account holds, in the app's `Backup` shape. |
| `DELETE` | `/v1/account` | Erase the account and all its rows. Irreversible. |
| `GET` | `/v1/health` | Liveness, for the reverse proxy and for you. |
| `GET` | `/v1/version` | Build and protocol version, so a client can warn about a too-old server. |

Eleven endpoints. That is the whole API.

### Registration without an email address

```http
POST /v1/auth/register
Content-Type: application/json

{ "handle": "benoit", "password": "..." }
```

```json
{
  "accountId": "018f2c...",
  "token": "tw_live_9f3a...",
  "recoveryCode": "TW-4KX9-2M7P-QR31-8VNE",
  "recoveryCodeIssuedAt": "2026-09-14T10:03:11Z"
}
```

`handle` is a local identifier, not an email and not validated as one. It may be
anything unique on the instance; the client should offer a generated one so a
user can create an account without inventing anything.

`recoveryCode` is CSPRNG output rendered in a grouped alphabet that excludes
look-alike characters. **It is shown exactly once**, and the client must insist
the user saves it (offer a download as a plain text file), which is the part
that makes this work without SMTP. The server stores only its Argon2id hash, so
a database dump does not yield recovery codes.

> **Amended during implementation: 80 bits, not the 128 first written here.**
> Sixteen characters from a 32-symbol alphabet is 80 bits. This is the one
> secret in the system a person has to copy by hand, and the length at which
> they stop doing that accurately is a real failure mode.
>
> Eighty bits is not a concession. Guessing one means defeating Argon2id at
> 64 MiB per attempt through a limiter that allows five tries an hour: the
> expected search runs longer than the age of the universe by many orders of
> magnitude. The binding constraint is the limiter, not the code, which is why
> the limiter's numbers are load-bearing rather than decorative.

Email is not a column with a `NULL` in it. It is **absent from the schema
entirely** in the first release. If optional email notification is ever added,
it goes in a separate `account_email` table that simply has no row for the vast
majority of accounts — so "this instance holds no email address for this user"
is a structural fact rather than a policy someone has to remember.

---

## 2. The revision counter, and the bug to avoid

Each account has a monotonically increasing revision counter. Every record the
server accepts is stamped with the next value. Clients pull with
`?since=<cursor>` and store the highest revision they have seen.

**The failure mode, which catches nearly everyone.** With a naive shared
sequence, two concurrent transactions can take revisions 41 and 42, and the one
holding 42 can commit *first*. A client that pulls in that window sees up to 42,
stores cursor 42, and never sees 41 — the row is invisible to that device
forever. It is not a rare race; it is the normal behaviour of any database with
concurrent writers and a sequence.

**The fix**: allocate the revision inside the same transaction as the write, and
serialise revision allocation per account.

```sql
BEGIN IMMEDIATE;
UPDATE account SET revision = revision + 1 WHERE id = ?;   -- takes the row lock
SELECT revision FROM account WHERE id = ?;
INSERT INTO record (...) VALUES (...) ON CONFLICT (accountId, collection, id) DO UPDATE ...;
COMMIT;
```

Two pushes for the same account now queue behind one row lock, so revisions
become visible in the order they were issued and no gap can be observed. Two
pushes for *different* accounts do not contend at all, which is the only
concurrency that matters here.

With the SQLite-and-single-Go-process stack recommended in doc 03 this is close
to free: a per-account mutex in the writer, plus `BEGIN IMMEDIATE`, and the
property holds by construction. Keep it anyway even if the database changes —
this is the correctness-critical part of the whole design, and it deserves the
test that reproduces the race with two concurrent pushes and asserts no puller
can skip a revision.

**Why revisions rather than timestamps.** You already gave the reason: device
clocks lie. A phone whose clock is a day fast would win every conflict forever.
`updatedAt` still travels in the record — the client needs it to display "edited
2 hours ago" and to break ties during first-sign-in adoption, where there is no
server revision yet — but **the server never orders anything by it**.

---

## 3. Pull and push

### Pull

```http
GET /v1/sync/changes?since=1840&limit=500
```

```json
{
  "changes": [
    {
      "collection": "plays",
      "id": "9e1c4b2a-...",
      "revision": 1841,
      "updatedAt": "2026-09-12T20:14:03Z",
      "deleted": false,
      "body": { "playedAt": 1757707200000, "scenarioCode": "01001", "won": true, "...": "..." }
    },
    {
      "collection": "owned_packs",
      "id": "mts",
      "revision": 1842,
      "updatedAt": "2026-09-13T09:00:00Z",
      "deleted": true,
      "body": null
    }
  ],
  "cursor": 1842,
  "hasMore": false,
  "minCursor": 1204
}
```

- Ordered by `revision` ascending, always. `hasMore` means page again from the
  new `cursor`.
- `deleted: true` records carry `body: null`. A tombstone is a revision like any
  other, which is what lets a delete propagate at all.
- **`minCursor` is the tombstone horizon**, the highest revision that has been
  swept away. A client whose stored cursor is below it has been away too long
  and must resynchronise fully. It is published on every pull, and it costs one
  integer.

  > **Amended during implementation.** This section originally said the point of
  > publishing it was that the client could detect the situation "without a
  > special error". The implementation publishes it *and* refuses the pull with
  > `cursor_too_old`, which section 8 already defined. Publishing alone relies
  > on every client remembering to compare two numbers; a client that forgets
  > receives a feed that looks complete and is not, and the deletions it never
  > hears about come back from the dead. Refusing makes it impossible to
  > miss. `since=0` is exempt, being the full resync itself.
- `since=0` means "everything", which is both first sign-in and full resync.

### Push

```http
POST /v1/sync/changes
Content-Type: application/json

{
  "batchId": "5c0f...",
  "records": [
    {
      "collection": "plays",
      "id": "9e1c4b2a-...",
      "updatedAt": "2026-09-12T20:14:03Z",
      "deleted": false,
      "baseRevision": 1799,
      "body": { "...": "..." }
    }
  ]
}
```

```json
{
  "cursor": 1851,
  "results": [
    { "id": "9e1c4b2a-...", "collection": "plays", "revision": 1851, "outcome": "applied" },
    { "id": "decklist-12345", "collection": "saved_decks", "revision": 1852, "outcome": "applied_over_conflict", "supersededRevision": 1830 }
  ]
}
```

Four properties, each earning its place:

**The batch is one transaction.** All records apply or none do. This is what
makes the partial-upload question in §6 boring.

**`batchId` makes it idempotent.** The server keeps `(accountId, batchId)` with
its response for 24 hours. A retry after a timeout — where the client cannot
know whether the write landed — returns the stored response rather than applying
twice. Without this, the single most common real-world failure (flaky mobile
network, request succeeded, response lost) silently duplicates writes.

**`baseRevision` is what the client last saw for that record**, or absent if the
record is new to the server. The server still applies the write either way — this
is last-write-wins, and refusing the push would only strand the client — but if
the stored revision is higher than `baseRevision`, the outcome is
`applied_over_conflict` and names the revision that was overwritten. That single
extra field turns silent data loss into something the client can tell the user
about, and it costs one integer per record.

**Batch limits are published and enforced**: 500 records or 2 MB, whichever
comes first, returned in `/v1/version` so a client does not have to guess.
A record body above 256 KB is rejected outright; nothing legitimate in this
schema is that big, and the cap keeps a client bug from filling the disk.

---

## 4. Conflict rules, per collection

| Collection | Rule |
|---|---|
| `campaign_events` | **Union merge.** Ids are stable and generated once; the same event pushed twice is the same row. Never updated, never deleted, no tombstone. Undo is an appended `revoke` event, which the engine folds away. Conflicts are not resolved here — they are impossible. |
| `campaign_runs` | Last-write-wins on the record, **with the three timer columns excluded from the body entirely** (doc 01 §2.5). `templateJson` is immutable after creation, so it never participates in a conflict. |
| `plays` | Last-write-wins, **except `reportedToBgg`, where `true` wins.** A stale `false` overwriting a `true` causes a duplicate BoardGameGeek submission — an outward-facing side effect, and the one field here where the wrong merge escapes the app. |
| `saved_decks` | Last-write-wins, **plus a fork rule.** See below. |
| `owned_packs` | Last-write-wins on `quantity`. |
| `favourite_cards` | Last-write-wins; on tie, keep the **earlier** `addedAt`, because the card was in fact starred then. |
| `excluded_modular_sets`, `excluded_scenarios` | Last-write-wins over presence and tombstone. |
| `randomizer_history` | Last-write-wins. Only `beaten` can be lost, and the user can tick it again. |
| `settings` | One record, last-write-wins **per key**, merged on the client. `dismissed_packs` merges as a union — a pack dismissed anywhere is dismissed. |

The per-field exceptions live in the client's merge code, not the server's. The
server applies last-write-wins to whole records and knows nothing else; the
client, which understands the entity, refines it when applying a pulled record
over a local one. This keeps the server dumb without giving up the three places
where dumb is wrong.

### The `saved_decks` fork rule

The only genuinely lossy conflict in the system. Two devices import MarvelCDB
decklist 12345 — fine, same id, idempotent. Two devices *edit* it offline —
last-write-wins throws away one person's deckbuilding.

Rule: if an incoming record would overwrite a local record where
**`locallyEdited` is true on both sides and the `slots` differ**, the client
keeps the incoming one at `decklist-12345` and re-keys the local one to
`local-<new-uuid>` with its name suffixed, then marks it dirty so it uploads as
a new deck. Nothing is lost; the user gets two decks and an explanation.

This is narrow on purpose. It applies to one collection, one field pair, and a
situation that requires deliberate offline editing on two devices. Everywhere
else, plain last-write-wins with the `applied_over_conflict` notice is enough.

---

## 5. Tombstones

A delete is a record with `deleted: true` and no body. It takes a revision like
any write, so it propagates through the same feed.

**Retention: 180 days.** Long enough that a device left in a drawer over a
summer still merges correctly; short enough that the table does not grow without
bound. A nightly job deletes tombstones older than the horizon and raises
`minCursor` to the oldest surviving revision.

A client whose cursor is below `minCursor` **must full-resync** (§6). This is
the only correct response: the server genuinely cannot tell it what it missed.

Two subtleties:

**Deleting a campaign run implies deleting its events.** The local `ON DELETE
CASCADE` stops firing once the parent is soft-deleted, and the events would
otherwise be pulled back as orphans. The client tombstones the run and
*suppresses* its events locally; the server needs no rule, because the run's
tombstone is enough for any client to reconstruct the same decision. Do not
tombstone thousands of events individually — a long campaign has a lot of them,
and the run's tombstone carries the same information for one revision instead of
hundreds.

**A tombstone can lose to a later write.** If a device deletes a play while
another edits its notes, and the edit arrives second, the play comes back. That
is last-write-wins working as specified, not a bug, and it is the right answer
more often than not: an edit is evidence somebody wanted the row.

---

## 6. The nasty cases

### The same record edited on two devices while offline

Phone and tablet both edit play `9e1c…` with no network. Both come back.

Phone pushes first: `baseRevision: 1799`, stored revision is 1799, applied
cleanly at 1841. Tablet pushes second: `baseRevision: 1799`, stored revision is
now 1841, so the server applies the tablet's version at 1852 and returns
`outcome: "applied_over_conflict", supersededRevision: 1841`.

The tablet's version wins because it arrived last. The tablet knows it
overwrote something. What it does with that is a product decision, and the
right one differs by collection:

- `plays`, `owned_packs`, `favourite_cards`, `randomizer_history` — say nothing.
  The stakes are a note or a number and a notification would be noise.
- `saved_decks` — apply the fork rule above.
- `campaign_runs` — say nothing; the campaign's actual state lives in the event
  log, which merged losslessly. Only the run's name or finished flag could have
  been lost.

The phone, meanwhile, learns nothing until its next pull, when it receives
revision 1852 and its edit quietly disappears. That is the honest cost of
last-write-wins, and it is the right trade here: the alternative is asking a
person to resolve a merge conflict about a note they wrote on a game they played
last Tuesday.

### A device that has been offline for six months

Its cursor is below `minCursor`. Detected on the next pull without a special
error path, because `minCursor` is in every response.

```
1. Pull with since=0. Take the whole account.
2. Reconcile locally, by id, per §7's three-way rule.
3. Push everything still dirty.
4. Store the new cursor.
```

The important part is what this is *not*: it is not "delete local and download".
The device may hold six months of plays that never reached the server, and those
must survive. Full resync is a **merge from cursor zero**, using exactly the
same reconciliation code as first sign-in. One code path, exercised by both the
common case and the rare one, which is the only way the rare one will ever
actually work.

### A partial upload that fails halfway

Cannot happen within a batch — the batch is one transaction. It can happen
*between* batches: three batches queued, the second fails.

- Batch 1 applied. Client advances its local high-water mark.
- Batch 2 fails: 5xx, timeout, or the phone leaving a tunnel. Nothing applied.
- Client stops, does not send batch 3, retries batch 2 later **with the same
  `batchId`**.

If batch 2 in fact succeeded and only the response was lost, the retry returns
the stored result and applies nothing twice. Records stay dirty until an
explicit success, so the worst outcome is re-uploading rows the server already
has — which, being keyed by id, is a no-op.

Batches must be pushed **in order and one at a time**, never in parallel.
Parallel batches from one device can interleave two edits of the same record and
land them in an order the device did not intend.

### Signing in on a device that already holds anonymous data

The case that matters most, and the one where a careless implementation is
unforgivable — someone's two years of play history either duplicated or gone.

**The rule: adoption is a merge, never a replace, it is idempotent, and it is
confirmed before it happens.**

Local rows carry no `serverRevision` in `sync_state` until they have synced,
which makes "never uploaded" a fact the client can read rather than infer.

```
1. Full pull from since=0 into a staging area — nothing touches the live
   tables yet.
2. Classify every id, in both directions:
     local only            -> adopt: mark dirty, will upload
     server only           -> insert locally
     both, same content    -> nothing to do
     both, differing       -> per-collection merge, below
3. Show the user the counts, before anything is written:
     "This account has 128 plays, 6 decks and 3 campaigns.
      This phone has 41 plays and 2 decks that are not in it.
      Merge them into the account?"
   with three answers: Merge, Keep only what is on the server
   (local data is exported to a backup file first), Cancel.
4. On Merge: apply in one local transaction, then push everything dirty.
```

Step 3 is not optional politeness. It is the difference between a feature people
trust and a feature that eats a stranger's campaign log the first time they try
it. And the export-first on "keep server only" means even the destructive answer
is recoverable.

The interesting collisions in step 2 are the **natural-key** collections, where
two never-connected devices genuinely can produce the same id — a UUID cannot
collide, but `owned_packs.mts` obviously can:

| Collection | Merge on first sign-in |
|---|---|
| `owned_packs` | `max(quantity)`. Owning it on either device means owning it. |
| `favourite_cards` | Union; keep the earlier `addedAt`. |
| `excluded_modular_sets`, `excluded_scenarios` | Union. An exclusion is a statement about a physical box; if either device says a set is missing, it is missing. |
| `saved_decks` | Same id and identical `slots` — one deck. Differing — the fork rule (§4). |
| `campaign_events` | Union, unconditionally. This is why event-sourcing the campaigns was such a good decision. |
| `plays`, `campaign_runs`, `randomizer_history` | UUID keys, so "both, differing" is impossible on a first sign-in. Anything local is new to the account and uploads. |
| `settings` | Ask, or default to the local device's, since that is what the person is looking at. |

Note the union rules deliberately favour **keeping data over discarding it**. On
a first merge there is no history to adjudicate with, so the safe direction is
inclusive: a wrongly kept favourite is a click to remove, a wrongly dropped
campaign is gone.

**Signing out** must be the mirror image: local data stays, `sync_state` is
cleared, the device returns to being anonymous with everything intact. Offer
"sign out and erase local data" as a separate, clearly labelled action for a
shared device — but never as the default, and never as a side effect of signing
out.

---

## 7. Error format, in both languages

The machine-readable `code` is the contract; clients translate it. The server
also returns a human string for whoever is holding `curl`, honouring
`Accept-Language` and defaulting to English.

```json
{
  "error": {
    "code": "cursor_too_old",
    "message": "Your cursor is older than the tombstone retention window; a full resynchronisation is required.",
    "details": { "minCursor": 1204 }
  }
}
```

The server carries FR and EN strings for its own small fixed set of codes.
**It does not translate anything about the data**, because it does not know what
the data is — that is the client's job, and the client already has the whole
`ttag`-equivalent apparatus for it.

Codes in the first release: `unauthorized`, `invalid_credentials`,
`handle_taken`, `invalid_recovery_code`, `cursor_too_old`, `batch_too_large`,
`record_too_large`, `malformed_record`, `rate_limited`, `server_error`.

> **Added during implementation: `registration_closed`.** An instance meant for
> one household needs a way to stop being one anybody can join, and the refusal
> has to be the server's — a client that stops drawing the form has changed
> nothing about who can register, since the endpoint is one curl away. The flag
> is `-registration=false`, `/v1/version` publishes `registrationOpen` so a
> client can stop offering a form that would be turned down, and **recovery
> stays open regardless**: it resets an account that already exists rather than
> creating one, and closing the door must not lock out the person whose account
> it is.

---

## Consequences

**Good.**

- The server is small — a first cut is a few thousand lines of Go, most of it
  the account handling rather than the sync.
- Adding an entity to Android needs no server change.
- One reconciliation code path serves first sign-in, six-months-offline resync,
  and disaster recovery, so the rare paths are exercised by the common one.
- The account is never a trap: `GET /v1/account/export` emits the app's own
  `Backup` shape, and `DELETE /v1/account` is real.
- Nothing in the protocol requires the server to hold an email address.

**Bad, and accepted.**

- Last-write-wins loses edits. Mitigated by `applied_over_conflict`, by the deck
  fork rule, and by the campaign log being immune, but not eliminated. For this
  data — a collection, some decks, a play history — it is the right trade.
- The server cannot validate bodies, so a client bug can store nonsense. The
  export endpoint and a schema-version field in each body are the escape hatch.
- Photographs are out of scope for the first release; the row syncs, the file
  does not.
- Tombstone retention is a real operational commitment: if the cleanup job stops
  running the table grows, and if it runs too aggressively clients are forced
  into avoidable full resyncs.
