package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"
)

/*
Confirming that the address on an account belongs to the person who typed it.

The rule is the one the operator asked for: **an account is disabled until its
address is confirmed.** It can be created, and the recovery code is shown once
at that moment because that is the only moment it exists — but nothing else
works. No sync, no export, no device list, and a sign-in is refused with a code
that says why rather than pretending the password was wrong.

Three reasons it matters, and only the first is about the user:

  - Somebody who mistypes their address would otherwise have an account they can
    never recover, because recovery by address is the whole point of holding one.
  - An address nobody confirmed is an address somebody else owns. Registering
    with it puts a stranger's mailbox in this database.
  - It is the only thing standing between an open registration endpoint and a
    database of made-up accounts.

**Verification is off when the instance has no mailer.** A self-hosted server
with no SMTP would otherwise create accounts nobody could ever enable, and the
recovery code already covers that case. See `-mail-from` in main.go.
*/

// How long a link lives.
//
// A week rather than an hour: this is not a password reset racing an attacker,
// it is somebody who may register on a phone and open their mail on a laptop
// next weekend. The link is single-use, which is the property that matters.
const verifyWindow = 7 * 24 * time.Hour

// How long an unconfirmed account is kept before it is swept away.
//
// The same week, plus a day of slack so that a link expiring and the account
// vanishing are not the same instant for somebody clicking a stale link. After
// that the row is deleted outright: an address nobody confirmed is an address
// this server has no business holding, and keeping it would be exactly the kind
// of quiet accumulation the rest of this project avoids.
const unverifiedLifetime = verifyWindow + 24*time.Hour

const verifyPrefix = "tw_verify_"

// newVerifyToken returns the token for the link, and the hash to store.
//
// 256 bits from the CSPRNG, hashed with SHA-256 rather than Argon2 for the same
// reason a device token is: there is nothing to guess, so a slow hash would only
// slow the server down.
func newVerifyToken() (token, hash string, err error) {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return "", "", fmt.Errorf("read verify token: %w", err)
	}
	token = verifyPrefix + base64.RawURLEncoding.EncodeToString(raw)
	return token, hashToken(token), nil
}

func (s *Server) verifyLink(token string) string {
	return strings.TrimSuffix(s.SiteURL, "/") + "/verify?token=" + url.QueryEscape(token)
}

/*
Issues a link and sends it.

Errors are returned rather than swallowed at registration time, because an
account whose confirmation never went out is an account nobody can enable, and
the honest thing is to say so while the person is still looking at the form.
*/
func (s *Server) sendVerification(ctx context.Context, account Account) error {
	if s.mailer == nil {
		return nil
	}
	token, hash, err := newVerifyToken()
	if err != nil {
		return err
	}
	now := time.Now().UTC()
	if err := s.store.SetVerification(ctx, account.ID, hash, now); err != nil {
		return fmt.Errorf("store verification: %w", err)
	}
	subject, body := verificationEmail(account.Handle, s.verifyLink(token), verifyWindow)
	return s.mailer.Send(ctx, account.Email, subject, body)
}

// --- handlers ----------------------------------------------------------------

type verifyRequest struct {
	Token string `json:"token"`
}

/*
Confirms an address from the link.

Unauthenticated on purpose: the link arrives in a mailbox, is opened in whatever
browser happens to be there, and requiring a signed-in session to use it would
mean the confirmation only works on the device that registered — which is the
one case where it is least needed.

Rate-limited by IP, because an unauthenticated endpoint that looks rows up by a
secret is exactly the shape somebody would try to grind. Sixty-four random bytes
makes that hopeless anyway; the limiter is there so it is not even cheap.
*/
func (s *Server) handleVerify(w http.ResponseWriter, r *http.Request) {
	var body verifyRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	if !s.limiter.allow("verify:"+clientIP(r), verifyPerIP) {
		writeError(w, r, apiError{status: http.StatusTooManyRequests, code: "rate_limited"})
		return
	}

	token := strings.TrimSpace(body.Token)
	if token == "" {
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "invalid_verification"})
		return
	}

	account, err := s.store.AccountByVerifyHash(r.Context(), hashToken(token))
	if err != nil {
		if !errors.Is(err, ErrNotFound) {
			s.fail(w, r, "resolve verification", err)
			return
		}
		// Not found covers three cases that must not be told apart: never
		// existed, already used, or the account is gone. Saying which would
		// turn this into a way to ask whether an address is registered.
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "invalid_verification"})
		return
	}

	if time.Since(account.VerifyIssuedAt) > verifyWindow {
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "verification_expired"})
		return
	}

	if err := s.store.MarkEmailVerified(r.Context(), account.ID, time.Now().UTC()); err != nil {
		s.fail(w, r, "mark verified", err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"handle": account.Handle,
		"email":  account.Email,
	})
}

type resendRequest struct {
	Handle   string `json:"handle"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

/*
Sends the link again.

Behind the password rather than behind the address alone: an endpoint that mails
anybody on request is a way to use this server to send mail to strangers, and
the address is the only thing an attacker would need to know.

The answer is the same whatever happens — no such account, wrong password, or
sent — so this cannot be used to find out which addresses are registered. The
one exception is an account that is already confirmed, which says so, because
somebody clicking Resend on a working account deserves to know it already works
rather than to wait for a message that will never come.
*/
func (s *Server) handleResendVerification(w http.ResponseWriter, r *http.Request) {
	var body resendRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	if !s.limiter.allow("resend:"+clientIP(r), resendPerIP) {
		writeError(w, r, apiError{status: http.StatusTooManyRequests, code: "rate_limited"})
		return
	}

	identifier := strings.ToLower(strings.TrimSpace(body.Email))
	if identifier == "" {
		identifier = strings.TrimSpace(body.Handle)
	}

	account, err := s.store.AccountByIdentifier(r.Context(), identifier)
	switch {
	case errors.Is(err, ErrNotFound):
		writeJSON(w, http.StatusAccepted, map[string]any{"sent": true})
		return
	case err != nil:
		s.fail(w, r, "resolve account", err)
		return
	}

	ok, err := verifySecret(body.Password, account.PasswordHash)
	if err != nil || !ok {
		writeJSON(w, http.StatusAccepted, map[string]any{"sent": true})
		return
	}

	if account.EmailVerified() {
		writeJSON(w, http.StatusOK, map[string]any{"sent": false, "alreadyVerified": true})
		return
	}

	if err := s.sendVerification(r.Context(), account); err != nil {
		s.fail(w, r, "send verification", err)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]any{"sent": true})
}

/*
Deletes accounts that were never confirmed.

Run on a timer by the server itself rather than by a cron job on the host,
because it is part of what the server promises in the message it sent: "an
account that is never confirmed is deleted". A promise kept by a file somebody
has to remember to install is not kept.

Only ever touches rows that have an address and no confirmation, so an account
from before verification existed — every one of which was marked confirmed by
the migration — cannot be caught by it.
*/
func (s *Server) sweepUnverified(ctx context.Context) {
	if s.mailer == nil {
		return
	}
	cutoff := time.Now().UTC().Add(-unverifiedLifetime)
	removed, err := s.store.DeleteUnverifiedAccountsBefore(ctx, cutoff)
	if err != nil {
		s.log.Error("sweep unverified", "error", err)
		return
	}
	if removed > 0 {
		s.log.Info("swept unverified accounts", "count", removed)
	}
}
