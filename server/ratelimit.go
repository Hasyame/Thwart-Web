package main

import (
	"context"
	"errors"
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

	/*
		The second tier, and the one that actually bounds a brute force.

		The windows above cap a burst. They do not cap a patient attacker: ten
		attempts every fifteen minutes is nine hundred and sixty a day, every
		day, forever. These put a ceiling on the day, so somebody who waits out
		each short window still runs out.

		Both tiers are cleared when a password finally works, so somebody who
		fumbles their password all morning and then gets it right is not still
		carrying the morning around.
	*/
	loginPerHandleDay = limitRule{50, 24 * time.Hour}
	loginPerIPDay     = limitRule{200, 24 * time.Hour}
	recoverHandleDay  = limitRule{20, 24 * time.Hour}

	/*
		Argon2 behind a device token, which nothing limited before.

		Changing a password and deleting an account both verify the current one,
		and both sit behind `authenticated`, so a stolen token was an unmetered
		supply of 64 MiB hashes. Generous, because these are things a person
		does deliberately and rarely.
	*/
	passwordPerAccount = limitRule{10, time.Hour}
	// Opening a link is a thing people do twice by accident and rarely more.
	verifyPerIP = limitRule{20, time.Hour}
	// Tighter, because this one makes the server send mail. Five is enough for
	// somebody whose message went to spam and not enough to be a mail cannon.
	resendPerIP = limitRule{5, time.Hour}
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

/*
How many Argon2 computations may run at once.

Not a rate: a concurrency. The rules above cap how many attempts an address or
an account may make over a window, and none of them stops those attempts being
made *simultaneously*. Thirty concurrent logins from one address are inside
every limit here and still mean thirty times 64 MiB of Argon2 at once, which is
1.9 GB against a MemoryMax of 512 MiB. The service is killed before any limit is
consulted, and it costs the attacker one machine and no credentials.

Four is measured against the unit file rather than picked: 4 x 64 MiB is 256 MiB
of hashing, which leaves room under MemoryHigh=384M for the Go heap and SQLite's
page cache. **Raising argonMemory or this number without revisiting the other
means revisiting the memory limits in deploy/thwart-api.service.**

Anything arriving while all four are busy waits rather than allocating, and
gives up after hashWait so that a queue cannot become the outage it was there to
prevent.
*/
const (
	hashSlots = 4
	hashWait  = 5 * time.Second
)

// A counting semaphore. A buffered channel rather than sync.Cond because the
// waiting has to be cancellable, and a select is the only way to wait on a slot
// and on a context at the same time.
type hashGate struct{ slots chan struct{} }

/*
What the server holds, so a test can count what goes through it.

An interface rather than the concrete gate because the property under test is
"no more than hashSlots at once", and the only honest way to check that is to
watch the real gate admit callers rather than to reason about it.
*/
type hashLimiter interface {
	enter(ctx context.Context) error
	leave()
}

func newHashGate(n int) *hashGate { return &hashGate{slots: make(chan struct{}, n)} }

// enter blocks until a slot is free, the caller goes away, or hashWait passes.
func (g *hashGate) enter(ctx context.Context) error {
	timer := time.NewTimer(hashWait)
	defer timer.Stop()
	select {
	case g.slots <- struct{}{}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return errBusy
	}
}

func (g *hashGate) leave() { <-g.slots }

// errBusy means the machine is saturated, not that the caller did anything
// wrong, which is why it becomes a 503 rather than a 429.
var errBusy = errors.New("too many password hashes in flight")

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
would put the whole world in one bucket and lock everybody out together. So a
forwarding header has to be read, and reading one carelessly is worse than not
reading it at all.

**The left-most entry is not the client.** It is whatever the client typed.
nginx's `$proxy_add_x_forwarded_for` appends the real peer to the header the
client sent, so `X-Forwarded-For: 198.51.100.1` arrives as
`198.51.100.1, 203.0.113.7`. Taking the first entry hands every caller a fresh
rate-limit bucket per request, which was measured against the live server:
eight attempts against a limit of five, none refused.

What is trustworthy is the entry the trusted proxy itself added, which is the
**last** one, and `X-Real-IP`, which nginx sets from `$remote_addr` and
therefore always overwrites. X-Real-IP is preferred because it cannot be
extended; the last X-Forwarded-For entry is the fallback for a proxy that only
sets that one.

Either way the header is read only when the immediate peer is loopback or
private, which is where a reverse proxy actually is. No flag to get wrong, and
a misconfiguration over-limits rather than not limiting.

A chain of more than one proxy (a CDN in front of nginx, say) needs the number
of trusted hops to be configurable. There is one hop here, so there is no
setting; do not add a CDN without revisiting this.
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

	if real := strings.TrimSpace(r.Header.Get("X-Real-IP")); net.ParseIP(real) != nil {
		return real
	}

	forwarded := r.Header.Get("X-Forwarded-For")
	if forwarded == "" {
		return host
	}
	parts := strings.Split(forwarded, ",")
	last := strings.TrimSpace(parts[len(parts)-1])
	if net.ParseIP(last) == nil {
		return host
	}
	return last
}
