/** ui.js */

const UI = {
  toast(msg,dur=2600){
    const el=document.getElementById("toast");
    el.textContent=msg;el.classList.add("show");
    clearTimeout(el._t);el._t=setTimeout(()=>el.classList.remove("show"),dur);
  }
};

const Tabs = (() => {
  const MAP={chat:"tab-chat",init:"tab-init",char:"tab-char",
             attacks:"tab-attacks",inventory:"tab-inventory",notes:"tab-notes",journal:"tab-journal",music:"tab-music",
             enemies:"tab-enemies",gmsettings:"tab-gmsettings",maps:"tab-maps",roster:"tab-roster"};
  function switchTo(name){
    document.querySelectorAll(".tab-pane").forEach(p=>p.classList.remove("active"));
    document.querySelectorAll(".p-tab").forEach(t=>t.classList.remove("active"));
    document.getElementById(MAP[name])?.classList.add("active");
    document.querySelectorAll(`.p-tab[data-tab="${name}"]`).forEach(t=>t.classList.add("active"));
  }
  function init(){
    document.querySelectorAll(".p-tab").forEach(t=>t.addEventListener("click",()=>switchTo(t.dataset.tab)));
  }
  return {init,switchTo};
})();

const ContextMenu = (() => {
  let el;
  function init(){
    el=document.getElementById("ctx-menu");
    document.addEventListener("click",hide);
  }
  function show(x,y,items){
    el.innerHTML=items.map(i=>i.sep?`<div class="ctx-sep"></div>`:
      `<div class="ctx-item"><span style="width:18px;text-align:center">${i.icon||""}</span>${i.label}</div>`
    ).join("");
    el.querySelectorAll(".ctx-item").forEach((node,i)=>{
      const real=items.filter(x=>!x.sep)[i];
      if(real?.action) node.addEventListener("click",()=>{hide();real.action();});
    });
    el.style.left=Math.min(x,window.innerWidth-180)+"px";
    el.style.top =Math.min(y,window.innerHeight-240)+"px";
    el.classList.add("open");
  }
  function hide(){el?.classList.remove("open");}
  function showMap(e){
    const gmItems=State.isGM?[
      {icon:"🌑",label:"Alles verdecken",   action:()=>Socket.emit("fog_cover_all",{session_id:State.session_id})},
      {icon:"🌕",label:"Alles aufdecken",   action:()=>Socket.emit("fog_clear_all",{session_id:State.session_id})},
      {sep:true},
      {icon:"🗑",label:"Zeichnung löschen",action:()=>Socket.emit("draw_clear",{session_id:State.session_id})},
    ]:[];
    show(e.clientX,e.clientY,[
      {icon:"🎲",label:"Würfeln",action:()=>Modals.openDice()},
      {icon:"📍",label:"Hier markieren",action:()=>{
        MapModule.createPingAt(e.clientX,e.clientY);
        Socket.emit("ping_map",{session_id:State.session_id,x:e.clientX,y:e.clientY});
      }},
      ...gmItems,
    ]);
  }
  function showToken(e,t){
    show(e.clientX,e.clientY,[
      {icon:"✏️",label:"Bearbeiten",   action:()=>Modals.openToken(t.id)},
      {icon:"⚔️",label:"Initiative würfeln",action:()=>{
        const im=t.initiative_bonus||0;
        const roll=Math.floor(Math.random()*20)+1+im;
        Socket.emit("initiative_add",{session_id:State.session_id,name:t.name,init:roll,
          hp:t.hp,max_hp:t.max_hp,ac:t.ac,conditions:t.conditions||[],token_id:t.id,owner:t.owner,
          is_enemy:t.is_enemy,
          show_hp_to_players:t.show_hp_to_players!==false,
          show_ac_to_players:t.show_ac_to_players!==false});
        UI.toast(`⚔️ ${t.name}: ${roll}`);
      }},
      ...(State.isGM?[{sep:true},{icon:"🗑",label:"Löschen",
        action:()=>Socket.emit("token_delete",{session_id:State.session_id,token_id:t.id})}]:[]),
    ]);
  }
  return {init,show,hide,showMap,showToken};
})();

