package main

import (
	"archive/zip"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"math"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
	"unicode"
)

const (
	defaultUploadMB  = 100
	defaultFilesJob  = 20
	defaultPagesFile = 500
	defaultTimeout   = 300 * time.Second
	defaultRetention = 24 * time.Hour
)

type config struct {
	addr          string
	storage       string
	python        string
	maxUpload     int64
	maxOutput     int64
	maxJobOutput  int64
	maxFiles      int
	maxActiveJobs int
	maxQueueJobs  int
	maxStoredJobs int
	maxPages      int
	timeout       time.Duration
	retention     time.Duration
	workerCount   int
	workerScript  string
	clamdscan     string
	trustProxy    bool
	databaseURL   string
	driver        string
}

type sourceFile struct {
	Name string `json:"name"`
	Path string `json:"-"`
	Size int64  `json:"size"`
	Kind string `json:"kind"`
}

type outputFile struct {
	Name string `json:"name"`
	Path string `json:"-"`
	Size int64  `json:"size"`
	From string `json:"from"`
}

type job struct {
	ID         string       `json:"id"`
	Status     string       `json:"status"`
	Progress   int          `json:"progress"`
	Message    string       `json:"message"`
	Target     string       `json:"target"`
	CreatedAt  time.Time    `json:"created_at"`
	FinishedAt *time.Time   `json:"finished_at,omitempty"`
	Files      []sourceFile `json:"files"`
	Outputs    []outputFile `json:"outputs,omitempty"`
	Error      string       `json:"error,omitempty"`
	Warnings   []string     `json:"warnings,omitempty"`
	OwnerID    string       `json:"-"`
	mu         sync.RWMutex `json:"-"`
}

type jobView struct {
	ID         string       `json:"id"`
	Status     string       `json:"status"`
	Progress   int          `json:"progress"`
	Message    string       `json:"message"`
	Target     string       `json:"target"`
	CreatedAt  time.Time    `json:"created_at"`
	FinishedAt *time.Time   `json:"finished_at,omitempty"`
	Files      []sourceFile `json:"files,omitempty"`
	Outputs    []outputFile `json:"outputs,omitempty"`
	Error      string       `json:"error,omitempty"`
	Warnings   []string     `json:"warnings,omitempty"`
}

type server struct {
	cfg            config
	mu             sync.RWMutex
	jobs           map[string]*job
	slots          chan struct{}
	queue          chan struct{}
	reservations   map[string]int
	reservedJobs   int
	caps           []capability
	sessionMu      sync.Mutex
	sessions       map[string]time.Time
	sessionSlotsMu sync.Mutex
	sessionSlots   map[string]*sessionSemaphore
	rateMu         sync.Mutex
	rateEntries    map[string]rateEntry
	db             *sql.DB
	driver         string
	cancelMu       sync.Mutex
	cancels        map[string]context.CancelFunc
}

type sessionSemaphore struct {
	slots chan struct{}
	refs  int
}

type rateEntry struct {
	tokens float64
	lastAt time.Time
}

type boundedBuffer struct {
	mu    sync.Mutex
	data  []byte
	limit int
}

var errMalwareDetected = errors.New("malware detected")
var errJobCancelled = errors.New("job cancelled by user")

func (b *boundedBuffer) Write(data []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	written := len(data)
	if remaining := b.limit - len(b.data); remaining > 0 {
		if len(data) > remaining {
			data = data[:remaining]
		}
		b.data = append(b.data, data...)
	}
	return written, nil
}

func (b *boundedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return string(b.data)
}

type contextKey string

const sessionContextKey contextKey = "session-id"

type capability struct {
	From    string `json:"from"`
	To      string `json:"to"`
	Label   string `json:"label"`
	Quality string `json:"quality,omitempty"`
	Warning string `json:"warning,omitempty"`
}

type workerRequest struct {
	Source       string            `json:"source"`
	MergeSources []string          `json:"merge_sources,omitempty"`
	Output       string            `json:"output"`
	SourceName   string            `json:"source_name"`
	Target       string            `json:"target"`
	Operation    string            `json:"operation"`
	PageRange    string            `json:"page_range,omitempty"`
	Options      map[string]string `json:"options,omitempty"`
}

type workerResponse struct {
	OK           bool   `json:"ok"`
	Message      string `json:"message,omitempty"`
	Warning      string `json:"warning,omitempty"`
	OutputFormat string `json:"output_format,omitempty"`
}

func envInt(name string, fallback int) int {
	if v := os.Getenv(name); v != "" {
		var n int
		if _, err := fmt.Sscanf(v, "%d", &n); err == nil && n > 0 {
			return n
		}
	}
	return fallback
}

func loadConfig() config {
	storage := os.Getenv("STORAGE_PATH")
	if storage == "" {
		storage = "storage"
	}
	python := os.Getenv("PYTHON")
	if python == "" {
		python = "python"
	}
	script := os.Getenv("WORKER_SCRIPT")
	if script == "" {
		script = filepath.Join("worker", "converter.py")
	}
	return config{
		addr:          envString("ADDR", "127.0.0.1:8080"),
		storage:       storage,
		python:        python,
		maxUpload:     int64(envInt("MAX_UPLOAD_SIZE_MB", defaultUploadMB)) << 20,
		maxOutput:     int64(envInt("MAX_OUTPUT_SIZE_MB", 300)) << 20,
		maxJobOutput:  int64(envInt("MAX_JOB_OUTPUT_SIZE_MB", 600)) << 20,
		maxFiles:      envInt("MAX_FILES_PER_JOB", defaultFilesJob),
		maxActiveJobs: envInt("MAX_ACTIVE_JOBS_PER_SESSION", 3),
		maxQueueJobs:  envInt("MAX_QUEUE_JOBS_PER_SESSION", 20),
		maxStoredJobs: envInt("MAX_STORED_JOBS", 100000),
		maxPages:      envInt("MAX_PAGES_PER_FILE", defaultPagesFile),
		timeout:       time.Duration(envInt("JOB_TIMEOUT_SECONDS", int(defaultTimeout.Seconds()))) * time.Second,
		retention:     time.Duration(envInt("FILE_EXPIRATION_HOURS", int(defaultRetention.Hours()))) * time.Hour,
		workerCount:   envInt("WORKER_COUNT", 2),
		workerScript:  script,
		clamdscan:     os.Getenv("CLAMDSCAN"),
		trustProxy:    strings.EqualFold(envString("TRUST_PROXY", "false"), "true"),
	}
}

func envString(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func scanUploadedFile(ctx context.Context, scanner, path string) error {
	cmd := exec.CommandContext(ctx, scanner, "--no-summary", path)
	err := cmd.Run()
	if err == nil {
		return nil
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) && exitErr.ExitCode() == 1 {
		return errMalwareDetected
	}
	return errors.New("malware scanner failed")
}

func workerEnvironment() []string {
	keys := []string{
		"PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "HOME",
		"PYTHONHOME", "PYTHONPATH", "PYTHONUTF8",
		"MAX_PAGES_PER_FILE", "MAX_IMAGE_PIXELS", "MAX_IMAGE_JOB_PIXELS",
		"MAX_ARCHIVE_EXPANDED_MB", "MAX_ARCHIVE_FILES", "MAX_ARCHIVE_COMPRESSION_RATIO",
		"MAX_OUTPUT_SIZE_MB",
	}
	env := make([]string, 0, len(keys))
	for _, key := range keys {
		if value, exists := os.LookupEnv(key); exists {
			env = append(env, key+"="+value)
		}
	}
	return env
}

func loadDotEnv(path string) {
	data, err := os.ReadFile(path)
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			k := strings.TrimSpace(parts[0])
			v := strings.TrimSpace(parts[1])
			if _, exists := os.LookupEnv(k); !exists {
				_ = os.Setenv(k, v)
			}
		}
	}
}

func main() {
	loadDotEnv(".env")
	cfg := loadConfig()
	driver, dsn, err := databaseDriverFromEnv()
	if err != nil {
		log.Fatal("database configuration is required: ", err)
	}
	cfg.driver = driver
	cfg.databaseURL = dsn
	if err := validatePrivateStorage(cfg.storage); err != nil {
		log.Fatalf("unsafe storage configuration: %v", err)
	}
	for _, dir := range []string{cfg.storage, filepath.Join(cfg.storage, "uploads"), filepath.Join(cfg.storage, "results")} {
		if err := os.MkdirAll(dir, 0700); err != nil {
			log.Fatal(err)
		}
	}
	s := &server{
		cfg:          cfg,
		driver:       cfg.driver,
		jobs:         make(map[string]*job),
		slots:        make(chan struct{}, cfg.workerCount),
		queue:        make(chan struct{}, cfg.workerCount*10),
		reservations: make(map[string]int),
		sessions:     make(map[string]time.Time),
		rateEntries:  make(map[string]rateEntry),
		cancels:      make(map[string]context.CancelFunc),
	}
	databaseCtx, databaseCancel := context.WithTimeout(context.Background(), 15*time.Second)
	s.db, err = openDatabase(databaseCtx, cfg.driver, cfg.databaseURL)
	databaseCancel()
	if err != nil {
		log.Fatal("could not initialize the database: ", err)
	}
	defer s.db.Close()
	restoreCtx, restoreCancel := context.WithTimeout(context.Background(), 30*time.Second)
	if err := s.restoreJobs(restoreCtx); err != nil {
		restoreCancel()
		log.Fatal("could not restore conversion history from the database: ", err)
	}
	if err := s.pruneExpiredSessions(restoreCtx, time.Now()); err != nil {
		restoreCancel()
		log.Fatal("could not clean expired database sessions")
	}
	restoreCancel()
	if _, err := exec.LookPath(cfg.python); err != nil {
		log.Fatalf("Python runtime not found (%s): %v", cfg.python, err)
	}
	if _, err := os.Stat(cfg.workerScript); err != nil {
		log.Fatalf("conversion worker not found (%s): %v", cfg.workerScript, err)
	}
	if cfg.clamdscan != "" {
		if _, err := exec.LookPath(cfg.clamdscan); err != nil {
			log.Fatalf("configured malware scanner is not available: %v", err)
		}
	}
	capabilityCommand := exec.Command(cfg.python, cfg.workerScript, "--capabilities")
	capabilityCommand.Env = workerEnvironment()
	capabilityOutput, err := capabilityCommand.Output()
	if err != nil {
		log.Fatalf("could not load conversion capabilities: %v", err)
	}
	if err := json.Unmarshal(capabilityOutput, &s.caps); err != nil || len(s.caps) == 0 {
		log.Fatalf("conversion worker returned an invalid or empty capability registry: %v", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/health", s.handleHealth)
	mux.HandleFunc("GET /api/capabilities", s.handleCapabilities)
	mux.HandleFunc("POST /api/jobs", s.handleCreateJob)
	mux.HandleFunc("GET /api/jobs/{id}", s.handleGetJob)
	mux.HandleFunc("GET /api/jobs/{id}/download", s.handleDownload)
	mux.HandleFunc("GET /api/jobs/{id}/preview", s.handlePreview)
	mux.HandleFunc("GET /api/jobs/{id}/files/{name}", s.handleDownloadFile)
	mux.HandleFunc("DELETE /api/jobs/{id}", s.handleDeleteJob)
	mux.HandleFunc("POST /api/jobs/{id}/cancel", s.handleCancelJob)
	mux.HandleFunc("POST /api/preview", s.handlePreviewPages)
	mux.HandleFunc("GET /api/history", s.handleHistory)
	mux.HandleFunc("POST /api/cloud/import", s.handleCloudImport)
	mux.HandleFunc("GET /api/admin/stats", s.handleAdminStats)
	mux.HandleFunc("GET /api/docs", s.handleAPIDocs)
	mux.HandleFunc("GET /api/openapi.json", s.handleOpenAPI)
	mux.HandleFunc("POST /api/signatures/verify", s.handleVerifySignature)
	mux.Handle("/", http.FileServer(http.Dir("web")))

	go s.cleanupLoop()
	s.removeExpiredDiskFiles()
	httpServer := &http.Server{
		Addr:              cfg.addr,
		Handler:           securityHeaders(s.recovery(s.rateLimit(s.session(mux)))),
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       2 * time.Minute,
		WriteTimeout:      10 * time.Minute,
		IdleTimeout:       60 * time.Second,
	}
	log.Printf("PDFForge listening on %s", cfg.addr)
	log.Printf("File size cap: %d MB; files/job: %d; workers: %d", cfg.maxUpload>>20, cfg.maxFiles, cfg.workerCount)
	log.Fatal(httpServer.ListenAndServe())
}

func securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		w.Header().Set("Cross-Origin-Opener-Policy", "same-origin")
		if r.TLS != nil {
			w.Header().Set("Strict-Transport-Security", "max-age=31536000")
		}
		if strings.HasPrefix(r.URL.Path, "/api/") {
			w.Header().Set("Cache-Control", "no-store")
		}
		w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; script-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'")
		next.ServeHTTP(w, r)
	})
}

