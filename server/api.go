package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"github.com/google/uuid"
)

/*
The HTTP surface, account half.

Doc 02 §1 lists eleven endpoints. The account half is here; the sync half is in
sync.go. Everything below holds to three rules:

  - The `code` is the contract. Clients switch on it, never on the message.
  - Nothing distinguishes "no such handle" from "wrong password", in the body
    or in the time taken.
  - A password change or a recovery signs the other devices out. If somebody
    else knew the old secret, the point of changing it is that they stop having
    access, and a live token they already hold would defeat that entirely.
*/

const (
	// Protocol version, not build version. A client checks this to know whether
	// it is talking to a server that predates something it needs.
	protocolVersion = 1

	// Nothing this API accepts is large. A cap here means a hostile body is
	// refused before it is read rather than after it is buffered.
	maxRequestBytes = 16 * 1024
)

type Server struct {
	store   *Store
	limiter *limiter
	/*
		How many password hashes may run at once.

		Every Argon2 computation in a request path goes through this. Without it
		the rate limits cap attempts per window while leaving concurrency
		unbounded, and 64 MiB apiece turns a handful of simultaneous logins into
		an out-of-memory kill. See hashSlots.
	*/
	hashes hashLimiter
	log    *slog.Logger
	build  string

	// A hash to verify against when the handle does not exist.
	//
	// Without it, a login for an unknown handle returns in microseconds while a
	// login for a known one spends 64 MiB of Argon2, and the difference is a
	// handle oracle anyone can read with a stopwatch.
	decoyHash string

	/*
		Whether this instance accepts new accounts.

		Refused here rather than hidden in the interface: the form is one curl
		away, so a client that stops offering registration has changed nothing
		about who can register. Recovery stays open whatever this says — it
		resets an account that already exists rather than creating one, and it
		is the way back in for somebody who has lost a password.
	*/
	OpenRegistration bool

	/*
		How confirmation mail is sent, and where the link points.

		Nil means this instance has no mail, and then addresses are not
		confirmed at all: an account is created ready to use. That is not a
		loophole, it is the self-hosted case — a server with no SMTP that
		demanded a confirmation would create accounts nobody could ever enable.
	*/
	mailer  Mailer
	SiteURL string

	/*
		Who is listening for changes, per account.

		A stream is an optimisation over the pull endpoint and never a source of
		truth: it carries a revision number, and a client that misses one is
		late rather than wrong. See stream.go.
	*/
	streams *broadcaster
}

// UseMailer turns address confirmation on, with the link pointing at siteURL.
func (s *Server) UseMailer(m Mailer, siteURL string) {
	s.mailer = m
	s.SiteURL = siteURL
}

func NewServer(store *Store, log *slog.Logger, build string) (*Server, error) {
	// Hashing a value nobody knows: the result is never matched, only timed.
	decoy, err := hashSecret(uuid.NewString())
	if err != nil {
		return nil, err
	}
	return &Server{
		store:            store,
		limiter:          newLimiter(),
		hashes:           newHashGate(hashSlots),
		log:              log,
		build:            build,
		decoyHash:        decoy,
		streams:          newBroadcaster(),
		OpenRegistration: true,
		SiteURL:          "https://thwart.app",
	}, nil
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("POST /v1/auth/register", s.handleRegister)
	mux.HandleFunc("POST /v1/auth/login", s.handleLogin)
	mux.HandleFunc("POST /v1/auth/recover", s.handleRecover)
	mux.HandleFunc("POST /v1/auth/password", s.authenticated(s.handlePassword))
	// Both unauthenticated: the link is opened in whatever browser the mailbox
	// happens to be in, which is rarely the one that registered.
	mux.HandleFunc("POST /v1/auth/verify", s.handleVerify)
	mux.HandleFunc("POST /v1/auth/verify/resend", s.handleResendVerification)
	mux.HandleFunc("GET /v1/auth/devices", s.authenticated(s.handleListDevices))
	mux.HandleFunc("DELETE /v1/auth/devices/{id}", s.authenticated(s.handleDeleteDevice))
	mux.HandleFunc("GET /v1/sync/changes", s.authenticated(s.handlePull))
	mux.HandleFunc("POST /v1/sync/changes", s.authenticated(s.handlePush))
	// Long-lived. Authenticated by the same middleware as everything else, so
	// there is no second authorisation path to keep in step.
	mux.HandleFunc("GET /v1/sync/stream", s.authenticatedStream(s.handleStream))
	mux.HandleFunc("GET /v1/account/export", s.authenticated(s.handleExport))
	mux.HandleFunc("DELETE /v1/account", s.authenticated(s.handleDeleteAccount))
	mux.HandleFunc("GET /v1/health", s.handleHealth)
	mux.HandleFunc("GET /v1/version", s.handleVersion)

	// Anything else is a 404 in the same envelope as every other error, so a
	// client never has to parse nginx's HTML to find out what happened.
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		writeError(w, r, apiError{status: http.StatusNotFound, code: "not_found"})
	})

	return s.recoverPanic(mux)
}