const Toolbar = (() => {
  // Alle Werkzeuge, die per Klick auf die Karte wirken. Jedes davon setzt
  // State.activeTool. setTool ist der EINZIGE Ort, der aktive Zustände umschaltet,
  // damit nie zwei Werkzeuge gleichzeitig aktiv aussehen.
  const MAP_TOOLS = ["measure","draw","ping","wall","door-toggle","wall-erase","fog-add","fog-remove"];
  // Zuordnung Werkzeug → Button-ID (für visuelles Hervorheben)
  const TOOL_BTN = {
    measure:"tool-measure", draw:"tool-draw", ping:"tool-ping",
    wall:"tool-wall", "door-toggle":"tool-door", "wall-erase":"tool-wall-erase",
    "fog-add":"fog-add-btn", "fog-remove":"fog-remove-btn",
  };

  function setTool(name){
    const prev = State.activeTool;
    State.activeTool = name;

    // 1) ALLE Werkzeug-Buttons zurücksetzen (Toolbar + Spezial-Buttons)
    document.querySelectorAll(".tb-btn").forEach(b=>b.classList.remove("active"));
    ["tool-wall","tool-door","tool-wall-erase"].forEach(id=>document.getElementById(id)?.classList.remove("active"));
    // Fog-Pinsel-Buttons wechseln Farbe je nach Zustand
    const fa=document.getElementById("fog-add-btn"), fr=document.getElementById("fog-remove-btn");
    if(fa) fa.className = "btn btn-sm " + (name==="fog-add"?"btn-gold":"btn-dark");
    if(fr) fr.className = "btn btn-sm " + (name==="fog-remove"?"btn-gold":"btn-dark");

    // 2) Aktiven Button hervorheben
    if(name!=="none" && TOOL_BTN[name]){
      document.getElementById(TOOL_BTN[name])?.classList.add("active");
    }

    // 3) Wenn Wandwerkzeug verlassen wird, Wand-Zwischenstand aufräumen
    if(prev==="wall" && name!=="wall" && MapModule.stopWallTool){ MapModule.stopWallTool(); }

    // 4) Cursor + Pointer-Events auf der Zeichenebene steuern
    const dc=document.getElementById("draw-canvas");
    if(dc){
      const curMap={draw:"crosshair",measure:"crosshair",ping:"crosshair",wall:"crosshair","door-toggle":"pointer","wall-erase":"pointer","fog-add":"cell","fog-remove":"cell"};
      dc.style.cursor=curMap[name]||"default";
      dc.style.pointerEvents = MAP_TOOLS.includes(name) ? "all" : "none";
    }
    const dcg=document.getElementById("draw-color-group");
    if(dcg) dcg.style.display=name==="draw"?"flex":"none";
    // Wandtyp-Auswahl nur beim Wandwerkzeug einblenden
    const wts=document.getElementById("wall-type-select");
    if(wts) wts.style.display = (name==="wall") ? "inline-block" : "none";
    if (typeof MapModule !== "undefined" && MapModule.updateMapCursor) MapModule.updateMapCursor();
  }

  function init(){
    document.querySelectorAll(".tb-btn[data-tool]").forEach(b=>b.addEventListener("click",()=>{
      if(State.activeTool===b.dataset.tool) setTool("none");
      else setTool(b.dataset.tool);
    }));
    document.addEventListener("keydown",e=>{
      if(e.target.tagName==="INPUT"||e.target.tagName==="TEXTAREA") return;
      const m={m:"measure",d:"draw",p:"ping"};
      if(m[e.key]) setTool(m[e.key]);
      if(e.key==="Escape") setTool("none");
    });
    setTool("none");
  }
  return {init,setTool};
})();

function renderUsers(){
  const row=document.getElementById("users-row"); if(!row) return;
  row.innerHTML=State.users.slice(0,8).map(u=>`
    <div class="user-avatar" style="border-color:${u.color};background:${u.color}22;color:${u.color}"
         title="${u.name} (${u.role})">${u.name[0].toUpperCase()}</div>`).join("");
}

// ── Initiative ────────────────────────────────────────────────────────────────
function renderInitiative(){
  const panel=document.getElementById("init-list"); if(!panel) return;
  if(!State.initiative.length){
    panel.innerHTML=`<div style="color:var(--text-dim);text-align:center;padding:18px;font-style:italic">Keine Einträge…</div>`;
    return;
  }
  const ci=State.current_turn_index||0;
  panel.innerHTML=State.initiative.map((e,i)=>{
    const isActive=i===ci;
    const isDead = (e.conditions||[]).includes("dead");
    const conds=(e.conditions||[]).map(c=>`<span class="init-cond" title="${c}">${Tokens.CONDITIONS[c]||"⚡"}</span>`).join("");
    // Sichtbarkeit steuert allein der DM-Schalter (❤️/🛡 im Initiative-Tab).
    // Standard: bei Gegnern aus, bei Spielern an – siehe Server (show_*_to_players).
    const defVis   = !e.is_enemy;
    const canSeeHp = State.isGM || (e.show_hp_to_players ?? defVis) !== false;
    const canSeeAc = State.isGM || (e.show_ac_to_players ?? defVis) !== false;

    if (State.isGM) {
      // DM: editable HP/AC inputs + visibility toggles
      return `<div class="init-entry${isActive?" active-turn":""}${isDead?" dead-entry":""}">
        <div class="init-num" style="color:${isActive?"#fff":"var(--gold)"}">${e.init}</div>
        <div style="flex:1;min-width:0">
          <div class="init-name">${esc(e.name)}${e.is_enemy?`<span class="init-enemy"> 🐉</span>`:""}${isDead?`<span style="color:#ff3030;margin-left:6px">☠️ TOT</span>`:""}</div>
          <div class="init-hp-row">
            <span class="init-hp-label">❤️</span>
            <input class="init-hp-input" type="number" value="${e.hp||0}" onchange="updateInitHp('${e.id}','hp',this.value)" title="Aktuelle HP">
            <span style="color:var(--text-dim);font-size:.7rem">/</span>
            <input class="init-hp-input" type="number" value="${e.max_hp||0}" onchange="updateInitHp('${e.id}','max_hp',this.value)" title="Max HP">
            <span class="init-hp-label" style="margin-left:6px">🛡</span>
            <input class="init-hp-input" type="number" value="${e.ac||0}" onchange="updateInitHp('${e.id}','ac',this.value)" title="Rüstung">
          </div>
          <div style="display:flex;gap:4px;margin-top:4px">
            <button class="init-dmg-btn" onclick="applyInitDamage('${e.id}')" title="Schaden zufügen">💥</button>
            <button class="init-heal-btn" onclick="applyInitHeal('${e.id}')" title="Heilen">💚</button>
            <button class="init-vis-btn ${e.show_hp_to_players!==false?"on":""}" onclick="toggleInitVis('${e.id}','hp')" title="HP für Spieler sichtbar">❤️</button>
            <button class="init-vis-btn ${e.show_ac_to_players!==false?"on":""}" onclick="toggleInitVis('${e.id}','ac')" title="RK für Spieler sichtbar">🛡</button>
          </div>
          ${conds?`<div class="init-conds-row">${conds}</div>`:""}
        </div>
        <button class="init-del" onclick="Socket.emit('initiative_remove',{session_id:State.session_id,id:'${e.id}'})" title="Entfernen">✕</button>
      </div>`;
    } else {
      // Player view: read-only
      const hpStr = canSeeHp && e.max_hp ? `<span class="init-hp">❤️${e.hp}/${e.max_hp}</span>` : "";
      const acStr = canSeeAc && e.ac    ? `<span class="init-hp">🛡${e.ac}</span>` : "";
      return `<div class="init-entry${isActive?" active-turn":""}${isDead?" dead-entry":""}">
        <div class="init-num" style="color:${isActive?"#fff":"var(--gold)"}">${e.init}</div>
        <div style="flex:1;min-width:0">
          <div class="init-name">${esc(e.name)}${e.is_enemy?`<span class="init-enemy"> 🐉</span>`:""}${isDead?`<span style="color:#ff3030;margin-left:6px">☠️</span>`:""}</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">${hpStr}${acStr}</div>
          ${conds?`<div class="init-conds-row">${conds}</div>`:""}
        </div>
      </div>`;
    }
  }).join("");
}

