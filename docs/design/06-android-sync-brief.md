# 06 — Brief: the sync client on Android

**Status:** Written 2026-09-03, for the Android side of Thwart.
**Amended 2026-09-04:** accounts now carry an email address, and signing in uses
it. Section 3 and the new section 4 are the parts that changed; if you read the
first version of this document, read those two again and nothing else.
**Audience:** whoever implements sync in `Hasyame/Thwart`.

This is not a design document. Doc 02 is the design and it is settled; this says
what is already built, what the Android app has to add, and which four things
will go wrong if they are approached casually.

---

## 1. What already exists

**The server is finished and deployed** at `https://thwart.app/api/v1`. Eleven
endpoints, accounts with Argon2id passwords and recovery codes, per-account
revision counters, tombstones, batch idempotency. It has tests. Nothing about
it needs changing to add a client.

**The web client has the transport, the account screen and change detection.**
It does not yet pull, push or merge. Both clients are being written against the
same protocol at roughly the same time, which is the reason for this document:
the two must agree without either being able to see the other.

**The Android app already has the local half of the state.**
`SyncStateEntity.kt` defines `SyncCollection` with nine keys, and those keys are
the contract. The web client reads them from that file. Do not rename one
without changing both, and understand that a rename **fails silently** — the
server stores whatever key it is handed and never parses a body, so a mismatch
does not error, it quietly builds a second set of records the other client never
sees.

What Android does not have is the transport: nothing in the app has ever called
the server.

---

## 2. The shape of the work

1. An HTTP client for the eleven endpoints, with the `Bearer` token and the
   error envelope.
2. Somewhere to keep the token, the account and the cursor. `SyncStateEntity`
   is already most of it.
3. Change detection: which local rows differ from what the server confirmed.
4. Pull, merge, push.
5. The account screen, and the opt-in switch.
6. First-sign-in adoption.

Steps 4 and 6 are where the risk is. Steps 1 to 3 are ordinary work.

---

## 3. The contract, in the form you need it

### Auth

```
POST /v1/auth/register   {handle, email, password, deviceName}
     -> {accountId, handle, email, token, recoveryCode,
         recoveryCodeIssuedAt}                                           201
POST /v1/auth/login      {email, handle, password, deviceName}
     -> {accountId, handle, email, token, recoveryCodeIssuedAt}          200
POST /v1/auth/recover    {email, handle, recoveryCode, newPassword,
                          deviceName}
     -> as register, with a fresh recoveryCode                           200
POST /v1/auth/password   {currentPassword, newPassword}                  auth
GET  /v1/auth/devices    -> {devices: [{id, name, current, createdAt, lastSeen}]}
DELETE /v1/auth/devices/{id}                                             auth
```

`recoveryCode` is returned **once** and the server keeps only its hash. The
screen must refuse to move on until the user has saved it, and must offer it as
a file. The server cannot send email yet, so until it can, that code is still
the only way back into an account whose password has been forgotten — the
address does not rescue anybody on its own.

`registrationOpen` is published by `GET /v1/version`. thwart.app currently has
registration closed; an instance that refuses will answer
`403 registration_closed`. Offer the form only when the instance says it is
open, but do not rely on that — the refusal is the server's.

### Sync

```
GET  /v1/sync/changes?since=<cursor>&limit=<n>
     -> {changes: [...], cursor, hasMore, minCursor}
POST /v1/sync/changes    {batchId, records: [...]}
     -> {cursor, results: [{id, collection, revision, outcome, supersededRevision?}]}
```

A record on the wire:

```json
{ "collection": "plays", "id": "<uuid>", "revision": 1841,
  "updatedAt": "2026-09-12T20:14:03Z", "deleted": false, "body": { ... } }
```

Pushing one is the same minus `revision`, plus `baseRevision` — what you last
saw for that record, absent when it is new to the server.

Limits come from `GET /v1/version` rather than being hardcoded: currently 500
records or 2 MB per batch, 256 KB per record, 1000 per page.

