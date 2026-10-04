/* ══════════════════════════════════════════════════════════════════════════
   design-runtime.js – Designs als Dateien (.vttdesign)
   ══════════════════════════════════════════════════════════════════════════
   Ein Design ist eine kleine JSON-Datei:
     { vttdesign: 1, id, name, scope: "ui" | "table", version, author,
       tag, description, params: {…}, vars: { "--gold": "#…", … } }

   • vars    – die fertigen CSS-Variablen (siehe themes.css). Daraus wird
               [data-ui-theme="id"] { … } bzw. [data-table-theme="id"] { … }
   • params  – die Grundeinstellungen aus dem Design-Editor (nur zum
               Weiterbearbeiten; das Spiel braucht nur vars)

   Eingebaut sind nur „Arkanum" (Oberfläche) und „Arkaner Tisch". Alle
   weiteren kommen aus dem Design-Katalog (GitHub, im Launcher) oder werden
   selbst gebaut / importiert und liegen im Profil (Schlüssel vtt_designs).

   SICHERHEIT: Importierte Designs dürfen nur bekannte Variablen setzen, und
   die Werte werden streng geprüft – ein fremdes Design kann so kein eigenes
   CSS (Regeln, externe Bilder, Skripte) einschleusen.

   Wird von theme.js (Spiel), design-studio.js (Editor) und dem Launcher
   benutzt. Keine Nebenwirkungen beim Laden.
   ══════════════════════════════════════════════════════════════════════════ */
