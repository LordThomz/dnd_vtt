/* ══════════════════════════════════════════════════════════════════════════
   design-studio.js – Auswahlfenster für alle Designs
   ══════════════════════════════════════════════════════════════════════════

   Öffnen:  DesignStudio.open()            (optional: open("dice") für einen Reiter)

   EINE Stelle für alles Optische im Spiel:
            Oberfläche – Menüs, Panels, Dialoge, Chat
            Spieltisch – Hintergrund, Raster, Nebel, Lineal
            Würfel     – eigenes Würfel-Set wählen (gestaltet wird in der Werkstatt)
   Was hier zur Auswahl steht, bestimmt der Launcher (Ausblenden). Komplett-
   Designs gibt es bewusst nicht mehr – siehe theme.js.

   Die Vorschaukarten tragen selbst data-ui-theme / data-table-theme. Weil
   themes.css auf diese Attribute reagiert, zeigt jede Karte das ECHTE Design –
   ohne dass etwas doppelt gepflegt werden muss.

   Braucht: theme.js, design-studio.css. Optional: dice3d.js
   (ohne 3D-Engine wird eine Würfel-Vorlage vorgemerkt und beim nächsten Öffnen
   des Spieltischs/der Werkstatt übernommen).
   ══════════════════════════════════════════════════════════════════════════ */
