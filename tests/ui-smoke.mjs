#!/usr/bin/env node
/* PDFForge UI smoke test — mandiri (server statis + peramban headless via CDP).
 *
 * Pemakaian:
 *   node tests/ui-smoke.mjs
 *
 * Opsi lingkungan:
 *   SMOKE_PORT      port server statis untuk web/   (default 8137)
 *   SMOKE_CDP_PORT  port debug peramban (CDP)       (default 9701)
 *   CHROME_PATH     lokasi msedge.exe / chrome.exe  (opsional)
 *
 * Semua panggilan /api/* dipalsukan di dalam halaman (stub fetch), jadi tes
 * tidak membutuhkan server PDFForge, database, atau Python.
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB_DIR = resolve(HERE, "..", "web");
const HTTP_PORT = Number(process.env.SMOKE_PORT || 8137);
const CDP_PORT = Number(process.env.SMOKE_CDP_PORT || 9701);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/* Palsuan API yang dipasang sebelum skrip halaman berjalan. */
const STUB_SOURCE = `
(() => {
  const json = (obj, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
  const PIXEL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const state = window.__smoke = {
    previewCalls: 0, jobCreated: 0, cancelCalls: 0, cancelled: false, jobPolls: 0, lastForm: null
  };
  window.fetch = async (url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || "GET").toUpperCase();
    if (u === "/api/capabilities") return json({
      formats: [
        { from: "pdf", to: "pdf" }, { from: "pdf", to: "txt" }, { from: "pdf", to: "docx" },
        { from: "png", to: "pdf" }, { from: "jpg", to: "pdf" }, { from: "docx", to: "pdf" }
      ],
      max_upload_bytes: 104857600, max_files_per_job: 20, malware_scan_enabled: true
    });
    if (u === "/api/health") return json({ status: "ok" });
    if (u === "/api/history") return json([]);
    if (u === "/api/preview") {
      state.previewCalls++;
      return json({ page_count: 3, limit: 40, pages: [
        { page: 1, image: PIXEL, width: 150 }, { page: 2, image: PIXEL, width: 150 }, { page: 3, image: PIXEL, width: 150 }
      ] });
    }
    if (u === "/api/jobs" && method === "POST") {
      state.jobCreated++; state.lastForm = opts.body;
      return json({ id: "smoke-job" });
    }
    if (u === "/api/jobs/smoke-job/cancel") {
      state.cancelCalls++; state.cancelled = true;
      return json({ id: "smoke-job", status: "cancelled" });
    }
    if (u === "/api/jobs/smoke-job") {
      if (state.cancelled) return json({ id: "smoke-job", status: "cancelled", progress: 40, message: "Cancelled by user" });
      state.jobPolls++;
      return json({ id: "smoke-job", status: "processing", progress: 40, message: "Converting laporan.pdf" });
    }
    return json({ error: "smoke-stub: " + u }, 404);
  };
})();
`;

function startStaticServer() {
  const server = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const filePath = resolve(join(WEB_DIR, pathname === "/" ? "/index.html" : pathname));
      if (!filePath.startsWith(WEB_DIR)) { response.writeHead(403).end(); return; }
      const body = await readFile(filePath);
      response.writeHead(200, {
        "Content-Type": MIME[extname(filePath).toLowerCase()] || "application/octet-stream",
        "Cache-Control": "no-store"
      });
      response.end(body);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found");
    }
  });
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(HTTP_PORT, "127.0.0.1", () => done(server));
  });
}

