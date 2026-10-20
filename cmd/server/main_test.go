package main

import (
	"archive/zip"
	"bytes"
	"context"
	"crypto/tls"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/go-sql-driver/mysql"
)

func TestDetectFormatRejectsMisleadingExtension(t *testing.T) {
	path := filepath.Join(t.TempDir(), "invoice.pdf")
	var content bytes.Buffer
	archive := zip.NewWriter(&content)
	entry, err := archive.Create("document.xml")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = entry.Write([]byte("not a pdf")); err != nil {
		t.Fatal(err)
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, content.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := detectFormat(path, "invoice.pdf"); err == nil || !strings.Contains(err.Error(), "extension does not match") {
		t.Fatalf("expected an extension mismatch error, got %v", err)
	}
}

func TestDetectFormatRecognizesPDFSignature(t *testing.T) {
	path := filepath.Join(t.TempDir(), "file")
	if err := os.WriteFile(path, []byte("%PDF-1.7\n"), 0600); err != nil {
		t.Fatal(err)
	}
	got, err := detectFormat(path, "report.pdf")
	if err != nil {
		t.Fatal(err)
	}
	if got != "pdf" {
		t.Fatalf("detected %q, want pdf", got)
	}
}

func TestDetectFormatRecognizesPNGSignature(t *testing.T) {
	path := filepath.Join(t.TempDir(), "photo.png")
	if err := os.WriteFile(path, []byte("\x89PNG\r\n\x1a\n"), 0600); err != nil {
		t.Fatal(err)
	}
	got, err := detectFormat(path, "photo.png")
	if err != nil {
		t.Fatal(err)
	}
	if got != "png" {
		t.Fatalf("detected %q, want png", got)
	}
}

func TestSafeDisplayNameRemovesPathAndControlCharacters(t *testing.T) {
	got := safeDisplayName(`..\..\private\report` + "\x00" + ".pdf")
	if got != "report.pdf" {
		t.Fatalf("safeDisplayName() = %q", got)
	}
}

func TestSessionOwnerIDStoresOnlyStableHash(t *testing.T) {
	first := sessionOwnerID("browser-token")
	if first == "browser-token" || first != sessionOwnerID("browser-token") {
		t.Fatalf("session owner ID is not a stable one-way hash: %q", first)
	}
	if first == sessionOwnerID("different-token") {
		t.Fatal("different browser sessions share the same owner ID")
	}
}

func TestDatabaseURLFromEnvironmentEscapesCredentials(t *testing.T) {
	for key, value := range map[string]string{
		"DATABASE_URL": "", "DB_HOST": "localhost", "DB_PORT": "5432",
		"DB_NAME": "pdfforge", "DB_USER": "pdf user", "DB_PASSWORD": "p@ss:/word",
		"DB_SSLMODE": "disable",
	} {
		t.Setenv(key, value)
	}
	raw, err := databaseURLFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		t.Fatal(err)
	}
	password, ok := parsed.User.Password()
	if !ok || parsed.User.Username() != "pdf user" || password != "p@ss:/word" {
		t.Fatalf("database credentials were not preserved safely: %q", raw)
	}
	if parsed.Host != "localhost:5432" || parsed.Path != "/pdfforge" || parsed.Query().Get("sslmode") != "disable" {
		t.Fatalf("unexpected PostgreSQL URL: %q", raw)
	}
}

func TestDatabaseStoragePathsCannotEscapePrivateDirectories(t *testing.T) {
	root := t.TempDir()
	s := &server{cfg: config{storage: root}}
	j := &job{
		ID:    "0123456789abcdef0123456789abcdef",
		Files: []sourceFile{{Path: filepath.Join(root, "uploads", "..", "secret.pdf")}},
	}
	if err := s.validateStoredJobPaths(j); err == nil {
		t.Fatal("path traversal in persisted upload metadata was accepted")
	}
	j.Files = []sourceFile{{Path: filepath.Join(root, "uploads", "safe.bin")}}
	j.Outputs = []outputFile{{Path: filepath.Join(root, "results", "another-job", "result.pdf")}}
	if err := s.validateStoredJobPaths(j); err == nil {
		t.Fatal("output path outside its job result directory was accepted")
	}
}

