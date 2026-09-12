package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

/*
The relay, against a fake BoardGameGeek.

Nothing here touches the real site. The fake answers the two endpoints the
relay uses — the login, which sets a session cookie or refuses, and
geekplay.php, which records what it was posted and with which cookies — so
the assertions are about what leaves this server: the form the phone posts,
field for field, the cookie attached to it and to nothing else, and the codes
each failure comes back as.
*/

type fakeBgg struct {
	mu       sync.Mutex
	password string
	// What geekplay.php received: the form, and the cookies it came with.
	plays   []map[string]string
	cookies []string
	// When set, the login answers this status with no cookie.
	loginStatus int
	// When set, geekplay answers this body (a refusal comes back 200 with
	// "error" in the body, which is the case worth having).
	playBody string
	// When set, the login redirects here, which must not be followed.
	redirectTo string
}

func (f *fakeBgg) handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /login/api/v1", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.redirectTo != "" {
			http.SetCookie(w, &http.Cookie{Name: "bggpassword", Value: "leak"})
			http.Redirect(w, r, f.redirectTo, http.StatusFound)
			return
		}
		if f.loginStatus != 0 {
			w.WriteHeader(f.loginStatus)
			return
		}
		var body struct {
			Credentials struct {
				Username string `json:"username"`
				Password string `json:"password"`
			} `json:"credentials"`
		}
		if r.Header.Get("Content-Type") != "application/json" ||
			json.NewDecoder(r.Body).Decode(&body) != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if body.Credentials.Password != f.password {
			// As the live site answers it: 400, and the reason in the body.
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte(`{"errors":{"message":"Invalid username or password"}}`))
			return
		}
		http.SetCookie(w, &http.Cookie{Name: "bggusername", Value: body.Credentials.Username})
		http.SetCookie(w, &http.Cookie{Name: "bggpassword", Value: "session-" + body.Credentials.Username})
		w.WriteHeader(http.StatusOK)
	})
	mux.HandleFunc("POST /geekplay.php", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if err := r.ParseForm(); err != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		form := map[string]string{}
		for key := range r.PostForm {
			form[key] = r.PostForm.Get(key)
		}
		f.plays = append(f.plays, form)
		f.cookies = append(f.cookies, r.Header.Get("Cookie"))
		if f.playBody != "" {
			_, _ = w.Write([]byte(f.playBody))
			return
		}
		_, _ = w.Write([]byte(`{"playid":"12345"}`))
	})
	return mux
}

func newBggTestServer(t *testing.T, fake *fakeBgg) (*Server, string) {
	t.Helper()
	upstream := httptest.NewServer(fake.handler())
	t.Cleanup(upstream.Close)
	s := newTestServer(t)
	s.UseBggRelay(upstream.URL)
	token := register(t, s, "geek", "correct horse battery").str("token")
	return s, token
}

func samplePlay() map[string]any {
	return map[string]any{
		"playedOn":      "2026-09-12",
		"lengthMinutes": 47,
		"location":      "Home",
		"comment":       "Win — Rhino (Standard I)\nHeroes: Spider-Man",
		"players": []map[string]any{
			{"username": "hasyame", "name": "hasyame", "score": 3, "won": true, "color": "Spider-Man / Justice"},
		},
	}
}

