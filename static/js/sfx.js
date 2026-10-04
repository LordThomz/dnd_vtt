/* ══════════════════════════════════════════════════════════════════════════
   sfx.js – Bedien-Klänge, Intro-Klang und Launcher-Musik
   ══════════════════════════════════════════════════════════════════════════
   Alle Klänge werden LIVE erzeugt (Web Audio) – keine Sounddateien, keine
   Lizenzfragen, kein Download-Gewicht. Gemeinsamer Hallraum, damit alles wie
   aus einem Guss klingt. Stil: warm, hölzern-glockig, leise.

   Sfx.play(name)        click | hover | open | close | tab | success | error |
                         notify | crit | fumble | intro | reveal
   Sfx.music.start()     ruhige, generative Klangfläche (Launcher)
   Sfx.music.stop()
   Sfx.settings() / Sfx.configure({sound, music, uiVol, musicVol})

   Einstellungen liegen im Profil (Schlüssel vtt_fx) – gleich im Launcher und
   im Spiel. Diese Datei gibt es zweimal: static/js/sfx.js (Spiel) und
   desktop/src/sfx.js (Launcher, identische Kopie).
   ══════════════════════════════════════════════════════════════════════════ */
const Sfx = (() => {
  "use strict";
  const DEFAULTS = { sound: true, music: true, uiVol: 0.55, musicVol: 0.35, masterVol: 0.9, reduceMotion: false };
  let ctx = null, master, uiBus, musicBus, verb, verbSend;

  function settings() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem("vtt_fx") || "{}")); }
    catch (e) { return Object.assign({}, DEFAULTS); }
  }
  function configure(patch) {
    const s = Object.assign(settings(), patch || {});
    try { localStorage.setItem("vtt_fx", JSON.stringify(s)); } catch (e) {}
    _applyVolumes();
    if (!s.music) music.stop();
    try { window.dispatchEvent(new CustomEvent("vtt:fx", { detail: s })); } catch (e) {}
    return s;
  }

  // ── Grundgerüst ─────────────────────────────────────────────────────────
  function _ctx() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume().catch(() => {}); return ctx; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 3;
    master.connect(comp).connect(ctx.destination);
    uiBus = ctx.createGain(); uiBus.connect(master);
    musicBus = ctx.createGain(); musicBus.connect(master);
    // Hallraum: synthetische Impulsantwort (gefilteres Rauschen, 2,8 s)
    verb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.8), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    verb.buffer = ir;
    verbSend = ctx.createGain(); verbSend.gain.value = 0.32;
    const verbOut = ctx.createGain(); verbOut.gain.value = 0.9;
    verbSend.connect(verb).connect(verbOut).connect(master);
    _applyVolumes();
    return ctx;
  }
  function _applyVolumes() {
    if (!ctx) return;
    const s = settings();
    master.gain.setTargetAtTime(Math.max(0, Math.min(1, s.masterVol)), ctx.currentTime, .05);
    uiBus.gain.setTargetAtTime(s.sound ? s.uiVol : 0, ctx.currentTime, .05);
    musicBus.gain.setTargetAtTime(s.music ? s.musicVol : 0, ctx.currentTime, .3);
  }
  // Browser erlauben Ton erst nach einer Nutzeraktion → beim ersten Klick starten
  ["pointerdown", "keydown"].forEach(ev => window.addEventListener(ev, () => { _ctx(); }, { once: true, capture: true }));

  // Ein Ton mit Hüllkurve. type: sine|triangle|square|sawtooth
  function tone({ f = 440, f2 = null, type = "sine", t = 0, a = .005, d = .25, g = .2, verbAmt = .3, bus = null, detune = 0 }) {
    const c = _ctx(); if (!c) return;
    const now = c.currentTime + t;
    const o = c.createOscillator(), v = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, now); o.detune.value = detune;
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, now + a + d);
    v.gain.setValueAtTime(0, now);
    v.gain.linearRampToValueAtTime(g, now + a);
    v.gain.exponentialRampToValueAtTime(0.0001, now + a + d);
    o.connect(v).connect(bus || uiBus);
    if (verbAmt) { const s = c.createGain(); s.gain.value = verbAmt; v.connect(s).connect(verbSend); }
    o.start(now); o.stop(now + a + d + .05);
  }
  // Gefiltertes Rauschen (Anschlag, Wind, Funkeln)
  function noise({ t = 0, d = .05, g = .1, type = "bandpass", f = 1800, q = 1, a = .002, verbAmt = .1, bus = null, f2 = null }) {
    const c = _ctx(); if (!c) return;
    const now = c.currentTime + t, len = Math.max(1, Math.floor(c.sampleRate * (a + d + .05)));
    const buf = c.createBuffer(1, len, c.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf;
    const fl = c.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, now); fl.Q.value = q;
    if (f2) fl.frequency.exponentialRampToValueAtTime(f2, now + a + d);
    const v = c.createGain();
    v.gain.setValueAtTime(0, now); v.gain.linearRampToValueAtTime(g, now + a); v.gain.exponentialRampToValueAtTime(0.0001, now + a + d);
    src.connect(fl).connect(v).connect(bus || uiBus);
    if (verbAmt) { const s = c.createGain(); s.gain.value = verbAmt; v.connect(s).connect(verbSend); }
    src.start(now); src.stop(now + a + d + .05);
  }
  // Glockenartiger Ton (Grundton + unharmonische Obertöne)
  function bell(f, t = 0, g = .12, d = 1.4) {
    tone({ f, t, g, d, type: "sine", verbAmt: .55 });
    tone({ f: f * 2.76, t, g: g * .35, d: d * .5, type: "sine", verbAmt: .5 });
    tone({ f: f * 5.4, t, g: g * .12, d: d * .25, type: "sine", verbAmt: .4 });
  }
  const N = n => 440 * Math.pow(2, (n - 69) / 12);   // MIDI-Note → Hz

  // ── Klangbibliothek ─────────────────────────────────────────────────────
  let _lastHover = 0;
  const SOUNDS = {
    click() {                       // weicher Holz-/Steinanschlag
      noise({ d: .045, g: .16, f: 2200, q: 1.4, verbAmt: .08 });
      tone({ f: 190, f2: 120, d: .09, g: .14, type: "sine", verbAmt: .05 });
    },
    hover() {
      const n = performance.now(); if (n - _lastHover < 70) return; _lastHover = n;
      tone({ f: 2400, d: .03, g: .018, type: "sine", verbAmt: .2 });
    },
    tab() { tone({ f: N(84), d: .12, g: .05, type: "triangle", verbAmt: .3 }); noise({ d: .02, g: .05, f: 3500 }); },
    open() {                        // aufsteigendes Schimmern
      tone({ f: 520, f2: 880, d: .22, g: .06, type: "sine", verbAmt: .5 });
      tone({ f: 780, f2: 1320, t: .04, d: .2, g: .035, type: "sine", verbAmt: .5 });
      noise({ d: .25, g: .025, type: "highpass", f: 5000, verbAmt: .4 });
    },
    close() { tone({ f: 880, f2: 520, d: .18, g: .05, type: "sine", verbAmt: .4 }); },
    success() { [N(79), N(83), N(86)].forEach((f, i) => bell(f, i * .07, .07, 1.1)); },
    notify() { bell(N(88), 0, .06, 1.2); },
    error() {
      tone({ f: 196, d: .22, g: .09, type: "triangle", verbAmt: .2 });
      tone({ f: 185, t: .02, d: .22, g: .07, type: "triangle", verbAmt: .2 });
    },
    crit() {                        // kleine Fanfare
      [N(67), N(71), N(74), N(79)].forEach((f, i) => { bell(f, i * .09, .09, 1.6); tone({ f, t: i * .09, d: .5, g: .03, type: "triangle", verbAmt: .5 }); });
      noise({ t: .3, d: 1.2, g: .03, type: "highpass", f: 6000, verbAmt: .6 });
    },
    fumble() { [N(62), N(58), N(53)].forEach((f, i) => tone({ f, t: i * .14, d: .45, g: .08, type: "triangle", verbAmt: .4 })); },
    intro() {                       // Anschwellen: Grollen → Chor → Funkeln
      const c = _ctx(); if (!c) return;
      tone({ f: 55, d: 2.6, a: 1.4, g: .22, type: "sawtooth", verbAmt: .4 });
      tone({ f: 55.4, d: 2.6, a: 1.4, g: .16, type: "sawtooth", verbAmt: .4, detune: 7 });
      noise({ d: 2.2, a: 1.6, g: .05, type: "lowpass", f: 200, f2: 2400, verbAmt: .5 });
      [N(50), N(57), N(62), N(65)].forEach((f, i) => {           // Dm-Klangfläche
        tone({ f, t: .5 + i * .12, a: .9, d: 1.8, g: .035, type: "triangle", verbAmt: .7, detune: (i % 2 ? 6 : -6) });
      });
      [N(86), N(89), N(93), N(98)].forEach((f, i) => tone({ f, t: 1.4 + i * .1, d: .9, g: .025, type: "sine", verbAmt: .8 }));
    },
    reveal() {                      // Ankunft im Hauptmenü
      tone({ f: 73.4, d: 1.8, g: .2, type: "sine", verbAmt: .5 });
      [N(62), N(69), N(74), N(77)].forEach((f, i) => bell(f, i * .05, .06, 2));
      noise({ d: 1.4, g: .03, type: "highpass", f: 7000, verbAmt: .7 });
    },
  };

  function play(name) {
    const s = settings();
    if (!s.sound) return;
    try { const fn = SOUNDS[name]; if (fn && _ctx()) fn(); } catch (e) {}
  }

  // ── Generative Musik (Launcher) ─────────────────────────────────────────
  // D-Dorisch, langsame Akkordflächen (Dm – C – B♭ – C), dazu vereinzelte
  // Harfentöne und ein leiser Wind. Läuft endlos, wiederholt sich nie genau.
  const music = (() => {
    let running = false, timers = [], windNode = null, step = 0;
    const CHORDS = [[50, 57, 62, 65, 69], [48, 55, 60, 64, 67], [46, 53, 58, 62, 65], [48, 55, 60, 64, 67]];
    const SCALE = [62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81];
    function pad(notes, t) {
      notes.forEach((n, i) => {
        tone({ f: N(n), t, a: 2.6, d: 6.5, g: i === 0 ? .05 : .026, type: i === 0 ? "sine" : "triangle", verbAmt: .75, bus: musicBus, detune: (i % 2 ? 5 : -5) });
      });
    }
    function chordLoop() {
      if (!running) return;
      pad(CHORDS[step % CHORDS.length], 0);
      step++;
      timers.push(setTimeout(chordLoop, 8000));
    }
    function harpLoop() {
      if (!running) return;
      const n = SCALE[Math.floor(Math.random() * SCALE.length)];
      const f = N(n + (Math.random() < .25 ? 12 : 0));
      tone({ f, d: 2.2, a: .004, g: .045, type: "triangle", verbAmt: .85, bus: musicBus });
      tone({ f: f * 2, d: .9, a: .004, g: .012, type: "sine", verbAmt: .8, bus: musicBus });
      timers.push(setTimeout(harpLoop, 1300 + Math.random() * 2600));
    }
    function wind() {
      const c = _ctx(); if (!c) return;
      const len = c.sampleRate * 4, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
      let last = 0; for (let i = 0; i < len; i++) { last = (last + .02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3; }
      const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
      const fl = c.createBiquadFilter(); fl.type = "bandpass"; fl.frequency.value = 500; fl.Q.value = .6;
      const lfo = c.createOscillator(), lg = c.createGain(); lfo.frequency.value = .07; lg.gain.value = 250;
      lfo.connect(lg).connect(fl.frequency);
      const v = c.createGain(); v.gain.value = .0001; v.gain.exponentialRampToValueAtTime(.05, c.currentTime + 4);
      src.connect(fl).connect(v).connect(musicBus);
      src.start(); lfo.start();
      windNode = { src, lfo, v };
    }
    function start() {
      if (running || !settings().music) return;
      const c = _ctx(); if (!c) return;
      running = true; step = 0;
      chordLoop(); timers.push(setTimeout(harpLoop, 2500)); wind();
    }
    function stop(fade = 1.2) {
      running = false; timers.forEach(clearTimeout); timers = [];
      if (windNode && ctx) {
        const w = windNode; windNode = null;
        try { w.v.gain.setTargetAtTime(.0001, ctx.currentTime, fade / 3); setTimeout(() => { try { w.src.stop(); w.lfo.stop(); } catch (e) {} }, fade * 1000 + 200); } catch (e) {}
      }
    }
    return { start, stop, get running() { return running; } };
  })();

  return { play, music, settings, configure, tone, bell };
})();
