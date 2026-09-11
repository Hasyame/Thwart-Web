package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

/*
Ratings are the one collection the server checks before it stores, and these
are the checks. The point of every refusal is that it costs nothing: no
revision, no row, and the plays beside it still land.
*/

func rating(subject string, score int, evidence map[string]any) map[string]any {
	return record("ratings", subject, map[string]any{
		"subject":  subject,
		"score":    score,
		"ratedAt":  1789100000000,
		"evidence": evidence,
		"context":  map[string]any{"players": 1, "mode": "standard_i"},
	})
}

func play(id, scenario, modulars string, runID any) map[string]any {
	body := map[string]any{
		"id": id, "scenarioCode": scenario, "scenarioName": scenario,
		"difficulty": "standard_i", "standardSet": "", "modularSets": modulars,
		"heroCode": "spiderman", "heroName": "Spider-Man", "aspects": "justice",
		"otherHeroes": "", "roster": []any{}, "players": 1, "won": true,
		"elapsedMillis": 1000, "notes": "", "location": "", "victoryPoints": 0,
		"campaignRunId": runID, "reportedToBgg": false, "photos": "",
		"updatedAt": 1789100000000, "deletedAt": nil,
	}
	return record("plays", id, body)
}

func ratingResults(t *testing.T, res response) map[string]map[string]any {
	t.Helper()
	if res.status != http.StatusOK {
		t.Fatalf("push: status %d, body %v", res.status, res.body)
	}
	out := map[string]map[string]any{}
	list, _ := res.body["results"].([]any)
	for _, item := range list {
		m := item.(map[string]any)
		out[m["collection"].(string)+"/"+m["id"].(string)] = m
	}
	return out
}

func summary(t *testing.T, s *Server, subjects ...string) map[string]map[string]any {
	t.Helper()
	path := "/v1/ratings/summary"
	for i, subject := range subjects {
		sep := "&"
		if i == 0 {
			sep = "?"
		}
		path += sep + "subject=" + subject
	}
	res := call(t, s, "GET", path, "", nil)
	if res.status != http.StatusOK {
		t.Fatalf("summary: status %d, body %v", res.status, res.body)
	}
	out := map[string]map[string]any{}
	for k, v := range res.body {
		out[k] = v.(map[string]any)
	}
	return out
}

// --- you can only rate what you played ----------------------------------------

func TestARatingNeedsThePlayItCites(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "rater", "correct horse battery").str("token")

	// No such play on this account.
	res := ratingResults(t, push(t, s, token, "b1",
		rating("scenario:rhino", 3, map[string]any{"playId": "never-pushed"}),
	))
	if r := res["ratings/scenario:rhino"]; r["outcome"] != "rejected" || r["reason"] != "not_played" {
		t.Fatalf("a rating for a play the account never pushed must be not_played, got %v", r)
	}

	// The play pushed earlier in the same batch counts as evidence.
	res = ratingResults(t, push(t, s, token, "b2",
		play("p1", "rhino", "bomb_scare,masters_of_evil", nil),
		rating("scenario:rhino", 3, map[string]any{"playId": "p1"}),
		rating("modular:bomb_scare@rhino", 4, map[string]any{"playId": "p1"}),
	))
	for _, key := range []string{"ratings/scenario:rhino", "ratings/modular:bomb_scare@rhino"} {
		if r := res[key]; r["outcome"] != "applied" {
			t.Errorf("%s: expected applied, got %v", key, r)
		}
	}

	// The wrong scenario, a set that was not on the table, a bad score.
	res = ratingResults(t, push(t, s, token, "b3",
		rating("scenario:klaw", 3, map[string]any{"playId": "p1"}),
		rating("modular:legions_of_hydra@rhino", 3, map[string]any{"playId": "p1"}),
		rating("scenario:rhino", 9, map[string]any{"playId": "p1"}),
	))
	if r := res["ratings/scenario:klaw"]; r["reason"] != "subject_mismatch" {
		t.Errorf("a scenario the play was not of must be subject_mismatch, got %v", r)
	}
	if r := res["ratings/modular:legions_of_hydra@rhino"]; r["reason"] != "subject_mismatch" {
		t.Errorf("a set that was not on the table must be subject_mismatch, got %v", r)
	}
	if r := res["ratings/scenario:rhino"]; r["reason"] != "invalid_score" {
		t.Errorf("a score of 9 must be invalid_score, got %v", r)
	}

	// A tombstoned play is not evidence any more.
	tomb := record("plays", "p1", nil)
	tomb["deleted"] = true
	res = ratingResults(t, push(t, s, token, "b4",
		tomb,
		rating("scenario:rhino", 2, map[string]any{"playId": "p1"}),
	))
	if r := res["ratings/scenario:rhino"]; r["reason"] != "not_played" {
		t.Errorf("a deleted play must not be evidence, got %v", r)
	}
}

