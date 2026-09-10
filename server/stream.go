package main

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"sync"
	"time"
)

/*
Telling a connected client that there is something to fetch.

Server-Sent Events, chosen in doc 07. The push is one-directional — writes go
over the REST API and keep their batching, `batchId` idempotency and conflict
responses — so the bidirectional half of a WebSocket would buy nothing and cost
a reconnection state machine that `EventSource` already has.

# The stream is an optimisation, never a source of truth

It carries a revision number and nothing else. A client that receives one
compares it against its cursor and, if behind, pulls through
`GET /v1/sync/changes` exactly as it does today. A client that misses an event
is not wrong, only late: the next event, the next reconnect, or the next
ordinary sync trigger catches it up.

That is what makes this safe to build. Everything here can fail — the
connection, the fan-out, the whole feature — and the result is data that is
stale rather than data that is wrong.

Three reasons the payload is an invalidation rather than the record:

  - **It cannot leak one account's data into another's connection.** A stream
    carrying bodies is a second place that has to get account scoping right, on
    a long-lived connection that outlives the token check that opened it. A
    revision number has nothing worth leaking. The data still travels through
    the pull endpoint, whose scoping is tested.
  - **One apply path.** The stream and the catch-up produce changes through the
    same client code, so they cannot drift.
  - **Constant size.** A 200 KB deck import pushes forty bytes to every other
    device, which fetch it only if they want it.
*/

/*
How often to write a comment line into an idle stream.

Twenty seconds, chosen against nginx's `proxy_read_timeout`: the deployed value
is 60s and doc 05 raises it to an hour for this route, but a self-hoster on the
default 60s must still work. It is also what tells a client the connection is
alive — `EventSource` cannot distinguish an idle stream from a dead one, and a
phone that has been asleep needs to find out quickly rather than sit silent.
*/
const streamHeartbeat = 20 * time.Second

/*
How many revisions a listener may fall behind before it is dropped.

Small on purpose. The events are invalidations, so a listener that is behind
needs exactly one of them — the latest — to do the right thing. If a reader is
so slow that even a buffer of eight backs up, closing its connection is the
correct answer: `EventSource` reconnects, and reconnecting performs a catch-up,
which is what a slow listener needed anyway.
*/
const streamBacklog = 8

// A writer that cannot flush cannot stream. Distinguished from a client error
// because it means the server is wired up wrongly, not that the caller is.
var errNoFlush = errors.New("the response writer does not support flushing")

type subscriber struct {
	account string
	events  chan int64
}

/*
Per-account fan-out.

A plain map behind a mutex. The operations are subscribe, unsubscribe and
notify; all three are short, none of them does I/O while holding the lock, and
the contention is one lock per account write. At the scale doc 07 estimates —
200 connections on a 2 vCPU box — anything cleverer would be harder to read for
no measurable gain.
*/
type broadcaster struct {
	mu        sync.RWMutex
	byAccount map[string]map[*subscriber]struct{}
}

func newBroadcaster() *broadcaster {
	return &broadcaster{byAccount: map[string]map[*subscriber]struct{}{}}
}

func (b *broadcaster) subscribe(account string) *subscriber {
	sub := &subscriber{account: account, events: make(chan int64, streamBacklog)}
	b.mu.Lock()
	defer b.mu.Unlock()
	listeners, seen := b.byAccount[account]
	if !seen {
		listeners = map[*subscriber]struct{}{}
		b.byAccount[account] = listeners
	}
	listeners[sub] = struct{}{}
	return sub
}

func (b *broadcaster) unsubscribe(sub *subscriber) {
	b.mu.Lock()
	defer b.mu.Unlock()
	listeners, seen := b.byAccount[sub.account]
	if !seen {
		return
	}
	delete(listeners, sub)
	// The last listener takes the account's entry with it, so the map does not
	// grow by one key per account that has ever connected.
	if len(listeners) == 0 {
		delete(b.byAccount, sub.account)
	}
	close(sub.events)
}

/*
notify tells one account's listeners that its revision has moved.

**Never blocks.** A send to a full buffer is dropped rather than waited on, and
that is safe precisely because the payload is an invalidation: a listener that
missed revision 41 and receives 42 does the same thing it would have done for
41, only once. Blocking here would make every push wait on the slowest reader,
which is how a live feature takes the write path down with it.

Called **after** the write transaction commits. Notifying inside it would tell a
listener about a revision it could then fail to read.
*/
func (b *broadcaster) notify(account string, revision int64) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for sub := range b.byAccount[account] {
		select {
		case sub.events <- revision:
		default:
			// Behind by more than the backlog. Its reconnect will catch it up.
		}
	}
}

