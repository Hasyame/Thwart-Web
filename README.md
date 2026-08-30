# Thwart Sync & Web

An optional sync server and a web companion for
[Thwart](https://github.com/Hasyame/Thwart), the offline-first Android app for
the Marvel Champions living card game.

**This is a work in progress.** Nothing here is released, nothing is stable,
and the repository is private for now. It will be made public once there is
something worth running.

Two components are planned:

- **A sync server.** A small, self-hostable HTTP API and database, so somebody
  who wants their collection, decks, campaigns and play history on more than
  one device can have that. An account is strictly opt-in: the Android app
  stays fully usable with no account and no network, which is the point of it.
- **A web application.** A progressive web app mirroring the Android app's
  features and appearance, with richer statistics, working anonymously by
  default and storing its data locally until somebody chooses otherwise.

The web application is being built first; the sync server is deferred. Design
documents live in [`docs/design/`](docs/design/) — the data audit, the sync
protocol, the stack decision, the roadmap and the operations plan.

## Running the web app

Needs Node 20 or later and nothing else. No database, no server, no Docker —
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
Marvel. Nothing in this repository bundles or re-hosts them, and the server
never will: it stores what a player has made — which packs they own, which
decks they saved, which games they played — and refers to cards by code, the
same way the Android app does.
