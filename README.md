# Thwart Web

A web companion for [Thwart](https://github.com/Hasyame/Thwart), the
offline-first Android app for the Marvel Champions living card game. Bilingual
in French and English, works with no account, and keeps its data in your own
browser.

Live at **<https://thwart.app>**. The repository is private for now; it will be
made public once the account server has run somewhere other than a laptop.

## What it does

- **Cards.** Search the whole database in either language, with the app's own
  accent- and case-folding, so `crane rouge` finds *Crâne Rouge*. Every card
  has its own page.
- **Collection.** Tick the packs you own, grouped by release wave as the app
  groups them, and say which modular sets or scenarios your boxes are actually
  missing.
- **Decks.** Import a decklist from MarvelCDB by link or number, and read it
  against your collection; it tells you whether you can build it.
- **Randomiser.** Draws a scenario, difficulty, heroes with aspects and modular
  sets from what you own, honouring each scenario's own setup rules. Every
  field can be locked and rerolled on its own.
- **My own setup.** Choose everything yourself, run the clock, and count the
  villain and the main scheme while you play: damage against the printed
  health, threat against the limit, and an end-of-round button that applies the
  acceleration. Counters only, deliberately; it does not adjudicate rules.
  A game that has to be cleared off the table can be put away with where
  everything stood, and picked up later.
- **Statistics.** Win rates by hero, aspect, hero-and-aspect pairing, scenario,
  difficulty and table size, counted per seat.
- **Campaigns.** Read-only progress for campaigns imported from the app.

Until there is an account to sync with, the app's **backup file** is the bridge:
export from your phone, import here, and export back. The records are stored in
the same shapes the Android app uses, so a round trip loses nothing, including
the decks, plays, campaigns and preferences this site does not display. The
phone's own settings are carried through untouched rather than applied here:
this site has its own theme and language, and adopting somebody's Android ones
because they imported a backup would be a surprise.

An **account server** lives in [`server/`](server/): registration without an
email address, login, recovery by written-down code, device management, and the
sync feed. It is optional, and the site works without it. No client speaks to
it yet; the Android app needs its soft-delete groundwork first (doc 01 §8).
See [`docs/design/`](docs/design/) for the data audit, the sync protocol, the
stack decision, the roadmap and the operations plan, and
[`docs/deployment.md`](docs/deployment.md) for the runbook.

## Running the web app

Needs Node 20 or later and nothing else. No database, no server, no Docker;
it is a static site, so it runs the same on Windows as anywhere.

```bash
cd web
npm install
npm run data
npm run dev
```

`npm run data` fetches the card database from MarvelCDB into
`web/public/data/`, which takes a minute or so and is never committed. You only
need to re-run it when you want fresher cards. `npm run dev` then serves the
site at <http://127.0.0.1:5173>.

Other scripts:

| Command | What it does |
|---|---|
| `npm run data` | Fetch cards and packs from MarvelCDB, both languages |
| `npm run theme` | Regenerate the Material 3 tokens from the app's seed colours |
| `npm run check` | Type-check (`svelte-check`, strict, no `any`) |
| `npm run build` | Production build into `web/dist/` |
| `npm run preview` | Serve the production build |
| `npm run test:sw` | Check the service worker's routing rules |
| `npm run test:backup` | Check that both backup formats import; pass a real export as an argument |
| `npm run test:settings` | Check the app's settings survive a round trip through here |
| `npm run test:encounter` | Check the ported tracker rules against the real card database |
| `npm run test:paused` | Check a game put away comes back the same |

`npm run dev` and `npm run build` regenerate the theme for you, so `npm run
theme` is only needed on its own after changing a seed colour.

The card data refreshes on the server, nightly, and a new release is published
only when the data or the code actually changed; see
[`docs/deployment.md`](docs/deployment.md).
[`.github/workflows/ci.yml`](.github/workflows/ci.yml) type-checks, tests and
builds both halves on every push, and deliberately publishes nothing: the built
site is mostly card text, and uploading it would be re-hosting it.

## Running the account server

Needs Go 1.25 or later. Pure Go throughout, so there is no C compiler, no
shared library and no database server to install; the whole of it is one binary
and one SQLite file.

```bash
cd server
go test ./...
go run . -addr 127.0.0.1:8787 -db ./thwart.sqlite
```

The concurrency tests are only worth much with the race detector, which needs
cgo and therefore a C compiler:

```bash
CGO_ENABLED=1 go test -race ./...
```

```bash
curl -s http://127.0.0.1:8787/v1/health
```

The server holds **no email address**, not as a nullable column but as a fact
about the schema: there is nowhere to put one. An account is a handle, a
password and a recovery code that is shown exactly once. Passwords and recovery
codes are hashed with Argon2id; device tokens are random and stored only as a
SHA-256, so a database dump yields nothing replayable.

It also holds **no understanding of the data it syncs**. A record is a
collection name, an id and a JSON body the server never parses, so adding an
entity to Android needs no server release. Every rule that requires knowing what
a play or a deck is lives in the client.

`GET /v1/account/export` emits the app's own `Backup` shape, so an export from
the server restores into the app through the import path that already exists.
That is deliberate: an account must never become a place data goes and cannot
leave. `DELETE /v1/account` is real erasure, not a flag.

## Legal

Licensed under the MIT licence, as Thwart is.

Marvel Champions card text and images belong to Fantasy Flight Games and to
Marvel. Nothing in this repository bundles or re-hosts them: the card database
is fetched from MarvelCDB at build time and never committed, and card images
are referenced at their canonical URLs rather than copied. What is stored is
what a player has made (which packs they own, which decks they saved, which
games they played), and cards are referred to by code, the same way the Android
app does.

This is an unofficial fan project, not affiliated with Fantasy Flight Games or
Marvel.
