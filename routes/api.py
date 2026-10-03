"""routes/api.py"""
import uuid
from pathlib import Path
import packs
from flask import (Blueprint, jsonify, request, send_from_directory, Response,
                   session as flask_session)
from game_state import (get_session, all_sessions, session_safe_copy,
                        get_all_characters, save_character, delete_character,
                        get_character, mark_dirty, active_map, new_id,
                        get_library, save_library_entry, delete_library_entry,
                        LIBRARY_CATEGORIES,
                        register_user, authenticate, get_user, list_users,
                        sessions_owned_by, public_sessions, sessions_invited_to,
                        is_dm_online, can_access_session, _sessions)

api_bp = Blueprint("api", __name__)

# Programmversion – wird später für die automatische Update-Prüfung genutzt.
APP_VERSION = "0.2.2"

# Uploads landen im beschreibbaren Datenverzeichnis (wichtig für die gebündelte Exe).
from config import app_data_dir
BASE_DIR = app_data_dir()
UPLOAD_ROOT = BASE_DIR / "uploads"

def _save_upload(folder, file):
    # Dateinamen bereinigen – sonst könnte „../../x" außerhalb des Ordners landen
    from werkzeug.utils import secure_filename
    fname = f"{uuid.uuid4().hex[:8]}_{secure_filename(file.filename or '') or 'datei'}"
    d = UPLOAD_ROOT / folder; d.mkdir(parents=True, exist_ok=True)
    file.save(str(d / fname))
    return f"/uploads/{folder}/{fname}"

def _current_user():
    return flask_session.get("username") or None

def _require_login():
    return _current_user()

def _is_local_request():
    """Kommt die Anfrage vom eigenen PC (nicht über das Netzwerk)?"""
    addr = (request.remote_addr or "").strip()
    return addr in ("127.0.0.1", "::1", "localhost") and not request.headers.get("X-Forwarded-For")

def _app_header():
    """Anfrage kommt von unserer eigenen Oberfläche (Launcher oder Spielseite)?
    Eine fremde Webseite kann diesen Kopf nicht setzen, ohne dass der Browser
    vorher nachfragt (CORS) – und das erlauben wir fremden Seiten nicht."""
    return request.headers.get("X-VTT-App") == "1"

def _owner_guard():
    """Besitzer-Prinzip (config.OWNER_ONLY): Verwalten nur am eigenen PC.
    Am eigenen PC genügt Anmeldung ODER die App-Kennung (der Launcher ist
    nicht angemeldet – wer an diesem PC sitzt, ist der Besitzer).
    Gibt eine Fehler-Antwort zurück oder None, wenn alles in Ordnung ist."""
    from config import Config
    if getattr(Config, "OWNER_ONLY", False):
        if not _is_local_request():
            return jsonify({"error": "Das kann nur der Besitzer dieser Installation an seinem eigenen PC ändern."}), 403
        if _app_header() or _require_login():
            return None
        return jsonify({"error": "Bitte anmelden"}), 401
    if not _require_login():
        return jsonify({"error": "Bitte anmelden"}), 401
    return None

# ── Auth ────────────────────────────────────────────────────────────────────
@api_bp.route("/api/auth/register", methods=["POST"])
def auth_register():
    data = request.get_json(silent=True) or {}
    result = register_user(data)
    if result.get("error"):
        return jsonify(result), 400
    flask_session["username"] = data["username"]
    flask_session.permanent = True
    u = result["user"]
    public = {k:v for k,v in u.items() if k not in ("password_hash","password_salt")}
    return jsonify({"ok":True, "user":public})

@api_bp.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = request.get_json(silent=True) or {}
    username = data.get("username",""); password = data.get("password","")
    if not authenticate(username, password):
        return jsonify({"error":"Benutzername oder Passwort falsch"}), 401
    flask_session["username"] = username
    # "Gerät merken" (Standard: an). Bei true bleibt die Anmeldung erhalten,
    # sodass man beim nächsten App-Start automatisch eingeloggt ist.
    remember = data.get("remember", True)
    flask_session.permanent = bool(remember)
    u = get_user(username)
    public = {k:v for k,v in u.items() if k not in ("password_hash","password_salt")}
    return jsonify({"ok":True, "user":public})

@api_bp.route("/api/auth/guest", methods=["POST"])
def auth_guest():
    import time as _t
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip() or "Gast"
    # Eindeutigen Gast-Usernamen erzeugen
    guest_username = f"gast_{new_id(6)}"
    from game_state import _users
    _users[guest_username] = {
        "username": guest_username,
        "display_name": name[:24],
        "nickname": "",
        "email": "",
        "password_salt": "", "password_hash": "",  # kein Login möglich
        "favorite_class": "", "favorite_race": "",
        "avatar_color": data.get("avatar_color") or "#7ab8d4",
        "bio": "", "lucky_number": 0,
        "is_guest": True,
        "created_at": _t.time(),
    }
    # Gäste werden NICHT dauerhaft gespeichert (kein mark_dirty)
    flask_session["username"] = guest_username
    flask_session["is_guest"] = True
    flask_session.permanent = True
    public = {k:v for k,v in _users[guest_username].items() if k not in ("password_hash","password_salt")}
    return jsonify({"ok":True, "user":public})

@api_bp.route("/api/auth/update_profile", methods=["POST"])
def auth_update_profile():
    """Erlaubt dem angemeldeten Nutzer, sein eigenes Profil zu bearbeiten
    (Anzeigename, Spitzname, Farbe)."""
    username = _current_user()
    if not username:
        return jsonify({"error": "Bitte anmelden"}), 401
    from game_state import _users, mark_dirty
    u = _users.get(username)
    if not u:
        return jsonify({"error": "Konto nicht gefunden"}), 404
    if u.get("is_guest"):
        return jsonify({"error": "Als Gast kannst du das Profil nicht ändern"}), 403
    data = request.get_json(silent=True) or {}
    # Nur erlaubte Felder übernehmen
    if "display_name" in data:
        dn = (data["display_name"] or "").strip()
        if dn: u["display_name"] = dn[:32]
    if "nickname" in data:
        u["nickname"] = (data["nickname"] or "").strip()[:32]
    if "email" in data:
        u["email"] = (data["email"] or "").strip()[:120]
    if "favorite_class" in data:
        u["favorite_class"] = (data["favorite_class"] or "").strip()[:32]
    if "favorite_race" in data:
        u["favorite_race"] = (data["favorite_race"] or "").strip()[:32]
    if "lucky_number" in data:
        try: u["lucky_number"] = int(data["lucky_number"])
        except (ValueError, TypeError): pass
    if "bio" in data:
        u["bio"] = (data["bio"] or "").strip()[:500]
    if "avatar_color" in data:
        col = (data["avatar_color"] or "").strip()
        if col.startswith("#") and len(col) <= 9:
            u["avatar_color"] = col
    mark_dirty()
    public = {k:v for k,v in u.items() if k not in ("password_hash","password_salt")}
    return jsonify({"ok": True, "user": public})

@api_bp.route("/api/auth/logout", methods=["POST"])
def auth_logout():
    # Gast-User beim Logout aus dem Speicher entfernen
    u = flask_session.get("username")
    if u and flask_session.get("is_guest"):
        from game_state import _users
        _users.pop(u, None)
    flask_session.pop("username", None)
    flask_session.pop("is_guest", None)
    return jsonify({"ok":True})

@api_bp.route("/api/auth/has_users", methods=["GET"])
def auth_has_users():
    """Gibt es auf dieser Installation schon ein Konto? (Erster Start → Registrierung)"""
    from game_state import _users
    return jsonify({"has_users": bool(_users)})


@api_bp.route("/api/server/info", methods=["GET"])
def server_info():
    """Basis-Infos über diesen Server. Die App nutzt das, um zu erkennen,
    mit welchem Server (Entwicklung oder echter Server) sie verbunden ist."""
    from config import Config
    return jsonify({
        "name": "VTT Server",
        "version": APP_VERSION,
        "mode": Config.MODE,
        "public_url": Config.PUBLIC_URL,
        # Sitzt der Aufrufer am eigenen PC? Dann darf er verwalten
        # (Bibliothek, Pakete, Kampagnen) – siehe _owner_guard().
        "is_owner": (not getattr(Config, "OWNER_ONLY", False)) or _is_local_request(),
    })

def _parse_version(v):
    """Wandelt '1.2.3' in (1,2,3) um, damit Versionen verglichen werden können."""
    parts = []
    for p in str(v).split("."):
        try:
            parts.append(int(p))
        except ValueError:
            parts.append(0)
    # Auf gleiche Länge bringen
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])

@api_bp.route("/api/server/check_update", methods=["GET"])
def check_update():
    """Prüft, ob die App-Version des Nutzers aktuell ist.

    Die App schickt ihre eigene Version mit (?version=...). Der Server
    vergleicht sie mit der neuesten verfügbaren Version und meldet zurück,
    ob ein Update nötig ist.

    Wenn im Ordner 'updates/' eine Installer-Datei liegt, bietet der Server
    sie direkt zum Download an. So können Freunde, die per Tailscale mit
    diesem PC verbunden sind, das Update direkt von hier laden und installieren.
    """
    from config import Config
    client_version = request.args.get("version", "")

    # Nach einer bereitgestellten Installer-Datei suchen.
    installer = _find_installer()

    # Die neueste Version ist die höhere aus: Server-Version (APP_VERSION)
    # und der Version, die im Installer-Dateinamen steht (z.B. ..._0.2.0_...).
    latest = APP_VERSION
    if installer:
        file_ver = _version_from_filename(installer.name)
        if file_ver and _parse_version(file_ver) > _parse_version(latest):
            latest = file_ver

    update_available = False
    if client_version:
        update_available = _parse_version(client_version) < _parse_version(latest)

    download_url = ""
    if installer:
        download_url = "/api/server/download_update"
    elif Config.UPDATE_DOWNLOAD_URL:
        download_url = Config.UPDATE_DOWNLOAD_URL

    return jsonify({
        "latest_version": latest,
        "your_version": client_version or "unbekannt",
        "update_available": update_available,
        "download_url": download_url,
        "installer_available": bool(installer),
        "installer_name": installer.name if installer else "",
    })

