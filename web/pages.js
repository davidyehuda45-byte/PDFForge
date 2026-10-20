/* PDFForge — penyusun halaman visual: pratinjau thumbnail, susun ulang, hapus/ kembalikan halaman. */
(function () {
  "use strict";

  var T = function (text, vars) { return window.PDFForgeT ? window.PDFForgeT(text, vars) : text; };
  var overlay = null;
  var cards = [];
  var dragIndex = -1;
  var selectedIndex = -1;
  var activeFileKey = "";

  var EYE_OPEN = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="2.6"/></svg>';
  var EYE_OFF = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18"/><path d="M2 12s3.5-6 10-6c2 0 3.7.6 5.1 1.5M22 12s-3.5 6-10 6c-2 0-3.7-.6-5.1-1.5"/></svg>';

  function showToast(message) {
    if (typeof window.showToast === "function") { window.showToast(message); return; }
    var toast = document.getElementById("toast");
    if (toast) { toast.textContent = message; toast.classList.add("show"); setTimeout(function () { toast.classList.remove("show"); }, 3200); }
  }

  function pdfFiles() {
    var files = (window.state && window.state.files) || [];
    return files.filter(function (file) { return /\.pdf$/i.test(file.name) || file.type === "application/pdf"; });
  }

  function build() {
    if (overlay) return overlay;
    overlay = document.createElement("div");
    overlay.id = "page-organizer";
    overlay.className = "po-overlay";
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="po-window" role="dialog" aria-modal="true">' +
        '<div class="po-head">' +
          '<div class="po-title"><strong>' + T("Susun Halaman PDF") + '</strong><small id="po-file"></small></div>' +
          '<button type="button" class="po-close" aria-label="' + T("Tutup") + '">×</button>' +
        '</div>' +
        '<p class="po-help">' + T("Seret kartu untuk mengubah urutan, atau klik dua halaman untuk menukar posisinya. Klik ikon mata untuk menyembunyikan halaman.") + '</p>' +
        '<div class="po-toolbar">' +
          '<button type="button" class="btn-sm ghost" id="po-restore">' + T("Tampilkan semua") + '</button>' +
          '<button type="button" class="btn-sm ghost" id="po-reverse">' + T("Balik urutan") + '</button>' +
          '<span class="po-count" id="po-count"></span>' +
        '</div>' +
        '<div class="po-grid" id="po-grid"><p class="po-loading">' + T("Memuat pratinjau halaman…") + '</p></div>' +
        '<div class="po-foot">' +
          '<button type="button" class="btn-sm ghost" id="po-cancel">' + T("Batal") + '</button>' +
          '<button type="button" class="btn-primary" id="po-apply">' + T("Terapkan urutan") + '</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    overlay.querySelector(".po-close").addEventListener("click", close);
    overlay.querySelector("#po-cancel").addEventListener("click", close);
    overlay.addEventListener("click", function (event) { if (event.target === overlay) close(); });
    overlay.querySelector("#po-restore").addEventListener("click", function () {
      cards.forEach(function (card) { card.removed = false; });
      render();
    });
    overlay.querySelector("#po-reverse").addEventListener("click", function () {
      cards.reverse();
      render();
    });
    overlay.querySelector("#po-apply").addEventListener("click", apply);
    return overlay;
  }

  function render() {
    var grid = overlay.querySelector("#po-grid");
    grid.innerHTML = "";
    cards.forEach(function (card, index) {
      var node = document.createElement("div");
      node.className = "po-card" + (card.removed ? " removed" : "") + (selectedIndex === index ? " selected" : "");
      node.draggable = true;
      node.dataset.index = String(index);
      node.innerHTML =
        '<img alt="" loading="lazy" src="data:image/jpeg;base64,' + card.image + '">' +
        '<span class="po-num">' + card.page + '</span>' +
        '<button type="button" class="po-eye" title="' + (card.removed ? T("Kembalikan halaman") : T("Halaman dihapus")) + '" aria-label="' + (card.removed ? T("Kembalikan halaman") : T("Halaman dihapus")) + '">' + (card.removed ? EYE_OFF : EYE_OPEN) + '</button>';

      node.addEventListener("click", function (event) {
        if (event.target.closest(".po-eye")) {
          card.removed = !card.removed;
          render();
          return;
        }
        if (selectedIndex === -1) { selectedIndex = index; render(); return; }
        if (selectedIndex === index) { selectedIndex = -1; render(); return; }
        var swapped = cards[selectedIndex];
        cards[selectedIndex] = cards[index];
        cards[index] = swapped;
        selectedIndex = -1;
        render();
      });
      node.addEventListener("dragstart", function (event) {
        dragIndex = index;
        try { event.dataTransfer.setData("text/plain", String(index)); } catch (e) { /* ignore */ }
        event.dataTransfer.effectAllowed = "move";
      });
      node.addEventListener("dragover", function (event) { event.preventDefault(); node.classList.add("dragover"); });
      node.addEventListener("dragleave", function () { node.classList.remove("dragover"); });
      node.addEventListener("drop", function (event) {
        event.preventDefault();
        node.classList.remove("dragover");
        if (dragIndex === -1 || dragIndex === index) return;
        var moved = cards.splice(dragIndex, 1)[0];
        cards.splice(index, 0, moved);
        dragIndex = -1;
        selectedIndex = -1;
        render();
      });
      grid.appendChild(node);
    });
    var kept = cards.filter(function (card) { return !card.removed; }).length;
    var counter = overlay.querySelector("#po-count");
    if (counter) counter.textContent = kept + " / " + cards.length + " " + T("halaman");
  }

  async function open() {
    var files = pdfFiles();
    if (!files.length) {
      showToast(T("Unggah berkas PDF terlebih dahulu untuk melihat pratinjau halaman."));
      return;
    }
    var file = files[0];
    build();
    overlay.hidden = false;
    document.body.classList.add("po-open");

    var key = file.name + "|" + file.size + "|" + (file.lastModified || 0);
    var grid = overlay.querySelector("#po-grid");
    var info = overlay.querySelector("#po-file");
    if (key !== activeFileKey) {
      activeFileKey = key;
      cards = [];
      selectedIndex = -1;
      if (info) info.textContent = file.name;
      grid.innerHTML = '<p class="po-loading">' + T("Memuat pratinjau halaman…") + '</p>';
      try {
        var body = new FormData();
        body.append("file", file);
        var response = await fetch("/api/preview", { method: "POST", body: body });
        var data = await response.json();
        if (!response.ok || !data.pages || !data.pages.length) {
          throw new Error(data.error || T("Gagal memuat pratinjau halaman."));
        }
        cards = data.pages.map(function (page) { return { page: page.page, image: page.image, removed: false }; });
        if (info) {
          info.textContent = file.name + " · " + cards.length + (data.page_count > cards.length ? "/" + data.page_count : "") + " " + T("halaman") +
            (files.length > 1 ? " · " + T("urutan berlaku untuk semua PDF") : "");
        }
      } catch (error) {
        grid.innerHTML = '<p class="po-loading po-error"></p>';
        grid.querySelector(".po-error").textContent = error.message;
        return;
      }
    } else if (info && files.length > 1) {
      info.textContent = file.name + " · " + cards.length + " " + T("halaman") + " · " + T("urutan berlaku untuk semua PDF");
    }
    render();
  }

  function close() {
    if (!overlay) return;
    overlay.hidden = true;
    document.body.classList.remove("po-open");
  }

  function apply() {
    var kept = cards.filter(function (card) { return !card.removed; }).map(function (card) { return card.page; });
    if (!kept.length) {
      showToast(T("Tidak ada halaman tersisa. Minimal 1 halaman harus dipakai."));
      return;
    }
    var opSelect = document.getElementById("operation");
    if (!opSelect) return;
    var option = Array.prototype.find.call(opSelect.options, function (item) { return item.value === "organize"; });
    if (!option) {
      option = document.createElement("option");
      option.value = "organize";
      opSelect.appendChild(option);
    }
    opSelect.value = "organize";
    opSelect.dispatchEvent(new Event("change", { bubbles: true }));
    var isEnglish = window.PDFForgeLang && window.PDFForgeLang() === "en";
    var english = window.PDFForgeMetaEN && window.PDFForgeMetaEN.organize;
    var info = isEnglish && english
      ? { op: "organize", target: "pdf", name: english.name, desc: english.desc }
      : { op: "organize", target: "pdf", name: "Atur Halaman", desc: "Susun ulang, hapus, dan rapikan halaman PDF Anda." };
    if (window.PDFForgeApplyToolUI) window.PDFForgeApplyToolUI(info);
    if (window.PDFForgeCustom) window.PDFForgeCustom.update();
    var orderInput = document.querySelector('#custom-tool-options [name="page_order"]');
    if (orderInput) orderInput.value = kept.join(",");
    var removeInput = document.querySelector('#custom-tool-options [name="remove_pages"]');
    if (removeInput) removeInput.value = "";
    close();
    showToast(T("Urutan halaman diterapkan. Tekan tombol proses untuk menyimpan."));
  }

  function init() {
    var buttons = [document.getElementById("organize-pages-btn"), document.getElementById("page-organizer-open")];
    buttons.forEach(function (button) {
      if (button) button.addEventListener("click", function (event) { event.preventDefault(); open(); });
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && overlay && !overlay.hidden) close();
    });
  }

  window.PDFForgePages = { open: open, close: close };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
