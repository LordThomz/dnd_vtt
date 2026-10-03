/**
 * tokens.js – Token rendering + drag (Pointer Events API)
 *
 * INTERACTION:
 *   - Left OR right pointer on token = drag (if owner or GM)
 *   - Double-click                    = open edit modal
 *   - Right-click on EMPTY map        = pan (handled by map.js)
 *
 * Tokens use pointerdown with stopPropagation so map's pan doesn't trigger.
 * Pointer capture ensures drag works even if cursor leaves the token.
 */
const Tokens = (() => {
  let layer=null;
  let dragging=null;
  let dragMoved=false;

  const CONDITIONS={
    blinded:"🙈",charmed:"💕",deafened:"🔇",exhausted:"😴",frightened:"😱",
    grappled:"🤝",incapacitated:"💤",invisible:"👻",paralyzed:"⚡",petrified:"🗿",
    poisoned:"🤢",prone:"⬇️",restrained:"⛓",stunned:"💫",unconscious:"💔",dead:"☠️",
  };

  function dbg(...args){ if(window.DEBUG_TOKENS) console.log("[TOK]", ...args); }

  function init() {
    layer=document.getElementById("tokens-layer");
    layer.style.pointerEvents = "none";
    document.addEventListener("dnd:tokens_changed", render);
    document.addEventListener("dnd:full_state",     render);

    // SAFETY NET: global pointerup to ensure drag always ends
    window.addEventListener("pointerup", e=>{
      if (!dragging) return;
      if (e.pointerId !== dragging.pointerId) return;
      dbg("safety net pointerup");
      if (dragMoved){
        const t = State.tokens[dragging.tokenId];
        if (t) Socket.emit("token_move",{session_id:State.session_id,token_id:t.id,x:t.x,y:t.y});
      }
      const el = document.querySelector(`[data-token-id="${dragging.tokenId}"]`);
      if (el) el.style.cursor = "grab";
      dragging = null;
      dragMoved = false;
    });

    dbg("initialized");
  }

  function render() {
    if(!layer) return;
    layer.innerHTML="";
    const all = State.getActiveMapTokens();
    const visible = all.filter(t => _isVisibleToMe(t));
    visible.forEach(t=>buildEl(t));
    dbg("rendered", visible.length, "of", all.length, "tokens");
  }

  // Entscheidet, ob ein Token für den aktuellen Betrachter sichtbar ist.
  // DM sieht alles. Spieler sehen nur ihren EIGENEN Token immer – alle
  // anderen Tokens (Mitspieler wie Gegner) nur, wenn sie im eigenen
  // Sichtradius liegen ODER von einer Lichtquelle beleuchtet werden.
  function _isVisibleToMe(t) {
    if (State.isGM) return true;
    // Eigener Token / eigener Charakter immer sichtbar
    if (t.owner === State.my_socket_id || (t.owner_char_id && t.owner_char_id === State.my_char_id)) return true;
    // Alle übrigen Tokens: nur wenn beleuchtet oder im eigenen Sichtradius
    const gs = State.map.grid_size;
    const tcx = t.x + t.size/2, tcy = t.y + t.size/2;
    // 1) Im eigenen Sichtradius?
    const myToken = State.getMyToken();
    // Ohne eigenen Token auf dieser Karte gibt es keinen Blickpunkt –
    // dann bleibt alles sichtbar (sonst säße man im Blindflug).
    if (!myToken) return true;
    if (myToken) {
      const visFt = State.effectiveVisionFt(myToken);
      if (visFt > 0) {
        const vr = (visFt/5)*gs;
        const dx = tcx - (myToken.x+myToken.size/2), dy = tcy - (myToken.y+myToken.size/2);
        if (dx*dx + dy*dy <= vr*vr) return true;
      }
    }
    // 2) In einer aktiven Lichtquelle (hell oder dämmrig)?
    for (const src of Object.values(State.tokens||{})) {
      if (src.map_id && src.map_id !== State.active_map_id) continue;
      const rFt = Math.max(src.light_bright||0, src.light_dim||0);
      if (rFt <= 0) continue;
      const r = (rFt/5)*gs;
      const dx = tcx - (src.x+src.size/2), dy = tcy - (src.y+src.size/2);
      if (dx*dx + dy*dy <= r*r) return true;
    }
    return false;
  }

  // Stellt die anzuzeigenden Balken zusammen: immer HP zuerst (aus hp/max_hp),
  // danach bis zu 2 frei konfigurierte Zusatzbalken aus t.bars.
  function _collectBars(t) {
    const bars = [];
    if (t.max_hp > 0) {
      bars.push({ label:"TP", cur:t.hp||0, max:t.max_hp, color:null, show_to_players:t.show_hp_to_players });
    }
    if (Array.isArray(t.bars)) {
      t.bars.slice(0, 2).forEach(b => {
        if (b && (b.max||0) > 0) {
          bars.push({
            label: b.label || "",
            cur: b.cur||0, max: b.max,
            color: b.color || "#4a7fa5",
            show_to_players: b.show_to_players,
          });
        }
      });
    }
    return bars;
  }

  function buildEl(t) {
    const el=document.createElement("div");
    el.className="token"+(t.id===State.selectedTokenId?" selected":"")+(t.is_enemy?" enemy-token":"");
    if(t.conditions?.includes("dead")) el.classList.add("dead-token");
    el.dataset.tokenId=t.id;
    el.style.cssText=`left:${t.x}px;top:${t.y}px;width:${t.size}px;height:${t.size}px`;
    const bc=_borderColor(t); el.style.borderColor=bc;

    if(t.url){
      const img=document.createElement("img");
      img.src=t.url; img.alt=t.name; img.draggable=false;
      el.appendChild(img);
    } else {
      el.style.background=t.is_enemy?"linear-gradient(135deg,#2a0a0a,#1a0808)":"linear-gradient(135deg,#1e1530,#130f1e)";
      const s=document.createElement("span");s.className="token-letter";
      s.style.cssText=`font-size:${Math.max(14,t.size*0.38)}px;color:${bc}`;
      s.textContent=(t.name||"?")[0].toUpperCase();el.appendChild(s);
    }

    // ── Statusbalken (bis zu 3) ──────────────────────────────────────────
    // Standard: HP-Balken aus hp/max_hp. Zusätzlich frei konfigurierbare
    // Balken über t.bars = [{label,cur,max,color,show_to_players}].
    const bars = _collectBars(t);
    if (bars.length) {
      // Sichtbarkeit der Balken:
      // - DM sieht immer alles
      // - Für alle anderen entscheidet allein der DM-Schalter
      //   "HP für Spieler sichtbar" – auch beim eigenen Token. Schaltet der
      //   DM die Leiste aus, sieht sie NIEMAND außer ihm.
      const shouldShow = State.isGM || (t.show_hp_to_players === true);
      if (shouldShow) {
        const barsWrap = document.createElement("div");
        barsWrap.className = "token-bars";
        bars.forEach(b => {
          // Ein einzelner Zusatzbalken darf für Spieler verborgen sein.
          if (!State.isGM && b.show_to_players === false) return;
          const pct = Math.max(0, Math.min(100, (b.cur / Math.max(1, b.max)) * 100));
          const bar = document.createElement("div");
          bar.className = "token-bar";
          const fill = document.createElement("div");
          fill.className = "token-bar-fill";
          fill.style.width = pct + "%";
          fill.style.background = b.color || (pct>50?"#4a8a5a":pct>25?"#e67e22":"#c0392b");
          bar.appendChild(fill);
          if (b.label) { bar.title = `${b.label}: ${b.cur}/${b.max}`; }
          barsWrap.appendChild(bar);
        });
        if (barsWrap.children.length) el.appendChild(barsWrap);
      }
    }

    const lbl=document.createElement("div");lbl.className="token-label";lbl.textContent=t.name||"?";el.appendChild(lbl);

    if(t.conditions?.length){
      const cv=document.createElement("div");cv.className="token-conds";
      t.conditions.forEach(c=>{
        const s=document.createElement("span");s.className="cond-pip";
        s.textContent=CONDITIONS[c]||"⚡";
        s.title=c;
        if(c==="dead") s.classList.add("cond-dead");
        cv.appendChild(s);
      });
      el.appendChild(cv);
    }

    if(t.conditions?.includes("dead")){
      const x=document.createElement("div");x.className="token-dead-overlay";
      x.textContent="✕";
      el.appendChild(x);
    }

    if(t.vision_range && (State.isGM || t.owner===State.my_socket_id || t.owner_char_id===State.my_char_id)){
      const vr=(t.vision_range/5)*State.map.grid_size;
      const ring=document.createElement("div");
      ring.style.cssText=`position:absolute;width:${vr*2}px;height:${vr*2}px;border-radius:50%;`+
        `border:1px dashed rgba(201,169,110,0.22);top:${t.size/2-vr}px;left:${t.size/2-vr}px;pointer-events:none;`;
      el.appendChild(ring);
    }

    const canDrag = State.isGM
      || t.owner===State.my_socket_id
      || (State.my_char_id && t.owner_char_id===State.my_char_id);

    // Force pointer events on this element (overriding layer's none)
    el.style.pointerEvents = "all";
    el.style.touchAction = "none";
    el.style.cursor = canDrag ? "grab" : "default";

    // CONTEXT MENU blocked on token to prevent browser menu on right-drag
    el.addEventListener("contextmenu", e=>{ e.preventDefault(); e.stopPropagation(); });

    // POINTER DOWN — left or right
    el.addEventListener("pointerdown", e=>{
      dbg("token pointerdown", t.name, {button:e.button, canDrag});
      if (!canDrag) return;
      if (e.button !== 0 && e.button !== 2) return;

      // If left-click with a drawing tool active, let the tool handle instead
      if (e.button === 0 && ["measure","draw","fog-add","fog-remove","ping"].includes(State.activeTool||"")){
        return;
      }

      e.stopPropagation();
      e.preventDefault();
      State.selectedTokenId = t.id;

      const mapArea = document.getElementById("map-area");
      const rect = mapArea.getBoundingClientRect();
      const scale = State.viewport.scale;
      dragging = {
        tokenId: t.id,
        pointerId: e.pointerId,
        button: e.button,
        startX: e.clientX,
        startY: e.clientY,
        tokenStartX: t.x,
        tokenStartY: t.y,
        offsetX: e.clientX - (t.x*scale + State.viewport.x + rect.left),
        offsetY: e.clientY - (t.y*scale + State.viewport.y + rect.top),
      };
      dragMoved = false;
      el.style.cursor = "grabbing";

      // Capture pointer so we get move/up even off the token
      try { el.setPointerCapture(e.pointerId); } catch(err){ dbg("capture failed", err); }
    });

    el.addEventListener("pointermove", e=>{
      if (!dragging || dragging.tokenId !== t.id) return;
      const t2 = State.tokens[dragging.tokenId]; if (!t2) return;
      const mapArea = document.getElementById("map-area");
      const rect = mapArea.getBoundingClientRect();
      const scale = State.viewport.scale;
      const gs = State.map.grid_size;
      const rawX = (e.clientX - dragging.offsetX - rect.left - State.viewport.x) / scale;
      const rawY = (e.clientY - dragging.offsetY - rect.top  - State.viewport.y) / scale;
      t2.x = Math.round(rawX/gs) * gs;
      t2.y = Math.round(rawY/gs) * gs;
      dragMoved = true;
      el.style.left = t2.x + "px";
      el.style.top  = t2.y + "px";
      const myToken = State.getMyToken();
      if (myToken && myToken.id === t2.id) MapModule.drawVision();
    });

    el.addEventListener("pointerup", e=>{
      if (!dragging || dragging.tokenId !== t.id) return;
      dbg("token pointerup", t.name, {moved:dragMoved});
      if (dragMoved){
        const t2 = State.tokens[dragging.tokenId];
        if (t2) Socket.emit("token_move",{session_id:State.session_id,token_id:t2.id,x:t2.x,y:t2.y});
      }
      try { el.releasePointerCapture(dragging.pointerId); } catch(err){}
      el.style.cursor = canDrag ? "grab" : "default";
      dragging = null;
      dragMoved = false;
    });

    el.addEventListener("pointercancel", e=>{
      if (!dragging) return;
      try { el.releasePointerCapture(dragging.pointerId); } catch(err){}
      el.style.cursor = canDrag ? "grab" : "default";
      dragging = null; dragMoved = false;
    });

    el.addEventListener("dblclick", e=>{ e.stopPropagation(); Modals.openToken(t.id); });

    layer.appendChild(el);
  }

  function _borderColor(t){
    if(t.conditions?.includes("dead"))        return "#c0392b";
    if(t.conditions?.includes("unconscious")) return "#888";
    if(t.is_enemy) return "#e87070";
    return "#c9a96e";
  }

  return {init,render,CONDITIONS,isVisibleToMe:_isVisibleToMe};
})();
