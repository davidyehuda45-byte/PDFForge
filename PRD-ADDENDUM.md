# PRD ADDENDUM — UNIVERSAL FILE CONVERSION ENGINE

## 1. Tujuan

PDFForge harus memiliki **Universal Conversion Engine** yang memungkinkan pengguna mengubah dokumen dari satu format ke format lain selama secara teknis memungkinkan.

Konsep:

```text
INPUT FILE
    ↓
Format Detection
    ↓
Conversion Pipeline
    ↓
Intermediate Format
    ↓
Target Converter
    ↓
OUTPUT FILE
```

Sistem **tidak boleh membatasi conversion hanya berdasarkan extension**. Format sebenarnya harus dideteksi dari file signature/MIME dan divalidasi sebelum processing.

---

# 2. FORMAT YANG DIDUKUNG

## Documents

```text
DOC
DOCX
ODT
RTF
TXT
HTML
HTM
MD
EPUB
```

## Spreadsheets

```text
XLS
XLSX
ODS
CSV
TSV
```

## Presentations

```text
PPT
PPTX
ODP
```

## PDF

```text
PDF
```

## Images

```text
JPG
JPEG
PNG
WEBP
GIF
BMP
TIFF
SVG
```

## Web

```text
HTML
HTM
CSS
```

HTML/CSS harus diproses menggunakan browser rendering engine jika membutuhkan rendering visual yang akurat.

---

# 3. CONVERSION MATRIX

## Document → PDF

WAJIB:

```text
DOC   → PDF
DOCX  → PDF
ODT   → PDF
RTF   → PDF
TXT   → PDF
HTML  → PDF
HTM   → PDF
MD    → PDF
```

---

# 4. Spreadsheet → PDF

WAJIB:

```text
XLS   → PDF
XLSX  → PDF
ODS   → PDF
CSV   → PDF
TSV   → PDF
```

User dapat mengatur:

```text
Page Size
Orientation
Margins
Scale
Fit to Page
Print Area
Headers
Footers
Gridlines
```

---

# 5. Presentation → PDF

WAJIB:

```text
PPT   → PDF
PPTX  → PDF
ODP   → PDF
```

Preserve:

- slide dimensions
- text
- images
- shapes
- colors
- backgrounds
- speaker notes jika memungkinkan

---

# 6. Image → PDF

WAJIB:

```text
JPG   → PDF
JPEG  → PDF
PNG   → PDF
WEBP  → PDF
GIF   → PDF
BMP   → PDF
TIFF  → PDF
SVG   → PDF
```

Multiple images:

```text
image1.jpg
image2.png
image3.webp
       ↓
combined.pdf
```

User dapat reorder image sebelum conversion.

---

# 7. PDF → Image

WAJIB:

```text
PDF → JPG
PDF → PNG
PDF → WEBP
PDF → TIFF
```

Options:

```text
All Pages
Selected Pages
Page Range
DPI
Quality
Background
```

Jika output menghasilkan banyak file:

```text
page-001.png
page-002.png
page-003.png
```

sistem menyediakan:

```text
Download ZIP
```

---

# 8. PDF → DOCUMENT

Support:

```text
PDF → DOCX
PDF → ODT
PDF → TXT
PDF → HTML
PDF → RTF
```

### PDF → DOCX

Prioritas tinggi.

Sistem harus mencoba mempertahankan:

- text
- headings
- paragraphs
- tables
- images
- basic formatting
- page structure

Jika layout tidak dapat dipertahankan sempurna, tampilkan warning:

> Complex layouts may not be converted exactly.

Jangan menjanjikan 100% identical conversion.

---

# 9. PDF → SPREADSHEET

Support:

```text
PDF → XLSX
PDF → XLS
PDF → CSV
PDF → ODS
```

Sistem harus mendeteksi table.

Contoh:

```text
PDF
 ↓
Table Detection
 ↓
Rows / Columns
 ↓
Spreadsheet
```

