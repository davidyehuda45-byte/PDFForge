# PDFForge

Konverter dokumen dan alat PDF gratis untuk semua pengguna. Tidak ada paket berbayar, paywall, kuota job, atau billing API. Batas file dan waktu proses adalah pengaman teknis yang berlaku setara dan dapat diubah oleh operator.

## Jalankan di Windows

Membutuhkan Go 1.24+, Python 3.10+, dan MySQL/MariaDB **atau** PostgreSQL yang aktif, serta koneksi internet saat memasang dependensi.

```powershell
Copy-Item .env.example .env
# Pilih database di .env: DB_DRIVER=mysql (bawaan contoh) atau postgres,
# lalu samakan DB_* dengan server database Anda.
py -m pip install -r requirements.txt
go run ./cmd/server
```

PDFForge mendukung dua database dan memilihnya secara otomatis: `DATABASE_URL` yang berawalan `mysql://` atau `postgres://` menang, selain itu `DB_DRIVER` (`mysql`/`postgres`) menentukan pilihan, dan `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSLMODE` menyusun koneksinya. Aplikasi membuat tabel/index secara otomatis saat startup. Folder `storage` dibuat otomatis; isi file tetap di storage privat, sedangkan metadata sesi/job disimpan di database. Perlu membuat database kosong bernama sama dengan `DB_NAME` lebih dulu (mis. `CREATE DATABASE pdfforge;`), lalu jalankan aplikasi dari folder proyek karena `.env` dibaca otomatis saat startup (environment variable yang sudah diset di shell tetap menang).

Untuk membuat executable Go:

```powershell
go build -o pdfforge.exe ./cmd/server
.\pdfforge.exe
```

## Jalankan dengan Docker

Membutuhkan Docker Desktop aktif:

```powershell
Copy-Item .env.example .env
# Ganti POSTGRES_PASSWORD pada .env dengan password kuat.
docker compose up --build
```

Buka <http://localhost:8080>. Compose menjalankan aplikasi beserta service PostgreSQL; jika Anda memakai MySQL/MariaDB (mis. Laragon), cukup jalankan aplikasi langsung seperti pada bagian pertama tanpa Docker. PostgreSQL berjalan sebagai service Compose dan menunggu healthcheck sebelum aplikasi start. Data PostgreSQL disimpan pada volume `pdfforge-postgres`; file input/hasil pada `pdfforge-data`. Keduanya tetap ada saat container direstart. Compose mengaktifkan non-root user untuk app, membatasi CPU/RAM/proses container, dan menurunkan hak Linux container. Port PostgreSQL hanya dipublikasikan ke loopback host; hapus mapping port tersebut jika host tidak perlu mengakses database.

## Kemampuan yang tersedia

Capability registry API adalah sumber daftar format yang ditampilkan UI: `GET /api/capabilities`. File signature diperiksa dan dibandingkan dengan ekstensi sebelum diproses.

- PDF: ekstrak ke TXT/HTML/RTF/DOCX/XLSX/CSV, gabung, ambil rentang halaman, putar, optimalkan, dan render ke PNG/JPG/WEBP/TIFF. Hasil multi-halaman gambar diberikan sebagai ZIP.
- PNG/JPG/WEBP/GIF/BMP/TIFF dapat dikonversi ke PDF atau ke format gambar lain yang berbeda. **PNG → PDF dan JPG → PDF benar-benar menghasilkan PDF berhalaman dengan gambar tertanam.** Gambar multi-frame menjadi beberapa halaman PDF.
- TXT/Markdown/HTML/RTF/DOCX/ODT/EPUB dikonversi antarformat dokumen dan PDF sesuai registry runtime; XLSX/CSV/TSV dikonversi ke PDF/TXT/CSV/XLSX; PPTX/ODP diekstrak ke PDF/TXT.
- XLSX dihasilkan dengan workbook nyata. DOCX hasil ekstraksi merupakan dokumen Word valid.
- Pasangan sumber/tujuan tunggal berasal langsung dari kemampuan aktual worker dan diuji memakai berkas contoh nyata. Pasangan yang tidak terdaftar ditolak API, bukan hanya disembunyikan UI.
- Antarmuka ramah ala iLovePDF: katalog 100 alat dengan pencarian + kategori, bintang favorit dan daftar "terakhir dipakai" (disimpan di browser), serta antarmuka dua bahasa Indonesia/Inggris yang mencakup deskripsi alat.
- Penyusun halaman visual: pratinjau thumbnail halaman PDF, susun ulang dengan drag & drop atau klik-tukar, sembunyikan halaman, balik urutan — hasilnya dikirim sebagai `page_order` (halaman yang dipertahankan, urutan visual).
- Proses berjalan menampilkan estimasi waktu dan tombol Batalkan. Job yang dibatalkan (antre maupun berjalan) berhenti tanpa hasil parsial; berkas di daftar unggahan tetap ada sehingga pengguna bisa mencoba lagi tanpa mengunggah ulang.
- Konversi dokumen Office berbasis ekstraksi teks adalah best-effort; tata letak, tabel, grafik, animasi, font, formula, dan format kompleks tidak dijanjikan identik. UI menjelaskan peringatan kualitas sebelum konversi.
- HTML→PDF tidak ditawarkan karena deployment ini belum mengaktifkan browser renderer yang menjaga CSS/layout; HTML→PDF berbasis ekstraksi teks tidak disamarkan sebagai render dokumen yang benar.
- File sumber segera dihapus setelah job selesai atau gagal; hasil dapat dihapus lebih awal dari tombol **Hapus** atau dihapus otomatis setelah waktu retensi. Setiap job, riwayat, dan unduhan diikat ke cookie sesi browser acak (`HttpOnly`, `SameSite=Strict`); hanya hash sesi disimpan di database (MySQL/MariaDB atau PostgreSQL). Riwayat dan sesi bertahan setelah restart. Job yang sedang berjalan ketika server berhenti ditandai gagal saat startup dan file sementaranya dibersihkan.

