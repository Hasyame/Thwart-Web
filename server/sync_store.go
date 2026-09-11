package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"sync"
	"time"
)

/*
The record store.

One table holding every user record, keyed by (account, collection, id), with an
opaque JSON body the server never looks inside. Doc 02 argues the case: adding
an entity to Android must not require a server change, and the server cannot
merge what it does not understand anyway. The per-field exceptions in doc 02 §4
live in the client.

The revision counter is the correctness-critical part of the whole design, and
it is implemented here rather than in a handler for that reason.
*/

// Record is one row on the wire.
type Record struct {
	Collection string          `json:"collection"`
	ID         string          `json:"id"`
	Revision   int64           `json:"revision"`
	UpdatedAt  string          `json:"updatedAt"`
	Deleted    bool            `json:"deleted"`
	Body       json.RawMessage `json:"body"`
}

// IncomingRecord is one row of a push.
type IncomingRecord struct {
	Collection string `json:"collection"`
	ID         string `json:"id"`
	UpdatedAt  string `json:"updatedAt"`
	Deleted    bool   `json:"deleted"`
	// What the client last saw for this record, absent if the record is new to
	// the server. The write applies either way; this only decides whether the
	// client is told it overwrote something.
	BaseRevision *int64          `json:"baseRevision"`
	Body         json.RawMessage `json:"body"`
}

// RecordResult is what the push says about one record.
type RecordResult struct {
	ID                 string `json:"id"`
	Collection         string `json:"collection"`
	Revision           int64  `json:"revision"`
	Outcome            string `json:"outcome"`
	SupersededRevision *int64 `json:"supersededRevision,omitempty"`
	// Why a record was rejected. Only ever set with outcomeRejected.
	Reason string `json:"reason,omitempty"`
}

const (
	outcomeApplied      = "applied"
	outcomeOverConflict = "applied_over_conflict"
	// campaign_events are union-merged: pushing one that already exists is not
	// a conflict and does not rewrite the row, because the ids are stable and
	// the same event pushed twice is the same event.
	outcomeAlreadyPresent = "already_present"
	// Not stored, and the client must not retry: a rating for something this
	// account never played, or malformed. The batch around it still applies.
	outcomeRejected = "rejected"
)

