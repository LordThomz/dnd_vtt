/* ══════════════════════════════════════════════════════════════════════════
   pack-manager.js – Inhaltspakete verwalten, importieren, erstellen
   ══════════════════════════════════════════════════════════════════════════

   Öffnen:  PackManager.open({ tab, onChange })
              tab       "installed" | "import" | "create"
              onChange  wird nach jeder Änderung aufgerufen (z.B. Bibliothek neu laden)

   Teilen unter Spielern läuft über Dateien (.vttpack). Es gibt bewusst
   keinen öffentlichen Katalog. Server-Logik: packs.py, Routen /api/packs/*.

   Würfel-Sets liegen im Browser (localStorage "vtt_dice_sets"). Beim Export
   schickt diese Datei die ausgewählten Sets mit, beim Import legt sie die
   Sets aus dem Paket dort an.

   Nutzt die Fenster-Stile aus design-studio.css (.ds-*), damit alle
   Dialoge gleich aussehen und jedem Design folgen.
   ══════════════════════════════════════════════════════════════════════════ */
const PackManager = (() => {
  "use strict";

  const CAT_LABEL = {
    races: "Rassen", classes: "Klassen", subclasses: "Unterklassen", items: "Gegenstände",
    magic_items: "Magische Gegenstände", spells: "Zauber", attacks: "Angriffe", feats: "Talente",
    backgrounds: "Hintergründe", conditions: "Zustände", monsters: "Monster",
  };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

  let _el = null, _tab = "installed", _onChange = null, _packs = [], _preview = null, _file = null, _lib = null;
  let _readOnly = false;   // über das Netzwerk verbunden → nur ansehen/herunterladen

  // ── Hilfen ──────────────────────────────────────────────────────────────
  async function _api(url, opts) {
    const res = await fetch(url, opts);
    let data = null;
    try { data = await res.clone().json(); } catch (e) {}
    if (!res.ok) throw new Error((data && data.error) || ("Fehler " + res.status));
    return { res, data };
  }
  function _toast(msg) {
    if (typeof toast === "function") return toast(msg);
    if (typeof UI !== "undefined" && UI.toast) return UI.toast(msg);
    console.log(msg);
  }
  function _countsText(counts) {
    const parts = Object.entries(counts || {}).filter(([, n]) => n > 0)
      .map(([c, n]) => `${n} ${CAT_LABEL[c] || c}`);
    return parts.length ? parts.join(" · ") : "leer";
  }
  function _changed() { if (_onChange) { try { _onChange(); } catch (e) {} } }

  // Würfel-Sets im Browser
  function _diceStore() {
    try { return JSON.parse(localStorage.getItem("vtt_dice_sets") || "null") || { sets: [], activeId: null }; }
    catch (e) { return { sets: [], activeId: null }; }
  }
  function _addDiceSets(sets) {
    const store = _diceStore();
    if (!Array.isArray(store.sets)) store.sets = [];
    let n = 0;
    (sets || []).forEach(s => {
      if (!s || typeof s.dice !== "object") return;
      const copy = JSON.parse(JSON.stringify(s));
      copy.id = "set_" + Math.random().toString(36).slice(2, 10);
      copy.name = String(copy.name || "Importiertes Set").slice(0, 60);
      delete copy.presetId;
      store.sets.push(copy); n++;
    });
    if (!store.activeId && store.sets.length) store.activeId = store.sets[0].id;
    localStorage.setItem("vtt_dice_sets", JSON.stringify(store));
    return n;
  }

  /** Datei speichern: Desktop-App → Download-Ordner, Browser → Download. */
  async function _saveFile(name, bytes) {
    const T = window.__TAURI__;
    if (T && T.fs && T.path) {
      const dir = await T.path.downloadDir();
      const full = await T.path.join(dir, name);
      await T.fs.writeFile(full, bytes);
      if (T.shell && T.shell.open) { try { await T.shell.open(dir); } catch (e) {} }
      return `im Download-Ordner gespeichert: ${name}`;
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
    const a = document.createElement("a");
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return `heruntergeladen: ${name}`;
  }

  // ── Reiter: installierte Pakete ─────────────────────────────────────────
  function _installed() {
    if (!_packs.length) return `<p class="ds-lead">Lade …</p>`;
    return `<p class="ds-lead">Jeder Bibliotheks-Eintrag gehört zu genau einer Quelle. Abgeschaltete Pakete verschwinden aus Charakter-Builder und Spieltisch, bleiben aber gespeichert. Welche Pakete eine Kampagne nutzt, legt der DM am Spieltisch fest.</p>
    <div class="pm-list">` + _packs.map(p => `
      <div class="pm-row${p.enabled ? "" : " off"}">
        <div class="pm-ico">${p.id === "basis" ? "📘" : p.id === "eigene" ? "✍️" : "📦"}</div>
        <div class="pm-info">
          <div class="pm-name">${esc(p.name)} ${p.version ? `<span class="pm-ver">v${esc(p.version)}</span>` : ""}</div>
          <div class="pm-meta">${p.author ? "von " + esc(p.author) + " · " : ""}${esc(_countsText(p.counts))}</div>
          ${p.description ? `<div class="pm-desc">${esc(p.description)}</div>` : ""}
        </div>
        <div class="pm-actions">
          ${_readOnly ? "" : `<label class="pm-switch" title="${p.enabled ? "Aktiv" : "Abgeschaltet"}">
            <input type="checkbox" data-toggle="${esc(p.id)}" ${p.enabled ? "checked" : ""}><span></span></label>`}
          <button class="pm-btn" data-export="${esc(p.id)}" ${p.total ? "" : "disabled"} title="Als Datei zum Weitergeben speichern">Teilen</button>
          ${p.builtin || _readOnly ? "" : `<button class="pm-btn danger" data-remove="${esc(p.id)}" title="Paket und seine Einträge entfernen">Entfernen</button>`}
        </div>
      </div>`).join("") + `</div>`;
  }

  // ── Reiter: importieren ─────────────────────────────────────────────────
  function _import() {
    let html = `<p class="ds-lead">Ein Paket (.vttpack) von einem Mitspieler hinzufügen. Ist es schon installiert, wird es auf die neue Version aktualisiert.</p>
      <label class="pm-drop" id="pm-drop">
        <input type="file" accept=".vttpack,.zip" id="pm-file" hidden>
        <div class="pm-drop-ico">📥</div>
        <div><b>Datei hierher ziehen</b> oder klicken zum Auswählen</div>
        <small>.vttpack</small>
      </label>`;
    if (_preview) {
      const p = _preview.pack;
      html += `<div class="pm-preview">
        <div class="pm-name">📦 ${esc(p.name)} <span class="pm-ver">v${esc(p.version)}</span></div>
        <div class="pm-meta">${p.author ? "von " + esc(p.author) : ""}</div>
        ${p.description ? `<div class="pm-desc">${esc(p.description)}</div>` : ""}
        <div class="pm-chips">${Object.entries(_preview.counts).map(([c, n]) => `<span>${n} ${esc(CAT_LABEL[c] || c)}</span>`).join("")}
          ${_preview.dice_sets ? `<span>${_preview.dice_sets} Würfel-Set${_preview.dice_sets > 1 ? "s" : ""}</span>` : ""}</div>
        ${_preview.is_update ? `<div class="pm-note">Bereits installiert (v${esc(_preview.installed_version)}). Die Einträge dieses Pakets werden ersetzt – Änderungen, die du an ihnen gemacht hast, gehen dabei verloren.</div>` : ""}
        <div class="pm-foot"><button class="pm-btn" data-cancel-import>Abbrechen</button>
          <button class="pm-btn primary" data-do-import>${_preview.is_update ? "Aktualisieren" : "Installieren"}</button></div>
      </div>`;
    }
    return html;
  }

  // ── Reiter: Paket erstellen ─────────────────────────────────────────────
  function _create() {
    if (!_lib) return `<p class="ds-lead">Lade Bibliothek …</p>`;
    const bySource = {};
    Object.entries(_lib).forEach(([cat, entries]) => Object.values(entries || {}).forEach(e => {
      const src = e.source || "eigene";
      ((bySource[src] = bySource[src] || {})[cat] = bySource[src][cat] || []).push(e);
    }));
    const srcName = id => (_packs.find(p => p.id === id) || {}).name || id;
    const tree = Object.keys(bySource).sort((a, b) => (a === "eigene" ? -1 : b === "eigene" ? 1 : 0)).map(src => `
      <details class="pm-src" ${src === "eigene" ? "open" : ""}>
        <summary><label><input type="checkbox" data-src="${esc(src)}"> ${esc(srcName(src))}</label></summary>
        ${Object.entries(bySource[src]).map(([cat, list]) => `
          <div class="pm-cat"><div class="pm-cat-h">${esc(CAT_LABEL[cat] || cat)}</div>
            ${list.sort((a, b) => (a.name || "").localeCompare(b.name || "")).map(e =>
              `<label class="pm-entry"><input type="checkbox" data-entry="${esc(cat)}|${esc(e.id)}" data-of="${esc(src)}"> ${esc(e.name || "—")}</label>`).join("")}
          </div>`).join("")}
      </details>`).join("");
    const dice = _diceStore().sets || [];
    return `<p class="ds-lead">Stelle ein Paket zusammen und gib die Datei an deine Mitspieler weiter.</p>
      <div class="pm-form">
        <label>Name <input id="pm-name" placeholder="z. B. Schattenreich" maxlength="80"></label>
        <label>Version <input id="pm-version" value="1.0.0" maxlength="20"></label>
        <label class="wide">Beschreibung <input id="pm-desc" placeholder="Worum geht es in dem Paket?" maxlength="500"></label>
      </div>
      <div class="pm-h">Inhalte</div>
      <div class="pm-tree">${tree || "<p class='ds-lead'>Die Bibliothek ist leer.</p>"}</div>
      ${dice.length ? `<div class="pm-h">Würfel-Sets beilegen</div><div class="pm-dice">` +
        dice.map(s => `<label class="pm-entry"><input type="checkbox" data-dice="${esc(s.id)}"> 🎲 ${esc(s.name || "Set")}</label>`).join("") + `</div>` : ""}
      <div class="pm-foot"><span id="pm-sum" class="pm-meta"></span><button class="pm-btn primary" data-do-export>Paket-Datei erstellen</button></div>`;
  }

  // ── Aktionen ────────────────────────────────────────────────────────────
  async function _loadPacks() {
    try { _packs = (await _api("/api/packs")).data || []; } catch (e) { _packs = []; _toast("⚠️ " + e.message); }
  }
  async function _loadLib() {
    try { _lib = (await _api("/api/library")).data || {}; } catch (e) { _lib = {}; }
  }

  async function _exportSource(pid) {
    const p = _packs.find(x => x.id === pid) || {};
    const name = p.builtin ? (pid === "eigene" ? "Meine Inhalte" : "Grundregeln") : p.name;
    await _exportRequest({ id: p.builtin ? "" : pid, name, version: p.version || "1.0.0",
      description: p.description || "", sources: [pid] });
  }

  async function _exportRequest(body) {
    try {
      const { res } = await _api("/api/packs/export", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const cd = res.headers.get("Content-Disposition") || "";
      const name = (cd.match(/filename="([^"]+)"/) || [])[1] || "paket.vttpack";
      const msg = await _saveFile(name, new Uint8Array(await res.arrayBuffer()));
      _toast("📦 Paket " + msg);
    } catch (e) { _toast("⚠️ " + e.message); }
  }

  async function _pickFile(file) {
    if (!file) return;
    _file = file; _preview = null;
    const fd = new FormData(); fd.append("file", file);
    try { _preview = (await _api("/api/packs/preview", { method: "POST", body: fd })).data; }
    catch (e) { _toast("⚠️ " + e.message); _file = null; }
    _render();
  }

  async function _doImport() {
    if (!_file) return;
    const fd = new FormData(); fd.append("file", _file);
    try {
      const r = (await _api("/api/packs/import", { method: "POST", body: fd })).data;
      const nd = _addDiceSets(r.dice);
      _toast(`✅ „${r.pack.name}" installiert: ${r.added} Einträge${nd ? `, ${nd} Würfel-Set${nd > 1 ? "s" : ""}` : ""}`);
      _file = null; _preview = null; _tab = "installed";
      await _loadPacks(); _lib = null; _render(); _changed();
    } catch (e) { _toast("⚠️ " + e.message); }
  }

  function _collectExport() {
    const q = sel => Array.from(_el.querySelectorAll(sel));
    const entries = {};
    q("[data-entry]:checked").forEach(cb => {
      const [cat, id] = cb.dataset.entry.split("|");
      (entries[cat] = entries[cat] || []).push(id);
    });
    const diceIds = new Set(q("[data-dice]:checked").map(cb => cb.dataset.dice));
    const dice = (_diceStore().sets || []).filter(s => diceIds.has(s.id));
    return { entries, dice };
  }
  function _updateSum() {
    const { entries, dice } = _collectExport();
    const n = Object.values(entries).reduce((s, l) => s + l.length, 0);
    const el = _el.querySelector("#pm-sum");
    if (el) el.textContent = `${n} Einträge${dice.length ? `, ${dice.length} Würfel-Sets` : ""} ausgewählt`;
  }

  async function _doExport() {
    const name = (_el.querySelector("#pm-name").value || "").trim();
    if (!name) { _toast("⚠️ Bitte einen Namen eingeben"); return; }
    const { entries, dice } = _collectExport();
    const user = (window.State && State.username) || "";
    await _exportRequest({
      id: (user ? user + "." : "") + name.toLowerCase().replace(/[^a-z0-9äöüß]+/g, "-").replace(/[äöüß]/g, c => ({ ä: "ae", ö: "oe", ü: "ue", ß: "ss" }[c])),
      name, version: _el.querySelector("#pm-version").value || "1.0.0",
      description: _el.querySelector("#pm-desc").value || "",
      entries, dice_sets: dice,
    });
  }

  // ── Fenster ─────────────────────────────────────────────────────────────
  function _render() {
    const body = { installed: _installed, import: _import, create: _create }[_tab]();
    _el.querySelector(".ds-body").innerHTML = body;
    _el.querySelectorAll(".ds-tab").forEach(b => {
      b.classList.toggle("on", b.dataset.tab === _tab);
      if (b.dataset.tab === "import") b.style.display = _readOnly ? "none" : "";
    });
    if (_tab === "create" && !_lib) _loadLib().then(_render);
    if (_tab === "create") _updateSum();
  }

  function _bind() {
    _el.addEventListener("click", async e => {
      if (e.target === _el || e.target.closest(".ds-x")) return close();
      const t = e.target.closest("[data-tab]"); if (t) { _tab = t.dataset.tab; return _render(); }
      const ex = e.target.closest("[data-export]"); if (ex) return _exportSource(ex.dataset.export);
      const rm = e.target.closest("[data-remove]");
      if (rm) {
        const p = _packs.find(x => x.id === rm.dataset.remove);
        const ok = (typeof Dialog !== "undefined" && Dialog.confirm)
          ? await Dialog.confirm(`„${p.name}" und alle ${p.total} Einträge daraus entfernen?`, { title: "Paket entfernen", okText: "Entfernen", danger: true })
          : confirm(`„${p.name}" entfernen?`);
        if (!ok) return;
        try { await _api("/api/packs/" + encodeURIComponent(p.id), { method: "DELETE" }); _toast("🗑 Paket entfernt"); await _loadPacks(); _render(); _changed(); }
        catch (err) { _toast("⚠️ " + err.message); }
        return;
      }
      if (e.target.closest("[data-do-import]")) return _doImport();
      if (e.target.closest("[data-cancel-import]")) { _file = null; _preview = null; return _render(); }
      if (e.target.closest("[data-do-export]")) return _doExport();
    });
    _el.addEventListener("change", async e => {
      const tg = e.target.closest("[data-toggle]");
      if (tg) {
        try { await _api(`/api/packs/${encodeURIComponent(tg.dataset.toggle)}/enabled`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: tg.checked }) });
          await _loadPacks(); _render(); _changed(); }
        catch (err) { _toast("⚠️ " + err.message); }
        return;
      }
      if (e.target.id === "pm-file") return _pickFile(e.target.files[0]);
      const src = e.target.closest("[data-src]");
      if (src) _el.querySelectorAll(`[data-of="${CSS.escape(src.dataset.src)}"]`).forEach(cb => { cb.checked = src.checked; });
      if (e.target.matches("[data-entry],[data-dice],[data-src]")) _updateSum();
    });
    // Ziehen & Ablegen
    _el.addEventListener("dragover", e => { const d = e.target.closest("#pm-drop"); if (d) { e.preventDefault(); d.classList.add("hover"); } });
    _el.addEventListener("dragleave", e => { const d = e.target.closest("#pm-drop"); if (d) d.classList.remove("hover"); });
    _el.addEventListener("drop", e => {
      const d = e.target.closest("#pm-drop"); if (!d) return;
      e.preventDefault(); d.classList.remove("hover");
      _pickFile(e.dataTransfer.files[0]);
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && _el.classList.contains("open")) close(); });
  }

  async function open(opts) {
    opts = opts || {};
    if (opts.tab) _tab = opts.tab;
    if (opts.onChange) _onChange = opts.onChange;
    _readOnly = !!opts.readOnly;
    if (_readOnly && _tab === "import") _tab = "installed";
    if (!_el) {
      _el = document.createElement("div");
      _el.className = "ds-backdrop";
      _el.innerHTML = `<div class="ds-win" role="dialog" aria-modal="true" aria-label="Inhaltspakete">
        <header class="ds-head"><div><h2>Inhaltspakete</h2><span>Inhalte ordnen, an-/abschalten und mit Mitspielern teilen</span></div>
          <button class="ds-x" aria-label="Schließen">✕</button></header>
        <nav class="ds-tabs">
          <button class="ds-tab" data-tab="installed">📚 Installiert</button>
          <button class="ds-tab" data-tab="import">📥 Importieren</button>
          <button class="ds-tab" data-tab="create">📤 Paket erstellen</button>
        </nav>
        <div class="ds-body"></div></div>`;
      document.body.appendChild(_el);
      _bind();
    }
    _lib = null;
    _render();
    requestAnimationFrame(() => _el.classList.add("open"));
    await _loadPacks();
    _render();
  }
  function close() { if (_el) _el.classList.remove("open"); }

  return { open, close, CAT_LABEL };
})();
