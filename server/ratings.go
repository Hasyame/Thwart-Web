package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"
)

/*
Difficulty ratings: checked on the way in, summarised on the way out.

# What this is the exception to

Every other collection is opaque to this server: a name, an id and a body it
never parses. A rating is the one record the server reads inside, and it reads
exactly four fields of *other* records to do it — a play's `scenarioCode`,
`modularSets` and `campaignRunId`, and a run's `templateJson` and `finished`.
It reads them to check that the person played what they are rating, never to
store or to serve, and that boundary is the whole reason the check can live
here rather than in the client, where it would be a suggestion.

# The shape

A rating record's id is its subject key, so one current rating per player per
subject is the data model rather than a rule:

	scenario:<setCode>
	modular:<setCode>@<scenarioCode>
	campaign:<templateId>

Two tables are kept beside `record`, both derived and both rebuildable from
the `ratings` collection: `rating`, the structured index of every accepted
record, and `rating_summary`, one row per subject with a count, a sum and a
six-bin histogram, moved by delta in the same transaction as the record.

docs/spec/ratings-and-modular-sets.md is the contract; §2.4 is this file.
*/

// The reasons a rating is refused. Each is a word the client can act on.
const (
	reasonInvalidScore    = "invalid_score"
	reasonSubjectMismatch = "subject_mismatch"
	reasonNotPlayed       = "not_played"
	reasonRunUnfinished   = "run_unfinished"
	reasonRateLimited     = "rate_limited"
)

/* Ratings per account per day. Nobody rates two hundred subjects in a day; a
client that does is a bug or a script. The excess is rejected one by one
rather than the batch failing, so the plays beside them still land. */
var ratingsPerAccountDay = limitRule{200, 24 * time.Hour}

// How many ratings a subject needs before its average is served at all.
// Overridable per instance: see -rating-threshold in main.go and §8.2.
const defaultRatingThreshold = 5

// The most subjects one summary request may ask for.
const maxSummarySubjects = 50

// How long a summary may be served from memory before it is re-read.
const summaryTTL = 60 * time.Second

type ratingBody struct {
	Subject  string `json:"subject"`
	Score    *int   `json:"score"`
	RatedAt  int64  `json:"ratedAt"`
	Evidence struct {
		PlayID string `json:"playId"`
		RunID  string `json:"runId"`
	} `json:"evidence"`
	// Kept as it came: the server neither reads nor rewrites it.
	Context json.RawMessage `json:"context"`
}

// ratingRow is a rating as the index holds it.
type ratingRow struct {
	Subject      string
	Kind         string
	SetCode      string
	ScenarioCode string
	Score        int
	RatedAt      int64
}

// parseSubject splits a key into its parts, or returns false for anything
// that is not one of the three shapes.
func parseSubject(key string) (kind, set, scenario string, ok bool) {
	kind, rest, found := strings.Cut(key, ":")
	if !found || rest == "" {
		return "", "", "", false
	}
	switch kind {
	case "scenario", "campaign":
		if strings.ContainsAny(rest, "@") {
			return "", "", "", false
		}
		return kind, rest, "", true
	case "modular":
		set, scenario, found := strings.Cut(rest, "@")
		if !found || set == "" || scenario == "" {
			return "", "", "", false
		}
		return kind, set, scenario, true
	}
	return "", "", "", false
}

// The four fields of a play the check reads.
type playEvidence struct {
	ScenarioCode  string `json:"scenarioCode"`
	ModularSets   string `json:"modularSets"`
	CampaignRunID *string `json:"campaignRunId"`
}

// The three fields of a run the check reads.
type runEvidence struct {
	TemplateID   string `json:"templateId"`
	Finished     bool   `json:"finished"`
	TemplateJSON string `json:"templateJson"`
}

// What a template says about one of its scenarios. Only the encounter sets:
// every campaign but Fear No Evil lists the villain's own set among them,
// which is what lets a campaign scenario be matched to a card set here
// without a card database.
type templateScenario struct {
	ID        string `json:"id"`
	BaseSetup struct {
		EncounterSets []string `json:"encounterSets"`
		ModularSets   []string `json:"modularSets"`
	} `json:"baseSetup"`
}

