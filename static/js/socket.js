/** socket.js – connection + event dispatching */
const Socket = (() => {
  let _io=null;
  let _heartbeat=null;

  function init() {
    _io=io();
    _io.on("connect",()=>{
      State.my_socket_id=_io.id;
      _io.emit("join",{
        session_id:State.session_id, username:State.username,
        role:State.role, color:State.my_color,
        char_id:State.my_char_id||"",
        account_username:State.account_username||State.username,
      });
      UI.toast("🔗 Verbunden!");

      // Regelmäßiges Lebenszeichen. Ohne das würde die Sitzung als verwaist
      // gelten, sobald der DM eine Weile nur zuschaut – und die Spieler
      // bekämen "DM hat die Sitzung verlassen" zu sehen.
      clearInterval(_heartbeat);
      _heartbeat = setInterval(() => {
        if (_io && _io.connected) {
          _io.emit("heartbeat", { session_id: State.session_id });
        }
      }, 25000);   // alle 25 s – deutlich unter den 90 s Kulanzzeit
    });

    _io.on("disconnect", () => {
      clearInterval(_heartbeat);
      _heartbeat = null;
    });
    _io.on("full_state",s=>{
      State.tokens=s.tokens||{}; State.fog=new Set(active_map_fog(s));
      State.initiative=s.initiative||[]; State.current_turn_index=s.current_turn_index||0;
      State.chat=s.chat||[]; State.handouts=s.handouts||[];
      State.enemies=s.enemies||{}; State.enemy_folders=s.enemy_folders||[];
      State.drawing_strokes=s.drawing_strokes||[];
      State.roster=s.roster||{};
      State.journal=s.journal||[];
      State.notes=s.notes||[];
      State.settings=s.settings||{drawing_allowed:true};
      State.maps=s.maps||{}; State.active_map_id=s.active_map_id||"";
      State.map_folders=s.map_folders||[];
      State.owner=s.owner||""; State.invited_users=s.invited_users||[];
      State.visibility=s.visibility||"private";
      const m=s.maps?.[s.active_map_id]||{};
      Object.assign(State.map,m);
      // Find my user entry to confirm socket_id and char_id
      const me=(s.users||[]).find(u=>u.socket_id===State.my_socket_id);
      if(me) State.my_char_id = me.char_id || State.my_char_id;
      dispatch("full_state");
    });
    _io.on("map_updated",    d=>{
      // server also sends map_id – only reload if it's the active map
      if(!d.map_id || d.map_id===State.active_map_id){
        State.map.url=d.url; dispatch("map_updated");
      }
    });
    _io.on("map_image_changed", d=>{
      if(State.maps[d.map_id]) State.maps[d.map_id].url=d.url;
      if(d.is_active){ State.map.url=d.url; dispatch("map_updated"); }
      dispatch("maps_list_changed");
    });
    _io.on("map_previewed", d=>{
      // DM-Vorschau: Karte lokal anzeigen, OHNE die aktive Karte der Session
      // zu ändern. State.viewing_map_id merkt sich, was der DM gerade ansieht.
      State.viewing_map_id = d.map_id;
      State.active_map_id = d.active_map_id;   // bleibt die echte aktive Karte
      State.map = Object.assign({}, d.map || {});
      State.map.walls = (d.map && d.map.walls) || [];
      State.fog = new Set(d.map?.fog_cells||[]);
      if(d.tokens) State.tokens = d.tokens;
      dispatch("map_switched"); dispatch("fog_changed"); dispatch("maps_list_changed");
      dispatch("tokens_changed");
    });
    _io.on("map_switched",   d=>{
      State.active_map_id=d.active_map_id;
      State.viewing_map_id=d.active_map_id;   // beim Aktivieren schaut auch der DM darauf
      // Kartenspezifische Felder komplett ersetzen (nicht nur mergen),
      // damit Wände/Türen/Fenster/Fog der alten Karte nicht hängen bleiben.
      State.map = Object.assign({}, d.map || {});
      State.map.walls = (d.map && d.map.walls) || [];
      State.fog=new Set(d.map?.fog_cells||[]);
      if(d.tokens) State.tokens = d.tokens;   // aktuelle Tokens der Karte übernehmen
      dispatch("map_switched"); dispatch("fog_changed"); dispatch("maps_list_changed");
      dispatch("tokens_changed");
      if(typeof Jukebox!=="undefined") Jukebox.fireTrigger("map_change");
      if(typeof Weather!=="undefined"){ Weather.resize(); Weather.set(d.map?.weather||"none"); }
    });
    _io.on("map_settings_updated",m=>{Object.assign(State.map,m);dispatch("map_settings");});
    _io.on("exploration_reset", d=>{
      if(MapModule.clearExplored) MapModule.clearExplored(d && d.map_id);
      if(!State.isGM) UI.toast("🔄 Die Karte ist neu zu erkunden");
    });
    _io.on("walls_updated", d=>{
      if(State.maps[d.map_id]) State.maps[d.map_id].walls = d.walls;
      if(d.map_id===State.active_map_id){ State.map.walls = d.walls; MapModule.drawVision(); MapModule.drawWalls(); }
      dispatch("walls_changed");
    });
    _io.on("door_toggled", d=>{ if(typeof Jukebox!=="undefined") Jukebox.fireTrigger("door"); });
    _io.on("weather_updated", d=>{ if(typeof Weather!=="undefined") Weather.set(d.weather||"none"); });
    _io.on("preload_maps_request", ()=>{ if(MapModule.preloadMaps){ MapModule.preloadMaps(); UI.toast("⏬ Szenen werden vorgeladen…"); } });
    _io.on("maps_updated",   d=>{State.maps=d.maps;State.map_folders=d.map_folders||[];dispatch("maps_list_changed");});
    _io.on("token_created",  t=>{State.tokens[t.id]=t;dispatch("tokens_changed");});
    _io.on("token_moved",    d=>{if(State.tokens[d.token_id]){State.tokens[d.token_id].x=d.x;State.tokens[d.token_id].y=d.y;}dispatch("tokens_changed");});
    _io.on("token_updated",  d=>{
      const tok = State.tokens[d.token_id];
      if(tok){
        // HP-Änderung für Sound-Trigger erkennen (vor dem Überschreiben)
        if(d.updates && typeof d.updates.hp==="number" && typeof tok.hp==="number" && typeof Jukebox!=="undefined"){
          const oldHp = tok.hp, newHp = d.updates.hp;
          if(newHp < oldHp){
            Jukebox.fireTrigger("damage");
            if(newHp<=0 && oldHp>0) Jukebox.fireTrigger("death");
          } else if(newHp > oldHp){
            Jukebox.fireTrigger("heal");
          }
        }
        // Für die Animation (schwebende Zahl, Aufblitzen) – siehe fx.js
        if(d.updates && typeof d.updates.hp==="number" && typeof tok.hp==="number" && d.updates.hp!==tok.hp){
          try{ window.dispatchEvent(new CustomEvent("vtt:hp",{detail:{id:d.token_id, delta:d.updates.hp-tok.hp}})); }catch(e){}
        }
        Object.assign(tok, d.updates);
      }
      dispatch("tokens_changed");
    });
    _io.on("token_deleted",  d=>{delete State.tokens[d.token_id];dispatch("tokens_changed");});
    _io.on("token_ownership_changed", d=>{State.tokens=d.tokens;dispatch("tokens_changed");});
    _io.on("fog_updated",    d=>{d.cells.forEach(c=>{const k=`${c[0]},${c[1]}`;d.action==="add"?State.fog.add(k):State.fog.delete(k);});dispatch("fog_changed");});
    _io.on("fog_cleared",    ()=>{State.fog.clear();dispatch("fog_changed");});
    _io.on("fog_covered",    d=>{State.fog=new Set(d.cells);dispatch("fog_changed");});
    _io.on("stroke_drawn",   d=>dispatch("stroke_drawn",{stroke:d.stroke}));
    _io.on("drawing_cleared",()=>dispatch("drawing_cleared"));
    _io.on("drawing_replaced",d=>dispatch("drawing_replaced",{strokes:d.strokes}));
    _io.on("settings_updated",s=>{State.settings=s;dispatch("settings_changed");});
    _io.on("chat_message",   msg=>dispatch("chat_message",{msg}));
    // Physik-Würfel-Fluss: Der Server schickt dem Werfer den Bauplan; der Werfer
    // würfelt physisch und meldet zurück. Alle bekommen die Nachspielung.
    _io.on("toast",         d=>{ if(typeof UI!=="undefined") UI.toast("⚠️ "+((d&&d.text)||""), 4000); });
    _io.on("dice_playback", d=>dispatch("dice_playback",{pb:d}));
    _io.on("initiative_updated",list=>{
      const wasEmpty = !State.initiative || State.initiative.length===0;
      State.initiative=list;dispatch("initiative_changed");
      if(wasEmpty && list && list.length && typeof Jukebox!=="undefined") Jukebox.fireTrigger("initiative");
    });
    _io.on("initiative_turn",  d=>{
      State.initiative=d.initiative;State.current_turn_index=d.index;
      dispatch("initiative_changed");
      dispatch("turn_changed");
      if(typeof Jukebox!=="undefined") Jukebox.fireTrigger("round");
    });
    _io.on("action_denied", d=>{ UI.toast("⛔ "+(d.message||"Nicht erlaubt")); });
    _io.on("vision_settings_updated", d=>{ dispatch("tokens_changed"); });
    _io.on("enemies_updated",  d=>{State.enemies=d.enemies||{};State.enemy_folders=d.enemy_folders||[];dispatch("enemies_changed");});
    _io.on("handout_created",  h=>{State.handouts.push(h);dispatch("handouts_changed");if(typeof Jukebox!=="undefined")Jukebox.fireTrigger("handout");});
    _io.on("journal_updated",  d=>{State.journal=d.journal||[];dispatch("journal_changed");});
    _io.on("notes_updated",    d=>{State.notes=d.notes||[];dispatch("notes_changed");});
    _io.on("roster_updated",   d=>{State.roster=d.roster||{};dispatch("roster_changed");});
    _io.on("user_joined",      d=>{State.users=d.users;dispatch("users_changed");UI.toast(`👤 ${d.username} beigetreten`);if(typeof Jukebox!=="undefined")Jukebox.fireTrigger("join");});
    _io.on("user_left",        d=>{State.users=d.users;dispatch("users_changed");UI.toast(`👤 ${d.username} verlassen`);});
    _io.on("map_ping",         d=>dispatch("map_ping",d));
    _io.on("force_disconnect", async d=>{
      await Dialog.alert("Du wurdest vom DM aus der Sitzung entfernt."
                         + (d.reason ? "\n\nGrund: " + d.reason : ""),
                         {title:"Aus der Sitzung entfernt", icon:"🚪", okText:"Verstanden"});
      (typeof Theme!=="undefined"?Theme.go("/play"):location.assign("/play"));
    });
    // ── Char-change approval ──
    _io.on("char_change_request", d=>{ if(State.isGM) dispatch("char_change_request", d); });
    _io.on("char_change_pending", d=>UI.toast("⏳ "+d.message));
    _io.on("char_change_approved", d=>{
      if(d.username===State.account_username){ UI.toast("✅ "+d.message); setTimeout(()=>window.location.reload(),1500); }
    });
    _io.on("char_change_denied", d=>{ if(d.username===State.account_username) UI.toast("❌ "+d.message); });

    // Die Verbindung des DM ist abgerissen. Das heißt NICHT, dass er weg ist –
    // meist ist es nur ein kurzer Netzwerk-Hänger, und er ist gleich wieder da.
    // Deshalb keine Panikmeldung mehr, sondern ein sachlicher Hinweis.
    _io.on("dm_disconnected", () => {
      if (!State.isGM) UI.toast("📡 Verbindung zum DM unterbrochen – warte kurz …");
    });
    // Falls die Sichtbarkeit tatsächlich geändert wurde (DM stellt auf privat)
    _io.on("session_visibility_changed", d=>{
      if(d.visibility==="private" && !State.isGM) UI.toast("🔒 Der DM hat die Sitzung auf privat gestellt.");
    });
  }
  function active_map_fog(s){
    const m=s.maps?.[s.active_map_id]; return m?.fog_cells||[];
  }
  function dispatch(name,detail={}){document.dispatchEvent(new CustomEvent("dnd:"+name,{detail}));}
  function emit(event,data){_io?.emit(event,data);}
  return {init,emit};
})();