func validatePrivateStorage(storage string) error {
	absolute, err := filepath.Abs(storage)
	if err != nil {
		return errors.New("storage path could not be resolved")
	}
	webRoot, err := filepath.Abs("web")
	if err != nil {
		return errors.New("web root could not be resolved")
	}
	absolute, err = filepath.EvalSymlinks(absolute)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return errors.New("storage path could not be resolved")
	}
	webRoot, err = filepath.EvalSymlinks(webRoot)
	if err != nil {
		return errors.New("web root could not be resolved")
	}
	rel, err := filepath.Rel(webRoot, absolute)
	if err != nil {
		return errors.New("storage path could not be validated")
	}
	if rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))) {
		return errors.New("storage must not be located in or under the public web directory")
	}
	return nil
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(status int) {
	if w.status == 0 {
		w.status = status
		w.ResponseWriter.WriteHeader(status)
	}
}

func (w *statusWriter) Write(data []byte) (int, error) {
	if w.status == 0 {
		w.WriteHeader(http.StatusOK)
	}
	return w.ResponseWriter.Write(data)
}

func (s *server) recovery(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sw := &statusWriter{ResponseWriter: w}
		defer func() {
			if recover() != nil {
				log.Printf("handler_panic method=%s", r.Method)
				if sw.status == 0 {
					writeError(sw, http.StatusInternalServerError, "Something went wrong. Please try again.")
				}
			}
		}()
		next.ServeHTTP(sw, r)
	})
}

func (s *server) session(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		secureRequest := r.TLS != nil || (s.cfg.trustProxy && strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https"))
		if origin := r.Header.Get("Origin"); origin != "" && !sameOrigin(origin, r.Host, secureRequest) {
			writeError(w, http.StatusForbidden, "This request origin is not allowed.")
			return
		}
		if r.Header.Get("Sec-Fetch-Site") == "cross-site" && r.Method != http.MethodGet && r.Method != http.MethodHead {
			writeError(w, http.StatusForbidden, "This cross-site request is not allowed.")
			return
		}
		now := time.Now()
		rawSessionID := ""
		if cookie, err := r.Cookie("pdfforge_session"); err == nil {
			s.sessionMu.Lock()
			expires, exists := s.sessions[cookie.Value]
			if exists && expires.After(now) {
				rawSessionID = cookie.Value
			} else if exists {
				delete(s.sessions, cookie.Value)
			}
			s.sessionMu.Unlock()
			if rawSessionID == "" && s.db != nil {
				ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
				expires, valid, lookupErr := s.lookupSession(ctx, cookie.Value)
				cancel()
				if lookupErr != nil {
					writeError(w, http.StatusServiceUnavailable, "Session storage is temporarily unavailable. Please try again.")
					return
				}
				if valid {
					rawSessionID = cookie.Value
					s.sessionMu.Lock()
					if len(s.sessions) < 100000 {
						s.sessions[rawSessionID] = expires
					}
					s.sessionMu.Unlock()
				}
			}
		}
		if rawSessionID == "" {
			id, err := randomID()
			if err != nil {
				writeError(w, http.StatusInternalServerError, "Something went wrong. Please try again.")
				return
			}
			expires := now.Add(24 * time.Hour)
			if s.db != nil {
				ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
				err := s.persistSession(ctx, id, expires)
				cancel()
				if err != nil {
					writeError(w, http.StatusServiceUnavailable, "Session storage is temporarily unavailable. Please try again.")
					return
				}
			}
			s.sessionMu.Lock()
			if len(s.sessions) >= 100000 {
				s.sessionMu.Unlock()
				writeError(w, http.StatusServiceUnavailable, "The service is busy. Please try again shortly.")
				return
			}
			s.sessions[id] = expires
			s.sessionMu.Unlock()
			rawSessionID = id
		}
		expires := now.Add(24 * time.Hour)
		s.sessionMu.Lock()
		s.sessions[rawSessionID] = expires
		s.sessionMu.Unlock()
		if s.db != nil {
			ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
			err := s.persistSession(ctx, rawSessionID, expires)
			cancel()
			if err != nil {
				writeError(w, http.StatusServiceUnavailable, "Session storage is temporarily unavailable. Please try again.")
				return
			}
		}
		http.SetCookie(w, &http.Cookie{
			Name: "pdfforge_session", Value: rawSessionID, Path: "/", HttpOnly: true,
			Secure: secureCookie(r) || secureRequest, SameSite: http.SameSiteStrictMode,
			MaxAge: 86400,
		})
		ctx := context.WithValue(r.Context(), sessionContextKey, rawSessionID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func secureCookie(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	host := r.Host
	if parsedHost, _, err := net.SplitHostPort(host); err == nil {
		host = parsedHost
	}
	if strings.EqualFold(host, "localhost") {
		return false
	}
	if ip := net.ParseIP(host); ip != nil && ip.IsLoopback() {
		return false
	}
	return true
}

func sameOrigin(origin, host string, secure bool) bool {
	expectedScheme := "http"
	if secure {
		expectedScheme = "https"
	}
	parsed, err := url.Parse(origin)
	return err == nil && parsed.User == nil && strings.EqualFold(parsed.Scheme, expectedScheme) &&
		strings.EqualFold(parsed.Host, host) && (parsed.Path == "" || parsed.Path == "/") &&
		parsed.RawQuery == "" && parsed.Fragment == ""
}

func sessionID(r *http.Request) string {
	value, _ := r.Context().Value(sessionContextKey).(string)
	if value == "" {
		return ""
	}
	return sessionOwnerID(value)
}

func (s *server) rateLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r, s.cfg.trustProxy)
		key := ip + ":" + r.Method + ":" + ratePath(r.URL.Path)
		capacity, refill := 120.0, 2.0
		if r.URL.Path == "/api/jobs" && r.Method == http.MethodPost {
			capacity, refill = 10, 10.0/60.0
		} else if r.Method == http.MethodDelete && strings.HasPrefix(r.URL.Path, "/api/jobs/") {
			capacity, refill = 30, 0.5
		} else if strings.HasSuffix(r.URL.Path, "/download") {
			capacity, refill = 30, 0.5
		}
		now := time.Now()
		s.rateMu.Lock()
		if _, exists := s.rateEntries[key]; !exists && len(s.rateEntries) >= 100000 {
			for oldKey, oldEntry := range s.rateEntries {
				if now.Sub(oldEntry.lastAt) > 10*time.Minute {
					delete(s.rateEntries, oldKey)
				}
			}
		}
		_, knownKey := s.rateEntries[key]
		if !knownKey && len(s.rateEntries) >= 100000 {
			s.rateMu.Unlock()
			w.Header().Set("Retry-After", "60")
			writeError(w, http.StatusTooManyRequests, "Too many requests. Please wait a moment and try again.")
			log.Printf("event=rate_limit_capacity_reached")
			return
		}
		entry := s.rateEntries[key]
		if entry.lastAt.IsZero() {
			entry.tokens = capacity
		} else {
			entry.tokens += now.Sub(entry.lastAt).Seconds() * refill
			if entry.tokens > capacity {
				entry.tokens = capacity
			}
		}
		entry.lastAt = now
		allowed := entry.tokens >= 1
		if allowed {
			entry.tokens--
		}
		s.rateEntries[key] = entry
		s.rateMu.Unlock()
		if !allowed {
			log.Printf("event=rate_limited method=%s endpoint=%s", r.Method, ratePath(r.URL.Path))
			w.Header().Set("Retry-After", "60")
			writeError(w, http.StatusTooManyRequests, "Too many requests. Please wait a moment and try again.")
			return
		}
		next.ServeHTTP(w, r)
	})
}

func clientIP(r *http.Request, trustProxy bool) string {
	if trustProxy {
		if forwarded := net.ParseIP(strings.TrimSpace(r.Header.Get("X-Real-IP"))); forwarded != nil {
			return forwarded.String()
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil {
		if parsed := net.ParseIP(host); parsed != nil {
			return parsed.String()
		}
		return host
	}
	return r.RemoteAddr
}

func ratePath(path string) string {
	switch {
	case path == "/api/jobs":
		return "jobs"
	case strings.Contains(path, "/download"):
		return "download"
	case strings.HasPrefix(path, "/api/jobs/"):
		return "job-status"
	default:
		return "other"
	}
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	if s.db != nil {
		if err := s.db.PingContext(ctx); err != nil {
			writeJSON(w, http.StatusServiceUnavailable, map[string]string{
				"status": "degraded", "message": "The database is temporarily unavailable.",
			})
			return
		}
	}
	cmd := exec.CommandContext(ctx, s.cfg.python, s.cfg.workerScript, "--health")
	cmd.Env = workerEnvironment()
	out, err := cmd.Output()
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "degraded", "message": "The conversion engine is unavailable."})
		return
	}
	var worker map[string]any
	if json.Unmarshal(out, &worker) != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "degraded", "message": "The conversion engine returned an invalid health response."})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "database": "ok", "database_driver": s.driver, "engine": worker})
}

