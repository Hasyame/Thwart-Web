package main

import (
	"bytes"
	"fmt"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

/*
Regression tests for the bug hunt of 2026-09-30 (docs/security/2026-09-30-bug-hunt.md).

Each started as a repro that asserted the bug and was turned around once the
bug was fixed.
*/

// Bug 1. A rating over the daily allowance is not wrong, only early: it must
// not be answered with the outcome clients read as "drop your copy".
func TestRateLimitedRatingIsDeferredNotRejected(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "benoit", "correct horse battery").str("token")

	const n = 201 // one more than ratingsPerAccountDay
	var records []map[string]any
	for i := 0; i < n; i++ {
		records = append(records, play(fmt.Sprintf("p%d", i), fmt.Sprintf("s%d", i), "", nil))
	}
	for i := 0; i < n; i++ {
		records = append(records, rating(fmt.Sprintf("scenario:s%d", i), 3, map[string]any{"playId": fmt.Sprintf("p%d", i)}))
	}
	res := ratingResults(t, push(t, s, token, "first-sync", records...))
	last := res[fmt.Sprintf("ratings/scenario:s%d", n-1)]
	if last["outcome"] != outcomeDeferred || last["reason"] != reasonRateLimited {
		t.Fatalf("rating #%d: want deferred/rate_limited, got %v", n, last)
	}
	if rev, _ := last["revision"].(float64); rev != 0 {
		t.Fatalf("a deferred rating spends no revision, got %v", rev)
	}
	if first := res["ratings/scenario:s0"]; first["outcome"] != outcomeApplied {
		t.Fatalf("rating #1 should apply, got %v", first)
	}

	// The same record is accepted once the window has passed.
	s.limiter.now = func() time.Time { return time.Now().Add(25 * time.Hour) }
	again := ratingResults(t, push(t, s, token, "next-day",
		rating(fmt.Sprintf("scenario:s%d", n-1), 3, map[string]any{"playId": fmt.Sprintf("p%d", n-1)})))
	if got := again[fmt.Sprintf("ratings/scenario:s%d", n-1)]; got["outcome"] != outcomeApplied {
		t.Fatalf("the next day: want applied, got %v", got)
	}
}

// Bug 1. Only a rating about to be stored spends the allowance: ratings the
// server refuses on their merits cost nothing.
func TestRefusedRatingsSpendNoAllowance(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "benoit", "correct horse battery").str("token")

	var junk []map[string]any
	for i := 0; i < 250; i++ {
		junk = append(junk, rating(fmt.Sprintf("scenario:x%d", i), 3, map[string]any{"playId": "never-played"}))
	}
	for id, r := range ratingResults(t, push(t, s, token, "junk", junk...)) {
		if r["outcome"] != outcomeRejected || r["reason"] != reasonNotPlayed {
			t.Fatalf("%s: want rejected/not_played, got %v", id, r)
		}
	}

	good := ratingResults(t, push(t, s, token, "good",
		play("p1", "rhino", "", nil),
		rating("scenario:rhino", 4, map[string]any{"playId": "p1"})))
	if got := good["ratings/scenario:rhino"]; got["outcome"] != outcomeApplied {
		t.Fatalf("after 250 refused ratings a real one should still apply, got %v", got)
	}
}

