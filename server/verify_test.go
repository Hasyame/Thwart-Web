package main

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"
)

/*
Confirming an address, and what an account can do before it has been.

The tests that matter here are the refusals. Anybody can check that a good link
works; the reason this feature exists is that a bad one, a stale one, a used one
and an unconfirmed account all have to fail, and fail without telling a stranger
which addresses are registered.
*/

// A mailer that keeps what it was given instead of sending it.
type fakeMailer struct {
	mu   sync.Mutex
	sent []sentMail
	// When set, every send fails with it. For the registration rollback test.
	err error
}

type sentMail struct{ to, subject, body string }

func (m *fakeMailer) Send(_ context.Context, to, subject, body string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.err != nil {
		return m.err
	}
	m.sent = append(m.sent, sentMail{to, subject, body})
	return nil
}

func (m *fakeMailer) last(t *testing.T) sentMail {
	t.Helper()
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.sent) == 0 {
		t.Fatalf("no mail was sent")
	}
	return m.sent[len(m.sent)-1]
}

func (m *fakeMailer) count() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.sent)
}

// The token out of the link in the message, the way a reader gets it: by
// opening what they were sent.
func tokenFromMail(t *testing.T, mail sentMail) string {
	t.Helper()
	start := strings.Index(mail.body, "https://thwart.test/verify?token=")
	if start < 0 {
		t.Fatalf("no confirmation link in the message:\n%s", mail.body)
	}
	link := mail.body[start:]
	if end := strings.IndexAny(link, " \r\n"); end > 0 {
		link = link[:end]
	}
	parsed, err := url.Parse(link)
	if err != nil {
		t.Fatalf("parse link %q: %v", link, err)
	}
	token := parsed.Query().Get("token")
	if token == "" {
		t.Fatalf("link carries no token: %s", link)
	}
	return token
}

func newMailServer(t *testing.T) (*Server, *fakeMailer) {
	t.Helper()
	s := newTestServer(t)
	mailer := &fakeMailer{}
	s.UseMailer(mailer, "https://thwart.test")
	return s, mailer
}

func TestUnverifiedAccountIsDisabled(t *testing.T) {
	s, mailer := newMailServer(t)

	created := register(t, s, "benoit", "correct horse battery")
	if created.body["emailVerified"] != false {
		t.Fatalf("a new account should not be confirmed: %v", created.body)
	}
	token := created.str("token")
	if token == "" {
		t.Fatal("register should still return a device token; the Android app expects the field")
	}

	// Every authenticated route, so that adding one later without thinking
	// about this is caught here rather than in production.
	for _, route := range []struct{ method, path string }{
		{"GET", "/v1/sync/changes?since=0"},
		{"POST", "/v1/sync/changes"},
		{"GET", "/v1/auth/devices"},
		{"GET", "/v1/account/export"},
		{"POST", "/v1/auth/password"},
	} {
		res := call(t, s, route.method, route.path, token, map[string]any{})
		if res.status != http.StatusForbidden || res.code() != "email_not_verified" {
			t.Errorf("%s %s: status %d code %q, want 403 email_not_verified",
				route.method, route.path, res.status, res.code())
		}
	}

	// And signing in says why rather than blaming the password.
	login := call(t, s, "POST", "/v1/auth/login", "", map[string]any{
		"handle": "benoit", "password": "correct horse battery", "deviceName": "another",
	})
	if login.status != http.StatusForbidden || login.code() != "email_not_verified" {
		t.Fatalf("login: status %d code %q, want 403 email_not_verified", login.status, login.code())
	}

	// Now open the link.
	mail := mailer.last(t)
	if mail.to != testEmail("benoit") {
		t.Errorf("sent to %q, want %q", mail.to, testEmail("benoit"))
	}
	if !strings.Contains(mail.body, "benoit") {
		t.Errorf("the message does not name the account:\n%s", mail.body)
	}

	confirmed := call(t, s, "POST", "/v1/auth/verify", "",
		map[string]any{"token": tokenFromMail(t, mail)})
	if confirmed.status != http.StatusOK {
		t.Fatalf("verify: status %d, body %v", confirmed.status, confirmed.body)
	}

	res := call(t, s, "GET", "/v1/auth/devices", token, nil)
	if res.status != http.StatusOK {
		t.Fatalf("after confirming, devices: status %d, body %v", res.status, res.body)
	}
}