func (s *server) handleCapabilities(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"formats": s.caps, "max_upload_bytes": s.cfg.maxUpload,
		"max_output_bytes": s.cfg.maxOutput, "max_job_output_bytes": s.cfg.maxJobOutput,
		"max_files_per_job": s.cfg.maxFiles, "malware_scan_enabled": s.cfg.clamdscan != "",
	})
}

func (s *server) handleCreateJob(w http.ResponseWriter, r *http.Request) {
	owner := sessionID(r)
	if err := s.reserveSessionJob(owner); err != nil {
		writeError(w, http.StatusTooManyRequests, err.Error())
		return
	}
	reserved := true
	defer func() {
		if reserved {
			s.releaseSessionJob(owner)
		}
	}()
	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.maxUpload*int64(s.cfg.maxFiles)+1<<20)
	parseErr := r.ParseMultipartForm(8 << 20)
	if r.MultipartForm != nil {
		defer func() { _ = r.MultipartForm.RemoveAll() }()
	}
	if parseErr != nil {
		var maxBytesError *http.MaxBytesError
		status := http.StatusBadRequest
		if errors.As(parseErr, &maxBytesError) {
			status = http.StatusRequestEntityTooLarge
		}
		writeError(w, status, "Choose files within the configured upload size.")
		return
	}
	files := r.MultipartForm.File["files"]
	if len(files) == 0 {
		writeError(w, http.StatusBadRequest, "Choose at least one file to convert.")
		return
	}
	if len(files) > s.cfg.maxFiles {
		writeError(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("A job can contain up to %d files.", s.cfg.maxFiles))
		return
	}
	target := normalizeFormat(r.FormValue("target"))
	if target == "" {
		writeError(w, http.StatusBadRequest, "Choose an output format.")
		return
	}
	op := r.FormValue("operation")
	if op == "convert" {
		op = ""
	}
	pageRange := r.FormValue("page_range")
	options := map[string]string{}
	for _, key := range []string{
		"quality", "dpi", "orientation", "page_size", "compress_level", "level",
		"rotation", "page_order", "order", "remove_pages", "split_mode", "mode", "split_n", "every",
		"crop_margin", "margin", "number_format", "format", "number_position", "position",
		"number_start", "font_size", "font_color", "color",
		"protect_password", "password", "unlock_password",
		"redact_terms", "terms", "signer_name", "signer", "sign_reason", "reason",
		"watermark_text", "text", "watermark_opacity", "opacity", "watermark_size",
		"watermark_rotation", "watermark_position", "watermark_color", "watermark_scale",
		"add_text_content", "add_text_x", "add_text_y", "add_text_size", "add_text_page",
		"image_x", "image_y", "image_width", "image_page", "x", "y", "width", "page",
		"shape_type", "shape", "shape_page", "shape_color", "shape_width",
		"annotation_text", "annotation_x", "annotation_y", "annotation_page",
		"highlight_term", "highlight_text", "draw_points", "points", "draw_page", "draw_color", "draw_width",
		"field_name", "field_type", "field_value", "field_options", "field_page",
		"fill_data", "data", "target_lang", "lang", "ai_prompt", "prompt",
		"workflow_steps", "steps", "audit_operation",
	} {
		if v := r.FormValue(key); v != "" {
			options[key] = v
		}
	}
	// fill_* dynamic fields for form filling
	for key, values := range r.MultipartForm.Value {
		if strings.HasPrefix(key, "fill_") && len(values) > 0 && options[key] == "" {
			options[key] = values[0]
		}
	}
	jobID, err := randomID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to start this conversion.")
		return
	}
	j := &job{ID: jobID, Status: "queued", Progress: 0, Message: "Waiting for an available worker", Target: target, CreatedAt: time.Now().UTC(), OwnerID: owner}
	cleanupOnError := true
	defer func() {
		if cleanupOnError {
			for _, f := range j.Files {
				_ = os.Remove(f.Path)
			}
		}
	}()
	for _, fh := range files {
		if fh.Size > s.cfg.maxUpload {
			writeError(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("%q exceeds the %d MB technical per-file limit.", safeDisplayName(fh.Filename), s.cfg.maxUpload>>20))
			return
		}
		f, err := fh.Open()
		if err != nil {
			writeError(w, http.StatusBadRequest, "A selected file could not be read.")
			return
		}
		id, err := randomID()
		if err != nil {
			_ = f.Close()
			writeError(w, http.StatusInternalServerError, "Unable to store the uploaded file.")
			return
		}
		dst := filepath.Join(s.cfg.storage, "uploads", id)
		out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			_ = f.Close()
			writeError(w, http.StatusInternalServerError, "Unable to store the uploaded file.")
			return
		}
		size, copyErr := io.Copy(out, io.LimitReader(f, s.cfg.maxUpload+1))
		closeErr := out.Close()
		_ = f.Close()
		if copyErr != nil || closeErr != nil || size > s.cfg.maxUpload {
			_ = os.Remove(dst)
			writeError(w, http.StatusRequestEntityTooLarge, "A selected file exceeds the configured technical size limit.")
			return
		}
		kind, detectErr := detectFormat(dst, fh.Filename)
		if detectErr != nil {
			_ = os.Remove(dst)
			writeError(w, http.StatusBadRequest, fmt.Sprintf("%q: %s", safeDisplayName(fh.Filename), detectErr.Error()))
			return
		}
		if op == "" && !s.supports(kind, target) {
			_ = os.Remove(dst)
			writeError(w, http.StatusUnprocessableEntity, fmt.Sprintf("Conversion from %s to %s is not supported by this installation.", strings.ToUpper(kind), strings.ToUpper(target)))
			return
		}
		j.Files = append(j.Files, sourceFile{Name: safeDisplayName(fh.Filename), Path: dst, Size: size, Kind: kind})
	}
	if s.cfg.clamdscan != "" {
		for _, file := range j.Files {
			ctx, cancel := context.WithTimeout(r.Context(), s.cfg.timeout)
			err := scanUploadedFile(ctx, s.cfg.clamdscan, file.Path)
			cancel()
			if err != nil {
				if errors.Is(err, errMalwareDetected) {
					log.Printf("event=malware_detected")
					writeError(w, http.StatusUnprocessableEntity, "A selected file did not pass the malware scan and was removed.")
					return
				}
				log.Printf("event=malware_scan_failed")
				writeError(w, http.StatusServiceUnavailable, "The malware scanner is unavailable. Please try again later.")
				return
			}
		}
	}
	mergeKind := ""
	if len(j.Files) > 0 && allKind(j.Files, "pdf") {
		mergeKind = "pdf"
	} else if len(j.Files) > 0 && allImages(j.Files) {
		mergeKind = "image"
	}
	if op == "merge" && (target != "pdf" || len(j.Files) < 2 || mergeKind == "") {
		writeError(w, http.StatusBadRequest, "Merge requires two or more files of the same type: PDF, or supported images.")
		return
	}
	if !isAllowedOperation(op) {
		writeError(w, http.StatusBadRequest, "The selected operation is not available.")
		return
	}
	if isPDFOnlyOperation(op) && op != "image_watermark" && op != "add_image" && (!allKind(j.Files, "pdf") || !isPDFTargetForOperation(op, target)) {
		writeError(w, http.StatusBadRequest, "This operation requires PDF input and a compatible output.")
		return
	}
	if (op == "image_watermark" || op == "add_image") && target != "pdf" {
		writeError(w, http.StatusBadRequest, "Image overlay operations produce PDF output.")
		return
	}
	if (op == "image_watermark" || op == "add_image") && (len(j.Files) < 2 || j.Files[0].Kind != "pdf" || !hasImageKind(j.Files[1:])) {
		writeError(w, http.StatusBadRequest, "Upload the PDF first and the logo image second for this operation.")
		return
	}
	if op == "split" && strings.TrimSpace(pageRange) == "" && strings.TrimSpace(options["split_mode"]) == "" {
		writeError(w, http.StatusBadRequest, "Enter the page numbers to extract, for example 1-3,5.")
		return
	}
	if op == "remove_pages" && strings.TrimSpace(pageRange) == "" && strings.TrimSpace(options["remove_pages"]) == "" {
		writeError(w, http.StatusBadRequest, "Enter the pages to remove, for example 2,5-6.")
		return
	}
	if op == "reorder" && strings.TrimSpace(options["page_order"]) == "" && strings.TrimSpace(options["order"]) == "" && strings.TrimSpace(pageRange) == "" {
		writeError(w, http.StatusBadRequest, "Enter a page order such as 3,1,2.")
		return
	}
	if op == "compare_pdf" && len(j.Files) < 2 {
		writeError(w, http.StatusBadRequest, "Compare requires two PDF files.")
		return
	}
	if (op == "image_watermark" || op == "add_image") && len(j.Files) < 2 {
		writeError(w, http.StatusBadRequest, "Attach the PDF and the image together for this operation.")
		return
	}
	if (op == "protect" || op == "password_encrypt") && len(options["protect_password"]+options["password"]) < 4 {
		writeError(w, http.StatusBadRequest, "Enter a protection password of at least 4 characters.")
		return
	}
	if op == "merge" && !s.supports(j.Files[0].Kind, "pdf") {
		writeError(w, http.StatusUnprocessableEntity, "This file type cannot be merged into PDF by the installed conversion engine.")
		return
	}
	select {
	case s.queue <- struct{}{}:
	default:
		writeError(w, http.StatusServiceUnavailable, "The conversion queue is at capacity. Please retry shortly.")
		return
	}
	if err := s.persistJobRequest(r.Context(), j); err != nil {
		<-s.queue
		writeError(w, http.StatusServiceUnavailable, "Job storage is temporarily unavailable. Your files were not queued.")
		return
	}
	s.mu.Lock()
	s.jobs[j.ID] = j
	s.reservations[owner]--
	s.reservedJobs--
	if s.reservations[owner] <= 0 {
		delete(s.reservations, owner)
	}
	reserved = false
	s.mu.Unlock()
	cleanupOnError = false
	go func() {
		defer func() { <-s.queue }()
		if op == "merge" && mergeKind == "image" {
			options["merge_images"] = "true"
		}
		s.runJob(j, op, pageRange, options)
	}()
	log.Printf("event=job_created file_count=%d", len(j.Files))
	writeJSON(w, http.StatusAccepted, snapshotJob(j, true))
}