Jika PDF tidak memiliki struktur tabel yang jelas, hasil dapat diberikan sebagai best-effort extraction.

---

# 10. PDF → PRESENTATION

Optional advanced:

```text
PDF → PPTX
PDF → ODP
```

Prioritas lebih rendah karena layout reconstruction lebih sulit.

Sistem harus mempertahankan sebisa mungkin:

- page/slide
- text
- images
- positions

Jika tidak memungkinkan editable reconstruction, dapat menyediakan mode:

```text
PDF page → image-based slide
```

---

# 11. DOCUMENT ↔ DOCUMENT

Support:

```text
DOCX ↔ ODT
DOCX ↔ RTF
DOCX → TXT
ODT → DOCX
RTF → DOCX
```

Untuk conversion yang tidak dapat mempertahankan formatting, tampilkan warning.

---

# 12. SPREADSHEET ↔ SPREADSHEET

Support:

```text
XLS ↔ XLSX
XLSX ↔ ODS
XLS ↔ ODS
CSV ↔ XLSX
CSV ↔ XLS
CSV ↔ ODS
TSV ↔ XLSX
```

Perhatikan:

- formulas
- formatting
- merged cells
- charts
- multiple sheets
- data types

---

# 13. PRESENTATION ↔ PRESENTATION

Support:

```text
PPT ↔ PPTX
PPTX ↔ ODP
PPT ↔ ODP
```

Preserve sebisa mungkin:

- slides
- text
- images
- shapes
- backgrounds
- speaker notes

---

# 14. IMAGE ↔ IMAGE

Universal image converter:

```text
JPG
JPEG
PNG
WEBP
GIF
BMP
TIFF
SVG
```

Contoh:

```text
PNG → JPG
JPG → WEBP
WEBP → PNG
PNG → TIFF
GIF → PNG
BMP → JPG
TIFF → PNG
```

Features:

```text
Quality
Width
Height
DPI
Compression
Resize
Crop
Rotate
Flip
Background
```

---

# 15. IMAGE PROCESSING

Conversion engine juga harus menyediakan:

### Resize

```text
Original
1920 × 1080

→

1280 × 720
```

### Crop

- free crop
- aspect ratio
- custom dimensions

### Rotate

```text
90°
180°
270°
```

### Flip

```text
Horizontal
Vertical
```

### Compress

User dapat memilih:

```text
Low
Medium
High
Custom
```

---

# 16. HTML → PDF

HTML conversion harus mendukung:

```text
HTML
HTM
HTML + CSS
```

Rendering menggunakan browser engine/headless browser.

Support:

- CSS
- fonts
- images
- SVG
- tables
- page breaks
- headers
- footers
- print styles

User dapat menentukan:

```text
A4
A3
Letter
Legal
Custom
```

Orientation:

```text
Portrait
Landscape
```

---

# 17. HTML → IMAGE

Optional:

```text
HTML → PNG
HTML → JPG
HTML → WEBP
```

Gunakan browser rendering.

User dapat memilih:

```text
Full Page
Viewport
Custom Width
Custom Height
```

---

# 18. MARKDOWN CONVERSION

Support:

```text
MD → HTML
MD → PDF
MD → DOCX
MD → TXT
```

Optional reverse:

```text
HTML → MD
```

---

# 19. EPUB CONVERSION

Support:

```text
EPUB → PDF
EPUB → HTML
EPUB → TXT
```

Optional:

```text
EPUB → DOCX
```

Jika conversion menghasilkan layout yang berbeda, berikan warning.

---

# 20. BATCH CONVERSION

User dapat upload:

```text
20 DOCX
```

Kemudian:

```text
Convert all → PDF
```

System:

```text
Job #1
Job #2
Job #3
...
Job #20
```

User mendapatkan:

```text
Download All
```

dalam ZIP.

---

# 21. MIXED FILE CONVERSION

Sistem harus memungkinkan:

```text
file1.docx
file2.xlsx
file3.jpg
file4.pptx
```

→