Format/fitur hanya ditawarkan ketika konverter yang sesuai benar-benar tersedia. Konversi antarformat yang tidak tercantum pada `/api/capabilities` tidak didukung; legacy DOC/XLS/PPT, OCR, tanda tangan, pengeditan visual PDF, dan akun pengguna belum diimplementasikan.

## API

- `GET /api/health` — kesehatan runtime konversi.
- `GET /api/capabilities` — format/pasangan konversi aktif dan batas teknis.
- `POST /api/jobs` — unggah multipart `files`, `target`, opsional `operation` (`merge`, `split`, `rotate`, `compress`), `page_range`, dan `quality`; mengembalikan ID job.
- `GET /api/jobs/{id}` — status/progres dan metadata hasil.
- `POST /api/jobs/{id}/cancel` — batalkan job milik sesi ini (antre maupun berjalan); status menjadi `cancelled`.
- `POST /api/preview` — render thumbnail halaman PDF untuk penyusun halaman (multipart `file`, opsional `pages` maks 120 dan `width` 40–480); mengembalikan JPEG base64 per halaman.
- `GET /api/jobs/{id}/download` — hasil tunggal atau semua hasil sebagai ZIP.
- `GET /api/history` — riwayat job milik sesi browser saat ini yang dibaca dari database.

Pembuatan job asynchronous; worker dibatasi oleh `WORKER_COUNT`, batas job aktif/antrean per sesi, limit request per IP, timeout dan batas ukuran output per file/job. Penyimpanan berada di luar web root dengan permission terbatas, akses memerlukan sesi pemilik, unduhan selalu attachment, dan API mengirim `Cache-Control: no-store`. Mutasi memeriksa `Origin`/Fetch Metadata; tidak ada CORS wildcard. Jika `CLAMDSCAN` diatur ke executable `clamdscan` yang tersedia, setiap upload dipindai sebelum dikonversi dan proses gagal tertutup jika scanner error. Nilai kosong berarti pemindaian tidak aktif. `TRUST_PROXY=true` hanya boleh dipakai jika server hanya dapat dijangkau melalui reverse proxy tepercaya yang menyediakan TLS, overwrite `X-Forwarded-Proto` dan `X-Real-IP`, serta menambahkan HSTS.

**Batas keamanan yang diketahui:** aplikasi belum memiliki akun/password atau perlindungan WAF. Pemindaian antivirus opsional dan nonaktif secara default; bila `CLAMDSCAN` tidak dikonfigurasi, file tidak dipindai. Worker tidak berjalan dalam sandbox terpisah saat dijalankan langsung di Windows. File diproses hanya oleh mesin lokal aplikasi dan tidak dikirim untuk pelatihan AI. Docker Compose menjalankan container non-root dengan pembatasan CPU/RAM/proses, tetapi bukan jaminan sandbox sempurna. Gunakan password database yang kuat; `.env` tidak boleh di-commit atau dibagikan. Jangan mempublikasikan server langsung ke internet atau memproses dokumen yang mensyaratkan isolasi/scan khusus tanpa menambahkan kontrol operasional yang sesuai.

## Batasan teknis default

| Pengaturan | Default |
|---|---:|
| Maksimum ukuran satu file | 100 MB |
| Maksimum ukuran satu hasil | 300 MB |
| Maksimum ukuran gabungan hasil satu job | 600 MB |
| Maksimum file per job | 20 |
| Maksimum job aktif per sesi | 3 |
| Maksimum antrean job per sesi | 20 |
| Maksimum job sementara yang dilacak server | 100.000 |
| Maksimum halaman per PDF/hasil | 500 |
| Maksimum piksel per gambar | 50 juta |
| Maksimum total piksel gambar per job | 100 juta |
| Maksimum ukuran dokumen ZIP setelah diekstrak | 512 MB |
| Timeout satu konversi | 300 detik |
| Retensi file | 24 jam |
| Worker serentak | 2 |
| Rate limit upload | 10 job/menit per IP |

Nilai dapat diubah melalui environment variables. Tidak ada jatah penggunaan berdasarkan pengguna atau tingkatan layanan.

## Pengujian

```powershell
go test ./...
python -m unittest discover -s worker -p "test_*.py"
node tests/ui-smoke.mjs   # tes UI peramban headless (mandiri, tanpa server; lihat tests/README.md)
```
