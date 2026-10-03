/**
 * map.js – Viewport, Grid, Fog, Vision, Drawing, Measure
 *
 * INTERACTION MODEL (Pointer Events API — robust):
 *   - Right/Middle pointer + drag = pan the map
 *   - Left pointer on empty map   = tool behavior (measure/draw/ping)
 *   - Wheel                       = zoom (cursor-centered)
 *
 * Tokens intercept their own pointerdown (see tokens.js) and stopPropagation.
 * Enable `window.DEBUG_MAP = true` in console to see events.
 */
const MapModule = (() => {
  let mapArea, vp, mapImg, gridCvs, fogCvs, drawCvs, visionCvs, measureCvs;
  let gridCtx, fogCtx, drawCtx, visionCtx, measureCtx;
  let _wallStart = null;
  let panStart=null, measureStart=null, drawStroke=null;
  let isPanning=false;
  let panPointerId = -1;

  function dbg(...args){ if(window.DEBUG_MAP) console.log("[MAP]", ...args); }

  function init() {
    mapArea   = document.getElementById("map-area");
    vp        = document.getElementById("map-viewport");
    mapImg    = document.getElementById("map-img");
    gridCvs   = document.getElementById("grid-canvas");
    fogCvs    = document.getElementById("fog-canvas");
    drawCvs   = document.getElementById("draw-canvas");
    visionCvs = document.getElementById("vision-canvas");
    measureCvs= document.getElementById("measure-canvas");

    if (!mapArea) { console.error("[MAP] #map-area not found!"); return; }

    gridCtx=gridCvs.getContext("2d"); fogCtx=fogCvs.getContext("2d");
    drawCtx=drawCvs.getContext("2d"); visionCtx=visionCvs.getContext("2d");
    measureCtx=measureCvs.getContext("2d");

    mapArea.style.touchAction = "none";

    _loadExplored();
    bindEvents();
    console.log("[MAP] init complete, mapArea =", mapArea);

    document.addEventListener("dnd:full_state",     () => { fullRender(); preloadMaps(); });
    document.addEventListener("dnd:maps_list_changed",() => preloadMaps());
    document.addEventListener("dnd:map_updated",    () => loadMapImg(true));
    document.addEventListener("dnd:map_switched",   () => { resizeCanvases(); loadMapImg(true); drawGrid(); drawFog(); drawVision(); });
    document.addEventListener("dnd:map_settings",   () => { resizeCanvases(); drawGrid(); drawFog(); drawVision(); });
    document.addEventListener("dnd:fog_changed",    () => drawFog());
    window.addEventListener("vtt:theme", () => { try { drawGrid(); drawFog(); } catch (e) {} });
    document.addEventListener("dnd:tokens_changed", () => drawVision());
    document.addEventListener("dnd:stroke_drawn",   e  => replayStroke(e.detail.stroke));
    document.addEventListener("dnd:drawing_cleared",() => drawCtx.clearRect(0,0,State.map.width,State.map.height));
    document.addEventListener("dnd:drawing_replaced", e => {
      // Zeichenfläche leeren und die verbliebenen Striche neu zeichnen.
      State.drawing_strokes = e.detail.strokes || [];
      drawCtx.clearRect(0,0,State.map.width,State.map.height);
      State.drawing_strokes.forEach(s=>replayStroke(s));
    });
  }

  function resizeCanvases() {
    const w=State.map.width, h=State.map.height;
    [gridCvs,fogCvs,drawCvs,visionCvs,measureCvs].forEach(c=>{c.width=w;c.height=h;});
    vp.style.width=w+"px"; vp.style.height=h+"px";
    _applyImageTransform();
  }

  function fullRender() {
    resizeCanvases(); loadMapImg(true); drawGrid(); drawFog(); drawVision();
    drawCtx.clearRect(0,0,State.map.width,State.map.height);
    (State.drawing_strokes||[]).forEach(s=>replayStroke(s));
    drawWalls();
  }

  // Cache für vorgeladene Kartenbilder (verhindert Ladezeit beim Wechsel)
  const _preloadCache = {};

  // Lädt alle Kartenbilder der Kampagne im Hintergrund vor.
  // Wird nach full_state und maps_updated aufgerufen.
  function preloadMaps() {
    const maps = State.maps || {};
    let loaded = 0, total = 0;
    Object.values(maps).forEach(m => {
      if (!m.url || _preloadCache[m.url]) return;
      total++;
      const img = new Image();
      img.onload  = () => { _preloadCache[m.url] = img; loaded++; };
      img.onerror = () => { /* stummes Überspringen fehlerhafter Bilder */ };
      img.src = m.url;
    });
    if (total > 0) console.log(`[preload] ${total} Karte(n) werden vorgeladen`);
  }

  function loadMapImg(force) {
    if (!State.map.url){ mapImg.src=""; mapImg.style.display="none"; return; }
    mapImg.style.display="block";
    const isPreloaded = !!_preloadCache[State.map.url];
    const newUrl = State.map.url + (force && !isPreloaded ? `?t=${Date.now()}` : "");
    mapImg.onload = () => {
      _applyImageTransform();
      resizeCanvases(); drawGrid(); drawFog(); drawVision();
    };
    mapImg.onerror = () => { console.error("Map load failed:", State.map.url); };
    mapImg.src = newUrl;
  }

  // Positioniert/skaliert das Kartenbild gemäß image_x/y/w/h.
  // Wenn image_w/h = 0, wird das Bild auf die volle Kartengröße gestreckt (Standard).
  function _applyImageTransform() {
    const m = State.map;
    if (m.image_w > 0 && m.image_h > 0) {
      mapImg.style.left   = (m.image_x||0) + "px";
      mapImg.style.top    = (m.image_y||0) + "px";
      mapImg.style.width  = m.image_w + "px";
      mapImg.style.height = m.image_h + "px";
    } else {
      // Standard: ganze Karte füllen
      mapImg.style.left = "0px";
      mapImg.style.top  = "0px";
      mapImg.style.width  = m.width + "px";
      mapImg.style.height = m.height + "px";
    }
  }

  // Rasterfarben. "theme" = folgt dem gewählten Spieltisch-Design des
  // jeweiligen Spielers (themes.css → --table-grid-rgb). Neue Karten nutzen
  // das standardmäßig; feste Farben bleiben für Karten, die es brauchen.
  const GRID_COLORS = {
    gold:  "rgba(201,169,110,{a})", white: "rgba(255,255,255,{a})",
    brown: "rgba(120,80,30,{a})",   black: "rgba(0,0,0,{a})",
  };
  const _tv = () => (typeof Theme !== "undefined" ? Theme.tableVars()
                     : { gridRgb: "212,181,120", fogRgb: "6,6,12", measure: "#ffd95a" });
  function _gridColor(key, a) {
    if (key === "theme") return `rgba(${_tv().gridRgb},${a})`;
    return (GRID_COLORS[key] || GRID_COLORS.gold).replace("{a}", a);
  }

  function drawGrid() {
    const w=State.map.width, h=State.map.height, gs=State.map.grid_size;
    const colorKey = State.map.grid_color || "theme";
    const opacity  = State.map.grid_opacity ?? 0.35;
    const gridType = State.map.grid_type || "square";
    gridCtx.clearRect(0,0,w,h);
    if (gridType === "none") return;
    gridCtx.strokeStyle = _gridColor(colorKey, opacity);
    gridCtx.lineWidth   = 1.2;
    if (gridType === "hex"){
      _drawHexGrid(w, h, gs);
    } else {
      for(let x=0;x<=w;x+=gs){gridCtx.beginPath();gridCtx.moveTo(x,0);gridCtx.lineTo(x,h);gridCtx.stroke();}
      for(let y=0;y<=h;y+=gs){gridCtx.beginPath();gridCtx.moveTo(0,y);gridCtx.lineTo(w,y);gridCtx.stroke();}
    }
  }

  // Zeichnet ein hexagonales Raster (flache Oberseite, "pointy-top" horizontal versetzt).
  function _drawHexGrid(w, h, gs){
    const r = gs / 2;                    // Radius = halbe Gittergröße
    const hexW = Math.sqrt(3) * r;       // Breite eines Hex (pointy-top)
    const hexH = 2 * r;                  // Höhe
    const vertSpacing = hexH * 0.75;     // Reihen überlappen zu 3/4
    let row = 0;
    for (let cy = r; cy - r < h; cy += vertSpacing){
      const offset = (row % 2) ? hexW/2 : 0;
      for (let cx = r + offset; cx - hexW/2 < w; cx += hexW){
        _drawHexAt(cx, cy, r);
      }
      row++;
    }
  }
  function _drawHexAt(cx, cy, r){
    gridCtx.beginPath();
    for (let i=0;i<6;i++){
      const ang = Math.PI/180 * (60*i - 90);   // pointy-top
      const px = cx + r * Math.cos(ang);
      const py = cy + r * Math.sin(ang);
      if (i===0) gridCtx.moveTo(px,py); else gridCtx.lineTo(px,py);
    }
    gridCtx.closePath();
    gridCtx.stroke();
  }

  function drawFog() {
    const w=State.map.width, h=State.map.height, gs=State.map.grid_size;
    fogCtx.clearRect(0,0,w,h);
    // Nebel in der Farbe des Tisch-Designs (DM sieht ihn halbtransparent)
    fogCtx.fillStyle = State.isGM ? `rgba(${_tv().fogRgb},0.72)` : `rgba(${_tv().fogRgb},1.0)`;
    State.fog.forEach(key=>{
      const [gx,gy]=key.split(",").map(Number);
      fogCtx.fillRect(gx*gs,gy*gs,gs,gs);
    });
  }

  // ── Erkundungsmodus: Erinnerungsraster ────────────────────────────────
  // Speichert pro Karte, welche Zellen der Spieler schon gesehen hat.
  // Struktur: _exploredByMap = { mapId: Set("gx,gy") }
  let _exploredByMap = {};

  function _exploredKey() {
    return `dnd_explored_${State.session_id}_${State.account_username||State.username}`;
  }
  function _loadExplored() {
    try {
      const raw = localStorage.getItem(_exploredKey());
      if (raw) {
        const obj = JSON.parse(raw);
        _exploredByMap = {};
        for (const mid in obj) _exploredByMap[mid] = new Set(obj[mid]);
      }
    } catch(e) { _exploredByMap = {}; }
  }
  function _saveExplored() {
    try {
      const obj = {};
      for (const mid in _exploredByMap) obj[mid] = [..._exploredByMap[mid]];
      localStorage.setItem(_exploredKey(), JSON.stringify(obj));
    } catch(e) {}
  }
  function _currentExplored() {
    const mid = State.active_map_id || "default";
    if (!_exploredByMap[mid]) _exploredByMap[mid] = new Set();
    return _exploredByMap[mid];
  }
  // Merkt sich alle Zellen im aktuellen Sichtkreis als "gesehen"
  function _rememberVisibleCells(cx, cy, vr) {
    const gs = State.map.grid_size;
    const explored = _currentExplored();
    const walls = _collectBlockingWalls();
    const minGx = Math.floor((cx - vr) / gs), maxGx = Math.floor((cx + vr) / gs);
    const minGy = Math.floor((cy - vr) / gs), maxGy = Math.floor((cy + vr) / gs);
    for (let gx = minGx; gx <= maxGx; gx++) {
      for (let gy = minGy; gy <= maxGy; gy++) {
        const px = gx*gs + gs/2, py = gy*gs + gs/2;
        const dx = px - cx, dy = py - cy;
        if (dx*dx + dy*dy > vr*vr) continue;
        // Nur merken, wenn keine Wand zwischen Token und Zelle liegt
        if (walls.length && _hasWallBetween(cx, cy, px, py, walls)) continue;
        explored.add(`${gx},${gy}`);
      }
    }
    _saveExplored();
  }

  // Prüft, ob zwischen zwei Punkten eine blockierende Wand liegt.
  function _hasWallBetween(x1, y1, x2, y2, walls) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    for (const w of walls) {
      const t = _raySegment(x1, y1, dx/len, dy/len, w.x1, w.y1, w.x2, w.y2);
      if (t !== null && t < len - 1) return true;  // Wand liegt vor der Zelle
    }
    return false;
  }

  // Sammelt die Wände der aktuellen Karte, die Sicht blockieren.
  // Offene Türen und (später) Fenster blockieren die Sicht nicht.
  function _collectBlockingWalls() {
    const walls = State.map.walls || [];
    return walls.filter(w => {
      if (w.type === "door" && w.open) return false;  // offene Tür blockiert nicht
      if (w.type === "window") return false;           // Fenster: Sicht durch
      return true;
    });
  }

  // Schnittpunkt von Strahl (px,py)->(Richtung dx,dy) mit Segment (x1,y1)-(x2,y2).
  // Gibt Distanz-Faktor t1 (entlang Strahl) zurück oder null.
  function _raySegment(px,py,dx,dy, x1,y1,x2,y2) {
    const r_dx=dx, r_dy=dy;
    const s_dx=x2-x1, s_dy=y2-y1;
    const denom = r_dx*s_dy - r_dy*s_dx;
    if (Math.abs(denom) < 1e-9) return null; // parallel
    const t2 = ((x1-px)*r_dy - (y1-py)*r_dx) / denom;
    const t1 = ((x1-px)*s_dy - (y1-py)*s_dx) / denom;
    if (t1 >= 0 && t2 >= 0 && t2 <= 1) return t1;
    return null;
  }

  // Berechnet das Sichtbarkeits-Polygon vom Punkt (cx,cy) mit Radius r,
  // begrenzt durch die blockierenden Wände. Gibt Array von Punkten zurück.
  function _computeVisibilityPolygon(cx, cy, r, walls) {
    // Sammle alle Winkel zu Wand-Endpunkten (+ kleine Offsets, um Kanten zu umschließen)
    const angles = [];
    walls.forEach(w => {
      [[w.x1,w.y1],[w.x2,w.y2]].forEach(([x,y])=>{
        const a = Math.atan2(y-cy, x-cx);
        angles.push(a-0.0001, a, a+0.0001);
      });
    });
    // Auch die vier Kreis-Hauptrichtungen für den Fall ohne nahe Wände
    for (let i=0;i<32;i++) angles.push((i/32)*Math.PI*2 - Math.PI);

    angles.sort((a,b)=>a-b);
    const pts = [];
    angles.forEach(a => {
      const dx = Math.cos(a), dy = Math.sin(a);
      let closest = r;  // maximal bis Sichtradius
      walls.forEach(w => {
        const t = _raySegment(cx,cy,dx,dy, w.x1,w.y1,w.x2,w.y2);
        if (t !== null && t < closest) closest = t;
      });
      pts.push({ x: cx + dx*closest, y: cy + dy*closest });
    });
    return pts;
  }

  // Legt einen Kreis im Nebel frei (destination-out entfernt Dunkelheit).
  // strength 1.0 = voll hell, <1 = nur teilweise (dämmriges Licht).
  // Wenn Wände vorhanden sind, wird die Sicht per Raycasting begrenzt.
  function _revealCircle(cx, cy, radius, strength=1.0) {
    if (radius <= 0) return;
    const a = Math.max(0, Math.min(1, strength));
    const walls = _collectBlockingWalls();

    visionCtx.globalCompositeOperation = "destination-out";

    if (walls.length) {
      // Wandbewusst: Sichtpolygon als Clip, dann Radialverlauf hinein
      const poly = _computeVisibilityPolygon(cx, cy, radius, walls);
      if (poly.length >= 3) {
        visionCtx.save();
        visionCtx.beginPath();
        visionCtx.moveTo(poly[0].x, poly[0].y);
        for (let i=1;i<poly.length;i++) visionCtx.lineTo(poly[i].x, poly[i].y);
        visionCtx.closePath();
        visionCtx.clip();
        const grad = visionCtx.createRadialGradient(cx,cy,radius*0.7,cx,cy,radius);
        grad.addColorStop(0,   `rgba(0,0,0,${a})`);
        grad.addColorStop(0.85,`rgba(0,0,0,${a})`);
        grad.addColorStop(1,   "rgba(0,0,0,0)");
        visionCtx.fillStyle = grad;
        visionCtx.beginPath(); visionCtx.arc(cx,cy,radius,0,Math.PI*2); visionCtx.fill();
        visionCtx.restore();
      }
    } else {
      // Kein Wand-Setup: klassischer Kreis
      const grad = visionCtx.createRadialGradient(cx, cy, radius*0.7, cx, cy, radius);
      grad.addColorStop(0,   `rgba(0,0,0,${a})`);
      grad.addColorStop(0.85,`rgba(0,0,0,${a})`);
      grad.addColorStop(1,   "rgba(0,0,0,0)");
      visionCtx.fillStyle = grad;
      visionCtx.beginPath(); visionCtx.arc(cx, cy, radius, 0, Math.PI*2); visionCtx.fill();
    }
    visionCtx.globalCompositeOperation = "source-over";
  }

  // Sammelt alle aktiven Lichtquellen auf der aktuellen Karte.
  // Ein Token ist Lichtquelle, wenn light_bright oder light_dim (in ft) > 0.
  function _collectLightSources() {
    const gs = State.map.grid_size;
    const lights = [];
    Object.values(State.tokens || {}).forEach(t => {
      if (t.map_id && t.map_id !== State.active_map_id) return;
      const bright = (t.light_bright || 0);
      const dim    = (t.light_dim || 0);
      if (bright <= 0 && dim <= 0) return;
      lights.push({
        cx: t.x + t.size/2, cy: t.y + t.size/2,
        bright: (bright/5)*gs,
        dim:    (dim/5)*gs,
      });
    });
    return lights;
  }

  function _snapToGrid(pos){
    const gs = State.map.grid_size || 50;
    return { x: Math.round(pos.x/gs)*gs, y: Math.round(pos.y/gs)*gs };
  }
  function _findNearestDoor(pos){
    const walls = State.map.walls || [];
    let best=null, bestD=40*40;
    walls.forEach(w=>{
      if (w.type!=="door") return;
      const mx=(w.x1+w.x2)/2, my=(w.y1+w.y2)/2;
      const d=(pos.x-mx)**2+(pos.y-my)**2;
      if (d<bestD){ bestD=d; best=w.id; }
    });
    return best;
  }
  // Findet die nächste Wand/Tür/Fenster zum Klickpunkt (Abstand Punkt→Segment).
  function _findNearestWall(pos){
    const walls = State.map.walls || [];
    let best=null, bestD=25*25;   // Klick-Toleranz ~25px
    walls.forEach(w=>{
      const d = _distToSegment(pos.x, pos.y, w.x1, w.y1, w.x2, w.y2);
      if (d*d < bestD){ bestD = d*d; best = w.id; }
    });
    return best;
  }
  // Abstand eines Punktes zu einem Liniensegment.
  function _distToSegment(px, py, x1, y1, x2, y2){
    const dx=x2-x1, dy=y2-y1;
    const len2 = dx*dx + dy*dy;
    if (len2 === 0) return Math.hypot(px-x1, py-y1);
    let t = ((px-x1)*dx + (py-y1)*dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1+t*dx), py - (y1+t*dy));
  }
  function startWallTool(){ _wallStart=null; UI.toast("🧱 Wand-Werkzeug: 2 Punkte klicken"); }
  function stopWallTool(){ _wallStart=null; clearMeasure(); drawWalls(); }

  // Zeichnet die Wände (nur für den GM sichtbar) auf die Mess-Ebene.
  function drawWalls() {
    if (!measureCtx || !State.isGM) return;
    const walls = State.map.walls || [];
    walls.forEach(w => {
      measureCtx.beginPath();
      measureCtx.moveTo(w.x1, w.y1);
      measureCtx.lineTo(w.x2, w.y2);
      if (w.type === "door") {
        measureCtx.strokeStyle = w.open ? "rgba(90,200,120,0.9)" : "rgba(230,180,60,0.95)";
        measureCtx.setLineDash([10,6]);
      } else if (w.type === "window") {
        measureCtx.strokeStyle = "rgba(120,180,230,0.9)";
        measureCtx.setLineDash([4,4]);
      } else {
        measureCtx.strokeStyle = "rgba(220,70,70,0.85)";
        measureCtx.setLineDash([]);
      }
      measureCtx.lineWidth = 3;
      measureCtx.stroke();
      measureCtx.setLineDash([]);
      [[w.x1,w.y1],[w.x2,w.y2]].forEach(([x,y])=>{
        measureCtx.beginPath();
        measureCtx.arc(x,y,4,0,Math.PI*2);
        measureCtx.fillStyle = "rgba(255,255,255,0.8)";
        measureCtx.fill();
      });
    });
  }

  // Liefert die aktuell AKTIV sichtbaren Regionen als Liste von Polygonen
  // (eigener Sichtkreis + Lichtquellen), begrenzt durch Wände.
  // Wird von weather.js genutzt, um Effekte nur im Sichtbereich zu zeigen.
  function getVisibleRegions() {
    if (State.isGM) return null;  // DM: keine Beschränkung
    const regions = [];
    const walls = _collectBlockingWalls();
    const myToken = State.getMyToken();
    const gs = State.map.grid_size || 50;

    function circleOrPoly(cx, cy, r){
      if (r <= 0) return;
      if (walls.length){
        const poly = _computeVisibilityPolygon(cx, cy, r, walls);
        if (poly && poly.length>=3) regions.push(poly);
      } else {
        // Kreis als Polygon annähern
        const poly=[]; const seg=24;
        for(let i=0;i<seg;i++){ const a=(i/seg)*Math.PI*2; poly.push({x:cx+Math.cos(a)*r, y:cy+Math.sin(a)*r}); }
        regions.push(poly);
      }
    }

    if (myToken){
      const visFt = State.effectiveVisionFt(myToken);
      const vr = visFt>0 ? (visFt/5)*gs : 0;
      circleOrPoly(myToken.x+myToken.size/2, myToken.y+myToken.size/2, vr);
    }
    // Lichtquellen
    _collectLightSources().forEach(L=>{
      const r = Math.max(L.bright||0, L.dim||0);
      circleOrPoly(L.cx, L.cy, r);
    });
    return regions;
  }

  function drawVision() {
    const w=State.map.width, h=State.map.height;
    visionCtx.clearRect(0,0,w,h);
    if(State.isGM) return;

    const exploreMode = State.map.explore_mode !== false;
    const lights = _collectLightSources();
    const myToken = State.getMyToken();

    // Ohne eigenen Token: nur Erinnerung + Lichtquellen zeigen
    if(!myToken){
      visionCtx.fillStyle="rgba(3,2,5,1.0)";
      visionCtx.fillRect(0,0,w,h);
      if (exploreMode) _revealExploredCells(0.55);
      _applyLights(lights, exploreMode);
      return;
    }

    const visFt = State.effectiveVisionFt(myToken);
    const isDark = State.map.darkness === true;
    // Hat der Spieler eine eigene Lichtquelle (Fackel etc.)?
    const hasOwnLight = (myToken.light_bright||0) > 0 || (myToken.light_dim||0) > 0;
    const hasDarkvision = (myToken.darkvision||0) > 0;
    // Bei Dunkelheit ersetzt die Nachtsicht die normale Sichtweite.
    // Ohne Nachtsicht sieht der Spieler im Dunkeln nur, was Lichtquellen beleuchten.
    let effFt = visFt;
    if (isDark){
      effFt = myToken.darkvision || 0;   // nur Nachtsicht-Reichweite
    }
    const vr = effFt > 0 ? (effFt/5)*State.map.grid_size : 0;
    const cx = myToken.x+myToken.size/2, cy=myToken.y+myToken.size/2;

    // Grundschleier
    visionCtx.fillStyle="rgba(3,2,5,1.0)";
    visionCtx.fillRect(0,0,w,h);

    // Erinnerung (halbdunkel) freilegen:
    // - bei heller Karte immer
    // - bei Dunkelheit, wenn der Spieler IRGENDEINE Sichtquelle hat (Nachtsicht ODER eigene Fackel)
    //   oder wenn Lichtquellen auf der Karte existieren
    const canRemember = !isDark || hasDarkvision || hasOwnLight || (lights && lights.length>0);
    if (exploreMode && canRemember) _revealExploredCells(0.55);

    // Eigener Sichtkreis (Nachtsicht im Dunkeln, sonst normale Sicht)
    if (vr > 0) {
      if (exploreMode) _rememberVisibleCells(cx, cy, vr);
      // Nachtsicht zeigt nur gedämpft (Graustufen-Gefühl über schwächere Deckung)
      _revealCircle(cx, cy, vr, isDark ? 0.82 : 1.0);
    }

    // Lichtquellen hellen immer auf (auch im Dunkeln – das ist der Sinn von Fackeln)
    _applyLights(lights, exploreMode, cx, cy, vr);
  }

  // Wendet alle Lichtquellen auf den Nebel an.
  // Wenn eine Lichtquelle in Reichweite des eigenen Tokens liegt, merkt sie sich
  // die Zellen ebenfalls als erkundet.
  function _applyLights(lights, exploreMode, myCx, myCy, myVr) {
    lights.forEach(L => {
      // Dämmriges Licht (schwächer)
      if (L.dim > 0)    _revealCircle(L.cx, L.cy, L.dim, 0.55);
      // Helles Licht (voll)
      if (L.bright > 0) _revealCircle(L.cx, L.cy, L.bright, 1.0);
      // Erkundung merken, wenn Licht sichtbar (Kern im eigenen Sichtradius oder immer bei eigenem Licht)
      if (exploreMode) {
        const r = Math.max(L.bright, L.dim);
        _rememberVisibleCells(L.cx, L.cy, r);
      }
    });
  }

  // Erkundete Zellen teilweise freilegen (Erinnerung)
  function _revealExploredCells(strength) {
    visionCtx.globalCompositeOperation="destination-out";
    visionCtx.fillStyle=`rgba(0,0,0,${strength})`;
    const gs = State.map.grid_size;
    _currentExplored().forEach(key=>{
      const [gx,gy]=key.split(",").map(Number);
      visionCtx.fillRect(gx*gs,gy*gs,gs,gs);
    });
    visionCtx.globalCompositeOperation="source-over";
  }

  // Öffentlich: Erinnerung für aktuelle Karte löschen (z.B. bei "Karte zurücksetzen")
  function clearExplored(mapId) {
    // Ohne Angabe die aktive Karte; "*" = alle Karten
    if (mapId === "*" || mapId === "all") {
      _exploredByMap = {};
    } else {
      const mid = mapId || State.active_map_id || "default";
      _exploredByMap[mid] = new Set();
    }
    _saveExplored();
    drawVision();
  }

  function replayStroke(stroke) {
    if(!stroke?.points?.length) return;
    drawCtx.beginPath();
    drawCtx.strokeStyle=stroke.color||"#e8cc94";
    drawCtx.lineWidth=stroke.width||3;
    drawCtx.lineCap="round"; drawCtx.lineJoin="round";
    drawCtx.moveTo(stroke.points[0].x,stroke.points[0].y);
    stroke.points.slice(1).forEach(p=>drawCtx.lineTo(p.x,p.y));
    drawCtx.stroke();
  }

  function drawMeasureLine(a, b) {
    const gs=State.map.grid_size;
    const w=State.map.width, h=State.map.height;
    measureCtx.clearRect(0,0,w,h);
    const bx=Math.round(b.x/gs)*gs, by=Math.round(b.y/gs)*gs;
    const dx=bx-a.x, dy=by-a.y;
    const dist=Math.sqrt(dx*dx+dy*dy);
    const ft=Math.round((dist/gs)*5/5)*5;
    measureCtx.save();
    measureCtx.setLineDash([8,5]);
    measureCtx.strokeStyle=_tv().measure;
    measureCtx.lineWidth=2.5;
    measureCtx.beginPath();measureCtx.moveTo(a.x,a.y);measureCtx.lineTo(bx,by);measureCtx.stroke();
    measureCtx.setLineDash([]);
    measureCtx.fillStyle=_tv().measure;
    measureCtx.beginPath();measureCtx.arc(a.x,a.y,5,0,Math.PI*2);measureCtx.fill();
    measureCtx.beginPath();measureCtx.arc(bx,by,5,0,Math.PI*2);measureCtx.fill();
    const mx=(a.x+bx)/2, my=(a.y+by)/2;
    measureCtx.font="bold 14px 'Cinzel',serif";
    measureCtx.fillStyle="rgba(0,0,0,0.7)";
    measureCtx.fillRect(mx-28,my-16,56,20);
    measureCtx.fillStyle=_tv().measure;
    measureCtx.textAlign="center";
    measureCtx.fillText(`${ft} ft`,mx,my-1);
    measureCtx.restore();
    const hud=document.getElementById("measure-hud");
    hud.style.display="block";
    hud.textContent=`📏 ${ft} ft  (${(dist/gs).toFixed(1)} Felder)`;
  }

  function clearMeasure() {
    measureCtx?.clearRect(0,0,State.map.width,State.map.height);
    const hud=document.getElementById("measure-hud");
    if(hud) hud.style.display="none";
  }

  function applyViewport() {
    const v=State.viewport;
    vp.style.transform=`translate(${v.x}px,${v.y}px) scale(${v.scale})`;
  }
  function adjustZoom(delta) {
    State.viewport.scale=Math.max(0.18,Math.min(3.5,State.viewport.scale+delta));
    applyViewport();
  }

  function zoomAt(clientX, clientY, deltaScale){
    const rect = mapArea.getBoundingClientRect();
    const mouseMapX = (clientX - rect.left - State.viewport.x) / State.viewport.scale;
    const mouseMapY = (clientY - rect.top  - State.viewport.y) / State.viewport.scale;
    const newScale = Math.max(0.18, Math.min(3.5, State.viewport.scale + deltaScale));
    State.viewport.scale = newScale;
    State.viewport.x = (clientX - rect.left) - mouseMapX * newScale;
    State.viewport.y = (clientY - rect.top)  - mouseMapY * newScale;
    applyViewport();
  }

  function resetView() { State.viewport={x:40,y:40,scale:1}; applyViewport(); }

  function getMapPos(e) {
    const r=mapArea.getBoundingClientRect();
    return {x:(e.clientX-r.left-State.viewport.x)/State.viewport.scale,
            y:(e.clientY-r.top-State.viewport.y)/State.viewport.scale};
  }

  function fogPaint(pos, add) {
    const gs=State.map.grid_size; const bs=2;
    const cx=Math.floor(pos.x/gs), cy=Math.floor(pos.y/gs);
    const cells=[];
    for(let dx=-bs;dx<=bs;dx++) for(let dy=-bs;dy<=bs;dy++) cells.push([cx+dx,cy+dy]);
    cells.forEach(c=>{const k=`${c[0]},${c[1]}`; add?State.fog.add(k):State.fog.delete(k);});
    drawFog();
    Socket.emit("fog_update",{session_id:State.session_id,action:add?"add":"remove",cells});
  }

  function createPingAt(cx, cy) {
    const el=document.createElement("div"); el.className="map-ping";
    el.style.cssText=`left:${cx}px;top:${cy}px;position:fixed`;
    document.body.appendChild(el); setTimeout(()=>el.remove(),850);
  }

  function startPan(e){
    isPanning = true;
    panPointerId = e.pointerId;
    panStart = {mx:e.clientX, my:e.clientY, vx:State.viewport.x, vy:State.viewport.y};
    mapArea.style.cursor = "grabbing";
    // Capture pointer so we get move/up even if cursor leaves the element
    try { mapArea.setPointerCapture(e.pointerId); } catch(err){}
    console.log("pan start",{x:e.clientX, y:e.clientY, button:e.button, pointerType:e.pointerType});
  }
  function endPan(e){
    if (!isPanning) return;
    isPanning = false;
    panStart = null;
    try { mapArea.releasePointerCapture(panPointerId); } catch(err){}
    panPointerId = -1;
    mapArea.style.cursor = "";
  }

  function bindEvents() {
    // Wheel = zoom
    mapArea.addEventListener("wheel", e=>{
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.12 : 0.12;
      zoomAt(e.clientX, e.clientY, delta);
    }, {passive:false});

    // Disable browser context menu on map (we use right-click for pan)
    mapArea.addEventListener("contextmenu", e=>{
      e.preventDefault();
    });

    // POINTER DOWN
    mapArea.addEventListener("pointerdown", e=>{
      console.log("pointerdown",{button:e.button, target:e.target.tagName, id:e.target.id, classes:e.target.className});

      // Right (2) or middle (1) = pan
      if (e.button === 2 || e.button === 1){
        e.preventDefault();
        startPan(e);
        return;
      }
      if (e.button !== 0) return;

      const pos = getMapPos(e);
      const tool = State.activeTool;

      if (tool === "measure"){ measureStart = pos; return; }
      if (tool === "wall"){
        // Erster Klick setzt Startpunkt, zweiter zieht die Wand
        const snapped = _snapToGrid(pos);
        if (!_wallStart){
          _wallStart = snapped;
        } else {
          const type = document.getElementById("wall-type-select")?.value || "opaque";
          Socket.emit("wall_add",{session_id:State.session_id, map_id:State.active_map_id,
            x1:_wallStart.x, y1:_wallStart.y, x2:snapped.x, y2:snapped.y, type});
          _wallStart = null;
          clearMeasure();
        }
        return;
      }
      if (tool === "door-toggle"){
        // Klick auf eine Tür schaltet sie um (nächste Tür in Reichweite)
        const wid = _findNearestDoor(pos);
        if (wid) Socket.emit("door_toggle",{session_id:State.session_id, map_id:State.active_map_id, wall_id:wid});
        return;
      }
      if (tool === "wall-erase"){
        // Klick auf eine Wand/Tür/Fenster löscht genau dieses eine Element
        const wid = _findNearestWall(pos);
        if (wid){
          Socket.emit("wall_delete",{session_id:State.session_id, map_id:State.active_map_id, wall_id:wid});
          UI.toast("🩹 Element gelöscht");
        } else {
          UI.toast("Nichts getroffen – näher an die Linie klicken");
        }
        return;
      }
      if (tool === "draw"){
        if(!State.isGM && !State.settings.drawing_allowed){UI.toast("✏️ Zeichnen gesperrt");return;}
        const color = document.getElementById("draw-color-pick")?.value || "#e8cc94";
        drawCtx.beginPath(); drawCtx.moveTo(pos.x, pos.y);
        drawCtx.strokeStyle = color; drawCtx.lineWidth = 3; drawCtx.lineCap = "round";
        drawStroke = {points:[pos], color, width:3, by: State.username};
        return;
      }
      if (tool === "fog-add"){ fogPaint(pos, true); return; }
      if (tool === "fog-remove"){ fogPaint(pos, false); return; }
      if (tool === "ping"){
        createPingAt(e.clientX, e.clientY);
        Socket.emit("ping_map",{session_id:State.session_id, x:e.clientX, y:e.clientY});
        return;
      }
    });

    // POINTER MOVE
    mapArea.addEventListener("pointermove", e=>{
      if (isPanning && panStart){
        State.viewport.x = panStart.vx + (e.clientX - panStart.mx);
        State.viewport.y = panStart.vy + (e.clientY - panStart.my);
        applyViewport();
        return;
      }
      const pos = getMapPos(e);
      const tool = State.activeTool;
      if (tool === "measure" && measureStart) drawMeasureLine(measureStart, pos);
      else if (tool === "wall" && _wallStart){
        const snapped = _snapToGrid(pos);
        clearMeasure();
        measureCtx.beginPath();
        measureCtx.moveTo(_wallStart.x, _wallStart.y);
        measureCtx.lineTo(snapped.x, snapped.y);
        measureCtx.strokeStyle = "rgba(220,70,70,0.7)";
        measureCtx.lineWidth = 3; measureCtx.setLineDash([6,4]);
        measureCtx.stroke(); measureCtx.setLineDash([]);
        drawWalls();
      }
      else if (tool === "draw" && drawStroke && (e.buttons & 1)){
        drawCtx.lineTo(pos.x, pos.y); drawCtx.stroke(); drawStroke.points.push(pos);
      } else if ((tool === "fog-add" || tool === "fog-remove") && (e.buttons & 1)){
        fogPaint(pos, tool === "fog-add");
      }
    });

    // POINTER UP
    mapArea.addEventListener("pointerup", e=>{
      console.log("pointerup",{button:e.button});
      if (isPanning) endPan(e);
      if (measureStart){ measureStart = null; clearMeasure(); }
      if (drawStroke){
        Socket.emit("draw_stroke",{session_id:State.session_id, stroke:drawStroke});
        drawStroke = null;
      }
    });

    // Also catch pointer cancel (e.g., pointer leaves the window)
    mapArea.addEventListener("pointercancel", e=>{
      if (isPanning) endPan(e);
    });

    mapArea.addEventListener("dragstart", e=>e.preventDefault());

    // SAFETY NET: if pointer is released outside map (and capture somehow lost), still end pan
    window.addEventListener("pointerup", e=>{
      if (isPanning && e.pointerId === panPointerId) {
        endPan(e);
      }
    });
  }

  // ── Karten-Editor: Bild am Raster verschieben/skalieren ──────────────────
  let _mapEditActive = false;
  let _editBox = null;   // Overlay-Element mit Griffen

  function isMapEditActive(){ return _mapEditActive; }

  function toggleMapEditor(){
    _mapEditActive = !_mapEditActive;
    if (_mapEditActive) _showEditBox(); else _hideEditBox();
    return _mapEditActive;
  }

  function _snap(v){
    const gs = State.map.grid_size || 50;
    return Math.round(v/gs)*gs;
  }

  function _currentImageRect(){
    const m = State.map;
    if (m.image_w > 0 && m.image_h > 0){
      return {x:m.image_x||0, y:m.image_y||0, w:m.image_w, h:m.image_h};
    }
    return {x:0, y:0, w:m.width, h:m.height};
  }

  function _showEditBox(){
    if (!State.map.url){ if(typeof UI!=="undefined") UI.toast("Erst eine Karte hochladen"); _mapEditActive=false; return; }
    _hideEditBox();
    const r = _currentImageRect();
    _editBox = document.createElement("div");
    _editBox.id = "map-edit-box";
    _editBox.style.cssText = `position:absolute;border:2px dashed var(--arcane);background:rgba(77,224,212,.06);z-index:90;cursor:move;`;
    _editBox.style.left = r.x+"px"; _editBox.style.top = r.y+"px";
    _editBox.style.width = r.w+"px"; _editBox.style.height = r.h+"px";
    // Ecken-Griff (unten rechts) zum Skalieren
    const handle = document.createElement("div");
    handle.style.cssText = `position:absolute;right:-9px;bottom:-9px;width:18px;height:18px;background:var(--arcane);border:2px solid #000;border-radius:3px;cursor:nwse-resize;`;
    handle.dataset.role = "resize";
    _editBox.appendChild(handle);
    // Info-Label
    const label = document.createElement("div");
    label.style.cssText = `position:absolute;left:0;top:-24px;background:var(--bg-panel2);color:var(--arcane);font-size:.7rem;padding:2px 8px;border-radius:4px;white-space:nowrap;`;
    label.textContent = "📐 Ziehen = verschieben · Ecke = Größe · rastet am Raster";
    _editBox.appendChild(label);
    vp.appendChild(_editBox);
    _bindEditEvents(handle);
  }

  function _hideEditBox(){
    if (_editBox){ _editBox.remove(); _editBox = null; }
    document.getElementById("tool-map-edit")?.classList.remove("active");
  }

  function _bindEditEvents(handle){
    let mode=null, startX=0, startY=0, orig=null;

    function down(e, m){
      e.preventDefault(); e.stopPropagation();
      mode = m;
      const p = getMapPos(e);
      startX = p.x; startY = p.y;
      orig = _currentImageRect();
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up);
    }
    function move(e){
      if(!mode) return;
      const p = getMapPos(e);
      const dx = p.x - startX, dy = p.y - startY;
      if (mode==="move"){
        _editBox.style.left = _snap(orig.x + dx)+"px";
        _editBox.style.top  = _snap(orig.y + dy)+"px";
      } else if (mode==="resize"){
        const gs = State.map.grid_size||50;
        _editBox.style.width  = Math.max(gs, _snap(orig.w + dx))+"px";
        _editBox.style.height = Math.max(gs, _snap(orig.h + dy))+"px";
      }
    }
    function up(){
      if(!mode) return;
      mode=null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      _commitEdit();
    }
    _editBox.addEventListener("pointerdown", e=>{
      if (e.target.dataset.role==="resize") down(e,"resize");
      else down(e,"move");
    });
  }

  function _commitEdit(){
    if (!_editBox) return;
    const x = parseInt(_editBox.style.left)||0;
    const y = parseInt(_editBox.style.top)||0;
    const wd = parseInt(_editBox.style.width)||State.map.width;
    const ht = parseInt(_editBox.style.height)||State.map.height;
    // Lokal sofort anwenden
    State.map.image_x = x; State.map.image_y = y;
    State.map.image_w = wd; State.map.image_h = ht;
    _applyImageTransform();
    // An Server senden (persistent + für alle)
    if (typeof Socket!=="undefined"){
      Socket.emit("map_settings", {session_id:State.session_id, settings:{
        image_x:x, image_y:y, image_w:wd, image_h:ht
      }});
    }
  }

  return {init,adjustZoom,zoomAt,resetView,getMapPos,drawGrid,drawFog,drawVision,drawWalls,fullRender,createPingAt,loadMapImg,clearExplored,startWallTool,stopWallTool,preloadMaps,getVisibleRegions,toggleMapEditor,isMapEditActive};
})();
