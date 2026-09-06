package main

import (
	"context"
	"net/http"
	"sync"
	"testing"
	"time"
)

/*
The defences, tested as defences.

Each of these fails if a protection is quietly removed, which is the only kind
of test worth writing about security: a test that asserts a feature works tells
you nothing about whether it can be got around.
*/

func TestHashGateBoundsConcurrency(t *testing.T) {
	/*
		The one that matters most.

		Every rate limit here caps attempts per window and none of them caps how
		many run at once. Thirty simultaneous logins were inside every rule and
		still meant thirty times 64 MiB of Argon2, which is four times the
		memory the service is allowed. This proves nothing gets past the gate.
	*/
	gate := newHashGate(2)
	ctx := context.Background()

	if err := gate.enter(ctx); err != nil {
		t.Fatalf("first slot: %v", err)
	}
	if err := gate.enter(ctx); err != nil {
		t.Fatalf("second slot: %v", err)
	}

	// The third has to wait. Cancelled rather than waited out, so the test does
	// not sit here for hashWait.
	quick, cancel := context.WithCancel(ctx)
	cancel()
	if err := gate.enter(quick); err == nil {
		t.Fatal("a third hash ran while both slots were held")
	}

	gate.leave()
	if err := gate.enter(ctx); err != nil {
		t.Fatalf("a freed slot was not reusable: %v", err)
	}
}

func TestHashGateGivesUpRatherThanQueueing(t *testing.T) {
	// A queue that never drains is the outage the gate exists to prevent, so
	// waiting has to end in a refusal.
	gate := &hashGate{slots: make(chan struct{}, 1)}
	if err := gate.enter(context.Background()); err != nil {
		t.Fatalf("first slot: %v", err)
	}

	deadline, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	start := time.Now()
	if err := gate.enter(deadline); err == nil {
		t.Fatal("the caller was let in while the only slot was held")
	}
	if time.Since(start) > hashWait {
		t.Error("the caller waited longer than hashWait")
	}
}

func TestConcurrentLoginsDoNotAllRunAtOnce(t *testing.T) {
	// The end-to-end version: many logins fired together against a real server
	// must never have more than hashSlots hashes in flight.
	s := newTestServer(t)
	register(t, s, "benoit", "correct horse battery")

	var mu sync.Mutex
	inFlight, peak := 0, 0
	original, isReal := s.hashes.(*hashGate)
	if !isReal {
		t.Fatalf("the server is not holding a real gate: %T", s.hashes)
	}
	s.hashes = &countingGate{inner: original, onEnter: func(delta int) {
		mu.Lock()
		defer mu.Unlock()
		inFlight += delta
		if inFlight > peak {
			peak = inFlight
		}
	}}

	var wg sync.WaitGroup
	for i := 0; i < 12; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			call(t, s, "POST", "/v1/auth/login", "", map[string]any{
				"handle": "benoit", "password": "wrong password entirely", "deviceName": "d",
			})
		}()
	}
	wg.Wait()

	mu.Lock()
	defer mu.Unlock()
	if peak > hashSlots {
		t.Errorf("%d hashes ran at once, the gate allows %d", peak, hashSlots)
	}
	if peak == 0 {
		t.Error("no hash went through the gate at all, so this proves nothing")
	}
}

// A gate that reports what it lets through, wrapping the real one so the
// bounding behaviour under test is the real behaviour.
type countingGate struct {
	inner   *hashGate
	onEnter func(delta int)
}

func (g *countingGate) enter(ctx context.Context) error {
	if err := g.inner.enter(ctx); err != nil {
		return err
	}
	g.onEnter(1)
	return nil
}

func (g *countingGate) leave() {
	g.onEnter(-1)
	g.inner.leave()
}

func TestLoginIsBoundedOverADayNotJustAWindow(t *testing.T) {
	/*
		A short window caps a burst, not a brute force: ten attempts every
		fifteen minutes is nine hundred and sixty a day, forever. The daily tier
		is what stops somebody who is willing to wait.
	*/
	s := newTestServer(t)
	register(t, s, "benoit", "correct horse battery")

	// Wind the clock forward between bursts, so each short window is fresh and
	// only the daily tier is left holding the line.
	at := time.Now()
	s.limiter.now = func() time.Time { return at }

	refused := false
	for burst := 0; burst < 12 && !refused; burst++ {
		for i := 0; i < loginPerHandle.limit; i++ {
			res := call(t, s, "POST", "/v1/auth/login", "", map[string]any{
				"handle": "benoit", "password": "not the password", "deviceName": "d",
			})
			if res.status == http.StatusTooManyRequests {
				refused = true
				break
			}
		}
		at = at.Add(loginPerHandle.window + time.Minute)
	}

	if !refused {
		t.Fatalf("more than %d attempts got through by waiting out each window",
			loginPerHandleDay.limit)
	}
}