func TestOneRejectedRatingDoesNotStopThePlaysBesideIt(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "rater", "correct horse battery").str("token")

	res := ratingResults(t, push(t, s, token, "b1",
		play("p1", "rhino", "", nil),
		rating("scenario:klaw", 3, map[string]any{"playId": "p1"}),
		play("p2", "klaw", "", nil),
	))
	if res["plays/p1"]["outcome"] != "applied" || res["plays/p2"]["outcome"] != "applied" {
		t.Fatalf("the plays around a rejected rating must still apply: %v", res)
	}
	if res["ratings/scenario:klaw"]["outcome"] != "rejected" {
		t.Fatalf("expected the rating rejected: %v", res)
	}
	// And the rejected rating is nowhere on the feed.
	for _, change := range changesOf(t, pull(t, s, token, 0)) {
		if change["collection"] == "ratings" {
			t.Fatalf("a rejected rating must not be stored, but the feed carries %v", change)
		}
	}
}

func TestACampaignIsRatedOnlyOnceFinished(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "rater", "correct horse battery").str("token")

	run := func(finished bool) map[string]any {
		return record("campaign_runs", "run1", map[string]any{
			"id": "run1", "templateId": "gmw", "templateName": "GMW", "name": "",
			"difficulty": "standard", "standardSet": "", "createdAt": 1, "finished": finished,
			"templateJson":           `{"scenarios":[{"id":"s1_badoon","baseSetup":{"encounterSets":["brotherhood_of_badoon","band_of_badoon","standard"]}}]}`,
			"timerAccumulatedMillis": 0, "timerRunningSince": nil, "timerScenarioId": "",
			"updatedAt": 1, "deletedAt": nil,
		})
	}

	res := ratingResults(t, push(t, s, token, "b1", run(false),
		rating("campaign:gmw", 4, map[string]any{"runId": "run1"})))
	if r := res["ratings/campaign:gmw"]; r["reason"] != "run_unfinished" {
		t.Fatalf("an unfinished run must be run_unfinished, got %v", r)
	}

	res = ratingResults(t, push(t, s, token, "b2", run(true),
		rating("campaign:gmw", 4, map[string]any{"runId": "run1"}),
		rating("campaign:other", 4, map[string]any{"runId": "run1"})))
	if r := res["ratings/campaign:gmw"]; r["outcome"] != "applied" {
		t.Errorf("a finished run is evidence: %v", r)
	}
	if r := res["ratings/campaign:other"]; r["reason"] != "subject_mismatch" {
		t.Errorf("a different template must be subject_mismatch: %v", r)
	}

	// A campaign's scenario is recorded under the template's own id; the
	// template resolves it to the villain's set and lists the modular sets.
	res = ratingResults(t, push(t, s, token, "b3",
		play("cp1", "s1_badoon", "", "run1"),
		rating("scenario:brotherhood_of_badoon", 3, map[string]any{"playId": "cp1"}),
		rating("modular:band_of_badoon@brotherhood_of_badoon", 2, map[string]any{"playId": "cp1"}),
		rating("scenario:rhino", 3, map[string]any{"playId": "cp1"}),
	))
	if r := res["ratings/scenario:brotherhood_of_badoon"]; r["outcome"] != "applied" {
		t.Errorf("a campaign scenario resolves through its template: %v", r)
	}
	if r := res["ratings/modular:band_of_badoon@brotherhood_of_badoon"]; r["outcome"] != "applied" {
		t.Errorf("a template's modular set counts as on the table: %v", r)
	}
	if r := res["ratings/scenario:rhino"]; r["reason"] != "subject_mismatch" {
		t.Errorf("a scenario the template does not list is refused: %v", r)
	}
}

// --- the summary --------------------------------------------------------------

func TestTheAverageIsServedOnlyFromTheThreshold(t *testing.T) {
	s := newTestServer(t)
	s.RatingThreshold = 3

	for i := 1; i <= 3; i++ {
		token := register(t, s, fmt.Sprintf("player%d", i), "correct horse battery").str("token")
		res := ratingResults(t, push(t, s, token, "b",
			play("p", "rhino", "bomb_scare", nil),
			rating("scenario:rhino", i, map[string]any{"playId": "p"}),
			rating("modular:bomb_scare@rhino", 4, map[string]any{"playId": "p"}),
		))
		if res["ratings/scenario:rhino"]["outcome"] != "applied" {
			t.Fatalf("player %d: %v", i, res)
		}
		// Below the threshold the count is served and nothing else.
		got := summary(t, s, "scenario:rhino")["scenario:rhino"]
		if i < 3 {
			if _, has := got["mean"]; has || got["count"].(float64) != float64(i) {
				t.Fatalf("with %d ratings expected only a count, got %v", i, got)
			}
		}
	}

	got := summary(t, s, "scenario:rhino", "modular:bomb_scare@rhino", "modular:bomb_scare", "scenario:nobody")
	rhino := got["scenario:rhino"]
	if rhino["count"].(float64) != 3 || rhino["mean"].(float64) != 2 {
		t.Errorf("three ratings of 1, 2, 3: expected count 3 mean 2, got %v", rhino)
	}
	hist := rhino["histogram"].([]any)
	if hist[1].(float64) != 1 || hist[2].(float64) != 1 || hist[3].(float64) != 1 || hist[0].(float64) != 0 {
		t.Errorf("histogram should be one each at 1, 2, 3: %v", hist)
	}
	// The bare set is the sum over its pairings.
	if got["modular:bomb_scare"]["count"].(float64) != 3 || got["modular:bomb_scare"]["mean"].(float64) != 4 {
		t.Errorf("the per-set view sums the pairings: %v", got["modular:bomb_scare"])
	}
	if got["scenario:nobody"]["count"].(float64) != 0 {
		t.Errorf("an unrated subject has count 0: %v", got["scenario:nobody"])
	}
}

