/* ══════════════════════════════════════════════════════════════════════════
   i18n.js – Sprache der Oberfläche (Deutsch / English)
   ══════════════════════════════════════════════════════════════════════════
   Die App ist auf Deutsch geschrieben. Ist Englisch eingestellt, übersetzt
   diese Datei die Oberfläche anhand eines Wörterbuchs (static/i18n/en.json,
   Schlüssel = deutscher Text):

     • Textknoten und die Attribute placeholder/title/aria-label/data-tip/alt
     • auch alles, was später per JavaScript entsteht (MutationObserver)
     • Muster mit Platzhaltern: "{} Einträge" → "{} entries" (der Platzhalter
       wird selbst wieder übersetzt, wenn möglich)
     • vorangestellte Symbole/Emojis bleiben erhalten („💾 Speichern")

   NICHT übersetzt wird Nutzer-Inhalt: alles in [translate="no"], .notranslate,
   Eingabefelder, Chat-Texte, Notizen, Journal (siehe SKIP).

   I18n.lang                aktuelle Sprache ("de" | "en")
   I18n.t("Speichern")      übersetzt einen Text im Code
   I18n.set("en")           Sprache wechseln (lädt die Seite neu)

   Neue Texte: einfach deutsch schreiben, dann „python tools/i18n.py" –
   das Werkzeug listet fehlende Übersetzungen auf.
   ══════════════════════════════════════════════════════════════════════════ */
