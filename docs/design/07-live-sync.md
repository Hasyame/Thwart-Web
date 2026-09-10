# 07 — Live sync

**Numbered 07, not 06.** `06-android-sync-brief.md` already exists. Same
document you asked for, one number along.

**Status: built, on both clients.** Proposed here, then implemented as
described — the server broadcaster and `GET /v1/sync/stream`, the web
subscriber with leader election, and as of Thwart 1.47.0 the Android one. The
design below is left as it was written rather than rewritten in the past tense,
because the reasoning is the useful part; §8's question was answered by keeping
what shipped, with the one addition it asked for.

What changed on the way, none of it structural:

- **Android does not use the query-string token.** §2's exception exists because
  `EventSource` cannot set a header. A native client can, so the phone sends
  `Authorization` and the nginx log concern in api.go does not apply to it.
- **Android reconnects on its own**, since it has no `EventSource` to do it. Same
  rule as §3 — catch up first, then listen — with exponential backoff and jitter
  in `SyncStream.kt`.
- **Android listens only in the foreground** and closes the connection on
  leaving. §7's leader election is a browser problem; a phone has one app.
- **§8's extra line is in**: both clients now say when a merge would keep a deck
  twice.

---

## Context, and a correction to the brief

> "Today the clients push data to the server but never learn about changes made
> elsewhere."

Half right, and the half that is wrong changes the size of this work.

**What already exists and is shipped:**

| Piece | Where |
|---|---|
| Per-account monotonic revision counter, allocated inside the write transaction | `server/store.go`, doc 02 §2 |
| `GET /v1/sync/changes?since=N`, paged, with a tombstone horizon | `server/sync.go` |
| Tombstones as records with `deleted: true` and no body | doc 02 §5 |
| Per-collection conflict rules, refined client-side | doc 02 §4, `web/src/lib/sync/merge.ts` |
| First-sign-in merge with a confirmation step | doc 02 §6, `web/src/lib/sync/adoption.ts` |
| Automatic sync on six named triggers | `web/src/lib/sync/auto.svelte.ts` |

So a client **does** learn about changes made elsewhere — it just only asks when
something prompts it. What is missing is exactly one thing: **the server telling
a connected client that there is something to fetch.** Steps 2.1 and much of 2.4
of your brief are already built.

That is worth saying plainly because it changes what to review. This document is
about a push channel and the handful of things it disturbs, not about designing
sync from scratch.

---

## 1. Local-first: I agree, and here is the sharper reason

You pre-empted yourself correctly, so this is short.

Local-first is right, and not only for the bad-wifi-at-the-table case. The
stronger reason is that **the app has to work for people with no account at
all.** That is the default state, it is most of the users, and it is the state
every user is in before they sign up. If a logged-in user's data lived on the
server, there would be two apps in one codebase — an offline one and an online
one — with two sets of bugs and two behaviours to explain. Local-first means one
app, and being signed in only adds a synchroniser.

There is a second-order argument: a server-authoritative read path would make
every screen an async, failable operation. The statistics page would need a
loading state per panel *and* an error state per panel *and* a stale-data state.
It has just spent two days getting the local version right; doubling that
surface for a feature nobody asked for would be a poor trade.

**Server as authority means: the server settles disagreements, and is what a new
device syncs from.** It does not mean the server is on the read path.

---

## 2. Transport

Judged on the criteria you named. The push is one-directional — writes already
go through the REST API and will keep doing so — which is the fact that decides
it.

