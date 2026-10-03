/* ══════════════════════════════════════════════════════════════════════════
   dice-presets.js – fertige Würfel-Looks
   ══════════════════════════════════════════════════════════════════════════
   Wird von dice3d.js (Übernehmen als Set) und vom Design-Studio (Anzeige,
   auch im Hauptmenü ohne 3D-Engine) gelesen. Jede Vorlage überschreibt nur
   die angegebenen Werte von Dice3D.DEFAULT_DIE_STYLE.
   «STELLSCHRAUBE» neue Vorlage = neuer Eintrag.
   ══════════════════════════════════════════════════════════════════════════ */
const MONO = "'Orbitron', 'Segoe UI', sans-serif";
const DicePresets = [
  { id: "messing", name: "Messing & Nacht", tag: "Fantasy × Modern",
    style: { surface: "metal", color: "#c8a24a", numberColor: "#1b1407", pattern: "none",
             edges: "subtle", edgeColor: "#f0d79c" } },
  { id: "obsidian", name: "Obsidian", tag: "Edel",
    style: { surface: "plastic", color: "#141319", color2: "#2a2140", numberColor: "#e8c46a",
             outlineColor: "#000000", edges: "subtle", edgeColor: "#b8944a" } },
  { id: "blutstein", name: "Blutstein", tag: "Düster",
    style: { surface: "stone", color: "#4a0f0c", color2: "#1a0504", numberColor: "#e6d8bc",
             pattern: "cracks", accentColor: "#0a0202", font: "'Uncial Antiqua', serif" } },
  { id: "tinte", name: "Elfenbein & Tinte", tag: "Klassisch",
    style: { surface: "plastic", color: "#efe4c8", numberColor: "#2a1a0a", outlineColor: "#efe4c8",
             border: "solid", borderColor: "#8a5a1c", borderWidth: 5 } },
  { id: "neonkern", name: "Neon-Kern", tag: "Futuristisch",
    style: { surface: "glass", color: "#0b1a26", numberColor: "#2fe3ff", font: MONO,
             numberOutline: 0, edges: "subtle", edgeColor: "#2fe3ff", pattern: "circuit", accentColor: "#ff3ea5" } },
  { id: "holochrom", name: "Holo-Chrom", tag: "Futuristisch",
    style: { surface: "metal", color: "#c9d3e0", color2: "#ff3ea5", numberColor: "#0a0f1c", font: MONO,
             edges: "subtle", edgeColor: "#2fe3ff" } },
  { id: "plasma", name: "Plasma", tag: "Futuristisch",
    style: { surface: "crystal", color: "#5b1a8a", color2: "#ff3ea5", numberColor: "#ffffff", font: MONO,
             numberOutline: 0, border: "glow", borderColor: "#ff6ad0", borderWidth: 6 } },
  { id: "mondglas", name: "Mondglas", tag: "Elfisch",
    style: { surface: "crystal", color: "#a9d8a2", numberColor: "#ffffff", pattern: "leaves",
             accentColor: "#e8fff0" } },
  { id: "frostzahn", name: "Frostzahn", tag: "Eis",
    style: { surface: "glass", color: "#9fd4ff", numberColor: "#0b2440", pattern: "frost",
             accentColor: "#ffffff", edges: "subtle", edgeColor: "#e8f6ff" } },
  { id: "eichenholz", name: "Eichenholz", tag: "Natur",
    style: { surface: "wood", color: "#8a5a2c", numberColor: "#f3e2c0" } },
  { id: "perlmond", name: "Perlmond", tag: "Edel",
    style: { surface: "pearl", color: "#f2ece4", color2: "#d9d0ea", numberColor: "#4a3a66", outlineColor: "#ffffff",
             edges: "subtle", edgeColor: "#e6dcf5" } },
  { id: "prisma", name: "Prisma", tag: "Futuristisch",
    style: { surface: "holo", color: "#c8ccd8", numberColor: "#101322", font: "'Orbitron', 'Segoe UI', sans-serif",
             edges: "bold", edgeColor: "#e8ecff" } },
  { id: "vulkanglas", name: "Vulkanglas", tag: "Düster",
    style: { surface: "obsidian", color: "#0d0b10", numberColor: "#ff9a3c", numberGlow: 0.8, outlineColor: "#2a0a00",
             pattern: "cracks", accentColor: "#ff6a1a", edges: "subtle", edgeColor: "#3a1a10" } },
  { id: "smaragd", name: "Smaragd", tag: "Edelstein",
    style: { surface: "crystal", color: "#14a06a", color2: "#0a4a32", numberColor: "#f4fff0",
             edges: "subtle", edgeColor: "#d8ffe8" } },
];
