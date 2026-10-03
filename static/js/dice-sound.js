/* ══════════════════════════════════════════════════════════════════════════
   DiceSound – wie ein Würfel klingt, wenn er aufschlägt.

   Die Klänge werden im Browser erzeugt, nicht aus Dateien geladen. Das hat
   zwei Vorteile: Sie passen sich der Aufprallstärke an (ein sanftes Aufsetzen
   klingt anders als ein harter Wurf), und die App bleibt klein.

   Jedes Material hat seinen eigenen Charakter:
     Kunststoff – kurzer, trockener Klack
     Metall     – heller Klang mit Nachhall
     Glas       – hohes Klirren
     Stein      – dumpfer, kurzer Schlag
     Holz       – warmer, hohler Ton
     Knochen    – trocken, mit leichtem Klappern
   ══════════════════════════════════════════════════════════════════════════ */
const DiceSound = (() => {

  let ctx = null;
  let master = null;
  let enabled = true;
  let volume = 0.5;

  // Klangprofile: Grundton, Obertöne, Abklingzeit, Rauschanteil
  const PROFILES = {
    plastic: {
      freqs: [520, 880, 1400],
      decay: 0.09,
      noise: 0.55,          // viel Anschlaggeräusch, wenig Ton
      noiseDecay: 0.05,
      filter: 2600,
      gain: 0.85,
    },
    metal: {
      freqs: [740, 1180, 1760, 2640, 3300],
      decay: 0.55,          // klingt lange nach
      noise: 0.18,
      noiseDecay: 0.03,
      filter: 6500,
      gain: 0.7,
      ring: true,           // metallisches Schwingen
    },
    glass: {
      freqs: [1450, 2200, 3100, 4300],
      decay: 0.34,
      noise: 0.14,
      noiseDecay: 0.02,
      filter: 8000,
      gain: 0.55,
      ring: true,
    },
    stone: {
      freqs: [180, 260, 380],
      decay: 0.06,          // sehr kurz, dumpf
      noise: 0.75,
      noiseDecay: 0.06,
      filter: 900,
      gain: 1.0,
    },
    wood: {
      freqs: [320, 520, 760],
      decay: 0.14,
      noise: 0.45,
      noiseDecay: 0.05,
      filter: 1800,
      gain: 0.9,
      ring: true,           // leicht hohl
    },
  };

  function _ensure() {
    if (ctx) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Kurzes Rauschen – das ist der "Anschlag" beim Aufprall. */
  function _noiseBuffer(seconds) {
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      // Zum Ende hin leiser – das gibt den knackigen Anschlag
      data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    }
    return buf;
  }

  /**
   * Spielt einen Aufprall.
   * @param {string} surface  Material (plastic, metal, glass …)
   * @param {number} strength 0…1 – wie hart der Aufprall war
   */
  function impact(surface, strength = 0.6) {
    if (!enabled || !_ensure()) return;
    if (ctx.state === "suspended") ctx.resume();

    const p = PROFILES[surface] || PROFILES.plastic;
    const s = Math.max(0.05, Math.min(1, strength));
    const now = ctx.currentTime;

    // Lautstärke und Klangfarbe hängen von der Aufprallstärke ab:
    // ein sanftes Aufsetzen klingt dumpfer und leiser.
    const vol = 0.12 + s * 0.5;

    // ── Anschlag (Rauschen) ───────────────────────────────────────────────
    if (p.noise > 0) {
      const src = ctx.createBufferSource();
      src.buffer = _noiseBuffer(p.noiseDecay * 2);
      const ng = ctx.createGain();
      const nf = ctx.createBiquadFilter();
      nf.type = "lowpass";
      nf.frequency.value = p.filter * (0.5 + s * 0.5);
      nf.Q.value = 0.8;
      ng.gain.setValueAtTime(vol * p.noise * p.gain, now);
      ng.gain.exponentialRampToValueAtTime(0.0001, now + p.noiseDecay);
      src.connect(nf); nf.connect(ng); ng.connect(master);
      src.start(now);
      src.stop(now + p.noiseDecay * 2);
    }

    // ── Klang (Obertöne) ──────────────────────────────────────────────────
    p.freqs.forEach((f, i) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = p.ring ? "triangle" : "sine";
      // Leichte Streuung, damit nicht jeder Wurf identisch klingt
      osc.frequency.value = f * (0.97 + Math.random() * 0.06);

      // Höhere Obertöne leiser und kürzer – so klingt es natürlich
      const share = 1 / (i + 1.35);
      const dec = p.decay * (1 - i * 0.12);
      const peak = vol * share * p.gain * (1 - p.noise * 0.4);

      g.gain.setValueAtTime(0, now);
      g.gain.linearRampToValueAtTime(peak, now + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.03, dec));

      osc.connect(g); g.connect(master);
      osc.start(now);
      osc.stop(now + Math.max(0.05, dec) + 0.02);
    });
  }

  /** Der letzte, sanfte Aufsetzer, wenn der Würfel liegen bleibt. */
  function settle(surface) {
    impact(surface, 0.22);
  }

  function setEnabled(v) {
    enabled = !!v;
    try { window.localStorage.setItem("vtt_dice_sound", enabled ? "1" : "0"); } catch (e) {}
  }
  function isEnabled() {
    try {
      const v = window.localStorage.getItem("vtt_dice_sound");
      if (v !== null) enabled = (v === "1");
    } catch (e) {}
    return enabled;
  }
  function setVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (master) master.gain.value = volume;
    try { window.localStorage.setItem("vtt_dice_volume", String(volume)); } catch (e) {}
  }
  function getVolume() {
    try {
      const v = window.localStorage.getItem("vtt_dice_volume");
      if (v !== null) volume = parseFloat(v);
    } catch (e) {}
    return volume;
  }

  isEnabled();
  getVolume();

  return {
    impact, settle,
    setEnabled, isEnabled,
    setVolume, getVolume,
    PROFILES,
  };
})();
