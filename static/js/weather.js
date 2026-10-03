/**
 * weather.js – GPU-schonende Partikel-Wettereffekte über der Karte.
 * Effekte: rain (Regen), snow (Schnee), fog (Nebelschwaden), leaves (fallende Blätter), ash (Funken/Asche).
 * Der aktuelle Effekt wird vom DM gesetzt und über Socket an alle synchronisiert.
 *
 * Performance-Design:
 * - Der Canvas ist ein BILDSCHIRM-Overlay in fester Viewport-Größe (nicht Kartengröße).
 *   Dadurch bleibt die zu zeichnende Fläche klein und der Effekt läuft flüssig,
 *   unabhängig davon, wie groß die Karte ist.
 * - Für Spieler wird der Effekt per CSS-Maske auf den aktuell sichtbaren Bereich
 *   begrenzt (die Vision-Ebene liefert die Maske). Kein teures Raycasting pro Frame.
 */
const Weather = (() => {
  let canvas, ctx, raf = null;
  let current = "none";
  let particles = [];
  let W = 0, H = 0;

  function init(){
    canvas = document.getElementById("weather-canvas");
    if (!canvas) return;
    ctx = canvas.getContext("2d");
    _resize();
    window.addEventListener("resize", _resize);
  }

  function _resize(){
    if (!canvas) return;
    // Bildschirmgröße des Karten-Bereichs (nicht die Kartengröße!).
    const area = document.getElementById("map-area") || document.getElementById("main");
    W = canvas.width  = area ? area.clientWidth  : window.innerWidth;
    H = canvas.height = area ? area.clientHeight : window.innerHeight;
    // Als festes Overlay über dem Karten-Bereich positionieren.
    canvas.style.position = "absolute";
    canvas.style.top = "0";
    canvas.style.left = "0";
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    canvas.style.pointerEvents = "none";
    canvas.style.zIndex = "8";
    if (current !== "none") _spawn(current);
  }

  function _spawn(type){
    particles = [];
    // Partikelzahl an die sichtbare Bildschirmfläche koppeln (Referenz: 1600x900).
    const areaFactor = Math.max(0.5, Math.min(2, (W*H) / (1600*900)));
    const base = {rain:220, snow:130, fog:18, leaves:45, ash:70}[type] || 0;
    const count = Math.round(base * areaFactor);
    for (let i=0;i<count;i++) particles.push(_mkParticle(type, true));
  }

  function _mkParticle(type, initial){
    const x = Math.random()*W;
    const y = initial ? Math.random()*H : -10;
    switch(type){
      case "rain":   return {x,y, len: 8+Math.random()*10, vy: 9+Math.random()*6, vx: -1.5};
      case "snow":   return {x,y, r: 1.5+Math.random()*2.5, vy: 0.7+Math.random()*1.2, sway: Math.random()*Math.PI*2};
      case "fog":    return {x, y: Math.random()*H, r: 90+Math.random()*140, vx: 0.2+Math.random()*0.4, a: 0.04+Math.random()*0.06};
      case "leaves": return {x,y, r: 4+Math.random()*4, vy: 1+Math.random()*1.5, vx: -0.5-Math.random(), rot: Math.random()*6, vrot:(Math.random()-0.5)*0.1, hue: 20+Math.random()*40};
      case "ash":    return {x, y: initial?Math.random()*H:H+10, r: 1+Math.random()*2, vy: -(0.5+Math.random()*1.2), vx:(Math.random()-0.5)*0.6, a: 0.5+Math.random()*0.5};
    }
    return {x,y};
  }

  function _tick(){
    if (!ctx) return;
    ctx.clearRect(0,0,W,H);
    if (current === "none"){ raf = null; return; }

    if (current === "rain"){
      ctx.strokeStyle = "rgba(160,190,220,0.5)"; ctx.lineWidth = 1.2;
      particles.forEach(p=>{
        ctx.beginPath(); ctx.moveTo(p.x,p.y); ctx.lineTo(p.x+p.vx*1.5, p.y+p.len); ctx.stroke();
        p.x += p.vx; p.y += p.vy;
        if (p.y > H){ Object.assign(p, _mkParticle("rain", false)); }
      });
    } else if (current === "snow"){
      ctx.fillStyle = "rgba(255,255,255,0.85)";
      particles.forEach(p=>{
        p.sway += 0.02; p.x += Math.sin(p.sway)*0.6; p.y += p.vy;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
        if (p.y > H){ Object.assign(p, _mkParticle("snow", false)); }
      });
    } else if (current === "fog"){
      particles.forEach(p=>{
        const g = ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,p.r);
        g.addColorStop(0, `rgba(180,185,195,${p.a})`);
        g.addColorStop(1, "rgba(180,185,195,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
        p.x += p.vx; if (p.x - p.r > W){ p.x = -p.r; }
      });
    } else if (current === "leaves"){
      particles.forEach(p=>{
        p.x += p.vx; p.y += p.vy; p.rot += p.vrot;
        ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.rot);
        ctx.fillStyle = `hsl(${p.hue},70%,45%)`;
        ctx.beginPath(); ctx.ellipse(0,0,p.r,p.r*0.5,0,0,Math.PI*2); ctx.fill();
        ctx.restore();
        if (p.y > H){ Object.assign(p, _mkParticle("leaves", false)); }
      });
    } else if (current === "ash"){
      particles.forEach(p=>{
        p.x += p.vx; p.y += p.vy;
        ctx.fillStyle = `rgba(255,${140+Math.floor(Math.random()*60)},60,${p.a})`;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2); ctx.fill();
        if (p.y < -10){ Object.assign(p, _mkParticle("ash", false)); }
      });
    }
    raf = requestAnimationFrame(_tick);
  }

  // Effekt setzen (lokal). "none" stoppt.
  function set(type){
    current = type || "none";
    if (current === "none"){
      particles = [];
      if (ctx) ctx.clearRect(0,0,W,H);
      if (raf){ cancelAnimationFrame(raf); raf = null; }
      return;
    }
    _resize();
    _spawn(current);
    if (!raf) raf = requestAnimationFrame(_tick);
  }

  return { init, set, resize:_resize, get current(){ return current; } };
})();