def _version_from_filename(name):
    """Zieht eine Versionsnummer wie '0.2.0' aus einem Dateinamen."""
    import re
    m = re.search(r"(\d+\.\d+\.\d+)", name)
    return m.group(1) if m else ""

def _find_installer():
    """Sucht im updates/-Ordner nach einer Installer-Datei (.exe/.msi/.dmg).
    Gibt den Pfad der neuesten zurück, oder None."""
    from game_state import _BASE_DIR
    updates_dir = _BASE_DIR / "data" / "updates"
    if not updates_dir.exists():
        return None
    candidates = []
    for ext in ("*.exe", "*.msi", "*.dmg"):
        candidates.extend(updates_dir.glob(ext))
    if not candidates:
        return None
    # Neueste Datei (nach Änderungszeit)
    return max(candidates, key=lambda p: p.stat().st_mtime)

@api_bp.route("/api/server/download_update", methods=["GET"])
def download_update():
    """Liefert die bereitgestellte Installer-Datei zum Herunterladen aus."""
    installer = _find_installer()
    if not installer:
        return jsonify({"error": "Keine Update-Datei verfügbar"}), 404
    return send_from_directory(str(installer.parent), installer.name, as_attachment=True)

@api_bp.route("/api/auth/me", methods=["GET"])
def auth_me():
    u = _current_user()
    if not u: return jsonify({"logged_in":False})
    user = get_user(u)
    if not user:
        flask_session.pop("username", None)
        return jsonify({"logged_in":False})
    public = {k:v for k,v in user.items() if k not in ("password_hash","password_salt")}
    return jsonify({"logged_in":True, "user":public})

@api_bp.route("/api/users", methods=["GET"])
def users_list():
    if not _require_login(): return jsonify({"error":"Nicht angemeldet"}), 401
    return jsonify(list_users())

# ── Sessions / Campaigns ────────────────────────────────────────────────────
@api_bp.route("/api/sessions", methods=["GET","POST"])
def sessions():
    if request.method == "POST":
        g = _owner_guard()
        if g: return g
        user = _require_login()
        if flask_session.get("is_guest"):
            return jsonify({"error":"Gäste können keine Kampagnen erstellen"}), 403
        data = request.get_json(silent=True) or {}
        sid  = uuid.uuid4().hex[:8]
        s = get_session(sid, owner=user)
        s["name"]        = data.get("name", f"Kampagne {sid[:6]}")
        s["gm_password"] = data.get("gm_password","dm1234")
        s["owner"]       = user
        s["visibility"]  = "private"
        mark_dirty()
        return jsonify({"id":sid,"name":s["name"]})
    # GET: nur Sessions zurückgeben, auf die der Nutzer Zugriff hat
    # (eigene, eingeladene, öffentliche) – niemals alle fremden.
    user = _require_login()
    accessible = [s for s in all_sessions() if can_access_session(s, user)]
    return jsonify(accessible)

def _session_preview(s):
    """Vorschau für die Kampagnen-Karten: Bild + Name der aktuellen Karte."""
    try:
        m = active_map(s) if s.get("maps") else None
    except Exception:
        m = None
    return {"cover": (m or {}).get("url") or "", "map_name": (m or {}).get("name", ""),
            "map_count": len(s.get("maps") or {})}

@api_bp.route("/api/sessions/my", methods=["GET"])
def my_sessions():
    user = _require_login()
    if not user: return jsonify([])
    return jsonify([{
        "id":s["id"], "name":s["name"], "visibility":s.get("visibility","private"),
        "invited_count":len(s.get("invited_users",[])), "dm_online":is_dm_online(s),
        **_session_preview(s),
    } for s in sessions_owned_by(user)])

@api_bp.route("/api/sessions/joinable", methods=["GET"])
def joinable_sessions():
    user = _require_login()
    if not user: return jsonify([])
    seen=set(); out=[]
    for s in sessions_invited_to(user):
        if s["id"] in seen: continue
        seen.add(s["id"])
        out.append({"id":s["id"],"name":s["name"],"owner":s.get("owner",""),
                    "visibility":s.get("visibility","private"),"dm_online":is_dm_online(s),
                    "invited":True,"joinable":is_dm_online(s), **_session_preview(s)})
    for s in public_sessions():
        if s["id"] in seen or s.get("owner")==user: continue
        seen.add(s["id"])
        dm_on = is_dm_online(s)
        out.append({"id":s["id"],"name":s["name"],"owner":s.get("owner",""),
                    "visibility":"public","dm_online":dm_on,
                    "invited":False,"joinable":dm_on, **_session_preview(s)})
    return jsonify(out)

@api_bp.route("/api/session/<sid>")
def session_detail(sid):
    user = _require_login()
    s = get_session(sid)
    # Zugriffsschutz: Adventure-Details nur für Berechtigte
    # (Besitzer, Eingeladene oder öffentliche Sessions).
    if not can_access_session(s, user):
        return jsonify({"error": "Kein Zugriff auf diese Kampagne"}), 403
    return jsonify(session_safe_copy(get_session(sid)))

@api_bp.route("/api/session/<sid>/check_pw", methods=["POST"])
def check_gm_pw(sid):
    data = request.get_json(silent=True) or {}
    s = get_session(sid)
    return jsonify({"ok": data.get("pw","") == s["gm_password"]})

@api_bp.route("/api/session/<sid>/check_player_pw", methods=["POST"])
def check_player_pw(sid):
    data = request.get_json(silent=True) or {}
    s = get_session(sid)
    needed = s.get("player_password","")
    if not needed: return jsonify({"ok":True})
    return jsonify({"ok": data.get("pw","")==needed})

@api_bp.route("/api/session/<sid>/settings", methods=["POST"])
def update_session_settings(sid):
    user = _require_login()
    if not user: return jsonify({"error":"Bitte anmelden"}), 401
    s = get_session(sid)
    if s.get("owner") != user: return jsonify({"error":"Nicht berechtigt"}), 403
    data = request.get_json(silent=True) or {}
    for key in ("name","gm_password","player_password","visibility"):
        if key in data: s[key] = data[key]
    mark_dirty()
    return jsonify({"ok":True})

@api_bp.route("/api/session/<sid>/invite", methods=["POST"])
def invite_player(sid):
    user = _require_login()
    if not user: return jsonify({"error":"Bitte anmelden"}), 401
    s = get_session(sid)
    if s.get("owner") != user: return jsonify({"error":"Nicht berechtigt"}), 403
    data = request.get_json(silent=True) or {}
    target = (data.get("username") or "").strip()
    if not target or not get_user(target):
        return jsonify({"error":"Benutzer existiert nicht"}), 400
    inv = s.setdefault("invited_users", [])
    if target not in inv:
        inv.append(target); mark_dirty()
    return jsonify({"ok":True, "invited_users":inv})

@api_bp.route("/api/session/<sid>/uninvite", methods=["POST"])
def uninvite_player(sid):
    user = _require_login()
    if not user: return jsonify({"error":"Bitte anmelden"}), 401
    s = get_session(sid)
    if s.get("owner") != user: return jsonify({"error":"Nicht berechtigt"}), 403
    data = request.get_json(silent=True) or {}
    target = (data.get("username") or "").strip()
    if target in s.get("invited_users", []):
        s["invited_users"].remove(target); mark_dirty()
    return jsonify({"ok":True})

@api_bp.route("/api/session/<sid>/delete", methods=["POST"])
def delete_session(sid):
    g = _owner_guard()
    if g: return g
    user = _require_login()
    if not user: return jsonify({"error":"Bitte anmelden"}), 401
    s = get_session(sid)
    if s.get("owner") != user: return jsonify({"error":"Nicht berechtigt"}), 403
    _sessions.pop(sid, None); mark_dirty()
    return jsonify({"ok":True})

@api_bp.route("/api/session/<sid>/clone", methods=["POST"])
def clone_session(sid):
    g = _owner_guard()
    if g: return g
    import copy as _copy
    user = _require_login()
    if not user: return jsonify({"error":"Bitte anmelden"}), 401
    src = get_session(sid)
    if src.get("owner") != user: return jsonify({"error":"Nicht berechtigt"}), 403
    data = request.get_json(silent=True) or {}
    new_sid = new_id()
    # Tiefe Kopie ohne Live-Zustände
    clone = _copy.deepcopy({k:v for k,v in src.items() if k not in ("users",)})
    clone["id"] = new_sid
    clone["name"] = data.get("name") or (src.get("name","Kampagne") + " (Kopie)")
    clone["owner"] = user
    clone["visibility"] = "private"
    clone["users"] = {}
    # Live-Zustände zurücksetzen, Aufbau (Maps/Wände/Gegner/Journal) behalten
    clone["chat"] = []
    clone["roster"] = {}
    clone["initiative"] = []
    clone["current_turn_index"] = 0
    clone["approved_chars"] = {}
    clone["pending_char_changes"] = []
    clone["invited_users"] = list(src.get("invited_users", []))
    # Tokens behalten, aber Owner-Bindungen lösen (Spieler treten neu bei)
    for t in clone.get("tokens", {}).values():
        t["owner"] = ""
        t["owner_char_id"] = ""
    _sessions[new_sid] = clone
    mark_dirty()
    return jsonify({"ok":True, "id":new_sid, "name":clone["name"]})

