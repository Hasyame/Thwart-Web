package main

import (
	"net/http"
	"strings"
	"testing"
)

func newAlphaServer(t *testing.T) (*Server, *fakeMailer) {
	t.Helper()
	s, mailer := newMailServer(t)
	s.UseAlphaSignup("owner@thwart.test")
	return s, mailer
}

func TestAlphaSignupSendsNameAndAddressToTheOwner(t *testing.T) {
	s, mailer := newAlphaServer(t)

	res := call(t, s, "POST", "/v1/alpha/android", "", map[string]any{
		"name": "  Peter Parker ", "email": "peter@example.com", "website": "",
	})
	if res.status != http.StatusAccepted {
		t.Fatalf("status %d, want 202: %v", res.status, res.body)
	}
	mail := mailer.last(t)
	if mail.to != "owner@thwart.test" {
		t.Errorf("sent to %q, want the owner's mailbox", mail.to)
	}
	if !strings.Contains(mail.body, "Name: Peter Parker\n") || !strings.Contains(mail.body, "Email: peter@example.com\n") {
		t.Errorf("the message should carry the trimmed name and the address:\n%s", mail.body)
	}
	if strings.Contains(mail.subject, "Peter") {
		t.Errorf("nothing a visitor typed belongs in a header: %q", mail.subject)
	}
}

func TestAlphaSignupClosedWithoutAMailbox(t *testing.T) {
	s, mailer := newMailServer(t)
	res := call(t, s, "POST", "/v1/alpha/android", "", map[string]any{"name": "Peter", "email": "peter@example.com"})
	if res.status != http.StatusServiceUnavailable || res.code() != "alpha_closed" {
		t.Fatalf("status %d code %q, want 503 alpha_closed", res.status, res.code())
	}
	if mailer.count() != 0 {
		t.Fatal("a closed form must send nothing")
	}
}

func TestAlphaSignupRefusesBadInput(t *testing.T) {
	s, mailer := newAlphaServer(t)
	for _, c := range []struct {
		body map[string]any
		code string
	}{
		{map[string]any{"name": "", "email": "peter@example.com"}, "invalid_name"},
		{map[string]any{"name": "Peter\r\nBcc: x@example.com", "email": "peter@example.com"}, "invalid_name"},
		{map[string]any{"name": strings.Repeat("a", 81), "email": "peter@example.com"}, "invalid_name"},
		{map[string]any{"name": "Peter", "email": "not an address"}, "invalid_email"},
		{map[string]any{"name": "Peter", "email": "peter@example.com", "phone": "1"}, "malformed_record"},
	} {
		res := call(t, s, "POST", "/v1/alpha/android", "", c.body)
		if res.status != http.StatusBadRequest || res.code() != c.code {
			t.Errorf("%v: status %d code %q, want 400 %s", c.body, res.status, res.code(), c.code)
		}
	}
	if mailer.count() != 0 {
		t.Fatalf("refused requests sent %d messages", mailer.count())
	}
}

func TestAlphaSignupHoneypotSendsNothing(t *testing.T) {
	s, mailer := newAlphaServer(t)
	res := call(t, s, "POST", "/v1/alpha/android", "", map[string]any{
		"name": "Bot", "email": "bot@example.com", "website": "https://spam.example",
	})
	if res.status != http.StatusAccepted {
		t.Fatalf("a bot should be told it worked, got %d", res.status)
	}
	if mailer.count() != 0 {
		t.Fatal("the honeypot must not send")
	}
}

func TestAlphaSignupIsRateLimitedPerAddress(t *testing.T) {
	s, mailer := newAlphaServer(t)
	for i := 0; i < alphaPerIP.limit; i++ {
		res := call(t, s, "POST", "/v1/alpha/android", "", map[string]any{"name": "Peter", "email": "peter@example.com"})
		if res.status != http.StatusAccepted {
			t.Fatalf("attempt %d: status %d", i+1, res.status)
		}
	}
	res := call(t, s, "POST", "/v1/alpha/android", "", map[string]any{"name": "Peter", "email": "peter@example.com"})
	if res.status != http.StatusTooManyRequests {
		t.Fatalf("status %d, want 429 after %d sign-ups", res.status, alphaPerIP.limit)
	}
	if mailer.count() != alphaPerIP.limit {
		t.Fatalf("sent %d, want %d", mailer.count(), alphaPerIP.limit)
	}
}