| | SSE | WebSocket | Long polling |
|---|---|---|---|
| nginx | Plain HTTP/1.1 proxy. Needs `proxy_buffering off` — **already set** on `/api/` — and a raised read timeout. | Needs `Upgrade`/`Connection` headers proxied explicitly. One more thing a self-hoster gets wrong. | Nothing special. |
| Corporate proxies | Ordinary `text/event-stream` response. A buffering proxy delays it but does not break it. | Upgrade is what transparent proxies and older middleboxes block. | Passes everywhere. |
| iOS Safari, backgrounded | Connection dropped on background; `EventSource` reconnects itself with `Last-Event-ID`. Home Screen mode behaves the same. | Dropped, and reconnection is mine to write, including backoff. | Request completes or is dropped; the next poll is a fresh request. |
| Reconnection | **Built in.** Automatic, with `Last-Event-ID` replay. | Hand-rolled. | Trivial, it is just the next request. |
| Idle cost on a small VPS | One goroutine and one socket. | One goroutine, one socket, plus a frame/ping state machine. | A request every N seconds per user: the worst of the three for a server that is otherwise idle. |
| Self-hoster difficulty | One nginx directive they probably already have. | Two directives and a protocol upgrade. | None. |
| Fit | One-directional push. Exactly what SSE is. | Bidirectional, which this is not. | Fine, and wasteful. |

**Decision: Server-Sent Events.** Your expectation was right, and the reason to
be confident is that the alternative's one advantage — a bidirectional channel —
buys nothing here. Writes go over REST because they need the existing batching,
`batchId` idempotency and conflict responses, none of which is worth
reimplementing over a socket.

There is one real SSE limitation worth stating: **six connections per origin on
HTTP/1.1**. thwart.app is HTTP/2 behind nginx, where the limit does not apply,
but a self-hoster on plain HTTP/1.1 could exhaust it with several tabs. §7's
leader-tab design reduces that to one connection per browser regardless, which
turns the limitation into a non-issue rather than a caveat.

### Two blockers in the running configuration

Found by reading the deployed config rather than assuming it:

**`WriteTimeout: 30 * time.Second`** in `server/main.go` applies to the whole
response, so it would kill every stream after thirty seconds, for ever, with no
error anybody would understand. It cannot simply be raised — it is what stops a
slow-loris client holding a connection open, and doc 05 wants it. The fix is
per-request: `http.NewResponseController(w).SetWriteDeadline(time.Time{})` on
the stream handler only, leaving every other route protected.

**`proxy_read_timeout 60s`** in the nginx `/api/` block closes an idle upstream
after a minute. A 20-second heartbeat comment (`: ping`) keeps the connection
under it *and* is what tells a client the link is alive; the timeout should
still be raised to 1h for the stream location so the heartbeat is a liveness
check rather than the only thing preventing a disconnect.

`proxy_buffering off` is already set. `X-Accel-Buffering: no` on the response
makes the stream survive a self-hoster who has buffering on globally.

---

## 3. Change feed and delta sync

**The stream is an optimisation on top of the catch-up endpoint, never the only
way to learn about a change.** This is the load-bearing rule and everything else
follows from it.

```
on connect / reconnect / foreground:
    GET /v1/sync/changes?since=<cursor>     # existing endpoint, unchanged
    apply, advance cursor
    then open the stream from that cursor
```

A client that was offline for a week catches up in one paged round trip, exactly
as it does today. A client that was offline for longer than the tombstone
horizon is told to full-resync, exactly as it is today. The stream never has to
replay history, which is what keeps it cheap and what makes it safe to drop.

### The payload: an invalidation, not the record

The stream carries the revision number and nothing else:

```
event: changed
data: {"revision":1841}
```

The client compares against its cursor and, if behind, calls the existing
`/sync/changes` endpoint. Three reasons, in order of weight:

1. **It cannot leak one account's data to another.** A stream carrying record
   bodies is a *second* place that has to get account scoping right, on a code
   path with no request context and a long-lived connection that outlives the
   token check that opened it. An invalidation carries nothing worth leaking:
   the worst case is telling somebody a number went up. The data still comes
   through the REST endpoint, whose scoping is already tested.
2. **One apply path.** The stream and the catch-up produce changes through the
   same code, so they cannot drift. Two paths that apply records is exactly how
   "it synced but the campaign was wrong" bugs happen.
