"""
packs.py – Inhaltspakete (.vttpack) und Quellen der Bibliothek
══════════════════════════════════════════════════════════════

GRUNDIDEE
    Jeder Bibliotheks-Eintrag gehört genau EINER Quelle (Feld `source`):
        "basis"    Grundregeln, die mit dem Programm kommen
        "eigene"   alles, was auf diesem Server selbst angelegt wurde
        <pack-id>  ein importiertes Inhaltspaket, z.B. "thomas.schattenreich"

    Dadurch bleibt die Bibliothek geordnet – auch mit vielen Paketen –, und
    ein Paket lässt sich als Ganzes an-/abschalten, aktualisieren oder
    entfernen, ohne fremde Einträge anzufassen.

    Zwei Filter-Ebenen:
        1. Server-weit:  Paket aktiv/inaktiv              (packs.json)
        2. Pro Kampagne: welche Pakete der DM erlaubt      (session["packs"])

PAKETDATEI (.vttpack = ZIP)
    manifest.json                    {format, id, name, version, author, description, …}
    library/<kategorie>/<id>.json    Einträge (Kategorien wie game_state.LIBRARY_CATEGORIES)
    dice/<set-id>.json               Würfel-Sets (werden im Browser gespeichert)

SICHERHEIT BEIM IMPORT
    • Die ZIP wird nur im Speicher gelesen, niemals entpackt
      (kein „Zip-Slip", keine Dateien außerhalb des Datenordners).
    • Nur JSON in bekannten Ordnern wird beachtet, alles andere ignoriert.
    • Größen- und Mengengrenzen gegen kaputte oder bösartige Dateien.
    • IDs werden bereinigt; kollidiert eine ID mit einem Eintrag einer
      ANDEREN Quelle, bekommt der neue Eintrag eine neue ID.
"""

import io
import json
import re
import time
import zipfile
from pathlib import Path

import game_state as gs

FORMAT_VERSION = 1

# «STELLSCHRAUBE» Grenzen für importierte Pakete
MAX_PACK_BYTES   = 40 * 1024 * 1024     # gepackte Datei
MAX_FILE_BYTES   = 2 * 1024 * 1024      # einzelne JSON-Datei entpackt
MAX_TOTAL_BYTES  = 80 * 1024 * 1024     # alles entpackt zusammen
MAX_ENTRIES      = 5000
MAX_DICE_SETS    = 50

BUILTIN = {
    "basis":  {"id": "basis",  "name": "Grundregeln 2014 (SRD 5.1)", "builtin": True, "rules": "2014",
               "description": "Regeln 2014: System Reference Document 5.1 von Wizards of the Coast LLC, "
                              "lizenziert unter CC-BY-4.0. Deutsch und Englisch."},
    "basis2024": {"id": "basis2024", "name": "Grundregeln 2024 (SRD 5.2)", "builtin": True, "rules": "2024",
               "description": "Regeln 2024: System Reference Document 5.2 von Wizards of the Coast LLC, "
                              "lizenziert unter CC-BY-4.0. Deutsch und Englisch."},
    "eigene": {"id": "eigene", "name": "Eigene Inhalte", "builtin": True,
               "description": "Alles, was auf diesem Server selbst erstellt wurde (Homebrew)."},
}

_ID_RE   = re.compile(r"[^a-zA-Z0-9_.\-]")
_PACKS_FILE = gs.LIB_DIR.parent / "packs.json"
_packs: dict = {}          # id -> Metadaten (ohne die Einträge selbst)
_loaded = False


class PackError(ValueError):
    """Fehler, der dem Benutzer verständlich angezeigt wird."""


# ════════════════════════════════════════════════════════════════════════
#  Verzeichnis der Pakete
# ════════════════════════════════════════════════════════════════════════

def _clean_id(value, fallback="paket"):
    v = _ID_RE.sub("", str(value or "")).strip(".-_")[:64]
    return v or fallback


def _ensure():
    if not _loaded:
        load()