// Bug 3. The summary cache is keyed by anything an unauthenticated caller asks
// about: it must stay bounded, and a sweep must reclaim what expired.
func TestSummaryCacheIsBoundedAndSwept(t *testing.T) {
	s := newTestServer(t)
	const ips, perIP, perReq = 5, 100, 50 // within ratingsSummaryPerIP (120/h)
	for ip := 0; ip < ips; ip++ {
		for r := 0; r < perIP; r++ {
			path := "/v1/ratings/summary"
			for k := 0; k < perReq; k++ {
				sep := "&"
				if k == 0 {
					sep = "?"
				}
				path += fmt.Sprintf("%ssubject=scenario:junk-%d-%d-%d", sep, ip, r, k)
			}
			req := httptest.NewRequest("GET", path, nil)
			req.RemoteAddr = fmt.Sprintf("198.51.100.%d:1234", ip+1)
			rec := httptest.NewRecorder()
			s.Handler().ServeHTTP(rec, req)
			if rec.Code != http.StatusOK {
				t.Fatalf("summary status %d", rec.Code)
			}
		}
	}
	held := func() int {
		s.summaries.mu.Lock()
		defer s.summaries.mu.Unlock()
		return len(s.summaries.entries)
	}
	if n := held(); n > maxCachedSummaries {
		t.Fatalf("25,000 junk subjects: cache holds %d, over its cap of %d", n, maxCachedSummaries)
	}
	s.summaries.sweep(time.Now().Add(summaryTTL + time.Second))
	if n := held(); n != 0 {
		t.Fatalf("after the TTL a sweep should empty the cache, %d entries left", n)
	}
}

// Bug hunt minor finding. A summary read before a rating write must not be
// cached after the write invalidated it.
func TestSummaryReadBeforeAWriteIsNotCached(t *testing.T) {
	c := newSummaryCache()
	now := time.Now()
	readAt := c.current()
	c.forget("scenario:rhino") // a rating lands while the read is in flight
	c.put("scenario:rhino", Summary{Count: 1}, now, readAt)
	if _, ok := c.get("scenario:rhino", now); ok {
		t.Fatal("a summary read before an invalidation was cached")
	}
	c.put("scenario:rhino", Summary{Count: 2}, now, c.current())
	if got, ok := c.get("scenario:rhino", now); !ok || got.Count != 2 {
		t.Fatalf("a fresh read should be cached, got %v %v", got, ok)
	}
}

// Bug 5. Signing a device out ends its open stream, and only its stream.
func TestSignedOutDevicesLoseTheirStream(t *testing.T) {
	ended := func(l *listener) bool {
		select {
		case <-l.done:
			return true
		case <-time.After(3 * time.Second):
			return false
		}
	}
	setup := func(t *testing.T) (*Server, *httptest.Server, string, string) {
		s := newTestServer(t)
		srv := httptest.NewServer(s.Handler())
		t.Cleanup(srv.Close)
		stolen := register(t, s, "benoit", "correct horse battery").str("token")
		owner := call(t, s, "POST", "/v1/auth/login", "",
			map[string]any{"handle": "benoit", "password": "correct horse battery", "deviceName": "phone"}).str("token")
		return s, srv, stolen, owner
	}

	t.Run("password change", func(t *testing.T) {
		s, srv, stolen, owner := setup(t)
		thief := listen(t, srv, stolen, 0)
		defer thief.close()
		mine := listen(t, srv, owner, 0)
		defer mine.close()
		thief.greeted(3 * time.Second)
		mine.greeted(3 * time.Second)

		pw := call(t, s, "POST", "/v1/auth/password", owner,
			map[string]any{"currentPassword": "correct horse battery", "newPassword": "a brand new long password"})
		if pw.status != http.StatusOK {
			t.Fatalf("password change: %d %v", pw.status, pw.body)
		}
		if !ended(thief) {
			t.Fatal("the signed-out device's stream is still open")
		}
		pushOverHTTP(t, srv, owner, "after-password-change")
		if rev := mine.expect(3 * time.Second); rev <= 0 {
			t.Fatalf("the device that changed the password should keep its stream, got %d", rev)
		}
	})

	t.Run("device revoked", func(t *testing.T) {
		s, srv, stolen, owner := setup(t)
		thief := listen(t, srv, stolen, 0)
		defer thief.close()
		thief.greeted(3 * time.Second)

		list := call(t, s, "GET", "/v1/auth/devices", owner, nil)
		devices, _ := list.body["devices"].([]any)
		revoked := ""
		for _, d := range devices {
			if m := d.(map[string]any); m["current"] != true {
				revoked = m["id"].(string)
			}
		}
		if r := call(t, s, "DELETE", "/v1/auth/devices/"+revoked, owner, nil); r.status != http.StatusOK {
			t.Fatalf("revoke: %d %v", r.status, r.body)
		}
		if !ended(thief) {
			t.Fatal("the revoked device's stream is still open")
		}
	})
}

