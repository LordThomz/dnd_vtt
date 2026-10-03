/** modals.js */
const Modals = (() => {
  let _editBars = [];  // Arbeitskopie der Zusatzbalken im offenen Modal

  function openToken(id){
    const t=State.tokens[id]; if(!t) return;
    document.getElementById("tm-id").value=id;
    document.getElementById("tm-name").value=t.name;
    document.getElementById("tm-hp").value=t.hp;
    document.getElementById("tm-maxhp").value=t.max_hp;
    document.getElementById("tm-ac").value=t.ac;
    document.getElementById("tm-speed").value=t.speed||30;
    document.getElementById("tm-vision").value=t.vision_range||0;
    const pc=document.getElementById("tm-perception"); if(pc) pc.value=t.perception||10;
    const lb=document.getElementById("tm-light-bright"); if(lb) lb.value=t.light_bright||0;
    const ld=document.getElementById("tm-light-dim"); if(ld) ld.value=t.light_dim||0;
    const dv=document.getElementById("tm-darkvision"); if(dv) dv.checked=(t.darkvision||0)>0;
    const vo=document.getElementById("tm-vision-override"); if(vo) vo.value=(t.vision_override??"");
    const cg=document.getElementById("tm-conds");
    cg.innerHTML=Object.entries(Tokens.CONDITIONS).map(([k,v])=>`
      <div class="cond-toggle ${(t.conditions||[]).includes(k)?"on":""}" onclick="this.classList.toggle('on')" data-cond="${k}">${v} ${k}</div>`).join("");
    // Zusatzbalken laden (tiefe Kopie)
    _editBars = Array.isArray(t.bars) ? JSON.parse(JSON.stringify(t.bars)).slice(0,2) : [];
    _renderTokenBars();
    const del=document.getElementById("tm-del-btn");
    if(del) del.style.display=State.isGM?"inline-flex":"none";
    document.getElementById("token-modal").classList.add("open");
  }

  function _renderTokenBars(){
    const wrap = document.getElementById("tm-bars"); if(!wrap) return;
    const COLORS = [["#4a7fa5","Blau"],["#7a5aa5","Lila"],["#4a8a5a","Grün"],["#a5824a","Braun"],["#a54a7f","Pink"]];
    wrap.innerHTML = _editBars.map((b,i)=>`
      <div style="display:flex;gap:5px;align-items:center;background:var(--bg-dark);padding:6px;border-radius:6px;border:1px solid var(--gold-dark)">
        <input class="form-input" style="flex:1.4" placeholder="Name (z.B. Mana)" value="${(b.label||"").replace(/"/g,"&quot;")}" oninput="Modals.updateTokenBar(${i},'label',this.value)">
        <input class="form-input" style="width:52px" type="number" placeholder="akt" value="${b.cur||0}" oninput="Modals.updateTokenBar(${i},'cur',this.value)" title="Aktuell">
        <input class="form-input" style="width:52px" type="number" placeholder="max" value="${b.max||0}" oninput="Modals.updateTokenBar(${i},'max',this.value)" title="Maximum">
        <select class="form-input" style="width:70px" onchange="Modals.updateTokenBar(${i},'color',this.value)">
          ${COLORS.map(([hex,name])=>`<option value="${hex}" ${b.color===hex?"selected":""}>${name}</option>`).join("")}
        </select>
        <button class="btn btn-danger btn-xs" onclick="Modals.removeTokenBar(${i})" title="Entfernen">✕</button>
      </div>`).join("") || `<div style="color:var(--text-dim);font-size:.78rem;font-style:italic">Keine Zusatzbalken. Der HP-Balken wird immer gezeigt.</div>`;
  }

  function setTorch(){
    const lb=document.getElementById("tm-light-bright");
    const ld=document.getElementById("tm-light-dim");
    if(lb) lb.value=20;
    if(ld) ld.value=20;
    UI.toast("🔥 Fackel: 20 ft hell + 20 ft dämmrig");
  }

  function addTokenBar(){
    if(_editBars.length >= 2){ UI.toast("Maximal 2 Zusatzbalken"); return; }
    _editBars.push({label:"", cur:0, max:10, color:"#4a7fa5", show_to_players:true});
    _renderTokenBars();
  }
  function updateTokenBar(i, field, val){
    if(!_editBars[i]) return;
    if(field==="cur"||field==="max") val = parseInt(val)||0;
    _editBars[i][field] = val;
  }
  function removeTokenBar(i){
    _editBars.splice(i,1); _renderTokenBars();
  }
  function saveToken(){
    const id=document.getElementById("tm-id").value;
    const conds=[...document.querySelectorAll("#tm-conds .cond-toggle.on")].map(e=>e.dataset.cond);
    const bars = _editBars.filter(b => (b.max||0) > 0);
    Socket.emit("token_update",{session_id:State.session_id,token_id:id,updates:{
      name:document.getElementById("tm-name").value,
      hp:parseInt(document.getElementById("tm-hp").value)||0,
      max_hp:parseInt(document.getElementById("tm-maxhp").value)||1,
      ac:parseInt(document.getElementById("tm-ac").value)||10,
      speed:parseInt(document.getElementById("tm-speed").value)||30,
      vision_range:parseInt(document.getElementById("tm-vision").value)||0,
      perception:parseInt(document.getElementById("tm-perception")?.value)||10,
      light_bright:parseInt(document.getElementById("tm-light-bright")?.value)||0,
      light_dim:parseInt(document.getElementById("tm-light-dim")?.value)||0,
      darkvision:(document.getElementById("tm-darkvision")?.checked ? 60 : 0),
      vision_override:(document.getElementById("tm-vision-override")?.value==="")?null:parseInt(document.getElementById("tm-vision-override")?.value)||0,
      conditions:conds,
      bars:bars,
    }});
    closeToken(); UI.toast("💾 Token gespeichert");
  }
  function deleteToken(){ Socket.emit("token_delete",{session_id:State.session_id,token_id:document.getElementById("tm-id").value}); closeToken(); }
  function closeToken(){ document.getElementById("token-modal").classList.remove("open"); }

  function openDice(){ document.getElementById("dice-modal").classList.add("open"); }
  function closeDice(){ document.getElementById("dice-modal").classList.remove("open"); }
  function rollFromModal(secret){
    Socket.emit("dice_roll",{session_id:State.session_id,formula:document.getElementById("dice-formula").value||"1d20",
      secret:!!secret,roller:State.username,author:State.username,role:State.role,color:State.my_color});
    closeDice(); Tabs.switchTo("chat");
  }

  function openHandout(id){ const h=State.handouts.find(x=>x.id===id); if(!h) return;
    document.getElementById("hm-title").textContent=h.title;
    document.getElementById("hm-content").textContent=h.content;
    document.getElementById("handout-modal").classList.add("open"); }
  function closeHandout(){ document.getElementById("handout-modal").classList.remove("open"); }

  function openSpawnToken(){ if(State.getMyToken()){UI.toast("Du hast bereits einen Token!");return;} document.getElementById("spawn-modal").classList.add("open"); }
  function closeSpawnToken(){ document.getElementById("spawn-modal").classList.remove("open"); }
  async function doSpawnToken(){
    const fileInput=document.getElementById("spawn-img"); let url="";
    if(fileInput.files[0]){const fd=new FormData();fd.append("file",fileInput.files[0]);const res=await fetch(`/upload/token/${State.session_id}`,{method:"POST",body:fd});const d=await res.json();url=d.url||"";}
    Character.spawnMyToken(url); closeSpawnToken();
  }

  function openEnemyCreate(){
    document.getElementById("em-id").value="";
    document.getElementById("enemy-modal-title").textContent="🐉 Neuen Gegner erstellen";
    ["em-name","em-cr","em-notes"].forEach(id=>{const el=document.getElementById(id);if(el)el.value="";});
    ["em-hp","em-ac","em-speed","em-initbonus","em-str","em-dex","em-con","em-int","em-wis","em-cha"].forEach(id=>{
      const el=document.getElementById(id);if(el)el.value=id==="em-ac"?"12":id==="em-speed"?"30":"10";
    });
    document.getElementById("em-pic-placeholder").style.display="";
    document.getElementById("em-pic-preview").style.display="none";
    document.getElementById("em-pic-preview").dataset.dataUrl="";
    if(typeof updateEnemyFolderSelect==="function") updateEnemyFolderSelect();
    _fillEnemySheet(null);   // Bogen-Felder leeren
    document.getElementById("enemy-modal").classList.add("open");
  }
  // ── Gegner-Charakterbogen: Übungen, Fähigkeiten, Beute ──────────────────
  // Arbeitskopien, solange das Fenster offen ist.
  let _enemySaves  = [];   // ["dex","con"]
  let _enemySkills = [];   // ["Wahrnehmung", ...]
  let _enemyTraits = [];   // [{name, desc}]
  let _enemyInv    = [];   // [{name, qty, note}]

  const EN_SAVES = [["str","STÄ"],["dex","GES"],["con","KON"],
                    ["int","INT"],["wis","WEI"],["cha","CHA"]];
  const EN_SKILLS = ["Akrobatik","Arkane Kunde","Athletik","Auftreten","Einsicht",
    "Fingerfertigkeit","Geschichte","Heilkunde","Heimlichkeit","Motiv erkennen",
    "Nachforschungen","Naturkunde","Religion","Täuschung","Überlebenskunst",
    "Überzeugen","Umgang mit Tieren","Wahrnehmung"];

  function _renderEnemyProfs(){
    const sv = document.getElementById("em-saves");
    if (sv) sv.innerHTML = EN_SAVES.map(([k,lbl]) => `
      <button type="button" class="prof-chip ${_enemySaves.includes(k)?"on":""}"
              onclick="Modals.toggleEnemySave('${k}')">${lbl}</button>`).join("");
    const sk = document.getElementById("em-skills");
    if (sk) sk.innerHTML = EN_SKILLS.map(n => `
      <button type="button" class="prof-chip ${_enemySkills.includes(n)?"on":""}"
              onclick="Modals.toggleEnemySkill('${n.replace(/'/g,"\\'")}')">${n}</button>`).join("");
  }
  function toggleEnemySave(k){
    const i=_enemySaves.indexOf(k);
    if(i>-1) _enemySaves.splice(i,1); else _enemySaves.push(k);
    _renderEnemyProfs();
  }
  function toggleEnemySkill(n){
    const i=_enemySkills.indexOf(n);
    if(i>-1) _enemySkills.splice(i,1); else _enemySkills.push(n);
    _renderEnemyProfs();
  }

  function _renderEnemyTraits(){
    const box=document.getElementById("em-traits-list");
    if(!box) return;
    box.innerHTML = _enemyTraits.length ? _enemyTraits.map((t,i)=>`
      <div class="mini-row">
        <input class="form-input" placeholder="Name" value="${_esc(t.name)}"
               oninput="Modals.editEnemyTrait(${i},'name',this.value)" style="flex:1">
        <input class="form-input" placeholder="Wirkung" value="${_esc(t.desc)}"
               oninput="Modals.editEnemyTrait(${i},'desc',this.value)" style="flex:2">
        <button class="btn btn-danger btn-xs" onclick="Modals.removeEnemyTrait(${i})">✕</button>
      </div>`).join("")
      : `<div style="color:var(--text-dim);font-size:.75rem;font-style:italic">Noch keine Fähigkeiten.</div>`;
  }
  function addEnemyTrait(){ _enemyTraits.push({name:"",desc:""}); _renderEnemyTraits(); }
  function editEnemyTrait(i,f,v){ if(_enemyTraits[i]) _enemyTraits[i][f]=v; }
  function removeEnemyTrait(i){ _enemyTraits.splice(i,1); _renderEnemyTraits(); }

  function _renderEnemyInv(){
    const box=document.getElementById("em-inv-list");
    if(!box) return;
    box.innerHTML = _enemyInv.length ? _enemyInv.map((it,i)=>`
      <div class="mini-row">
        <input class="form-input" placeholder="Gegenstand" value="${_esc(it.name)}"
               oninput="Modals.editEnemyItem(${i},'name',this.value)" style="flex:2">
        <input class="form-input" type="number" min="1" value="${it.qty||1}"
               oninput="Modals.editEnemyItem(${i},'qty',parseInt(this.value)||1)" style="width:60px" title="Anzahl">
        <button class="btn btn-danger btn-xs" onclick="Modals.removeEnemyItem(${i})">✕</button>
      </div>`).join("")
      : `<div style="color:var(--text-dim);font-size:.75rem;font-style:italic">Keine Beute hinterlegt.</div>`;
  }
  function addEnemyItem(){ _enemyInv.push({name:"",qty:1,note:""}); _renderEnemyInv(); }
  function editEnemyItem(i,f,v){ if(_enemyInv[i]) _enemyInv[i][f]=v; }
  function removeEnemyItem(i){ _enemyInv.splice(i,1); _renderEnemyInv(); }

  function _esc(s){ return String(s??"").replace(/"/g,"&quot;"); }

  /** Setzt die Bogen-Felder aus einem Gegner (oder leer bei "neu"). */
  function _fillEnemySheet(e){
    e = e || {};
    _enemySaves  = [...(e.save_profs  || [])];
    _enemySkills = [...(e.skill_profs || [])];
    _enemyTraits = (e.traits    || []).map(t => ({...t}));
    _enemyInv    = (e.inventory || []).map(i => ({...i}));
    const set=(id,v)=>{ const el=document.getElementById(id); if(el) el.value=v; };
    set("em-type",        e.creature_type || "");
    set("em-size",        e.size || "M");
    set("em-alignment",   e.alignment || "");
    set("em-level",       e.level || 1);
    set("em-senses",      e.senses || "");
    set("em-languages",   e.languages || "");
    set("em-resistances", e.resistances || "");
    _renderEnemyProfs(); _renderEnemyTraits(); _renderEnemyInv();
  }

  function openEnemyEdit(id){
    const e=State.enemies[id]; if(!e) return;
    document.getElementById("em-id").value=id;
    document.getElementById("enemy-modal-title").textContent="✏️ Gegner bearbeiten";
    document.getElementById("em-name").value=e.name||"";
    document.getElementById("em-cr").value=e.cr||"1";
    document.getElementById("em-hp").value=e.hp||10;
    document.getElementById("em-ac").value=e.ac||12;
    document.getElementById("em-speed").value=e.speed||30;
    document.getElementById("em-initbonus").value=e.initiative_bonus||0;
    document.getElementById("em-notes").value=e.notes||"";
    if(e.stats){["str","dex","con","int","wis","cha"].forEach(s=>{const el=document.getElementById("em-"+s);if(el)el.value=e.stats[s]||10;});}
    if(e.url){document.getElementById("em-pic-placeholder").style.display="none";const img=document.getElementById("em-pic-preview");img.src=e.url;img.style.display="block";img.dataset.dataUrl="";}
    else{document.getElementById("em-pic-placeholder").style.display="";document.getElementById("em-pic-preview").style.display="none";}
    if(typeof updateEnemyFolderSelect==="function") updateEnemyFolderSelect();
    const fsel=document.getElementById("em-folder");if(fsel&&e.folder_id)fsel.value=e.folder_id;
    _fillEnemySheet(e);
    document.getElementById("enemy-modal").classList.add("open");
  }
  function closeEnemyCreate(){ document.getElementById("enemy-modal").classList.remove("open"); }
  function saveEnemy(){
    const eid=document.getElementById("em-id")?.value||"";
    const imgEl=document.getElementById("em-pic-preview");
    const url=imgEl?.dataset.dataUrl||imgEl?.src||"";
    const data={
      name:document.getElementById("em-name")?.value||"Gegner",
      hp:parseInt(document.getElementById("em-hp")?.value)||10,
      ac:parseInt(document.getElementById("em-ac")?.value)||12,
      speed:parseInt(document.getElementById("em-speed")?.value)||30,
      cr:document.getElementById("em-cr")?.value||"1",
      initiative_bonus:parseInt(document.getElementById("em-initbonus")?.value)||0,
      notes:document.getElementById("em-notes")?.value||"",
      folder_id:document.getElementById("em-folder")?.value||"default",
      url: url.startsWith("data:") || url.startsWith("/") ? url : "",
      str:parseInt(document.getElementById("em-str")?.value)||10,
      dex:parseInt(document.getElementById("em-dex")?.value)||10,
      con:parseInt(document.getElementById("em-con")?.value)||10,
      int:parseInt(document.getElementById("em-int")?.value)||10,
      wis:parseInt(document.getElementById("em-wis")?.value)||10,
      cha:parseInt(document.getElementById("em-cha")?.value)||10,
      // ── Charakterbogen ──────────────────────────────────────────────
      creature_type:document.getElementById("em-type")?.value||"",
      size:document.getElementById("em-size")?.value||"M",
      alignment:document.getElementById("em-alignment")?.value||"",
      level:parseInt(document.getElementById("em-level")?.value)||1,
      senses:document.getElementById("em-senses")?.value||"",
      languages:document.getElementById("em-languages")?.value||"",
      resistances:document.getElementById("em-resistances")?.value||"",
      save_profs:[..._enemySaves],
      skill_profs:[..._enemySkills],
      // Leere Einträge nicht mitspeichern
      traits:_enemyTraits.filter(t=>t.name && t.name.trim()),
      inventory:_enemyInv.filter(i=>i.name && i.name.trim()),
    };
    if(eid){
      Socket.emit("enemy_update",{session_id:State.session_id,enemy_id:eid,updates:data});
    } else {
      Socket.emit("enemy_create",{session_id:State.session_id,...data});
    }
    closeEnemyCreate(); UI.toast("🐉 Gegner gespeichert");
  }

  function openCreateMap(folderId){
    // Zielordner merken, damit die neue Karte dort landet (leer = oberste Ebene)
    window._createMapTargetFolder = folderId || "";
    document.getElementById("create-map-modal").classList.add("open");
  }

  function initBackdropClose(){
    document.querySelectorAll(".modal-backdrop").forEach(el=>{
      el.addEventListener("click",e=>{if(e.target===el)el.classList.remove("open");});
    });
  }

  return {
    openToken,saveToken,deleteToken,closeToken,
    addTokenBar,updateTokenBar,removeTokenBar,setTorch,
    openDice,closeDice,rollFromModal,
    openHandout,closeHandout,
    openSpawnToken,closeSpawnToken,doSpawnToken,
    openEnemyCreate,openEnemyEdit,closeEnemyCreate,saveEnemy,
    toggleEnemySave,toggleEnemySkill,
    addEnemyTrait,editEnemyTrait,removeEnemyTrait,
    addEnemyItem,editEnemyItem,removeEnemyItem,
    openCreateMap, initBackdropClose,
  };
})();