function updateInitHp(entryId, field, val){
  const num = parseInt(val)||0;
  Socket.emit("initiative_update",{session_id:State.session_id,id:entryId,updates:{[field]:num}});
}
async function applyInitDamage(entryId, dmgStr){
  // Ohne mitgegebenen Wert: nach dem Schaden fragen.
  if (dmgStr === undefined || dmgStr === null) {
    const e0 = State.initiative.find(x=>x.id===entryId);
    dmgStr = await Dialog.promptNumber("Wie viel Schaden erleidet " + (e0?e0.name:"das Ziel") + "?", 5,
      {title:"Schaden zufügen", icon:"💥", okText:"Zufügen"});
    if (dmgStr === null) return;
  }
  const dmg=parseInt(dmgStr); if(isNaN(dmg)) return;
  const e=State.initiative.find(x=>x.id===entryId); if(!e) return;
  const newHp = Math.max(0, (e.hp||0) - dmg);
  Socket.emit("initiative_update",{session_id:State.session_id,id:entryId,updates:{hp:newHp}});
  UI.toast(`💥 ${e.name}: -${dmg} HP → ${newHp}`);
}
async function applyInitHeal(entryId, healStr){
  if (healStr === undefined || healStr === null) {
    const e0 = State.initiative.find(x=>x.id===entryId);
    healStr = await Dialog.promptNumber("Wie viel wird " + (e0?e0.name:"das Ziel") + " geheilt?", 5,
      {title:"Heilen", icon:"💚", okText:"Heilen"});
    if (healStr === null) return;
  }
  const heal=parseInt(healStr); if(isNaN(heal)) return;
  const e=State.initiative.find(x=>x.id===entryId); if(!e) return;
  const newHp = Math.min(e.max_hp||999, (e.hp||0) + heal);
  Socket.emit("initiative_update",{session_id:State.session_id,id:entryId,updates:{hp:newHp}});
  UI.toast(`💚 ${e.name}: +${heal} HP → ${newHp}`);
}

function toggleInitVis(entryId, kind){
  const e = State.initiative.find(x=>x.id===entryId);
  if(!e) return;
  const key = kind==="hp" ? "show_hp_to_players" : "show_ac_to_players";
  const newVal = e[key] === false ? true : false;
  Socket.emit("initiative_update",{session_id:State.session_id,id:entryId,updates:{[key]:newVal}});
}

// ── Handouts ──────────────────────────────────────────────────────────────────
function renderHandouts(){
  const panel=document.getElementById("handouts-list"); if(!panel) return;
  const vis=State.handouts.filter(h=>h.visible_to==="all"||State.isGM);
  panel.innerHTML=vis.length?vis.map(h=>`
    <div class="handout-card" onclick="Modals.openHandout('${h.id}')">
      <h4>${esc(h.title)}</h4><p>${esc(h.content.substring(0,90))}${h.content.length>90?"…":""}</p>
    </div>`).join(""):
    `<div style="color:var(--text-dim);text-align:center;padding:18px;font-style:italic">Keine Handouts…</div>`;
}