// Bug 6. An account's handle and its address share one login budget, and one
// recovery budget.
func TestLoginAndRecoveryBudgetsArePerAccount(t *testing.T) {
	s := newTestServer(t)
	register(t, s, "benoit", "correct horse battery")

	login := func(field, value string) string {
		return call(t, s, "POST", "/v1/auth/login", "",
			map[string]any{field: value, "password": "wrong password guess", "deviceName": "x"}).code()
	}
	for i := 0; i < 10; i++ {
		login("handle", "benoit")
	}
	if c := login("email", testEmail("benoit")); c != "rate_limited" {
		t.Fatalf("login: the handle's budget is spent, a guess through the address got %q", c)
	}

	recover := func(field, value string) string {
		return call(t, s, "POST", "/v1/auth/recover", "",
			map[string]any{field: value, "recoveryCode": "AAAA-BBBB-CCCC-DDDD", "newPassword": "a brand new long password"}).code()
	}
	for i := 0; i < 5; i++ {
		recover("handle", "benoit")
	}
	if c := recover("email", testEmail("benoit")); c != "rate_limited" {
		t.Fatalf("recovery: the handle's budget is spent, a guess through the address got %q", c)
	}

	// Someone else's budget is untouched.
	register(t, s, "somebody", "another long password")
	if c := login("handle", "somebody"); c != "invalid_credentials" {
		t.Fatalf("another account's first guess got %q", c)
	}
}

// Bug 4. A play that went out and got no answer may be on BGG already: the
// relay must say so, not "try again later".
func TestSlowBggAnswerIsReportedUncertain(t *testing.T) {
	const password = "hunter2-bgg-secret"
	fake := &fakeBgg{password: password}
	inner := fake.handler()
	slow := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		inner.ServeHTTP(w, r) // the play IS recorded...
		if r.URL.Path == "/geekplay.php" {
			time.Sleep(400 * time.Millisecond) // ...and the answer comes after the relay's timeout
		}
	})
	upstream := httptest.NewServer(slow)
	t.Cleanup(upstream.Close)
	s := newTestServer(t)
	s.UseBggRelay(upstream.URL)
	s.bgg.client.Timeout = 200 * time.Millisecond // stands in for bggTimeout
	var logged bytes.Buffer
	s.log = slog.New(slog.NewTextHandler(&logged, &slog.HandlerOptions{Level: slog.LevelDebug}))
	token := register(t, s, "geek", "correct horse battery").str("token")

	res := call(t, s, "POST", "/v1/bgg/plays", token,
		map[string]any{"username": "hasyame", "password": password, "play": samplePlay()})
	if res.status != http.StatusGatewayTimeout || res.code() != "bgg_uncertain" {
		t.Fatalf("sent, no answer: want 504 bgg_uncertain, got %d %q", res.status, res.code())
	}
	if strings.Contains(logged.String(), password) || strings.Contains(logged.String(), "hasyame") {
		t.Fatalf("a credential reached the log:\n%s", logged.String())
	}

	// Nothing listening is still "unreachable": nothing went out, a retry is safe.
	s = newTestServer(t)
	s.UseBggRelay("http://127.0.0.1:1")
	token = register(t, s, "geek", "correct horse battery").str("token")
	res = call(t, s, "POST", "/v1/bgg/plays", token,
		map[string]any{"username": "hasyame", "password": password, "play": samplePlay()})
	if res.code() != "bgg_unreachable" {
		t.Fatalf("nothing listening: want bgg_unreachable, got %q", res.code())
	}
}
