# PRD ADDENDUM — SECURITY, PRIVACY & PREMIUM UX

## 1. Tujuan

PDFForge harus dirancang dengan prinsip **Security First + Privacy by Design**.

Sistem harus tetap aman ketika:
- converter crash
- worker error
- server restart
- database error
- user mengirim file berbahaya
- request dimanipulasi
- terjadi brute force
- terjadi path traversal
- terjadi upload abuse
- terjadi job flooding
- terjadi unauthorized download
- terjadi kebocoran log
- terjadi exception/panic

**Tidak boleh ada kondisi di mana file user dapat diakses publik hanya karena error.**

---

# 2. SECURITY PRINCIPLES

Implementasikan:

- Zero Trust terhadap uploaded files.
- Default deny.
- Private storage by default.
- Least privilege.
- Short-lived file access.
- Automatic cleanup.
- Input validation.
- Output validation.
- Resource limits.
- Process isolation.
- Audit logging.
- Secure error handling.

---

# 3. FILE PRIVACY

Semua file user harus **private secara default**.

Jangan pernah menyimpan file user pada:

```text
public/
static/
assets/
uploads/ yang exposed langsung oleh web server
```

Gunakan:

```text
private-storage/
```

Backend menjadi satu-satunya pihak yang boleh mengakses storage.

User tidak boleh bisa:

```text
GET /uploads/document.pdf
```

secara langsung.

---

# 4. RANDOM STORAGE ID

Jangan menggunakan:

```text
/uploads/user123/invoice.pdf
```

Gunakan identifier random:

```text
storage/
├── 8f/
│   └── 91/
│       └── 8f91c2...bin
```

Database menyimpan mapping:

```text
file_id
storage_key
owner_id
```

Filename asli hanya digunakan sebagai metadata.

---

# 5. AUTHORIZATION

Setiap file harus memiliki owner.

Setiap download harus melakukan:

```text
Authenticated User
       ↓
Check File Exists
       ↓
Check Ownership / Permission
       ↓
Check File Status
       ↓
Check Expiration
       ↓
Generate Download
```

User A **tidak boleh** mengakses file User B meskipun mengetahui `file_id`.

---

# 6. IDOR PROTECTION

Jangan menganggap:

```text
GET /api/files/123
```

aman hanya karena `123` sulit ditebak.

Backend wajib memeriksa:

```text
file.user_id == current_user.id
```

untuk setiap operasi.

Berlaku untuk:

- view
- download
- delete
- rename
- reprocess
- share
- history

---

# 7. SECURE DOWNLOAD

Jangan menggunakan public URL permanen.

Gunakan:

```text
GET /api/files/{id}/download
```

Backend melakukan authorization terlebih dahulu.

Jika menggunakan object storage:

```text
Private Object
      ↓
Authorization
      ↓
Short-lived Signed URL
      ↓
Download
```

Signed URL harus:
- memiliki expiration
- hanya berlaku untuk file tertentu
- tidak reusable terlalu lama

---

# 8. FILE EXPIRATION

File temporary memiliki TTL.

Default:

```text
24 hours
```

Setelah expiration:

```text
Database record
       ↓
Cleanup Worker
       ↓
Physical File Delete
```

Jika user logout, file **tidak otomatis menjadi public**.

Jika server restart, file tetap private.

---

# 9. ERROR SAFETY

Jika terjadi:

```text
panic
converter crash
timeout
worker crash
database error
```

response kepada user:

```text
We couldn't process your file.
Please try again.
```

Jangan pernah mengirim:

- filesystem path
- command line
- stack trace
- environment variable
- database URL
- internal IP
- storage path
- converter arguments

---

# 10. PANIC RECOVERY

Go HTTP server harus memiliki panic recovery middleware.

Jika handler panic:

```text
Recover
↓
Log internal error
↓
Return generic error
```

Contoh response:

```json
{
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Something went wrong. Please try again."
  }
}
```