// liveBody reads one of this account's records, in this transaction, or
// returns false when it is absent or tombstoned. "In this transaction" is what
// lets a play pushed earlier in the same batch count as evidence.
func liveBody(ctx context.Context, tx *sql.Tx, accountID, collection, id string) (json.RawMessage, bool, error) {
	var body sql.NullString
	var deleted int
	err := tx.QueryRowContext(ctx,
		`SELECT body, deleted FROM record WHERE account_id = ? AND collection = ? AND id = ?`,
		accountID, collection, id).Scan(&body, &deleted)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}
	if deleted != 0 || !body.Valid {
		return nil, false, nil
	}
	return json.RawMessage(body.String), true, nil
}

func csvContains(csv, code string) bool {
	for _, part := range strings.Split(csv, ",") {
		if strings.TrimSpace(part) == code {
			return true
		}
	}
	return false
}

/*
validateRating decides whether a pushed rating may be stored.

Returns the parsed row and an empty reason when it may; a reason and no row
when it may not; an error only for the database. Every refusal is a word the
client can act on, and none of them spends a revision.
*/
func validateRating(ctx context.Context, tx *sql.Tx, accountID string, in IncomingRecord) (*ratingRow, string, error) {
	var body ratingBody
	if err := json.Unmarshal(in.Body, &body); err != nil {
		return nil, reasonSubjectMismatch, nil
	}
	if body.Score == nil || *body.Score < 0 || *body.Score > 5 {
		return nil, reasonInvalidScore, nil
	}
	if body.Subject != in.ID {
		return nil, reasonSubjectMismatch, nil
	}
	kind, set, scenario, ok := parseSubject(in.ID)
	if !ok {
		return nil, reasonSubjectMismatch, nil
	}

	row := &ratingRow{Subject: in.ID, Kind: kind, SetCode: set, ScenarioCode: scenario, Score: *body.Score, RatedAt: body.RatedAt}

	switch kind {
	case "campaign":
		if body.Evidence.RunID == "" {
			return nil, reasonNotPlayed, nil
		}
		raw, live, err := liveBody(ctx, tx, accountID, "campaign_runs", body.Evidence.RunID)
		if err != nil || !live {
			return nil, reasonNotPlayed, err
		}
		var run runEvidence
		if json.Unmarshal(raw, &run) != nil || run.TemplateID != set {
			return nil, reasonSubjectMismatch, nil
		}
		if !run.Finished {
			return nil, reasonRunUnfinished, nil
		}
		return row, "", nil

	case "scenario", "modular":
		if body.Evidence.PlayID == "" {
			return nil, reasonNotPlayed, nil
		}
		raw, live, err := liveBody(ctx, tx, accountID, "plays", body.Evidence.PlayID)
		if err != nil || !live {
			return nil, reasonNotPlayed, err
		}
		var play playEvidence
		if json.Unmarshal(raw, &play) != nil {
			return nil, reasonSubjectMismatch, nil
		}
		// The scenario the subject names: `S` for scenario:S, the pairing for
		// modular:M@S.
		wantScenario := set
		if kind == "modular" {
			wantScenario = scenario
		}
		matched, err := scenarioMatches(ctx, tx, accountID, play, wantScenario)
		if err != nil {
			return nil, "", err
		}
		if !matched {
			return nil, reasonSubjectMismatch, nil
		}
		if kind == "modular" && !csvContains(play.ModularSets, set) {
			// A campaign scenario's mandated sets live in the template rather
			// than on the play; those count too.
			inTemplate, err := templateListsSet(ctx, tx, accountID, play, set)
			if err != nil {
				return nil, "", err
			}
			if !inTemplate {
				return nil, reasonSubjectMismatch, nil
			}
		}
		return row, "", nil
	}
	return nil, reasonSubjectMismatch, nil
}