# ── Characters ───────────────────────────────────────────────────────────────
@api_bp.route("/api/characters", methods=["GET"])
def list_characters():
    user = _require_login()
    if not user: return jsonify([])
    return jsonify(list(get_all_characters(owner=user).values()))

@api_bp.route("/api/characters", methods=["POST"])
def create_or_update_character():
    user = _require_login()
    if not user: return jsonify({"error":"Bitte anmelden"}), 401
    data = request.get_json(silent=True) or {}
    if data.get("id"):
        existing = get_character(data["id"])
        if existing and existing.get("owner") and existing.get("owner") != user:
            return jsonify({"error":"Nicht dein Charakter"}), 403
    packs.annotate_character(data)      # merken, aus welchen Paketen Rasse/Klasse … stammen
    return jsonify(save_character(data, owner=user))

@api_bp.route("/api/characters/<cid>", methods=["DELETE"])
def del_character(cid):
    user = _require_login()
    if not user: return jsonify({"error":"Bitte anmelden"}), 401
    ok = delete_character(cid, owner=user)
    return jsonify({"deleted":ok})

@api_bp.route("/api/characters/<cid>", methods=["GET"])
def get_char(cid):
    user = _require_login()
    if not user:
        return jsonify({"error": "Bitte anmelden"}), 401
    c = get_character(cid)
    if not c:
        return jsonify({"error": "not found"}), 404
    # Zugriffsschutz: Nur der Besitzer darf seinen Charakter direkt abrufen.
    if c.get("owner") and c.get("owner") != user:
        return jsonify({"error": "Nicht dein Charakter"}), 403
    return jsonify(c)

# ── Persönliches Profil (für den Launcher) ───────────────────────────────────
# Würfel-Sets und Designs leben im Browser-Speicher – und der ist an die
# Server-ADRESSE gebunden. Damit ein Spieler sie beim DM dabeihat, spiegeln
# die Seiten der eigenen Installation sie hierher; der Launcher holt sie ab
# und gibt sie beim Beitreten mit (siehe theme.js → Handover).
PROFILE_KEYS = ("vtt_theme_ui", "vtt_theme_table", "vtt_dice_sets", "vtt_dice3d",
                "vtt_dice_sound", "vtt_dice_volume", "vtt_hidden_designs", "vtt_designs", "vtt_fx")

def _profile_path():
    from game_state import _BASE_DIR
    return _BASE_DIR / "data" / "profile.json"

def _read_profile():
    import json as _json
    try:
        return _json.loads(_profile_path().read_text(encoding="utf-8"))
    except Exception:
        return {"keys": {}, "updated": 0}

@api_bp.route("/api/profile", methods=["GET", "PUT"])
def profile():
    from config import Config
    if getattr(Config, "OWNER_ONLY", False) and not _is_local_request():
        return jsonify({"error": "Nur am eigenen PC"}), 403
    if request.method == "PUT":
        if not _app_header():
            return jsonify({"error": "Nur aus der App"}), 403
        import json as _json, time as _time
        d = request.get_json(silent=True) or {}
        keys = {k: str(v)[:400_000] for k, v in (d.get("keys") or {}).items() if k in PROFILE_KEYS and v is not None}
        prof = {"keys": keys, "updated": _time.time()}
        p = _profile_path(); p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_suffix(".tmp"); tmp.write_text(_json.dumps(prof, ensure_ascii=False), encoding="utf-8"); tmp.replace(p)
        return jsonify({"ok": True, "updated": prof["updated"]})
    return jsonify(_read_profile())

@api_bp.route("/api/profile/bundle", methods=["GET"])
def profile_bundle():
    """Alles, was ein Spieler zum DM mitnimmt: Profil + seine Charaktere
    (als .vttchar-Inhalt). Nur am eigenen PC abrufbar."""
    from config import Config
    import copy as _copy
    if getattr(Config, "OWNER_ONLY", False) and not _is_local_request():
        return jsonify({"error": "Nur am eigenen PC"}), 403
    chars = []
    for c in get_all_characters().values():
        ch = packs.annotate_character(_copy.deepcopy(c))
        portrait = _portrait_data_url(ch.get("pic_url"))
        if portrait and len(portrait) > 120_000:   # zu groß für die Übergabe
            portrait = None
        chars.append({"vttchar": 1, "character": ch, "portrait": portrait})
    return jsonify({"profile": _read_profile(), "characters": chars, "version": APP_VERSION})


# ── Charakter mitbringen ─────────────────────────────────────────────────────
# Jeder baut seine Charaktere in der EIGENEN Installation. Zum Mitspielen
# exportiert er sie als .vttchar-Datei; die Kampagne des DM prüft beim
# Hereinholen, ob alle benötigten Inhalte dort vorhanden und freigegeben sind.

def _portrait_data_url(url):
    """Lokales Porträt als data:-URL einbetten (damit die Datei vollständig ist)."""
    import base64, mimetypes
    if not url or not str(url).startswith("/uploads/"):
        return None
    path = (UPLOAD_ROOT / str(url)[len("/uploads/"):]).resolve()
    if UPLOAD_ROOT.resolve() not in path.parents or not path.is_file() or path.stat().st_size > 4_000_000:
        return None
    mime = mimetypes.guess_type(path.name)[0] or "image/png"
    return f"data:{mime};base64," + base64.b64encode(path.read_bytes()).decode()

@api_bp.route("/api/characters/<cid>/export", methods=["GET"])
def export_character(cid):
    user = _require_login()
    if not user: return jsonify({"error": "Bitte anmelden"}), 401
    c = get_character(cid)
    if not c or (c.get("owner") and c.get("owner") != user):
        return jsonify({"error": "Nicht dein Charakter"}), 404
    import json as _json, copy as _copy
    ch = packs.annotate_character(_copy.deepcopy(c))
    payload = {"vttchar": 1, "character": ch, "portrait": _portrait_data_url(ch.get("pic_url"))}
    from werkzeug.utils import secure_filename
    fname = (secure_filename(ch.get("name") or "") or "charakter") + ".vttchar"
    return Response(_json.dumps(payload, ensure_ascii=False), mimetype="application/json",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})

def _check_response(result, s):
    """Fehlermeldung für fehlende Inhalte, nach Paketen gruppiert."""
    return jsonify({"error": "In dieser Kampagne fehlen Inhalte, die dein Charakter braucht.",
                    "missing": result["missing"], "campaign": s.get("name", "")}), 409

@api_bp.route("/api/sessions/<sid>/check_character", methods=["POST"])
def check_character_for_session(sid):
    """Vor dem Beitreten mit einem vorhandenen Charakter prüfen."""
    from game_state import _sessions
    user = _require_login()
    if not user: return jsonify({"error": "Bitte anmelden"}), 401
    s = _sessions.get(sid)
    if not s: return jsonify({"error": "Kampagne nicht gefunden"}), 404
    c = get_character((request.get_json(silent=True) or {}).get("char_id", ""))
    if not c or (c.get("owner") and c.get("owner") != user):
        return jsonify({"error": "Charakter nicht gefunden"}), 404
    r = packs.check_character(c, s)
    return jsonify({"ok": True}) if r["ok"] else _check_response(r, s)

@api_bp.route("/api/sessions/<sid>/import_character", methods=["POST"])
def import_character_into_session(sid):
    """.vttchar-Datei hochladen → prüfen → als eigener Charakter des Spielers
    auf diesem Server anlegen."""
    import json as _json, base64, re as _re
    from game_state import _sessions
    user = _require_login()
    if not user: return jsonify({"error": "Bitte anmelden"}), 401
    s = _sessions.get(sid)
    if not s: return jsonify({"error": "Kampagne nicht gefunden"}), 404
    f = request.files.get("file")
    if not f: return jsonify({"error": "Keine Datei ausgewählt"}), 400
    raw = f.read(8_000_001)
    if len(raw) > 8_000_000: return jsonify({"error": "Die Datei ist zu groß"}), 400
    try:
        data = _json.loads(raw.decode("utf-8"))
        ch = data["character"]
        assert isinstance(ch, dict) and data.get("vttchar")
    except Exception:
        return jsonify({"error": "Das ist keine gültige Charakter-Datei (.vttchar)"}), 400
    r = packs.check_character(ch, s)
    if not r["ok"]:
        return _check_response(r, s)
    # Als neuer Charakter dieses Spielers anlegen (fremde Ids nie übernehmen)
    ch = dict(ch)
    ch["id"] = new_id()
    ch["imported_from"] = ch.get("owner", "")
    ch.pop("owner", None)
    ch["pic_url"] = ""
    m = _re.match(r"^data:(image/(png|jpeg|webp|gif));base64,(.+)$", str(data.get("portrait") or ""), _re.S)
    if m:
        try:
            img = base64.b64decode(m.group(3), validate=True)
            ext = {"png": "png", "jpeg": "jpg", "webp": "webp", "gif": "gif"}[m.group(2)]
            d = UPLOAD_ROOT / "characters"; d.mkdir(parents=True, exist_ok=True)
            name = f"{uuid.uuid4().hex[:8]}_portrait.{ext}"
            (d / name).write_bytes(img)
            ch["pic_url"] = f"/uploads/characters/{name}"
        except Exception:
            pass
    saved = save_character(ch, owner=user)
    return jsonify({"ok": True, "char_id": saved["id"], "name": saved.get("name", "")})


