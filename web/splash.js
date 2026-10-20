/* PDFForge splash hide — zero dependencies, runs first, cannot get stuck.
   Layer 1: JS hide on load/DOMReady/timeout. Layer 2 (system.css): CSS kill-switch. */
(function () {
  try {
    var t0 = Date.now();
    var done = false;
    function hide() {
      if (done) return;
      done = true;
      try {
        var s = document.getElementById("splash");
        if (!s) return;
        if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          if (s.parentNode) s.parentNode.removeChild(s);
          return;
        }
        var wait = Math.max(0, 900 - (Date.now() - t0));
        setTimeout(function () {
          try {
            s.classList.add("done");
            setTimeout(function () { if (s.parentNode) s.parentNode.removeChild(s); }, 550);
          } catch (e) { /* CSS kill-switch takes over */ }
        }, wait);
      } catch (e) { /* CSS kill-switch takes over */ }
    }
    if (document.readyState === "complete") {
      hide();
    } else {
      window.addEventListener("load", hide);
      document.addEventListener("DOMContentLoaded", function () { setTimeout(hide, 900); });
    }
    setTimeout(hide, 2500);
    try {
      var countEl = document.getElementById("splash-count");
      if (countEl) {
        if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          countEl.textContent = "100";
        } else if (window.requestAnimationFrame) {
          var start = null;
          var DUR = 1200;
          var tick = function (now) {
            if (!document.getElementById("splash")) return;
            if (!start) start = now;
            var p = Math.min(1, (now - start) / DUR);
            var eased = 1 - Math.pow(1 - p, 3);
            countEl.textContent = String(Math.round(eased * 100));
            if (p < 1) window.requestAnimationFrame(tick);
          };
          window.requestAnimationFrame(tick);
        } else {
          countEl.textContent = "100";
        }
      }
    } catch (e) {}
  } catch (e) { /* CSS kill-switch takes over */ }
})();