func TestFormatAliasesAreCanonicalized(t *testing.T) {
	for input, want := range map[string]string{
		".JPEG": "jpg", ".htm": "html", ".Markdown": "md",
	} {
		if got := normalizeFormat(input); got != want {
			t.Errorf("normalizeFormat(%q) = %q, want %q", input, got, want)
		}
	}
}

func TestDetectFormatRejectsTextDisguisedAsHTML(t *testing.T) {
	path := filepath.Join(t.TempDir(), "page.html")
	if err := os.WriteFile(path, []byte("just plain text"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := detectFormat(path, "page.html"); err == nil || !strings.Contains(err.Error(), "HTML") {
		t.Fatalf("expected invalid HTML to be rejected, got %v", err)
	}
}

func TestJobsArePrivateToTheirOwningSession(t *testing.T) {
	now := time.Now().Add(time.Hour)
	s := &server{
		jobs: map[string]*job{
			"private-job": {ID: "private-job", OwnerID: sessionOwnerID("session-a"), CreatedAt: time.Now()},
		},
		cfg:         config{retention: 24 * time.Hour},
		sessions:    map[string]time.Time{"session-a": now, "session-b": now},
		rateEntries: map[string]rateEntry{},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/jobs/{id}", func(w http.ResponseWriter, r *http.Request) {
		j := s.getOwnedJob(r.PathValue("id"), sessionID(r))
		if j == nil {
			writeError(w, http.StatusNotFound, "This conversion could not be found.")
			return
		}
		writeJSON(w, http.StatusOK, snapshotJob(j, true))
	})
	handler := s.rateLimit(s.session(mux))

	for _, test := range []struct {
		name       string
		cookie     string
		wantStatus int
	}{
		{name: "owner can read job", cookie: "session-a", wantStatus: http.StatusOK},
		{name: "other session cannot read job", cookie: "session-b", wantStatus: http.StatusNotFound},
		{name: "job ID without owner cookie cannot read job", wantStatus: http.StatusNotFound},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/api/jobs/private-job", nil)
			if test.cookie != "" {
				req.AddCookie(&http.Cookie{Name: "pdfforge_session", Value: test.cookie})
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, req)
			if response.Code != test.wantStatus {
				t.Fatalf("status=%d want=%d body=%q", response.Code, test.wantStatus, response.Body.String())
			}
		})
	}
}

func TestPerSessionQueueAndConcurrencyLimits(t *testing.T) {
	running := &job{OwnerID: "owner", Status: "processing"}
	s := &server{
		cfg: config{maxActiveJobs: 1, maxQueueJobs: 2},
		jobs: map[string]*job{
			"running": running,
		},
		reservations: make(map[string]int),
	}
	if err := s.reserveSessionJob("owner"); err == nil || !strings.Contains(err.Error(), "maximum") {
		t.Fatalf("expected active job limit, got %v", err)
	}
	running.Status = "completed"
	s.jobs["queued"] = &job{OwnerID: "owner", Status: "queued"}
	s.reservations["owner"] = 1
	if err := s.reserveSessionJob("owner"); err == nil || !strings.Contains(err.Error(), "queue is full") {
		t.Fatalf("expected per-session queue limit, got %v", err)
	}
	s.cfg.maxStoredJobs = 1
	s.jobs["other-session-job"] = &job{OwnerID: "another-owner", Status: "completed"}
	s.jobs["queued"] = &job{OwnerID: "owner", Status: "completed"}
	s.reservations["owner"] = 0
	if err := s.reserveSessionJob("new-owner"); err == nil || !strings.Contains(err.Error(), "service") {
		t.Fatalf("expected global stored job limit, got %v", err)
	}
}

func TestSessionWorkerSemaphoreEnforcesConcurrency(t *testing.T) {
	s := &server{cfg: config{maxActiveJobs: 1}}
	releaseFirst := s.acquireSessionSlot("owner")
	secondAcquired := make(chan func(), 1)
	go func() {
		secondAcquired <- s.acquireSessionSlot("owner")
	}()
	select {
	case releaseSecond := <-secondAcquired:
		releaseSecond()
		releaseFirst()
		t.Fatal("two jobs for one session ran concurrently")
	case <-time.After(20 * time.Millisecond):
	}
	releaseFirst()
	select {
	case releaseSecond := <-secondAcquired:
		releaseSecond()
	case <-time.After(time.Second):
		t.Fatal("queued job did not acquire the released session slot")
	}
}