3. **Constant, tiny payload.** Roughly forty bytes per change regardless of what
   changed. A 200 KB deck import pushes forty bytes down every other connected
   device, which then fetch it if they want it.

The cost is one extra round trip per change. At this app's write rate — a game
recorded every hour or two at the very most — that is nothing. **If this were a
chat app the answer would be the opposite**, and it is worth writing that down
so nobody re-derives it later from the wrong premise.

`id:` on each event carries the revision, so `Last-Event-ID` on an automatic
reconnect tells the server where the client got to — a free correctness net that
costs one header.

---

## 4. Conflict resolution

Doc 02 §4 already defines this per collection and it does not change. Live sync
alters *when* conflicts are noticed, not how they are settled. Two notes.

**Your campaign-run concern is real in general and already solved here.** You
wrote that "a campaign run whose state carries forward between scenarios can be
corrupted by a naive LWW merge", and you are right — which is why campaigns are
event-sourced. The run record is thin (name, difficulty, template, finished) and
last-write-wins on it is harmless. The state that carries forward lives in
`campaign_events`, which is **append-only with union merge**: two devices
playing the same campaign offline produce two sets of events, both are kept, and
the engine folds them in timestamp order. Undo is an appended `revoke`, not a
deletion. There is no merge to get wrong.

That was the single best decision in doc 02 and it is why this section is short.

**Deletes are tombstones.** Already true at the protocol level, and since
yesterday also true in the web client's local database (`Play.deletedAt`), which
is what stops a delete being resurrected by a device that never heard about it.

---

## 5. What live sync actually changes

Not much, which is the point:

- A new endpoint, `GET /v1/sync/stream`, authenticated by the existing bearer
  token.
- A broadcaster in the server: per-account fan-out, notified after a successful
  push transaction commits — **after**, never inside, or a listener can be told
  about a revision that has not landed yet.
- A client subscriber that catches up first and then listens.
- A connection indicator (§9).

---

## 6. Load, on this machine

Measured facts: the VPS is **2 vCPU and 3826 MB**, and `thwart-api` is capped at
`MemoryHigh=384M` / `MemoryMax=512M`.

Per idle SSE connection:

| | |
|---|---|
| Go goroutine stack | 8 KB initial, grows only on deep calls; a stream handler is shallow |
| `http.Server` read + write buffers | 4 KB + 4 KB, default |
| Per-connection bookkeeping (channel, account key) | well under 1 KB |
| **Server total** | **~20 KB, call it 32 KB with slack** |
| nginx, per proxied connection | ~16 KB with buffering off |

**200 concurrent users: roughly 6.5 MB in the Go process and ~3 MB in nginx.**
Against a 384 MB soft cap that is noise. CPU at idle is a 20-second heartbeat per
connection — 10 writes a second across 200 users, which is nothing.

The real constraint is not memory but **file descriptors**: 200 connections is
200 sockets in nginx plus 200 upstream, and the default `ulimit -n` of 1024 is
close enough to matter at a few hundred users. `LimitNOFILE=8192` on the unit
and `worker_connections` raised in nginx.

The honest scaling limit is that this is one Go process with SQLite. At a few
thousand concurrent connections the fan-out lock and the goroutine count would
need thought. Thwart has one user today and F-Droid ambitions; if it ever has
two thousand concurrent players, the sync design is not the thing that will need
rewriting first.

---

## 7. Multi-tab

**One leader tab holds the stream; the rest listen over `BroadcastChannel`.**

Elected with the Web Locks API — `navigator.locks.request('thwart-sync-leader',
{mode: 'exclusive'}, ...)` held for the tab's lifetime. Whichever tab holds the
lock owns the connection; when it closes, the lock releases and another tab
takes it, with no heartbeat protocol and no stale-leader problem. Supported in
every browser this app targets, Safari included since 15.4.

Without Web Locks: fall back to one connection per tab. Correct, just wasteful,
and the fallback path is three lines rather than a second election protocol.

