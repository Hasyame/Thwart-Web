package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"
)

/*
Logging plays on BoardGameGeek, for a browser that cannot.

BGG publishes no write API. Its XML API is read-only, so logging a play goes
through `geekplay.php`, the same endpoint the website's own form posts to,
after signing in with the account's **password** — there is no token, no OAuth
and no app credential to issue. The Android app does exactly this from the
phone. A page on thwart.app cannot: neither the login endpoint nor geekplay.php
sends CORS headers, so the browser refuses the request before it leaves.

So the browser sends the play, and the credentials, here, and this relays them.
That is the one thing this server does with somebody's password for another
site, and the rules around it are the whole point of the file:

  - **Nothing is stored.** Not the password, not the username, not the session
    BGG hands back. Each request signs in, posts, and forgets. The browser keeps
    the credentials, on the device, the way the phone does.
  - **Nothing is logged.** The password never reaches a log line, an error
    message or a metric; the username reaches none either. An error names the
    step that failed and BGG's status, nothing more.
  - **Only for an account that is signed in here.** The relay is behind the
    same device token as everything else, and rate limited per account, so it
    cannot be used from the outside to try passwords against BGG through this
    box's address.
  - **Cookies go back to BGG and nowhere else.** The session cookies from the
    login are attached to the geekplay request by hand and redirects are not
    followed, so a redirect off the host cannot leave with a live session.
  - **Undocumented, and therefore fragile.** geekplay.php carries no promise of
    compatibility; when it changes this stops working rather than degrading,
    and every failure is reported to the player rather than swallowed.

The relay can be switched off for an instance (`-bgg-relay=false`), and then
the endpoints answer `bgg_disabled` and the web app offers only the hand-off to
BGG's own form.
*/

/** Where BoardGameGeek is. Overridden by tests to point at a fake. */
const bggBaseURL = "https://boardgamegeek.com"

/** Marvel Champions: The Card Game, on BGG. */
const bggMarvelChampionsID = "285774"

/*
Generous, because BGG is slow on a bad day and the play should still land;
short of the server's 30 s write timeout, with room for the login before it.
*/
const bggTimeout = 12 * time.Second

// What one relayed request may send. Nothing here is large, and the request
// body cap already bounds the lot; these keep a single field honest.
const (
	bggMaxUsername = 64
	bggMaxPassword = 256
	bggMaxComment  = 4000
	bggMaxLocation = 200
	bggMaxPlayers  = 6
	bggMaxMinutes  = 24 * 60
)

var bggDate = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

/*
How often one account may go through the relay.

A verification is something a person does when connecting, a handful of
times ever; a play is one per game. Both are per account rather than per IP,
because the relay is only reachable with a token, and it is the account that
must not become a password-guessing tool against somebody's BGG login.
*/
var (
	bggVerifyPerAccount = limitRule{10, time.Hour}
	bggPlayPerAccount   = limitRule{60, 24 * time.Hour}
)

type bggPlayer struct {
	Username string `json:"username"`
	Name     string `json:"name"`
	Score    int    `json:"score"`
	Won      bool   `json:"won"`
	/** Shown by BGG beside the name; the hero played is what belongs there. */
	Color string `json:"color"`
}

/** A finished game, in the shape BoardGameGeek records one. */
type bggPlay struct {
	/** Calendar day, `yyyy-MM-dd`. */
	PlayedOn      string      `json:"playedOn"`
	LengthMinutes int         `json:"lengthMinutes"`
	Location      string      `json:"location"`
	Comment       string      `json:"comment"`
	Players       []bggPlayer `json:"players"`
}

type bggVerifyRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type bggPlayRequest struct {
	Username string  `json:"username"`
	Password string  `json:"password"`
	Play     bggPlay `json:"play"`
}

// The outcomes a relayed call can have, each with its own error code.
var (
	errBggBadCredentials = errors.New("bgg: username or password rejected")
	errBggRejected       = errors.New("bgg: request refused")
	errBggUnreachable    = errors.New("bgg: not reached")
)

/*
The relay itself. One per server, holding nothing but where BGG is and a
client that follows no redirects.
*/
type bggRelay struct {
	base   string
	client *http.Client
}

