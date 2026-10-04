/* ══════════════════════════════════════════════════════════════════════════
   theme.js – Design-Verwaltung (Oberfläche, Spieltisch, Komplett-Designs)
   ══════════════════════════════════════════════════════════════════════════

   Wird GANZ OBEN im <head> geladen (nach themes.css), damit das gewählte
   Design schon vor dem ersten Zeichnen gesetzt ist – sonst würde die Seite
   kurz im Standard-Design aufblitzen.

   Die Wahl ist LOKAL (localStorage): Jeder Spieler sieht sein eigenes Design,
   niemand zwingt anderen seinen Geschmack auf.

   Schnittstelle:
     Theme.get("ui" | "table")          aktuelles Design
     Theme.set("ui" | "table", id)      umschalten (sofort, mit Übergang)
     Theme.UI / Theme.TABLE             verfügbare Designs
     Theme.visible("ui" | "table")      nur die im Launcher nicht ausgeblendeten
     Theme.isHidden(scope, id)
     Theme.tableVars()                  Tischfarben für Canvas-Zeichnungen (map.js)
     window-Ereignis "vtt:theme"        wird nach jedem Umschalten ausgelöst

   Neues Design hinzufügen: Block in themes.css + Eintrag in UI/TABLE unten.
   ══════════════════════════════════════════════════════════════════════════ */