func (s *server) persistJobRequest(ctx context.Context, j *job) error {
	if s.db == nil {
		return nil
	}
	persistCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return s.persistJob(persistCtx, j)
}

func (s *server) reserveSessionJob(owner string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	queued, active := s.reservations[owner], 0
	for _, existing := range s.jobs {
		if existing.OwnerID != owner {
			continue
		}
		existing.mu.RLock()
		status := existing.Status
		existing.mu.RUnlock()
		if status == "queued" || status == "processing" {
			queued++
		}
		if status == "processing" {
			active++
		}
	}
	if active >= s.cfg.maxActiveJobs {
		return errors.New("You already have the maximum number of conversions running.")
	}
	if queued >= s.cfg.maxQueueJobs {
		return errors.New("Your conversion queue is full. Please wait for a job to finish.")
	}
	if s.cfg.maxStoredJobs > 0 && len(s.jobs)+s.reservedJobs >= s.cfg.maxStoredJobs {
		return errors.New("The service has reached its temporary job capacity. Please try again later.")
	}
	s.reservations[owner]++
	s.reservedJobs++
	return nil
}

func (s *server) releaseSessionJob(owner string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.reservations[owner]--
	s.reservedJobs--
	if s.reservations[owner] <= 0 {
		delete(s.reservations, owner)
	}
}

func allKind(files []sourceFile, kind string) bool {
	for _, f := range files {
		if f.Kind != kind {
			return false
		}
	}
	return true
}

func allImages(files []sourceFile) bool {
	for _, f := range files {
		if f.Kind != "jpg" && f.Kind != "png" && f.Kind != "webp" && f.Kind != "gif" && f.Kind != "bmp" && f.Kind != "tiff" {
			return false
		}
	}
	return len(files) > 0
}

func hasImageKind(files []sourceFile) bool {
	for _, f := range files {
		if f.Kind == "jpg" || f.Kind == "png" || f.Kind == "webp" || f.Kind == "gif" || f.Kind == "bmp" || f.Kind == "tiff" {
			return true
		}
	}
	return false
}

func (s *server) supports(from, to string) bool {
	for _, c := range s.caps {
		if c.From == from && c.To == to {
			return true
		}
	}
	return false
}

func isAllowedOperation(op string) bool {
	if op == "" {
		return true
	}
	allowed := map[string]bool{
		"merge": true, "split": true, "smart_split": true, "organize": true,
		"reorder": true, "remove_pages": true, "rotate": true, "crop": true,
		"page_numbers": true, "compress": true, "repair": true, "pdf_to_pdfa": true,
		"validate_pdfa": true, "convert": true, "ocr_to_word": true, "ocr_to_excel": true,
		"pdf_to_excel": true, "pdf_to_md": true, "pdf_to_json": true, "pdf_to_xml": true,
		"pdf_to_pptx": true, "pdf_to_llm_md": true,
		"edit_pdf": true, "add_text": true, "add_image": true, "add_shapes": true,
		"add_annotations": true, "highlight": true, "draw": true,
		"create_form": true, "fill_form": true,
		"ocr_pdf": true, "scan_to_pdf": true,
		"protect": true, "password_encrypt": true, "unlock": true, "redact": true,
		"permanent_remove": true, "digital_sign": true, "signature_request": true,
		"verify_signatures": true, "modal_signatures": true, "audit_trail": true,
		"text_watermark": true, "image_watermark": true,
		"compare_pdf": true, "ai_summarize": true, "ai_translate": true,
		"ai_extract_data": true, "ai_smart_split": true, "workflow": true,
	}
	return allowed[op]
}

func isPDFOnlyOperation(op string) bool {
	switch op {
	case "", "merge":
		return false
	case "smart_split", "organize", "reorder", "remove_pages", "rotate", "crop",
		"page_numbers", "compress", "repair", "pdf_to_pdfa", "validate_pdfa",
		"protect", "password_encrypt", "unlock", "redact", "permanent_remove",
		"digital_sign", "signature_request", "verify_signatures", "modal_signatures",
		"audit_trail", "text_watermark", "image_watermark",
		"edit_pdf", "add_text", "add_image", "add_shapes", "add_annotations",
		"highlight", "draw", "create_form", "fill_form",
		"ocr_pdf", "compare_pdf", "ai_summarize", "ai_translate", "ai_extract_data",
		"ai_smart_split", "pdf_to_llm_md", "pdf_to_md", "pdf_to_json", "pdf_to_xml",
		"pdf_to_pptx", "pdf_to_excel", "ocr_to_word", "ocr_to_excel", "workflow",
		"split":
		return true
	default:
		return false
	}
}

func isPDFTargetForOperation(op, target string) bool {
	switch op {
	case "validate_pdfa", "audit_trail", "compare_pdf", "verify_signatures", "modal_signatures", "ai_extract_data", "pdf_to_json":
		return target == "json"
	case "ai_summarize", "pdf_to_llm_md", "pdf_to_md":
		return target == "md"
	case "pdf_to_xml":
		return target == "xml"
	case "pdf_to_pptx":
		return target == "pptx"
	case "split", "rotate", "compress", "organize", "reorder", "remove_pages", "crop",
		"page_numbers", "repair", "pdf_to_pdfa", "protect", "password_encrypt", "unlock",
		"redact", "permanent_remove", "digital_sign", "signature_request",
		"text_watermark", "image_watermark", "edit_pdf", "add_text", "add_image",
		"add_shapes", "add_annotations", "highlight", "draw", "create_form", "fill_form",
		"ocr_pdf", "ai_translate", "workflow", "merge", "smart_split", "ai_smart_split":
		return target == "pdf" || target == "zip"
	default:
		return true
	}
}

func isSingleOutputOperation(op string) bool {
	return op == "merge" || op == "compare_pdf"
}

func (s *server) runJob(j *job, operation, pageRange string, options map[string]string) {
	releaseSessionSlot := s.acquireSessionSlot(j.OwnerID)
	defer releaseSessionSlot()
	s.slots <- struct{}{}
	defer func() { <-s.slots }()
	ctx, cancelJob := context.WithCancel(context.Background())
	s.cancelMu.Lock()
	if s.cancels == nil {
		s.cancels = make(map[string]context.CancelFunc)
	}
	s.cancels[j.ID] = cancelJob
	s.cancelMu.Unlock()
	defer func() {
		cancelJob()
		s.cancelMu.Lock()
		delete(s.cancels, j.ID)
		s.cancelMu.Unlock()
	}()
	if s.jobCancelled(j) {
		for _, file := range j.Files {
			_ = os.Remove(file.Path)
		}
		_ = os.RemoveAll(filepath.Join(s.cfg.storage, "results", j.ID))
		return
	}
	if s.expired(j) {
		for _, file := range j.Files {
			_ = os.Remove(file.Path)
		}
		_ = os.RemoveAll(filepath.Join(s.cfg.storage, "results", j.ID))
		s.failJob(j, "This temporary conversion has expired.")
		return
	}
	j.mu.Lock()
	j.Status, j.Message, j.Progress = "processing", "Checking file contents", 5
	j.mu.Unlock()
	if err := s.persistJobRequest(context.Background(), j); err != nil {
		for _, file := range j.Files {
			_ = os.Remove(file.Path)
		}
		s.failJob(j, "Job storage became unavailable. Please try again.")
		return
	}
	started := time.Now()
	outputPaths := make([]string, 0, len(j.Files))
	resultsDir := filepath.Join(s.cfg.storage, "results", j.ID)
	defer func() {
		if recover() != nil {
			for _, path := range outputPaths {
				_ = os.Remove(path)
			}
			_ = os.RemoveAll(resultsDir)
			for _, file := range j.Files {
				_ = os.Remove(file.Path)
			}
			s.failJob(j, "Something went wrong while processing this file. Please try again.")
		}
	}()
	if err := os.MkdirAll(resultsDir, 0700); err != nil {
		s.failJob(j, "The output could not be stored.")
		return
	}
	fail := func(message string) {
		for _, path := range outputPaths {
			_ = os.Remove(path)
		}
		_ = os.RemoveAll(resultsDir)
		for _, file := range j.Files {
			_ = os.Remove(file.Path)
		}
		if s.jobCancelled(j) {
			return
		}
		s.failJob(j, message)
	}
	if operation == "merge" || operation == "compare_pdf" {
		outTarget := "pdf"
		outName := "merged.pdf"
		if operation == "compare_pdf" {
			outTarget = "json"
			outName = "comparison.json"
		}
		out := filepath.Join(resultsDir, outName)
		j.mu.Lock()
		if operation == "merge" {
			j.Progress, j.Message = 15, "Combining files"
		} else {
			j.Progress, j.Message = 15, "Comparing documents"
		}
		j.mu.Unlock()
		if _, err := s.invokeWorker(ctx, j.Files[0], out, outTarget, operation, pageRange, options, j); err != nil {
			fail(humanWorkerError(err))
			return
		}
		outputPaths = append(outputPaths, out)
		if _, err := s.checkOutputSize(out, 0); err != nil {
			fail(err.Error())
			return
		}
	} else if operation == "image_watermark" || operation == "add_image" {
		out := filepath.Join(resultsDir, "watermarked.pdf")
		j.mu.Lock()
		j.Progress, j.Message = 15, "Applying image overlay"
		j.mu.Unlock()
		if _, err := s.invokeWorker(ctx, j.Files[0], out, "pdf", operation, pageRange, options, j); err != nil {
			fail(humanWorkerError(err))
			return
		}
		outputPaths = append(outputPaths, out)
		if _, err := s.checkOutputSize(out, 0); err != nil {
			fail(err.Error())
			return
		}
	} else {
		totalOutput := int64(0)
		outputFormats := make([]string, 0, len(j.Files))
		for i, input := range j.Files {
			if s.jobCancelled(j) {
				fail("Cancelled by user")
				return
			}
			j.mu.Lock()
			j.Progress = 10 + i*60/len(j.Files)
			j.Message = "Converting " + input.Name
			j.mu.Unlock()
			outName := convertedName(input.Name, j.Target)
			if len(j.Files) > 1 {
				outName = fmt.Sprintf("%s-%03d.%s", strings.TrimSuffix(outName, "."+j.Target), i+1, j.Target)
			}
			out := filepath.Join(resultsDir, fmt.Sprintf("%03d-%s", i+1, outName))
			op := operation
			if op == "" {
				op = "convert"
			}
			outputFormat, err := s.invokeWorker(ctx, input, out, j.Target, op, pageRange, options, j)
			if err != nil {
				fail(fmt.Sprintf("%s: %s", input.Name, humanWorkerError(err)))
				return
			}
			outputPaths = append(outputPaths, out)
			totalOutput, err = s.checkOutputSize(out, totalOutput)
			if err != nil {
				fail(err.Error())
				return
			}
			outputFormats = append(outputFormats, outputFormat)
			j.mu.Lock()
			j.Progress = 70 + (i+1)*20/len(j.Files)
			j.Message = "Validating converted files"
			j.mu.Unlock()
		}
		j.mu.Lock()
		j.Outputs = make([]outputFile, len(outputPaths))
		for i, path := range outputPaths {
			j.Outputs[i] = outputFile{Path: path, Name: outputFormats[i]}
		}
		j.mu.Unlock()
	}
	outputs := make([]outputFile, 0, len(outputPaths))
	for i, path := range outputPaths {
		info, err := os.Stat(path)
		if err != nil || info.Size() == 0 {
			fail("The converter did not produce a valid output file.")
			return
		}
		if info.Size() > s.cfg.maxOutput {
			fail("The converted file exceeds this server's technical output-size limit.")
			return
		}
		name := filepath.Base(path)
		if operation == "merge" {
			name = "merged.pdf"
		} else if operation == "compare_pdf" {
			name = "comparison.json"
		} else if operation == "image_watermark" || operation == "add_image" {
			name = strings.TrimSuffix(filepath.Base(j.Files[0].Name), filepath.Ext(j.Files[0].Name)) + "-watermarked.pdf"
		} else {
			name = convertedName(j.Files[i].Name, j.Target)
			j.mu.RLock()
			if i < len(j.Outputs) && j.Outputs[i].Name != "" {
				name = strings.TrimSuffix(name, "."+j.Target) + "." + j.Outputs[i].Name
			}
			j.mu.RUnlock()
			if len(j.Files) > 1 {
				name = fmt.Sprintf("%s-%03d", strings.TrimSuffix(name, filepath.Ext(name)), i+1) + filepath.Ext(name)
			}
		}
		outputs = append(outputs, outputFile{Name: name, Path: path, Size: info.Size(), From: j.Files[minInt(i, len(j.Files)-1)].Name})
	}
	if s.expired(j) {
		fail("This temporary conversion has expired.")
		return
	}
	if s.jobCancelled(j) {
		fail("Cancelled by user")
		return
	}
	now := time.Now().UTC()
	for _, file := range j.Files {
		if err := os.Remove(file.Path); err != nil && !errors.Is(err, os.ErrNotExist) {
			log.Printf("event=input_cleanup_failed")
		}
	}
	j.mu.Lock()
	j.Outputs, j.Progress, j.Status, j.Message, j.FinishedAt = outputs, 100, "completed", "Your files are ready", &now
	j.mu.Unlock()
	if err := s.persistJobRequest(context.Background(), j); err != nil {
		fail("Job storage became unavailable before the result could be saved.")
		return
	}
	log.Printf("event=job_completed inputs=%d elapsed=%s", len(j.Files), time.Since(started).Round(time.Millisecond))
}

