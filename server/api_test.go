package main

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newTestServer(t *testing.T) *Server {
	t.Helper()

	store, err := OpenStore(filepath.Join(t.TempDir(), "test.sqlite"))
	if err != nil {
		t.Fatalf("open store: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })

	// Discard: a passing test should be silent, and the handlers log on every
	// error path on purpose.
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	server, err := NewServer(store, log, "test")
	if err != nil {
		t.Fatalf("new server: %v", err)
	}
	return server
}

type response struct {
	status int
	body   map[string]any
}

func (r response) code() string {
	wrapper, ok := r.body["error"].(map[string]any)
	if !ok {
		return ""
	}
	code, _ := wrapper["code"].(string)
	return code
}

func (r response) str(key string) string {
	value, _ := r.body[key].(string)
	return value
}

// Safe to call from a spawned goroutine: it reports failures with Errorf
// rather than Fatalf, which may only be used on the test's own goroutine.
func call(t *testing.T, s *Server, method, path, token string, body any, headers ...string) response {
	t.Helper()

	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Errorf("marshal: %v", err)
			return response{}
		}
		reader = bytes.NewReader(encoded)
	}

	req := httptest.NewRequest(method, path, reader)
	// A public address, so the rate limiter treats each test as one client and
	// does not take the X-Forwarded-For path unless a test asks for it.
	req.RemoteAddr = "203.0.113.7:54321"
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}

	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)

	out := response{status: rec.Code}
	if rec.Body.Len() > 0 {
		if err := json.Unmarshal(rec.Body.Bytes(), &out.body); err != nil {
			t.Errorf("%s %s: body is not JSON: %q", method, path, rec.Body.String())
		}
	}
	return out
}

func register(t *testing.T, s *Server, handle, password string) response {
	t.Helper()
	res := call(t, s, "POST", "/v1/auth/register", "",
		map[string]any{"handle": handle, "password": password, "deviceName": "test device"})
	if res.status != http.StatusCreated {
		t.Fatalf("register %s: status %d, body %v", handle, res.status, res.body)
	}
	return res
}

// --- the whole account lifecycle --------------------------------------------

func TestAccountLifecycle(t *testing.T) {
	s := newTestServer(t)

	created := register(t, s, "benoit", "correct horse battery")
	if created.str("token") == "" || created.str("recoveryCode") == "" {
		t.Fatalf("register returned no credentials: %v", created.body)
	}
	if !strings.HasPrefix(created.str("token"), "tw_live_") {
		t.Errorf("token has no recognisable prefix: %q", created.str("token"))
	}

	// A second device, so there is something for the password change to sign
	// out. This is the case the test exists for.
	second := call(t, s, "POST", "/v1/auth/login", "",
		map[string]any{"handle": "benoit", "password": "correct horse battery", "deviceName": "phone"})
	if second.status != http.StatusOK {
		t.Fatalf("login: status %d, body %v", second.status, second.body)
	}

	listed := call(t, s, "GET", "/v1/auth/devices", second.str("token"), nil)
	devices, _ := listed.body["devices"].([]any)
	if len(devices) != 2 {
		t.Fatalf("expected 2 devices, got %d: %v", len(devices), listed.body)
	}
	current := 0
	for _, entry := range devices {
		if flag, _ := entry.(map[string]any)["current"].(bool); flag {
			current++
		}
	}
	if current != 1 {
		t.Errorf("expected exactly one device marked current, got %d", current)
	}

	// Changing the password from the phone must revoke the first device.
	changed := call(t, s, "POST", "/v1/auth/password", second.str("token"),
		map[string]any{"currentPassword": "correct horse battery", "newPassword": "a different long one"})
	if changed.status != http.StatusOK {
		t.Fatalf("password change: status %d, body %v", changed.status, changed.body)
	}

	stale := call(t, s, "GET", "/v1/auth/devices", created.str("token"), nil)
	if stale.status != http.StatusUnauthorized {
		t.Errorf("the other device kept working after a password change: status %d", stale.status)
	}
	if kept := call(t, s, "GET", "/v1/auth/devices", second.str("token"), nil); kept.status != http.StatusOK {
		t.Errorf("the device that changed the password was signed out too: status %d", kept.status)
	}

	// The old password must be gone, the new one must work.
	if old := call(t, s, "POST", "/v1/auth/login", "",
		map[string]any{"handle": "benoit", "password": "correct horse battery"}); old.status != http.StatusUnauthorized {
		t.Errorf("old password still works: status %d", old.status)
	}

	// Erasure asks for the password again, because a stolen token should not be
	// able to do the one irreversible thing in the API.
	if refused := call(t, s, "DELETE", "/v1/account", second.str("token"),
		map[string]any{"password": "correct horse battery"}); refused.code() != "invalid_credentials" {
		t.Errorf("the old password deleted the account: status %d, code %q", refused.status, refused.code())
	}

	// Deleting the account takes its devices with it.
	deleted := call(t, s, "DELETE", "/v1/account", second.str("token"),
		map[string]any{"password": "a different long one"})
	if deleted.status != http.StatusOK {
		t.Fatalf("delete account: status %d, body %v", deleted.status, deleted.body)
	}
	if after := call(t, s, "GET", "/v1/auth/devices", second.str("token"), nil); after.status != http.StatusUnauthorized {
		t.Errorf("token outlived its account: status %d", after.status)
	}
}

