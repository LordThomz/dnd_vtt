"""game_state.py – Central store + JSON persistence.

Library storage: per-category folder `data/library/<cat>/<id>.json`.
Supported categories: races, classes, subclasses, items, spells, attacks,
                      feats, backgrounds, magic_items, conditions, monsters.
"""
import uuid, json, time, threading, copy, hashlib, hmac, secrets, shutil, sys, os
from pathlib import Path

# Datenverzeichnis: im Normalbetrieb der Projektordner, in der gebündelten
# Exe ein beschreibbarer Ordner im Benutzerprofil. Kommt zentral aus config.py.
def _resolve_data_dir():
    try:
        from config import app_data_dir, app_base_dir
        return app_data_dir(), app_base_dir()
    except Exception:
        base = Path(__file__).resolve().parent
        return base, base

_DATA_DIR, _BUNDLE_DIR = _resolve_data_dir()
_BASE_DIR  = _DATA_DIR                       # Daten werden hier gelesen/geschrieben
DATA_FILE  = _BASE_DIR / "data" / "sessions.json"
CHARS_FILE = _BASE_DIR / "data" / "characters.json"
USERS_FILE = _BASE_DIR / "data" / "users.json"
LIB_DIR    = _BASE_DIR / "data" / "library"

def _ensure_initial_data():
    """Stellt sicher, dass der Datenordner existiert. In der gebündelten Exe
    werden mitgelieferte Startdaten (z. B. die Bibliothek) beim ersten Start
    einmalig in den beschreibbaren Datenordner kopiert."""
    (_BASE_DIR / "data").mkdir(parents=True, exist_ok=True)
    # Nur wenn Daten- und Bundle-Ordner verschieden sind (also in der Exe):
    if str(_DATA_DIR) != str(_BUNDLE_DIR):
        src_lib = _BUNDLE_DIR / "data" / "library"
        if src_lib.exists() and not LIB_DIR.exists():
            shutil.copytree(src_lib, LIB_DIR)
        # Uploads-Ordner im Datenbereich anlegen
        for sub in ("maps", "tokens", "enemies"):
            (_BASE_DIR / "uploads" / sub).mkdir(parents=True, exist_ok=True)

_ensure_initial_data()

LIBRARY_CATEGORIES = [
    "races", "classes", "subclasses",
    "items", "magic_items", "spells", "attacks",
    "feats", "backgrounds", "conditions", "monsters", "languages",
]

_sessions:   dict = {}
_characters: dict = {}
_users:      dict = {}   # username -> {username, display_name, password_hash, salt, ...}
_library:    dict = {cat:{} for cat in LIBRARY_CATEGORIES}
_dirty = False
_lock  = threading.Lock()

# ── Password hashing (PBKDF2) ──────────────────────────────────────────────
def _hash_password(password, salt=None):
    if salt is None:
        salt = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 100_000)
    return salt, h.hex()

def _verify_password(password, salt, expected_hex):
    _, got = _hash_password(password, salt)
    return hmac.compare_digest(got, expected_hex)

def _default_map(mid, name="Neue Karte"):
    return {"id":mid,"name":name,"url":None,"width":3000,"height":2000,
            "grid_size":50,"grid_color":"theme","grid_opacity":0.35,"fog_cells":[],
            "walls":[], "explore_mode":True,
            "map_type":"combat",        # "combat" | "exploration"
            "darkness":False,           # ist die Karte grundsätzlich dunkel?
            "image_x":0,"image_y":0,    # Position des Kartenbilds (Kartenpixel, am Raster)
            "image_w":0,"image_h":0,    # Größe des Kartenbilds (0 = auf volle Karte strecken)
            }

def _default_session(sid, owner_username=""):
    mid = new_id()
    return {
        "id":sid,"name":f"Kampagne {sid[:6]}","gm_password":"dm1234",
        "owner": owner_username,       # username of the DM who owns this campaign
        "visibility": "private",        # "private" | "public" (visible in join list)
        "invited_users": [],            # usernames the DM added as players
        "player_password": "",          # optional password players must enter
        "approved_chars": {},           # {username: char_id} — approved char per player
        "pending_char_changes": [],     # [{request_id, username, old/new char info}]
        "maps":{mid:_default_map(mid,"Karte 1")},"active_map_id":mid,
        "map_folders":[],
        "tokens":{},"initiative":[],"current_turn_index":0,
        "vision_settings":{},           # {char_id: {vision_override, perception_mod}} — global pro Charakter
        "chat":[],"handouts":[],
        "enemy_folders":[{"id":"default","name":"Allgemein","enemy_ids":[]}],
        "enemies":{},
        "drawing_strokes":[],
        "roster":{},
        "journal":[],
        "notes":[],                     # Spieler-Notizen: [{id, author_char_id, author_name, title, content, shared, ts}]
        "settings":{"drawing_allowed":True},
        "users":{},
    }

