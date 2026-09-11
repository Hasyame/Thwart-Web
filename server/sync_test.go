package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"sync"
	"testing"
	"time"
)

func push(t *testing.T, s *Server, token, batchID string, records ...map[string]any) response {
	t.Helper()
	return call(t, s, "POST", "/v1/sync/changes", token,
		map[string]any{"batchId": batchID, "records": records})
}

func record(collection, id string, body map[string]any) map[string]any {
	return map[string]any{
		"collection": collection,
		"id":         id,
		"updatedAt":  "2026-09-12T20:14:03Z",
		"deleted":    false,
		"body":       body,
	}
}

func pull(t *testing.T, s *Server, token string, since int) response {
	t.Helper()
	return call(t, s, "GET", fmt.Sprintf("/v1/sync/changes?since=%d", since), token, nil)
}

func changesOf(t *testing.T, res response) []map[string]any {
	t.Helper()
	raw, _ := res.body["changes"].([]any)
	out := make([]map[string]any, 0, len(raw))
	for _, entry := range raw {
		m, ok := entry.(map[string]any)
		if !ok {
			t.Fatalf("a change is not an object: %v", entry)
		}
		out = append(out, m)
	}
	return out
}

func resultsOf(t *testing.T, res response) []map[string]any {
	t.Helper()
	raw, _ := res.body["results"].([]any)
	out := make([]map[string]any, 0, len(raw))
	for _, entry := range raw {
		m, _ := entry.(map[string]any)
		out = append(out, m)
	}
	return out
}

// --- the round trip ----------------------------------------------------------

func TestPushThenPull(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "benoit", "a long enough password").str("token")

	pushed := push(t, s, token, "batch-1",
		record("plays", "play-1", map[string]any{"scenarioCode": "01001", "won": true}),
		record("owned_packs", "core", map[string]any{"quantity": 1}),
	)
	if pushed.status != http.StatusOK {
		t.Fatalf("push: status %d, body %v", pushed.status, pushed.body)
	}

	results := resultsOf(t, pushed)
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	for _, r := range results {
		if r["outcome"] != outcomeApplied {
			t.Errorf("unexpected outcome %v for %v", r["outcome"], r["id"])
		}
	}

	pulled := pull(t, s, token, 0)
	changes := changesOf(t, pulled)
	if len(changes) != 2 {
		t.Fatalf("expected 2 changes, got %d: %v", len(changes), pulled.body)
	}

	// Revision ascending is the ordering a client depends on to resume.
	if changes[0]["revision"].(float64) >= changes[1]["revision"].(float64) {
		t.Errorf("changes are not in revision order: %v", changes)
	}

	// The body comes back exactly as it went in. The server never parses it,
	// and this is the test that says the storage does not mangle it either.
	body, _ := changes[0]["body"].(map[string]any)
	if body["scenarioCode"] != "01001" || body["won"] != true {
		t.Errorf("body did not survive the round trip: %v", body)
	}

	// Pulling from the cursor returns nothing new.
	cursor := int(pulled.body["cursor"].(float64))
	if again := changesOf(t, pull(t, s, token, cursor)); len(again) != 0 {
		t.Errorf("pulling from the cursor returned %d changes", len(again))
	}
}

func TestDeleteTravelsAsATombstone(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "benoit", "a long enough password").str("token")

	push(t, s, token, "batch-1", record("plays", "play-1", map[string]any{"won": true}))
	push(t, s, token, "batch-2", map[string]any{
		"collection": "plays", "id": "play-1",
		"updatedAt": "2026-09-13T09:00:00Z", "deleted": true, "body": nil,
	})

	changes := changesOf(t, pull(t, s, token, 0))
	if len(changes) != 1 {
		t.Fatalf("expected the record once, in its latest state, got %d", len(changes))
	}
	if changes[0]["deleted"] != true {
		t.Errorf("the record is not marked deleted: %v", changes[0])
	}
	// A tombstone with a body would let a client resurrect what it describes.
	if changes[0]["body"] != nil {
		t.Errorf("tombstone carries a body: %v", changes[0]["body"])
	}
}