func TestRecoverySpendsTheCodeAndSignsEverybodyOut(t *testing.T) {
	s := newTestServer(t)
	created := register(t, s, "benoit", "correct horse battery")
	code := created.str("recoveryCode")

	recovered := call(t, s, "POST", "/v1/auth/recover", "", map[string]any{
		"handle": "benoit", "recoveryCode": code, "newPassword": "brand new long password",
	})
	if recovered.status != http.StatusOK {
		t.Fatalf("recover: status %d, body %v", recovered.status, recovered.body)
	}
	if recovered.str("recoveryCode") == code {
		t.Error("recovery returned the same code it consumed")
	}
	if recovered.str("recoveryCode") == "" {
		t.Error("recovery did not issue a replacement code")
	}

	// The device that existed before recovery must be gone.
	if before := call(t, s, "GET", "/v1/auth/devices", created.str("token"), nil); before.status != http.StatusUnauthorized {
		t.Errorf("recovery left an older device signed in: status %d", before.status)
	}

	// Replaying the spent code must fail, even though it was valid a moment ago.
	replay := call(t, s, "POST", "/v1/auth/recover", "", map[string]any{
		"handle": "benoit", "recoveryCode": code, "newPassword": "yet another long one",
	})
	if replay.code() != "invalid_recovery_code" {
		t.Errorf("a spent recovery code was accepted again: status %d, code %q", replay.status, replay.code())
	}
}

func TestRecoveryCodeIsAcceptedAsPeopleTypeIt(t *testing.T) {
	s := newTestServer(t)
	created := register(t, s, "benoit", "correct horse battery")

	// Lower case, no dashes, and the look-alikes people substitute. This is the
	// case auth.go's alphabet exists for.
	mangled := strings.ToLower(strings.ReplaceAll(created.str("recoveryCode"), "-", " "))
	mangled = strings.NewReplacer("0", "o", "1", "l").Replace(mangled)

	res := call(t, s, "POST", "/v1/auth/recover", "", map[string]any{
		"handle": "benoit", "recoveryCode": mangled, "newPassword": "brand new long password",
	})
	if res.status != http.StatusOK {
		t.Fatalf("a mistyped but equivalent code was refused: status %d, code %q", res.status, res.code())
	}
}

// --- what the server refuses to tell you ------------------------------------

func TestLoginDoesNotRevealWhetherAHandleExists(t *testing.T) {
	s := newTestServer(t)
	register(t, s, "benoit", "correct horse battery")

	unknown := call(t, s, "POST", "/v1/auth/login", "",
		map[string]any{"handle": "nobody", "password": "correct horse battery"})
	wrong := call(t, s, "POST", "/v1/auth/login", "",
		map[string]any{"handle": "benoit", "password": "wrong but long enough"})

	if unknown.status != wrong.status || unknown.code() != wrong.code() {
		t.Errorf("the two failures are distinguishable: unknown=%d/%q, wrong=%d/%q",
			unknown.status, unknown.code(), wrong.status, wrong.code())
	}
	if unknown.code() != "invalid_credentials" {
		t.Errorf("unexpected code %q", unknown.code())
	}
}

