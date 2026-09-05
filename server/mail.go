package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"log/slog"
	"net/smtp"
	"strings"
	"time"
)

/*
Sending mail, which this server does exactly once per account.

There is one message in the whole system: the one that asks somebody to confirm
the address they registered with. No newsletters, no notifications, no digests.
That is not a starting point to build on — it is the design. An account here
exists so that two devices can hold the same data, and nothing about that needs
a mailbox except proving once that the address belongs to the person who typed
it.

The transport is a Postfix on the loopback (deploy/mail.sh), so there is no
authentication and no TLS on this hop: the connection never leaves the machine.
Postfix does the DKIM signing and the delivery.
*/

type Mailer interface {
	Send(ctx context.Context, to, subject, body string) error
}

/*
An SMTP mailer, deliberately without authentication.

`Addr` is expected to be a loopback address. Sending unauthenticated plaintext
to anything else would be handing the message to whoever is on the path, so the
constructor refuses a host that is not local rather than trusting the operator
to have meant it.
*/
type SMTPMailer struct {
	Addr string
	// The envelope sender and the From header. `Thwart <no-reply@thwart.app>`.
	From string
	// The bare address inside From, for the envelope.
	fromAddr string
	log      *slog.Logger
}

func NewSMTPMailer(addr, from string, log *slog.Logger) (*SMTPMailer, error) {
	host, _, ok := strings.Cut(addr, ":")
	if !ok {
		return nil, fmt.Errorf("smtp address %q needs a port", addr)
	}
	if host != "127.0.0.1" && host != "::1" && host != "localhost" && host != "[::1]" {
		return nil, fmt.Errorf(
			"smtp address %q is not loopback: this mailer sends unauthenticated plaintext "+
				"and must not do so over a network", addr)
	}

	bare := from
	if start := strings.LastIndex(from, "<"); start >= 0 {
		if end := strings.Index(from[start:], ">"); end > 0 {
			bare = from[start+1 : start+end]
		}
	}
	if !validEmail(strings.ToLower(strings.TrimSpace(bare))) {
		return nil, fmt.Errorf("mail-from %q has no usable address in it", from)
	}

	return &SMTPMailer{Addr: addr, From: from, fromAddr: bare, log: log}, nil
}

func (m *SMTPMailer) Send(ctx context.Context, to, subject, body string) error {
	// Rejected rather than escaped. Every address this is called with has been
	// through validEmail, which already forbids whitespace, so a control
	// character here means something upstream is broken and the right answer is
	// to stop rather than to send a message with an attacker's headers in it.
	if strings.ContainsAny(to, "\r\n") || strings.ContainsAny(subject, "\r\n") {
		return fmt.Errorf("refusing to send: a header would be split")
	}

	id, err := messageID(m.fromAddr)
	if err != nil {
		return err
	}

	var b strings.Builder
	write := func(k, v string) { fmt.Fprintf(&b, "%s: %s\r\n", k, v) }
	write("From", m.From)
	write("To", to)
	write("Subject", subject)
	write("Date", time.Now().UTC().Format(time.RFC1123Z))
	write("Message-ID", id)
	write("MIME-Version", "1.0")
	write("Content-Type", `text/plain; charset="utf-8"`)
	write("Content-Transfer-Encoding", "8bit")
	// So that an out-of-office reply does not come back at a mailbox nobody
	// reads, and so filters can see this for what it is.
	write("Auto-Submitted", "auto-generated")
	b.WriteString("\r\n")
	b.WriteString(strings.ReplaceAll(body, "\n", "\r\n"))

	done := make(chan error, 1)
	go func() {
		done <- smtp.SendMail(m.Addr, nil, m.fromAddr, []string{to}, []byte(b.String()))
	}()
	select {
	case err := <-done:
		return err
	case <-ctx.Done():
		return ctx.Err()
	}
}

func messageID(from string) (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("read message id: %w", err)
	}
	_, domain, _ := strings.Cut(from, "@")
	return fmt.Sprintf("<%s@%s>", base64.RawURLEncoding.EncodeToString(raw), domain), nil
}

/*
The one message.

Written as plain text on purpose. A confirmation link is the whole content, an
HTML version would carry nothing the text does not, and a message that is only
a styled button is the shape people have been taught to distrust.

The wording says what the account is for, what happens if the reader ignores it,
and what is held about them — because somebody who has just typed their address
into a hobby project deserves all three without having to go and look.
*/
func verificationEmail(handle, link string, expires time.Duration) (subject, body string) {
	days := int(expires.Hours() / 24)
	return "Confirm your address for Thwart",
		fmt.Sprintf(`Somebody — probably you — made a Thwart account with this address,
under the name %s.

Confirm the address and the account starts working:

%s

Until you do, the account is disabled: it cannot sign in and nothing
syncs to it. Thwart is a companion for Marvel Champions, and the only
reason it holds an address at all is so that your own devices can find
the same account.

The link works once and stops working after %d days.

If you did not make this account, do nothing. An account that is never
confirmed is deleted, along with the address, rather than left sitting
here.

— Thwart
   https://thwart.app
`, handle, link, days)
}