// scenarioMatches says whether a play was of the named scenario set.
//
// A standalone play records the set code itself. A campaign's play records
// the template's own id for the scenario, so the run's template is read: the
// villain's set is among the scenario's encounter sets in every campaign but
// Fear No Evil, whose villains are drawn from a pool as the campaign goes and
// are known only to the client's folded state. For those the claim is taken
// as made — the play and the run are still real, so this is still one subject
// per game a signed-in player actually played. §2.4 says so.
func scenarioMatches(ctx context.Context, tx *sql.Tx, accountID string, play playEvidence, want string) (bool, error) {
	if play.ScenarioCode == want {
		return true, nil
	}
	if play.CampaignRunID == nil || *play.CampaignRunID == "" {
		return false, nil
	}
	sc, found, err := templateScenarioOf(ctx, tx, accountID, play)
	if err != nil || !found {
		return false, err
	}
	if len(sc.BaseSetup.EncounterSets) == 0 {
		return true, nil // drawn villain: taken as claimed
	}
	for _, code := range sc.BaseSetup.EncounterSets {
		if code == want {
			return true, nil
		}
	}
	return false, nil
}

func templateListsSet(ctx context.Context, tx *sql.Tx, accountID string, play playEvidence, set string) (bool, error) {
	if play.CampaignRunID == nil || *play.CampaignRunID == "" {
		return false, nil
	}
	sc, found, err := templateScenarioOf(ctx, tx, accountID, play)
	if err != nil || !found {
		return false, err
	}
	for _, code := range append(append([]string{}, sc.BaseSetup.EncounterSets...), sc.BaseSetup.ModularSets...) {
		if code == set {
			return true, nil
		}
	}
	return false, nil
}

// templateScenarioOf finds the template scenario a campaign play was of.
func templateScenarioOf(ctx context.Context, tx *sql.Tx, accountID string, play playEvidence) (templateScenario, bool, error) {
	raw, live, err := liveBody(ctx, tx, accountID, "campaign_runs", *play.CampaignRunID)
	if err != nil || !live {
		return templateScenario{}, false, err
	}
	var run runEvidence
	if json.Unmarshal(raw, &run) != nil || run.TemplateJSON == "" {
		return templateScenario{}, false, nil
	}
	var template struct {
		Scenarios []templateScenario `json:"scenarios"`
	}
	if json.Unmarshal([]byte(run.TemplateJSON), &template) != nil {
		return templateScenario{}, false, nil
	}
	for _, sc := range template.Scenarios {
		if sc.ID == play.ScenarioCode {
			return sc, true, nil
		}
	}
	return templateScenario{}, false, nil
}

// --- the index and the summary ------------------------------------------------

func bump(ctx context.Context, tx *sql.Tx, subject string, score, delta int) error {
	cols := []string{"h0", "h1", "h2", "h3", "h4", "h5"}
	_, err := tx.ExecContext(ctx,
		`INSERT INTO rating_summary (subject, count, sum, `+cols[score]+`)
		 VALUES (?, ?, ?, ?)
		 ON CONFLICT (subject) DO UPDATE SET
		     count = count + excluded.count,
		     sum   = sum + excluded.sum,
		     `+cols[score]+` = `+cols[score]+` + excluded.`+cols[score],
		subject, delta, delta*score, delta)
	return err
}

