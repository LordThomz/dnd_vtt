/* ══════════════════════════════════════════════════════════════════════════
   Inspector – der DM sieht (und bearbeitet) den Charakterbogen eines
   Spielers oder Gegners.

   Öffnet ein Panel LINKS neben dem normalen Seitenpanel, mit drei Reitern:
     Bogen · Angriffe · Inventar
   und zwei Modi:
     ANSEHEN    – alles auf einen Blick, würfeln möglich
     BEARBEITEN – Werte ändern, Zustände setzen

   Der DM sieht dasselbe wie der Spieler auf seinem eigenen Bogen.
   ══════════════════════════════════════════════════════════════════════════ */
const Inspector = (() => {

  let _target = null;    // {kind:"char"|"enemy", id, name, pic, sheet, token}
  let _tab    = "sheet";
  let _edit   = false;   // Bearbeiten-Modus

  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  const mod    = v => Math.floor(((v ?? 10) - 10) / 2);
  const fmtMod = m => (m >= 0 ? "+" : "") + m;
  const pb     = lvl => 2 + Math.floor((Math.max(1, lvl || 1) - 1) / 4);

  const STATS = [
    ["str","STÄ"], ["dex","GES"], ["con","KON"],
    ["int","INT"], ["wis","WEI"], ["cha","CHA"],
  ];

  // Fertigkeiten mit ihrem Attribut (wie im Charakterbogen)
  const SKILLS = [
    ["Akrobatik","dex"], ["Arkana","int"], ["Athletik","str"],
    ["Auftreten","cha"], ["Einschüchtern","cha"], ["Fingerfertigkeit","dex"],
    ["Geschichte","int"], ["Heilkunde","wis"], ["Heimlichkeit","dex"],
    ["Motiv erkennen","wis"], ["Nachforschungen","int"], ["Naturkunde","int"],
    ["Religion","int"], ["Täuschung","cha"], ["Überlebenskunst","wis"],
    ["Überzeugen","cha"], ["Umgang mit Tieren","wis"], ["Wahrnehmung","wis"],
  ];

  const CONDITIONS = {
    blinded:"🙈", charmed:"💕", deafened:"🔇", exhausted:"😴", frightened:"😱",
    grappled:"🤝", incapacitated:"💤", invisible:"👻", paralyzed:"⚡",
    petrified:"🗿", poisoned:"🤢", prone:"⬇️", restrained:"⛓",
    stunned:"💫", unconscious:"💔", dead:"☠️",
  };
  const COND_NAMES = {
    blinded:"Blind", charmed:"Bezaubert", deafened:"Taub", exhausted:"Erschöpft",
    frightened:"Verängstigt", grappled:"Gepackt", incapacitated:"Kampfunfähig",
    invisible:"Unsichtbar", paralyzed:"Gelähmt", petrified:"Versteinert",
    poisoned:"Vergiftet", prone:"Liegend", restrained:"Festgesetzt",
    stunned:"Betäubt", unconscious:"Bewusstlos", dead:"Tot",
  };

  // ── Öffnen ──────────────────────────────────────────────────────────────

  /** Spieler-Charakter (aus dem Roster). */
  function openChar(charId) {
    const r = (State.roster || {})[charId];
    if (!r) { UI.toast("Charakterbogen nicht verfügbar"); return; }
    const sheet = r.character || {};
    _target = {
      kind: "char", id: charId,
      name: r.name || sheet.name || "Charakter",
      pic:  r.pic_url || sheet.pic_url || "",
      sub:  [sheet.race, sheet.class, sheet.level ? "Stufe " + sheet.level : ""]
              .filter(Boolean).join(" · ") || "Spielercharakter",
      sheet,
      token: _tokenOfChar(charId),
    };
    _tab = "sheet";
    _render(); _open();
  }

  /** Gegner – über die Gegner-ID oder einen Token auf der Karte. */
  function openEnemy(idOrTokenId) {
    const enemies = State.enemies || {};
    let e = enemies[idOrTokenId];
    let tok = null;

    if (!e) {
      tok = (State.tokens || {})[idOrTokenId];
      if (tok && tok.enemy_id) e = enemies[tok.enemy_id];
      if (!e && tok) e = {
        name: tok.name, hp: tok.hp, max_hp: tok.max_hp, ac: tok.ac,
        speed: tok.speed, stats: {}, attacks: [],
      };
    } else {
      // Passenden Token auf der Karte suchen (für HP/Zustände)
      tok = Object.values(State.tokens || {})
        .find(t => t.enemy_id === idOrTokenId) || null;
    }
    if (!e) { UI.toast("Kein Gegner-Bogen gefunden"); return; }

    _target = {
      kind: "enemy", id: idOrTokenId,
      enemyId: e.id || (tok && tok.enemy_id) || idOrTokenId,
      name: e.name || "Gegner",
      pic:  e.url || (tok ? tok.url : "") || "",
      sub:  [e.size ? _sizeName(e.size) : "", e.creature_type,
             e.cr ? "HG " + e.cr : "", e.alignment]
              .filter(Boolean).join(" · ") || "Gegner",
      sheet: e, token: tok,
    };
    _tab = "sheet";
    _render(); _open();
  }

  function _tokenOfChar(charId) {
    return Object.values(State.tokens || {})
      .find(t => t.owner_char_id === charId) || null;
  }
  function _sizeName(s) {
    return { T:"Winzig", S:"Klein", M:"Mittelgroß", L:"Groß",
             H:"Riesig", G:"Gigantisch" }[s] || "";
  }

  function _open()  { $("inspect-panel")?.classList.add("open"); }
  function close()  { $("inspect-panel")?.classList.remove("open"); _target = null; }

  function setTab(tab) {
    _tab = tab;
    ["sheet","attacks","inventory"].forEach(t =>
      $("insp-tab-" + t)?.classList.toggle("on", t === tab));
    _renderBody();
  }
  function setMode(edit) {
    _edit = !!edit;
    $("insp-mode-view")?.classList.toggle("on", !_edit);
    $("insp-mode-edit")?.classList.toggle("on",  _edit);
    _renderBody();
  }

  /** Von außen aufrufen, wenn sich Daten geändert haben (Token, Roster …). */
  function refresh() {
    if (!_target) return;
    if (_target.kind === "char") {
      const r = (State.roster || {})[_target.id];
      if (r) { _target.sheet = r.character || _target.sheet; }
      _target.token = _tokenOfChar(_target.id);
    } else {
      const e = (State.enemies || {})[_target.enemyId];
      if (e) _target.sheet = e;
      if (_target.token) _target.token = (State.tokens || {})[_target.token.id] || _target.token;
    }
    _renderBody();
  }

  function _render() {
    if (!_target) return;
    const av = $("insp-avatar");
    if (av) {
      if (_target.pic) av.innerHTML = `<img src="${esc(_target.pic)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:7px">`;
      else av.textContent = _target.kind === "enemy" ? "🐉" : "🧙";
    }
    $("insp-name") && ($("insp-name").textContent = _target.name);
    $("insp-sub")  && ($("insp-sub").textContent  = _target.sub);
    setTab(_tab);
  }

  function _renderBody() {
    const body = $("insp-body");
    if (!body) return;
    if (!_target) {
      body.innerHTML = `<div class="insp-empty">Kein Charakter ausgewählt.</div>`;
      return;
    }
    body.innerHTML = _tab === "attacks"   ? _viewAttacks()
                   : _tab === "inventory" ? _viewInventory()
                   :                        _viewSheet();
  }

  // ── Werte zusammentragen ────────────────────────────────────────────────
  // Beim Spieler stehen die Kampfwerte im Bogen, beim Gegner am Token
  // (der Token trägt die aktuellen HP im Kampf).
  function _combat() {
    const s = _target.sheet || {};
    const t = _target.token;
    return {
      hp:    t ? t.hp     : s.hp,
      maxHp: t ? t.max_hp : s.max_hp,
      ac:    t ? t.ac     : s.ac,
      speed: (t ? t.speed : s.speed) || 30,
      conditions: t ? (t.conditions || []) : [],
      level: s.level || 1,
    };
  }

  // ── Reiter 1: Charakterbogen ────────────────────────────────────────────
  function _viewSheet() {
    const s = _target.sheet || {};
    const c = _combat();
    const stats = s.stats || {};
    const profs = s.skill_profs || [];
    const saveProfs = s.save_profs || [];
    const bonus = pb(c.level);
    const isEnemy = _target.kind === "enemy";

    const pct = Math.max(0, Math.min(100, (c.hp / Math.max(1, c.maxHp || 1)) * 100));
    const hpColor = pct > 50 ? "#4a8a5a" : pct > 25 ? "#e67e22" : "#c0392b";

    // ── HP-Block (im Bearbeiten-Modus mit Eingabefeldern) ────────────────
    const hpBlock = _edit ? `
      <div class="insp-hp">
        <div class="insp-edit-row">
          <div><label>Akt. HP</label>
            <input type="number" value="${c.hp ?? 0}" onchange="Inspector.setHp(this.value)"></div>
          <div><label>Max HP</label>
            <input type="number" value="${c.maxHp ?? 0}" onchange="Inspector.setMaxHp(this.value)"></div>
        </div>
        <div class="insp-hp-bar" style="margin-top:8px"><div class="insp-hp-fill" style="width:${pct}%;background:${hpColor}"></div></div>
        <div class="insp-quick">
          <button onclick="Inspector.damage()">💥 Schaden</button>
          <button onclick="Inspector.heal()">💚 Heilen</button>
        </div>
      </div>` : `
      <div class="insp-hp">
        <div class="insp-hp-readout" style="color:${hpColor}">${c.hp ?? "?"} <span style="opacity:.55">/</span> ${c.maxHp ?? "?"}</div>
        <div class="insp-hp-bar"><div class="insp-hp-fill" style="width:${pct}%;background:${hpColor}"></div></div>
        <div class="insp-hp-lbl">TREFFERPUNKTE</div>
        <div class="insp-quick">
          <button onclick="Inspector.damage()">💥 Schaden</button>
          <button onclick="Inspector.heal()">💚 Heilen</button>
        </div>
      </div>`;

    // ── Kampfwerte ───────────────────────────────────────────────────────
    const passivePerc = 10 + mod(stats.wis) + (profs.includes("Wahrnehmung") ? bonus : 0);
    const initMod = mod(stats.dex) + (s.initiative_bonus || 0);

    const combatRow = _edit ? `
      <div class="insp-edit-row3">
        <div><label>Rüstung</label>
          <input type="number" value="${c.ac ?? 10}" onchange="Inspector.setAc(this.value)"></div>
        <div><label>Bewegung</label>
          <input type="number" value="${c.speed}" onchange="Inspector.setSpeed(this.value)"></div>
        <div><label>Init-Bonus</label>
          <input type="number" value="${s.initiative_bonus || 0}" onchange="Inspector.setField('initiative_bonus', this.value)"></div>
      </div>` : `
      <div class="insp-row3">
        <div class="insp-mini"><div class="insp-mini-ic">🛡</div><div class="insp-mini-v">${c.ac ?? "?"}</div><div class="insp-mini-l">Rüstung</div></div>
        <div class="insp-mini"><div class="insp-mini-ic">⚡</div><div class="insp-mini-v">${fmtMod(initMod)}</div><div class="insp-mini-l">Initiative</div></div>
        <div class="insp-mini"><div class="insp-mini-ic">👣</div><div class="insp-mini-v">${c.speed}</div><div class="insp-mini-l">Bewegung</div></div>
      </div>
      <div class="insp-row3" style="margin-top:6px">
        <div class="insp-mini"><div class="insp-mini-ic">👁</div><div class="insp-mini-v">${passivePerc}</div><div class="insp-mini-l">Pass. Wahrn.</div></div>
        <div class="insp-mini"><div class="insp-mini-ic">✚</div><div class="insp-mini-v">${fmtMod(bonus)}</div><div class="insp-mini-l">Übung</div></div>
        <div class="insp-mini"><div class="insp-mini-ic">📊</div><div class="insp-mini-v">${c.level}</div><div class="insp-mini-l">${isEnemy ? "Stufe" : "Level"}</div></div>
      </div>`;

    // ── Zustände (der DM darf sie setzen) ────────────────────────────────
    const condBlock = `
      <div class="insp-sec-title">Zustände</div>
      <div class="insp-conds">
        ${Object.keys(CONDITIONS).map(k => `
          <button class="insp-cond ${c.conditions.includes(k)?"on":""}"
                  onclick="Inspector.toggleCondition('${k}')"
                  title="${COND_NAMES[k]}">
            <span>${CONDITIONS[k]}</span>
          </button>`).join("")}
      </div>
      ${!_target.token ? `<div class="insp-note">Kein Token auf der Karte – Zustände wirken erst, wenn die Figur platziert ist.</div>` : ""}`;

    // ── Attribute ────────────────────────────────────────────────────────
    const statCards = STATS.map(([k, lbl]) => {
      const val = stats[k] ?? 10;
      const m = mod(val);
      const saveMod = m + (saveProfs.includes(k) ? bonus : 0);
      if (_edit) {
        return `<div class="insp-stat">
          <div class="insp-stat-lbl">${lbl}</div>
          <input class="insp-stat-inp" type="number" value="${val}"
                 onchange="Inspector.setStat('${k}', this.value)">
          <div class="insp-stat-mod">${fmtMod(m)}</div>
          <button class="insp-save-btn ${saveProfs.includes(k)?"on":""}"
                  onclick="Inspector.toggleSaveProf('${k}')"
                  title="Rettungswurf geübt?">RW ${fmtMod(saveMod)}</button>
        </div>`;
      }
      return `<div class="insp-stat">
        <div class="insp-stat-lbl">${lbl}</div>
        <div class="insp-stat-val">${val}</div>
        <button class="insp-stat-mod-btn" onclick="Inspector.rollStat('${k}','${lbl}')"
                title="Attributswurf">${fmtMod(m)}</button>
        <button class="insp-save-btn ${saveProfs.includes(k)?"on":""}"
                onclick="Inspector.rollSave('${k}','${lbl}')" title="Rettungswurf">
          RW ${fmtMod(saveMod)}${saveProfs.includes(k) ? " ◉" : ""}
        </button>
      </div>`;
    }).join("");

    // ── Fertigkeiten (alle, wie beim Spieler) ────────────────────────────
    const skillRows = SKILLS.map(([name, stat]) => {
      const isProf = profs.includes(name);
      const total = mod(stats[stat]) + (isProf ? bonus : 0);
      return `<div class="insp-skill ${isProf?"prof":""}"
                   onclick="Inspector.${_edit ? `toggleSkillProf('${name.replace(/'/g,"\\'")}')` : `rollSkill('${name.replace(/'/g,"\\'")}','${stat}')`}"
                   title="${_edit ? "Übung an/aus" : "Würfeln"}">
        <span class="insp-skill-dot">${isProf ? "◉" : "○"}</span>
        <span class="insp-skill-name">${esc(name)}</span>
        <span class="insp-skill-stat">${stat.toUpperCase()}</span>
        <span class="insp-skill-mod">${fmtMod(total)}</span>
      </div>`;
    }).join("");

    // ── Gegner-Zusatz ────────────────────────────────────────────────────
    const extras = isEnemy ? `
      ${(s.senses || s.languages || s.resistances || _edit) ? `
        <div class="insp-sec-title">Sinne &amp; Eigenschaften</div>
        ${_edit ? `
          <div class="insp-edit-col">
            <label>Sinne</label>
            <input type="text" value="${esc(s.senses||"")}" onchange="Inspector.setField('senses', this.value)">
            <label>Sprachen</label>
            <input type="text" value="${esc(s.languages||"")}" onchange="Inspector.setField('languages', this.value)">
            <label>Resistenzen</label>
            <input type="text" value="${esc(s.resistances||"")}" onchange="Inspector.setField('resistances', this.value)">
          </div>` : `
          <div class="insp-kv">
            ${s.senses      ? `<div><span>👁 Sinne</span><b>${esc(s.senses)}</b></div>` : ""}
            ${s.languages   ? `<div><span>💬 Sprachen</span><b>${esc(s.languages)}</b></div>` : ""}
            ${s.resistances ? `<div><span>🛡 Resistenzen</span><b>${esc(s.resistances)}</b></div>` : ""}
          </div>`}` : ""}
      ${(s.traits && s.traits.length) ? `
        <div class="insp-sec-title">Besondere Fähigkeiten</div>
        <div class="insp-list">${s.traits.map(t => `
          <div class="insp-item">
            <div class="insp-item-head"><span class="insp-item-name">✦ ${esc(t.name || "Fähigkeit")}</span></div>
            ${t.desc ? `<div class="insp-item-note">${esc(t.desc)}</div>` : ""}
          </div>`).join("")}</div>` : ""}
      ${s.notes ? `
        <div class="insp-sec-title">DM-Notizen</div>
        <div class="insp-text">${esc(s.notes)}</div>` : ""}
    ` : "";

    // ── Spieler-Zusatz: Ressourcen, Zauberplätze, Persönlichkeit ─────────
    const res = s.custom_resources || [];
    const slots = s.spell_slots || {};
    const hasSlots = Object.values(slots).some(v => v && (v.max || v.total));

    const playerExtras = !isEnemy ? `
      ${res.length ? `
        <div class="insp-sec-title">Ressourcen</div>
        <div class="insp-chips">
          ${res.map(r => `<span class="insp-chip">${esc(r.name)}: ${(r.max||0)-(r.used||0)}/${r.max||0}</span>`).join("")}
        </div>` : ""}
      ${hasSlots ? `
        <div class="insp-sec-title">Zauberplätze</div>
        <div class="insp-chips">
          ${Object.entries(slots).filter(([,v]) => v && (v.max||v.total)).map(([lvl, v]) => {
            const max = v.max || v.total || 0;
            const used = v.used || 0;
            return `<span class="insp-chip">Grad ${lvl}: ${max-used}/${max}</span>`;
          }).join("")}
        </div>` : ""}
      ${(s.personality || s.ideals || s.bonds || s.flaws) ? `
        <div class="insp-sec-title">Persönlichkeit</div>
        <div class="insp-kv">
          ${s.personality ? `<div><span>Wesenszüge</span><b>${esc(s.personality)}</b></div>` : ""}
          ${s.ideals      ? `<div><span>Ideale</span><b>${esc(s.ideals)}</b></div>` : ""}
          ${s.bonds       ? `<div><span>Bindungen</span><b>${esc(s.bonds)}</b></div>` : ""}
          ${s.flaws       ? `<div><span>Makel</span><b>${esc(s.flaws)}</b></div>` : ""}
        </div>` : ""}
    ` : "";

    return `
      ${hpBlock}
      <div style="margin-top:9px">${combatRow}</div>
      ${condBlock}

      <div class="insp-sec-title">Attribute &amp; Rettungswürfe</div>
      <div class="insp-stats">${statCards}</div>

      <div class="insp-sec-title">
        Fertigkeiten
        <span style="float:right;color:var(--text-dim);font-size:.6rem;text-transform:none;letter-spacing:0">
          ${_edit ? "klicken = Übung an/aus" : "klicken zum Würfeln"}
        </span>
      </div>
      <div class="insp-skills">${skillRows}</div>

      ${extras}
      ${playerExtras}

      ${s.backstory ? `
        <div class="insp-sec-title">Hintergrund</div>
        <div class="insp-text">${esc(s.backstory)}</div>` : ""}
    `;
  }

  // ── Reiter 2: Angriffe ──────────────────────────────────────────────────
  function _viewAttacks() {
    const s = _target.sheet || {};
    const atks = s.attacks || [];

    if (_edit) {
      return `
        <div class="insp-list">
          ${atks.length ? atks.map((a, i) => `
            <div class="insp-item">
              <div class="insp-edit-attack">
                <input type="text" placeholder="Name" value="${esc(a.name||"")}"
                       onchange="Inspector.editAttack(${i},'name',this.value)" style="flex:2">
                <input type="number" placeholder="Bonus" value="${a.hit_bonus ?? 0}"
                       onchange="Inspector.editAttack(${i},'hit_bonus',parseInt(this.value)||0)"
                       style="width:58px" title="Trefferbonus">
                <button class="insp-del" onclick="Inspector.removeAttack(${i})" title="Entfernen">✕</button>
              </div>
              <div class="insp-edit-attack" style="margin-top:5px">
                <input type="text" placeholder="Schaden (1d8+3)" value="${esc(a.damage||"")}"
                       onchange="Inspector.editAttack(${i},'damage',this.value)" style="flex:2">
                <input type="text" placeholder="Typ" value="${esc(a.damage_type||"")}"
                       onchange="Inspector.editAttack(${i},'damage_type',this.value)" style="flex:1">
                <input type="text" placeholder="Reichw." value="${esc(a.range||"")}"
                       onchange="Inspector.editAttack(${i},'range',this.value)" style="flex:1">
              </div>
              <div class="insp-edit-attack" style="margin-top:5px">
                <select onchange="Inspector.editAttack(${i},'effect',this.value)" style="flex:2">
                  <option value="">— kein Effekt —</option>
                  ${Object.keys(CONDITIONS).map(k => `
                    <option value="${k}" ${a.effect===k?"selected":""}>${CONDITIONS[k]} ${COND_NAMES[k]}</option>`).join("")}
                </select>
                <select onchange="Inspector.editAttack(${i},'effect_dur',this.value)" style="flex:2">
                  <option value="">Dauer …</option>
                  <option value="until_my_next_turn_end"     ${a.effect_dur==="until_my_next_turn_end"?"selected":""}>bis Ende meines nächsten Zuges</option>
                  <option value="until_target_next_turn_end" ${a.effect_dur==="until_target_next_turn_end"?"selected":""}>bis Ende des Zuges des Ziels</option>
                  <option value="rounds:1"  ${a.effect_dur==="rounds:1"?"selected":""}>1 Runde</option>
                  <option value="rounds:3"  ${a.effect_dur==="rounds:3"?"selected":""}>3 Runden</option>
                  <option value="rounds:10" ${a.effect_dur==="rounds:10"?"selected":""}>10 Runden</option>
                  <option value="permanent" ${a.effect_dur==="permanent"?"selected":""}>bis er entfernt wird</option>
                </select>
              </div>
            </div>`).join("")
          : `<div class="insp-empty">Noch keine Angriffe.</div>`}
        </div>
        <button class="insp-add" onclick="Inspector.addAttack()">+ Angriff hinzufügen</button>
      `;
    }

    if (!atks.length) {
      return `<div class="insp-empty">Keine Angriffe eingetragen.</div>`;
    }
    return `<div class="insp-list">` + atks.map((a, i) => `
      <div class="insp-item">
        <div class="insp-item-head">
          <span class="insp-item-name">🗡️ ${esc(a.name || "Angriff")}</span>
          ${a.hit_bonus != null ? `<span class="insp-badge">${fmtMod(Number(a.hit_bonus))} Treffer</span>` : ""}
        </div>
        <div class="insp-item-sub">
          ${a.damage ? `Schaden: <b>${esc(a.damage)}</b>` : ""}
          ${a.damage_type ? ` · ${esc(a.damage_type)}` : ""}
          ${a.range ? ` · Reichweite ${esc(a.range)}` : ""}
        </div>
        ${a.effect ? `<div class="insp-item-note">
          ✨ Bei Treffer: <b>${CONDITIONS[a.effect]||""} ${COND_NAMES[a.effect]||a.effect}</b>
          ${a.effect_dur ? ` (${_durText(a.effect_dur)})` : ""}
        </div>` : ""}
        ${a.note ? `<div class="insp-item-note">${esc(a.note)}</div>` : ""}
        <div class="insp-item-actions">
          <button onclick="Inspector.rollAttack(${i})">🎲 Angriff</button>
          ${a.damage ? `<button onclick="Inspector.rollDamage(${i})">💥 Schaden</button>` : ""}
        </div>
      </div>`).join("") + `</div>`;
  }

  function _durText(d) {
    if (d === "until_my_next_turn_end")     return "bis Ende des nächsten Zuges";
    if (d === "until_target_next_turn_end") return "bis Ende des Zuges des Ziels";
    if (d === "permanent")                  return "dauerhaft";
    if (d && d.startsWith("rounds:")) {
      const n = d.split(":")[1];
      return `${n} Runde${n !== "1" ? "n" : ""}`;
    }
    return d || "";
  }

  // ── Reiter 3: Inventar ──────────────────────────────────────────────────
  function _viewInventory() {
    const s = _target.sheet || {};
    const inv = s.inventory || [];
    const money = s.money || {};

    if (_edit) {
      return `
        <div class="insp-sec-title">Geld</div>
        <div class="insp-money-edit">
          ${[["pp","PP"],["gp","GM"],["ep","EM"],["sp","SM"],["cp","KM"]].map(([k,lbl]) => `
            <div>
              <label>${lbl}</label>
              <input type="number" min="0" value="${money[k] || 0}"
                     onchange="Inspector.setMoney('${k}', this.value)">
            </div>`).join("")}
        </div>

        <div class="insp-sec-title">Gegenstände</div>
        <div class="insp-list">
          ${inv.length ? inv.map((it, i) => `
            <div class="insp-item">
              <div class="insp-edit-attack">
                <input type="text" placeholder="Gegenstand" value="${esc(it.name||"")}"
                       onchange="Inspector.editItem(${i},'name',this.value)" style="flex:2">
                <input type="number" min="1" value="${it.qty || 1}"
                       onchange="Inspector.editItem(${i},'qty',parseInt(this.value)||1)"
                       style="width:54px" title="Anzahl">
                <button class="insp-del" onclick="Inspector.removeItem(${i})" title="Entfernen">✕</button>
              </div>
              <input type="text" placeholder="Notiz (z. B. Wirkung)" value="${esc(it.note||"")}"
                     onchange="Inspector.editItem(${i},'note',this.value)"
                     style="width:100%;margin-top:5px">
            </div>`).join("")
          : `<div class="insp-empty">Noch keine Gegenstände.</div>`}
        </div>
        <button class="insp-add" onclick="Inspector.addItem()">+ Gegenstand hinzufügen</button>

        <div class="insp-sec-title">Ausrüstung (Freitext)</div>
        <textarea class="insp-textarea" rows="4"
                  onchange="Inspector.setField('equipment', this.value)"
                  placeholder="Rüstung, Waffen …">${esc(s.equipment||"")}</textarea>
      `;
    }

    const coins = [["pp","PP"],["gp","GM"],["ep","EM"],["sp","SM"],["cp","KM"]]
      .filter(([k]) => money[k])
      .map(([k, lbl]) => `<span class="insp-chip">${money[k]} ${lbl}</span>`).join("");

    const equip = s.equipment ? `
      <div class="insp-sec-title">Ausrüstung (Text)</div>
      <div class="insp-text">${esc(s.equipment)}</div>` : "";

    if (!inv.length && !coins && !equip) {
      return `<div class="insp-empty">Das Inventar ist leer.</div>`;
    }

    return `
      ${coins ? `<div class="insp-sec-title">Geld</div><div class="insp-chips">${coins}</div>` : ""}
      ${inv.length ? `
        <div class="insp-sec-title">Gegenstände</div>
        <div class="insp-list">` + inv.map(it => `
          <div class="insp-item">
            <div class="insp-item-head">
              <span class="insp-item-name">${esc(it.name || "Gegenstand")}</span>
              ${it.qty && it.qty > 1 ? `<span class="insp-badge">×${it.qty}</span>` : ""}
            </div>
            ${it.note ? `<div class="insp-item-note">${esc(it.note)}</div>` : ""}
          </div>`).join("") + `</div>` : ""}
      ${equip}
    `;
  }

  // ── Änderungen (Bearbeiten-Modus) ───────────────────────────────────────

  /** Token-Werte ändern (HP, RK, Bewegung, Zustände). */
  function _updateToken(updates) {
    const t = _target && _target.token;
    if (!t) { UI.toast("Kein Token auf der Karte"); return; }
    Socket.emit("token_update", {
      session_id: State.session_id, token_id: t.id, updates,
    });
    Object.assign(t, updates);
    _renderBody();
  }

  /** Bogen-Werte ändern (Attribute, Fertigkeiten …). */
  function _updateSheet(updates) {
    if (!_target) return;
    if (_target.kind === "enemy") {
      Socket.emit("enemy_update", {
        session_id: State.session_id,
        enemy_id: _target.enemyId,
        updates,
      });
      Object.assign(_target.sheet, updates);
    } else {
      // Spieler-Charakter: der DM ändert den gespeicherten Bogen
      Socket.emit("roster_sheet_update", {
        session_id: State.session_id,
        char_id: _target.id,
        updates,
      });
      Object.assign(_target.sheet, updates);
    }
    _renderBody();
  }

  function setHp(v)    { _updateToken({ hp: parseInt(v) || 0 }); }
  function setMaxHp(v) { _updateToken({ max_hp: parseInt(v) || 1 }); }
  function setAc(v)    { _updateToken({ ac: parseInt(v) || 10 }); }
  function setSpeed(v) { _updateToken({ speed: parseInt(v) || 30 }); }

  function setStat(key, v) {
    const stats = Object.assign({}, _target.sheet.stats || {});
    stats[key] = parseInt(v) || 10;
    _updateSheet({ stats });
  }
  function setField(key, v) {
    const val = (key === "initiative_bonus") ? (parseInt(v) || 0) : v;
    _updateSheet({ [key]: val });
  }
  function toggleSaveProf(key) {
    const cur = [...(_target.sheet.save_profs || [])];
    const i = cur.indexOf(key);
    if (i > -1) cur.splice(i, 1); else cur.push(key);
    _updateSheet({ save_profs: cur });
  }
  function toggleSkillProf(name) {
    const cur = [...(_target.sheet.skill_profs || [])];
    const i = cur.indexOf(name);
    if (i > -1) cur.splice(i, 1); else cur.push(name);
    _updateSheet({ skill_profs: cur });
  }
  function toggleCondition(key) {
    const t = _target && _target.token;
    if (!t) { UI.toast("Kein Token auf der Karte"); return; }
    const cur = [...(t.conditions || [])];
    const i = cur.indexOf(key);
    if (i > -1) cur.splice(i, 1); else cur.push(key);
    _updateToken({ conditions: cur });
  }

  // ── Angriffe bearbeiten ─────────────────────────────────────────────────
  function addAttack() {
    const atks = [...(_target.sheet.attacks || [])];
    atks.push({
      id: Date.now().toString(36),
      name: "Neuer Angriff", hit_bonus: 0,
      damage: "1d6", damage_type: "Hieb", range: "",
      effect: "", effect_dur: "",
    });
    _updateSheet({ attacks: atks });
  }
  function editAttack(i, field, value) {
    const atks = (_target.sheet.attacks || []).map(a => ({ ...a }));
    if (!atks[i]) return;
    atks[i][field] = value;
    _updateSheet({ attacks: atks });
  }
  async function removeAttack(i) {
    const a = (_target.sheet.attacks || [])[i];
    if (!await Dialog.confirmDanger(`„${a ? a.name : "Angriff"}“ wird entfernt.`,
        { title:"Angriff entfernen?", icon:"🗡️", okText:"Entfernen" })) return;
    const atks = [...(_target.sheet.attacks || [])];
    atks.splice(i, 1);
    _updateSheet({ attacks: atks });
  }

  // ── Inventar bearbeiten ─────────────────────────────────────────────────
  function addItem() {
    const inv = [...(_target.sheet.inventory || [])];
    inv.push({ name: "Neuer Gegenstand", qty: 1, note: "" });
    _updateSheet({ inventory: inv });
  }
  function editItem(i, field, value) {
    const inv = (_target.sheet.inventory || []).map(x => ({ ...x }));
    if (!inv[i]) return;
    inv[i][field] = value;
    _updateSheet({ inventory: inv });
  }
  async function removeItem(i) {
    const it = (_target.sheet.inventory || [])[i];
    if (!await Dialog.confirmDanger(`„${it ? it.name : "Gegenstand"}“ wird entfernt.`,
        { title:"Gegenstand entfernen?", icon:"🎒", okText:"Entfernen" })) return;
    const inv = [...(_target.sheet.inventory || [])];
    inv.splice(i, 1);
    _updateSheet({ inventory: inv });
  }
  function setMoney(key, value) {
    const money = Object.assign({}, _target.sheet.money || {});
    money[key] = Math.max(0, parseInt(value) || 0);
    _updateSheet({ money });
  }

  async function damage() {
    const c = _combat();
    const n = await Dialog.promptNumber(
      `Wie viel Schaden erleidet ${_target.name}?`, 5,
      { title:"Schaden zufügen", icon:"💥", okText:"Zufügen" });
    if (n === null) return;
    _updateToken({ hp: Math.max(0, (c.hp || 0) - n) });
    UI.toast(`💥 ${_target.name}: -${n} HP`);
  }
  async function heal() {
    const c = _combat();
    const n = await Dialog.promptNumber(
      `Wie viel wird ${_target.name} geheilt?`, 5,
      { title:"Heilen", icon:"💚", okText:"Heilen" });
    if (n === null) return;
    _updateToken({ hp: Math.min(c.maxHp || 999, (c.hp || 0) + n) });
    UI.toast(`💚 ${_target.name}: +${n} HP`);
  }

  // ── Würfeln (der DM kann für die Figur würfeln) ──────────────────────────
  function _roll(formula, label) {
    Socket.emit("dice_roll", {
      session_id: State.session_id, formula,
      roller: _target.name, author: State.username,
      role: State.role, color: State.my_color,
      label, secret: false,
    });
    if (window.Tabs) Tabs.switchTo("chat");
  }
  function rollStat(key, lbl) {
    const m = mod((_target.sheet.stats || {})[key]);
    _roll(`1d20${m>=0?"+"+m:m}`, `${_target.name}: ${lbl}`);
  }
  function rollSave(key, lbl) {
    const s = _target.sheet || {};
    const c = _combat();
    const m = mod((s.stats || {})[key]) +
              ((s.save_profs || []).includes(key) ? pb(c.level) : 0);
    _roll(`1d20${m>=0?"+"+m:m}`, `${_target.name}: ${lbl}-Rettungswurf`);
  }
  function rollSkill(name, stat) {
    const s = _target.sheet || {};
    const c = _combat();
    const m = mod((s.stats || {})[stat]) +
              ((s.skill_profs || []).includes(name) ? pb(c.level) : 0);
    _roll(`1d20${m>=0?"+"+m:m}`, `${_target.name}: ${name}`);
  }
  function rollAttack(i) {
    const a = (_target.sheet.attacks || [])[i];
    if (!a) return;
    const b = Number(a.hit_bonus) || 0;
    _roll(`1d20${b>=0?"+"+b:b}`, `${_target.name}: ${a.name} (Angriff)`);
  }
  function rollDamage(i) {
    const a = (_target.sheet.attacks || [])[i];
    if (!a || !a.damage) return;
    _roll(String(a.damage), `${_target.name}: ${a.name} (Schaden)`);
  }

  return {
    openChar, openEnemy, close, setTab, setMode, refresh,
    setHp, setMaxHp, setAc, setSpeed,
    setStat, setField, toggleSaveProf, toggleSkillProf, toggleCondition,
    addAttack, editAttack, removeAttack,
    addItem, editItem, removeItem, setMoney,
    damage, heal,
    rollStat, rollSave, rollSkill, rollAttack, rollDamage,
    get target() { return _target; },
  };
})();

// Kurznamen fürs Template
function closeInspector()       { Inspector.close(); }
function setInspectorTab(tab)   { Inspector.setTab(tab); }
function setInspectorMode(edit) { Inspector.setMode(edit); }
function inspectChar(charId)    { Inspector.openChar(charId); }
function inspectEnemy(tokenId)  { Inspector.openEnemy(tokenId); }

// Der Inspektor soll immer den aktuellen Stand zeigen: Ändert jemand einen
// Token (HP, Zustände) oder den Roster, frischen wir die Anzeige auf.
["tokens_changed", "roster_changed", "enemies_changed"].forEach(evt => {
  document.addEventListener("dnd:" + evt, () => {
    if (Inspector.target) Inspector.refresh();
  });
});