// ── Enemies ───────────────────────────────────────────────────────────────────
function renderEnemies(){
  const panel=document.getElementById("enemy-list"); if(!panel) return;
  const folders=State.enemy_folders||[];
  const enemies=State.enemies||{};
  if(!Object.keys(enemies).length&&!folders.length){
    panel.innerHTML=`<div style="color:var(--text-dim);text-align:center;padding:16px;font-style:italic">Keine Gegner…</div>`;
    return;
  }
  let html="";
  folders.forEach(f=>{
    const ids=f.enemy_ids||[];
    const folderEnemies=ids.map(id=>enemies[id]).filter(Boolean);
    html+=`<div class="enemy-folder">
      <div class="enemy-folder-header" onclick="this.parentElement.classList.toggle('open')">
        📁 ${esc(f.name)} <span style="color:var(--text-dim);font-size:.75rem">(${folderEnemies.length})</span>
        <span style="margin-left:auto">▸</span>
      </div>
      <div class="enemy-folder-body">`;
    folderEnemies.forEach(e=>{ html+=buildEnemyCard(e); });
    html+=`</div></div>`;
  });
  const allInFolders=new Set(folders.flatMap(f=>f.enemy_ids||[]));
  const ungrouped=Object.values(enemies).filter(e=>!allInFolders.has(e.id));
  ungrouped.forEach(e=>{ html+=buildEnemyCard(e); });
  panel.innerHTML=html;
}

function buildEnemyCard(e){
  return `<div class="enemy-card">
    <div class="enemy-head" onclick="inspectEnemy('${e.id}')" title="Charakterbogen ansehen">
      ${e.url?`<img src="${e.url}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;border:1px solid var(--red-soft)">`:`<div style="width:34px;height:34px;border-radius:50%;background:#2a0a0a;display:flex;align-items:center;justify-content:center;font-size:1.1rem;border:1px solid var(--red-soft)">🐉</div>`}
      <div style="flex:1;min-width:0">
        <div class="ec-name">${esc(e.name)}</div>
        <div class="ec-stats">HG ${e.cr} · ❤️${e.hp} · 🛡${e.ac} · 💨${e.speed}ft</div>
      </div>
      <span class="roster-open" title="Charakterbogen öffnen">📄</span>
    </div>
    ${e.notes?`<div style="font-size:.75rem;color:var(--text-dim);font-style:italic;margin-bottom:4px">${esc(e.notes)}</div>`:""}
    <div style="display:flex;gap:4px;flex-wrap:wrap">
      <button class="btn btn-gold btn-xs" onclick="Enemies.spawn('${e.id}')">+ Karte</button>
      <button class="btn btn-dark btn-xs" onclick="Enemies.addToInit('${e.id}')">+ Init</button>
      <button class="btn btn-dark btn-xs" onclick="Modals.openEnemyEdit('${e.id}')">✏️</button>
      <button class="btn btn-danger btn-xs" onclick="Socket.emit('enemy_delete',{session_id:State.session_id,id:'${e.id}'})">🗑</button>
    </div>
  </div>`;
}

// ── Maps panel ────────────────────────────────────────────────────────────────
function renderMapsPanel(){
  const panel=document.getElementById("maps-list"); if(!panel) return;
  const maps=State.maps||{};
  const folders=State.map_folders||[];

  // Rekursiv: Ordner können über parent_id verschachtelt sein.
  // Ordner ohne parent_id sind auf oberster Ebene.
  function renderFolder(folder, depth){
    const childFolders = folders.filter(f => (f.parent_id||"") === folder.id);
    const ids = folder.map_ids || [];
    const folderMaps = ids.map(id=>maps[id]).filter(Boolean);
    const totalCount = folderMaps.length + childFolders.length;
    let h = `<div class="map-folder" data-folder="${folder.id}" style="margin-left:${depth*10}px">
      <div class="map-folder-header" onclick="this.parentElement.classList.toggle('open')">
        📁 ${esc(folder.name)} <span style="color:var(--text-dim);font-size:.72rem">(${totalCount})</span>
        <span style="margin-left:auto;display:flex;gap:3px">
          <button class="btn btn-dark btn-xs" onclick="event.stopPropagation();addSubfolder('${folder.id}')" title="Unterordner">📁+</button>
          <button class="btn btn-dark btn-xs" onclick="event.stopPropagation();renameFolder('${folder.id}')" title="Umbenennen">✏️</button>
          <button class="btn btn-danger btn-xs" onclick="event.stopPropagation();deleteFolder('${folder.id}')" title="Löschen">🗑</button>
        </span>
      </div>
      <div class="map-folder-body">`;
    // Zuerst Unterordner (rekursiv), dann Karten
    childFolders.forEach(cf => { h += renderFolder(cf, depth+1); });
    folderMaps.forEach(m => { h += buildMapCard(m); });
    h += `</div></div>`;
    return h;
  }

  let html = "";
  // Oberste Ordner (ohne parent)
  folders.filter(f => !(f.parent_id||"")).forEach(f => { html += renderFolder(f, 0); });
  // Karten, die in keinem Ordner sind
  const allInFolders = new Set(folders.flatMap(f=>f.map_ids||[]));
  Object.values(maps).filter(m=>!allInFolders.has(m.id)).forEach(m=>{ html += buildMapCard(m); });

  panel.innerHTML=html||`<div style="color:var(--text-dim);text-align:center;padding:14px;font-style:italic">Keine Karten…</div>`;
}

