"""
build_rules.py – erzeugt die mitgelieferten Grundregeln (data/library)
═════════════════════════════════════════════════════════════════════
    python tools/content/build_rules.py

Quelle: srd51.py (Regeln 2014, Paket „basis") und srd52.py (Regeln 2024,
Paket „basis2024") – eigene, zweisprachige Kurzfassungen des SRD (CC-BY-4.0).

Jeder Eintrag bekommt eine stabile Kennung (rkey) und eine Revision (rev).
Beim Start einer bestehenden Installation ersetzt packs._sync_basis ältere
Fassungen desselben rkey (Kennung bleibt erhalten → Charaktere passen weiter).
"""
import hashlib, json, sys, importlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
LIB = ROOT / "data" / "library"
sys.path.insert(0, str(HERE))
REV = 2          # «STELLSCHRAUBE» erhöhen, wenn sich Inhalte ändern

SETS = [("srd51", "basis", "2014"), ("srd52", "basis2024", "2024")]

def _id(*parts): return hashlib.sha1(".".join(parts).encode()).hexdigest()[:8]

def _feat(f, fid):
    ch = [{"id": f"{fid}c{i}", "type": c["type"], "count": c.get("count", 1), "label": "", "options": []} for i, c in enumerate(f["choices"])]
    de = {"id": fid, "name": f["name"][0], "description": f["desc"][0], "choices": ch}
    en = {"id": fid, "name": f["name"][1], "description": f["desc"][1]}
    return de, en

def _features(by_level, prefix):
    de, en = {}, {}
    for lvl, fs in sorted(by_level.items()):
        de[str(lvl)], en[str(lvl)] = [], []
        for i, f in enumerate(fs):
            a, b = _feat(f, f"{prefix}{lvl}_{i}")
            de[str(lvl)].append(a); en[str(lvl)].append(b)
    return de, en

def build(modname, source, rules):
    m = importlib.import_module(modname)
    out = []
    cls_names = {c["key"]: c["name"] for c in m.CLASSES}
    def entry(cat, key, base, en, aliases=()):
        base.update({"id": _id(modname, cat, key), "rkey": f"{modname}.{cat}.{key}", "rev": REV, "rules": rules,
                     "source": source, "lang": "de", "i18n": {"en": en}})
        if aliases: base["aliases"] = list(aliases)
        out.append((cat, base))
    for r in m.RACES:
        tde, ten = zip(*[_feat(f, f"t{i}") for i, f in enumerate(r["traits"])]) if r["traits"] else ((), ())
        entry("races", r["key"], {"name": r["name"][0], "size": r["size"][0], "speed": r["speed"], "darkvision": r["darkvision"],
              "asi": r["asi"][0], "languages": r["languages"][0], "description": r["desc"][0], "traits": list(tde)},
              {"name": r["name"][1], "size": r["size"][1], "asi": r["asi"][1], "languages": r["languages"][1], "description": r["desc"][1], "traits": list(ten)},
              r.get("aliases", ()))
    for c in m.CLASSES:
        fde, fen = _features(c["features"], "f")
        entry("classes", c["key"], {"name": c["name"][0], "hd": c["hd"], "primary": c["primary"], "spellcaster": c["caster"],
              "armor": c["armor"][0], "weapons": c["weapons"][0], "tools": c["tools"][0], "saves": c["saves"][0],
              "skill_count": c["skill_count"], "skill_options": c["skill_options"][0], "description": c["desc"][0], "level_features": fde},
              {"name": c["name"][1], "armor": c["armor"][1], "weapons": c["weapons"][1], "tools": c["tools"][1], "saves": c["saves"][1],
               "skill_options": c["skill_options"][1], "description": c["desc"][1], "level_features": fen}, c.get("aliases", ()))
    for s in m.SUBCLASSES:
        fde, fen = _features(s["features"], "f")
        p = cls_names[s["parent"]]
        entry("subclasses", s["key"], {"name": s["name"][0], "parent_class_name": p[0], "parent_class": _id(modname, "classes", s["parent"]),
              "start_level": s["start"], "description": s["desc"][0], "level_features": fde},
              {"name": s["name"][1], "parent_class_name": p[1], "description": s["desc"][1], "level_features": fen}, s.get("aliases", ()))
    for b in m.BACKGROUNDS:
        entry("backgrounds", b["key"], {"name": b["name"][0], "skill_profs": b["skills"][0], "languages": b["languages"][0], "tool_profs": b["tools"][0],
              "equipment": b["equipment"][0], "feature": b["feature"][0], "description": b["desc"][0], **({"ability_scores": b["abilities"][0]} if "abilities" in b else {})},
              {"name": b["name"][1], "skill_profs": b["skills"][1], "languages": b["languages"][1], "tool_profs": b["tools"][1],
               "equipment": b["equipment"][1], "feature": b["feature"][1], "description": b["desc"][1], **({"ability_scores": b["abilities"][1]} if "abilities" in b else {})})
    for f in m.FEATS:
        entry("feats", f["key"], {"name": f["name"][0], "prereq": f["prereq"][0], "description": f["desc"][0], "benefits": f["benefits"][0], **({"category": f["cat"][0]} if "cat" in f else {})},
              {"name": f["name"][1], "prereq": f["prereq"][1], "description": f["desc"][1], "benefits": f["benefits"][1], **({"category": f["cat"][1]} if "cat" in f else {})})
    for c in m.CONDITIONS:
        n, d, al = c[0], c[1], (c[2] if len(c) > 2 else ())
        entry("conditions", n[1].lower().replace(" ", "_"), {"name": n[0], "description": d[0]}, {"name": n[1], "description": d[1]}, al)
    for n, rar, script, speakers in m.LANGUAGES:
        rar_en = {"Standard": "Standard", "Exotisch": "Exotic", "Selten": "Rare"}[rar]
        entry("languages", n[1].lower().replace(" ", "_").replace("'", ""), {"name": n[0], "rarity": rar, "script": script[0], "speakers": speakers[0],
              "description": f"{rar}e Sprache. Schrift: {script[0]}. Typische Sprecher: {speakers[0]}." if rar != "Standard" else f"Standardsprache. Schrift: {script[0]}. Typische Sprecher: {speakers[0]}."},
              {"name": n[1], "rarity": rar_en, "script": script[1], "speakers": speakers[1],
               "description": f"{rar_en} language. Script: {script[1]}. Typical speakers: {speakers[1]}."})
    return out

def main():
    # alte mitgelieferte Grundregeln entfernen (nur basis/basis2024)
    removed = 0
    for f in LIB.glob("*/*.json"):
        try:
            if json.loads(f.read_text(encoding="utf-8")).get("source") in ("basis", "basis2024"): f.unlink(); removed += 1
        except Exception: pass
    total = 0
    for mod, src, rules in SETS:
        try: entries = build(mod, src, rules)
        except ModuleNotFoundError: print(f"– {mod}: noch nicht vorhanden"); continue
        for cat, e in entries:
            (LIB / cat).mkdir(parents=True, exist_ok=True)
            (LIB / cat / f"{e['id']}.json").write_text(json.dumps(e, ensure_ascii=False, indent=1), encoding="utf-8")
        counts = {}
        for cat, _ in entries: counts[cat] = counts.get(cat, 0) + 1
        print(f"{mod} ({rules}): {len(entries)} Einträge", counts); total += len(entries)
    print(f"{removed} alte entfernt, {total} geschrieben")

if __name__ == "__main__":
    main()
