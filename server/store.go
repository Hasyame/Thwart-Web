package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	_ "modernc.org/sqlite"
)

/*
Storage.

SQLite, one file, embedded in this process. Doc 03 (ADR-202) argues the case:
the whole of one user's data is a couple of megabytes, writes are serialised per
account anyway, and the alternative is operating a database server this project
does not need. The driver is modernc.org/sqlite, which is pure Go, so the binary
has no cgo and no shared libraries to go missing on a server.

All SQL lives here behind a small surface, so that if SQLite is ever outgrown
the replacement is a few hundred lines in one file rather than a search through
handlers.
*/

// Schema is applied at startup, in order, inside a transaction. Forward only:
// rolling back means restoring the backup taken just before, which is a
// procedure that works, unlike a down migration nobody has ever run.
var migrations = []string{
	`CREATE TABLE IF NOT EXISTS schema_version (
		version INTEGER NOT NULL
	)`,

	// There is deliberately no email column.
	//
	// Not a nullable one, not an empty string: absent. "This instance holds no
	// email address for this user" is then a structural fact about the schema
	// rather than a policy somebody has to remember to honour. If optional
	// email is ever added it goes in its own table, with no row for the vast
	// majority of accounts.
	`CREATE TABLE IF NOT EXISTS account (
		id            TEXT PRIMARY KEY,
		handle        TEXT NOT NULL,
		password_hash TEXT NOT NULL,
		recovery_hash TEXT NOT NULL,
		created_at    INTEGER NOT NULL,
		-- The per-account revision counter the sync protocol will allocate
		-- from. Unused until sync lands; here now so that adding it later is
		-- not a migration on live accounts.
		revision      INTEGER NOT NULL DEFAULT 0
	)`,

	// Handles are compared case-insensitively, so "Benoit" and "benoit" cannot
	// both exist and be confused for one another at a login prompt.
	`CREATE UNIQUE INDEX IF NOT EXISTS account_handle ON account (handle COLLATE NOCASE)`,

	// One row per signed-in device. The token itself is never stored, only its
	// SHA-256: a database dump then yields nothing that can be replayed.
	`CREATE TABLE IF NOT EXISTS device (
		id         TEXT PRIMARY KEY,
		account_id TEXT NOT NULL REFERENCES account(id) ON DELETE CASCADE,
		token_hash TEXT NOT NULL,
		name       TEXT NOT NULL DEFAULT '',
		created_at INTEGER NOT NULL,
		last_seen  INTEGER NOT NULL
	)`,
	`CREATE UNIQUE INDEX IF NOT EXISTS device_token ON device (token_hash)`,
	`CREATE INDEX IF NOT EXISTS device_account ON device (account_id)`,
}

type Store struct {
	db *sql.DB
}

type Account struct {
	ID           string
	Handle       string
	PasswordHash string
	RecoveryHash string
	CreatedAt    time.Time
}

type Device struct {
	ID        string
	AccountID string
	Name      string
	CreatedAt time.Time
	LastSeen  time.Time
}

var ErrNotFound = errors.New("not found")

// ErrHandleTaken is returned rather than the driver's constraint error, so a
// handler never has to match on a message string to know what happened.
var ErrHandleTaken = errors.New("handle taken")

func OpenStore(path string) (*Store, error) {
	// WAL so readers never block the writer. busy_timeout so a concurrent write
	// waits rather than failing immediately, and foreign_keys because SQLite
	// does not enforce them unless asked, which would quietly orphan devices
	// when an account is deleted.
	dsn := fmt.Sprintf(
		"file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_pragma=synchronous(NORMAL)",
		path,
	)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}

	// One writer. SQLite allows only one anyway, and saying so here means a
	// second write waits in Go rather than colliding in the driver.
	db.SetMaxOpenConns(1)
	db.SetConnMaxLifetime(0)

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping %s: %w", path, err)
	}

	s := &Store{db: db}
	if err := s.migrate(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) migrate() error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	for _, stmt := range migrations {
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("migration failed: %w", err)
		}
	}
	return tx.Commit()
}

func (s *Store) Close() error { return s.db.Close() }

