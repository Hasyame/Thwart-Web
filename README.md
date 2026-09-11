# Thwart Web

A web companion for [Thwart](https://github.com/Hasyame/Thwart), the
offline-first Android app for the Marvel Champions living card game. Bilingual
in French and English, works with no account, and keeps its data in your own
browser.

Live at **<https://thwart.app>**.

The Android app is the reference implementation and this is brought to it,
except in the few places where an audit found Android wrong and recorded it.
[`docs/spec/statistics.md`](docs/spec/statistics.md) is the shared source of
truth for what every number means, written to be read by both.

## What it does

- **Cards.** Search the whole database in either language, with the app's own
  accent- and case-folding, so `crane rouge` finds *Crâne Rouge*. Every card
  has its own page.
- **Collection.** Tick the packs you own, grouped by release wave as the app
  groups them, and say which modular sets or scenarios your boxes are actually
  missing.
- **Decks.** Import a decklist from MarvelCDB by link or number, or build one
  here, and read it against your collection; it tells you whether you can
  build it. While building, the search can be limited to packs you own, or
  offer every card and mark the ones you would have to buy — remembered per
  browser.
- **Randomiser.** Draws a scenario, difficulty, heroes with aspects and modular
  sets from what you own, honouring each scenario's own setup rules. Every
  field can be locked and rerolled on its own. Up to five **extra modular
  sets** on top of the scenario's own, from the same pool, and a collection
  that cannot supply them is told so before the roll rather than drawn short.
  A draw is one tap from the setup screen, as on the phone.
- **My own setup.** Choose everything yourself — as many modular sets as you
  like, through a picker with a search, the count in view and the scenario's
  required sets placed and not removable — read the scenario's own setup
  off its main scheme card, then run the clock and count the villain and the
  main scheme while you play: damage against the printed health, threat against
  the limit, and an end-of-round button that applies the acceleration. Counters
  only, deliberately; it does not adjudicate rules. A game that has to be
  cleared off the table can be put away with where everything stood, and picked
  up later.
- **Campaigns.** Start one of the nine campaigns, pick who is at the table, read
  each scenario's setup as the campaign changes it, record what happened, spend
  credits in the market, and let the branches decide what comes next. A run is
  an append-only log and everything on screen is folded from it, so undo is an
  appended revocation rather than an unpicked change, and a campaign corrected
  on the app reads correctly here on the next build.
- **Versus.** The two-box mode, offered only to people who own a box that
  prints two main schemes — as the app does, because a menu entry that leads to
  an apology is worse than no menu entry.
- **History.** Every game and campaign run, filtered by hero, aspect, scenario,
  result, campaign or date. The filters live in the URL, so a filtered view can
  be bookmarked and shared and comes back the same after a reload. Any game can
  be **played again** — laid out on the setup screen with the same scenario,
  difficulty, heroes and modular sets, a campaign's scenario included, resolved
  through its template — and **starred**, to find in one filter and to see
  listed on the setup screen with a one-tap replay.
- **Difficulty ratings.** After a game, and from its page in the history, you
  can say how hard the scenario was and how hard each modular set was *with
  that scenario*, on a six-word scale from effortless to impossible; a finished
  campaign can be rated as a whole. Optional, one current opinion per subject,
  and only for what you actually played: the server checks every rating
  against the game it cites and refuses one that does not match, which the app
  then drops and says so. Signed-in players' ratings are pooled; the community
  average and its spread show beside a scenario, a drawn set, a set in the
  picker and a campaign once enough people have rated it (five, by default),
  and never on the rating row itself. Signed out, a rating stays on the
  device.
- **Statistics.** Win rates by hero, aspect, hero-and-aspect pairing, scenario,
  difficulty and table size, counted per seat.
- **BoardGameGeek.** A game can be handed to BGG's own play form, prefilled.
  The username is kept in this browser and never synced, so no BGG password is
  ever held by anything of ours.

Optionally, the navigation can be arranged the way the phone arranges it: one
**Play** tab opening a hub that holds the random draw, your own setup, the
campaigns and versus. Off by default, under Settings.

## Where your data lives

The rule, in one sentence: **what you make without an account stays in this
browser, and what you make with one belongs to the account.**

Signed out, everything is in IndexedDB on the device you made it on. Sign in
and you are asked once whether to adopt what is already here; from then on
those records live on the server and follow you to every device, including the
phone. Sign out and the account's records go with it — what you generated
outside the account is what remains. Games and campaigns carry a tag saying
which they are, *On this device only* or *On the server*, so this is never a
guess.

The app's **backup file** works in both directions regardless: export from your
phone, import here, export back. The records are stored in the same shapes the
Android app uses, so a round trip loses nothing, including the decks, plays,
campaigns and preferences this site does not display. The phone's own settings
are carried through untouched rather than applied here: this site has its own
theme and language, and adopting somebody's Android ones because they imported
a backup would be a surprise.

## Accounts and sync

An account is **optional** and the site is fully usable without one. What it
buys is the same data on the phone and in the browser.

Registration takes a handle, an email address and a password. The address is
confirmed by a link, and **the account is disabled until it is** — it cannot
sign in and nothing syncs to it. An account that is never confirmed is deleted
along with the address rather than left sitting there. Accounts created before
addresses existed keep signing in with their handle.

Passwords and recovery codes are hashed with Argon2id; device tokens are random
and stored only as a SHA-256, so a database dump yields nothing replayable.
`DELETE /v1/account` is real erasure, not a flag, and it takes the devices with
it.

Sync is a per-account revision counter, a pull by revision, a push of batches
that are idempotent on retry, and tombstones with a horizon — doc 02 has the
protocol and doc 06 the brief both clients were written from. Changes also
arrive **live**: a small server-sent-events stream tells a signed-in client that
something changed elsewhere, and the ordinary sync does the fetching, so the
stream is an optimisation and never a source of truth. One connection per
browser rather than per tab, elected with the Web Locks API; the phone holds one
while it is on screen and closes it when it leaves.

The server holds **no understanding of the data it syncs**. A record is a
collection name, an id and a JSON body the server never parses, so adding an
entity to Android needs no server release. Every rule that requires knowing what
a play or a deck is lives in the client.

`GET /v1/account/export` emits the app's own `Backup` shape, so an export from
the server restores through the import path that already exists. That is
deliberate: an account must never become a place data goes and cannot leave.

## Running the web app

Needs Node 20.19 or later, which is what Vite 7 asks for; CI builds on 24.
Nothing else — no database, no server, no Docker. It is a static site, so it
runs the same on Windows as anywhere.

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

| Command | What it does |
|---|---|
| `npm run data` | Fetch cards and packs from MarvelCDB, both languages |
| `npm run campaigns` | Fetch the campaign templates from the Android repository |
| `npm run icons` | Regenerate the app icons from the source SVG |
| `npm run check` | Type-check (`svelte-check`, strict, no `any`) |
| `npm run build` | Production build into `web/dist/` |
| `npm run preview` | Serve the production build |

`npm run dev` and `npm run build` regenerate the icons for you.

The tests are plain scripts rather than a framework, run by `vite-node` against
the real modules:

| Command | What it checks |
|---|---|
| `npm run test:parity` | The phone's own statistics tests, against this implementation |
| `npm run test:plays` | The statistics themselves |
| `npm run test:sync` | Change detection — the digest that decides what to upload |
| `npm run test:merge` | Per-collection merge and conflict rules |
| `npm run test:adoption` | What signing in does to data already on the device |
| `npm run test:device` | Which rows signing out takes, and which it leaves |
| `npm run test:engine-sync` | Campaign runs through the sync path |
| `npm run test:nav` | That every destination is reachable, in both arrangements |
| `npm run test:replay` | That a game played again is the game that was played, a campaign's included |
| `npm run test:randomizer` | The draw with extra modular sets: exact count, no duplicate, the scenario's own pool |
| `npm run test:ratings` | That a rating cites the right subject and game, a campaign's scenario resolved, and that a refused one does not stall the cursor |
| `npm run test:safe-area` | Whether the bottom system-bar inset is believed |
| `npm run test:filters` | Search and history filtering |
| `npm run test:deckbuilder` | Deck legality against a collection |
| `npm run test:campaign` | The campaign condition evaluator, and type coverage |
| `npm run test:engine` | Folding campaign logs; pass a backup path to fold your own |
| `npm run test:text` | Campaign text substitution |
| `npm run test:deal` | Campaign dealing |
| `npm run test:tracker` | The campaign tracker |
| `npm run test:setup` | Scenario setup text, in both languages |
| `npm run test:encounter` | The ported tracker rules against the real card database |
| `npm run test:paused` | That a game put away comes back the same |
| `npm run test:backup` | That both backup formats import; pass a real export as an argument |
| `npm run test:settings` | That the app's settings survive a round trip |
| `npm run test:sw` | The service worker's routing rules |
| `npm run test:contrast` | Colour contrast and the touch-target floor |

The card data refreshes on the server nightly, and a new release is published
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

Fifteen endpoints under `/v1`, and 83 test functions over them.

Mail is only needed for confirmation links, and **an instance with no mailer
turns verification off** rather than creating accounts nobody could ever
enable: without `-mail-from` there is no way to send a link, and the recovery
code already covers a forgotten password. So a self-hosted server needs no SMTP
at all.

[`deploy/`](deploy/) holds the whole of the production arrangement as scripts
rather than as instructions somebody has to follow: host hardening, nginx,
systemd units and timers, backups, send-only Postfix with DKIM, and
`live-probe.py`, which checks live sync against the running server over the
public endpoint. [`docs/design/`](docs/design/) has the data audit, the sync
protocol, the stack decision, the roadmap, the operations plan, the Android
brief and the live-sync design.

## What's coming

- **Making this repository public.** It was kept private until the server ran
  somewhere other than a laptop, which it now does. The history was written to
  be read, so it goes public in place rather than being squashed.
- **Confirming an address from Android.** Since Thwart 1.47.0 the phone knows
  `email_not_verified` and says, in its own words, that the link is in your
  inbox — which is the part that was actually missing, because before that it
  showed a general error and left you guessing. It still does not know
  `/v1/auth/verify` itself, so the link has to be opened somewhere else and
  there is no way to ask for another one from the app.
- **Starred games and ratings on Android.** The web syncs two collections the
  phone does not have yet: `favourite_plays` — a game somebody starred, to find
  again and play again — and `ratings`. Its sync engine defers a collection it
  cannot name and holds its cursor short of it, so nothing is lost and nothing
  breaks; both arrive the moment a build that knows the names pulls. Doc 06 §6
  has the favourites contract, the same shape as `favourite_cards`, and
  [`docs/spec/ratings-and-modular-sets.md`](docs/spec/ratings-and-modular-sets.md)
  has the ratings one. Ratings need one more thing of the phone first: its
  push loop marks every result synced, and the server answers a rating it
  refuses with a fourth outcome, `rejected`, which Android must handle by
  deleting the local record rather than keeping a rating the server never
  stored.
- **Extra modular sets on Android.** The randomiser here can add up to five
  modular sets beyond a scenario's own, and a custom game takes as many as you
  like; the phone's randomiser draws the scenario's count only.
- **One correction on Android** that
  [`docs/spec/statistics.md`](docs/spec/statistics.md) records: `plays_by_scenario`
  groups by `scenarioCode` while selecting a bare `scenarioName`, so a scenario
  ever recorded under two spellings gets an undefined label. It should take the
  name from the most recent play in the group, as the hero labels do.

  Two others listed here have been settled. `Play.ignored` is already gone from
  the phone. The French *affinité* was recorded as a stray word to tidy; it is
  not one — fifteen Android strings say *affinité* and none say *aspect*, so the
  apps chose different words rather than one being inconsistent. That is a
  terminology decision, and until it is made neither client should change.

Known and not planned: on Android, Firefox reports a bottom safe-area inset for
a navigation bar it has already kept outside the page, and its own toolbar
overlays the top of a sticky header while scrolling. The first is worked around
(`web/src/lib/safeArea.ts`); the second has no reliable fix from inside a page.

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