def _default_enemy(eid, data):
    hp = data.get("hp",10)
    return {
        "id":eid,"name":data.get("name","Gegner"),"hp":hp,"max_hp":data.get("max_hp",hp),
        "ac":data.get("ac",12),"speed":data.get("speed",30),"cr":data.get("cr","1"),
        "url":data.get("url",""),"notes":data.get("notes",""),
        "folder_id":data.get("folder_id","default"),
        "stats":{"str":data.get("str",10),"dex":data.get("dex",10),"con":data.get("con",10),
                 "int":data.get("int",10),"wis":data.get("wis",10),"cha":data.get("cha",10)},
        "initiative_bonus":data.get("initiative_bonus",0),
        "attacks":data.get("attacks",[]),
        # ── Vollständiger Charakterbogen (wie bei Spielern) ──────────────
        "creature_type":data.get("creature_type",""),   # z. B. "Humanoid", "Untot"
        "size":data.get("size","M"),                    # T/S/M/L/H/G
        "alignment":data.get("alignment",""),           # z. B. "Rechtschaffen böse"
        "level":data.get("level",1),                    # für den Übungsbonus
        "save_profs":data.get("save_profs",[]),         # ["dex","con", ...]
        "skill_profs":data.get("skill_profs",[]),       # ["Wahrnehmung", ...]
        "senses":data.get("senses",""),                 # z. B. "Dunkelsicht 60 ft"
        "languages":data.get("languages",""),
        "resistances":data.get("resistances",""),       # Resistenzen/Immunitäten
        "traits":data.get("traits",[]),                 # besondere Fähigkeiten
        "inventory":data.get("inventory",[]),           # Beute/Ausrüstung
        "equipment":data.get("equipment",""),
        "backstory":data.get("backstory",""),           # DM-Notizen zur Kreatur
    }

# ── Persistence ────────────────────────────────────────────────────────────
def save_sessions_only():
    """Save sessions and characters (lightweight, called often)."""
    global _dirty
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    with _lock:
        try:
            out = {}
            for sid, s in _sessions.items():
                out[sid] = {k:v for k,v in s.items() if k != "users"}
            DATA_FILE.write_text(json.dumps(out, ensure_ascii=False, indent=2), encoding="utf-8")
            CHARS_FILE.write_text(json.dumps(_characters, ensure_ascii=False, indent=2), encoding="utf-8")
            USERS_FILE.write_text(json.dumps(_users, ensure_ascii=False, indent=2), encoding="utf-8")
            _dirty = False
        except Exception as e:
            print(f"[save sessions] {e}")

def save_now():
    """Save sessions + characters (library uses per-entry save)."""
    save_sessions_only()

def mark_dirty():
    global _dirty; _dirty = True

def _autosave_loop():
    while True:
        time.sleep(6)
        if _dirty: save_sessions_only()

def _lib_path(category, entry_id):
    return LIB_DIR / category / f"{entry_id}.json"