func TestVerificationLinkIsSingleUse(t *testing.T) {
	s, mailer := newMailServer(t)
	register(t, s, "benoit", "correct horse battery")
	token := tokenFromMail(t, mailer.last(t))

	if res := call(t, s, "POST", "/v1/auth/verify", "", map[string]any{"token": token}); res.status != http.StatusOK {
		t.Fatalf("first use: status %d", res.status)
	}
	res := call(t, s, "POST", "/v1/auth/verify", "", map[string]any{"token": token})
	if res.status != http.StatusBadRequest || res.code() != "invalid_verification" {
		t.Fatalf("second use: status %d code %q, want 400 invalid_verification", res.status, res.code())
	}
}

func TestVerificationRejectsRubbishWithoutSayingWhy(t *testing.T) {
	s, _ := newMailServer(t)
	register(t, s, "benoit", "correct horse battery")

	for _, token := range []string{"", "   ", "tw_verify_nonsense", "../../etc/passwd"} {
		res := call(t, s, "POST", "/v1/auth/verify", "", map[string]any{"token": token})
		if res.status != http.StatusBadRequest || res.code() != "invalid_verification" {
			t.Errorf("token %q: status %d code %q, want 400 invalid_verification",
				token, res.status, res.code())
		}
	}
}

func TestVerificationExpires(t *testing.T) {
	s, mailer := newMailServer(t)
	register(t, s, "benoit", "correct horse battery")
	token := tokenFromMail(t, mailer.last(t))

	// Age the link rather than the clock: the window is a week, and a test that
	// waited for it would be a test nobody runs.
	account, err := s.store.AccountByHandle(context.Background(), "benoit")
	if err != nil {
		t.Fatalf("account: %v", err)
	}
	stale := time.Now().UTC().Add(-verifyWindow - time.Hour)
	if err := s.store.SetVerification(context.Background(), account.ID, account.VerifyHash, stale); err != nil {
		t.Fatalf("age the link: %v", err)
	}

	res := call(t, s, "POST", "/v1/auth/verify", "", map[string]any{"token": token})
	if res.status != http.StatusBadRequest || res.code() != "verification_expired" {
		t.Fatalf("status %d code %q, want 400 verification_expired", res.status, res.code())
	}
}

func TestResendIssuesANewLinkAndRetiresTheOld(t *testing.T) {
	s, mailer := newMailServer(t)
	register(t, s, "benoit", "correct horse battery")
	first := tokenFromMail(t, mailer.last(t))

	res := call(t, s, "POST", "/v1/auth/verify/resend", "", map[string]any{
		"email": testEmail("benoit"), "password": "correct horse battery",
	})
	if res.status != http.StatusAccepted {
		t.Fatalf("resend: status %d, body %v", res.status, res.body)
	}
	second := tokenFromMail(t, mailer.last(t))
	if second == first {
		t.Fatal("resend sent the same token again")
	}

	if used := call(t, s, "POST", "/v1/auth/verify", "", map[string]any{"token": first}); used.status == http.StatusOK {
		t.Fatal("the superseded link still works")
	}
	if used := call(t, s, "POST", "/v1/auth/verify", "", map[string]any{"token": second}); used.status != http.StatusOK {
		t.Fatalf("the new link does not work: status %d", used.status)
	}
}

func TestResendTellsStrangersNothing(t *testing.T) {
	s, mailer := newMailServer(t)
	register(t, s, "benoit", "correct horse battery")
	sentAfterRegister := mailer.count()

	// No such account, and the wrong password for one that exists. Both answer
	// exactly as a success does, and neither sends anything.
	for _, body := range []map[string]any{
		{"email": "nobody@example.test", "password": "correct horse battery"},
		{"email": testEmail("benoit"), "password": "not the password"},
	} {
		res := call(t, s, "POST", "/v1/auth/verify/resend", "", body)
		if res.status != http.StatusAccepted || res.body["sent"] != true {
			t.Errorf("%v: status %d body %v, want 202 sent:true", body, res.status, res.body)
		}
	}
	if mailer.count() != sentAfterRegister {
		t.Fatalf("mail was sent for a request that should have sent none")
	}
}

