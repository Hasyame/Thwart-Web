# 03 — Stack decision

Four decisions, in ADR form. They are ordered by how hard they are to reverse:
the database is the one you are stuck with, the front-end framework the one you
could rewrite in a fortnight.

A note on the criteria before we start. You asked me to weigh "the ability for
outside contributors to help (the project already receives pull requests)". I
checked: `Hasyame/Thwart` has three merged pull requests, all from dependabot,
and two contributors, one of which is dependabot. That is not a criticism — a
niche companion app for a card game is not a magnet for drive-by patches — but
it does change the arithmetic. A contributor pool that does not exist yet should
not outvote the maintenance burden on the one person who is certainly here. I
have weighted accordingly, and I say so at each point where it changed the
answer.

---

## ADR-201 — The API is written in Go

### Context

A small HTTP API implementing doc 02: eleven endpoints, no business logic worth
the name, one correctness-critical section (the per-account revision counter).
It must be trivially self-hostable by strangers, and maintainable by one person
who is a systems engineer rather than a professional developer.

### Options considered

**Kotlin with Ktor.** The obvious candidate: it is the language you already
write, the app's `@Serializable` data classes exist, and you would not be
learning a second syntax. The pitch is code sharing with Android.

That pitch does not survive doc 02. The server is deliberately dumb — it stores
`body` as opaque JSON and never parses it. **There is no domain model to
share**, because the server has no domain. What Ktor would actually share is
`kotlinx.serialization` on data classes the server treats as `[]byte`, which is
nothing.

What remains is the JVM's operational profile: a runtime to install or a fat
base image, a heap to size, garbage-collection pauses on a 1 GB VPS, a Gradle
build a self-hoster has to run or a several-hundred-megabyte image they have to
pull. All to serve a few hundred requests a day. `jlink` can trim it, at the
cost of build complexity you would then maintain.

**Node with TypeScript.** Shares a language with the web front end, which is a
genuine benefit — one runtime, one package manager, one mental model for the
whole of this repository. Against it: `node_modules` as a supply-chain surface
on a server holding user data, a dependency treadmill measured in weeks, and the
fact that the ecosystem's answers to "how do I write an HTTP server" change
often enough that a two-year-old tutorial is misleading. For a project one
person maintains between app releases, that churn is the dominant cost.

**Go.** Not a language you write today, which is the whole of the case against
it.

Everything else favours it. `go build` produces one static binary with no
runtime; the container is `FROM scratch` plus a certificate bundle, around
15 MB, and starts in milliseconds on 20–30 MB of RAM. The standard library's
`net/http` and `database/sql` are enough for this entire API with essentially no
third-party dependencies — which means the supply chain is "Go, and the SQLite
driver". The language is deliberately small: no inheritance, no generics worth
arguing about, no metaprogramming, explicit error handling everywhere. A
systems engineer reads Go comfortably on day one, and the code you write in
month one still looks right in year three, because the language does not move.

Go is also the native tongue of self-hosted infrastructure — Prometheus,
Traefik, Caddy, Gitea, Grafana, Docker itself. Anyone who self-hosts your server
will recognise the shape of it.

### Decision

**Go**, with the standard library plus a SQLite driver, an Argon2id
implementation from `golang.org/x/crypto`, and as close to nothing else as
discipline allows.

Yes, this is a third language in the project. I recommend it anyway, and the
honest reason is that **the server is the component that should never need your
attention**. It is perhaps 2,000 lines that implement a protocol which, once
correct, does not change when the app gains a feature — that was the entire
point of making it dumb. A component you touch twice a year should optimise for
being operable and re-readable after six months away, not for sharing a syntax
with the component you touch weekly.

If you would rather not learn a language for this, Ktor is a defensible second
choice and I would not argue hard. Node I would argue against.

### Consequences

- You learn Go. For this API that is a weekend: it uses maybe a third of the
  language, and none of the parts people find annoying.
- Deployment is a single binary. No runtime, no interpreter, no version manager,
  no `node_modules`.
- Near-zero dependencies means near-zero dependency maintenance, which is the
  recurring cost you are actually trying to avoid.
- Three languages in the project (Kotlin, Go, TypeScript). Real, and the price
  of the two points above.
- Go's static typing and explicit errors suit a correctness-critical transaction
  boundary better than either alternative.

---

## ADR-202 — The database is SQLite

### Context

You know MariaDB well and asked, plainly, whether that familiarity outweighs the
technical arguments. It deserves a plain answer.

The workload: one user's entire dataset is a few hundred kilobytes to a couple
of megabytes. Writes are a handful of small rows a day per user, and doc 02
serialises them per account anyway. Reads are a cursor scan over one account's
records. A hundred users on this server would not trouble a Raspberry Pi.

### Options considered

**MariaDB.** You know it. You can back it up, replicate it, tune it and read its
slow log without opening a manual. That is worth real money and I am not going
to pretend otherwise.

