package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
)

/*
The sync endpoints.

Three of them: pull, push, and the export. Doc 02 sections 3 to 6 specify the
behaviour; this file tries to make each decision visible at the point it is
taken rather than restating the document.

The server is deliberately ignorant of the data. It stores a collection name, an
id, and a body it never parses. Every rule that needs to know what a play or a
deck is (doc 02 section 4: reportedToBgg, the favourite tie-break, the saved_decks
fork) lives in the client. That is what lets Android add an entity without a
server release.
*/

// Published in /v1/version so a client does not have to guess, and enforced
// here so a client that guesses wrong is told rather than half-served.
const (
	maxBatchRecords = 500
	maxBatchBytes   = 2 << 20   // 2 MiB
	maxRecordBytes  = 256 << 10 // 256 KiB
	defaultPageSize = 500
	maxPageSize     = 1000
)

type collectionSpec struct {
	// The field this collection occupies in the app's Backup document.
	backupField string
	// Union-merged and never rewritten: campaign_events only. Doc 02 section 4.
	immutable bool
	// One record, and an object rather than a list in Backup. Only settings.
	single bool
	/*
		Sent on a pull only to a client that names it.

		A collection added after clients were already in the field. A pull
		that does not say which collections it wants is such a client, and it
		gets the collections that existed when it was built. Sending it a
		record it cannot read is not harmless: the phone's engine held its
		cursor short of the first record it could not apply, so one such
		record, followed by a page's worth of ordinary changes, stalled its
		sync for good on the same page. See the `collections` parameter in
		handlePull.
	*/
	optIn bool
}

/*
The collections, and nothing else.

An allow-list rather than accepting any name. The body is opaque, but the
collection name is not: it is a key the export maps to a Backup field, and a
client bug inventing "playss" would otherwise create a silent second collection
that syncs perfectly and restores nowhere.

The field names come from BackupModels.kt, field for field. Doc 01 section 7
argues why they must: the server's export has to restore into the app through
the import path that already exists and is already tested.
*/
var collections = map[string]collectionSpec{
	"owned_packs":           {backupField: "ownedPacks"},
	"excluded_modular_sets": {backupField: "excludedModularSets"},
	"saved_decks":           {backupField: "decks"},
	"campaign_runs":         {backupField: "campaignRuns"},
	"campaign_events":       {backupField: "campaignEvents", immutable: true},
	"plays":                 {backupField: "plays"},
	"randomizer_history":    {backupField: "randomizerHistory"},
	"favourite_cards":       {backupField: "favouriteCards"},
	// Starred games. The phone does not know this one yet and defers it; the
	// web has synced it since 2026-09-11. Not listing it here would refuse the
	// whole batch it arrives in — this map is the push's allowlist as well as
	// the export's table of contents.
	"favourite_plays": {backupField: "favouritePlays", optIn: true},
	// Difficulty ratings. Validated and indexed on the way in; see ratings.go.
	"ratings": {backupField: "ratings", optIn: true},

	"excluded_scenarios": {backupField: "excludedScenarios"},

	// Not a list. Backup declares `settings: BackupSettings?`, a single
	// nullable object, and kotlinx.serialization ignores unknown *keys* but
	// not a value of the wrong type: emitting an array here makes the app
	// refuse the whole file. Doc 02 section 4 agrees on the shape, calling
	// settings "one record, last-write-wins per key".
	"settings": {backupField: "settings", single: true},
}

// --- pull --------------------------------------------------------------------