The leader broadcasts `{revision}` and *every* tab does its own catch-up through
Dexie, which is already reactive across tabs via `liveQuery`. So in practice the
follower tabs need no code at all: the leader applies the change to IndexedDB,
and the other tabs re-render because their queries observed the write. The
`BroadcastChannel` is only needed to tell followers a leader exists so they do
not open their own connection.

---

## 8. First login merge — your decision, and it is already shipped

You asked to be presented with options rather than have this decided alone.
Fairly, but it was decided in doc 02 §6 and **it is implemented and working
today** — I exercised it during the account work last week. So this is a
"confirm or change", not a blank page.

**What ships today:** full pull into a staging area, classify every id in both
directions, then **show counts and ask**, with three answers — Merge / Keep only
what is on the server (local data exported to a backup file first) / Cancel.
Nothing is written until the answer.

The options, for completeness:

| Option | For | Against |
|---|---|---|
| **Merge, after asking** *(current)* | Nothing is lost; the destructive answer is recoverable; the user understands what happened | One dialog on first sign-in |
| Merge silently | No dialog | The first time it surprises somebody it eats a campaign log and they never trust sync again |
| Server wins | Simple; matches "server is authority" | Destroys six months of anonymous play. Unacceptable |
| Keep both, always | Never loses | Duplicates every deck and pack; the user tidies up by hand |

**My recommendation: keep what ships.** The union rules deliberately favour
keeping data over discarding it, which is the right bias when there is no
history to adjudicate with — a wrongly kept favourite is one click to remove, a
wrongly dropped campaign is gone.

**The one thing I would change:** the current dialog reports counts
(`128 plays, 6 decks, 3 campaigns`). It does not say what happens to a *conflict*
— the same deck edited in both places. That is the fork rule from doc 02 §4 and
it produces a second deck with a suffixed name. Somebody who is not expecting
that will think sync duplicated their deck. One extra line when `forks > 0`,
which the plan already counts.

**Tell me if you want anything else changed here and I will fold it into step 2.**

---

## 9. The connection indicator

Offline is a normal state. The rules:

- **Never a red banner.** Somebody on a train is not experiencing an error.
- Connected: nothing at all, or the faintest possible mark. The absence of a
  problem is not news.
- Offline with queued writes: a quiet line where the sync state already lives —
  "3 changes waiting" — and nothing that blocks or covers anything.
- Reconnecting: no distinct state. It is indistinguishable from offline to the
  user and adds a flicker.
- The only thing worth interrupting for is a **conflict that produced a fork**,
  because that is the one case where the user has something to do.

---

## 10. What I would build, in order

Matching your step 2, adjusted for what already exists:

1. **Server**: broadcaster, `GET /v1/sync/stream`, `SetWriteDeadline` exemption,
   `LimitNOFILE`. Revision counter, change feed and tombstones are done.
2. **Test that a user never receives another user's events.** Two accounts, two
   streams, a write on one, assert silence on the other. Written before the
   handler.
3. **nginx**: a `location /api/v1/sync/stream` with the read timeout raised;
   `X-Accel-Buffering: no` from the handler. Documented in doc 05 for
   self-hosters.
4. **Web**: leader election, subscribe-after-catch-up, exponential backoff with
   jitter, always catch up by revision before trusting the stream.
5. **Web**: the outbound queue. Partly exists — `auto.svelte.ts` already
   coalesces, retries once and waits for `online` — but it does not survive a
   reload. That is the gap.
6. **UI**: §9.

---

## Consequences

- One more long-lived connection per signed-in browser, which is cheap here and
  is the thing to watch if the user base ever changes shape.
- Two configuration items a self-hoster must get right, both documented, both
  with a sane failure mode: get them wrong and the stream disconnects every
  minute, which degrades to the polling behaviour that exists today rather than
  breaking anything.
- The write path is untouched. Anything that breaks in this work breaks
  *freshness*, not correctness, and the catch-up endpoint remains the guarantee.