func (s *server) acquireSessionSlot(owner string) func() {
	s.sessionSlotsMu.Lock()
	if s.sessionSlots == nil {
		s.sessionSlots = make(map[string]*sessionSemaphore)
	}
	semaphore := s.sessionSlots[owner]
	if semaphore == nil {
		semaphore = &sessionSemaphore{slots: make(chan struct{}, s.cfg.maxActiveJobs)}
		s.sessionSlots[owner] = semaphore
	}
	semaphore.refs++
	s.sessionSlotsMu.Unlock()

	semaphore.slots <- struct{}{}
	return func() {
		<-semaphore.slots
		s.sessionSlotsMu.Lock()
		semaphore.refs--
		if semaphore.refs == 0 {
			delete(s.sessionSlots, owner)
		}
		s.sessionSlotsMu.Unlock()
	}
}

func (s *server) checkOutputSize(path string, currentTotal int64) (int64, error) {
	info, err := os.Stat(path)
	if err != nil || info.Size() == 0 {
		return currentTotal, errors.New("The converter did not produce a valid output file.")
	}
	if info.Size() > s.cfg.maxOutput {
		return currentTotal, errors.New("The converted file exceeds this server's technical output-size limit.")
	}
	if s.cfg.maxJobOutput > 0 && info.Size() > s.cfg.maxJobOutput-currentTotal {
		return currentTotal, errors.New("The combined outputs exceed this server's technical job-size limit.")
	}
	return currentTotal + info.Size(), nil
}

func (s *server) invokeWorker(parent context.Context, input sourceFile, output, target, operation, pageRange string, options map[string]string, j *job) (string, error) {
	ctx, cancel := context.WithTimeout(parent, s.cfg.timeout)
	defer cancel()
	req := workerRequest{Source: input.Path, Output: output, SourceName: input.Name, Target: target, Operation: operation, PageRange: pageRange, Options: options}
	if (operation == "merge" || operation == "compare_pdf" || operation == "image_watermark" || operation == "add_image") && len(j.Files) > 1 {
		start := 1
		// For per-file loop jobs the input may not be j.Files[0]; find its index.
		for idx, file := range j.Files {
			if file.Path == input.Path {
				start = idx + 1
				break
			}
		}
		if operation == "merge" || operation == "compare_pdf" {
			// merge/compare always use first file as primary with the rest as sources
			if input.Path == j.Files[0].Path {
				for _, file := range j.Files[1:] {
					req.MergeSources = append(req.MergeSources, file.Path)
				}
			}
		} else {
			for _, file := range j.Files {
				if file.Path != input.Path {
					req.MergeSources = append(req.MergeSources, file.Path)
					break
				}
			}
		}
		_ = start
	}
	encoded, err := json.Marshal(req)
	if err != nil {
		return "", err
	}
	cmd := exec.CommandContext(ctx, s.cfg.python, s.cfg.workerScript, "--request", string(encoded))
	cmd.Dir = "."
	cmd.Env = workerEnvironment()
	outputCapture := &boundedBuffer{limit: 64 << 10}
	cmd.Stdout, cmd.Stderr = outputCapture, outputCapture
	err = cmd.Run()
	if s.jobCancelled(j) {
		return "", errJobCancelled
	}
	if ctx.Err() != nil {
		return "", fmt.Errorf("conversion timed out after %s", s.cfg.timeout)
	}
	var response workerResponse
	if json.Unmarshal([]byte(outputCapture.String()), &response) != nil {
		log.Printf("event=converter_failure")
		if err != nil {
			return "", fmt.Errorf("conversion engine could not process this file")
		}
		return "", errors.New("conversion engine returned an invalid response")
	}
	if !response.OK {
		log.Printf("event=converter_rejected_input")
		switch {
		case strings.Contains(strings.ToLower(response.Message), "password"):
			return "", errors.New("password-protected")
		case strings.Contains(strings.ToLower(response.Message), "unsupported"):
			return "", errors.New("unsupported")
		case strings.Contains(strings.ToLower(response.Message), "output size"):
			return "", errors.New("output-size")
		default:
			return "", errors.New("conversion-failed")
		}
	}
	if response.Warning != "" {
		j.mu.Lock()
		j.Warnings = append(j.Warnings, response.Warning)
		j.mu.Unlock()
	}
	if response.OutputFormat == "" {
		response.OutputFormat = target
	}
	return response.OutputFormat, nil
}

func humanWorkerError(err error) string {
	message := err.Error()
	switch {
	case strings.Contains(message, "password"):
		return "This file is password-protected. Unlock it before converting."
	case strings.Contains(message, "unsupported"):
		return "This file format is not supported by the installed conversion engine."
	case strings.Contains(message, "timeout"):
		return "Conversion took too long. Try a smaller or simpler file."
	case strings.Contains(message, "output-size"):
		return "The converted file exceeds this server's technical output-size limit."
	default:
		return "The selected file could not be converted. Check that it is valid and try again."
	}
}

func (s *server) failJob(j *job, message string) {
	now := time.Now().UTC()
	j.mu.Lock()
	j.Status, j.Progress, j.Message, j.Error, j.FinishedAt = "failed", 100, "Conversion failed", message, &now
	j.mu.Unlock()
	if err := s.persistJobRequest(context.Background(), j); err != nil {
		log.Printf("event=job_status_persist_failed")
	}
	log.Printf("event=job_failed")
}

func (s *server) handleGetJob(w http.ResponseWriter, r *http.Request) {
	j, ok := s.ownedJobForRequest(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, snapshotJob(j, true))
}

func (s *server) handleHistory(w http.ResponseWriter, r *http.Request) {
	owner := sessionID(r)
	itemsByID := make(map[string]*job)
	if s.db != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		persisted, err := s.loadHistory(ctx, owner)
		cancel()
		if err != nil {
			log.Printf("event=history_load_failed")
			writeError(w, http.StatusServiceUnavailable, "History storage is temporarily unavailable.")
			return
		}
		for _, j := range persisted {
			itemsByID[j.ID] = j
		}
	}
	s.mu.RLock()
	for _, j := range s.jobs {
		if j.OwnerID == owner {
			itemsByID[j.ID] = j
		}
	}
	s.mu.RUnlock()
	items := make([]*job, 0, len(itemsByID))
	for _, j := range itemsByID {
		items = append(items, j)
	}
	sort.Slice(items, func(i, k int) bool { return items[i].CreatedAt.After(items[k].CreatedAt) })
	if len(items) > 50 {
		items = items[:50]
	}
	result := make([]jobView, 0, len(items))
	for _, j := range items {
		if s.expired(j) {
			s.expireTerminalJob(j.ID, j)
			continue
		}
		result = append(result, snapshotJob(j, true))
	}
	writeJSON(w, http.StatusOK, result)
}

func (s *server) ownedJobForRequest(w http.ResponseWriter, r *http.Request) (*job, bool) {
	id, owner := r.PathValue("id"), sessionID(r)
	j := s.getOwnedJob(id, owner)
	if j == nil && s.db != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		persisted, err := s.findOwnedJob(ctx, id, owner)
		cancel()
		if err != nil {
			log.Printf("event=job_load_failed")
			writeError(w, http.StatusServiceUnavailable, "Job storage is temporarily unavailable.")
			return nil, false
		}
		if persisted != nil {
			s.mu.Lock()
			if cached := s.jobs[id]; cached != nil && cached.OwnerID == owner {
				j = cached
			} else {
				s.jobs[id] = persisted
				j = persisted
			}
			s.mu.Unlock()
		}
	}
	if j == nil {
		writeError(w, http.StatusNotFound, "This conversion could not be found.")
		return nil, false
	}
	if s.expired(j) {
		s.expireTerminalJob(id, j)
		writeError(w, http.StatusGone, "This temporary conversion has expired.")
		return nil, false
	}
	return j, true
}

