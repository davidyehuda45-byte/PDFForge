package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
)

const postgresSchema = `
CREATE TABLE IF NOT EXISTS pdfforge_sessions (
    session_hash BYTEA PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS pdfforge_sessions_expiry_idx
    ON pdfforge_sessions (expires_at);

CREATE TABLE IF NOT EXISTS pdfforge_jobs (
    id TEXT PRIMARY KEY,
    owner_hash BYTEA NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    target TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    finished_at TIMESTAMPTZ,
    files JSONB NOT NULL DEFAULT '[]'::jsonb,
    outputs JSONB NOT NULL DEFAULT '[]'::jsonb,
    error TEXT NOT NULL DEFAULT '',
    warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS pdfforge_jobs_owner_created_idx
    ON pdfforge_jobs (owner_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS pdfforge_jobs_expiry_idx
    ON pdfforge_jobs (expires_at);
`

const mysqlSchema = `
CREATE TABLE IF NOT EXISTS pdfforge_sessions (
    session_hash VARBINARY(32) NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (session_hash),
    KEY pdfforge_sessions_expiry_idx (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS pdfforge_jobs (
    id VARCHAR(64) NOT NULL,
    owner_hash VARBINARY(32) NOT NULL,
    status VARCHAR(32) NOT NULL,
    progress INT NOT NULL DEFAULT 0,
    message VARCHAR(255) NOT NULL DEFAULT '',
    target VARCHAR(32) NOT NULL,
    created_at DATETIME(6) NOT NULL,
    finished_at DATETIME(6) NULL,
    files JSON NOT NULL,
    outputs JSON NOT NULL,
    error TEXT NOT NULL,
    warnings JSON NOT NULL,
    expires_at DATETIME(6) NOT NULL,
    PRIMARY KEY (id),
    KEY pdfforge_jobs_owner_created_idx (owner_hash, created_at DESC),
    KEY pdfforge_jobs_expiry_idx (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`

type storedSourceFile struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Size int64  `json:"size"`
	Kind string `json:"kind"`
}

type storedOutputFile struct {
	Name string `json:"name"`
	Path string `json:"path"`
	Size int64  `json:"size"`
	From string `json:"from"`
}

func databaseURLFromEnv() (string, error) {
	if value := strings.TrimSpace(os.Getenv("DATABASE_URL")); value != "" {
		return value, nil
	}
	host := strings.TrimSpace(os.Getenv("DB_HOST"))
	if host == "" {
		return "", errors.New("DATABASE_URL or DB_HOST is required")
	}
	port := envString("DB_PORT", "5432")
	name := envString("DB_NAME", "pdfforge")
	user := envString("DB_USER", "pdfforge")
	password := os.Getenv("DB_PASSWORD")
	sslmode := envString("DB_SSLMODE", "require")
	connectionURL := &url.URL{
		Scheme: "postgres",
		User:   url.UserPassword(user, password),
		Host:   net.JoinHostPort(host, port),
		Path:   name,
	}
	query := connectionURL.Query()
	query.Set("sslmode", sslmode)
	connectionURL.RawQuery = query.Encode()
	return connectionURL.String(), nil
}

// databaseDriverFromEnv decides which database to use. DATABASE_URL with a
// mysql:// scheme (or DB_DRIVER=mysql) selects MySQL; everything else uses
// PostgreSQL for backwards compatibility.
func databaseDriverFromEnv() (string, string, error) {
	if raw := strings.TrimSpace(os.Getenv("DATABASE_URL")); raw != "" {
		if strings.HasPrefix(raw, "mysql://") {
			parsed, err := url.Parse(raw)
			if err != nil {
				return "", "", fmt.Errorf("invalid DATABASE_URL: %w", err)
			}
			cfg := mysql.NewConfig()
			if parsed.User != nil {
				cfg.User = parsed.User.Username()
				if password, ok := parsed.User.Password(); ok {
					cfg.Passwd = password
				}
			}
			cfg.Net = "tcp"
			cfg.Addr = parsed.Host
			cfg.DBName = strings.TrimPrefix(parsed.Path, "/")
			cfg.ParseTime = true
			cfg.Loc = time.UTC
			return "mysql", cfg.FormatDSN(), nil
		}
		return "postgres", raw, nil
	}
	if strings.EqualFold(envString("DB_DRIVER", "postgres"), "mysql") {
		dsn, err := mysqlDSNFromEnv()
		return "mysql", dsn, err
	}
	dsn, err := databaseURLFromEnv()
	return "postgres", dsn, err
}