# ── Library (items, spells, attacks) ────────────────────────────────────────
@api_bp.route("/api/library", methods=["GET"])
def library_list():
    """Ohne Parameter: ALLE Einträge (für die Bibliotheks-Verwaltung).
    ?session=<id>: nur, was in dieser Kampagne erlaubt ist (Builder, Spieltisch).
    ?active=1:     nur Einträge aktiver Pakete."""
    sid = request.args.get("session")
    if sid:
        from game_state import _sessions
        return jsonify(packs.filtered_library(_sessions.get(sid)))
    if request.args.get("active"):
        return jsonify(packs.filtered_library(None))
    return jsonify(get_library())


# ── Inhaltspakete (.vttpack) – Logik in packs.py ──────────────────────────
def _pack_error(e, code=400):
    return jsonify({"error": str(e)}), code

@api_bp.route("/api/packs", methods=["GET"])
def packs_list():
    return jsonify(packs.list_packs())

@api_bp.route("/api/packs/<pid>/contents", methods=["GET"])
def packs_contents(pid):
    """Übersicht für den Launcher: nur Namen + kurze Beschreibung je Kategorie,
    keine Regeldetails."""
    from game_state import get_library
    out = {}
    for cat, entries in get_library().items():
        items = [{"name": e.get("name", ""), "description": str(e.get("description") or "")[:160],
                  "parent": e.get("parent_class_name", "")}
                 for e in entries.values() if (e.get("source") or "eigene") == pid]
        if items:
            out[cat] = sorted(items, key=lambda x: x["name"].lower())
    return jsonify(out)


@api_bp.route("/api/packs/<pid>/enabled", methods=["POST"])
def packs_enable(pid):
    g = _owner_guard()
    if g: return g
    if not _require_login(): return _pack_error("Bitte anmelden", 401)
    data = request.get_json(silent=True) or {}
    try:
        return jsonify(packs.set_enabled(pid, bool(data.get("enabled", True))))
    except packs.PackError as e:
        return _pack_error(e, 404)

@api_bp.route("/api/packs/<pid>", methods=["DELETE"])
def packs_remove(pid):
    g = _owner_guard()
    if g: return g
    if not _require_login(): return _pack_error("Bitte anmelden", 401)
    try:
        return jsonify({"removed_entries": packs.remove(pid)})
    except packs.PackError as e:
        return _pack_error(e)

@api_bp.route("/api/packs/export", methods=["POST"])
def packs_export():
    # Exportieren = Teilen: angemeldete Spieler ODER der Launcher am eigenen PC
    if not (_require_login() or (_is_local_request() and _app_header())):
        return _pack_error("Bitte anmelden", 401)
    d = request.get_json(silent=True) or {}
    # Paket-Ids tragen den Ersteller („thomas.sternenpfad"), damit zwei
    # gleich benannte Pakete verschiedener Spieler sich nicht überschreiben.
    user = _current_user() or ""
    raw_id = str(d.get("id") or d.get("name") or "").strip()
    if raw_id and "." not in raw_id and user:
        raw_id = f"{user.lower()}.{raw_id}"
    try:
        pid, blob = packs.export_pack(
            pack_id=raw_id, name=d.get("name"), version=d.get("version"),
            author=d.get("author") or _current_user(), description=d.get("description"),
            sources=d.get("sources") or None, entry_ids=d.get("entries") or None,
            dice_sets=d.get("dice_sets") or None)
    except packs.PackError as e:
        return _pack_error(e)
    from flask import Response
    fname = f"{pid}.vttpack"
    return Response(blob, mimetype="application/zip",
                    headers={"Content-Disposition": f'attachment; filename="{fname}"'})

def _uploaded_pack():
    f = request.files.get("file")
    if not f:
        raise packs.PackError("Keine Datei ausgewählt")
    return f.read(packs.MAX_PACK_BYTES + 1)

@api_bp.route("/api/packs/preview", methods=["POST"])
def packs_preview():
    g = _owner_guard()
    if g: return g
    if not _require_login(): return _pack_error("Bitte anmelden", 401)
    try:
        return jsonify(packs.preview(_uploaded_pack()))
    except packs.PackError as e:
        return _pack_error(e)

@api_bp.route("/api/packs/import", methods=["POST"])
def packs_import():
    g = _owner_guard()
    if g: return g
    user = _require_login()
    if not user: return _pack_error("Bitte anmelden", 401)
    try:
        return jsonify(packs.import_pack(_uploaded_pack(), installed_by=user))
    except packs.PackError as e:
        return _pack_error(e)

@api_bp.route("/api/sessions/<sid>/packs", methods=["GET", "PUT"])
def session_packs(sid):
    """Welche Pakete in dieser Kampagne erlaubt sind. Ändern darf nur der DM."""
    from game_state import _sessions
    s = _sessions.get(sid)
    if not s: return _pack_error("Kampagne nicht gefunden", 404)
    if request.method == "PUT":
        g = _owner_guard()
        if g: return g
        user = _require_login()
        if not user or (s.get("owner") and s.get("owner") != user):
            return _pack_error("Nur der DM darf das ändern", 403)
        d = request.get_json(silent=True) or {}
        allowed = d.get("packs")
        s["packs"] = None if allowed is None else [str(x) for x in allowed][:200]
        mark_dirty()
    return jsonify({"packs": s.get("packs"), "all": packs.list_packs()})

def _norm_traits(text):
    """Convert legacy newline-string traits → list of {id,name,description} objects."""
    if isinstance(text, list): return text
    if not text: return []
    result = []
    for i, line in enumerate(str(text).split("\n")):
        line = line.strip()
        if not line: continue
        # "Name: description" -> split; else name=first 30 chars
        if ":" in line:
            name, desc = line.split(":", 1)
            result.append({"id":f"t{i}", "name":name.strip(), "description":desc.strip(), "choices":[]})
        else:
            result.append({"id":f"t{i}", "name":line[:40], "description":line, "choices":[]})
    return result

def _norm_level_features(lf):
    """Convert {"1":"text", "2":"text"} → {"1":[{id,name,description,choices}], ...}"""
    if not lf: return {}
    result = {}
    for lvl, val in lf.items():
        if isinstance(val, list):
            result[str(lvl)] = val
        elif isinstance(val, str):
            # Split on period+space or newlines for multi-feature levels
            features = []
            for i, piece in enumerate(val.split("\n") if "\n" in val else [val]):
                piece = piece.strip()
                if not piece: continue
                if ":" in piece:
                    n, d = piece.split(":", 1)
                    features.append({"id":f"f{lvl}_{i}","name":n.strip(),"description":d.strip(),"choices":[]})
                else:
                    features.append({"id":f"f{lvl}_{i}","name":piece[:40],"description":piece,"choices":[]})
            result[str(lvl)] = features
    return result

@api_bp.route("/api/library/seed_defaults", methods=["POST"])
def seed_defaults():
    """Seed the library with default D&D 5e content if empty categories exist."""
    g = _owner_guard()
    if g: return g
    lib = get_library()
    added = False
    if not lib.get("races"):
        for r in _DEFAULT_RACES:
            entry = dict(r)
            entry["traits"] = _norm_traits(entry.get("traits",""))
            entry["source"] = "basis"; save_library_entry("races", entry)
        added = True
    if not lib.get("classes"):
        for c in _DEFAULT_CLASSES:
            entry = dict(c)
            entry["level_features"] = _norm_level_features(entry.get("level_features",{}))
            entry["source"] = "basis"; save_library_entry("classes", entry)
        added = True
    if not lib.get("subclasses"):
        for s in _DEFAULT_SUBCLASSES:
            entry = dict(s)
            entry["level_features"] = _norm_level_features(entry.get("level_features",{}))
            entry["source"] = "basis"; save_library_entry("subclasses", entry)
        added = True
    if not lib.get("feats"):
        for f in _DEFAULT_FEATS:
            save_library_entry("feats", {**f, "source": "basis"})
        added = True
    if not lib.get("backgrounds"):
        for b in _DEFAULT_BACKGROUNDS:
            save_library_entry("backgrounds", {**b, "source": "basis"})
        added = True
    if not lib.get("conditions"):
        for c in _DEFAULT_CONDITIONS:
            save_library_entry("conditions", {**c, "source": "basis"})
        added = True
    return jsonify({"seeded": added, "library": get_library()})

@api_bp.route("/api/library/<category>", methods=["POST"])
def library_save(category):
    g = _owner_guard()
    if g: return g
    if category not in LIBRARY_CATEGORIES:
        return jsonify({"error":"bad category"}), 400
    user = _require_login()
    if not user:
        return jsonify({"error": "Bitte anmelden"}), 401
    data = request.get_json(silent=True) or {}
    return jsonify(save_library_entry(category, data, owner=user))

@api_bp.route("/api/library/<category>/<eid>", methods=["DELETE"])
def library_delete(category, eid):
    g = _owner_guard()
    if g: return g
    user = _require_login()
    if not user:
        return jsonify({"error": "Bitte anmelden"}), 401
    ok = delete_library_entry(category, eid, requester=user)
    if not ok:
        return jsonify({"error": "Nicht löschbar (fremder Eintrag oder nicht gefunden)"}), 403
    return jsonify({"deleted": True})


