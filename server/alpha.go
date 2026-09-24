package main

import (
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode"
)

/*
Signing up for the Android alpha.

A name and an address typed on the web page, handed on to the owner's mailbox
so they can be added to the testers by hand. Nothing is stored: no table, no
log line with either value in it. The message in the owner's mailbox is the
only copy, which is what the page tells the person before they send.

Off unless `-alpha-to` names the mailbox, and off without a mailer, since the
whole feature is one message. A closed sign-up answers `alpha_closed` and the
page says so rather than pretending it worked.

Limited twice: per address, so one person cannot use the form as a way to
send mail, and in total per day, so a botnet cannot either. The hidden
`website` field is a honeypot a person never sees; a request that fills it is
answered as if it worked and nothing is sent.
*/

const (
	maxAlphaName = 80
)

var (
	alphaPerIP  = limitRule{3, time.Hour}
	alphaPerDay = limitRule{50, 24 * time.Hour}
)

type alphaRequest struct {
	Name  string `json:"name"`
	Email string `json:"email"`
	// The honeypot. Hidden on the page, so only a form-filling bot sets it.
	Website string `json:"website"`
}

// UseAlphaSignup switches the Android alpha sign-up on, sending to this address.
func (s *Server) UseAlphaSignup(to string) {
	s.alphaTo = to
}

func (s *Server) handleAlphaSignup(w http.ResponseWriter, r *http.Request) {
	var body alphaRequest
	if !decodeJSON(w, r, &body) {
		return
	}
	if s.alphaTo == "" || s.mailer == nil {
		writeError(w, r, apiError{status: http.StatusServiceUnavailable, code: "alpha_closed"})
		return
	}
	name := strings.TrimSpace(body.Name)
	email := strings.TrimSpace(body.Email)
	if !validAlphaName(name) {
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "invalid_name"})
		return
	}
	if !validEmail(email) {
		writeError(w, r, apiError{status: http.StatusBadRequest, code: "invalid_email"})
		return
	}
	// After validation, so somebody correcting a typo is not locked out.
	if !s.limiter.allow("alpha:"+clientIP(r), alphaPerIP) {
		writeError(w, r, apiError{status: http.StatusTooManyRequests, code: "rate_limited"})
		return
	}
	if strings.TrimSpace(body.Website) != "" {
		writeJSON(w, http.StatusAccepted, map[string]any{"sent": true})
		return
	}
	// Counted only for requests that would really send, so a flood of junk
	// cannot close the form for the day.
	if !s.limiter.allow("alpha:all", alphaPerDay) {
		writeError(w, r, apiError{status: http.StatusTooManyRequests, code: "rate_limited"})
		return
	}

	// The subject is fixed: nothing typed by a visitor goes into a header.
	subject := "Thwart Android alpha sign-up"
	message := fmt.Sprintf("Someone asked to join the Thwart Android alpha from the web page.\n\nName: %s\nEmail: %s\nSent: %s\n\nNothing about this request is stored on the server; this message is the only copy.\n",
		name, email, time.Now().UTC().Format("2006-01-02 15:04 MST"))
	if err := s.mailer.Send(r.Context(), s.alphaTo, subject, message); err != nil {
		s.fail(w, r, "send alpha sign-up", err)
		return
	}
	s.log.Info("alpha sign-up relayed")
	writeJSON(w, http.StatusAccepted, map[string]any{"sent": true})
}

// A name as a person types it: some letters, no line breaks or control
// characters, and short enough to be a name.
func validAlphaName(name string) bool {
	if name == "" || len([]rune(name)) > maxAlphaName {
		return false
	}
	for _, r := range name {
		if unicode.IsControl(r) {
			return false
		}
	}
	return true
}
