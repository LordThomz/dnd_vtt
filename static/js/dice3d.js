/* ════════════════════════════════════════════════════════════════════════
   DICE3D – Eigene 3D-Würfel-Engine des VTT  (Version 3, „ehrlich vorberechnet")
   ════════════════════════════════════════════════════════════════════════

   ÜBERBLICK
   ─────────
     • dice-geometry.js – die sieben Würfelformen als echte Körper, dazu die
                          Beschriftung je Fläche und die Symmetrie-Drehungen.
     • dice-material.js – zeichnet jede Fläche (Zahl, Muster, Rahmen, Kanten)
                          und baut die Materialien (zwischengespeichert).
     • dice-sound.js    – Aufprallgeräusche.
     • dice3d.js        – DIESE DATEI: Simulation, Abspielen, Bühne, Popup,
                          Werkstatt-Vorschau und die Schnittstelle `Dice3D`.

   SO FUNKTIONIERT EIN WURF
   ────────────────────────
   1. Der SERVER würfelt (echter Zufall) und schickt allen die Zahlen + einen
      Startwert (seed) für die Wurfbewegung.
   2. Jeder Client SIMULIERT den Wurf unsichtbar komplett durch (cannon-es,
      fester Zeitschritt, dauert wenige Millisekunden) und zeichnet jede
      Position/Drehung auf. Landet ein Würfel schief oder kommt nicht zur
      Ruhe, wird der Versuch verworfen und neu gerechnet.
   3. Aus der Aufzeichnung ergibt sich, welche Fläche oben liegen WIRD. Mit
      einer Symmetrie-Drehung des Körpers (DiceGeometry.symmetry) wird die
      Beschriftung so gedreht, dass genau die Server-Zahl an dieser Stelle
      steht. Weil der Körper unter dieser Drehung identisch aussieht, bleibt
      die Bewegung 1:1 die berechnete Physik – kein Einrasten, kein Ruck.
   4. Die Aufzeichnung wird in Echtzeit abgespielt, mit Geräuschen an den
      aufgezeichneten Aufprall-Zeitpunkten. Danach erscheint das Ergebnis.

   Ohne vorgegebene Zahl (Werkstatt-Testwurf) gilt einfach, was fällt.

   ÖFFENTLICHE SCHNITTSTELLE (Abschnitt 10):
     Dice3D.roll(diceList, meta, onComplete, opts)
         diceList  [{sides, value?}]   value = Zielzahl (W100 als 1–100 →
                                        wird automatisch zu Zehner- + Einerwürfel)
         meta      {total?, formula?, label?, parts?}  für das Ergebnis-Popup
         onComplete(results)            wenn alle Würfel liegen
         opts      {seed?, suppressPopup?}
     Dice3D.preview(sides, style, canvas) / stopPreview(canvas)
     Dice3D.testRoll(sides)
     Dice3D.showFinalResult({total, formula, label})
     Dice3D.getSets / getActiveSet / setActiveSet / saveSet / deleteSet / newSet
     Dice3D.setEnabled / isEnabled / preload
   ════════════════════════════════════════════════════════════════════════ */

