/**
 * journal.js – Journal/Wiki mit Cross-Linking und geheimen GM-Notizen
 *
 * Cross-Linking: [[Eintragstitel]] im Text wird zu einem klickbaren Link,
 * der den verlinkten Eintrag öffnet. Existiert der Eintrag nicht, wird der
 * Link rot markiert (und der GM kann ihn per Klick anlegen).
 *
 * GM-Notizen: Jeder Eintrag hat einen für Spieler sichtbaren Inhalt und ein
 * separates, nur für den DM sichtbares Notizfeld. Spieler-Clients erhalten
 * die GM-Notizen gar nicht erst vom Server.
 */
function _jEsc(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}

let _journalEditId = null;   // id des gerade bearbeiteten Eintrags (null = neu)
let _journalViewId = null;   // id des gerade angezeigten Eintrags

function renderJournalList(){
  const box = document.getElementById("journal-list");
  const viewer = document.getElementById("journal-viewer");
  if (!box) return;
  // Wenn gerade ein Eintrag angezeigt/bearbeitet wird, Liste ausblenden
  if (_journalViewId || _journalEditId) { box.style.display="none"; return; }
  box.style.display = "block";
  if (viewer) viewer.style.display = "none";

  const search = (document.getElementById("journal-search")?.value||"").toLowerCase();
  const entries = (State.journal||[]).filter(e =>
    !search || (e.title||"").toLowerCase().includes(search) || (e.content||"").toLowerCase().includes(search)
  ).sort((a,b)=>(a.title||"").localeCompare(b.title||""));

  if (!entries.length){
    box.innerHTML = `<div style="color:var(--text-dim);text-align:center;padding:20px;font-style:italic;font-size:.85rem">
      ${search?"Nichts gefunden.":"Noch keine Einträge."}${State.isGM&&!search?'<br>Klicke „+ Neu" für den ersten Eintrag.':""}
    </div>`;
    return;
  }
  box.innerHTML = entries.map(e=>`
    <div class="journal-item" onclick="viewJournalEntry('${e.id}')">
      <div class="ji-title">📖 ${_jEsc(e.title||"Ohne Titel")}</div>
      <div class="ji-preview">${_jEsc((e.content||"").replace(/\[\[|\]\]/g,"").slice(0,80))}${(e.content||"").length>80?"…":""}</div>
      <div class="ji-badges">
        ${e.visible_to_players ? '<span class="ji-badge vis">👁 Sichtbar</span>' : '<span class="ji-badge hidden">🔒 DM only</span>'}
        ${State.isGM && e.gm_notes ? '<span class="ji-badge notes">📝 Notizen</span>' : ''}
      </div>
    </div>`).join("");
}

// Wandelt [[Titel]] in klickbare Links um
function _renderCrossLinks(text){
  const titleToId = {};
  (State.journal||[]).forEach(e => { titleToId[(e.title||"").toLowerCase()] = e.id; });
  const escaped = _jEsc(text||"");
  return escaped.replace(/\[\[([^\]]+)\]\]/g, (m, name)=>{
    const key = name.trim().toLowerCase();
    const id = titleToId[key];
    if (id){
      return `<a class="journal-link" onclick="viewJournalEntry('${id}')">${_jEsc(name.trim())}</a>`;
    }
    // Nicht existierender Eintrag
    if (State.isGM){
      return `<a class="journal-link missing" onclick="newJournalEntry('${_jEsc(name.trim()).replace(/'/g,"")}')">${_jEsc(name.trim())} ✚</a>`;
    }
    return `<span class="journal-link missing">${_jEsc(name.trim())}</span>`;
  }).replace(/\n/g,"<br>");
}

