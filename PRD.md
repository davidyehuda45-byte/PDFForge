# PRD — PDFForge
### Modern Online PDF Processing Platform

## 1. Visi Produk

PDFForge adalah platform web untuk mengolah dokumen PDF secara cepat, aman, modern, dan mudah digunakan.

Produk terinspirasi dari konsep platform seperti iLovePDF, tetapi **tidak melakukan cloning UI/branding**. PDFForge harus memiliki identitas visual, UX, arsitektur, dan fitur sendiri.

Tujuan utama:
- Menggabungkan berbagai kebutuhan PDF dalam satu platform.
- Memproses file dengan cepat menggunakan backend Go.
- Menampilkan progress processing secara realtime.
- Memiliki workflow upload → processing → result yang sangat sederhana.
- Mendukung batch processing.
- Memiliki sistem akun dan riwayat dokumen.
- Menjaga file pengguna agar tidak tersimpan selamanya.
- Dapat dioperasikan secara berkelanjutan sebagai layanan gratis untuk semua pengguna.
- Tidak memiliki paket berbayar, paywall, kuota penggunaan produk, atau biaya bagi pengguna.

---

# 2. Target Pengguna

### Primary
- Pelajar
- Mahasiswa
- Guru/dosen
- Pekerja kantoran
- Freelancer
- Developer
- Administrasi perusahaan
- Pengguna umum

### Use Case

User ingin:
- Menggabungkan beberapa PDF.
- Memisahkan halaman tertentu.
- Mengecilkan ukuran PDF.
- Mengubah gambar menjadi PDF.
- Mengubah PDF ke gambar.
- Mengubah dokumen Office menjadi PDF.
- Memutar halaman.
- Menghapus halaman.
- Mengambil halaman tertentu.
- Memberikan watermark.
- Melindungi PDF dengan password.
- Membuka password PDF jika user memiliki password.
- Mengubah nama/metadata PDF.
- Melakukan OCR.
- Menandatangani PDF.
- Membandingkan dua PDF.
- Melihat informasi PDF.

---

# 3. Prinsip Produk

AI Agent WAJIB mengikuti prinsip berikut:

1. Jangan membuat aplikasi yang terasa seperti template dashboard admin.
2. Jangan menggunakan desain generik "AI SaaS".
3. UI harus memiliki identitas visual sendiri.
4. Workflow utama harus dapat dipahami tanpa tutorial.
5. File processing harus asynchronous.
6. Jangan membuat request HTTP menunggu proses PDF berat.
7. Jangan menyimpan file user secara permanen tanpa alasan.
8. Semua operasi file harus divalidasi.
9. Jangan mempercayai filename, MIME type, atau extension dari client.
10. Semua processing harus memiliki batas ukuran, timeout, dan resource limit.
11. Error harus ditampilkan dengan bahasa manusia.
12. Jangan membuat fitur palsu yang hanya berupa tombol.
13. Setiap fitur PDF harus benar-benar melakukan processing.
14. Arsitektur harus mudah dikembangkan untuk production tanpa mengharuskan monetisasi atau paket berbayar.
15. Semua pengguna mendapat akses ke seluruh fitur tanpa kuota penggunaan produk atau biaya.
16. Batas teknis hanya untuk keamanan, kestabilan, dan kapasitas server; tidak boleh menjadi pembeda paket atau paywall.

---

# 4. Tech Stack

## Backend

### Go
Gunakan Go sebagai backend utama.

Recommended:
- Go
- HTTP router: Chi / Gin
- PostgreSQL
- pgx
- sqlc atau repository pattern
- JWT/session authentication
- WebSocket atau Server-Sent Events
- structured logging
- background workers

Backend bertanggung jawab atas:
- Authentication
- User management
- File upload
- File validation
- Job creation
- Job queue
- PDF processing orchestration
- Processing progress
- Download authorization
- History
- Operational usage metrics untuk kapasitas dan pencegahan penyalahgunaan, bukan billing atau kuota paket
- API
- Security
- Cleanup

---

# 5. Frontend

Recommended:

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui atau komponen custom
- TanStack Query
- Framer Motion jika diperlukan