// --- session -----------------------------------------------------------------

type session struct {
	device  Device
	account Account
}

type authedHandler func(http.ResponseWriter, *http.Request, session)

func (s *Server) authenticated(next authedHandler) http.HandlerFunc {
	return s.authenticatedBy(bearerToken, next)
}

/*
The same, for the one endpoint that cannot send a header.

`EventSource` has no way to set `Authorization` — the API simply does not offer
it — so the stream reads its token from the query string instead. This is a
deliberate exception and it is confined to one route rather than widened into
the general middleware, so nothing else can pick the habit up.

**The reason this is acceptable, and the condition on it.** The token travels
over TLS to the same origin, `EventSource` creates no history entry, the
service worker refuses to touch /api/, and this server logs paths without query
strings. The one place it would otherwise be written down is nginx's access log,
which records the full request line — so deploy/nginx-thwart.app.conf turns
logging off for this location. Without that directive this is a credential in a
plaintext file, which is precisely what the `tw_live_` prefix exists to make
greppable.

A single-use ticket endpoint would avoid the question entirely. It was not built
because it adds issuing, expiry and consumption — three more things to get wrong
— to protect a token that is already confined to one origin and one log line
that is switched off.
*/
func (s *Server) authenticatedStream(next authedHandler) http.HandlerFunc {
	return s.authenticatedBy(func(r *http.Request) (string, bool) {
		if token, ok := bearerToken(r); ok {
			return token, true
		}
		token := r.URL.Query().Get("token")
		return token, token != ""
	}, next)
}

func (s *Server) authenticatedBy(
	tokenOf func(*http.Request) (string, bool),
	next authedHandler,
) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, ok := tokenOf(r)
		if !ok {
			writeError(w, r, apiError{status: http.StatusUnauthorized, code: "unauthorized"})
			return
		}

		device, err := s.store.DeviceByTokenHash(r.Context(), hashToken(token))
		if err != nil {
			// Including the not-found case: a token that resolves to nothing is
			// simply not authenticated, and saying more would confirm which
			// tokens once existed.
			if !errors.Is(err, ErrNotFound) {
				s.log.Error("resolve device", "error", err)
			}
			writeError(w, r, apiError{status: http.StatusUnauthorized, code: "unauthorized"})
			return
		}

		account, err := s.store.AccountByID(r.Context(), device.AccountID)
		if err != nil {
			s.log.Error("resolve account", "error", err, "device", device.ID)
			writeError(w, r, apiError{status: http.StatusUnauthorized, code: "unauthorized"})
			return
		}

		/*
			The gate.

			One place, so that a handler added later is disabled-by-default
			rather than exempt-by-accident. Everything behind a device token is
			part of "the account works", and none of it should before the
			address is confirmed.

			Password change is deliberately behind it too: an unconfirmed
			account has nothing to protect, and letting it be edited would make
			an address somebody else owns slightly more useful to hold.
		*/
		if !account.EmailVerified() {
			writeError(w, r, apiError{status: http.StatusForbidden, code: "email_not_verified"})
			return
		}

		next(w, r, session{device: device, account: account})
	}
}

/*
Argon2, one caller at a time up to hashSlots.

Wrapped rather than called directly so that no future handler can hash without
passing through the gate: the plain functions in auth.go are still there for
tests and for startup, but every request path goes through these two.

A refusal here is 503, not 429. The caller did nothing wrong — the machine is
saturated — and telling them to slow down would be a lie about whose fault it
is.
*/
func (s *Server) hash(ctx context.Context, secret string) (string, error) {
	if err := s.hashes.enter(ctx); err != nil {
		return "", err
	}
	defer s.hashes.leave()
	return hashSecret(secret)
}

