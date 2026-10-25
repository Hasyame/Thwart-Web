# Web quality and security audit, 2026-10-25

## Scope and qualification

Review of the Web/PWA, its Go API, dependency advisories and deployment headers.
The baseline was Web `91cb424` and API `e499f9b` (compiled with Go 1.27.0).
No Android files, account records, schema or sync protocol were changed.

This is a source review and automated/browser regression audit, not an independent
penetration test or a guarantee that no vulnerabilities remain. Production was
inspected read-only; interactive tests used isolated browser profiles, synthetic
local records and blocked API requests. No live accounts or third-party mail/BGG
actions were exercised.

## Confirmed findings and corrections

| Finding | Assessment | Correction and evidence |
| --- | --- | --- |
| Known advisories in devalue, sharp, source-map-js and Vite | High advisory severity in development/build dependencies; this does not establish production exploitability | Updated compatible locked versions with `npm audit fix`, without forced major upgrades. Full and production-only npm audits report zero advisories. |
| Go standard-library advisories | Govulncheck reported 10 reachable findings with Go 1.27.0; production binary metadata confirmed that toolchain | Pin Go 1.27.3 for local, CI and server builds. Govulncheck v1.9.0 reports zero reachable vulnerabilities and zero affected imported packages. |
| Malformed card/deck URL can throw URIError | Availability/usability defect from unguarded `decodeURIComponent` | Invalid encoding returns the existing not-found route. Valid encoded identifiers still decode. Regression tests cover both. |
| Tag-removal regex leaves browser-valid malformed HTML intact | Defense-in-depth gap in untrusted card text; strict production CSP limits exploitation | Shared default-escaping allow-list at ingestion and rendering, including stale cached and linked cards. Preserve formatting and fixed icon spans only. Real-browser test confirms malformed image/SVG/frame tags become inert text and event attributes disappear. |
| CSP blocks imported backup photos | Functional regression: photos use a local object URL | Permit `blob:` only in `img-src`. Real-browser JPEG fixture fails under the original policy and loads under the corrected one. `script-src 'self'` remains unchanged. |
| Finish action falls below short mobile viewport | Reproduced at 360 × 640; counters plus wake-lock controls consume available height | On short phones, place villain HP beside the buttons. Keep 44px controls, maximum HP and the wake-lock option. Verify 320 × 568, 360 × 640 and 390 × 844. Enlarged text can scroll rather than being clipped. |
| Help text is wordy or misleading | Readability and accuracy | Shorter FR/EN deck, tracker, save/resume and homepage help; explicit next-stage and delete-save labels. Account text now describes email verification/recovery and avoids implying that stored records are unreadable to the server. |

Dependency evidence: [launch-editor/Vite advisory](https://github.com/advisories/GHSA-587h-7wmj-h5pm),
[sharp advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w),
[devalue advisory](https://github.com/advisories/GHSA-j22f-vq7h-c4qm),
[source-map-js advisory](https://github.com/advisories/GHSA-68fv-2mgg-jv7q),
and the Go vulnerability database used by govulncheck.

## Coverage

- All 47 `test:*` scripts: security regressions, contrast, service worker/offline
  behavior, backup validation, sync/merge/recovery, deck building, campaign rules,
  preparation order, imported data and release safeguards.
- `svelte-check`: zero errors and warnings; production Vite build.
- API: `go vet ./...` and `go test ./...` on the patched toolchain; Linux CI also
  runs the race detector. Reviewed authentication hashing, token scoping, request
  size bounds and account-scoped sync queries alongside their existing tests.
- Browser route sweep: 21 routes in French at 320px/light, English at 390px/dark
  and French at 1440px/dark. Includes missing and malformed routes. Checked page
  exceptions, horizontal overflow and axe WCAG A/AA findings.
- Populated campaign interaction: preparation navigation, four-villain table,
  44px counter controls, accumulated threat feedback, recurring acceleration,
  reload persistence, finish confirmation and defeated-state feedback.
- Actual HTML parser and production-CSP fixtures for the two content findings.
- Homepage news updated in both languages.

## Remaining limits and release checks

Govulncheck still lists three module-level advisories in unused `x/crypto/ssh`
and `x/crypto/openpgp` packages. The application imports Argon2, not those
packages; the scan reports no affected imported package or reachable call.
Reassess if imports change. Automated accessibility checks do not replace
screen-reader, physical-device and full keyboard testing. External image hosts,
mail delivery and BGG availability are not guaranteed by these tests.

Publish through the normal tested-release and API-promotion workflows. Take a
consistent database backup first; no migration is required. Back up and replace
only the nginx security-header snippet, validate with `nginx -t`, then reload;
do not overwrite the live TLS server configuration. Check running Web/API commit
stamps, API health, Go binary metadata, CSP and homepage news after publication.