---

# 11. TEMPORARY FILE SECURITY

Setiap job menggunakan temporary working directory unik:

```text
/tmp/pdf-forge/jobs/{random-job-id}/
```

Permissions harus restrictive.

Setelah job:

```text
success → cleanup
failure → cleanup
timeout → cleanup
panic → cleanup
cancel → cleanup
```

Gunakan cleanup melalui `defer` dan background cleanup worker sebagai safety net.

---

# 12. PATH TRAVERSAL

Tolak input seperti:

```text
../../secret.txt
..\..\secret.txt
/etc/passwd
C:\Windows\...
```

Jangan pernah menggunakan filename user sebagai filesystem path.

Storage key harus dibuat server-side.

---

# 13. COMMAND INJECTION

External tools seperti:

```text
qpdf
Ghostscript
LibreOffice
Tesseract
Chromium
```

harus dipanggil menggunakan argument array.

Jangan:

```text
sh -c "qpdf " + userInput
```

Gunakan process execution API dengan arguments terpisah.

Tidak boleh ada shell interpolation dari input user.

---

# 14. MALICIOUS FILE PROTECTION

Uploaded file dianggap **untrusted**.

Validasi:

- file signature
- MIME
- extension
- parser
- file size
- page count
- decompressed size
- structure

Jangan percaya:

```text
Content-Type
filename extension
client metadata
```

---

# 15. ZIP BOMB / DECOMPRESSION BOMB

Jika ZIP processing ditambahkan:

WAJIB memiliki:

```text
Maximum archive size
Maximum extracted size
Maximum files
Maximum nesting depth
Maximum compression ratio
```

Contoh:

```env
MAX_ARCHIVE_SIZE_MB=100
MAX_EXTRACTED_SIZE_MB=500
MAX_ARCHIVE_FILES=1000
MAX_ARCHIVE_DEPTH=5
```

Extraction harus dihentikan jika melewati limit.

---

# 16. PDF BOMB / RESOURCE EXHAUSTION

PDF dapat menyebabkan penggunaan CPU/RAM tinggi.

Setiap job memiliki:

```text
CPU limit
Memory limit
Time limit
Page limit
Input size limit
Output size limit
```

Contoh:

```env
MAX_UPLOAD_SIZE_MB=100
MAX_PAGES=500
MAX_OUTPUT_SIZE_MB=300
JOB_TIMEOUT_SECONDS=300
```

---

# 17. PROCESS ISOLATION

External converter sebaiknya tidak berjalan dengan privilege tinggi.

Gunakan:

```text
Dedicated Worker User
```

bukan:

```text
root
Administrator
```

Jika production:

```text
Container / Sandbox
```

untuk converter berisiko.

Worker tidak boleh memiliki akses ke:
- database credentials yang tidak diperlukan
- system secrets
- SSH keys
- host filesystem
- application source secrets

---

# 18. SSRF PROTECTION

Jika fitur menerima URL:

```text
HTML URL → PDF
```

WAJIB mencegah akses ke:

```text
localhost
127.0.0.1
0.0.0.0
::1
private IP
metadata endpoints
internal services
```

Jangan mengizinkan converter mengakses jaringan internal secara bebas.

Jika URL conversion belum aman, **jangan implementasikan fitur tersebut**.

---

# 19. MALICIOUS HTML

HTML conversion harus dianggap berbahaya.

Jalankan browser dalam sandbox.

Disable jika tidak diperlukan:

- file:// access
- arbitrary local filesystem access
- dangerous browser APIs
- unrestricted network access

Jangan memberikan browser access ke storage aplikasi.

---

# 20. MALICIOUS DOCUMENT MACROS

DOC/DOCX/XLS/XLSX/PPT/PPTX yang mengandung macro harus diproses dalam environment terisolasi.

Jangan menjalankan macro.

Jika engine tidak dapat menjamin macro tidak dieksekusi:

> Reject atau sanitize file sebelum conversion.

---

# 21. MALICIOUS SVG

SVG dapat mengandung:

- scripts
- external references
- embedded content

SVG harus disanitasi sebelum diproses jika diperlukan.

Jika sanitizer tidak tersedia:

> Jangan render SVG user secara langsung di browser.

---

# 22. ANTIVIRUS

Architecture harus menyediakan optional malware scanning layer:

```text
Upload
 ↓
Validation
 ↓
Virus Scanner
 ↓
Processing
```

Contoh integration:

```text
ClamAV
```

Jika scanner mendeteksi malware:

```text
Reject
Delete temporary file
Log security event
```

---

# 23. RATE LIMITING

Rate limit berdasarkan:

- IP
- account
- endpoint
- operation
- upload volume

Endpoint sensitif:

```text
/login
/register
/password-reset
/upload
/jobs
/download
```

harus memiliki limit lebih ketat.

---

# 24. ABUSE PROTECTION

Cegah user melakukan:

```text
1000 simultaneous jobs
```

Gunakan:

```text
Per-user concurrency limit
Global worker limit
Queue limit
```

Contoh:

```env
MAX_ACTIVE_JOBS_PER_USER=3
MAX_QUEUE_PER_USER=20
```

---

# 25. AUTHENTICATION SECURITY

Password:

- Argon2id atau bcrypt
- tidak pernah plaintext
- tidak pernah masuk logs

Session:

- HttpOnly
- Secure
- SameSite
- expiration
- rotation

Jika JWT digunakan:

- short expiration
- refresh token rotation
- revocation strategy

---

# 26. CSRF

Jika authentication menggunakan cookie:

Implementasikan CSRF protection untuk state-changing requests.

---

# 27. CORS

Jangan:

```text
Access-Control-Allow-Origin: *
```

untuk authenticated API.

Gunakan whitelist:

```env
ALLOWED_ORIGINS=https://pdfforge.example
```

---

# 28. SECURITY HEADERS

Gunakan:

```text
Content-Security-Policy
Strict-Transport-Security
X-Content-Type-Options
Referrer-Policy
Permissions-Policy
Frame-ancestors
```

Jangan mengaktifkan header yang tidak diperlukan.

---

# 29. CONTENT DISPOSITION

Download harus menggunakan:

```text
Content-Disposition: attachment
```

untuk file yang tidak dimaksudkan sebagai inline browser content.

Filename output harus disanitasi.

---

# 30. LOG SECURITY

Log:

```text
login success/failure
upload
job creation
job failure
download
delete
authorization failure
rate limit
malware detection
```

Jangan log:

```text
password
JWT
API key
file contents
signed URLs
sensitive metadata
```

---

# 31. AUDIT LOG

Security events:

```text
USER_LOGIN
USER_LOGIN_FAILED
FILE_UPLOADED
FILE_DOWNLOADED
FILE_DELETED
JOB_CREATED
JOB_FAILED
ACCESS_DENIED
RATE_LIMITED
MALWARE_DETECTED
```

Audit log tidak boleh berisi isi dokumen.

---

# 32. DATABASE SECURITY

Gunakan parameterized queries.

Dilarang:

```text
string concatenation → SQL query
```

Database user aplikasi harus memiliki permission minimum.

Migration user tidak digunakan sebagai runtime user jika tidak diperlukan.

---

# 33. SECRETS

Jangan menyimpan:

```text
password
JWT secret
API keys
database password
```

di Git.

Gunakan:

```text
.env
secret manager
environment variables
```

Tambahkan:

```text
.env
```

ke `.gitignore`.

---

# 34. BACKUP

Database backup harus:

- encrypted
- access restricted
- retention policy
- tested restoration

File user temporary tidak perlu masuk backup jika privacy policy mengharuskan ephemeral storage.

---

# 35. DATA PRIVACY

User harus mengetahui:

```text
How long files are stored
When files are deleted
Whether files are scanned
Whether files are used for AI/training
```

Default:

> User files are processed only to provide the requested operation and are automatically deleted after the configured retention period.

---

# 36. NO PUBLIC FILE LEAK

Automated security test harus memastikan:

```text
Private file
↓
Direct URL
↓
403 / 404
```

Jika user lain mencoba:

```text
User A file
↓
User B request
↓
403
```

Jika job gagal:

```text
Failed job
↓
Output inaccessible
↓
Temporary files deleted
```

Jika server restart:

```text
Restart
↓
Files remain private
```

---

# 37. UI — VISUAL DIRECTION

UI harus terasa seperti **premium document utility**, bukan admin dashboard.

Gunakan:

- large typography
- spacious layout
- strong visual hierarchy
- subtle gradients
- glass/blur hanya jika memang membantu
- clean cards
- distinctive illustrations
- polished upload experience
- micro-interactions

Hindari:

- dashboard template generik
- terlalu banyak card
- gradient berlebihan
- rainbow gradients
- excessive animations
- "AI slop" aesthetics

---

# 38. HOMEPAGE EXPERIENCE

Hero:

```text
Your files.
Your tools.
One workspace.

Convert, compress, merge,
edit and transform documents.
```

Upload area menjadi focal point:

```text
┌───────────────────────────────────────┐
│                                       │
│            Drop your file             │
│                                       │
│       or browse from your device      │
│                                       │
│        PDF · DOCX · XLSX · JPG        │
│                                       │
└───────────────────────────────────────┘
```

Drag ketika file mendekati area:

```text
Drop it here.
We'll take care of the rest.
```

---

# 39. TOOL CARD DESIGN

Setiap tool:

```text
┌─────────────────────────────┐
│  ◈                          │
│                             │
│  Compress PDF               │
│  Make your PDF smaller      │
│  without unnecessary hassle.│
│                             │
│  Open tool  →               │
└─────────────────────────────┘
```

Hover:

- card sedikit naik
- icon animation
- border highlight
- arrow movement

Jangan menggunakan animasi berlebihan.

---

# 40. FILE CARD

Setiap upload:

```text
┌─────────────────────────────────┐
│ 📄  report-final.pdf            │
│     PDF · 24.8 MB · 48 pages    │
│                                 │
│     ███████████████░░  78%      │
│                                 │
│     Processing...               │
└─────────────────────────────────┘
```

Status harus jelas secara visual:

```text
Uploading
Processing
Completed
Failed
Expired
```

---

# 41. PROCESSING SCREEN

Jangan hanya:

```text
Loading...
```

Gunakan:

```text
Preparing your document

Analyzing pages
████████████░░░

Page 34 of 48

Usually takes a few seconds.
```

Jika proses lama:

```text
Your document is taking a little longer than usual.
You can safely leave this page open.
```

---

# 42. SUCCESS STATE

Gunakan success animation ringan.

```text
✓
Done.

Your document is ready.
```

Kemudian:

```text
[ Download File ]
[ Process Another ]
```

Secondary:

```text
Delete file now
```

---

# 43. ERROR STATE

Error harus tetap terlihat premium.

Jangan:

```text
500 Internal Server Error
```

Gunakan:

```text
Something went wrong.

We couldn't finish processing this document.
Your original file is safe.

[ Try Again ]
[ Choose Another File ]
```

Jika file sudah dihapus:

> Your temporary file has been securely removed.

---

# 44. SECURITY INDICATORS

Tanpa menakut-nakuti user.

Upload page:

```text
🔒 Private processing
Your files are automatically deleted after processing.
```

Tooltip:

> Files are stored privately and are never publicly accessible.

---

# 45. EMPTY STATE

History:

```text
Your workspace is empty.

Processed documents will appear here.

[ Start with a PDF ]
```

---

# 46. MICRO INTERACTIONS

Implement:

- drag/drop animation
- upload progress
- smooth progress transitions
- button loading states
- success state
- error recovery
- skeleton loading
- page transitions

Semua animation harus memiliki:

```text
prefers-reduced-motion
```

support.

---

# 47. MOBILE UX

Mobile harus memiliki:

- large upload button
- bottom action area
- touch-friendly controls
- swipe page preview
- sticky download button
- no horizontal overflow

---

# 48. SECURITY TEST SUITE

AI Agent WAJIB membuat test untuk:

### Authorization

```text
User A cannot download User B file
```

### Path Traversal

```text
../../secret
```

must fail.

### SQL Injection

All endpoints must reject/neutralize malicious SQL input.

### XSS

Filename:

```text
<script>alert(1)</script>.pdf
```

harus ditampilkan sebagai text biasa.

### Command Injection

Malicious filename/input tidak boleh menjalankan command.

### Upload Abuse

Oversized files harus ditolak.

### Rate Limit

Excessive requests harus dibatasi.

### Expiration

Expired files harus inaccessible.

### Error Cleanup

Failed job harus membersihkan temporary files.

### Crash Recovery

Worker crash tidak boleh meninggalkan public files.

### IDOR

Changing file ID tidak boleh memberikan akses ke file user lain.

---

# 49. SECURITY ACCEPTANCE CRITERIA

Aplikasi **tidak dianggap production-ready** jika:

- file upload dapat diakses public tanpa authorization
- user dapat membaca file user lain
- stack trace terlihat di browser
- temporary files tidak dibersihkan
- converter dapat menjalankan arbitrary shell command
- upload tidak memiliki size limit
- job dapat membuat unlimited resource consumption
- secrets masuk Git
- password disimpan plaintext
- signed URL tidak memiliki expiration
- failed processing meninggalkan file sensitif yang dapat diakses

---

# 50. FINAL SECURITY ARCHITECTURE

```text
                 INTERNET
                    │
                    ▼
             ┌─────────────┐
             │ Rate Limit  │
             │ WAF/Proxy   │
             └──────┬──────┘
                    │
                    ▼
             ┌─────────────┐
             │   Go API    │
             │ Auth        │
             │ Validation  │
             │ Authorization│
             └──────┬──────┘
                    │
          ┌─────────┴──────────┐
          ▼                    ▼
    ┌───────────┐       ┌────────────┐
    │ PostgreSQL│       │ Private    │
    │           │       │ Storage    │
    └───────────┘       └─────┬──────┘
                              │
                              ▼
                       ┌─────────────┐
                       │ Job Queue   │
                       └──────┬──────┘
                              │
                              ▼
                       ┌─────────────┐
                       │ Isolated    │
                       │ Worker      │
                       └──────┬──────┘
                              │
                    ┌─────────┼─────────┐
                    ▼         ▼         ▼
                  qpdf    Ghostscript  LibreOffice
                    │         │         │
                    └─────────┼─────────┘
                              ▼
                       Output Validation
                              │
                              ▼
                       Private Storage
                              │
                              ▼
                       Authorized Download
                              │
                              ▼
                        Auto Cleanup
```

# 51. FINAL AI AGENT DIRECTIVE

Prioritaskan **security > correctness > reliability > performance > visual polish**.

Tidak boleh mengorbankan keamanan hanya untuk membuat fitur terlihat selesai.

Jika sebuah fitur belum dapat dibuat dengan aman, jangan membuat implementasi palsu. Tandai sebagai `Experimental`, batasi capability-nya, atau tunda implementasi.

Setiap fitur baru harus melewati:

```text
Implementation
↓
Unit Test
↓
Integration Test
↓
Security Test
↓
Error/Crash Test
↓
UX Review
↓
Performance Review
↓
Documentation
```

Target akhir:

> **PDFForge harus terasa seperti produk SaaS profesional, tetapi file user diperlakukan sebagai data sensitif dan tidak pernah menjadi public asset secara default.**