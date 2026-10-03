/* ══════════════════════════════════════════════════════════════════════════
   fx.js – Animationen, Klänge und visuelles Feedback im ganzen Spiel
   ══════════════════════════════════════════════════════════════════════════
   Wird auf allen Seiten geladen (nach sfx.js). Hängt sich überwiegend
   automatisch an – einzelne Seiten müssen kaum etwas tun:

   • Knöpfe:     Lichtwelle + Klick-Klang, leises Ticken beim Überfahren
   • Fenster:    Öffnen/Schließen-Klang (Animation in fx.css)
   • Listen:     neue Einträge erscheinen gestaffelt (FX.stagger)
   • Spieltisch: Spielfiguren gleiten (FLIP), Schaden/Heilung mit schwebender
                 Zahl, kritischer Treffer / Patzer mit Bildschirm-Puls
   • Chat:       Würfelergebnis zählt hoch
   • Meldungen:  Restzeit-Leiste
   • Hintergrund: sanft schwebende Lichtpartikel (FX.ambient)
   • Ankunft nach dem Intro (FX.reveal)

   Einstellungen (Profil, Schlüssel vtt_fx): reduceMotion, sound, uiVol …
   ══════════════════════════════════════════════════════════════════════════ */
const FX = (() => {
  "use strict";
  const S = () => (typeof Sfx !== "undefined" ? Sfx.settings() : { reduceMotion: false });
  const snd = name => { if (typeof Sfx !== "undefined") Sfx.play(name); };
  const reduced = () => S().reduceMotion || matchMedia("(prefers-reduced-motion: reduce)").matches;

  function applySettings() { document.documentElement.classList.toggle("fx-reduce", !!S().reduceMotion); }
  applySettings();
  window.addEventListener("vtt:fx", applySettings);

  // ── Knöpfe ──────────────────────────────────────────────────────────────
  const BTN = "button, .btn, .menu-btn, .pm-btn, .tb-btn, .p-tab, .ds-tab, .ds-card, .b, .set-add, .camp-card .btn, label.btn, [role=button]";
  const TAB = ".p-tab, .ds-tab, .tab, [data-tab]";
  document.addEventListener("pointerdown", e => {
    const b = e.target.closest(BTN);
    if (!b || b.disabled || b.getAttribute("aria-disabled") === "true") return;
    snd(e.target.closest(TAB) ? "tab" : "click");
    if (reduced()) return;
    const r = b.getBoundingClientRect();
    if (getComputedStyle(b).position === "static") b.style.position = "relative";
    let wrap = b.querySelector(":scope > .fx-rw");
    if (!wrap) { wrap = document.createElement("span"); wrap.className = "fx-rw"; b.prepend(wrap); }
    const rip = document.createElement("span");
    const size = Math.max(r.width, r.height) * 2.2;
    rip.className = "fx-ripple";
    rip.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left}px;top:${e.clientY - r.top}px`;
    wrap.appendChild(rip);
    setTimeout(() => rip.remove(), 650);
  }, true);
  document.addEventListener("pointerover", e => {
    const b = e.target.closest(".menu-btn, .ds-card, .camp-card, .tb-btn");
    if (b && !b.contains(e.relatedTarget)) snd("hover");
  });

  // ── Fenster: Klang beim Öffnen/Schließen ────────────────────────────────
  const isDialog = el => el.nodeType === 1 && (el.classList.contains("ds-backdrop") || (el.id && /-modal$/.test(el.id)) || el.classList.contains("modal-overlay"));
  new MutationObserver(list => list.forEach(m => {
    if (m.attributeName !== "class" || !isDialog(m.target)) return;
    const was = (m.oldValue || "").split(/\s+/).includes("open"), is = m.target.classList.contains("open");
    if (is && !was) snd("open"); else if (was && !is) snd("close");
  })).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true });

  // ── Gestaffelte Listen ──────────────────────────────────────────────────
  function stagger(container, startIdx) {
    if (!container || reduced()) return;
    let i = startIdx || 0;
    [...container.children].forEach(ch => {
      if (ch.dataset.fxDone) return;
      ch.dataset.fxDone = "1";
      ch.style.setProperty("--fx-i", Math.min(i++, 12));
      ch.classList.add("fx-in");
    });
  }
  const STAGGER = "#my-camps, #joinable-camps, .camp-list, .ds-grid, .pm-list, .menu-list, #char-list, #handover-chars, .init-list, #init-list, .lib-list, #entry-list";
  function _watchStagger() {
    document.querySelectorAll(STAGGER).forEach(c => {
      stagger(c);
      if (c.dataset.fxObs) return; c.dataset.fxObs = "1";
      new MutationObserver(() => stagger(c)).observe(c, { childList: true });
    });
  }

  // (Spielfiguren gleiten: direkt in tokens.js → render(), FLIP-Technik)

  // ── Schaden / Heilung ───────────────────────────────────────────────────
  window.addEventListener("vtt:hp", e => {
    const { id, delta } = e.detail || {};
    if (!id || !delta) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.querySelector(`.token[data-token-id="${CSS.escape(id)}"]`);
      if (!el) return;
      const cls = delta < 0 ? "fx-hit" : "fx-heal";
      el.classList.remove("fx-hit", "fx-heal"); void el.offsetWidth; el.classList.add(cls);
      const f = document.createElement("div");
      f.className = "fx-float " + (delta < 0 ? "dmg" : "heal");
      f.textContent = (delta > 0 ? "+" : "−") + Math.abs(delta);
      f.style.left = (parseFloat(el.style.left) + el.offsetWidth / 2) + "px";
      f.style.top = (parseFloat(el.style.top) - 8) + "px";
      el.parentElement.appendChild(f);
      setTimeout(() => f.remove(), 1400);
    }));
  });

  // ── Kritischer Treffer / Patzer ─────────────────────────────────────────
  window.addEventListener("vtt:crit", e => {
    const kind = e.detail && e.detail.kind;
    snd(kind === "crit" ? "crit" : "fumble");
    if (reduced()) return;
    const p = document.createElement("div");
    p.className = "fx-screen-pulse " + (kind === "crit" ? "crit" : "fail");
    document.body.appendChild(p); setTimeout(() => p.remove(), 1100);
  });

  // ── Chat: Würfelergebnis zählt hoch ─────────────────────────────────────
  function _countUp(el) {
    const target = parseInt(el.textContent, 10);
    if (isNaN(target) || el.dataset.fxCounted) return;
    el.dataset.fxCounted = "1";
    if (reduced() || Math.abs(target) < 2) return;
    const t0 = performance.now(), dur = 520;
    el.classList.add("fx-count");
    const tick = now => {
      const k = Math.min(1, (now - t0) / dur), v = Math.round(target * (1 - Math.pow(1 - k, 3)));
      el.textContent = v;
      if (k < 1) requestAnimationFrame(tick); else el.textContent = target;
    };
    requestAnimationFrame(tick);
  }
  function _watchChat() {
    const box = document.getElementById("chat-messages");
    if (!box || box.dataset.fxObs) return; box.dataset.fxObs = "1";
    box.querySelectorAll(".roll-total").forEach(el => { el.dataset.fxCounted = "1"; });   // Verlauf nicht animieren
    new MutationObserver(list => list.forEach(m => {
      m.addedNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        (n.matches(".roll-total") ? [n] : [...n.querySelectorAll(".roll-total")]).forEach(el => setTimeout(() => _countUp(el), 30));
      });
    })).observe(box, { childList: true, subtree: true });
  }

  // ── Meldungen: Restzeit-Leiste + Klang ──────────────────────────────────
  function _hookToast() {
    if (typeof UI === "undefined" || !UI.toast || UI.toast.__fx) return;
    const orig = UI.toast;
    UI.toast = function (msg, dur = 2600) {
      const el = document.getElementById("toast");
      if (el) { el.style.setProperty("--fx-toast-ms", dur + "ms"); el.classList.remove("show"); void el.offsetWidth; }
      snd(/⚠|Fehler|nicht/i.test(String(msg)) ? "error" : "notify");
      return orig.call(this, msg, dur);
    };
    UI.toast.__fx = true;
  }

  // ── Bewegter Hintergrund: schwebende Lichtpartikel ──────────────────────
  function ambient() {
    if (document.getElementById("fx-ambient")) return;
    const cv = document.createElement("canvas"); cv.id = "fx-ambient";
    document.body.prepend(cv);
    const ctx = cv.getContext("2d");
    const cs = getComputedStyle(document.documentElement);
    const rgb = n => (cs.getPropertyValue(n).trim() || "212,181,120");
    const cols = [rgb("--gold-rgb"), rgb("--arcane-rgb"), rgb("--gold-rgb")];
    let W = 0, H = 0, parts = [];
    const dpr = Math.min(2, devicePixelRatio || 1);
    function resize() {
      W = cv.width = innerWidth * dpr; H = cv.height = innerHeight * dpr;
      cv.style.width = innerWidth + "px"; cv.style.height = innerHeight + "px";
      const n = Math.round((innerWidth * innerHeight) / 26000);
      parts = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, r: (.6 + Math.random() * 1.8) * dpr,
        vx: (Math.random() - .5) * .12 * dpr, vy: -(.08 + Math.random() * .25) * dpr, c: cols[Math.floor(Math.random() * cols.length)],
        a: .15 + Math.random() * .5, ph: Math.random() * 6.28 }));
    }
    resize(); addEventListener("resize", resize);
    let last = performance.now();
    function frame(now) {
      const dt = Math.min(50, now - last) / 16.7; last = now;
      if (!document.hidden && !reduced()) {
        ctx.clearRect(0, 0, W, H);
        for (const p of parts) {
          p.x += p.vx * dt; p.y += p.vy * dt; p.ph += .02 * dt;
          if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; }
          if (p.x < -10) p.x = W + 10; if (p.x > W + 10) p.x = -10;
          const a = p.a * (.6 + .4 * Math.sin(p.ph));
          const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
          g.addColorStop(0, `rgba(${p.c},${a})`); g.addColorStop(1, `rgba(${p.c},0)`);
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 4, 0, 6.283); ctx.fill();
        }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    window.addEventListener("vtt:theme", () => { cols[0] = cols[2] = rgb("--gold-rgb"); cols[1] = rgb("--arcane-rgb"); resize(); });
  }

  // ── Ankunft nach dem Intro ──────────────────────────────────────────────
  function reveal() {
    let flag = null; try { flag = sessionStorage.getItem("vtt_intro"); sessionStorage.removeItem("vtt_intro"); } catch (e) {}
    if (!flag) return false;
    snd("reveal");
    if (reduced()) return true;
    const ov = document.createElement("div"); ov.className = "fx-reveal";
    ov.innerHTML = `<svg viewBox="0 0 64 64"><polygon points="32,3 58,18 58,46 32,61 6,46 6,18" fill="none" stroke="rgb(var(--gold-rgb))" stroke-width="2.4"/>
      <polygon points="32,14 49,42 15,42" fill="none" stroke="rgb(var(--gold-rgb))" stroke-width="2"/></svg>`;
    document.body.appendChild(ov);
    setTimeout(() => ov.remove(), 1400);
    return true;
  }

  function _boot() {
    _watchStagger(); _watchChat(); _hookToast();
    // höchstens einmal pro Bild prüfen (der Spieltisch ändert sich sehr oft)
    let pend = false;
    new MutationObserver(() => { if (pend) return; pend = true; requestAnimationFrame(() => { pend = false; _watchStagger(); }); })
      .observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", _boot); else _boot();
  // Tokens/UI werden teils erst nach dem Laden angelegt
  window.addEventListener("load", () => { _hookToast(); _watchChat(); });

  return { stagger, ambient, reveal, applySettings };
})();
