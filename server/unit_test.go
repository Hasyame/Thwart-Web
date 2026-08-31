package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/argon2"
)

func TestPasswordHashRoundTrip(t *testing.T) {
	hash, err := hashSecret("correct horse battery")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if strings.Contains(hash, "correct horse") {
		t.Fatal("the hash contains the password")
	}

	ok, err := verifySecret("correct horse battery", hash)
	if err != nil || !ok {
		t.Errorf("the right password did not verify: ok=%v err=%v", ok, err)
	}
	if ok, _ := verifySecret("correct horse batterz", hash); ok {
		t.Error("a wrong password verified")
	}

	// Same input, different salt: two registrations with the same password must
	// not produce the same row.
	other, err := hashSecret("correct horse battery")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if other == hash {
		t.Error("two hashes of the same password are identical, so the salt is not random")
	}
}

// The parameters live in the hash so they can be raised later. Verifying must
// use the recorded ones, not the current constants, or raising the cost locks
// every existing account out.
func TestVerifyUsesTheParametersInTheHash(t *testing.T) {
	hash, err := hashSecret("correct horse battery")
	if err != nil {
		t.Fatalf("hash: %v", err)
	}
	if !strings.HasPrefix(hash, "$argon2id$") {
		t.Fatalf("unexpected hash format: %q", hash)
	}
	if !strings.Contains(hash, "m=65536,t=1,p=4") {
		t.Fatalf("the hash does not record its parameters: %q", hash)
	}

	// A hash written under cheaper parameters than the ones in force now: this
	// is what an account registered before a cost increase looks like, and it
	// has to keep verifying.
	salt := []byte("sixteen bytes!!!")
	key := argon2.IDKey([]byte("correct horse battery"), salt, 1, 16*1024, 2, 32)
	older := fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version, 16*1024, 1, 2,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(key))

	if ok, err := verifySecret("correct horse battery", older); err != nil || !ok {
		t.Errorf("a hash written under older parameters no longer verifies: ok=%v err=%v", ok, err)
	}
	if ok, _ := verifySecret("the wrong one entirely", older); ok {
		t.Error("a wrong password verified against the older hash")
	}

	for _, broken := range []string{"", "not-a-hash", "$argon2id$v=19$m=65536$abc$def", "$bcrypt$v=19$m=1,t=1,p=1$a$b"} {
		if _, err := verifySecret("x", broken); err == nil {
			t.Errorf("a malformed hash was accepted: %q", broken)
		}
	}
}

func TestRecoveryCodeShape(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 50; i++ {
		code, err := newRecoveryCode()
		if err != nil {
			t.Fatalf("generate: %v", err)
		}
		if seen[code] {
			t.Fatalf("generated the same code twice: %q", code)
		}
		seen[code] = true

		if !strings.HasPrefix(code, "TW-") {
			t.Fatalf("no prefix: %q", code)
		}
		groups := strings.Split(strings.TrimPrefix(code, "TW-"), "-")
		if len(groups) != recoveryGroups {
			t.Fatalf("expected %d groups, got %d: %q", recoveryGroups, len(groups), code)
		}
		for _, group := range groups {
			if len(group) != recoveryGroupSize {
				t.Fatalf("group %q is the wrong length in %q", group, code)
			}
			// The look-alike characters must never be generated, which is the
			// whole reason normaliseRecoveryCode can fold them without
			// ambiguity.
			if strings.ContainsAny(group, "ILOU") {
				t.Fatalf("code contains an excluded character: %q", code)
			}
		}
	}
}

