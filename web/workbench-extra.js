/* PDFForge workbench extras: dynamic options, toolbar, context menu, theme, i18n bridge */
(function () {
  "use strict";
  const tr = (text, vars) => (window.PDFForgeT ? window.PDFForgeT(text, vars) : text);
  function field(label, inner) {
    return '<div class="custom-field"><label class="field-label">' + label + '</label>' + inner + '</div>';
  }
  function grid2(a, b) {
    return '<div class="custom-fields-grid">' + a + b + '</div>';
  }
  function hint(text) {
    return '<p class="field-hint">' + text + '</p>';
  }
  function translateBlock(html) {
    if (!window.PDFForgeT || !window.PDFForgeLang || window.PDFForgeLang() !== "en") return html;
    const holder = document.createElement("template");
    holder.innerHTML = html;
    holder.content.querySelectorAll("*").forEach(node => {
      if (!node.children.length && node.textContent.trim()) {
        const translated = window.PDFForgeT(node.textContent);
        if (translated !== node.textContent) node.textContent = translated;
      }
      for (const attr of ["placeholder", "value", "title", "aria-label"]) {
        if (node.hasAttribute(attr)) {
          const original = node.getAttribute(attr);
          const translated = window.PDFForgeT(original);
          if (translated !== original) node.setAttribute(attr, translated);
        }
      }
    });
    return holder.innerHTML;
  }
  function updateCustomOptions() {
    const box = document.getElementById("custom-tool-options");
    const opSel = document.getElementById("operation");
    if (!box || !opSel) return;
    const op = opSel.value;
    let html = "";
    if (op === "protect" || op === "password_encrypt") {
      html = field("KATA SANDI PDF (MINIMAL 4 KARAKTER)", '<input type="password" name="protect_password" class="input-styled" placeholder="Contoh: Rahasia2026" minlength="4" autocomplete="new-password">') +
        hint("Simpan kata sandi ini — tanpa kata sandi, PDF tidak bisa dibuka lagi.");
    } else if (op === "unlock") {
      html = field("KATA SANDI SAAT INI", '<input type="password" name="unlock_password" class="input-styled" placeholder="Kata sandi yang membuka PDF ini">');
    } else if (op === "split") {
      html = field("CARA MEMISAH", '<select name="split_mode" class="input-styled"><option value="">Halaman yang dipilih saja</option><option value="individual">Setiap halaman jadi berkas sendiri (ZIP)</option><option value="every_n">Setiap N halaman jadi satu berkas (ZIP)</option></select>') +
        field("N (BERAPA HALAMAN PER BERKAS)", '<input type="number" name="split_n" class="input-styled" value="5" min="1" max="500">') +
        hint("Untuk mengambil halaman tertentu, isi kolom “Halaman” di atas (contoh: 1-3, 5).");
    } else if (op === "smart_split" || op === "ai_smart_split") {
      html = field("CARA MEMISAH", '<select name="split_mode" class="input-styled"><option value="individual">Setiap halaman jadi berkas sendiri (ZIP)</option><option value="every_n">Setiap N halaman jadi satu berkas (ZIP)</option></select>') +
        field("N (BERAPA HALAMAN PER BERKAS)", '<input type="number" name="split_n" class="input-styled" value="5" min="1" max="500">');
    } else if (op === "reorder") {
      html = field("URUTAN HALAMAN BARU", '<input type="text" name="page_order" class="input-styled" placeholder="Contoh: 3,1,2 atau 2-4,1" required>');
    } else if (op === "remove_pages") {
      html = field("HALAMAN YANG DIHAPUS", '<input type="text" name="remove_pages" class="input-styled" placeholder="Contoh: 2,5-6" required>');
    } else if (op === "organize") {
      html = grid2(
        field("URUTAN BARU (OPSIONAL)", '<input type="text" name="page_order" class="input-styled" placeholder="Contoh: 3,1,2">'),
        field("HALAMAN YANG DIHAPUS (OPSIONAL)", '<input type="text" name="remove_pages" class="input-styled" placeholder="Contoh: 5-6">')
      ) + field("PUTAR HALAMAN (OPSIONAL)", '<select name="rotation" class="input-styled"><option value="0">Tidak diputar</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select>');
    } else if (op === "rotate") {
      html = field("PUTAR SEARAH JARUM JAM", '<select name="rotation" class="input-styled"><option value="90">90 derajat</option><option value="180">180 derajat</option><option value="270">270 derajat</option></select>');
    } else if (op === "crop") {
      html = field("BESAR MARGIN YANG DIPANGKAS (POIN 0-300)", '<input type="number" name="crop_margin" class="input-styled" value="36" min="0" max="300">') +
        hint("Semakin besar angkanya, semakin banyak tepi halaman yang dipotong.");
    } else if (op === "page_numbers") {
      html = grid2(
        field("FORMAT NOMOR", '<select name="number_format" class="input-styled"><option>Page 1 of N</option><option>Page 1</option><option>1</option></select>'),
        field("POSISI NOMOR", '<select name="number_position" class="input-styled"><option value="bottom-center">Bawah tengah</option><option value="bottom-left">Bawah kiri</option><option value="bottom-right">Bawah kanan</option><option value="top-center">Atas tengah</option><option value="top-left">Atas kiri</option><option value="top-right">Atas kanan</option></select>')
      );
    } else if (op === "compress") {
      html = field("TINGKAT KOMPRESI", '<select name="compress_level" class="input-styled"><option value="recommended">Direkomendasikan (aman)</option><option value="extreme">Paling kecil (kualitas gambar turun)</option><option value="balanced">Seimbang</option><option value="high">Kualitas tinggi (berkas lebih besar)</option></select>');
    } else if (op === "redact") {
      html = field("KATA / DATA YANG DISENSOR (PISAH KOMA)", '<input type="text" name="redact_terms" class="input-styled" placeholder="Contoh: NIK, rahasia, 0812..." required>') +
        hint("Kata tersebut akan dihapus dari teks, bukan hanya ditutup kotak hitam.");
    } else if (op === "permanent_remove") {
      html = field("SANITASI", '<input type="text" class="input-styled" disabled value="Metadata + anotasi dibersihkan otomatis">');
    } else if (op === "text_watermark") {
      html = grid2(
        field("TEKS WATERMARK", '<input type="text" name="watermark_text" class="input-styled" value="CONFIDENTIAL">'),
        field("TRANSPARANSI (0.05 - 1)", '<input type="number" name="watermark_opacity" class="input-styled" value="0.25" step="0.05" min="0.05" max="1">')
      ) + grid2(
        field("UKURAN TEKS (8-200)", '<input type="number" name="watermark_size" class="input-styled" value="48" min="8" max="200">'),
        field("KEMIRINGAN (-180 s.d. 180)", '<input type="number" name="watermark_rotation" class="input-styled" value="45" min="-180" max="180">')
      ) + grid2(
        field("POSISI", '<select name="watermark_position" class="input-styled"><option value="center">Tengah halaman</option><option value="tiled">Ubin (penuh halaman)</option><option value="top-left">Kiri atas</option><option value="top-center">Atas tengah</option><option value="top-right">Kanan atas</option><option value="bottom-left">Kiri bawah</option><option value="bottom-center">Bawah tengah</option><option value="bottom-right">Kanan bawah</option></select>'),
        field("WARNA", '<select name="watermark_color" class="input-styled"><option value="888888">Abu-abu</option><option value="ff0000">Merah</option><option value="000000">Hitam</option><option value="1a4d8f">Biru</option></select>')
      ) + hint("Untuk banyak berkas sekaligus: unggah hingga 20 PDF, watermark diterapkan ke semuanya.");
    } else if (op === "image_watermark" || op === "add_image") {
      html = field("CARA MENAMBAH GAMBAR", '<input type="text" class="input-styled" disabled value="Unggah PDF dulu, lalu gambar (urutan: PDF pertama, gambar kedua)">') +
        grid2(field("TRANSPARANSI", '<input type="number" name="watermark_opacity" class="input-styled" value="0.3" step="0.05" min="0.05" max="1">'),
        field("POSISI", '<select name="watermark_position" class="input-styled"><option value="center">Tengah</option><option value="tiled">Ubin</option><option value="bottom-right">Kanan bawah</option><option value="top-right">Kanan atas</option></select>'));
    } else if (op === "add_text" || op === "edit_pdf") {
      html = grid2(field("TEKS", '<input type="text" name="text" class="input-styled" placeholder="Teks yang ditambahkan…" required>'),
        field("UKURAN FONT", '<input type="number" name="font_size" class="input-styled" value="14" min="6" max="200">')) +
        grid2(field("POSISI X", '<input type="number" name="x" class="input-styled" value="72">'),
        field("POSISI Y", '<input type="number" name="y" class="input-styled" value="72">')) +
        grid2(field("WARNA", '<select name="color" class="input-styled"><option value="000000">Hitam</option><option value="ff0000">Merah</option><option value="1a4d8f">Biru</option></select>'),
        field("HALAMAN (all/1-3)", '<input type="text" name="page" class="input-styled" value="1">'));
    } else if (op === "highlight") {
      html = field("KATA YANG INGIN DISOROT", '<input type="text" name="highlight_term" class="input-styled" placeholder="Contoh: penting, rahasia…" required>');
    } else if (op === "add_shapes") {
      html = grid2(field("BENTUK", '<select name="shape" class="input-styled"><option value="rect">Kotak</option><option value="circle">Lingkaran</option><option value="line">Garis</option></select>'),
        field("WARNA", '<select name="color" class="input-styled"><option value="ff0000">Merah</option><option value="000000">Hitam</option><option value="1a4d8f">Biru</option></select>'));
    } else if (op === "add_annotations") {
      html = field("ISI CATATAN", '<input type="text" name="text" class="input-styled" placeholder="Catatan yang ditempel…" required>');
    } else if (op === "create_form") {
      html = grid2(field("NAMA KOLOM", '<input type="text" name="field_name" class="input-styled" value="nama">'),
        field("JENIS KOLOM", '<select name="field_type" class="input-styled"><option value="text">Teks</option><option value="checkbox">Kotak centang</option><option value="radio">Pilihan (radio)</option><option value="dropdown">Menu dropdown</option></select>')) +
        field("PILIHAN DROPDOWN (PISAH KOMA)", '<input type="text" name="field_options" class="input-styled" value="Opsi A,Opsi B">');
    } else if (op === "fill_form") {
      html = field('DATA FORMULIR (CONTOH: {"nama":"Budi"})', '<input type="text" name="fill_data" class="input-styled" placeholder=\'{"nama":"Budi"}\'>');
    } else if (op === "digital_sign" || op === "signature_request") {
      html = grid2(field("NAMA PENANDATANGAN", '<input type="text" name="signer_name" class="input-styled" placeholder="Nama / instansi">'),
        field("ALASAN", '<input type="text" name="sign_reason" class="input-styled" value="Persetujuan dokumen">'));
    } else if (op === "ai_translate") {
      html = field("BAHASA TUJUAN", '<select name="target_lang" class="input-styled"><option value="id">Bahasa Indonesia</option><option value="en">English (US)</option><option value="ja">Jepang</option><option value="zh">Mandarin</option><option value="de">Jerman</option><option value="fr">Prancis</option></select>');
    } else if (op === "ai_summarize" || op === "ai_extract_data") {
      html = field("INSTRUKSI (OPSIONAL)", '<input type="text" name="ai_prompt" class="input-styled" placeholder="Contoh: fokus pada total biaya dan tenggat">');
    } else if (op === "workflow") {
      html = field("URUTAN LANGKAH (PISAH KOMA)", '<input type="text" name="workflow_steps" class="input-styled" value="compress,text_watermark,page_numbers">') +
        hint("Terisi otomatis saat Anda memakai builder “Alur kerja”. Langkah yang didukung: compress, text_watermark, page_numbers, protect, redact, repair, rotate, crop, digital_sign.");
    } else if (op === "compare_pdf") {
      html = field("CARA BANDING", '<input type="text" class="input-styled" disabled value="Unggah tepat 2 berkas PDF untuk dibandingkan">');
    }
    box.innerHTML = translateBlock(html);
    box.hidden = !html;
  }
  window.PDFForgeCustom = { update: updateCustomOptions };
  window.updateCustomOptions = updateCustomOptions;

  function setTool(op, tgt, label, toolInfo) {
    const opSel = document.getElementById("operation");
    const tg = document.getElementById("target");
    if (opSel) {
      let opt = Array.from(opSel.options).find(o => o.value === op);
      if (!opt) { opt = document.createElement("option"); opt.value = op; opt.textContent = label || op; opSel.appendChild(opt); }
      opSel.value = op;
    }
    if (tg && tgt) {
      let opt = Array.from(tg.options).find(o => o.value === tgt);
      if (!opt) { opt = document.createElement("option"); opt.value = tgt; opt.textContent = tgt.toUpperCase(); tg.appendChild(opt); }
      tg.value = tgt;
      if (window.state) window.state.preferredTarget = tgt;
    }
    const info = toolInfo || (window.PDF_TOOLS_100 || []).find(t => t.op === op && (!tgt || t.target === tgt)) || null;
    if (window.PDFForgeApplyToolUI) {
      window.PDFForgeApplyToolUI(info ? { op, target: tgt || info.target, name: label || info.name, desc: info.desc, id: info.id } : { op, target: tgt });
    }
    if (window.state && window.state.files && window.state.files.length && typeof renderTargets === "function") renderTargets();
    updateCustomOptions();
    document.getElementById("converter")?.scrollIntoView({ behavior: "smooth" });
  }
  window.PDFForge = Object.assign(window.PDFForge || {}, { setTool, updateCustomOptions });

  function showContextMenu(e, index) {
    e.preventDefault();
    const menu = document.getElementById("context-menu");
    if (!menu || !window.state) return;
    menu.innerHTML = "";
    const items = [[tr("Ke atas"), () => { if (index > 0) { const s = window.state.files; [s[index - 1], s[index]] = [s[index], s[index - 1]]; } }], [tr("Ke bawah"), () => { const s = window.state.files; if (index < s.length - 1) [s[index + 1], s[index]] = [s[index], s[index + 1]]; }], [tr("Hapus"), () => { window.state.files.splice(index, 1); }]];
    items.forEach(([label, fn]) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = label;
      b.addEventListener("click", () => { fn(); menu.hidden = true; document.dispatchEvent(new Event("pdfforge:files")); });
      menu.appendChild(b);
    });
    menu.hidden = false;
    menu.style.left = Math.min(e.clientX, innerWidth - 180) + "px";
    menu.style.top = e.clientY + "px";
  }
  window.showContextMenu = showContextMenu;
  document.addEventListener("click", () => { const m = document.getElementById("context-menu"); if (m) m.hidden = true; });
  document.addEventListener("pdfforge:files", () => { try { if (typeof renderFiles === "function") renderFiles(); } catch {} try { if (typeof renderTargets === "function") renderTargets(); else if (window.renderTargets) window.renderTargets(); } catch {} });

  document.addEventListener("DOMContentLoaded", () => {
    try {
      const themeBtn = document.getElementById("theme-toggle-btn");
      const saved = localStorage.getItem("pdfforge_theme") || "light";
      document.documentElement.dataset.theme = saved;
      themeBtn?.addEventListener("click", () => {
        const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        localStorage.setItem("pdfforge_theme", next);
      });
      document.getElementById("sort-name-btn")?.addEventListener("click", () => { if (window.state) window.state.files.sort((a, b) => a.name.localeCompare(b.name)); document.dispatchEvent(new Event("pdfforge:files")); });
      document.getElementById("sort-size-btn")?.addEventListener("click", () => { if (window.state) window.state.files.sort((a, b) => a.size - b.size); document.dispatchEvent(new Event("pdfforge:files")); });
      document.getElementById("clear-files-btn")?.addEventListener("click", () => {
        if (window.state) window.state.files = [];
        if (typeof renderFiles === "function") renderFiles();
        if (typeof renderTargets === "function") renderTargets();
      });
      document.getElementById("add-more-btn")?.addEventListener("click", () => document.getElementById("file-input")?.click());
      document.getElementById("operation")?.addEventListener("change", updateCustomOptions);
      updateCustomOptions();
    } catch (err) { console.warn(err); }
  });
})();