**PostgreSQL.** The reflexive recommendation, and here the reflex is wrong.
The technical argument for Postgres over MariaDB usually rests on transactional
DDL, `jsonb`, and stronger concurrency primitives. This schema has three tables
and no DDL after migration; `body` is stored as text and never queried into; and
the one concurrency-critical operation — the revision counter — is solved by a
row lock that InnoDB does just as well. **The Postgres case does not survive
contact with this workload.** It would be a new database to learn for no
benefit, which is strictly worse than the MariaDB you already know.

**SQLite.** Which is the answer, and the reason is not that it beats MariaDB at
anything. It is that this system does not need a database *server*.

### Decision

**SQLite**, in WAL mode, one file, embedded in the Go binary's process.

The honest framing of your question: your MariaDB familiarity is a genuine
argument for MariaDB, and it comfortably defeats PostgreSQL. But it is an
argument about *operating a component this project does not need*. Your skill
would be spent maintaining a second container, a second upgrade cycle, a second
set of credentials in `.env`, a second backup procedure and a second thing that
can be down — in order to store a few megabytes with no concurrent writers.

What SQLite buys, measured against your stated constraints:

- **`docker compose up` is one container.** That is your first-class
  self-hosting requirement, met by deletion rather than by documentation.
- **Backup is copying a file.** `VACUUM INTO '/backups/thwart-2026-09-14.db'`
  produces a consistent snapshot of a live database with no lock held, no
  `mysqldump`, no credentials in a cron job. Restore is `cp`. Doc 05 has the
  procedure, and it fits in a paragraph.
- **Nothing to tune.** No buffer pool, no `max_connections`, no character set
  argument, no major-version upgrade that rewrites the data directory.
- **The concurrency objection does not apply.** SQLite's weakness is concurrent
  writers; doc 02 already serialises writes per account, and a single Go process
  with WAL and `BEGIN IMMEDIATE` handles this load with room to spare. Readers
  never block writers in WAL mode.

Keep all SQL behind a small `Store` interface and use no SQLite-specific syntax
beyond `VACUUM INTO`. If the thing ever outgrows a single file — which would
mean a scale this project is not trying to reach — swapping in MariaDB is a few
hundred lines behind an interface, and by then you will have real numbers
instead of a guess.

### Consequences

- One container, one file, one backup, one thing to be down.
- Backup and restore are file operations a sysadmin can verify by eye.
- Horizontal scaling is off the table. Accepted: this is a companion app for a
  card game, and the single-VPS sizing in doc 05 has two orders of magnitude of
  headroom.
- The database is inside the application process, so a server restart is a brief
  total outage rather than a reconnect. At this scale, invisible.
- Your MariaDB expertise goes unused here. It is not wasted — doc 05 leans on
  the same instincts for nginx, TLS, backups and log hygiene.

---

## ADR-203 — The web front end is a TypeScript PWA, not Compose for Wasm

### Context

The web app must mirror the Android app's features and appearance, work
anonymously with local persistence, be bilingual, and — per your Phase 1 — be
discoverable through search engines.

### Options considered

**Compose Multiplatform for Wasm**, sharing UI code with Android.

The appeal is obvious and I want to be fair to it: one UI codebase, one design
system, features appearing on both platforms at once. If it worked as
advertised, it would be the right answer.

The downsides, in the order they would hurt you:

- **It renders to a canvas, so there is no SEO whatsoever.** Compose for Wasm
  paints pixels via Skia into a `<canvas>`. There is no DOM for a crawler to
  read, no headings, no links, no text. Your Phase 1 rationale is "low risk,
  good for SEO and discovery" — this option scores exactly zero on that, which
  by itself disqualifies it for the phase you want it for.
- **Accessibility is the same problem wearing a different hat.** No DOM means no
  screen reader, no browser find-in-page, no text selection, no translation
  extension.
- **Bundle size.** A Skia-backed Wasm runtime plus your application is measured
  in megabytes before a single card is loaded, against tens of kilobytes for an
  equivalent DOM app. On a phone browser, that is the first impression.
- **It is not the web.** Browser back and forward, deep links, scroll
  behaviour, text input, autofill, right-click, zoom — all of it either
  reimplemented or subtly wrong. Users notice immediately even if they cannot
  name it.
- **The coupling you already flagged.** To share UI, the Android app's Compose
  code must move into a multiplatform module with multiplatform dependencies.
  You would be restructuring a shipping app — one that is mid-review at F-Droid,
  where build reproducibility and module structure are somebody else's problem
  to re-approve — in order to start a side project. That is a bad trade at any
  exchange rate.

**A TypeScript SPA and PWA.** Ordinary DOM, ordinary web. Server-rendered or
pre-rendered pages are indexable; the PWA parts (service worker, IndexedDB,
installability) are well-trodden. Costs a second UI implementation.

### Decision

**A TypeScript progressive web app**, built with Vite, using **Svelte** for
components, with **Dexie** over IndexedDB for local persistence and **Workbox**
for the service worker.