func TestNormaliseRecoveryCode(t *testing.T) {
	cases := map[string]string{
		"TW-4KX9-2M7P":   "TW4KX92M7P",
		"tw-4kx9-2m7p":   "TW4KX92M7P",
		"tw 4kx9 2m7p":   "TW4KX92M7P",
		"  TW4KX92M7P  ": "TW4KX92M7P",
		// The substitutions people actually make when reading handwriting.
		"TW-4KX9-2M7O": "TW4KX92M70",
		"TW-4KXI-2M7P": "TW4KX12M7P",
		"TW-4KXl-2M7P": "TW4KX12M7P",
		"TW-4KXU-2M7P": "TW4KXV2M7P",
	}
	for input, want := range cases {
		if got := normaliseRecoveryCode(input); got != want {
			t.Errorf("normalise(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestPrefersFrench(t *testing.T) {
	cases := map[string]bool{
		"":                            false,
		"en":                          false,
		"fr":                          true,
		"fr-FR":                       true,
		"fr-FR,fr;q=0.9,en;q=0.8":     true,
		"en-GB,en;q=0.9,fr;q=0.8":     false,
		"en;q=0.4,fr;q=0.9":           true,
		"de,es":                       false,
		"*":                           false,
		"fr;q=0, en;q=0.1":            false,
		"  FR-ca ;q=1.0 , en ;q=0.5 ": true,
	}
	for header, want := range cases {
		if got := prefersFrench(header); got != want {
			t.Errorf("prefersFrench(%q) = %v, want %v", header, got, want)
		}
	}
}

/*
The header is trusted only from a proxy.

Both halves matter. From a public peer the header is ignored, or anyone could
mint a fresh identity per attempt and never be limited. From loopback it is
honoured, or nginx would put the entire internet in one bucket.
*/
func TestClientIP(t *testing.T) {
	cases := []struct {
		name      string
		remote    string
		forwarded string
		want      string
	}{
		{"direct, no header", "203.0.113.7:1234", "", "203.0.113.7"},
		{"direct, header ignored", "203.0.113.7:1234", "198.51.100.9", "203.0.113.7"},
		{"behind loopback proxy", "127.0.0.1:1234", "198.51.100.9", "198.51.100.9"},
		{"behind private proxy", "10.0.0.2:1234", "198.51.100.9", "198.51.100.9"},
		{"proxy chain takes the first", "127.0.0.1:1234", "198.51.100.9, 10.0.0.2", "198.51.100.9"},
		{"proxy sent rubbish", "127.0.0.1:1234", "not-an-ip", "127.0.0.1"},
		{"proxy sent nothing", "127.0.0.1:1234", "", "127.0.0.1"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest("GET", "/v1/health", nil)
			req.RemoteAddr = c.remote
			if c.forwarded != "" {
				req.Header.Set("X-Forwarded-For", c.forwarded)
			}
			if got := clientIP(req); got != c.want {
				t.Errorf("clientIP = %q, want %q", got, c.want)
			}
		})
	}
}

func TestLimiterWindow(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	l := newLimiter()
	l.now = func() time.Time { return now }

	rule := limitRule{limit: 3, window: time.Minute}
	for i := 1; i <= 3; i++ {
		if !l.allow("k", rule) {
			t.Fatalf("attempt %d was refused inside the limit", i)
		}
	}
	if l.allow("k", rule) {
		t.Error("the fourth attempt was allowed")
	}
	if !l.allow("other", rule) {
		t.Error("a different key shares the counter")
	}

	// The window is fixed, so everything is forgiven once it passes.
	now = now.Add(time.Minute + time.Second)
	if !l.allow("k", rule) {
		t.Error("the window did not expire")
	}

	// And nothing is left behind once it has.
	now = now.Add(2 * time.Minute)
	l.sweep()
	if len(l.counts) != 0 {
		t.Errorf("sweep left %d expired counters behind", len(l.counts))
	}
}

// --- storage -----------------------------------------------------------------

func TestMigrationsAreIdempotent(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.sqlite")

	store, err := OpenStore(path)
	if err != nil {
		t.Fatalf("first open: %v", err)
	}
	ctx := context.Background()
	account := Account{
		ID: "account-1", Handle: "benoit",
		PasswordHash: "hash", RecoveryHash: "hash",
		RecoveryIssuedAt: time.Now().UTC(), CreatedAt: time.Now().UTC(),
	}
	if err := store.CreateAccount(ctx, account); err != nil {
		t.Fatalf("create account: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}

	// Reopening must not re-run migration 1, which would fail on CREATE TABLE,
	// and must not lose the row.
	reopened, err := OpenStore(path)
	if err != nil {
		t.Fatalf("second open: %v", err)
	}
	defer func() { _ = reopened.Close() }()

	if _, err := reopened.AccountByHandle(ctx, "benoit"); err != nil {
		t.Errorf("account did not survive the reopen: %v", err)
	}
}

func TestDeletingAnAccountTakesItsDevices(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "test.sqlite"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	now := time.Now().UTC()
	if err := store.CreateAccount(ctx, Account{
		ID: "account-1", Handle: "benoit", PasswordHash: "h", RecoveryHash: "h",
		RecoveryIssuedAt: now, CreatedAt: now,
	}); err != nil {
		t.Fatalf("create account: %v", err)
	}
	if err := store.CreateDevice(ctx, Device{
		ID: "device-1", AccountID: "account-1", Name: "phone", CreatedAt: now, LastSeen: now,
	}, "token-hash"); err != nil {
		t.Fatalf("create device: %v", err)
	}

	if err := store.DeleteAccount(ctx, "account-1"); err != nil {
		t.Fatalf("delete account: %v", err)
	}
	// The cascade only fires because OpenStore turns foreign keys on; SQLite
	// leaves them off by default, and this is the test that notices.
	if _, err := store.DeviceByTokenHash(ctx, "token-hash"); err == nil {
		t.Error("the device outlived its account")
	}
}

func TestHandleUniquenessIgnoresCase(t *testing.T) {
	store, err := OpenStore(filepath.Join(t.TempDir(), "test.sqlite"))
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer func() { _ = store.Close() }()

	ctx := context.Background()
	now := time.Now().UTC()
	first := Account{ID: "a", Handle: "Benoit", PasswordHash: "h", RecoveryHash: "h", RecoveryIssuedAt: now, CreatedAt: now}
	if err := store.CreateAccount(ctx, first); err != nil {
		t.Fatalf("create: %v", err)
	}

	second := Account{ID: "b", Handle: "benoit", PasswordHash: "h", RecoveryHash: "h", RecoveryIssuedAt: now, CreatedAt: now}
	if err := store.CreateAccount(ctx, second); err != ErrHandleTaken {
		t.Errorf("expected ErrHandleTaken, got %v", err)
	}

	// And a lookup finds it whichever way it is typed.
	if _, err := store.AccountByHandle(ctx, "BENOIT"); err != nil {
		t.Errorf("case-insensitive lookup failed: %v", err)
	}
}

func TestResponsesAreNotCacheable(t *testing.T) {
	s := newTestServer(t)
	created := register(t, s, "benoit", "correct horse battery")

	req := httptest.NewRequest("GET", "/v1/auth/devices", nil)
	req.RemoteAddr = "203.0.113.7:1234"
	req.Header.Set("Authorization", "Bearer "+created.str("token"))
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status %d", rec.Code)
	}
	// Every response here is a credential or account state; nginx and the
	// browser both need telling.
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}
}