const DesignRuntime = (() => {
  "use strict";

  const UI_VARS = ["--gold","--gold-light","--gold-dark","--gold-rgb","--arcane","--arcane-dim","--arcane-deep","--arcane-rgb",
    "--arcane-violet","--violet-rgb","--purple","--crimson","--crimson-rgb","--bg-deep","--bg-dark","--bg-mid","--bg-panel",
    "--bg-panel2","--border","--border-rgb","--text","--text-dim","--text-bright","--on-accent","--green","--green-soft",
    "--green-rgb","--red","--red-soft","--red-rgb","--blue","--blue-soft","--blue-rgb","--shade-rgb","--hi-rgb","--panel-rgb",
    "--font-display","--font-body","--font-ui","--font-mono","--radius","--radius-lg","--glow-arcane","--glow-gold","--edge",
    "--backdrop","--stars-opacity"];
  const TABLE_VARS = ["--table-bg","--table-bg-image","--table-grid-rgb","--table-fog-rgb","--table-measure"];

  // Schriften, die die App mitbringt (fonts.css) + sichere Systemschriften
  const FONTS = {
    "Cinzel":           "'Cinzel', Georgia, serif",
    "Cinzel Decorative":"'Cinzel Decorative', 'Cinzel', Georgia, serif",
    "Uncial Antiqua":   "'Uncial Antiqua', 'Cinzel', Georgia, serif",
    "Orbitron":         "'Orbitron', 'Segoe UI', sans-serif",
    "Crimson Pro":      "'Crimson Pro', Georgia, serif",
    "Segoe UI":         "'Segoe UI', system-ui, sans-serif",
    "Georgia":          "Georgia, 'Times New Roman', serif",
    "JetBrains Mono":   "'JetBrains Mono', Consolas, monospace",
  };

  // ── Prüfung ─────────────────────────────────────────────────────────────
  const BAD = /[{};<>@\\]|url\s*\(|expression|javascript:|import/i;
  const SAFE_VALUE = /^[#\w\s,.%()'"\-+*/:]*$/;
  function _safeValue(v) {
    v = String(v ?? "").trim();
    if (!v || v.length > 600 || BAD.test(v) || !SAFE_VALUE.test(v)) return null;
    return v;
  }
  const _safeId = id => String(id || "").toLowerCase().replace(/[^a-z0-9_.\-]/g, "").slice(0, 60);

  /** Design prüfen und bereinigen. Gibt null zurück, wenn es unbrauchbar ist. */
  function sanitize(d) {
    if (!d || typeof d !== "object") return null;
    const scope = d.scope === "table" ? "table" : d.scope === "ui" ? "ui" : null;
    const id = _safeId(d.id);
    if (!scope || !id || id === "arkanum" || id === "arkan") return null;
    const allowed = scope === "ui" ? UI_VARS : TABLE_VARS;
    const vars = {};
    Object.entries(d.vars || {}).forEach(([k, v]) => {
      if (!allowed.includes(k)) return;
      const sv = _safeValue(v);
      if (sv !== null) vars[k] = sv;
    });
    if (!Object.keys(vars).length) return null;
    return {
      vttdesign: 1, id, scope,
      name: String(d.name || id).slice(0, 50),
      version: String(d.version || "1.0.0").slice(0, 20),
      author: String(d.author || "").slice(0, 50),
      tag: String(d.tag || "").slice(0, 30),
      description: String(d.description || "").slice(0, 200),
      scheme: d.scheme === "light" ? "light" : "dark",
      params: (d.params && typeof d.params === "object") ? JSON.parse(JSON.stringify(d.params)) : null,
      // Übersetzungen von Name/Tag/Beschreibung (nur Texte)
      i18n: (d.i18n && typeof d.i18n === "object") ? Object.fromEntries(Object.entries(d.i18n).filter(([l]) => /^[a-z]{2}$/.test(l)).map(([l, v]) =>
              [l, { name: String((v || {}).name || "").slice(0, 50), tag: String((v || {}).tag || "").slice(0, 30), description: String((v || {}).description || "").slice(0, 200) }])) : undefined,
      vars,
    };
  }

  /** CSS-Block für ein Design. */
  function css(d) {
    d = sanitize(d);
    if (!d) return "";
    const sel = d.scope === "ui" ? `[data-ui-theme="${d.id}"]` : `[data-table-theme="${d.id}"]`;
    const body = Object.entries(d.vars).map(([k, v]) => `  ${k}: ${v};`).join("\n");
    return `${sel} {\n${body}${d.scope === "ui" ? `\n  color-scheme: ${d.scheme};` : ""}\n}\n`;
  }

  // ── Farbhelfer ──────────────────────────────────────────────────────────
  function hex2rgb(h) {
    h = String(h || "").replace("#", "");
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    const n = parseInt(h.slice(0, 6), 16);
    return isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb2hex = ([r, g, b]) => "#" + [r, g, b].map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0")).join("");
  const mix = (a, b, t) => { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A.map((x, i) => x + (B[i] - x) * t)); };
  const lighten = (c, t) => mix(c, "#ffffff", t);
  const darken = (c, t) => mix(c, "#000000", t);
  const triple = c => hex2rgb(c).join(",");
  const lum = c => { const [r, g, b] = hex2rgb(c).map(v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }); return .2126 * r + .7152 * g + .0722 * b; };

  // ── Generator für den Editor ────────────────────────────────────────────
  // Aus wenigen Grundfarben entsteht ein vollständiger, stimmiger Satz.
  const UI_DEFAULTS = {
    scheme: "dark", bg: "#06070d", panel: "#171a26", text: "#dcd4c2",
    accent: "#d4b578", accent2: "#4de0d4", danger: "#d64545", success: "#4fae6d",
    fontDisplay: "Cinzel", fontBody: "Crimson Pro", radius: 8, glow: 60, stars: 100,
  };
  function generateUI(p) {
    p = Object.assign({}, UI_DEFAULTS, p || {});
    const light = p.scheme === "light";
    const bgDark = mix(p.bg, p.panel, .3), bgMid = mix(p.bg, p.panel, .6);
    const panel2 = light ? darken(p.panel, .04) : lighten(p.panel, .05);
    const border = mix(p.panel, p.text, light ? .22 : .14);
    const g = Math.max(0, Math.min(100, +p.glow)) / 100;
    const r = Math.max(0, Math.min(24, +p.radius));
    const vars = {
      "--gold": p.accent, "--gold-light": light ? darken(p.accent, .25) : lighten(p.accent, .32),
      "--gold-dark": light ? lighten(p.accent, .25) : darken(p.accent, .35), "--gold-rgb": triple(p.accent),
      "--arcane": p.accent2, "--arcane-dim": darken(p.accent2, .3), "--arcane-deep": mix(p.accent2, p.bg, .82),
      "--arcane-rgb": triple(p.accent2), "--arcane-violet": mix(p.accent2, "#9a7fe0", .55), "--violet-rgb": triple(mix(p.accent2, "#9a7fe0", .55)),
      "--purple": mix(p.accent2, "#7a5a9a", .6), "--crimson": darken(p.danger, .35), "--crimson-rgb": triple(darken(p.danger, .35)),
      "--bg-deep": p.bg, "--bg-dark": bgDark, "--bg-mid": bgMid, "--bg-panel": p.panel, "--bg-panel2": panel2,
      "--border": border, "--border-rgb": triple(border),
      "--text": p.text, "--text-dim": mix(p.text, p.bg, .45), "--text-bright": light ? darken(p.text, .3) : lighten(p.text, .35),
      "--on-accent": lum(p.accent) > .35 ? darken(p.accent, .85) : lighten(p.accent, .9),
      "--green": p.success, "--green-soft": light ? darken(p.success, .15) : lighten(p.success, .35), "--green-rgb": triple(p.success),
      "--red": p.danger, "--red-soft": light ? darken(p.danger, .1) : lighten(p.danger, .25), "--red-rgb": triple(p.danger),
      "--shade-rgb": light ? triple(darken(p.bg, .7)) : "0,0,0",
      "--hi-rgb": light ? triple(darken(p.text, .2)) : triple(lighten(p.text, .7)),
      "--panel-rgb": triple(light ? p.panel : bgDark),
      "--font-display": FONTS[p.fontDisplay] || FONTS["Cinzel"], "--font-body": FONTS[p.fontBody] || FONTS["Crimson Pro"],
      "--radius": r + "px", "--radius-lg": Math.round(r * 1.7) + "px",
      "--backdrop": `radial-gradient(ellipse 80% 55% at 50% 0%, rgba(${triple(p.accent2)},${(.10 * g).toFixed(3)}) 0%, transparent 60%), ` +
                    `radial-gradient(ellipse 45% 45% at 10% 75%, rgba(${triple(p.accent)},${(.08 * g).toFixed(3)}) 0%, transparent 55%)`,
      "--stars-opacity": light ? "0" : String(Math.max(0, Math.min(100, +p.stars)) / 100),
    };
    return { vars, scheme: light ? "light" : "dark", params: p };
  }

  const TABLE_DEFAULTS = { bg: "#04050a", pattern: "glow", patternStrength: 50, grid: "#d4b578", fog: "#06060c", measure: "#ffd95a" };
  const TABLE_PATTERNS = {
    none:   "Einfarbig",
    glow:   "Sanfter Schimmer",
    wood:   "Holzmaserung",
    stone:  "Steinplatten",
    grid:   "Leuchtraster",
    paper:  "Pergament",
  };
  function generateTable(p) {
    p = Object.assign({}, TABLE_DEFAULTS, p || {});
    const s = Math.max(0, Math.min(100, +p.patternStrength)) / 100;
    const bg = p.bg, hi = lighten(bg, .18), lo = darken(bg, .4);
    const img = {
      none:  `linear-gradient(${bg}, ${bg})`,
      glow:  `radial-gradient(ellipse at 50% 40%, ${mix(bg, "#ffffff", .08 * s + .02)} 0%, ${bg} 70%)`,
      wood:  `repeating-linear-gradient(90deg, rgba(0,0,0,${(.25 * s).toFixed(2)}) 0 2px, transparent 2px 140px), ` +
             `repeating-linear-gradient(0deg, rgba(255,220,170,${(.05 * s).toFixed(3)}) 0 1px, transparent 1px 7px), linear-gradient(180deg, ${hi}, ${lo})`,
      stone: `repeating-linear-gradient(0deg, rgba(0,0,0,${(.45 * s).toFixed(2)}) 0 2px, transparent 2px 64px), ` +
             `repeating-linear-gradient(90deg, rgba(0,0,0,${(.45 * s).toFixed(2)}) 0 2px, transparent 2px 64px), radial-gradient(ellipse at 50% 50%, ${hi} 0%, ${lo} 80%)`,
      grid:  `linear-gradient(rgba(${triple(p.grid)},${(.08 * s).toFixed(3)}) 1px, transparent 1px) 0 0/32px 32px, ` +
             `linear-gradient(90deg, rgba(${triple(p.grid)},${(.08 * s).toFixed(3)}) 1px, transparent 1px) 0 0/32px 32px, radial-gradient(ellipse at 50% 50%, ${hi} 0%, ${bg} 75%)`,
      paper: `radial-gradient(ellipse at 50% 45%, ${lighten(bg, .3)} 0%, ${bg} 60%, ${darken(bg, .2 + .2 * s)} 100%)`,
    }[p.pattern] || `linear-gradient(${bg}, ${bg})`;
    return { vars: { "--table-bg": bg, "--table-bg-image": img, "--table-grid-rgb": triple(p.grid),
                     "--table-fog-rgb": triple(p.fog), "--table-measure": p.measure }, params: p };
  }

  return { sanitize, css, generateUI, generateTable, UI_DEFAULTS, TABLE_DEFAULTS, TABLE_PATTERNS, FONTS,
           UI_VARS, TABLE_VARS, mix, lighten, darken, hex2rgb };
})();
