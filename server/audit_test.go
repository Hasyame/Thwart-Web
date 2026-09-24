package main

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"testing"
)

/*
The black-box audit of 2026-09-24, turned into tests where it asked for one.

Every public endpoint that does work worth grinding, or that sends mail, has a
throttle; the ones not already covered elsewhere are pinned here, so removing
one fails a test instead of passing review. Login (api_test, hardening_test),
register (unit_test), BGG verify (bgg_test) and the alpha form (alpha_test) are
covered where they live.
*/

func TestRecoveryIsRateLimitedPerHandle(t *testing.T) {
	s := newTestServer(t)
	register(t, s, "benoit", "correct horse battery")
	limited := false
	for i := 0; i < recoverHandle.limit+1; i++ {
		res := call(t, s, "POST", "/v1/auth/recover", "", map[string]any{
			"handle": "benoit", "recoveryCode": "AAAA-AAAA-AAAA-AAAA",
			"newPassword": "another long password", "deviceName": "test",
		})
		if res.status == http.StatusTooManyRequests {
			limited = true
			break
		}
	}
	if !limited {
		t.Fatalf("no limit after %d recovery attempts", recoverHandle.limit+1)
	}
}

func TestVerifyIsRateLimitedPerAddress(t *testing.T) {
	s, _ := newMailServer(t)
	for i := 0; i < verifyPerIP.limit; i++ {
		res := call(t, s, "POST", "/v1/auth/verify", "", map[string]any{"token": "not-a-real-token"})
		if res.status == http.StatusTooManyRequests {
			t.Fatalf("limited after %d attempts, before the limit of %d", i, verifyPerIP.limit)
		}
	}
	res := call(t, s, "POST", "/v1/auth/verify", "", map[string]any{"token": "not-a-real-token"})
	if res.status != http.StatusTooManyRequests {
		t.Fatalf("status %d after %d attempts, want 429", res.status, verifyPerIP.limit)
	}
}

func TestResendIsRateLimitedPerAddress(t *testing.T) {
	s, _ := newMailServer(t)
	// Strangers' requests count too: the limit is what stops the endpoint
	// being ground, whatever the answer says.
	for i := 0; i < resendPerIP.limit; i++ {
		res := call(t, s, "POST", "/v1/auth/verify/resend", "", map[string]any{
			"email": "nobody@example.test", "password": "correct horse battery",
		})
		if res.status != http.StatusAccepted {
			t.Fatalf("attempt %d: status %d", i+1, res.status)
		}
	}
	res := call(t, s, "POST", "/v1/auth/verify/resend", "", map[string]any{
		"email": "nobody@example.test", "password": "correct horse battery",
	})
	if res.status != http.StatusTooManyRequests {
		t.Fatalf("status %d, want 429 after %d resends", res.status, resendPerIP.limit)
	}
}

func TestResendIsRateLimitedPerAccount(t *testing.T) {
	s, mailer := newMailServer(t)
	register(t, s, "benoit", "correct horse battery")
	before := mailer.count()
	for i := 0; i < resendPerAccount.limit; i++ {
		res := call(t, s, "POST", "/v1/auth/verify/resend", "", map[string]any{
			"email": testEmail("benoit"), "password": "correct horse battery",
		})
		if res.status != http.StatusAccepted {
			t.Fatalf("resend %d: status %d", i+1, res.status)
		}
	}
	res := call(t, s, "POST", "/v1/auth/verify/resend", "", map[string]any{
		"email": testEmail("benoit"), "password": "correct horse battery",
	})
	if res.status != http.StatusTooManyRequests {
		t.Fatalf("status %d, want 429 once the account had %d resends", res.status, resendPerAccount.limit)
	}
	if sent := mailer.count() - before; sent != resendPerAccount.limit {
		t.Fatalf("sent %d messages, want %d", sent, resendPerAccount.limit)
	}
}

/*
The BGG relay's promise, checked where it could break: every outcome, with the
server's log captured, and neither the password nor the username in it.
*/
func TestBggCredentialsNeverReachTheLog(t *testing.T) {
	const password = "hunter2-bgg-secret"
	const username = "secret-geek-name"
	var logged bytes.Buffer

	cases := []*fakeBgg{
		{password: password},         // success
		{password: "something else"}, // bad credentials
		{password: password, loginStatus: http.StatusInternalServerError}, // BGG broken
		{password: password, playBody: `{"error":"Invalid play date"}`},   // play refused
	}
	for _, fake := range cases {
		s, token := newBggTestServer(t, fake)
		s.log = slog.New(slog.NewTextHandler(&logged, &slog.HandlerOptions{Level: slog.LevelDebug}))
		call(t, s, "POST", "/v1/bgg/verify", token, map[string]any{"username": username, "password": password})
		call(t, s, "POST", "/v1/bgg/plays", token,
			map[string]any{"username": username, "password": password, "play": samplePlay()})
	}
	// And nothing listening at all, which logs the transport error.
	s := newTestServer(t)
	s.UseBggRelay("http://127.0.0.1:1")
	s.log = slog.New(slog.NewTextHandler(&logged, &slog.HandlerOptions{Level: slog.LevelDebug}))
	token := register(t, s, "geek", "correct horse battery").str("token")
	call(t, s, "POST", "/v1/bgg/verify", token, map[string]any{"username": username, "password": password})

	if logged.Len() == 0 {
		t.Fatal("nothing was logged; the test would pass without checking anything")
	}
	for _, secret := range []string{password, username} {
		if strings.Contains(logged.String(), secret) {
			t.Errorf("%q reached the log:\n%s", secret, logged.String())
		}
	}
}

// Sync and the stream are covered in sync_test and stream_test; this adds the
// two other reads that return an account's own data.
func TestExportAndDevicesAreScopedToTheAccount(t *testing.T) {
	s := newTestServer(t)
	mine := register(t, s, "benoit", "a long enough password").str("token")
	theirs := register(t, s, "someone", "another long password").str("token")
	push(t, s, mine, "batch-1", record("plays", "play-1", map[string]any{"note": "only-mine"}))

	export := call(t, s, "GET", "/v1/account/export", theirs, nil)
	if export.status != http.StatusOK {
		t.Fatalf("export: status %d", export.status)
	}
	raw, _ := json.Marshal(export.body)
	if strings.Contains(string(raw), "only-mine") || strings.Contains(string(raw), "benoit") {
		t.Errorf("another account's export carries my data: %s", raw)
	}

	devices := call(t, s, "GET", "/v1/auth/devices", theirs, nil)
	raw, _ = json.Marshal(devices.body)
	if devices.status != http.StatusOK || strings.Count(string(raw), `"id"`) != 1 {
		t.Errorf("another account's device list should hold its one device: %d %s", devices.status, raw)
	}
}
