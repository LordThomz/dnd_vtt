"""
i18n_content.py – zweisprachige Bibliotheks-Inhalte
═══════════════════════════════════════════════════

Jeder Eintrag hat eine Hauptsprache und Übersetzungen:

    { "name": "Elf", "description": "…", "traits": [{"id": "t0", "name": "…"}],
      "lang": "de",                                   # Hauptsprache (Standard: de)
      "i18n": { "en": { "name": "Elf", "traits": [{"id": "t0", "name": "…"}] } } }

`localize(entry, "en")` liefert eine fertige englische Fassung: die Felder
aus i18n.en werden über die Hauptfassung gelegt. Listen werden dabei über
die Kennung („id") ihrer Elemente zugeordnet, sonst über die Position.
Übersetzt werden nur Texte – Zahlen und Struktur kommen immer aus der
Hauptfassung. Fehlt eine Übersetzung, bleibt der Text der Hauptsprache.

Der Server liefert Bibliotheken automatisch in der Sprache des Spielers aus
(Cookie „vtt_lang", gesetzt von static/js/i18n.js). Builder, Charakterbogen
und Spieltisch müssen deshalb nichts von Sprachen wissen.
"""
import copy

LANGS = ("de", "en")
# Technische Felder – keine Übersetzung nötig (zählen nicht zur Abdeckung)
TECH = {"id", "i18n", "lang", "source", "created_by", "parent_class", "level", "hd", "primary", "rkey", "rules",
        "rev", "aliases", "type", "key", "icon", "color"}


def _merge(base, over):
    """Übersetzung (over) über die Hauptfassung (base) legen – nur Texte."""
    if isinstance(base, dict) and isinstance(over, dict):
        out = dict(base)
        for k, v in over.items():
            if k in ("id", "i18n", "lang", "source"):
                continue
            if k in base:
                out[k] = _merge(base[k], v)
        return out
    if isinstance(base, list) and isinstance(over, list):
        out = list(base)
        by_id = {o.get("id"): o for o in over if isinstance(o, dict) and o.get("id")}
        for i, b in enumerate(base):
            if isinstance(b, dict) and b.get("id") in by_id:
                out[i] = _merge(b, by_id[b["id"]])
            elif i < len(over) and not (isinstance(b, dict) and b.get("id")):
                out[i] = _merge(b, over[i])
        return out
    if isinstance(base, str) and isinstance(over, str) and over.strip():
        return over
    return base


def localize(entry, lang):
    """Eintrag in der gewünschten Sprache (Kopie; Original bleibt unverändert)."""
    if not isinstance(entry, dict) or lang not in LANGS:
        return entry
    main = entry.get("lang") or "de"
    if lang == main:
        return entry
    over = (entry.get("i18n") or {}).get(lang)
    if not over:
        return entry
    out = _merge(entry, over)
    out["i18n"] = entry.get("i18n")
    out["lang"] = main
    return out


def localize_library(lib, lang):
    if lang not in LANGS:
        return lib
    return {cat: {eid: localize(e, lang) for eid, e in (entries or {}).items()} for cat, entries in lib.items()}


def names_of(entry):
    """Alle Namen eines Eintrags (Hauptsprache + Übersetzungen) – für den
    sprachunabhängigen Abgleich, z.B. beim Mitbringen von Charakteren."""
    names = {str(entry.get("name", "")).strip().lower()}
    names |= {str(a).strip().lower() for a in (entry.get("aliases") or [])}   # frühere Namen
    for tr in (entry.get("i18n") or {}).values():
        if isinstance(tr, dict) and tr.get("name"):
            names.add(str(tr["name"]).strip().lower())
    names.discard("")
    return names


def _count_strings(base, over):
    """(übersetzt, gesamt) der Text-Felder – für die Fortschrittsanzeige."""
    if isinstance(base, dict):
        d, t = 0, 0
        for k, v in base.items():
            if k in TECH:
                continue
            a, b = _count_strings(v, (over or {}).get(k) if isinstance(over, dict) else None)
            d += a; t += b
        return d, t
    if isinstance(base, list):
        d, t = 0, 0
        by_id = {o.get("id"): o for o in (over or []) if isinstance(o, dict) and o.get("id")} if isinstance(over, list) else {}
        for i, b in enumerate(base):
            o = by_id.get(b.get("id")) if isinstance(b, dict) and b.get("id") else (over[i] if isinstance(over, list) and i < len(over) else None)
            a, c = _count_strings(b, o); d += a; t += c
        return d, t
    if isinstance(base, str) and base.strip() and not base.strip().replace(".", "").isdigit():
        return (1 if isinstance(over, str) and over.strip() else 0), 1
    return 0, 0


def coverage(entry, lang):
    """Anteil übersetzter Texte (0 … 1) in einer Sprache."""
    if (entry.get("lang") or "de") == lang:
        return 1.0
    d, t = _count_strings(entry, (entry.get("i18n") or {}).get(lang))
    return 1.0 if t == 0 else d / t