def load():
    """Beim Start nach game_state.load_from_disk() aufrufen (sonst automatisch
    beim ersten Zugriff)."""
    global _packs, _loaded
    _loaded = True
    try:
        _packs = json.loads(_PACKS_FILE.read_text(encoding="utf-8")) if _PACKS_FILE.exists() else {}
    except Exception:
        _packs = {}
    for pid, meta in BUILTIN.items():
        cur = _packs.get(pid, {})
        _packs[pid] = {**meta, "enabled": cur.get("enabled", True)}
    _migrate_sources()
    _sync_basis()
    _save()


BASIS_SOURCES = ("basis", "basis2024")

def _sync_basis():
    """Mitgelieferte Grundregeln (2014 + 2024) mit einem Update abgleichen.
    • Neue Einträge werden ergänzt.
    • Ältere Fassungen (gleiche Kennung rkey mit kleinerer Revision, oder
      frühere Einträge ohne rkey mit gleichem Namen/Alias) werden ERSETZT –
      die Kennung (id) bleibt, damit Charaktere und Verweise weiter passen.
    • Es wird nie etwas gelöscht; eigene Einträge bleiben unberührt."""
    try:
        import i18n_content
        bundle = gs._BUNDLE_DIR / "data" / "library"
        if str(gs._DATA_DIR) == str(gs._BUNDLE_DIR) or not bundle.is_dir():
            return
        lib = gs.get_library()
        added = updated = 0
        for cat in gs.LIBRARY_CATEGORIES:
            for f in sorted((bundle / cat).glob("*.json")) if (bundle / cat).is_dir() else []:
                try:
                    e = json.loads(f.read_text(encoding="utf-8"))
                except Exception:
                    continue
                src = e.get("source")
                if src not in BASIS_SOURCES:
                    continue
                cur = lib.get(cat, {})
                old = next((x for x in cur.values() if e.get("rkey") and x.get("rkey") == e.get("rkey")), None)
                if old is None and src == "basis":
                    names = i18n_content.names_of(e)
                    old = next((x for x in cur.values() if x.get("source") == "basis" and not x.get("rkey")
                                and str(x.get("name", "")).strip().lower() in names), None)
                if old is not None:
                    if old.get("rkey") and int(old.get("rev") or 0) >= int(e.get("rev") or 0):
                        continue
                    e["id"] = old["id"]
                    gs.save_library_entry(cat, e); updated += 1
                else:
                    if e.get("id") in cur:
                        e["id"] = gs.new_id()
                    gs.save_library_entry(cat, e); added += 1
        # Altlasten: frühere „Grundregel"-Einträge ohne Gegenstück in den
        # heutigen Grundregeln (z. B. Spielerhandbuch-Inhalte aus Version 0.1)
        # werden zu eigenen Inhalten. Ein importiertes Paket mit denselben
        # Kennungen ersetzt sie später sauber.
        lib = gs.get_library(); moved = 0
        for cat, entries in lib.items():
            for x in list(entries.values()):
                if x.get("source") == "basis" and not x.get("rkey"):
                    x["source"] = "eigene"; gs.save_library_entry(cat, x); moved += 1
        if moved:
            print(f"[packs] {moved} frühere Grundregel-Einträge zu „Eigene Inhalte“ verschoben")
        # Unterklassen der Grundregeln mit der Klasse DESSELBEN Regelwerks verknüpfen
        lib = gs.get_library()
        for sc in list(lib.get("subclasses", {}).values()):
            if sc.get("source") not in BASIS_SOURCES:
                continue
            cls = next((c for c in lib.get("classes", {}).values() if c.get("source") == sc.get("source")
                        and str(c.get("name", "")).strip().lower() == str(sc.get("parent_class_name", "")).strip().lower()), None)
            if cls and sc.get("parent_class") != cls["id"]:
                sc["parent_class"] = cls["id"]; gs.save_library_entry("subclasses", sc)
        if added or updated:
            print(f"[packs] Grundregeln abgeglichen: {added} neu, {updated} aktualisiert")
    except Exception as ex:
        print(f"[packs] Abgleich der Grundregeln übersprungen: {ex}")