function buildMapCard(m){
  const active=m.id===State.active_map_id;
  const folderOptions=(State.map_folders||[]).map(f=>`<option value="${f.id}" ${(f.map_ids||[]).includes(m.id)?"selected":""}>${esc(f.name)}</option>`).join("");
  return `<div class="map-card${active?" active-map":""}">
    ${m.url?`<div style="width:46px;height:46px;border-radius:6px;background-image:url(${m.url});background-size:cover;background-position:center;border:1px solid var(--border);flex-shrink:0"></div>`:`<div style="width:46px;height:46px;border-radius:6px;background:var(--bg-dark);border:1px solid var(--border);display:flex;align-items:center;justify-content:center;flex-shrink:0">🗺️</div>`}
    <div style="flex:1;min-width:0">
      <div style="font-family:var(--font-display);font-size:.84rem;color:${active?"var(--gold)":"var(--text)"};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(m.name)}</div>
      <div style="font-size:.7rem;color:var(--text-dim)">${m.url?"Karte geladen":"Keine Karte"}</div>
      <select class="char-input" style="font-size:.72rem;padding:2px 4px;margin-top:2px" onchange="moveMapToFolder('${m.id}',this.value)">
        <option value="">— ohne Ordner —</option>
        ${folderOptions}
      </select>
    </div>
    <div style="display:flex;flex-direction:column;gap:3px;flex-shrink:0">
      ${active?`<span style="color:var(--gold);font-size:.68rem;font-family:var(--font-display);text-align:center">▶ AKTIV</span>`:`<button class="btn btn-gold btn-xs" onclick="switchMap('${m.id}')">✓ Aktivieren</button>`}
      <button class="btn btn-dark btn-xs" onclick="uploadMapForMap('${m.id}')">📁 Bild</button>
      <button class="btn btn-dark btn-xs" onclick="renameMap('${m.id}','${esc(m.name).replace(/'/g,'')}')">✏️</button>
      ${!active?`<button class="btn btn-danger btn-xs" onclick="deleteMap('${m.id}')">🗑</button>`:""}
    </div>
  </div>`;
}

function moveMapToFolder(mapId, folderId){
  Socket.emit("map_folder_assign",{session_id:State.session_id,map_id:mapId,folder_id:folderId});
}

async function renameMap(mapId, currentName){
  const name=await Dialog.prompt("Neuer Name der Karte:", currentName,
    {title:"Karte umbenennen", icon:"🗺️", okText:"Umbenennen"});
  if(name) Socket.emit("map_rename",{session_id:State.session_id,map_id:mapId,name});
}

async function deleteMap(mapId){
  const m = (State.maps||{})[mapId];
  if(!await Dialog.confirmDanger(
      `Die Karte „${m?m.name:"?"}“ wird gelöscht.`,
      {title:"Karte löschen?", icon:"🗺️", hint:"Das lässt sich nicht rückgängig machen."})) return;
  Socket.emit("map_delete",{session_id:State.session_id,map_id:mapId});
}

function uploadMapForMap(mapId){
  const input=document.createElement("input");
  input.type="file"; input.accept="image/*";
  input.onchange=async e=>{
    if(!input.files[0]) return;
    const fd=new FormData(); fd.append("file",input.files[0]);
    try{
      const res=await fetch(`/upload/map_for/${State.session_id}/${mapId}`,{method:"POST",body:fd});
      const data=await res.json();
      if(data.url){
        Socket.emit("map_image_set",{session_id:State.session_id, map_id:mapId, url:data.url});
        UI.toast("🗺️ Karte hochgeladen!");
      } else { UI.toast("❌ Upload fehlgeschlagen"); }
    }catch(err){ UI.toast("❌ Upload-Fehler"); }
  };
  input.click();
}

