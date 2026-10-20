# Tes PDFForge

## Tes UI otomatis (`ui-smoke.mjs`)

Skrip mandiri (tanpa dependensi npm) yang menjalankan antarmuka PDFForge di
peramban headless dan memeriksa fitur-fitur baru:

- katalog 100 alat dirender penuh;
- favorit (bintang) tersimpan di `localStorage` dan muncul di baris favorit;
- memilih alat menyetel workbench + menyimpan "terakhir dipakai";
- unggah berkas PDF (via `DataTransfer`) menampilkan berkas + tombol Susun halaman;
- penyusun halaman: pratinjau 3 halaman, hapus halaman ke-2, terapkan → `page_order=1,3`;
- proses berjalan menampilkan estimasi waktu (ETA) dan tombol Batalkan;
- batalkan proses → panel hilang, berkas tetap ada, tanpa kartu hasil palsu;
- formulir proses memuat `files`, `target`, `operation`, `page_order`;
- ganti bahasa ke Inggris (EN) menerjemahkan tab, deskripsi alat, dan label opsi dinamis;
- tidak ada error JavaScript di halaman.

### Cara menjalankan

```bat
node tests/ui-smoke.mjs
```

Semua panggilan API (`/api/*`) dipalsukan di dalam peramban (stub `fetch`),
jadi tes TIDAK membutuhkan server PDFForge, database, maupun Python — hanya
peramban (Edge/Chrome) yang terpasang.

### Opsi lingkungan

| Variabel | Arti | Default |
| --- | --- | --- |
| `SMOKE_PORT` | Port server statis untuk folder `web/` | `8137` |
| `SMOKE_CDP_PORT` | Port debug peramban (CDP) | `9701` |
| `CHROME_PATH` | Lokasi `msedge.exe` / `chrome.exe` bila tidak standar | dicari otomatis |

Kode keluar `0` = semua pemeriksaan lulus, `1` = ada yang gagal (ringkasan
`✓`/`✗` tercetak di konsol).

## Uji API end-to-end (manual, di luar repo)

Skrip `api_test.py` (driver Python + server uji nyata + PostgreSQL sementara)
dipakai untuk menguji endpoint `/api/preview`, `/api/jobs/{id}/cancel`, dan
organize `page_order` terhadap server sungguhan. Letaknya di folder kerja
sementara, bukan di dalam repo ini.
