"""Bausteine für die Regel-Inhalte (zweisprachig, eigene Kurzfassungen).

Jede Angabe ist ein Paar (deutsch, englisch). build_rules.py macht daraus
Bibliotheks-Einträge: deutsche Hauptfassung + englische Übersetzung (i18n.en).
"""
ABIL = {"str": ("STR", "STR"), "dex": ("GES", "DEX"), "con": ("KON", "CON"),
        "int": ("INT", "INT"), "wis": ("WEI", "WIS"), "cha": ("CHA", "CHA")}
SKILL = {
 "acrobatics": ("Akrobatik", "Acrobatics"), "animal": ("Tierführung", "Animal Handling"), "arcana": ("Arkana", "Arcana"),
 "athletics": ("Athletik", "Athletics"), "deception": ("Täuschung", "Deception"), "history": ("Geschichte", "History"),
 "insight": ("Einsicht", "Insight"), "intimidation": ("Einschüchtern", "Intimidation"), "investigation": ("Nachforschungen", "Investigation"),
 "medicine": ("Heilkunde", "Medicine"), "nature": ("Naturkunde", "Nature"), "perception": ("Wahrnehmung", "Perception"),
 "performance": ("Auftreten", "Performance"), "persuasion": ("Überzeugen", "Persuasion"), "religion": ("Religion", "Religion"),
 "sleight": ("Fingerfertigkeit", "Sleight of Hand"), "stealth": ("Heimlichkeit", "Stealth"), "survival": ("Überleben", "Survival"),
}
ALL_SKILLS = list(SKILL)

def abil(*keys):
    return (", ".join(ABIL[k][0] for k in keys), ", ".join(ABIL[k][1] for k in keys))

def skills(*keys):
    return (", ".join(SKILL[k][0] for k in keys), ", ".join(SKILL[k][1] for k in keys))

def F(name, desc, choices=None):
    """Merkmal / Eigenschaft: name=(de,en), desc=(de,en)."""
    return {"name": name, "desc": desc, "choices": choices or []}

ASI = F(("Attributswerterhöhung", "Ability Score Improvement"),
        ("Ein Attribut um 2 oder zwei Attribute um je 1 erhöhen (höchstens 20) – oder stattdessen ein Talent.",
         "Increase one ability score by 2 or two by 1 (max 20) – or take a feat instead."))
SUBCLASS_FEATURE = lambda n: F(("Merkmal der Unterklasse", "Subclass feature"),
                               ("Merkmal deiner gewählten " + n[0] + ".", "Feature from your chosen " + n[1] + "."))