func (s *Server) handlePull(w http.ResponseWriter, r *http.Request, sess session) {
	since, err := int64Param(r, "since", 0)
	if err != nil || since < 0 {
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "malformed_record"})
		return
	}
	limit, err := intParam(r, "limit", defaultPageSize)
	if err != nil || limit <= 0 {
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "malformed_record"})
		return
	}
	limit = min(limit, maxPageSize)

	/*
		Whether this pull is one page of a full resynchronisation.

		A claim the client makes, because it is the only party that can: this
		server is stateless between requests and cannot tell "resuming from an
		old cursor" from "paging through a resync that started at zero". It is
		not a privilege — a client that claims it falsely only serves itself an
		incomplete feed, which is precisely what the refusal below exists to
		spare it.
	*/
	resync, err := boolParam(r, "resync")
	if err != nil {
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "malformed_record"})
		return
	}

	minCursor, err := s.store.MinCursor(r.Context(), sess.account.ID)
	if err != nil {
		s.fail(w, r, "read min cursor", err)
		return
	}

	/*
		Refused rather than half-served.

		Doc 02 section 3 says publishing minCursor lets a client notice this for
		itself, which is true, and section 5 says such a client must full-resync.
		Between "tell it and hope it checks" and "refuse and say why", refuse:
		a client that missed the check would otherwise receive a feed that looks
		complete and is not, and the deletions it never hears about come back
		from the dead. since=0 is exempt because it is the full resync.

		So is every later page of that same resync, and forgetting them was a
		bug: page two resumes from the last revision of page one, and a live
		record untouched since before the last sweep carries a revision below
		the horizon. A large account then failed on its own second page with no
		way forward — the client cannot step over the gap, because those records
		have never reached it. A resync is rebuilding from nothing and so has no
		deletion to miss, which is the same reason since=0 was already exempt.
	*/
	if since > 0 && !resync && since < minCursor {
		writeError(w, r, apiError{
			status:  http.StatusConflict,
			code:    "cursor_too_old",
			details: map[string]any{"minCursor": minCursor},
		})
		return
	}

	/*
		Which collections this client can read.

		Named by the client, comma separated, or defaulted to the ones that
		predate the parameter for a client that does not send it. A name the
		server does not know is dropped rather than refused: a client one
		release ahead of this server is the ordinary case for a self-hosted
		instance, and refusing its pull would stop everything else too.

		The cursor the client keeps is then only a position among the
		collections it asked for. A build that asks for more than the one
		before it has to pull from zero once, which both clients do when the
		set they declare changes; the records it never asked for are exactly
		the ones its cursor already passed.
	*/
	wanted := pullCollections(r.URL.Query().Get("collections"))

	changes, err := s.store.Changes(r.Context(), sess.account.ID, since, limit, wanted)
	if err != nil {
		s.fail(w, r, "read changes", err)
		return
	}

	cursor := since
	if len(changes) > 0 {
		// The last one, because the query orders by revision.
		cursor = changes[len(changes)-1].Revision
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"changes": changes,
		"cursor":  cursor,
		// A full page means there may be more. Saying "maybe" rather than
		// counting the remainder keeps the query to one index scan.
		"hasMore":   len(changes) == limit,
		"minCursor": minCursor,
	})
}

// --- push --------------------------------------------------------------------

type pushRequest struct {
	BatchID string           `json:"batchId"`
	Records []IncomingRecord `json:"records"`
}