func (s *Server) verify(ctx context.Context, secret, encoded string) (bool, error) {
	if err := s.hashes.enter(ctx); err != nil {
		return false, err
	}
	defer s.hashes.leave()
	return verifySecret(secret, encoded)
}

// busy reports a saturated machine, and is the one error path that is not the
// caller's doing.
func (s *Server) busy(w http.ResponseWriter, r *http.Request, err error) bool {
	if !errors.Is(err, errBusy) {
		return false
	}
	s.log.Warn("hash gate full", "path", r.URL.Path)
	w.Header().Set("Retry-After", "5")
	writeError(w, r, apiError{status: http.StatusServiceUnavailable, code: "server_busy"})
	return true
}

func bearerToken(r *http.Request) (string, bool) {
	header := r.Header.Get("Authorization")
	const prefix = "Bearer "
	if len(header) <= len(prefix) || !strings.EqualFold(header[:len(prefix)], prefix) {
		return "", false
	}
	return strings.TrimSpace(header[len(prefix):]), true
}

// --- handlers ----------------------------------------------------------------

type registerRequest struct {
	Handle     string `json:"handle"`
	Email      string `json:"email"`
	Password   string `json:"password"`
	DeviceName string `json:"deviceName"`
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	// Before anything is read or hashed. A closed instance should cost a
	// would-be registrant nothing and this server rather less.
	if !s.OpenRegistration {
		writeError(w, r, apiError{status: http.StatusForbidden, code: "registration_closed"})
		return
	}

	var body registerRequest
	if !decodeJSON(w, r, &body) {
		return
	}

	handle := strings.TrimSpace(body.Handle)
	if !validHandle(handle) {
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "invalid_handle"})
		return
	}
	// Lower-cased on the way in, because an address is not two addresses
	// depending on how somebody held the shift key. The unique index is
	// case-insensitive too, so the two cannot disagree.
	email := strings.ToLower(strings.TrimSpace(body.Email))
	if !validEmail(email) {
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "invalid_email"})
		return
	}
	if !validPassword(body.Password, handle, email) {
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "weak_password"})
		return
	}

	// Counted after validation, not before. A form the user has fumbled is not
	// an attempt at anything, and burning one of five hourly registrations on a
	// typo would lock somebody out of their own signup.
	if !s.limiter.allow("register:"+clientIP(r), registerPerIP) {
		writeError(w, r, apiError{status: http.StatusTooManyRequests, code: "rate_limited"})
		return
	}

	passwordHash, err := s.hash(r.Context(), body.Password)
	if err != nil {
		if s.busy(w, r, err) {
			return
		}
		s.fail(w, r, "hash password", err)
		return
	}
	recoveryCode, err := newRecoveryCode()
	if err != nil {
		s.fail(w, r, "make recovery code", err)
		return
	}
	recoveryHash, err := s.hash(r.Context(), normaliseRecoveryCode(recoveryCode))
	if err != nil {
		if s.busy(w, r, err) {
			return
		}
		s.fail(w, r, "hash recovery code", err)
		return
	}

	now := time.Now().UTC()
	account := Account{
		ID:               uuid.NewString(),
		Handle:           handle,
		Email:            email,
		PasswordHash:     passwordHash,
		RecoveryHash:     recoveryHash,
		RecoveryIssuedAt: now,
		CreatedAt:        now,
	}
	// An instance with no mail cannot ask anybody to confirm anything, so its
	// accounts are born confirmed. Everywhere else this stays zero and the
	// account is disabled until the link is opened.
	if s.mailer == nil {
		account.EmailVerifiedAt = now
	}
	if err := s.store.CreateAccount(r.Context(), account); err != nil {
		if errors.Is(err, ErrHandleTaken) {
			writeError(w, r, apiError{status: http.StatusConflict, code: "handle_taken"})
			return
		}
		if errors.Is(err, ErrEmailTaken) {
			writeError(w, r, apiError{status: http.StatusConflict, code: "email_taken"})
			return
		}
		s.fail(w, r, "create account", err)
		return
	}

	/*
		Sent before the token is issued, and a failure is fatal to the request.

		If the message did not go out, nobody can enable this account, and the
		honest moment to say so is while the person is still looking at the
		form rather than a week later. The row is removed again so the address
		is not taken by an account that never worked.
	*/
	if err := s.sendVerification(r.Context(), account); err != nil {
		if delErr := s.store.DeleteAccount(r.Context(), account.ID); delErr != nil {
			s.log.Error("roll back unsent registration", "error", delErr, "account", account.ID)
		}
		s.fail(w, r, "send verification", err)
		return
	}

	/*
		A device token is still issued, and still returned.

		The account cannot use it yet — `authenticated` refuses every request
		until the address is confirmed — but the shape of this response is the
		contract the Android app was built against, and quietly dropping a field
		from it would break a released app to make a point. The client learns
		the state from `emailVerified` and the `email_not_verified` code.
	*/
	token, err := s.issueDevice(r.Context(), account.ID, body.DeviceName)
	if err != nil {
		s.fail(w, r, "issue device", err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"accountId":     account.ID,
		"handle":        account.Handle,
		"email":         account.Email,
		"token":         token,
		"emailVerified": account.EmailVerified(),
		// Shown exactly once. Doc 02 §1: the client must insist the user saves
		// it, and offer it as a text file, because that is the part that makes
		// recovery work without SMTP.
		"recoveryCode":         recoveryCode,
		"recoveryCodeIssuedAt": now.Format(time.RFC3339),
	})
}