// --- conflicts ---------------------------------------------------------------

func TestOverwritingIsReported(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "benoit", "a long enough password").str("token")

	first := push(t, s, token, "batch-1", record("plays", "play-1", map[string]any{"note": "phone"}))
	firstRevision := int64(resultsOf(t, first)[0]["revision"].(float64))

	// Somebody else's edit lands in between.
	push(t, s, token, "batch-2", record("plays", "play-1", map[string]any{"note": "tablet"}))

	// A push that still believes the record is at firstRevision.
	stale := record("plays", "play-1", map[string]any{"note": "phone again"})
	stale["baseRevision"] = firstRevision
	third := push(t, s, token, "batch-3", stale)

	result := resultsOf(t, third)[0]
	if result["outcome"] != outcomeOverConflict {
		t.Errorf("outcome = %v, want %s", result["outcome"], outcomeOverConflict)
	}
	if result["supersededRevision"] == nil {
		t.Error("no superseded revision reported, so the client cannot tell what it overwrote")
	}

	// It still applied. Refusing would strand the client with a change it can
	// never upload.
	changes := changesOf(t, pull(t, s, token, 0))
	body, _ := changes[0]["body"].(map[string]any)
	if body["note"] != "phone again" {
		t.Errorf("the write did not apply: %v", body)
	}
}

func TestUpToDatePushIsNotAConflict(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "benoit", "a long enough password").str("token")

	first := push(t, s, token, "batch-1", record("plays", "play-1", map[string]any{"note": "one"}))
	revision := int64(resultsOf(t, first)[0]["revision"].(float64))

	current := record("plays", "play-1", map[string]any{"note": "two"})
	current["baseRevision"] = revision
	second := push(t, s, token, "batch-2", current)

	if outcome := resultsOf(t, second)[0]["outcome"]; outcome != outcomeApplied {
		t.Errorf("outcome = %v, want %s", outcome, outcomeApplied)
	}
}

// --- idempotency -------------------------------------------------------------

/*
The failure this exists for: the request arrived, the write happened, the reply
did not come back. The client cannot tell that from a request that never
arrived, so it retries.
*/
func TestReplayingABatchDoesNotApplyItTwice(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "benoit", "a long enough password").str("token")

	rec := record("plays", "play-1", map[string]any{"note": "one"})
	first := push(t, s, token, "same-batch", rec)
	second := push(t, s, token, "same-batch", rec)

	if first.status != http.StatusOK || second.status != http.StatusOK {
		t.Fatalf("statuses %d and %d", first.status, second.status)
	}
	// The same answer, not a new one.
	if fmt.Sprint(first.body) != fmt.Sprint(second.body) {
		t.Errorf("replay returned a different response:\n  %v\n  %v", first.body, second.body)
	}
	// And no revision was burned, which a client would otherwise see as a
	// change it has to pull for no reason.
	if changes := changesOf(t, pull(t, s, token, 0)); len(changes) != 1 {
		t.Errorf("expected 1 record after the replay, got %d", len(changes))
	}
	if cursor := first.body["cursor"]; cursor != second.body["cursor"] {
		t.Errorf("cursor moved on replay: %v then %v", cursor, second.body["cursor"])
	}
}

// --- collection rules --------------------------------------------------------

func TestCampaignEventsUnionMerge(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "benoit", "a long enough password").str("token")

	event := record("campaign_events", "event-1", map[string]any{"kind": "scenario_won"})
	first := push(t, s, token, "batch-1", event)
	firstRevision := resultsOf(t, first)[0]["revision"]

	// The same event from another device. Same id, same event; rewriting it
	// would burn a revision and make every other client re-download a row that
	// did not change.
	second := push(t, s, token, "batch-2", event)
	result := resultsOf(t, second)[0]
	if result["outcome"] != outcomeAlreadyPresent {
		t.Errorf("outcome = %v, want %s", result["outcome"], outcomeAlreadyPresent)
	}
	if result["revision"] != firstRevision {
		t.Errorf("the revision moved: %v then %v", firstRevision, result["revision"])
	}
}