func TestSessionCookieIsHttpOnlyAndSameSiteStrict(t *testing.T) {
	s := &server{sessions: make(map[string]time.Time)}
	handler := s.session(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "http://localhost/", nil))
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || !cookies[0].HttpOnly || cookies[0].SameSite != http.SameSiteStrictMode {
		t.Fatalf("session cookie has unsafe settings: %#v", cookies)
	}
	if cookies[0].Secure {
		t.Fatal("localhost HTTP development cookie should not require HTTPS")
	}
}

func TestWorkerEnvironmentOmitsUnrelatedSecrets(t *testing.T) {
	t.Setenv("DATABASE_URL", "should-not-be-forwarded")
	t.Setenv("AWS_SECRET_ACCESS_KEY", "should-not-be-forwarded")
	t.Setenv("MAX_OUTPUT_SIZE_MB", "300")
	env := strings.Join(workerEnvironment(), "\n")
	if strings.Contains(env, "should-not-be-forwarded") {
		t.Fatal("worker environment inherited unrelated secret variables")
	}
	if !strings.Contains(env, "MAX_OUTPUT_SIZE_MB=300") {
		t.Fatal("worker environment omitted the configured output safety limit")
	}
}

func TestBoundedBufferCapsCapturedWorkerOutput(t *testing.T) {
	buffer := &boundedBuffer{limit: 4}
	if written, err := buffer.Write([]byte("excessive")); err != nil || written != len("excessive") {
		t.Fatalf("write=(%d, %v), want full input length and no error", written, err)
	}
	if got := buffer.String(); got != "exce" {
		t.Fatalf("captured output = %q, want first four bytes", got)
	}
}

func TestCrossOriginMutationIsRejected(t *testing.T) {
	s := &server{sessions: make(map[string]time.Time)}
	handler := s.session(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodPost, "http://localhost/api/jobs", nil)
	req.Header.Set("Origin", "https://attacker.example")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusForbidden {
		t.Fatalf("cross-origin mutation returned %d, want 403", response.Code)
	}
}

func TestTrustedProxyOriginAndSecureCookie(t *testing.T) {
	s := &server{cfg: config{trustProxy: true}, sessions: make(map[string]time.Time)}
	handler := s.session(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	req := httptest.NewRequest(http.MethodPost, "http://files.example.com/api/jobs", nil)
	req.Header.Set("Origin", "https://files.example.com")
	req.Header.Set("X-Forwarded-Proto", "https")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusNoContent {
		t.Fatalf("trusted TLS proxy request returned %d", response.Code)
	}
	if cookies := response.Result().Cookies(); len(cookies) != 1 || !cookies[0].Secure {
		t.Fatalf("trusted HTTPS proxy did not set a Secure session cookie: %#v", cookies)
	}
}

func TestRateLimitUsesProxyClientAddressOnlyWhenTrusted(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "192.0.2.1:1234"
	req.Header.Set("X-Real-IP", "198.51.100.8")
	if got := clientIP(req, false); got != "192.0.2.1" {
		t.Fatalf("untrusted proxy address = %q", got)
	}
	if got := clientIP(req, true); got != "198.51.100.8" {
		t.Fatalf("trusted proxy address = %q", got)
	}
	req.Header.Set("X-Real-IP", "not-an-ip")
	if got := clientIP(req, true); got != "192.0.2.1" {
		t.Fatalf("invalid trusted proxy address = %q", got)
	}
}

func TestRateLimitRejectsExcessiveJobUploads(t *testing.T) {
	s := &server{rateEntries: make(map[string]rateEntry)}
	handler := s.rateLimit(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	for i := 0; i < 10; i++ {
		req := httptest.NewRequest(http.MethodPost, "http://localhost/api/jobs", nil)
		req.RemoteAddr = "192.0.2.10:1234"
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, req)
		if response.Code != http.StatusNoContent {
			t.Fatalf("upload %d unexpectedly rate limited: %d", i+1, response.Code)
		}
	}
	req := httptest.NewRequest(http.MethodPost, "http://localhost/api/jobs", nil)
	req.RemoteAddr = "192.0.2.10:1234"
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, req)
	if response.Code != http.StatusTooManyRequests || response.Header().Get("Retry-After") == "" {
		t.Fatalf("excess upload status=%d retry-after=%q", response.Code, response.Header().Get("Retry-After"))
	}
}

