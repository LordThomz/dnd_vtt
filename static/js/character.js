/**
 * character.js
 * ────────────
 * D&D 5e character sheet logic.
 * - Sheet tab: full edit form  (attributes, skills, HP, etc.)
 * - Charakter tab: read-only stat overview
 * - Attacks tab: attack/spell list + roll buttons
 * Saves to localStorage.  Character name → token name.
 */

const Character = (() => {

  const STATS = ["str","dex","con","int","wis","cha"];
  const STAT_LABELS = { str:"STR",dex:"GES",con:"KON",int:"INT",wis:"WEI",cha:"CHA" };
  const PROF_BONUS  = [2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,6,6,6,6];

  const SKILLS_DEF = [
    {name:"Akrobatik",stat:"dex"},{name:"Arkana",stat:"int"},{name:"Athletik",stat:"str"},
    {name:"Auftreten",stat:"cha"},{name:"Einschüchtern",stat:"cha"},{name:"Einsicht",stat:"wis"},
    {name:"Geschichte",stat:"int"},{name:"Heilkunde",stat:"wis"},{name:"Heimlichkeit",stat:"dex"},
    {name:"Naturkunde",stat:"int"},{name:"Überzeugung",stat:"cha"},{name:"Tierführung",stat:"wis"},
    {name:"Täuschung",stat:"cha"},{name:"Wahrnehmung",stat:"wis"},{name:"Religion",stat:"int"},
    {name:"Überleben",stat:"wis"},
  ];

  let sheet = {
    name:"", class:"", race:"", level:1, background:"",
    stats:{ str:10,dex:10,con:10,int:10,wis:10,cha:10 },
    hp:20, max_hp:20, ac:10, speed:30, initiative_bonus:0,
    skill_profs:[],
    attacks:[],
    equipment:"", backstory:"",
    // ── Live resource trackers ──
    spell_slots:{},          // {1:{max:4,used:0}, 2:{max:3,used:0}, ...}
    hit_dice:{max:1,used:0},  // Trefferwürfel
    death_saves:{success:0,fail:0},
    custom_resources:[],      // [{id,name,max,used}]  z.B. Ki, Wut, Inspiration
  };

  let _library = {items:{}, spells:{}, attacks:{}, races:{}, classes:{}, subclasses:{}};

  async function fetchLibrary() {
    try {
      // nur Inhalte, die in dieser Kampagne erlaubt sind (packs.py)
      const res = await fetch("/api/library?session=" + encodeURIComponent(State.session_id || ""));
      _library = await res.json();
      // ensure all cats exist
      ["items","spells","attacks","races","classes","subclasses"].forEach(c=>{
        if (!_library[c]) _library[c] = {};
      });
    } catch(e){}
  }

  // ── Init ────────────────────────────────────────────────────────────────
  async function init() {
    // Prefer server-side character if my_char_id is set
    if (State.my_char_id) {
      try {
        const res = await fetch("/api/characters/" + State.my_char_id);
        if (res.ok) {
          const char = await res.json();
          if (char && !char.error) sheet = Object.assign(sheet, char);
        }
      } catch(e) {}
    } else {
      loadFromStorage();
    }
    await fetchLibrary();
    _populateForm();
    buildStatInputs();
    buildSkillsList();
    updateHP();
    updateOverview();
    updateAttacksList();
    renderMiniStats();
    document.addEventListener("dnd:full_state",    () => {
      updateOverview();
      if(typeof buildPlayerCondsGrid==="function") buildPlayerCondsGrid();
      // If we have char_id but form is still empty, load from roster
      if (State.my_char_id && State.roster && State.roster[State.my_char_id]) {
        const r = State.roster[State.my_char_id].character;
        if (r && (!sheet.name || sheet.name==="")) { sheet = Object.assign(sheet, r); _populateForm(); buildStatInputs(); buildSkillsList(); updateHP(); updateOverview(); }
      }
    });
    document.addEventListener("dnd:tokens_changed",() => { updateOverview(); if(typeof buildPlayerCondsGrid==="function") buildPlayerCondsGrid(); });
  }

  function _populateForm() {
    const sv=(id,val)=>{const el=document.getElementById(id);if(el)el.value=val||"";}
    sv("cs-charname",sheet.name); sv("cs-class",sheet.class); sv("cs-race",sheet.race);
    sv("cs-level",sheet.level||1); sv("cs-hp-inp",sheet.hp); sv("cs-maxhp-inp",sheet.max_hp);
    sv("cs-ac-inp",sheet.ac); sv("cs-speed-inp",sheet.speed||30);
    sv("cs-init-bonus-inp",sheet.initiative_bonus||0); sv("cs-vision-inp",sheet.vision_range||0);
    sv("cs-equipment",sheet.equipment); sv("cs-backstory",sheet.backstory);
    if(sheet.pic_url){const a=document.getElementById("char-pic-area");if(a)a.innerHTML='<img src="'+sheet.pic_url+'" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';}
  }

  // ── Persistence ─────────────────────────────────────────────────────────
  function saveToStorage() { localStorage.setItem(_storageKey(), JSON.stringify(sheet)); }
  function loadFromStorage() {
    const saved = localStorage.getItem(_storageKey());
    if (saved) try { sheet = JSON.parse(saved); } catch(e){}
  }
  function _storageKey() { return `dnd_char_${State.session_id}_${State.username}`; }

  // ── Stat helpers ─────────────────────────────────────────────────────────
  function mod(val) { return Math.floor((val-10)/2); }

  // Formel-/Platzhalter-Parser: ersetzt [[@{...}]] in Texten durch Charakterwerte.
  // Unterstützt: @{level}, @{prof}, @{str}..@{cha} (Werte), @{mod:str}.. (Modifikatoren),
  //   @{name}, @{class}, @{race}, @{ac}, @{hp}, @{max_hp}, @{speed}
  //   sowie einfache Würfel-Skalierung: @{scale:1d6:5} = 1 Würfel pro 5 Level (aufgerundet ab Lvl 1).
  function parseFormulas(text) {
    if (!text || text.indexOf("[[") === -1) return text || "";
    const s = sheet;
    const profBonus = 2 + Math.floor(((s.level||1) - 1) / 4);
    const stats = s.stats || {};
    const map = {
      "level": s.level||1, "prof": profBonus,
      "name": s.name||"", "class": s.class||"", "race": s.race||"",
      "ac": s.ac||10, "hp": s.hp||0, "max_hp": s.max_hp||0, "speed": s.speed||30,
      "str": stats.str||10, "dex": stats.dex||10, "con": stats.con||10,
      "int": stats.int||10, "wis": stats.wis||10, "cha": stats.cha||10,
    };
    return text.replace(/\[\[@\{([^}]+)\}\]\]/g, (m, expr) => {
      expr = expr.trim();
      // Modifikator: mod:str
      let mm = /^mod:(str|dex|con|int|wis|cha)$/i.exec(expr);
      if (mm) { const v = mod(stats[mm[1].toLowerCase()]||10); return (v>=0?"+":"")+v; }
      // Skalierung: scale:1d6:5  → Würfelanzahl = ceil(level / teiler)
      let sc = /^scale:(\d+)d(\d+):(\d+)$/i.exec(expr);
      if (sc) {
        const perN = parseInt(sc[3]); const die = sc[2];
        const count = Math.max(1, Math.ceil((s.level||1) / perN));
        return `${count}d${die}`;
      }
      // Direkter Wert
      if (expr.toLowerCase() in map) return map[expr.toLowerCase()];
      return m; // unbekannt: unverändert lassen
    });
  }
  function fmtMod(m){ return (m>=0?"+":"")+m; }
  function pb()     { return PROF_BONUS[Math.min(sheet.level-1,19)]; }

  function getStatMod(stat) { return mod(sheet.stats[stat] || 10); }

  // ── Build attribute inputs ────────────────────────────────────────────────
  function buildStatInputs() {
    const grid = document.getElementById("stat-grid");
    if (!grid) return;
    grid.innerHTML = STATS.map(s => `
      <div class="stat-box">
        <div class="stat-abbr" onclick="Character.rollStat('${s}')" style="cursor:pointer">${STAT_LABELS[s]}</div>
        <div class="stat-mod" id="mod-${s}" onclick="Character.rollStat('${s}')" style="cursor:pointer" title="Klicken zum Würfeln">${fmtMod(mod(sheet.stats[s]))}</div>
        <input class="char-input" type="number" id="stat-${s}" min="1" max="30"
          value="${sheet.stats[s]}" oninput="Character.onStatChange()"
          onclick="event.stopPropagation()"
          style="text-align:center;padding:2px 4px;font-size:.85rem;margin-top:2px">
      </div>
    `).join("");
  }

  function onStatChange() {
    STATS.forEach(s => {
      const el = document.getElementById(`stat-${s}`);
      if (el) sheet.stats[s] = parseInt(el.value)||10;
      const modEl = document.getElementById(`mod-${s}`);
      if (modEl) modEl.textContent = fmtMod(mod(sheet.stats[s]));
    });
    buildSkillsList();
    updateMiniStatBonuses();
  }

  // ── Skills ───────────────────────────────────────────────────────────────
  function buildSkillsList() {
    const list = document.getElementById("skills-list");
    if (!list) return;
    list.innerHTML = SKILLS_DEF.map(sk => {
      const base  = getStatMod(sk.stat);
      const prof  = sheet.skill_profs.includes(sk.name);
      const total = base + (prof ? pb() : 0);
      return `
        <div class="skill-row" onclick="Character.rollSkill('${sk.name}','${sk.stat}')">
          <div class="sk-prof ${prof?"on":""}" onclick="event.stopPropagation();Character.toggleProf('${sk.name}',this)"></div>
          <span>${sk.name}</span>
          <span class="sk-stat">${sk.stat.toUpperCase()}</span>
          <span class="sk-mod">${fmtMod(total)}</span>
        </div>`;
    }).join("");
  }

  function toggleProf(skill, el) {
    const idx = sheet.skill_profs.indexOf(skill);
    idx>=0 ? sheet.skill_profs.splice(idx,1) : sheet.skill_profs.push(skill);
    el.classList.toggle("on");
    buildSkillsList();
    saveToStorage();
  }

  // ── HP ───────────────────────────────────────────────────────────────────
  function updateHP() {
    const hpEl    = document.getElementById("cs-hp");
    const maxHpEl = document.getElementById("cs-maxhp");
    const fillEl  = document.getElementById("cs-hpfill");
    if (!hpEl) return;
    hpEl.textContent    = sheet.hp;
    if (maxHpEl) maxHpEl.textContent = sheet.max_hp;
    const pct = Math.max(0, Math.min(100, (sheet.hp / Math.max(1,sheet.max_hp)) * 100));
    if (fillEl) {
      fillEl.style.width      = pct+"%";
      fillEl.style.background = pct>50?"#4a8a5a":pct>25?"#e67e22":"#c0392b";
    }
    // Sync hp-input fields
    const hpIn  = document.getElementById("cs-hp-inp");
    const maxIn = document.getElementById("cs-maxhp-inp");
    if (hpIn)  hpIn.value  = sheet.hp;
    if (maxIn) maxIn.value = sheet.max_hp;
  }

  function onHpChange() {
    const hpIn  = document.getElementById("cs-hp-inp");
    const maxIn = document.getElementById("cs-maxhp-inp");
    sheet.hp     = parseInt(hpIn?.value)  || 0;
    sheet.max_hp = parseInt(maxIn?.value) || 1;
    updateHP();
    syncTokenHP();
  }

  function syncTokenHP() {
    const myToken = State.getMyToken();
    if (!myToken) return;
    Socket.emit("token_update", {
      session_id: State.session_id,
      token_id:   myToken.id,
      updates:    { hp:sheet.hp, max_hp:sheet.max_hp },
    });
  }

  // ── Mini stats (AC, Speed, Initiative) ───────────────────────────────────
  function renderMiniStats() {
    const ms = document.getElementById("mini-stats-row");
    if (!ms) return;
    ms.innerHTML = `
      <div class="mini-stat"><div class="ms-val">${sheet.ac}</div><div class="ms-label">Rüstung</div></div>
      <div class="mini-stat"><div class="ms-val">${sheet.speed}</div><div class="ms-label">Bewegung</div></div>
      <div class="mini-stat"><div class="ms-val">${fmtMod(getStatMod("dex") + (sheet.initiative_bonus||0))}</div><div class="ms-label">Initiative</div></div>
    `;
  }

  function updateMiniStatBonuses() { renderMiniStats(); }

  // ── Save full sheet ───────────────────────────────────────────────────────
  function saveSheet() {
    // Read all form fields
    const v = id => document.getElementById(id)?.value;
    sheet.name              = v("cs-charname")   || sheet.name;
    sheet.class             = v("cs-class")      || sheet.class;
    sheet.race              = v("cs-race")        || sheet.race;
    sheet.level             = parseInt(v("cs-level"))  || 1;
    sheet.background        = v("cs-background") || sheet.background;
    sheet.ac                = parseInt(v("cs-ac-inp"))   || 10;
    sheet.speed             = parseInt(v("cs-speed-inp"))|| 30;
    sheet.initiative_bonus  = parseInt(v("cs-init-bonus-inp"))||0;
    sheet.equipment         = v("cs-equipment")  || "";
    sheet.backstory         = v("cs-backstory")  || "";
    sheet.vision_range      = parseInt(v("cs-vision-inp"))||0;
    // pic_url persisted separately via uploadCharPic

    onStatChange(); // refresh mods
    updateHP();
    renderMiniStats();
    updateOverview();
    updateAttacksList();
    saveToStorage();

    // Sync token name, AC, HP, initiative_bonus, vision
    const myToken = State.getMyToken();
    if (myToken) {
      Socket.emit("token_update", {
        session_id: State.session_id,
        token_id:   myToken.id,
        updates: {
          name:             sheet.name || myToken.name,
          hp:               sheet.hp,
          max_hp:           sheet.max_hp,
          ac:               sheet.ac,
          speed:            sheet.speed,
          initiative_bonus: sheet.initiative_bonus,
          vision_range:     parseInt(v("cs-vision-inp"))||0,
          perception:          sheet.perception || 10,
          passive_perception:  sheet.passive_perception || 10,
        },
      });
    }
    // Sync character to server roster + also save to global library
    syncCharToServer();
    UI.toast("💾 Bogen gespeichert");
  }

  // Push character snapshot to session roster & save to global library
  function syncCharToServer() {
    if (!State.my_char_id) return;
    const charData = { ...sheet, id: State.my_char_id };
    Socket.emit("roster_update_char", {
      session_id: State.session_id,
      character:  charData,
    });
    // Save to global library
    fetch("/api/characters", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify(charData),
    }).catch(()=>{});
  }

  // ── Overview (Charakter tab) – VOLLSTÄNDIGER Charakterbogen ────────────────
  // ── Live-Ressourcen-Tracker ───────────────────────────────────────────────
  function _renderResourceTrackers() {
    const slots = sheet.spell_slots || {};
    const hasSlots = Object.keys(slots).some(l => (slots[l]?.max||0) > 0);
    const hd = sheet.hit_dice || {max:sheet.level||1, used:0};
    const ds = sheet.death_saves || {success:0, fail:0};
    const custom = sheet.custom_resources || [];

    const pips = (max, used, kind, key) => {
      let out = "";
      for (let i = 0; i < max; i++) {
        const isUsed = i < used;
        out += `<span class="cb-pip ${isUsed?"used":"avail"}" onclick="Character.togglePip('${kind}','${key}',${i})" title="${isUsed?"Verbraucht":"Verfügbar"}"></span>`;
      }
      return out || `<span style="color:var(--text-dim);font-size:.75rem">—</span>`;
    };

    let slotsHtml = "";
    if (hasSlots) {
      slotsHtml = `
        <div class="cb-res-group">
          <div class="cb-res-group-title">✨ Zauberplätze</div>
          ${[1,2,3,4,5,6,7,8,9].filter(l => (slots[l]?.max||0) > 0).map(l => {
            const s = slots[l];
            return `<div class="cb-res-row">
              <span class="cb-res-lbl">Grad ${l}</span>
              <div class="cb-pips">${pips(s.max, s.used, "slot", String(l))}</div>
              <span class="cb-res-count">${s.max - s.used}/${s.max}</span>
            </div>`;
          }).join("")}
        </div>`;
    }

    const myToken = State.getMyToken();
    const curHp = myToken ? myToken.hp : sheet.hp;
    const showDeath = curHp <= 0 || ds.success > 0 || ds.fail > 0;
    let deathHtml = "";
    if (showDeath) {
      deathHtml = `
        <div class="cb-res-group cb-death">
          <div class="cb-res-group-title">💀 Todesrettungswürfe</div>
          <div class="cb-res-row">
            <span class="cb-res-lbl" style="color:var(--green)">Erfolge</span>
            <div class="cb-pips">${[0,1,2].map(i=>`<span class="cb-pip ${i<ds.success?"success":"avail"}" onclick="Character.toggleDeath('success',${i})"></span>`).join("")}</div>
          </div>
          <div class="cb-res-row">
            <span class="cb-res-lbl" style="color:var(--red)">Fehlschläge</span>
            <div class="cb-pips">${[0,1,2].map(i=>`<span class="cb-pip ${i<ds.fail?"fail":"avail"}" onclick="Character.toggleDeath('fail',${i})"></span>`).join("")}</div>
          </div>
          <button class="btn btn-dark btn-xs" style="width:100%;margin-top:6px" onclick="Character.resetDeathSaves()">↺ Zurücksetzen</button>
        </div>`;
    }

    let customHtml = "";
    if (custom.length) {
      customHtml = custom.map(r => `
        <div class="cb-res-row">
          <span class="cb-res-lbl">${esc(r.name)}</span>
          <div class="cb-pips">${r.max <= 12 ? pips(r.max, r.used, "custom", r.id) : ""}</div>
          ${r.max <= 12 ? `<span class="cb-res-count">${r.max-r.used}/${r.max}</span>` : `<div style="display:flex;gap:3px;align-items:center"><button class="cb-res-btn" onclick="Character.adjustCustom('${r.id}',1)">−</button><span class="cb-res-count">${r.max-r.used}/${r.max}</span><button class="cb-res-btn" onclick="Character.adjustCustom('${r.id}',-1)">+</button></div>`}
          <button class="cb-res-del" onclick="Character.removeCustomResource('${r.id}')" title="Entfernen">✕</button>
        </div>`).join("");
    }

    return `
      <div class="cb-section">
        <div class="cb-section-title">
          🎯 Ressourcen
          <span style="float:right;color:var(--text-dim);font-size:.6rem">klick auf Punkte = verbrauchen</span>
        </div>
        <div class="cb-resources">
          ${slotsHtml}
          <div class="cb-res-group">
            <div class="cb-res-group-title">🎲 Trefferwürfel</div>
            <div class="cb-res-row">
              <span class="cb-res-lbl">TW</span>
              <div class="cb-pips">${pips(hd.max||sheet.level||1, hd.used||0, "hd", "hd")}</div>
              <span class="cb-res-count">${(hd.max||sheet.level||1)-(hd.used||0)}/${hd.max||sheet.level||1}</span>
            </div>
          </div>
          <div class="cb-res-group">
            <div class="cb-res-group-title">
              ⚡ Klassen-Ressourcen
              <button class="cb-res-add" onclick="Character.addCustomResource()" title="Ressource hinzufügen">+</button>
            </div>
            ${customHtml || `<div style="color:var(--text-dim);font-size:.75rem;font-style:italic;padding:4px 0">Keine — klick auf „+" für Ki, Wut, Inspiration usw.</div>`}
          </div>
          ${deathHtml}
          <div class="cb-res-actions">
            <button class="btn btn-dark btn-xs" onclick="Character.shortRest()" title="Kurze Rast">🌙 Kurze Rast</button>
            <button class="btn btn-gold btn-xs" onclick="Character.longRest()" title="Lange Rast: alles auffüllen">☀️ Lange Rast</button>
          </div>
        </div>
      </div>`;
  }

  function togglePip(kind, key, index) {
    if (kind === "slot") {
      const s = sheet.spell_slots[key]; if (!s) return;
      s.used = (index < s.used) ? index : index + 1;
      s.used = Math.max(0, Math.min(s.max, s.used));
    } else if (kind === "hd") {
      const hd = sheet.hit_dice; const max = hd.max || sheet.level || 1;
      hd.used = (index < hd.used) ? index : index + 1;
      hd.used = Math.max(0, Math.min(max, hd.used));
    } else if (kind === "custom") {
      const r = sheet.custom_resources.find(x => x.id === key); if (!r) return;
      r.used = (index < r.used) ? index : index + 1;
      r.used = Math.max(0, Math.min(r.max, r.used));
    }
    saveToStorage(); updateOverview();
  }

  function toggleDeath(type, index) {
    const ds = sheet.death_saves;
    const cur = ds[type];
    ds[type] = (index < cur) ? index : index + 1;
    ds[type] = Math.max(0, Math.min(3, ds[type]));
    saveToStorage(); updateOverview();
    if (ds.success >= 3) { UI.toast("✨ Stabilisiert!"); ds.success = 0; ds.fail = 0; saveToStorage(); updateOverview(); }
    if (ds.fail >= 3) UI.toast("💀 Charakter gestorben…");
  }

  function resetDeathSaves() {
    sheet.death_saves = {success:0, fail:0};
    saveToStorage(); updateOverview();
  }

  async function addCustomResource() {
    const name = await Dialog.prompt(
      "Wie heißt die Ressource?", "",
      {title:"Neue Ressource", icon:"✨", okText:"Weiter",
       placeholder:"z. B. Ki-Punkte, Wut, Inspiration"});
    if (!name || !name.trim()) return;
    const max = await Dialog.promptNumber(
      `Wie viele „${name.trim()}“ hat der Charakter maximal?`, 3,
      {title:"Maximale Anzahl", icon:"🔢", okText:"Anlegen"});
    if (max === null) return;
    sheet.custom_resources.push({ id: "res"+Date.now(), name: name.trim(),
                                  max: Math.max(1, max), used: 0 });
    saveToStorage(); updateOverview();
  }

  function removeCustomResource(id) {
    sheet.custom_resources = sheet.custom_resources.filter(r => r.id !== id);
    saveToStorage(); updateOverview();
  }

  function adjustCustom(id, delta) {
    const r = sheet.custom_resources.find(x => x.id === id); if (!r) return;
    r.used = Math.max(0, Math.min(r.max, r.used + delta));
    saveToStorage(); updateOverview();
  }

  function shortRest() {
    UI.toast("🌙 Kurze Rast eingelegt");
    saveToStorage(); updateOverview();
  }

  function longRest() {
    Object.values(sheet.spell_slots || {}).forEach(s => s.used = 0);
    const hd = sheet.hit_dice;
    if (hd) hd.used = Math.max(0, (hd.used||0) - Math.max(1, Math.floor((hd.max||1)/2)));
    (sheet.custom_resources || []).forEach(r => r.used = 0);
    sheet.death_saves = {success:0, fail:0};
    const myToken = State.getMyToken();
    if (myToken) {
      Socket.emit("token_update", {session_id:State.session_id, token_id:myToken.id, updates:{hp:myToken.max_hp}});
    }
    sheet.hp = sheet.max_hp;
    UI.toast("☀️ Lange Rast — alles aufgefrischt!");
    saveToStorage(); syncCharToServer(); updateOverview();
  }

  function autoGenerateSpellSlots() {
    const FULL_CASTER = {
      1:[2],2:[3],3:[4,2],4:[4,3],5:[4,3,2],6:[4,3,3],7:[4,3,3,1],8:[4,3,3,2],
      9:[4,3,3,3,1],10:[4,3,3,3,2],11:[4,3,3,3,2,1],12:[4,3,3,3,2,1],
      13:[4,3,3,3,2,1,1],14:[4,3,3,3,2,1,1],15:[4,3,3,3,2,1,1,1],16:[4,3,3,3,2,1,1,1],
      17:[4,3,3,3,2,1,1,1,1],18:[4,3,3,3,3,1,1,1,1],19:[4,3,3,3,3,2,1,1,1],20:[4,3,3,3,3,2,2,1,1],
    };
    const row = FULL_CASTER[Math.min(sheet.level||1, 20)] || [];
    const newSlots = {};
    row.forEach((count, idx) => {
      const lvl = idx + 1;
      const prevUsed = sheet.spell_slots?.[lvl]?.used || 0;
      newSlots[lvl] = { max: count, used: Math.min(prevUsed, count) };
    });
    sheet.spell_slots = newSlots;
    saveToStorage(); updateOverview();
    UI.toast("✨ Zauberplätze für Vollzauberer generiert");
  }

  function updateOverview() {
    const ov = document.getElementById("char-overview");
    if (!ov) return;
    const myToken = State.getMyToken();
    const hp    = myToken ? myToken.hp    : sheet.hp;
    const maxHp = myToken ? myToken.max_hp: sheet.max_hp;
    const ac    = myToken ? myToken.ac    : sheet.ac;
    const speed = myToken ? (myToken.speed||sheet.speed) : sheet.speed;
    const vision = myToken ? (myToken.vision_range||sheet.vision_range) : sheet.vision_range;
    const pct   = Math.max(0,Math.min(100,(hp/Math.max(1,maxHp))*100));
    const hpColor = pct>50?"#4a8a5a":pct>25?"#e67e22":"#c0392b";
    const proficiency = pb();
    const initMod = getStatMod("dex") + (sheet.initiative_bonus||0);
    // Passive Wahrnehmung nach D&D: 10 + WEI-Mod + (Übungsbonus, falls in Wahrnehmung geübt)
    const perceptionProf = sheet.skill_profs.includes("Wahrnehmung") ? proficiency : 0;
    const passivePerception = 10 + getStatMod("wis") + perceptionProf;
    // Passive Werte auch für Untersuchung & Einsicht (nützlich für den DM)
    const investigationProf = sheet.skill_profs.includes("Nachforschungen") || sheet.skill_profs.includes("Untersuchung") ? proficiency : 0;
    const passiveInvestigation = 10 + getStatMod("int") + investigationProf;
    const insightProf = sheet.skill_profs.includes("Einsicht") ? proficiency : 0;
    const passiveInsight = 10 + getStatMod("wis") + insightProf;
    // Passive Wahrnehmung im Sheet speichern (für Token/Sichtberechnung)
    sheet.passive_perception = passivePerception;

    // Find library race + class (may be string name from builtin, or lib-id)
    const libRace = _findLibRace(sheet.race);
    const libClass = _findLibClass(sheet.class);
    const libSubclass = _findLibSubclass(sheet.subclass);

    ov.innerHTML = `
      <!-- Name header -->
      <div class="cb-header">
        ${sheet.pic_url?`<img class="cb-pic" src="${esc(sheet.pic_url)}" alt="">`:`<div class="cb-pic cb-pic-ph">🧙</div>`}
        <div class="cb-head-info">
          <div class="cb-name">${esc(sheet.name||State.username)}</div>
          <div class="cb-subtitle">${esc(sheet.race||"—")} · ${esc(sheet.class||"—")} ${sheet.level||1}${sheet.subclass?` (${esc(sheet.subclass)})`:""}</div>
          ${sheet.background?`<div class="cb-bg">📜 ${esc(sheet.background)}</div>`:""}
        </div>
      </div>

      <!-- HP bar (big) -->
      <div class="cb-hp-block">
        <div class="cb-hp-readout" style="color:${hpColor}">${hp} <span style="opacity:.6">/</span> ${maxHp}</div>
        <div class="cb-hp-bar"><div class="cb-hp-fill" style="width:${pct}%;background:${hpColor}"></div></div>
        <div class="cb-hp-label">TREFFERPUNKTE</div>
      </div>

      <!-- Key combat stats row -->
      <div class="cb-combat-row">
        <div class="cb-mini">
          <div class="cb-mini-icon">🛡</div>
          <div class="cb-mini-val">${ac}</div>
          <div class="cb-mini-lbl">Rüstung</div>
        </div>
        <div class="cb-mini">
          <div class="cb-mini-icon">⚡</div>
          <div class="cb-mini-val">${fmtMod(initMod)}</div>
          <div class="cb-mini-lbl">Initiative</div>
        </div>
        <div class="cb-mini">
          <div class="cb-mini-icon">💨</div>
          <div class="cb-mini-val">${speed}</div>
          <div class="cb-mini-lbl">BW (ft)</div>
        </div>
        <div class="cb-mini">
          <div class="cb-mini-icon">👁</div>
          <div class="cb-mini-val">${vision||"∞"}</div>
          <div class="cb-mini-lbl">Sicht</div>
        </div>
        <div class="cb-mini">
          <div class="cb-mini-icon">➕</div>
          <div class="cb-mini-val">${fmtMod(proficiency)}</div>
          <div class="cb-mini-lbl">Übung</div>
        </div>
      </div>

      <!-- Passive Werte -->
      <div class="cb-passive-row">
        <div class="cb-passive" title="Passive Wahrnehmung – bestimmt auch dein Sichtfeld auf der Karte">
          <span class="cb-passive-icon">👁️‍🗨️</span>
          <span class="cb-passive-val">${passivePerception}</span>
          <span class="cb-passive-lbl">Pass. Wahrnehmung</span>
        </div>
        <div class="cb-passive" title="Passive Nachforschung">
          <span class="cb-passive-icon">🔍</span>
          <span class="cb-passive-val">${passiveInvestigation}</span>
          <span class="cb-passive-lbl">Pass. Nachf.</span>
        </div>
        <div class="cb-passive" title="Passive Einsicht">
          <span class="cb-passive-icon">🧠</span>
          <span class="cb-passive-val">${passiveInsight}</span>
          <span class="cb-passive-lbl">Pass. Einsicht</span>
        </div>
      </div>

      <!-- Attributes + Saves in two columns -->
      <div class="cb-section">
        <div class="cb-section-title">Attribute &amp; Rettungswürfe</div>
        <div class="cb-stats-grid">
          ${STATS.map(s=>{
            const val = sheet.stats[s]||10;
            const m = getStatMod(s);
            const saveM = m + (_isSaveProf(s) ? proficiency : 0);
            return `<div class="cb-stat-card">
              <div class="cb-stat-lbl">${STAT_LABELS[s]}</div>
              <div class="cb-stat-val">${val}</div>
              <div class="cb-stat-mod" onclick="Character.rollStat('${s}')" title="Attributs-Probe würfeln">${fmtMod(m)}</div>
              <div class="cb-save ${_isSaveProf(s)?"prof":""}" onclick="Character.rollSave('${s}')" title="Rettungswurf">
                <span class="cb-save-dot"></span> RW ${fmtMod(saveM)}
              </div>
            </div>`;
          }).join("")}
        </div>
      </div>

      <!-- Skills -->
      <div class="cb-section">
        <div class="cb-section-title">Fertigkeiten <span style="float:right;color:var(--text-dim);font-size:.6rem">◉ = geübt · klicken zum Würfeln</span></div>
        <div class="cb-skills-grid">
          ${SKILLS_DEF.map(sk=>{
            const base = getStatMod(sk.stat);
            const prof = sheet.skill_profs.includes(sk.name);
            const total = base + (prof ? proficiency : 0);
            return `<div class="cb-skill-row ${prof?"prof":""}" onclick="Character.rollSkill('${sk.name}','${sk.stat}')">
              <div class="cb-skill-dot"></div>
              <span class="cb-skill-name">${esc(sk.name)}</span>
              <span class="cb-skill-stat">${STAT_LABELS[sk.stat]}</span>
              <span class="cb-skill-mod">${fmtMod(total)}</span>
            </div>`;
          }).join("")}
        </div>
      </div>

      ${_renderResourceTrackers()}

      ${libRace ? `
        <div class="cb-section">
          <div class="cb-section-title">🧬 Volks-Eigenschaften (${esc(libRace.name)})</div>
          <div class="cb-feature-box">
            ${libRace.size?`<div class="cb-feat-line"><strong>Größe:</strong> ${esc(libRace.size)}</div>`:""}
            ${libRace.speed?`<div class="cb-feat-line"><strong>Geschwindigkeit:</strong> ${libRace.speed} ft</div>`:""}
            ${libRace.darkvision?`<div class="cb-feat-line"><strong>Dunkelsicht:</strong> ${libRace.darkvision} ft</div>`:""}
            ${libRace.asi?`<div class="cb-feat-line"><strong>Attributs-Boni:</strong> ${esc(libRace.asi)}</div>`:""}
            ${libRace.languages?`<div class="cb-feat-line"><strong>Sprachen:</strong> ${esc(libRace.languages)}</div>`:""}
            ${_renderRaceTraits(libRace)}
          </div>
        </div>` : ""
      }

      ${libClass ? `
        <div class="cb-section">
          <div class="cb-section-title">⚔️ Klassen-Merkmale (${esc(libClass.name)})</div>
          <div class="cb-feature-box">
            ${libClass.hd?`<div class="cb-feat-line"><strong>Trefferwürfel:</strong> ${esc(libClass.hd)}</div>`:""}
            ${libClass.saves?`<div class="cb-feat-line"><strong>Rettungswürfe:</strong> ${esc(libClass.saves)}</div>`:""}
            ${libClass.armor?`<div class="cb-feat-line"><strong>Rüstungen:</strong> ${esc(libClass.armor)}</div>`:""}
            ${libClass.weapons?`<div class="cb-feat-line"><strong>Waffen:</strong> ${esc(libClass.weapons)}</div>`:""}
            ${libClass.tools?`<div class="cb-feat-line"><strong>Werkzeuge:</strong> ${esc(libClass.tools)}</div>`:""}
          </div>
        </div>` : ""
      }

      ${_renderLevelFeaturesSection(libClass, libSubclass) || ""}

      <!-- Attacks preview -->
      ${sheet.attacks && sheet.attacks.length ? `
        <div class="cb-section">
          <div class="cb-section-title">🗡 Angriffe &amp; Zauber</div>
          <div class="cb-attacks-list">
            ${sheet.attacks.slice(0,8).map(a=>`
              <div class="cb-attack-row">
                <div class="cb-atk-info">
                  <div class="cb-atk-name">${esc(a.name)}</div>
                  <div class="cb-atk-meta">${esc(a.type||"")} ${a.hit_bonus!=null?`· ${fmtMod(a.hit_bonus)} tref.`:""} ${a.damage?`· ${esc(a.damage)} ${esc(a.damage_type||"")}`:""}</div>
                </div>
                <button class="btn btn-gold btn-xs" onclick="Character.rollAttack('${a.id}')" title="Trefferwurf">🎯</button>
                <button class="btn btn-dark btn-xs" onclick="Character.rollDamage('${a.id}')" title="Schaden">💥</button>
              </div>`).join("")}
          </div>
        </div>` : ""
      }

      <!-- Inventory preview -->
      ${sheet.inventory && sheet.inventory.length ? `
        <div class="cb-section">
          <div class="cb-section-title">🎒 Inventar</div>
          <div class="cb-inv-list">
            ${sheet.inventory.slice(0,10).map(it=>`
              <div class="cb-inv-row ${it.equipped?"equipped":""}">
                ${it.equipped?"✓ ":""}${esc(it.name)}${it.quantity>1?` ×${it.quantity}`:""}
                ${it.ac_bonus?`<span style="color:var(--text-dim);font-size:.72rem">· +${it.ac_bonus} RK</span>`:""}
              </div>`).join("")}
          </div>
        </div>` : ""
      }

      <!-- Gold -->
      ${(sheet.gold||sheet.silver||sheet.copper) ? `
        <div class="cb-coins-row">
          <div class="cb-coin gold">💰 ${sheet.gold||0} GP</div>
          <div class="cb-coin silver">⚪ ${sheet.silver||0} SP</div>
          <div class="cb-coin copper">🟤 ${sheet.copper||0} CP</div>
        </div>` : ""
      }

      <!-- Personality / Ideals / Bonds / Flaws -->
      ${(sheet.personality||sheet.ideals||sheet.bonds||sheet.flaws) ? `
        <div class="cb-section">
          <div class="cb-section-title">✨ Persönlichkeit</div>
          <div class="cb-personality-grid">
            ${sheet.personality?`<div class="cb-pers-card"><div class="cb-pers-lbl">Eigenschaften</div><div>${esc(sheet.personality)}</div></div>`:""}
            ${sheet.ideals?`<div class="cb-pers-card"><div class="cb-pers-lbl">Ideale</div><div>${esc(sheet.ideals)}</div></div>`:""}
            ${sheet.bonds?`<div class="cb-pers-card"><div class="cb-pers-lbl">Bindungen</div><div>${esc(sheet.bonds)}</div></div>`:""}
            ${sheet.flaws?`<div class="cb-pers-card"><div class="cb-pers-lbl">Makel</div><div>${esc(sheet.flaws)}</div></div>`:""}
          </div>
        </div>` : ""
      }

      ${sheet.backstory ? `
        <div class="cb-section">
          <div class="cb-section-title">📖 Hintergrundgeschichte</div>
          <div class="cb-backstory">${esc(sheet.backstory).replace(/\n/g,"<br>")}</div>
        </div>` : ""
      }
    `;
  }

  // ── Library lookup helpers ─────────────────────────────────────────────────
  function _findLibRace(raceName){
    if (!raceName) return null;
    // Try match by name (from builder, race is stored as name string)
    const libEntries = Object.values(_library.races||{});
    return libEntries.find(r=>r.name && r.name.toLowerCase() === String(raceName).toLowerCase()) || null;
  }

  function _renderRaceTraits(libRace){
    if (!libRace) return "";
    const t = libRace.traits;
    if (!t) return "";
    // New array format: [{name, description, choices}]
    if (Array.isArray(t)) {
      if (!t.length) return "";
      return `<div class="cb-feat-traits">${t.map(tr=>{
        return `<div style="margin-bottom:4px"><strong style="color:var(--gold)">${esc(tr.name||"")}</strong>${tr.description?": "+esc(tr.description):""}</div>`;
      }).join("")}</div>`;
    }
    // Old string format
    return `<div class="cb-feat-traits">${esc(t).replace(/\n/g,"<br>")}</div>`;
  }

  function _findLibClass(className){
    if (!className) return null;
    const libEntries = Object.values(_library.classes||{});
    return libEntries.find(c=>c.name && c.name.toLowerCase() === String(className).toLowerCase()) || null;
  }

  function _findLibSubclass(subclassName){
    if (!subclassName) return null;
    const libEntries = Object.values(_library.subclasses||{});
    return libEntries.find(s=>s.name && s.name.toLowerCase() === String(subclassName).toLowerCase()) || null;
  }

  function _renderLevelFeaturesSection(libClass, libSubclass){
    const level = sheet.level || 1;
    let allFeatures = {};
    if (libClass?.level_features) {
      for (let [lvl, feat] of Object.entries(libClass.level_features)) {
        if (parseInt(lvl) <= level) allFeatures[lvl] = { class: feat, class_name: libClass.name };
      }
    }
    if (libSubclass?.level_features) {
      for (let [lvl, feat] of Object.entries(libSubclass.level_features)) {
        if (parseInt(lvl) <= level) {
          if (!allFeatures[lvl]) allFeatures[lvl] = {};
          allFeatures[lvl].subclass = feat;
          allFeatures[lvl].subclass_name = libSubclass.name;
        }
      }
    }
    const sortedLevels = Object.keys(allFeatures).sort((a,b)=>parseInt(a)-parseInt(b));
    if (!sortedLevels.length) return "";
    return `<div class="cb-section">
      <div class="cb-section-title">⭐ Level-Features (bis Stufe ${level})</div>
      <div class="cb-level-features">
        ${sortedLevels.map(lvl=>{
          const f = allFeatures[lvl];
          return `<div class="cb-lvl-card">
            <div class="cb-lvl-badge">Lvl ${lvl}</div>
            <div class="cb-lvl-body">
              ${f.class?`<div><strong style="color:var(--gold)">${esc(f.class_name)}:</strong> ${esc(parseFormulas(f.class)).replace(/\n/g,"<br>")}</div>`:""}
              ${f.subclass?`<div style="margin-top:4px"><strong style="color:var(--gold-light)">${esc(f.subclass_name)}:</strong> ${esc(parseFormulas(f.subclass)).replace(/\n/g,"<br>")}</div>`:""}
            </div>
          </div>`;
        }).join("")}
      </div>
    </div>`;
  }

  function _isSaveProf(stat){
    // A character has save proficiencies from the class; we store them optionally in sheet.save_profs
    if (!sheet.save_profs) {
      // Try to read from library class
      const libClass = _findLibClass(sheet.class);
      if (libClass?.saves) {
        const saves = libClass.saves.toLowerCase();
        // saves string like "STR, KON" or "str, con"
        if (saves.includes("str") && stat==="str") return true;
        if (saves.includes("dex") || saves.includes("ges")) if (stat==="dex") return true;
        if (saves.includes("con") || saves.includes("kon")) if (stat==="con") return true;
        if (saves.includes("int") && stat==="int") return true;
        if (saves.includes("wis") || saves.includes("wei")) if (stat==="wis") return true;
        if (saves.includes("cha")) if (stat==="cha") return true;
      }
      return false;
    }
    return sheet.save_profs.includes(stat);
  }

  function rollSave(stat) {
    const m = getStatMod(stat) + (_isSaveProf(stat) ? pb() : 0);
    const formula = `1d20${m>=0?"+"+m:m}`;
    Socket.emit("dice_roll",{
      session_id:State.session_id, formula, roller:State.username,
      author:State.username, role:State.role, color:State.my_color,
      label:`${STAT_LABELS[stat]}-Rettungswurf`, secret:false,
    });
    Tabs.switchTo("chat");
  }

  // ── Roll helpers ─────────────────────────────────────────────────────────
  function rollStat(stat) {
    const m = getStatMod(stat);
    const formula = `1d20${m>=0?"+"+m:m}`;
    Socket.emit("dice_roll",{
      session_id:State.session_id, formula, roller:State.username,
      author:State.username, role:State.role, color:State.my_color,
      label:`${STAT_LABELS[stat]}-Probe`, secret:false,
    });
    Tabs.switchTo("chat");
  }

  function rollSkill(name, stat) {
    const base  = getStatMod(stat);
    const prof  = sheet.skill_profs.includes(name);
    const total = base + (prof ? pb() : 0);
    const formula = `1d20${total>=0?"+"+total:total}`;
    // Der Wahrnehmungswurf steuert zusätzlich die eigene Sichtweite auf der
    // Karte. Deshalb schicken wir ihn markiert mit – der Server rechnet den
    // Sicht-Modifikator daraus aus (schlechter Wurf = kleinerer Sichtradius).
    const isPerception = (name === "Wahrnehmung");
    Socket.emit("dice_roll",{
      session_id:State.session_id, formula, roller:State.username,
      author:State.username, role:State.role, color:State.my_color,
      label:name, secret:false,
      is_perception: isPerception,
      char_id: isPerception ? (State.my_char_id || "") : "",
    });
    Tabs.switchTo("chat");
  }

  function rollInitiative() {
    const initMod = getStatMod("dex") + (sheet.initiative_bonus||0);
    const formula = `1d20${initMod>=0?"+"+initMod:initMod}`;
    // Roll locally for result, then add to tracker
    const rollVal = Math.floor(Math.random()*20)+1;
    const total   = rollVal + initMod;
    Socket.emit("dice_roll",{
      session_id:State.session_id, formula, roller:State.username,
      author:State.username, role:State.role, color:State.my_color,
      label:"Initiative", secret:false,
    });
    // Add to initiative tracker automatically
    Socket.emit("initiative_add",{
      session_id: State.session_id,
      name:       sheet.name || State.username,
      init:       total,
      hp:         sheet.hp,
      max_hp:     sheet.max_hp,
      owner_char_id: State.my_char_id || sheet.id || "",
    });
    Tabs.switchTo("chat");
    UI.toast(`⚔️ Initiative: ${total}`);
  }

  // ── Attacks ──────────────────────────────────────────────────────────────
  function updateAttacksList() {
    const panel = document.getElementById("attacks-list");
    if (!panel) return;
    if (!sheet.attacks.length) {
      panel.innerHTML = `<div style="color:var(--text-dim);text-align:center;padding:16px;font-style:italic">Noch keine Angriffe oder Zauber erstellt.</div>`;
      return;
    }
    // Trennung: Zauber vs. normale Angriffe (Nahkampf/Fernkampf)
    const isSpell = a => (a.type==="Zauber" || a.type==="spell" || a.is_spell);
    const spells  = sheet.attacks.filter(isSpell);
    const attacks = sheet.attacks.filter(a=>!isSpell(a));

    const CONDS = (typeof Tokens !== "undefined" && Tokens.CONDITIONS) ? Tokens.CONDITIONS : {};
    const CONDNAMES = (typeof COND_LABELS !== "undefined") ? COND_LABELS : {};
    const durText = d => {
      if (d === "until_my_next_turn_end")     return "bis Ende deines nächsten Zuges";
      if (d === "until_target_next_turn_end") return "bis Ende des Zuges des Ziels";
      if (d === "permanent")                  return "dauerhaft";
      if (d && d.startsWith("rounds:")) {
        const n = d.split(":")[1];
        return `${n} Runde${n !== "1" ? "n" : ""}`;
      }
      return "";
    };

    const card = a => `
      <div class="attack-card">
        <div class="atk-name">${esc(a.name)}</div>
        <div class="atk-stats">
          <span title="Angriffsbonus">🗡 ${a.hit_bonus>=0?"+":""}${a.hit_bonus} zum Treffen</span>
          <span title="Schaden">💥 ${esc(a.damage)} ${esc(a.damage_type)}</span>
          ${a.range?`<span>📏 ${esc(a.range)}</span>`:""}
          ${a.save_type?`<span title="Rettungswurf">🛡 ${esc(a.save_type)} RW (SG ${a.save_dc||10})</span>`:""}
        </div>
        ${a.effect ? `<div class="atk-effect" title="Wirkt automatisch bei einem Treffer">
          ✨ ${CONDS[a.effect]||""} <b>${CONDNAMES[a.effect]||a.effect}</b>
          ${a.effect_dur ? `<span style="opacity:.7"> · ${durText(a.effect_dur)}</span>` : ""}
        </div>` : ""}
        ${a.notes?`<div class="atk-note">${esc(a.notes)}</div>`:""}
        <div style="display:flex;gap:5px;margin-top:7px;flex-wrap:wrap">
          <button class="btn btn-gold btn-xs" onclick="Character.rollAttack('${a.id}')">🗡 ${a.save_type?"Zauber":"Angriff"}</button>
          <button class="btn btn-dark  btn-xs" onclick="Character.rollDamage('${a.id}')">💥 Schaden</button>
          <button class="btn btn-danger btn-xs" onclick="Character.deleteAttack('${a.id}')" style="margin-left:auto">🗑</button>
        </div>
      </div>`;

    let html = "";
    if (attacks.length){
      html += `<div class="atk-group-title">🗡️ Angriffe</div>`;
      html += attacks.map(card).join("");
    }
    if (spells.length){
      html += `<div class="atk-group-title" style="margin-top:10px">✨ Zauber</div>`;
      html += spells.map(card).join("");
    }
    panel.innerHTML = html;
  }

  function addAttack() {
    const v = id => document.getElementById(id)?.value;
    const saveType = v("atk-save-type") || "";
    const atk = {
      id:          Date.now().toString(36),
      name:        v("atk-name")    || "Neuer Angriff",
      type:        v("atk-type")    || "melee",
      hit_bonus:   parseInt(v("atk-hit")) || 0,
      damage:      v("atk-dmg")     || "1d6",
      damage_type: v("atk-dmgtype") || "Hieb",
      range:       v("atk-range")   || "",
      notes:       v("atk-notes")   || "",
      save_type:   saveType,
      save_dc:     parseInt(v("atk-save-dc")) || 0,
      is_spell:    (v("atk-type")==="Zauber"),
      // Statuseffekt, den ein Treffer beim Ziel auslöst
      effect:      v("atk-effect")     || "",
      effect_dur:  v("atk-effect-dur") || "",
    };
    sheet.attacks.push(atk);
    saveToStorage();
    updateAttacksList();
    // Formular leeren
    ["atk-name","atk-dmg","atk-dmgtype","atk-range","atk-notes","atk-save-dc"].forEach(id=>{
      const el=document.getElementById(id); if(el) el.value="";
    });
    const hitEl = document.getElementById("atk-hit");
    if (hitEl) hitEl.value="0";
    ["atk-save-type","atk-effect","atk-effect-dur"].forEach(id=>{
      const el=document.getElementById(id); if(el) el.value="";
    });
    UI.toast(saveType ? "✨ Zauber hinzugefügt" : "🗡 Angriff hinzugefügt");
  }

  function deleteAttack(id) {
    sheet.attacks = sheet.attacks.filter(a=>a.id!==id);
    saveToStorage(); updateAttacksList();
  }

  function rollAttack(id) {
    const a = sheet.attacks.find(x=>x.id===id);
    if (!a) return;
    // Ziel-Auswahl öffnen (nur sichtbare Ziele)
    if (typeof openAttackTargetPicker === "function") {
      openAttackTargetPicker(a);
    } else {
      // Fallback: einfacher Wurf ohne Ziel
      const formula = `1d20${a.hit_bonus>=0?"+"+a.hit_bonus:a.hit_bonus}`;
      Socket.emit("dice_roll",{
        session_id:State.session_id, formula, roller:State.username,
        author:State.username, role:State.role, color:State.my_color,
        label:`${a.name} – Angriff`, secret:false,
      });
      Tabs.switchTo("chat");
    }
  }

  function rollDamage(id) {
    const a = sheet.attacks.find(x=>x.id===id);
    if (!a) return;
    Socket.emit("dice_roll",{
      session_id:State.session_id, formula:a.damage, roller:State.username,
      author:State.username, role:State.role, color:State.my_color,
      label:`${a.name} – Schaden (${a.damage_type})`, secret:false,
    });
    Tabs.switchTo("chat");
  }

  // ── Spawn own token (first time joining) ─────────────────────────────────
  function spawnMyToken(url) {
    if (State.getMyToken()) { UI.toast("Du hast bereits einen Token!"); return; }
    Socket.emit("token_create",{
      session_id:       State.session_id,
      name:             sheet.name || State.username,
      url:              url || sheet.pic_url || "",
      x:                200, y:200, size:50,
      hp:               sheet.hp,
      max_hp:           sheet.max_hp,
      ac:               sheet.ac,
      speed:            sheet.speed,
      initiative_bonus: sheet.initiative_bonus||0,
      vision_range:     parseInt(document.getElementById("cs-vision-inp")?.value)||0,
      owner:            State.my_socket_id,
    });
    UI.toast("🧙 Token platziert!");
  }

  function esc(s){ return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

  return {
    init, saveSheet, onStatChange, onHpChange,
    toggleProf, rollStat, rollSave, rollSkill, rollInitiative,
    addAttack, deleteAttack, rollAttack, rollDamage,
    spawnMyToken, updateOverview,
    togglePip, toggleDeath, resetDeathSaves,
    addCustomResource, removeCustomResource, adjustCustom,
    shortRest, longRest, autoGenerateSpellSlots,
    parseFormulas,
    get sheet() { return sheet; },
  };
})();