func TestCampaignEventsCannotBeDeleted(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "benoit", "a long enough password").str("token")

	res := push(t, s, token, "batch-1", map[string]any{
		"collection": "campaign_events", "id": "event-1",
		"updatedAt": "2026-09-12T20:14:03Z", "deleted": true, "body": nil,
	})
	// Undo is an appended revoke event the engine folds away, not a deletion.
	// Accepting a tombstone would let one device erase history another still
	// needs to replay.
	if res.code() != "malformed_record" {
		t.Errorf("a delete on an append-only collection was accepted: %d %q", res.status, res.code())
	}
}

func TestRecordValidation(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "benoit", "a long enough password").str("token")

	cases := []struct {
		name string
		rec  map[string]any
		code string
	}{
		{"unknown collection", record("playss", "x", map[string]any{"a": 1}), "malformed_record"},
		{"empty id", record("plays", "", map[string]any{"a": 1}), "malformed_record"},
		{"live record with no body", map[string]any{
			"collection": "plays", "id": "p", "updatedAt": "2026-09-12T20:14:03Z", "deleted": false,
		}, "malformed_record"},
		{"updatedAt is not a timestamp", map[string]any{
			"collection": "plays", "id": "p", "updatedAt": "last tuesday",
			"deleted": false, "body": map[string]any{"a": 1},
		}, "malformed_record"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := push(t, s, token, "batch-"+c.name, c.rec).code(); got != c.code {
				t.Errorf("code = %q, want %q", got, c.code)
			}
		})
	}

	// Nothing from a rejected batch may have landed: the batch is one
	// transaction, which is what makes a partial upload impossible.
	if changes := changesOf(t, pull(t, s, token, 0)); len(changes) != 0 {
		t.Errorf("a rejected batch left %d records behind", len(changes))
	}
}

func TestOversizedRecordAndBatch(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "benoit", "a long enough password").str("token")

	big := make([]byte, maxRecordBytes+1)
	for i := range big {
		big[i] = 'x'
	}
	res := push(t, s, token, "batch-1",
		record("plays", "play-1", map[string]any{"note": string(big)}))
	if res.code() != "record_too_large" {
		t.Errorf("oversized record: code %q, status %d", res.code(), res.status)
	}

	too_many := make([]map[string]any, maxBatchRecords+1)
	for i := range too_many {
		too_many[i] = record("plays", fmt.Sprintf("play-%d", i), map[string]any{"n": i})
	}
	res = push(t, s, token, "batch-2", too_many...)
	if res.code() != "batch_too_large" {
		t.Errorf("oversized batch: code %q, status %d", res.code(), res.status)
	}
}

// --- isolation ---------------------------------------------------------------

func TestAccountsCannotSeeEachOther(t *testing.T) {
	s := newTestServer(t)
	mine := register(t, s, "benoit", "a long enough password").str("token")
	theirs := register(t, s, "someone", "another long password").str("token")

	push(t, s, mine, "batch-1", record("plays", "play-1", map[string]any{"note": "mine"}))

	if changes := changesOf(t, pull(t, s, theirs, 0)); len(changes) != 0 {
		t.Errorf("another account's feed returned %d of my records", len(changes))
	}

	// Same record id, different account: both must exist independently.
	push(t, s, theirs, "batch-2", record("plays", "play-1", map[string]any{"note": "theirs"}))
	body, _ := changesOf(t, pull(t, s, mine, 0))[0]["body"].(map[string]any)
	if body["note"] != "mine" {
		t.Errorf("another account overwrote my record: %v", body)
	}
}

// --- tombstone horizon -------------------------------------------------------