// ── Roster (GM view of all characters) ────────────────────────────────────────
function renderRoster(){
  const panel=document.getElementById("roster-list"); if(!panel||!State.isGM) return;
  const roster=State.roster||{};
  const entries=Object.values(roster);
  if(!entries.length){
    panel.innerHTML=`<div style="color:var(--text-dim);text-align:center;padding:16px;font-style:italic">Noch keine Spieler beigetreten…</div>`;
    return;
  }
  panel.innerHTML=entries.map(r=>{
    const c=r.character||{};
    const online = r.socket_id ? true : false;
    const myTok = Object.values(State.tokens).find(t=>
      t.owner_char_id===r.char_id &&
      (t.map_id ? t.map_id===State.active_map_id : true)
    );
    const hasToken = !!myTok;
    const mod = myTok ? ((myTok.perception_mod===undefined||myTok.perception_mod===null)?1:myTok.perception_mod) : 1;
    const effFt = myTok ? Math.round(State.effectiveVisionFt(myTok)) : 0;
    return `<div class="roster-card">
      <div class="roster-head" onclick="inspectChar('${r.char_id}')" title="Charakterbogen ansehen">
        ${r.pic_url?`<img src="${r.pic_url}" style="width:40px;height:40px;border-radius:50%;object-fit:cover;border:1px solid var(--gold-dark)">`
          :`<div style="width:40px;height:40px;border-radius:50%;background:var(--bg-dark);display:flex;align-items:center;justify-content:center;font-size:1.2rem;border:1px solid var(--gold-dark)">🧙</div>`}
        <div style="flex:1;min-width:0">
          <div style="font-family:var(--font-display);font-size:.85rem;color:var(--gold)">${esc(r.name||"?")}</div>
          <div style="font-size:.72rem;color:var(--text-dim)">${esc(c.class||"—")} ${c.level||1} · ${esc(c.race||"—")}</div>
        </div>
        <span class="roster-open" title="Charakterbogen öffnen">📄</span>
        <span class="status-dot ${online?"online":"offline"}" title="${online?"Online":"Offline"}"></span>
      </div>
      <div style="font-size:.75rem;color:var(--text-dim);margin-bottom:6px">
        ❤️ ${c.hp||"?"}/${c.max_hp||"?"} · 🛡 ${c.ac||"?"} · 💨 ${c.speed||30}ft · 🔍 ${c.perception||myTok?.perception||10}
      </div>
      ${hasToken?`
      <div class="rp-vision">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <span style="font-size:.7rem;color:var(--gold-dark);font-family:var(--font-display)">🔦 Sichtweite</span>
          <span style="font-size:.72rem;color:var(--gold)">${effFt} ft</span>
        </div>
        <div style="display:flex;gap:4px;align-items:center;margin-bottom:4px">
          <input type="number" min="0" step="10" value="${myTok.vision_override??''}" placeholder="Standard (${State.DEFAULT_VISION[(State.map&&State.map.map_type)||'combat']}ft)"
            onchange="setVisionOverride('${myTok.id}', this.value)"
            style="flex:1;background:var(--bg-dark);border:1px solid var(--gold-dark);color:var(--text);border-radius:5px;padding:3px 6px;font-size:.75rem" title="Exakte Sichtweite in Fuß (leer = Standard der Karte)">
          <button class="btn btn-dark btn-xs" onclick="resetVision('${myTok.id}')" title="Auf Karten-Standard zurücksetzen">↺</button>
        </div>
        <div style="display:flex;gap:4px;align-items:center">
          <span style="flex:1;font-size:.7rem;color:var(--text-dim)" title="Ergebnis des Wahrnehmungswurfs, den der Spieler auf seinem Charakterbogen macht">
            👁 Wahrnehmung: <b style="color:${mod<1?'#d68a45':'var(--gold)'}">${Math.round(mod*100)}%</b>
          </span>
          <button class="btn btn-dark btn-xs" onclick="setPerceptionMod('${myTok.id}',1)" title="Sicht-Modifikator auf 100% zurücksetzen">↺ 100%</button>
        </div>
      </div>`:""}
      <div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">
        ${hasToken?`<span style="color:var(--gold);font-size:.7rem;align-self:center">✓ Auf Karte</span>`:
          `<button class="btn btn-gold btn-xs" onclick="Socket.emit('roster_spawn_token',{session_id:State.session_id,char_id:'${r.char_id}'})">+ Token spawnen</button>`}
        <button class="btn btn-danger btn-xs" onclick="kickChar('${r.char_id}')">🚪 Rauswerfen</button>
      </div>
    </div>`;
  }).join("");
}

async function kickChar(cid){
  if(!await Dialog.confirmDanger("Der Charakter wird aus der Kampagne entfernt.",
      {title:"Charakter entfernen?", icon:"🚪", okText:"Entfernen",
       hint:"Der Spieler kann später mit einem anderen Charakter beitreten."})) return;
  Socket.emit("roster_kick",{session_id:State.session_id,char_id:cid});
}

