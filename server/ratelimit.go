package main

import (
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

/*
Rate limiting.

In memory, in this process, because that is what the deployment is: one Go
binary on one small box, per doc 03. A shared store would be a second piece of
infrastructure bought to protect an instance with a handful of users on it.

The consequences are stated rather than hidden. Counters reset when the process
restarts, so a restart forgives everybody, and a second instance behind a load
balancer would count separately. Both are acceptable at this size; neither is
acceptable if this ever scales out, and that is the moment to move the counters
into SQLite.

A fixed window, not a token bucket. The thing being limited is guessing, and
"five attempts an hour" is a sentence an operator can reason about, which
matters more here than smoothing out bursts.
*/

type limitRule struct {
	limit  int
	window time.Duration
}

// The limits themselves.
//
// Recovery is the tightest, and deliberately so: auth.go argues that an 80-bit
// recovery code is safe *because* the rate limiter is the binding constraint,
// so this number is load-bearing rather than decorative.
var (
	registerPerIP  = limitRule{5, time.Hour}
	loginPerHandle = limitRule{10, 15 * time.Minute}
	loginPerIP     = limitRule{30, 15 * time.Minute}
	recoverHandle  = limitRule{5, time.Hour}
	recoverIP      = limitRule{10, time.Hour}
)

type counter struct {
	count int
	reset time.Time
}

type limiter struct {
	mu     sync.Mutex
	counts map[string]*counter
	now    func() time.Time // injectable, so the tests do not sleep
}

func newLimiter() *limiter {
	return &limiter{counts: map[string]*counter{}, now: time.Now}
}

// allow records one attempt and reports whether it is within the rule.
func (l *limiter) allow(key string, rule limitRule) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	c, seen := l.counts[key]
	if !seen || now.After(c.reset) {
		l.counts[key] = &counter{count: 1, reset: now.Add(rule.window)}
		return true
	}
	c.count++
	return c.count <= rule.limit
}

// forget clears a key, called after a success so that someone who mistyped
// their password four times and then got it right is not still one attempt from
// being locked out.
func (l *limiter) forget(key string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	delete(l.counts, key)
}

// sweep drops expired counters. Without it the map is an unbounded memory leak
// keyed by anything an unauthenticated caller cares to send.
func (l *limiter) sweep() {
	l.mu.Lock()
	defer l.mu.Unlock()

	now := l.now()
	for key, c := range l.counts {
		if now.After(c.reset) {
			delete(l.counts, key)
		}
	}
}

/*
clientIP works out who is being limited.

Behind nginx every request arrives from 127.0.0.1, so taking RemoteAddr alone
would put the whole world in one bucket and lock everybody out together. Taking
X-Forwarded-For alone is worse: it is a request header, so anyone reaching the
server directly could pick a fresh identity per attempt and never be limited at
all.

So the header is trusted only when the immediate peer is loopback or a private
address, which is exactly the case where a reverse proxy set it. No flag to get
wrong, and the failure mode of a misconfiguration is over-limiting rather than
no limiting.
*/
func clientIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	peer := net.ParseIP(host)
	if peer == nil || !(peer.IsLoopback() || peer.IsPrivate()) {
		return host
	}

	forwarded := r.Header.Get("X-Forwarded-For")
	if forwarded == "" {
		return host
	}
	// Left-most entry is the original client. A proxy that appends rather than
	// replaces is the normal configuration, and nginx's proxy_set_header in
	// deploy/ does exactly that.
	first := strings.TrimSpace(strings.Split(forwarded, ",")[0])
	if net.ParseIP(first) == nil {
		return host
	}
	return first
}