def _save():
    try:
        _PACKS_FILE.parent.mkdir(parents=True, exist_ok=True)
        tmp = _PACKS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(_packs, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(_PACKS_FILE)
    except Exception as e:
        print(f"[packs] Speichern fehlgeschlagen: {e}")


def _default_names():
    """Namen der mitgelieferten Standard-Einträge (für die einmalige Zuordnung)."""
    try:
        from routes import api
        names = {}
        for cat, lst in (("races", api._DEFAULT_RACES), ("classes", api._DEFAULT_CLASSES),
                         ("subclasses", api._DEFAULT_SUBCLASSES), ("feats", api._DEFAULT_FEATS),
                         ("backgrounds", api._DEFAULT_BACKGROUNDS), ("conditions", api._DEFAULT_CONDITIONS)):
            names[cat] = {str(e.get("name", "")).strip().lower() for e in lst}
        return names
    except Exception:
        return {}


def _migrate_sources():
    """Einträge ohne Quelle einmalig zuordnen: Standard-Namen → „basis",
    alles andere → „eigene"."""
    defaults = _default_names()
    changed = 0
    for cat, entries in gs.get_library().items():
        for e in entries.values():
            if e.get("source"):
                continue
            is_default = str(e.get("name", "")).strip().lower() in defaults.get(cat, set())
            e["source"] = "basis" if is_default else "eigene"
            gs._save_library_file(cat, e)
            changed += 1
    if changed:
        print(f"[packs] {changed} Bibliotheks-Einträgen eine Quelle zugeordnet")


def counts():
    """Anzahl Einträge je Quelle und Kategorie."""
    out = {}
    for cat, entries in gs.get_library().items():
        for e in entries.values():
            src = e.get("source") or "eigene"
            out.setdefault(src, {}).setdefault(cat, 0)
            out[src][cat] += 1
    return out


def list_packs():
    _ensure()
    c = counts()
    res = []
    for pid, meta in _packs.items():
        per_cat = c.get(pid, {})
        res.append({**meta, "counts": per_cat, "total": sum(per_cat.values())})
    # Eingebaute zuerst, dann alphabetisch
    res.sort(key=lambda p: (not p.get("builtin"), p.get("name", "").lower()))
    return res


def get(pid):
    _ensure()
    return _packs.get(pid)


def create(name, description="", author=""):
    """Neue, leere eigene Bibliothek anlegen (in der Bibliothek im Spiel).
    Sie ist ein ganz normales Paket: im Launcher an-/ausschaltbar,
    exportierbar und teilbar."""
    _ensure()
    name = str(name or "").strip()[:60]
    if not name:
        raise PackError("Bitte einen Namen angeben")
    base = "bib." + _clean_id(name, "bibliothek")
    pid, i = base, 2
    while pid in _packs or pid in BUILTIN:
        pid = f"{base}-{i}"; i += 1
    _packs[pid] = {"id": pid, "name": name, "version": "1.0.0", "author": str(author or "")[:60],
                   "description": str(description or "")[:400], "enabled": True, "own": True,
                   "installed": time.strftime("%Y-%m-%d")}
    _save()
    return _packs[pid]


def rename(pid, name=None, description=None):
    """Eigene Bibliothek umbenennen / beschreiben."""
    _ensure()
    if pid not in _packs or pid in BUILTIN:
        raise PackError("Diese Bibliothek kann nicht umbenannt werden")
    if name is not None and str(name).strip():
        _packs[pid]["name"] = str(name).strip()[:60]
    if description is not None:
        _packs[pid]["description"] = str(description)[:400]
    _save()
    return _packs[pid]


def set_enabled(pid, enabled: bool):
    _ensure()
    if pid not in _packs:
        raise PackError("Paket nicht gefunden")
    _packs[pid]["enabled"] = bool(enabled)
    _save()
    return _packs[pid]


def remove(pid):
    _ensure()
    """Paket samt seinen Einträgen entfernen (nicht für eingebaute Quellen)."""
    meta = _packs.get(pid)
    if not meta:
        raise PackError("Paket nicht gefunden")
    if meta.get("builtin"):
        raise PackError("Eingebaute Quellen können nicht entfernt werden")
    removed = _remove_entries_of(pid)
    _packs.pop(pid, None)
    _save()
    return removed


def _remove_entries_of(pid):
    n = 0
    for cat, entries in gs.get_library().items():
        for eid in [k for k, e in entries.items() if e.get("source") == pid]:
            gs.delete_library_entry(cat, eid)
            n += 1
    return n


# ════════════════════════════════════════════════════════════════════════
#  Filter: was darf in einer Kampagne benutzt werden?
# ════════════════════════════════════════════════════════════════════════

def allowed_sources(session=None):
    _ensure()
    """Menge der erlaubten Quellen: aktiv UND (falls gesetzt) von der Kampagne erlaubt."""
    active = {pid for pid, m in _packs.items() if m.get("enabled", True)}
    if session and isinstance(session.get("packs"), list):
        return active & set(session["packs"])
    return active


def filtered_library(session=None):
    allowed = allowed_sources(session)
    return {cat: {eid: e for eid, e in entries.items() if (e.get("source") or "eigene") in allowed}
            for cat, entries in gs.get_library().items()}


# ════════════════════════════════════════════════════════════════════════
#  EXPORT
# ════════════════════════════════════════════════════════════════════════

def export_pack(*, pack_id, name, version="1.0.0", author="", description="",
                sources=None, entry_ids=None, dice_sets=None):
    """
    Baut eine .vttpack-Datei (bytes).
      sources    Liste von Quellen, deren Einträge komplett hinein sollen
      entry_ids  {kategorie: [ids]} für eine Einzelauswahl
      dice_sets  Liste von Würfel-Sets (kommen aus dem Browser)
    """
    pack_id = _clean_id(pack_id or name)
    name = str(name or pack_id)[:80]
    lib = gs.get_library()
    picked = {}
    for cat, entries in lib.items():
        for eid, e in entries.items():
            take = (sources and (e.get("source") or "eigene") in sources) or \
                   (entry_ids and eid in set(entry_ids.get(cat, [])))
            if take:
                picked.setdefault(cat, []).append(e)

    dice_sets = [d for d in (dice_sets or []) if isinstance(d, dict)][:MAX_DICE_SETS]
    if not picked and not dice_sets:
        raise PackError("Nichts ausgewählt – das Paket wäre leer")

    manifest = {
        "format": FORMAT_VERSION,
        "id": pack_id, "name": name,
        "version": str(version or "1.0.0")[:20],
        "author": str(author or "")[:60],
        "description": str(description or "")[:500],
        "created": time.strftime("%Y-%m-%d"),
        "counts": {cat: len(v) for cat, v in picked.items()},
        "dice_sets": len(dice_sets),
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False, indent=1))
        for cat, entries in picked.items():
            for e in entries:
                clean = {k: v for k, v in e.items() if k not in ("created_by",)}
                # Verweise auch per NAME sichern – interne IDs sind auf jedem
                # Rechner anders (siehe _relink beim Import).
                if cat == "subclasses" and clean.get("parent_class"):
                    parent = lib.get("classes", {}).get(clean["parent_class"])
                    if parent:
                        clean["parent_class_name"] = parent.get("name", "")
                clean["source"] = pack_id   # beim Empfänger gehört es zu diesem Paket
                z.writestr(f"library/{cat}/{_clean_id(e.get('id'), 'e')}.json",
                           json.dumps(clean, ensure_ascii=False, indent=1))
        for i, d in enumerate(dice_sets):
            did = _clean_id(d.get("id"), f"set{i}")
            z.writestr(f"dice/{did}.json", json.dumps(d, ensure_ascii=False, indent=1))
    return pack_id, buf.getvalue()