type loginRequest struct {
	Handle     string `json:"handle"`
	Email      string `json:"email"`
	Password   string `json:"password"`
	DeviceName string `json:"deviceName"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body loginRequest
	if !decodeJSON(w, r, &body) {
		return
	}

	// Signing in is by address. The pseudonym is still accepted, because a
	// client that has not been updated sends it and because the first account
	// on this instance was made before addresses existed.
	identifier := strings.TrimSpace(body.Email)
	if identifier == "" {
		identifier = strings.TrimSpace(body.Handle)
	}
	ip := clientIP(r)
	handleKey := "login:handle:" + strings.ToLower(identifier)
	dayKey := "login:handle:day:" + strings.ToLower(identifier)
	/*
		Two tiers, and every one of them is consulted.

		Written as four separate calls rather than short-circuited with `||`,
		because `allow` counts as well as reports: a short-circuit would leave
		the daily counter untouched whenever the quarter-hour one refused, and
		an attacker pacing themselves at the burst limit would never register on
		the daily one at all. Counting all four costs nothing and cannot be got
		subtly wrong later.
	*/
	burstIP := s.limiter.allow("login:ip:"+ip, loginPerIP)
	dayIP := s.limiter.allow("login:ip:day:"+ip, loginPerIPDay)
	burstHandle := s.limiter.allow(handleKey, loginPerHandle)
	dayHandle := s.limiter.allow(dayKey, loginPerHandleDay)
	if !burstIP || !dayIP || !burstHandle || !dayHandle {
		writeError(w, r, apiError{status: http.StatusTooManyRequests, code: "rate_limited"})
		return
	}

	account, err := s.store.AccountByIdentifier(r.Context(), identifier)
	if err != nil && !errors.Is(err, ErrNotFound) {
		s.fail(w, r, "look up account", err)
		return
	}

	// The unknown-handle path verifies against the decoy so that it costs the
	// same as the known-handle path.
	hash := s.decoyHash
	if err == nil {
		hash = account.PasswordHash
	}
	ok, verifyErr := s.verify(r.Context(), body.Password, hash)
	if verifyErr != nil {
		if s.busy(w, r, verifyErr) {
			return
		}
		s.fail(w, r, "verify password", verifyErr)
		return
	}
	if !ok || err != nil {
		writeError(w, r, apiError{status: http.StatusUnauthorized, code: "invalid_credentials"})
		return
	}

	// Both tiers, so a morning of fumbling does not follow somebody around for
	// the rest of the day once they get it right.
	s.limiter.forget(handleKey)
	s.limiter.forget(dayKey)

	/*
		The password was right, and the account still cannot be used.

		Said plainly rather than folded into `invalid_credentials`: somebody
		who typed their password correctly and is told it is wrong will change
		it, and then be told that is wrong too. The address is already known to
		whoever holds this password, so naming the reason gives away nothing.
	*/
	if !account.EmailVerified() {
		writeError(w, r, apiError{status: http.StatusForbidden, code: "email_not_verified"})
		return
	}

	token, err := s.issueDevice(r.Context(), account.ID, body.DeviceName)
	if err != nil {
		s.fail(w, r, "issue device", err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"accountId":            account.ID,
		"handle":               account.Handle,
		"email":                account.Email,
		"token":                token,
		"emailVerified":        true,
		"recoveryCodeIssuedAt": account.RecoveryIssuedAt.Format(time.RFC3339),
	})
}

type recoverRequest struct {
	Handle       string `json:"handle"`
	Email        string `json:"email"`
	RecoveryCode string `json:"recoveryCode"`
	NewPassword  string `json:"newPassword"`
	DeviceName   string `json:"deviceName"`
}

/*
Recovery.

Spends the code and issues a new one, because a code that still works after it
has been used is a password that never expires. Every other device is signed
out: whoever prompted the recovery is exactly who should lose access.
*/
func (s *Server) handleRecover(w http.ResponseWriter, r *http.Request) {
	var body recoverRequest
	if !decodeJSON(w, r, &body) {
		return
	}

	identifier := strings.TrimSpace(body.Email)
	if identifier == "" {
		identifier = strings.TrimSpace(body.Handle)
	}
	// Same order as registration: a rejected new password is a form error, and
	// spending one of five hourly attempts on it would leave somebody locked
	// out of a recovery they hold the correct code for.
	//
	// Both submitted names are checked against the password, not just the one
	// being looked up by, so that neither can be reused as it.
	if !validPassword(body.NewPassword, strings.TrimSpace(body.Handle), strings.TrimSpace(body.Email)) {
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "weak_password"})
		return
	}

	handleKey := "recover:handle:" + strings.ToLower(identifier)
	// Counted, not short-circuited: see the note in handleLogin for why every
	// tier has to be consulted even when an earlier one has already refused.
	recIP := s.limiter.allow("recover:ip:"+clientIP(r), recoverIP)
	recBurst := s.limiter.allow(handleKey, recoverHandle)
	recDay := s.limiter.allow("recover:handle:day:"+strings.ToLower(identifier), recoverHandleDay)
	if !recIP || !recBurst || !recDay {
		writeError(w, r, apiError{status: http.StatusTooManyRequests, code: "rate_limited"})
		return
	}

	account, err := s.store.AccountByIdentifier(r.Context(), identifier)
	if err != nil && !errors.Is(err, ErrNotFound) {
		s.fail(w, r, "look up account", err)
		return
	}

	hash := s.decoyHash
	if err == nil {
		hash = account.RecoveryHash
	}
	ok, verifyErr := s.verify(r.Context(), normaliseRecoveryCode(body.RecoveryCode), hash)
	if verifyErr != nil {
		s.fail(w, r, "verify recovery code", verifyErr)
		return
	}
	if !ok || err != nil {
		writeError(w, r, apiError{status: http.StatusUnauthorized, code: "invalid_recovery_code"})
		return
	}

	passwordHash, err := s.hash(r.Context(), body.NewPassword)
	if err != nil {
		s.fail(w, r, "hash password", err)
		return
	}
	nextCode, err := newRecoveryCode()
	if err != nil {
		s.fail(w, r, "make recovery code", err)
		return
	}
	nextHash, err := s.hash(r.Context(), normaliseRecoveryCode(nextCode))
	if err != nil {
		s.fail(w, r, "hash recovery code", err)
		return
	}

	now := time.Now().UTC()
	if err := s.store.SetPasswordHash(r.Context(), account.ID, passwordHash); err != nil {
		s.fail(w, r, "set password", err)
		return
	}
	if err := s.store.SetRecoveryHash(r.Context(), account.ID, nextHash, now); err != nil {
		s.fail(w, r, "set recovery code", err)
		return
	}

	token, err := s.issueDevice(r.Context(), account.ID, body.DeviceName)
	if err != nil {
		s.fail(w, r, "issue device", err)
		return
	}
	device, err := s.store.DeviceByTokenHash(r.Context(), hashToken(token))
	if err != nil {
		s.fail(w, r, "resolve new device", err)
		return
	}
	if err := s.store.DeleteOtherDevices(r.Context(), account.ID, device.ID); err != nil {
		s.fail(w, r, "sign out other devices", err)
		return
	}

	s.limiter.forget(handleKey)

	writeJSON(w, http.StatusOK, map[string]any{
		"accountId":            account.ID,
		"handle":               account.Handle,
		"email":                account.Email,
		"token":                token,
		"recoveryCode":         nextCode,
		"recoveryCodeIssuedAt": now.Format(time.RFC3339),
	})
}

type passwordRequest struct {
	CurrentPassword string `json:"currentPassword"`
	NewPassword     string `json:"newPassword"`
}

func (s *Server) handlePassword(w http.ResponseWriter, r *http.Request, sess session) {
	var body passwordRequest
	if !decodeJSON(w, r, &body) {
		return
	}

	/*
		Metered, even though this is behind a token.

		A device token was an unmetered supply of Argon2: whoever held one could
		verify passwords here as fast as the machine would go, which is both a
		way to grind the current password and a way to exhaust the memory of a
		box that allows four hashes at a time. Ten an hour is far more than
		anybody changes a password and far less than anybody grinds one.
	*/
	if !s.limiter.allow("password:"+sess.account.ID, passwordPerAccount) {
		writeError(w, r, apiError{status: http.StatusTooManyRequests, code: "rate_limited"})
		return
	}

	ok, err := s.verify(r.Context(), body.CurrentPassword, sess.account.PasswordHash)
	if err != nil {
		if s.busy(w, r, err) {
			return
		}
		s.fail(w, r, "verify password", err)
		return
	}
	if !ok {
		writeError(w, r, apiError{status: http.StatusUnauthorized, code: "invalid_credentials"})
		return
	}
	if !validPassword(body.NewPassword, sess.account.Handle, sess.account.Email) {
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "weak_password"})
		return
	}

	hash, err := s.hash(r.Context(), body.NewPassword)
	if err != nil {
		if s.busy(w, r, err) {
			return
		}
		s.fail(w, r, "hash password", err)
		return
	}
	if err := s.store.SetPasswordHash(r.Context(), sess.account.ID, hash); err != nil {
		s.fail(w, r, "set password", err)
		return
	}
	if err := s.store.DeleteOtherDevices(r.Context(), sess.account.ID, sess.device.ID); err != nil {
		s.fail(w, r, "sign out other devices", err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"signedOutOtherDevices": true})
}

func (s *Server) handleListDevices(w http.ResponseWriter, r *http.Request, sess session) {
	devices, err := s.store.DevicesForAccount(r.Context(), sess.account.ID)
	if err != nil {
		s.fail(w, r, "list devices", err)
		return
	}

	out := make([]map[string]any, 0, len(devices))
	for _, d := range devices {
		out = append(out, map[string]any{
			"id":   d.ID,
			"name": d.Name,
			// So the list can say "this device" rather than making somebody
			// work out which line is the phone they are holding.
			"current":   d.ID == sess.device.ID,
			"createdAt": d.CreatedAt.Format(time.RFC3339),
			"lastSeen":  d.LastSeen.Format(time.RFC3339),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"devices": out})
}

func (s *Server) handleDeleteDevice(w http.ResponseWriter, r *http.Request, sess session) {
	id := r.PathValue("id")
	if err := s.store.DeleteDevice(r.Context(), sess.account.ID, id); err != nil {
		if errors.Is(err, ErrNotFound) {
			writeError(w, r, apiError{status: http.StatusNotFound, code: "not_found"})
			return
		}
		s.fail(w, r, "delete device", err)
		return
	}
	// Revoking your own device is how logout is spelled, so it is allowed and
	// simply ends this session.
	writeJSON(w, http.StatusOK, map[string]any{"revoked": id, "self": id == sess.device.ID})
}

type deleteAccountRequest struct {
	Password string `json:"password"`
}

/*
Erasure, and why it asks for the password.

Doc 02 is emphatic that this is real rather than a flag: an account that cannot
be left is a trap. But it is also the one irreversible thing in the API, and a
device token is a bearer credential that can be stolen. Re-typing the password
costs a legitimate user five seconds and costs a thief the whole attack.

It does not make erasure conditional. Somebody who has forgotten their password
recovers first, then deletes.
*/
func (s *Server) handleDeleteAccount(w http.ResponseWriter, r *http.Request, sess session) {
	var body deleteAccountRequest
	if !decodeJSON(w, r, &body) {
		return
	}

	// Shares the password budget with the change endpoint, because they verify
	// the same secret and an attacker would otherwise simply alternate.
	if !s.limiter.allow("password:"+sess.account.ID, passwordPerAccount) {
		writeError(w, r, apiError{status: http.StatusTooManyRequests, code: "rate_limited"})
		return
	}

	ok, err := s.verify(r.Context(), body.Password, sess.account.PasswordHash)
	if err != nil {
		if s.busy(w, r, err) {
			return
		}
		s.fail(w, r, "verify password", err)
		return
	}
	if !ok {
		writeError(w, r, apiError{status: http.StatusUnauthorized, code: "invalid_credentials"})
		return
	}

	if err := s.store.DeleteAccount(r.Context(), sess.account.ID); err != nil {
		s.fail(w, r, "delete account", err)
		return
	}
	s.log.Info("account deleted", "account", sess.account.ID)
	writeJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	if err := s.store.Ping(r.Context()); err != nil {
		s.log.Error("health check failed", "error", err)
		writeError(w, r, apiError{status: http.StatusServiceUnavailable, code: "server_error"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok"})
}

func (s *Server) handleVersion(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"build":    s.build,
		"protocol": protocolVersion,
		// So a client can stop offering a form that would be refused, rather
		// than finding out by submitting one. Not a security boundary — the
		// refusal above is — just honesty about what this instance does.
		"registrationOpen": s.OpenRegistration,
		// Published so a client does not have to guess, and enforced on push
		// so one that guesses wrong is told rather than half-served.
		"limits": map[string]any{
			"batchRecords": maxBatchRecords,
			"batchBytes":   maxBatchBytes,
			"recordBytes":  maxRecordBytes,
			"pageSize":     maxPageSize,
		},
	})
}

// --- helpers -----------------------------------------------------------------

func (s *Server) issueDevice(ctx context.Context, accountID, name string) (string, error) {
	token, hash, err := newDeviceToken()
	if err != nil {
		return "", err
	}
	now := time.Now().UTC()
	device := Device{
		ID:        uuid.NewString(),
		AccountID: accountID,
		Name:      trimTo(strings.TrimSpace(name), 64),
		CreatedAt: now,
		LastSeen:  now,
	}
	if err := s.store.CreateDevice(ctx, device, hash); err != nil {
		return "", err
	}
	return token, nil
}

// fail logs the cause and tells the client nothing about it. An internal error
// message is a description of the server's internals; the log is where that
// belongs.
func (s *Server) fail(w http.ResponseWriter, r *http.Request, what string, err error) {
	s.log.Error(what, "error", err, "path", r.URL.Path)
	writeError(w, r, apiError{status: http.StatusInternalServerError, code: "server_error"})
}

func decodeJSON(w http.ResponseWriter, r *http.Request, into any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxRequestBytes)
	decoder := json.NewDecoder(r.Body)
	// Strict: an unknown field is far more often a client sending the wrong
	// shape than a client being forward-compatible, and silence there turns a
	// typo into a password that was never set.
	decoder.DisallowUnknownFields()

	if err := decoder.Decode(into); err != nil {
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "malformed_record"})
		return false
	}
	// Exactly one document, not a stream.
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "malformed_record"})
		return false
	}
	return true
}

/*
Handle rules.

Three to thirty-two characters of letters, digits, dot, dash or underscore. Not
an email, not validated as one: doc 02 is explicit that a handle is a local
identifier and that the client should offer a generated one, so that creating an
account requires inventing nothing.
*/
func validHandle(handle string) bool {
	if len(handle) < 3 || len(handle) > 32 {
		return false
	}
	for _, r := range handle {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9':
		case r == '.' || r == '-' || r == '_':
		default:
			return false
		}
	}
	return true
}

/*
Password rules.

Length, and nothing else. NIST SP 800-63B stopped recommending composition
rules years ago, on the evidence that they push people towards Password1! and
away from a long passphrase. So: at least ten characters, and not the handle.

The upper bound is not a policy, it is a defence. Argon2id hashes whatever it
is given, and an unbounded password is a way to make the server do unbounded
work for free.
*/
/*
Whether a password is strong enough to be worth the hashing.

Length-led, and deliberately without composition classes. ANSSI and NIST both
moved away from "one uppercase, one digit, one symbol" for the same reason:
people satisfy it with `Motdepasse1!`, which is shorter and more guessable than
four ordinary words. Twelve characters with no other rule admits a passphrase,
which is what somebody can actually remember.

What actually defends this system is elsewhere and already built: Argon2id at
64 MiB per attempt, and a limiter that allows five tries an hour. A rule here
only has to stop the passwords that fall to the first hundred guesses.

Rejected as well: anything that is the pseudonym or the address, or contains
them, because those are the first two things anybody trying would enter.
*/
func validPassword(password, handle, email string) bool {
	trimmed := strings.TrimSpace(password)
	if len([]rune(trimmed)) < minPasswordRunes || len(password) > maxPasswordBytes {
		return false
	}

	lower := strings.ToLower(trimmed)
	for _, own := range []string{handle, emailLocalPart(email), email} {
		own = strings.ToLower(strings.TrimSpace(own))
		if own == "" {
			continue
		}
		if lower == own {
			return false
		}
		// Containment, but only for a token long enough to mean something. A
		// two-letter local part is inside half the passwords ever written, and
		// rejecting those would teach the user nothing except that the form is
		// broken. Short tokens are still caught by the equality test above and
		// by the distinct-rune rule below.
		if len([]rune(own)) >= 4 && strings.Contains(lower, own) {
			return false
		}
	}

	// One repeated character, however many times, is one character.
	if distinctRunes(trimmed) < 5 {
		return false
	}

	for _, common := range weakPasswords {
		if lower == common {
			return false
		}
	}
	return true
}

const (
	// Twelve, counted in runes: a passphrase in French should not be penalised
	// for its accents, which are two bytes each.
	minPasswordRunes = 12
	// A ceiling only so that one request cannot ask for an unbounded amount of
	// Argon2. Nothing legitimate approaches it.
	maxPasswordBytes = 256
)

// The handful that survive a length rule. Not a dictionary — that belongs in a
// list nobody has to maintain by hand — just the ones somebody types when a
// form asks for twelve characters.
var weakPasswords = []string{
	"motdepasse12", "motdepasse123", "password1234", "passwordpassword",
	"123456789012", "azertyuiopqs", "qwertyuiopas", "aaaaaaaaaaaa",
	"motdepasse!1", "administrateur", "thwartthwart",
}

func distinctRunes(s string) int {
	seen := map[rune]struct{}{}
	for _, r := range strings.ToLower(s) {
		seen[r] = struct{}{}
	}
	return len(seen)
}

func emailLocalPart(email string) string {
	at := strings.IndexByte(email, '@')
	if at <= 0 {
		return ""
	}
	return email[:at]
}

/*
Whether an address is worth storing.

Deliberately shallow. The only test that means anything is sending to it, which
this instance cannot yet do, so anything stricter here would reject valid
addresses — the grammar is far wider than the regexes people write for it — in
exchange for nothing. One at-sign with something either side, a dot in the
domain, no spaces, and a sane length.
*/
func validEmail(email string) bool {
	email = strings.TrimSpace(email)
	if len(email) < 6 || len(email) > 254 || len(strings.Fields(email)) != 1 {
		return false
	}
	at := strings.IndexByte(email, '@')
	if at <= 0 || at != strings.LastIndexByte(email, '@') || at == len(email)-1 {
		return false
	}
	domain := email[at+1:]
	dot := strings.IndexByte(domain, '.')
	return dot > 0 && dot < len(domain)-1
}

func trimTo(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// recoverPanic keeps one bad request from taking the process down, and makes
// sure the client still gets the standard envelope rather than a dropped
// connection.
func (s *Server) recoverPanic(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if cause := recover(); cause != nil {
				// With the stack. A cause on its own says what went wrong and
				// not where, which on a server that logs nothing else about a
				// request is the difference between a fix and a guess.
				s.log.Error("panic",
					"cause", cause,
					"path", r.URL.Path,
					"stack", string(debug.Stack()))
				writeError(w, r, apiError{status: http.StatusInternalServerError, code: "server_error"})
			}
		}()
		next.ServeHTTP(w, r)
	})
}