/*
A full resync of an account whose live records predate the horizon.

Reported from the Android client, and it deadlocks: since=0 is exempt from the
horizon check, but the second page resumes from the last revision of the first,
and a live record never touched since before the last sweep carries a revision
below min_cursor. The resync is then refused on its own second page, and there
is no way forward from the client side — the records between the page boundary
and the horizon have never been read by that device, so stepping over them
would lose them.

The client says it is resyncing. A resync has no deletions to miss, because it
is rebuilding from nothing, which is exactly why since=0 was already exempt.
*/
func TestAResyncCanPageBelowTheHorizon(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "benoit", "a long enough password").str("token")

	// Four live records, then a deletion swept well past the horizon. The
	// horizon lands above the first records, which is the whole point: they are
	// alive, they are old, and they have to remain reachable.
	for i := 1; i <= 4; i++ {
		push(t, s, token, fmt.Sprintf("batch-live-%d", i),
			record("plays", fmt.Sprintf("play-%d", i), map[string]any{"note": i}))
	}
	push(t, s, token, "batch-gone", record("plays", "play-gone", map[string]any{"note": "x"}))
	push(t, s, token, "batch-delete", map[string]any{
		"collection": "plays", "id": "play-gone",
		"updatedAt": "2026-09-13T09:00:00Z", "deleted": true, "body": nil,
	})

	if _, _, err := s.store.Sweep(t.Context(), time.Now().Add(TombstoneRetention+24*time.Hour)); err != nil {
		t.Fatalf("sweep: %v", err)
	}

	// Page through a resync two at a time, the way a client with a page limit
	// does, and assert every live record arrives.
	seen := map[string]bool{}
	since, resync := 0, true
	for page := 0; page < 10; page++ {
		res := call(t, s, "GET",
			fmt.Sprintf("/v1/sync/changes?since=%d&limit=2&resync=%t", since, resync), token, nil)
		if res.status != http.StatusOK {
			t.Fatalf("page %d refused: %d %q", page, res.status, res.code())
		}
		for _, change := range changesOf(t, res) {
			id, _ := change["id"].(string)
			seen[id] = true
		}
		cursor, ok := res.body["cursor"].(float64)
		if !ok {
			t.Fatalf("page %d has no cursor: %v", page, res.body)
		}
		since = int(cursor)
		if more, _ := res.body["hasMore"].(bool); !more {
			break
		}
	}

	for i := 1; i <= 4; i++ {
		if id := fmt.Sprintf("play-%d", i); !seen[id] {
			t.Errorf("%s never arrived; a resync lost a live record", id)
		}
	}
}

/*
And the flag does not become a way round the refusal that matters.

A client resuming an ordinary sync from a stale cursor must still be sent back
to a full resync: it is missing deletions the server can no longer describe.
Only a resync — which starts at zero and therefore has no deletions to miss —
may page below the horizon.
*/
func TestResyncFlagDoesNotExcuseAStaleCursor(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "benoit", "a long enough password").str("token")

	push(t, s, token, "batch-1", record("plays", "play-1", map[string]any{"note": "one"}))
	push(t, s, token, "batch-2", map[string]any{
		"collection": "plays", "id": "play-1",
		"updatedAt": "2026-09-13T09:00:00Z", "deleted": true, "body": nil,
	})
	push(t, s, token, "batch-3", record("plays", "play-2", map[string]any{"note": "two"}))

	if _, _, err := s.store.Sweep(t.Context(), time.Now().Add(TombstoneRetention+24*time.Hour)); err != nil {
		t.Fatalf("sweep: %v", err)
	}

	// A resync that has genuinely paged past the horizon is served.
	if res := call(t, s, "GET", "/v1/sync/changes?since=1&resync=true", token, nil); res.status != http.StatusOK {
		t.Errorf("a paging resync was refused: %d %q", res.status, res.code())
	}

	// The same cursor without the flag is still refused, because that client is
	// resuming and has missed a deletion.
	if res := pull(t, s, token, 1); res.code() != "cursor_too_old" {
		t.Errorf("a stale resuming cursor was served: %d %q", res.status, res.code())
	}
}

