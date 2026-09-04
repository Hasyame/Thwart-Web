package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"runtime/debug"
	"syscall"
	"time"
)

/*
Entry point.

One binary, one SQLite file, listening on loopback behind nginx. Doc 05 has the
runbook; this file only has to make the process start cleanly, stop cleanly, and
say why when it cannot.
*/

func main() {
	addr := flag.String("addr", "127.0.0.1:8787",
		"address to listen on; loopback by default because nginx terminates TLS in front")
	dbPath := flag.String("db", "thwart.sqlite", "path to the SQLite database file")
	/*
		Whether anybody may create an account here.

		Open by default, because that is what a fresh self-hosted instance
		needs and because closing it by default would make the first run a
		puzzle. An instance that is meant for one household closes it once
		those accounts exist, and then the only way in is a password or a
		recovery code for an account that is already there.

		A server flag rather than something the client decides: hiding the
		form in the interface stops nobody, since the endpoint is one curl
		away.
	*/
	openRegistration := flag.Bool("registration", true,
		"accept new accounts; set false once the accounts that should exist do")
	/*
		Write a consistent snapshot and exit, without stopping the server.

		Doc 05 section 3 asks for this on the binary rather than leaving it to
		a `sqlite3` on the host: the backup script should not depend on a tool
		that may not be installed, and copying the database file is not a
		backup. In WAL mode the file on disk is not a complete database —
		recent transactions live in the -wal beside it — so a plain `cp` yields
		something that opens without complaint and is missing the last hour.
		That is the worst kind of backup, because it looks like one.
	*/
	backupTo := flag.String("backup", "",
		"write a consistent snapshot to this path and exit, leaving any running server alone")
	flag.Parse()

	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	if *backupTo != "" {
		if err := backup(*dbPath, *backupTo); err != nil {
			log.Error("backup", "error", err)
			os.Exit(1)
		}
		log.Info("backed up", "db", *dbPath, "to", *backupTo)
		return
	}

	if err := run(*addr, *dbPath, *openRegistration, log); err != nil {
		log.Error("fatal", "error", err)
		os.Exit(1)
	}
}

/*
A snapshot of a live database.

VACUUM INTO is the supported way to do this: it reads through the normal
transaction machinery, so it takes a consistent view without blocking writers
and without needing the -wal copied separately. The result is a single file
that is already compact, and it is a real database rather than a text dump, so
restoring it is a move rather than a replay.

It refuses to overwrite, which is SQLite's own behaviour and worth keeping:
every caller here writes to a fresh timestamped path, and a backup that
silently replaced yesterday's would be a way to lose two at once.
*/
func backup(dbPath, to string) error {
	if dbPath == to {
		return fmt.Errorf("refusing to back up %s onto itself", dbPath)
	}
	store, err := OpenStore(dbPath)
	if err != nil {
		return err
	}
	defer func() { _ = store.Close() }()
	return store.Backup(context.Background(), to)
}

func run(addr, dbPath string, openRegistration bool, log *slog.Logger) error {
	store, err := OpenStore(dbPath)
	if err != nil {
		return err
	}
	defer func() { _ = store.Close() }()

	server, err := NewServer(store, log, buildVersion())
	if err != nil {
		return err
	}
	server.OpenRegistration = openRegistration
	log.Info("configured", "registration", map[bool]string{true: "open", false: "closed"}[openRegistration])

	httpServer := &http.Server{
		Addr:    addr,
		Handler: server.Handler(),
		// A slow-loris client should not be able to hold a connection open for
		// free. The write budget is generous because Argon2id at 64 MiB is
		// deliberately slow, and a login runs one.
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	// The rate limiter keeps a map keyed by whatever unauthenticated callers
	// send, so something has to drop the expired entries or it grows forever.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go sweepUntil(ctx, server.limiter, 10*time.Minute)

	// Tombstones and stored push responses expire. Doc 02 §5: a delete stays
	// describable for 180 days, long enough that a phone left in a drawer over
	// a summer still merges correctly, and the sweep raises the horizon a
	// client is measured against.
	go sweepRecords(ctx, store, log, 6*time.Hour)

	errs := make(chan error, 1)
	go func() {
		log.Info("listening", "addr", addr, "db", dbPath, "build", server.build)
		if err := httpServer.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errs <- err
		}
	}()

	select {
	case err := <-errs:
		return err
	case <-ctx.Done():
	}

	// In-flight requests get a moment to finish rather than being cut off
	// mid-write, which for a password change is the difference between a clear
	// outcome and one nobody can explain afterwards.
	log.Info("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	return httpServer.Shutdown(shutdownCtx)
}

func sweepUntil(ctx context.Context, l *limiter, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			l.sweep()
		}
	}
}

func sweepRecords(ctx context.Context, store *Store, log *slog.Logger, every time.Duration) {
	ticker := time.NewTicker(every)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			tombstones, batches, err := store.Sweep(ctx, time.Now())
			if err != nil {
				log.Error("sweep", "error", err)
				continue
			}
			if tombstones > 0 || batches > 0 {
				log.Info("swept", "tombstones", tombstones, "batches", batches)
			}
		}
	}
}

// buildVersion reports the VCS revision Go stamps into the binary, so
// /v1/version answers with something traceable without a build script having to
// pass it in.
func buildVersion() string {
	info, ok := debug.ReadBuildInfo()
	if !ok {
		return "unknown"
	}
	revision, modified := "unknown", false
	for _, setting := range info.Settings {
		switch setting.Key {
		case "vcs.revision":
			revision = setting.Value
		case "vcs.modified":
			modified = setting.Value == "true"
		}
	}
	if len(revision) > 12 {
		revision = revision[:12]
	}
	if modified {
		return revision + "-dirty"
	}
	return revision
}
