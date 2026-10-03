/** state.js – shared client state */
const State = {
  session_id:"", role:"player", username:"", my_color:"#c9a96e",
  my_socket_id:"", my_char_id:"", account_username:"",
  map:{url:null,width:3000,height:2000,grid_size:50,grid_color:"gold",grid_opacity:0.35},
  maps:{}, active_map_id:"", map_folders:[],
  tokens:{}, fog:new Set(), initiative:[], current_turn_index:0,
  chat:[], handouts:[], enemies:{}, enemy_folders:[], drawing_strokes:[],
  roster:{}, journal:[],
  settings:{drawing_allowed:true},
  users:[],
  owner:"", invited_users:[], visibility:"private", allUsers:[],
  // ── Viewport state (pan/zoom position)
  viewport:{x:40, y:40, scale:1},
  // ── Active tool (measure/draw/ping/none)
  activeTool:"none",
  // ── Selected token (for highlighting)
  selectedTokenId:null,
  get isGM(){return this.role==="gm";},
  getMyToken(){
    // Nur der eigene Token auf der AKTIVEN Karte zählt (Sicht/Licht ist kartenabhängig).
    return Object.values(this.tokens).find(t=>{
      const mine = t.owner===this.my_socket_id ||
                   (this.my_char_id && t.owner_char_id===this.my_char_id);
      const onMap = t.map_id ? t.map_id===this.active_map_id : true;
      return mine && onMap;
    }) || null;
  },
  getActiveMapTokens(){
    // Ein Token gehört zu genau einer Karte. Tokens ohne map_id gehören
    // (aus Kompatibilität) zur aktiven Karte, damit alte Daten nicht verschwinden.
    return Object.values(this.tokens).filter(t=>
      t.map_id ? t.map_id===this.active_map_id : true
    );
  },
  // Effektive Sichtweite eines Tokens in Fuß.
  // Basis = vision_range, skaliert mit perception_mod (vom DM live steuerbar).
  // Zusätzlich kann der Perception-Wert eine Grundsicht geben (Wahrnehmung/2).
  // Standard-Sichtweiten je nach Kartentyp (in Fuß)
  DEFAULT_VISION: { combat: 200, exploration: 400 },

  effectiveVisionFt(t){
    if(!t) return 0;
    // 1) Basis: expliziter DM-Wert am Token ODER Standard nach Kartentyp
    let base;
    if (t.vision_override !== undefined && t.vision_override !== null && t.vision_override !== "") {
      base = t.vision_override;
    } else {
      const mapType = (this.map && this.map.map_type) || "combat";
      base = this.DEFAULT_VISION[mapType] || 200;
    }
    // 2) Dunkelsicht (Nachtsicht) als Mindest-Sichtweite im Dunkeln – siehe Lichtsystem
    // 3) Würfel-Modifikator (schlechter Wahrnehmungswurf verkleinert die Sicht)
    const mod = (t.perception_mod===undefined || t.perception_mod===null) ? 1 : t.perception_mod;
    return Math.max(0, base * mod);
  },
};