Frontend harus berkomunikasi dengan Go API.

Jangan menaruh business logic penting di frontend.

---

# 6. PDF Processing Engine

Go menjadi orchestrator.

Gunakan external binary/library yang sesuai untuk pekerjaan PDF.

Recommended tools:

### qpdf
Untuk:
- merge
- split
- rotate
- encryption/decryption tertentu
- optimization tertentu
- structural PDF operations

### Ghostscript
Untuk:
- compression
- PDF optimization
- rendering tertentu

### LibreOffice
Untuk:
- DOC/DOCX → PDF
- XLS/XLSX → PDF
- PPT/PPTX → PDF

### Tesseract OCR
Untuk:
- OCR PDF
- image → text
- searchable PDF

AI Agent harus mendeteksi apakah dependency tersedia.

Jika dependency belum tersedia:
- tampilkan error setup yang jelas
- jangan membuat mock processing
- jangan berpura-pura fitur berhasil

---

# 7. Database

Gunakan PostgreSQL.

## users

Fields:
- id
- name
- email
- password_hash
- avatar_url
- role
- plan
- storage_used
- created_at
- updated_at
- last_login_at

## files

Fields:
- id
- user_id
- original_name
- stored_name
- mime_type
- extension
- size
- checksum
- page_count
- storage_path
- status
- created_at
- expires_at

## jobs

Fields:
- id
- user_id
- operation
- status
- progress
- input_files
- output_file_id
- error_code
- error_message
- started_at
- completed_at
- created_at

Statuses:

```text
queued
processing
completed
failed
cancelled
expired
```

## job_logs

Fields:
- id
- job_id
- level
- message
- created_at

## usage_records

Fields:
- id
- user_id
- operation
- input_size
- output_size
- processing_time
- created_at

## api_keys

Fields:
- id
- user_id
- name
- key_hash
- last_used_at
- created_at
- revoked_at

---

# 8. Storage Architecture

Development:

```text
/local-storage
```

Production-ready abstraction:

```text
Storage Interface
      ↓
Local Storage
      OR
S3
      OR
MinIO
```

Jangan mengikat business logic langsung ke filesystem.

Buat interface:

```text
Storage
├── Save()
├── Open()
├── Delete()
├── Exists()
└── GetURL()
```

---

# 9. Core PDF Tools

Homepage harus memiliki kategori tools.

## ORGANIZE

### Merge PDF

Input:
- multiple PDF

Features:
- drag & drop
- reorder
- preview
- remove file
- rename output
- merge

Flow:

```text
Upload
↓
Preview
↓
Reorder
↓
Merge
↓
Processing
↓
Download
```

---

### Split PDF

Modes:

- Split every N pages
- Extract page range
- Extract selected pages
- Split into individual pages

Example:

```text
1-5
8
10-12
```

Output dapat berupa:
- multiple PDF
- ZIP

---

### Extract Pages

User memilih:
- page 1
- page 3
- page 8-10

Output:
```text
selected-pages.pdf
```

---

### Remove Pages

User memilih halaman yang ingin dihapus.

Preview harus memperlihatkan nomor halaman.

---

### Reorder Pages

Drag halaman.

Support:
- drag
- move left/right
- first
- last
- rotate
- delete

---

### Rotate PDF

Options:

- 90°
- 180°
- 270°

Scope:
- all pages
- selected pages

---

## OPTIMIZE

### Compress PDF

Preset:

```text
Extreme
Recommended
Balanced
High Quality
Custom
```

Tampilkan:

```text
Before: 24.8 MB
After: 7.2 MB
Saved: 71%
```

Jangan mengklaim compression jika output tidak benar-benar lebih kecil.

---

### Repair PDF

Mencoba memperbaiki PDF yang:
- malformed
- corrupted structure
- broken xref
- damaged metadata

Jika gagal, tampilkan alasan.

---

### Optimize PDF

Target:
- remove unnecessary metadata
- optimize streams
- optimize objects
- reduce size

---

# 10. CONVERT

## Image → PDF

Support:
- JPG
- JPEG
- PNG
- WEBP

