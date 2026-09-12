package main

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

/*
The live channel, and the one property it must never get wrong.

A stream is a long-lived connection that outlives the request that opened it,
fanned out from a map keyed by account. That is exactly the shape where one
account's events reach another's connection, and it is the reason the isolation
test is the first thing in this file rather than an afterthought at the bottom:
it was written before the handler.

Everything else here is about a stream being an optimisation rather than a
source of truth. It carries a revision number and nothing else; a client that
misses one is not wrong, only late, and catches up through /sync/changes.
*/

// A stream reader that a test can wait on.
type listener struct {
	t        *testing.T
	events   chan int64
	comments chan string
	cancel   context.CancelFunc
	done     chan struct{}
	body     *strings.Builder
	mu       sync.Mutex
}

/*
Opens a stream and reads it in the background.

`httptest.NewRecorder` cannot be used: it buffers the whole response and only
hands it over when the handler returns, which never happens for a stream. So
this runs a real server on a real socket, which is also closer to what nginx
will be proxying.
*/
func listen(t *testing.T, srv *httptest.Server, token string, since int64) *listener {
	t.Helper()

	ctx, cancel := context.WithCancel(context.Background())
	l := &listener{
		t:        t,
		events:   make(chan int64, 64),
		comments: make(chan string, 64),
		cancel:   cancel,
		done:     make(chan struct{}),
		body:     &strings.Builder{},
	}

	url := srv.URL + "/v1/sync/stream"
	if since > 0 {
		url += "?since=" + itoa(since)
	}
	req, err := http.NewRequestWithContext(ctx, "GET", url, nil)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)

	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	if res.StatusCode != http.StatusOK {
		t.Fatalf("stream status %d", res.StatusCode)
	}
	if ct := res.Header.Get("Content-Type"); !strings.HasPrefix(ct, "text/event-stream") {
		t.Fatalf("content type %q, want text/event-stream", ct)
	}
	// The header that keeps a stream alive through a proxy somebody left
	// buffering on. nginx here has proxy_buffering off, but a self-hoster's
	// may not.
	if res.Header.Get("X-Accel-Buffering") != "no" {
		t.Error("X-Accel-Buffering: no is missing; a buffering proxy would hold every event")
	}

	go func() {
		defer close(l.done)
		defer func() { _ = res.Body.Close() }()
		scanner := bufio.NewScanner(res.Body)
		for scanner.Scan() {
			line := scanner.Text()
			l.mu.Lock()
			l.body.WriteString(line + "\n")
			l.mu.Unlock()

			switch {
			case strings.HasPrefix(line, ":"):
				select {
				case l.comments <- line:
				default:
				}
			case strings.HasPrefix(line, "data:"):
				var payload struct {
					Revision int64 `json:"revision"`
				}
				if err := json.Unmarshal([]byte(strings.TrimSpace(line[len("data:"):])), &payload); err == nil {
					select {
					case l.events <- payload.Revision:
					default:
					}
				}
			}
		}
	}()

	return l
}

func (l *listener) close() {
	l.cancel()
	select {
	case <-l.done:
	case <-time.After(2 * time.Second):
	}
}

/** Waits for one revision, or fails. */
func (l *listener) expect(within time.Duration) int64 {
	l.t.Helper()
	select {
	case rev := <-l.events:
		return rev
	case <-time.After(within):
		l.mu.Lock()
		defer l.mu.Unlock()
		l.t.Fatalf("no event within %s; stream so far:\n%s", within, l.body.String())
		return 0
	}
}

/** Waits for the greeting, which is the server saying the subscription is in place. */
func (l *listener) greeted(within time.Duration) {
	l.t.Helper()
	select {
	case <-l.comments:
	case <-time.After(within):
		l.t.Fatal("no greeting")
	}
}

/** Asserts nothing arrives. The whole point of the isolation test. */
func (l *listener) expectSilence(for_ time.Duration) {
	l.t.Helper()
	select {
	case rev := <-l.events:
		l.mu.Lock()
		defer l.mu.Unlock()
		l.t.Fatalf("received revision %d that belongs to another account; stream:\n%s", rev, l.body.String())
	case <-time.After(for_):
	}
}