---

## 4. The address

Added after the first version of this document. It changes three screens and
nothing else — sync is untouched, and no record body gains a field.

### What goes on the wire

**Registering takes both.** An address *and* a pseudonym, because they answer
different questions: the address is how you get back in, the pseudonym is what
you are called. Both are required; a registration without an address is refused
with `invalid_email`.

**Signing in and recovering take one field.** The server reads `email` first
and falls back to `handle`, and `AccountByIdentifier` resolves either. Show one
box labelled *Email address* and send what was typed as **`handle`**:

```json
{"handle": "<what was typed>", "password": "..."}
```

> **Corrected 2026-09-04.** This section first said to send the value in
> `email` *and* `handle`, on the grounds that it cost nothing and would also
> satisfy a server too old to know about addresses. That was wrong, and the
> Android side was right to check rather than take it on trust: every account
> endpoint decodes with `DisallowUnknownFields`, so a body carrying `email`
> against a pre-address build is refused outright as `malformed_record`. The
> advice would have broken sign-in on exactly the server it claimed to
> protect.
>
> `handle` alone reaches the same account on both builds, because the newer
> server falls back to it and resolves an address through it. One field, and
> it works everywhere.

**Responses now carry `email`.** Register, login and recover all return it.
Store it next to the handle so the account screen can show which address is
signed in; treat it as optional, because an older server does not send it and
the account made before this change has none until it is set.

### What it is not

- **Not verified.** There is no confirmation link, because there is no SMTP
  relay yet. Do not build a screen that waits for one. The column
  `email_verified_at` exists in the schema so that adding it later is not a
  fourth migration; it is null for everybody and the API does not expose it.
- **Not a way back in yet.** See above: the recovery code still is.
- **Not required to use the app.** This is the part that matters legally and
  the part easiest to erode by accident. Thwart works with no account at all —
  collection, decks, plays, campaigns, all local. An account buys sync and
  nothing else. Nothing in the app may become unreachable behind a sign-in, and
  no screen should ask for an address in order to do something local.

### Passwords

The rule changed with the address and is now length-led, with **no composition
classes**: at least 12 characters counted as runes, not the pseudonym or the
address and not containing either (for tokens of four characters or more), at
least five distinct characters, and not one of a short list of obvious ones.

Twelve *runes*, so a French passphrase is not penalised for its accents. No
"one uppercase, one digit, one symbol", deliberately: that rule is satisfied by
`Motdepasse1!`, which is shorter and more guessable than four ordinary words.
What actually defends the system is Argon2id at 64 MiB per attempt and a
limiter of five tries an hour, both of which already existed.

**Do not re-implement this client-side.** Show the rule as a hint under the
field, let the server decide, and print its `weak_password` message. Two copies
of a password policy is two policies, and the one on the phone will be the
stale one.

### New error codes

| code | when |
|---|---|
| `invalid_email` | no address, or one that is not shaped like an address |
| `email_taken` | that address already has an account (case-insensitively) |
| `invalid_handle` | pseudonym outside 3–32 chars of `[A-Za-z0-9._-]` |
| `weak_password` | fails the rule above |

`invalid_handle` and `weak_password` existed before but were not listed here.
All four come back with English and French messages, chosen by
`Accept-Language`, so a client with nothing to say for a code can print
`error.message` and be correct in both languages.

### Storage on the device

The address belongs wherever the token, handle and cursor already live — one
row for the session, not one per record — and it is not synced as a record:
it belongs to the account, not to the data, and the server is the only copy
that matters. It also has no business in anything that gets written to a backup
file, for the same reason the bearer token does not.

*(This first said "`SyncStateEntity` needs one nullable `email` column", which
was written without checking that the table is one row per record. Android put
it in the session store instead, which is right.)*

---

## 5. The four things that will go wrong

### 5.1 Batches in order, one at a time, and never in parallel

Two batches in flight can interleave two edits of the same record and land them
in an order the device did not intend. Queue them.