On the framework choice specifically: React has the larger contributor pool, and
if outside contributions were arriving weekly I would pick it for that reason
alone. They are not. Optimising for the maintainer who is definitely here,
Svelte is the better fit — its components are HTML with logic added rather than
JavaScript that produces HTML, which is a much shorter path for someone whose
day job is not front-end work. There are no hooks rules, no dependency arrays,
no render-cycle model to internalise, no memoisation to get wrong. It compiles
away, so the shipped bundle is small, which matters for the PWA. And when you
come back to a screen after four months, Svelte's version of that screen is the
one you can still read.

Local persistence is **IndexedDB via Dexie**, not `localStorage`. The anonymous
user's data is the same shape as the Android app's — plays, decks, campaign
events — and `localStorage` is a synchronous string store with a 5 MB ceiling.
Dexie gives indexed queries and transactions over IndexedDB with an API small
enough to hold in your head.

### Consequences

- The UI is implemented twice. This is the real cost and it is not small: every
  feature is built once in Compose and once in Svelte, and they will drift.
  Mitigated by doc 04's shared data package — the campaign templates, JSON
  schemas and rules definitions are shared even though the views are not — and
  by Phase 1 being read-only, so the second implementation starts small.
- The Android app is not touched at all to build the web app. Given F-Droid,
  this is worth a great deal on its own.
- SEO, accessibility, deep links and browser affordances work because they are
  the platform's, not something to reimplement.
- Small bundle, fast first load, ordinary offline story.
- The web app can ship, break and be rewritten without any risk to the Android
  app.

---

## ADR-204 — Material 3 by tokens, not by Material Web components

### Context

The plan assumed "Material 3 web components to match the app's look". That
assumption needs correcting before it becomes a dependency.

**Material Web (`@material/web`) has been in maintenance mode since June 2024.**
Google reassigned the engineering team to internal work; the project is not
deprecated and bug fixes are considered case by case, but there is no planned
feature work and the roadmap is explicitly contingent on finding new maintainers
([announcement](https://github.com/material-components/material-web/discussions/5642),
[roadmap](https://material-web.dev/about/roadmap/),
[coverage](https://9to5google.com/2024/06/25/material-web-components/)).

Building the front end on a component library that is frozen mid-way, with
several M3 components never shipped, is a poor foundation for something meant to
last years.

The good news is that the part you actually need is maintained.
`@material/material-color-utilities` — the library that implements M3's colour
algorithms, and the same one the Material 3 Compose stack derives its schemes
from — was last published in January 2026 and is actively used
([npm](https://www.npmjs.com/package/@material/material-color-utilities),
[source](https://github.com/material-foundation/material-color-utilities)).

And your look is not really Material's anyway. `Color.kt` defines it in four
hand-picked colours, with a comment saying so: *"Red and gold: hot-rod lacquer
over polished brass… everything else here is a tint or shade derived from them
so that Material's containers and disabled states stay in the same family rather
than drifting to stock purple."* `IronRed #E30022`, `BrassGold #D3AF37`,
`ArcGold #FCC200`, `PanelInk #1A1113`, on `PaperWarm #FFF8F6`.

### Decision

**Generate M3 design tokens from the same seed colours, and build the components
from them.** Feed `IronRed`, `BrassGold` and `ArcGold` through
`@material/material-color-utilities` at build time, emit the resulting tonal
palettes as CSS custom properties for light and dark, and write the handful of
components the app actually uses — buttons, cards, chips, lists, dialogs, tabs,
top app bar, navigation — against those variables.

The web app needs perhaps fifteen components. Writing them against a generated
token set is less work than adopting a frozen library, discovering which
components it never shipped, and hand-rolling those anyway in a different style.
It also means the two apps stay in step by construction: change a seed colour in
`Color.kt`, change the same constant in the token generator, and both move
together.

### Consequences

- No dependency on a maintenance-mode component library.
- Light and dark themes, and every container and disabled state, are derived by
  the same algorithm Compose uses — so they genuinely match rather than
  approximately match.
- You write the components. Fifteen of them, once, with no framework
  disagreement to mediate.
- The seed colours become a shared constant across three clients, and belong in
  the shared package described in doc 04.

---

## The stack, in one place

| Layer | Choice |
|---|---|
| API | Go, standard library, minimal dependencies |
| Database | SQLite, WAL, one file |
| Password and recovery-code hashing | Argon2id (`golang.org/x/crypto/argon2`) |
| Sessions | Opaque random bearer tokens, hashed at rest, revocable per device |
| Web build | Vite + TypeScript |
| Web components | Svelte |
| Web local storage | IndexedDB via Dexie |
| Service worker | Workbox |
| Theme | M3 tokens generated from the app's seed colours |
| Containers | Two images (API, static web), one `docker compose up` |
| Reverse proxy | nginx, as you already run |

No JWTs — opaque tokens are revocable, which is the property that matters when
somebody loses a phone. No ORM on the server — three tables and hand-written
SQL. No Redis, no message queue, no object store in the first release.