/** How many connections are open, for the health endpoint. */
func (b *broadcaster) connections() int {
	b.mu.RLock()
	defer b.mu.RUnlock()
	total := 0
	for _, listeners := range b.byAccount {
		total += len(listeners)
	}
	return total
}

// --- the handler ---------------------------------------------------------------

/*
The stream itself.

Authenticated by the same bearer token as every other route, through the same
middleware — so an unconfirmed address is refused here as it is everywhere, and
there is no second authorisation path to keep in step.
*/
func (s *Server) handleStream(w http.ResponseWriter, r *http.Request, sess session) {
	flusher, canFlush := w.(http.Flusher)
	if !canFlush {
		// Cannot stream to a writer that will not flush. Better a clear refusal
		// than a connection that silently never delivers anything.
		s.fail(w, r, "stream", errNoFlush)
		return
	}

	/*
		The server-wide WriteTimeout applies to a whole response, so it would
		cut every stream at thirty seconds — for ever, with no error anybody
		could interpret. Cleared for this route only, leaving the slow-loris
		defence in place everywhere else.

		Go 1.20 and later; if the controller cannot do it, the stream still
		works and simply ends at the timeout, which degrades to reconnecting
		rather than breaking.
	*/
	if err := http.NewResponseController(w).SetWriteDeadline(time.Time{}); err != nil {
		s.log.Warn("stream write deadline", "error", err)
	}

	w.Header().Set("Content-Type", "text/event-stream; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Connection", "keep-alive")
	/*
		For a reverse proxy that buffers.

		nginx here has `proxy_buffering off` on /api/, but a self-hoster's may
		not, and a buffered stream delivers nothing until it fills — which looks
		exactly like a broken feature. nginx honours this header; others ignore
		it harmlessly.
	*/
	w.Header().Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	/*
		A greeting, before anything else.

		`EventSource` fires `onopen` on the headers alone, so without a first
		byte a client cannot tell an open stream from a proxy holding one. This
		is also the retry hint: a client that loses the connection waits this
		long before its automatic reconnect, and the client-side backoff builds
		on top of it.
	*/
	fmt.Fprintf(w, "retry: %d\n: connected\n\n", 3000)
	flusher.Flush()

	sub := s.streams.subscribe(sess.account.ID)
	defer s.streams.unsubscribe(sub)

	/*
		Catch up a client that was away.

		It reconnects carrying where it got to, in `Last-Event-ID` — set by the
		browser automatically — or `?since=`, which is what a client that has
		never connected uses. If the account has moved on since then, say so
		immediately rather than leaving it idle until the next unrelated write.
	*/
	if since, known := clientCursor(r); known {
		current, err := s.store.AccountCursor(r.Context(), sess.account.ID)
		if err != nil {
			s.log.Error("stream cursor", "error", err, "account", sess.account.ID)
		} else if current > since {
			writeRevision(w, flusher, current)
		}
	}

	beat := time.NewTicker(streamHeartbeat)
	defer beat.Stop()

	for {
		select {
		case <-r.Context().Done():
			// The client went away: closed the tab, lost the network, or was
			// backgrounded by iOS. Nothing to clean up but the subscription.
			return

		case revision, open := <-sub.events:
			if !open {
				return
			}
			if !writeRevision(w, flusher, revision) {
				return
			}

		case <-beat.C:
			// A comment. Ignored by every client, and the only thing that keeps
			// an idle connection under a proxy's read timeout.
			if _, err := fmt.Fprint(w, ": ping\n\n"); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

/*
One event.

`id:` carries the revision so the browser puts it in `Last-Event-ID` on the next
automatic reconnect, which is where the catch-up above reads it from. That is a
correctness net for the price of one header.
*/
func writeRevision(w http.ResponseWriter, flusher http.Flusher, revision int64) bool {
	if _, err := fmt.Fprintf(w, "id: %d\nevent: changed\ndata: {\"revision\":%d}\n\n", revision, revision); err != nil {
		return false
	}
	flusher.Flush()
	return true
}

/*
Where the client says it has got to.

`Last-Event-ID` first, because the browser sets it on an automatic reconnect
without the page being involved at all. `?since=` is for a first connection, or
a client that is not a browser.
*/
func clientCursor(r *http.Request) (int64, bool) {
	if header := r.Header.Get("Last-Event-ID"); header != "" {
		if value, err := strconv.ParseInt(header, 10, 64); err == nil && value >= 0 {
			return value, true
		}
	}
	if query := r.URL.Query().Get("since"); query != "" {
		if value, err := strconv.ParseInt(query, 10, 64); err == nil && value >= 0 {
			return value, true
		}
	}
	return 0, false
}
