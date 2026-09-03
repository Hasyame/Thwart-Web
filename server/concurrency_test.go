package main

import (
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"
)

/*
Concurrency.

Run these with the race detector, which is the only reason they exist:

	CGO_ENABLED=1 go test -race ./...

The counts are kept small on purpose. Argon2id takes 64 MiB per hash, so a
dozen simultaneous logins is most of a gigabyte, and the point here is to have
two goroutines touch the same state at the same time rather than to load-test
anything.
*/

// The limiter is one map behind one mutex, read and written by every request
// plus a sweeper on a ticker. If the counting is not atomic, more than the
// limit gets through.
func TestLimiterCountsCorrectlyUnderConcurrency(t *testing.T) {
	l := newLimiter()
	rule := limitRule{limit: 20, window: time.Hour}

	const goroutines, each = 8, 25 // 200 attempts against a limit of 20

	var allowed int
	var mu sync.Mutex
	var wg sync.WaitGroup

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < each; j++ {
				if l.allow("shared", rule) {
					mu.Lock()
					allowed++
					mu.Unlock()
				}
			}
		}()
	}

	// Sweeping while the counting runs, because that is what the process
	// actually does: main.go has this on a ticker for the lifetime of the
	// server.
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 50; i++ {
			l.sweep()
		}
	}()

	wg.Wait()

	// Exact, not approximate. Nothing here expires, so the count is decided by
	// the locking and by nothing else.
	if allowed != rule.limit {
		t.Errorf("allowed %d attempts, want exactly %d", allowed, rule.limit)
	}
}

// Two people picking the same handle at the same moment. Exactly one account
// must exist afterwards: the unique index decides it, and the loser has to see
// handle_taken rather than a server error.
func TestSimultaneousRegistrationsOfOneHandle(t *testing.T) {
	s := newTestServer(t)

	const attempts = 4
	results := make([]response, attempts)

	var wg sync.WaitGroup
	for i := 0; i < attempts; i++ {
		wg.Add(1)
		go func(slot int) {
			defer wg.Done()
			// A distinct address per attempt: the collision under test is the
			// handle, and a shared address would let the other unique index
			// answer first.
			results[slot] = call(t, s, "POST", "/v1/auth/register", "", map[string]any{
				"handle":   "benoit",
				"email":    fmt.Sprintf("benoit+%d@example.test", slot),
				"password": "correct horse battery",
			})
		}(i)
	}
	wg.Wait()

	created, taken := 0, 0
	for _, res := range results {
		switch {
		case res.status == http.StatusCreated:
			created++
		case res.code() == "handle_taken":
			taken++
		default:
			t.Errorf("unexpected outcome: status %d, code %q", res.status, res.code())
		}
	}
	if created != 1 {
		t.Errorf("created %d accounts, want exactly 1", created)
	}
	if taken != attempts-1 {
		t.Errorf("%d attempts saw handle_taken, want %d", taken, attempts-1)
	}
}

// Several devices signing in at once. Each must get its own token and its own
// row; a shared or overwritten one would show up as a missing device.
func TestConcurrentLoginsEachGetTheirOwnDevice(t *testing.T) {
	s := newTestServer(t)
	created := register(t, s, "benoit", "correct horse battery")

	const logins = 4
	tokens := make([]string, logins)

	var wg sync.WaitGroup
	for i := 0; i < logins; i++ {
		wg.Add(1)
		go func(slot int) {
			defer wg.Done()
			res := call(t, s, "POST", "/v1/auth/login", "", map[string]any{
				"handle": "benoit", "password": "correct horse battery", "deviceName": "device",
			})
			if res.status != http.StatusOK {
				t.Errorf("login %d: status %d, code %q", slot, res.status, res.code())
				return
			}
			tokens[slot] = res.str("token")
		}(i)
	}
	wg.Wait()

	unique := map[string]bool{}
	for _, token := range tokens {
		if token == "" {
			t.Fatal("a login returned no token")
		}
		if unique[token] {
			t.Fatal("two logins were handed the same token")
		}
		unique[token] = true
	}

	listed := call(t, s, "GET", "/v1/auth/devices", created.str("token"), nil)
	devices, _ := listed.body["devices"].([]any)
	if len(devices) != logins+1 {
		t.Errorf("expected %d devices, got %d", logins+1, len(devices))
	}
}

// Reads and writes crossing on one account. The handler reads the account on
// every authenticated request while another goroutine rewrites its password
// hash; SQLite serialises the writes, and this is the test that says so.
func TestReadsAndWritesCrossOnOneAccount(t *testing.T) {
	s := newTestServer(t)
	created := register(t, s, "benoit", "correct horse battery")
	token := created.str("token")

	var wg sync.WaitGroup

	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < 10; i++ {
			if res := call(t, s, "GET", "/v1/auth/devices", token, nil); res.status != http.StatusOK {
				t.Errorf("device list failed mid-write: status %d", res.status)
				return
			}
		}
	}()

	wg.Add(1)
	go func() {
		defer wg.Done()
		// One change, not a loop: each one rehashes at 64 MiB, and the second
		// would need the new password anyway.
		res := call(t, s, "POST", "/v1/auth/password", token, map[string]any{
			"currentPassword": "correct horse battery",
			"newPassword":     "a different long one",
		})
		if res.status != http.StatusOK {
			t.Errorf("password change: status %d, code %q", res.status, res.code())
		}
	}()

	wg.Wait()
}