func newBggRelay(base string) *bggRelay {
	return &bggRelay{
		base: strings.TrimRight(base, "/"),
		client: &http.Client{
			Timeout: bggTimeout,
			// A redirect is not followed. The login sets a session cookie, and
			// the only request that may carry it is the one to geekplay.php on
			// the same host, built below by hand.
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

/*
Signs in and returns the session cookies, which the caller attaches to exactly
one request. Sent as JSON because that is what BGG's own login form posts; a
form body is rejected.
*/
func (b *bggRelay) logIn(ctx context.Context, username, password string) ([]*http.Cookie, error) {
	payload, err := json.Marshal(map[string]any{
		"credentials": map[string]string{"username": username, "password": password},
	})
	if err != nil {
		return nil, fmt.Errorf("%w: encode login", errBggRejected)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, b.base+"/login/api/v1", bytes.NewReader(payload))
	if err != nil {
		return nil, fmt.Errorf("%w: build login", errBggRejected)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", bggUserAgent)

	res, err := b.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: login: %s", errBggUnreachable, transportDetail(err))
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 64*1024))

	/*
		A wrong password comes back as 400 with `{"errors":{"message":"Invalid
		username or password"}}` — checked against the live endpoint on
		2026-09-12, not the 401 the phone's client expects. Both are read as
		bad credentials; a 400 that says something else is BGG refusing the
		request itself.
	*/
	switch {
	case res.StatusCode == http.StatusUnauthorized:
		return nil, errBggBadCredentials
	case res.StatusCode == http.StatusBadRequest &&
		bytes.Contains(bytes.ToLower(body), []byte("invalid username or password")):
		return nil, errBggBadCredentials
	case res.StatusCode < 200 || res.StatusCode >= 300:
		return nil, fmt.Errorf("%w: login answered HTTP %d", errBggRejected, res.StatusCode)
	}
	cookies := res.Cookies()
	if len(cookies) == 0 {
		// Signed in with no session to show for it: whatever that is, a play
		// posted with it would not be filed under anybody.
		return nil, fmt.Errorf("%w: login set no session", errBggRejected)
	}
	return cookies, nil
}

/** Posts one play, exactly the way the phone does (BggClient.kt). */
func (b *bggRelay) postPlay(ctx context.Context, cookies []*http.Cookie, play bggPlay) error {
	form := url.Values{}
	form.Set("ajax", "1")
	form.Set("action", "save")
	form.Set("version", "2")
	form.Set("objecttype", "thing")
	form.Set("objectid", bggMarvelChampionsID)
	form.Set("playdate", play.PlayedOn)
	form.Set("length", strconv.Itoa(play.LengthMinutes))
	form.Set("location", play.Location)
	form.Set("quantity", "1")
	form.Set("incomplete", "0")
	form.Set("nowinstats", "0")
	form.Set("comments", play.Comment)
	// Player rows, not a count. A play posted with only a number lands in BGG
	// with nobody in it and never shows as the account holder's play.
	for i, player := range play.Players {
		prefix := "players[" + strconv.Itoa(i) + "]"
		form.Set(prefix+"[username]", player.Username)
		form.Set(prefix+"[userid]", "0")
		form.Set(prefix+"[name]", player.Name)
		form.Set(prefix+"[score]", strconv.Itoa(player.Score))
		form.Set(prefix+"[win]", map[bool]string{true: "1", false: "0"}[player.Won])
		form.Set(prefix+"[new]", "0")
		form.Set(prefix+"[rating]", "0")
		form.Set(prefix+"[color]", player.Color)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, b.base+"/geekplay.php", strings.NewReader(form.Encode()))
	if err != nil {
		return fmt.Errorf("%w: build play", errBggRejected)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("User-Agent", bggUserAgent)
	req.Header.Set("X-Requested-With", "XMLHttpRequest")
	for _, cookie := range cookies {
		req.AddCookie(cookie)
	}

	res, err := b.client.Do(req)
	if err != nil {
		return fmt.Errorf("%w: play: %s", errBggUnreachable, transportDetail(err))
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 64*1024))

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return fmt.Errorf("%w: play answered HTTP %d", errBggRejected, res.StatusCode)
	}
	// A rejected save comes back 200 with an error in the body, so the status
	// code alone cannot be trusted.
	if bytes.Contains(bytes.ToLower(body), []byte(`"error"`)) {
		return fmt.Errorf("%w: play refused", errBggRejected)
	}
	return nil
}

const bggUserAgent = "Thwart/1.0 (+https://thwart.app)"

/*
What a transport error may say. A timeout or a refused connection is worth
naming; the URL inside a `url.Error` is not, and nothing else in it carries a
credential either, but the shortest true sentence is the safest one.
*/
func transportDetail(err error) string {
	var urlErr *url.Error
	if errors.As(err, &urlErr) {
		if urlErr.Timeout() {
			return "timed out"
		}
		return "connection failed"
	}
	return "connection failed"
}

// --- the handlers -------------------------------------------------------------

/*
Turns a relay error into the code the client switches on. Logged with the
step and the status only: see the file comment for what must never appear.
*/
func (s *Server) bggFail(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, errBggBadCredentials):
		writeError(w, r, apiError{status: http.StatusUnauthorized, code: "bgg_bad_credentials"})
	case errors.Is(err, errBggUnreachable):
		s.log.Warn("bgg relay", "outcome", "unreachable", "detail", err.Error())
		writeError(w, r, apiError{status: http.StatusBadGateway, code: "bgg_unreachable"})
	default:
		s.log.Warn("bgg relay", "outcome", "rejected", "detail", err.Error())
		writeError(w, r, apiError{status: http.StatusBadGateway, code: "bgg_rejected"})
	}
}