func TestPanicRecoveryReturnsGenericError(t *testing.T) {
	handler := (&server{}).recovery(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		panic("do not expose internal panic details")
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("panic status=%d", response.Code)
	}
	if strings.Contains(response.Body.String(), "internal panic") {
		t.Fatalf("panic detail leaked to response: %s", response.Body.String())
	}
}

func TestPublicWebDirectoryCannotBeUsedAsPrivateStorage(t *testing.T) {
	webRoot, err := filepath.Abs("web")
	if err != nil {
		t.Fatal(err)
	}
	publicStorage := filepath.Join(webRoot, "uploads-test")
	if err := os.MkdirAll(publicStorage, 0700); err != nil {
		t.Fatal(err)
	}
	defer os.Remove(publicStorage)
	if err := validatePrivateStorage(publicStorage); err == nil {
		t.Fatal("public web directory was accepted as private storage")
	}
	if err := validatePrivateStorage(t.TempDir()); err != nil {
		t.Fatalf("private directory outside web root rejected: %v", err)
	}
}

func TestExpiredJobCannotBeReadAndItsFilesAreDeleted(t *testing.T) {
	root := t.TempDir()
	resultDir := filepath.Join(root, "results", "expired-job")
	if err := os.MkdirAll(resultDir, 0700); err != nil {
		t.Fatal(err)
	}
	output := filepath.Join(resultDir, "result.pdf")
	if err := os.WriteFile(output, []byte("private"), 0600); err != nil {
		t.Fatal(err)
	}
	j := &job{
		ID: "expired-job", OwnerID: "owner", Status: "completed",
		CreatedAt: time.Now().Add(-2 * time.Hour),
		Outputs:   []outputFile{{Path: output}},
	}
	s := &server{
		cfg:  config{storage: root, retention: time.Hour},
		jobs: map[string]*job{"expired-job": j},
	}
	if got := s.getOwnedJob("expired-job", "owner"); got != nil {
		t.Fatal("expired job was accessible")
	}
	if _, err := os.Stat(output); !os.IsNotExist(err) {
		t.Fatalf("expired output still exists: %v", err)
	}
	if _, exists := s.jobs["expired-job"]; exists {
		t.Fatal("expired job remained in history")
	}
}