func TestBggVerifyChecksTheCredentialsAndStoresNothing(t *testing.T) {
	fake := &fakeBgg{password: "bgg secret"}
	s, token := newBggTestServer(t, fake)

	res := call(t, s, "POST", "/v1/bgg/verify", token,
		map[string]any{"username": "hasyame", "password": "bgg secret"})
	if res.status != http.StatusOK {
		t.Fatalf("verify: status %d, body %v", res.status, res.body)
	}
	if len(fake.plays) != 0 {
		t.Errorf("a verification posted a play")
	}

	wrong := call(t, s, "POST", "/v1/bgg/verify", token,
		map[string]any{"username": "hasyame", "password": "not it"})
	if wrong.status != http.StatusUnauthorized || wrong.code() != "bgg_bad_credentials" {
		t.Errorf("wrong password: status %d code %q", wrong.status, wrong.code())
	}

	// A 401, which is what the phone's client expects, reads the same way.
	old := &fakeBgg{password: "bgg secret", loginStatus: http.StatusUnauthorized}
	s, token = newBggTestServer(t, old)
	wrong = call(t, s, "POST", "/v1/bgg/verify", token,
		map[string]any{"username": "hasyame", "password": "bgg secret"})
	if wrong.status != http.StatusUnauthorized || wrong.code() != "bgg_bad_credentials" {
		t.Errorf("401 login: status %d code %q", wrong.status, wrong.code())
	}

	// A 400 that says something else is not a wrong password.
	other := &fakeBgg{password: "bgg secret", loginStatus: http.StatusBadRequest}
	s, token = newBggTestServer(t, other)
	wrong = call(t, s, "POST", "/v1/bgg/verify", token,
		map[string]any{"username": "hasyame", "password": "bgg secret"})
	if wrong.status != http.StatusBadGateway || wrong.code() != "bgg_rejected" {
		t.Errorf("400 without the message: status %d code %q", wrong.status, wrong.code())
	}
}

func TestBggPlayIsPostedAsThePhonePostsIt(t *testing.T) {
	fake := &fakeBgg{password: "bgg secret"}
	s, token := newBggTestServer(t, fake)

	res := call(t, s, "POST", "/v1/bgg/plays", token,
		map[string]any{"username": "hasyame", "password": "bgg secret", "play": samplePlay()})
	if res.status != http.StatusOK {
		t.Fatalf("play: status %d, body %v", res.status, res.body)
	}
	if len(fake.plays) != 1 {
		t.Fatalf("geekplay received %d posts, want 1", len(fake.plays))
	}
	form := fake.plays[0]
	// The fields BggClient.kt sets, with the same values.
	want := map[string]string{
		"ajax":                 "1",
		"action":               "save",
		"version":              "2",
		"objecttype":           "thing",
		"objectid":             "285774",
		"playdate":             "2026-09-12",
		"length":               "47",
		"location":             "Home",
		"quantity":             "1",
		"incomplete":           "0",
		"nowinstats":           "0",
		"comments":             "Win — Rhino (Standard I)\nHeroes: Spider-Man",
		"players[0][username]": "hasyame",
		"players[0][userid]":   "0",
		"players[0][name]":     "hasyame",
		"players[0][score]":    "3",
		"players[0][win]":      "1",
		"players[0][new]":      "0",
		"players[0][rating]":   "0",
		"players[0][color]":    "Spider-Man / Justice",
	}
	for key, value := range want {
		if form[key] != value {
			t.Errorf("form[%s] = %q, want %q", key, form[key], value)
		}
	}
	// The session from the login, and only that, travelled with the play.
	if !strings.Contains(fake.cookies[0], "bggpassword=session-hasyame") {
		t.Errorf("play carried no session cookie: %q", fake.cookies[0])
	}
}

func TestBggPlayReportsEveryFailure(t *testing.T) {
	// A refusal that comes back 200 with an error in the body.
	refusing := &fakeBgg{password: "bgg secret", playBody: `{"error":"Invalid play date"}`}
	s, token := newBggTestServer(t, refusing)
	res := call(t, s, "POST", "/v1/bgg/plays", token,
		map[string]any{"username": "hasyame", "password": "bgg secret", "play": samplePlay()})
	if res.status != http.StatusBadGateway || res.code() != "bgg_rejected" {
		t.Errorf("refused play: status %d code %q", res.status, res.code())
	}

	// A login that answers something other than a success or a refusal of
	// the credentials.
	broken := &fakeBgg{password: "bgg secret", loginStatus: http.StatusInternalServerError}
	s, token = newBggTestServer(t, broken)
	res = call(t, s, "POST", "/v1/bgg/verify", token,
		map[string]any{"username": "hasyame", "password": "bgg secret"})
	if res.status != http.StatusBadGateway || res.code() != "bgg_rejected" {
		t.Errorf("broken login: status %d code %q", res.status, res.code())
	}

	// Nothing listening at all.
	s = newTestServer(t)
	s.UseBggRelay("http://127.0.0.1:1")
	token = register(t, s, "geek", "correct horse battery").str("token")
	res = call(t, s, "POST", "/v1/bgg/verify", token,
		map[string]any{"username": "hasyame", "password": "bgg secret"})
	if res.status != http.StatusBadGateway || res.code() != "bgg_unreachable" {
		t.Errorf("unreachable: status %d code %q", res.status, res.code())
	}
}

