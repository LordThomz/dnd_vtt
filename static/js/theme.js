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
    return base.concat(installed().filter(d => d.scope === scope).map(d => ({
      id: d.id, name: d.name, tag: d.tag || (d.author ? "von " + d.author : "Eigenes"), desc: d.description || "",
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
                        "vtt_dice_sound", "vtt_dice_volume", "vtt_hidden_designs", "vtt_designs", "vtt_fx"];
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
  //  LADESCHLEIER – Seiten erscheinen erst, wenn sie wirklich fertig sind
  // ══════════════════════════════════════════════════════════════════════
  //  Ein Schleier im Design der App liegt ab dem ersten Bild über der Seite
  //  (html::before / ::after – braucht kein HTML und ist sofort da). Er
  //  verschwindet weich, wenn: Seite geladen + Schriften fertig + alle
  //  angemeldeten Wartepunkte erledigt (Theme.hold(promise)). Höchstens 6 s.
  //  Beim Verlassen blendet er wieder ein → ruhige Übergänge.
  const _holds = [];
  function hold(p) { if (p && p.then) _holds.push(p.catch(() => {})); }
  /** Läuft, sobald die Seite sichtbar ist (für Arbeit, die warten kann). */
  function whenReady(fn) {
    if (!document.documentElement.classList.contains("vtt-veil")) return void setTimeout(fn, 0);
    window.addEventListener("vtt:ready", () => setTimeout(fn, 200), { once: true });
  }
  (function veil() {
    const css = document.createElement("style");
    css.textContent = `
      html.vtt-veil::before { content: ""; position: fixed; inset: 0; z-index: 2147483000; pointer-events: none;
        background: var(--bg-deep); background-image: var(--backdrop); opacity: 1; transition: opacity .38s ease; }
      html.vtt-veil::after { content: ""; position: fixed; left: 50%; top: 50%; width: 46px; height: 46px; margin: -23px 0 0 -23px;
        z-index: 2147483001; pointer-events: none; border-radius: 50%; border: 2px solid rgba(var(--gold-rgb), .15);
        border-top-color: var(--gold); border-right-color: var(--arcane); opacity: 0;
        animation: vtt-spin .9s linear infinite, vtt-spin-in .3s ease .45s forwards; transition: opacity .25s ease; }
      html.vtt-veil.vtt-ready::before, html.vtt-veil.vtt-ready::after { opacity: 0 !important; }
      html.vtt-leaving::before { content: ""; position: fixed; inset: 0; z-index: 2147483000; pointer-events: none;
        background: var(--bg-deep); background-image: var(--backdrop); animation: vtt-leave .2s ease forwards; }
      @keyframes vtt-spin { to { transform: rotate(360deg); } }
      @keyframes vtt-spin-in { to { opacity: 1; } }
      @keyframes vtt-leave { from { opacity: 0; } to { opacity: 1; } }`;
    (document.head || document.documentElement).appendChild(css);
    const html = document.documentElement;
    html.classList.add("vtt-veil");
    const loaded = new Promise(r => { if (document.readyState === "complete") r(); else window.addEventListener("load", r, { once: true }); });
    const fonts = (document.fonts && document.fonts.ready) ? document.fonts.ready : Promise.resolve();
    const all = async () => {
      await Promise.all([loaded, fonts]);
      let n = -1; while (n !== _holds.length) { n = _holds.length; await Promise.all(_holds.slice()); }   // auch spät angemeldete
    };
    const reveal = () => {
      if (html.classList.contains("vtt-ready")) return;
      // setTimeout statt requestAnimationFrame: bei hoher Last bleiben Bilder
      // aus – der Schleier soll trotzdem zuverlässig verschwinden.
      setTimeout(() => {
        html.classList.add("vtt-ready");
        setTimeout(() => html.classList.remove("vtt-veil", "vtt-ready"), 450);
        try { window.dispatchEvent(new CustomEvent("vtt:ready")); } catch (e) {}
      }, 30);
    };
    Promise.race([all(), new Promise(r => setTimeout(r, 6000))]).then(reveal);
    // Beim Verlassen weich abblenden (bei Datei-Downloads bleibt die Seite – dann wieder weg)
    window.addEventListener("beforeunload", () => {
      html.classList.add("vtt-leaving");
      setTimeout(() => html.classList.remove("vtt-leaving"), 2500);
    });
    // Zurück-Navigation aus dem Browser-Cache: Schleier nicht hängen lassen
    window.addEventListener("pageshow", e => { if (e.persisted) { html.classList.remove("vtt-leaving"); reveal(); } });
  })();

  _injectDesigns();
  apply();
  return { hold, whenReady, get, set, apply, tableVars, launcherUrl, visible, isHidden, installed, preview, endPreview, saveDesign,
           get UI() { return _list("ui"); }, get TABLE() { return _list("table"); } };
})();