// ── Jukebox (Musik + SFX, Crossfade, Sound-Trigger) ─────────────────────────
const Jukebox = (() => {
  // Musik-Kanal (mit Crossfade zwischen zwei <audio>-Elementen)
  let musicA = null, musicB = null, activeMusic = null;
  let musicVol = 0.5, sfxVol = 0.7;
  let fadeTimer = null;
  let currentTrackName = "";
  // Vom Nutzer geladene Musikstücke: {name, url}
  let tracks = [];       // Musik-Bibliothek
  let sfxLib = [];       // Soundeffekt-Bibliothek: {name, url}
  // Trigger-Zuordnung: welcher SFX-Index bei welchem Ereignis.
  // Deutlich erweitert – für möglichst viele Spielereignisse.
  let triggers = {
    crit: -1,          // natürliche 20
    fumble: -1,        // natürliche 1 (Patzer)
    initiative: -1,    // Kampf beginnt
    round: -1,         // neue Kampfrunde
    map_change: -1,    // Kartenwechsel
    death: -1,         // Charakter/Token fällt (0 HP)
    damage: -1,        // Schaden genommen
    heal: -1,          // Heilung
    levelup: -1,       // Levelaufstieg
    door: -1,          // Tür öffnen/schließen
    dice: -1,          // beliebiger Würfelwurf
    message: -1,       // neue Chat-Nachricht
    join: -1,          // Spieler tritt bei
    handout: -1,       // neues Handout geteilt
    rest: -1,          // Rast (kurz/lang)
  };

  function _mkAudio(){ const a=new Audio(); a.preload="auto"; return a; }

  function render(){
    const list=document.getElementById("preset-tracks"); if(!list) return;
    // Musik-Bibliothek
    let html = `<div class="jb-section-lbl">🎵 Musik (${tracks.length})</div>`;
    if (!tracks.length){
      html += `<div class="jb-empty">Noch keine Musik geladen.<br>Lade Dateien über „+ Musik laden".</div>`;
    } else {
      html += tracks.map((t,i)=>`
        <div class="track-card ${currentTrackName===t.name?"playing":""}" onclick="Jukebox.playTrack(${i})">
          <div class="track-icon">${currentTrackName===t.name?"🎶":"🎵"}</div>
          <div class="track-info"><div class="track-name">${esc(t.name)}</div>
            <div class="track-desc">${currentTrackName===t.name?"läuft…":"klicken zum Abspielen"}</div></div>
          <span style="font-size:.8rem;color:var(--text-dim)">${currentTrackName===t.name?"⏸":"▶"}</span>
        </div>`).join("");
    }
    // SFX-Bibliothek
    html += `<div class="jb-section-lbl" style="margin-top:10px">🔊 Soundeffekte (${sfxLib.length})</div>`;
    if (!sfxLib.length){
      html += `<div class="jb-empty">Keine Effekte geladen.</div>`;
    } else {
      html += sfxLib.map((s,i)=>`
        <div class="track-card" onclick="Jukebox.playSfx(${i})">
          <div class="track-icon">🔊</div>
          <div class="track-info"><div class="track-name">${esc(s.name)}</div>
            <div class="track-desc">Effekt abspielen</div></div>
          <span style="font-size:.8rem;color:var(--text-dim)">▶</span>
        </div>`).join("");
    }
    // Trigger-Konfiguration (nur GM)
    if (State.isGM && sfxLib.length){
      const opts = (sel)=>`<option value="-1">— keiner —</option>` +
        sfxLib.map((s,i)=>`<option value="${i}" ${sel===i?"selected":""}>${esc(s.name)}</option>`).join("");
      html += `<div class="jb-section-lbl" style="margin-top:10px">⚡ Automatische Trigger</div>
        <div class="jb-trigger"><span>💥 Kritischer Treffer (Nat 20)</span>
          <select onchange="Jukebox.setTrigger('crit',this.value)">${opts(triggers.crit)}</select></div>
        <div class="jb-trigger"><span>💢 Patzer (Nat 1)</span>
          <select onchange="Jukebox.setTrigger('fumble',this.value)">${opts(triggers.fumble)}</select></div>
        <div class="jb-trigger"><span>⚔️ Kampf beginnt</span>
          <select onchange="Jukebox.setTrigger('initiative',this.value)">${opts(triggers.initiative)}</select></div>
        <div class="jb-trigger"><span>🔄 Neue Kampfrunde</span>
          <select onchange="Jukebox.setTrigger('round',this.value)">${opts(triggers.round)}</select></div>
        <div class="jb-trigger"><span>🗺️ Kartenwechsel</span>
          <select onchange="Jukebox.setTrigger('map_change',this.value)">${opts(triggers.map_change)}</select></div>
        <div class="jb-trigger"><span>💀 Charakter fällt (0 HP)</span>
          <select onchange="Jukebox.setTrigger('death',this.value)">${opts(triggers.death)}</select></div>
        <div class="jb-trigger"><span>🩸 Schaden genommen</span>
          <select onchange="Jukebox.setTrigger('damage',this.value)">${opts(triggers.damage)}</select></div>
        <div class="jb-trigger"><span>💚 Heilung</span>
          <select onchange="Jukebox.setTrigger('heal',this.value)">${opts(triggers.heal)}</select></div>
        <div class="jb-trigger"><span>⬆️ Levelaufstieg</span>
          <select onchange="Jukebox.setTrigger('levelup',this.value)">${opts(triggers.levelup)}</select></div>
        <div class="jb-trigger"><span>🚪 Tür</span>
          <select onchange="Jukebox.setTrigger('door',this.value)">${opts(triggers.door)}</select></div>
        <div class="jb-trigger"><span>🎲 Würfelwurf (allgemein)</span>
          <select onchange="Jukebox.setTrigger('dice',this.value)">${opts(triggers.dice)}</select></div>
        <div class="jb-trigger"><span>💬 Neue Nachricht</span>
          <select onchange="Jukebox.setTrigger('message',this.value)">${opts(triggers.message)}</select></div>
        <div class="jb-trigger"><span>👋 Spieler tritt bei</span>
          <select onchange="Jukebox.setTrigger('join',this.value)">${opts(triggers.join)}</select></div>
        <div class="jb-trigger"><span>📜 Handout geteilt</span>
          <select onchange="Jukebox.setTrigger('handout',this.value)">${opts(triggers.handout)}</select></div>
        <div class="jb-trigger"><span>🏕️ Rast</span>
          <select onchange="Jukebox.setTrigger('rest',this.value)">${opts(triggers.rest)}</select></div>`;
    }
    list.innerHTML = html;
  }

  // Musik laden (mehrere Dateien)
  function loadMusic(files){
    if(!files||!files.length) return;
    [...files].forEach(f => tracks.push({name:f.name.replace(/\.[^.]+$/,""), url:URL.createObjectURL(f)}));
    render(); UI.toast(`🎵 ${files.length} Stück(e) geladen`);
  }
  // SFX laden
  function loadSfx(files){
    if(!files||!files.length) return;
    [...files].forEach(f => sfxLib.push({name:f.name.replace(/\.[^.]+$/,""), url:URL.createObjectURL(f)}));
    render(); UI.toast(`🔊 ${files.length} Effekt(e) geladen`);
  }

  // Musik mit Crossfade abspielen
  function playTrack(i){
    const t = tracks[i]; if(!t) return;
    if (currentTrackName === t.name){ stopMusic(); return; }
    currentTrackName = t.name;
    _crossfadeTo(t.url);
    render();
    const el=document.getElementById("now-playing"); if(el) el.textContent="▶ "+t.name;
  }

  function _crossfadeTo(url){
    if(!musicA) musicA = _mkAudio();
    if(!musicB) musicB = _mkAudio();
    const incoming = (activeMusic === musicA) ? musicB : musicA;
    const outgoing = activeMusic;
    incoming.src = url; incoming.loop = true; incoming.volume = 0;
    incoming.play().catch(()=>UI.toast("⚠️ Audio-Fehler (Browser blockiert evtl. Autoplay)"));
    activeMusic = incoming;
    if (fadeTimer) clearInterval(fadeTimer);
    const steps = 30, dur = 1500, stepT = dur/steps;
    let n = 0;
    fadeTimer = setInterval(()=>{
      n++;
      const p = n/steps;
      incoming.volume = Math.min(musicVol, musicVol * p);
      if (outgoing) outgoing.volume = Math.max(0, musicVol * (1-p));
      if (n >= steps){
        clearInterval(fadeTimer); fadeTimer=null;
        if (outgoing){ outgoing.pause(); }
        incoming.volume = musicVol;
      }
    }, stepT);
  }

  function stopMusic(){
    if (fadeTimer){ clearInterval(fadeTimer); fadeTimer=null; }
    [musicA,musicB].forEach(a=>{ if(a){a.pause();} });
    activeMusic=null; currentTrackName="";
    render();
    const el=document.getElementById("now-playing"); if(el) el.textContent="";
  }

  // SFX einmalig abspielen (überlagert Musik)
  function playSfx(i){
    const s = sfxLib[i]; if(!s) return;
    const a = new Audio(s.url);
    a.volume = sfxVol;
    a.play().catch(()=>{});
  }

  function setVolume(v){
    musicVol = parseFloat(v);
    const el=document.getElementById("vol-pct"); if(el) el.textContent=Math.round(musicVol*100)+"%";
    if(activeMusic && !fadeTimer) activeMusic.volume = musicVol;
  }
  function setSfxVolume(v){
    sfxVol = parseFloat(v);
    const el=document.getElementById("sfx-pct"); if(el) el.textContent=Math.round(sfxVol*100)+"%";
  }

  function setTrigger(event, idx){
    triggers[event] = parseInt(idx);
    UI.toast(`⚡ Trigger „${event}" gesetzt`);
  }

  // Wird von außen bei Ereignissen aufgerufen
  function fireTrigger(event){
    const idx = triggers[event];
    if (idx >= 0 && sfxLib[idx]) playSfx(idx);
  }

  function stop(){ stopMusic(); }

  return {render, playTrack, playSfx, loadMusic, loadSfx, setVolume, setSfxVolume, setTrigger, fireTrigger, stop};
})();