func snapshotJob(j *job, includeFiles bool) jobView {
	j.mu.RLock()
	defer j.mu.RUnlock()
	result := jobView{
		ID: j.ID, Status: j.Status, Progress: j.Progress, Message: j.Message,
		Target: j.Target, CreatedAt: j.CreatedAt, FinishedAt: j.FinishedAt,
		Outputs: append([]outputFile(nil), j.Outputs...), Error: j.Error,
		Warnings: append([]string(nil), j.Warnings...),
	}
	if includeFiles {
		result.Files = append([]sourceFile(nil), j.Files...)
	}
	return result
}

func (s *server) handleDownload(w http.ResponseWriter, r *http.Request) {
	j, ok := s.ownedJobForRequest(w, r)
	if !ok {
		return
	}
	j.mu.RLock()
	if s.expired(j) {
		j.mu.RUnlock()
		s.expireTerminalJob(r.PathValue("id"), j)
		writeError(w, http.StatusGone, "This temporary conversion has expired.")
		return
	}
	defer j.mu.RUnlock()
	if j.Status != "completed" || len(j.Outputs) == 0 {
		writeError(w, http.StatusConflict, "Your converted files are not ready yet.")
		return
	}
	if len(j.Outputs) == 1 {
		serveOutput(w, r, j.Outputs[0])
		return
	}
	files := make([]*os.File, 0, len(j.Outputs))
	for _, output := range j.Outputs {
		file, err := os.Open(output.Path)
		if err != nil {
			for _, opened := range files {
				_ = opened.Close()
			}
			writeError(w, http.StatusGone, "This output has expired and was deleted.")
			return
		}
		files = append(files, file)
	}
	defer func() {
		for _, file := range files {
			_ = file.Close()
		}
	}()
	log.Printf("event=file_downloaded file_count=%d", len(files))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", `attachment; filename="pdfforge-converted-files.zip"`)
	zw := zip.NewWriter(w)
	for i, output := range j.Outputs {
		entry, err := zw.Create(safeDisplayName(output.Name))
		if err != nil {
			log.Printf("event=zip_download_failed")
			_ = zw.Close()
			return
		}
		_, err = io.Copy(entry, files[i])
		if err != nil {
			log.Printf("event=zip_download_failed")
			_ = zw.Close()
			return
		}
	}
	if err := zw.Close(); err != nil {
		log.Printf("event=zip_download_failed")
	}
}

func (s *server) handleDownloadFile(w http.ResponseWriter, r *http.Request) {
	j, ok := s.ownedJobForRequest(w, r)
	if !ok {
		return
	}
	j.mu.RLock()
	if s.expired(j) {
		j.mu.RUnlock()
		s.expireTerminalJob(r.PathValue("id"), j)
		writeError(w, http.StatusGone, "This temporary conversion has expired.")
		return
	}
	defer j.mu.RUnlock()
	if j.Status != "completed" {
		writeError(w, http.StatusConflict, "Your converted files are not ready yet.")
		return
	}
	for _, output := range j.Outputs {
		if filepath.Base(output.Name) == r.PathValue("name") {
			serveOutput(w, r, output)
			return
		}
	}
	writeError(w, http.StatusNotFound, "This output file could not be found.")
}

func (s *server) handleDeleteJob(w http.ResponseWriter, r *http.Request) {
	id, owner := r.PathValue("id"), sessionID(r)
	s.mu.Lock()
	j := s.jobs[id]
	if j == nil || j.OwnerID != owner {
		s.mu.Unlock()
		writeError(w, http.StatusNotFound, "This conversion could not be found.")
		return
	}
	j.mu.Lock()
	if j.Status == "queued" || j.Status == "processing" {
		j.mu.Unlock()
		s.mu.Unlock()
		writeError(w, http.StatusConflict, "Wait for this conversion to finish before deleting it.")
		return
	}
	if s.db != nil {
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		_, err := s.deletePersistedJob(ctx, id, owner)
		cancel()
		if err != nil {
			j.mu.Unlock()
			s.mu.Unlock()
			log.Printf("event=job_delete_persist_failed")
			writeError(w, http.StatusServiceUnavailable, "Job storage is temporarily unavailable. Please try again.")
			return
		}
	}
	delete(s.jobs, id)
	files := append([]sourceFile(nil), j.Files...)
	j.mu.Unlock()
	s.mu.Unlock()

	failed := false
	for _, file := range files {
		if err := os.Remove(file.Path); err != nil && !errors.Is(err, os.ErrNotExist) {
			failed = true
		}
	}
	if err := os.RemoveAll(filepath.Join(s.cfg.storage, "results", id)); err != nil {
		failed = true
	}
	if failed {
		log.Printf("event=file_delete_cleanup_failed")
		writeError(w, http.StatusInternalServerError, "This conversion was removed from your workspace. Temporary files will be removed automatically.")
		return
	}
	log.Printf("event=file_deleted")
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) jobCancelled(j *job) bool {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return j.Status == "cancelled"
}

func (s *server) markJobCancelled(j *job) {
	now := time.Now().UTC()
	j.mu.Lock()
	if j.Status != "cancelled" {
		j.Status, j.Progress, j.Message, j.Error, j.FinishedAt = "cancelled", 0, "Cancelled by user", "", &now
	}
	j.mu.Unlock()
	if err := s.persistJobRequest(context.Background(), j); err != nil {
		log.Printf("event=job_status_persist_failed")
	}
	log.Printf("event=job_cancelled")
}

func (s *server) handleCancelJob(w http.ResponseWriter, r *http.Request) {
	id, owner := r.PathValue("id"), sessionID(r)
	s.mu.RLock()
	j := s.jobs[id]
	s.mu.RUnlock()
	if j == nil || j.OwnerID != owner {
		writeError(w, http.StatusNotFound, "This conversion could not be found.")
		return
	}
	j.mu.RLock()
	status := j.Status
	j.mu.RUnlock()
	switch status {
	case "completed", "failed", "cancelled":
		writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": status})
		return
	}
	s.markJobCancelled(j)
	s.cancelMu.Lock()
	if cancel := s.cancels[id]; cancel != nil {
		cancel()
	}
	s.cancelMu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": "cancelled"})
}

func (s *server) handlePreviewPages(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.maxUpload+(8<<20))
	if err := r.ParseMultipartForm(16 << 20); err != nil || r.MultipartForm == nil {
		writeError(w, http.StatusBadRequest, "The preview request could not be read.")
		return
	}
	headers := r.MultipartForm.File["file"]
	if len(headers) == 0 {
		headers = r.MultipartForm.File["files"]
	}
	if len(headers) == 0 {
		writeError(w, http.StatusBadRequest, "Attach a PDF file to preview.")
		return
	}
	header := headers[0]
	if header.Size > s.cfg.maxUpload {
		writeError(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("Files above %d MB cannot be previewed on this server.", s.cfg.maxUpload>>20))
		return
	}
	source, err := header.Open()
	if err != nil {
		writeError(w, http.StatusBadRequest, "The selected file could not be read.")
		return
	}
	id, err := randomID()
	if err != nil {
		_ = source.Close()
		writeError(w, http.StatusInternalServerError, "The preview could not be prepared.")
		return
	}
	tempPath := filepath.Join(s.cfg.storage, "uploads", "preview-"+id)
	destination, err := os.OpenFile(tempPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		_ = source.Close()
		writeError(w, http.StatusInternalServerError, "The preview could not be prepared.")
		return
	}
	_, copyErr := io.Copy(destination, io.LimitReader(source, s.cfg.maxUpload+1))
	closeErr := destination.Close()
	_ = source.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(tempPath)
		writeError(w, http.StatusInternalServerError, "The preview could not be prepared.")
		return
	}
	defer os.Remove(tempPath)

	limit, width := 40, 150
	if value := r.FormValue("pages"); value != "" {
		var n int
		if _, scanErr := fmt.Sscanf(value, "%d", &n); scanErr == nil && n > 0 && n <= 120 {
			limit = n
		}
	}
	if value := r.FormValue("width"); value != "" {
		var n int
		if _, scanErr := fmt.Sscanf(value, "%d", &n); scanErr == nil && n >= 40 && n <= 480 {
			width = n
		}
	}
	payload, err := json.Marshal(map[string]any{"source": tempPath, "pages": limit, "width": width})
	if err != nil {
		writeError(w, http.StatusInternalServerError, "The preview could not be prepared.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, s.cfg.python, "-W", "ignore", s.cfg.workerScript, "--preview", string(payload))
	command.Dir = "."
	command.Env = workerEnvironment()
	output, runErr := command.Output()
	if ctx.Err() != nil {
		writeError(w, http.StatusGatewayTimeout, "Rendering the preview took too long. Try a smaller file.")
		return
	}
	if runErr != nil && len(output) == 0 {
		log.Printf("event=preview_worker_failed err=%v", runErr)
		writeError(w, http.StatusBadGateway, "The preview engine is unavailable right now.")
		return
	}
	var preview struct {
		OK        bool   `json:"ok"`
		Message   string `json:"message"`
		PageCount int    `json:"page_count"`
		Limit     int    `json:"limit"`
		Pages     []struct {
			Page  int    `json:"page"`
			Image string `json:"image"`
		} `json:"pages"`
	}
	if json.Unmarshal(output, &preview) != nil || !preview.OK {
		log.Printf("event=preview_rejected")
		message := "This file cannot be previewed. Page previews work for text-based PDFs."
		if strings.Contains(strings.ToLower(preview.Message), "password") {
			message = "This PDF is password-protected. Unlock it first, then preview the pages."
		}
		writeError(w, http.StatusUnprocessableEntity, message)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"page_count": preview.PageCount,
		"limit":      preview.Limit,
		"pages":      preview.Pages,
	})
}

func serveOutput(w http.ResponseWriter, r *http.Request, output outputFile) {
	file, err := os.Open(output.Path)
	if err != nil {
		writeError(w, http.StatusGone, "This output has expired and was deleted.")
		return
	}
	defer file.Close()
	log.Printf("event=file_downloaded")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": output.Name}))
	w.Header().Set("Content-Length", fmt.Sprintf("%d", output.Size))
	http.ServeContent(w, r, output.Name, time.Time{}, file)
}

