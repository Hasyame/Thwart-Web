# Black-box security audit, 2026-09-24: outcome

An external, unauthenticated, non-destructive audit of https://thwart.app found
no exploitable vulnerability and listed six items to verify or harden. Each was
checked against the code and closed as below. Production nginx was updated the
same day (backups in `/root/nginx-backup-audit-*` on the host).

**What is live, and where.** The nginx changes (headers, log format) have been
live since 2026-09-24 13:10 UTC. The server change (the per-account resend cap)
is in commit `34281bb` on `main`, and reaches production when the API is next
released: `GET /api/v1/version` reports the running commit in `build`. The tests
are code only and run in CI on every push.

| # | Item | Verdict |
|---|------|---------|
| 1 | Rate limiting on auth and mail endpoints | Present everywhere; one cap added, tests added |
| 2 | Sync token in the SSE query string | Kept, with a written rationale; query strings no longer logged anywhere |
| 3 | BGG credential relay | Confirmed no store, no log; test added |
| 4 | Missing response headers | Added on pages and API |
| 5 | Bearer token in page storage | By design; CSP rule written down |
| 6 | Public `/v1/version` fields | Kept on purpose |

## 1. Rate limiting

Every endpoint the audit named is throttled in the server (`server/ratelimit.go`,
the application layer), behind nginx's own zones (`deploy/nginx-thwart-limits.conf`):

| Endpoint | Limit | Test |
|---|---|---|
| `POST /auth/login` | 10 / 15 min and 50 / day per handle, 30 / 15 min and 200 / day per IP | `TestLoginIsRateLimitedPerHandle`, `TestLoginIsBoundedOverADayNotJustAWindow` |
| `POST /auth/register` | 5 / h per IP | `TestRateLimitBucketCannotBeChosenByTheCaller` |
| `POST /auth/recover` | 5 / h and 20 / day per handle, 10 / h per IP | `TestRecoveryIsRateLimitedPerHandle` (new) |
| `POST /auth/verify` | 20 / h per IP | `TestVerifyIsRateLimitedPerAddress` (new) |
| `POST /auth/verify/resend` | 5 / h per IP, **3 / h per account (new)** | `TestResendIsRateLimitedPerAddress`, `TestResendIsRateLimitedPerAccount` (new) |
| `POST /bgg/verify` | 10 / h per account | `TestBggVerifyIsRateLimitedPerAccount` |
| `POST /alpha/android` | 3 / h per IP, 50 / day in total | `alpha_test.go` |

`verify/resend` also requires the account's password before it sends anything,
so it cannot mail an address its caller did not register. The per-account cap
is counted only after the password matched, so it tells a stranger nothing.
New tests are in `server/audit_test.go`.

## 2. SSE token

`EventSource` cannot send headers, so the stream takes the device token from the
query string. Kept, with the reasons next to `authenticatedStream` in
`server/api.go`: nginx has `access_log off` on the stream location, and the site
log format now drops every query string (`log_format thwart`); the server logs
paths only; `Referrer-Policy: no-referrer`; signing out revokes the device and
with it the token. A search of the live logs found no stream token ever
written. It did find two address-confirmation tokens (`/verify?token=`), from
before this change; those links are single-use and expire.

## 3. BGG relay

`server/bgg.go`: credentials are read from the request, sent to
`https://boardgamegeek.com` over TLS with redirects refused, and dropped. Errors
log the step and HTTP status only. `TestBggCredentialsNeverReachTheLog` runs
every outcome with the log captured and fails if the username or password
appears; `TestBggVerifyChecksTheCredentialsAndStoresNothing` covers storage.
The BGG settings page tells users the server keeps nothing.

## 4. Headers

Added to `deploy/nginx-thwart-security.conf` (every page location) and to the
`/api/` location, and live:

- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=()`.
  Screen wake lock and clipboard stay allowed; the app uses both.
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Resource-Policy: same-origin`

Checked live after the reload: pages and card images load, no console errors,
the service worker still controls the page.

## 5. Token in storage

No change. The comment above the CSP in `deploy/nginx-thwart-security.conf` now
says it: `script-src 'self'` with no inline script is the control that makes a
token in page storage acceptable, and loosening it is a security regression.

## 6. `/v1/version`

Kept. `build` is the commit of a public repository, and `deploy/release.sh` and
`deploy/api-ready.sh` read it to confirm a new server is the one answering.

## Not covered by the audit

TLS configuration at the edge was not visible to the auditor (a proxy stood in
between). Worth an SSL Labs run against thwart.app. Cross-account isolation is
covered by `TestAccountsCannotSeeEachOther`, `TestAStreamNeverCarriesAnotherAccountsEvents`,
`TestOneAccountCannotRevokeAnothersDevice` and, for export and the device list,
`TestExportAndDevicesAreScopedToTheAccount` (new).

## Production delta

The live site file is certbot-rewritten, so it was edited in place, not copied:
an `access_log /var/log/nginx/access.log thwart;` line in each of its two server
blocks, and the three headers in its `/api/` location. `conf.d/thwart-limits.conf`
and `snippets/thwart-security.conf` are plain copies of the repository files.

## Counter-audit checklist

Each check can be run from outside, without an account, and none of them is
load or brute force. Expected results are what the site answered on
2026-09-24 after the changes.

**Headers, pages and API (item 4).**

```bash
curl -sI https://thwart.app/ | grep -iE 'permissions-policy|cross-origin|content-security|strict-transport|x-frame|referrer|nosniff'
curl -sI https://thwart.app/api/v1/version | grep -iE 'permissions-policy|cross-origin|content-security'
```

Expected on both: `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=()`,
`Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`.
The page keeps its CSP with `script-src 'self'`; the API keeps `default-src 'none'`.
The same headers should appear on a deep link (`/decks`), a hashed asset
under `/assets/`, and `/sw.js`.

**No regression from the headers.** Open https://thwart.app in a browser: no
console errors, card images from marvelcdb.com load on a card page
(`/card/01001a`), the service worker controls the page after a reload.

**Resend cap (item 1), once `build` reports `34281bb` or later.** Only
verifiable with an unconfirmed account of your own: after three resends within
an hour, a fourth with the right password answers `429 rate_limited`. With a
wrong password or an unknown address the answer stays `202 {"sent":true}` until
the per-address limit (five an hour). If you do this, use a disposable account
and address; it sends real mail.

**Unauthenticated sign-up form (added after the audit).** `POST
/api/v1/alpha/android` exists and relays a name and address to the owner by
mail. A request with an empty name must answer `400 invalid_name` and send
nothing:

```bash
curl -s -X POST https://thwart.app/api/v1/alpha/android -H 'Content-Type: application/json' -d '{"name":"","email":"x@example.com","website":""}'
```

It is limited to three sends an hour per address and fifty a day in total, has a
honeypot field (`website`), a fixed subject, and refuses control characters in
the name (`server/alpha.go`, `server/alpha_test.go`).

**Not checkable from outside, stated for completeness.** That no query string
reaches the access log (items 2 and 3), that BGG credentials are never logged
(item 3), and the rate limits other than resend (item 1): see the code and tests
named above. A reviewer with repository access can run `go test ./...` in
`server/`.

**Verified on 2026-09-26.** SSL Labs completed its assessment of thwart.app
(92.222.65.177): grade **A+**, no warnings. TLS 1.2 and 1.3 are enabled, and
the report confirms HSTS. This assesses the public TLS endpoint, not application
authorization. [SSL Labs report](https://www.ssllabs.com/ssltest/analyze.html?d=thwart.app).
