package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
)

/*
The HTTP surface, account half.

Doc 02 §1 lists eleven endpoints. Seven of them are here; the four sync ones
land when sync does. Everything below holds to three rules:

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
	log     *slog.Logger
	build   string

	// A hash to verify against when the handle does not exist.
	//
	// Without it, a login for an unknown handle returns in microseconds while a
	// login for a known one spends 64 MiB of Argon2, and the difference is a
	// handle oracle anyone can read with a stopwatch.
	decoyHash string
}

func NewServer(store *Store, log *slog.Logger, build string) (*Server, error) {
	// Hashing a value nobody knows: the result is never matched, only timed.
	decoy, err := hashSecret(uuid.NewString())
	if err != nil {
		return nil, err
	}
	return &Server{store: store, limiter: newLimiter(), log: log, build: build, decoyHash: decoy}, nil
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("POST /v1/auth/register", s.handleRegister)
	mux.HandleFunc("POST /v1/auth/login", s.handleLogin)
	mux.HandleFunc("POST /v1/auth/recover", s.handleRecover)
	mux.HandleFunc("POST /v1/auth/password", s.authenticated(s.handlePassword))
	mux.HandleFunc("GET /v1/auth/devices", s.authenticated(s.handleListDevices))
	mux.HandleFunc("DELETE /v1/auth/devices/{id}", s.authenticated(s.handleDeleteDevice))
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
	return func(w http.ResponseWriter, r *http.Request) {
		token, ok := bearerToken(r)
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

		next(w, r, session{device: device, account: account})
	}
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
	Password   string `json:"password"`
	DeviceName string `json:"deviceName"`
}

func (s *Server) handleRegister(w http.ResponseWriter, r *http.Request) {
	var body registerRequest
	if !decodeJSON(w, r, &body) {
		return
	}

	handle := strings.TrimSpace(body.Handle)
	if !validHandle(handle) {
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "invalid_handle"})
		return
	}
	if !validPassword(body.Password, handle) {
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

	passwordHash, err := hashSecret(body.Password)
	if err != nil {
		s.fail(w, r, "hash password", err)
		return
	}
	recoveryCode, err := newRecoveryCode()
	if err != nil {
		s.fail(w, r, "make recovery code", err)
		return
	}
	recoveryHash, err := hashSecret(normaliseRecoveryCode(recoveryCode))
	if err != nil {
		s.fail(w, r, "hash recovery code", err)
		return
	}

	now := time.Now().UTC()
	account := Account{
		ID:               uuid.NewString(),
		Handle:           handle,
		PasswordHash:     passwordHash,
		RecoveryHash:     recoveryHash,
		RecoveryIssuedAt: now,
		CreatedAt:        now,
	}
	if err := s.store.CreateAccount(r.Context(), account); err != nil {
		if errors.Is(err, ErrHandleTaken) {
			writeError(w, r, apiError{status: http.StatusConflict, code: "handle_taken"})
			return
		}
		s.fail(w, r, "create account", err)
		return
	}

	token, err := s.issueDevice(r.Context(), account.ID, body.DeviceName)
	if err != nil {
		s.fail(w, r, "issue device", err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"accountId": account.ID,
		"handle":    account.Handle,
		"token":     token,
		// Shown exactly once. Doc 02 §1: the client must insist the user saves
		// it, and offer it as a text file, because that is the part that makes
		// recovery work without SMTP.
		"recoveryCode":         recoveryCode,
		"recoveryCodeIssuedAt": now.Format(time.RFC3339),
	})
}

type loginRequest struct {
	Handle     string `json:"handle"`
	Password   string `json:"password"`
	DeviceName string `json:"deviceName"`
}

func (s *Server) handleLogin(w http.ResponseWriter, r *http.Request) {
	var body loginRequest
	if !decodeJSON(w, r, &body) {
		return
	}

	handle := strings.TrimSpace(body.Handle)
	ip := clientIP(r)
	handleKey := "login:handle:" + strings.ToLower(handle)
	if !s.limiter.allow("login:ip:"+ip, loginPerIP) || !s.limiter.allow(handleKey, loginPerHandle) {
		writeError(w, r, apiError{status: http.StatusTooManyRequests, code: "rate_limited"})
		return
	}

	account, err := s.store.AccountByHandle(r.Context(), handle)
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
	ok, verifyErr := verifySecret(body.Password, hash)
	if verifyErr != nil {
		s.fail(w, r, "verify password", verifyErr)
		return
	}
	if !ok || err != nil {
		writeError(w, r, apiError{status: http.StatusUnauthorized, code: "invalid_credentials"})
		return
	}

	s.limiter.forget(handleKey)

	token, err := s.issueDevice(r.Context(), account.ID, body.DeviceName)
	if err != nil {
		s.fail(w, r, "issue device", err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"accountId":            account.ID,
		"handle":               account.Handle,
		"token":                token,
		"recoveryCodeIssuedAt": account.RecoveryIssuedAt.Format(time.RFC3339),
	})
}

type recoverRequest struct {
	Handle       string `json:"handle"`
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

	handle := strings.TrimSpace(body.Handle)
	// Same order as registration: a rejected new password is a form error, and
	// spending one of five hourly attempts on it would leave somebody locked
	// out of a recovery they hold the correct code for.
	if !validPassword(body.NewPassword, handle) {
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "weak_password"})
		return
	}

	handleKey := "recover:handle:" + strings.ToLower(handle)
	if !s.limiter.allow("recover:ip:"+clientIP(r), recoverIP) || !s.limiter.allow(handleKey, recoverHandle) {
		writeError(w, r, apiError{status: http.StatusTooManyRequests, code: "rate_limited"})
		return
	}

	account, err := s.store.AccountByHandle(r.Context(), handle)
	if err != nil && !errors.Is(err, ErrNotFound) {
		s.fail(w, r, "look up account", err)
		return
	}

	hash := s.decoyHash
	if err == nil {
		hash = account.RecoveryHash
	}
	ok, verifyErr := verifySecret(normaliseRecoveryCode(body.RecoveryCode), hash)
	if verifyErr != nil {
		s.fail(w, r, "verify recovery code", verifyErr)
		return
	}
	if !ok || err != nil {
		writeError(w, r, apiError{status: http.StatusUnauthorized, code: "invalid_recovery_code"})
		return
	}

	passwordHash, err := hashSecret(body.NewPassword)
	if err != nil {
		s.fail(w, r, "hash password", err)
		return
	}
	nextCode, err := newRecoveryCode()
	if err != nil {
		s.fail(w, r, "make recovery code", err)
		return
	}
	nextHash, err := hashSecret(normaliseRecoveryCode(nextCode))
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

	ok, err := verifySecret(body.CurrentPassword, sess.account.PasswordHash)
	if err != nil {
		s.fail(w, r, "verify password", err)
		return
	}
	if !ok {
		writeError(w, r, apiError{status: http.StatusUnauthorized, code: "invalid_credentials"})
		return
	}
	if !validPassword(body.NewPassword, sess.account.Handle) {
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "weak_password"})
		return
	}

	hash, err := hashSecret(body.NewPassword)
	if err != nil {
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

	ok, err := verifySecret(body.Password, sess.account.PasswordHash)
	if err != nil {
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
func validPassword(password, handle string) bool {
	if len(password) < 10 || len(password) > 256 {
		return false
	}
	return !strings.EqualFold(strings.TrimSpace(password), strings.TrimSpace(handle))
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
				s.log.Error("panic", "cause", cause, "path", r.URL.Path)
				writeError(w, r, apiError{status: http.StatusInternalServerError, code: "server_error"})
			}
		}()
		next.ServeHTTP(w, r)
	})
}