func (s *server) handlePreview(w http.ResponseWriter, r *http.Request) {
	j, ok := s.ownedJobForRequest(w, r)
	if !ok {
		return
	}
	j.mu.RLock()
	defer j.mu.RUnlock()
	if j.Status != "completed" || len(j.Outputs) == 0 {
		writeError(w, http.StatusConflict, "Your converted files are not ready yet.")
		return
	}
	output := j.Outputs[0]
	file, err := os.Open(output.Path)
	if err != nil {
		writeError(w, http.StatusGone, "This output has expired and was deleted.")
		return
	}
	defer file.Close()
	contentType := mime.TypeByExtension(filepath.Ext(output.Name))
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	if strings.HasSuffix(output.Name, ".pdf") || strings.HasSuffix(output.Name, ".png") ||
		strings.HasSuffix(output.Name, ".jpg") || strings.HasSuffix(output.Name, ".html") ||
		strings.HasSuffix(output.Name, ".txt") || strings.HasSuffix(output.Name, ".md") {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": output.Name}))
	} else {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": output.Name}))
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", output.Size))
	http.ServeContent(w, r, output.Name, time.Time{}, file)
}

func (s *server) handleAdminStats(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	total := len(s.jobs)
	var completed, failed, bytesProcessed int64
	var totalElapsed time.Duration
	var elapsedCount int64
	for _, j := range s.jobs {
		j.mu.RLock()
		switch j.Status {
		case "completed":
			completed++
			for _, out := range j.Outputs {
				bytesProcessed += out.Size
			}
			if j.FinishedAt != nil {
				totalElapsed += j.FinishedAt.Sub(j.CreatedAt)
				elapsedCount++
			}
		case "failed":
			failed++
		}
		j.mu.RUnlock()
	}
	s.mu.RUnlock()
	avg := 0.0
	if elapsedCount > 0 {
		avg = totalElapsed.Seconds() / float64(elapsedCount)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"total_conversions":              total,
		"completed":                      completed,
		"failed":                         failed,
		"total_bytes_processed":          bytesProcessed,
		"avg_duration_sec":               math.Round(avg*100) / 100,
		"compression_bandwidth_saved":    bytesProcessed / 4,
		"max_upload_bytes":               s.cfg.maxUpload,
		"max_files_per_job":              s.cfg.maxFiles,
		"malware_scan_enabled":           s.cfg.clamdscan != "",
		"engine":                         "pymupdf",
	})
}

func (s *server) handleOpenAPI(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"openapi": "3.0.0",
		"info":    map[string]any{"title": "PDFForge API", "version": "2.0.0", "description": "Free document processing API. All endpoints use the private session cookie."},
		"paths": map[string]any{
			"/api/health":            map[string]any{"get": map[string]any{"summary": "Engine health"}},
			"/api/capabilities":      map[string]any{"get": map[string]any{"summary": "Supported format pairs"}},
			"/api/jobs":              map[string]any{"post": map[string]any{"summary": "Create a conversion job (multipart: files, target, operation)"}},
			"/api/jobs/{id}":         map[string]any{"get": map[string]any{"summary": "Job status"}, "delete": map[string]any{"summary": "Delete job"}},
			"/api/jobs/{id}/cancel":  map[string]any{"post": map[string]any{"summary": "Cancel a queued or running job (session owner only)"}},
			"/api/jobs/{id}/download": map[string]any{"get": map[string]any{"summary": "Download result (ZIP for multi-file)"}},
			"/api/jobs/{id}/preview":  map[string]any{"get": map[string]any{"summary": "Inline preview"}},
			"/api/preview":           map[string]any{"post": map[string]any{"summary": "Render page thumbnails (multipart: file, optional pages<=120, width 40-480)"}},
			"/api/history":           map[string]any{"get": map[string]any{"summary": "Session history"}},
			"/api/cloud/import":      map[string]any{"post": map[string]any{"summary": "Import from public HTTPS URL with SSRF protection"}},
			"/api/admin/stats":       map[string]any{"get": map[string]any{"summary": "Usage statistics"}},
			"/api/signatures/verify": map[string]any{"post": map[string]any{"summary": "Verify PDF signatures"}},
		},
	})
}

func (s *server) handleAPIDocs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write([]byte(`<!doctype html><meta charset="utf-8"><title>PDFForge API Docs</title><style>body{font-family:system-ui;max-width:760px;margin:40px auto;padding:0 20px;line-height:1.6}code{background:#f2f4f0;padding:2px 6px;border-radius:4px}pre{background:#f6f7f4;padding:16px;border-radius:8px;overflow:auto}</style><h1>PDFForge API v2</h1><p>All features are free. Auth uses the <code>pdfforge_session</code> HttpOnly cookie issued automatically.</p><pre>POST /api/jobs (multipart)
  files: binary[]  target: pdf|docx|xlsx|png|...  operation: merge|split|compress|protect|text_watermark|...
GET /api/jobs/{id}
POST /api/jobs/{id}/cancel
GET /api/jobs/{id}/download
GET /api/jobs/{id}/preview
POST /api/preview (multipart file: pages, width)
GET /api/history
POST /api/cloud/import {"url","target","operation"}
POST /api/signatures/verify (multipart file)
GET /api/admin/stats
GET /api/openapi.json</pre><p>Full machine-readable spec: <a href="/api/openapi.json">/api/openapi.json</a></p>`))
}

func (s *server) handleVerifySignature(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, s.cfg.maxUpload+1<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "Upload a PDF file to verify.")
		return
	}
	files := r.MultipartForm.File["file"]
	if len(files) == 0 {
		files = r.MultipartForm.File["files"]
	}
	if len(files) == 0 {
		writeError(w, http.StatusBadRequest, "Upload a PDF file to verify.")
		return
	}
	fh := files[0]
	f, err := fh.Open()
	if err != nil {
		writeError(w, http.StatusBadRequest, "The file could not be read.")
		return
	}
	defer f.Close()
	tmp, err := os.CreateTemp("", "verify-*.pdf")
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Verification is unavailable.")
		return
	}
	tmpPath := tmp.Name()
	_, copyErr := io.Copy(tmp, io.LimitReader(f, s.cfg.maxUpload+1))
	closeErr := tmp.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(tmpPath)
		writeError(w, http.StatusBadRequest, "The file could not be read.")
		return
	}
	defer os.Remove(tmpPath)
	kind, detectErr := detectFormat(tmpPath, fh.Filename)
	if detectErr != nil || kind != "pdf" {
		writeError(w, http.StatusBadRequest, "Only PDF files can be signature-verified.")
		return
	}
	out := tmpPath + ".json"
	req := workerRequest{Source: tmpPath, Output: out, SourceName: safeDisplayName(fh.Filename), Target: "json", Operation: "verify_signatures", Options: map[string]string{}}
	encoded, _ := json.Marshal(req)
	ctx, cancel := context.WithTimeout(r.Context(), 60*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, s.cfg.python, s.cfg.workerScript, "--request", string(encoded))
	cmd.Dir = "."
	cmd.Env = workerEnvironment()
	captured := &boundedBuffer{limit: 64 << 10}
	cmd.Stdout, cmd.Stderr = captured, captured
	if err := cmd.Run(); err != nil {
		var resp workerResponse
		if json.Unmarshal([]byte(captured.String()), &resp) == nil && resp.Message != "" {
			writeError(w, http.StatusUnprocessableEntity, humanWorkerError(errors.New(resp.Message)))
			return
		}
		writeError(w, http.StatusUnprocessableEntity, "This document could not be verified.")
		return
	}
	data, err := os.ReadFile(out)
	_ = os.Remove(out)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Verification is unavailable.")
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

func isPublicImportURL(raw string) bool {
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") {
		return false
	}
	host := parsed.Hostname()
	if host == "" || strings.Contains(raw, "@") {
		return false
	}
	if ip := net.ParseIP(host); ip != nil {
		return false
	}
	lowered := strings.ToLower(host)
	blocked := []string{"localhost", "metadata.google", "metadata.google.internal", "169.254.169.254"}
	for _, b := range blocked {
		if lowered == b || strings.HasSuffix(lowered, "."+b) {
			return false
		}
	}
	return true
}

func (s *server) handleCloudImport(w http.ResponseWriter, r *http.Request) {
	owner := sessionID(r)
	var payload struct {
		URL       string            `json:"url"`
		Target    string            `json:"target"`
		Operation string            `json:"operation"`
		Options   map[string]string `json:"options"`
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 1<<20))
	if err != nil {
		writeError(w, http.StatusBadRequest, "Invalid import request.")
		return
	}
	if err := json.Unmarshal(body, &payload); err != nil || strings.TrimSpace(payload.URL) == "" {
		writeError(w, http.StatusBadRequest, "Provide a public file URL.")
		return
	}
	if !isPublicImportURL(payload.URL) {
		writeError(w, http.StatusBadRequest, "Only public http(s) URLs with resolvable hostnames can be imported. Private IPs and metadata endpoints are blocked.")
		return
	}
	if err := s.reserveSessionJob(owner); err != nil {
		writeError(w, http.StatusTooManyRequests, err.Error())
		return
	}
	reserved := true
	defer func() {
		if reserved {
			s.releaseSessionJob(owner)
		}
	}()
	target := normalizeFormat(payload.Target)
	if target == "" {
		target = "pdf"
	}
	op := payload.Operation
	if op == "convert" {
		op = ""
	}
	if !isAllowedOperation(op) {
		writeError(w, http.StatusBadRequest, "The selected operation is not available.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 45*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, payload.URL, nil)
	if err != nil {
		writeError(w, http.StatusBadRequest, "This URL could not be fetched.")
		return
	}
	req.Header.Set("User-Agent", "PDFForge/2.0")
	client := &http.Client{Timeout: 40 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return errors.New("too many redirects")
		}
		if !isPublicImportURL(req.URL.String()) {
			return errors.New("redirect to private address blocked")
		}
		return nil
	}}
	resp, err := client.Do(req)
	if err != nil {
		writeError(w, http.StatusBadRequest, "This URL could not be fetched safely.")
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		writeError(w, http.StatusBadRequest, "The remote server did not return the file.")
		return
	}
	id, err := randomID()
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to store the imported file.")
		return
	}
	dst := filepath.Join(s.cfg.storage, "uploads", id)
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Unable to store the imported file.")
		return
	}
	size, copyErr := io.Copy(out, io.LimitReader(resp.Body, s.cfg.maxUpload+1))
	closeErr := out.Close()
	if copyErr != nil || closeErr != nil || size == 0 || size > s.cfg.maxUpload {
		_ = os.Remove(dst)
		writeError(w, http.StatusRequestEntityTooLarge, "The remote file exceeds the configured size limit.")
		return
	}
	parsedURL, _ := url.Parse(payload.URL)
	guessedName := safeDisplayName(filepath.Base(parsedURL.Path))
	if guessedName == "" || guessedName == "." || filepath.Ext(guessedName) == "" {
		guessedName = "imported-document.pdf"
	}
	kind, detectErr := detectFormat(dst, guessedName)
	if detectErr != nil {
		// try content-type hint
		ct := resp.Header.Get("Content-Type")
		if strings.Contains(ct, "pdf") {
			kind, detectErr = detectFormat(dst, "imported.pdf")
			guessedName = "imported.pdf"
		}
		if detectErr != nil {
			_ = os.Remove(dst)
			writeError(w, http.StatusBadRequest, "The remote file type is not supported.")
			return
		}
	}
	jobID, err := randomID()
	if err != nil {
		_ = os.Remove(dst)
		writeError(w, http.StatusInternalServerError, "Unable to start this conversion.")
		return
	}
	j := &job{ID: jobID, Status: "queued", Progress: 0, Message: "Waiting for an available worker", Target: target, CreatedAt: time.Now().UTC(), OwnerID: owner,
		Files: []sourceFile{{Name: guessedName, Path: dst, Size: size, Kind: kind}}}
	if op == "" && !s.supports(kind, target) {
		_ = os.Remove(dst)
		writeError(w, http.StatusUnprocessableEntity, "Conversion from this file to the target is not supported.")
		return
	}
	if isPDFOnlyOperation(op) && kind != "pdf" {
		_ = os.Remove(dst)
		writeError(w, http.StatusBadRequest, "This operation requires a PDF file.")
		return
	}
	pageRange := ""
	if payload.Options != nil {
		pageRange = payload.Options["page_range"]
	}
	options := payload.Options
	if options == nil {
		options = map[string]string{}
	}
	select {
	case s.queue <- struct{}{}:
	default:
		_ = os.Remove(dst)
		writeError(w, http.StatusServiceUnavailable, "The conversion queue is at capacity.")
		return
	}
	if err := s.persistJobRequest(r.Context(), j); err != nil {
		<-s.queue
		_ = os.Remove(dst)
		writeError(w, http.StatusServiceUnavailable, "Job storage is unavailable.")
		return
	}
	s.mu.Lock()
	s.jobs[j.ID] = j
	s.reservations[owner]--
	s.reservedJobs--
	if s.reservations[owner] <= 0 {
		delete(s.reservations, owner)
	}
	reserved = false
	s.mu.Unlock()
	go func() {
		defer func() { <-s.queue }()
		s.runJob(j, op, pageRange, options)
	}()
	writeJSON(w, http.StatusAccepted, snapshotJob(j, true))
}