// indexRating stores the row and moves the summary by exactly the difference
// from what this account had for the subject before, if anything.
func indexRating(ctx context.Context, tx *sql.Tx, accountID string, row ratingRow) error {
	var previous sql.NullInt64
	err := tx.QueryRowContext(ctx,
		`SELECT score FROM rating WHERE account_id = ? AND subject = ?`, accountID, row.Subject).Scan(&previous)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if previous.Valid {
		if err := bump(ctx, tx, row.Subject, int(previous.Int64), -1); err != nil {
			return err
		}
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO rating (account_id, subject, kind, set_code, scenario_code, score, rated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT (account_id, subject) DO UPDATE SET
		     score = excluded.score, rated_at = excluded.rated_at`,
		accountID, row.Subject, row.Kind, row.SetCode, nullIfEmpty(row.ScenarioCode), row.Score, row.RatedAt,
	); err != nil {
		return err
	}
	return bump(ctx, tx, row.Subject, row.Score, +1)
}

// unindexRating takes one rating out of the index and the summary. Idempotent:
// a tombstone for a rating that was never accepted moves nothing.
func unindexRating(ctx context.Context, tx *sql.Tx, accountID, subject string) error {
	var score sql.NullInt64
	err := tx.QueryRowContext(ctx,
		`SELECT score FROM rating WHERE account_id = ? AND subject = ?`, accountID, subject).Scan(&score)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM rating WHERE account_id = ? AND subject = ?`, accountID, subject); err != nil {
		return err
	}
	return bump(ctx, tx, subject, int(score.Int64), -1)
}

// unindexAccountRatings subtracts everything an account rated, before the
// account itself goes. The cascade would delete the rows; it would not adjust
// the sums, and an average that counts a player who no longer exists is wrong.
func unindexAccountRatings(ctx context.Context, tx *sql.Tx, accountID string) error {
	rows, err := tx.QueryContext(ctx, `SELECT subject, score FROM rating WHERE account_id = ?`, accountID)
	if err != nil {
		return err
	}
	type held struct {
		subject string
		score   int
	}
	var all []held
	for rows.Next() {
		var h held
		if err := rows.Scan(&h.subject, &h.score); err != nil {
			_ = rows.Close()
			return err
		}
		all = append(all, h)
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, h := range all {
		if err := bump(ctx, tx, h.subject, h.score, -1); err != nil {
			return err
		}
	}
	return nil
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// --- reading ---------------------------------------------------------------------

// Summary is what the read endpoint serves for one subject. Below the
// threshold only the count is present.
type Summary struct {
	Count     int     `json:"count"`
	Mean      float64 `json:"mean,omitempty"`
	Histogram []int   `json:"histogram,omitempty"`
}

// summariesOf reads the summaries for a set of subjects.
//
// A bare `modular:<M>` is not a subject anyone rates: it is served as the sum
// over every `modular:<M>@*` pairing, computed here. The threshold is applied
// here as well, so no client can display a mean the contract says not to.
func (s *Store) summariesOf(ctx context.Context, subjects []string, threshold int) (map[string]Summary, error) {
	out := make(map[string]Summary, len(subjects))
	for _, subject := range subjects {
		var count, sum int
		var h [6]int
		var err error
		if strings.HasPrefix(subject, "modular:") && !strings.Contains(subject, "@") {
			// Every pairing of this set: the rows whose subject starts with
			// "modular:<M>@". A prefix compare rather than LIKE, so a set code
			// with a wildcard character in it needs no escaping.
			prefix := subject + "@"
			err = s.db.QueryRowContext(ctx,
				`SELECT COALESCE(SUM(count),0), COALESCE(SUM(sum),0),
				        COALESCE(SUM(h0),0), COALESCE(SUM(h1),0), COALESCE(SUM(h2),0),
				        COALESCE(SUM(h3),0), COALESCE(SUM(h4),0), COALESCE(SUM(h5),0)
				   FROM rating_summary WHERE substr(subject, 1, ?) = ?`,
				len(prefix), prefix).Scan(&count, &sum, &h[0], &h[1], &h[2], &h[3], &h[4], &h[5])
		} else {
			err = s.db.QueryRowContext(ctx,
				`SELECT count, sum, h0, h1, h2, h3, h4, h5 FROM rating_summary WHERE subject = ?`,
				subject).Scan(&count, &sum, &h[0], &h[1], &h[2], &h[3], &h[4], &h[5])
			if errors.Is(err, sql.ErrNoRows) {
				err = nil
			}
		}
		if err != nil {
			return nil, err
		}
		summary := Summary{Count: count}
		if count >= threshold && count > 0 {
			// Two decimals, as the contract says, and rounded here so every
			// client shows the same number.
			summary.Mean = float64(int(float64(sum)/float64(count)*100+0.5)) / 100
			summary.Histogram = h[:]
		}
		out[subject] = summary
	}
	return out, nil
}

// summaryCache keeps recently served summaries for summaryTTL. Invalidated per
// subject on every write, so a fresh rating is visible within one request.
type summaryCache struct {
	mu      sync.Mutex
	entries map[string]cachedSummary
}

type cachedSummary struct {
	summary Summary
	expires time.Time
}

func newSummaryCache() *summaryCache {
	return &summaryCache{entries: map[string]cachedSummary{}}
}

func (c *summaryCache) get(subject string, now time.Time) (Summary, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.entries[subject]
	if !ok || now.After(e.expires) {
		return Summary{}, false
	}
	return e.summary, true
}

func (c *summaryCache) put(subject string, s Summary, now time.Time) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries[subject] = cachedSummary{summary: s, expires: now.Add(summaryTTL)}
}

// clear drops everything. For account deletion, which touches every subject
// the account rated and is rare enough that re-reading them all is nothing.
func (c *summaryCache) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = map[string]cachedSummary{}
}

// forget drops a subject and, for a pairing, the per-set view it feeds.
func (c *summaryCache) forget(subject string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.entries, subject)
	if set, _, found := strings.Cut(strings.TrimPrefix(subject, "modular:"), "@"); found && strings.HasPrefix(subject, "modular:") {
		delete(c.entries, "modular:"+set)
	}
}

