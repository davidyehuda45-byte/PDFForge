const state = { files: [], capabilities: [], pollTimer: null, jobId: null, preferredTarget: "", maxUpload: 100 * 1024 * 1024, maxFiles: 20, lang: localStorage.getItem("pdfforge_lang") || "id" };
window.state = state;
window.PDFForgeState = state;
const el = id => document.getElementById(id);
const T = (text, vars) => (window.PDFForgeT ? window.PDFForgeT(text, vars) : text);
const input = el("file-input"), target = el("target"), list = el("file-list"), dropzone = el("dropzone"), button = el("convert-button"), toast = el("toast");
const imageFormats = new Set(["jpg", "png", "webp", "gif", "bmp", "tiff"]);
const formatName = name => (name.split(".").pop() || "").toLowerCase().replace("jpeg", "jpg").replace("htm", "html").replace("markdown", "md");
const prettySize = bytes => bytes < 1048576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1048576).toFixed(1)} MB`;
const displayName = name => name.replace(/[<>]/g, "");

/* ---------- Nama alat yang ramah (bahasa Indonesia) ---------- */
const TARGET_LABEL = {
  pdf: "PDF", docx: "Word (DOCX)", xlsx: "Excel (XLSX)", pptx: "PowerPoint (PPTX)", jpg: "JPG", png: "PNG",
  webp: "WEBP", gif: "GIF", bmp: "BMP", tiff: "TIFF", txt: "Teks (TXT)", md: "Markdown (MD)", html: "HTML",
  rtf: "RTF", csv: "CSV", json: "JSON", xml: "XML", epub: "EPUB", odt: "ODT", odp: "ODP"
};
const TOOL_META = {
  merge: { name: "Gabung PDF", desc: "Satukan beberapa berkas PDF (atau gambar) menjadi satu dokumen. Atur urutannya sesuai keinginan Anda.", action: "Gabung PDF" },
  split: { name: "Pisah PDF", desc: "Ambil halaman tertentu atau bagi dokumen menjadi beberapa berkas terpisah.", action: "Pisah PDF" },
  smart_split: { name: "Pisah Otomatis", desc: "Bagi PDF menjadi beberapa berkas (ZIP) secara otomatis.", action: "Pisah PDF" },
  organize: { name: "Atur Halaman", desc: "Susun ulang, hapus, dan putar halaman dalam satu langkah.", action: "Simpan perubahan" },
  reorder: { name: "Susun Ulang Halaman", desc: "Ubah urutan halaman PDF sesuai keinginan Anda.", action: "Simpan urutan" },
  remove_pages: { name: "Hapus Halaman", desc: "Buang halaman yang tidak diperlukan dari PDF.", action: "Hapus halaman" },
  rotate: { name: "Putar Halaman", desc: "Putar halaman PDF 90°, 180°, atau 270° agar mudah dibaca.", action: "Putar PDF" },
  crop: { name: "Pangkas Margin", desc: "Potong tepi atau margin halaman PDF.", action: "Pangkas PDF" },
  page_numbers: { name: "Tambah Nomor Halaman", desc: "Bubuhkan nomor halaman otomatis pada PDF.", action: "Tambah nomor" },
  compress: { name: "Perkecil Ukuran PDF", desc: "Kurangi ukuran berkas PDF agar lebih mudah dibagikan.", action: "Perkecil PDF" },
  repair: { name: "Perbaiki PDF", desc: "Coba pulihkan PDF yang rusak atau gagal dibuka.", action: "Perbaiki PDF" },
  pdf_to_pdfa: { name: "Ubah ke PDF/A", desc: "Konversi PDF ke format arsip PDF/A untuk penyimpanan jangka panjang.", action: "Jadikan PDF/A" },
  validate_pdfa: { name: "Validasi PDF/A", desc: "Periksa kepatuhan PDF terhadap standar arsip PDF/A (hasil laporan JSON).", action: "Validasi PDF" },
  pdf_to_excel: { name: "PDF ke Excel", desc: "Ubah tabel dan data PDF menjadi lembar kerja Excel (.xlsx).", action: "Konversi ke Excel" },
  ocr_to_word: { name: "PDF Scan ke Word (OCR)", desc: "Kenali teks pada PDF hasil scan dan ubah ke Word (.docx).", action: "OCR ke Word" },
  ocr_to_excel: { name: "PDF Scan ke Excel (OCR)", desc: "Kenali tabel pada PDF hasil scan dan ubah ke Excel (.xlsx).", action: "OCR ke Excel" },
  pdf_to_pptx: { name: "PDF ke PowerPoint", desc: "Ubah setiap halaman PDF menjadi slide presentasi PowerPoint.", action: "Jadikan PowerPoint" },
  pdf_to_md: { name: "PDF ke Markdown", desc: "Ubah isi PDF menjadi berkas Markdown (.md) yang rapi.", action: "Jadikan Markdown" },
  pdf_to_llm_md: { name: "PDF ke Markdown (LLM)", desc: "Ubah PDF menjadi Markdown terstruktur yang siap dipakai untuk AI.", action: "Jadikan Markdown" },
  pdf_to_json: { name: "PDF ke JSON", desc: "Ekstrak teks dan struktur PDF ke format data JSON.", action: "Jadikan JSON" },
  pdf_to_xml: { name: "PDF ke XML", desc: "Ekstrak isi PDF ke struktur XML.", action: "Jadikan XML" },
  add_text: { name: "Tambah Teks", desc: "Sisipkan teks di posisi yang Anda tentukan.", action: "Tambah teks" },
  edit_pdf: { name: "Edit PDF", desc: "Sunting PDF dengan menambahkan teks atau elemen baru.", action: "Sunting PDF" },
  add_image: { name: "Tambah Gambar", desc: "Sisipkan gambar atau logo ke halaman PDF.", action: "Tambah gambar" },
  add_shapes: { name: "Tambah Bentuk", desc: "Gambar kotak, lingkaran, atau garis di atas PDF.", action: "Tambah bentuk" },
  add_annotations: { name: "Tambah Catatan", desc: "Tempelkan catatan atau komentar pada PDF.", action: "Tambah catatan" },
  highlight: { name: "Sorot Teks", desc: "Tandai kata kunci penting dengan sorotan warna.", action: "Sorot teks" },
  draw: { name: "Coret Bebas", desc: "Tambahkan coretan bebas atau tanda tangan manual.", action: "Tambah coretan" },
  create_form: { name: "Buat Kolom Formulir", desc: "Tambahkan kolom formulir yang bisa diisi langsung di PDF.", action: "Buat formulir" },
  fill_form: { name: "Isi Formulir", desc: "Isi kolom formulir PDF dengan data Anda (format JSON).", action: "Isi formulir" },
  ocr_pdf: { name: "OCR PDF", desc: "Buat PDF hasil scan bisa dicari (Ctrl+F) dan teksnya bisa disalin.", action: "Jalankan OCR" },
  protect: { name: "Kunci PDF", desc: "Lindungi PDF dengan kata sandi (AES-256) agar tidak sembarang dibuka.", action: "Kunci PDF" },
  password_encrypt: { name: "Kunci PDF", desc: "Lindungi PDF dengan kata sandi (AES-256).", action: "Kunci PDF" },
  unlock: { name: "Buka Kunci PDF", desc: "Hapus proteksi PDF menggunakan kata sandi yang Anda miliki.", action: "Buka kunci" },
  redact: { name: "Sensor Data", desc: "Hapus informasi sensitif (NIK, nomor kartu, nama) dari PDF.", action: "Sensor data" },
  permanent_remove: { name: "Hapus Metadata Permanen", desc: "Bersihkan metadata dan informasi tersembunyi pada PDF.", action: "Bersihkan PDF" },
  digital_sign: { name: "Tanda Tangan Digital", desc: "Bubuhkan tanda tangan digital pada PDF.", action: "Tanda tangani" },
  signature_request: { name: "Permintaan Tanda Tangan", desc: "Siapkan kolom tanda tangan untuk ditandatangani pihak lain.", action: "Siapkan tanda tangan" },
  audit_trail: { name: "Jejak Audit", desc: "Buat laporan jejak audit PDF (hasil JSON).", action: "Buat laporan" },
  text_watermark: { name: "Watermark Teks", desc: "Tambahkan tanda air teks di seluruh halaman PDF.", action: "Tambah watermark" },
  image_watermark: { name: "Watermark Logo", desc: "Tambahkan logo atau gambar sebagai tanda air di PDF.", action: "Tambah watermark" },
  compare_pdf: { name: "Bandingkan 2 PDF", desc: "Temukan perbedaan antara dua berkas PDF (hasil JSON).", action: "Bandingkan" },
  ai_summarize: { name: "Ringkasan Otomatis", desc: "Buat ringkasan poin penting dari isi dokumen (Markdown).", action: "Buat ringkasan" },
  ai_translate: { name: "Terjemahan", desc: "Terjemahkan isi dokumen ke bahasa lain.", action: "Terjemahkan" },
  ai_extract_data: { name: "Ekstrak Data", desc: "Ambil data penting seperti tanggal dan nominal (hasil JSON).", action: "Ekstrak data" },
  ai_smart_split: { name: "Pisah Otomatis (AI)", desc: "Bagi dokumen berdasarkan pergantian topik (hasil ZIP).", action: "Pisah PDF" },
  workflow: { name: "Alur Kerja Bertahap", desc: "Jalankan beberapa proses sekaligus (contoh: kompres → watermark → kunci).", action: "Jalankan alur" }
};
const PDF_OUTPUT_OPS = ["merge", "split", "smart_split", "ai_smart_split", "organize", "reorder", "remove_pages", "rotate", "crop", "page_numbers", "compress", "repair", "pdf_to_pdfa", "protect", "password_encrypt", "unlock", "redact", "permanent_remove", "digital_sign", "signature_request", "text_watermark", "image_watermark", "add_text", "edit_pdf", "add_image", "add_shapes", "add_annotations", "highlight", "draw", "create_form", "fill_form", "ocr_pdf", "ai_translate", "workflow"];
const PDF_ONLY_OPS = ["split", "smart_split", "organize", "reorder", "remove_pages", "rotate", "crop", "page_numbers", "compress", "repair", "pdf_to_pdfa", "validate_pdfa", "protect", "password_encrypt", "unlock", "redact", "permanent_remove", "digital_sign", "signature_request", "verify_signatures", "modal_signatures", "audit_trail", "text_watermark", "edit_pdf", "add_text", "add_shapes", "add_annotations", "highlight", "draw", "create_form", "fill_form", "ocr_pdf", "pdf_to_md", "pdf_to_llm_md", "pdf_to_json", "pdf_to_xml", "pdf_to_pptx", "pdf_to_excel", "ocr_to_word", "ocr_to_excel", "workflow", "ai_summarize", "ai_translate", "ai_extract_data", "ai_smart_split"];
const PDF_PAIR_EXCEPTIONS = ["image_watermark", "add_image", "compare_pdf"];

function prettyTarget(value) { return TARGET_LABEL[value] || ""; }
function metaFor(op, tgt) {
  const english = window.PDFForgeLang && window.PDFForgeLang() === "en" && window.PDFForgeMetaEN;
  if (english && english[op]) return english[op];
  if (TOOL_META[op]) return TOOL_META[op];
  const label = prettyTarget(tgt);
  return label
    ? { name: `${T("Konversi ke")} ${label}`, desc: T("Ubah format berkas sesuai pilihan Anda."), action: `${T("Konversi ke")} ${label}` }
    : { name: T("Konversi berkas"), desc: T("Unggah berkas, lalu pilih format tujuan pada menu “Simpan sebagai”."), action: T("Ubah format") };
}
function setConvertLabel(text) { const label = el("convert-label"); if (label) label.textContent = text; }
window.PDFForgeSelectedTool = null;
function applyToolHeader(opOverride) {
  const op = opOverride || el("operation")?.value || "convert";
  const tgt = target.value;
  const selected = window.PDFForgeSelectedTool;
  const fallback = metaFor(op, tgt);
  const matchesSelected = selected && selected.op === op && (op !== "convert" || selected.target === tgt || !state.files.length);
  const meta = matchesSelected
    ? { name: selected.name || fallback.name, desc: selected.desc || fallback.desc, action: selected.action || fallback.action }
    : fallback;
  const title = el("active-tool-title"); if (title) title.textContent = meta.name;
  const desc = el("active-tool-desc"); if (desc) desc.textContent = meta.desc;
  if (!state.pollTimer) setConvertLabel(meta.action);
}
function updateSteps(stage) {
  const steps = document.querySelectorAll("#wb-steps .wb-step");
  if (!steps.length) return;
  const current = stage || (state.files.length ? 2 : 1);
  steps.forEach(step => {
    const n = Number(step.dataset.step);
    step.classList.toggle("done", n < current);
    step.classList.toggle("active", n === current);
  });
}
window.PDFForgeApplyToolUI = function (tool) {
  window.PDFForgeSelectedTool = tool || null;
  applyToolHeader(tool ? tool.op : undefined);
  updateSteps();
  applyAcceptAttribute();
};
function toggleField(field, visible) {
  if (!field) return;
  field.hidden = !visible;
  field.disabled = !visible;
  const label = field.previousElementSibling;
  if (label && label.classList && label.classList.contains("field-label")) label.hidden = !visible;
}
const SOURCE_EXTENSIONS = ["pdf", "docx", "doc", "xlsx", "xls", "pptx", "ppt", "odt", "ods", "odp", "rtf", "txt", "md", "html", "htm", "csv", "json", "xml", "jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff", "tif"];
function applyAcceptAttribute() {
  const op = el("operation")?.value || "convert";
  const needsPdfOnly = PDF_ONLY_OPS.includes(op) && !PDF_PAIR_EXCEPTIONS.includes(op);
  let sources = [];
  if (needsPdfOnly) sources = ["pdf"];
  else if (op === "merge" || PDF_PAIR_EXCEPTIONS.includes(op)) sources = ["pdf", "jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff"];
  else if (state.capabilities.length) {
    const reachingTarget = [...new Set(state.capabilities.filter(c => c.to === target.value).map(c => c.from))];
    sources = reachingTarget.length ? reachingTarget : [...new Set(state.capabilities.map(c => c.from))];
  }
  const accept = sources.filter(source => SOURCE_EXTENSIONS.includes(source)).map(source => "." + source).join(",");
  if (accept) input.setAttribute("accept", accept);
  else input.removeAttribute("accept");
}

function showToast(message) {
  if (!message) return;
  toast.textContent = message; toast.classList.add("show");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("show"), 3400);
}
window.showToast = showToast;
function capabilitiesFor(kind) { return state.capabilities.filter(c => c.from === kind); }
function allowedTargets() {
  if (!state.files.length) return [];
  const common = capabilitiesFor(formatName(state.files[0].name)).map(c => c.to);
  return state.files.slice(1).reduce((allowed, file) => {
    const supported = new Set(capabilitiesFor(formatName(file.name)).map(c => c.to));
    return allowed.filter(format => supported.has(format));
  }, common).sort((a, b) => a.localeCompare(b));
}
function renderTargets(preferred) {
  const formats = allowedTargets();
  const op = el("operation")?.value || "convert";
  const inputPdf = state.files.length > 0 && state.files.every(f => formatName(f.name) === "pdf");
  target.replaceChildren();
  for (const format of formats) {
    const option = document.createElement("option"); option.value = format; option.textContent = format.toUpperCase();
    target.append(option);
  }
  if (!formats.length) {
    const option = document.createElement("option");
    option.textContent = state.files.length ? T("Tidak ada format tujuan yang didukung") : T("Unggah berkas terlebih dahulu");
    target.append(option);
  } else {
    const forced = PDF_OUTPUT_OPS.includes(op) && formats.includes("pdf") ? "pdf" : "";
    if (forced) state.preferredTarget = forced;
    let wanted = forced || preferred || state.preferredTarget;
    if (!wanted || !formats.includes(wanted)) {
      const defaults = inputPdf
        ? ["docx", "xlsx", "pptx", "jpg", "png", "txt", "md", "csv", "json", "xml", "pdf"]
        : ["pdf", "docx", "xlsx", "jpg", "png", "txt", "md", "csv"];
      wanted = defaults.find(format => formats.includes(format)) || formats[0];
    }
    if (wanted && formats.includes(wanted)) target.value = wanted;
  }
  target.disabled = !formats.length;
  button.disabled = !formats.length || !state.files.length;
  const adv = el("advanced-options");
  const allPdf = state.files.length > 0 && state.files.every(f => formatName(f.name) === "pdf");
  const allImages = state.files.length > 0 && state.files.every(f => imageFormats.has(formatName(f.name)));
  const canMerge = state.files.length > 1 && (allPdf || allImages);
  const opSel = el("operation");
  if (opSel) {
    for (const option of opSel.options) {
      if (option.value === "merge") option.disabled = !canMerge;
      else if (PDF_ONLY_OPS.includes(option.value)) option.disabled = !allPdf && !PDF_PAIR_EXCEPTIONS.includes(option.value);
      else if (option.value !== "convert") option.disabled = false;
    }
  }
  const selectedOption = opSel?.selectedOptions?.[0];
  let noteText = "";
  if (state.files.length) {
    if (op === "merge" && !canMerge) {
      noteText = T("Gabung butuh minimal 2 berkas (PDF atau gambar). Tambahkan berkas lagi.");
    } else if (selectedOption?.disabled) {
      noteText = T("Alat ini hanya untuk berkas PDF. Hapus berkas non-PDF atau pilih alat lain.");
    } else if (allPdf || allImages) {
      const selectedCapabilities = state.files.map(file =>
        state.capabilities.find(cap => cap.from === formatName(file.name) && cap.to === target.value));
      const warnings = [...new Set(selectedCapabilities.filter(Boolean).map(cap => cap.warning).filter(Boolean))];
      noteText = warnings.join(" ");
    }
  }
  const noteElement = el("capability-note");
  if (noteElement) { noteElement.textContent = noteText; noteElement.hidden = !noteText; }
  const toolbar = el("file-toolbar"); if (toolbar) toolbar.hidden = !state.files.length;
  if (window.PDFForgeCustom && typeof window.PDFForgeCustom.update === "function") window.PDFForgeCustom.update();
  else if (typeof updateCustomOptions === "function") { try { updateCustomOptions(); } catch {} }
  const settingsRow = el("settings-row"); if (settingsRow) settingsRow.hidden = op !== "convert";
  const outputIsImage = imageFormats.has(target.value);
  const usesPageRange = allPdf && (target.value !== "pdf" || ["split", "remove_pages", "reorder"].includes(op));
  toggleField(el("pages"), usesPageRange);
  toggleField(el("quality"), outputIsImage);
  toggleField(el("dpi"), allPdf && outputIsImage);
  if (adv) adv.hidden = !(usesPageRange || outputIsImage);
  applyToolHeader(op);
  updateSteps();
  applyAcceptAttribute();
}
function renderFiles() {
  list.replaceChildren(); list.hidden = !state.files.length;
  state.files.forEach((file, index) => {
    const row = document.createElement("div"); row.className = "file-row";
    const ext = document.createElement("span"); ext.className = "file-ext"; ext.textContent = formatName(file.name).toUpperCase();
    const name = document.createElement("span"); name.className = "file-name"; name.textContent = displayName(file.name); name.title = file.name;
    const size = document.createElement("small"); size.textContent = prettySize(file.size);
    const up = document.createElement("button"); up.type = "button"; up.textContent = "↑"; up.title = T("Naikkan urutan"); up.setAttribute("aria-label", `${T("Naikkan urutan")}: ${file.name}`); up.disabled = index === 0;
    up.addEventListener("click", () => { [state.files[index - 1], state.files[index]] = [state.files[index], state.files[index - 1]]; renderFiles(); });
    const down = document.createElement("button"); down.type = "button"; down.textContent = "↓"; down.title = T("Turunkan urutan"); down.setAttribute("aria-label", `${T("Turunkan urutan")}: ${file.name}`); down.disabled = index === state.files.length - 1;
    down.addEventListener("click", () => { [state.files[index], state.files[index + 1]] = [state.files[index + 1], state.files[index]]; renderFiles(); });
    const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "×"; remove.title = T("Hapus berkas"); remove.setAttribute("aria-label", `${T("Hapus berkas")}: ${file.name}`);
    remove.addEventListener("click", () => { state.files.splice(index, 1); renderFiles(); renderTargets(); });
    row.append(ext, name, size, up, down, remove); list.append(row);
  });
  dropzone.classList.toggle("has-files", state.files.length > 0);
  const organizeButton = el("organize-pages-btn");
  if (organizeButton) organizeButton.hidden = !state.files.some(file => formatName(file.name) === "pdf");
  updateSteps();
}
function addFiles(files) {
  const next = Array.from(files);
  if (state.files.length + next.length > state.maxFiles) return showToast(T("Satu proses dapat memuat maksimal {n} berkas demi kestabilan server.", { n: state.maxFiles }));
  for (const file of next) {
    if (file.size > state.maxUpload) return showToast(T("{name} melampaui batas teknis {size} per berkas.", { name: displayName(file.name), size: prettySize(state.maxUpload) }));
    if (!state.files.some(existing => existing.name === file.name && existing.size === file.size)) state.files.push(file);
  }
  renderFiles(); renderTargets();
}
input.addEventListener("change", () => { addFiles(input.files); input.value = ""; });
for (const event of ["dragenter", "dragover"]) dropzone.addEventListener(event, e => { e.preventDefault(); dropzone.classList.add("dragover"); });
for (const event of ["dragleave", "drop"]) dropzone.addEventListener(event, e => { e.preventDefault(); dropzone.classList.remove("dragover"); });
dropzone.addEventListener("drop", e => addFiles(e.dataTransfer.files));
target.addEventListener("change", () => {
  state.preferredTarget = target.value;
  const formats = new Set(state.files.map(f => formatName(f.name)));
  el("operation").value = formats.size > 1 ? "convert" : el("operation").value;
  if (formats.size > 1) window.PDFForgeSelectedTool = null;
  renderTargets(target.value);
});
document.querySelectorAll(".tool-card").forEach(card => card.addEventListener("click", () => {
  const preset = card.dataset.preset;
  const presets = {
    "pdf-pdf": { op: "merge", target: "pdf" },
    "pdf-image": { op: "convert", target: "png" },
    "any-pdf": { op: "convert", target: "pdf" },
    "office-pdf": { op: "convert", target: "pdf" },
    "pdf-text": { op: "convert", target: "txt" },
    "image-image": { op: "convert", target: "jpg" }
  };
  const choice = presets[preset];
  if (choice) {
    const opSel = el("operation");
    if (opSel) opSel.value = choice.op;
    state.preferredTarget = choice.target;
    window.PDFForgeSelectedTool = null;
  }
  if (state.files.length) renderTargets();
  else { applyToolHeader(); applyAcceptAttribute(); }
  document.querySelector("#converter").scrollIntoView({ behavior: "smooth" });
  input.click();
}));
el("change-tool-btn")?.addEventListener("click", () => {
  document.getElementById("tools")?.scrollIntoView({ behavior: "smooth" });
  setTimeout(() => el("tool-search-input")?.focus(), 420);
});
const OP_TARGET = { validate_pdfa: "json", audit_trail: "json", compare_pdf: "json", ai_extract_data: "json", pdf_to_json: "json", verify_signatures: "json", ai_summarize: "md", pdf_to_llm_md: "md", pdf_to_md: "md", pdf_to_xml: "xml", pdf_to_pptx: "pptx", ocr_to_word: "docx", ocr_to_excel: "xlsx", pdf_to_excel: "xlsx" };
el("operation").addEventListener("change", () => {
  const op = el("operation").value;
  window.PDFForgeSelectedTool = null;
  const want = OP_TARGET[op];
  if (want && target.querySelector(`option[value="${want}"]`)) { target.value = want; state.preferredTarget = want; }
  else if (op !== "convert" && !OP_TARGET[op]) {
    if ([...target.options].some(o => o.value === "pdf")) { target.value = "pdf"; state.preferredTarget = "pdf"; }
  }
  renderTargets(target.value);
});
function progressView() {
  let panel = document.querySelector(".processing");
  if (!panel) {
    panel = document.createElement("div"); panel.className = "processing";
    const label = document.createElement("div"); label.className = "processing-label";
    const track = document.createElement("div"); track.className = "progress-track";
    const fill = document.createElement("div"); fill.className = "progress-fill"; track.append(fill);
    const cancel = document.createElement("button"); cancel.type = "button"; cancel.className = "progress-cancel";
    cancel.hidden = true; cancel.textContent = T("Batalkan proses");
    cancel.addEventListener("click", cancelCurrentJob);
    panel.append(label, track, cancel); button.before(panel);
  }
  return panel;
}
async function cancelCurrentJob() {
  if (!state.jobId) return;
  const cancel = document.querySelector(".processing .progress-cancel");
  if (cancel) { cancel.disabled = true; cancel.textContent = T("Membatalkan…"); }
  try {
    await fetch(`/api/jobs/${encodeURIComponent(state.jobId)}/cancel`, { method: "POST" });
  } catch {
    if (cancel) { cancel.disabled = false; cancel.textContent = T("Batalkan proses"); }
  }
}
async function createJob() {
  const operation = el("operation").value;
  if (operation === "merge" && state.files.length < 2) return showToast(T("Gabung membutuhkan minimal 2 berkas PDF (atau gambar)."));
  if (operation === "merge" && state.files.some(file => formatName(file.name) !== "pdf" && !imageFormats.has(formatName(file.name)))) {
    return showToast(T("Penggabungan memerlukan berkas PDF atau gambar yang didukung."));
  }
  if (PDF_ONLY_OPS.includes(operation) && !PDF_PAIR_EXCEPTIONS.includes(operation) && state.files.some(file => formatName(file.name) !== "pdf")) {
    return showToast(T("Alat ini hanya untuk berkas PDF. Pilih berkas PDF atau ganti alat."));
  }
  const form = new FormData();
  state.files.forEach(file => form.append("files", file, file.name));
  form.append("target", target.value);
  if (operation !== "convert") form.append("operation", operation);
  form.append("page_range", el("pages") ? el("pages").value : "");
  form.append("quality", el("quality") ? el("quality").value : "85");
  form.append("dpi", el("dpi") ? el("dpi").value : "144");
  const addedFields = new Set(["files", "target", "operation", "page_range", "quality", "dpi"]);
  document.querySelectorAll("#custom-tool-options [name]").forEach(field => {
    if (field.value === "" || addedFields.has(field.name)) return;
    addedFields.add(field.name);
    form.append(field.name, field.value);
  });
  button.disabled = true; setConvertLabel(T("Mengunggah…")); updateSteps(2);
  document.querySelector(".processing.result-card")?.remove();
  const panel = progressView(); panel.querySelector(".processing-label").textContent = T("Mengunggah berkas dengan aman…");
  try {
    const response = await fetch("/api/jobs", { method: "POST", body: form });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || T("Berkas tidak dapat diproses."));
    state.jobId = data.id; state.jobStartedAt = Date.now();
    const cancel = panel.querySelector(".progress-cancel");
    if (cancel) { cancel.hidden = false; cancel.disabled = false; cancel.textContent = T("Batalkan proses"); }
    pollJob(data.id);
  } catch (error) {
    button.disabled = false; updateSteps(2); panel.remove(); renderTargets(); showToast(error.message);
  }
}
async function pollJob(id) {
  if (state.pollTimer) clearInterval(state.pollTimer);
  state.pollTimer = null;
  const tick = async () => {
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`);
      const job = await response.json();
      if (!response.ok) throw new Error(job.error || T("Status proses tidak tersedia."));
      const panel = progressView(), label = panel.querySelector(".processing-label"), fill = panel.querySelector(".progress-fill");
      let text = job.status === "queued" ? T("Menunggu giliran diproses…") : `${T(job.message)} · ${job.progress}%`;
      if (job.status === "processing" && job.progress > 8 && state.jobStartedAt) {
        const elapsed = (Date.now() - state.jobStartedAt) / 1000;
        text += ` · ±${Math.max(1, Math.round(elapsed * (100 - job.progress) / job.progress))}s ${T("tersisa")}`;
      }
      label.textContent = text;
      fill.style.width = `${job.progress}%`;
      if (job.status === "completed") {
        clearInterval(state.pollTimer); state.pollTimer = null; state.jobId = null; state.jobStartedAt = null;
        panel.remove(); button.disabled = true;
        state.files = []; renderFiles(); renderTargets(); updateSteps(3);
        showToast(`${T("Selesai")} — ${job.outputs?.length || 1} ${T("berkas siap diunduh")}.`);
        if (job.warnings?.length) showToast(job.warnings[0]);
        refreshHistory(); showResult(job);
      } else if (job.status === "failed") {
        clearInterval(state.pollTimer); state.pollTimer = null; state.jobId = null; state.jobStartedAt = null;
        panel.remove(); renderTargets(); updateSteps(2); showToast(job.error || T("Proses gagal."));
        refreshHistory();
      } else if (job.status === "cancelled") {
        clearInterval(state.pollTimer); state.pollTimer = null; state.jobId = null; state.jobStartedAt = null;
        panel.remove(); button.disabled = false; renderTargets(); updateSteps(2);
        showToast(T("Proses dibatalkan. Berkas Anda masih ada — coba lagi kapan saja."));
        refreshHistory();
      }
    } catch (error) {
      clearInterval(state.pollTimer); state.pollTimer = null; state.jobId = null;
      document.querySelector(".processing:not(.result-card)")?.remove(); renderTargets(); updateSteps(2); showToast(error.message);
    }
  };
  await tick();
  // Only keep polling if the job is still active (avoid a stray tick after instant completion).
  if (state.jobId === id) state.pollTimer = setInterval(tick, 900);
}
function showResult(job) {
  state.lastJob = job;
  const panel = progressView();
  panel.className = "processing result-card";
  const count = job.outputs?.length || 1;
  panel.innerHTML = `<div class="processing-label result-title">✓ ${T("Selesai")} — ${count} ${T("berkas siap diunduh")}</div>`;
  const actions = document.createElement("div"); actions.className = "result-actions";
  const link = document.createElement("a"); link.href = `/api/jobs/${encodeURIComponent(job.id)}/download`;
  link.className = "convert-button"; link.style.textDecoration = "none";
  link.innerHTML = `<span>${count > 1 ? `${T("Unduh semua")} (${count} ${T("berkas")} · ZIP)` : T("Unduh hasil")}</span><span>↓</span>`;
  actions.append(link);
  const again = document.createElement("button"); again.type = "button"; again.className = "text-button"; again.textContent = T("Proses berkas lain");
  again.addEventListener("click", () => { panel.remove(); dropzone.scrollIntoView({ behavior: "smooth" }); input.click(); });
  actions.append(again);
  const prev = document.createElement("button"); prev.type = "button"; prev.className = "text-button"; prev.textContent = T("Pratinjau");
  prev.addEventListener("click", () => { if (window.openDocumentInReader) window.openDocumentInReader(job.id); else window.open(`/api/jobs/${encodeURIComponent(job.id)}/preview`, "_blank"); });
  actions.append(prev);
  const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-button"; remove.textContent = T("Hapus sekarang");
  remove.addEventListener("click", () => deleteJob(job.id, panel)); actions.append(remove);
  panel.append(actions);
  if (job.warnings?.length) {
    const warning = document.createElement("p"); warning.className = "terms"; warning.textContent = job.warnings.join(" "); panel.append(warning);
  }
  setTimeout(() => panel.remove(), 60000);
}
async function deleteJob(id, container) {
  try {
    const response = await fetch(`/api/jobs/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error || T("Berkas tidak dapat dihapus sekarang."));
    }
    container.remove(); showToast(T("Berkas dan riwayatnya telah dihapus.")); refreshHistory();
  } catch (error) {
    showToast(error.message); refreshHistory();
  }
}
button.addEventListener("click", createJob);
async function refreshHistory() {
  const container = el("history-list");
  try {
    const response = await fetch("/api/history"); if (!response.ok) return;
    const items = await response.json(); container.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p"); empty.className = "empty-history"; empty.textContent = T("Belum ada pekerjaan. Unggah berkas untuk memulai — hasil akan muncul di sini."); container.append(empty); return;
    }
    for (const item of items) {
      const row = document.createElement("div"); row.className = "history-item";
      const symbol = document.createElement("span"); symbol.className = "history-symbol";
      symbol.textContent = item.status === "completed" ? "✓" : item.status === "cancelled" ? "×" : "↻";
      const details = document.createElement("span");
      const title = document.createElement("strong"); title.textContent = item.files?.map(f => f.name).join(", ") || T("Pekerjaan PDFForge");
      const statusText = item.status === "completed" ? T("Selesai") : item.status === "failed" ? T("Gagal") : item.status === "cancelled" ? T("Dibatalkan") : T("Diproses");
      const locale = window.PDFForgeLang && window.PDFForgeLang() === "en" ? "en-US" : "id-ID";
      const meta = document.createElement("small"); meta.textContent = `${statusText} · ${T("ke")} ${item.target.toUpperCase()} · ${new Date(item.created_at).toLocaleString(locale)}`;
      details.append(title, meta); row.append(symbol, details);
      if (item.status === "completed") {
        const link = document.createElement("a"); link.href = `/api/jobs/${encodeURIComponent(item.id)}/download`; link.textContent = `${T("Unduh")} ↓`; row.append(link); const pv = document.createElement("button"); pv.type = "button"; pv.className = "text-button"; pv.textContent = T("Pratinjau"); pv.addEventListener("click", () => { if (window.openDocumentInReader) window.openDocumentInReader(item.id); }); row.append(pv);
      }
      if (item.status === "completed" || item.status === "failed" || item.status === "cancelled") {
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "text-button";
        remove.textContent = T("Hapus"); remove.setAttribute("aria-label", `${T("Hapus")} ${title.textContent}`);
        remove.addEventListener("click", () => deleteJob(item.id, row)); row.append(remove);
      }
      container.append(row);
    }
  } catch {}
}
el("refresh-history").addEventListener("click", refreshHistory);
async function initialize() {
  try {
    const [capsResponse, healthResponse] = await Promise.all([fetch("/api/capabilities"), fetch("/api/health")]);
    if (capsResponse.ok) {
      const data = await capsResponse.json(); state.capabilities = data.formats;
      state.maxUpload = data.max_upload_bytes; state.maxFiles = data.max_files_per_job;
      const limits = el("drop-limits");
      if (limits && state.maxFiles && state.maxUpload) {
        limits.textContent = `${T("Maks.")} ${state.maxFiles} ${T("berkas")} · ${T("hingga")} ${Math.round(state.maxUpload / (1024 * 1024))} MB ${T("per berkas")}`;
        limits.hidden = false;
      }
      if (data.malware_scan_enabled) el("privacy-scan-note").textContent = T("File dipindai antivirus sebelum diproses.");
      el("file-input").setAttribute("aria-label", `${T("Pilih maksimum")} ${state.maxFiles} ${T("berkas")}`);
    }
    const status = el("engine-status");
    if (healthResponse.ok) { status.className = "engine-status online"; status.innerHTML = `<i></i> ${T("Mesin konversi aktif")}`; }
    else { status.className = "engine-status offline"; status.innerHTML = `<i></i> ${T("Mesin konversi terbatas")}`; }
  } catch {
    el("engine-status").className = "engine-status offline"; el("engine-status").innerHTML = `<i></i> ${T("Server tidak terhubung")}`;
  }
  renderTargets();
  refreshHistory();
}
initialize();
