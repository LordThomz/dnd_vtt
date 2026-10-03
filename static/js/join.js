/* ══════════════════════════════════════════════════════════════════════════
   join.js – „Bei einem DM mitspielen" (im Hauptmenü des Spiels)
   ══════════════════════════════════════════════════════════════════════════
   1. Adresse des DM eingeben (Port 5000 wird ergänzt), zuletzt genutzte
      Adressen werden gemerkt.
   2. Versionsvergleich: Nur gleiche Versionen spielen zusammen (Updates sind
      Pflicht – wer älter ist, startet die App neu).
   3. Übergabe: Würfel-Sets, Designs und eigene Charaktere aus der eigenen
      Installation (/api/profile/bundle) reisen als #vttprofile=… mit;
      theme.js packt sie auf der Seite des DM aus. Der Teil hinter # wird nie
      an einen Server geschickt.

   Öffnen: JoinDM.open()     Braucht: design-studio.css (.ds-*), theme.js
   ══════════════════════════════════════════════════════════════════════════ */
const JoinDM = (() => {
  "use strict";
  const PORT = 5000;
  let _el = null;
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

  function _timeout(p, ms) {
    return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("Zeitüberschreitung")), ms))]);
  }
  function normalize(raw) {
    let a = String(raw || "").trim();
    if (!a) return "";
    if (!/^https?:\/\//i.test(a)) a = "http://" + a;
    try { const u = new URL(a); if (!u.port && u.protocol === "http:") u.port = String(PORT); return u.origin; }
    catch (e) { return ""; }
  }
  const recent = () => { try { return JSON.parse(localStorage.getItem("vtt_recent_dm") || "[]"); } catch (e) { return []; } };
  const addRecent = a => { try { localStorage.setItem("vtt_recent_dm", JSON.stringify([a, ...recent().filter(x => x !== a)].slice(0, 5))); } catch (e) {} };
  function cmpVer(a, b) {
    const pa = String(a).split(".").map(Number), pb = String(b).split(".").map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    return 0;
  }
  function pack(obj) {
    return btoa(unescape(encodeURIComponent(JSON.stringify(obj)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function connect() {
    const err = _el.querySelector("#jd-err"), btn = _el.querySelector("#jd-go");
    err.style.display = "none";
    const url = normalize(_el.querySelector("#jd-addr").value);
    const fail = msg => { err.textContent = msg; err.style.display = "block"; btn.disabled = false; btn.textContent = "Verbinden"; };
    if (!url) return fail("Bitte die Adresse des DM eingeben.");
    if (url === location.origin) return fail("Das ist deine eigene Installation – hier bist du schon.");
    btn.disabled = true; btn.textContent = "Verbinde …";
    let mine, theirs;
    try { mine = await (await fetch("/api/server/info")).json(); } catch (e) { mine = {}; }
    try { theirs = await (await _timeout(fetch(url + "/api/server/info", { cache: "no-store" }), 6000)).json(); }
    catch (e) { return fail("Der DM ist nicht erreichbar. Läuft seine App, und seid ihr im selben Netzwerk (z. B. Tailscale)?"); }
    if (mine.version && theirs.version && mine.version !== theirs.version) {
      const older = cmpVer(mine.version, theirs.version) < 0 ? "Deine App" : "Die App des DM";
      return fail(`Versionen passen nicht: du hast ${mine.version}, der DM ${theirs.version}. ${older} ist älter – einfach neu starten, dann aktualisiert sie sich automatisch.`);
    }
    let bundle = { profile: null, characters: [] };
    try { bundle = await (await fetch("/api/profile/bundle")).json(); } catch (e) {}
    const payload = { profile: bundle.profile, characters: bundle.characters || [], launcher: location.origin + "/menu" };
    let frag = pack(payload);
    if (frag.length > 1_500_000) { payload.characters = payload.characters.map(c => ({ ...c, portrait: null })); frag = pack(payload); }
    addRecent(url);
    location.href = url + "/play#vttprofile=" + frag;
  }

  function open() {
    if (!_el) {
      _el = document.createElement("div");
      _el.className = "ds-backdrop";
      _el.innerHTML = `<div class="ds-win" style="width:min(520px,94vw)" role="dialog" aria-label="Bei einem DM mitspielen">
        <header class="ds-head"><div><h2>🐉 Bei einem DM mitspielen</h2><span>Würfel, Designs und Charaktere nimmst du automatisch mit.</span></div>
          <button class="ds-x" aria-label="Schließen">✕</button></header>
        <div class="ds-body">
          <div class="pm-form" style="grid-template-columns:1fr">
            <label>Adresse des DM <input id="jd-addr" placeholder="z. B. 100.64.12.7" spellcheck="false"></label>
          </div>
          <div class="jd-recent" id="jd-recent"></div>
          <div class="pm-note" id="jd-err" style="display:none;border-left-color:var(--red);background:rgba(var(--red-rgb),.08)"></div>
          <div class="pm-foot"><button class="pm-btn primary" id="jd-go">Verbinden</button></div>
        </div></div>`;
      document.body.appendChild(_el);
      _el.addEventListener("click", e => {
        if (e.target === _el || e.target.closest(".ds-x")) return close();
        const r = e.target.closest("[data-addr]");
        if (r) { _el.querySelector("#jd-addr").value = r.dataset.addr; return connect(); }
        if (e.target.closest("#jd-go")) connect();
      });
      _el.querySelector("#jd-addr").addEventListener("keydown", e => { if (e.key === "Enter") connect(); });
      document.addEventListener("keydown", e => { if (e.key === "Escape" && _el.classList.contains("open")) close(); });
    }
    const list = recent();
    _el.querySelector("#jd-recent").innerHTML = list.length
      ? `<div class="pm-h" style="margin-top:12px">Zuletzt</div>` + list.map(a => `<button class="pm-btn" data-addr="${esc(a.replace(/^https?:\/\//, ""))}" style="margin:0 6px 6px 0">${esc(a.replace(/^https?:\/\//, ""))}</button>`).join("")
      : "";
    if (list.length && !_el.querySelector("#jd-addr").value) _el.querySelector("#jd-addr").value = list[0].replace(/^https?:\/\//, "");
    requestAnimationFrame(() => { _el.classList.add("open"); _el.querySelector("#jd-addr").focus(); });
  }
  function close() { if (_el) _el.classList.remove("open"); }
  return { open, close };
})();