# ── Default D&D 5e races, classes, subclasses ─────────────────────────────────
_DEFAULT_RACES = [
    {"name":"Mensch","size":"Mittel","speed":30,"darkvision":0,"asi":"+1 auf alle Werte","languages":"Gemeinsprache, +1 weitere","traits":"Vielseitig: Menschen sind anpassungsfähig und ehrgeizig.\nZusätzliche Sprache.\nZusätzliche Fertigkeit (Standard-Regeln) oder ein Talent (Variant-Regel).","description":"Die vielseitigste und am weitesten verbreitete Rasse."},
    {"name":"Elf","size":"Mittel","speed":30,"darkvision":60,"asi":"+2 GES","languages":"Gemeinsprache, Elfisch","traits":"Dunkelsicht 60 ft.\nScharfe Sinne: Geübtheit in Wahrnehmung.\nElfische Ahnenreihe: Fae Ahnen, Vorteil gegen Bezaubern.\nTrance: 4 Stunden Trance statt 8 Stunden Schlaf.","description":"Anmutige, langlebige Wesen mit starker Verbindung zur Natur und Magie."},
    {"name":"Zwerg","size":"Mittel","speed":25,"darkvision":60,"asi":"+2 KON","languages":"Gemeinsprache, Zwergisch","traits":"Dunkelsicht 60 ft.\nZwergen-Resilienz: Vorteil gegen Gift, Resistenz gegen Giftschaden.\nZwergische Kampfkunst: Geübtheit in Kriegsaxt, Handaxt, leichtem Hammer, Kriegshammer.\nSteinkundig: Doppelter Übungsbonus auf Geschichte-Proben bezüglich Stein.","description":"Robuste, ehrenhafte Krieger und Handwerker."},
    {"name":"Halbling","size":"Klein","speed":25,"darkvision":0,"asi":"+2 GES","languages":"Gemeinsprache, Halblingisch","traits":"Glück: 1 würfelt neu.\nTapfer: Vorteil gegen Furcht.\nHalblings-Agilität: Durch Felder größerer Kreaturen bewegen.","description":"Fröhliche, neugierige Kleinvölker mit Sinn für das Gute im Leben."},
    {"name":"Drachenblut","size":"Mittel","speed":30,"darkvision":0,"asi":"+2 STR, +1 CHA","languages":"Gemeinsprache, Drakonisch","traits":"Drachen-Abstammung: Wähle einen Drachentyp (Feuer, Kälte, Blitz, Säure, Gift).\nAtem-Waffe: 2W6 Schaden gemäß Drachentyp (Rettungswurf).\nResistenz: gegen den zugehörigen Schadenstyp.","description":"Stolze Nachfahren der großen Drachen."},
    {"name":"Gnom","size":"Klein","speed":25,"darkvision":60,"asi":"+2 INT","languages":"Gemeinsprache, Gnomisch","traits":"Dunkelsicht 60 ft.\nGnomische List: Vorteil auf INT-, WEI- und CHA-Rettungswürfe gegen Magie.","description":"Kleine, kluge Tüftler und Illusionisten."},
    {"name":"Halb-Elf","size":"Mittel","speed":30,"darkvision":60,"asi":"+2 CHA, +1 auf zwei andere","languages":"Gemeinsprache, Elfisch, +1 weitere","traits":"Dunkelsicht 60 ft.\nFae Ahnen: Vorteil gegen Bezaubern.\nVielseitig: Geübtheit in 2 Fertigkeiten deiner Wahl.","description":"Zwischen zwei Welten zuhause, charismatisch und vielseitig."},
    {"name":"Halb-Ork","size":"Mittel","speed":30,"darkvision":60,"asi":"+2 STR, +1 KON","languages":"Gemeinsprache, Orkisch","traits":"Dunkelsicht 60 ft.\nMenacing: Geübtheit in Einschüchtern.\nUnnachgiebige Ausdauer: Bei HP=0 stattdessen auf 1 HP (1×/lange Rast).\nWilde Angriffe: Bei krit. Treffer zusätzlicher Schadenswürfel.","description":"Stark, ausdauernd, oft zwischen Welten stehend."},
    {"name":"Tiefling","size":"Mittel","speed":30,"darkvision":60,"asi":"+2 CHA, +1 INT","languages":"Gemeinsprache, Infernal","traits":"Dunkelsicht 60 ft.\nHöllische Resistenz: Resistenz gegen Feuerschaden.\nInfernale Vererbung: Thaumaturgie-Zaubertrick. Stufe 3: Höllischer Tadel. Stufe 5: Finsternis.","description":"Nachfahren mit dämonischem Blut, faszinierend und oft missverstanden."},
]