If a batch fails, **stop** — do not send the next one — and retry that batch
later **with the same `batchId`**. The server keeps `(accountId, batchId)` and
its response for 24 hours, so a retry after a lost response returns the stored
result rather than applying twice. Without this, the commonest real failure —
request succeeded, response lost on a flaky mobile network — silently
duplicates writes.

Records stay dirty until an explicit success. Re-uploading rows the server
already has is a no-op; assuming a write landed is not.

### 5.2 `minCursor` and the full resync

Every pull publishes `minCursor`, the tombstone horizon. A cursor below it means
this device has been away longer than the 180-day retention and the server
genuinely cannot say what it missed. The server also **refuses** such a pull
with `cursor_too_old` — you cannot forget to check.

The response is a full resync, and the thing to get right is what that is *not*:
it is **not** "delete local and download". The device may hold six months of
plays that never reached the server. It is a merge from `since=0`, using exactly
the same reconciliation code as first sign-in. One code path for both, which is
the only way the rare one will ever actually work.

**Send `resync=1` on every page of it**, not only the first:

```
GET /v1/sync/changes?since=<cursor>&limit=<n>&resync=1
```

`since=0` was always exempt from the horizon check, but the later pages were
not, and that was a server bug — reported from the Android side and fixed on
2026-09-04. Page two resumes from the last revision of page one, and a live
record untouched since before the last sweep carries a revision below the
horizon, so a large account failed on its own second page with no way forward.
There is now a test for it.

The flag is a claim only the client can make: the server is stateless between
requests and cannot tell "resuming from an old cursor" from "paging through a
resync that started at zero". It is not a privilege. A client that sets it on
an ordinary resuming pull only serves itself an incomplete feed, which is the
exact harm the refusal exists to prevent. An older server ignores the parameter
and behaves as it did.

### 5.3 Signing in on a phone that already holds data

The one that is unforgivable to get wrong: somebody's two years of play history
either duplicated or gone.

**Adoption is a merge, never a replace, and it is confirmed before it happens.**

```
1. Full pull from since=0 into a staging area. Nothing touches the live tables.
2. Classify every id, both directions:
     local only          -> adopt: mark dirty, will upload
     server only         -> insert locally
     both, same content  -> nothing to do
     both, differing     -> per-collection merge (doc 02 §6)
3. Show the counts BEFORE writing anything:
     "This account has 128 plays, 6 decks and 3 campaigns.
      This phone has 41 plays and 2 decks that are not in it.
      Merge them into the account?"
   Three answers: Merge / Keep only what is on the server (export local to a
   backup file first) / Cancel.
4. On Merge: apply in one local transaction, then push everything dirty.
```

Step 3 is not politeness. It is the difference between a feature people trust
and one that eats a stranger's campaign log the first time they try it.

The natural-key collections are where two never-connected devices genuinely
collide — a UUID cannot, `owned_packs.mts` obviously can. Merge inclusively:
`max(quantity)` for packs, union for favourites keeping the earlier `addedAt`,
union for exclusions, union unconditionally for campaign events. On a first
merge there is no history to adjudicate with, so the safe direction is keeping
data: a wrongly kept favourite is one tap to remove, a wrongly dropped campaign
is gone.

### 5.4 Signing out

Local data **stays**. The sync state is cleared, the device is anonymous again
with everything intact. Offer "sign out and erase local data" as a separate,
clearly labelled action for a shared phone — never as the default, and never as
a side effect of signing out.

---

## 6. Decisions taken since doc 02

### Sync is opt-in

An account is the security boundary — every sync endpoint is behind
authentication, so there is no anonymous path to anybody's records. But signing
in must not start syncing on its own.

- **Signing in** answers *who are you*. It records a token and stops.
- **A switch, off by default,** answers *should this device stay in step*.

The adoption conversation in §5.3 belongs to the switch, not to sign-in. Firing
a merge dialogue at somebody who only wanted to sign in is how the feature earns
a reputation before it has done anything.

### `settings` syncs, and the web will apply it

