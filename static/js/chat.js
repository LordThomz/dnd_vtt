/**
 * chat.js
 * ───────
 * Chat panel: rendering messages, sending, dice breakdown display.
 */

const Chat = (() => {

  // Merkt sich pro Wurf-Nachricht die „Enthüllen"-Funktion, damit die Zuschauer-
  // Nachspielung (dice_playback) das Chat-Ergebnis erst nach dem Ausrollen zeigt.
  const _pendingReveals = new Map();   // msg_id → revealFn

  function init() {
    document.addEventListener("dnd:chat_message", e => appendMsg(e.detail.msg, true));
    document.addEventListener("dnd:full_state",   () => {
      document.getElementById("chat-messages").innerHTML = "";
      State.chat.forEach(m => appendMsg(m, false));
    });

    // 3D-Nachspielung: alle im Raum (inkl. Werfer) spielen den vom Server
    // festgelegten Wurf ab und enthüllen danach das Chat-Ergebnis.
    document.addEventListener("dnd:dice_playback", e => handleDicePlayback(e.detail.pb));

    document.getElementById("chat-input").addEventListener("keydown", e => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
    });
  }

  // Nachspielung: dieselben Zahlen + derselbe Startwert bei allen. Danach
  // das Chat-Ergebnis dieser Nachricht enthüllen.
  function handleDicePlayback(pb) {
    const reveal = () => {
      const fn = _pendingReveals.get(pb.msg_id);
      if (fn) { fn(); _pendingReveals.delete(pb.msg_id); }
    };
    if (typeof Dice3D === "undefined" || !Dice3D.isEnabled()) { reveal(); return; }
    try {
      Dice3D.roll((pb.dice || []).map(d => ({ sides: d.sides, value: d.value })),
        { total: pb.total, formula: pb.formula, label: pb.label },
        reveal, { seed: pb.seed });
    } catch (e) { reveal(); }
  }

  // ── Send ────────────────────────────────────────────────────────────────
  function send() {
    const input = document.getElementById("chat-input");
    const raw   = input.value.trim();
    if (!raw) return;
    input.value = "";

    const base = { session_id:State.session_id, roller:State.username,
                   author:State.username, role:State.role, color:State.my_color };

    if (/^\/r(oll)?\s+/i.test(raw)) {
      Socket.emit("dice_roll", { ...base, formula: raw.replace(/^\/r(oll)?\s+/i,""), secret:false });
    } else if (/^\/gm(roll)?\s+/i.test(raw)) {
      Socket.emit("dice_roll", { ...base, formula: raw.replace(/^\/gm(roll)?\s+/i,""), secret:true });
    } else if (/^\/me\s+/i.test(raw)) {
      Socket.emit("chat_message", { ...base, text: raw.replace(/^\/me\s+/i,""), type:"emote" });
    } else if (/^\/w\s+/i.test(raw)) {
      Socket.emit("chat_message", { ...base, text: raw.replace(/^\/w\s+/i,""), type:"whisper" });
    } else {
      Socket.emit("chat_message", { ...base, text:raw, type:"chat" });
    }
  }

  function quickRoll(formula) {
    Socket.emit("dice_roll", {
      session_id:State.session_id, roller:State.username,
      author:State.username, role:State.role, color:State.my_color,
      formula, secret:false,
    });
    Tabs.switchTo("chat");
  }

  // ── Render message ──────────────────────────────────────────────────────
  function appendMsg(msg, isLive) {
    const box = document.getElementById("chat-messages");
    const el  = document.createElement("div");
    el.className = `chat-msg type-${msg.type}`;

    // Sound-Trigger bei neuen (Live-)Würfen
    if (isLive && (msg.type==="roll"||msg.type==="gmroll") && msg.rolls && typeof Jukebox!=="undefined") {
      const d20parts = (msg.rolls.parts||[]).filter(p =>
        p.type==="dice" && p.rolls && /d20\b/.test(p.expr||""));
      const hasNat20 = d20parts.some(p => p.rolls.includes(20));
      const hasNat1  = d20parts.some(p => p.rolls.includes(1));
      // Allgemeiner Würfel-Trigger (immer bei einem Wurf)
      Jukebox.fireTrigger("dice");
      if (hasNat20) Jukebox.fireTrigger("crit");
      if (hasNat1)  Jukebox.fireTrigger("fumble");
    }
    // Nachrichten-Trigger bei neuen normalen Chat-Nachrichten
    if (isLive && msg.type==="chat" && typeof Jukebox!=="undefined") {
      Jukebox.fireTrigger("message");
    }
    // 3D-Würfelanimation: läuft über dice_playback (siehe oben). Bei einem Live-Wurf mit 3D verstecken
    // wir das Chat-Ergebnis zunächst und enthüllen es, sobald die Nachspielung
    // (dice_playback) gemeldet hat, dass der Würfel liegt. Ohne 3D (oder bei
    // Geheim-Würfen) erscheint das Ergebnis wie gewohnt sofort.
    let revealRoll = null;
    const willAnimate = isLive && (msg.type==="roll" || (msg.type==="gmroll" && msg.author===State.username)) && msg.rolls
                        && typeof Dice3D!=="undefined" && Dice3D.isEnabled();
    if (willAnimate) {
      // Platzhalter setzen; die echte Enthüllung registrieren wir unten per msg.id.
      revealRoll = () => {};
    }

    const time = new Date((msg.timestamp||Date.now()/1000)*1000)
      .toLocaleTimeString("de",{hour:"2-digit",minute:"2-digit"});

    let html = `<div class="msg-meta">
      <span style="color:${msg.color};font-weight:600">${esc(msg.author)}</span>`;
    if (msg.role === "gm")     html += `<span style="font-size:.58rem;color:var(--red-soft)">GM</span>`;
    if (msg.type === "gmroll") html += `<span style="font-size:.58rem;color:var(--red-soft)">👁 Geheim</span>`;
    if (msg.type === "whisper")html += `<span style="font-size:.58rem;color:var(--blue)">🤫 Flüstern</span>`;
    html += `<span class="msg-time">${time}</span></div>`;

    if (msg.type === "roll" || msg.type === "gmroll") {
      html += buildRollHTML(msg);
    } else if (msg.type === "emote") {
      html += `<div>✦ <em>${esc(msg.author)}</em> ${esc(msg.text)}</div>`;
    } else if (msg.type === "system") {
      let safe = esc(msg.text||"").replace(/&lt;b&gt;/g,"<b>").replace(/&lt;\/b&gt;/g,"</b>");
      html += `<div class="sys-msg">${safe}</div>`;
    } else {
      html += `<div>${esc(msg.text)}</div>`;
    }

    el.innerHTML = html;
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;

    // Wenn dieser Wurf auf das Ausrollen warten soll: die verräterischen Teile
    // (Einzelwürfel + Gesamtergebnis) verdecken und erst enthüllen, wenn Dice3D
    // meldet, dass der Würfel liegt. Label und Formel bleiben sichtbar.
    if (revealRoll !== null && (msg.type==="roll"||msg.type==="gmroll")) {
      const parts = [
        el.querySelector(".roll-breakdown"),
        el.querySelector(".roll-total"),
      ].filter(Boolean);
      if (parts.length) {
        parts.forEach(p => {
          p.style.transition = "opacity .25s ease";
          p.style.opacity = "0";
        });
        // Platzhalter, damit das Layout nicht springt: ein „…" über dem Total
        const total = el.querySelector(".roll-total");
        let dots = null;
        if (total) {
          dots = document.createElement("div");
          dots.className = "roll-total";
          dots.textContent = "…";
          dots.style.opacity = ".5";
          total.parentNode.insertBefore(dots, total);
        }
        revealRoll = () => {
          if (dots) dots.remove();
          parts.forEach(p => { p.style.opacity = "1"; });
        };
      } else {
        revealRoll = () => {};
      }
      // Für die Nachspielung merken: enthüllen, wenn dice_playback für diese
      // Nachricht eintrifft. Sicherheitsnetz: nach 10 s auf jeden Fall zeigen.
      if (msg.id) {
        _pendingReveals.set(msg.id, revealRoll);
        setTimeout(() => {
          const fn = _pendingReveals.get(msg.id);
          if (fn) { fn(); _pendingReveals.delete(msg.id); }
        }, 10000);
      }
    }
    return;
  }

  // ── Dice breakdown HTML ─────────────────────────────────────────────────
  function buildRollHTML(msg) {
    const r = msg.rolls;
    if (!r) return `<div>${esc(msg.text||"")}</div>`;

    let html = "";

    // Label (attack name, skill name, etc.)
    if (msg.label) html += `<div class="roll-label">${esc(msg.label)}</div>`;

    // Formula
    html += `<div class="roll-formula">${esc(r.formula)}</div>`;

    // Breakdown
    html += `<div class="roll-breakdown">`;
    r.parts.forEach((part, pi) => {
      if (pi > 0) html += `<span class="roll-eq">+</span>`;

      if (part.type === "dice") {
        // Welche Würfel zählen? Der Server liefert die Indizes (kept). Alte
        // Chat-Einträge ohne kept: alle zählen.
        const keptIdx = new Set(Array.isArray(part.kept) ? part.kept : [...part.rolls.keys()]);

        part.rolls.forEach((val, idx) => {
          const maxVal  = part.sides || +part.expr.match(/d(\d+)/)?.[1] || 20;
          const isCrit  = val === maxVal;
          const isFail  = val === 1;
          const dropped = !keptIdx.has(idx);
          const cls = [
            "roll-die",
            isCrit  ? "crit-max" : "",
            isFail  ? "crit-min" : "",
            dropped ? "dropped"  : "",
          ].join(" ").trim();
          html += `<span class="${cls}" title="${dropped?"Nicht gewertet":""}">${val}</span>`;
        });

        html += `<span class="roll-mod-badge">(${part.expr})</span>`;
      } else {
        html += `<span class="roll-mod-badge" style="color:var(--text)">${part.expr}</span>`;
      }
    });
    html += `</div>`;

    // Total
    html += `<div class="roll-total">${r.total}</div>`;

    return html;
  }

  function esc(s) {
    return String(s||"")
      .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
      .replace(/"/g,"&quot;");
  }

  return { init, send, quickRoll };
})();
