"""
tools/i18n.py – Übersetzungen pflegen
═════════════════════════════════════
Sammelt alle deutschen Oberflächentexte aus templates/*.html, static/js/*.js
und dem Launcher (desktop/src/index.html) und vergleicht sie mit dem
Wörterbuch static/i18n/en.json.

    python tools/i18n.py            zeigt, wie viele Texte fehlen
    python tools/i18n.py --missing  schreibt fehlende nach tools/i18n_fehlend.json
    python tools/i18n.py --sync     kopiert das Wörterbuch auch in den Launcher

Die Engine (static/js/i18n.js) normalisiert genauso wie dieses Werkzeug:
Symbole vorne und Satzzeichen hinten werden abgetrennt, ${…} wird zu {}.
"""
import json, re, sys, glob, shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DICT = ROOT / "static" / "i18n" / "en.json"
SKIP_JS = {"i18n.js", "icons.js", "three.min.js", "cannon-es.min.js", "socket.io.min.js", "RoomEnvironment.js", "design-runtime.js"}

PREFIX = re.compile(r'^([\s\u2139\u2190-\u2BFF\u2600-\u27BF\u2300-\u23FF\u25A0-\u25FF\uFE0F\u200D\uFF0B+✓✕×•·…]|[\U0001F300-\U0001FAFF])+')
SUFFIX = re.compile(r'([\s.:!?…→←›‹»«])+$')
GERMAN = re.compile(r'[äöüÄÖÜß]|\b(der|die|das|und|oder|nicht|mit|für|ein|eine|ist|zu|im|auf|von|bei|Neu|Speichern|Löschen|Abbrechen|Zurück|Weiter)\b')
CODEISH = re.compile(r'(=>|===|!==|&&|\|\||\bfunction\b|\breturn\b|\bconst\b|\blet\b|rgba?\(|var\(--|px\b|\.js\b|\.css\b|\.json\b|^#[0-9a-f]{3,8}$|^\.|https?:|^/|\\n|\bdocument\.|\bwindow\.|\bthis\.|querySelector|getElementById|\bnull\b|\bundefined\b|\btrue\b|\bfalse\b|=\s*["\'])')

def core(s):
    s = s.strip()
    s = PREFIX.sub("", s)
    s = SUFFIX.sub("", s).strip()
    return s

def keep(s):
    if len(s) < 2 or len(s) > 400 or not re.search(r'[A-Za-zÄÖÜäöüß]{2}', s):
        return False
    if re.fullmatch(r'[\w\-./]+', s) and not re.search(r'[A-ZÄÖÜ]', s[:1]) and " " not in s:
        return False                               # Bezeichner, Dateien
    if CODEISH.search(s) or s.count("{}") > 4:
        return False
    if (";" in s and ":" in s) or "${" in s or s[:1] in "#.()),*-+$'\"" or s[-1:] in "(,+=" :
        return False                               # CSS, Code-Reste
    if re.search(r"serif|monospace|system-ui|\b(auto|inherit|none|flex|grid)\b\s*$", s):
        return False
    if re.fullmatch(r"[\d\s.,+\-*/x×%dDwW()]+(ft|gp|lb|kg|m)?", s):
        return False                               # Zahlen, Würfelformeln
    if re.fullmatch(r"[A-Z]{2,4}( [+\-]?\d+)?", s):
        return False                               # Kürzel wie STR, GES

    if re.fullmatch(r'(\{\}\s*)+', s):
        return False
    return bool(GERMAN.search(s) or re.match(r'[A-ZÄÖÜ]', s) or " " in s)

def from_html_text(html):
    html = re.sub(r'<!--.*?-->', ' ', html, flags=re.S)
    out = set()
    for m in re.finditer(r'(placeholder|title|aria-label|data-tip|alt|data-label)="([^"]+)"', html):
        out.add(m.group(2))
    text = re.sub(r'<(script|style)\b.*?</\1>', ' ', html, flags=re.S | re.I)
    for seg in re.split(r'<[^>]+>', text):
        seg = re.sub(r'\{\{.*?\}\}|\{%.*?%\}', '{}', seg)
        for part in re.split(r'\s{2,}|\n', seg):
            out.add(part)
    return out

def from_js(js):
    out = set()
    js = re.sub(r'/\*.*?\*/', ' ', js, flags=re.S)
    js = re.sub(r'(?m)^\s*//.*$', ' ', js)
    # Template-Literale: ${…} → {} und HTML-Teile zerlegen
    for m in re.finditer(r'`((?:\\.|[^`\\])*)`', js, flags=re.S):
        body = m.group(1)
        # verschachtelte ${ … } grob entfernen
        prev = None
        while prev != body:
            prev = body; body = re.sub(r'\$\{[^{}]*\}', '{}', body)
        out |= from_html_text(body)
    for m in re.finditer(r'"((?:\\.|[^"\\\n])*)"|\'((?:\\.|[^\'\\\n])*)\'', js):
        s = m.group(1) if m.group(1) is not None else m.group(2)
        if "<" in s and ">" in s: out |= from_html_text(s)
        else: out.add(s)
    return out

def collect():
    found = {}
    files = list(ROOT.glob("templates/*.html")) + [ROOT / "desktop" / "src" / "index.html"]
    files += [p for p in ROOT.glob("static/js/*.js") if p.name not in SKIP_JS]
    for f in files:
        src = f.read_text(encoding="utf-8")
        strings = set()
        if f.suffix == ".html":
            strings |= from_html_text(src)
            for sm in re.finditer(r'<script\b[^>]*>(.*?)</script>', src, flags=re.S | re.I):
                strings |= from_js(sm.group(1))
        else:
            strings |= from_js(src)
        for s in strings:
            c = core(s.replace("\\n", " "))
            if keep(c):
                found.setdefault(c, set()).add(f.name)
    return found

def main(argv):
    d = json.loads(DICT.read_text(encoding="utf-8")) if DICT.exists() else {}
    ign = ROOT / "tools" / "i18n_ignorieren.json"         # kein Oberflächentext (Code, Namen …)
    for k in (json.loads(ign.read_text(encoding="utf-8")) if ign.exists() else []): d.setdefault(k, None)
    found = collect()
    missing = {k: sorted(v) for k, v in sorted(found.items()) if k not in d}
    print(f"Texte gefunden: {len(found)} · übersetzt: {len(found) - len(missing)} · fehlend: {len(missing)}")
    if "--missing" in argv:
        out = ROOT / "tools" / "i18n_fehlend.json"
        out.write_text(json.dumps(missing, ensure_ascii=False, indent=1), encoding="utf-8")
        print("→", out)
    if "--sync" in argv:
        dst = ROOT / "desktop" / "src" / "i18n"; dst.mkdir(exist_ok=True)
        shutil.copy(DICT, dst / "en.json"); shutil.copy(ROOT / "static" / "js" / "i18n.js", ROOT / "desktop" / "src" / "i18n.js")
        print("Launcher aktualisiert")

if __name__ == "__main__":
    main(sys.argv[1:])
