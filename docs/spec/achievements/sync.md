# Achievements — export and sync

## 1. What changes, and what does not

Achievement state is derived and is **never** exported, synced, or
imported. The only contract change is the play record (data-model.md §3),
because the derivation needs three facts the record did not carry:

| field | on | type | v1 reading |
|---|---|---|---|
| `roster[].isOwner` | play seat | boolean, optional | absent → the first seat is the owner |
| `mode` | play | string, optional | absent → ordinary game |
| `difficulty` | play | string, existing | empty or unrecognised → level `unknown`, never `standard` |

`campaignRunId` already exists and is kept as is.

## 2. Backup format

`formatVersion` goes from **1 to 2**, on both clients in the same
release. Reader rules, identical on both sides:

- **Read 1 and 2.** A v1 file imports with the readings above.
- **Write 2.** Every export carries `formatVersion: 2` and the new fields
  where the record has them.
- **Preserve unknown fields.** A client that reads a file with a
  `formatVersion` higher than it writes, or any record carrying keys it
  does not know, keeps those keys on the stored record and writes them
  back on export, untouched. It never drops them, never reorders their
  meaning, and never fails the import because of them. This rule is
  mandatory and is the reason the bump is safe: a phone one release behind
  round-trips a v2 file without losing `mode` or `isOwner`.
- A file whose `formatVersion` is **lower** than a client's is upgraded on
  import by the readings above; the client does not rewrite the file.

Implementation note for unknown-field preservation: store each record's
unrecognised keys beside the typed fields (a JSON `extra` map on the
entity, or the raw object kept whole), and spread them back into the
exported record after the known fields. Known fields always win over an
`extra` key of the same name.

### Round-trip fixtures

Each repository keeps the **other** platform's export as a fixture and
asserts, in its test suite, that importing it and exporting again yields a
file equal to the fixture field for field (key order aside), including
fields the importer does not know. Web: `web/scripts/fixtures/backup-android-v2.json`.
Android: `app/src/test/resources/backup-web-v2.json`.

## 3. Sync

The `plays` collection carries the play record as a JSON body and hashes
the whole body. Adding `isOwner` and `mode`:

- A client that writes them includes them in the body; the hash changes,
  which is a change like any other.
- A client that does not know them **must carry them through**: on
  receiving a record with unknown keys it stores them (the `extra` map
  above) and includes them, unchanged, in any body it sends back for that
  record. Otherwise the older client's next edit would silently strip the
  newer client's fields, and the newer client would see its own change
  reverted.
- Merge rule is the existing one, last write by `updatedAt`, applied to
  the record as a whole. There is no field-level merge: a record is one
  body.
- No new collection. Achievement state is not synced; each device derives
  it from what it has, and two devices in sync derive the same state.

## 4. Definitions file versioning

`achievements.json` (data-model.md §4):

- The web repository is the master; the file is fetched with the card
  data on the web and **bundled as a snapshot** on Android
  (`assets/achievements.json`) with the `definitionsVersion` it shipped
  with recorded in the build. Android never fetches it at runtime in v1.
- A test on Android asserts the bundled snapshot is byte-identical to the
  web file at the tagged commit the release was built from.
- `schemaVersion` higher than the client understands → the client refuses
  the file and shows the achievements page as unavailable, with the
  reason; the rest of the app is unaffected.
- `definitionsVersion` is informational: any value loads.
- `difficultyScaleVersion` mismatch → refused like a schema mismatch.

## 5. Migration of stored data

None. Existing plays are read with the v1 readings; nothing is rewritten
in place. A play recorded from now on carries `isOwner` on its owner seat
and `mode` when applicable. Old plays therefore have level `unknown` only
when their `difficulty` string was empty or unrecognised — most carry a
recognisable string already and keep their level.
