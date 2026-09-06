package main

import (
	"bufio"
	"context"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

/*
The SMTP conversation itself.

Written after a real failure. Every test above this one uses a fake Mailer, so
none of them ever spoke SMTP, and the first message the live server tried to
send died with "cannot validate certificate for 127.0.0.1": `smtp.SendMail`
upgrades to STARTTLS whenever the server offers it, and Postfix offers it with a
self-signed certificate that has no IP SAN. A Python check had passed earlier
only because smtplib does not upgrade on its own — which is the exact shape of a
test that proves the wrong thing.

So this server advertises STARTTLS the way Postfix does, and fails the test if
the client reaches for it.
*/

type fakeSMTP struct {
	addr string

	mu        sync.Mutex
	triedTLS  bool
	envFrom   string
	envTo     []string
	dataLines []string
	done      chan struct{}
}

// startFakeSMTP listens on the loopback and speaks just enough SMTP.
func startFakeSMTP(t *testing.T) *fakeSMTP {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	s := &fakeSMTP{addr: listener.Addr().String(), done: make(chan struct{})}
	t.Cleanup(func() { _ = listener.Close() })

	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		defer func() { _ = conn.Close() }()
		defer close(s.done)
		_ = conn.SetDeadline(time.Now().Add(10 * time.Second))

		reader := bufio.NewReader(conn)
		write := func(line string) { _, _ = conn.Write([]byte(line + "\r\n")) }

		write("220 fake.test ESMTP")
		inData := false
		for {
			line, err := reader.ReadString('\n')
			if err != nil {
				return
			}
			line = strings.TrimRight(line, "\r\n")

			if inData {
				if line == "." {
					inData = false
					write("250 2.0.0 Ok: queued as FAKE")
					continue
				}
				s.mu.Lock()
				s.dataLines = append(s.dataLines, line)
				s.mu.Unlock()
				continue
			}

			upper := strings.ToUpper(line)
			switch {
			case strings.HasPrefix(upper, "EHLO"), strings.HasPrefix(upper, "LHLO"):
				// Advertised exactly as Postfix does, which is what made the
				// real client reach for it.
				write("250-fake.test")
				write("250-PIPELINING")
				write("250-SIZE 10240000")
				write("250-STARTTLS")
				write("250 8BITMIME")
			case strings.HasPrefix(upper, "HELO"):
				write("250 fake.test")
			case strings.HasPrefix(upper, "STARTTLS"):
				s.mu.Lock()
				s.triedTLS = true
				s.mu.Unlock()
				write("454 4.7.0 TLS not available")
			case strings.HasPrefix(upper, "MAIL FROM:"):
				s.mu.Lock()
				s.envFrom = addressIn(line)
				s.mu.Unlock()
				write("250 2.1.0 Ok")
			case strings.HasPrefix(upper, "RCPT TO:"):
				s.mu.Lock()
				s.envTo = append(s.envTo, addressIn(line))
				s.mu.Unlock()
				write("250 2.1.5 Ok")
			case strings.HasPrefix(upper, "DATA"):
				inData = true
				write("354 End data with <CR><LF>.<CR><LF>")
			case strings.HasPrefix(upper, "QUIT"):
				write("221 2.0.0 Bye")
				return
			default:
				write("250 2.0.0 Ok")
			}
		}
	}()
	return s
}

/*
The address out of a MAIL FROM or RCPT TO line.

Between the angle brackets, not "everything after the colon": the command can
carry ESMTP parameters after the address — `MAIL FROM:<a@b> BODY=8BITMIME` when
the server has advertised 8BITMIME, which this one does. Trimming brackets off
the whole remainder swallowed the parameter and failed a test that was right
about the thing it was actually checking.
*/
func addressIn(line string) string {
	open := strings.IndexByte(line, '<')
	closed := strings.IndexByte(line, '>')
	if open < 0 || closed < open {
		return strings.TrimSpace(line[strings.IndexByte(line, ':')+1:])
	}
	return line[open+1 : closed]
}

func (s *fakeSMTP) body(t *testing.T) string {
	t.Helper()
	select {
	case <-s.done:
	case <-time.After(10 * time.Second):
		t.Fatal("the fake server never finished the conversation")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return strings.Join(s.dataLines, "\n")
}

func TestSendDoesNotReachForSTARTTLS(t *testing.T) {
	server := startFakeSMTP(t)
	mailer, err := NewSMTPMailer(server.addr, "Thwart <no-reply@thwart.app>", nil)
	if err != nil {
		// The constructor only accepts loopback, and the listener is on
		// 127.0.0.1, so this would mean the address parsing broke.
		t.Fatalf("new mailer: %v", err)
	}

	if err := mailer.Send(context.Background(), "someone@example.test", "Hello", "a body\n"); err != nil {
		t.Fatalf("send: %v", err)
	}

	message := server.body(t)

	server.mu.Lock()
	tried, from, to := server.triedTLS, server.envFrom, server.envTo
	server.mu.Unlock()

	if tried {
		t.Error("the client issued STARTTLS; on the loopback that only introduces a certificate to fail on")
	}
	if from != "no-reply@thwart.app" {
		t.Errorf("envelope sender %q, want the bare address out of From", from)
	}
	if len(to) != 1 || to[0] != "someone@example.test" {
		t.Errorf("envelope recipients %v", to)
	}
	if !strings.Contains(message, "Subject: Hello") {
		t.Errorf("subject missing from the message:\n%s", message)
	}
	if !strings.Contains(message, "From: Thwart <no-reply@thwart.app>") {
		t.Errorf("From header missing:\n%s", message)
	}
	if !strings.Contains(message, "a body") {
		t.Errorf("body missing:\n%s", message)
	}
	// The id has to be aligned with the From domain, not with the machine's
	// hostname: a Message-ID at mail.thwart.app while From says thwart.app is a
	// mismatch some filters score.
	if !strings.Contains(message, "@thwart.app>") {
		t.Errorf("Message-ID is not aligned with the sending domain:\n%s", message)
	}
}

func TestSendRefusesToSplitAHeader(t *testing.T) {
	server := startFakeSMTP(t)
	mailer, err := NewSMTPMailer(server.addr, "Thwart <no-reply@thwart.app>", nil)
	if err != nil {
		t.Fatalf("new mailer: %v", err)
	}
	err = mailer.Send(context.Background(), "someone@example.test\r\nBcc: everyone@example.test", "Hello", "body")
	if err == nil {
		t.Fatal("a recipient carrying a newline was accepted")
	}
	if err := mailer.Send(context.Background(), "someone@example.test", "Hi\r\nBcc: everyone@example.test", "body"); err == nil {
		t.Fatal("a subject carrying a newline was accepted")
	}
}