func TestDeleteJobRemovesFilesAndHistory(t *testing.T) {
	root := t.TempDir()
	uploads := filepath.Join(root, "uploads")
	results := filepath.Join(root, "results", "job-to-delete")
	if err := os.MkdirAll(uploads, 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(results, 0700); err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(uploads, "source")
	output := filepath.Join(results, "result.pdf")
	for _, path := range []string{source, output} {
		if err := os.WriteFile(path, []byte("private"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	s := &server{
		cfg: config{storage: root},
		jobs: map[string]*job{
			"job-to-delete": {
				ID: "job-to-delete", OwnerID: sessionOwnerID("owner"), Status: "completed",
				Files: []sourceFile{{Path: source}}, Outputs: []outputFile{{Path: output}},
			},
		},
	}
	req := httptest.NewRequest(http.MethodDelete, "/api/jobs/job-to-delete", nil)
	req.SetPathValue("id", "job-to-delete")
	unauthorized := req.WithContext(context.WithValue(req.Context(), sessionContextKey, "another-owner"))
	denied := httptest.NewRecorder()
	s.handleDeleteJob(denied, unauthorized)
	if denied.Code != http.StatusNotFound {
		t.Fatalf("cross-session delete status=%d, want 404", denied.Code)
	}
	req = req.WithContext(context.WithValue(req.Context(), sessionContextKey, "owner"))
	response := httptest.NewRecorder()
	s.handleDeleteJob(response, req)
	if response.Code != http.StatusNoContent {
		t.Fatalf("delete status=%d body=%q", response.Code, response.Body.String())
	}
	for _, path := range []string{source, output} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Errorf("deleted file %q still exists: %v", path, err)
		}
	}
	if _, exists := s.jobs["job-to-delete"]; exists {
		t.Fatal("deleted job remained in history")
	}
}

func TestOutputSizeLimitsApplyToFileAndWholeJob(t *testing.T) {
	path := filepath.Join(t.TempDir(), "output.bin")
	if err := os.WriteFile(path, []byte("12345"), 0600); err != nil {
		t.Fatal(err)
	}
	s := &server{cfg: config{maxOutput: 4, maxJobOutput: 10}}
	if _, err := s.checkOutputSize(path, 0); err == nil || !strings.Contains(err.Error(), "file") {
		t.Fatalf("expected per-file size rejection, got %v", err)
	}
	s.cfg.maxOutput = 10
	if _, err := s.checkOutputSize(path, 6); err == nil || !strings.Contains(err.Error(), "combined") {
		t.Fatalf("expected aggregate size rejection, got %v", err)
	}
}

func TestOversizedUploadIsRejected(t *testing.T) {
	root := t.TempDir()
	for _, folder := range []string{"uploads", "results"} {
		if err := os.MkdirAll(filepath.Join(root, folder), 0700); err != nil {
			t.Fatal(err)
		}
	}
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("files", "large.txt")
	if err != nil {
		t.Fatal(err)
	}
	_, _ = part.Write([]byte("12345"))
	_ = writer.WriteField("target", "pdf")
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	s := &server{
		cfg:          config{storage: root, maxUpload: 4, maxFiles: 1, maxActiveJobs: 3, maxQueueJobs: 20},
		jobs:         make(map[string]*job),
		queue:        make(chan struct{}, 1),
		reservations: make(map[string]int),
	}
	req := httptest.NewRequest(http.MethodPost, "/api/jobs", &body)
	req.Header.Set("Content-Type", writer.FormDataContentType())
	req = req.WithContext(context.WithValue(req.Context(), sessionContextKey, "owner"))
	response := httptest.NewRecorder()
	s.handleCreateJob(response, req)
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized upload status=%d body=%q", response.Code, response.Body.String())
	}
}

func TestFailedJobCleansTemporaryFiles(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "uploads", "private-input")
	if err := os.MkdirAll(filepath.Dir(source), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(source, []byte("%PDF-1.7\n"), 0600); err != nil {
		t.Fatal(err)
	}
	j := &job{
		ID: "failed-job", Status: "queued", Target: "pdf", CreatedAt: time.Now(),
		Files: []sourceFile{{Path: source, Name: "private.pdf", Kind: "pdf"}},
	}
	s := &server{
		cfg:   config{storage: root, python: filepath.Join(root, "missing-python"), timeout: time.Second, maxActiveJobs: 1},
		slots: make(chan struct{}, 1),
	}
	s.runJob(j, "", "", nil)
	if j.Status != "failed" {
		t.Fatalf("job status=%q, want failed", j.Status)
	}
	if _, err := os.Stat(source); !os.IsNotExist(err) {
		t.Fatalf("failed source file still exists: %v", err)
	}
	if _, err := os.Stat(filepath.Join(root, "results", j.ID)); !os.IsNotExist(err) {
		t.Fatalf("failed result directory still exists: %v", err)
	}
}

func TestSecureCookieRequiresTLSForNonLoopbackHosts(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "http://files.example.com/", nil)
	if !secureCookie(req) {
		t.Fatal("non-loopback host should require Secure cookies")
	}
	req = httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8080/", nil)
	if secureCookie(req) {
		t.Fatal("loopback development host should permit HTTP cookies")
	}
}

