# Thwart Web/PWA and backend

Read `docs/product/AGENTS.md` and relevant `docs/product/specs` first;
from the product workspace read its root instructions too. The product documentation
is stored here for distribution, not because Web is authoritative over every rule.
Read deeper instructions where present and relevant docs/spec and design contracts.

## Web architecture

Svelte 5 runes, strict TypeScript, Vite and Dexie. Use current package.json/lockfile
versions. Keep hand-written routing, lazy pages and bilingual string bundles in
step. Adding a route requires router, App, head/SEO, navigation where relevant,
translations and appropriate sitemap changes. Document the corresponding nginx
route update; production changes are a separate deployment action.

Keep style roles in tokens.css and preserve keyboard focus, reduced motion,
browser safe-area behavior, responsive layouts and native dialog semantics.
Dexie migrations append a new version/upgrade; never alter an existing version.
Service-worker changes need cache/install/update/offline regression checks.
Card JSON is generated into ignored public/data; no card dumps in Git or CI artifacts.
Keep installation icons and preview assets reproducible under their existing policy.

## Backend and deployment

The Go/SQLite API and deploy scripts belong only to this repository. Preserve
the revisioned sync protocol, collection opt-ins and server validation. Test
against a local server and disposable local accounts: Vite proxies to production
by default unless THWART_API is changed. Never use real account data for tests.

Deployment remains pull-based. Main CI advances release; release-api separately
promotes api-release. Never manually push those pointers. A server change holds
site publication until API promotion; report that dependency. Do not overwrite
live nginx configuration with the repository copy, which omits live TLS edits.
Production migrations require a fresh backup and the existing release flow.
Detailed operations belong in docs/deployment.md and docs/MAINTAINER_GUIDE.md.

## Verification and Git

From web: `npm run check` must have zero errors/warnings, `npm run build`, affected
test:* scripts and all scripts before push. Required card/campaign fixtures must
be prepared before data-dependent tests; CI test ordering matters. No ESLint or
Prettier is implied. From server: go vet, gofmt check and go test; CI also runs
the race detector on its supported toolchain. Release-script tests need Git Bash
on Windows. Report unavailable prerequisites rather than claiming full coverage.

Feature PRs target main in Hasyame/Thwart-Web. Stage named files; no git add -A.
Push only when requested by the owner, since main changes can reach production.
Cross-platform work uses a separate Android branch/PR and its own checks.