func validBggCredentials(username, password string) bool {
	trimmed := strings.TrimSpace(username)
	return trimmed != "" && len(trimmed) <= bggMaxUsername &&
		password != "" && len(password) <= bggMaxPassword
}

func validBggPlay(play bggPlay) bool {
	if !bggDate.MatchString(play.PlayedOn) {
		return false
	}
	if play.LengthMinutes < 0 || play.LengthMinutes > bggMaxMinutes {
		return false
	}
	if len(play.Comment) > bggMaxComment || len(play.Location) > bggMaxLocation {
		return false
	}
	if len(play.Players) == 0 || len(play.Players) > bggMaxPlayers {
		return false
	}
	for _, player := range play.Players {
		if len(player.Username) > bggMaxUsername || len(player.Name) > bggMaxUsername ||
			len(player.Color) > bggMaxLocation {
			return false
		}
	}
	return true
}

/*
`POST /v1/bgg/verify` — checks a username and password against BGG, storing
nothing. So a typo is caught while the player is still looking at the form,
rather than at the end of a game.
*/
func (s *Server) handleBggVerify(w http.ResponseWriter, r *http.Request, sess session) {
	if s.bgg == nil {
		writeError(w, r, apiError{status: http.StatusServiceUnavailable, code: "bgg_disabled"})
		return
	}
	var body bggVerifyRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	if !validBggCredentials(body.Username, body.Password) {
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "malformed_record"})
		return
	}
	if !s.limiter.allow("bgg:verify:"+sess.account.ID, bggVerifyPerAccount) {
		writeError(w, r, apiError{status: http.StatusTooManyRequests, code: "rate_limited"})
		return
	}
	if _, err := s.bgg.logIn(r.Context(), strings.TrimSpace(body.Username), body.Password); err != nil {
		s.bggFail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

/*
`POST /v1/bgg/plays` — signs in, posts one play, forgets. The play arrives
already shaped by the client, comment and all, so both clients' plays read
the same on BGG and this never has to know what a scenario is.
*/
func (s *Server) handleBggPlay(w http.ResponseWriter, r *http.Request, sess session) {
	if s.bgg == nil {
		writeError(w, r, apiError{status: http.StatusServiceUnavailable, code: "bgg_disabled"})
		return
	}
	var body bggPlayRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	if !validBggCredentials(body.Username, body.Password) || !validBggPlay(body.Play) {
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "malformed_record"})
		return
	}
	if !s.limiter.allow("bgg:play:"+sess.account.ID, bggPlayPerAccount) {
		writeError(w, r, apiError{status: http.StatusTooManyRequests, code: "rate_limited"})
		return
	}
	cookies, err := s.bgg.logIn(r.Context(), strings.TrimSpace(body.Username), body.Password)
	if err != nil {
		s.bggFail(w, r, err)
		return
	}
	if err := s.bgg.postPlay(r.Context(), cookies, body.Play); err != nil {
		s.bggFail(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