func (s *Server) handlePush(w http.ResponseWriter, r *http.Request, sess session) {
	// Larger than the account endpoints allow, and checked again below against
	// the published batch limit so the error is the specific one.
	r.Body = http.MaxBytesReader(w, r.Body, maxBatchBytes+64<<10)

	var body pushRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&body); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeError(w, r, apiError{
				status:  http.StatusRequestEntityTooLarge,
				code:    "batch_too_large",
				details: map[string]any{"maxBytes": maxBatchBytes},
			})
			return
		}
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "malformed_record"})
		return
	}

	if body.BatchID == "" || len(body.BatchID) > 128 {
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "malformed_record"})
		return
	}
	if len(body.Records) > maxBatchRecords {
		writeError(w, r, apiError{
			status:  http.StatusRequestEntityTooLarge,
			code:    "batch_too_large",
			details: map[string]any{"maxRecords": maxBatchRecords, "sent": len(body.Records)},
		})
		return
	}
	if bad, err := validateRecords(body.Records); err != nil {
		writeError(w, r, *bad)
		return
	}

	/*
		Idempotency, before anything is written.

		A phone whose request arrived and whose reply did not cannot tell that
		from a request that never arrived, so it retries. Returning the stored
		response makes the retry a no-op instead of a second copy of every row
		in the batch.
	*/
	if stored, found, err := s.store.BatchResponse(r.Context(), sess.account.ID, body.BatchID); err != nil {
		s.fail(w, r, "read batch response", err)
		return
	} else if found {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		// So a client can tell a replay from a fresh application, which matters
		// when it is deciding whether its own retry logic is working.
		w.Header().Set("Idempotent-Replay", "true")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(stored)
		return
	}

	/*
		Ratings per account per day, refused one by one.

		The limiter is the server's, not the store's, so it is applied here: a
		rating over the day's allowance is answered `rejected`/`rate_limited`
		and taken out of the batch before the store sees it, in place, so the
		plays beside it still land and the result list keeps its order.
	*/
	limited := map[int]bool{}
	kept := make([]IncomingRecord, 0, len(body.Records))
	for i, rec := range body.Records {
		if rec.Collection == "ratings" && !rec.Deleted &&
			!s.limiter.allow("ratings:"+sess.account.ID, ratingsPerAccountDay) {
			limited[i] = true
			continue
		}
		kept = append(kept, rec)
	}

	applied, cursor, err := s.store.ApplyBatch(r.Context(), sess.account.ID, kept)
	if err != nil {
		s.fail(w, r, "apply batch", err)
		return
	}

	results := make([]RecordResult, 0, len(body.Records))
	next := 0
	for i, rec := range body.Records {
		if limited[i] {
			results = append(results, RecordResult{ID: rec.ID, Collection: rec.Collection, Outcome: outcomeRejected, Reason: reasonRateLimited})
			continue
		}
		results = append(results, applied[next])
		next++
	}

	// A summary served from memory must not outlive the rating that changed
	// it. Forgotten after the commit, so the next read is the new truth.
	for _, res := range results {
		if res.Collection == "ratings" && res.Outcome != outcomeRejected {
			s.summaries.forget(res.ID)
		}
	}

	/*
		Tell this account's other devices, after the transaction has committed.

		After, never inside: a listener told about a revision the write then
		failed to land would pull and find nothing, and record a cursor ahead of
		what exists. `notify` never blocks, so a slow listener cannot hold up
		this response.
	*/
	s.streams.notify(sess.account.ID, cursor)

	response, err := json.Marshal(map[string]any{"cursor": cursor, "results": results})
	if err != nil {
		s.fail(w, r, "encode batch response", err)
		return
	}
	// Best effort. Failing to remember the response is a reason to duplicate on
	// a retry, which is bad, but refusing a batch that has already been written
	// is worse: the client would retry that too, forever.
	if err := s.store.SaveBatchResponse(r.Context(), sess.account.ID, body.BatchID, response); err != nil {
		s.log.Error("save batch response", "error", err, "account", sess.account.ID)
	}

	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(response)
}

func validateRecords(records []IncomingRecord) (*apiError, error) {
	total := 0
	for _, rec := range records {
		spec, known := collections[rec.Collection]
		if !known {
			return &apiError{
				status:  http.StatusBadRequest,
				code:    "malformed_record",
				details: map[string]any{"id": rec.ID, "collection": rec.Collection, "why": "unknown collection"},
			}, errors.New("unknown collection")
		}
		if rec.ID == "" || len(rec.ID) > 200 {
			return &apiError{
				status:  http.StatusBadRequest,
				code:    "malformed_record",
				details: map[string]any{"collection": rec.Collection, "why": "missing or oversized id"},
			}, errors.New("bad id")
		}
		// campaign_events are append-only by design: undo is an appended
		// revoke event the engine folds away, not a deletion. Accepting a
		// tombstone here would let one device erase history another still
		// needs to replay.
		if spec.immutable && rec.Deleted {
			return &apiError{
				status:  http.StatusBadRequest,
				code:    "malformed_record",
				details: map[string]any{"id": rec.ID, "collection": rec.Collection, "why": "collection is append-only"},
			}, errors.New("delete on append-only collection")
		}
		if !rec.Deleted && len(rec.Body) == 0 {
			return &apiError{
				status:  http.StatusBadRequest,
				code:    "malformed_record",
				details: map[string]any{"id": rec.ID, "collection": rec.Collection, "why": "a live record needs a body"},
			}, errors.New("missing body")
		}
		if len(rec.Body) > maxRecordBytes {
			return &apiError{
				status:  http.StatusRequestEntityTooLarge,
				code:    "record_too_large",
				details: map[string]any{"id": rec.ID, "collection": rec.Collection, "maxBytes": maxRecordBytes},
			}, errors.New("record too large")
		}
		// Carried through untouched, but it has to be a timestamp: the client
		// displays it, and a first-sign-in tie-break compares it.
		if rec.UpdatedAt != "" {
			if _, err := time.Parse(time.RFC3339, rec.UpdatedAt); err != nil {
				return &apiError{
					status:  http.StatusBadRequest,
					code:    "malformed_record",
					details: map[string]any{"id": rec.ID, "collection": rec.Collection, "why": "updatedAt is not RFC 3339"},
				}, errors.New("bad updatedAt")
			}
		}
		total += len(rec.Body)
	}
	if total > maxBatchBytes {
		return &apiError{
			status:  http.StatusRequestEntityTooLarge,
			code:    "batch_too_large",
			details: map[string]any{"maxBytes": maxBatchBytes, "sent": total},
		}, errors.New("batch too large")
	}
	return nil, nil
}