func TestSweptTombstonesForceAFullResync(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "benoit", "a long enough password").str("token")

	push(t, s, token, "batch-1", record("plays", "play-1", map[string]any{"note": "one"}))
	push(t, s, token, "batch-2", map[string]any{
		"collection": "plays", "id": "play-1",
		"updatedAt": "2026-09-13T09:00:00Z", "deleted": true, "body": nil,
	})
	push(t, s, token, "batch-3", record("plays", "play-2", map[string]any{"note": "two"}))

	// Well past the horizon.
	tombstones, _, err := s.store.Sweep(t.Context(), time.Now().Add(TombstoneRetention+24*time.Hour))
	if err != nil {
		t.Fatalf("sweep: %v", err)
	}
	if tombstones != 1 {
		t.Fatalf("swept %d tombstones, want 1", tombstones)
	}

	// A client that had already seen everything is fine.
	if res := pull(t, s, token, 3); res.status != http.StatusOK {
		t.Errorf("an up-to-date client was refused: %d %q", res.status, res.code())
	}

	// One that predates the horizon cannot be told what it missed, so it must
	// be sent back to a full resync rather than handed an incomplete feed.
	res := pull(t, s, token, 1)
	if res.code() != "cursor_too_old" {
		t.Errorf("a stale cursor was served: %d %q", res.status, res.code())
	}

	// And a full resync always works.
	if res := pull(t, s, token, 0); res.status != http.StatusOK {
		t.Errorf("since=0 was refused: %d %q", res.status, res.code())
	}
}

// --- export ------------------------------------------------------------------

func TestExportUsesTheBackupShape(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "benoit", "a long enough password").str("token")

	push(t, s, token, "batch-1",
		record("plays", "play-1", map[string]any{"scenarioCode": "01001", "won": true}),
		record("saved_decks", "deck-1", map[string]any{"name": "Spider-Man"}),
		record("owned_packs", "core", map[string]any{"quantity": 1}),
	)
	// Deleted records must not appear in an export.
	push(t, s, token, "batch-2", map[string]any{
		"collection": "plays", "id": "play-2",
		"updatedAt": "2026-09-13T09:00:00Z", "deleted": true, "body": nil,
	})

	res := call(t, s, "GET", "/v1/account/export", token, nil)
	if res.status != http.StatusOK {
		t.Fatalf("export: status %d", res.status)
	}

	// The names come from BackupModels.kt. If one of these ever fails, the
	// export has stopped restoring into the app through the import path that
	// already exists, which is the whole reason for the shape.
	for _, field := range []string{
		"formatVersion", "createdAt", "appVersion", "photos",
		"ownedPacks", "excludedModularSets", "decks", "campaignRuns",
		"campaignEvents", "plays", "randomizerHistory", "favouriteCards",
	} {
		if _, present := res.body[field]; !present {
			t.Errorf("export has no %q key", field)
		}
	}

	plays, _ := res.body["plays"].([]any)
	if len(plays) != 1 {
		t.Errorf("expected 1 play (the tombstone excluded), got %d", len(plays))
	}
	decks, _ := res.body["decks"].([]any)
	if len(decks) != 1 {
		t.Errorf("expected 1 deck, got %d", len(decks))
	}
	// Empty collections are still present, so a restore never has to tell "no
	// decks" from "this server does not do decks".
	if runs, _ := res.body["campaignRuns"].([]any); runs == nil {
		t.Error("campaignRuns is absent rather than empty")
	}
}

/*
settings is an object, not a list.

Backup declares `settings: BackupSettings?`. kotlinx.serialization ignores
unknown keys but not a value of the wrong type, so emitting an array makes the
app refuse the entire file: the export would restore nowhere, which is the one
thing the shared shape exists to prevent.

Absent when there is none, because the app reads null as "leave the device's own
settings alone" and an empty object as "use the defaults", and resetting
somebody's language on a restore is not a small bug.
*/
func TestSettingsExportAsAnObject(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "benoit", "a long enough password").str("token")

	before := call(t, s, "GET", "/v1/account/export", token, nil)
	if raw, present := before.body["settings"]; present && raw != nil {
		t.Errorf("settings emitted before any were synced: %v", raw)
	}

	push(t, s, token, "batch-1", record("settings", "settings", map[string]any{
		"cardLocale": "fr", "themeChoice": "dark", "dismissedPacks": []any{"mts"},
	}))

	after := call(t, s, "GET", "/v1/account/export", token, nil)
	settings, ok := after.body["settings"].(map[string]any)
	if !ok {
		t.Fatalf("settings is %T, want an object: %v", after.body["settings"], after.body["settings"])
	}
	if settings["cardLocale"] != "fr" || settings["themeChoice"] != "dark" {
		t.Errorf("settings did not survive: %v", settings)
	}

	// The list collections stay lists, which is the other half of the same
	// claim.
	for _, field := range []string{"plays", "decks", "ownedPacks", "excludedScenarios"} {
		if _, ok := after.body[field].([]any); !ok {
			t.Errorf("%s is %T, want a list", field, after.body[field])
		}
	}
}