function renderGMSettings(){
  const panel=document.getElementById("gm-settings-panel"); if(!panel||!State.isGM) return;
  const s=State.settings;
  panel.innerHTML=`
    <div class="toggle-row"><span class="toggle-label">✏️ Spieler dürfen zeichnen</span>
      <div class="toggle-switch ${s.drawing_allowed?"on":""}" onclick="GMSettings.toggle('drawing_allowed',this)"></div></div>
    <div style="padding:8px 12px;font-family:var(--font-display);font-size:.72rem;color:var(--gold);border-top:1px solid var(--border);margin-top:6px">🐉 Gegner-Würfe im Chat</div>
    <div class="toggle-row"><span class="toggle-label">🎲 Rettungswürfe der Gegner zeigen</span>
      <div class="toggle-switch ${s.show_enemy_saves?"on":""}" onclick="GMSettings.toggle('show_enemy_saves',this)"></div></div>
    <div class="toggle-row"><span class="toggle-label">🗡️ Angriffswürfe der Gegner zeigen</span>
      <div class="toggle-switch ${s.show_enemy_attacks?"on":""}" onclick="GMSettings.toggle('show_enemy_attacks',this)"></div></div>
    <div class="toggle-row"><span class="toggle-label">🛡 RK der Gegner im Chat zeigen</span>
      <div class="toggle-switch ${s.show_enemy_ac_in_chat?"on":""}" onclick="GMSettings.toggle('show_enemy_ac_in_chat',this)"></div></div>
    <div style="padding:10px 12px;font-size:.78rem;color:var(--text-dim);line-height:1.5">
      Ist ein Schalter <strong>aus</strong>, sehen die Spieler nur das Ergebnis (trifft/verfehlt, bestanden/gescheitert) – nicht die gewürfelte Zahl. Die RK der Gegner bleibt im Chat verborgen, solange der RK-Schalter aus ist.
    </div>
    <div style="padding:10px 12px;font-size:.8rem;color:var(--text-dim);line-height:1.5;border-top:1px solid var(--border)">
      💡 <strong>Hinweis:</strong> HP- und RK-Sichtbarkeit kannst du zusätzlich pro Charakter/Gegner direkt im <strong>Initiative</strong>-Tab mit den ❤️/🛡 Buttons ein/ausschalten.
    </div>
  `;
}
const GMSettings={toggle(key,el){
  el.classList.toggle("on"); const val=el.classList.contains("on");
  State.settings[key]=val; Socket.emit("gm_setting",{session_id:State.session_id,key,value:val});
}};

const Enemies={
  spawn(id){Socket.emit("enemy_spawn",{session_id:State.session_id,enemy_id:id,x:300,y:300});UI.toast("🐉 Gespawnt");},
  addToInit(id){Socket.emit("enemy_add_to_initiative",{session_id:State.session_id,enemy_id:id});UI.toast("⚔️ Zu Initiative hinzugefügt");}
};

function switchMap(mid){
  Socket.emit("map_switch",{session_id:State.session_id,map_id:mid});
  UI.toast("🗺️ Karte gewechselt – alle Spieler werden verschoben");
}

function esc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
