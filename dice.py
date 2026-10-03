"""
dice.py – Würfelformeln auswerten
═════════════════════════════════

Der Server ist die einzige Autorität über Würfelergebnisse. Er würfelt mit
kryptografisch sicherem Zufall (secrets.SystemRandom) – niemand kann Würfe
vorhersagen oder vom Browser aus manipulieren. Die 3D-Würfel im Browser
spielen das feststehende Ergebnis nur noch sichtbar nach (siehe dice3d.js).

UNTERSTÜTZTE SCHREIBWEISEN (Groß-/Kleinschreibung egal, Leerzeichen egal)
    1d20+5          normaler Wurf mit Modifikator
    d20             „1" darf fehlen
    2d20kh1  / adv  Vorteil   (höchsten behalten)
    2d20kl1  / dis  Nachteil  (niedrigsten behalten)
    4d6kh3          Attributswurf
    4d6dl1          „drop lowest" – gleichbedeutend mit 4d6kh3
    1d100 / 1d%     Prozentwurf
    1w20+3          deutsche Schreibweise (W statt D)
    2d6+1d4-1       beliebig kombinierbar

Das Ergebnis-dict wird vom Chat angezeigt und an die 3D-Nachspielung verteilt.
"""

import re
import secrets

_rng = secrets.SystemRandom()

# «STELLSCHRAUBE» Schutzgrenzen gegen Tippfehler wie „1000d1000"
MAX_DICE_PER_TERM = 100
MAX_TERMS = 20
MAX_SIDES = 1000

_ALIASES = {
    "adv": "2d20kh1", "vorteil": "2d20kh1",
    "dis": "2d20kl1", "nachteil": "2d20kl1",
}

_DICE_RE = re.compile(r"^(\d*)d(\d+|%)(?:(kh|kl|dh|dl|k)(\d+))?$")


class DiceError(ValueError):
    """Formel ist ungültig (wird dem Spieler als Hinweis angezeigt)."""


def normalize(formula: str) -> str:
    f = (formula or "").strip().lower().replace(" ", "")
    f = f.replace("w", "d").replace("−", "-")
    # Aliase auch am Anfang mit Modifikator: "adv+5" → "2d20kh1+5"
    for alias, repl in _ALIASES.items():
        if f == alias or f.startswith(alias + "+") or f.startswith(alias + "-"):
            f = repl + f[len(alias):]
            break
    return f or "1d20"


def roll(formula: str) -> dict:
    """
    Würfelt eine Formel aus.

    Returns:
        {
          formula: str,          – bereinigte Formel
          total:   int,
          parts: [
            {type:"dice", expr:"2d20kh1", sides:20, rolls:[3,17], used:[17],
             kept:[1], subtotal:17, sign:1},
            {type:"mod",  expr:"+5", value:5},
          ]
        }
    Wirft DiceError bei ungültigen Formeln.
    """
    f = normalize(formula)
    tokens = [t for t in re.split(r"(?=[+\-])", f) if t]
    if not tokens or len(tokens) > MAX_TERMS:
        raise DiceError("Ungültige Formel")

    parts, total = [], 0
    for tok in tokens:
        sign = 1
        if tok[0] in "+-":
            sign = -1 if tok[0] == "-" else 1
            tok = tok[1:]
        if not tok:
            raise DiceError("Ungültige Formel")

        dm = _DICE_RE.match(tok)
        if dm:
            num = int(dm.group(1) or 1)
            sides = 100 if dm.group(2) == "%" else int(dm.group(2))
            mode, n = dm.group(3), dm.group(4)
            if not (1 <= num <= MAX_DICE_PER_TERM) or not (2 <= sides <= MAX_SIDES):
                raise DiceError(f"Zu viele Würfel oder Seiten in „{tok}“")

            rolls = [_rng.randint(1, sides) for _ in range(num)]

            # Welche Würfel zählen? (Indizes, damit der Chat die richtigen
            # Würfel durchstreichen kann – auch bei gleichen Augenzahlen)
            order_hi = sorted(range(num), key=lambda i: (-rolls[i], i))
            order_lo = sorted(range(num), key=lambda i: (rolls[i], i))
            k = int(n) if n else None
            if mode in ("kh", "k") and k:
                kept = sorted(order_hi[:k])
            elif mode == "kl" and k:
                kept = sorted(order_lo[:k])
            elif mode == "dl" and k is not None:
                kept = sorted(order_hi[:max(0, num - k)])
            elif mode == "dh" and k is not None:
                kept = sorted(order_lo[:max(0, num - k)])
            else:
                kept = list(range(num))

            used = [rolls[i] for i in kept]
            subtotal = sum(used) * sign
            total += subtotal
            expr = f"{'−' if sign < 0 else ''}{num}d{sides}" + (f"{mode}{n}" if mode else "")
            parts.append({
                "type": "dice", "expr": expr, "sides": sides,
                "rolls": rolls, "used": used, "kept": kept,
                "subtotal": subtotal, "sign": sign,
            })
        elif tok.isdigit():
            val = int(tok) * sign
            total += val
            parts.append({"type": "mod", "expr": f"{'+' if sign >= 0 else '−'}{tok}", "value": val})
        else:
            raise DiceError(f"Unbekannter Teil „{tok}“")

    if not any(p["type"] == "dice" for p in parts):
        raise DiceError("Die Formel enthält keinen Würfel")
    return {"formula": f, "total": total, "parts": parts}


def animation_dice(result: dict) -> list:
    """Flache Liste aller geworfenen Würfel für die 3D-Nachspielung:
    [{sides, value}, …] in Wurf-Reihenfolge (auch nicht gewertete Würfel –
    beim Vorteil sieht man ja beide W20 rollen)."""
    out = []
    for p in result.get("parts", []):
        if p.get("type") == "dice":
            for v in p.get("rolls", []):
                out.append({"sides": p.get("sides", 20), "value": v})
    return out


def new_seed() -> int:
    """Startwert für die Wurfbewegung (alle Clients sehen denselben Wurf)."""
    return secrets.randbits(32)