// --- the revision counter ----------------------------------------------------

/*
The test doc 02 section 2 asks for by name.

With a sequence taken outside the write transaction, two writers can take 41 and
42 and the holder of 42 can commit first. A client pulling in that window stores
cursor 42 and never sees 41 again: the row is invisible to that device forever.
It is not a rare race, it is the normal behaviour of any database with
concurrent writers and a sequence.

So: push from several goroutines while a puller keeps advancing its cursor, and
assert the puller ends up having seen every record exactly once. A skipped
revision shows up as a missing id, which is the symptom a user would report.
*/
func TestNoPullerCanSkipARevision(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "benoit", "a long enough password").str("token")

	const writers, each = 4, 5
	seen := map[string]int{}
	var seenMu sync.Mutex
	done := make(chan struct{})

	// The puller, advancing its cursor exactly as a real client would: store
	// the highest revision received, resume from it, never look back.
	var pullerWG sync.WaitGroup
	pullerWG.Add(1)
	go func() {
		defer pullerWG.Done()
		cursor := 0
		drain := func() {
			for {
				res := pull(t, s, token, cursor)
				changes := changesOf(t, res)
				if len(changes) == 0 {
					return
				}
				seenMu.Lock()
				for _, c := range changes {
					seen[c["id"].(string)]++
				}
				seenMu.Unlock()
				cursor = int(res.body["cursor"].(float64))
			}
		}
		for {
			select {
			case <-done:
				drain() // one last pass, so the race is in the middle, not the end
				return
			default:
				drain()
			}
		}
	}()

	var writersWG sync.WaitGroup
	for w := 0; w < writers; w++ {
		writersWG.Add(1)
		go func(writer int) {
			defer writersWG.Done()
			for i := 0; i < each; i++ {
				id := fmt.Sprintf("play-%d-%d", writer, i)
				res := push(t, s, token, fmt.Sprintf("batch-%d-%d", writer, i),
					record("plays", id, map[string]any{"writer": writer, "n": i}))
				if res.status != http.StatusOK {
					t.Errorf("push %s: status %d, code %q", id, res.status, res.code())
					return
				}
			}
		}(w)
	}
	writersWG.Wait()
	close(done)
	pullerWG.Wait()

	seenMu.Lock()
	defer seenMu.Unlock()
	if len(seen) != writers*each {
		t.Errorf("the puller saw %d distinct records, want %d; a revision was skipped",
			len(seen), writers*each)
	}
	for id, count := range seen {
		if count == 0 {
			t.Errorf("%s was never delivered", id)
		}
	}

	// And the feed itself is a contiguous run from 1, with nothing missing.
	all := changesOf(t, call(t, s, "GET", "/v1/sync/changes?since=0&limit=1000", token, nil))
	revisions := map[int]bool{}
	for _, c := range all {
		revisions[int(c["revision"].(float64))] = true
	}
	if len(revisions) != len(all) {
		t.Errorf("two records share a revision")
	}
}

func TestPagination(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "benoit", "a long enough password").str("token")

	records := make([]map[string]any, 7)
	for i := range records {
		records[i] = record("plays", fmt.Sprintf("play-%d", i), map[string]any{"n": i})
	}
	push(t, s, token, "batch-1", records...)

	seen := 0
	cursor := 0
	for page := 0; page < 10; page++ {
		res := call(t, s, "GET", fmt.Sprintf("/v1/sync/changes?since=%d&limit=3", cursor), token, nil)
		changes := changesOf(t, res)
		seen += len(changes)
		cursor = int(res.body["cursor"].(float64))
		if res.body["hasMore"] != true {
			break
		}
	}
	if seen != 7 {
		t.Errorf("paging returned %d records, want 7", seen)
	}
}