function viewJournalEntry(id){
  const e = (State.journal||[]).find(x=>x.id===id);
  if (!e) return;
  _journalViewId = id;
  _journalEditId = null;
  const box = document.getElementById("journal-list");
  const viewer = document.getElementById("journal-viewer");
  if (box) box.style.display = "none";
  if (!viewer) return;
  viewer.style.display = "flex";
  viewer.innerHTML = `
    <div style="padding:8px 10px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:6px;flex-shrink:0">
      <button class="btn btn-dark btn-sm" onclick="closeJournalEntry()">← Zurück</button>
      ${State.isGM?`<button class="btn btn-dark btn-sm" onclick="editJournalEntry('${e.id}')">✏️ Bearbeiten</button>
        <button class="btn btn-danger btn-sm" onclick="deleteJournalEntry('${e.id}')">🗑</button>`:""}
    </div>
    <div class="pane-scroll" style="padding:12px">
      <h2 style="font-family:'Cinzel',serif;color:var(--gold);font-size:1.2rem;margin-bottom:4px">${_jEsc(e.title||"Ohne Titel")}</h2>
      <div style="font-size:.7rem;color:var(--text-dim);margin-bottom:12px">
        ${e.visible_to_players?"👁 Für Spieler sichtbar":"🔒 Nur für DM"}
      </div>
      <div class="journal-content">${_renderCrossLinks(e.content)}</div>
      ${State.isGM && e.gm_notes ? `
        <div class="journal-gmnotes">
          <div class="jgn-title">📝 Geheime DM-Notizen (nur du siehst das)</div>
          <div>${_renderCrossLinks(e.gm_notes)}</div>
        </div>` : ""}
    </div>`;
}

function closeJournalEntry(){
  _journalViewId = null;
  _journalEditId = null;
  renderJournalList();
}

function newJournalEntry(prefillTitle){
  if (!State.isGM) return;
  _journalEditId = "__new__";
  _journalViewId = null;
  _showJournalEditor({id:null, title: (typeof prefillTitle==="string"?prefillTitle:""), content:"", gm_notes:"", visible_to_players:false});
}

function editJournalEntry(id){
  const e = (State.journal||[]).find(x=>x.id===id);
  if (!e || !State.isGM) return;
  _journalEditId = id;
  _journalViewId = null;
  _showJournalEditor(e);
}

function _showJournalEditor(e){
  const box = document.getElementById("journal-list");
  const viewer = document.getElementById("journal-viewer");
  if (box) box.style.display = "none";
  if (!viewer) return;
  viewer.style.display = "flex";
  viewer.innerHTML = `
    <div class="pane-scroll" style="padding:12px">
      <label class="field-label">Titel</label>
      <input class="form-input" id="je-title" value="${_jEsc(e.title||"")}" placeholder="z.B. Dorf Altheim" style="margin-bottom:8px">

      <label class="field-label">Inhalt (Spieler sehen dies, wenn freigegeben)</label>
      <div style="font-size:.68rem;color:var(--text-dim);margin-bottom:3px">Tipp: [[Anderer Eintrag]] erstellt einen Link</div>
      <textarea class="form-input" id="je-content" rows="7" placeholder="Beschreibung…" style="margin-bottom:8px">${_jEsc(e.content||"")}</textarea>

      <label class="field-label">📝 Geheime DM-Notizen (nie für Spieler sichtbar)</label>
      <textarea class="form-input" id="je-gmnotes" rows="4" placeholder="Deine geheimen Notizen…" style="margin-bottom:8px">${_jEsc(e.gm_notes||"")}</textarea>

      <label style="display:flex;align-items:center;gap:8px;font-size:.85rem;cursor:pointer;margin-bottom:12px">
        <input type="checkbox" id="je-visible" ${e.visible_to_players?"checked":""} style="width:auto">
        👁 Für Spieler sichtbar machen
      </label>

      <div style="display:flex;gap:6px">
        <button class="btn btn-gold" style="flex:1" onclick="saveJournalEntry('${e.id||""}')">💾 Speichern</button>
        <button class="btn btn-dark" onclick="closeJournalEntry()">Abbrechen</button>
      </div>
    </div>`;
  setTimeout(()=>document.getElementById("je-title")?.focus(), 50);
}

function saveJournalEntry(id){
  const payload = {
    session_id: State.session_id,
    id: id || null,
    title: document.getElementById("je-title")?.value.trim() || "Ohne Titel",
    content: document.getElementById("je-content")?.value || "",
    gm_notes: document.getElementById("je-gmnotes")?.value || "",
    visible_to_players: document.getElementById("je-visible")?.checked || false,
  };
  Socket.emit("journal_save", payload);
  _journalEditId = null;
  _journalViewId = null;
  UI.toast("💾 Journal gespeichert");
  // Liste erscheint nach journal_updated-Event automatisch neu
  setTimeout(renderJournalList, 200);
}

async function deleteJournalEntry(id){
  if (!await Dialog.confirmDanger("Der Journal-Eintrag wird gelöscht.",
      {title:"Eintrag löschen?", icon:"📖"})) return;
  Socket.emit("journal_delete", {session_id:State.session_id, id});
  _journalViewId = null;
  _journalEditId = null;
  UI.toast("🗑 Eintrag gelöscht");
  setTimeout(renderJournalList, 200);
}
