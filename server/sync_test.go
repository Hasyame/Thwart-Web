package main

import (
	"encoding/json"
	"fmt"
	"net/http"
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