const DesignStudio = (() => {
  "use strict";

  let _el = null, _tab = "ui";
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

  // Würfel-Sets: mit 3D-Engine über Dice3D, sonst direkt aus dem Speicher
  function _diceSets() {
    if (typeof Dice3D !== "undefined") return { sets: Dice3D.getVisibleSets(), active: (Dice3D.getActiveSet() || {}).id };
    try {
      const raw = JSON.parse(localStorage.getItem("vtt_dice_sets") || "null") || { sets: [] };
      const sets = (raw.sets || []).filter(x => !x.hidden || x.id === raw.activeId);
      return { sets, active: raw.activeId || (sets[0] || {}).id };
    } catch (e) { return { sets: [], active: null }; }
  }
  function _setActiveDice(id) {
    if (typeof Dice3D !== "undefined") { Dice3D.setActiveSet(id); }
    else {
      try {
        const raw = JSON.parse(localStorage.getItem("vtt_dice_sets") || "null");
        if (raw) { raw.activeId = id; localStorage.setItem("vtt_dice_sets", JSON.stringify(raw)); }
      } catch (e) {}
    }
    try { window.dispatchEvent(new CustomEvent("vtt:dice-set")); } catch (e) {}
  }

  // ── Kleine Bausteine für die Vorschau ────────────────────────────────────
  function _uiMini(id) {
    return `<div class="ds-ui" data-ui-theme="${id}">
      <div class="ds-ui-bar"><span class="ds-ui-dot"></span><span class="ds-ui-title">Abenteuer</span></div>
      <div class="ds-ui-body">
        <div class="ds-ui-panel">
          <div class="ds-ui-h">Initiative</div>
          <div class="ds-ui-row"><i></i><span>Thorin</span><b>18</b></div>
          <div class="ds-ui-row dim"><i></i><span>Goblin</span><b>12</b></div>
        </div>
        <div class="ds-ui-side">
          <div class="ds-ui-btn">Würfeln</div>
          <div class="ds-ui-chip">W20 · 17</div>
        </div>
      </div>
    </div>`;
  }
  function _tableMini(id) {
    return `<div class="ds-table" data-table-theme="${id}"><div class="ds-table-grid"></div>
      <div class="ds-token" style="left:30%;top:38%"></div><div class="ds-token b" style="left:62%;top:58%"></div></div>`;
  }
  function _dieMini(p) {
    const st = p.style || {};
    const c1 = st.color || "#c8a24a", c2 = st.color2 || st.color || "#c8a24a";
    const num = st.numberColor || "#111";
    const edge = st.edges && st.edges !== "none" ? (st.edgeColor || "#fff") : "rgba(0,0,0,.35)";
    const glass = /glass|crystal/.test(st.surface || "") ? " glass" : "";
    const metal = st.surface === "metal" ? " metal" : "";
    const font = st.font ? `font-family:${esc(st.font)};` : "";
    return `<div class="ds-die${glass}${metal}" style="--c1:${esc(c1)};--c2:${esc(c2)};--edge:${esc(edge)};--num:${esc(num)}">
      <svg viewBox="0 0 100 100"><polygon class="o" points="50,4 91,27 91,73 50,96 9,73 9,27"/>
        <polygon class="f" points="50,20 78,66 22,66"/>
        <line class="l" x1="50" y1="4" x2="50" y2="20"/><line class="l" x1="91" y1="27" x2="78" y2="66"/>
        <line class="l" x1="9" y1="27" x2="22" y2="66"/><line class="l" x1="91" y1="73" x2="78" y2="66"/>
        <line class="l" x1="9" y1="73" x2="22" y2="66"/><line class="l" x1="50" y1="96" x2="50" y2="66"/>
        <line class="l" x1="50" y1="20" x2="9" y2="27"/><line class="l" x1="50" y1="20" x2="91" y2="27"/></svg>
      <span style="${font}">20</span></div>`;
  }

  // ── Reiter-Inhalte ───────────────────────────────────────────────────────
  function _cardsFor(scope) {
    const cur = Theme.get(scope);
    const mini = scope === "ui" ? _uiMini : _tableMini;
    return Theme.visible(scope).map(t => `<div class="ds-card${t.id === cur ? " on" : ""}" data-${scope}="${t.id}" tabindex="0" role="button">
        ${mini(t.id)}
        <button class="ds-edit" data-edit="${scope}:${t.id}" title="${t.builtin ? "Als Vorlage für ein eigenes Design nutzen" : "Bearbeiten"}">${t.builtin ? "⧉" : "✎"}</button>
        <div class="ds-card-foot"><b>${esc(t.name)}</b><small>${esc(t.tag || "")}</small>${t.desc ? `<p>${esc(t.desc)}</p>` : ""}</div>
      </div>`).join("") +
      `<button class="ds-card ds-new" data-new="${scope}"><div class="ds-new-plus" style="width:auto;height:132px">＋</div>
        <div class="ds-card-foot" style="text-align:center"><b>Eigenes Design</b><small>im Editor erstellen</small></div></button>`;
  }
  function _ui() {
    return `<p class="ds-lead">Menüs, Seitenleisten, Dialoge und Chat. Weitere Designs lädst du im Launcher aus dem Katalog.</p><div class="ds-grid">${_cardsFor("ui")}</div>`;
  }
  function _table() {
    return `<p class="ds-lead">Hintergrund, Standard-Raster, Nebel und Lineal. Karten mit fest eingestellter Rasterfarbe behalten diese.</p><div class="ds-grid">${_cardsFor("table")}</div>`;
  }

  // ══ DESIGN-EDITOR ═══════════════════════════════════════════════════════
  // Wenige Grundeinstellungen → DesignRuntime erzeugt daraus den vollständigen
  // Farbsatz. Die GANZE Seite zeigt den Entwurf live (Theme.preview).
  let _ed = null;   // { scope, id, name, params, editingOwn }

  function _paramsFromDesign(scope, id) {
    const R = DesignRuntime;
    const t = (scope === "ui" ? Theme.UI : Theme.TABLE).find(x => x.id === id);
    if (t && t.design && t.design.params) return Object.assign({}, scope === "ui" ? R.UI_DEFAULTS : R.TABLE_DEFAULTS, t.design.params);
    // Ohne gespeicherte Grundeinstellungen: aus den echten Farben ableiten
    const cs = getComputedStyle(document.documentElement);
    const prev = document.documentElement.getAttribute(scope === "ui" ? "data-ui-theme" : "data-table-theme");
    document.documentElement.setAttribute(scope === "ui" ? "data-ui-theme" : "data-table-theme", id);
    const v = n => cs.getPropertyValue(n).trim();
    const hex = c => /^#[0-9a-f]{6}$/i.test(c) ? c : null;
    const fontName = stack => Object.keys(R.FONTS).find(k => stack.includes(k)) || null;
    let p;
    if (scope === "ui") {
      p = Object.assign({}, R.UI_DEFAULTS, {
        scheme: (cs.getPropertyValue("color-scheme") || "").includes("light") ? "light" : "dark",
        bg: hex(v("--bg-deep")) || R.UI_DEFAULTS.bg, panel: hex(v("--bg-panel")) || R.UI_DEFAULTS.panel,
        text: hex(v("--text")) || R.UI_DEFAULTS.text, accent: hex(v("--gold")) || R.UI_DEFAULTS.accent,
        accent2: hex(v("--arcane")) || R.UI_DEFAULTS.accent2, danger: hex(v("--red")) || R.UI_DEFAULTS.danger,
        success: hex(v("--green")) || R.UI_DEFAULTS.success,
        fontDisplay: fontName(v("--font-display")) || "Cinzel", fontBody: fontName(v("--font-body")) || "Crimson Pro",
        radius: parseInt(v("--radius")) || 8, stars: Math.round((parseFloat(v("--stars-opacity")) || 0) * 100),
      });
    } else {
      const rgb = n => { const t = v(n).split(",").map(Number); return t.length === 3 ? "#" + t.map(x => x.toString(16).padStart(2, "0")).join("") : null; };
      p = Object.assign({}, R.TABLE_DEFAULTS, { bg: hex(v("--table-bg")) || R.TABLE_DEFAULTS.bg,
        grid: rgb("--table-grid-rgb") || R.TABLE_DEFAULTS.grid, fog: rgb("--table-fog-rgb") || R.TABLE_DEFAULTS.fog,
        measure: hex(v("--table-measure")) || R.TABLE_DEFAULTS.measure });
    }
    if (prev) document.documentElement.setAttribute(scope === "ui" ? "data-ui-theme" : "data-table-theme", prev);
    return p;
  }

  function _openEditor(scope, baseId) {
    const t = baseId && (scope === "ui" ? Theme.UI : Theme.TABLE).find(x => x.id === baseId);
    const own = !!(t && t.custom && t.design && !t.design.author);
    _ed = { scope, id: own ? t.id : null, name: own ? t.name : (t ? t.name + " (eigen)" : "Mein Design"),
            params: baseId ? _paramsFromDesign(scope, baseId) : Object.assign({}, scope === "ui" ? DesignRuntime.UI_DEFAULTS : DesignRuntime.TABLE_DEFAULTS) };
    _tab = "editor";
    _render();
    _livePreview();
  }

  function _generated() {
    return _ed.scope === "ui" ? DesignRuntime.generateUI(_ed.params) : DesignRuntime.generateTable(_ed.params);
  }
  function _livePreview() {
    const g = _generated();
    Theme.preview({ scope: _ed.scope, id: "x", vars: g.vars, scheme: g.scheme });
  }

  function _editor() {
    const p = _ed.params, R = DesignRuntime;
    const color = (k, label, hint) => `<label class="de-row"><span>${label}${hint ? `<i>${hint}</i>` : ""}</span>
      <span class="de-color"><input type="color" data-p="${k}" value="${esc(p[k])}"><code>${esc(p[k])}</code></span></label>`;
    const range = (k, label, min, max, unit) => `<label class="de-row"><span>${label}</span>
      <span class="de-range"><input type="range" data-p="${k}" min="${min}" max="${max}" value="${esc(p[k])}"><code>${esc(p[k])}${unit || ""}</code></span></label>`;
    const select = (k, label, opts) => `<label class="de-row"><span>${label}</span><select data-p="${k}">` +
      Object.entries(opts).map(([v, l]) => `<option value="${esc(v)}" ${String(p[k]) === v ? "selected" : ""}>${esc(l)}</option>`).join("") + `</select></label>`;
    // Zierschriften sind in großen Titeln schön, in Knöpfen aber schwer lesbar
    const DECO = ["Uncial Antiqua", "Cinzel Decorative"];
    const fonts = Object.fromEntries(Object.keys(R.FONTS).filter(f => f !== "JetBrains Mono")
      .map(f => [f, DECO.includes(f) ? f + " – Zierschrift, schwerer lesbar" : f]));
    const controls = _ed.scope === "ui" ? `
      <div class="de-sec"><h4>Grundton</h4>${select("scheme", "Helligkeit", { dark: "Dunkel", light: "Hell" })}
        ${color("bg", "Hintergrund")}${color("panel", "Flächen", "Panels, Karten, Dialoge")}${color("text", "Schrift")}</div>
      <div class="de-sec"><h4>Akzente</h4>${color("accent", "Hauptakzent", "Knöpfe, Überschriften, Rahmen")}
        ${color("accent2", "Zweitakzent", "Hover, Leuchten, Fokus")}${color("danger", "Warnung")}${color("success", "Erfolg")}</div>
      <div class="de-sec"><h4>Form & Schrift</h4>${select("fontDisplay", "Überschriften", fonts)}${select("fontBody", "Fließtext", fonts)}
        ${range("radius", "Ecken", 0, 20, " px")}${range("glow", "Hintergrund-Leuchten", 0, 100, " %")}${range("stars", "Sterne", 0, 100, " %")}</div>`
    : `
      <div class="de-sec"><h4>Fläche</h4>${color("bg", "Grundfarbe")}${select("pattern", "Muster", R.TABLE_PATTERNS)}
        ${range("patternStrength", "Musterstärke", 0, 100, " %")}</div>
      <div class="de-sec"><h4>Spielhilfen</h4>${color("grid", "Raster", "für Karten mit „Tisch-Design")}
        ${color("fog", "Nebel des Krieges")}${color("measure", "Lineal")}</div>`;
    return `<div class="de">
      <div class="de-side">
        <label class="de-name">Name <input id="de-name" value="${esc(_ed.name)}" maxlength="40"></label>
        ${controls}
      </div>
      <div class="de-prev">
        <div class="de-prev-h">Live-Vorschau <span>Die ganze Seite zeigt deinen Entwurf</span></div>
        ${_ed.scope === "ui" ? _uiMini("__entwurf_ui") : _tableMini("__entwurf_table")}
        <div class="de-swatches">${Object.entries(_generated().vars).filter(([k, v]) => /^#[0-9a-f]{6}$/i.test(v)).slice(0, 14)
          .map(([k, v]) => `<i title="${esc(k)}: ${esc(v)}" style="background:${esc(v)}"></i>`).join("")}</div>
        <div class="de-actions">
          <button class="pm-btn" data-de="cancel">Abbrechen</button>
          <button class="pm-btn" data-de="reset">Zurücksetzen</button>
          <button class="pm-btn primary" data-de="save">${_ed.id ? "Speichern" : "Als neues Design speichern"}</button>
        </div>
        <p class="de-note">Teilen und Löschen eigener Designs: im Launcher unter „Designs".</p>
      </div></div>`;
  }

  function _editorInput(e) {
    const el = e.target.closest("[data-p]");
    if (!el || !_ed) return;
    _ed.params[el.dataset.p] = el.type === "range" ? +el.value : el.value;
    const code = el.parentElement.querySelector("code");
    if (code) code.textContent = el.value + (el.type === "range" ? (el.dataset.p === "radius" ? " px" : " %") : "");
    _livePreview();
    const sw = _el.querySelector(".de-swatches");
    if (sw) sw.innerHTML = Object.entries(_generated().vars).filter(([k, v]) => /^#[0-9a-f]{6}$/i.test(v)).slice(0, 14)
      .map(([k, v]) => `<i title="${esc(k)}: ${esc(v)}" style="background:${esc(v)}"></i>`).join("");
  }

  function _editorAction(act) {
    if (act === "cancel") { Theme.endPreview(); const sc = _ed.scope; _ed = null; _tab = sc; return _render(); }
    if (act === "reset") { _ed.params = Object.assign({}, _ed.scope === "ui" ? DesignRuntime.UI_DEFAULTS : DesignRuntime.TABLE_DEFAULTS); _render(); return _livePreview(); }
    if (act === "save") {
      const name = (_el.querySelector("#de-name").value || "").trim() || "Mein Design";
      const slug = name.toLowerCase().replace(/[äöüß]/g, c => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" }[c])).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "design";
      const id = _ed.id || ("eigen." + slug + "." + Math.random().toString(36).slice(2, 6));
      const g = _generated();
      const saved = Theme.saveDesign({ vttdesign: 1, id, name, scope: _ed.scope, version: "1.0.0", author: "",
                                       tag: "Eigenes", vars: g.vars, scheme: g.scheme, params: _ed.params });
      const sc = _ed.scope; _ed = null; _tab = sc; _render();
      if (saved && typeof window.UI !== "undefined" && UI.toast) UI.toast("🎨 Design gespeichert");
    }
  }
  function _dice() {
    const { sets, active } = _diceSets();
    const cards = sets.map(set => {
      const st = (set.dice && (set.dice[20] || set.dice["20"])) || {};
      return `<button class="ds-card ds-dicecard${set.id === active ? " on" : ""}" data-set="${esc(set.id)}">
        ${_dieMini({ style: st })}
        <div class="ds-card-foot"><b>${esc(set.name || "Set")}</b><small>${set.id === active ? "Aktiv" : "Auswählen"}</small></div>
      </button>`;
    }).join("");
    return `<p class="ds-lead">Wähle, mit welchem deiner Würfel-Sets du würfelst. Neue Sets gestaltest du in der Würfel-Werkstatt; welche hier erscheinen, legst du im Launcher fest.</p>
      <div class="ds-grid ds-grid-dice">${cards}
        <a class="ds-card ds-dicecard ds-new" href="/dice"><div class="ds-new-plus">＋</div>
          <div class="ds-card-foot"><b>Neues Set</b><small>in der Werkstatt</small></div></a>
      </div>
      <div class="ds-actions"><a class="ds-link" href="/dice">Würfel-Werkstatt öffnen →</a></div>`;
  }

  // ── Fenster ──────────────────────────────────────────────────────────────
  function _render() {
    const body = { ui: _ui, table: _table, dice: _dice, editor: _editor }[_tab]();
    _el.querySelector(".ds-body").innerHTML = body;
    _el.querySelectorAll(".ds-tab").forEach(b => b.classList.toggle("on", b.dataset.tab === _tab || (_ed && b.dataset.tab === _ed.scope)));
  }

  function open(tab) {
    if (tab) _tab = tab;
    if (!_el) {
      _el = document.createElement("div");
      _el.className = "ds-backdrop";
      _el.innerHTML = `<div class="ds-win" role="dialog" aria-modal="true" aria-label="Design-Studio">
        <header class="ds-head">
          <div><h2>Design-Studio</h2><span>Dein Look – gilt nur auf diesem Gerät</span></div>
          <button class="ds-x" aria-label="Schließen">✕</button>
        </header>
        <nav class="ds-tabs">
          <button class="ds-tab" data-tab="ui">▣ Oberfläche</button>
          <button class="ds-tab" data-tab="table">▦ Spieltisch</button>
          <button class="ds-tab" data-tab="dice">⬢ Würfel</button>
        </nav>
        <div class="ds-body"></div>
      </div>`;
      document.body.appendChild(_el);
      _el.addEventListener("click", e => {
        if (e.target === _el || e.target.closest(".ds-x")) { if (_ed) { Theme.endPreview(); _ed = null; _tab = "ui"; } return close(); }
        const t = e.target.closest("[data-tab]");
        if (t) { if (_ed) { Theme.endPreview(); _ed = null; } _tab = t.dataset.tab; return _render(); }
        const ed = e.target.closest("[data-edit]"); if (ed) { const [sc, id] = ed.dataset.edit.split(":"); return _openEditor(sc, id); }
        const nw = e.target.closest("[data-new]");  if (nw) return _openEditor(nw.dataset.new, Theme.get(nw.dataset.new));
        const da = e.target.closest("[data-de]");   if (da) return _editorAction(da.dataset.de);
        const u = e.target.closest("[data-ui]");    if (u) { Theme.set("ui", u.dataset.ui); return _render(); }
        const tb = e.target.closest("[data-table]"); if (tb) { Theme.set("table", tb.dataset.table); return _render(); }
        const d = e.target.closest("[data-set]");   if (d) { _setActiveDice(d.dataset.set); return _render(); }
      });
      _el.addEventListener("input", _editorInput);
      document.addEventListener("keydown", e => { if (e.key === "Escape" && _el && _el.classList.contains("open")) { if (_ed) { Theme.endPreview(); _ed = null; _tab = "ui"; } close(); } });
    }
    _render();
    requestAnimationFrame(() => _el.classList.add("open"));
  }
  function close() { if (_el) _el.classList.remove("open"); }

  return { open, close };
})();