```text
Convert All → PDF
```

Output:

```text
file1.pdf
file2.pdf
file3.pdf
file4.pdf
```

---

# 22. UNIVERSAL CONVERTER

Buat halaman:

```text
/universal-converter
```

UI:

```text
┌───────────────────────────────────┐
│                                   │
│       Drop your files here        │
│                                   │
│          [ Browse Files ]         │
│                                   │
└───────────────────────────────────┘

Convert to:

[ PDF ▼ ]

              [ Convert ]
```

Setelah file upload:

```text
document.docx
Current format: DOCX

Convert to:
[ PDF ▼ ]
```

Dropdown hanya menampilkan format yang **valid untuk input tersebut**.

---

# 23. SMART CONVERSION

Sistem harus menentukan converter berdasarkan:

```text
source_format
target_format
```

Contoh:

```text
DOCX → PDF
```

Pipeline:

```text
DOCX
 ↓
LibreOffice
 ↓
PDF
```

Contoh:

```text
HTML → PDF
```

Pipeline:

```text
HTML
 ↓
Headless Chromium
 ↓
PDF
```

Contoh:

```text
PDF → PNG
```

Pipeline:

```text
PDF
 ↓
PDF Renderer
 ↓
PNG
```

---

# 24. CONVERSION GRAPH

Jangan membuat converter terpisah untuk setiap kombinasi jika tidak diperlukan.

Gunakan konsep:

```text
              PDF
             / | \
            /  |  \
         DOCX JPG XLSX
          |
         ODT
```

Jika conversion langsung tidak tersedia:

```text
FORMAT A
   ↓
INTERMEDIATE FORMAT
   ↓
FORMAT B
```

Contoh:

```text
ODT
 ↓
DOCX
 ↓
PDF
```

Namun AI Agent wajib memilih pipeline dengan **paling sedikit intermediate conversion** untuk meminimalkan kehilangan data.

---

# 25. CONVERSION CAPABILITY ENGINE

Backend harus memiliki registry:

```go
type Converter struct {
    SourceFormats []string
    TargetFormats []string
    Name          string
    Priority      int
    SupportsBatch bool
}
```

Contoh:

```text
LibreOffice
DOCX → PDF
XLSX → PDF
PPTX → PDF
ODT → PDF
```

Registry memungkinkan tool baru ditambahkan tanpa mengubah API utama.

---

# 26. FORMAT DETECTION

Jangan hanya:

```text
filename.endsWith(".pdf")
```

Gunakan:

```text
File Signature
MIME Detection
Extension
Parser Validation
```

Jika terjadi:

```text
filename.pdf
```

tetapi sebenarnya ZIP/DOCX:

```text
REJECT
```

atau lakukan safe detection sesuai kebutuhan.

---

# 27. CONVERSION RESULT

Setelah conversion:

```text
✓ Conversion completed

Original:
document.docx
4.8 MB

Converted:
document.pdf
1.9 MB

Processing:
2.8 seconds

[ Download ]
```

---

# 28. QUALITY WARNING

Beberapa conversion tidak lossless.

Contoh:

```text
PDF → DOCX
```

UI:

> Some complex layouts, fonts, forms, or graphics may change during conversion.

Untuk image conversion:

> Image quality may change depending on the selected compression settings.

---

# 29. FAILED CONVERSION

Jika converter gagal:

```text
Conversion failed.

The selected file could not be converted to DOCX.

Reason:
The document contains unsupported structures.
```

Backend tetap menyimpan technical error di logs.

---

# 30. SECURITY UNTUK CONVERTER

Semua external converter harus dijalankan secara aman.

WAJIB:

- timeout
- memory limit
- CPU limit
- process isolation
- temporary working directory
- sanitized filenames
- no shell interpolation
- cleanup
- output validation

File user **tidak boleh dianggap trusted**.

---

# 31. OUTPUT VALIDATION

Setelah conversion:

```text
Process
 ↓
Check exit code
 ↓
Check output exists
 ↓
Check output size
 ↓
Validate output signature
 ↓
Optional parser validation
 ↓
Mark completed
```

Jika output corrupt:

```text
failed
```

bukan:

```text
completed
```

---

# 32. CONVERSION HISTORY

History harus menyimpan:

```text
Source
Target
Filename
Size
Processing Time
Status
Created At
```

Contoh:

```text
report.docx → PDF
invoice.xlsx → PDF
photo.png → JPG
document.pdf → DOCX
```

---

# 33. DOWNLOAD MULTIPLE OUTPUTS

Jika conversion menghasilkan banyak file:

```text
[ Download ZIP ]
```

ZIP harus dibuat secara asynchronous jika ukuran besar.

---

# 34. FILE NAMING

Default:

```text
document.pdf
```

Conversion:

```text
document-converted.pdf
```

User dapat mengubah nama sebelum download.

Untuk batch:

```text
document-001.pdf
document-002.pdf
```

Jangan menggunakan filename user sebagai storage filename.

---

# 35. FUTURE FORMAT SUPPORT

Architecture harus memungkinkan penambahan:

```text
JSON
XML
LaTeX
TEX
XPS
DJVU
MOBI
CBZ
CBR
```

tanpa mengubah fundamental conversion engine.

Format baru cukup menambahkan:

```text
Detector
Converter
Validator
Capability Registry
Tests
```

---

# 36. CONVERSION PRIORITY

### Tier 1 — Stable

```text
DOCX → PDF
XLSX → PDF
PPTX → PDF
JPG → PDF
PNG → PDF

PDF → JPG
PDF → PNG

PDF → DOCX
PDF → TXT

HTML → PDF

JPG ↔ PNG
JPG ↔ WEBP
PNG ↔ WEBP
```

### Tier 2

```text
ODT
ODS
ODP
RTF
CSV
TSV
BMP
TIFF
SVG
MD
EPUB
```

### Tier 3 — Experimental

```text
PDF → PPTX
PDF → XLSX
PDF → ODT
EPUB → DOCX
HTML → DOCX
```

---

# 37. IMPORTANT PRODUCT RULE

Jangan menampilkan semua kombinasi format sebagai tersedia jika converter sebenarnya tidak reliable.

UI harus berdasarkan:

```text
SupportedCapabilities
```

Contoh:

```text
PDF → DOCX       ✓
PDF → PPTX       ⚠ Experimental
PDF → EXE        ✕ Unsupported
```

Dengan begitu pengguna tidak mendapatkan fitur palsu.

---

# 38. FINAL CONVERSION ARCHITECTURE

```text
                    Upload
                       │
                       ▼
              ┌────────────────┐
              │ Format Detector│
              └───────┬────────┘
                      │
                      ▼
              ┌────────────────┐
              │ Capability     │
              │ Registry       │
              └───────┬────────┘
                      │
               Source + Target
                      │
                      ▼
              ┌────────────────┐
              │ Pipeline       │
              │ Resolver       │
              └───────┬────────┘
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
       qpdf       LibreOffice  Chromium
          │           │           │
          └───────────┼───────────┘
                      ▼
              ┌────────────────┐
              │ Output         │
              │ Validator      │
              └───────┬────────┘
                      ▼
                 Storage
                      │
                      ▼
                  Download
```

# 39. AI AGENT REQUIREMENT

AI Agent harus memperlakukan conversion sebagai **platform capability**, bukan kumpulan endpoint hardcoded.

Ketika menambahkan format baru:

```text
1. Detect format
2. Register capability
3. Implement converter
4. Implement validator
5. Add conversion tests
6. Add UI capability
7. Add documentation
```

Setiap conversion harus diuji menggunakan **file nyata**, bukan hanya mock.

Target akhirnya adalah:

> **User memberikan file apa pun yang didukung → memilih format output → PDFForge menentukan pipeline terbaik → memproses file → memvalidasi hasil → memberikan file output yang benar-benar dapat digunakan.**