func TestMySQLDSNFromEnvironment(t *testing.T) {
	for key, value := range map[string]string{
		"DATABASE_URL": "", "DB_DRIVER": "mysql", "DB_HOST": "127.0.0.1", "DB_PORT": "3306",
		"DB_NAME": "pdfforge", "DB_USER": "pdf user", "DB_PASSWORD": "p@ss:/word",
	} {
		t.Setenv(key, value)
	}
	driver, dsn, err := databaseDriverFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if driver != "mysql" {
		t.Fatalf("driver=%q, want mysql", driver)
	}
	parsed, err := mysql.ParseDSN(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.User != "pdf user" || parsed.Passwd != "p@ss:/word" {
		t.Fatalf("MySQL credentials were not preserved safely: %q", dsn)
	}
	if parsed.Addr != "127.0.0.1:3306" || parsed.DBName != "pdfforge" || !parsed.ParseTime {
		t.Fatalf("unexpected MySQL DSN: %q", dsn)
	}
}

func TestDATABASEURLSelectsMySQLDriver(t *testing.T) {
	t.Setenv("DB_DRIVER", "")
	t.Setenv("DATABASE_URL", "mysql://pdfforge:secret@127.0.0.1:3306/pdfforge")
	driver, dsn, err := databaseDriverFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if driver != "mysql" {
		t.Fatalf("driver=%q, want mysql", driver)
	}
	parsed, err := mysql.ParseDSN(dsn)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.User != "pdfforge" || parsed.Passwd != "secret" || parsed.Addr != "127.0.0.1:3306" || parsed.DBName != "pdfforge" {
		t.Fatalf("unexpected MySQL DSN from DATABASE_URL: %q", dsn)
	}
	t.Setenv("DATABASE_URL", "postgres://pdfforge@127.0.0.1:5432/pdfforge")
	driver, dsn, err = databaseDriverFromEnv()
	if err != nil {
		t.Fatal(err)
	}
	if driver != "postgres" || dsn != "postgres://pdfforge@127.0.0.1:5432/pdfforge" {
		t.Fatalf("PostgreSQL DATABASE_URL was not preserved: %q (%s)", dsn, driver)
	}
}

func TestMySQLStatementTranslation(t *testing.T) {
	mysqlServer := &server{driver: "mysql"}
	got := mysqlServer.q(`SELECT a FROM t WHERE id = $1 AND expires_at > NOW() AND b = $2`)
	want := `SELECT a FROM t WHERE id = ? AND expires_at > UTC_TIMESTAMP(6) AND b = ?`
	if got != want {
		t.Fatalf("translated=%q, want %q", got, want)
	}
	if got := mysqlServer.q(`DELETE FROM pdfforge_sessions WHERE expires_at <= $1`); got != `DELETE FROM pdfforge_sessions WHERE expires_at <= ?` {
		t.Fatalf("placeholder translation failed: %q", got)
	}
	postgresServer := &server{driver: "postgres"}
	if statement := postgresServer.q(`SELECT $1, NOW()`); statement != `SELECT $1, NOW()` {
		t.Fatalf("postgres statement was rewritten: %q", statement)
	}
}

func TestSecurityHeadersArePresent(t *testing.T) {
	handler := securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/", nil))
	for _, header := range []string{"Content-Security-Policy", "Permissions-Policy", "X-Content-Type-Options", "Referrer-Policy"} {
		if response.Header().Get(header) == "" {
			t.Errorf("missing security header %q", header)
		}
	}
}

func TestHSTSIsOnlySetOnHTTPSRequests(t *testing.T) {
	handler := securityHeaders(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	httpResponse := httptest.NewRecorder()
	handler.ServeHTTP(httpResponse, httptest.NewRequest(http.MethodGet, "http://localhost/", nil))
	if got := httpResponse.Header().Get("Strict-Transport-Security"); got != "" {
		t.Fatalf("HSTS sent over HTTP: %q", got)
	}
	httpsRequest := httptest.NewRequest(http.MethodGet, "https://localhost/", nil)
	httpsRequest.TLS = &tls.ConnectionState{}
	httpsResponse := httptest.NewRecorder()
	handler.ServeHTTP(httpsResponse, httpsRequest)
	if got := httpsResponse.Header().Get("Strict-Transport-Security"); got == "" {
		t.Fatal("HSTS missing from HTTPS response")
	}
}
