package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
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

	// Not in Backup today. Doc 01 section 8 items 5 and 6 add both on the
	// Android side; the keys are emitted now because the format ignores
	// unknown ones by design, so an older build reads the export and merely
	// loses these rather than refusing the file.
	"excluded_scenarios": {backupField: "excludedScenarios"},
	"settings":           {backupField: "settings"},
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
	*/
	if since > 0 && since < minCursor {
		writeError(w, r, apiError{
			status:  http.StatusConflict,
			code:    "cursor_too_old",
			details: map[string]any{"minCursor": minCursor},
		})
		return
	}

	changes, err := s.store.Changes(r.Context(), sess.account.ID, since, limit)
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

	results, cursor, err := s.store.ApplyBatch(r.Context(), sess.account.ID, body.Records)
	if err != nil {
		s.fail(w, r, "apply batch", err)
		return
	}

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

	// Every known collection gets a key, empty or not, so a restore never has
	// to distinguish "no decks" from "this server does not do decks".
	grouped := map[string][]json.RawMessage{}
	for _, spec := range collections {
		grouped[spec.backupField] = []json.RawMessage{}
	}
	for _, rec := range records {
		field := collections[rec.Collection].backupField
		if field == "" {
			continue
		}
		grouped[field] = append(grouped[field], rec.Body)
	}

	out := map[string]any{
		"formatVersion": 1,
		"createdAt":     time.Now().UnixMilli(),
		"appVersion":    "thwart-server/" + s.build,
		"photos":        []string{},
	}
	for field, bodies := range grouped {
		out[field] = bodies
	}

	w.Header().Set("Content-Disposition",
		`attachment; filename="thwart-account-export.json"`)
	writeJSON(w, http.StatusOK, out)
}

// --- helpers -----------------------------------------------------------------

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