def _save_library_file(category, entry):
    eid = entry.get("id")
    if not eid: return
    cat_dir = LIB_DIR / category
    cat_dir.mkdir(parents=True, exist_ok=True)
    try:
        _lib_path(category, eid).write_text(json.dumps(entry, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        print(f"[save lib {category}/{eid}] {e}")

def _delete_library_file(category, entry_id):
    try:
        p = _lib_path(category, entry_id)
        if p.exists(): p.unlink()
    except Exception as e:
        print(f"[del lib {category}/{entry_id}] {e}")

def _migrate_old_library():
    """One-time migration: read old data/items.json and split into new folders."""
    old_file = _BASE_DIR / "data" / "items.json"
    if not old_file.exists(): return
    try:
        old_data = _read_json_tolerant(old_file)
        migrated = False
        for cat, entries in old_data.items():
            if cat not in LIBRARY_CATEGORIES: continue
            if not isinstance(entries, dict): continue
            for eid, entry in entries.items():
                entry["id"] = eid
                _library[cat][eid] = entry
                _save_library_file(cat, entry)
                migrated = True
        if migrated:
            # Back up old file
            old_file.rename(_BASE_DIR / "data" / "items.json.migrated")
            print(f"[migrate] old library -> folder structure (backup: items.json.migrated)")
    except Exception as e:
        print(f"[migrate library] {e}")

def _read_json_tolerant(path):
    """Read a JSON file, tolerating both UTF-8 and legacy latin-1 encodings."""
    raw = Path(path).read_bytes()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
        try: Path(path).write_text(text, encoding="utf-8")
        except Exception: pass
    return json.loads(text)

def load_from_disk():
    global _characters
    # Migrate old single-file library if present
    _migrate_old_library()

    # Load library from folder structure (tolerant of UTF-8 or latin-1 files)
    for cat in LIBRARY_CATEGORIES:
        cat_dir = LIB_DIR / cat
        if not cat_dir.exists(): continue
        for jf in cat_dir.glob("*.json"):
            try:
                raw_bytes = jf.read_bytes()
                try:
                    text = raw_bytes.decode("utf-8")
                except UnicodeDecodeError:
                    # Legacy file saved as latin-1/cp1252 → decode and re-save as UTF-8
                    text = raw_bytes.decode("latin-1")
                    try:
                        jf.write_text(text, encoding="utf-8")
                        print(f"[fix] {jf.name} von latin-1 zu UTF-8 konvertiert")
                    except Exception: pass
                entry = json.loads(text)
                eid = entry.get("id") or jf.stem
                entry["id"] = eid
                _library[cat][eid] = entry
            except Exception as e:
                print(f"[load lib {jf}] {e}")
    total = sum(len(v) for v in _library.values())
    print(f"[load] library: {total} entries across {len([c for c in _library if _library[c]])} categories")

    if DATA_FILE.exists():
        try:
            raw = _read_json_tolerant(DATA_FILE)
            for sid, s in raw.items():
                s["users"] = {}
                s.setdefault("owner", "")
                s.setdefault("visibility", "private")
                s.setdefault("invited_users", [])
                s.setdefault("player_password", "")
                s.setdefault("approved_chars", {})
                s.setdefault("pending_char_changes", [])
                s.setdefault("journal", [])
                for _f in s.get("map_folders",[]):
                    _f.setdefault("parent_id", "")
                    _f.setdefault("map_ids", [])
                for _m in s.get("maps",{}).values():
                    _m.setdefault("walls", [])
                    _m.setdefault("map_type", "combat")
                    _m.setdefault("darkness", False)
                    _m.setdefault("image_x", 0); _m.setdefault("image_y", 0)
                    _m.setdefault("image_w", 0); _m.setdefault("image_h", 0)
                    _m.setdefault("explore_mode", True)
                    _m.setdefault("fog_cells", [])
                if "enemy_folders" not in s:
                    s["enemy_folders"] = [{"id":"default","name":"Allgemein","enemy_ids":[]}]
                if isinstance(s.get("enemies"), list):
                    s["enemies"] = {e["id"]:e for e in s["enemies"]}
                if "maps" not in s:
                    mid = new_id()
                    s["maps"] = {mid: _default_map(mid)}
                    s["active_map_id"] = mid
                if "roster" not in s: s["roster"] = {}
                if "settings" not in s: s["settings"] = {"drawing_allowed":True}
                else:
                    s["settings"].pop("show_enemy_hp", None)
                    s["settings"].pop("show_enemy_ac", None)
                for t in s.get("tokens",{}).values():
                    t.setdefault("show_hp_to_players", not t.get("is_enemy", False))
                    t.setdefault("show_ac_to_players", not t.get("is_enemy", False))
                    t.setdefault("map_id", s.get("active_map_id",""))
                    t.setdefault("placeholder_for_user", "")
                    t.setdefault("bars", [])
                    t.setdefault("light_bright", 0)
                    t.setdefault("light_dim", 0)
                    t.setdefault("perception", 10)
                    t.setdefault("perception_mod", 1.0)
                    if "per_map_positions" not in t:
                        t["per_map_positions"] = ({t["map_id"]: {"x":t.get("x",0),"y":t.get("y",0),"placed":True}}
                                                  if t.get("map_id") else {})
                for e in s.get("initiative",[]):
                    e.setdefault("show_hp_to_players", not e.get("is_enemy", False))
                    e.setdefault("show_ac_to_players", not e.get("is_enemy", False))
                _sessions[sid] = s
            print(f"[load] {len(_sessions)} sessions")
        except Exception as e:
            print(f"[load sessions] {e}")
    if CHARS_FILE.exists():
        try:
            _characters = _read_json_tolerant(CHARS_FILE)
            for cid, c in _characters.items():
                c.setdefault("owner", "Thomas")
            print(f"[load] {len(_characters)} characters")
        except Exception as e: print(f"[load chars] {e}")

    # Load users, create default Thomas account
    global _users
    if USERS_FILE.exists():
        try:
            _users = _read_json_tolerant(USERS_FILE)
            print(f"[load] {len(_users)} users")
        except Exception as e: print(f"[load users] {e}")
    # Früher wurde hier in JEDER Installation ein Konto „Thomas" mit dem
    # Passwort „thomas" angelegt – wer sich mit dem Server eines anderen
    # verband, hätte sich damit anmelden können. Neue Installationen starten
    # jetzt ohne Konto; man registriert sich beim ersten Start selbst.
    # (Bestehende Konten in users.json bleiben unverändert.)

def get_session(sid, owner=""):
    if sid not in _sessions:
        _sessions[sid] = _default_session(sid, owner)
        mark_dirty()
    return _sessions[sid]

def active_map(s):
    mid = s.get("active_map_id")
    return s["maps"].get(mid, next(iter(s["maps"].values())))

def all_sessions():
    return [{"id":k,"name":v["name"]} for k,v in _sessions.items()]

def session_safe_copy(s):
    c = copy.deepcopy({k:v for k,v in s.items() if k != "users"})
    c["users"] = list(s["users"].values())
    return c

def new_id(length=8):
    return uuid.uuid4().hex[:length]

# ── Character library ──────────────────────────────────────────────────────
def get_all_characters(owner=None):
    if owner is None: return _characters
    return {cid:c for cid,c in _characters.items() if c.get("owner")==owner}
def save_character(char, owner=None):
    cid = char.get("id") or new_id()
    char["id"] = cid
    if owner: char["owner"] = owner
    elif "owner" not in char: char["owner"] = "Thomas"
    _characters[cid] = char
    mark_dirty()
    return char
def delete_character(cid, owner=None):
    c = _characters.get(cid)
    if c and (owner is None or c.get("owner")==owner):
        _characters.pop(cid, None); mark_dirty(); return True
    return False
def get_character(cid):
    return _characters.get(cid)

# ── Global library ─────────────────────────────────────────────────────────
def get_library(): return _library
def get_library_category(cat):
    return _library.get(cat, {})

def save_library_entry(category, entry, owner=None):
    if category not in LIBRARY_CATEGORIES: return entry
    if category not in _library: _library[category] = {}
    eid = entry.get("id") or new_id()
    entry["id"] = eid
    entry.setdefault("source", "eigene")      # Quelle (siehe packs.py)
    if "created_by" not in entry:
        entry["created_by"] = owner or "Thomas"
    _library[category][eid] = entry
    _save_library_file(category, entry)
    return entry

def delete_library_entry(category, eid, requester=None):
    """Löscht einen Bibliotheks-Eintrag.

    Wenn 'requester' angegeben ist, darf nur der Ersteller (owner) löschen.
    Einträge ohne Besitzer (mitgelieferte Standard-Einträge) bleiben für alle
    Angemeldeten löschbar. Gibt True zurück, wenn gelöscht wurde.
    """
    if category not in _library:
        return False
    entry = _library[category].get(eid)
    if entry is None:
        return False
    if requester is not None:
        owner = entry.get("created_by")
        if owner and owner != requester:
            return False   # fremder Eintrag – nicht löschen
    _library[category].pop(eid, None)
    _delete_library_file(category, eid)
    return True

# ── User accounts ──────────────────────────────────────────────────────────
def list_users():
    return [{"username":u["username"],"display_name":u.get("display_name",u["username"]),
             "nickname":u.get("nickname",""),"avatar_color":u.get("avatar_color","#c9a96e"),
             "favorite_class":u.get("favorite_class",""),"favorite_race":u.get("favorite_race","")}
            for u in _users.values()]

def get_user(username):
    return _users.get(username)

def register_user(data):
    username = (data.get("username") or "").strip()
    password = data.get("password") or ""
    if not username or not password:
        return {"error":"Benutzername und Passwort erforderlich"}
    if len(username) < 3:
        return {"error":"Benutzername muss mindestens 3 Zeichen haben"}
    if len(password) < 4:
        return {"error":"Passwort muss mindestens 4 Zeichen haben"}
    if username in _users:
        return {"error":"Benutzername bereits vergeben"}
    salt, pw_hash = _hash_password(password)
    _users[username] = {
        "username":username,
        "display_name":(data.get("display_name") or username).strip(),
        "nickname":(data.get("nickname") or "").strip(),
        "email":(data.get("email") or "").strip(),
        "password_salt":salt,"password_hash":pw_hash,
        "favorite_class":(data.get("favorite_class") or "").strip(),
        "favorite_race":(data.get("favorite_race") or "").strip(),
        "avatar_color":data.get("avatar_color") or "#c9a96e",
        "bio":(data.get("bio") or "").strip(),
        "lucky_number":data.get("lucky_number") or 0,
        "created_at":time.time(),
    }
    mark_dirty()
    return {"ok":True, "user":_users[username]}

def authenticate(username, password):
    u = _users.get(username)
    if not u: return False
    return _verify_password(password, u.get("password_salt",""), u.get("password_hash",""))

# ── Campaign ownership helpers ─────────────────────────────────────────────
def sessions_owned_by(username):
    return [s for s in _sessions.values() if s.get("owner")==username]

def public_sessions():
    return [s for s in _sessions.values() if s.get("visibility")=="public"]

def sessions_invited_to(username):
    return [s for s in _sessions.values()
            if username in (s.get("invited_users") or [])
            and s.get("owner")!=username]

def is_dm_online(session):
    """Ist der DM (Besitzer) gerade erreichbar?

    Früher haben wir nur in der Liste der verbundenen Nutzer nachgesehen.
    Die ist aber flüchtig: Bricht die Verbindung kurz ab (Netzwerk-Hänger,
    Tab-Wechsel, Server-Neustart), verschwindet der DM daraus – und die
    Sitzung galt plötzlich als verwaist, obwohl er noch am Tisch saß.

    Deshalb merken wir uns zusätzlich, wann er zuletzt gesehen wurde, und
    überbrücken kurze Aussetzer.
    """
    owner = session.get("owner")
    if not owner:
        return False

    # 1) Ist er gerade verbunden?
    for u in session.get("users", {}).values():
        if u.get("role") == "gm" and u.get("username") == owner:
            return True

    # 2) War er eben noch da? (Kurze Aussetzer überbrücken)
    last = session.get("dm_last_seen", 0)
    if last and (time.time() - last) < DM_GRACE_SECONDS:
        return True

    return False

# So lange gilt der DM nach einem Verbindungsabbruch noch als anwesend.
# Das überbrückt Netzwerk-Hänger, ohne dass verwaiste Sitzungen ewig
# als "offen" erscheinen.
DM_GRACE_SECONDS = 90

def can_access_session(session, username):
    """Zentrale Zugriffsregel für ein Adventure / eine Session.

    Ein Nutzer darf auf die Session-Details zugreifen, wenn EINE der
    folgenden Bedingungen erfüllt ist:
      - er ist der Besitzer (DM) der Session,
      - er wurde ausdrücklich eingeladen,
      - die Session ist öffentlich.
    Damit bleiben private Adventures für Unbeteiligte unsichtbar –
    genau das gewünschte Verhalten "Adventures bleiben privat".
    """
    if not session:
        return False
    if not username:
        # Nicht angemeldet: nur öffentliche Sessions.
        return session.get("visibility") == "public"
    if session.get("owner") == username:
        return True
    if username in (session.get("invited_users") or []):
        return True
    if session.get("visibility") == "public":
        return True
    return False

threading.Thread(target=_autosave_loop, daemon=True).start()
