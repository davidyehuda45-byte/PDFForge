// PDFForge Portal - 100 Complete Features Engine
(function () {
  "use strict";

  const tr = (text, vars) => (window.PDFForgeT ? window.PDFForgeT(text, vars) : text);
  const loadIds = (key) => { try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; } };
  const saveIds = (key, list) => { try { localStorage.setItem(key, JSON.stringify(list)); } catch { /* private mode */ } };
  let favorites = loadIds("pdfforge_favorites");
  let recentTools = loadIds("pdfforge_recent_tools");

  const TOOLS_100 = [
    // 1-9: Organisasi PDF
    { id: 1, name: "Merge PDF", nameEn: "Merge PDF", cat: "organize", desc: "Gabungkan beberapa berkas PDF menjadi satu dokumen berurutan.", op: "merge", target: "pdf", badge: "Batch" },
    { id: 2, name: "Split PDF", nameEn: "Split PDF", cat: "organize", desc: "Pisahkan halaman terpilih dari berkas PDF menjadi file baru.", op: "split", target: "pdf", badge: "Presisi" },
    { id: 3, name: "Smart Split PDF", nameEn: "Smart Split PDF", cat: "organize", desc: "Pecah PDF otomatis per bab, penanda buku, atau ukuran tertentu (ZIP).", op: "smart_split", target: "zip", badge: "Smart" },
    { id: 4, name: "Organize PDF", nameEn: "Organize PDF", cat: "organize", desc: "Atur, hapus, dan rapikan tata letak halaman dokumen secara menyeluruh.", op: "organize", target: "pdf", badge: "Alat" },
    { id: 5, name: "Reorder Pages", nameEn: "Reorder Pages", cat: "organize", desc: "Susun ulang urutan halaman PDF sesuai instruksi indeks yang Anda pilih.", op: "reorder", target: "pdf", badge: "Cepat" },
    { id: 6, name: "Remove Pages", nameEn: "Remove Pages", cat: "organize", desc: "Hapus halaman tidak diinginkan secara permanen tanpa merusak file.", op: "remove_pages", target: "pdf", badge: "Instan" },
    { id: 7, name: "Rotate PDF", nameEn: "Rotate PDF", cat: "organize", desc: "Putar arah halaman 90°, 180°, atau 270° agar mudah dibaca.", op: "rotate", target: "pdf", badge: "Instan" },
    { id: 8, name: "Crop PDF", nameEn: "Crop PDF", cat: "organize", desc: "Pangkas margin atau tepi halaman PDF ke rasio yang diinginkan.", op: "crop", target: "pdf", badge: "Presisi" },
    { id: 9, name: "Add Page Numbers", nameEn: "Add Page Numbers", cat: "organize", desc: "Bubuhi nomor halaman otomatis di bagian bawah atau atas lembar kerja.", op: "page_numbers", target: "pdf", badge: "Otomatis" },

    // 10-13: Kompresi & Optimasi
    { id: 10, name: "Compress PDF", nameEn: "Compress PDF", cat: "compress", desc: "Perkecil ukuran file PDF secara signifikan tanpa merusak keterbacaan teks.", op: "compress", target: "pdf", badge: "Hemat" },
    { id: 11, name: "Repair PDF", nameEn: "Repair PDF", cat: "compress", desc: "Perbaiki struktur internal PDF yang rusak, korup, atau gagal dibuka pembaca.", op: "repair", target: "pdf", badge: "Pemulihan" },
    { id: 12, name: "PDF → PDF/A", nameEn: "PDF to PDF/A", cat: "compress", desc: "Konversi ke format arsip standar ISO PDF/A untuk kepatuhan jangka panjang.", op: "pdf_to_pdfa", target: "pdf", badge: "Arsip" },
    { id: 13, name: "Validate PDF/A", nameEn: "Validate PDF/A", cat: "compress", desc: "Validasi kepatuhan spesifikasi format arsip PDF/A dan dapatkan laporannya.", op: "validate_pdfa", target: "json", badge: "Audit" },

    // 14-29: Konversi
    { id: 14, name: "PDF → Word", nameEn: "PDF to Word", cat: "convert", desc: "Ubah dokumen PDF menjadi file Microsoft Word (.docx) yang dapat disunting.", op: "convert", target: "docx", badge: "Populer" },
    { id: 15, name: "PDF → Word OCR", nameEn: "PDF to Word OCR", cat: "convert", desc: "Ekstrak teks dari pindaian PDF ke Word (.docx) dengan pengenalan OCR.", op: "ocr_to_word", target: "docx", badge: "OCR" },
    { id: 16, name: "PDF → Excel", nameEn: "PDF to Excel", cat: "convert", desc: "Ekstrak tabel dan data tabular dari PDF ke lembar kerja Excel (.xlsx).", op: "pdf_to_excel", target: "xlsx", badge: "Tabel" },
    { id: 17, name: "PDF → Excel OCR", nameEn: "PDF to Excel OCR", cat: "convert", desc: "Konversi tabel dari PDF hasil scan gambar ke Excel (.xlsx) lewat OCR.", op: "ocr_to_excel", target: "xlsx", badge: "OCR" },
    { id: 18, name: "PDF → PowerPoint", nameEn: "PDF to PowerPoint", cat: "convert", desc: "Ubah setiap halaman lembar PDF menjadi slide presentasi PPTX otomatis.", op: "convert", target: "pptx", badge: "Slide" },
    { id: 19, name: "PDF → JPG", nameEn: "PDF to JPG", cat: "convert", desc: "Ekstrak halaman PDF menjadi gambar berkualitas JPG untuk kebutuhan web.", op: "convert", target: "jpg", badge: "Gambar" },
    { id: 20, name: "PDF → PNG", nameEn: "PDF to PNG", cat: "convert", desc: "Konversi halaman PDF menjadi gambar resolusi tinggi format PNG tanpa kompresi.", op: "convert", target: "png", badge: "HD" },
    { id: 21, name: "Word → PDF", nameEn: "Word to PDF", cat: "convert", desc: "Konversi dokumen Microsoft Word (.docx, .doc) ke dokumen PDF standar.", op: "convert", target: "pdf", badge: "Office" },
    { id: 22, name: "Excel → PDF", nameEn: "Excel to PDF", cat: "convert", desc: "Simpan file spreadsheet Excel (.xlsx, .csv, .tsv) ke format PDF rapi.", op: "convert", target: "pdf", badge: "Office" },
    { id: 23, name: "PowerPoint → PDF", nameEn: "PowerPoint to PDF", cat: "convert", desc: "Ubah presentasi PPTX atau PPT menjadi dokumen PDF siap cetak.", op: "convert", target: "pdf", badge: "Office" },
    { id: 24, name: "JPG/Image → PDF", nameEn: "Image to PDF", cat: "convert", desc: "Gabungkan atau konversi gambar PNG, JPG, WEBP, TIFF ke berkas PDF.", op: "convert", target: "pdf", badge: "Visual" },
    { id: 25, name: "HTML/Web → PDF", nameEn: "HTML to PDF", cat: "convert", desc: "Ubah halaman web HTML dan kode markup menjadi tata letak dokumen PDF.", op: "convert", target: "pdf", badge: "Web" },
    { id: 26, name: "PDF → Markdown", nameEn: "PDF to Markdown", cat: "convert", desc: "Ubah isi konten dokumen PDF menjadi format Markdown (.md) yang bersih.", op: "convert", target: "md", badge: "Dev" },
    { id: 27, name: "PDF Data Extract → JSON", nameEn: "PDF Extract JSON", cat: "convert", desc: "Ekstrak seluruh teks, metadata, dan struktur PDF ke representasi data JSON.", op: "convert", target: "json", badge: "API" },
    { id: 28, name: "PDF Data Extract → XML", nameEn: "PDF Extract XML", cat: "convert", desc: "Ekstrak informasi dokumen PDF menjadi pohon elemen XML terstruktur.", op: "convert", target: "xml", badge: "Data" },
    { id: 29, name: "PDF Data Extract → CSV", nameEn: "PDF Extract CSV", cat: "convert", desc: "Ekstrak isi teks dan baris tabel dokumen langsung ke file CSV.", op: "convert", target: "csv", badge: "Tabel" },

    // 30-43: Editing
    { id: 30, name: "Edit PDF", nameEn: "Edit PDF", cat: "edit", desc: "Sunting isi dokumen, sisipkan catatan atau perbarui tata letak halaman PDF.", op: "edit_pdf", target: "pdf", badge: "Editor" },
    { id: 31, name: "Add Text", nameEn: "Add Text", cat: "edit", desc: "Sisipkan teks tambahan dengan font, ukuran, dan posisi yang ditentukan.", op: "add_text", target: "pdf", badge: "Teks" },
    { id: 32, name: "Add Image", nameEn: "Add Image", cat: "edit", desc: "Tambahkan gambar, stempel, atau logo visual ke dalam halaman PDF.", op: "add_image", target: "pdf", badge: "Visual" },
    { id: 33, name: "Add Shapes", nameEn: "Add Shapes", cat: "edit", desc: "Gambar bentuk geometris seperti kotak, lingkaran, atau garis pembatas.", op: "add_shapes", target: "pdf", badge: "Bentuk" },
    { id: 34, name: "Add Annotations", nameEn: "Add Annotations", cat: "edit", desc: "Berikan anotasi, catatan tempel, dan komentar pada halaman dokumen.", op: "add_annotations", target: "pdf", badge: "Catatan" },
    { id: 35, name: "Highlight", nameEn: "Highlight Text", cat: "edit", desc: "Sorot kalimat atau kata kunci penting dengan penanda warna transparan.", op: "highlight", target: "pdf", badge: "Sorot" },
    { id: 36, name: "Draw", nameEn: "Freehand Draw", cat: "edit", desc: "Buat coretan bebas, tanda tangan manual, atau sketsa di atas PDF.", op: "draw", target: "pdf", badge: "Kuas" },
    { id: 37, name: "Edit font/size/color", nameEn: "Font & Color Tool", cat: "edit", desc: "Konfigurasi tipografi: ukuran font, warna teks RGB, dan tata letak.", op: "add_text", target: "pdf", badge: "Gaya" },
    { id: 38, name: "PDF Forms", nameEn: "PDF Forms Hub", cat: "edit", desc: "Pusat pengelolaan formulir interaktif dan isian data digital PDF.", op: "create_form", target: "pdf", badge: "Formulir" },
    { id: 39, name: "Create Fillable Form", nameEn: "Create Fillable Form", cat: "edit", desc: "Buat kolom formulir digital yang dapat diketik langsung oleh pengguna.", op: "create_form", target: "pdf", badge: "Buat" },
    { id: 40, name: "Fill Form", nameEn: "Fill Form", cat: "edit", desc: "Isi data formulir PDF otomatis atau manual tanpa mencetak kertas.", op: "fill_form", target: "pdf", badge: "Isi" },
    { id: 41, name: "Checkbox/Form fields", nameEn: "Checkbox Fields", cat: "edit", desc: "Sisipkan elemen kotak centang interaktif pada kuesioner PDF Anda.", op: "create_form", target: "pdf", badge: "Field" },
    { id: 42, name: "Multiple Choice", nameEn: "Radio Buttons", cat: "edit", desc: "Tambahkan opsi tombol radio pilihan ganda pada formulir digital.", op: "create_form", target: "pdf", badge: "Pilihan" },
    { id: 43, name: "Dropdown/List", nameEn: "Dropdown Selector", cat: "edit", desc: "Tambahkan kotak menu pilihan dropdown interaktif pada halaman PDF.", op: "create_form", target: "pdf", badge: "Menu" },

    // 44-48: OCR & Scanning
    { id: 44, name: "OCR PDF", nameEn: "OCR PDF", cat: "ocr", desc: "Pindai dan kenali karakter optik dari dokumen gambar atau scan PDF.", op: "ocr_pdf", target: "pdf", badge: "OCR" },
    { id: 45, name: "Scan → PDF", nameEn: "Scan to PDF", cat: "ocr", desc: "Ubah foto dokumen dari scanner atau kamera ponsel menjadi PDF jernih.", op: "convert", target: "pdf", badge: "Kamera" },
    { id: 46, name: "OCR → searchable PDF", nameEn: "Searchable PDF", cat: "ocr", desc: "Sisipkan lapisan teks tak terlihat agar PDF hasil scan dapat dicari (Ctrl+F).", op: "ocr_pdf", target: "pdf", badge: "Cari" },
    { id: 47, name: "OCR → editable Word", nameEn: "OCR to Word", cat: "ocr", desc: "Ekstrak dokumen hasil pindaian gambar langsung ke Microsoft Word berformat.", op: "ocr_to_word", target: "docx", badge: "Word" },
    { id: 48, name: "OCR → editable Excel", nameEn: "OCR to Excel", cat: "ocr", desc: "Kenali angka dan tabel dari lembar pindaian ke spreadsheet Excel (.xlsx).", op: "ocr_to_excel", target: "xlsx", badge: "Excel" },

    // 49-58: Keamanan
    { id: 49, name: "Protect PDF", nameEn: "Protect PDF", cat: "security", desc: "Kunci PDF dengan kata sandi kuat AES-256 untuk membatasi akses rahasia.", op: "protect", target: "pdf", badge: "Enkripsi" },
    { id: 50, name: "Unlock PDF", nameEn: "Unlock PDF", cat: "security", desc: "Buka kata sandi pemilik PDF resmi agar berkas dapat diedit atau dicetak.", op: "unlock", target: "pdf", badge: "Buka" },
    { id: 51, name: "Password encryption", nameEn: "Password Encryption", cat: "security", desc: "Enkripsi berkas menggunakan algoritma kriptografi berstandar militer.", op: "protect", target: "pdf", badge: "Ketat" },
    { id: 52, name: "Redact PDF", nameEn: "Redact PDF", cat: "security", desc: "Sensor informasi sensitif (NIK, kartu kredit, nama) secara visual & data.", op: "redact", target: "pdf", badge: "Sensor" },
    { id: 53, name: "Permanent removal", nameEn: "Permanent Info Removal", cat: "security", desc: "Hapus teks dan metadata tersembunyi hingga tidak dapat dipulihkan.", op: "permanent_remove", target: "pdf", badge: "Aman" },
    { id: 54, name: "Digital Signature", nameEn: "Digital Signature", cat: "security", desc: "Bubuhi tanda tangan digital kriptografis terverifikasi dengan timestamp.", op: "digital_sign", target: "pdf", badge: "Valid" },
    { id: 55, name: "Signature Request", nameEn: "Signature Request", cat: "security", desc: "Kirim undangan penandatanganan dokumen digital kepada pihak mitra.", op: "signature_request", target: "pdf", badge: "Kolaborasi" },
    { id: 56, name: "Signature management", nameEn: "Signature Hub", cat: "security", desc: "Verifikasi keaslian tanda tangan digital dan validasi sertifikat.", op: "modal_signatures", target: "json", badge: "Kelola" },
    { id: 57, name: "Audit Trail", nameEn: "Audit Trail", cat: "security", desc: "Dapatkan log jejak audit lengkap berisi riwayat akses dan verifikasi hash.", op: "audit_trail", target: "json", badge: "Log" },
    { id: 58, name: "Signed custody", nameEn: "Custody Archive", cat: "security", desc: "Simpan arsip rantai pengawasan integritas dokumen yang telah ditandatangani.", op: "digital_sign", target: "pdf", badge: "Integritas" },

    // 59-64: Watermark
    { id: 59, name: "Text Watermark", nameEn: "Text Watermark", cat: "watermark", desc: "Bubuhi tanda air teks seperti 'RAHASIA', 'DRAFT', atau nama perusahaan Anda.", op: "text_watermark", target: "pdf", badge: "Teks" },
    { id: 60, name: "Image/Logo Watermark", nameEn: "Logo Watermark", cat: "watermark", desc: "Pasang logo atau stempel transparan pada seluruh lembar kerja dokumen.", op: "image_watermark", target: "pdf", badge: "Logo" },
    { id: 61, name: "Custom typography", nameEn: "Watermark Typography", cat: "watermark", desc: "Atur rotasi sudut 45°, ukuran font proporsional, dan gaya tulisan watermark.", op: "text_watermark", target: "pdf", badge: "Gaya" },
    { id: 62, name: "Transparency", nameEn: "Watermark Opacity", cat: "watermark", desc: "Sesuaikan tingkat transparansi (opacity) agar teks dokumen tetap terbaca.", op: "text_watermark", target: "pdf", badge: "Transparan" },
    { id: 63, name: "Positioning", nameEn: "Watermark Position", cat: "watermark", desc: "Pilih posisi watermark: tengah halaman, sudut kanan atas, atau ubin (tiled).", op: "text_watermark", target: "pdf", badge: "Posisi" },
    { id: 64, name: "Batch Watermark", nameEn: "Batch Watermark", cat: "watermark", desc: "Terapkan tanda air ke puluhan dokumen PDF sekaligus dalam sekali klik.", op: "text_watermark", target: "pdf", badge: "Batch" },

    // 65-70: Analisis & AI
    { id: 65, name: "Compare PDF", nameEn: "Compare PDF", cat: "ai", desc: "Bandingkan 2 dokumen PDF dan temukan perbedaan teks maupun tata letak.", op: "compare_pdf", target: "json", badge: "Banding" },
    { id: 66, name: "AI Summarizer", nameEn: "AI Summarizer", cat: "ai", desc: "Ringkas ratusan halaman dokumen PDF menjadi poin-poin penting dalam detik.", op: "ai_summarize", target: "md", badge: "AI" },
    { id: 67, name: "AI PDF Translation", nameEn: "AI PDF Translate", cat: "ai", desc: "Terjemahkan isi dokumen ke Bahasa Indonesia, Inggris, atau bahasa lainnya.", op: "ai_translate", target: "pdf", badge: "AI" },
    { id: 68, name: "PDF Data Extraction", nameEn: "AI Data Extraction", cat: "ai", desc: "Ekstrak otomatis entitas data seperti total biaya, tanggal, dan nama invoice.", op: "ai_extract_data", target: "json", badge: "Ekstraksi" },
    { id: 69, name: "Smart Split AI", nameEn: "AI Smart Split", cat: "ai", desc: "Pecah dokumen otomatis mendeteksi perpindahan topik dan bab cerdas.", op: "ai_smart_split", target: "zip", badge: "Cerdas" },
    { id: 70, name: "PDF → MD untuk LLM", nameEn: "PDF to LLM Markdown", cat: "ai", desc: "Konversi PDF ke format Markdown terstruktur yang optimal untuk konteks LLM.", op: "pdf_to_llm_md", target: "md", badge: "LLM" },

    // 71-83: Workflow & Produktivitas
    { id: 71, name: "Custom Workflow", nameEn: "Custom Workflow", cat: "workflow", desc: "Rancang alur kerja multi-tahap (Kompres → Watermark → Lindungi PDF).", op: "modal_workflow", target: "pdf", badge: "Alur" },
    { id: 72, name: "Workflow automation", nameEn: "Workflow Automation", cat: "workflow", desc: "Jalankan otomatisasi proses pengolahan dokumen tanpa intervensi manual.", op: "workflow", target: "pdf", badge: "Otomatis" },
    { id: 73, name: "Reusable Workflow", nameEn: "Saved Pipelines", cat: "workflow", desc: "Simpan template alur kerja favorit untuk digunakan kembali kapan saja.", op: "modal_workflow", target: "pdf", badge: "Template" },
    { id: 74, name: "Batch processing", nameEn: "Batch Processing", cat: "workflow", desc: "Proses hingga 20 dokumen secara paralel dengan performa server tinggi.", op: "convert", target: "pdf", badge: "Multi" },
    { id: 75, name: "Drag & Drop", nameEn: "Drag and Drop", cat: "workflow", desc: "Tarik dan letakkan file langsung dari desktop ke area kerja aplikasi.", op: "action_dropzone", target: "pdf", badge: "UI" },
    { id: 76, name: "File sorting", nameEn: "File Reordering", cat: "workflow", desc: "Urutkan daftar berkas unggahan berdasarkan nama, ukuran, atau urutan klik.", op: "action_sort", target: "pdf", badge: "Sort" },
    { id: 77, name: "Multi-file processing", nameEn: "Parallel Engine", cat: "workflow", desc: "Engine antrean memproses beberapa berkas secara asinkronus dan aman.", op: "convert", target: "pdf", badge: "Worker" },
    { id: 78, name: "Google Drive integration", nameEn: "Google Drive", cat: "workflow", desc: "Impor dokumen langsung dari Google Drive Anda dengan aman.", op: "modal_cloud", target: "pdf", badge: "Cloud" },
    { id: 79, name: "Dropbox integration", nameEn: "Dropbox", cat: "workflow", desc: "Ambil file dari akun Dropbox Anda langsung ke proses konversi.", op: "modal_cloud", target: "pdf", badge: "Cloud" },
    { id: 80, name: "Cloud import/export", nameEn: "Cloud Storage Hub", cat: "workflow", desc: "Hubungkan penyimpanan awan untuk pertukaran dokumen dua arah.", op: "modal_cloud", target: "pdf", badge: "Konektor" },
    { id: 81, name: "Download hasil", nameEn: "Instant Download", cat: "workflow", desc: "Unduh file hasil pemrosesan secara instan langsung dari peramban.", op: "action_history", target: "pdf", badge: "Unduh" },
    { id: 82, name: "ZIP hasil batch", nameEn: "ZIP Batch Export", cat: "workflow", desc: "Otomatis kemas semua file hasil konversi banyak dokumen dalam 1 arsip ZIP.", op: "smart_split", target: "zip", badge: "ZIP" },
    { id: 83, name: "Processing history", nameEn: "Session History", cat: "workflow", desc: "Lihat daftar riwayat pekerjaan aktif di sesi Anda dengan privasi terlindungi.", op: "action_history", target: "pdf", badge: "Riwayat" },

    // 84-100: Platform & Sistem
    { id: 84, name: "Web App", nameEn: "Web Platform", cat: "platform", desc: "Aplikasi berbasis web modern, responsif, dan ringan tanpa install plugin.", op: "info_webapp", target: "pdf", badge: "PWA" },
    { id: 85, name: "Desktop App", nameEn: "Desktop Offline", cat: "platform", desc: "Dukungan pengoperasian lokal di Windows, macOS, dan Linux tanpa internet.", op: "info_desktop", target: "pdf", badge: "Desktop" },
    { id: 86, name: "Mobile App", nameEn: "Mobile Responsive", cat: "platform", desc: "Tampilan responsif penuh di layar ponsel pintar Android dan iOS.", op: "info_mobile", target: "pdf", badge: "Mobile" },
    { id: 87, name: "Offline processing", nameEn: "Offline Processing", cat: "platform", desc: "Pemrosesan privat langsung di server tanpa transmisi data ke pihak ketiga.", op: "info_offline", target: "pdf", badge: "Privat" },
    { id: 88, name: "PDF Reader", nameEn: "In-Browser PDF Reader", cat: "platform", desc: "Baca dan pratinjau dokumen PDF langsung di dalam peramban web Anda.", op: "modal_reader", target: "pdf", badge: "Pratinjau" },
    { id: 89, name: "Right-click conversion", nameEn: "Context Shortcuts", cat: "platform", desc: "Akses pintasan operasi cepat dengan klik kanan pada file yang diunggah.", op: "action_dropzone", target: "pdf", badge: "Pintasan" },
    { id: 90, name: "Multi-language UI", nameEn: "Multi-Language UI", cat: "platform", desc: "Dukungan penuh dua bahasa: Bahasa Indonesia dan English dengan 1 klik.", op: "action_toggle_lang", target: "pdf", badge: "ID/EN" },
    { id: 91, name: "Account system", nameEn: "Account & Keys", cat: "platform", desc: "Sistem akun opsional dan API Bearer Tokens untuk pengembang software.", op: "modal_account", target: "json", badge: "Akun" },
    { id: 92, name: "Team/workspace", nameEn: "Team Workspace", cat: "platform", desc: "Ruang kerja kolaborasi tim untuk berbagi pipeline pemrosesan dokumen.", op: "modal_workspace", target: "json", badge: "Tim" },
    { id: 93, name: "Role & permissions", nameEn: "Roles & RBAC", cat: "platform", desc: "Atur hak akses pengguna: Viewer, Editor, Administrator secara aman.", op: "modal_workspace", target: "json", badge: "Akses" },
    { id: 94, name: "Admin dashboard", nameEn: "Admin Dashboard", cat: "platform", desc: "Pantau kesehatan sistem, jumlah konversi, dan performa server secara langsung.", op: "modal_admin", target: "json", badge: "Admin" },
    { id: 95, name: "Usage statistics", nameEn: "Usage Statistics", cat: "platform", desc: "Analitik penggunaan fitur terpopuler dan penghematan bandwidth storage.", op: "modal_stats", target: "json", badge: "Statistik" },
    { id: 96, name: "File-size limits", nameEn: "Limits & Quotas", cat: "platform", desc: "Konfigurasi batas ukuran upload hingga 100 MB dan 500 halaman per berkas.", op: "info_limits", target: "pdf", badge: "Batas" },
    { id: 97, name: "AI credits", nameEn: "AI Credits Balance", cat: "platform", desc: "Informasi kuota token dan kredit pemrosesan model kecerdasan buatan.", op: "modal_credits", target: "json", badge: "Kredit" },
    { id: 98, name: "Regional processing", nameEn: "Regional Residency", cat: "platform", desc: "Penyimpanan data lokal menjamin kedaulatan data dan regulasi privasi.", op: "info_offline", target: "pdf", badge: "Lokal" },
    { id: 99, name: "SSO (Single Sign-On)", nameEn: "SSO Enterprise", cat: "platform", desc: "Integrasi masuk tunggal dengan Google, Microsoft, atau SAML perusahaan.", op: "modal_sso", target: "json", badge: "SSO" },
    { id: 100, name: "API-ready architecture", nameEn: "OpenAPI Documentation", cat: "platform", desc: "Arsitektur REST API lengkap dengan dokumentasi interaktif Swagger/OpenAPI.", op: "modal_api_docs", target: "json", badge: "API v2" }
  ];

  // Nama alat berbahasa Indonesia yang lebih mudah dipahami (pengganti nama Inggris default).
  const ID_NAME = {
    1: "Gabung PDF", 2: "Pisah PDF", 3: "Pisah PDF Otomatis",
    4: "Atur Halaman", 5: "Susun Ulang Halaman", 6: "Hapus Halaman", 7: "Putar Halaman", 8: "Pangkas Halaman",
    9: "Tambah Nomor Halaman", 10: "Perkecil Ukuran PDF", 11: "Perbaiki PDF", 14: "PDF → Word", 18: "PDF → PowerPoint",
    19: "PDF → JPG", 20: "PDF → PNG", 25: "HTML → PDF", 26: "PDF → Markdown", 27: "PDF → JSON", 28: "PDF → XML",
    29: "PDF → CSV", 30: "Sunting PDF", 31: "Tambah Teks", 32: "Tambah Gambar", 33: "Tambah Bentuk",
    34: "Tambah Catatan", 35: "Sorot Teks", 36: "Coret Bebas", 37: "Atur Font & Warna", 38: "Pusat Formulir",
    39: "Buat Kolom Isian", 40: "Isi Formulir", 41: "Tambah Kotak Centang", 42: "Tambah Pilihan Ganda",
    43: "Tambah Menu Dropdown", 45: "Scan → PDF", 46: "PDF → PDF Bisa Dicari", 47: "Scan → Word (OCR)",
    48: "Scan → Excel (OCR)", 49: "Kunci PDF", 50: "Buka Kunci PDF", 51: "Enkripsi Kata Sandi",
    52: "Sensor Data (Redact)", 53: "Hapus Metadata Permanen", 54: "Tanda Tangan Digital",
    55: "Minta Tanda Tangan", 56: "Kelola Tanda Tangan", 57: "Jejak Audit", 58: "Arsip Bukti Integritas",
    59: "Watermark Teks", 60: "Watermark Logo", 61: "Gaya Teks Watermark", 62: "Atur Transparansi",
    63: "Atur Posisi Watermark", 64: "Watermark Banyak Berkas", 65: "Bandingkan 2 PDF", 66: "Ringkasan Otomatis",
    67: "Terjemahan Otomatis", 68: "Ekstrak Data Otomatis", 69: "Pisah Otomatis (AI)", 71: "Alur Kerja Kustom",
    72: "Otomatisasi Alur Kerja", 73: "Simpan Alur Favorit", 74: "Proses Banyak Berkas", 75: "Tarik & Letakkan",
    76: "Urutkan Berkas", 77: "Proses Pararel", 78: "Google Drive", 79: "Dropbox", 80: "Impor dari Cloud",
    81: "Unduh Hasil", 82: "ZIP Hasil Banyak Berkas", 83: "Riwayat Proses", 84: "Aplikasi Web",
    85: "Aplikasi Desktop", 86: "Tampilan Ponsel", 87: "Proses Offline", 88: "Pembaca PDF",
    89: "Menu Klik Kanan", 90: "Dua Bahasa (ID/EN)", 91: "Akun & Token API", 92: "Ruang Kerja Tim",
    93: "Peran & Izin", 94: "Dasbor Admin", 95: "Statistik Penggunaan", 96: "Batas Ukuran & Halaman",
    97: "Kredit AI", 98: "Data Disimpan Lokal", 99: "Masuk Tunggal (SSO)", 100: "Dokumentasi API"
  };
  TOOLS_100.forEach(tool => { if (ID_NAME[tool.id]) tool.name = ID_NAME[tool.id]; });

  let currentLang = localStorage.getItem("pdfforge_lang") || "id";
  let activeCategory = "all";

  // Expose tools catalog globally
  window.PDF_TOOLS_100 = TOOLS_100;

  var OPEN = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">';
  var CLOSE = '</svg>';
  var MAGNIFIER = OPEN + '<circle cx="11" cy="11" r="7"/><path d="M16.5 16.5L21 21"/>' + CLOSE;
  var DOC_ICON = OPEN + '<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>' + CLOSE;
  var CLOUD_ICON = OPEN + '<path d="M7 18a4 4 0 01-.6-7.9A5.5 5.5 0 0117.3 8l.4.1A4 4 0 0117.5 18H7z"/>' + CLOSE;
  var BOX_ICON = OPEN + '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>' + CLOSE;
  var CATEGORY_SVG = {
    organize: OPEN + '<path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 13l9 5 9-5"/>' + CLOSE,
    compress: OPEN + '<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5"/>' + CLOSE,
    convert: OPEN + '<path d="M4 7h13l-3-3M20 17H7l3 3"/>' + CLOSE,
    edit: OPEN + '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>' + CLOSE,
    ocr: OPEN + '<path d="M4 8V4h4M20 8V4h-4M4 16v4h4M20 16v4h-4M4 12h16"/>' + CLOSE,
    security: OPEN + '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>' + CLOSE,
    watermark: OPEN + '<path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z"/>' + CLOSE,
    ai: OPEN + '<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="12" cy="18" r="2.5"/><path d="M8 7.5l3 8M16 7.5l-3 8M8.5 6h7"/>' + CLOSE,
    workflow: OPEN + '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="12" r="2.5"/><path d="M6 8.5v7M8.2 6.8l7.3 3.9"/>' + CLOSE,
    platform: OPEN + '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>' + CLOSE
  };
  var CAT_LABEL = {
    organize: { id: "Organisasi", en: "Organize" },
    compress: { id: "Kompresi", en: "Compress" },
    convert: { id: "Konversi", en: "Convert" },
    edit: { id: "Penyunting", en: "Edit" },
    ocr: { id: "OCR", en: "OCR" },
    security: { id: "Keamanan", en: "Security" },
    watermark: { id: "Watermark", en: "Watermark" },
    ai: { id: "Analisis", en: "Analyze" },
    workflow: { id: "Workflow", en: "Workflow" },
    platform: { id: "Platform", en: "Platform" }
  };
  function svgFor(cat) { return CATEGORY_SVG[cat] || CATEGORY_SVG.platform; }
  function catLabel(cat) { var e = CAT_LABEL[cat]; if (!e) return cat; return currentLang === "id" ? e.id : e.en; }


  function renderToolsGrid(filterText = "") {
    const grid = document.getElementById("catalog-grid");
    if (!grid) return;
    grid.innerHTML = "";

    const query = filterText.toLowerCase().trim();
    const filtered = TOOLS_100.filter(tool => {
      const matchCat = activeCategory === "all" || tool.cat === activeCategory;
      const matchText = !query ||
        tool.name.toLowerCase().includes(query) ||
        tool.nameEn.toLowerCase().includes(query) ||
        tool.desc.toLowerCase().includes(query) ||
        ((window.PDFForgeToolDescEN || {})[tool.id] || "").toLowerCase().includes(query) ||
        String(tool.id) === query;
      return matchCat && matchText;
    });

    const countBadge = document.getElementById("tools-count-badge");
    if (countBadge) {
      countBadge.textContent = currentLang === "id" ? `${filtered.length} alat` : `${filtered.length} tools`;
    }

    if (filtered.length === 0) {
      grid.innerHTML = `
        <div class="empty-tools-state">
          <span class="empty-mark">${MAGNIFIER}</span>
          <p><strong>${currentLang === "id" ? "Tidak ada fitur yang cocok" : "No matching tools found"}</strong></p>
          <small>${currentLang === "id" ? "Coba kata kunci lain atau pilih tab kategori 'Semua'" : "Try another search term or click 'All'"}</small>
        </div>`;
      return;
    }

    filtered.forEach(tool => {
      const card = document.createElement("div");
      card.className = "catalog-card";
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.dataset.id = tool.id;
      card.dataset.op = tool.op;
      card.dataset.target = tool.target;
      card.dataset.cat = tool.cat;

      const isFav = favorites.includes(tool.id);
      card.innerHTML = `
        <button class="card-fav${isFav ? " active" : ""}" type="button" aria-label="${tr(isFav ? "Hapus dari favorit" : "Tandai sebagai favorit")}">${isFav ? "★" : "☆"}</button>
        <div class="card-body">
          <span class="card-icon">${svgFor(tool.cat)}</span>
          <div class="card-text">
            <h3 class="card-title">${toolTitle(tool)}</h3>
            <p class="card-desc">${toolDesc(tool)}</p>
          </div>
        </div>
        <div class="card-foot">
          <span class="card-badge">${currentLang === "id" ? tool.badge : ((window.PDFForgeBadgeEN || {})[tool.badge] || tool.badge)}</span>
          <span class="card-action">${tr("Buka alat")} →</span>
        </div>
      `;
      card.querySelector(".card-fav")?.addEventListener("click", (event) => {
        event.stopPropagation();
        toggleFavorite(tool.id);
      });

      card.addEventListener("click", () => handleToolClick(tool));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleToolClick(tool);
        }
      });

      grid.appendChild(card);
    });
  }

  function toolTitle(tool) {
    return currentLang === "id" ? (ID_NAME[tool.id] || tool.name) : (tool.nameEn || tool.name);
  }
  function toolDesc(tool) {
    return currentLang === "id" ? tool.desc : ((window.PDFForgeToolDescEN || {})[tool.id] || tool.desc);
  }
  function toggleFavorite(id) {
    favorites = favorites.includes(id) ? favorites.filter(value => value !== id) : [...favorites, id];
    saveIds("pdfforge_favorites", favorites);
    renderToolsGrid(document.getElementById("tool-search-input")?.value || "");
    renderRecentRow();
  }
  function rememberTool(id) {
    recentTools = [id, ...recentTools.filter(value => value !== id)].slice(0, 6);
    saveIds("pdfforge_recent_tools", recentTools);
    renderRecentRow();
  }
  function renderRecentRow() {
    const container = document.getElementById("recent-favorites");
    if (!container) return;
    const favTools = favorites.map(id => TOOLS_100.find(tool => tool.id === id)).filter(Boolean).slice(0, 8);
    const recent = recentTools.map(id => TOOLS_100.find(tool => tool.id === id)).filter(tool => tool && !favorites.includes(tool.id)).slice(0, 8);
    if (!favTools.length && !recent.length) { container.hidden = true; container.innerHTML = ""; return; }
    const chip = (tool) => `<button type="button" class="rf-chip" data-id="${tool.id}">${svgFor(tool.cat)}<span>${toolTitle(tool)}</span></button>`;
    container.innerHTML =
      (favTools.length ? `<div class="rf-row"><span class="rf-label">${tr("Favorit")}</span><div class="rf-chips">${favTools.map(chip).join("")}</div></div>` : "") +
      (recent.length ? `<div class="rf-row"><span class="rf-label">${tr("Terakhir dipakai")}</span><div class="rf-chips">${recent.map(chip).join("")}</div></div>` : "");
    container.hidden = false;
    container.querySelectorAll(".rf-chip").forEach(button => {
      button.addEventListener("click", () => {
        const tool = TOOLS_100.find(item => item.id === Number(button.dataset.id));
        if (tool) handleToolClick(tool);
      });
    });
  }

  function handleToolClick(tool) {
    if (!tool.op.startsWith("info_") && tool.op !== "modal_api_docs" && tool.op !== "modal_admin" && tool.op !== "modal_stats") rememberTool(tool.id);
    // Check if this tool triggers an interactive modal
    if (tool.op === "modal_reader") {
      openReaderModal();
      return;
    }
    if (tool.op === "modal_workflow") {
      openWorkflowModal();
      return;
    }
    if (tool.op === "modal_cloud") {
      openCloudModal();
      return;
    }
    if (tool.op === "modal_signatures") {
      openSignatureModal();
      return;
    }
    if (tool.op === "modal_admin" || tool.op === "modal_stats") {
      openAdminModal();
      return;
    }
    if (tool.op === "modal_api_docs") {
      window.open("/api/docs", "_blank");
      return;
    }
    if (tool.op === "modal_account" || tool.op === "modal_workspace" || tool.op === "modal_credits" || tool.op === "modal_sso") {
      openAccountModal(toolTitle(tool));
      return;
    }
    if (tool.op === "action_history") {
      document.getElementById("history")?.scrollIntoView({ behavior: "smooth" });
      return;
    }
    if (tool.op === "action_sort") {
      if (window.state && window.state.files.length && typeof window.renderFiles === "function") {
        window.state.files.sort((a, b) => a.name.localeCompare(b.name));
        window.renderFiles();
      }
      document.getElementById("converter")?.scrollIntoView({ behavior: "smooth" });
      showToast(tr("Berkas diurutkan berdasarkan nama."));
      return;
    }
    if (tool.op === "action_dropzone") {
      document.getElementById("converter")?.scrollIntoView({ behavior: "smooth" });
      document.getElementById("file-input")?.click();
      return;
    }
    if (tool.op === "action_toggle_lang") {
      toggleLanguage();
      return;
    }
    if (tool.op.startsWith("info_")) {
      showInfoModal(tool);
      return;
    }

    // Standard converter workbench integration via bridge
    if (window.PDFForge && typeof window.PDFForge.setTool === "function") {
      window.PDFForge.setTool(tool.op, tool.target, toolTitle(tool), Object.assign({}, tool, { name: toolTitle(tool), desc: toolDesc(tool) }));
      const hasFiles = window.state && window.state.files && window.state.files.length > 0;
      if (!hasFiles) {
        document.getElementById("file-input")?.click();
      } else if (tool.op === "organize" && window.PDFForgePages) {
        setTimeout(() => window.PDFForgePages.open(), 300);
      }
      return;
    }
    const opSelect = document.getElementById("operation");
    const targetSelect = document.getElementById("target");
    const customOptionsDiv = document.getElementById("custom-tool-options");

    // Scroll smoothly to workbench
    document.getElementById("converter")?.scrollIntoView({ behavior: "smooth" });

    // Set operation
    if (opSelect) {
      // Check if option exists, or add dynamic option
      let opt = Array.from(opSelect.options).find(o => o.value === tool.op);
      if (!opt) {
        opt = document.createElement("option");
        opt.value = tool.op;
        opt.textContent = tool.name;
        opSelect.appendChild(opt);
      }
      opSelect.value = tool.op;
    }

    // Set target format
    if (targetSelect && tool.target) {
      let opt = Array.from(targetSelect.options).find(o => o.value === tool.target);
      if (!opt) {
        opt = document.createElement("option");
        opt.value = tool.target;
        opt.textContent = tool.target.toUpperCase();
        targetSelect.appendChild(opt);
      }
      targetSelect.value = tool.target;
    }

    // Update the active tool header in the workbench
    if (window.PDFForgeApplyToolUI) {
      window.PDFForgeApplyToolUI({ op: tool.op, target: tool.target, name: tool.name, desc: tool.desc });
    }

    // Reveal custom options based on tool requirements
    configureCustomInputs(tool);

    // If no files selected yet, trigger file picker
    const fileInput = document.getElementById("file-input");
    if (window.state && window.state.files && window.state.files.length === 0) {
      fileInput?.click();
    }
  }

  function configureCustomInputs(tool) {
    const container = document.getElementById("custom-tool-options");
    if (!container) return;
    container.innerHTML = "";
    container.hidden = true;

    // Password Protect / Unlock
    if (tool.op === "protect" || tool.op === "password_encrypt") {
      container.innerHTML = `
        <div class="custom-field">
          <label class="field-label" for="opt-password">KATA SANDI ENKRIPSI</label>
          <input type="password" id="opt-password" name="protect_password" placeholder="Masukkan kata sandi pengaman PDF..." class="input-styled" required>
        </div>`;
      container.hidden = false;
    } else if (tool.op === "unlock") {
      container.innerHTML = `
        <div class="custom-field">
          <label class="field-label" for="opt-password">KATA SANDI PEMBUKA</label>
          <input type="password" id="opt-password" name="unlock_password" placeholder="Masukkan kata sandi untuk menghapus proteksi..." class="input-styled" required>
        </div>`;
      container.hidden = false;
    } else if (tool.op === "text_watermark") {
      container.innerHTML = `
        <div class="custom-fields-grid">
          <div class="custom-field">
            <label class="field-label" for="opt-watermark-text">TEKS WATERMARK</label>
            <input type="text" id="opt-watermark-text" name="watermark_text" value="CONFIDENTIAL" class="input-styled">
          </div>
          <div class="custom-field">
            <label class="field-label" for="opt-opacity">TRANSPARANSI (0.1 - 1.0)</label>
            <input type="number" step="0.1" min="0.1" max="1" id="opt-opacity" name="watermark_opacity" value="0.3" class="input-styled">
          </div>
        </div>`;
      container.hidden = false;
    } else if (tool.op === "redact" || tool.op === "permanent_remove") {
      container.innerHTML = `
        <div class="custom-field">
          <label class="field-label" for="opt-redact">KATA / DATA YANG DISENSOR (Pisahkan koma)</label>
          <input type="text" id="opt-redact" name="redact_terms" placeholder="Contoh: Rahasia, NIK, Password, 08123..." class="input-styled" required>
        </div>`;
      container.hidden = false;
    } else if (tool.op === "digital_sign" || tool.op === "signature_request") {
      container.innerHTML = `
        <div class="custom-fields-grid">
          <div class="custom-field">
            <label class="field-label" for="opt-signer">NAMA PENANDATANGAN</label>
            <input type="text" id="opt-signer" name="signer_name" placeholder="Nama Lengkap / Instansi" class="input-styled" required>
          </div>
          <div class="custom-field">
            <label class="field-label" for="opt-reason">ALASAN / PERIHAL</label>
            <input type="text" id="opt-reason" name="sign_reason" value="Persetujuan Dokumen Resmi" class="input-styled">
          </div>
        </div>`;
      container.hidden = false;
    } else if (tool.op === "ai_translate") {
      container.innerHTML = `
        <div class="custom-field">
          <label class="field-label" for="opt-target-lang">BAHASA TUJUAN</label>
          <select id="opt-target-lang" name="target_lang" class="input-styled">
            <option value="id">Bahasa Indonesia</option>
            <option value="en">English (US)</option>
            <option value="ja">日本語 (Japanese)</option>
            <option value="zh">中文 (Chinese)</option>
            <option value="de">Deutsch (German)</option>
            <option value="fr">Français (French)</option>
          </select>
        </div>`;
      container.hidden = false;
    } else if (tool.op === "ai_summarize" || tool.op === "ai_extract_data") {
      container.innerHTML = `
        <div class="custom-field">
          <label class="field-label" for="opt-ai-prompt">INSTRUKSI KHUSUS AI (Opsional)</label>
          <input type="text" id="opt-ai-prompt" name="ai_prompt" placeholder="Contoh: Ekstrak hanya total biaya dan tenggat waktu pembayaran..." class="input-styled">
        </div>`;
      container.hidden = false;
    }
  }

  // Modals Management
  function createModal(id, title, contentHtml) {
    let modal = document.getElementById(id);
    if (!modal) {
      modal = document.createElement("div");
      modal.id = id;
      modal.className = "portal-modal-backdrop";
      document.body.appendChild(modal);
    }
    modal.innerHTML = `
      <div class="portal-modal-window">
        <div class="portal-modal-header">
          <h3>${title}</h3>
          <button class="portal-modal-close" aria-label="${tr("Tutup")}">×</button>
        </div>
        <div class="portal-modal-body">${contentHtml}</div>
      </div>
    `;
    modal.querySelector(".portal-modal-close").addEventListener("click", () => {
      modal.classList.remove("open");
    });
    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.remove("open");
    });
    if (!createModal.escBound) {
      createModal.escBound = true;
      document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        document.querySelectorAll(".portal-modal-backdrop.open").forEach(m => m.classList.remove("open"));
      });
    }
    modal.classList.add("open");
    return modal;
  }

  function openReaderModal(previewUrl = "") {
    const src = previewUrl || (window.lastPreviewUrl ? window.lastPreviewUrl : "");
    const bodyHtml = `
      <div class="reader-container">
        <div class="reader-toolbar">
          <span class="reader-title">PDF Viewer</span>
          <div>
            <button class="btn-sm" id="btn-reader-open-file">${tr("Buka Berkas")}</button>
            <input type="file" id="reader-file-picker" accept=".pdf" hidden>
          </div>
        </div>
        <div class="reader-canvas-wrap" id="reader-canvas-wrap">
          ${src ? `<iframe src="${src}" class="reader-iframe" title="PDF Document Preview"></iframe>` : `
          <div class="reader-empty">
            <span class="empty-mark">${DOC_ICON}</span>
            <p><strong>${tr("Tidak ada dokumen yang sedang ditampilkan")}</strong></p>
            <p><small>${tr("Pilih file PDF atau selesaikan salah satu konversi untuk melihat pratinjau langsung di peramban.")}</small></p>
            <button class="btn-primary" onclick="document.getElementById('reader-file-picker').click()">${tr("Pilih PDF dari Komputer")}</button>
          </div>`}
        </div>
      </div>
    `;
    const modal = createModal("modal-reader", tr("Pembaca PDF"), bodyHtml);
    const picker = modal.querySelector("#reader-file-picker");
    const openBtn = modal.querySelector("#btn-reader-open-file");
    openBtn?.addEventListener("click", () => picker?.click());
    picker?.addEventListener("change", (e) => {
      if (e.target.files && e.target.files[0]) {
        const fileUrl = URL.createObjectURL(e.target.files[0]);
        modal.querySelector("#reader-canvas-wrap").innerHTML = `<iframe src="${fileUrl}" class="reader-iframe" title="Preview"></iframe>`;
      }
    });
  }

  function openWorkflowModal() {
    const bodyHtml = `
      <div class="workflow-builder">
        <p>${tr("Bangun alur otomatisasi pengolahan dokumen berurutan:")}</p>
        <div class="workflow-steps" id="workflow-steps">
          <div class="wf-step">
            <span class="wf-step-num">1</span>
            <select class="input-styled wf-step-op">
              <option value="compress">${tr("Kompresi PDF (Hemat Ukuran)")}</option>
              <option value="pdf_to_pdfa">${tr("Konversi ke PDF/A Standar ISO")}</option>
              <option value="ocr_pdf">${tr("Jalankan OCR Teks")}</option>
            </select>
          </div>
          <div class="wf-step">
            <span class="wf-step-num">2</span>
            <select class="input-styled wf-step-op">
              <option value="text_watermark">${tr('Tambahkan Watermark "CONFIDENTIAL"')}</option>
              <option value="page_numbers">${tr("Bubuhi Nomor Halaman Otomatis")}</option>
              <option value="redact">${tr("Sensor Data Sensitif")}</option>
            </select>
          </div>
          <div class="wf-step">
            <span class="wf-step-num">3</span>
            <select class="input-styled wf-step-op">
              <option value="protect">${tr("Enkripsi & Kunci Kata Sandi AES-256")}</option>
              <option value="digital_sign">${tr("Bubuhi Tanda Tangan Kriptografis")}</option>
            </select>
          </div>
        </div>
        <div class="wf-actions" style="margin-top:16px; display:flex; gap:8px;">
          <button class="btn-primary" id="btn-run-workflow">${tr("Jalankan Pipeline Alur Kerja")}</button>
          <button class="btn-secondary" id="btn-save-workflow">${tr("Simpan Sebagai Template Favorit")}</button>
        </div>
      </div>
    `;
    const modal = createModal("modal-workflow", tr("Alur Kerja Otomatis"), bodyHtml);
    const collectSteps = () => [...modal.querySelectorAll(".wf-step-op")].map(s => s.value).filter(Boolean).join(",");
    modal.querySelector("#btn-run-workflow").addEventListener("click", () => {
      modal.classList.remove("open");
      document.getElementById("converter")?.scrollIntoView({ behavior: "smooth" });
      const opSelect = document.getElementById("operation");
      if (opSelect) {
        let opt = Array.from(opSelect.options).find(o => o.value === "workflow");
        if (!opt) {
          opt = document.createElement("option");
          opt.value = "workflow";
          opt.textContent = "Alur kerja bertahap";
          opSelect.appendChild(opt);
        }
        opSelect.value = "workflow";
      }
      const wfTool = TOOLS_100.find(t => t.op === "workflow");
      if (window.PDFForgeApplyToolUI && wfTool) {
        window.PDFForgeApplyToolUI({ op: wfTool.op, target: wfTool.target, name: toolTitle(wfTool), desc: toolDesc(wfTool), id: wfTool.id });
      }
      if (window.PDFForgeCustom) window.PDFForgeCustom.update();
      const stepsInput = document.querySelector('#custom-tool-options [name="workflow_steps"]');
      if (stepsInput) stepsInput.value = collectSteps();
      showToast(tr("Alur kerja disiapkan: {steps}. Unggah berkas PDF untuk memulai.", { steps: collectSteps() }));
    });
    modal.querySelector("#btn-save-workflow").addEventListener("click", () => {
      try {
        localStorage.setItem("pdfforge_workflow_template", collectSteps());
        showToast(tr("Alur favorit tersimpan di browser: {steps}", { steps: collectSteps() }));
      } catch {
        showToast(tr("Browser menolak menyimpan template alur."));
      }
    });
  }

  function openCloudModal() {
    const bodyHtml = `
      <div class="cloud-import-view">
        <p>${tr("Impor dari penyimpanan awan atau URL publik:")}</p>
        <div class="cloud-providers">
          <div class="cloud-card" data-provider="gdrive">
            <span class="empty-mark">${CLOUD_ICON}</span>
            <strong>Google Drive</strong>
            <small>${tr("Impor berkas via Google Drive API")}</small>
            <button class="btn-sm" style="margin-top:8px;">${tr("Pilih Berkas")}</button>
          </div>
          <div class="cloud-card" data-provider="dropbox">
            <span class="empty-mark">${BOX_ICON}</span>
            <strong>Dropbox</strong>
            <small>${tr("Sinkronisasi berkas Dropbox Chooser")}</small>
            <button class="btn-sm" style="margin-top:8px;">${tr("Pilih Berkas")}</button>
          </div>
        </div>
        <div style="margin-top:18px;">
          <label class="field-label">${tr("ATAU IMPOR MELALUI URL PUBLIK AMAN (HTTPS)")}</label>
          <div style="display:flex; gap:8px;">
            <input type="url" id="cloud-import-url" placeholder="https://example.com/document.pdf" class="input-styled" style="flex:1;">
            <button class="btn-primary" id="btn-cloud-fetch">${tr("Tarik File")}</button>
          </div>
        </div>
      </div>
    `;
    const modal = createModal("modal-cloud", tr("Impor dari Cloud"), bodyHtml);
    modal.querySelectorAll(".cloud-card").forEach(card => {
      card.querySelector("button")?.addEventListener("click", () => {
        const provider = card.dataset.provider === "gdrive" ? "Google Drive" : "Dropbox";
        showToast(tr("Menghubungkan {provider} butuh kunci API di server. Gunakan impor URL atau unggah dari perangkat.", { provider: provider }));
        modal.querySelector("#cloud-import-url")?.focus();
      });
    });
    modal.querySelector("#btn-cloud-fetch").addEventListener("click", async () => {
      const urlInput = modal.querySelector("#cloud-import-url");
      const url = urlInput.value.trim();
      if (!url) return showToast(tr("Masukkan URL file terlebih dahulu."));
      try {
        const targetSel = document.getElementById("target");
        const opSel = document.getElementById("operation");
        const res = await fetch("/api/cloud/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url, target: targetSel ? targetSel.value : "pdf", operation: opSel ? opSel.value : "convert", options: {} })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || tr("Gagal mengambil file"));
        showToast(tr("File berhasil diimpor: {name}", { name: data.name }));
        modal.classList.remove("open");
      } catch (err) {
        showToast(err.message);
      }
    });
  }

  function openSignatureModal() {
    const bodyHtml = `
      <div class="signature-view">
        <p>${tr("Kelola dan verifikasi tanda tangan digital:")}</p>
        <div style="display:flex; gap:12px; margin-bottom:16px;">
          <button class="btn-primary" id="btn-tab-verify">${tr("Verifikasi Sertifikat")}</button>
          <button class="btn-secondary" id="btn-tab-request">${tr("Buat Permintaan Baru")}</button>
        </div>
        <div id="sig-verify-panel">
          <label class="field-label">${tr("UNGGAH DOKUMEN BER-TANDA TANGAN UNTUK DIVALIDASI")}</label>
          <input type="file" id="sig-verify-input" accept=".pdf" class="input-styled">
          <div id="sig-verify-result" style="margin-top:14px;" hidden></div>
        </div>
      </div>
    `;
    const modal = createModal("modal-signature", tr("Tanda Tangan & Verifikasi"), bodyHtml);
    const input = modal.querySelector("#sig-verify-input");
    const resultDiv = modal.querySelector("#sig-verify-result");
    input.addEventListener("change", async () => {
      if (!input.files || !input.files[0]) return;
      const form = new FormData();
      form.append("file", input.files[0]);
      try {
        const res = await fetch("/api/signatures/verify", { method: "POST", body: form });
        const data = await res.json();
        resultDiv.hidden = false;
        resultDiv.innerHTML = `
          <div class="status-box ${data.valid ? 'success' : 'warn'}">
            <strong>${data.valid ? tr('✓ Tanda Tangan Valid & Asli') : tr('⚠ Dokumen Belum Bertanda Tangan')}</strong>
            <p><small>${tr("Penerbit / Subjek:")} ${data.subject || '—'}<br>Timestamp: ${data.timestamp || '—'}</small></p>
          </div>
        `;
      } catch (err) {
        showToast(err.message);
      }
    });
  }

  async function openAdminModal() {
    let stats = null;
    try {
      const res = await fetch("/api/admin/stats");
      if (res.ok) stats = await res.json();
    } catch {}

    const prettyMb = (b) => (b / (1024 * 1024)).toFixed(1) + " MB";
    const val = (formatter) => stats ? formatter() : "—";
    const bodyHtml = `
      <div class="admin-dashboard-view">
        ${stats ? "" : `<div class="status-box warn" style="margin-bottom:14px;"><strong>${tr("Statistik belum tersedia")}</strong><p><small>${tr("Server tidak mengembalikan data. Jalankan server PDFForge, lalu buka kembali halaman ini.")}</small></p></div>`}
        <div class="stats-cards-grid">
          <div class="stat-card">
            <span class="stat-val">${val(() => stats.total_conversions ?? 0)}</span>
            <span class="stat-label">${tr("Total Konversi Sukses")}</span>
          </div>
          <div class="stat-card">
            <span class="stat-val">${val(() => prettyMb(stats.total_bytes_processed ?? 0))}</span>
            <span class="stat-label">${tr("Volume Data Diproses")}</span>
          </div>
          <div class="stat-card">
            <span class="stat-val">${val(() => `${stats.avg_duration_sec ?? 0} ${tr("detik")}`)}</span>
            <span class="stat-label">${tr("Kecepatan Rata-Rata")}</span>
          </div>
          <div class="stat-card">
            <span class="stat-val">${val(() => prettyMb(stats.compression_bandwidth_saved ?? 0))}</span>
            <span class="stat-label">${tr("Bandwidth Dihemat")}</span>
          </div>
        </div>
        <div style="margin-top:20px;">
          <h4>${tr("Arsitektur & Keamanan Platform")}</h4>
          <ul style="font-size:0.88rem; line-height:1.6; padding-left:20px;">
            <li>${tr("Isolasi sesi browser penuh (Owner Hash SHA-256)")}</li>
            <li>${tr("Pembersihan berkas otomatis (retensi 24 jam)")}</li>
            <li>${tr("Database ganda: MySQL / PostgreSQL dengan auto-recovery in-memory")}</li>
            <li>${tr("Pemrosesan lokal tanpa transmisi ke pihak ketiga")}</li>
          </ul>
        </div>
      </div>
    `;
    createModal("modal-admin", tr("Statistik Penggunaan"), bodyHtml);
  }

  function openAccountModal(title) {
    const bodyHtml = `
      <div class="account-view">
        <p>${tr("Informasi akun & akses pengembang.")}</p>
        <div class="token-box" style="margin:16px 0; padding:12px; border-radius:6px;">
          <label class="field-label" for="api-token-field">${tr("TOKEN API")}</label>
          <input type="text" id="api-token-field" readonly value="${tr("Server ini tidak memakai token API")}" class="input-styled">
          <p class="field-hint">${tr("Dokumentasi endpoint tersedia di")} <a href="/api/docs" target="_blank" rel="noopener">/api/docs</a>.</p>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
          <div class="info-card">
            <strong>${tr("Kredit AI")}</strong>
            <p style="font-size:1.15rem; margin:4px 0;">${tr("Gratis & tanpa batas")}</p>
            <small>${tr("Diproses lokal oleh mesin PDFForge, tanpa layanan pihak ketiga.")}</small>
          </div>
          <div class="info-card">
            <strong>${tr("Status Workspace")}</strong>
            <p style="font-size:1.15rem; margin:4px 0;">${tr("Tidak aktif di server ini")}</p>
            <small>${tr("Fitur tim, peran pengguna, dan SSO belum dikonfigurasi.")}</small>
          </div>
        </div>
      </div>
    `;
    createModal("modal-account", title || tr("Akun & Akses"), bodyHtml);
  }

  function showInfoModal(tool) {
    const bodyHtml = `
      <div class="info-view">
        <div class="empty-mark" style="margin-bottom:12px">${svgFor(tool.cat)}</div>
        <h4>${toolTitle(tool)}</h4>
        <p style="margin:12px 0; line-height:1.6;">${toolDesc(tool)}</p>
        <div class="callout-box" style="padding:12px; border-left:4px solid #3366ff; border-radius:4px; font-size:0.85rem;">
          ${tr("Ini keterangan fitur platform, bukan alat pemroses berkas. Untuk memproses dokumen, pilih alat pada bagian “Pilih alat” di halaman utama.")}
        </div>
      </div>
    `;
    createModal("modal-info", toolTitle(tool), bodyHtml);
  }

  function toggleLanguage() {
    currentLang = currentLang === "id" ? "en" : "id";
    localStorage.setItem("pdfforge_lang", currentLang);
    applyLanguage();
    renderToolsGrid(document.getElementById("tool-search-input")?.value || "");
    showToast(currentLang === "id" ? "Bahasa diubah ke Bahasa Indonesia" : "Language switched to English");
  }

  function applyLanguage() {
    const langBtn = document.getElementById("lang-toggle-btn");
    if (langBtn) langBtn.textContent = currentLang === "id" ? "EN" : "ID";
    if (window.state) window.state.lang = currentLang;
    if (window.PDFForgeApplyI18n) window.PDFForgeApplyI18n();
    if (window.PDFForgeCustom) window.PDFForgeCustom.update();
    const tabs = {
      id: { all: "Semua", organize: "Atur halaman", convert: "Konversi", compress: "Kompres & perbaiki", edit: "Edit & formulir", ocr: "OCR & scan", security: "Keamanan", watermark: "Watermark", ai: "Analisis & AI", workflow: "Alur kerja", platform: "Platform" },
      en: { all: "All", organize: "Organize pages", convert: "Convert", compress: "Compress & repair", edit: "Edit & forms", ocr: "OCR & scan", security: "Security", watermark: "Watermark", ai: "Analyze & AI", workflow: "Workflow", platform: "Platform" }
    };
    const labels = tabs[currentLang] || tabs.id;
    document.querySelectorAll(".cat-tab").forEach(tab => {
      const label = labels[tab.dataset.cat];
      if (label) tab.textContent = label;
    });
    // Refresh the active tool header in the workbench so it follows the language.
    const selected = window.PDFForgeSelectedTool;
    if (selected && window.PDFForgeApplyToolUI) {
      const tool = TOOLS_100.find(item => item.id === selected.id) || TOOLS_100.find(item => item.op === selected.op);
      if (tool) {
        window.PDFForgeApplyToolUI({ op: tool.op, target: tool.target, name: toolTitle(tool), desc: toolDesc(tool), id: tool.id });
      }
    }
    renderRecentRow();
    if (window.state && window.state.lastJob && document.querySelector(".result-card") && typeof window.showResult === "function") {
      window.showResult(window.state.lastJob);
    }
    if (typeof window.refreshHistory === "function") window.refreshHistory();
  }

  // Setup event listeners on initialization
  document.addEventListener("DOMContentLoaded", () => {
    // Search input
    const searchInput = document.getElementById("tool-search-input");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        renderToolsGrid(e.target.value);
      });
    }

    // Category tabs
    document.querySelectorAll(".cat-tab").forEach(tab => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".cat-tab").forEach(t => t.classList.remove("active"));
        tab.classList.add("active");
        activeCategory = tab.dataset.cat;
        renderToolsGrid(searchInput?.value || "");
      });
    });

    // Language toggle
    const langBtn = document.getElementById("lang-toggle-btn");
    if (langBtn) {
      langBtn.addEventListener("click", toggleLanguage);
    }

    // Direct nav buttons
    document.getElementById("nav-reader-btn")?.addEventListener("click", (e) => {
      e.preventDefault();
      openReaderModal();
    });
    document.getElementById("nav-workflow-btn")?.addEventListener("click", (e) => {
      e.preventDefault();
      openWorkflowModal();
    });
    document.getElementById("nav-admin-btn")?.addEventListener("click", (e) => {
      e.preventDefault();
      openAdminModal();
    });

    applyLanguage();
    renderToolsGrid();
    renderRecentRow();
  });

  // Global helper to show preview in reader modal
  window.openDocumentInReader = function (jobId) {
    openReaderModal(`/api/jobs/${encodeURIComponent(jobId)}/preview`);
  };

})();