Features:
- reorder
- page size
- orientation
- margin
- fit/fill
- quality

---

## PDF → JPG

Options:
- page selection
- quality
- resolution

Output:
- individual images
- ZIP

---

## PDF → PNG

Same concept.

---

## PDF → WebP

Optional advanced feature.

---

## Word → PDF

Support:
- DOC
- DOCX

Processing menggunakan LibreOffice.

---

## Excel → PDF

Support:
- XLS
- XLSX

---

## PowerPoint → PDF

Support:
- PPT
- PPTX

---

## PDF → Word

Jika engine yang dipakai belum cukup reliable, fitur harus diberi status experimental.

Jangan menjanjikan layout 100% identical.

---

## PDF → Excel

Experimental.

---

# 11. EDIT PDF

## Watermark

Support:
- text
- image

Controls:
- opacity
- size
- rotation
- position
- color
- page selection

Positions:

```text
Top Left
Top Center
Top Right
Center
Bottom Left
Bottom Center
Bottom Right
```

---

## Page Number

Formats:

```text
1
Page 1
Page 1 of 10
```

Position:
- top
- bottom

Alignment:
- left
- center
- right

---

## Header & Footer

User dapat memasukkan:
- text
- date
- page number

---

## Crop PDF

Visual crop editor.

User dapat memilih:
- crop box
- margins
- page range

---

## Metadata Editor

Fields:

- Title
- Author
- Subject
- Keywords
- Creator
- Producer

---

# 12. SECURITY

## Encrypt PDF

User dapat memberikan password.

Options:
- password to open
- permissions password
- printing permission
- copying permission
- editing permission

---

## Unlock PDF

User harus memasukkan password yang memang dimilikinya.

Jangan membuat fitur brute-force password.

---

# 13. OCR

## OCR PDF

Flow:

```text
Upload PDF
↓
Detect scanned pages
↓
OCR
↓
Generate searchable PDF
↓
Download
```

Languages:

- Indonesian
- English
- additional languages

UI harus menampilkan:

```text
OCR Progress
Page 14 / 38
```

---

# 14. SIGN PDF

Fitur:

- draw signature
- upload signature image
- type signature
- place signature
- resize
- move
- rotate

Signature harus menjadi bagian dari generated document.

---

# 15. PDF INFORMATION

Tool untuk melihat:

```text
File Size
Pages
PDF Version
Author
Creator
Producer
Creation Date
Modification Date
Encrypted
Fonts
Images
Metadata
```

---

# 16. PDF COMPARISON

User upload:

```text
Original.pdf
Modified.pdf
```

System menampilkan:

- page differences
- added pages
- removed pages
- changed text
- changed visual areas

Jika visual diff terlalu kompleks untuk MVP, implementasikan text/page-level comparison terlebih dahulu.

---

# 17. PDF PREVIEW

Setiap file PDF harus bisa memiliki preview.

Preview:
- thumbnail
- page number
- zoom
- rotate
- fullscreen
- next/previous page

UI:

```text
[-] 100% [+]
       ↓
┌─────────────────┐
│                 │
│   PDF PREVIEW   │
│                 │
│                 │
└─────────────────┘
       1 / 20
```

---

# 18. HOME PAGE

Hero section:

```text
Transform your PDFs.
Without the hassle.
```

Subheadline:

```text
Merge, compress, convert, edit,
and organize your documents in seconds.
```

Primary CTA:

```text
Choose a PDF Tool
```

Secondary:
```text
Upload PDF
```

---

# 19. TOOL GRID

Kategori:

```text
Organize
Convert
Optimize
Edit
Security
OCR
Advanced
```

Setiap tool card:

- icon
- name
- description
- supported formats
- badge jika premium
- hover animation

Contoh:

```text
┌─────────────────────────┐
│  ⇄                      │
│  Merge PDF              │
│  Combine multiple PDFs  │
│  into one document.     │
│                         │
│  Open Tool →            │
└─────────────────────────┘
```

---

# 20. UPLOAD EXPERIENCE

Upload zone harus mendukung:

- click upload
- drag & drop
- multiple files
- paste file jika browser mendukung

UI:

```text
Drop your files here

or

[ Browse Files ]

PDF, JPG, PNG, DOCX
```

Setelah upload:

```text
document.pdf
████████████████ 100%

24.5 MB
```

---

# 21. PROCESSING EXPERIENCE

Jangan hanya menampilkan spinner.

Tampilkan:

```text
Processing your PDF

██████████████░░░░ 78%

Optimizing pages...

Page 38 / 50
```

Status:

```text
Uploading
Analyzing
Processing
Finalizing
Completed
```

---

# 22. RESULT PAGE

Setelah selesai:

```text
✓ Your PDF is ready

compressed-document.pdf

Original      24.8 MB
Compressed     7.2 MB
Saved         71%

[ Download ]

[ Process Another ]

[ Share ]
```

Optional:

```text
Delete File
```

---

# 23. HISTORY

User login dapat melihat:

```text
Recent Files
```

Columns:

- filename
- operation
- size
- status
- created
- expiration
- action

Actions:

```text
Download
Delete
Reprocess
Rename
```

Filter:

```text
All
Merge
Compress
Convert
OCR
Edit
```

---

# 24. DASHBOARD

Dashboard bukan admin panel generik.

Overview:

```text
Files Processed
Storage Used
Total Saved
Processing Time
```

Activity:

```text
Compress report.pdf
2 minutes ago

Merge invoices.pdf
1 hour ago

OCR document.pdf
Yesterday
```

---

# 25. AUTHENTICATION

Support:

- Register
- Login
- Logout
- Forgot password
- Reset password
- Email verification
- Session management

Optional:
- Google OAuth

---

# 26. USER PROFILE

Fields:

- name
- email
- avatar
- password
- timezone
- language

Security:
- active sessions
- logout all sessions
- account deletion

---

# 27. FILE LIFECYCLE

Temporary uploaded files harus memiliki expiration.

Example:

```text
Upload
↓
Processing
↓
Result
↓
Temporary storage
↓
Expiration
↓
Automatic deletion
```

Default expiration:

```text
24 hours
```

Configurable melalui environment variable.

---

# 28. JOB SYSTEM

Jangan melakukan processing berat langsung dalam HTTP request.

Architecture:

```text
Client
   ↓
Go API
   ↓
Create Job
   ↓
PostgreSQL / Queue
   ↓
Worker
   ↓
PDF Engine
   ↓
Storage
   ↓
Update Job
   ↓
WebSocket/SSE
   ↓
Client
```

Job memiliki:

```text
id
type
status
progress
input
output
error
timestamps
```

---

# 29. WORKER

Worker bertanggung jawab:

```text
Fetch job
↓
Lock job
↓
Validate input
↓
Execute processor
↓
Update progress
↓
Save result
↓
Mark completed
```

Jika gagal:

```text
failed
```

Retry policy:

```text
attempt 1
attempt 2
attempt 3
```

Gunakan exponential backoff.

---

# 30. CONCURRENCY

Go harus dimanfaatkan untuk concurrency.

Contoh:

```text
Worker Pool

Worker 1 → Compress PDF
Worker 2 → OCR PDF
Worker 3 → Merge PDF
Worker 4 → Convert DOCX
```

Jumlah worker configurable:

```env
WORKER_COUNT=4
```

Jangan membuat goroutine tanpa batas.

Gunakan:
- worker pool
- semaphore
- context cancellation
- timeout

---

# 31. REALTIME PROGRESS

Gunakan WebSocket atau SSE.

Events:

```text
job.created
job.started
job.progress
job.completed
job.failed
job.cancelled
```

Example:

```json
{
  "job_id": "abc123",
  "status": "processing",
  "progress": 72,
  "message": "Optimizing page 36 of 50"
}
```

---

# 32. API

Contoh endpoint:

```text
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/logout

GET    /api/user
PATCH  /api/user

POST   /api/files/upload
GET    /api/files
GET    /api/files/:id
DELETE /api/files/:id

POST   /api/jobs
GET    /api/jobs/:id
POST   /api/jobs/:id/cancel

GET    /api/jobs/:id/events

GET    /api/download/:id
```