func TestBggRedirectIsNotFollowed(t *testing.T) {
	// A login that redirects elsewhere, cookie in hand. The relay must not
	// follow: a redirect off the host would carry a live session with it.
	elsewhere := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Errorf("the redirect was followed, with cookies %q", r.Header.Get("Cookie"))
	}))
	t.Cleanup(elsewhere.Close)
	fake := &fakeBgg{password: "bgg secret", redirectTo: elsewhere.URL + "/steal"}
	s, token := newBggTestServer(t, fake)
	res := call(t, s, "POST", "/v1/bgg/verify", token,
		map[string]any{"username": "hasyame", "password": "bgg secret"})
	if res.status != http.StatusBadGateway || res.code() != "bgg_rejected" {
		t.Errorf("redirecting login: status %d code %q", res.status, res.code())
	}
}

func TestBggRelayNeedsAnAccountAndCanBeOff(t *testing.T) {
	fake := &fakeBgg{password: "bgg secret"}
	s, _ := newBggTestServer(t, fake)

	anonymous := call(t, s, "POST", "/v1/bgg/verify", "",
		map[string]any{"username": "hasyame", "password": "bgg secret"})
	if anonymous.status != http.StatusUnauthorized {
		t.Errorf("without a token: status %d", anonymous.status)
	}
	if len(fake.plays) != 0 {
		t.Errorf("an anonymous call reached BGG")
	}

	off := newTestServer(t)
	token := register(t, off, "geek", "correct horse battery").str("token")
	res := call(t, off, "POST", "/v1/bgg/plays", token,
		map[string]any{"username": "hasyame", "password": "bgg secret", "play": samplePlay()})
	if res.status != http.StatusServiceUnavailable || res.code() != "bgg_disabled" {
		t.Errorf("relay off: status %d code %q", res.status, res.code())
	}
}

func TestBggRelayRefusesWhatItCannotSend(t *testing.T) {
	fake := &fakeBgg{password: "bgg secret"}
	s, token := newBggTestServer(t, fake)

	bad := []map[string]any{
		{"username": "", "password": "bgg secret", "play": samplePlay()},
		{"username": "hasyame", "password": "", "play": samplePlay()},
		{"username": "hasyame", "password": "bgg secret", "play": func() map[string]any {
			p := samplePlay()
			p["playedOn"] = "12/09/2026"
			return p
		}()},
		{"username": "hasyame", "password": "bgg secret", "play": func() map[string]any {
			p := samplePlay()
			p["players"] = []map[string]any{}
			return p
		}()},
		{"username": "hasyame", "password": "bgg secret", "play": func() map[string]any {
			p := samplePlay()
			p["lengthMinutes"] = -1
			return p
		}()},
	}
	for i, body := range bad {
		res := call(t, s, "POST", "/v1/bgg/plays", token, body)
		if res.status != http.StatusBadRequest || res.code() != "malformed_record" {
			t.Errorf("bad body %d: status %d code %q", i, res.status, res.code())
		}
	}
	if len(fake.plays) != 0 {
		t.Errorf("a refused body still reached BGG")
	}
}

func TestBggVerifyIsRateLimitedPerAccount(t *testing.T) {
	fake := &fakeBgg{password: "bgg secret"}
	s, token := newBggTestServer(t, fake)
	body := map[string]any{"username": "hasyame", "password": "wrong"}
	var last response
	for i := 0; i < bggVerifyPerAccount.limit+1; i++ {
		last = call(t, s, "POST", "/v1/bgg/verify", token, body)
	}
	if last.status != http.StatusTooManyRequests || last.code() != "rate_limited" {
		t.Errorf("after the limit: status %d code %q", last.status, last.code())
	}
}