func TestResendSaysWhenTheAddressIsAlreadyConfirmed(t *testing.T) {
	s, mailer := newMailServer(t)
	register(t, s, "benoit", "correct horse battery")
	call(t, s, "POST", "/v1/auth/verify", "", map[string]any{"token": tokenFromMail(t, mailer.last(t))})

	res := call(t, s, "POST", "/v1/auth/verify/resend", "", map[string]any{
		"email": testEmail("benoit"), "password": "correct horse battery",
	})
	if res.status != http.StatusOK || res.body["alreadyVerified"] != true {
		t.Fatalf("status %d body %v, want 200 alreadyVerified:true", res.status, res.body)
	}
}

var errSendFailed = errors.New("the mail server said no")

func TestRegistrationRollsBackWhenTheMessageCannotBeSent(t *testing.T) {
	s, mailer := newMailServer(t)
	mailer.err = errSendFailed

	res := call(t, s, "POST", "/v1/auth/register", "", map[string]any{
		"handle": "benoit", "email": testEmail("benoit"),
		"password": "correct horse battery", "deviceName": "test device",
	})
	if res.status != http.StatusInternalServerError {
		t.Fatalf("register: status %d, want 500 when the message cannot go out", res.status)
	}

	// The address has to be free again, or a transient mail failure would take
	// somebody's address away from them permanently.
	mailer.err = nil
	register(t, s, "benoit", "correct horse battery")
}

func TestUnverifiedAccountsAreSweptAndOthersAreNot(t *testing.T) {
	s, mailer := newMailServer(t)
	ctx := context.Background()

	register(t, s, "stale", "correct horse battery")
	register(t, s, "fresh", "correct horse battery")
	register(t, s, "confirmed", "correct horse battery")

	// The third one confirms. Its mail is the last of the three.
	call(t, s, "POST", "/v1/auth/verify", "", map[string]any{"token": tokenFromMail(t, mailer.last(t))})

	// Age the first past the grace period.
	stale, err := s.store.AccountByHandle(ctx, "stale")
	if err != nil {
		t.Fatalf("account: %v", err)
	}
	if _, err := s.store.db.ExecContext(ctx,
		`UPDATE account SET created_at = ? WHERE id = ?`,
		time.Now().UTC().Add(-unverifiedLifetime-time.Hour).UnixMilli(), stale.ID); err != nil {
		t.Fatalf("age the account: %v", err)
	}

	s.sweepUnverified(ctx)

	if _, err := s.store.AccountByHandle(ctx, "stale"); err == nil {
		t.Error("an account nobody confirmed in over a week is still here")
	}
	if _, err := s.store.AccountByHandle(ctx, "fresh"); err != nil {
		t.Error("an account registered a moment ago was swept away")
	}
	if _, err := s.store.AccountByHandle(ctx, "confirmed"); err != nil {
		t.Error("a confirmed account was swept away")
	}
}

func TestAnInstanceWithoutMailConfirmsNothing(t *testing.T) {
	// The self-hosted case, and the reason the feature is opt-in: a server with
	// no MTA must not create accounts nobody can ever enable.
	s := newTestServer(t)
	created := register(t, s, "benoit", "correct horse battery")
	if created.body["emailVerified"] != true {
		t.Fatalf("without a mailer an account should be usable at once: %v", created.body)
	}
	res := call(t, s, "GET", "/v1/auth/devices", created.str("token"), nil)
	if res.status != http.StatusOK {
		t.Fatalf("devices: status %d, want 200", res.status)
	}
}

func TestMailerRefusesToLeaveTheMachine(t *testing.T) {
	// Unauthenticated plaintext SMTP is only safe over the loopback, so the
	// constructor is where that is enforced rather than trusting a flag.
	if _, err := NewSMTPMailer("mail.example.com:25", "Thwart <no-reply@thwart.app>", nil); err == nil {
		t.Fatal("a remote SMTP host was accepted")
	}
	if _, err := NewSMTPMailer("127.0.0.1:25", "not an address", nil); err == nil {
		t.Fatal("a From with no address in it was accepted")
	}
	if _, err := NewSMTPMailer("127.0.0.1:25", "Thwart <no-reply@thwart.app>", nil); err != nil {
		t.Fatalf("a loopback mailer was refused: %v", err)
	}
}
