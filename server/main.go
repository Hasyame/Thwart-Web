package main

import (
	"context"
	"errors"
	"flag"
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
	flag.Parse()

	log := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

	if err := run(*addr, *dbPath, log); err != nil {
		log.Error("fatal", "error", err)
		os.Exit(1)
	}
}

func run(addr, dbPath string, log *slog.Logger) error {
	store, err := OpenStore(dbPath)
	if err != nil {
		return err
	}
	defer func() { _ = store.Close() }()

	server, err := NewServer(store, log, buildVersion())
	if err != nil {
		return err
	}

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