# ════════════════════════════════════════════════════════════════════════
#  IMPORT
# ════════════════════════════════════════════════════════════════════════

def _read_pack(data: bytes):
    if len(data) > MAX_PACK_BYTES:
        raise PackError("Die Datei ist zu groß")
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise PackError("Das ist keine gültige Paket-Datei (.vttpack)")

    def read_json(info):
        if info.file_size > MAX_FILE_BYTES:
            raise PackError(f"Datei im Paket zu groß: {info.filename}")
        try:
            return json.loads(z.read(info).decode("utf-8"))
        except Exception:
            raise PackError(f"Beschädigte Datei im Paket: {info.filename}")

    infos = z.infolist()
    if sum(i.file_size for i in infos) > MAX_TOTAL_BYTES:
        raise PackError("Das Paket ist entpackt zu groß")
    man_info = next((i for i in infos if i.filename == "manifest.json"), None)
    if not man_info:
        raise PackError("Im Paket fehlt die manifest.json")
    manifest = read_json(man_info)
    if not isinstance(manifest, dict) or not manifest.get("id"):
        raise PackError("Die manifest.json ist unvollständig")
    if int(manifest.get("format", 1)) > FORMAT_VERSION:
        raise PackError("Das Paket stammt aus einer neueren Programmversion – bitte aktualisieren")

    pid = _clean_id(manifest["id"])
    if pid in BUILTIN:
        raise PackError("Ungültige Paket-Id")

    entries, dice = {}, []
    n = 0
    for info in infos:
        parts = info.filename.split("/")
        if info.is_dir() or not info.filename.endswith(".json"):
            continue
        if len(parts) == 3 and parts[0] == "library" and parts[1] in gs.LIBRARY_CATEGORIES:
            e = read_json(info)
            if not isinstance(e, dict) or not e.get("name"):
                continue
            n += 1
            if n > MAX_ENTRIES:
                raise PackError("Zu viele Einträge im Paket")
            entries.setdefault(parts[1], []).append(e)
        elif len(parts) == 2 and parts[0] == "dice":
            d = read_json(info)
            if isinstance(d, dict) and isinstance(d.get("dice"), dict) and len(dice) < MAX_DICE_SETS:
                dice.append(d)

    meta = {
        "id": pid,
        "name": str(manifest.get("name") or pid)[:80],
        "version": str(manifest.get("version") or "1.0.0")[:20],
        "author": str(manifest.get("author") or "")[:60],
        # Regelwerk des Pakets ("2014"/"2024", leer = beide) – für die Kampagnen-Wahl
        "rules": str(manifest.get("rules") or "")[:8] if str(manifest.get("rules") or "") in ("2014", "2024") else "",
        "description": str(manifest.get("description") or "")[:500],
    }
    return meta, entries, dice


