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
     Theme.UI / Theme.TABLE / Theme.COMBOS   verfügbare Designs
     Theme.applyCombo(id)               Komplett-Design (Oberfläche + Tisch + Würfel)
     Theme.tableVars()                  Tischfarben für Canvas-Zeichnungen (map.js)
     window-Ereignis "vtt:theme"        wird nach jedem Umschalten ausgelöst

   Neues Design hinzufügen: Block in themes.css + Eintrag in UI/TABLE unten.
   ══════════════════════════════════════════════════════════════════════════ */
const Theme = (() => {
  "use strict";

  // ── Die Designs (Anzeige im Design-Studio) ───────────────────────────────
  const UI = [
    { id: "arkanum",       name: "Arkanum",       tag: "Fantasy × Modern",
      desc: "Nachtblau, Messing-Gold und arkanes Türkis – gläsern und edel." },
    { id: "schattenfeste", name: "Schattenfeste", tag: "Düster",
      desc: "Verrußtes Eisen, Blutrot, knochenfarbene Schrift. Für Grimdark-Runden." },
    { id: "pergament",     name: "Pergament",     tag: "Klassisch · Hell",
      desc: "Wie ein aufgeschlagenes Abenteuerbuch: Pergament, Tinte, Siegelrot." },
    { id: "neonsphaere",   name: "Neonsphäre",    tag: "Futuristisch",
      desc: "Tiefschwarz mit Cyan und Magenta, kantig und leuchtend." },
    { id: "mondwald",      name: "Mondwald",      tag: "Elfisch",
      desc: "Nachtgrün, Mondsilber und sanftes Violett – ruhig und naturverbunden." },
  ];

  const TABLE = [
    { id: "arkan",  name: "Arkaner Tisch",  desc: "Dunkles Nachtblau mit sanftem Schimmer." },
    { id: "eiche",  name: "Eichentafel",    desc: "Warmes, gemasertes Holz – wie am echten Spieltisch." },
    { id: "kerker", name: "Kerkerstein",    desc: "Kalte Steinplatten, helles Raster." },
    { id: "karte",  name: "Pergamentkarte", desc: "Gealtertes Papier mit Sepia-Raster." },
    { id: "holo",   name: "Holo-Tisch",     desc: "Leuchtendes Cyan-Raster auf tiefem Blau." },
  ];

  // Komplett-Designs: stimmen Oberfläche, Tisch und Würfel aufeinander ab.
  // dice = Id einer Würfel-Vorlage aus dice3d.js (Dice3D.PRESETS)
  const COMBOS = [
    { id: "arkanum",       name: "Arkanum",       ui: "arkanum",       table: "arkan",  dice: "messing" },
    { id: "schattenfeste", name: "Schattenfeste", ui: "schattenfeste", table: "kerker", dice: "blutstein" },
    { id: "pergament",     name: "Pergament",     ui: "pergament",     table: "karte",  dice: "tinte" },
    { id: "neonsphaere",   name: "Neonsphäre",    ui: "neonsphaere",   table: "holo",   dice: "neonkern" },
    { id: "mondwald",      name: "Mondwald",      ui: "mondwald",      table: "eiche",  dice: "mondglas" },
  ];

  const KEY = { ui: "vtt_theme_ui", table: "vtt_theme_table" };
  const DEFAULT = { ui: "arkanum", table: "arkan" };
  const ATTR = { ui: "data-ui-theme", table: "data-table-theme" };
  const LIST = { ui: UI, table: TABLE };

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

  function applyCombo(id) {
    const c = COMBOS.find(x => x.id === id);
    if (!c) return;
    set("ui", c.ui, { silent: true });
    set("table", c.table, { silent: true });
    if (c.dice && typeof Dice3D !== "undefined" && Dice3D.applyPreset) {
      try { Dice3D.applyPreset(c.dice); } catch (e) {}
    }
    _notify("all");
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
    if (e.key === KEY.ui || e.key === KEY.table) { apply(); _notify("sync"); }
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
                        "vtt_dice_sound", "vtt_dice_volume"];
  const isOwnInstall = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(location.hostname);

  let _pushT = 0;
  function _pushProfile() {
    if (!isOwnInstall) return;
    clearTimeout(_pushT);
    _pushT = setTimeout(() => {
      const keys = {};
      PROFILE_KEYS.forEach(k => { const v = localStorage.getItem(k); if (v !== null) keys[k] = v; });
      fetch("/api/profile", { method: "PUT", headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ keys }) }).catch(() => {});
    }, 600);
  }
  // Alle Schreibzugriffe auf diese Schlüssel mitbekommen – egal, welche Datei
  // sie auslöst (Würfel-Werkstatt, Design-Studio, Klang-Einstellungen …).
  try {
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      orig.call(this, k, v);
      if (this === window.localStorage && PROFILE_KEYS.includes(k)) _pushProfile();
    };
  } catch (e) {}

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
    } catch (e) { console.warn("[Theme] Übergabe aus dem Launcher unlesbar", e); }
    // Adresse aufräumen (Übergabe soll nicht im Verlauf/Lesezeichen landen)
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}
  }
  _receiveHandover();

  /** Zurück zum Launcher (nur in der Desktop-App bekannt). */
  function launcherUrl() {
    try { return localStorage.getItem("vtt_launcher") || ""; } catch (e) { return ""; }
  }

  apply();
  return { get, set, apply, applyCombo, tableVars, launcherUrl, UI, TABLE, COMBOS };
})();