// CreateAccount stores a new account. The caller has already hashed both
// secrets: this layer never sees a password or a recovery code in clear.
func (s *Store) CreateAccount(ctx context.Context, a Account) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO account (id, handle, password_hash, recovery_hash, created_at)
		 VALUES (?, ?, ?, ?, ?)`,
		a.ID, a.Handle, a.PasswordHash, a.RecoveryHash, a.CreatedAt.UnixMilli(),
	)
	if err != nil {
		// modernc reports this as a message rather than a typed error, so the
		// index name is what identifies it.
		if containsAny(err.Error(), "UNIQUE constraint failed", "constraint failed: UNIQUE") {
			return ErrHandleTaken
		}
		return err
	}
	return nil
}

func (s *Store) AccountByHandle(ctx context.Context, handle string) (Account, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, handle, password_hash, recovery_hash, created_at
		   FROM account WHERE handle = ? COLLATE NOCASE`, handle)
	return scanAccount(row)
}

func (s *Store) AccountByID(ctx context.Context, id string) (Account, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, handle, password_hash, recovery_hash, created_at
		   FROM account WHERE id = ?`, id)
	return scanAccount(row)
}

func scanAccount(row *sql.Row) (Account, error) {
	var a Account
	var created int64
	if err := row.Scan(&a.ID, &a.Handle, &a.PasswordHash, &a.RecoveryHash, &created); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Account{}, ErrNotFound
		}
		return Account{}, err
	}
	a.CreatedAt = time.UnixMilli(created).UTC()
	return a, nil
}

func (s *Store) SetPasswordHash(ctx context.Context, accountID, hash string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE account SET password_hash = ? WHERE id = ?`, hash, accountID)
	return err
}

func (s *Store) SetRecoveryHash(ctx context.Context, accountID, hash string) error {
	_, err := s.db.ExecContext(ctx,
		`UPDATE account SET recovery_hash = ? WHERE id = ?`, hash, accountID)
	return err
}

func (s *Store) CreateDevice(ctx context.Context, d Device, tokenHash string) error {
	_, err := s.db.ExecContext(ctx,
		`INSERT INTO device (id, account_id, token_hash, name, created_at, last_seen)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		d.ID, d.AccountID, tokenHash, d.Name, d.CreatedAt.UnixMilli(), d.LastSeen.UnixMilli(),
	)
	return err
}

// DeviceByTokenHash resolves a bearer token to its device, and stamps last_seen.
func (s *Store) DeviceByTokenHash(ctx context.Context, tokenHash string) (Device, error) {
	row := s.db.QueryRowContext(ctx,
		`SELECT id, account_id, name, created_at, last_seen
		   FROM device WHERE token_hash = ?`, tokenHash)

	var d Device
	var created, seen int64
	if err := row.Scan(&d.ID, &d.AccountID, &d.Name, &created, &seen); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return Device{}, ErrNotFound
		}
		return Device{}, err
	}
	d.CreatedAt = time.UnixMilli(created).UTC()
	d.LastSeen = time.UnixMilli(seen).UTC()

	// Best effort: a failure to record when a device was last seen is not a
	// reason to refuse the request it was making.
	_, _ = s.db.ExecContext(ctx,
		`UPDATE device SET last_seen = ? WHERE token_hash = ?`,
		time.Now().UnixMilli(), tokenHash)

	return d, nil
}

func (s *Store) DevicesForAccount(ctx context.Context, accountID string) ([]Device, error) {
	rows, err := s.db.QueryContext(ctx,
		`SELECT id, account_id, name, created_at, last_seen
		   FROM device WHERE account_id = ? ORDER BY created_at`, accountID)
	if err != nil {
		return nil, err
	}
	defer func() { _ = rows.Close() }()

	var out []Device
	for rows.Next() {
		var d Device
		var created, seen int64
		if err := rows.Scan(&d.ID, &d.AccountID, &d.Name, &created, &seen); err != nil {
			return nil, err
		}
		d.CreatedAt = time.UnixMilli(created).UTC()
		d.LastSeen = time.UnixMilli(seen).UTC()
		out = append(out, d)
	}
	return out, rows.Err()
}

// DeleteDevice revokes one device, and only if it belongs to this account:
// without that condition a token could revoke a stranger's session by id.
func (s *Store) DeleteDevice(ctx context.Context, accountID, deviceID string) error {
	res, err := s.db.ExecContext(ctx,
		`DELETE FROM device WHERE id = ? AND account_id = ?`, deviceID, accountID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteOtherDevices signs out every device except the one given. Used after a
// password change and after a recovery, where the point is to lock out whoever
// prompted it.
func (s *Store) DeleteOtherDevices(ctx context.Context, accountID, keepDeviceID string) error {
	_, err := s.db.ExecContext(ctx,
		`DELETE FROM device WHERE account_id = ? AND id <> ?`, accountID, keepDeviceID)
	return err
}

func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if len(sub) <= len(s) && indexOf(s, sub) >= 0 {
			return true
		}
	}
	return false
}

func indexOf(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