Tool-specific endpoint tidak harus dibuat satu per satu jika job architecture lebih cocok.

Contoh:

```json
POST /api/jobs
{
  "operation": "compress",
  "files": ["file-id"]
}
```

---

# 33. SECURITY

WAJIB:

- validate MIME
- validate extension
- inspect actual file signature
- maximum upload size
- maximum pages
- processing timeout
- rate limiting
- authentication
- authorization
- path traversal protection
- random storage filename
- sanitize filenames
- never execute user-provided commands
- never interpolate filenames into shell commands
- sandbox external processors jika memungkinkan
- automatic cleanup
- audit logs

Jangan pernah melakukan:

```text
exec("command " + userFilename)
```

Gunakan argument array dan validasi ketat.

---

# 34. RATE LIMIT

Rate limiting hanya digunakan sebagai perlindungan sementara terhadap penyalahgunaan dan untuk menjaga ketersediaan layanan. Rate limit bukan kuota produk, tidak boleh membedakan pengguna gratis dan berbayar, dan tidak boleh dipakai untuk mendorong upgrade.

Konfigurasi harus dapat disesuaikan operator berdasarkan kapasitas dan pola penyalahgunaan aktual. Gunakan respons `429` yang jelas, sertakan waktu retry bila tersedia, dan jangan menampilkan ajakan membeli paket.

Jangan membatasi pengguna yang berperilaku normal dengan jatah operasi per jam/hari/bulan.

---

# 35. FILE LIMIT

Semua batas di bawah adalah maksimum teknis untuk melindungi server dan seluruh pengguna, bukan kuota paket. Nilainya harus configurable, diberlakukan setara untuk semua pengguna, dan dijelaskan dengan transparan. Jangan membuat paywall atau meminta pembayaran untuk melewati batas tersebut. Bila file melebihi kapasitas instance, tampilkan batas aktual dan pesan yang mudah dipahami.

Environment variables:

```env
MAX_UPLOAD_SIZE_MB=100
MAX_FILES_PER_JOB=20
MAX_PAGES_PER_FILE=500
JOB_TIMEOUT_SECONDS=300
FILE_EXPIRATION_HOURS=24
```

Jangan hardcode.

---

# 36. ERROR HANDLING

Jangan tampilkan:

```text
panic: exit status 1
```

User harus mendapatkan:

```text
We couldn't process this PDF.

The document appears to be corrupted.
Try opening it in a PDF reader first and upload it again.
```

Backend tetap mencatat error teknis dalam logs.

---

# 37. LOGGING

Structured JSON logs:

```json
{
  "level": "error",
  "service": "pdf-worker",
  "job_id": "abc123",
  "operation": "compress",
  "error": "..."
}
```

Levels:

```text
debug
info
warn
error
```

Jangan log:
- password
- JWT
- sensitive file contents

---

# 38. OBSERVABILITY

Dashboard internal dapat menampilkan:

```text
Active Jobs
Queued Jobs
Failed Jobs
Average Processing Time
CPU Usage
Memory Usage
Storage Usage
```

Metrics:

```text
jobs_total
jobs_completed
jobs_failed
processing_duration
upload_bytes
download_bytes
```

---

# 39. ADMIN PANEL

Admin dapat:

- melihat users
- melihat jobs
- melihat failed jobs
- melihat storage
- melihat metrik penggunaan agregat untuk kapasitas dan operasional (bukan billing)
- melihat system health
- melihat logs
- suspend user
- delete file
- retry job
- configure technical safety limits consistently for all users
- configure tools

---

# 40. DESIGN SYSTEM

Visual direction:

### Style

Modern document utility platform.

Bukan:
- corporate dashboard
- Bootstrap default
- template SaaS
- terlalu banyak gradient
- AI-generated generic UI

Gunakan:

- whitespace luas
- typography kuat
- rounded cards secukupnya
- subtle borders
- subtle shadows
- micro-interactions
- clean iconography

---

# 41. BRANDING

Nama sementara:

**PDFForge**

Alternatif:
- DocForge
- PaperFlow
- PDFLab
- FileForge
- PaperKit

Brand harus terasa seperti software utility profesional.