class CDP {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        this.pending.get(message.id)(message);
        this.pending.delete(message.id);
      } else if (message.method) {
        this.events.push(message);
      }
    };
  }
  open() {
    return new Promise((done, fail) => {
      this.ws.onopen = done;
      this.ws.onerror = () => fail(new Error("websocket CDP gagal dibuka"));
    });
  }
  send(method, params = {}) {
    return new Promise((done) => {
      const id = ++this.id;
      this.pending.set(id, done);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression) {
    const out = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (out.error) throw new Error("CDP error: " + JSON.stringify(out.error));
    const details = out.result?.exceptionDetails;
    if (details) throw new Error("eksepsi halaman: " + (details.exception?.description || details.text));
    return out.result?.result?.value;
  }
  pageErrors() {
    const list = [];
    for (const event of this.events) {
      if (event.method === "Runtime.exceptionThrown") {
        list.push(event.params?.exceptionDetails?.exception?.description || "eksepsi tanpa keterangan");
      }
      if (event.method === "Runtime.consoleAPICalled" && event.params?.type === "error") {
        list.push(event.params.args.map((arg) => arg.value || arg.description || "").join(" "));
      }
    }
    return list;
  }
}

async function waitForBrowserTarget(timeoutMs = 25000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* peramban belum siap */ }
    await sleep(300);
  }
  throw new Error(`endpoint CDP peramban tidak muncul di port ${CDP_PORT}`);
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try { process.kill(pid, "SIGKILL"); } catch { /* sudah mati */ }
  }
}

const PAGE_SCRIPT = `(async () => {
  const log = {};
  const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
  const $ = (sel) => document.querySelector(sel);
  const card = (id) => document.querySelector('.catalog-card[data-id="' + id + '"]');
  const waitFor = async (fn, ms = 6000) => {
    const start = Date.now();
    while (Date.now() - start < ms) {
      try { const value = await fn(); if (value) return value; } catch { /* coba lagi */ }
      await sleep(70);
    }
    return null;
  };

  log.catalogCards = await waitFor(() => {
    const count = document.querySelectorAll("#catalog-grid .catalog-card").length;
    return count === 100 ? count : 0;
  });

  /* --- favorit --- */
  card(14).querySelector(".card-fav").click();
  await sleep(160);
  log.favStored = JSON.parse(localStorage.getItem("pdfforge_favorites") || "[]").includes(14);
  log.favRowVisible = !$("#recent-favorites").hidden && $("#recent-favorites").textContent.includes("Favorit");
  card(14).querySelector(".card-fav").click();
  await sleep(160);
  log.favRemoved = !JSON.parse(localStorage.getItem("pdfforge_favorites") || "[]").includes(14);

  /* --- pilih alat (kata sandi PDF) --- */
  card(49).click();
  await sleep(200);
  log.protectOp = document.getElementById("operation").value;
  log.protectFields = !!$('#custom-tool-options [name="protect_password"]');
  log.recentFirst = JSON.parse(localStorage.getItem("pdfforge_recent_tools") || "[]")[0] === 49;

  /* --- tambah berkas PDF --- */
  const transfer = new DataTransfer();
  transfer.items.add(new File([new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52])], "laporan.pdf", { type: "application/pdf", lastModified: 1 }));
  const input = document.getElementById("file-input");
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(260);
  log.fileRows = document.querySelectorAll("#file-list .file-row").length;
  log.organizeBtnVisible = !document.getElementById("organize-pages-btn").hidden;

  /* --- penyusun halaman --- */
  document.getElementById("organize-pages-btn").click();
  const overlay = document.getElementById("page-organizer");
  log.organizerCards = await waitFor(() => {
    const count = overlay.querySelectorAll(".po-card").length;
    return count === 3 ? count : 0;
  });
  log.previewCalls = window.__smoke.previewCalls;
  overlay.querySelectorAll(".po-card")[1].querySelector(".po-eye").click();
  await sleep(140);
  log.page2Removed = overlay.querySelectorAll(".po-card")[1].classList.contains("removed");
  log.countText = overlay.querySelector("#po-count").textContent;
  overlay.querySelector("#po-apply").click();
  await sleep(260);
  log.organizeApplied = document.getElementById("operation").value === "organize";
  log.pageOrderValue = document.querySelector('#custom-tool-options [name="page_order"]')?.value || "";
  log.overlayHidden = overlay.hidden === true;
  log.applyToast = document.getElementById("toast").textContent;

  /* --- proses + ETA + batal --- */
  document.getElementById("convert-button").click();
  log.cancelVisible = !!(await waitFor(() => {
    const button = document.querySelector(".processing .progress-cancel");
    return button && !button.hidden ? button : null;
  }));
  log.etaShown = !!(await waitFor(() => /±\\d+s/.test(document.querySelector(".processing .processing-label")?.textContent || "")));
  log.formFields = [...window.__smoke.lastForm.entries()].map(([name, value]) =>
    [name, typeof value === "string" ? value : (value.name || "blob")]);
  document.querySelector(".processing .progress-cancel").click();
  log.cancelRequested = !!(await waitFor(() => window.__smoke.cancelCalls === 1));
  log.jobPanelGone = !!(await waitFor(() => !document.querySelector(".processing")));
  log.cancelToast = document.getElementById("toast").textContent;
  log.filesKept = document.querySelectorAll("#file-list .file-row").length;
  log.noResultCard = !document.querySelector(".result-card");

  /* --- ganti bahasa ke Inggris --- */
  card(49).click();
  await sleep(200);
  const descBefore = card(49).querySelector(".card-desc").textContent;
  document.getElementById("lang-toggle-btn").click();
  await sleep(320);
  log.langEn = window.PDFForgeLang() === "en";
  log.tabFirstEn = document.querySelector(".cat-tab").textContent;
  log.descChanged = card(49).querySelector(".card-desc").textContent !== descBefore;
  log.optionLabelEn = document.querySelector("#custom-tool-options .field-label")?.textContent || "";
  log.organizeBtnEn = document.getElementById("organize-pages-btn").textContent.trim();
  document.getElementById("lang-toggle-btn").click();
  await sleep(320);
  log.langBackId = window.PDFForgeLang() === "id";
  return log;
})()`;

