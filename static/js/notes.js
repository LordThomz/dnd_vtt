/**
 * notes.js – Spieler-Notizen.
 * Spieler erstellen Notizen (privat oder mit allen geteilt).
 * Der DM sieht alle Notizen in einer Ordnerstruktur: pro Autor + "Geteilte Notizen".
 */
function _nEsc(s){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}

let _notesOpenFolders = {};   // welche Ordner (DM-Ansicht) offen sind
let _noteEditId = null;       // gerade bearbeitete Notiz

function createNote(){
  const title = document.getElementById("note-title")?.value?.trim() || "Notiz";
  const content = document.getElementById("note-content")?.value?.trim() || "";
  const shared = document.getElementById("note-shared")?.checked || false;
  if(!content){ UI.toast("Bitte einen Text eingeben"); return; }
  if(_noteEditId){
    Socket.emit("note_update",{session_id:State.session_id,id:_noteEditId,title,content,shared});
    _noteEditId = null;
  } else {
    Socket.emit("note_add",{session_id:State.session_id,title,content,shared});
  }
  document.getElementById("note-title").value = "";
  document.getElementById("note-content").value = "";
  document.getElementById("note-shared").checked = false;
  UI.toast("📝 Notiz gespeichert");
}

function editNote(id){
  const n = (State.notes||[]).find(x=>x.id===id);
  if(!n) return;
  document.getElementById("note-title").value = n.title||"";
  document.getElementById("note-content").value = n.content||"";
  document.getElementById("note-shared").checked = !!n.shared;
  _noteEditId = id;
  UI.toast("✏️ Bearbeiten – dann Speichern");
}

async function deleteNote(id){
  if(!await Dialog.confirmDanger("Die Notiz wird gelöscht.",
      {title:"Notiz löschen?", icon:"📝"})) return;
  Socket.emit("note_delete",{session_id:State.session_id,id});
}

function toggleNoteShared(id, shared){
  Socket.emit("note_update",{session_id:State.session_id,id,shared});
}

function _toggleNotesFolder(key){
  _notesOpenFolders[key] = !_notesOpenFolders[key];
  renderNotes();
}

function renderNotes(){
  const box = document.getElementById("notes-container");
  if(!box) return;
  const notes = State.notes || [];

  if(State.isGM){
    // DM-Ansicht: Ordnerstruktur nach Autor + Geteilte
    if(!notes.length){
      box.innerHTML = `<div style="color:var(--text-dim);text-align:center;padding:20px;font-style:italic;font-size:.85rem">Noch keine Spieler-Notizen.</div>`;
      return;
    }
    // Gruppieren
    const shared = notes.filter(n=>n.shared);
    const byAuthor = {};
    notes.forEach(n=>{
      const key = n.author_char_id || n.author_name || "unbekannt";
      (byAuthor[key] = byAuthor[key] || {name:n.author_name||"Spieler", items:[]}).items.push(n);
    });
    let html = "";
    // Geteilte Notizen zuerst
    const sharedOpen = _notesOpenFolders["__shared__"];
    html += `<div class="notes-folder">
      <div class="nf-head" onclick="_toggleNotesFolder('__shared__')">
        <span>${sharedOpen?"📂":"📁"} Geteilte Notizen</span><span class="nf-count">${shared.length}</span>
      </div>
      ${sharedOpen ? shared.map(n=>_noteCardGM(n)).join("") || '<div class="nf-empty">Keine geteilten Notizen</div>' : ""}
    </div>`;
    // Pro Autor
    Object.keys(byAuthor).forEach(key=>{
      const grp = byAuthor[key];
      const open = _notesOpenFolders[key];
      html += `<div class="notes-folder">
        <div class="nf-head" onclick="_toggleNotesFolder('${_nEsc(key)}')">
          <span>${open?"📂":"📁"} ${_nEsc(grp.name)}</span><span class="nf-count">${grp.items.length}</span>
        </div>
        ${open ? grp.items.map(n=>_noteCardGM(n)).join("") : ""}
      </div>`;
    });
    box.innerHTML = html;
  } else {
    // Spieler-Ansicht: eigene + geteilte, als flache Liste
    if(!notes.length){
      box.innerHTML = `<div style="color:var(--text-dim);text-align:center;padding:20px;font-style:italic;font-size:.85rem">Noch keine Notizen.<br>Erstelle unten deine erste Notiz.</div>`;
      return;
    }
    box.innerHTML = notes.map(n=>_noteCardPlayer(n)).join("");
  }
}

function _noteCardGM(n){
  return `<div class="note-card">
    <div class="note-card-head">
      <span class="note-title">${n.shared?"🔓":"🔒"} ${_nEsc(n.title||"Notiz")}</span>
    </div>
    <div class="note-body">${_nEsc(n.content||"")}</div>
    <div class="note-meta">von ${_nEsc(n.author_name||"?")}</div>
  </div>`;
}

function _noteCardPlayer(n){
  const mine = n.author_char_id===State.my_char_id;
  return `<div class="note-card">
    <div class="note-card-head">
      <span class="note-title">${n.shared?"🔓":"🔒"} ${_nEsc(n.title||"Notiz")}</span>
      ${mine?`<div class="note-actions">
        <button title="Teilen an/aus" onclick="toggleNoteShared('${n.id}',${!n.shared})">${n.shared?"🔓":"🔒"}</button>
        <button title="Bearbeiten" onclick="editNote('${n.id}')">✏️</button>
        <button title="Löschen" onclick="deleteNote('${n.id}')">🗑</button>
      </div>`:`<span class="note-shared-tag">geteilt</span>`}
    </div>
    <div class="note-body">${_nEsc(n.content||"")}</div>
    ${!mine?`<div class="note-meta">von ${_nEsc(n.author_name||"?")}</div>`:""}
  </div>`;
}