func mysqlDSNFromEnv() (string, error) {
	host := strings.TrimSpace(os.Getenv("DB_HOST"))
	if host == "" {
		return "", errors.New("DATABASE_URL or DB_HOST is required")
	}
	cfg := mysql.NewConfig()
	cfg.User = envString("DB_USER", "pdfforge")
	cfg.Passwd = os.Getenv("DB_PASSWORD")
	cfg.Net = "tcp"
	cfg.Addr = net.JoinHostPort(host, envString("DB_PORT", "3306"))
	cfg.DBName = envString("DB_NAME", "pdfforge")
	cfg.ParseTime = true
	cfg.Loc = time.UTC
	cfg.Collation = "utf8mb4_unicode_ci"
	return cfg.FormatDSN(), nil
}

func openDatabase(ctx context.Context, driver, dsn string) (*sql.DB, error) {
	if driver == "mysql" {
		return openMySQL(ctx, dsn)
	}
	return openPostgres(ctx, dsn)
}

func openMySQL(ctx context.Context, dsn string) (*sql.DB, error) {
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, fmt.Errorf("open MySQL connection: %w", err)
	}
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("connect to MySQL: %w", err)
	}
	for _, statement := range strings.Split(mysqlSchema, ";") {
		if strings.TrimSpace(statement) == "" {
			continue
		}
		if _, err := db.ExecContext(ctx, statement); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("initialize MySQL schema: %w", err)
		}
	}
	return db, nil
}

func openPostgres(ctx context.Context, dsn string) (*sql.DB, error) {
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		return nil, fmt.Errorf("open PostgreSQL connection: %w", err)
	}
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("connect to PostgreSQL: %w", err)
	}
	for _, statement := range strings.Split(postgresSchema, ";") {
		if strings.TrimSpace(statement) == "" {
			continue
		}
		if _, err := db.ExecContext(ctx, statement); err != nil {
			_ = db.Close()
			return nil, fmt.Errorf("initialize PostgreSQL schema: %w", err)
		}
	}
	return db, nil
}

func hashSessionID(sessionID string) []byte {
	sum := sha256.Sum256([]byte(sessionID))
	return sum[:]
}

func sessionOwnerID(sessionID string) string {
	return hex.EncodeToString(hashSessionID(sessionID))
}

func ownerIDFromHash(value []byte) string {
	return hex.EncodeToString(value)
}

var sqlPlaceholderPattern = regexp.MustCompile(`\$[0-9]+`)

// q adapts a PostgreSQL-flavoured statement for the active database driver.
func (s *server) q(statement string) string {
	if s.driver != "mysql" {
		return statement
	}
	statement = sqlPlaceholderPattern.ReplaceAllString(statement, "?")
	return strings.ReplaceAll(statement, "NOW()", "UTC_TIMESTAMP(6)")
}

func (s *server) upsertSessionSQL() string {
	if s.driver == "mysql" {
		return `INSERT INTO pdfforge_sessions (session_hash, expires_at)
			VALUES (?, ?)
			ON DUPLICATE KEY UPDATE expires_at = VALUES(expires_at)`
	}
	return `INSERT INTO pdfforge_sessions (session_hash, expires_at)
		VALUES ($1, $2)
		ON CONFLICT (session_hash) DO UPDATE SET expires_at = EXCLUDED.expires_at`
}

func (s *server) upsertJobSQL() string {
	if s.driver == "mysql" {
		return `INSERT INTO pdfforge_jobs
			(id, owner_hash, status, progress, message, target, created_at, finished_at, files, outputs, error, warnings, expires_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE
				status = VALUES(status),
				progress = VALUES(progress),
				message = VALUES(message),
				finished_at = VALUES(finished_at),
				files = VALUES(files),
				outputs = VALUES(outputs),
				error = VALUES(error),
				warnings = VALUES(warnings),
				expires_at = VALUES(expires_at)`
	}
	return `INSERT INTO pdfforge_jobs
			(id, owner_hash, status, progress, message, target, created_at, finished_at, files, outputs, error, warnings, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
		ON CONFLICT (id) DO UPDATE SET
			status = EXCLUDED.status,
			progress = EXCLUDED.progress,
			message = EXCLUDED.message,
			finished_at = EXCLUDED.finished_at,
			files = EXCLUDED.files,
			outputs = EXCLUDED.outputs,
			error = EXCLUDED.error,
			warnings = EXCLUDED.warnings,
			expires_at = EXCLUDED.expires_at`
}

func (s *server) persistSession(ctx context.Context, id string, expires time.Time) error {
	_, err := s.db.ExecContext(ctx, s.upsertSessionSQL(), hashSessionID(id), expires)
	return err
}