_DEFAULT_CLASSES = [
    {"name":"Barbar","hd":"d12","primary":"str","spellcaster":False,"armor":"Leichte & mittlere Rüstung, Schilde","weapons":"Einfache & Kriegswaffen","tools":"—","saves":"STR, KON","skill_count":2,"skill_options":"Athletik, Einschüchtern, Naturkunde, Tierführung, Wahrnehmung, Überleben","description":"Ein wilder Krieger, angetrieben von primitiver Wut.","level_features":{"1":"Wut: 2/Tag, +2 Schaden, Resistenz Hieb/Stich/Wucht.\nUngerüstete Verteidigung: RK = 10 + GES-Mod + KON-Mod","2":"Rücksichtsloser Angriff: Vorteil auf STR-Angriffe, Angreifer haben Vorteil gegen dich.\nGefahrensinn: Vorteil auf GES-RW gegen sichtbare Effekte.","3":"Primärer Pfad (Unterklasse wählen)","4":"Ability Score Improvement","5":"Extraangriff. Schnelle Bewegung (+10 ft).","6":"Pfad-Merkmal","7":"Feral Instinct (Vorteil auf Initiative)","8":"ASI","9":"Brutal Critical (1 Würfel)","10":"Pfad-Merkmal","11":"Relentless Rage","12":"ASI","13":"Brutal Critical (2)","14":"Pfad-Merkmal","15":"Persistent Rage","16":"ASI","17":"Brutal Critical (3)","18":"Indomitable Might","19":"ASI","20":"Primal Champion: STR/KON werden +4 (max 24)"}},
    {"name":"Barde","hd":"d8","primary":"cha","spellcaster":True,"armor":"Leichte Rüstung","weapons":"Einfache Waffen, Hand-Armbrüste, Langschwerter, Rapiere, Kurzschwerter","tools":"3 Musikinstrumente","saves":"GES, CHA","skill_count":3,"skill_options":"*","description":"Magischer Geschichtenerzähler, inspiriert Verbündete und verzaubert Feinde.","level_features":{"1":"Bardische Inspiration (W6).\nZauber wirken (CHA).","2":"Jack of All Trades (halber Übungsbonus auf ungeübte Proben).\nLied der Ruhe.","3":"Bardenkolleg (Unterklasse). Experte (2 Fertigkeiten).","4":"ASI","5":"Bardische Inspiration (W8). Font of Inspiration.","6":"Kolleg-Merkmal. Counter-Charm.","7":"—","8":"ASI","9":"Lied der Ruhe (stärker). Bardische Inspiration (W8).","10":"Experte (2 mehr). Magische Geheimnisse.","11":"—","12":"ASI","13":"—","14":"Kolleg-Merkmal. Magische Geheimnisse.","15":"Bardische Inspiration (W12).","16":"ASI","17":"—","18":"Magische Geheimnisse.","19":"ASI","20":"Superior Inspiration"}},
    {"name":"Kleriker","hd":"d8","primary":"wis","spellcaster":True,"armor":"Leichte & mittlere Rüstung, Schilde","weapons":"Einfache Waffen","tools":"—","saves":"WEI, CHA","skill_count":2,"skill_options":"Geschichte, Einsicht, Heilkunde, Überzeugung, Religion","description":"Diener einer Gottheit, mit göttlichen Zaubern.","level_features":{"1":"Zauber wirken (WEI). Göttliche Domäne (Unterklasse).","2":"Channel Divinity: Turn Undead (1/Rast).","3":"—","4":"ASI","5":"Untote zerstören (HG 1/2).","6":"Channel Divinity (2/Rast). Domänen-Merkmal.","7":"—","8":"ASI. Untote zerstören (HG 1). Domänen-Merkmal.","9":"—","10":"Divine Intervention","11":"Untote zerstören (HG 2)","12":"ASI","13":"—","14":"Untote zerstören (HG 3)","15":"—","16":"ASI","17":"Untote zerstören (HG 4). Domänen-Merkmal.","18":"Channel Divinity (3/Rast)","19":"ASI","20":"Divine Intervention Improvement"}},
    {"name":"Druide","hd":"d8","primary":"wis","spellcaster":True,"armor":"Leichte & mittlere Rüstung (keine Metall), Schilde (keine Metall)","weapons":"Keulen, Dolche, Wurfpfeile, Wurfspieße, Keulen, Sichel, Speer, Quarterstaff, Scimitar","tools":"Kräuterkunde","saves":"INT, WEI","skill_count":2,"skill_options":"Arkana, Tierführung, Einsicht, Heilkunde, Naturkunde, Wahrnehmung, Religion, Überleben","description":"Hüter der Natur mit wilder Magie und Formwandlung.","level_features":{"1":"Druidic (Sprache). Zauber wirken (WEI).","2":"Wildgestalt. Druidenkreis (Unterklasse).","3":"—","4":"ASI. Wildgestalt-Verbesserung (Schwimmen).","5":"—","6":"Kreis-Merkmal","7":"—","8":"ASI. Wildgestalt (Fliegen).","9":"—","10":"Kreis-Merkmal","11":"—","12":"ASI","13":"—","14":"Kreis-Merkmal","15":"—","16":"ASI","17":"—","18":"Zeitlos. 1000 Formen.","19":"ASI","20":"Erzdruide (unbegrenzte Wildgestalt)"}},
    {"name":"Kämpfer","hd":"d10","primary":"str","spellcaster":False,"armor":"Alle Rüstungen, Schilde","weapons":"Alle Waffen","tools":"—","saves":"STR, KON","skill_count":2,"skill_options":"Akrobatik, Tierführung, Athletik, Geschichte, Einsicht, Einschüchtern, Wahrnehmung, Überleben","description":"Meisterlicher Krieger mit vielseitigen Kampftechniken.","level_features":{"1":"Fighting Style. Second Wind (1W10+Level HP heilen).","2":"Action Surge (1 extra Aktion).","3":"Martial Archetype (Unterklasse).","4":"ASI","5":"Extraangriff (2).","6":"ASI","7":"Archetyp-Merkmal","8":"ASI","9":"Indomitable (RW neu würfeln, 1×/Tag).","10":"Archetyp-Merkmal","11":"Extraangriff (3).","12":"ASI","13":"Indomitable (2/Tag)","14":"ASI","15":"Archetyp-Merkmal","16":"ASI","17":"Action Surge (2). Indomitable (3).","18":"Archetyp-Merkmal","19":"ASI","20":"Extraangriff (4)"}},
    {"name":"Mönch","hd":"d8","primary":"dex","spellcaster":False,"armor":"Keine","weapons":"Einfache Waffen, Kurzschwerter","tools":"1 Handwerker oder Musikinstrument","saves":"STR, GES","skill_count":2,"skill_options":"Akrobatik, Athletik, Geschichte, Einsicht, Religion, Heimlichkeit","description":"Disziplinierter Krieger mit übernatürlicher Körperbeherrschung.","level_features":{"1":"Ungerüstete Verteidigung (10+GES+WEI). Kampfkünste.","2":"Ki (2 Punkte). Schnelle Bewegung (+10 ft).","3":"Monastische Tradition (Unterklasse). Deflect Missiles.","4":"ASI. Slow Fall.","5":"Extraangriff. Stunning Strike.","6":"Ki-gestärkte Schläge. Tradition-Merkmal.","7":"Evasion. Stillness of Mind.","8":"ASI","9":"Unhindered Movement","10":"Purity of Body","11":"Tradition-Merkmal","12":"ASI","13":"Tongue of the Sun and Moon","14":"Diamond Soul","15":"Timeless Body","16":"ASI","17":"Tradition-Merkmal","18":"Empty Body","19":"ASI","20":"Perfect Self (4 Ki-Punkte bei Initiative)"}},
    {"name":"Paladin","hd":"d10","primary":"str","spellcaster":True,"armor":"Alle Rüstungen, Schilde","weapons":"Einfache & Kriegswaffen","tools":"—","saves":"WEI, CHA","skill_count":2,"skill_options":"Athletik, Einsicht, Einschüchtern, Heilkunde, Überzeugung, Religion","description":"Heiliger Krieger, geschworen auf einen Eid.","level_features":{"1":"Divine Sense. Handauflegen (5×Level HP).","2":"Zauber wirken (CHA). Fighting Style. Divine Smite.","3":"Heiliger Eid (Unterklasse). Divine Health.","4":"ASI","5":"Extraangriff","6":"Aura of Protection (+CHA auf RW)","7":"Eid-Merkmal","8":"ASI","9":"—","10":"Aura of Courage (immun gegen Furcht)","11":"Improved Divine Smite (+1W8)","12":"ASI","13":"—","14":"Cleansing Touch","15":"Eid-Merkmal","16":"ASI","17":"—","18":"Aura-Reichweite 30 ft","19":"ASI","20":"Eid-Ultimat"}},
    {"name":"Waldläufer","hd":"d10","primary":"dex","spellcaster":True,"armor":"Leichte & mittlere Rüstung, Schilde","weapons":"Einfache & Kriegswaffen","tools":"—","saves":"STR, GES","skill_count":3,"skill_options":"Tierführung, Athletik, Einsicht, Ermitteln, Naturkunde, Wahrnehmung, Heimlichkeit, Überleben","description":"Jäger der Wildnis mit Spur- und Kampfkünsten.","level_features":{"1":"Favored Enemy. Natural Explorer.","2":"Fighting Style. Zauber wirken (WEI).","3":"Ranger Conclave (Unterklasse). Primeval Awareness.","4":"ASI","5":"Extraangriff","6":"—","7":"Conclave-Merkmal","8":"ASI. Land's Stride.","9":"—","10":"Hide in Plain Sight","11":"Conclave-Merkmal","12":"ASI","13":"—","14":"Vanish","15":"Conclave-Merkmal","16":"ASI","17":"—","18":"Feral Senses","19":"ASI","20":"Foe Slayer"}},
    {"name":"Schurke","hd":"d8","primary":"dex","spellcaster":False,"armor":"Leichte Rüstung","weapons":"Einfache Waffen, Hand-Armbrüste, Langschwerter, Rapiere, Kurzschwerter","tools":"Diebeswerkzeug","saves":"GES, INT","skill_count":4,"skill_options":"Akrobatik, Athletik, Täuschung, Einsicht, Einschüchtern, Ermitteln, Wahrnehmung, Auftreten, Überzeugung, Fingerfertigkeit, Heimlichkeit","description":"Schleicher und Hinterhält-Angreifer mit vielen Fähigkeiten.","level_features":{"1":"Expertise (2). Heimtückischer Angriff (1W6). Thieves' Cant.","2":"Cunning Action (Bonus-Aktion: Dash/Disengage/Hide).","3":"Roguish Archetype (Unterklasse). Heimtücke (2W6).","4":"ASI","5":"Uncanny Dodge. Heimtücke (3W6).","6":"Expertise (2 mehr).","7":"Evasion. Heimtücke (4W6).","8":"ASI","9":"Archetyp-Merkmal. Heimtücke (5W6).","10":"ASI","11":"Reliable Talent. Heimtücke (6W6).","12":"ASI","13":"Archetyp-Merkmal. Heimtücke (7W6).","14":"Blindsense","15":"Slippery Mind. Heimtücke (8W6).","16":"ASI","17":"Archetyp-Merkmal. Heimtücke (9W6).","18":"Elusive","19":"ASI. Heimtücke (10W6).","20":"Stroke of Luck"}},
    {"name":"Hexenmeister","hd":"d6","primary":"cha","spellcaster":True,"armor":"Keine","weapons":"Dolche, Wurfpfeile, Schleudern, Kampfstäbe, leichte Armbrüste","tools":"—","saves":"KON, CHA","skill_count":2,"skill_options":"Arkana, Täuschung, Einsicht, Einschüchtern, Überzeugung, Religion","description":"Angeborene Magie aus dem Blut, spontan und chaotisch.","level_features":{"1":"Zauber wirken (CHA). Sorcerous Origin (Unterklasse).","2":"Font of Magic: Sorcery Points (2).","3":"Metamagic (2 Optionen).","4":"ASI","5":"—","6":"Origin-Merkmal","7":"—","8":"ASI","9":"—","10":"Metamagic (1 mehr). Origin-Merkmal.","11":"—","12":"ASI","13":"—","14":"Origin-Merkmal","15":"—","16":"ASI","17":"Metamagic (1 mehr)","18":"Origin-Merkmal","19":"ASI","20":"Sorcerous Restoration"}},
    {"name":"Hexer","hd":"d8","primary":"cha","spellcaster":True,"armor":"Leichte Rüstung","weapons":"Einfache Waffen","tools":"—","saves":"WEI, CHA","skill_count":2,"skill_options":"Arkana, Täuschung, Geschichte, Einschüchtern, Ermitteln, Naturkunde, Religion","description":"Gepeiligter Schüler eines mächtigen Paktwesens.","level_features":{"1":"Otherworldly Patron (Unterklasse). Pact Magic.","2":"Eldritch Invocations (2).","3":"Pact Boon.","4":"ASI","5":"—","6":"Patron-Merkmal","7":"—","8":"ASI","9":"—","10":"Patron-Merkmal","11":"Mystic Arcanum (6. Stufe)","12":"ASI","13":"Mystic Arcanum (7. Stufe)","14":"Patron-Merkmal","15":"Mystic Arcanum (8. Stufe)","16":"ASI","17":"Mystic Arcanum (9. Stufe)","18":"—","19":"ASI","20":"Eldritch Master"}},
    {"name":"Magier","hd":"d6","primary":"int","spellcaster":True,"armor":"Keine","weapons":"Dolche, Wurfpfeile, Schleudern, Kampfstäbe, leichte Armbrüste","tools":"—","saves":"INT, WEI","skill_count":2,"skill_options":"Arkana, Geschichte, Einsicht, Ermitteln, Heilkunde, Religion","description":"Gelehrter der arkanen Magie mit einem Zauberbuch.","level_features":{"1":"Zauber wirken (INT). Arkane Erholung.","2":"Arkane Tradition (Unterklasse).","3":"—","4":"ASI","5":"—","6":"Tradition-Merkmal","7":"—","8":"ASI","9":"—","10":"Tradition-Merkmal","11":"—","12":"ASI","13":"—","14":"Tradition-Merkmal","15":"—","16":"ASI","17":"—","18":"Zauber-Meisterschaft","19":"ASI","20":"Signature Spells"}},
]