/*
writeLocks serialises writes per account.

With SetMaxOpenConns(1) the database already serialises everything, so today
this is belt and braces. Doc 02 §2 says to keep it anyway, and it is right: the
gap-visibility bug it prevents is invisible in testing and permanent in effect,
and the day the connection limit is raised or SQLite is swapped out, this is the
line that stops the bug arriving with it.
*/
type writeLocks struct {
	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

func newWriteLocks() *writeLocks { return &writeLocks{locks: map[string]*sync.Mutex{}} }

func (w *writeLocks) lock(accountID string) func() {
	w.mu.Lock()
	m, ok := w.locks[accountID]
	if !ok {
		m = &sync.Mutex{}
		w.locks[accountID] = m
	}
	w.mu.Unlock()

	m.Lock()
	return m.Unlock
}

// --- pull --------------------------------------------------------------------

// Changes returns records with a revision above since, oldest first.
//
// Ordering by revision is not a nicety: it is what lets a client store the
// highest revision it has seen and resume from there.
func (s *Store) Changes(ctx context.Context, accountID string, since int64, limit int, wanted []string) ([]Record, error) {
	// Filtered in the query rather than after it, so a page is a page of
	// records the client asked for: filtering afterwards could hand back an
	// empty page with hasMore set, and a client that stops on an empty page
	// would stop short.
	if len(wanted) == 0 {
		return []Record{}, nil
	}
	args := []any{accountID, since}
	marks := make([]string, len(wanted))
	for i, name := range wanted {
		marks[i] = "?"
		args = append(args, name)
	}
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx,
		`SELECT collection, id, revision, updated_at, deleted, body
		   FROM record
		  WHERE account_id = ? AND revision > ?
		    AND collection IN (`+strings.Join(marks, ",")+`)
		  ORDER BY revision
		  LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	out := make([]Record, 0, 16)
	for rows.Next() {
		var r Record
		var deleted int
		var body sql.NullString
		if err := rows.Scan(&r.Collection, &r.ID, &r.Revision, &r.UpdatedAt, &deleted, &body); err != nil {
			return nil, err
		}
		r.Deleted = deleted != 0
		if body.Valid {
			r.Body = json.RawMessage(body.String)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// AllRecords returns every live record for an account, for the export. Ordered
// so that an export of the same data twice is byte-identical, which makes it
// diffable and makes a test able to say so.
func (s *Store) AllRecords(ctx context.Context, accountID string) ([]Record, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT collection, id, revision, updated_at, body
		   FROM record
		  WHERE account_id = ? AND deleted = 0
		  ORDER BY collection, id`, accountID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []Record
	for rows.Next() {
		var r Record
		var body sql.NullString
		if err := rows.Scan(&r.Collection, &r.ID, &r.Revision, &r.UpdatedAt, &body); err != nil {
			return nil, err
		}
		if body.Valid {
			r.Body = json.RawMessage(body.String)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// MinCursor reports the tombstone horizon: the highest revision that has been
// swept away. A client whose stored cursor is below it may have missed a
// tombstone that no longer exists to be sent, so it has to resynchronise fully.
func (s *Store) MinCursor(ctx context.Context, accountID string) (int64, error) {
	var minCursor int64
	err := s.db.QueryRowContext(ctx,
		`SELECT min_cursor FROM account WHERE id = ?`, accountID).Scan(&minCursor)
	if errors.Is(err, sql.ErrNoRows) {
		return 0, ErrNotFound
	}
	return minCursor, err
}

// --- push --------------------------------------------------------------------

/*
ApplyBatch writes a whole batch, or none of it.

The revision is allocated **inside** the transaction that does the write, which
is the point doc 02 §2 spends a page on. With a sequence taken outside, two
concurrent writers can take 41 and 42 and the holder of 42 can commit first; a
client pulling in that window stores cursor 42 and never sees 41 again. Taking
the number under the account's row lock makes revisions become visible in the
order they were issued, so no gap can be observed.
*/
/*
AccountCursor is the account's current revision.

Read outside any write, for the stream to tell a reconnecting client whether it
is behind. Cheap: one indexed row.
*/
func (s *Store) AccountCursor(ctx context.Context, accountID string) (int64, error) {
	var cursor int64
	err := s.db.QueryRowContext(ctx,
		`SELECT revision FROM account WHERE id = ?`, accountID).Scan(&cursor)
	return cursor, err
}

func (s *Store) ApplyBatch(ctx context.Context, accountID string, records []IncomingRecord) ([]RecordResult, int64, error) {
	unlock := s.writes.lock(accountID)
	defer unlock()

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, 0, err
	}
	defer func() { _ = tx.Rollback() }()

	results := make([]RecordResult, 0, len(records))
	for _, in := range records {
		result, err := applyOne(ctx, tx, accountID, in)
		if err != nil {
			return nil, 0, err
		}
		results = append(results, result)
	}

	var cursor int64
	if err := tx.QueryRowContext(ctx,
		`SELECT revision FROM account WHERE id = ?`, accountID).Scan(&cursor); err != nil {
		return nil, 0, err
	}

	if err := tx.Commit(); err != nil {
		return nil, 0, err
	}
	return results, cursor, nil
}

func applyOne(ctx context.Context, tx *sql.Tx, accountID string, in IncomingRecord) (RecordResult, error) {
	spec := collections[in.Collection]

	/*
		Ratings are checked before they are stored.

		The one collection the server reads inside, and it reads to check, never
		to serve: a rating is refused unless this account holds the play or run
		it cites, and the subject matches. Refused means not written at all —
		no revision spent, no row for another device to pull — and the client
		is told why, once, so it can drop its copy. See ratings.go and
		docs/spec/ratings-and-modular-sets.md §2.4.
	*/
	var rating *ratingRow
	if in.Collection == "ratings" && !in.Deleted {
		row, reason, err := validateRating(ctx, tx, accountID, in)
		if err != nil {
			return RecordResult{}, err
		}
		if reason != "" {
			return RecordResult{ID: in.ID, Collection: in.Collection, Outcome: outcomeRejected, Reason: reason}, nil
		}
		rating = row
	}

	var stored sql.NullInt64
	err := tx.QueryRowContext(ctx,
		`SELECT revision FROM record WHERE account_id = ? AND collection = ? AND id = ?`,
		accountID, in.Collection, in.ID).Scan(&stored)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return RecordResult{}, err
	}
	exists := err == nil

	// Union merge. An event that is already here is the same event; rewriting
	// it would burn a revision and make every other client re-download a row
	// that did not change.
	if spec.immutable && exists {
		return RecordResult{
			ID: in.ID, Collection: in.Collection,
			Revision: stored.Int64, Outcome: outcomeAlreadyPresent,
		}, nil
	}

	revision, err := nextRevision(ctx, tx, accountID)
	if err != nil {
		return RecordResult{}, err
	}

	var body any
	if !in.Deleted && len(in.Body) > 0 {
		body = string(in.Body)
	}
	var deletedAt any
	if in.Deleted {
		deletedAt = time.Now().UnixMilli()
	}

	if _, err := tx.ExecContext(ctx,
		`INSERT INTO record (account_id, collection, id, revision, updated_at, deleted, body, deleted_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (account_id, collection, id) DO UPDATE SET
		     revision   = excluded.revision,
		     updated_at = excluded.updated_at,
		     deleted    = excluded.deleted,
		     body       = excluded.body,
		     deleted_at = excluded.deleted_at`,
		accountID, in.Collection, in.ID, revision, in.UpdatedAt, boolToInt(in.Deleted), body, deletedAt,
	); err != nil {
		return RecordResult{}, err
	}

	// The index and the summary move in the same transaction as the record,
	// so a rating that is stored is counted and one that is tombstoned is not.
	if in.Collection == "ratings" {
		if in.Deleted {
			if err := unindexRating(ctx, tx, accountID, in.ID); err != nil {
				return RecordResult{}, err
			}
		} else if err := indexRating(ctx, tx, accountID, *rating); err != nil {
			return RecordResult{}, err
		}
	}

	result := RecordResult{
		ID: in.ID, Collection: in.Collection,
		Revision: revision, Outcome: outcomeApplied,
	}

	// The write applied either way. Refusing it would strand the client with a
	// change it can never upload; naming what was overwritten turns silent data
	// loss into something the client can act on, for one integer.
	if exists && in.BaseRevision != nil && stored.Int64 > *in.BaseRevision {
		superseded := stored.Int64
		result.Outcome = outcomeOverConflict
		result.SupersededRevision = &superseded
	}
	return result, nil
}

// nextRevision takes the account's next revision under its row lock. The UPDATE
// is what takes the lock; doing it before the write is what keeps the sequence
// gap-free from a reader's point of view.
func nextRevision(ctx context.Context, tx *sql.Tx, accountID string) (int64, error) {
	if _, err := tx.ExecContext(ctx,
		`UPDATE account SET revision = revision + 1 WHERE id = ?`, accountID); err != nil {
		return 0, err
	}
	var revision int64
	if err := tx.QueryRowContext(ctx,
		`SELECT revision FROM account WHERE id = ?`, accountID).Scan(&revision); err != nil {
		return 0, err
	}
	return revision, nil
}

// --- idempotency -------------------------------------------------------------

/*
The stored response is what makes a retry safe.

The single most common real failure on a phone is: the request arrived, the
write happened, the reply did not come back. The client cannot tell that from a
request that never arrived, so it retries. Without this the retry applies the
batch a second time and duplicates every row in it.
*/
func (s *Store) BatchResponse(ctx context.Context, accountID, batchID string) ([]byte, bool, error) {
	var response string
	err := s.db.QueryRowContext(ctx,
		`SELECT response FROM batch WHERE account_id = ? AND batch_id = ?`,
		accountID, batchID).Scan(&response)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	return []byte(response), true, nil
}

func (s *Store) SaveBatchResponse(ctx context.Context, accountID, batchID string, response []byte) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO batch (account_id, batch_id, response, created_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT (account_id, batch_id) DO NOTHING`,
		accountID, batchID, string(response), time.Now().UnixMilli())
	return err
}

// --- housekeeping ------------------------------------------------------------

// TombstoneRetention is how long a delete stays describable. Long enough that a
// device left in a drawer over a summer still merges correctly; short enough
// that the table does not grow without bound.
const TombstoneRetention = 180 * 24 * time.Hour

// BatchRetention is how long a push response stays replayable. A retry happens
// within seconds; a day is generous.
const BatchRetention = 24 * time.Hour

/*
Sweep removes expired tombstones and expired batch responses.

Raising min_cursor is the half that matters. Once a tombstone is gone the server
can no longer tell a client that the record was deleted, so every client whose
cursor is at or below the highest swept revision has to resynchronise fully.
Recording that number is what lets the server say so instead of quietly serving
an incomplete feed.
*/
func (s *Store) Sweep(ctx context.Context, now time.Time) (tombstones, batches int64, err error) {
	tombstoneCutoff := now.Add(-TombstoneRetention).UnixMilli()

	// Per account, because min_cursor is per account.
	rows, err := s.db.QueryContext(ctx,
		`SELECT account_id, MAX(revision) FROM record
		  WHERE deleted = 1 AND deleted_at IS NOT NULL AND deleted_at < ?
		  GROUP BY account_id`, tombstoneCutoff)
	if err != nil {
		return 0, 0, err
	}
	horizons := map[string]int64{}
	for rows.Next() {
		var accountID string
		var highest int64
		if err := rows.Scan(&accountID, &highest); err != nil {
			_ = rows.Close()
			return 0, 0, err
		}
		horizons[accountID] = highest
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return 0, 0, err
	}
	_ = rows.Close()

	for accountID, highest := range horizons {
		if _, err := s.db.ExecContext(ctx,
			`UPDATE account SET min_cursor = ? WHERE id = ? AND min_cursor < ?`,
			highest, accountID, highest); err != nil {
			return 0, 0, err
		}
	}

	res, err := s.db.ExecContext(ctx,
		`DELETE FROM record WHERE deleted = 1 AND deleted_at IS NOT NULL AND deleted_at < ?`,
		tombstoneCutoff)
	if err != nil {
		return 0, 0, err
	}
	tombstones, _ = res.RowsAffected()

	res, err = s.db.ExecContext(ctx,
		`DELETE FROM batch WHERE created_at < ?`, now.Add(-BatchRetention).UnixMilli())
	if err != nil {
		return tombstones, 0, err
	}
	batches, _ = res.RowsAffected()

	return tombstones, batches, nil
}

func boolToInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