`SyncCollection` has nine collections and settings is not one of them. Doc 01 §6
says five of the six preference keys should sync, and doc 02 §4 already writes
the merge rule. The web client is implementing it. **Android should match this
exactly or say so before writing something different:**

```
collection  "settings"
id          "app"                     one record per account
body        { cardLocale, themeChoice, playLocation,
              trackEncounter, dismissedPacks: [...] }
merge       last-write-wins per key
            dismissedPacks union-merged — a pack dismissed anywhere is dismissed
            lastCardSync never syncs: it is about one device's fetch
```

If Android would rather define this differently, that is fine — but decide
before both sides write it, because a mismatch here is silent for the same
reason a collection name is.

### A play can be set aside

Added to the web on 5 September 2026, and it needs a column on your side.

`plays` gains an optional boolean, `ignored`. A play with it set is kept — it is
still a row, still in the backup, still on every device — and left out of the
statistics: a demo taught to somebody, a duplicate entered twice, a night that
went nowhere. One tap in either direction, which is the point: it is a
preference, not a deletion, and deletion is offered separately beside it.

```
collection  "plays"
body        { ..., "ignored": true }     absent means false
```

**Absent must read as false, never as unknown.** Every play recorded before
this existed has no opinion, and a three-state reading of it would put a
question mark on somebody's entire history.

Until Android has the column this is fragile in one direction, and it is worth
saying exactly how. The web's `plays` mapping spreads the body it is given, so
a flag Android does not know about survives a round trip through this client.
Android rebuilds a play from the fields it knows, so **the first time Android
edits a play the web has flagged, the flag is dropped** and that game quietly
returns to the statistics. Adding the field fixes it; nothing else needs to
change.

Filter it in one place rather than at each screen that counts. The web puts the
test inside the statistics function itself, because a filter every caller has to
remember is one a caller will forget — and the failure is silent: the reader
sets a play aside, the number does not move, and the only way to find out is to
count by hand.

---

### What does not sync

- **`paused_games`** — a game put down mid-play describes the table in front of
  one person. Doc 01 §6 excludes it and the web client does too.
- **The three timer columns on `campaign_runs`** — excluded from the body
  entirely. A running clock is a fact about the device somebody is holding.
  Syncing it has a phone pull a `timerRunningSince` from a tablet that is
  mid-game and start counting a session nobody is playing.
- **Photographs** — the row syncs, the file does not, in this release.

---

## 7. Two things worth stealing from the web client

**Change detection without a dirty flag.** The web keeps, per record, the
revision the server gave it and a digest of the body that was sent. A row whose
current body hashes differently has been edited; a row with a state and no table
row has been deleted. No write anywhere in the app can forget to mark a record,
which is the commonest way a sync client loses an edit. It moves the risk into
the digest, so the digest is tested: field order must not matter, an absent
field must hash like one that was never there, and `null`, `""` and `0` must all
differ.

Room has change-tracking options Android may prefer. Either is fine; what
matters is that "never uploaded" is a fact the client can read rather than
infer.

**Say when nothing is syncing.** While the transport existed and the engine did
not, the web account screen said so in plain words rather than showing an idle
spinner. A screen that looks like it is working is worse than one that admits it
is not.

---

## 8. Testing it

The server is real and reachable, so test against it rather than a mock. Make a
throwaway account, exercise the paths, then `DELETE /v1/account` — which is a
real deletion and takes the rows with it.

The three tests worth writing before the code:

- **Two batches where the first succeeds and the second fails.** Assert the
  third is not sent, and that retrying the second with the same `batchId`
  applies nothing twice.
- **A cursor below `minCursor`.** Assert the client full-resyncs and that local
  rows the server has never seen survive it.
- **Adoption with data on both sides.** Assert nothing is written before the
  user answers, and that answering Cancel leaves the device exactly as it was.

The server's own `concurrency_test.go` covers the revision race that doc 02 §2
describes; the client does not need to reproduce it, only to never assume
revisions arrive without gaps.