func (s *server) lookupSession(ctx context.Context, id string) (time.Time, bool, error) {
	var expires time.Time
	err := s.db.QueryRowContext(ctx,
		s.q(`SELECT expires_at FROM pdfforge_sessions WHERE session_hash = $1`),
		hashSessionID(id)).Scan(&expires)
	if errors.Is(err, sql.ErrNoRows) {
		return time.Time{}, false, nil
	}
	if err != nil {
		return time.Time{}, false, err
	}
	if !expires.After(time.Now()) {
		_, err = s.db.ExecContext(ctx,
			s.q(`DELETE FROM pdfforge_sessions WHERE session_hash = $1`), hashSessionID(id))
		return time.Time{}, false, err
	}
	return expires, true, nil
}

func (s *server) persistJob(ctx context.Context, j *job) error {
	j.mu.RLock()
	files := make([]storedSourceFile, 0, len(j.Files))
	for _, file := range j.Files {
		files = append(files, storedSourceFile{Name: file.Name, Path: file.Path, Size: file.Size, Kind: file.Kind})
	}
	outputs := make([]storedOutputFile, 0, len(j.Outputs))
	for _, output := range j.Outputs {
		outputs = append(outputs, storedOutputFile{Name: output.Name, Path: output.Path, Size: output.Size, From: output.From})
	}
	warnings := append([]string(nil), j.Warnings...)
	ownerHash, err := hex.DecodeString(j.OwnerID)
	if err != nil {
		j.mu.RUnlock()
		return errors.New("invalid job owner identifier")
	}
	id, status, progress, message, target := j.ID, j.Status, j.Progress, j.Message, j.Target
	createdAt, finishedAt, jobError := j.CreatedAt, j.FinishedAt, j.Error
	j.mu.RUnlock()

	filesJSON, err := json.Marshal(files)
	if err != nil {
		return err
	}
	outputsJSON, err := json.Marshal(outputs)
	if err != nil {
		return err
	}
	warningsJSON, err := json.Marshal(warnings)
	if err != nil {
		return err
	}
	expiresAt := createdAt.Add(s.cfg.retention)
	_, err = s.db.ExecContext(ctx, s.upsertJobSQL(),
		id, ownerHash, status, progress, message, target, createdAt, finishedAt,
		string(filesJSON), string(outputsJSON), jobError, string(warningsJSON), expiresAt)
	return err
}

func (s *server) scanJob(row interface{ Scan(...any) error }) (*job, error) {
	var (
		id, status, message, target, jobError           string
		ownerHash, filesJSON, outputsJSON, warningsJSON []byte
		progress                                        int
		createdAt                                       time.Time
		finishedAt                                      sql.NullTime
	)
	if err := row.Scan(&id, &ownerHash, &status, &progress, &message, &target, &createdAt,
		&finishedAt, &filesJSON, &outputsJSON, &jobError, &warningsJSON); err != nil {
		return nil, err
	}
	var storedFiles []storedSourceFile
	var storedOutputs []storedOutputFile
	var warnings []string
	if err := json.Unmarshal(filesJSON, &storedFiles); err != nil {
		return nil, errors.New("job source metadata is invalid")
	}
	if err := json.Unmarshal(outputsJSON, &storedOutputs); err != nil {
		return nil, errors.New("job output metadata is invalid")
	}
	if err := json.Unmarshal(warningsJSON, &warnings); err != nil {
		return nil, errors.New("job warning metadata is invalid")
	}
	j := &job{
		ID: id, OwnerID: ownerIDFromHash(ownerHash), Status: status, Progress: progress,
		Message: message, Target: target, CreatedAt: createdAt, Error: jobError,
		Files:   make([]sourceFile, 0, len(storedFiles)),
		Outputs: make([]outputFile, 0, len(storedOutputs)), Warnings: warnings,
	}
	if finishedAt.Valid {
		value := finishedAt.Time
		j.FinishedAt = &value
	}
	for _, file := range storedFiles {
		j.Files = append(j.Files, sourceFile{Name: file.Name, Path: file.Path, Size: file.Size, Kind: file.Kind})
	}
	for _, output := range storedOutputs {
		j.Outputs = append(j.Outputs, outputFile{Name: output.Name, Path: output.Path, Size: output.Size, From: output.From})
	}
	if err := s.validateStoredJobPaths(j); err != nil {
		return nil, err
	}
	return j, nil
}