// --- export ------------------------------------------------------------------

/*
The export, in the app's own Backup shape.

Doc 01 section 7: an export from the server has to restore into the app through
the import path that already exists and is already tested. That is a free win,
and it is what stops the account becoming a place data goes and cannot leave.

Photos are absent and always will be: the server never receives them.
*/
func (s *Server) handleExport(w http.ResponseWriter, r *http.Request, sess session) {
	records, err := s.store.AllRecords(r.Context(), sess.account.ID)
	if err != nil {
		s.fail(w, r, "read records", err)
		return
	}

	out := map[string]any{
		"formatVersion": 1,
		"createdAt":     time.Now().UnixMilli(),
		"appVersion":    "thwart-server/" + s.build,
		// Never anything else: the server does not receive photographs.
		"photos": []string{},
	}

	// Every list collection gets a key, empty or not, so a restore never has to
	// distinguish "no decks" from "this server does not do decks".
	//
	// settings is the exception and is left absent rather than emitted empty.
	// The app reads null as "this file has no settings, leave the device's own
	// alone", which is the right answer for an account that has never synced
	// them; an empty object would say "use the defaults" and quietly reset
	// somebody's language and theme.
	for _, spec := range collections {
		if !spec.single {
			out[spec.backupField] = []json.RawMessage{}
		}
	}
	for _, rec := range records {
		spec := collections[rec.Collection]
		if spec.backupField == "" {
			continue
		}
		if spec.single {
			out[spec.backupField] = rec.Body
			continue
		}
		out[spec.backupField] = append(out[spec.backupField].([]json.RawMessage), rec.Body)
	}

	w.Header().Set("Content-Disposition",
		`attachment; filename="thwart-account-export.json"`)
	writeJSON(w, http.StatusOK, out)
}

// --- helpers -----------------------------------------------------------------

/*
pullCollections resolves the `collections` parameter of a pull to the names
that will be served: the named ones this server knows, or, when nothing was
named, every collection that is not opt-in. Never empty as long as the map
has a collection that is not opt-in.
*/
func pullCollections(param string) []string {
	if param == "" {
		out := make([]string, 0, len(collections))
		for name, spec := range collections {
			if !spec.optIn {
				out = append(out, name)
			}
		}
		return out
	}
	out := make([]string, 0, len(collections))
	for _, name := range strings.Split(param, ",") {
		name = strings.TrimSpace(name)
		if _, known := collections[name]; known && !slices.Contains(out, name) {
			out = append(out, name)
		}
	}
	return out
}

func intParam(r *http.Request, name string, fallback int) (int, error) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return fallback, nil
	}
	return strconv.Atoi(raw)
}

func int64Param(r *http.Request, name string, fallback int64) (int64, error) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return fallback, nil
	}
	return strconv.ParseInt(raw, 10, 64)
}

// Accepts what the three client languages produce for a boolean in a query
// string: 1/0, true/false, t/f. An absent parameter is false rather than an
// error, so an older client that has never heard of it behaves as it did.
func boolParam(r *http.Request, name string) (bool, error) {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return false, nil
	}
	return strconv.ParseBool(raw)
}