const Dice3D = (() => {
  "use strict";

  // ══════════════════════════════════════════════════════════════════════
  //  0) STELLSCHRAUBEN – die wichtigsten Werte an einem Ort
  // ══════════════════════════════════════════════════════════════════════

  const DIE_RADIUS   = 2.1;    // «STELLSCHRAUBE» Grundgröße eines Würfels (Weltmaß)
  const GRAVITY      = -60;    // «STELLSCHRAUBE» Schwerkraft (negativer = schnelleres Fallen)
  const SIM_HZ       = 120;    // Physik-Takt (Schritte pro Sekunde, fest → reproduzierbar)
  const MAX_SIM_S    = 7;      // «STELLSCHRAUBE» längste erlaubte Wurfdauer (Sekunden)
  const REST_S       = 0.25;   // so lange müssen alle Würfel ruhen, dann ist Schluss
  const FLAT_DOT     = 0.997;  // Mindest-„Flachheit" (1 = perfekt waagerecht)
  const MAX_TRIES    = 8;      // wie oft notfalls neu gerechnet wird
  const CAM_FOV      = 38;     // «STELLSCHRAUBE» Blickwinkel der Wurfkamera
  const CAM_THROW_Y  = 42;     // «STELLSCHRAUBE» Kamerahöhe (kleiner = Würfel größer)
  const CAM_THROW_Z  = 10;     // leichte Neigung der Wurf-Kamera
  const EDGE_MARGIN  = 0.6;    // Abstand der unsichtbaren Wände zum Bildrand (Weltmaß)
  const HOLD_MS      = 5200;   // «STELLSCHRAUBE» wie lange die Würfel nach dem Wurf liegen bleiben
  const HOLD_QUEUE_MS= 1300;   //   … wenn schon der nächste Wurf wartet
  const FADE_MS      = 420;    // Ausblenden

  // Standard-Aussehen eines Würfels. Jede dieser Eigenschaften kann pro Würfel
  // im "Set" überschrieben werden (siehe Abschnitt 1, Sets/Styles).
  const DEFAULT_DIE_STYLE = {
    surface:     "plastic",                     // Oberfläche (siehe dice-material SURFACES)
    color:       "#c8a24a",                     // Grundfarbe des Würfels
    color2:      null,                          // optionale Zweitfarbe (Verlauf)
    numberColor: null,                          // Zahlenfarbe (null = automatisch je nach Helligkeit)
    accentColor: "#ffffff",                     // Akzentfarbe für Muster
    pattern:     "none",                        // Muster (siehe dice-material PATTERNS)
    font:        "'Cinzel', Georgia, serif",    // Schriftart der Zahlen
    numberScale: 1.0,                           // Zahlengröße (1 = normal)
    numberOutline: 0.08,                        // Umrandungsdicke der Zahl (0 = keine)
    outlineColor: null,                         // Farbe der Zahl-Umrandung
    border:      "none",                        // Flächenrand: none | solid | glow | dashed
    borderColor: "#f0d79c",
    borderWidth: 8,
    edges:       "none",                        // Kantenfärbung: none | subtle | bold
    edgeColor:   "#f0d79c",
    numberGlow:  0,                             // Zahlen leuchten (0 = aus … 1 = stark)
  };


  // ══════════════════════════════════════════════════════════════════════
  //  1) SETS & STYLES – Verwaltung des Aussehens (localStorage)
  //
  //  Ein "Set" bündelt das Aussehen aller sieben Würfel. Man kann mehrere
  //  Sets anlegen (z.B. "Feuer", "Eis") und zwischen ihnen wechseln.
  // ══════════════════════════════════════════════════════════════════════

  const SIDES_LIST = [4, 6, 8, 10, 12, 20, 100];
  let _sets = null, _activeSetId = null;

  function _defaultSet(name) {
    const per = {};
    SIDES_LIST.forEach(s => { per[s] = Object.assign({}, DEFAULT_DIE_STYLE); });
    return { id: "set_default", name: name || "Standard", dice: per };
  }
  function _loadSets() {
    try {
      const raw = window.localStorage.getItem("vtt_dice_sets");
      if (raw) {
        const data = JSON.parse(raw);
        if (data && Array.isArray(data.sets) && data.sets.length) {
          _sets = data.sets;
          _activeSetId = data.activeId || data.sets[0].id;
          // Fehlende Würfelgrößen in alten Sets ergänzen (Vorwärtskompatibilität)
          _sets.forEach(set => {
            SIDES_LIST.forEach(s => {
              if (!set.dice[s]) set.dice[s] = Object.assign({}, DEFAULT_DIE_STYLE);
            });
          });
          return;
        }
      }
    } catch (e) {}
    _sets = [_defaultSet()];
    _activeSetId = _sets[0].id;
  }
  function _saveSets() {
    try {
      window.localStorage.setItem("vtt_dice_sets",
        JSON.stringify({ sets: _sets, activeId: _activeSetId }));
    } catch (e) {}
  }
  function getSets()       { if (!_sets) _loadSets(); return _sets; }
  /** Nur die im Launcher nicht ausgeblendeten Sets (das aktive immer dabei). */
  function getVisibleSets(){ const all = getSets(); const v = all.filter(s => !s.hidden || s.id === _activeSetId); return v.length ? v : all; }
  function getActiveSet()  { if (!_sets) _loadSets(); return _sets.find(s => s.id === _activeSetId) || _sets[0]; }
  function setActiveSet(id){ if (!_sets) _loadSets(); if (_sets.some(s => s.id === id)) { _activeSetId = id; _saveSets(); } }
  function saveSet(set)    { if (!_sets) _loadSets(); const i = _sets.findIndex(s => s.id === set.id); if (i > -1) _sets[i] = set; else _sets.push(set); _saveSets(); }
  function deleteSet(id)   { if (!_sets) _loadSets(); if (_sets.length <= 1) return false; _sets = _sets.filter(s => s.id !== id); if (_activeSetId === id) _activeSetId = _sets[0].id; _saveSets(); return true; }
  function newSet(name)    { const set = _defaultSet(name || "Neues Set"); set.id = "set_" + Date.now().toString(36); saveSet(set); return set; }

  // Aussehen für eine bestimmte Würfelgröße aus dem aktiven Set holen.
  function _styleFor(sides) {
    const set = getActiveSet();
    return (set.dice && set.dice[sides]) || (set.dice && set.dice[20]) || DEFAULT_DIE_STYLE;
  }
  function getStyle()  { return Object.assign({}, _styleFor(20)); }
  function setStyle(s) { const set = getActiveSet(); Object.keys(set.dice).forEach(k => { set.dice[k] = Object.assign({}, set.dice[k], s); }); saveSet(set); }


  // ── Würfel-Vorlagen ────────────────────────────────────────────────────
  // Fertige Looks, die man mit einem Klick als eigenes Set übernimmt und
  // danach in der Werkstatt frei weiter anpassen kann. Die Komplett-Designs
  // (theme.js → COMBOS) verweisen per id auf diese Vorlagen.
  // «STELLSCHRAUBE» neue Vorlage = neuer Eintrag.
  // Die Vorlagen selbst stehen in dice-presets.js (auch ohne 3D-Engine lesbar).
  const PRESETS = (typeof DicePresets !== "undefined") ? DicePresets : [];

  /** Vorlage als NEUES Set übernehmen und aktivieren (bestehende Sets bleiben). */
  function applyPreset(id) {
    const p = PRESETS.find(x => x.id === id);
    if (!p) return null;
    if (!_sets) _loadSets();
    // Schon einmal übernommen? Dann das vorhandene Set aktivieren statt doppelt anlegen.
    const existing = _sets.find(s => s.presetId === id);
    if (existing) { setActiveSet(existing.id); return existing; }
    const set = _defaultSet(p.name);
    set.id = "set_" + id + "_" + Date.now().toString(36);
    set.presetId = id;
    SIDES_LIST.forEach(sd => { set.dice[sd] = Object.assign({}, DEFAULT_DIE_STYLE, p.style); });
    saveSet(set);
    setActiveSet(set.id);
    return set;
  }


  try {
    const pend = localStorage.getItem("vtt_dice_preset_pending");
    if (pend) { localStorage.removeItem("vtt_dice_preset_pending"); applyPreset(pend); }
  } catch (e) {}


  // ══════════════════════════════════════════════════════════════════════
  //  2) AN/AUS – 3D-Würfel können abgeschaltet werden (dann nur Chat-Zahlen)
  // ══════════════════════════════════════════════════════════════════════

  let _enabled = true;
  function setEnabled(v) {
    _enabled = !!v;
    try { window.localStorage.setItem("vtt_dice3d", _enabled ? "1" : "0"); } catch (e) {}
    if (!_enabled && _hostEl) _hostEl.style.opacity = "0";
  }
  function isEnabled() {
    try { const v = window.localStorage.getItem("vtt_dice3d"); if (v !== null) _enabled = (v === "1"); } catch (e) {}
    return _enabled;
  }
  isEnabled();


  // ══════════════════════════════════════════════════════════════════════
  //  3) DIAGNOSE – sichtbarer Fehlerbalken (falls etwas nicht lädt)
  // ══════════════════════════════════════════════════════════════════════

  function _diag(msg, err) {
    console.error("[Dice3D] " + msg, err || "");
    try {
      let bar = document.getElementById("dice3d-diag");
      if (!bar) {
        bar = document.createElement("div");
        bar.id = "dice3d-diag";
        Object.assign(bar.style, {
          position: "fixed", left: "50%", bottom: "18px", transform: "translateX(-50%)",
          maxWidth: "80%", padding: "10px 16px", borderRadius: "10px", zIndex: 9999,
          background: "rgba(150,40,40,.95)", color: "#fff",
          font: "13px/1.4 system-ui, sans-serif", boxShadow: "0 4px 18px rgba(0,0,0,.4)",
          pointerEvents: "none",
        });
        document.body.appendChild(bar);
      }
      bar.textContent = "🎲 3D-Würfel: " + msg;
      bar.style.opacity = "1";
      clearTimeout(bar._t);
      bar._t = setTimeout(() => { bar.style.opacity = "0"; }, 8000);
    } catch (e) {}
  }

  // Prüft, ob die nötigen Bibliotheken/Bausteine da sind.
  function _librariesReady() {
    return (typeof THREE !== "undefined" &&
            typeof CANNON !== "undefined" &&
            typeof DiceGeometry !== "undefined" &&
            typeof DiceMaterial !== "undefined");
  }


  // ══════════════════════════════════════════════════════════════════════
  //  4) HILFEN – Zufall mit Startwert, Symmetrie → Quaternion
  // ══════════════════════════════════════════════════════════════════════

  /** Reproduzierbarer Zufall (mulberry32). Gleicher Startwert → gleiche Zahlen. */
  function _rng(seed) {
    let a = (seed >>> 0) || 0x9e3779b9;
    return () => {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const _symQCache = new Map();
  /** Alle Symmetrie-Drehungen (Merkmal from → to) als THREE.Quaternion. */
  function _symQuats(sides, from, to) {
    const key = sides + ":" + from + ">" + to;
    if (_symQCache.has(key)) return _symQCache.get(key);
    const list = DiceGeometry.symmetries(sides, from, to, DIE_RADIUS).map(R =>
      new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().set(
        R[0], R[1], R[2], 0,  R[3], R[4], R[5], 0,  R[6], R[7], R[8], 0,  0, 0, 0, 1)));
    _symQCache.set(key, list);
    return list;
  }

  // Leserichtung: Die Zahl soll am Ende GERADE zum Betrachter stehen.
  // Die Kamera schaut leicht schräg von vorn → „oben" auf dem Bildschirm ist
  // die Welt-Richtung −Z.
  const SCREEN_UP = new THREE.Vector3(0, 0, -1);
  /** Drehwinkel um die senkrechte Achse, der die Zahl aufrichtet. */
  function _yawToUpright(sides, faceIdx, quat) {
    const up = DiceGeometry.build(sides, DIE_RADIUS).faces[faceIdx].up;
    const u = new THREE.Vector3(up[0], up[1], up[2]).applyQuaternion(quat);
    u.y = 0;
    if (u.lengthSq() < 1e-6) return 0;
    u.normalize();
    // Drehung um +Y, die u auf SCREEN_UP bringt
    return Math.atan2(u.z * SCREEN_UP.x - u.x * SCREEN_UP.z, u.x * SCREEN_UP.x + u.z * SCREEN_UP.z);
  }

  /** Welches Merkmal (Fläche bzw. beim W4 Ecke) zeigt nach oben – und wie genau? */
  function _topFeature(sides, quat) {
    const feats = DiceGeometry.features(sides, DIE_RADIUS);
    const v = new THREE.Vector3();
    let best = -Infinity, idx = 0;
    feats.forEach((f, i) => {
      v.set(f[0], f[1], f[2]).applyQuaternion(quat);
      if (v.y > best) { best = v.y; idx = i; }
    });
    return { idx, dot: best };
  }

  /** Zielwert → Merkmal-Index. W10: 10 → „0"; W100: 0/100 → „00". */
  function _valueToFeature(sides, value) {
    const g = DiceGeometry.build(sides, DIE_RADIUS);
    let v = +value;
    if (sides === 10)  v = v % 10;
    if (sides === 100) v = (Math.round(v / 10) * 10) % 100;
    return g.values.indexOf(v);
  }
  function _featureToValue(sides, idx) {
    return DiceGeometry.build(sides, DIE_RADIUS).values[idx];
  }

  /** W100 als 1–100 → Zehnerwürfel + Einerwürfel (wie am echten Tisch).
   *  100 = „00" + „0". */
  function _expandSpecs(diceList) {
    const out = [];
    diceList.forEach((d, i) => {
      const sides = +d.sides || 20;
      if (sides === 100 && !d.tensOnly) {
        const val = (d.value != null) ? +d.value : null;
        const tens  = (val == null) ? null : Math.floor((val % 100) / 10) * 10;
        const units = (val == null) ? null : val % 10;
        out.push({ sides: 100, value: tens,  group: i });
        out.push({ sides: 10,  value: units, group: i, percentileUnits: true });
      } else {
        out.push({ sides, value: (d.value != null ? +d.value : null), group: i });
      }
    });
    return out;
  }


  // ══════════════════════════════════════════════════════════════════════
  //  5) SIMULATION – der ganze Wurf wird vorab unsichtbar durchgerechnet
  // ══════════════════════════════════════════════════════════════════════

  // Physik-Eigenschaften je Würfelform. «STELLSCHRAUBE» Roll-Gefühl.
  //   friction    Haftung am Tisch (höher = bremst schneller, rutscht weniger)
  //   restitution Sprungkraft (höher = hüpft mehr)
  //   linDamp/angDamp  Luft-/Rolldämpfung
  const PHYSICS = {
    4:   { friction: 0.50, restitution: 0.18, linDamp: 0.10, angDamp: 0.30 },
    6:   { friction: 0.42, restitution: 0.30, linDamp: 0.08, angDamp: 0.16 },
    8:   { friction: 0.38, restitution: 0.30, linDamp: 0.08, angDamp: 0.15 },
    10:  { friction: 0.38, restitution: 0.28, linDamp: 0.08, angDamp: 0.17 },
    12:  { friction: 0.34, restitution: 0.30, linDamp: 0.07, angDamp: 0.13 },
    20:  { friction: 0.32, restitution: 0.30, linDamp: 0.07, angDamp: 0.12 },
    100: { friction: 0.38, restitution: 0.28, linDamp: 0.08, angDamp: 0.17 },
  };
  const _phys = s => PHYSICS[s] || PHYSICS[20];

  // Wurfkraft je Würfelform. «STELLSCHRAUBE»
  const THROW_POWER = {
    4:   { vel: 0.80, spin: 0.70 },
    6:   { vel: 0.95, spin: 0.90 },
    8:   { vel: 1.00, spin: 0.95 },
    10:  { vel: 0.95, spin: 0.90 },
    12:  { vel: 1.00, spin: 1.00 },
    20:  { vel: 1.05, spin: 1.05 },
    100: { vel: 0.95, spin: 0.90 },
  };
  const _power = s => THROW_POWER[s] || THROW_POWER[20];

  const _shapeCache = new Map();
  function _shape(sides) {
    if (!_shapeCache.has(sides)) _shapeCache.set(sides, DiceGeometry.buildPhysicsShape(sides, DIE_RADIUS));
    return _shapeCache.get(sides);
  }

  /**
   * Simuliert einen kompletten Wurf.
   * @param {Array}  specs   [{sides}]
   * @param {number} seed    Startwert für Wurfrichtung/-kraft
   * @param {object} bounds  {xMin,xMax,zMin,zMax} – sichtbarer Tischbereich
   * @returns {{ok, steps, frames:Float32Array[], impacts:[], landed:[]}}
   */
  function _simulate(specs, seed, bounds) {
    const rand = _rng(seed);
    const world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0) });
    // NaiveBroadphase: bei wenigen Körpern + unendlichen Wänden stabiler als SAP
    world.broadphase = new CANNON.NaiveBroadphase();
    world.allowSleep = true;
    world.solver.iterations = 20;
    world.solver.tolerance = 0.001;

    const floorMat = new CANNON.Material("floor");
    const wallMat  = new CANNON.Material("wall");

    // Boden
    const ground = new CANNON.Body({ mass: 0, material: floorMat, shape: new CANNON.Plane() });
    ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    world.addBody(ground);

    // Wände. WICHTIG (teuer gelernt): Eine CANNON.Plane blockiert den Halbraum
    // ENTGEGEN ihrer Normale – die Normale muss nach INNEN zeigen.
    const addWall = (normal, pos) => {
      const b = new CANNON.Body({ mass: 0, material: wallMat, shape: new CANNON.Plane() });
      b.quaternion.setFromVectors(new CANNON.Vec3(0, 0, 1), new CANNON.Vec3(normal[0], normal[1], normal[2]));
      b.position.set(pos[0], pos[1], pos[2]);
      world.addBody(b);
    };
    addWall([-1, 0, 0], [bounds.xMax, 0, 0]);
    addWall([ 1, 0, 0], [bounds.xMin, 0, 0]);
    addWall([ 0, 0,-1], [0, 0, bounds.zMax]);
    addWall([ 0, 0, 1], [0, 0, bounds.zMin]);

    const bodies = specs.map((spec, i) => {
      const p = _phys(spec.sides);
      const mat = new CANNON.Material("die" + i);
      world.addContactMaterial(new CANNON.ContactMaterial(mat, floorMat, { friction: p.friction, restitution: p.restitution }));
      world.addContactMaterial(new CANNON.ContactMaterial(mat, wallMat,  { friction: 0.1, restitution: 0.55 }));
      const body = new CANNON.Body({
        mass: 1, shape: _shape(spec.sides), material: mat,
        allowSleep: true, sleepSpeedLimit: 0.35, sleepTimeLimit: 0.2,
        linearDamping: p.linDamp, angularDamping: p.angDamp,
      });
      body.__i = i;
      world.addBody(body);
      return body;
    });
    // Würfel untereinander
    for (let i = 0; i < bodies.length; i++)
      for (let j = i + 1; j < bodies.length; j++)
        world.addContactMaterial(new CANNON.ContactMaterial(bodies[i].material, bodies[j].material, { friction: 0.25, restitution: 0.35 }));

    // ── Wurf: von der unteren Bildkante schräg auf den Tisch ─────────────
    const W = bounds.xMax - bounds.xMin, D = bounds.zMax - bounds.zMin;
    const n = specs.length;
    const fromLeft = rand() < 0.5;
    const baseX = bounds.xMin + W * (fromLeft ? 0.22 + rand() * 0.2 : 0.58 + rand() * 0.2);
    const aimX  = bounds.xMin + W * (0.35 + rand() * 0.3);
    bodies.forEach((b, i) => {
      const pw = _power(specs[i].sides);
      const col = i % 5, row = Math.floor(i / 5);
      b.position.set(
        baseX + (col - Math.min(n - 1, 4) / 2) * DIE_RADIUS * 2.3 + (rand() - 0.5) * 1.2,
        DIE_RADIUS * 2.5 + row * DIE_RADIUS * 2.4 + rand() * 3,
        bounds.zMax - DIE_RADIUS * 1.6 - rand() * 1.5);
      const speed = (15 + rand() * 9) * pw.vel;       // «STELLSCHRAUBE» Wurfweite
      const dirX = (aimX - baseX) / (D * 0.8);
      b.velocity.set(dirX * speed * 0.7 + (rand() - 0.5) * 5, 2 + rand() * 5, -speed);
      b.angularVelocity.set(
        (rand() - 0.5) * 36 * pw.spin,
        (rand() - 0.5) * 22 * pw.spin,
        (rand() - 0.5) * 36 * pw.spin);
      const q = new CANNON.Quaternion();
      q.setFromEuler(rand() * Math.PI * 2, rand() * Math.PI * 2, rand() * Math.PI * 2);
      b.quaternion.copy(q);
    });

    // ── Aufprall-Geräusche mitschreiben ──────────────────────────────────
    const impacts = [];
    let step = 0;
    const lastImpact = new Array(n).fill(-99);
    bodies.forEach(b => b.addEventListener("collide", e => {
      let v = 0;
      try { v = Math.abs(e.contact.getImpactVelocityAlongNormal()); } catch (_) {}
      if (v < 1.2 || step - lastImpact[b.__i] < 5) return;
      lastImpact[b.__i] = step;
      impacts.push({ step, die: b.__i, strength: Math.min(1, v / 22) });
    }));

    // ── Rechnen + aufzeichnen ────────────────────────────────────────────
    const maxSteps = Math.round(MAX_SIM_S * SIM_HZ);
    const restSteps = Math.round(REST_S * SIM_HZ);
    const frames = bodies.map(() => new Float32Array(maxSteps * 7));
    let restFor = 0;
    for (step = 0; step < maxSteps; step++) {
      world.step(1 / SIM_HZ);
      for (let i = 0; i < n; i++) {
        const b = bodies[i], f = frames[i], o = step * 7;
        f[o] = b.position.x; f[o+1] = b.position.y; f[o+2] = b.position.z;
        f[o+3] = b.quaternion.x; f[o+4] = b.quaternion.y; f[o+5] = b.quaternion.z; f[o+6] = b.quaternion.w;
      }
      const resting = bodies.every(b => b.sleepState === CANNON.Body.SLEEPING ||
        (b.velocity.lengthSquared() < 0.01 && b.angularVelocity.lengthSquared() < 0.01));
      restFor = resting ? restFor + 1 : 0;
      if (restFor >= restSteps && step > SIM_HZ * 0.6) { step++; break; }
    }
    const settled = restFor >= restSteps;

    // ── Liegen alle flach auf dem Tisch? ─────────────────────────────────
    const q = new THREE.Quaternion();
    const landed = bodies.map(b => {
      q.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
      return _topFeature(specs[b.__i].sides, q);
    });
    const inside = bodies.every(b => b.position.y < DIE_RADIUS * 1.2 &&
      b.position.x > bounds.xMin - 0.5 && b.position.x < bounds.xMax + 0.5 &&
      b.position.z > bounds.zMin - 0.5 && b.position.z < bounds.zMax + 0.5);
    const ok = settled && inside && landed.every(l => l.dot >= FLAT_DOT);
    return { ok, steps: step, frames, impacts, landed };
  }

  /** Letzter Schritt, in dem sich der Würfel noch sichtbar bewegt. */
  function _restStep(f, steps) {
    const L = (steps - 1) * 7;
    for (let k = steps - 1; k > 0; k--) {
      const o = k * 7;
      const dp = Math.abs(f[o] - f[L]) + Math.abs(f[o+1] - f[L+1]) + Math.abs(f[o+2] - f[L+2]);
      const dq = 1 - Math.abs(f[o+3]*f[L+3] + f[o+4]*f[L+4] + f[o+5]*f[L+5] + f[o+6]*f[L+6]);
      if (dp > 0.01 || dq > 1e-5) return k + 1;
    }
    return 1;
  }

  /** Simulieren, bis ein sauberer Wurf dabei ist (normalerweise der erste). */
  function _planRoll(specs, seed, bounds) {
    let sim = null;
    for (let t = 0; t < MAX_TRIES; t++) {
      sim = _simulate(specs, (seed + t * 7919) >>> 0, bounds);
      if (sim.ok) break;
    }
    // Beschriftung drehen, damit die Zielzahl oben landet – und dabei unter
    // allen gleichwertigen Drehungen die wählen, bei der die Zahl am Ende am
    // geradesten steht. Den kleinen Rest drehen wir WÄHREND des Rollens
    // unmerklich heraus (yaw), statt den liegenden Würfel nachzudrehen.
    const qEnd = new THREE.Quaternion(), qTry = new THREE.Quaternion();
    const fixes = specs.map((spec, i) => {
      const o = (sim.steps - 1) * 7, f = sim.frames[i];
      qEnd.set(f[o+3], f[o+4], f[o+5], f[o+6]);
      const landed = sim.landed[i].idx;
      const restStep = _restStep(sim.frames[i], sim.steps);
      if (spec.sides === 4) {          // W4: Zahl an der Spitze, keine „Leserichtung"
        const want = spec.value == null ? landed : _valueToFeature(4, spec.value);
        const q = (want < 0 || want === landed) ? null : (_symQuats(4, want, landed)[0] || null);
        return { quat: q, value: spec.value == null ? _featureToValue(4, landed) : spec.value, yaw: 0, restStep };
      }
      const want = spec.value == null ? landed : _valueToFeature(spec.sides, spec.value);
      let cands = (want < 0) ? [null] : (want === landed ? [null] : []);
      if (want >= 0) cands = cands.concat(_symQuats(spec.sides, want, landed));
      if (!cands.length) cands = [null];
      const shownFace = (want < 0) ? landed : want;
      let best = { quat: null, yaw: 0, abs: Infinity };
      for (const c of cands) {
        qTry.copy(qEnd); if (c) qTry.multiply(c);
        const yaw = _yawToUpright(spec.sides, shownFace, qTry);
        if (Math.abs(yaw) < best.abs) best = { quat: c, yaw, abs: Math.abs(yaw) };
      }
      return { quat: best.quat, yaw: best.yaw, restStep,
               value: spec.value == null ? _featureToValue(spec.sides, landed) : spec.value };
    });
    return Object.assign(sim, { fixes });
  }


  // ══════════════════════════════════════════════════════════════════════
  //  6) DIE BÜHNE – Szene, Licht, Kamera, Abspielen
  // ══════════════════════════════════════════════════════════════════════

  class Stage {
    constructor(container, opts) {
      opts = opts || {};
      this.container = container;
      this.opts = opts;
      this.meshes = [];
      this._running = false;
      this._raf = null;

      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);

      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: !!opts.preserve });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.setSize(w, h, false);
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      if (THREE.SRGBColorSpace) this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      if (THREE.ACESFilmicToneMapping) {
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
      }
      this.renderer.domElement.style.cssText = "width:100%;height:100%;display:block;";
      container.appendChild(this.renderer.domElement);

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(opts.previewMode ? 36 : CAM_FOV, w / h, 0.1, 400);
      if (opts.previewMode) {
        const d = opts.camDist || 6;
        this.camera.position.set(0, d * 0.38, d);
      } else {
        this.camera.position.set(0, CAM_THROW_Y, CAM_THROW_Z);
      }
      this.camera.lookAt(0, 0, 0);

      this._setupLights();
      if (!opts.previewMode) this._setupFloorShadow();

      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(container);
    }

    // Beleuchtung: viel weiches Grundlicht (Zahlen immer lesbar), ein Hauptlicht
    // für Schatten, ein kühles Kantenlicht, dazu eine gedämpfte Studio-Spiegelung.
    _setupLights() {
      this.scene.add(new THREE.HemisphereLight(0xdfe6ff, 0x2a2233, 0.85));
      const key = new THREE.DirectionalLight(0xfff1dc, 1.6);
      key.position.set(10, 36, 14);
      key.castShadow = !this.opts.previewMode;
      if (key.castShadow) {
        key.shadow.mapSize.set(2048, 2048);
        const d = 36;
        Object.assign(key.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 1, far: 100 });
        key.shadow.bias = -0.0005;
        key.shadow.normalBias = 0.02;
        key.shadow.radius = 5;
      }
      this.scene.add(key);
      // Kantenlicht von hinten – bewusst schwach und fast neutral, sonst
      // entsteht auf glatten Flächen ein bläulicher Glanzfleck über der Zahl.
      const rim = new THREE.DirectionalLight(0xd8e6ff, 0.22);
      rim.position.set(-22, 14, -14);
      this.scene.add(rim);
      const fill = new THREE.DirectionalLight(0xffe0c0, 0.35);
      fill.position.set(18, 6, 18);
      this.scene.add(fill);
      this.scene.environment = _buildStudioEnv(this.renderer);
    }

    _setupFloorShadow() {
      const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.ShadowMaterial({ opacity: 0.42 }));
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      this.scene.add(floor);
    }

    _resize() {
      const w = Math.max(1, this.container.clientWidth);
      const h = Math.max(1, this.container.clientHeight);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      if (!this._running) this.renderOnce();
    }

    /** Sichtbarer Tischbereich (y = 0) – daraus entstehen die Wände, damit
     *  die Würfel NIE aus dem Bild rollen, egal wie breit das Fenster ist. */
    tableBounds() {
      this.camera.updateMatrixWorld();
      const ray = new THREE.Raycaster();
      // Auf Höhe der Würfel-OBERSEITE messen: Durch die Perspektive ragt ein
      // Würfel sonst oben aus dem Bild, obwohl sein Fuß noch drin ist.
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -DIE_RADIUS * 1.7);
      const hit = (x, y) => {
        ray.setFromCamera(new THREE.Vector2(x, y), this.camera);
        const p = new THREE.Vector3();
        return ray.ray.intersectPlane(plane, p) ? p : new THREE.Vector3();
      };
      const tl = hit(-1, 1), tr = hit(1, 1), bl = hit(-1, -1), br = hit(1, -1);
      const m = EDGE_MARGIN;
      return {
        xMin: Math.max(tl.x, bl.x) + m, xMax: Math.min(tr.x, br.x) - m,
        zMin: Math.max(tl.z, tr.z) + m, zMax: Math.min(bl.z, br.z) - m,
      };
    }

    clear() {
      for (const m of this.meshes) this.scene.remove(m);
      this.meshes = [];
    }

    /** Einen Würfel als Mesh bauen (Geometrie + Materialien sind geteilt). */
    makeDie(sides, style) {
      const g = DiceGeometry.build(sides, DIE_RADIUS);
      const mats = DiceMaterial.build(sides, g, style);
      const mesh = new THREE.Mesh(g.geometry, mats);
      mesh.castShadow = true;
      mesh.userData.sides = sides;
      this.scene.add(mesh);
      this.meshes.push(mesh);
      return mesh;
    }

    /**
     * Eine fertige Simulation abspielen.
     * @param {Array} specs  [{sides, style}]
     * @param {object} plan  Ergebnis von _planRoll
     * @returns {Promise} wenn alle Würfel liegen
     */
    play(specs, plan) {
      this.clear();
      const meshes = specs.map(s => this.makeDie(s.sides, s.style));
      const fixQ = plan.fixes.map(f => f.quat);
      const tmp = new THREE.Quaternion(), yawQ = new THREE.Quaternion();
      const Y = new THREE.Vector3(0, 1, 0);
      const ease = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
      const last = plan.steps - 1;
      let nextImpact = 0;
      const t0 = performance.now();

      const apply = (stepF) => {
        const s0 = Math.min(last, Math.floor(stepF)), s1 = Math.min(last, s0 + 1), a = stepF - s0;
        meshes.forEach((m, i) => {
          const f = plan.frames[i], o0 = s0 * 7, o1 = s1 * 7;
          m.position.set(f[o0] + (f[o1] - f[o0]) * a, f[o0+1] + (f[o1+1] - f[o0+1]) * a, f[o0+2] + (f[o1+2] - f[o0+2]) * a);
          m.quaternion.set(f[o0+3], f[o0+4], f[o0+5], f[o0+6]);
          tmp.set(f[o1+3], f[o1+4], f[o1+5], f[o1+6]);
          m.quaternion.slerp(tmp, a);
          if (fixQ[i]) m.quaternion.multiply(fixQ[i]);   // Beschriftung mitdrehen
          const fx = plan.fixes[i];
          if (fx.yaw) {   // Zahl aufrichten – verteilt über die Zeit, in der er sich noch bewegt
            yawQ.setFromAxisAngle(Y, fx.yaw * ease(stepF / Math.max(1, fx.restStep)));
            m.quaternion.premultiply(yawQ);
          }
        });
      };
      apply(0);

      return new Promise(resolve => {
        this._frameFn = () => {
          const stepF = (performance.now() - t0) / 1000 * SIM_HZ;
          apply(stepF);
          while (nextImpact < plan.impacts.length && plan.impacts[nextImpact].step <= stepF) {
            const im = plan.impacts[nextImpact++];
            _sound(specs[im.die], im.strength);
          }
          if (stepF >= last) { this._frameFn = null; resolve(meshes); }
        };
        this.start();
      });
    }

    /** Einzelwürfel zeigen (Werkstatt, Design-Studio).
     *  Ruckelfrei: Der bisherige Würfel dreht sich weiter, während der neue in
     *  kleinen Zeitscheiben entsteht (Texturen + Shader). Erst wenn alles
     *  fertig ist, wird getauscht – mit derselben Drehung, kein Zurückspringen.
     *  Kommt währenddessen eine neuere Änderung, wird die alte verworfen. */
    async showStatic(sides, style) {
      const token = (this._showToken = (this._showToken || 0) + 1);
      this.start();
      const g = DiceGeometry.build(sides, DIE_RADIUS);
      const mats = await DiceMaterial.buildAsync(sides, g, style, this.renderer, () => token !== this._showToken);
      if (!mats || token !== this._showToken) return null;
      const mesh = new THREE.Mesh(g.geometry, mats);
      mesh.castShadow = true; mesh.userData.sides = sides;
      const old = this._preview;
      if (old) { mesh.rotation.copy(old.rotation); mesh.position.copy(old.position); }
      // Shader vorab übersetzen (sonst stockt das erste Bild mit dem neuen Material)
      mesh.visible = false; this.scene.add(mesh);
      try {
        if (this.renderer.compileAsync) await this.renderer.compileAsync(mesh, this.camera, this.scene);
        else this.renderer.compile(this.scene, this.camera);
      } catch (e) {}
      if (token !== this._showToken) { this.scene.remove(mesh); return null; }
      if (old) { mesh.rotation.copy(old.rotation); this.scene.remove(old); }
      mesh.visible = true;
      this.meshes = this.meshes.filter(m => m !== old); this.meshes.push(mesh);
      this._preview = mesh;
      return mesh;
    }

    start() {
      if (this._running) return;
      this._running = true;
      const loop = () => {
        if (!this._running) return;
        this._raf = requestAnimationFrame(loop);
        if (this._preview) {
          // Neigung = eigene Neigung des Nutzers + sanftes Schaukeln. Das
          // Schaukeln wird ADDIERT (früher überschrieb es die Neigung → der
          // Würfel sprang nach dem Loslassen zurück).
          const p = this._preview;
          if (!this._dragging) {
            // Schwung nach dem Loslassen, läuft in die Grunddrehung aus
            this._velY = (this._velY ?? 0.007) * 0.94 + 0.007 * 0.06;
            this._velX = (this._velX ?? 0) * 0.94;
            p.rotation.y += this._velY;
            this._userX = (this._userX ?? 0) + this._velX;
          }
          p.rotation.x = (this._userX ?? 0) + Math.sin(performance.now() / 2600) * 0.12;
        }
        if (this._frameFn) this._frameFn();
        this.renderer.render(this.scene, this.camera);
      };
      this._raf = requestAnimationFrame(loop);
    }
    stop() {
      this._running = false;
      if (this._raf) cancelAnimationFrame(this._raf);
      this._raf = null;
    }
    renderOnce() { try { this.renderer.render(this.scene, this.camera); } catch (e) {} }

    /** Bildschirm-Rechteck, das alle Würfel umschließt (fürs Popup). */
    screenBox() {
      const rect = this.renderer.domElement.getBoundingClientRect();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const v = new THREE.Vector3();
      for (const m of this.meshes) {
        for (const dx of [-1, 1]) for (const dz of [-1, 1]) for (const dy of [0, 2]) {
          v.set(m.position.x + dx * DIE_RADIUS, m.position.y + (dy - 1) * DIE_RADIUS, m.position.z + dz * DIE_RADIUS).project(this.camera);
          const sx = rect.left + (v.x * 0.5 + 0.5) * rect.width;
          const sy = rect.top + (-v.y * 0.5 + 0.5) * rect.height;
          x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
        }
      }
      if (!isFinite(x0)) return null;
      return { x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
    }

    enableDrag() {
      const el = this.renderer.domElement;
      el.style.touchAction = "none";
      el.style.cursor = "grab";
      let px = 0, py = 0;
      const down = (e) => { this._dragging = true; el.style.cursor = "grabbing"; const p = e.touches ? e.touches[0] : e; px = p.clientX; py = p.clientY; };
      const move = (e) => {
        if (!this._dragging || !this._preview) return;
        const p = e.touches ? e.touches[0] : e;
        const dx = (p.clientX - px) * 0.012, dy = (p.clientY - py) * 0.012;
        this._preview.rotation.y += dx;
        this._userX = (this._userX ?? 0) + dy;
        this._velY = dx; this._velX = dy;      // Schwung für das Loslassen merken
        px = p.clientX; py = p.clientY;
        e.preventDefault();
      };
      const up = () => { this._dragging = false; el.style.cursor = "grab"; };
      el.addEventListener("mousedown", down);
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
      el.addEventListener("touchstart", down, { passive: false });
      el.addEventListener("touchmove", move, { passive: false });
      el.addEventListener("touchend", up);
    }

    dispose() {
      this.stop();
      this.clear();
      if (this._ro) this._ro.disconnect();
      try { this.renderer.dispose(); } catch (e) {}
      if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }

  function _sound(spec, strength) {
    try {
      if (typeof DiceSound === "undefined") return;
      const surf = (DiceMaterial.SURFACES[spec.style && spec.style.surface] || {}).sound || "plastic";
      DiceSound.impact(surf, strength);
    } catch (e) {}
  }

  /** Gedämpftes Studio als Spiegel-Umgebung (für Metall/Glas). */
  function _buildStudioEnv(renderer) {
    if (!THREE.PMREMGenerator) return null;
    try {
      const pmrem = new THREE.PMREMGenerator(renderer);
      pmrem.compileEquirectangularShader();
      let envScene;
      const RoomEnv = THREE.RoomEnvironment || (typeof RoomEnvironment !== "undefined" ? RoomEnvironment : null);
      if (RoomEnv) {
        envScene = new RoomEnv();
        const DIM = 0.4;
        const tint = new THREE.Color(0.9, 0.95, 1.05);
        envScene.traverse(o => {
          if (o.isMesh && o.material && o.material.color) {
            o.material.color.multiplyScalar(DIM).multiply(tint);
            if (o.material.emissive) o.material.emissive.multiplyScalar(DIM);
          }
          if (o.isLight) o.intensity *= DIM;
        });
      } else {
        envScene = new THREE.Scene();
        envScene.add(new THREE.Mesh(new THREE.SphereGeometry(60, 24, 16),
          new THREE.MeshBasicMaterial({ color: 0x3a4050, side: THREE.BackSide })));
      }
      const tex = pmrem.fromScene(envScene, 0.02).texture;
      envScene.traverse && envScene.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
      pmrem.dispose();
      return tex;
    } catch (e) { return null; }
  }


  // ══════════════════════════════════════════════════════════════════════
  //  7) DER WURF-HOST – Vollbild-Ebene über der Karte + Warteschlange
  // ══════════════════════════════════════════════════════════════════════

  let _hostEl = null, _stage = null, _stageReady = null;

  function _ensureHost() {
    if (_hostEl) return _hostEl;
    let host = document.getElementById("dice3d-host");
    if (!host) {
      host = document.createElement("div");
      host.id = "dice3d-host";
      document.body.appendChild(host);
    }
    Object.assign(host.style, {
      position: "fixed", inset: "0", pointerEvents: "none", zIndex: 500,
      opacity: "0", transition: `opacity ${FADE_MS}ms ease`,
      background: "radial-gradient(ellipse at 50% 55%, rgba(0,0,0,0) 45%, rgba(4,6,12,.28) 100%)",
    });
    _hostEl = host;
    return host;
  }

  /** Würfelfläche an den Bereich anpassen, der mit data-dice-area markiert
   *  ist (am Spieltisch: die Karte). So rollen die Würfel nie unter Chat oder
   *  Seitenleiste. Ohne Markierung: ganzes Fenster. */
  function _fitHost() {
    const host = _ensureHost();
    const area = document.querySelector("[data-dice-area]");
    const r = area ? area.getBoundingClientRect() : null;
    if (r && r.width > 200 && r.height > 200) {
      Object.assign(host.style, { inset: "auto", left: r.left + "px", top: r.top + "px", width: r.width + "px", height: r.height + "px" });
    } else {
      Object.assign(host.style, { inset: "0", left: "", top: "", width: "", height: "" });
    }
    if (_stage) _stage._resize();
  }

  function _ensureStage() {
    if (_stageReady) return _stageReady;
    _stageReady = (async () => {
      if (!_librariesReady()) {
        _diag("Bibliotheken fehlen (THREE / cannon-es / dice-geometry / dice-material).");
        throw new Error("libs missing");
      }
      if (DiceMaterial.ensureFonts) { try { await DiceMaterial.ensureFonts(); } catch (e) {} }
      _stage = new Stage(_ensureHost(), { preserve: !!window.__DICE_TEST__ });
      return _stage;
    })();
    _stageReady.catch(() => { _stageReady = null; });   // bei Fehler später neu versuchen
    return _stageReady;
  }

  const _queue = [];
  let _busy = false, _hideTimer = 0;

  function _enqueue(job) {
    _queue.push(job);
    if (!_busy) _next();
  }

  async function _next() {
    const job = _queue.shift();
    if (!job) { _busy = false; return; }
    _busy = true;
    clearTimeout(_hideTimer);
    try {
      const stage = await _ensureStage();
      _clearPopup();
      _fitHost();
      const bounds = stage.tableBounds();
      const plan = _planRoll(job.specs, job.seed, bounds);
      _hostEl.style.opacity = "1";
      await stage.play(job.specs, plan);
      const results = job.specs.map((s, i) => ({ sides: s.sides, value: plan.fixes[i].value, group: s.group, percentileUnits: !!s.percentileUnits }));
      const disp = _buildDisplay(job, results);
      _lastDisp = disp;
      if (!job.opts.suppressPopup) _showPopup(disp, stage.screenBox());
      if (job.onComplete) { try { job.onComplete(_collapse(job, results)); } catch (e) {} }
      const hold = _queue.length ? HOLD_QUEUE_MS : HOLD_MS;
      await new Promise(r => { _hideTimer = setTimeout(r, hold); });
    } catch (err) {
      _diag("Würfel-Engine konnte nicht starten. Details in der Konsole (F12).", err);
      if (job.onComplete) { try { job.onComplete(null); } catch (e) {} }
    }
    // Ausblenden, Renderschleife anhalten (spart Grafikleistung)
    if (!_queue.length) {
      _hostEl && (_hostEl.style.opacity = "0");
      _clearPopup();
      await new Promise(r => setTimeout(r, FADE_MS));
      if (!_queue.length && _stage) { _stage.stop(); _stage.clear(); }
    }
    _next();
  }

  /** Einzelwürfel wieder zu den ursprünglichen Würfeln zusammenfassen
   *  (Prozentwürfel: Zehner + Einer → 1–100). */
  function _collapse(job, results) {
    const out = [];
    results.forEach(r => {
      if (r.percentileUnits) {
        const tens = out[out.length - 1];
        let v = (tens.value || 0) + (r.value || 0);
        if (v === 0) v = 100;
        tens.value = v;
      } else out.push({ sides: r.sides, value: r.value });
    });
    return out;
  }


  // ══════════════════════════════════════════════════════════════════════
  //  8) ERGEBNIS-POPUP – erscheint NEBEN den Würfeln, nie darüber
  // ══════════════════════════════════════════════════════════════════════

  let _popupEl = null, _lastDisp = null;

  function _popup() {
    if (_popupEl) return _popupEl;
    const css = document.createElement("style");
    css.textContent = `
      #dice3d-result{position:fixed;z-index:600;pointer-events:none;min-width:120px;max-width:min(420px,90vw);
        padding:14px 22px 12px;border-radius:14px;text-align:center;color:var(--text-bright,#f3e6c4);
        background:linear-gradient(180deg,rgba(var(--panel-rgb,16,15,22),.9),rgba(var(--panel-rgb,16,15,22),.97));
        border:1px solid rgba(var(--gold-rgb,214,178,94),.55);border-radius:var(--radius-lg,14px);
        box-shadow:0 18px 50px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.06),0 0 0 1px rgba(0,0,0,.4);
        backdrop-filter:blur(6px);opacity:0;transform:translate(-50%,-50%) scale(.92);
        transition:opacity .22s ease,transform .28s cubic-bezier(.2,1.4,.4,1);font-family:var(--font-body,'Crimson Pro',Georgia,serif)}
      #dice3d-result.show{opacity:1;transform:translate(-50%,-50%) scale(1)}
      #dice3d-result .lbl{font:600 11px/1.2 var(--font-display,'Cinzel',serif);letter-spacing:.14em;text-transform:uppercase;color:var(--gold,#cdb77f);margin-bottom:4px}
      #dice3d-result .tot{font:700 44px/1 var(--font-display,'Cinzel',serif);color:var(--text-bright,#fff3d1);text-shadow:0 2px 14px rgba(var(--gold-rgb,214,178,94),.35)}
      #dice3d-result .frm{font:500 12px/1.3 var(--font-mono,monospace);color:var(--text-dim,#a99c80);margin-top:6px}
      #dice3d-result .chips{display:flex;flex-wrap:wrap;gap:5px;justify-content:center;margin-top:8px}
      #dice3d-result .chip{font:600 12px/1 var(--font-mono,monospace);padding:4px 7px;border-radius:6px;background:rgba(var(--hi-rgb,255,255,255),.07);border:1px solid rgba(var(--hi-rgb,255,255,255),.1);color:var(--text,#e9dcbc)}
      #dice3d-result .chip b{color:var(--text-dim,#8f8570);font-weight:500;margin-right:3px}
      #dice3d-result .tag{margin-top:7px;font:700 11px/1 var(--font-display,'Cinzel',serif);letter-spacing:.16em;text-transform:uppercase}
      #dice3d-result.crit{border-color:rgba(110,220,150,.8);box-shadow:0 18px 50px rgba(0,0,0,.55),0 0 34px rgba(90,220,140,.28)}
      #dice3d-result.crit .tot{color:#c9ffd9;text-shadow:0 0 18px rgba(90,220,140,.55)} #dice3d-result.crit .tag{color:#7fe3a3}
      #dice3d-result.fail{border-color:rgba(235,110,110,.8);box-shadow:0 18px 50px rgba(0,0,0,.55),0 0 34px rgba(235,90,90,.25)}
      #dice3d-result.fail .tot{color:#ffd0d0;text-shadow:0 0 18px rgba(235,90,90,.5)} #dice3d-result.fail .tag{color:#f59a9a}`;
    document.head.appendChild(css);
    const el = document.createElement("div");
    el.id = "dice3d-result";
    document.body.appendChild(el);
    _popupEl = el;
    return el;
  }
  function _esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;" }[c])); }
  function _clearPopup() { if (_popupEl) _popupEl.classList.remove("show"); }

  function _buildDisplay(job, results) {
    const collapsed = _collapse(job, results);
    const sum = collapsed.reduce((s, r) => s + (r.sides === 10 && r.value === 0 ? 10 : (r.value || 0)), 0);
    const meta = job.meta || {};
    return {
      dice: collapsed,
      total: (typeof meta.total === "number") ? meta.total : sum,
      label: meta.label || "",
      formula: meta.formula || "",
    };
  }

  function _showPopup(disp, box) {
    if (!disp) return;
    const el = _popup();
    const d20s = disp.dice.filter(d => d.sides === 20);
    const isCrit = d20s.length === 1 && d20s[0].value === 20;
    const isFail = d20s.length === 1 && d20s[0].value === 1;
    el.className = isCrit ? "crit" : isFail ? "fail" : "";

    let html = "";
    if (disp.label) html += `<div class="lbl">${_esc(disp.label)}</div>`;
    html += `<div class="tot">${_esc(disp.total)}</div>`;
    if (disp.formula) html += `<div class="frm">${_esc(disp.formula)}</div>`;
    if (disp.dice.length > 1 || (disp.formula && /[+\-]/.test(disp.formula))) {
      html += `<div class="chips">` + disp.dice.map(d => {
        const v = (d.sides === 10 && d.value === 0) ? 10 : d.value;
        return `<span class="chip"><b>W${d.sides}</b>${_esc(v)}</span>`;
      }).join("") + `</div>`;
    }
    if (isCrit || isFail) { try { window.dispatchEvent(new CustomEvent("vtt:crit", { detail: { kind: isCrit ? "crit" : "fail" } })); } catch (e) {} }
    if (isCrit) html += `<div class="tag">Kritischer Erfolg</div>`;
    if (isFail) html += `<div class="tag">Patzer</div>`;
    el.innerHTML = html;

    // Platz suchen: über den Würfeln → darunter → rechts → links
    const vw = window.innerWidth, vh = window.innerHeight, M = 16, GAP = 22;
    el.style.left = "-9999px"; el.style.top = "0px";
    const pw = el.offsetWidth, ph = el.offsetHeight;
    const b = box || { x0: vw / 2, x1: vw / 2, y0: vh / 2, y1: vh / 2, cx: vw / 2, cy: vh / 2 };
    const clampX = x => Math.max(M + pw / 2, Math.min(vw - M - pw / 2, x));
    const clampY = y => Math.max(M + ph / 2, Math.min(vh - M - ph / 2, y));
    let x, y;
    if (b.y0 - GAP - ph >= M)            { x = clampX(b.cx); y = b.y0 - GAP - ph / 2; }
    else if (b.y1 + GAP + ph <= vh - M)  { x = clampX(b.cx); y = b.y1 + GAP + ph / 2; }
    else if (b.x1 + GAP + pw <= vw - M)  { x = b.x1 + GAP + pw / 2; y = clampY(b.cy); }
    else                                 { x = Math.max(M + pw / 2, b.x0 - GAP - pw / 2); y = clampY(b.cy); }
    el.style.left = x + "px"; el.style.top = y + "px";
    requestAnimationFrame(() => el.classList.add("show"));
  }

  /** Endgültiges Gesamtergebnis (inkl. Modifikatoren) nachträglich zeigen. */
  function showFinalResult(meta) {
    if (!_lastDisp) return;
    const disp = Object.assign({}, _lastDisp);
    if (meta) {
      if (typeof meta.total === "number") disp.total = meta.total;
      if (meta.formula) disp.formula = meta.formula;
      if (meta.label) disp.label = meta.label;
    }
    _showPopup(disp, _stage ? _stage.screenBox() : null);
  }


  // ══════════════════════════════════════════════════════════════════════
  //  9) ÖFFENTLICHE FUNKTIONEN – Wurf, Vorschau, Testwurf
  // ══════════════════════════════════════════════════════════════════════

  function roll(diceList, meta, onComplete, opts) {
    opts = opts || {};
    if (!_enabled || !Array.isArray(diceList) || !diceList.length) {
      if (onComplete) { try { onComplete(null); } catch (e) {} }
      return;
    }
    const specs = _expandSpecs(diceList).slice(0, 30).map(s =>
      Object.assign(s, { style: _styleFor(s.sides) }));
    const seed = (opts.seed != null) ? (opts.seed >>> 0) : (Math.random() * 4294967296) >>> 0;
    _enqueue({ specs, seed, meta: meta || {}, onComplete, opts });
  }

  function testRoll(sides) {
    roll([{ sides: sides }], { label: "Testwurf" });
  }

  // ── Werkstatt-Vorschau: drehbarer Einzelwürfel ──────────────────────────
  const _previews = new Map();

  async function preview(sides, style, canvas) {
    if (!canvas) return;
    try {
      if (!_librariesReady()) { _diag("Bibliotheken fehlen (F12 für Details)."); return; }
      if (DiceMaterial.ensureFonts) { try { await DiceMaterial.ensureFonts(); } catch (e) {} }
      let entry = _previews.get(canvas);
      if (!entry) {
        const cw = canvas.clientWidth || 340, ch = canvas.clientHeight || 340;
        const host = document.createElement("div");
        host.className = "dice-prev-host";
        Object.assign(host.style, {
          width: cw + "px", height: ch + "px", display: "block", margin: "0 auto",
          position: "relative", flex: "0 0 auto", minWidth: cw + "px", minHeight: ch + "px",
        });
        if (canvas.parentElement) { canvas.parentElement.insertBefore(host, canvas); canvas.style.display = "none"; }
        const stage = new Stage(host, { previewMode: true, camDist: 6.4, preserve: !!window.__DICE_TEST__ });
        stage.enableDrag();
        entry = { stage, host };
        _previews.set(canvas, entry);
      }
      return entry.stage.showStatic(+sides, style);
    } catch (e) {
      _diag("Vorschau konnte nicht laden (F12 für Details).", e);
    }
  }

  function stopPreview(canvas) {
    const entry = _previews.get(canvas);
    if (entry && entry.stage) { try { entry.stage.dispose(); } catch (e) {} }
    if (entry && entry.host && entry.host.parentNode) entry.host.parentNode.removeChild(entry.host);
    if (canvas) canvas.style.display = "";
    _previews.delete(canvas);
  }

  /** Engine vorwärmen: Bühne, Schriften und die Materialien des aktiven Sets
   *  vorab bauen, damit schon der ERSTE Wurf ohne Verzögerung startet. */
  function preload() {
    try {
      if (!_librariesReady()) return;
      _ensureStage().then(stage => {
        SIDES_LIST.forEach(s => {
          const g = DiceGeometry.build(s, DIE_RADIUS);
          DiceMaterial.build(s, g, _styleFor(s));
          _shape(s);
        });
        // Shader einmal kompilieren (sonst ruckelt der erste Frame)
        try { const m = stage.makeDie(20, _styleFor(20)); stage.renderer.compile(stage.scene, stage.camera); stage.clear(); } catch (e) {}
      }).catch(() => {});
    } catch (e) {}
  }

  /** Vorschaubild eines Würfels als data:-URL (für Set-Karten in Werkstatt
   *  und Launcher). EIN unsichtbarer Renderer wird wiederverwendet – viele
   *  einzelne 3D-Kontexte wären langsam (Browser erlauben nur ~16 gleichzeitig). */
  let _snapStage = null, _snapSize = 0, _snapQueue = Promise.resolve();
  function snapshot(sides, style, size) {
    size = size || 160;
    const job = async () => {
      if (!_librariesReady()) return null;
      if (DiceMaterial.ensureFonts) { try { await DiceMaterial.ensureFonts(); } catch (e) {} }
      if (!_snapStage || _snapSize !== size) {
        if (_snapStage) { try { _snapStage.dispose(); } catch (e) {} _snapStage.__host.remove(); }
        const host = document.createElement("div");
        Object.assign(host.style, { position: "fixed", left: "-10000px", top: "0", width: size + "px", height: size + "px" });
        document.body.appendChild(host);
        _snapStage = new Stage(host, { previewMode: true, camDist: 6.2, preserve: true });
        _snapStage.__host = host; _snapSize = size;
      }
      const st = _snapStage;
      st.clear();
      const mesh = st.makeDie(+sides || 20, Object.assign({}, DEFAULT_DIE_STYLE, style || {}));
      mesh.rotation.set(0.55, -0.35, 0.1);
      st.renderer.render(st.scene, st.camera);
      const url = st.renderer.domElement.toDataURL("image/webp", 0.85);
      st.clear();
      return url;
    };
    const p = _snapQueue.then(job, job);        // nacheinander, nie gleichzeitig
    _snapQueue = p.catch(() => null);
    return p.catch(() => null);
  }

  /** Nur für automatische Tests: Simulation ohne Darstellung. */
  function _selfTest(sides, value, seed) {
    const specs = _expandSpecs([{ sides, value }]);
    const plan = _planRoll(specs, seed >>> 0, { xMin: -20, xMax: 20, zMin: -12, zMax: 12 });
    const q = new THREE.Quaternion();
    return specs.map((s, i) => {
      const o = (plan.steps - 1) * 7, f = plan.frames[i];
      q.set(f[o+3], f[o+4], f[o+5], f[o+6]);
      if (plan.fixes[i].quat) q.multiply(plan.fixes[i].quat);
      if (plan.fixes[i].yaw) q.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0), plan.fixes[i].yaw));
      const top = _topFeature(s.sides, q);
      const tilt = s.sides === 4 ? 0 : Math.abs(_yawToUpright(s.sides, top.idx, q)) * 180 / Math.PI;
      return { sides: s.sides, want: s.value, shown: _featureToValue(s.sides, top.idx), flat: top.dot, ok: plan.ok, steps: plan.steps, tilt };
    });
  }


  // ══════════════════════════════════════════════════════════════════════
  //  10) ÖFFENTLICHE SCHNITTSTELLE
  // ══════════════════════════════════════════════════════════════════════

  return {
    roll, testRoll, preview, stopPreview, preload, showFinalResult, snapshot,
    setEnabled, isEnabled,
    getStyle, setStyle,
    getSets, getVisibleSets, getActiveSet, setActiveSet, saveSet, deleteSet, newSet,
    DEFAULT_DIE_STYLE, PRESETS, applyPreset, _selfTest,
  };
})();

// Engine vorwärmen, sobald die Seite bereit ist (nur wenn 3D aktiv).
if (typeof window !== "undefined") {
  const _warm = () => { try { if (Dice3D.isEnabled()) Dice3D.preload(); } catch (e) {} };
  if (document.readyState === "complete" || document.readyState === "interactive") setTimeout(_warm, 200);
  else window.addEventListener("DOMContentLoaded", () => setTimeout(_warm, 200));
}