func (s *server) validateStoredJobPaths(j *job) error {
	jobID, err := hex.DecodeString(j.ID)
	if err != nil || len(jobID) != 16 {
		return errors.New("job identifier is invalid")
	}
	uploadsRoot, err := filepath.Abs(filepath.Join(s.cfg.storage, "uploads"))
	if err != nil {
		return err
	}
	resultsRoot, err := filepath.Abs(filepath.Join(s.cfg.storage, "results", j.ID))
	if err != nil {
		return err
	}
	for _, file := range j.Files {
		if !pathWithin(uploadsRoot, file.Path) {
			return errors.New("job source path is outside private upload storage")
		}
	}
	for _, output := range j.Outputs {
		if !pathWithin(resultsRoot, output.Path) {
			return errors.New("job output path is outside its private result directory")
		}
	}
	return nil
}

func pathWithin(root, path string) bool {
	absoluteRoot, err := filepath.Abs(root)
	if err != nil {
		return false
	}
	absolutePath, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	relative, err := filepath.Rel(absoluteRoot, absolutePath)
	if err != nil || relative == "." || filepath.IsAbs(relative) {
		return false
	}
	return relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func (s *server) findOwnedJob(ctx context.Context, id, owner string) (*job, error) {
	ownerHash, err := hex.DecodeString(owner)
	if err != nil {
		return nil, errors.New("invalid job owner identifier")
	}
	row := s.db.QueryRowContext(ctx, s.q(`
		SELECT id, owner_hash, status, progress, message, target, created_at, finished_at,
		       files, outputs, error, warnings
		FROM pdfforge_jobs
		WHERE id = $1 AND owner_hash = $2 AND expires_at > NOW()`),
		id, ownerHash)
	j, err := s.scanJob(row)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	return j, err
}

func (s *server) loadHistory(ctx context.Context, owner string) ([]*job, error) {
	ownerHash, err := hex.DecodeString(owner)
	if err != nil {
		return nil, errors.New("invalid job owner identifier")
	}
	rows, err := s.db.QueryContext(ctx, s.q(`
		SELECT id, owner_hash, status, progress, message, target, created_at, finished_at,
		       files, outputs, error, warnings
		FROM pdfforge_jobs
		WHERE owner_hash = $1 AND expires_at > NOW()
		ORDER BY created_at DESC LIMIT 50`), ownerHash)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	jobs := make([]*job, 0, 50)
	for rows.Next() {
		j, err := s.scanJob(rows)
		if err != nil {
			return nil, err
		}
		jobs = append(jobs, j)
	}
	return jobs, rows.Err()
}

func (s *server) restoreJobs(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, s.q(`DELETE FROM pdfforge_jobs WHERE expires_at <= NOW()`))
	if err != nil {
		return err
	}
	rows, err := s.db.QueryContext(ctx, s.q(`
		SELECT id, owner_hash, status, progress, message, target, created_at, finished_at,
		       files, outputs, error, warnings
		FROM pdfforge_jobs
		WHERE expires_at > NOW()
		ORDER BY created_at DESC`))
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		j, err := s.scanJob(rows)
		if err != nil {
			return err
		}
		if s.cfg.maxStoredJobs > 0 && len(s.jobs) >= s.cfg.maxStoredJobs {
			return errors.New("the database contains more active jobs than MAX_STORED_JOBS permits")
		}
		if j.Status == "queued" || j.Status == "processing" {
			for _, file := range j.Files {
				if pathWithin(filepath.Join(s.cfg.storage, "uploads"), file.Path) {
					_ = os.Remove(file.Path)
				}
			}
			_ = os.RemoveAll(filepath.Join(s.cfg.storage, "results", j.ID))
			now := time.Now().UTC()
			j.Status, j.Progress, j.Message = "failed", 100, "Conversion interrupted by server restart"
			j.Error, j.FinishedAt = "The server restarted before this conversion finished. Please try again.", &now
			if err := s.persistJob(ctx, j); err != nil {
				return err
			}
		}
		s.jobs[j.ID] = j
	}
	return rows.Err()
}

func (s *server) deletePersistedJob(ctx context.Context, id, owner string) (bool, error) {
	ownerHash, err := hex.DecodeString(owner)
	if err != nil {
		return false, errors.New("invalid job owner identifier")
	}
	result, err := s.db.ExecContext(ctx,
		s.q(`DELETE FROM pdfforge_jobs WHERE id = $1 AND owner_hash = $2`), id, ownerHash)
	if err != nil {
		return false, err
	}
	count, err := result.RowsAffected()
	return count > 0, err
}

func (s *server) pruneExpiredSessions(ctx context.Context, now time.Time) error {
	_, err := s.db.ExecContext(ctx, s.q(`DELETE FROM pdfforge_sessions WHERE expires_at <= $1`), now)
	return err
}