func (s *server) getOwnedJob(id, owner string) *job {
	s.mu.RLock()
	j := s.jobs[id]
	allowed := j != nil && j.OwnerID == owner
	s.mu.RUnlock()
	if !allowed {
		log.Printf("event=access_denied")
		return nil
	}
	if s.expired(j) {
		s.expireTerminalJob(id, j)
		log.Printf("event=access_denied")
		return nil
	}
	return j
}

func (s *server) expired(j *job) bool {
	return s.cfg.retention > 0 && time.Now().After(j.CreatedAt.Add(s.cfg.retention))
}

func (s *server) expireTerminalJob(id string, j *job) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.jobs[id] != j {
		return
	}
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.Status == "queued" || j.Status == "processing" {
		return
	}
	if s.db != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, err := s.db.ExecContext(ctx, s.q(`DELETE FROM pdfforge_jobs WHERE id = $1`), id)
		cancel()
		if err != nil {
			log.Printf("event=expired_job_persist_delete_failed error=%v", err)
		}
	}
	delete(s.jobs, id)
	for _, file := range j.Files {
		if err := os.Remove(file.Path); err != nil && !errors.Is(err, os.ErrNotExist) {
			log.Printf("event=expired_file_cleanup_failed")
		}
	}
	if err := os.RemoveAll(filepath.Join(s.cfg.storage, "results", id)); err != nil {
		log.Printf("event=expired_file_cleanup_failed")
	}
}

func (s *server) cleanupLoop() {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		cutoff := time.Now().Add(-s.cfg.retention)
		s.mu.Lock()
		for id, j := range s.jobs {
			j.mu.Lock()
			if j.CreatedAt.Before(cutoff) {
				if j.Status == "queued" || j.Status == "processing" {
					j.mu.Unlock()
					continue
				}
				for _, f := range j.Files {
					_ = os.Remove(f.Path)
				}
				_ = os.RemoveAll(filepath.Join(s.cfg.storage, "results", id))
				if j.Status == "queued" || j.Status == "processing" {
					j.Status, j.Error, j.Message = "expired", "This temporary job has expired.", "Temporary files were deleted"
				}
				delete(s.jobs, id)
			}
			j.mu.Unlock()
		}
		s.mu.Unlock()
		s.sessionMu.Lock()
		now := time.Now()
		for id, expires := range s.sessions {
			if expires.Before(now) {
				delete(s.sessions, id)
			}
		}
		s.sessionMu.Unlock()
		if s.db != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			_, jobErr := s.db.ExecContext(ctx, s.q(`DELETE FROM pdfforge_jobs WHERE expires_at <= $1`), time.Now())
			_, sessionErr := s.db.ExecContext(ctx, s.q(`DELETE FROM pdfforge_sessions WHERE expires_at <= $1`), time.Now())
			cancel()
			if jobErr != nil || sessionErr != nil {
				log.Printf("event=database_expiry_cleanup_failed jobs_error=%v sessions_error=%v", jobErr, sessionErr)
			}
		}
		s.removeExpiredDiskFiles()
	}
}

func (s *server) removeExpiredDiskFiles() {
	cutoff := time.Now().Add(-s.cfg.retention)
	for _, folder := range []string{filepath.Join(s.cfg.storage, "uploads"), filepath.Join(s.cfg.storage, "results")} {
		entries, err := os.ReadDir(folder)
		if err != nil {
			continue
		}
		for _, entry := range entries {
			path := filepath.Join(folder, entry.Name())
			info, err := entry.Info()
			if err == nil && info.ModTime().Before(cutoff) {
				if err := os.RemoveAll(path); err != nil {
					log.Printf("event=expired_file_cleanup_failed")
				}
			}
		}
	}
}

func detectFormat(path, filename string) (string, error) {
	ext := normalizeFormat(filepath.Ext(filename))
	if ext == "" {
		return "", errors.New("the file type could not be determined")
	}
	f, err := os.Open(path)
	if err != nil {
		return "", errors.New("the uploaded file could not be read")
	}
	defer f.Close()
	head := make([]byte, 4096)
	n, _ := f.Read(head)
	data := head[:n]
	actual := ""
	switch {
	case strings.Contains(string(data[:minInt(len(data), 1024)]), "%PDF-"):
		actual = "pdf"
	case len(data) >= 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n":
		actual = "png"
	case len(data) >= 3 && string(data[:3]) == "\xff\xd8\xff":
		actual = "jpg"
	case len(data) >= 6 && (string(data[:6]) == "GIF87a" || string(data[:6]) == "GIF89a"):
		actual = "gif"
	case len(data) >= 2 && string(data[:2]) == "BM":
		actual = "bmp"
	case len(data) >= 4 && string(data[:4]) == "II*\x00" || len(data) >= 4 && string(data[:4]) == "MM\x00*":
		actual = "tiff"
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		actual = "webp"
	case len(data) >= 4 && string(data[:2]) == "PK":
		actual, err = detectZipFormat(path, ext)
	case looksLikeText(data):
		actual = ext
	default:
		return "", errors.New("the file content does not match a supported format")
	}
	if err != nil {
		return "", err
	}
	if canonicalFormat(actual) != canonicalFormat(ext) {
		return "", fmt.Errorf("the file extension does not match its actual %s format", strings.ToUpper(actual))
	}
	if actual == "rtf" && !strings.HasPrefix(strings.TrimSpace(strings.TrimPrefix(string(data), "\xef\xbb\xbf")), `{\rtf`) {
		return "", errors.New("the file does not contain a valid RTF document")
	}
	if actual == "html" && !looksLikeHTML(data) {
		return "", errors.New("the file does not contain an HTML document")
	}
	return canonicalFormat(actual), nil
}

func looksLikeHTML(data []byte) bool {
	content := strings.ToLower(string(data))
	for i := 0; i+1 < len(content); i++ {
		if content[i] == '<' && (content[i+1] == '!' || content[i+1] == '/' ||
			content[i+1] >= 'a' && content[i+1] <= 'z') {
			return true
		}
	}
	return false
}

func detectZipFormat(path, ext string) (string, error) {
	r, err := zip.OpenReader(path)
	if err != nil {
		return "", errors.New("this archive is not a valid supported document")
	}
	defer r.Close()
	names := make(map[string]bool)
	for _, f := range r.File {
		names[f.Name] = true
	}
	switch {
	case names["word/document.xml"]:
		return "docx", nil
	case names["xl/workbook.xml"]:
		return "xlsx", nil
	case names["ppt/presentation.xml"]:
		return "pptx", nil
	case names["content.xml"] && ext == "odt":
		return "odt", nil
	case names["content.xml"] && ext == "odp":
		return "odp", nil
	case names["mimetype"] && ext == "epub":
		return "epub", nil
	default:
		return "zip", nil
	}
}

func looksLikeText(data []byte) bool {
	if len(data) == 0 {
		return false
	}
	for _, r := range string(data) {
		if r == 0 || (unicode.IsControl(r) && r != '\n' && r != '\r' && r != '\t' && r != '\f') {
			return false
		}
	}
	return true
}

func normalizeFormat(value string) string {
	value = strings.TrimPrefix(strings.ToLower(strings.TrimSpace(value)), ".")
	switch value {
	case "jpeg":
		return "jpg"
	case "htm":
		return "html"
	case "markdown":
		return "md"
	}
	return value
}

func canonicalFormat(value string) string { return normalizeFormat(value) }

func convertedName(name, target string) string {
	base := strings.TrimSuffix(filepath.Base(name), filepath.Ext(name))
	if base == "" || base == "." {
		base = "document"
	}
	return base + "-converted." + target
}

func safeDisplayName(name string) string {
	name = filepath.Base(strings.ReplaceAll(name, `\`, `/`))
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if name == "" || name == "." {
		return "document"
	}
	if len(name) > 180 {
		ext := filepath.Ext(name)
		if len(ext) >= 180 {
			ext = ""
		}
		stem := strings.TrimSuffix(name, ext)
		runes := []rune(stem)
		for len(stem)+len(ext) > 180 && len(runes) > 1 {
			runes = runes[:len(runes)-1]
			stem = string(runes)
		}
		name = stem + ext
	}
	return name
}

func randomID() (string, error) {
	var id [16]byte
	if _, err := rand.Read(id[:]); err != nil {
		return "", err
	}
	return hex.EncodeToString(id[:]), nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
