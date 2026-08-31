# Thwart Web

A web companion for [Thwart](https://github.com/Hasyame/Thwart), the
offline-first Android app for the Marvel Champions living card game. Bilingual
in French and English, works with no account, and keeps its data in your own
browser.

**Work in progress.** Nothing is deployed yet and the repository is private for
now; it will be made public once there is something worth running.

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
- **My own setup.** Choose everything yourself and let the clock run, then
  record the result.
- **Statistics.** Win rates by hero, aspect, hero-and-aspect pairing, scenario,
  difficulty and table size, counted per seat.
- **Campaigns.** Read-only progress for campaigns imported from the app.

Until there is an account to sync with, the app's **backup file** is the bridge:
export from your phone, import here, and export back. The records are stored in
the same shapes the Android app uses, so a round trip loses nothing, including
the decks, plays and campaigns this site cannot yet display.

A sync server is designed but deferred; see
[`docs/design/`](docs/design/) for the data audit, the sync protocol, the stack
decision, the roadmap and the operations plan.

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

`npm run dev` and `npm run build` regenerate the theme for you, so `npm run
theme` is only needed on its own after changing a seed colour.

The card data refreshes automatically through
[`.github/workflows/card-data.yml`](.github/workflows/card-data.yml), which
checks MarvelCDB nightly and only rebuilds when something actually changed.

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