func itoa(n int64) string {
	digits := ""
	if n == 0 {
		return "0"
	}
	for n > 0 {
		digits = string(rune('0'+n%10)) + digits
		n /= 10
	}
	return digits
}

/** A running server with two accounts on it. */
func streamServer(t *testing.T) (*httptest.Server, string, string) {
	t.Helper()
	s := newTestServer(t)
	srv := httptest.NewServer(s.Handler())
	t.Cleanup(srv.Close)

	one := register(t, s, "benoit", "correct horse battery")
	two := register(t, s, "somebody", "another long password")
	return srv, one.str("token"), two.str("token")
}

/** Pushes one record and returns the account's new cursor. */
func pushOverHTTP(t *testing.T, srv *httptest.Server, token, id string) {
	t.Helper()
	body := map[string]any{
		"batchId": "batch-" + id,
		"records": []map[string]any{
			{
				"collection": "plays",
				"id":         id,
				"updatedAt":  time.Now().UTC().Format(time.RFC3339),
				"body":       map[string]any{"id": id, "won": true},
			},
		},
	}
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	req, err := http.NewRequest("POST", srv.URL+"/v1/sync/changes", strings.NewReader(string(encoded)))
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("push: %v", err)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("push status %d", res.StatusCode)
	}
}

// --- the one that had to be written first ------------------------------------

func TestAStreamNeverCarriesAnotherAccountsEvents(t *testing.T) {
	/*
		The unforgivable bug for this feature.

		Fan-out from a map keyed by account is exactly the shape where a
		mistyped key, a shared channel or a stale subscriber sends one person's
		history to another. Written before the handler existed.
	*/
	srv, mine, theirs := streamServer(t)

	me := listen(t, srv, mine, 0)
	defer me.close()
	them := listen(t, srv, theirs, 0)
	defer them.close()

	pushOverHTTP(t, srv, mine, "play-1")

	got := me.expect(3 * time.Second)
	if got <= 0 {
		t.Fatalf("my own write gave revision %d", got)
	}
	// The assertion this file exists for.
	them.expectSilence(500 * time.Millisecond)

	// And the other way round, so the test cannot pass by the fan-out being
	// broken in one direction only.
	pushOverHTTP(t, srv, theirs, "play-2")
	if rev := them.expect(3 * time.Second); rev <= 0 {
		t.Fatalf("their own write gave revision %d", rev)
	}
	me.expectSilence(500 * time.Millisecond)
}

func TestAStreamAcceptsATokenInTheQuery(t *testing.T) {
	/*
		`EventSource` cannot set a header, so this route reads the token from the
		query string. Confined to this route: see authenticatedStream.
	*/
	srv, mine, theirs := streamServer(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, "GET", srv.URL+"/v1/sync/stream?token="+mine, nil)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer func() { _ = res.Body.Close() }()
	if res.StatusCode != http.StatusOK {
		t.Fatalf("status %d with a query token, want 200", res.StatusCode)
	}
	_ = theirs
}

func TestOnlyTheStreamAcceptsAQueryToken(t *testing.T) {
	/*
		The exception must not have widened. Every other authenticated route
		still requires the header, or a token in a URL becomes the normal way to
		call this API and ends up in every log and every bookmark.
	*/
	srv, mine, _ := streamServer(t)

	for _, path := range []string{"/v1/auth/devices", "/v1/sync/changes?since=0", "/v1/account/export"} {
		joiner := "?"
		if strings.Contains(path, "?") {
			joiner = "&"
		}
		res, err := srv.Client().Get(srv.URL + path + joiner + "token=" + mine)
		if err != nil {
			t.Fatalf("get %s: %v", path, err)
		}
		_ = res.Body.Close()
		if res.StatusCode != http.StatusUnauthorized {
			t.Errorf("%s accepted a query token: status %d, want 401", path, res.StatusCode)
		}
	}
}