func TestReRatingReplacesAndTombstoningSubtracts(t *testing.T) {
	s := newTestServer(t)
	s.RatingThreshold = 1
	token := register(t, s, "rater", "correct horse battery").str("token")

	ratingResults(t, push(t, s, token, "b1", play("p", "rhino", "", nil),
		rating("scenario:rhino", 1, map[string]any{"playId": "p"})))
	if got := summary(t, s, "scenario:rhino")["scenario:rhino"]; got["mean"].(float64) != 1 {
		t.Fatalf("first rating: %v", got)
	}

	// Rating again is the same id: one player, one rating, the newer opinion.
	ratingResults(t, push(t, s, token, "b2",
		rating("scenario:rhino", 5, map[string]any{"playId": "p"})))
	got := summary(t, s, "scenario:rhino")["scenario:rhino"]
	if got["count"].(float64) != 1 || got["mean"].(float64) != 5 {
		t.Fatalf("re-rating must replace, not add: %v", got)
	}

	tomb := record("ratings", "scenario:rhino", nil)
	tomb["deleted"] = true
	ratingResults(t, push(t, s, token, "b3", tomb))
	got = summary(t, s, "scenario:rhino")["scenario:rhino"]
	if got["count"].(float64) != 0 {
		t.Fatalf("a removed rating must leave the summary: %v", got)
	}
}

func TestDeletingAnAccountRemovesItsRatingsFromTheAverages(t *testing.T) {
	s := newTestServer(t)
	s.RatingThreshold = 1
	password := "correct horse battery"
	token := register(t, s, "leaver", password).str("token")

	ratingResults(t, push(t, s, token, "b1", play("p", "rhino", "", nil),
		rating("scenario:rhino", 5, map[string]any{"playId": "p"})))
	if got := summary(t, s, "scenario:rhino")["scenario:rhino"]; got["count"].(float64) != 1 {
		t.Fatalf("before: %v", got)
	}

	res := call(t, s, "DELETE", "/v1/account", token, map[string]any{"password": password})
	if res.status != http.StatusOK {
		t.Fatalf("delete account: %d %v", res.status, res.body)
	}
	got := summary(t, s, "scenario:rhino")["scenario:rhino"]
	if got["count"].(float64) != 0 {
		t.Fatalf("an average must not count a player who no longer exists: %v", got)
	}
}

func TestRatingsAreInTheExport(t *testing.T) {
	s := newTestServer(t)
	token := register(t, s, "rater", "correct horse battery").str("token")
	ratingResults(t, push(t, s, token, "b1", play("p", "rhino", "", nil),
		rating("scenario:rhino", 3, map[string]any{"playId": "p"})))

	res := call(t, s, "GET", "/v1/account/export", token, nil)
	if res.status != http.StatusOK {
		t.Fatalf("export: %d", res.status)
	}
	list, ok := res.body["ratings"].([]any)
	if !ok || len(list) != 1 {
		raw, _ := json.Marshal(res.body)
		t.Fatalf("export must carry the ratings list, got %s", raw)
	}
	if _, ok := res.body["favouritePlays"].([]any); !ok {
		t.Errorf("the export must carry favouritePlays too, empty or not")
	}
}

func TestTheSummaryEndpointIsBounded(t *testing.T) {
	s := newTestServer(t)
	res := call(t, s, "GET", "/v1/ratings/summary", "", nil)
	if res.status != http.StatusBadRequest {
		t.Errorf("no subjects: expected 400, got %d", res.status)
	}
	res = call(t, s, "GET", "/v1/ratings/summary?subject=nonsense", "", nil)
	if res.status != http.StatusBadRequest {
		t.Errorf("a malformed subject: expected 400, got %d", res.status)
	}
	path := "/v1/ratings/summary?subject=scenario:a"
	for i := 0; i < 50; i++ {
		path += fmt.Sprintf("&subject=scenario:s%d", i)
	}
	res = call(t, s, "GET", path, "", nil)
	if res.status != http.StatusBadRequest {
		t.Errorf("fifty-one subjects: expected 400, got %d", res.status)
	}
}