// The decoy hash is what makes the two paths cost the same. Without it an
// unknown handle skips Argon2 entirely and returns in microseconds.
func TestUnknownHandleStillPaysForArgon(t *testing.T) {
	s := newTestServer(t)
	register(t, s, "benoit", "correct horse battery")

	start := time.Now()
	call(t, s, "POST", "/v1/auth/login", "",
		map[string]any{"handle": "nobody", "password": "correct horse battery"})
	unknown := time.Since(start)

	start = time.Now()
	call(t, s, "POST", "/v1/auth/login", "",
		map[string]any{"handle": "benoit", "password": "wrong but long enough"})
	known := time.Since(start)

	// Deliberately loose. The claim is that one is not orders of magnitude
	// faster than the other, not that they are equal, which no wall clock on a
	// shared machine could establish.
	if unknown < known/4 {
		t.Errorf("unknown handle answered far too quickly: unknown=%v, known=%v", unknown, known)
	}
}

func TestUnauthenticatedAndBadTokens(t *testing.T) {
	s := newTestServer(t)

	for _, probe := range []struct {
		name  string
		token string
	}{
		{"no token", ""},
		{"nonsense token", "not-a-token"},
		{"well-formed but unknown", "tw_live_" + strings.Repeat("A", 43)},
	} {
		res := call(t, s, "GET", "/v1/auth/devices", probe.token, nil)
		if res.status != http.StatusUnauthorized || res.code() != "unauthorized" {
			t.Errorf("%s: status %d, code %q", probe.name, res.status, res.code())
		}
	}
}

func TestOneAccountCannotRevokeAnothersDevice(t *testing.T) {
	s := newTestServer(t)
	mine := register(t, s, "benoit", "correct horse battery")
	theirs := register(t, s, "someone", "another long password")

	listed := call(t, s, "GET", "/v1/auth/devices", theirs.str("token"), nil)
	devices, _ := listed.body["devices"].([]any)
	if len(devices) != 1 {
		t.Fatalf("expected one device, got %d", len(devices))
	}
	victim, _ := devices[0].(map[string]any)["id"].(string)

	res := call(t, s, "DELETE", "/v1/auth/devices/"+victim, mine.str("token"), nil)
	if res.status != http.StatusNotFound {
		t.Errorf("revoked a stranger's device: status %d, body %v", res.status, res.body)
	}
	if still := call(t, s, "GET", "/v1/auth/devices", theirs.str("token"), nil); still.status != http.StatusOK {
		t.Errorf("the stranger was signed out anyway: status %d", still.status)
	}
}

// --- validation --------------------------------------------------------------

func TestRegistrationValidation(t *testing.T) {
	s := newTestServer(t)
	register(t, s, "benoit", "correct horse battery")

	cases := []struct {
		name     string
		handle   string
		password string
		code     string
	}{
		{"handle already taken", "benoit", "another long password", "handle_taken"},
		{"same handle, different case", "BENOIT", "another long password", "handle_taken"},
		{"handle too short", "ab", "another long password", "invalid_handle"},
		{"handle has a space", "be noit", "another long password", "invalid_handle"},
		{"handle is an email", "a@b.com", "another long password", "invalid_handle"},
		{"password too short", "fresh", "short", "weak_password"},
		{"password is the handle", "repeated.handle", "repeated.handle", "weak_password"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := call(t, s, "POST", "/v1/auth/register", "",
				map[string]any{"handle": c.handle, "password": c.password})
			if res.code() != c.code {
				t.Errorf("status %d, code %q, want %q", res.status, res.code(), c.code)
			}
		})
	}
}