func TestAStreamNeedsAValidToken(t *testing.T) {
	srv, _, _ := streamServer(t)

	for _, token := range []string{"", "tw_live_nonsense"} {
		req, err := http.NewRequest("GET", srv.URL+"/v1/sync/stream", nil)
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		res, err := srv.Client().Do(req)
		if err != nil {
			t.Fatalf("do: %v", err)
		}
		_ = res.Body.Close()
		if res.StatusCode != http.StatusUnauthorized {
			t.Errorf("token %q: status %d, want 401", token, res.StatusCode)
		}
	}
}

func TestAStreamSaysHelloSoAClientKnowsItIsOpen(t *testing.T) {
	/*
		Without a first byte, a proxy that buffers and a server that has not
		written yet look identical from the client, and `EventSource` fires
		`onopen` on headers alone. The greeting is what makes "connected" mean
		something.
	*/
	srv, mine, _ := streamServer(t)
	me := listen(t, srv, mine, 0)
	defer me.close()

	select {
	case line := <-me.comments:
		if !strings.HasPrefix(line, ":") {
			t.Errorf("greeting %q is not a comment line", line)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no greeting; a client cannot tell an open stream from a buffering proxy")
	}
}

func TestAStreamCatchesUpAClientThatWasBehind(t *testing.T) {
	/*
		A client reconnects with `Last-Event-ID` — or `?since=` — carrying where
		it got to. It must be told there is something to fetch even though the
		write happened while it was away, or it sits idle believing it is
		current until the next unrelated change.
	*/
	srv, mine, _ := streamServer(t)

	// Two writes with nobody listening, so reconnecting at revision 1 is
	// genuinely behind rather than merely current.
	pushOverHTTP(t, srv, mine, "play-early")
	pushOverHTTP(t, srv, mine, "play-later")

	me := listen(t, srv, mine, 1)
	defer me.close()

	if rev := me.expect(3 * time.Second); rev < 2 {
		t.Fatalf("a client behind by one was not told to catch up; got %d", rev)
	}
}

func TestAStreamThatIsCurrentIsNotToldToCatchUp(t *testing.T) {
	// The mirror of the above: a client already at the head should hear
	// nothing until something actually changes, or every reconnect costs a
	// pointless round trip.
	srv, mine, _ := streamServer(t)
	pushOverHTTP(t, srv, mine, "play-1")

	// Read the account's cursor the way a client would, then connect at it.
	req, err := http.NewRequest("GET", srv.URL+"/v1/sync/changes?since=0", nil)
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+mine)
	res, err := srv.Client().Do(req)
	if err != nil {
		t.Fatalf("pull: %v", err)
	}
	var page struct {
		Cursor int64 `json:"cursor"`
	}
	if err := json.NewDecoder(res.Body).Decode(&page); err != nil {
		t.Fatalf("decode: %v", err)
	}
	_ = res.Body.Close()

	me := listen(t, srv, mine, page.Cursor)
	defer me.close()
	me.expectSilence(500 * time.Millisecond)
}

func TestManyListenersOnOneAccountAllHear(t *testing.T) {
	// Two tabs, or a phone and a laptop. One slow reader must not stop the
	// others being told.
	srv, mine, _ := streamServer(t)

	first := listen(t, srv, mine, 0)
	defer first.close()
	second := listen(t, srv, mine, 0)
	defer second.close()

	// Both greeted, and so both subscribed, before anything is pushed: the
	// server greets after it subscribes precisely so this holds.
	first.greeted(2 * time.Second)
	second.greeted(2 * time.Second)

	pushOverHTTP(t, srv, mine, "play-1")

	if first.expect(3*time.Second) <= 0 || second.expect(3*time.Second) <= 0 {
		t.Fatal("a listener missed a revision")
	}
}

func TestABroadcastToNobodyDoesNotBlockTheWrite(t *testing.T) {
	/*
		The failure that takes the server down rather than the feature: a
		fan-out that blocks on a channel nobody is reading turns every push into
		a hung request. Pushing with no listeners at all must be exactly as fast
		as it was before this existed.
	*/
	srv, mine, _ := streamServer(t)

	done := make(chan struct{})
	go func() {
		defer close(done)
		pushOverHTTP(t, srv, mine, "play-1")
	}()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("a push with no listeners did not return; the fan-out is blocking")
	}
}