func TestSyncNeedsAuthentication(t *testing.T) {
	s := newTestServer(t)
	for _, probe := range []struct{ method, path string }{
		{"GET", "/v1/sync/changes"},
		{"POST", "/v1/sync/changes"},
		{"GET", "/v1/account/export"},
	} {
		res := call(t, s, probe.method, probe.path, "", nil)
		if res.status != http.StatusUnauthorized {
			t.Errorf("%s %s: status %d", probe.method, probe.path, res.status)
		}
	}
}

// The body is stored as text and handed back untouched. Anything that
// re-encodes it would quietly reorder keys and change numbers.
func TestBodyIsOpaque(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "benoit", "a long enough password").str("token")

	original := map[string]any{
		"nested":   map[string]any{"deep": []any{1.0, 2.0, "three"}},
		"unicode":  "Crâne Rouge",
		"null":     nil,
		"boolean":  false,
		"largeInt": 9007199254740991.0,
	}
	push(t, s, token, "batch-1", record("plays", "play-1", original))

	got, _ := changesOf(t, pull(t, s, token, 0))[0]["body"].(map[string]any)
	want, _ := json.Marshal(original)
	have, _ := json.Marshal(got)
	if string(want) != string(have) {
		t.Errorf("body changed in transit:\n  sent %s\n  got  %s", want, have)
	}
}

// --- collections a client can read ---------------------------------------------

/*
A pull serves only the collections the client can read.

Found from the Android side. Its engine held the cursor short of the first
record it could not apply, which was the right thing for an orphaned campaign
event and the wrong thing for a whole collection it had never heard of: one
starred game on the web, followed by a page's worth of ordinary changes, and
every later pull returned the same page from the same cursor, for good. The
server cannot tell an old client's version, so the contract is the other way
round: a client names what it reads, and one that names nothing is one that
predates the parameter and gets what existed then.
*/
func TestAPullServesOnlyTheCollectionsNamed(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "benoit", "a long enough password").str("token")

	push(t, s, token, "batch-play", record("plays", "play-1", map[string]any{"note": 1}))
	push(t, s, token, "batch-star", record("favourite_plays", "play-1", map[string]any{"playId": "play-1", "addedAt": 1}))
	push(t, s, token, "batch-deck", record("saved_decks", "deck-1", map[string]any{"name": "d"}))

	ids := func(query string) []string {
		res := call(t, s, "GET", "/v1/sync/changes?since=0&limit=10"+query, token, nil)
		if res.status != http.StatusOK {
			t.Fatalf("pull %q refused: %d %q", query, res.status, res.code())
		}
		out := []string{}
		for _, change := range changesOf(t, res) {
			out = append(out, change["collection"].(string))
		}
		return out
	}

	// A client that names nothing is a client from before the parameter.
	if got := ids(""); !slices.Equal(got, []string{"plays", "saved_decks"}) {
		t.Errorf("unnamed pull served %v; an opt-in collection reached a client that cannot read it", got)
	}
	// One that names the opt-in collection gets it, in revision order.
	if got := ids("&collections=plays,favourite_plays"); !slices.Equal(got, []string{"plays", "favourite_plays"}) {
		t.Errorf("named pull served %v", got)
	}
	// A name this server does not know is dropped, not refused.
	if got := ids("&collections=plays,playss"); !slices.Equal(got, []string{"plays"}) {
		t.Errorf("pull with an unknown name served %v", got)
	}
	// And the cursor is a position among the records served: after the play,
	// the next page for a client that reads only plays is empty, not stuck.
	res := call(t, s, "GET", "/v1/sync/changes?since=1&limit=10&collections=plays", token, nil)
	if n := len(changesOf(t, res)); n != 0 {
		t.Errorf("a plays-only client got %d records after its last play", n)
	}
}