_DEFAULT_SUBCLASSES = [  # nur SRD 5.1 (CC-BY-4.0) – alles andere als privates Paket
    {"name": "Pfad des Berserkers", "parent_class_name": "Barbar", "start_level": 3, "description": "Rohe, zerstörerische Raserei.", "level_features": {"3": "Frenzy: Raserei gewährt Bonus-Aktion Angriff, aber danach 1 Erschöpfungs-Stufe.", "6": "Mindless Rage: Immun gegen Bezaubern & Furcht in Raserei.", "10": "Intimidating Presence: Bonus-Aktion: 1 Kreatur WEI-RW oder verängstigt.", "14": "Retaliation: Reaktion auf Treffer: Nahkampfangriff als Gegenangriff."}},
    {"name": "College of Lore", "parent_class_name": "Barde", "start_level": 3, "description": "Akademische Barden voller Wissen.", "level_features": {"3": "Bonus Proficiencies (3 Fertigkeiten). Cutting Words.", "6": "Additional Magical Secrets.", "14": "Peerless Skill."}},
    {"name": "Leben-Domäne", "parent_class_name": "Kleriker", "start_level": 1, "description": "Kleriker der Heilung und des Lebens.", "level_features": {"1": "Disciple of Life (Heilzauber +2+Zauberstufe HP). Bonus-Zauber.", "2": "Channel Divinity: Preserve Life (5×Level HP verteilen).", "6": "Blessed Healer.", "8": "Divine Strike (+1W8 strahlend).", "17": "Supreme Healing (Heilzauber max. Würfel)."}},
    {"name": "Champion", "parent_class_name": "Kämpfer", "start_level": 3, "description": "Meister der physischen Perfektion.", "level_features": {"3": "Improved Critical (19-20).", "7": "Remarkable Athlete.", "10": "Additional Fighting Style.", "15": "Superior Critical (18-20).", "18": "Survivor (regeneriert 5+KON HP pro Runde wenn unter Hälfte HP)."}},
    {"name": "Dieb", "parent_class_name": "Schurke", "start_level": 3, "description": "Meisterdieb mit akrobatischen Fähigkeiten.", "level_features": {"3": "Fast Hands. Second-Story Work.", "9": "Supreme Sneak.", "13": "Use Magic Device.", "17": "Thief's Reflexes."}},
    {"name": "Hervorrufung", "parent_class_name": "Magier", "start_level": 2, "description": "Meister der zerstörerischen Magie.", "level_features": {"2": "Evocation Savant. Sculpt Spells.", "6": "Potent Cantrip.", "10": "Empowered Evocation.", "14": "Overchannel."}},
    {"name": "Zirkel des Landes", "parent_class_name": "Druide", "start_level": 2, "description": "Hüter alter Naturorte; die Magie ist an eine bestimmte Landschaft gebunden.", "level_features": {"2": [{"id": "f2_0", "name": "Zusätzlicher Zaubertrick", "description": "Ein weiterer Druiden-Zaubertrick deiner Wahl.", "choices": []}, {"id": "f2_1", "name": "Natürliche Erholung", "description": "Einmal pro langer Rast während einer kurzen Rast Zauberplätze zurückgewinnen: Gesamtgrad bis zur halben Druidenstufe (aufgerundet), keiner ab Grad 6.", "choices": []}], "3": [{"id": "f3_0", "name": "Zirkelzauber", "description": "Landschaft wählen (Arktis, Küste, Wüste, Wald, Grasland, Gebirge, Sumpf, Unterreich). Auf Stufe 3, 5, 7 und 9 kommen je zwei immer vorbereitete Zauber dieser Landschaft hinzu.", "choices": []}], "6": [{"id": "f6_0", "name": "Schritt des Landes", "description": "Nichtmagisches schwieriges Gelände kostet keine zusätzliche Bewegung; nichtmagische Pflanzen behindern oder verletzen dich nicht. Vorteil auf Rettungswürfe gegen magisch erschaffene, behindernde Pflanzen.", "choices": []}], "10": [{"id": "f10_0", "name": "Schutz der Natur", "description": "Elementare und Feenwesen können dich nicht bezaubern oder verängstigen. Immun gegen Gift und Krankheiten.", "choices": []}], "14": [{"id": "f14_0", "name": "Zuflucht der Natur", "description": "Tiere und Pflanzen, die dich angreifen wollen, müssen einen WEI-Rettungswurf schaffen, sonst müssen sie ein anderes Ziel wählen.", "choices": []}]}},
    {"name": "Weg der offenen Hand", "parent_class_name": "Mönch", "start_level": 3, "description": "Meister des waffenlosen Kampfes, die Gegner mit gezielten Schlägen aus dem Gleichgewicht bringen.", "level_features": {"3": [{"id": "f3_0", "name": "Technik der offenen Hand", "description": "Trifft ein Angriff aus dem Schlaghagel, wähle: GES-Rettungswurf oder liegend; STR-Rettungswurf oder 15 ft weggestoßen; oder bis Ende deines nächsten Zuges keine Reaktionen.", "choices": []}], "6": [{"id": "f6_0", "name": "Ganzheit des Körpers", "description": "Als Aktion TP in Höhe der dreifachen Mönchsstufe zurückgewinnen. Einmal pro langer Rast.", "choices": []}], "11": [{"id": "f11_0", "name": "Gelassenheit", "description": "Am Ende einer langen Rast erhältst du bis zur nächsten langen Rast die Wirkung von Heiligtum (SG 8 + WEI + Übungsbonus).", "choices": []}], "17": [{"id": "f17_0", "name": "Bebende Handfläche", "description": "3 Ki nach einem waffenlosen Treffer: unmerkliche Schwingungen für Tage = Mönchsstufe. Als Aktion beenden: KON-Rettungswurf, bei Misserfolg 0 TP, bei Erfolg 10W10 nekrotischer Schaden.", "choices": []}]}},
    {"name": "Schwur der Hingabe", "parent_class_name": "Paladin", "start_level": 3, "description": "Das Ideal des edlen Ritters: Ehrlichkeit, Mut, Mitgefühl, Ehre und Pflicht.", "level_features": {"3": [{"id": "f3_0", "name": "Schwurzauber", "description": "Immer vorbereitet – Stufe 3: Schutz vor Gut und Böse, Heiligtum; 5: Geringere Wiederherstellung, Zone der Wahrheit; 9: Leuchtfeuer der Hoffnung, Magie bannen; 13: Bewegungsfreiheit, Wächter des Glaubens; 17: Göttliche Verbindung, Flammenschlag.", "choices": []}, {"id": "f3_1", "name": "Göttliche Macht: Geheiligte Waffe", "description": "Aktion: 1 Minute CHA-Modifikator auf Angriffswürfe mit einer Waffe; sie leuchtet und gilt als magisch.", "choices": []}, {"id": "f3_2", "name": "Göttliche Macht: Unheiliges vertreiben", "description": "Aktion: Unholde und Untote in 30 ft machen einen WEI-Rettungswurf, bei Misserfolg 1 Minute vertrieben.", "choices": []}], "7": [{"id": "f7_0", "name": "Aura der Hingabe", "description": "Du und Verbündete in 10 ft (ab Stufe 18: 30 ft) können nicht bezaubert werden, solange du bei Bewusstsein bist.", "choices": []}], "15": [{"id": "f15_0", "name": "Reinheit des Geistes", "description": "Du stehst dauerhaft unter der Wirkung von Schutz vor Gut und Böse.", "choices": []}], "20": [{"id": "f20_0", "name": "Heiliger Nimbus", "description": "Aktion, 1 Minute: helles Licht 30 ft; Feinde, die ihren Zug darin beginnen, erleiden 10 gleißenden Schaden; Vorteil auf Rettungswürfe gegen Zauber von Unholden und Untoten. Einmal pro langer Rast.", "choices": []}]}},
    {"name": "Jäger", "parent_class_name": "Waldläufer", "start_level": 3, "description": "Bollwerk zwischen der Zivilisation und den Schrecken der Wildnis.", "level_features": {"3": [{"id": "f3_0", "name": "Beute des Jägers", "description": "Eine Option: Kolossbezwinger (einmal pro Zug +1W8 gegen ein verletztes Ziel), Riesentöter (Reaktionsangriff, wenn dich eine große oder größere Kreatur in 5 ft angreift) oder Hordenbrecher (einmal pro Zug ein zusätzlicher Angriff gegen eine andere Kreatur neben dem Ziel).", "choices": []}], "7": [{"id": "f7_0", "name": "Verteidigungstaktik", "description": "Eine Option: Der Horde entkommen (Gelegenheitsangriffe gegen dich mit Nachteil), Verteidigung gegen Mehrfachangriffe (+4 RK gegen weitere Angriffe derselben Kreatur in diesem Zug) oder Stählerner Wille (Vorteil gegen Verängstigung).", "choices": []}], "11": [{"id": "f11_0", "name": "Mehrfachangriff", "description": "Eine Option: Salve (Fernkampfangriff gegen beliebig viele Kreaturen in 10 ft um einen Punkt) oder Wirbelangriff (Nahkampfangriff gegen jede Kreatur in 5 ft).", "choices": []}], "15": [{"id": "f15_0", "name": "Überlegene Jägerverteidigung", "description": "Eine Option: Entrinnen, Gegen den Strom (verfehlt dich ein Nahkampfangriff, als Reaktion denselben Angriff gegen eine andere Kreatur richten) oder Unheimliches Ausweichen (Schaden eines sichtbaren Angreifers halbieren).", "choices": []}]}},
    {"name": "Drakonische Blutlinie", "parent_class_name": "Hexenmeister", "start_level": 1, "description": "Die Magie stammt von einem Drachen unter deinen Vorfahren.", "level_features": {"1": [{"id": "f1_0", "name": "Drachenahn", "description": "Drachenart wählen – sie bestimmt die Schadensart. Du sprichst Drakonisch; doppelter Übungsbonus auf CHA-Proben im Umgang mit Drachen.", "choices": []}, {"id": "f1_1", "name": "Drakonische Widerstandskraft", "description": "+1 TP-Maximum pro Stufe dieser Klasse. Ohne Rüstung RK 13 + GES.", "choices": []}], "6": [{"id": "f6_0", "name": "Elementare Affinität", "description": "CHA-Modifikator auf einen Schadenswurf von Zaubern deiner Schadensart. Für 1 Zauberpunkt 1 Stunde Resistenz gegen diese Schadensart.", "choices": []}], "14": [{"id": "f14_0", "name": "Drachenschwingen", "description": "Bonusaktion: Flügel, Fluggeschwindigkeit = Geschwindigkeit (nicht in normaler Rüstung).", "choices": []}], "18": [{"id": "f18_0", "name": "Drakonische Präsenz", "description": "Aktion und 5 Zauberpunkte: 1 Minute (Konzentration) Aura von 60 ft – Feinde machen einen WEI-Rettungswurf oder sind bezaubert bzw. verängstigt (deine Wahl).", "choices": []}]}},
    {"name": "Der Unhold", "parent_class_name": "Hexer", "start_level": 1, "description": "Ein Pakt mit einem Wesen der unteren Ebenen.", "level_features": {"1": [{"id": "f1_0", "name": "Erweiterte Zauberliste", "description": "Zusätzlich wählbar – Grad 1: Brennende Hände, Befehl; 2: Blindheit/Taubheit, Sengender Strahl; 3: Feuerball, Stinkende Wolke; 4: Feuerschild, Feuerwand; 5: Flammenschlag, Weihen.", "choices": []}, {"id": "f1_1", "name": "Segen des Dunklen", "description": "Sinkt ein feindliches Wesen durch dich auf 0 TP: temporäre TP = CHA-Modifikator + Hexerstufe (mindestens 1).", "choices": []}], "6": [{"id": "f6_0", "name": "Glück des Dunklen", "description": "Einen W10 zu einem Attributs- oder Rettungswurf addieren. Einmal pro kurzer oder langer Rast.", "choices": []}], "10": [{"id": "f10_0", "name": "Unholdische Widerstandskraft", "description": "Nach jeder Rast eine Schadensart wählen: Resistenz dagegen (nicht gegen magische oder versilberte Waffen).", "choices": []}], "14": [{"id": "f14_0", "name": "Durch die Hölle schleudern", "description": "Nach einem Treffer: Ziel bis zum Ende deines nächsten Zuges durch die unteren Ebenen geschleudert; Nicht-Unholde erleiden 10W10 psychischen Schaden. Einmal pro langer Rast.", "choices": []}]}},
]