func TestASuccessfulLoginClearsBothTiers(t *testing.T) {
	// Somebody who fumbles their password all morning and then gets it right
	// must not still be carrying the morning around.
	s := newTestServer(t)
	register(t, s, "benoit", "correct horse battery")

	for i := 0; i < loginPerHandle.limit-1; i++ {
		call(t, s, "POST", "/v1/auth/login", "", map[string]any{
			"handle": "benoit", "password": "wrong", "deviceName": "d",
		})
	}
	res := call(t, s, "POST", "/v1/auth/login", "", map[string]any{
		"handle": "benoit", "password": "correct horse battery", "deviceName": "d",
	})
	if res.status != http.StatusOK {
		t.Fatalf("the right password was refused: status %d %s", res.status, res.code())
	}

	// And the budget is back.
	for i := 0; i < loginPerHandle.limit-1; i++ {
		again := call(t, s, "POST", "/v1/auth/login", "", map[string]any{
			"handle": "benoit", "password": "wrong", "deviceName": "d",
		})
		if again.status == http.StatusTooManyRequests {
			t.Fatalf("the counter was not cleared by the successful sign-in (attempt %d)", i+1)
		}
	}
}

func TestChangingAPasswordIsMetered(t *testing.T) {
	/*
		A device token used to be an unmetered supply of Argon2: whoever held
		one could verify the current password here as fast as the machine
		allowed. That is both a way to grind the password and a way to exhaust
		the memory of a box that permits four hashes at a time.
	*/
	s := newTestServer(t)
	created := register(t, s, "benoit", "correct horse battery")
	token := created.str("token")

	refused := false
	for i := 0; i < passwordPerAccount.limit+3; i++ {
		res := call(t, s, "POST", "/v1/auth/password", token, map[string]any{
			"currentPassword": "not the password", "newPassword": "another long password",
		})
		if res.status == http.StatusTooManyRequests {
			refused = true
			break
		}
	}
	if !refused {
		t.Fatalf("more than %d password checks got through on one token", passwordPerAccount.limit)
	}

	// Deleting an account shares the budget, because it verifies the same
	// secret and an attacker would otherwise simply alternate between the two.
	res := call(t, s, "DELETE", "/v1/account", token, map[string]any{"password": "correct horse battery"})
	if res.status != http.StatusTooManyRequests {
		t.Errorf("account deletion has its own budget: status %d", res.status)
	}
}

func TestForwardedHeadersAreOnlyTrustedFromAProxy(t *testing.T) {
	/*
		The header is the rate limiter's whole notion of who is calling, so a
		caller who can choose it has no limit at all. It is read only when the
		immediate peer is loopback or private, which is where a reverse proxy
		is, and the last entry is taken rather than the first because the first
		is whatever the caller typed.
	*/
	cases := []struct {
		name       string
		remoteAddr string
		realIP     string
		forwarded  string
		want       string
	}{
		{"a direct caller cannot claim to be somebody else",
			"198.51.100.9:44321", "203.0.113.1", "203.0.113.2", "198.51.100.9"},
		{"behind the proxy, X-Real-IP is authoritative",
			"127.0.0.1:44321", "203.0.113.1", "", "203.0.113.1"},
		{"the last forwarded entry is the proxy's, not the caller's",
			"127.0.0.1:44321", "", "198.51.100.1, 203.0.113.7", "203.0.113.7"},
		{"rubbish in the header falls back to the peer",
			"127.0.0.1:44321", "not-an-ip", "also not an ip", "127.0.0.1"},
		{"no header at all is the peer",
			"127.0.0.1:44321", "", "", "127.0.0.1"},
	}

	for _, tc := range cases {
		req, err := http.NewRequest("GET", "/", nil)
		if err != nil {
			t.Fatalf("request: %v", err)
		}
		req.RemoteAddr = tc.remoteAddr
		if tc.realIP != "" {
			req.Header.Set("X-Real-IP", tc.realIP)
		}
		if tc.forwarded != "" {
			req.Header.Set("X-Forwarded-For", tc.forwarded)
		}
		if got := clientIP(req); got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
}
