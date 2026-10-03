/* ══════════════════════════════════════════════════════════════════════════
   design-studio.js – Auswahlfenster für alle Designs
   ══════════════════════════════════════════════════════════════════════════

   Öffnen:  DesignStudio.open()            (optional: open("dice") für einen Reiter)

   Reiter:  Komplett   – Oberfläche + Spieltisch + Würfel aufeinander abgestimmt
            Oberfläche – Menüs, Panels, Dialoge, Chat
            Spieltisch – Hintergrund, Raster, Nebel, Lineal
            Würfel     – fertige Würfel-Looks (danach frei anpassbar in der Werkstatt)

   Die Vorschaukarten tragen selbst data-ui-theme / data-table-theme. Weil
   themes.css auf diese Attribute reagiert, zeigt jede Karte das ECHTE Design –
   ohne dass etwas doppelt gepflegt werden muss.

   Braucht: theme.js, design-studio.css. Optional: dice-presets.js, dice3d.js
   (ohne 3D-Engine wird eine Würfel-Vorlage vorgemerkt und beim nächsten Öffnen
   des Spieltischs/der Werkstatt übernommen).
   ══════════════════════════════════════════════════════════════════════════ */
const DesignStudio = (() => {
  "use strict";

  let _el = null, _tab = "combo";
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
  const presets = () => (typeof DicePresets !== "undefined" ? DicePresets : []);

  function _activeDicePreset() {
    try {
      if (typeof Dice3D !== "undefined") return (Dice3D.getActiveSet() || {}).presetId || null;
      const raw = JSON.parse(localStorage.getItem("vtt_dice_sets") || "null");
      if (raw && raw.sets) { const s = raw.sets.find(x => x.id === raw.activeId); return s && s.presetId || null; }
    } catch (e) {}
    return null;
  }

  function _applyDice(id) {
    if (typeof Dice3D !== "undefined" && Dice3D.applyPreset) Dice3D.applyPreset(id);
    else { try { localStorage.setItem("vtt_dice_preset_pending", id); } catch (e) {} }
    _pendingDice = id;
  }
  let _pendingDice = null;

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
  function _combo() {
    const ui = Theme.get("ui"), tb = Theme.get("table");
    return `<p class="ds-lead">Ein Klick setzt Oberfläche, Spieltisch und Würfel passend zueinander. Danach kannst du jeden Bereich einzeln ändern.</p>
    <div class="ds-grid ds-grid-combo">` + Theme.COMBOS.map(c => {
      const p = presets().find(x => x.id === c.dice);
      const on = (ui === c.ui && tb === c.table) ? " on" : "";
      const meta = Theme.UI.find(t => t.id === c.ui) || {};
      return `<button class="ds-card${on}" data-combo="${c.id}">
        <div class="ds-combo-prev">${_uiMini(c.ui)}<div class="ds-combo-tbl">${_tableMini(c.table)}${p ? _dieMini(p) : ""}</div></div>
        <div class="ds-card-foot"><b>${esc(c.name)}</b><small>${esc(meta.tag || "")}</small></div>
      </button>`;
    }).join("") + `</div>`;
  }
  function _ui() {
    const cur = Theme.get("ui");
    return `<p class="ds-lead">Menüs, Seitenleisten, Dialoge und Chat.</p><div class="ds-grid">` +
      Theme.UI.map(t => `<button class="ds-card${t.id === cur ? " on" : ""}" data-ui="${t.id}">
        ${_uiMini(t.id)}
        <div class="ds-card-foot"><b>${esc(t.name)}</b><small>${esc(t.tag)}</small><p>${esc(t.desc)}</p></div>
      </button>`).join("") + `</div>`;
  }
  function _table() {
    const cur = Theme.get("table");
    return `<p class="ds-lead">Hintergrund, Standard-Raster, Nebel und Lineal. Karten mit fest eingestellter Rasterfarbe behalten diese – neue Karten nutzen „Tisch-Design".</p><div class="ds-grid">` +
      Theme.TABLE.map(t => `<button class="ds-card${t.id === cur ? " on" : ""}" data-table="${t.id}">
        ${_tableMini(t.id)}
        <div class="ds-card-foot"><b>${esc(t.name)}</b><p>${esc(t.desc)}</p></div>
      </button>`).join("") + `</div>`;
  }
  function _dice() {
    const cur = _pendingDice || _activeDicePreset();
    const list = presets();
    if (!list.length) return `<p class="ds-lead">Keine Würfel-Vorlagen gefunden.</p>`;
    return `<p class="ds-lead">Eine Vorlage wird als eigenes Würfel-Set gespeichert – deine bisherigen Sets bleiben erhalten. Feinschliff (Farben, Muster, Schrift, Kanten) in der Würfel-Werkstatt.</p>
    <div class="ds-grid ds-grid-dice">` + list.map(p => `<button class="ds-card ds-dicecard${p.id === cur ? " on" : ""}" data-dice="${p.id}">
        ${_dieMini(p)}
        <div class="ds-card-foot"><b>${esc(p.name)}</b><small>${esc(p.tag || "")}</small></div>
      </button>`).join("") + `</div>
    <div class="ds-actions"><a class="ds-link" href="/dice">Würfel-Werkstatt öffnen →</a></div>`;
  }

  // ── Fenster ──────────────────────────────────────────────────────────────
  function _render() {
    const body = { combo: _combo, ui: _ui, table: _table, dice: _dice }[_tab]();
    _el.querySelector(".ds-body").innerHTML = body;
    _el.querySelectorAll(".ds-tab").forEach(b => b.classList.toggle("on", b.dataset.tab === _tab));
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
          <button class="ds-tab" data-tab="combo">✦ Komplett</button>
          <button class="ds-tab" data-tab="ui">▣ Oberfläche</button>
          <button class="ds-tab" data-tab="table">▦ Spieltisch</button>
          <button class="ds-tab" data-tab="dice">⬢ Würfel</button>
        </nav>
        <div class="ds-body"></div>
      </div>`;
      document.body.appendChild(_el);
      _el.addEventListener("click", e => {
        if (e.target === _el || e.target.closest(".ds-x")) return close();
        const t = e.target.closest("[data-tab]"); if (t) { _tab = t.dataset.tab; return _render(); }
        const c = e.target.closest("[data-combo]");
        if (c) { const combo = Theme.COMBOS.find(x => x.id === c.dataset.combo); if (combo) _applyDice(combo.dice); Theme.applyCombo(c.dataset.combo); return _render(); }
        const u = e.target.closest("[data-ui]");    if (u) { Theme.set("ui", u.dataset.ui); return _render(); }
        const tb = e.target.closest("[data-table]"); if (tb) { Theme.set("table", tb.dataset.table); return _render(); }
        const d = e.target.closest("[data-dice]");  if (d) { _applyDice(d.dataset.dice); try { window.dispatchEvent(new CustomEvent("vtt:dice-set")); } catch (x) {} return _render(); }
      });
      document.addEventListener("keydown", e => { if (e.key === "Escape" && _el && _el.classList.contains("open")) close(); });
    }
    _render();
    requestAnimationFrame(() => _el.classList.add("open"));
  }
  function close() { if (_el) _el.classList.remove("open"); }

  return { open, close };
})();