---

# 42. NAVIGATION

Desktop:

```text
Logo

Tools
Convert
Optimize
Edit
Security
OCR

----------------

History

----------------

About
API

[Sign In]
[Get Started]
```

Mobile:

```text
Logo        ☰
```

---

# 43. RESPONSIVE

WAJIB:

- Desktop
- Laptop
- Tablet
- Mobile

Upload harus nyaman di mobile.

Tool editor harus memiliki touch interaction.

---

# 44. ANIMATION

Gunakan animation secara fungsional.

Contoh:

Upload:
```text
drop → file card muncul
```

Processing:
```text
progress bar
```

Completion:
```text
subtle success animation
```

Drag pages:
```text
smooth reorder
```

Jangan membuat semua elemen bergerak.

---

# 45. DARK MODE

Support:

```text
Light
Dark
System
```

Theme preference disimpan.

---

# 46. ACCESSIBILITY

Minimal:

- keyboard navigation
- visible focus state
- semantic HTML
- aria labels
- readable contrast
- screen-reader friendly
- drag/drop memiliki alternatif keyboard

---

# 47. SEO

Public tool pages:

```text
/merge-pdf
/compress-pdf
/split-pdf
/pdf-to-jpg
/jpg-to-pdf
/ocr-pdf
/pdf-to-word
```

Setiap halaman memiliki:
- title
- description
- canonical
- Open Graph
- structured data jika relevan

---

# 48. TOOL PAGE TEMPLATE

Setiap tool menggunakan struktur:

```text
Breadcrumb

Tool Icon

H1
Tool Description

Upload Zone

↓

File Configuration

↓

Processing

↓

Result

↓

How It Works

↓

FAQ

↓

Related Tools
```

---

# 49. GRATIS UNTUK SEMUA PENGGUNA

PDFForge sepenuhnya gratis bagi semua pengguna:

- Tidak ada paket Free/Pro, subscription, paywall, atau biaya per penggunaan.
- Tidak ada kuota jumlah job, batas fitur berdasarkan akun, atau antrean berbayar.
- Semua tool yang tersedia, termasuk batch processing, OCR, fitur lanjutan, history, dan API, dapat digunakan tanpa pembayaran.
- API tidak menggunakan skema pay-per-usage; dokumentasi dan akses API mengikuti kebijakan keamanan yang sama untuk semua pengguna.
- Jangan menambahkan payment provider, billing, upgrade CTA, atau entitlement berbayar.
- Batas ukuran file, jumlah file/halaman per job, timeout, dan rate limit hanya boleh diterapkan sebagai pengaman teknis/anti-penyalahgunaan yang berlaku setara, dapat dikonfigurasi, dan disampaikan dengan jelas. Batas tersebut bukan alasan untuk menawarkan paket berbayar.

Biaya infrastruktur dan operasional ditanggung oleh operator PDFForge, bukan pengguna. Rencana kapasitas dan keberlanjutan layanan harus memperhitungkan biaya tersebut tanpa mengubah akses menjadi berbayar.

---

# 50. API PLATFORM

Future feature:

User membuat:

```text
API Key
```

Kemudian:

```http
POST /v1/jobs
Authorization: Bearer API_KEY
```

API dapat digunakan developer untuk:
- compress
- merge
- convert
- OCR
- split

---

# 51. PROJECT STRUCTURE

Backend:

```text
backend/
├── cmd/
│   └── server/
│       └── main.go
│
├── internal/
│   ├── auth/
│   ├── users/
│   ├── files/
│   ├── jobs/
│   ├── workers/
│   ├── storage/
│   ├── pdf/
│   │   ├── merge/
│   │   ├── split/
│   │   ├── compress/
│   │   ├── convert/
│   │   ├── ocr/
│   │   └── watermark/
│   ├── database/
│   ├── middleware/
│   └── config/
│
├── migrations/
├── pkg/
├── Dockerfile
├── go.mod
└── .env.example
```

Frontend:

```text
frontend/
├── app/
│   ├── page.tsx
│   ├── tools/
│   ├── dashboard/
│   ├── history/
│   └── settings/
│
├── components/
│   ├── upload/
│   ├── pdf/
│   ├── jobs/
│   ├── layout/
│   └── ui/
│
├── lib/
├── hooks/
├── types/
└── public/
```

---

# 52. ENVIRONMENT

Example:

Nilai batas upload, jumlah file/halaman, timeout, dan retensi pada contoh ini adalah default teknis untuk deployment, bukan kuota akun. Operator dapat menyesuaikannya sesuai kapasitas server, dan nilai efektif harus berlaku sama untuk semua pengguna.

```env
APP_ENV=development
PORT=8080

DATABASE_URL=postgres://...

JWT_SECRET=...

STORAGE_DRIVER=local
STORAGE_PATH=./storage

MAX_UPLOAD_SIZE_MB=100
MAX_FILES_PER_JOB=20
MAX_PAGES_PER_FILE=500

WORKER_COUNT=4
JOB_TIMEOUT_SECONDS=300

FILE_EXPIRATION_HOURS=24

QPDF_PATH=qpdf
GS_PATH=gs
LIBREOFFICE_PATH=libreoffice
TESSERACT_PATH=tesseract
```

---

# 53. LOCAL DEVELOPMENT

Karena developer baru memiliki Go + PostgreSQL, AI Agent harus membantu menyiapkan dependency yang dibutuhkan.

Jangan mengasumsikan Redis/MinIO/Docker sudah tersedia.

Untuk MVP, gunakan:

```text
Go
PostgreSQL
Local filesystem
```

Job queue dapat dibuat menggunakan PostgreSQL terlebih dahulu.

Kemudian arsitektur harus memungkinkan migrasi ke Redis/MinIO tanpa rewrite besar.

---

# 54. MVP

Prioritas MVP:

### Phase 1

1. Homepage
2. Tool directory
3. Upload system
4. File validation
5. Merge PDF
6. Split PDF
7. Compress PDF
8. PDF → JPG
9. JPG → PDF
10. Rotate PDF
11. Delete pages
12. Reorder pages
13. Download result
14. Job system
15. Progress indicator
16. PostgreSQL
17. File expiration
18. Error handling
19. Responsive UI
20. Dark mode

---

# 55. PHASE 2

Tambahkan:

- Authentication
- User dashboard
- History
- OCR
- Watermark
- Page numbers
- Metadata editor
- PDF encryption
- PDF unlock
- Word → PDF
- Excel → PDF
- PowerPoint → PDF

---

# 56. PHASE 3

Tambahkan:

- PDF editor
- Signature
- PDF comparison
- API
- API keys
- Usage analytics
- Admin panel
- Rate limiting
- advanced monitoring

---

# 57. DEFINITION OF DONE

Sebuah tool dianggap selesai jika:

- User dapat upload file.
- File tervalidasi.
- Job dibuat.
- Job masuk queue.
- Worker mengambil job.
- PDF benar-benar diproses.
- Progress diperbarui.
- Output tersimpan.
- User dapat download.
- File temporary dapat dihapus.
- Error ditangani.
- Tidak ada fake/mock result.
- Test tersedia.
- Tidak menyebabkan memory leak.
- Tidak meninggalkan temporary files setelah cleanup.
- Tidak memungkinkan path traversal.
- Tidak dapat menjalankan arbitrary command melalui filename/input.

---

# 58. TESTING

Backend wajib memiliki:

### Unit Test

Test:
- validation
- job state
- storage
- authorization
- PDF service
- filename sanitization

### Integration Test

Test:

```text
Upload
→ Database
→ Job
→ Worker
→ PDF processor
→ Output
```

### E2E

Test:

```text
User opens tool
↓
Upload PDF
↓
Configure
↓
Process
↓
Download
```

---

# 59. AI AGENT CODING RULES

AI Agent WAJIB:

1. Jangan langsung membuat seluruh aplikasi dalam satu file.
2. Jangan membuat dummy data untuk menggantikan backend.
3. Jangan membuat tombol yang belum memiliki fungsi tanpa memberi status `Coming Soon`.
4. Jangan menghapus existing functionality tanpa alasan.
5. Sebelum coding, inspect repository.
6. Gunakan existing architecture jika sudah tersedia.
7. Buat migration database.
8. Buat `.env.example`.
9. Buat README.
10. Buat automated tests.
11. Jalankan formatter.
12. Jalankan tests setelah perubahan.
13. Perbaiki error compilation sebelum melanjutkan.
14. Jangan menggunakan hardcoded secrets.
15. Jangan hardcode absolute filesystem paths.
16. Semua konfigurasi menggunakan environment variables.
17. Semua external command harus menggunakan safe arguments.
18. Semua upload harus divalidasi.
19. Semua file temporary harus mempunyai cleanup strategy.
20. Jangan menganggap proses PDF berhasil hanya karena command berhasil; validasi output.

---

# 60. DEVELOPMENT ORDER

AI Agent harus mengerjakan dalam urutan:

```text
1. Repository setup
        ↓
2. Backend Go
        ↓
3. PostgreSQL
        ↓
4. Database migrations
        ↓
5. Storage abstraction
        ↓
6. File upload
        ↓
7. Job system
        ↓
8. Worker
        ↓
9. PDF engine abstraction
        ↓
10. Merge
        ↓
11. Split
        ↓
12. Compress
        ↓
13. Convert
        ↓
14. Frontend
        ↓
15. Realtime progress
        ↓
16. Authentication
        ↓
17. History
        ↓
18. Advanced tools
        ↓
19. Security hardening
        ↓
20. Testing
        ↓
21. Documentation
```

Jangan melompat ke fitur advanced sebelum core pipeline stabil.

---

# 61. CORE ARCHITECTURE

Final architecture:

```text
                    ┌──────────────┐
                    │   Next.js    │
                    │   Frontend   │
                    └──────┬───────┘
                           │
                    HTTP / SSE
                           │
                           ▼
                    ┌──────────────┐
                    │   Go API     │
                    │              │
                    │ Auth         │
                    │ Files        │
                    │ Jobs         │
                    │ API          │
                    └──────┬───────┘
                           │
                 ┌─────────┴─────────┐
                 ▼                   ▼
          ┌─────────────┐     ┌─────────────┐
          │ PostgreSQL  │     │   Storage   │
          │             │     │             │
          │ Users       │     │ Local/S3    │
          │ Files       │     │             │
          │ Jobs        │     └─────────────┘
          └─────────────┘
                 ▲
                 │
                 ▼
          ┌─────────────┐
          │ Go Workers  │
          │             │
          │ Merge       │
          │ Split       │
          │ Compress    │
          │ Convert     │
          │ OCR         │
          └──────┬──────┘
                 │
        ┌────────┼─────────┐
        ▼        ▼         ▼
      qpdf   Ghostscript  LibreOffice
                          │
                       Tesseract
```

---

# 62. SUCCESS METRICS

MVP dianggap berhasil jika:

- Upload berhasil secara reliable.
- PDF processing tidak memblok HTTP request.
- Progress realtime bekerja.
- File hasil dapat di-download.
- Temporary file otomatis dibersihkan.
- Tidak ada critical security vulnerability.
- Tool utama dapat memproses file nyata.
- UI usable pada desktop dan mobile.
- Backend dapat menangani beberapa job bersamaan.
- Architecture memungkinkan penambahan tool baru tanpa mengubah core system.

---

# 63. FINAL INSTRUCTION TO AI AGENT

Bangun PDFForge sebagai aplikasi full-stack production-oriented.

Gunakan:

```text
Go
PostgreSQL
Next.js
TypeScript
```

Mulai dari MVP dan kerjakan secara incremental.

**Jangan membuat seluruh fitur sekaligus.**

Setiap fase harus:
1. implementasi
2. test
3. run
4. fix error
5. dokumentasi
6. lanjut ke fase berikutnya

Prioritaskan correctness, security, maintainability, performance, dan UX.

Aplikasi harus benar-benar memproses file PDF, bukan sekadar simulasi UI.

Jangan clone branding, layout, asset, atau source code iLovePDF. Gunakan konsep PDF utility platform sebagai inspirasi dan bangun desain serta implementasi original.