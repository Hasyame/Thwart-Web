# Thwart Web

A web companion for [Thwart](https://github.com/Hasyame/Thwart), the
offline-first Android app for the Marvel Champions living card game. Bilingual
in French and English, works with no account, and keeps its data in your own
browser.

Live at **<https://thwart.app>**.

Shared product decisions are recorded in [docs/product/specs](docs/product/specs).
Android and Web are independent clients; neither is the authority for every
behavior. The [statistics contract](docs/spec/statistics.md) and
[campaign specification](docs/spec/campaigns.md) describe shared rules.

## What it does

- **Cards.** Search the whole database in either language, with the app's own
  accent- and case-folding, so `crane rouge` finds *Crâne Rouge*. Every card
  has its own page. French artwork is looked up through MC4DB and cgbuilder,
  with English artwork as a fallback. Supplemental MC4DB encounter data fills
  gaps including Fear No Evil; named cards in its briefings open their details.
- **Collection.** Tick the packs you own, grouped by release wave as the app
  groups them, and say which modular sets or scenarios your boxes are actually
  missing.
- **Decks.** Import a decklist from MarvelCDB by link or number, or build one
  here, and read it against your collection; it tells you whether you can
  build it. A new deck starts with the hero's own cards, as the phone's does.
  The editor shows every card that can go in *this* deck from the first
  pixel — the deck's aspects and basic on, the others one tap away, type and
  cost chips, a text box, and *only what I own*, on by default, to keep to
  your packs — with
  a bar that stays put holding the count against its range, the verdict and
  Save. Rest the pointer on any card, anywhere in the app, to see it with
  its rules; on a wide screen the deck pages pin that card beside the list;
  a click opens it in a window without leaving the page. Decks are tiles
  with the hero's art, and each deck has a page of its own at
  `/decks/<id>` — the banner, a search box and a list-or-grid switch, the
  hero set apart, the deck in type columns, the card panel with the actions
  beside it, the hero's nemesis set, and the cost curve and composition
  under it all. The editor is that page's `/edit`. Decks sort into
  **folders** you name, which sync like everything else. Building starts
  from a hero alone: the aspect is whatever the cards you add say, and the
  editor flags the first card that mixes more than the hero allows. A card that
  says "play only if your identity has the Guardian trait" stays legal in any
  deck, but the editor and the deck page say which cards the identity cannot
  play, live, and the pool can hide them. The rule is derived once from the
  card text at build time and shared with the Android app through one fixture
  ([`docs/spec/synergie-et-draft.md`](docs/spec/synergie-et-draft.md)). And a **draft**, at `/draft`: an identity, an aspect, then a
  hand of random cards from your collection at each pick, keep one, until the
  deck is full — one to four players on one device, each physical copy
  drafted once, every offer legal, every deck saved to the shelf under a
  `DRAFT-HERO-ASPECT-01` name. The state survives a closed tab.
  **Sealed** opens six boosters of ten cards, individually or all at once,
  then lets you build from those 60 cards. Both modes support temporary
  collection settings and hand saved decks to a random game, custom game or
  campaign. Back navigation retains the completed decks and mode chooser.
  Start either mode from Play or Decks. Folder collapse and deck list/grid
  preferences are remembered in this browser.
- **Achievements**, at `/achievements`: a heroes-by-scenarios grid of what
  you have played and beaten, 43 named achievements, and a
  completion rate over your collection. Switch between all, achievements and
  completion; milestones include draft/sealed wins and losses. Eligible
  achievements can prepare a suitable game. Nothing is stored: the state is a
  pure function of the game history, recomputed live, specified once for
  both clients in [`docs/spec/achievements/`](docs/spec/achievements/)
  with the vectors both must reproduce. The definitions are a versioned
  data file, [`web/public/achievements.json`](web/public/achievements.json),
  of which Android bundles a snapshot. The backup format is 2 since then:
  the play record carries the owner's seat and Thwart's own mode, and every
  field a build does not know is kept and written back.
- **Randomiser.** Draws a scenario, difficulty, heroes with aspects and modular
  sets from what you own, honouring each scenario's own setup rules. Every
  field can be locked and rerolled on its own. Up to five **extra modular
  sets** on top of the scenario's own, from the same pool, and a collection
  that cannot supply them is told so before the roll rather than drawn short.
  An optional filter offers only hero/scenario combinations never played in
  your history. Decks passed from draft or sealed retain their heroes and
  aspects through rerolls. A draw is one tap from the game briefing.
- **Custom game.** Choose everything yourself — as many modular sets as you
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
  on the app reads correctly here on the next build. Each run is a tile with
  its final villain's art as the face of the box, a status badge — not
  started, in progress, won, lost, conceded — the scenarios beaten and every
  game's result in order. A campaign is lost only when its rules say so; a
  lost game on the way does not make a lost campaign. Each campaign has its own
  page with scenario cards, heroes linked to their decks, attempt counts,
  play time, victory points and community difficulty ratings. Beaten scenarios
  receive a comic stamp. The briefing guides the setup step by step, and new
  campaigns are offered only for boxes in your collection.
- **Versus.** The two-box mode, offered only to people who own a box that
  prints two main schemes — as the app does, because a menu entry that leads to
  an apology is worse than no menu entry.
- **History.** Every game and campaign run, filtered by hero, aspect, scenario,
  result, campaign or date. The filters live in the URL, so a filtered view can
  be bookmarked and shared and comes back the same after a reload. A game
  played from the setup page or from a draw can be **played again** — laid
  out on the setup screen with the same scenario, difficulty, heroes and
  modular sets — and **starred**, to find in one filter and to see listed on
  the setup screen with a one-tap replay. A campaign's scenario is played
  again from its own campaign.
- **Difficulty ratings.** After a game, and from its page in the history, you
  can say how hard the scenario was and how hard each modular set was *with
  that scenario*, on a six-word scale from effortless to impossible; a finished
  campaign can be rated as a whole. Optional, one current opinion per subject,
  and only for what you actually played: the server checks every rating
  against the game it cites and refuses one that does not match, which the app
  then drops and says so. Signed-in players' ratings are pooled; the community
  average and its spread show beside a scenario, a drawn set, a set in the
  picker and a campaign once enough people have rated it (five, by default;
  before that, only how many have), and never on the rating row itself.
  Signed out, a rating stays on the device.
- **Statistics.** Win rates by hero, aspect, hero-and-aspect pairing, scenario,
  difficulty and table size, counted per seat.
- **BoardGameGeek.** Under Settings, a page of its own, laid out as on the
  phone: connect with your BGG username and password, choose whether games
  are sent never, on request or always, and disconnect. A sent play is the
  phone's, field for field — result and scenario, heroes, aspects, the day
  and the start–end times, your notes in the comment; your hero beside your
  name. BGG has no write API and no token: the phone posts with your
  password, and a page on thwart.app cannot reach BGG at all (no CORS on
  either endpoint), so the play goes through the thwart.app server, which
  signs in, posts, and keeps nothing — not the password, not the username,
  not the session (`server/bgg.go`). The connection lives in this browser
  only, never synced and never in a backup, and the relay is open only to a
  signed-in Thwart account. Without one, or on a server run with
  `-bgg-relay=false`, the page still takes a username and hands you BGG's own
  Log Play form with the details on your clipboard.

Optionally, the navigation can be arranged the way the phone arranges it: one
**Play** tab opening a hub that holds the random draw, custom games, the
campaigns and versus. Configurable under Settings.

The home page offers **Install Thwart** with Android installation help and an
Android alpha sign-up form. The form relays your name and email to the maintainer
without retaining a registration database.

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

The server validates sync envelopes and collection-specific constraints, including
ratings. New collections require coordinated backend and client handling; they
must not be treated as arbitrary data that older clients necessarily understand.

`GET /v1/account/export` emits the app's own `Backup` shape, so an export from
the server restores through the import path that already exists. That is
deliberate: an account must never become a place data goes and cannot leave.

## Running the web app

Needs Node 20.19 or later, which is what Vite 7 asks for; CI builds on 24.
Nothing else — no database, no server, no Docker. It is a static site, so it
runs the same on Windows as anywhere.

```bash
cd web
npm ci
npm run data
npm run dev
```

`npm run data` fetches card data and supplementary sources into
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
| `npm run test:engine-sync` | Pull/push ordering, batches, cursors and failures |
| `npm run test:sync-integration` | IndexedDB merge rules, adoption, sync controls and retries |
| `npm run test:release` | Release and nightly publication gates with isolated fake tools (requires Git Bash on Windows) |
| `npm run test:nav` | That every destination is reachable, in both arrangements |
| `npm run test:head` | What each page says about itself: titles, descriptions, canonicals, what is kept out of the index |
| `npm run test:replay` | That a game played again is the game that was played |
| `npm run test:randomizer` | The draw with extra modular sets: exact count, no duplicate, the scenario's own pool |
| `npm run test:ratings` | That a rating cites the right subject and game, a campaign's scenario resolved, and that a refused one does not stall the cursor |
| `npm run test:bgg` | That the BGG comment is the phone's, line for line |
| `npm run test:safe-area` | Whether the bottom system-bar inset is believed |
| `npm run test:filters` | Search and history filtering |
| `npm run test:deckbuilder` | Deck legality against a collection |
| `npm run test:campaign` | The campaign condition evaluator, and type coverage |
| `npm run test:engine` | Folding campaign logs; pass a backup path to fold your own |
| `npm run test:text` | Campaign text substitution |
| `npm run test:deal` | Campaign dealing |
| `npm run test:tracker` | The campaign tracker |
| `npm run test:fne` | Fear No Evil played through against the shipped template: a lost scenario is not failed, the Kingpin defeat on Expert, the lost campaign |
| `npm run test:fne-solo` | Fear No Evil outside its campaign: the codes, the jobs and subordinates, the tracker, the briefing, the draw |
| `npm run test:tile` | A campaign's tile: the final villain as its face, won or lost as the engine means it |
| `npm run test:synergy` | Which cards an identity can play: the shared fixture, the real cards, and the conditions not read |
| `npm run test:draft` | The draft: offers, limits, the shared shelf, whole drafts ending legal, the names |
| `npm run test:achievements` | The achievements: the vectors shared with Android (`docs/spec/achievements/`), the definitions file, the reading of the records |
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

The API exposes account, sync, ratings, BGG relay and Android alpha endpoints under `/v1`.

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

## Development and security

See [AGENTS.md](AGENTS.md) for contribution checks and
[docs/deployment.md](docs/deployment.md) for the pull-based release process.
Main CI promotes tested site revisions; API publication is separate. Generated
card data is ignored and must not be committed or uploaded as CI artifacts.

The [September 2026 security audit](docs/security/2026-09-24-blackbox-audit.md)
records endpoint limits, credential handling and deployment hardening, with a
counter-audit checklist. Consult that report for the exact verification scope.
Report sensitive issues privately rather than posting credentials or account
information in an issue.

## Legal

Licensed under the MIT licence, as Thwart is.

Marvel Champions card text and images belong to Fantasy Flight Games and to
Marvel. Nothing in this repository bundles or re-hosts them: the card database
is fetched from MarvelCDB and supplementary MC4DB sources at build time and never committed, and card images
are referenced at their canonical URLs rather than copied. What is stored is
what a player has made (which packs they own, which decks they saved, which
games they played), and cards are referred to by code, the same way the Android
app does.

Card data contributors and image providers are credited in the app, including
[MarvelCDB](https://marvelcdb.com), [MC4DB](https://mc4db.merlindumesnil.net) and
[cgbuilder](https://mc.cgbuilder.fr).

This is an unofficial fan project, not affiliated with Fantasy Flight Games or
Marvel.