const I18n = (() => {
  "use strict";
  const LANGS = { de: "Deutsch", en: "English" };

  function _detect() {
    try { const s = JSON.parse(localStorage.getItem("vtt_settings") || "{}"); if (s.lang && LANGS[s.lang]) return s.lang; } catch (e) {}
    // Ohne Einstellung: Sprache des Systems (deutsches Windows → Deutsch,
    // sonst Englisch). Im Spiel jederzeit unter Einstellungen → Sprache.
    return (navigator.language || "de").toLowerCase().startsWith("de") ? "de" : "en";
  }
  const lang = _detect();
  document.documentElement.setAttribute("lang", lang);
  // Der Server liefert Bibliotheks-Inhalte in dieser Sprache (Cookie)
  try { document.cookie = "vtt_lang=" + lang + "; path=/; max-age=31536000; SameSite=Lax"; } catch (e) {}

  let dict = null, patterns = [];
  // Nutzer-Inhalte: weder Text noch Attribute übersetzen
  const SKIP = '[translate="no"], .notranslate, script, style, code, pre, [contenteditable="true"], ' +
               '.chat-text, .msg-text, .note-body, .note-text, .journal-content, .je-content, .token-label, .li-name, .cc-name, #user-name, .user-name';
  // Eingabefelder: Inhalt nie, Platzhalter/Titel aber schon
  const SKIP_TEXT = SKIP + ", textarea, input, select option[data-user]";
  const ATTRS = ["placeholder", "title", "aria-label", "data-tip", "alt", "data-label"];
  // vorangestellte Symbole (Emojis, Pfeile, Häkchen …) und Leerraum
  const PREFIX = /^([\s\u2139\u2190-\u2BFF\u2600-\u27BF\u2300-\u23FF\u25A0-\u25FF\uFE0F\u200D\uFF0B+✓✕×•·…]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDC00-\uDFFF])+/;
  const SUFFIX = /([\s.:!?…→←›‹»«]|\u2026)+$/;

  function _compile(d) {
    patterns = Object.keys(d).filter(k => k.includes("{}")).map(k => {
      const parts = k.split("{}").map(p => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      return { re: new RegExp("^" + parts.join("(.+?)") + "$"), to: d[k], lit: k.replace(/\{\}/g, "").length };
    }).sort((a, b) => b.lit - a.lit);
  }

  /** Einen Text übersetzen (ohne Treffer: unverändert). */
  function t(s) {
    if (lang === "de" || !dict || s == null) return s;
    s = String(s);
    if (dict[s] !== undefined) return dict[s];
    // Symbole vorn / Satzzeichen hinten abtrennen und den Kern übersetzen
    const pre = (s.match(PREFIX) || [""])[0], rest = s.slice(pre.length);
    const suf = (rest.match(SUFFIX) || [""])[0], core = rest.slice(0, rest.length - suf.length);
    if (!core) return s;
    if (dict[core] !== undefined) return pre + dict[core] + suf;
    if (dict[core + suf.trim()] !== undefined) return pre + dict[core + suf.trim()] + (suf.match(/\s+$/) || [""])[0];
    for (const p of patterns) {
      const m = core.match(p.re);
      if (m) {
        let i = 1;
        const out = p.to.replace(/\{\}/g, () => { const g = m[i++] || ""; return dict[g.trim()] !== undefined ? g.replace(g.trim(), dict[g.trim()]) : g; });
        return pre + out + suf;
      }
    }
    return s;
  }

  function _skip(el) { return !el || (el.closest && el.closest(SKIP)); }
  function _textNode(n) {
    const v = n.nodeValue; if (!v || !/[A-Za-zÄÖÜäöüß]/.test(v)) return;
    if (n.parentElement && n.parentElement.closest && n.parentElement.closest(SKIP_TEXT)) return;
    const trimmed = v.trim();
    let out = t(trimmed);
    // mehrzeilige Texte im Quelltext: Leerraum zusammenfassen und erneut suchen
    if (out === trimmed && /\s{2,}|\n/.test(trimmed)) { const flat = trimmed.replace(/\s+/g, " "); const o2 = t(flat); if (o2 !== flat) out = o2; }
    if (out !== trimmed) { n.nodeValue = v.replace(trimmed, out); }
  }
  function _attrs(el) {
    if (_skip(el)) return;
    for (const a of ATTRS) {
      const v = el.getAttribute && el.getAttribute(a);
      if (v && /[A-Za-zÄÖÜäöüß]/.test(v)) { const o = t(v); if (o !== v) el.setAttribute(a, o); }
    }
    if (el.tagName === "INPUT" && (el.type === "button" || el.type === "submit") && el.value) { const o = t(el.value); if (o !== el.value) el.value = o; }
  }
  function apply(root) {
    if (lang === "de" || !dict || !root) return;
    if (root.nodeType === 3) return _textNode(root);
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    const start = root.nodeType === 9 ? root.documentElement : root;
    if (start.nodeType === 1) _attrs(start);
    const w = document.createTreeWalker(start, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
      acceptNode: n => (n.nodeType === 1 && n.matches && n.matches(SKIP)) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,   // Textfelder werden in _textNode geprüft
    });
    let n; while ((n = w.nextNode())) { if (n.nodeType === 3) _textNode(n); else _attrs(n); }
  }

  function _observe() {
    let busy = false;
    new MutationObserver(list => {
      if (busy) return; busy = true;
      try {
        for (const m of list) {
          if (m.type === "childList") m.addedNodes.forEach(apply);
          else if (m.type === "characterData") _textNode(m.target);
          else if (m.type === "attributes") _attrs(m.target);
        }
      } finally { busy = false; }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }

  // Wörterbuch synchron laden (klein, aus dem Zwischenspeicher) – so ist die
  // Seite schon beim ersten Bild übersetzt und nichts „springt" um.
  if (lang !== "de") {
    try {
      const x = new XMLHttpRequest();
      const base = (document.currentScript && document.currentScript.src) ? document.currentScript.src.replace(/js\/i18n\.js.*$/, "") : "/static/";
      x.open("GET", base + "i18n/" + lang + ".json", false); x.send(null);
      if (x.status === 200) { dict = JSON.parse(x.responseText); _compile(dict); }
    } catch (e) { dict = {}; }
    const startUp = () => { apply(document); document.title = t(document.title); _observe(); };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", startUp); else startUp();
  }

  function set(l) {
    if (!LANGS[l]) return;
    try { const s = JSON.parse(localStorage.getItem("vtt_settings") || "{}"); s.lang = l; localStorage.setItem("vtt_settings", JSON.stringify(s)); } catch (e) {}
    try { document.cookie = "vtt_lang=" + l + "; path=/; max-age=31536000; SameSite=Lax"; } catch (e) {}
  }
  return { lang, t, apply, set, LANGS };
})();