// ratingsSummaryPerIP caps reads of the summary endpoint. Generous, because the
// scenario browser asks on every visit; cheap, because it is cached.
var ratingsSummaryPerIP = limitRule{120, time.Hour}

/*
handleRatingSummary serves community averages for up to fifty subjects.

Unauthenticated: averages are community data, and the scenario browser shows
them to people with no account. Never a source of per-user data — the caller's
own rating is in its own local table and never comes from here.
*/
func (s *Server) handleRatingSummary(w http.ResponseWriter, r *http.Request) {
	if !s.limiter.allow("ratings-summary:"+clientIP(r), ratingsSummaryPerIP) {
		writeError(w, r, apiError{status: http.StatusTooManyRequests, code: "rate_limited"})
		return
	}
	subjects := r.URL.Query()["subject"]
	if len(subjects) == 0 || len(subjects) > maxSummarySubjects {
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "malformed_record",
			details: map[string]any{"why": "between 1 and 50 subjects", "sent": len(subjects)}})
		return
	}
	for _, subject := range subjects {
		if len(subject) > 200 {
			writeError(w, r, apiError{status: http.StatusBadRequest, code: "malformed_record"})
			return
		}
		if _, _, _, ok := parseSubject(subject); !ok {
			// A bare modular:<M> is a view, not a key, and is allowed.
			if !(strings.HasPrefix(subject, "modular:") && !strings.Contains(subject, "@") && len(subject) > len("modular:")) {
				writeError(w, r, apiError{status: http.StatusBadRequest, code: "malformed_record",
					details: map[string]any{"subject": subject}})
				return
			}
		}
	}

	now := time.Now()
	out := make(map[string]Summary, len(subjects))
	var missing []string
	for _, subject := range subjects {
		if cached, ok := s.summaries.get(subject, now); ok {
			out[subject] = cached
		} else {
			missing = append(missing, subject)
		}
	}
	if len(missing) > 0 {
		fresh, err := s.store.summariesOf(r.Context(), missing, s.RatingThreshold)
		if err != nil {
			s.fail(w, r, "read rating summaries", err)
			return
		}
		for subject, summary := range fresh {
			s.summaries.put(subject, summary, now)
			out[subject] = summary
		}
	}

	// A stable body, so the ETag is stable: maps encode in key order in Go,
	// but the sort here documents that the order is part of the contract.
	keys := make([]string, 0, len(out))
	for k := range out {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	ordered := make(map[string]Summary, len(out))
	for _, k := range keys {
		ordered[k] = out[k]
	}
	body, err := json.Marshal(ordered)
	if err != nil {
		s.fail(w, r, "encode rating summaries", err)
		return
	}
	sum := sha256.Sum256(body)
	etag := `"` + hex.EncodeToString(sum[:8]) + `"`

	w.Header().Set("ETag", etag)
	w.Header().Set("Cache-Control", "public, max-age=60")
	if r.Header.Get("If-None-Match") == etag {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}