func TestMalformedBodies(t *testing.T) {
	s := newTestServer(t)

	// An unknown field, which is usually a client sending the wrong shape.
	res := call(t, s, "POST", "/v1/auth/register", "",
		map[string]any{"handle": "benoit", "passphrase": "correct horse battery"})
	if res.code() != "malformed_record" {
		t.Errorf("unknown field accepted: status %d, code %q", res.status, res.code())
	}

	// Two documents in one body.
	req := httptest.NewRequest("POST", "/v1/auth/register",
		strings.NewReader(`{"handle":"a"} {"handle":"b"}`))
	req.RemoteAddr = "203.0.113.7:1234"
	rec := httptest.NewRecorder()
	s.Handler().ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Errorf("a second document in the body was accepted: status %d", rec.Code)
	}

	// Larger than the cap.
	big := call(t, s, "POST", "/v1/auth/register", "",
		map[string]any{"handle": "benoit", "password": strings.Repeat("x", maxRequestBytes+1)})
	if big.status != http.StatusBadRequest {
		t.Errorf("an oversized body was accepted: status %d", big.status)
	}
}

func TestUnknownRouteAnswersInTheStandardEnvelope(t *testing.T) {
	s := newTestServer(t)
	res := call(t, s, "GET", "/v1/nothing/here", "", nil)
	if res.status != http.StatusNotFound || res.code() != "not_found" {
		t.Errorf("status %d, code %q", res.status, res.code())
	}
}

func TestHealthAndVersion(t *testing.T) {
	s := newTestServer(t)

	if res := call(t, s, "GET", "/v1/health", "", nil); res.status != http.StatusOK || res.str("status") != "ok" {
		t.Errorf("health: status %d, body %v", res.status, res.body)
	}

	res := call(t, s, "GET", "/v1/version", "", nil)
	protocol, _ := res.body["protocol"].(float64)
	if res.status != http.StatusOK || int(protocol) != protocolVersion {
		t.Errorf("version: status %d, body %v", res.status, res.body)
	}
}

// --- language and limits ------------------------------------------------------

func TestErrorsAreTranslated(t *testing.T) {
	s := newTestServer(t)

	english := call(t, s, "GET", "/v1/auth/devices", "", nil)
	french := call(t, s, "GET", "/v1/auth/devices", "", nil, "Accept-Language", "fr-FR,fr;q=0.9,en;q=0.8")

	if english.code() != french.code() {
		t.Fatalf("the code changed with the language: %q vs %q", english.code(), french.code())
	}

	message := func(r response) string {
		wrapper, _ := r.body["error"].(map[string]any)
		text, _ := wrapper["message"].(string)
		return text
	}
	if message(english) == message(french) {
		t.Errorf("both languages returned the same text: %q", message(english))
	}
	if !strings.Contains(message(french), "authentification") {
		t.Errorf("French message looks wrong: %q", message(french))
	}
}

func TestLoginIsRateLimitedPerHandle(t *testing.T) {
	s := newTestServer(t)
	register(t, s, "benoit", "correct horse battery")

	var limited bool
	for i := 0; i < loginPerHandle.limit+2; i++ {
		res := call(t, s, "POST", "/v1/auth/login", "",
			map[string]any{"handle": "benoit", "password": "wrong but long enough"})
		if res.code() == "rate_limited" {
			if res.status != http.StatusTooManyRequests {
				t.Errorf("rate limited with status %d", res.status)
			}
			limited = true
			break
		}
	}
	if !limited {
		t.Errorf("no limit applied after %d failed logins", loginPerHandle.limit+2)
	}
}

func TestSuccessfulLoginClearsTheHandleCounter(t *testing.T) {
	s := newTestServer(t)
	register(t, s, "benoit", "correct horse battery")

	// Four failures, then a success, then four more failures. Without the
	// clear, the ninth and tenth attempts would trip the per-handle limit.
	for i := 0; i < 4; i++ {
		call(t, s, "POST", "/v1/auth/login", "",
			map[string]any{"handle": "benoit", "password": "wrong but long enough"})
	}
	if res := call(t, s, "POST", "/v1/auth/login", "",
		map[string]any{"handle": "benoit", "password": "correct horse battery"}); res.status != http.StatusOK {
		t.Fatalf("correct password refused: status %d, code %q", res.status, res.code())
	}
	for i := 0; i < 4; i++ {
		res := call(t, s, "POST", "/v1/auth/login", "",
			map[string]any{"handle": "benoit", "password": "wrong but long enough"})
		if res.code() == "rate_limited" {
			t.Fatalf("attempt %d was limited; the counter was not cleared on success", i+1)
		}
	}
}