function check(label, condition, actual) {
  return { label, ok: Boolean(condition), actual };
}

async function main() {
  const server = await startStaticServer();

  const browserCandidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe"
  ].filter(Boolean);
  const browserPath = browserCandidates.find((candidate) => existsSync(candidate));
  if (!browserPath) throw new Error("msedge.exe/chrome.exe tidak ditemukan; set CHROME_PATH");

  const profileDir = mkdtempSync(join(tmpdir(), "pdfforge-smoke-"));
  const browser = spawn(browserPath, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--mute-audio", "--window-size=1280,900",
    `--user-data-dir=${profileDir}`, `--remote-debugging-port=${CDP_PORT}`, "about:blank"
  ], { stdio: "ignore" });

  let cdp = null;
  const cleanup = () => {
    try { cdp?.ws.close(); } catch { /* abaikan */ }
    killTree(browser.pid);
    try { server.close(); } catch { /* abaikan */ }
    try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* abaikan */ }
  };
  process.on("exit", cleanup);

  try {
    const target = await waitForBrowserTarget();
    cdp = new CDP(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: STUB_SOURCE });
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${HTTP_PORT}/` });

    const ready = await cdp.eval(`(async () => {
      const deadline = Date.now() + 15000;
      while (Date.now() < deadline) {
        if (document.readyState === "complete" && document.getElementById("catalog-grid")) return true;
        await new Promise((done) => setTimeout(done, 100));
      }
      return false;
    })()`);
    if (!ready) throw new Error("halaman PDFForge tidak selesai dimuat");

    const log = await cdp.eval(PAGE_SCRIPT);
    const fields = Object.fromEntries(log.formFields || []);
    const pageErrors = cdp.pageErrors();

    const checks = [
      check("katalog menampilkan 100 kartu alat", log.catalogCards === 100, log.catalogCards),
      check("bintang favorit tersimpan di localStorage", log.favStored, log.favStored),
      check("baris favorit muncul", log.favRowVisible, log.favRowVisible),
      check("favorit bisa dilepas lagi", log.favRemoved, log.favRemoved),
      check("pilih alat menyetel operasi=protect", log.protectOp === "protect", log.protectOp),
      check("kolom kata sandi tampil", log.protectFields, log.protectFields),
      check("alat tercatat di daftar 'terakhir dipakai'", log.recentFirst, log.recentFirst),
      check("berkas PDF terdaftar setelah unggah", log.fileRows === 1, log.fileRows),
      check("tombol Susun halaman muncul", log.organizeBtnVisible, log.organizeBtnVisible),
      check("penyusun halaman memuat 3 pratinjau", log.organizerCards === 3, log.organizerCards),
      check("endpoint /api/preview dipanggil sekali", log.previewCalls === 1, log.previewCalls),
      check("halaman ke-2 ditandai terhapus", log.page2Removed, log.page2Removed),
      check("penghitung halaman 2 / 3", String(log.countText).startsWith("2 / 3"), log.countText),
      check("operasi berubah ke organize setelah diterapkan", log.organizeApplied, log.organizeApplied),
      check("page_order berisi 1,3 (halaman 2 dihapus)", log.pageOrderValue === "1,3", log.pageOrderValue),
      check("overlay tertutup setelah diterapkan", log.overlayHidden, log.overlayHidden),
      check("toast penerapan urutan tampil", String(log.applyToast).includes("diterapkan"), log.applyToast),
      check("tombol Batalkan tampil saat proses berjalan", log.cancelVisible, log.cancelVisible),
      check("estimasi waktu (ETA) tampil", log.etaShown, log.etaShown),
      check("formulir memuat operation=organize", fields.operation === "organize", fields.operation ?? "(kosong)"),
      check("formulir memuat page_order=1,3", fields.page_order === "1,3", fields.page_order ?? "(kosong)"),
      check("formulir memuat target=pdf", fields.target === "pdf", fields.target ?? "(kosong)"),
      check("formulir memuat berkas laporan.pdf", fields.files === "laporan.pdf", fields.files ?? "(kosong)"),
      check("permintaan batal dikirim", log.cancelRequested, log.cancelRequested),
      check("panel proses hilang setelah batal", log.jobPanelGone, log.jobPanelGone),
      check("toast batal jujur", String(log.cancelToast).toLowerCase().includes("batalkan"), log.cancelToast),
      check("berkas tetap ada setelah batal", log.filesKept === 1, log.filesKept),
      check("tidak ada kartu hasil palsu setelah batal", log.noResultCard, log.noResultCard),
      check("mode Inggris aktif", log.langEn, log.langEn),
      check("tab pertama menjadi 'All'", log.tabFirstEn === "All", log.tabFirstEn),
      check("deskripsi alat berubah ke Inggris", log.descChanged, log.descChanged),
      check("label opsi dinamis berubah ke Inggris", log.optionLabelEn === "PDF PASSWORD (MIN 4 CHARACTERS)", log.optionLabelEn),
      check("tombol Susun halaman menjadi 'Organize pages'", /organize/i.test(log.organizeBtnEn), log.organizeBtnEn),
      check("kembali ke mode Indonesia", log.langBackId, log.langBackId),
      check("tanpa error JavaScript", pageErrors.length === 0, pageErrors)
    ];

    let failed = 0;
    for (const item of checks) {
      const mark = item.ok ? "✓" : "✗";
      if (!item.ok) failed++;
      console.log(`${mark} ${item.label}${item.ok ? "" : `  → dapat: ${JSON.stringify(item.actual)}`}`);
    }
    console.log(`\n${checks.length - failed}/${checks.length} pemeriksaan lulus.`);
    if (failed) process.exitCode = 1;
  } finally {
    cleanup();
  }
}

main().catch((error) => {
  console.error("TES GAGAL:", error.message);
  process.exitCode = 1;
});