def _relink(cat, e, idmap):
    """Verweise eines Eintrags auf diesem Rechner auflösen.
    Unterklasse → Klasse: zuerst eine Klasse aus demselben Paket (über die
    alte Id), sonst eine vorhandene Klasse mit gleichem Namen (Grundregeln
    bevorzugt). Findet sich nichts, bleibt der Name als Hinweis stehen."""
    if cat != "subclasses":
        return
    old = str(e.get("parent_class") or "")
    if ("classes", old) in idmap:
        e["parent_class"] = idmap[("classes", old)]
        return
    name = str(e.get("parent_class_name") or "").strip().lower()
    if not name:
        return
    matches = [c for c in gs.get_library().get("classes", {}).values()
               if name in __import__("i18n_content").names_of(c)]
    # gleiches Regelwerk/Paket zuerst, dann Grundregeln
    matches.sort(key=lambda c: 0 if c.get("source") == e.get("source") else 1 if c.get("source") in ("basis", "basis2024") else 2)
    e["parent_class"] = matches[0]["id"] if matches else ""


def preview(data: bytes):
    _ensure()
    """Was würde der Import tun? (nichts wird gespeichert)"""
    meta, entries, dice = _read_pack(data)
    existing = _packs.get(meta["id"])
    return {
        "pack": meta,
        "counts": {cat: len(v) for cat, v in entries.items()},
        "dice_sets": len(dice),
        "installed_version": existing.get("version") if existing else None,
        "is_update": bool(existing),
    }


def import_pack(data: bytes, installed_by=""):
    _ensure()
    """Paket installieren. Ist es schon installiert, wird es ersetzt (Update).
    Gibt Metadaten + die Würfel-Sets zurück (die speichert der Browser)."""
    meta, entries, dice = _read_pack(data)
    pid = meta["id"]
    lib = gs.get_library()

    replaced = _remove_entries_of(pid) if pid in _packs else 0
    added = 0
    idmap = {}                              # (kategorie, alte Id) -> neue Id
    prepared = []
    for cat, items in entries.items():
        for e in items:
            e = dict(e)
            e.pop("created_by", None)
            old = str(e.get("id") or "")
            eid = _clean_id(old, "")
            other = lib.get(cat, {}).get(eid) if eid else None
            if not eid or (other and other.get("source") != pid):
                eid = gs.new_id()           # Kollision mit fremder Quelle → neue Id
            idmap[(cat, old)] = eid
            e["id"] = eid
            e["source"] = pid
            prepared.append((cat, e))
    for cat, e in prepared:
        _relink(cat, e, idmap)
        gs.save_library_entry(cat, e, owner=f"Paket: {meta['name']}")
        added += 1

    _packs[pid] = {**meta, "enabled": _packs.get(pid, {}).get("enabled", True),
                   "installed_at": time.strftime("%Y-%m-%d %H:%M"),
                   "installed_by": installed_by}
    _save()
    return {"pack": _packs[pid], "added": added, "replaced": replaced, "dice": dice}