# ── Feats ─────────────────────────────────────────────────────────────────
_DEFAULT_FEATS = [  # nur SRD 5.1 (CC-BY-4.0) – alles andere als privates Paket
    {"name": "Ringer", "prereq": "STR 13", "description": "Geübt im Nahkampf auf engstem Raum.", "benefits": "Vorteil auf Angriffswürfe gegen eine Kreatur, die du gepackt hältst.\nAls Aktion versuchen, eine gepackte Kreatur festzusetzen (erneuter Ringkampfwurf); bei Erfolg seid ihr beide festgesetzt, bis der Griff endet."},
]

# ── Backgrounds ───────────────────────────────────────────────────────────
_DEFAULT_BACKGROUNDS = [  # nur SRD 5.1 (CC-BY-4.0) – alles andere als privates Paket
    {"name": "Akolyth", "skill_profs": "Einsicht, Religion", "languages": "2 beliebige", "tool_profs": "", "equipment": "Heiliges Symbol, Gebetbuch, 5 Räucherstäbchen, Gewand, Alltagskleidung, 15 gp", "feature": "Zuflucht der Gläubigen: Heiler Tempel gewähren dir und deinen Gefährten kostenlose Pflege.", "description": "Du hast dein Leben dem Dienst an einer Gottheit gewidmet."},
]

# ── Conditions (Status-Effekte) ───────────────────────────────────────────
_DEFAULT_CONDITIONS = [
    {"name":"Blind","description":"Kann nichts sehen. Automatischer Fehlschlag bei Sicht-Proben. Nachteil bei Angriffswürfen; Angriffe gegen ihn haben Vorteil."},
    {"name":"Bezaubert","description":"Kann den Bezauberer nicht angreifen. Bezauberer hat Vorteil auf soziale Interaktionen."},
    {"name":"Taub","description":"Kann nichts hören. Automatischer Fehlschlag bei Hör-Proben."},
    {"name":"Erschöpft","description":"6 Stufen. Stufe 1: Nachteil auf Proben. 2: Geschwindigkeit halbiert. 3: Nachteil auf Angriffe und Rettungswürfe. 4: HP-Max halbiert. 5: Geschwindigkeit 0. 6: Tod."},
    {"name":"Verängstigt","description":"Nachteil auf Angriffe und Proben bei Sichtkontakt zur Quelle. Kann sich ihr nicht freiwillig nähern."},
    {"name":"Gepackt","description":"Geschwindigkeit 0. Endet wenn Angreifer handlungsunfähig oder durch Bewegung aus Reichweite."},
    {"name":"Handlungsunfähig","description":"Kann keine Aktionen oder Reaktionen ausführen."},
    {"name":"Unsichtbar","description":"Nicht ohne Magie/Spezialfähigkeit sichtbar. Angriffe gegen ihn mit Nachteil, seine Angriffe mit Vorteil."},
    {"name":"Gelähmt","description":"Handlungsunfähig, kann nicht sprechen oder bewegen. Automatischer Fehlschlag STR- und DEX-Rettungswürfe. Angriffe mit Vorteil; Treffer innerhalb 5 ft sind kritisch."},
    {"name":"Versteinert","description":"In Stein verwandelt. 10× Gewicht, gealtert kein normalens. Handlungsunfähig, Rüstungsimmun außer Zerschlagen. Resistenz gegen Nicht-Gewaltsam."},
    {"name":"Vergiftet","description":"Nachteil auf Angriffe und Proben."},
    {"name":"Liegend","description":"Kann kriechen oder 5 ft für Aufstehen. Nachteil auf Angriffe. Angriffe auf Entfernung: Nachteil. Angriffe in Nahkampf: Vorteil."},
    {"name":"Zurückgehalten","description":"Geschwindigkeit 0. Angriffe mit Nachteil; Angriffe gegen ihn mit Vorteil. Nachteil auf DEX-Rettungswürfe."},
    {"name":"Betäubt","description":"Handlungsunfähig. Auto-Fehlschlag STR/DEX-Rettungswürfe. Angriffe mit Vorteil."},
    {"name":"Bewusstlos","description":"Handlungsunfähig, kann sich nicht bewegen. Auto-Fehlschlag STR/DEX-Rettungswürfe. Nahkampf: Vorteil; Treffer auf 5ft = Crit."},
]

# ── Uploads ──────────────────────────────────────────────────────────────────
@api_bp.route("/upload/map/<sid>", methods=["POST"])
def upload_map(sid):
    if "file" not in request.files: return jsonify({"error":"no file"}),400
    url = _save_upload("maps", request.files["file"])
    s = get_session(sid)
    active_map(s)["url"] = url; mark_dirty()
    from app import socketio
    socketio.emit("map_updated", {"url":url, "map_id":s["active_map_id"]}, room=sid)
    return jsonify({"url":url})

@api_bp.route("/upload/map_for/<sid>/<map_id>", methods=["POST"])
def upload_map_for(sid, map_id):
    if "file" not in request.files: return jsonify({"error":"no file"}),400
    url = _save_upload("maps", request.files["file"])
    s = get_session(sid)
    if map_id in s.get("maps",{}):
        s["maps"][map_id]["url"] = url
        mark_dirty()
        from app import socketio
        socketio.emit("map_image_changed", {"map_id":map_id, "url":url,
                                            "is_active": map_id == s["active_map_id"]}, room=sid)
    return jsonify({"url":url})

@api_bp.route("/upload/token/<sid>", methods=["POST"])
def upload_token(sid):
    if "file" not in request.files: return jsonify({"error":"no file"}),400
    return jsonify({"url": _save_upload("tokens", request.files["file"])})

@api_bp.route("/upload/enemy/<sid>", methods=["POST"])
def upload_enemy(sid):
    if "file" not in request.files: return jsonify({"error":"no file"}),400
    return jsonify({"url": _save_upload("enemies", request.files["file"])})

@api_bp.route("/upload/character", methods=["POST"])
def upload_character_pic():
    if "file" not in request.files: return jsonify({"error":"no file"}),400
    return jsonify({"url": _save_upload("tokens", request.files["file"])})

@api_bp.route("/uploads/<path:filename>")
def serve_upload(filename):
    return send_from_directory(str(UPLOAD_ROOT), filename)

@api_bp.route("/static/default-avatar.svg")
def default_avatar():
    svg = '''<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
      <defs><radialGradient id="g" cx="50%" cy="40%"><stop offset="0%" stop-color="#3a2540"/><stop offset="100%" stop-color="#120a18"/></radialGradient></defs>
      <rect width="100" height="100" fill="url(#g)"/>
      <circle cx="50" cy="40" r="16" fill="#c9a96e"/>
      <path d="M20 90 Q50 60 80 90 Z" fill="#c9a96e"/></svg>'''
    return Response(svg, mimetype="image/svg+xml")