const Theme = (() => {
  "use strict";

  // ── Die Designs (Anzeige im Design-Studio) ───────────────────────────────
  // Fest eingebaut ist je Bereich nur EIN Standard-Design. Alle weiteren
  // kommen aus dem Design-Katalog (Launcher) oder dem Design-Editor und liegen
  // als .vttdesign im Profil (Schlüssel vtt_designs) – siehe design-runtime.js.
  const BUILTIN_UI = [
    { id: "arkanum", name: "Arkanum", tag: "Standard", builtin: true,
      desc: "Nachtblau, Messing-Gold und arkanes Türkis – gläsern und edel." },
  ];
  const BUILTIN_TABLE = [
    { id: "arkan", name: "Arkaner Tisch", tag: "Standard", builtin: true, desc: "Dunkles Nachtblau mit sanftem Schimmer." },
  ];

  /** Installierte Designs (geprüft). */
  function installed() {
    let list = [];
    try { list = JSON.parse(localStorage.getItem("vtt_designs") || "[]"); } catch (e) {}
    if (typeof DesignRuntime === "undefined") return [];
    return (Array.isArray(list) ? list : []).map(d => DesignRuntime.sanitize(d)).filter(Boolean);
  }
  function _list(scope) {
    const base = scope === "ui" ? BUILTIN_UI : BUILTIN_TABLE;
    const L = (typeof I18n !== "undefined" ? I18n.lang : "de"), tr = d => (d.i18n && d.i18n[L]) || {};
    return base.concat(installed().filter(d => d.scope === scope).map(d => ({
      id: d.id, name: tr(d).name || d.name, tag: tr(d).tag || d.tag || (d.author ? "von " + d.author : "Eigenes"), desc: tr(d).description || d.description || "",
      custom: true, design: d })));
  }
  /** CSS aller installierten Designs in die Seite legen. */
  function _injectDesigns() {
    if (typeof DesignRuntime === "undefined") return;
    let el = document.getElementById("vtt-designs");
    if (!el) { el = document.createElement("style"); el.id = "vtt-designs"; (document.head || document.documentElement).appendChild(el); }
    el.textContent = installed().map(DesignRuntime.css).join("\n");
  }

  // (Komplett-Designs wurden bewusst entfernt: Jeder stellt seinen Look aus
  //  Oberfläche, Spieltisch und Würfeln selbst zusammen – ein Klick auf ein
  //  „Komplett-Design" hätte diese Zusammenstellung überschrieben.)

  const KEY = { ui: "vtt_theme_ui", table: "vtt_theme_table" };
  const DEFAULT = { ui: "arkanum", table: "arkan" };
  const ATTR = { ui: "data-ui-theme", table: "data-table-theme" };
  const LIST = { get ui() { return _list("ui"); }, get table() { return _list("table"); } };

  function _read(scope) {
    try {
      const v = localStorage.getItem(KEY[scope]);
      if (v && LIST[scope].some(t => t.id === v)) return v;
    } catch (e) {}
    return DEFAULT[scope];
  }

  function apply() {
    const html = document.documentElement;
    html.setAttribute(ATTR.ui, _read("ui"));
    html.setAttribute(ATTR.table, _read("table"));
  }

  function get(scope) { return _read(scope); }

  function set(scope, id, opts) {
    if (!LIST[scope] || !LIST[scope].some(t => t.id === id)) return;
    try { localStorage.setItem(KEY[scope], id); } catch (e) {}
    _animateSwitch();
    apply();
    if (!(opts && opts.silent)) _notify(scope);
  }

  // Sanfter Übergang: nur während des Umschaltens Transitionen erzwingen
  let _t = 0;
  function _animateSwitch() {
    const html = document.documentElement;
    html.classList.add("theme-switching");
    clearTimeout(_t);
    _t = setTimeout(() => html.classList.remove("theme-switching"), 420);
  }

  function _notify(scope) {
    try { window.dispatchEvent(new CustomEvent("vtt:theme", { detail: { scope } })); } catch (e) {}
  }

  /** Werte des Tisch-Designs für Canvas-Zeichnungen (Canvas versteht kein var()). */
  function tableVars() {
    const cs = getComputedStyle(document.documentElement);
    const v = n => cs.getPropertyValue(n).trim();
    return {
      gridRgb: v("--table-grid-rgb") || "212,181,120",
      fogRgb:  v("--table-fog-rgb")  || "6,6,12",
      measure: v("--table-measure")  || "#ffd95a",
    };
  }

  // Andere Fenster/Tabs (z.B. Werkstatt + Spieltisch) ziehen sofort mit
  window.addEventListener("storage", e => {
    if (e.key === KEY.ui || e.key === KEY.table || e.key === "vtt_designs") { _injectDesigns(); apply(); _notify("sync"); }
  });

  // ══════════════════════════════════════════════════════════════════════
  //  PERSÖNLICHES PROFIL – Würfel-Sets & Designs reisen mit dem Spieler
  // ══════════════════════════════════════════════════════════════════════
  //  Der Browser-Speicher ist an die Server-Adresse gebunden. Damit ein
  //  Spieler beim DM SEINE Würfel und Designs hat:
  //   1. Auf der eigenen Installation (localhost) wird jede Änderung dieser
  //      Schlüssel an den eigenen Server gespiegelt (/api/profile).
  //   2. Der Launcher holt sie dort ab und hängt sie beim Beitreten als
  //      #vttprofile=… an die Adresse des DM (der Teil hinter # wird nie an
  //      einen Server geschickt).
  //   3. Hier wird diese Übergabe beim DM ausgepackt und gespeichert.
  const PROFILE_KEYS = ["vtt_theme_ui", "vtt_theme_table", "vtt_dice_sets", "vtt_dice3d",
                        "vtt_dice_sound", "vtt_dice_volume", "vtt_hidden_designs", "vtt_designs", "vtt_fx", "vtt_settings"];
  const isOwnInstall = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(location.hostname);
  const _origSet = Storage.prototype.setItem;
  const _setQuiet = (k, v) => { try { _origSet.call(localStorage, k, v); } catch (e) {} };

  // Die Installation ist die Quelle der Wahrheit: Der Server legt das Profil
  // in jede Seite (window.__VTT_PROFILE__). Ist es neuer als der Stand im
  // Browser (z.B. weil im Launcher etwas ausgeblendet/importiert wurde),
  // wird es übernommen – sonst schicken wir den neueren Browser-Stand hoch.
  function _adoptServerProfile() {
    const P = window.__VTT_PROFILE__;
    if (!isOwnInstall || !P) return;
    const local = +(localStorage.getItem("vtt_profile_updated") || 0);
    const server = +(P.updated || 0);
    if (server > local) {
      const keys = P.keys || {};
      PROFILE_KEYS.forEach(k => {
        if (typeof keys[k] === "string") _setQuiet(k, keys[k]);
        else if (k === "vtt_hidden_designs") { try { localStorage.removeItem(k); } catch (e) {} }
      });
      _setQuiet("vtt_profile_updated", String(server));
    } else if (local > server || !server) {
      _pushProfile(true);
    }
  }

  let _pushT = 0;
  function _pushProfile(now) {
    if (!isOwnInstall) return;
    clearTimeout(_pushT);
    _pushT = setTimeout(() => {
      const keys = {};
      PROFILE_KEYS.forEach(k => { const v = localStorage.getItem(k); if (v !== null) keys[k] = v; });
      fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json", "X-VTT-App": "1" },
                              body: JSON.stringify({ keys }) })
        .then(r => r.json()).then(d => { if (d && d.updated) _setQuiet("vtt_profile_updated", String(d.updated)); })
        .catch(() => {});
    }, now ? 0 : 600);
  }
  // Alle Schreibzugriffe auf diese Schlüssel mitbekommen – egal, welche Datei
  // sie auslöst (Würfel-Werkstatt, Design-Studio, Klang-Einstellungen …).
  try {
    Storage.prototype.setItem = function (k, v) {
      _origSet.call(this, k, v);
      if (this === window.localStorage && PROFILE_KEYS.includes(k)) {
        _origSet.call(this, "vtt_profile_updated", String(Date.now() / 1000));
        _pushProfile();
      }
    };
  } catch (e) {}
  _adoptServerProfile();

  // ── Im Launcher ausgeblendete Designs ────────────────────────────────────
  function _hidden() {
    try { return new Set(JSON.parse(localStorage.getItem("vtt_hidden_designs") || "[]")); }
    catch (e) { return new Set(); }
  }
  function isHidden(scope, id) { return _hidden().has(scope + ":" + id); }
  function visible(scope) {
    const h = _hidden();
    const list = LIST[scope].filter(t => !h.has(scope + ":" + t.id) || t.id === _read(scope));
    return list.length ? list : LIST[scope];
  }

  /** Übergabe aus dem Launcher auspacken (#vttprofile=<base64url JSON>). */
  function _receiveHandover() {
    const h = location.hash || "";
    if (!h.startsWith("#vttprofile=")) return;
    try {
      const b64 = h.slice(12).replace(/-/g, "+").replace(/_/g, "/");
      const json = decodeURIComponent(escape(atob(b64)));
      const data = JSON.parse(json);
      const keys = (data.profile && data.profile.keys) || {};
      PROFILE_KEYS.forEach(k => { if (typeof keys[k] === "string") localStorage.setItem(k, keys[k]); });
      if (Array.isArray(data.characters)) sessionStorage.setItem("vtt_handover_chars", JSON.stringify(data.characters));
      if (data.launcher) localStorage.setItem("vtt_launcher", String(data.launcher).slice(0, 200));
      if (data.open) sessionStorage.setItem("vtt_open", String(data.open).slice(0, 40));   // z.B. "design"
      if (data.intro) sessionStorage.setItem("vtt_intro", "1");                            // Ankunft nach dem Intro
    } catch (e) { console.warn("[Theme] Übergabe aus dem Launcher unlesbar", e); }
    // Adresse aufräumen (Übergabe soll nicht im Verlauf/Lesezeichen landen)
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
  }
  _receiveHandover();

  /** Zurück zum Launcher (nur in der Desktop-App bekannt). */
  function launcherUrl() {
    try { return localStorage.getItem("vtt_launcher") || ""; } catch (e) { return ""; }
  }

  // ── Design-Editor: Live-Vorschau und Speichern ───────────────────────────
  const _draftId = { ui: "__entwurf_ui", table: "__entwurf_table" };
  /** Entwurf sofort auf der ganzen Seite zeigen (ohne zu speichern). */
  function preview(design) {
    if (typeof DesignRuntime === "undefined") return;
    const d = DesignRuntime.sanitize(Object.assign({}, design, { id: _draftId[design.scope] }));
    if (!d) return;
    let el = document.getElementById("vtt-design-draft");
    if (!el) { el = document.createElement("style"); el.id = "vtt-design-draft"; document.head.appendChild(el); }
    el.textContent = DesignRuntime.css(d);
    document.documentElement.setAttribute(ATTR[d.scope], d.id);
  }
  function endPreview() {
    const el = document.getElementById("vtt-design-draft"); if (el) el.textContent = "";
    apply();
  }
  /** Design speichern (neu oder überschreiben) und aktivieren. */
  function saveDesign(design) {
    const d = typeof DesignRuntime !== "undefined" ? DesignRuntime.sanitize(design) : null;
    if (!d) return null;
    let list = [];
    try { list = JSON.parse(localStorage.getItem("vtt_designs") || "[]"); } catch (e) {}
    list = (Array.isArray(list) ? list : []).filter(x => !(x && x.id === d.id && x.scope === d.scope));
    list.push(d);
    localStorage.setItem("vtt_designs", JSON.stringify(list));
    _injectDesigns();
    endPreview();
    set(d.scope, d.id);
    return d;
  }

  // ══════════════════════════════════════════════════════════════════════
  //  EINSTELLUNGEN (Einstellungsmenü im Startbildschirm)
  // ══════════════════════════════════════════════════════════════════════
  //  Theme.setting(name, standard)   lesen
  //  Theme.setSetting(name, wert)    schreiben (+ Ereignis „vtt:settings")
  //  Klang-Einstellungen liegen in sfx.js (vtt_fx), alles andere hier.
  const SETTINGS_KEY = "vtt_settings";
  function _settings() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {}; } catch (e) { return {}; } }
  function setting(k, d) { const s = _settings(); return (k in s) ? s[k] : d; }
  function setSetting(k, v) {
    const s = _settings(); s[k] = v;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
    try { window.dispatchEvent(new CustomEvent("vtt:settings", { detail: { key: k, value: v } })); } catch (e) {}
  }
  function resetSettings() { try { localStorage.removeItem(SETTINGS_KEY); localStorage.removeItem("vtt_fx"); } catch (e) {} _pushProfile(true); }

  // ══════════════════════════════════════════════════════════════════════
  //  LADEBILDSCHIRM – kein Zwischenzustand ist je zu sehen
  // ══════════════════════════════════════════════════════════════════════
  //  • Liegt ab dem allerersten Bild über jeder Seite (wird schon im <head>
  //    eingefügt) und verschwindet erst, wenn die Seite WIRKLICH fertig ist:
  //    geladen + Schriften + alle Wartepunkte (Theme.hold) – höchstens 15 s.
  //  • Erscheint beim Verlassen SOFORT beim Klick (Theme.go / Links). Die alte
  //    Seite stellt dabei aufwendige Animationen ein (Ereignis „vtt:leaving").
  //  • Gleiches Bild auf beiden Seiten → nahtloser Übergang.
  //  • Animiert nur transform/opacity → läuft auf der Grafikkarte und bleibt
  //    flüssig, auch wenn im Hintergrund gerechnet wird.
  const _tr = s => (typeof I18n !== "undefined" ? I18n.t(s) : s);   // Übersetzung (i18n.js)
  const _holds = [];
  function hold(p) { if (p && p.then) _holds.push(p.catch(() => {})); }
  function whenReady(fn) {
    if (!document.documentElement.classList.contains("vtt-loading")) return void setTimeout(fn, 0);
    window.addEventListener("vtt:ready", () => setTimeout(fn, 200), { once: true });
  }
  const CREST = '<svg viewBox="0 0 100 100" aria-hidden="true"><defs><linearGradient id="ldg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--gold-light)"/><stop offset=".55" stop-color="var(--gold)"/><stop offset="1" stop-color="var(--arcane)"/></linearGradient></defs>' +
    '<polygon points="50,4 91,27 91,73 50,96 9,73 9,27" fill="none" stroke="url(#ldg)" stroke-width="2.4" stroke-linejoin="round"/>' +
    '<polygon points="50,22 76,66 24,66" fill="none" stroke="url(#ldg)" stroke-width="1.8" stroke-linejoin="round"/>' +
    '<path d="M50 4 50 22 M91 27 76 66 M9 27 24 66 M91 73 76 66 M9 73 24 66 M50 96 50 66 M50 22 9 27 M50 22 91 27" stroke="url(#ldg)" stroke-opacity=".55" stroke-width="1.2" fill="none"/></svg>';
  let _loader = null;
  function _ensureLoader() {
    if (_loader) return _loader;
    const css = document.createElement("style");
    css.textContent = `
      #vtt-loader { position: fixed; inset: 0; z-index: 2147483000; display: grid; place-items: center; pointer-events: none;
        background: var(--bg-deep, #06070d); background-image: var(--backdrop); opacity: 1; transition: opacity .42s ease; }
      #vtt-loader.gone { opacity: 0; }
      #vtt-loader.leave { opacity: 0; transition: opacity .16s ease; pointer-events: all; }
      #vtt-loader.leave.on { opacity: 1; }
      #vtt-loader .ld-in { display: flex; flex-direction: column; align-items: center; gap: 18px; }
      #vtt-loader .ld-crest { position: relative; width: 92px; height: 92px; }
      #vtt-loader .ld-crest svg { width: 100%; height: 100%; will-change: transform, opacity;
        animation: ld-float 2.6s ease-in-out infinite; filter: drop-shadow(0 0 16px rgba(var(--gold-rgb, 212,181,120), .55)); }
      #vtt-loader .ld-glow { position: absolute; inset: -40px; border-radius: 50%; will-change: transform, opacity;
        background: radial-gradient(circle, rgba(var(--gold-rgb, 212,181,120), .28), rgba(var(--arcane-rgb, 77,224,212), .08) 45%, transparent 70%);
        animation: ld-breathe 2.6s ease-in-out infinite; }
      #vtt-loader .ld-crest svg { position: relative; }
      #vtt-loader .ld-text { font: 600 .74rem/1 var(--font-display, Georgia, serif); letter-spacing: .32em; text-transform: uppercase;
        color: var(--text-dim, #7a7488); min-height: 1em; }
      #vtt-loader .ld-bar { position: relative; width: 240px; height: 4px; border-radius: 4px; overflow: hidden;
        background: rgba(var(--hi-rgb, 255,255,255), .07); box-shadow: inset 0 0 0 1px rgba(var(--gold-rgb, 212,181,120), .12); }
      #vtt-loader .ld-fill { position: absolute; inset: 0; transform-origin: left; transform: scaleX(.04); will-change: transform;
        background: linear-gradient(90deg, var(--gold-dark, #8a6d35), var(--gold, #d4b578), var(--arcane, #4de0d4));
        box-shadow: 0 0 10px rgba(var(--gold-rgb, 212,181,120), .6); transition: transform .45s cubic-bezier(.2,.8,.2,1); }
      #vtt-loader .ld-shine { position: absolute; top: 0; bottom: 0; width: 30%; will-change: transform;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,.55), transparent); animation: ld-sweep 1.6s ease-in-out infinite; }
      @keyframes ld-float { 50% { transform: translateY(-5px) scale(1.03); } }
      @keyframes ld-breathe { 0%, 100% { transform: scale(.85); opacity: .55; } 50% { transform: scale(1.1); opacity: 1; } }
      @keyframes ld-sweep { from { transform: translateX(-120%); } to { transform: translateX(380%); } }`;
    (document.head || document.documentElement).appendChild(css);
    const el = document.createElement("div");
    el.id = "vtt-loader"; el.setAttribute("role", "status"); el.setAttribute("aria-live", "polite");
    el.innerHTML = `<div class="ld-in"><div class="ld-crest"><div class="ld-glow"></div>${CREST}</div><div class="ld-text">${_tr("Lädt")}</div><div class="ld-bar"><div class="ld-fill"></div><div class="ld-shine"></div></div></div>`;
    document.documentElement.appendChild(el);    // geht schon, bevor <body> existiert
    _loader = el;
    return el;
  }
  /** Fortschritt des Balkens (0 … 1) – geht nur vorwärts. */
  let _prog = 0;
  function progress(v) {
    _prog = Math.max(_prog, Math.min(1, v));
    const f = _ensureLoader().querySelector(".ld-fill"); if (f) f.style.transform = `scaleX(${Math.max(.04, _prog)})`;
  }
  /** Ladetext ändern (z.B. „Bereite Würfel vor · 3/14"). */
  function loaderText(t) { const el = _ensureLoader(); el.querySelector(".ld-text").textContent = _tr(t || "Lädt"); }
  // Läuft die Seite im festen Rahmen (/app, für durchgehende Musik)?
  const inShell = (() => { try { return window.top !== window && !!window.top.VTT_SHELL; } catch (e) { return false; } })();
  // Desktop-Funktionen (Dateien speichern …) aus dem Rahmen durchreichen
  if (inShell && !window.__TAURI__) { try { if (window.top.__TAURI__) window.__TAURI__ = window.top.__TAURI__; } catch (e) {} }

  /** Zu einer anderen Seite wechseln – Ladebildschirm erscheint sofort. */
  function go(url) {
    let target; try { target = new URL(url, location.href); } catch (e) { target = null; }
    // Andere Adresse (Launcher, Server eines DM): die GANZE Seite wechselt
    if (inShell && target && target.origin !== location.origin) {
      try { window.top.location.href = target.href; return; } catch (e) {}
    }
    if (inShell) { try { window.parent.postMessage({ type: "vtt-nav", url: target ? target.href : url }, location.origin); } catch (e) {} }
    const el = _ensureLoader();
    loaderText("Lädt");
    el.classList.remove("gone"); el.classList.add("leave");
    el.style.display = ""; _prog = 0; progress(.12);
    try { window.dispatchEvent(new CustomEvent("vtt:leaving")); } catch (e) {}
    requestAnimationFrame(() => {
      el.classList.add("on");
      setTimeout(() => { location.href = url; }, 170);     // erst wenn der Ladebildschirm steht
    });
  }
  (function boot() {
    const html = document.documentElement;
    html.classList.add("vtt-loading");
    _ensureLoader();
    const loaded = new Promise(r => { if (document.readyState === "complete") r(); else window.addEventListener("load", r, { once: true }); });
    const fonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    // Echter Fortschritt: Struktur → geladen → Schriften → Wartepunkte
    progress(.15);
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => progress(.3), { once: true }); else progress(.3);
    loaded.then(() => progress(.6)); fonts.then(() => progress(Math.max(_prog, .45)));
    const all = async () => {
      await Promise.all([loaded, fonts]);
      progress(.7);
      let n = -1, done = 0;
      while (n !== _holds.length) {
        n = _holds.length;
        await Promise.all(_holds.slice().map(h => h.then(() => { done++; progress(.7 + .28 * done / Math.max(1, _holds.length)); })));
      }
      progress(1);
      // zwei ruhige Bilder abwarten: erst dann ist die Seite wirklich gezeichnet
      await new Promise(r => setTimeout(r, 240));   // vollen Balken kurz zeigen
    };
    const reveal = () => {
      if (!html.classList.contains("vtt-loading")) return;
      html.classList.remove("vtt-loading");
      const el = _ensureLoader(); el.classList.add("gone");
      setTimeout(() => { if (el.classList.contains("gone")) el.style.display = "none"; }, 480);
      try { window.dispatchEvent(new CustomEvent("vtt:ready")); } catch (e) {}
    };
    Promise.race([all(), new Promise(r => setTimeout(r, 15000))]).then(reveal);
    // Links innerhalb der App: Ladebildschirm sofort beim Klick
    document.addEventListener("click", e => {
      if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const a = e.target.closest && e.target.closest("a[href]");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const href = a.getAttribute("href");
      if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
      let u; try { u = new URL(href, location.href); } catch (x) { return; }
      if (u.origin !== location.origin) return;
      e.preventDefault(); go(u.href);
    });
    // Andere Seitenwechsel (z.B. location.href im Code): so früh wie möglich
    window.addEventListener("beforeunload", () => {
      const el = _ensureLoader(); el.style.display = ""; el.classList.remove("gone"); el.classList.add("leave", "on");
      try { window.dispatchEvent(new CustomEvent("vtt:leaving")); } catch (e) {}
      setTimeout(() => { el.classList.remove("leave", "on"); el.classList.add("gone"); }, 3000);   // Download-Fall
    });
    window.addEventListener("pageshow", e => { if (e.persisted) { const el = _ensureLoader(); el.classList.remove("leave", "on"); reveal(); } });
  })();

  _injectDesigns();
  apply();
  return { hold, whenReady, go, loaderText, progress, inShell, setting, setSetting, resetSettings, get, set, apply, tableVars, launcherUrl, visible, isHidden, installed, preview, endPreview, saveDesign,
           get UI() { return _list("ui"); }, get TABLE() { return _list("table"); } };
})();