# ════════════════════════════════════════════════════════════════════════
#  CHARAKTERE: Welche Inhalte braucht ein Charakter – und hat der DM sie?
# ════════════════════════════════════════════════════════════════════════
#
#  Jeder spielt mit seiner EIGENEN Installation (eigene Bibliothek, eigene
#  Pakete). Bringt ein Spieler einen Charakter in die Kampagne eines DM mit,
#  muss alles, worauf der Charakter aufbaut (Rasse, Klasse, Unterklasse,
#  Hintergrund), beim DM vorhanden UND für die Kampagne freigegeben sein.
#
#  Charaktere speichern diese Dinge als NAMEN. Beim Speichern merken wir uns
#  zusätzlich, aus welcher Quelle (Paket) der Name stammt – „content_refs".
#  So kann die Fehlermeldung beim DM sagen: „Es fehlt das Paket Sternenpfad
#  (von Thomas, v1.0.0) – lass es dir schicken."

REF_FIELDS = (("races", "race", "Rasse"), ("classes", "class", "Klasse"),
              ("subclasses", "subclass", "Unterklasse"), ("backgrounds", "background", "Hintergrund"))


def _find_by_name(lib, cat, name, prefer=None):
    # Abgleich in beiden Sprachen (Hauptname + Übersetzungen, i18n_content)
    import i18n_content
    name = str(name or "").strip().lower()
    hits = [e for e in (lib.get(cat) or {}).values() if name in i18n_content.names_of(e)]
    if not hits:
        return None
    if prefer:
        for e in hits:
            if (e.get("source") or "eigene") == prefer:
                return e
    return hits[0]


def annotate_character(ch):
    """Beim Speichern/Exportieren: Quellen der verwendeten Inhalte vermerken."""
    _ensure()
    lib = gs.get_library()
    refs = []
    for cat, field, label in REF_FIELDS:
        name = str(ch.get(field) or "").strip()
        if not name:
            continue
        e = _find_by_name(lib, cat, name)
        src = (e.get("source") or "eigene") if e else ""
        meta = _packs.get(src, {})
        refs.append({"cat": cat, "label": label, "name": name, "source": src,
                     "source_name": meta.get("name", src), "source_version": meta.get("version", ""),
                     "source_author": meta.get("author", "")})
    ch["content_refs"] = refs
    return ch


def check_character(ch, session):
    """Prüft einen Charakter gegen die Inhalte einer Kampagne.
    Rückgabe: {"ok": bool, "missing": [ {label, name, source_name, …, reason} ]}
      reason "missing"    – gibt es auf diesem Server gar nicht
             "disabled"   – vorhanden, aber Paket abgeschaltet oder für die
                            Kampagne nicht freigegeben (DM kann es freigeben)
    Charaktere ohne content_refs (alter Stand) werden nicht blockiert."""
    _ensure()
    allowed = filtered_library(session)
    everything = gs.get_library()
    missing = []
    for r in (ch.get("content_refs") or []):
        if not r.get("name") or not r.get("source"):
            continue      # beim Ersteller selbst schon unbekannt → nicht prüfbar
        if _find_by_name(allowed, r["cat"], r["name"], prefer=r.get("source")):
            continue
        found = _find_by_name(everything, r["cat"], r["name"], prefer=r.get("source"))
        item = {**r, "reason": "disabled" if found else "missing"}
        if found:
            # Beim DM heißt die Quelle evtl. anders (Homebrew des Spielers liegt
            # dort als importiertes Paket) – den Namen nennen, der freizuschalten ist.
            dm_src = found.get("source") or "eigene"
            item["dm_source"] = dm_src
            item["dm_source_name"] = _packs.get(dm_src, {}).get("name", dm_src)
        missing.append(item)
    return {"ok": not missing, "missing": missing}
