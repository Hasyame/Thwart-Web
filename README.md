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

Design documents live in [`docs/design/`](docs/design/). They come first: the
data audit, the sync protocol, the stack decision, the roadmap and the
operations plan are all written before any application code is.

## Legal

Licensed under the MIT licence, as Thwart is.

Marvel Champions card text and images belong to Fantasy Flight Games and to
Marvel. Nothing in this repository bundles or re-hosts them, and the server
never will: it stores what a player has made — which packs they own, which
decks they saved, which games they played — and refers to cards by code, the
same way the Android app does.
