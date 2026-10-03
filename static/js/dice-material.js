/* ══════════════════════════════════════════════════════════════════════════
   DiceMaterial – wie ein Würfel aussieht.

   Drei Bausteine ergeben zusammen das Aussehen:
     1. Oberfläche  – Kunststoff, Metall, Glas, Stein, Holz, Edelstein
     2. Farbe       – frei wählbar (Körper + Zahlen getrennt)
     3. Muster      – optionaler Aufdruck (Marmor, Runen, Sterne, Nebel …)

   Für jede Fläche wird eine eigene Textur gezeichnet, damit die Zahl auf
   JEDER Seite steht – auch auf denen, die gerade unten liegen.
   ══════════════════════════════════════════════════════════════════════════ */
const DiceMaterial = (() => {

  const TEX = 256;   // Auflösung je Fläche

  // Canvas wartet nicht auf Schriften: Ist eine Schrift beim Zeichnen noch
  // nicht geladen, nimmt der Browser klammheimlich die Standardschrift.
  // Deshalb laden wir die Würfel-Schriften einmal vorab und merken uns das.
  const _fontsReady = { done: false, promise: null };

  function ensureFonts() {
    if (_fontsReady.promise) return _fontsReady.promise;
    const families = [
      "700 40px 'Cinzel'",
      "400 40px 'Uncial Antiqua'",
      "700 40px 'Orbitron'",
      "700 40px 'JetBrains Mono'",
      "600 40px 'Crimson Pro'",
    ];
    _fontsReady.promise = (async () => {
      try {
        if (document.fonts && document.fonts.load) {
          await Promise.all(families.map(f => document.fonts.load(f, "0123456789")));
          await document.fonts.ready;
        }
      } catch (e) { /* zur Not eben mit der Standardschrift */ }
      _fontsReady.done = true;
    })();
    return _fontsReady.promise;
  }
  // Gleich beim Laden anstoßen, damit die Schriften früh bereitstehen.
  if (typeof document !== "undefined") ensureFonts();

  // ── Oberflächen ─────────────────────────────────────────────────────────
  //
  //  Die Werte orientieren sich an echten Würfeln:
  //
  //  Metall     – gebürstet, kräftige Spiegelung, dunkle vertiefte Zahlen
  //  Glas       – klar durchsichtig, man schaut hindurch
  //  Kristall   – Einschlüsse im Inneren, schillert, bricht das Licht
  //  Stein      – matt und körnig, KEIN Glanz
  //  Marmor     – geschwungene Adern, seidiger Glanz
  //  Holz       – sichtbare Maserung, warm
  //  Kunststoff – gleichmäßig, leichter Lackglanz
  //  Knochen    – porös, rau, elfenbeinfarben
  //
  const SURFACES = {
    plastic: {
      label: "Kunststoff", icon: "🎲",
      params: {
        metalness: 0.0, roughness: 0.55,
        clearcoat: 0.20, clearcoatRoughness: 0.4,
        envMapIntensity: 0.12,
      },
      texture: "smooth",
      sound: "plastic",
    },

    metal: {
      label: "Metall", icon: "⚙️",
      params: {
        metalness: 1.0,          // voll metallisch
        roughness: 0.62,         // stark gebürstet: streut das Licht weit,
                                 // dadurch kein grelles Glanzlicht
        clearcoat: 0.0,
        envMapIntensity: 0.40,   // stark gedämpft – Metall glänzt, blendet aber nicht
      },
      texture: "brushed",
      bumpScale: 0.015,
      sound: "metal",
      // Zahlen sind eingraviert: dunkel und vertieft
      engraved: true,
      defaultColor: "#9aa3ad",
      defaultNumber: "#15181c",
    },

    glass: {
      label: "Glas", icon: "🪟",
      params: {
        metalness: 0.0,
        roughness: 0.02,
        transmission: 1.0,       // vollständig durchsichtig
        thickness: 3.5,          // Dicke bestimmt die Lichtbrechung
        ior: 1.52,               // Brechungsindex von echtem Glas
        clearcoat: 1.0, clearcoatRoughness: 0.0,
        transparent: true,
        opacity: 1.0,
        envMapIntensity: 0.30,   // minimal – die Durchsicht macht das Glas aus,
                                 // nicht die Spiegelung
        specularIntensity: 0.35,
        attenuationDistance: 8.0,
      },
      texture: "smooth",
      sound: "glass",
      seeThrough: true,          // beide Seiten zeichnen (man schaut hindurch)
      defaultColor: "#a8d8e8",
      defaultNumber: "#0d2830",
    },

    crystal: {
      label: "Kristall", icon: "💎",
      params: {
        metalness: 0.0,
        roughness: 0.12,         // leicht rauer: das Funkeln wird weicher
        transmission: 0.82,
        thickness: 4.5,
        ior: 1.9,
        clearcoat: 1.0, clearcoatRoughness: 0.06,
        iridescence: 0.7,        // schillernder Farbschimmer
        iridescenceIOR: 1.5,
        iridescenceThicknessRange: [200, 700],
        transparent: true,
        opacity: 1.0,
        envMapIntensity: 0.35,   // minimal – das Schillern kommt vom Material,
                                 // nicht von der Spiegelung
        specularIntensity: 0.4,
        sheen: 0.3,
      },
      texture: "inclusions",     // Einschlüsse im Inneren
      sound: "glass",
      seeThrough: true,
      dualColor: true,
      defaultColor: "#7a4ad0",
      defaultColor2: "#2a8ad0",
      defaultNumber: "#ffe9a8",
    },

    stone: {
      label: "Stein", icon: "🪨",
      params: {
        metalness: 0.0,
        roughness: 1.0,          // komplett matt – kein Glanz
        clearcoat: 0.0,
        envMapIntensity: 0.05,   // spiegelt praktisch nichts
        sheen: 0.0,
      },
      texture: "granite",
      bumpScale: 0.09,           // deutlich uneben
      sound: "stone",
      engraved: true,
      defaultColor: "#4a4a50",
      defaultNumber: "#1a1a1e",
    },

    marble: {
      label: "Marmor", icon: "🏛",
      params: {
        metalness: 0.0,
        roughness: 0.34,
        clearcoat: 0.25, clearcoatRoughness: 0.35,
        envMapIntensity: 0.15,
        sheen: 0.3,
        sheenRoughness: 0.4,
      },
      texture: "marble",
      bumpScale: 0.006,
      sound: "stone",
      defaultColor: "#e8e6e0",
      defaultColor2: "#2a2a30",
      defaultNumber: "#c9a44a",
    },

    wood: {
      label: "Holz", icon: "🪵",
      params: {
        metalness: 0.0,
        roughness: 0.58,
        clearcoat: 0.12, clearcoatRoughness: 0.45,
        envMapIntensity: 0.10,
      },
      texture: "woodgrain",
      bumpScale: 0.03,
      sound: "wood",
      engraved: true,
      defaultColor: "#a06838",
      defaultNumber: "#3a2412",
    },

    pearl: {
      label: "Perlmutt", icon: "🐚",
      params: {
        metalness: 0.0, roughness: 0.28,
        clearcoat: 0.9, clearcoatRoughness: 0.12,
        iridescence: 1.0, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 520],
        sheen: 0.6, sheenRoughness: 0.35, envMapIntensity: 0.45,
      },
      texture: "smooth",
      sound: "plastic",
      defaultColor: "#f2ece4",
      defaultNumber: "#5a4a6a",
    },

    holo: {
      label: "Holografisch", icon: "🌈",
      params: {
        metalness: 0.85, roughness: 0.22,
        iridescence: 1.0, iridescenceIOR: 1.8, iridescenceThicknessRange: [120, 900],
        clearcoat: 0.6, clearcoatRoughness: 0.1, envMapIntensity: 0.7,
      },
      texture: "smooth",
      sound: "metal",
      engraved: true,
      defaultColor: "#c8ccd8",
      defaultNumber: "#121420",
    },

    obsidian: {
      label: "Obsidian", icon: "🖤",
      params: {
        metalness: 0.15, roughness: 0.06,
        clearcoat: 1.0, clearcoatRoughness: 0.03, envMapIntensity: 0.8,
      },
      texture: "smooth",
      sound: "glass",
      defaultColor: "#0d0b10",
      defaultNumber: "#d9b46a",
    },

  };

  // ── Oberflächen-Texturen ────────────────────────────────────────────────
  // Diese Karten geben dem Material seinen Charakter. Ein gleichmäßig glattes
  // Material wirkt immer künstlich – erst Kratzer, Poren und Maserung machen
  // den Unterschied zwischen "Metall" und "grau lackiertem Kunststoff".
  const _texCache = new Map();

  function _surfaceMaps(kind, bumpScale) {
    const key = kind + "|" + (bumpScale || 0);
    if (_texCache.has(key)) return _texCache.get(key);

    const S = 256;
    const rough = document.createElement("canvas"); rough.width = rough.height = S;
    const bump  = document.createElement("canvas"); bump.width  = bump.height  = S;
    const rc = rough.getContext("2d");
    const bc = bump.getContext("2d");

    // Grundton: mittleres Grau (= Materialwert unverändert lassen)
    rc.fillStyle = "#808080"; rc.fillRect(0, 0, S, S);
    bc.fillStyle = "#808080"; bc.fillRect(0, 0, S, S);

    switch (kind) {
      case "brushed": {
        // Metall: feine, gerichtete Schleifspuren
        for (let i = 0; i < 400; i++) {
          const y = Math.random() * S;
          const v = 90 + Math.random() * 120;
          rc.strokeStyle = `rgba(${v},${v},${v},.6)`;
          rc.lineWidth = 0.4 + Math.random() * 1.6;
          rc.beginPath();
          rc.moveTo(0, y);
          rc.lineTo(S, y + (Math.random() - 0.5) * 5);
          rc.stroke();
        }
        // Ein paar tiefere Kratzer als Unebenheit
        for (let i = 0; i < 20; i++) {
          const y = Math.random() * S;
          const v = Math.random() < .5 ? 50 : 200;
          bc.strokeStyle = `rgba(${v},${v},${v},.55)`;
          bc.lineWidth = 0.5 + Math.random() * 1.2;
          bc.beginPath(); bc.moveTo(0, y); bc.lineTo(S, y + (Math.random()-0.5)*8); bc.stroke();
        }
        break;
      }

      case "granite": {
        // Stein: grobkörnig, ungleichmäßig – wie Granit
        // Grundrauschen
        const img = rc.getImageData(0, 0, S, S);
        for (let i = 0; i < img.data.length; i += 4) {
          const n = 140 + Math.random() * 115;
          img.data[i] = img.data[i+1] = img.data[i+2] = n;
        }
        rc.putImageData(img, 0, 0);
        // Größere Körner
        for (let i = 0; i < 2600; i++) {
          const x = Math.random()*S, y = Math.random()*S;
          const r = 1 + Math.random()*4;
          const v = 100 + Math.random()*140;
          rc.fillStyle = `rgba(${v},${v},${v},.5)`;
          rc.beginPath(); rc.arc(x, y, r, 0, Math.PI*2); rc.fill();
          const bv = Math.random()*255;
          bc.fillStyle = `rgba(${bv},${bv},${bv},.42)`;
          bc.beginPath(); bc.arc(x, y, r*1.6, 0, Math.PI*2); bc.fill();
        }
        break;
      }

      case "marble": {
        // Marmor: geschwungene Adern, wie im Referenzbild
        rc.fillStyle = "#5a5a5a";           // Grundton: eher glänzend
        rc.fillRect(0, 0, S, S);
        for (let i = 0; i < 14; i++) {
          rc.strokeStyle = `rgba(${150+Math.random()*80},${150},${150},.35)`;
          rc.lineWidth = 3 + Math.random() * 16;
          rc.lineCap = "round";
          rc.beginPath();
          let x = Math.random()*S, y = -10;
          rc.moveTo(x, y);
          while (y < S + 10) {
            x += (Math.random()-0.5) * 70;
            y += 16 + Math.random()*18;
            rc.lineTo(x, y);
          }
          rc.stroke();
          // Die Adern leicht erhaben
          bc.strokeStyle = "rgba(190,190,190,.30)";
          bc.lineWidth = rc.lineWidth * 0.5;
          bc.stroke();
        }
        break;
      }

      case "woodgrain": {
        // Holz: längslaufende Maserung mit Jahresringen
        for (let i = 0; i < 60; i++) {
          const x0 = Math.random() * S;
          const v = 70 + Math.random() * 120;
          rc.strokeStyle = `rgba(${v},${v},${v},.45)`;
          rc.lineWidth = 1 + Math.random() * 5;
          rc.beginPath();
          let x = x0, y = 0;
          rc.moveTo(x, y);
          while (y < S) {
            x += (Math.random()-0.5) * 6;
            y += 10;
            rc.lineTo(x, y);
          }
          rc.stroke();
          bc.strokeStyle = `rgba(${v},${v},${v},.38)`;
          bc.lineWidth = rc.lineWidth;
          bc.stroke();
        }
        break;
      }

      case "inclusions": {
        // Kristall: Einschlüsse und Risse im Inneren (siehe Referenzbild)
        rc.fillStyle = "#1a1a1a";     // grundsätzlich sehr glatt
        rc.fillRect(0, 0, S, S);
        // Wolkige Einschlüsse
        for (let i = 0; i < 22; i++) {
          const x = Math.random()*S, y = Math.random()*S;
          const r = 10 + Math.random()*45;
          const g = rc.createRadialGradient(x, y, 1, x, y, r);
          g.addColorStop(0, "rgba(210,210,210,.55)");
          g.addColorStop(1, "transparent");
          rc.fillStyle = g;
          rc.beginPath(); rc.arc(x, y, r, 0, Math.PI*2); rc.fill();
        }
        // Feine Risse
        for (let i = 0; i < 16; i++) {
          rc.strokeStyle = "rgba(235,235,235,.5)";
          rc.lineWidth = 0.6 + Math.random()*1.8;
          rc.beginPath();
          let x = Math.random()*S, y = Math.random()*S;
          rc.moveTo(x, y);
          for (let k = 0; k < 4; k++) {
            x += (Math.random()-0.5)*80;
            y += (Math.random()-0.5)*80;
            rc.lineTo(x, y);
          }
          rc.stroke();
        }
        break;
      }

      case "porous": {
        // Knochen: Poren und feine Risse
        for (let i = 0; i < 900; i++) {
          const x = Math.random()*S, y = Math.random()*S, r = Math.random()*3.4;
          const v = 35 + Math.random()*60;
          bc.fillStyle = `rgba(${v},${v},${v},.6)`;
          bc.beginPath(); bc.arc(x, y, r, 0, Math.PI*2); bc.fill();
          rc.fillStyle = `rgba(210,210,210,.4)`;
          rc.beginPath(); rc.arc(x, y, r, 0, Math.PI*2); rc.fill();
        }
        for (let i = 0; i < 10; i++) {
          bc.strokeStyle = "rgba(45,45,45,.55)";
          bc.lineWidth = 0.8 + Math.random();
          bc.beginPath();
          let x = Math.random()*S, y = Math.random()*S;
          bc.moveTo(x,y);
          for (let k=0;k<5;k++){ x+=(Math.random()-0.5)*55; y+=(Math.random()-0.5)*55; bc.lineTo(x,y); }
          bc.stroke();
        }
        break;
      }

      default:
        // "smooth" – keine Zusatzstruktur
        break;
    }

    const rt = new THREE.CanvasTexture(rough);
    const bt = new THREE.CanvasTexture(bump);
    [rt, bt].forEach(t => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(1, 1);
      t.needsUpdate = true;
    });

    const maps = { roughnessMap: rt, bumpMap: bt, bumpScale: bumpScale || 0 };
    _texCache.set(key, maps);
    return maps;
  }
  // ── Muster: werden auf die Fläche gezeichnet, bevor die Zahl kommt ──────
  const PATTERNS = {
    none:    { label: "Ohne",      icon: "○" },
    marble:  { label: "Marmor",    icon: "🌫" },
    runes:   { label: "Runen",     icon: "ᚱ" },
    stars:   { label: "Sterne",    icon: "✦" },
    mist:    { label: "Nebel",     icon: "☁" },
    scales:  { label: "Schuppen",  icon: "🐉" },
    circuit: { label: "Arkan",     icon: "⚡" },
    cracks:  { label: "Risse",     icon: "⟋" },
    web:     { label: "Spinnweb",  icon: "🕸" },
    leaves:  { label: "Ranken",    icon: "🍃" },
    flames:  { label: "Flammen",   icon: "🔥" },
    frost:   { label: "Frost",     icon: "❄" },
    ripple:  { label: "Wellen",    icon: "〰" },
  };

  // Vorgeschlagene Farben – der Spieler kann jede eigene Farbe wählen.
  const PRESET_COLORS = [
    "#d4b578", "#8a1a1a", "#1a4a7a", "#2a6a3a", "#5a2a7a",
    "#c05a1a", "#1a7a7a", "#7a1a5a", "#2a2a3a", "#e8e6df",
    "#4de0d4", "#9a7fe0", "#e8a838", "#3a8a5a", "#c44a4a",
  ];

  // ── Muster zeichnen ─────────────────────────────────────────────────────
  function _drawPattern(ctx, kind, color, accent) {
    if (!kind || kind === "none") return;
    ctx.save();
    switch (kind) {
      case "marble": {
        // Weiche Adern quer über die Fläche
        ctx.globalAlpha = 0.28;
        ctx.strokeStyle = accent;
        for (let i = 0; i < 7; i++) {
          ctx.lineWidth = 2 + Math.random() * 7;
          ctx.beginPath();
          let x = Math.random() * TEX, y = 0;
          ctx.moveTo(x, y);
          while (y < TEX) {
            x += (Math.random() - 0.5) * 60;
            y += 18 + Math.random() * 26;
            ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        break;
      }
      case "runes": {
        ctx.globalAlpha = 0.30;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        const glyphs = ["ᚠ","ᚢ","ᚦ","ᚨ","ᚱ","ᚲ","ᚷ","ᚹ","ᚺ","ᛃ","ᛈ","ᛇ","ᛉ","ᛊ","ᛏ","ᛒ"];
        ctx.fillStyle = accent;
        ctx.font = "34px serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (let i = 0; i < 6; i++) {
          const g = glyphs[Math.floor(Math.random() * glyphs.length)];
          ctx.fillText(g, 30 + Math.random() * (TEX - 60), 30 + Math.random() * (TEX - 60));
        }
        break;
      }
      case "stars": {
        ctx.globalAlpha = 0.55;
        ctx.fillStyle = accent;
        for (let i = 0; i < 28; i++) {
          const x = Math.random() * TEX, y = Math.random() * TEX;
          const r = 1 + Math.random() * 2.6;
          ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        }
        // Ein paar größere Funkel-Sterne
        ctx.globalAlpha = 0.75;
        for (let i = 0; i < 4; i++) {
          const x = Math.random() * TEX, y = Math.random() * TEX, s = 5 + Math.random() * 5;
          ctx.beginPath();
          ctx.moveTo(x, y - s); ctx.lineTo(x + s*0.28, y - s*0.28);
          ctx.lineTo(x + s, y); ctx.lineTo(x + s*0.28, y + s*0.28);
          ctx.lineTo(x, y + s); ctx.lineTo(x - s*0.28, y + s*0.28);
          ctx.lineTo(x - s, y); ctx.lineTo(x - s*0.28, y - s*0.28);
          ctx.closePath(); ctx.fill();
        }
        break;
      }
      case "mist": {
        for (let i = 0; i < 5; i++) {
          const g = ctx.createRadialGradient(
            Math.random() * TEX, Math.random() * TEX, 6,
            Math.random() * TEX, Math.random() * TEX, 70 + Math.random() * 60);
          g.addColorStop(0, accent + "55");
          g.addColorStop(1, "transparent");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, TEX, TEX);
        }
        break;
      }
      case "scales": {
        ctx.globalAlpha = 0.26;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2.4;
        const r = 22;
        for (let row = 0; row * r * 0.85 < TEX + r; row++) {
          for (let col = 0; col * r * 1.6 < TEX + r; col++) {
            const x = col * r * 1.6 + (row % 2 ? r * 0.8 : 0);
            const y = row * r * 0.85;
            ctx.beginPath();
            ctx.arc(x, y, r, Math.PI * 0.15, Math.PI * 0.85);
            ctx.stroke();
          }
        }
        break;
      }
      case "circuit": {
        // Arkane Leiterbahnen – passt zum Stil des Spiels
        ctx.globalAlpha = 0.42;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        for (let i = 0; i < 9; i++) {
          let x = Math.random() * TEX, y = Math.random() * TEX;
          ctx.beginPath(); ctx.moveTo(x, y);
          for (let k = 0; k < 4; k++) {
            if (Math.random() < 0.5) x += (Math.random() - 0.5) * 90;
            else                     y += (Math.random() - 0.5) * 90;
            ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.beginPath(); ctx.arc(x, y, 3.2, 0, Math.PI * 2);
          ctx.fillStyle = accent; ctx.fill();
        }
        break;
      }
      case "cracks": {
        // Risse, die von der Mitte nach außen laufen
        ctx.globalAlpha = 0.42;
        ctx.strokeStyle = accent;
        ctx.lineCap = "round";
        for (let i = 0; i < 6; i++) {
          const ang = Math.random() * Math.PI * 2;
          let x = TEX/2 + Math.cos(ang) * 20;
          let y = TEX/2 + Math.sin(ang) * 20;
          ctx.lineWidth = 3.4;
          ctx.beginPath(); ctx.moveTo(x, y);
          let a = ang;
          for (let k = 0; k < 5; k++) {
            a += (Math.random() - 0.5) * 0.9;
            const step = 20 + Math.random() * 26;
            x += Math.cos(a) * step;
            y += Math.sin(a) * step;
            ctx.lineTo(x, y);
            ctx.lineWidth = Math.max(0.6, ctx.lineWidth * 0.72);
          }
          ctx.stroke();
        }
        break;
      }
      case "web": {
        // Spinnennetz aus der Ecke
        ctx.globalAlpha = 0.32;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.8;
        const ox = 20, oy = 20;
        const rays = 7;
        for (let i = 0; i <= rays; i++) {
          const a = (i / rays) * (Math.PI / 2);
          ctx.beginPath(); ctx.moveTo(ox, oy);
          ctx.lineTo(ox + Math.cos(a) * TEX, oy + Math.sin(a) * TEX);
          ctx.stroke();
        }
        for (let r = 40; r < TEX * 1.2; r += 34) {
          ctx.beginPath();
          for (let i = 0; i <= rays; i++) {
            const a = (i / rays) * (Math.PI / 2);
            const x = ox + Math.cos(a) * r;
            const y = oy + Math.sin(a) * r;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
        break;
      }
      case "leaves": {
        // Ranken mit kleinen Blättern
        ctx.globalAlpha = 0.36;
        ctx.strokeStyle = accent;
        ctx.fillStyle = accent;
        for (let i = 0; i < 4; i++) {
          let x = Math.random() * TEX, y = TEX + 10;
          const sway = 26 + Math.random() * 24;
          ctx.lineWidth = 2.6;
          ctx.beginPath(); ctx.moveTo(x, y);
          const pts = [];
          while (y > -10) {
            x += Math.sin(y / 34) * (sway / 10);
            y -= 20;
            ctx.lineTo(x, y);
            pts.push([x, y]);
          }
          ctx.stroke();
          // Blätter an die Ranke setzen
          pts.forEach((p, k) => {
            if (k % 2) return;
            const s = 5 + Math.random() * 5;
            const dir = (k % 4 === 0) ? 1 : -1;
            ctx.beginPath();
            ctx.ellipse(p[0] + dir * s, p[1], s, s * 0.55, dir * 0.6, 0, Math.PI * 2);
            ctx.fill();
          });
        }
        break;
      }
      case "flames": {
        // Züngelnde Flammen vom unteren Rand
        for (let i = 0; i < 9; i++) {
          const x = Math.random() * TEX;
          const h = 60 + Math.random() * 110;
          const g = ctx.createLinearGradient(x, TEX, x, TEX - h);
          g.addColorStop(0, accent + "aa");
          g.addColorStop(0.55, accent + "55");
          g.addColorStop(1, "transparent");
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(x - 16, TEX);
          ctx.quadraticCurveTo(x - 9, TEX - h * 0.55, x, TEX - h);
          ctx.quadraticCurveTo(x + 9, TEX - h * 0.55, x + 16, TEX);
          ctx.closePath();
          ctx.fill();
        }
        break;
      }
      case "frost": {
        // Eisblumen: sechsstrahlige Kristalle
        ctx.globalAlpha = 0.44;
        ctx.strokeStyle = accent;
        ctx.lineCap = "round";
        for (let i = 0; i < 5; i++) {
          const cx = Math.random() * TEX, cy = Math.random() * TEX;
          const R = 16 + Math.random() * 28;
          for (let a = 0; a < 6; a++) {
            const ang = (a / 6) * Math.PI * 2;
            ctx.lineWidth = 1.8;
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            const ex = cx + Math.cos(ang) * R, ey = cy + Math.sin(ang) * R;
            ctx.lineTo(ex, ey);
            ctx.stroke();
            // Seitenäste
            [0.45, 0.72].forEach(f => {
              const bx = cx + Math.cos(ang) * R * f;
              const by = cy + Math.sin(ang) * R * f;
              const bl = R * 0.26;
              ctx.lineWidth = 1.1;
              [-0.6, 0.6].forEach(o => {
                ctx.beginPath();
                ctx.moveTo(bx, by);
                ctx.lineTo(bx + Math.cos(ang + o) * bl, by + Math.sin(ang + o) * bl);
                ctx.stroke();
              });
            });
          }
        }
        break;
      }
      case "ripple": {
        // Konzentrische Wellen
        ctx.globalAlpha = 0.30;
        ctx.strokeStyle = accent;
        const cx = TEX * (0.3 + Math.random() * 0.4);
        const cy = TEX * (0.3 + Math.random() * 0.4);
        for (let r = 14; r < TEX; r += 17) {
          ctx.lineWidth = 1.4 + Math.random() * 1.6;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        break;
      }
    }
    ctx.restore();
  }

  // ══════════════════════════════════════════════════════════════════════
  //  FLÄCHEN-TEXTUREN
  //
  //  Koordinaten: Gezeichnet wird in einem LOGISCHEN Raster von TEX×TEX
  //  (256) – die Leinwand selbst ist aber RES×RES (512) groß. So bleiben alle
  //  Maße in den Mustern unverändert, die Zahlen werden trotzdem gestochen
  //  scharf.
  //
  //  Die Textur deckt die GANZE Fläche ab. `layout` (aus dice-geometry.js)
  //  liefert den Umriss der Fläche in Textur-Koordinaten (u nach rechts,
  //  v nach OBEN) und den Inkreis-Radius. Der Inkreis-Mittelpunkt liegt immer
  //  genau in der Texturmitte – dort steht die Zahl.
  //
  //  FRÜHERER W4-FEHLER: v zeigt nach oben, die Leinwand-y-Achse aber nach
  //  unten. Die Eckenzahlen wurden ohne Umrechnung gezeichnet und landeten
  //  dadurch gespiegelt an der falschen Ecke – daher „mehrere Zahlen an einer
  //  Ecke". Jetzt rechnet _toCanvas() sauber um.
  // ══════════════════════════════════════════════════════════════════════

  const RES = 512;   // «STELLSCHRAUBE» echte Texturauflösung je Fläche

  function _canvas() {
    const c = document.createElement("canvas");
    c.width = c.height = RES;
    const ctx = c.getContext("2d");
    ctx.setTransform(RES / TEX, 0, 0, RES / TEX, 0, 0);
    return { c, ctx };
  }
  const _toCanvas = (uv) => [uv[0] * TEX, (1 - uv[1]) * TEX];

  function _polyPath(ctx, poly, inset) {
    // inset: 0 = genau auf der Kante, 1 = im Mittelpunkt
    const cx = TEX / 2, cy = TEX / 2;
    ctx.beginPath();
    poly.forEach((uv, i) => {
      let [x, y] = _toCanvas(uv);
      x = cx + (x - cx) * (1 - inset); y = cy + (y - cy) * (1 - inset);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.closePath();
  }

  /** Untergrund (Körperfarbe, Verlauf, Zweitfarbe). */
  function _drawBackground(ctx, style) {
    const body = style.color || "#d4b578";
    const g = ctx.createLinearGradient(0, 0, TEX, TEX);
    g.addColorStop(0, _lighten(body, 0.14));
    g.addColorStop(0.5, body);
    g.addColorStop(1, _darken(body, 0.12));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, TEX, TEX);

    if (style.color2) {
      const g2 = ctx.createRadialGradient(TEX * 0.28, TEX * 0.26, TEX * 0.05,
                                          TEX * 0.28, TEX * 0.26, TEX * 0.85);
      g2.addColorStop(0, style.color2);
      g2.addColorStop(0.55, style.color2 + "77");
      g2.addColorStop(1, "transparent");
      ctx.fillStyle = g2;
      ctx.fillRect(0, 0, TEX, TEX);
    }
  }

  /** Rahmen AUF der Fläche – folgt jetzt dem echten Umriss (Dreieck,
   *  Fünfeck, Drachen …) statt eines Kreises. */
  function _drawBorder(ctx, style, layout) {
    if (!style.border || style.border === "none" || !layout) return;
    const bw = (style.borderWidth || 8) * 0.55;
    ctx.save();
    ctx.strokeStyle = style.borderColor || "#f0d79c";
    ctx.lineWidth = bw;
    ctx.lineJoin = "round";
    ctx.globalAlpha = 0.9;
    if (style.border === "glow") {
      ctx.shadowColor = style.borderColor || "#4de0d4";
      ctx.shadowBlur = 12;
    }
    if (style.border === "dashed") ctx.setLineDash([12, 8]);
    _polyPath(ctx, layout.poly, 0.14);
    ctx.stroke();
    ctx.restore();
  }

  /** Kantenfärbung: ein Farbband genau auf den Kanten des Würfels.
   *  Weil beide angrenzenden Flächen die Hälfte des Bandes zeichnen, wirkt
   *  es wie eine durchgehend lackierte Kante. */
  const EDGE_STYLES = {                     // «STELLSCHRAUBE» Kantenbreite
    subtle: { width: 7,  alpha: 0.75 },
    bold:   { width: 15, alpha: 1.0  },
  };
  function _drawEdges(ctx, style, layout) {
    const e = EDGE_STYLES[style.edges];
    if (!e || !layout) return;
    ctx.save();
    ctx.strokeStyle = style.edgeColor || "#f0d79c";
    ctx.globalAlpha = e.alpha;
    ctx.lineWidth = e.width * 2;           // halbe Breite liegt außerhalb der Fläche
    ctx.lineJoin = "round";
    _polyPath(ctx, layout.poly, 0);
    ctx.stroke();
    // feine Glanzlinie innen, damit die Kante plastisch wirkt
    ctx.globalAlpha = e.alpha * 0.35;
    ctx.strokeStyle = _lighten(style.edgeColor || "#f0d79c", 0.5);
    ctx.lineWidth = 1.5;
    _polyPath(ctx, layout.poly, e.width / (TEX * 0.5) * 0.9);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Zahl(en) einer Fläche zeichnen. Wird für die Farbtextur, die Leucht-
   * karte (Glas) und die Gravur-Karte (Metall/Stein/Holz) benutzt – so liegen
   * alle drei garantiert exakt übereinander.
   *
   * mode: "color" (mit Umrandung + Schatten) | "mask" (nur Füllung)
   */
  function _drawNumbers(ctx, face, style, mode) {
    const font  = style.font || "'Cinzel', Georgia, serif";
    const scale = Math.max(0.5, Math.min(1.5, style.numberScale ?? 1));
    const num   = style.numberColor || (mode === "color" ? _contrast(style.color || "#d4b578") : "#ffffff");
    const cx = TEX / 2, cy = TEX / 2;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    const paint = (txt, x, y, ang, size) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(ang);
      ctx.font = `bold ${size}px ${font}`;
      if (mode === "color") {
        const outlineW = style.numberOutline ?? 0.08;
        if (outlineW > 0) {
          ctx.lineWidth = Math.max(1.5, size * outlineW);
          ctx.strokeStyle = style.outlineColor || _contrast(num);
          ctx.lineJoin = "round";
          ctx.strokeText(txt, 0, 0);
        }
        ctx.shadowColor = "rgba(0,0,0,.35)";
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 1.5;
      }
      ctx.fillStyle = mode === "color" ? num : (style._maskColor || "#ffffff");
      ctx.fillText(txt, 0, 0);
      ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
      // 6 und 9 unterstreichen (nicht beim W6 – dort gibt es kein „oben")
      if ((txt === "6" || txt === "9") && face.sides !== 6) {
        const w = size * 0.42;
        ctx.fillRect(-w / 2, size * 0.42, w, Math.max(1.5, size * 0.065));
      }
      ctx.restore();
    };

    if (face.sides === 4) {
      // Drei Zahlen, je eine an jeder Ecke, Kopf zur Ecke.
      const size = TEX * 0.19 * scale;
      face.layout.poly.forEach((uv, k) => {
        const [ux, uy] = _toCanvas(uv);
        const PULL = 0.58;                  // «STELLSCHRAUBE» 0 = Mitte, 1 = Ecke
        const x = cx + (ux - cx) * PULL, y = cy + (uy - cy) * PULL;
        const ang = Math.atan2(uy - cy, ux - cx) + Math.PI / 2;
        paint(String(face.cornerLabels[k]), x, y, ang, size);
      });
      return;
    }

    const txt = String(face.label);
    const r = face.layout.inR * TEX;              // Inkreis in Leinwand-Pixeln
    // «STELLSCHRAUBE» Zahlengröße relativ zum Inkreis der Fläche
    let size = (txt.length > 1 ? 1.05 : 1.38) * r * scale;
    ctx.font = `bold ${size}px ${font}`;
    const maxW = r * 1.62;
    const w = ctx.measureText(txt).width;
    if (w > maxW) size *= maxW / w;
    paint(txt, cx, cy, 0, size);
  }

  /** Farbtextur einer Fläche. */
  function makeFaceTexture(face, style) {
    const { c, ctx } = _canvas();
    _drawBackground(ctx, style);
    _drawPattern(ctx, style.pattern, style.color || "#d4b578", style.accentColor || "#ffffff");
    _drawBorder(ctx, style, face.layout);
    if (!face.bevel) _drawEdges(ctx, style, face.layout);   // mit Kantenstreifen: echte Kanten
    _drawNumbers(ctx, face, style, "color");
    const tex = new THREE.CanvasTexture(c);
    if (THREE.SRGBColorSpace) tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    tex.needsUpdate = true;
    return tex;
  }

  /** Karte mit NUR der Zahl (schwarz = nichts, weiß = Zahl).
   *  kind "glow": Leuchtkarte für Glas/Kristall; "engrave": Gravur. */
  function _maskMap(face, style, kind) {
    const { c, ctx } = _canvas();
    ctx.fillStyle = kind === "engrave" ? "#808080" : "#000000";
    ctx.fillRect(0, 0, TEX, TEX);
    if (kind === "glow") {
      // Bei durchsichtigen Würfeln ist die Farbtextur kaum zu sehen – Kanten
      // und Rahmen leuchten deshalb zusätzlich selbst (wirkt wie Neon-Linien).
      _drawBorder(ctx, style, face.layout);
      if (!face.bevel) _drawEdges(ctx, style, face.layout);
      // Leuchtet in Zahlenfarbe
      _drawNumbers(ctx, face, Object.assign({}, style, { _maskColor: style.numberColor || "#ffffff" }), "mask");
    } else {
      _drawNumbers(ctx, face, style, "mask");
    }
    const tex = new THREE.CanvasTexture(c);
    tex.needsUpdate = true;
    return tex;
  }

  /**
   * Baut die Materialien für einen Würfel – eines pro Fläche.
   *
   * @param {number} sides   4, 6, 8, 10, 12, 20, 100
   * @param {object} geo     Ergebnis von DiceGeometry.build (layout + values)
   * @param {object} style   Aussehen (siehe DEFAULT_DIE_STYLE)
   *
   * Materialien werden pro (Würfel + Aussehen) zwischengespeichert: Ein Wurf
   * zeichnet also nicht jedes Mal alle Texturen neu (das kostete beim ersten
   * Wurf spürbar Zeit). Die Materialien sind GETEILT – nicht disposen,
   * stattdessen clearCache() benutzen.
   */
  const _matCache = new Map();
  const MAT_CACHE_MAX = 24;                  // «STELLSCHRAUBE» wie viele Sätze im Speicher bleiben

  function build(sides, geo, style) {
    const key = sides + "|" + JSON.stringify(style);
    if (_matCache.has(key)) {
      const hit = _matCache.get(key);
      _matCache.delete(key); _matCache.set(key, hit);   // als „zuletzt benutzt" markieren
      return hit;
    }
    const surf = SURFACES[style.surface] || SURFACES.plastic;
    const maps = _surfaceMaps(surf.texture, surf.bumpScale);

    const faces = geo.layout.map((layout, fi) => ({
      sides, layout, bevel: !!geo.bevel,
      label: _labelText(sides, geo.values[fi]),
      cornerLabels: sides === 4 ? layout.cornerIds.map(id => geo.values[id]) : null,
    }));

    const mats = faces.map(face => {
      const params = Object.assign({
        color: new THREE.Color(0xffffff),   // neutral – die Farbe steckt in der Textur
        map: makeFaceTexture(face, style),
        side: THREE.FrontSide,
      }, surf.params);

      if (maps.roughnessMap) params.roughnessMap = maps.roughnessMap;
      if (maps.bumpScale > 0) { params.bumpMap = maps.bumpMap; params.bumpScale = maps.bumpScale; }

      if (surf.engraved) {
        params.bumpMap = _maskMap(face, style, "engrave");
        params.bumpScale = -0.08;          // negativ = vertieft
      }
      if (surf.seeThrough) {
        params.side = THREE.DoubleSide;
        params.emissive = new THREE.Color(0xffffff);
        params.emissiveMap = _maskMap(face, style, "glow");
        params.emissiveIntensity = 0.55;
        params.attenuationColor = new THREE.Color(style.color || "#a8d8e8");
      }
      // Leuchtende Zahlen (für jede Oberfläche): Zahl als Leuchtkarte
      const glow = Math.max(0, Math.min(1, +style.numberGlow || 0));
      if (glow > 0 && !surf.seeThrough) {
        params.emissive = new THREE.Color(0xffffff);
        params.emissiveMap = _maskMap(face, style, "glow");
        params.emissiveIntensity = 0.25 + glow * 1.4;
      }
      const M = THREE.MeshPhysicalMaterial || THREE.MeshStandardMaterial;
      return new M(params);
    });

    // Material der abgerundeten Kanten: Kantenfarbe, sonst ein Hauch dunkler
    // als der Körper. Bei Glas/Kristall leuchten gefärbte Kanten (Neon-Look).
    if (geo.bevel) {
      const M = THREE.MeshPhysicalMaterial || THREE.MeshStandardMaterial;
      const hasEdge = style.edges && style.edges !== "none";
      const base = hasEdge ? (style.edgeColor || "#f0d79c") : _darken(style.color || "#d4b578", 0.08);
      const ep = Object.assign({}, surf.params, { color: new THREE.Color(base), side: THREE.FrontSide });
      if (maps.roughnessMap) ep.roughnessMap = maps.roughnessMap;
      if (hasEdge && style.edges === "bold") { ep.metalness = Math.max(ep.metalness || 0, 0.6); ep.roughness = Math.min(ep.roughness ?? .5, .3); }
      if (surf.seeThrough && hasEdge) {
        ep.transmission = 0; ep.emissive = new THREE.Color(base); ep.emissiveIntensity = style.edges === "bold" ? 1.1 : .6;
      }
      mats.push(new M(ep));
    }

    _matCache.set(key, mats);
    while (_matCache.size > MAT_CACHE_MAX) {
      const oldest = _matCache.keys().next().value;
      _disposeMats(_matCache.get(oldest));
      _matCache.delete(oldest);
    }
    return mats;
  }

  function _disposeMats(mats) {
    (mats || []).forEach(m => {
      ["map", "emissiveMap"].forEach(k => { if (m[k]) m[k].dispose(); });
      if (m.bumpMap && !Array.from(_texCache.values()).some(t => t.bumpMap === m.bumpMap)) m.bumpMap.dispose();
      m.dispose();
    });
  }
  /** Kleine Vorschau eines Musters (für die Werkstatt). */
  function patternPreview(pattern, color, accent, size) {
    size = size || 96;
    const c = document.createElement("canvas"); c.width = c.height = size;
    const ctx = c.getContext("2d");
    ctx.setTransform(size / TEX, 0, 0, size / TEX, 0, 0);
    _drawBackground(ctx, { color: color || "#3a3550" });
    try { _drawPattern(ctx, pattern, color || "#3a3550", accent || "#ffffff"); } catch (e) {}
    return c.toDataURL();
  }

  function clearCache() { _matCache.forEach(_disposeMats); _matCache.clear(); }

  /** Zahlenwert → Beschriftung (W100: „00", „10" …). */
  function _labelText(sides, value) {
    if (sides === 100) return String(value).padStart(2, "0");
    return String(value);
  }

  // ── Farb-Hilfen ─────────────────────────────────────────────────────────
  function _hex(c) {
    const s = String(c).replace("#", "");
    return {
      r: parseInt(s.substring(0,2), 16) || 0,
      g: parseInt(s.substring(2,4), 16) || 0,
      b: parseInt(s.substring(4,6), 16) || 0,
    };
  }
  const _clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  const _toHex = ({r,g,b}) =>
    "#" + [r,g,b].map(v => _clamp(v).toString(16).padStart(2,"0")).join("");

  function _lighten(c, amt) {
    const { r,g,b } = _hex(c);
    return _toHex({ r: r + (255-r)*amt, g: g + (255-g)*amt, b: b + (255-b)*amt });
  }
  function _darken(c, amt) {
    const { r,g,b } = _hex(c);
    return _toHex({ r: r*(1-amt), g: g*(1-amt), b: b*(1-amt) });
  }
  /** Schwarz oder Weiß – je nachdem, was besser lesbar ist. */
  function _contrast(c) {
    const { r,g,b } = _hex(c);
    return (0.299*r + 0.587*g + 0.114*b) > 140 ? "#000000" : "#ffffff";
  }

  return {
    build, makeFaceTexture, ensureFonts, clearCache, EDGE_STYLES, patternPreview,
    SURFACES, PATTERNS, PRESET_COLORS,
    contrast: _contrast,
  };
})();
