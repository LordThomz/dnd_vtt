/* ══════════════════════════════════════════════════════════════════════════
   DiceGeometry – die sieben Würfelformen als echte Körper.

   Der Kniff: Three.js liefert zwar fertige Formen (Ikosaeder usw.), aber
   dort teilen sich benachbarte Flächen die Eckpunkte. Man kann deshalb
   keine Zahl pro Fläche aufbringen.

   Hier bauen wir jede Form aus ihren Flächen selbst auf. Jede Fläche
   bekommt eigene Eckpunkte, eigene Textur-Koordinaten und eine eigene
   Materialgruppe. So trägt JEDE Seite ihre Zahl – auch die, die gerade
   unten liegt.

   Zusätzlich liefert jede Form die Daten, die die Physik-Engine braucht
   (Eckpunkte + Flächen), damit der Würfel wirklich auf seinen Kanten kippt.
   ══════════════════════════════════════════════════════════════════════════ */
const DiceGeometry = (() => {

  const PHI = (1 + Math.sqrt(5)) / 2;   // Goldener Schnitt

  // ── Vektor-Rechnung (wird schon beim Bau der Körper gebraucht) ──────────
  const sub  = (a,b) => [a[0]-b[0], a[1]-b[1], a[2]-b[2]];
  const cross= (a,b) => [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]];
  const dot  = (a,b) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  const len  = a => Math.sqrt(dot(a,a));
  const norm = a => { const l = len(a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };

  // ── Die reinen Körper: Eckpunkte + Flächen (als Eckpunkt-Indizes) ────────

  function _tetrahedron() {
    const v = [
      [ 1,  1,  1], [-1, -1,  1], [-1,  1, -1], [ 1, -1, -1],
    ];
    const f = [ [0,1,2], [0,3,1], [0,2,3], [1,3,2] ];
    return { verts: v, faces: f };
  }

  function _cube() {
    const v = [
      [-1,-1,-1], [ 1,-1,-1], [ 1, 1,-1], [-1, 1,-1],
      [-1,-1, 1], [ 1,-1, 1], [ 1, 1, 1], [-1, 1, 1],
    ];
    // Reihenfolge so, dass gegenüberliegende Seiten 7 ergeben (wie beim echten W6)
    const f = [
      [1,2,6,5],  // +X → 1
      [0,4,7,3],  // -X → 6
      [3,7,6,2],  // +Y → 2
      [0,1,5,4],  // -Y → 5
      [4,5,6,7],  // +Z → 3
      [0,3,2,1],  // -Z → 4
    ];
    return { verts: v, faces: f };
  }

  function _octahedron() {
    const v = [
      [ 1, 0, 0], [-1, 0, 0], [ 0, 1, 0],
      [ 0,-1, 0], [ 0, 0, 1], [ 0, 0,-1],
    ];
    const f = [
      [0,2,4], [2,1,4], [1,3,4], [3,0,4],
      [2,0,5], [1,2,5], [3,1,5], [0,3,5],
    ];
    return { verts: v, faces: f };
  }

  function _dodecahedron() {
    const a = 1 / PHI, b = PHI;
    const v = [
      [-1,-1,-1], [-1,-1, 1], [-1, 1,-1], [-1, 1, 1],
      [ 1,-1,-1], [ 1,-1, 1], [ 1, 1,-1], [ 1, 1, 1],
      [ 0,-a,-b], [ 0,-a, b], [ 0, a,-b], [ 0, a, b],
      [-a,-b, 0], [-a, b, 0], [ a,-b, 0], [ a, b, 0],
      [-b, 0,-a], [ b, 0,-a], [-b, 0, a], [ b, 0, a],
    ];
    // Die Flächen leiten wir aus der Form selbst her (siehe _facesFromHull):
    // Für jede Ebene, auf der mehrere Eckpunkte liegen, entsteht eine Fläche.
    // Das ist zuverlässiger, als die Flächen von Hand einzutragen.
    return { verts: v, faces: _facesFromHull(v, 5) };
  }

  /**
   * Findet die Flächen eines konvexen Körpers aus seinen Eckpunkten.
   *
   * Vorgehen: Für je drei Eckpunkte wird die Ebene durch sie bestimmt. Liegen
   * ALLE anderen Punkte auf einer Seite dieser Ebene, ist es eine echte
   * Außenfläche. Alle Punkte, die auf der Ebene liegen, gehören dazu.
   * Am Ende werden die Eckpunkte jeder Fläche ringförmig geordnet.
   *
   * @param {Array} verts    die Eckpunkte
   * @param {number} minSize wie viele Ecken eine Fläche mindestens hat
   */
  function _facesFromHull(verts, minSize = 3) {
    const EPS = 1e-6;
    const seen = new Set();
    const faces = [];
    const N = verts.length;

    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        for (let k = j + 1; k < N; k++) {
          const p0 = verts[i], p1 = verts[j], p2 = verts[k];
          let n = cross(sub(p1, p0), sub(p2, p0));
          if (len(n) < EPS) continue;          // Punkte liegen auf einer Linie
          n = norm(n);
          const d = dot(n, p0);

          // Liegen alle anderen Punkte auf EINER Seite?
          let above = 0, below = 0;
          const onPlane = [];
          for (let m = 0; m < N; m++) {
            const s = dot(n, verts[m]) - d;
            if (s >  EPS) above++;
            else if (s < -EPS) below++;
            else onPlane.push(m);
          }
          if (above > 0 && below > 0) continue;     // Ebene schneidet den Körper
          if (onPlane.length < minSize) continue;   // zu wenig Punkte

          // Normale nach außen drehen
          const outward = (below > 0) ? n : [-n[0], -n[1], -n[2]];

          // Doppelte Flächen überspringen
          const key = onPlane.slice().sort((x, y) => x - y).join(",");
          if (seen.has(key)) continue;
          seen.add(key);

          faces.push(_orderRing(verts, onPlane, outward));
        }
      }
    }
    return faces;
  }

  /** Ordnet die Eckpunkte einer Fläche im Kreis (gegen den Uhrzeigersinn
   *  von außen gesehen), damit daraus ein sauberes Vieleck wird. */
  function _orderRing(verts, idxs, normal) {
    const pts = idxs.map(i => verts[i]);
    const c = pts.reduce((a, p) => [a[0]+p[0], a[1]+p[1], a[2]+p[2]], [0,0,0])
                 .map(x => x / pts.length);
    const e1 = norm(sub(pts[0], c));
    const e2 = norm(cross(normal, e1));
    return idxs
      .map((i, k) => {
        const r = sub(pts[k], c);
        return { i, ang: Math.atan2(dot(r, e2), dot(r, e1)) };
      })
      .sort((x, y) => x.ang - y.ang)
      .map(x => x.i);
  }

  function _icosahedron() {
    const v = [
      [-1, PHI, 0], [ 1, PHI, 0], [-1,-PHI, 0], [ 1,-PHI, 0],
      [ 0,-1, PHI], [ 0, 1, PHI], [ 0,-1,-PHI], [ 0, 1,-PHI],
      [ PHI, 0,-1], [ PHI, 0, 1], [-PHI, 0,-1], [-PHI, 0, 1],
    ];
    const f = [
      [ 0,11, 5], [ 0, 5, 1], [ 0, 1, 7], [ 0, 7,10], [ 0,10,11],
      [ 1, 5, 9], [ 5,11, 4], [11,10, 2], [10, 7, 6], [ 7, 1, 8],
      [ 3, 9, 4], [ 3, 4, 2], [ 3, 2, 6], [ 3, 6, 8], [ 3, 8, 9],
      [ 4, 9, 5], [ 2, 4,11], [ 6, 2,10], [ 8, 6, 7], [ 9, 8, 1],
    ];
    return { verts: v, faces: f };
  }

  /** Pentagonales Trapezoeder – die klassische W10-Form mit 10 Drachenflächen.
   *
   *  Aufbau: zwei Spitzen (oben/unten) und zehn Punkte auf einem Ring, deren
   *  Höhe abwechselnd nach oben und unten versetzt ist.
   *
   *  Damit die Drachenflächen EBEN werden, müssen Ringhöhe und Spitzenhöhe
   *  in einem festen Verhältnis stehen:
   *
   *      Spitze = Ringhöhe · (5 + 2·√5)   ≈ Ringhöhe · 9,472
   *
   *  Die Ringhöhe bestimmt damit die Form: Je kleiner sie ist, desto flacher
   *  und gedrungener wird der Würfel. Mit 0,105 kommt die Höhe etwa der
   *  Breite gleich – genau wie beim echten W10.
   *  (Vorher war sie 0,16 – dadurch war der Würfel viel zu spitz.) */
  function _trapezohedron() {
    const n = 5;                                     // fünf Flächenpaare
    const ringY = 0.105;                             // flach wie ein echter W10
    const apexY = ringY * (5 + 2 * Math.sqrt(5));    // exakt, sonst wird er beulig

    const verts = [];
    verts.push([0,  apexY, 0]);   // 0: obere Spitze
    verts.push([0, -apexY, 0]);   // 1: untere Spitze
    for (let i = 0; i < 2 * n; i++) {
      const ang = (i / (2 * n)) * Math.PI * 2;
      const y = (i % 2 === 0) ? ringY : -ringY;
      verts.push([Math.cos(ang), y, Math.sin(ang)]);
    }

    const faces = [];
    for (let i = 0; i < 2 * n; i++) {
      const a = 2 + i;
      const b = 2 + ((i + 1) % (2 * n));
      const c = 2 + ((i + 2) % (2 * n));
      if (i % 2 === 0) faces.push([0, a, b, c]);   // an der oberen Spitze
      else             faces.push([1, c, b, a]);   // an der unteren Spitze
    }
    return { verts, faces };
  }

  const SHAPES = {
    4:  _tetrahedron,
    6:  _cube,
    8:  _octahedron,
    10: _trapezohedron,
    12: _dodecahedron,
    20: _icosahedron,
    // Der W100 (Prozentwürfel) hat dieselbe Form wie der W10 – ein
    // pentagonales Trapezoeder mit zehn Flächen. Nur die Beschriftung ist
    // anders (00, 10, 20 … 90); die macht dice-material.js.
    100: _trapezohedron,
  };

  // ── Hilfsrechnungen ─────────────────────────────────────────────────────

  /** Skaliert alle Eckpunkte so, dass der Körper den gewünschten Radius hat. */
  function _scaleToRadius(verts, radius) {
    const maxLen = Math.max(...verts.map(len));
    const f = radius / (maxLen || 1);
    return verts.map(v => [v[0]*f, v[1]*f, v[2]*f]);
  }

  /** Echte Flächennormale (nach außen), aus dem Kreuzprodukt.
   *
   *  FRÜHERER FEHLER: Hier stand normalize(Flächenmittelpunkt). Bei den
   *  regelmäßigen Körpern ist das zufällig dasselbe – beim W10/W100
   *  (Drachenflächen) weicht es aber um 19,5° ab. Die Ergebnis-Erkennung und
   *  das Einrasten haben den Würfel dadurch aktiv auf eine Kante gekippt. */
  function _faceNormal(pts) {
    let n = [0, 0, 0];
    // Newell-Verfahren: robust auch bei Vier- und Fünfecken
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      n[0] += (a[1] - b[1]) * (a[2] + b[2]);
      n[1] += (a[2] - b[2]) * (a[0] + b[0]);
      n[2] += (a[0] - b[0]) * (a[1] + b[1]);
    }
    n = norm(n);
    const c = pts.reduce((a,p) => [a[0]+p[0], a[1]+p[1], a[2]+p[2]], [0,0,0]);
    if (dot(n, c) < 0) n = [-n[0], -n[1], -n[2]];
    return n;
  }

  /** Abstand eines 2D-Punkts zur Geraden a–b. */
  function _distToEdge(px, py, a, b) {
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const el = Math.hypot(ex, ey) || 1;
    return Math.abs(ex * (a[1] - py) - ey * (a[0] - px)) / el;
  }

  /** Inkreis-Mittelpunkt eines konvexen 2D-Vielecks: der Punkt mit dem
   *  größten Mindestabstand zu allen Kanten. Bei regelmäßigen Flächen ist
   *  das die Mitte; bei den Drachenflächen des W10 liegt er deutlich im
   *  breiten Teil – genau dort, wo auf echten W10 die Zahl sitzt. */
  function _incenter(flat) {
    const minDist = (x, y) => {
      let m = Infinity;
      for (let i = 0; i < flat.length; i++)
        m = Math.min(m, _distToEdge(x, y, flat[i], flat[(i + 1) % flat.length]));
      return m;
    };
    let bx = flat.reduce((s,p) => s + p[0], 0) / flat.length;
    let by = flat.reduce((s,p) => s + p[1], 0) / flat.length;
    let best = minDist(bx, by);
    let step = Math.max(...flat.map(p => Math.hypot(p[0]-bx, p[1]-by))) * 0.25;
    // Einfaches Muster-Suchverfahren – für ein Vieleck mehr als genau genug
    for (let it = 0; it < 60 && step > 1e-6; it++) {
      let moved = false;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1],[.7,.7],[-.7,.7],[.7,-.7],[-.7,-.7]]) {
        const d = minDist(bx + dx*step, by + dy*step);
        if (d > best + 1e-12) { best = d; bx += dx*step; by += dy*step; moved = true; break; }
      }
      if (!moved) step *= 0.5;
    }
    return { x: bx, y: by, r: best };
  }

  /** Beschriftung je Fläche so vergeben, dass gegenüberliegende Flächen
   *  zusammen immer dieselbe Summe ergeben – wie bei echten Würfeln
   *  (W6: 7, W8: 9, W12: 13, W20: 21, W10: 9, W100: 90).
   *  Gibt die ZAHLENWERTE je Flächenindex zurück (W10: 0–9, W100: 0–90). */
  function _faceValues(sides, normals) {
    const n = normals.length;
    const pairOf = new Array(n).fill(-1);
    for (let i = 0; i < n; i++) {
      if (pairOf[i] >= 0) continue;
      let best = -1, bestD = Infinity;
      for (let j = 0; j < n; j++) {
        if (j === i || pairOf[j] >= 0) continue;
        const d = dot(normals[i], normals[j]);
        if (d < bestD) { bestD = d; best = j; }
      }
      if (best < 0) { pairOf[i] = i; continue; }
      pairOf[i] = best; pairOf[best] = i;
    }
    // Werte-Reihe des Würfels (aufsteigend)
    const series = (sides === 100) ? Array.from({length: 10}, (_, i) => i * 10)
                 : (sides === 10)  ? Array.from({length: 10}, (_, i) => i)
                 : Array.from({length: n}, (_, i) => i + 1);
    const values = new Array(n).fill(null);
    // W10/W100: wie beim echten Würfel stehen um die obere Spitze die geraden,
    // um die untere die ungeraden Zahlen (Gegenseite ergibt immer 9 bzw. 90).
    if (sides === 10 || sides === 100) {
      const step = (sides === 100) ? 10 : 1;
      const upper = normals.map((nv, i) => ({ i, nv })).filter(o => o.nv[1] > 0)
        .sort((p, q) => Math.atan2(p.nv[2], p.nv[0]) - Math.atan2(q.nv[2], q.nv[0]));
      upper.forEach((o, k) => {
        values[o.i] = (2 * k) * step;
        values[pairOf[o.i]] = (9 - 2 * k) * step;
      });
      if (values.every(v => v !== null)) return values;
      values.fill(null);
    }
    // Paare verteilen: kleinster + größter Wert, zweitkleinster + zweitgrößter …
    // Abwechselnd „oben"/„unten" vergeben, damit hohe und niedrige Zahlen
    // gleichmäßig über den Körper verteilt sind.
    let lo = 0, hi = series.length - 1, k = 0;
    for (let i = 0; i < n; i++) {
      if (values[i] !== null) continue;
      const j = pairOf[i];
      if (k % 2 === 0) { values[i] = series[lo]; values[j] = series[hi]; }
      else             { values[i] = series[hi]; values[j] = series[lo]; }
      lo++; hi--; k++;
    }
    return values;
  }

  // «STELLSCHRAUBE» Breite der abgerundeten Kanten (Anteil am Radius).
  // 0 = scharfe Kanten wie früher. Nur Darstellung – die Physik bleibt exakt.
  // Einstellungen → Grafik → „Abgerundete Kanten" (aus = scharfe Kanten)
  const BEVEL_FRAC = (() => { try { return JSON.parse(localStorage.getItem("vtt_settings") || "{}") || {}; } catch (e) { return {}; } })().diceBevel === false ? 0 : 0.045;

  // Zwischenspeicher: Geometrie wird pro Würfelform nur einmal gerechnet.
  const _cache = new Map();

  /**
   * Baut die Three.js-Geometrie.
   * Jede Fläche wird einzeln vernetzt (eigene Eckpunkte + UV + Materialgruppe),
   * damit auf jeder Seite eine eigene Zahl liegen kann.
   *
   * TEXTUR-LAYOUT (neu): Die Textur deckt jetzt die GANZE Fläche ab (Umkreis
   * um den Inkreis-Mittelpunkt), nicht mehr nur den Inkreis. Vorher lagen die
   * Ecken der Fläche außerhalb der Textur und bekamen gestreckte Randpixel ab.
   * Jetzt kennt die Materialseite den genauen Umriss jeder Fläche (layout) und
   * kann Kanten, Rahmen und Zahlen exakt darauf zeichnen.
   *
   * Rückgabe-Objekt ist geteilt (Cache) – NICHT verändern und NICHT disposen.
   */
  function build(sides, radius = 2.0) {
    const key = sides + "|" + radius;
    if (_cache.has(key)) return _cache.get(key);

    const shapeFn = SHAPES[sides] || SHAPES[20];
    const raw = shapeFn();
    const verts = _scaleToRadius(raw.verts, radius);
    const faces = raw.faces;

    const positions = [], normals = [], uvs = [];
    const groups = [];
    const layout = [];      // je Fläche: {poly:[[u,v]…], cx, cy, inR, cornerIds}
    const faceNormals = [];
    const insetByFace = [];   // je Fläche: versetzte Ecken (für Kantenstreifen)
    const BEVEL = radius * BEVEL_FRAC;
    const textUps = [];     // „oben" der Zahl je Fläche (Körper-Koordinaten)
    let vertexCount = 0;

    faces.forEach((face, faceIndex) => {
      // Eckpunkte immer gegen den Uhrzeigersinn (von außen) – sonst wären die
      // Zahlen gespiegelt.
      let f = [...face];
      let pts = f.map(i => verts[i]);
      const nTest = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
      const cTest = pts.reduce((a,p) => [a[0]+p[0], a[1]+p[1], a[2]+p[2]], [0,0,0]);
      if (dot(nTest, cTest) < 0) { f.reverse(); pts = f.map(i => verts[i]); }

      const n = _faceNormal(pts);
      faceNormals.push(n);
      const center = pts.reduce((acc,p) => [acc[0]+p[0], acc[1]+p[1], acc[2]+p[2]], [0,0,0])
                        .map(c => c / pts.length);

      // Leserichtung der Zahl („oben" = e2):
      //   Vierecke (W6)          → zur Kantenmitte (Zahl steht gerade)
      //   Drei-/Fünfecke, Drachen → zu einer Ecke (so wie auf echten Würfeln;
      //                            beim W10 zur Spitze des Drachens)
      let upDir;
      if (pts.length === 4 && sides === 6) {
        upDir = sub([(pts[0][0]+pts[1][0])/2, (pts[0][1]+pts[1][1])/2, (pts[0][2]+pts[1][2])/2], center);
      } else if (sides === 10 || sides === 100) {
        // Spitze = der Eckpunkt mit dem größten Abstand vom Mittelpunkt
        const apexIdx = pts.reduce((bi, p, i) =>
          len(sub(p, center)) > len(sub(pts[bi], center)) ? i : bi, 0);
        upDir = sub(pts[apexIdx], center);
      } else {
        upDir = sub(pts[0], center);
      }
      // Auf die Flächenebene projizieren
      upDir = sub(upDir, n.map(x => x * dot(upDir, n)));
      const e2 = norm(upDir);
      const e1 = norm(cross(e2, n));   // e1 × e2 = n  → rechtshändig, nicht gespiegelt

      const flat0 = pts.map(p => { const d = sub(p, center); return [dot(d, e1), dot(d, e2)]; });
      const inc = _incenter(flat0);
      const flat = flat0.map(([x, y]) => [x - inc.x, y - inc.y]);

      // Quadrat um den Inkreis-Mittelpunkt, das die ganze Fläche enthält
      const half = Math.max(...flat.map(p => Math.max(Math.abs(p[0]), Math.abs(p[1])))) * 1.02;
      const uv = flat.map(([x, y]) => [0.5 + x / (2 * half), 0.5 + y / (2 * half)]);

      textUps.push(e2);
      layout.push({
        poly: uv.map(q => [q[0], q[1]]),   // Umriss in UV (v nach oben!)
        inR: inc.r / (2 * half),            // Inkreis-Radius in UV-Einheiten
        cornerIds: [...f],
      });

      // ── Abgerundete Kanten: Fläche um BEVEL nach innen versetzen ──────
      // Jede Kante der Fläche wird in der Flächenebene um BEVEL nach innen
      // geschoben; die neuen Ecken sind die Schnittpunkte benachbarter Kanten.
      const m = flat0.length;
      const inset2d = flat0.map((_, k) => {
        const lineAt = j => {        // nach innen versetzte Kante j (Punkt + Richtung)
          const A = flat0[j], B = flat0[(j + 1) % m];
          const dx = B[0] - A[0], dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1;
          const nx = -dy / L, ny = dx / L;                // Linksnormale = nach innen (CCW)
          return { px: A[0] + nx * BEVEL, py: A[1] + ny * BEVEL, dx, dy };
        };
        const l1 = lineAt((k - 1 + m) % m), l2 = lineAt(k);
        const det = l1.dx * l2.dy - l1.dy * l2.dx;
        if (Math.abs(det) < 1e-9) return flat0[k];
        const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / det;
        return [l1.px + l1.dx * t, l1.py + l1.dy * t];
      });
      const to3d = ([x, y]) => [center[0] + e1[0] * x + e2[0] * y, center[1] + e1[1] * x + e2[1] * y, center[2] + e1[2] * x + e2[2] * y];
      const ipts = BEVEL > 0 ? inset2d.map(to3d) : pts;
      const iuv = BEVEL > 0 ? inset2d.map(([x, y]) => [0.5 + (x - inc.x) / (2 * half), 0.5 + (y - inc.y) / (2 * half)]) : uv;
      insetByFace.push({ ids: [...f], pts: ipts, n });

      const startVertex = vertexCount;
      for (let i = 1; i < ipts.length - 1; i++) {
        [0, i, i + 1].forEach(k => {
          positions.push(ipts[k][0], ipts[k][1], ipts[k][2]);
          normals.push(n[0], n[1], n[2]);
          uvs.push(iuv[k][0], iuv[k][1]);
          vertexCount++;
        });
      }
      groups.push({ start: startVertex, count: vertexCount - startVertex, materialIndex: faceIndex });
    });

    // ── Kantenstreifen und Eckkappen (eigenes Material: Index faces.length) ─
    // Die Normalen gehen von der einen Fläche zur nächsten über – dadurch
    // wirkt der schmale Streifen beim Licht wie eine gerundete Kante.
    if (BEVEL > 0) {
      const start = vertexCount;
      const tri = (a, na, b, nb, c, nc) => {
        // Außenseite sicherstellen (Dreiecksnormale zeigt vom Mittelpunkt weg)
        const tn = cross(sub(b, a), sub(c, a));
        const mid = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
        if (dot(tn, mid) < 0) { [b, c] = [c, b]; [nb, nc] = [nc, nb]; }
        [[a, na], [b, nb], [c, nc]].forEach(([p, q]) => {
          positions.push(p[0], p[1], p[2]); normals.push(q[0], q[1], q[2]); uvs.push(0.5, 0.5); vertexCount++;
        });
      };
      const edgeMap = new Map();     // "a|b" → [{face, pa, pb}]
      insetByFace.forEach((F, fi) => {
        F.ids.forEach((a, k) => {
          const b = F.ids[(k + 1) % F.ids.length];
          const key = a < b ? a + "|" + b : b + "|" + a;
          const e = { fi, ids: [a, b], pts: [F.pts[k], F.pts[(k + 1) % F.ids.length]], n: F.n };
          (edgeMap.get(key) || edgeMap.set(key, []).get(key)).push(e);
        });
      });
      edgeMap.forEach(list => {
        if (list.length !== 2) return;
        const [A, B] = list;
        // gleiche Eckpunkt-Reihenfolge herstellen
        const bA = B.ids[0] === A.ids[0] ? B.pts : [B.pts[1], B.pts[0]];
        tri(A.pts[0], A.n, A.pts[1], A.n, bA[1], B.n);
        tri(A.pts[0], A.n, bA[1], B.n, bA[0], B.n);
      });
      // Eckkappen: alle versetzten Ecken um einen Original-Eckpunkt herum
      verts.forEach((v, vi) => {
        const ring = [];
        insetByFace.forEach(F => { const k = F.ids.indexOf(vi); if (k >= 0) ring.push({ p: F.pts[k], n: F.n }); });
        if (ring.length < 3) return;
        const vn = norm(v);
        const c = ring.reduce((acc, r) => [acc[0] + r.p[0], acc[1] + r.p[1], acc[2] + r.p[2]], [0, 0, 0]).map(x => x / ring.length);
        // Ring um die Eck-Richtung sortieren
        const ax = norm(sub(ring[0].p, c)), ay = cross(vn, ax);
        ring.sort((r1, r2) => { const d1 = sub(r1.p, c), d2 = sub(r2.p, c);
          return Math.atan2(dot(d1, ay), dot(d1, ax)) - Math.atan2(dot(d2, ay), dot(d2, ax)); });
        ring.forEach((r, k) => { const r2 = ring[(k + 1) % ring.length]; tri(c, vn, r.p, r.n, r2.p, r2.n); });
      });
      groups.push({ start, count: vertexCount - start, materialIndex: faces.length });
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal",   new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute("uv",       new THREE.Float32BufferAttribute(uvs, 2));
    groups.forEach(g => geo.addGroup(g.start, g.count, g.materialIndex));
    geo.computeBoundingSphere();

    // Werte je Fläche (W4: je ECKE – dort steht die Zahl oben an der Spitze)
    const values = (sides === 4)
      ? verts.map((_, i) => i + 1)
      : _faceValues(sides, faceNormals);

    const faceData = faces.map((face, fi) => ({
      normal: faceNormals[fi],
      up: textUps[fi],
      cornerIds: layout[fi].cornerIds,
    }));

    const result = {
      sides,
      geometry: geo,
      faceCount: faces.length,
      bevel: BEVEL > 0,         // es gibt eine zusätzliche Materialgruppe (Index faceCount)
      faces: faceData,        // je Fläche: echte Normale + Ecken
      corners: verts,         // Eckpunkte (für W4 und Symmetrie-Suche)
      layout,                 // Umriss je Fläche in der Textur
      values,                 // W4: Wert je Ecke, sonst Wert je Fläche
      physics: { verts, faces },
    };
    _cache.set(key, result);
    return result;
  }

  /**
   * Die Merkmals-Richtungen, an denen das Ergebnis abgelesen wird:
   *   W4 → Richtungen der Ecken (die Ecke oben zählt)
   *   sonst → Flächennormalen (die Fläche oben zählt)
   */
  function features(sides, radius = 2.0) {
    const g = build(sides, radius);
    if (sides === 4) return g.corners.map(v => norm(v));
    return g.faces.map(f => f.normal);
  }

  /**
   * Symmetrie-Drehung finden, die Merkmal `from` auf Merkmal `to` abbildet
   * UND den ganzen Körper auf sich selbst (alle Ecken landen wieder auf Ecken).
   *
   * Das ist der Kern des „ehrlichen Würfelns": Weil der Körper unter dieser
   * Drehung gleich aussieht, können wir die aufgezeichnete Physik exakt
   * abspielen und nur die BESCHRIFTUNG mitdrehen – der Würfel rollt genau so,
   * wie die Physik es berechnet hat, und zeigt am Ende trotzdem den
   * vorgegebenen Wert. Kein Einrasten, kein Ruck.
   *
   * @returns {number[]|null} 3×3-Matrix (zeilenweise) oder null
   */
  const _symCache = new Map();
  /** ALLE Symmetrie-Drehungen, die Merkmal `from` auf `to` abbilden und den
   *  Körper auf sich selbst (beim W12 z.B. 5 Stück – um die Flächennormale
   *  gedreht). dice3d.js wählt daraus die, bei der die Zahl am Ende am
   *  geradesten zum Betrachter steht. */
  function symmetries(sides, from, to, radius = 2.0) {
    const key = sides + ":" + from + ">" + to;
    if (_symCache.has(key)) return _symCache.get(key);
    const g = build(sides, radius);
    const feats = features(sides, radius);
    const V = g.corners;
    const a = feats[from], b = feats[to];
    const perp = (v, axis) => sub(v, axis.map(x => x * dot(v, axis)));
    const ref = V.find(v => len(perp(v, a)) > 1e-3);
    const ra = norm(perp(ref, a));
    const frameA = [a, ra, cross(a, ra)];
    const found = [];
    for (const c of V) {
      const pc = perp(c, b);
      if (len(pc) < 1e-3) continue;
      if (Math.abs(dot(c, b) - dot(ref, a)) > 1e-4) continue;
      const rb = norm(pc);
      const frameB = [b, rb, cross(b, rb)];
      const R = [0,0,0, 0,0,0, 0,0,0];
      for (let k = 0; k < 3; k++)
        for (let r = 0; r < 3; r++)
          for (let s2 = 0; s2 < 3; s2++) R[r*3+s2] += frameB[k][r] * frameA[k][s2];
      const apply = v => [R[0]*v[0]+R[1]*v[1]+R[2]*v[2], R[3]*v[0]+R[4]*v[1]+R[5]*v[2], R[6]*v[0]+R[7]*v[1]+R[8]*v[2]];
      const ok = V.every(v => { const w = apply(v); return V.some(u => len(sub(u, w)) < 1e-4); });
      if (ok && !found.some(F => F.every((x, i) => Math.abs(x - R[i]) < 1e-6))) found.push(R);
    }
    _symCache.set(key, found);
    return found;
  }
  /** Eine (die erste) passende Symmetrie – für ältere Aufrufer. */
  function symmetry(sides, from, to, radius = 2.0) {
    return symmetries(sides, from, to, radius)[0] || null;
  }

  /** Physik-Körper (ConvexPolyhedron) aus denselben Daten. */
  function buildPhysicsShape(sides, radius = 2.0) {
    const shapeFn = SHAPES[sides] || SHAPES[20];
    const raw = shapeFn();
    const verts = _scaleToRadius(raw.verts, radius);

    // WICHTIG: cannon-es' ConvexPolyhedron braucht Flächen, deren Eckpunkte
    // GEGEN den Uhrzeigersinn (von außen gesehen) angeordnet sind – sonst zeigt
    // die berechnete Flächennormale nach INNEN und die Kollision wird falsch
    // (der Würfel "buggt"/springt). Das betraf besonders W4, W10 und W100.
    //
    // Deshalb prüfen wir jede Fläche: Zeigt ihre Normale vom Mittelpunkt weg?
    // Wenn nicht, drehen wir die Reihenfolge der Eckpunkte um.
    const faces = raw.faces.map(f => {
      const pts = f.map(i => verts[i]);
      // Flächennormale aus den ersten drei Punkten
      const n = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
      // Mittelpunkt der Fläche (zeigt vom Ursprung nach außen)
      const c = pts.reduce((a, p) => [a[0]+p[0], a[1]+p[1], a[2]+p[2]], [0,0,0])
                   .map(x => x / pts.length);
      // Zeigt die Normale in dieselbe Richtung wie der Mittelpunkt (= nach außen)?
      const face = [...f];
      if (dot(n, c) < 0) face.reverse();   // nach innen → umdrehen
      return face;
    });

    return new CANNON.ConvexPolyhedron({
      vertices: verts.map(v => new CANNON.Vec3(v[0], v[1], v[2])),
      faces: faces,
    });
  }

  return { build, buildPhysicsShape, features, symmetry, symmetries, SIDES: Object.keys(SHAPES).map(Number) };
})();
