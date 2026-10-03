"""routes/sockets.py – all Socket.IO handlers"""
import time, random, math
from flask import request
from flask_socketio import emit, join_room
from game_state import (get_session, session_safe_copy, new_id, active_map,
                        mark_dirty, save_now, _default_enemy, _default_map,
                        get_character)
from dice import roll, animation_dice, new_seed, DiceError

def _require_gm(s):
    """Prüft, ob der Anfragende der DM ist.

    Nebenbei frischen wir seinen "zuletzt gesehen"-Zeitstempel auf. So gilt
    er als anwesend, solange er tatsächlich etwas tut – auch wenn seine
    Socket-Verbindung zwischendurch mal kurz abreißt.
    """
    is_gm = s["users"].get(request.sid, {}).get("role") == "gm"
    if is_gm:
        s["dm_last_seen"] = time.time()
    return is_gm

def _update_roster(s, char, username, socket_id):
    """Add or update a character in the session roster."""
    if not char: return
    cid = char.get("id")
    if not cid: return
    s["roster"][cid] = {
        "char_id": cid,
        "name": char.get("name") or username,
        "pic_url": char.get("pic_url") or "",
        "last_username": username,
        "socket_id": socket_id,
        "character": char,  # full character data snapshot
    }
    mark_dirty()

def _roster_for_players(s):
    """Roster ohne die vollständigen Charakterbögen.

    Der Roster enthält für den DM den kompletten Bogen jedes Spielers
    (Attribute, Angriffe, Inventar). Diese Daten gehen die Mitspieler nichts
    an – sie bekommen nur, was zur Anzeige nötig ist (Name, Bild, wer online
    ist). Der DM erhält weiterhin alles.
    """
    slim = {}
    for cid, r in s.get("roster", {}).items():
        slim[cid] = {k: v for k, v in r.items() if k != "character"}
    return slim

def _emit_roster(s, sid):
    """Schickt den Roster an alle – dem DM vollständig, Spielern gekürzt."""
    slim = _roster_for_players(s)
    for socket_id, u in s.get("users", {}).items():
        payload = s["roster"] if u.get("role") == "gm" else slim
        emit("roster_updated", {"roster": payload}, room=socket_id)

def _journal_for_broadcast(s):
    """Volle Journal-Daten (inkl. GM-Notizen) – nur für GM gedacht."""
    return s.get("journal", [])

def _journal_for_players(s):
    """Gefilterte Journal-Daten für Spieler: nur sichtbare Einträge, ohne GM-Notizen."""
    out = []
    for e in s.get("journal", []):
        if e.get("visible_to_players"):
            out.append({
                "id": e["id"], "title": e.get("title",""),
                "content": e.get("content",""),
                "visible_to_players": True,
                # gm_notes bewusst NICHT enthalten
            })
    return out

def _notes_for_user(s, socket_id):
    """DM sieht alle Notizen; Spieler sieht eigene + geteilte."""
    user = s["users"].get(socket_id, {})
    is_gm = user.get("role")=="gm"
    my_char = user.get("char_id")
    result = []
    for n in s.get("notes", []):
        if is_gm or n.get("shared") or n.get("author_char_id")==my_char:
            result.append(n)
    return result

def register_socket_events(socketio):

    @socketio.on("join")
    def on_join(data):
        sid = data["session_id"]; s = get_session(sid)
        join_room(sid)
        username = data.get("username","?")
        account  = data.get("account_username","") or username
        char_id  = data.get("char_id", "")
        char     = get_character(char_id) if char_id else None
        role     = data.get("role","player")

        # ── Char-change approval (players only) ──
        if role != "gm" and char_id and account:
            approved = s.setdefault("approved_chars", {})
            prev = approved.get(account)
            if prev is None:
                approved[account] = char_id      # first time: auto-approve
                mark_dirty()
            elif prev == char_id:
                pass                             # same char: fine
            else:
                # Different char → ask DM, join with OLD char meanwhile
                pending = s.setdefault("pending_char_changes", [])
                if not any(p.get("username")==account and p.get("new_char_id")==char_id for p in pending):
                    new_c = get_character(char_id) or {}
                    old_c = get_character(prev) or {}
                    req_id = str(int(time.time()*1000))
                    pending.append({
                        "request_id": req_id, "username": account, "display_name": username,
                        "old_char_id": prev, "old_char_name": old_c.get("name","?"),
                        "new_char_id": char_id, "new_char_name": new_c.get("name","?"),
                    })
                    mark_dirty()
                    emit("char_change_request", {
                        "request_id": req_id, "username": account, "display_name": username,
                        "old_char_name": old_c.get("name","?"), "new_char_name": new_c.get("name","?"),
                    }, room=sid)
                emit("char_change_pending", {"message": f"Wechsel zu '{char.get('name','?') if char else '?'}' wartet auf DM-Genehmigung."})
                char_id = prev
                char = get_character(char_id) if char_id else None

        s["users"][request.sid] = {
            "socket_id": request.sid, "name": username, "username": account,
            "role": role, "color": data.get("color","#c9a96e"),
            "char_id": char_id, "character": char,
        }

        # Betritt der DM (Besitzer) die Sitzung, wird sie automatisch für
        # Spieler sichtbar. Sonst müsste er sie jedes Mal von Hand freigeben.
        # Über "Verwalten" kann er sie weiterhin wieder auf privat stellen.
        if role == "gm" and account and s.get("owner") == account:
            if s.get("visibility") != "public":
                s["visibility"] = "public"
            # Merken, dass der DM da ist. Bricht seine Verbindung kurz ab,
            # gilt er trotzdem noch eine Weile als anwesend (siehe is_dm_online).
            s["dm_last_seen"] = time.time()
            mark_dirty()
        if char and role != "gm":
            _update_roster(s, char, username, request.sid)
            # Vorplatzierten Platzhalter-Token übernehmen ODER neuen Token erstellen
            adopted = False
            for tid, t in s["tokens"].items():
                if t.get("placeholder_for_user") and account and t.get("placeholder_for_user") == account:
                    t["owner"] = request.sid
                    t["owner_char_id"] = char_id
                    t["name"] = char.get("name") or username
                    t["url"] = char.get("pic_url") or t.get("url","")
                    t["hp"] = char.get("hp", t.get("hp",20))
                    t["max_hp"] = char.get("max_hp", t.get("max_hp",20))
                    t["ac"] = char.get("ac", t.get("ac",10))
                    t["vision_range"] = char.get("vision_range", t.get("vision_range",0))
                    t["perception"] = char.get("perception", t.get("perception",10))
                    t["passive_perception"] = char.get("passive_perception", 10 + (char.get("perception",10)-10)//2 if False else char.get("passive_perception",10))
                    t["placeholder_for_user"] = ""
                    adopted = True
                    emit("token_updated",{"token_id":tid,"updates":t}, room=sid)
                    break
            # Bestehende Tokens dieses Charakters mit neuer Socket-ID verknüpfen
            # (nach Reconnect), damit der Spieler seine Tokens wieder steuern kann.
            for t in s["tokens"].values():
                if t.get("owner_char_id")==char_id:
                    t["owner"] = request.sid
            # Existiert auf der AKTIVEN Karte schon ein Token für diesen Charakter?
            has_token = adopted or any(
                t.get("owner_char_id")==char_id and t.get("map_id")==s["active_map_id"]
                for t in s["tokens"].values()
            )
            # Kein Token auf dieser Karte → automatisch einen anlegen
            if not has_token:
                tid = new_id()
                pp = char.get("passive_perception") or (10 + (char.get("perception",10)-10)//2)
                new_tok = {
                    "id": tid, "name": char.get("name") or username,
                    "url": char.get("pic_url",""),
                    "x": 150, "y": 150, "size": 50,
                    "hp": char.get("hp",20), "max_hp": char.get("max_hp",20),
                    "ac": char.get("ac",10), "speed": char.get("speed",30),
                    "is_enemy": False, "conditions": [],
                    "owner": request.sid, "owner_char_id": char_id,
                    "map_id": s["active_map_id"],
                    "vision_range": char.get("vision_range",0),
                    "perception": char.get("perception",10),
                    "passive_perception": pp,
                    "perception_mod": 1.0,
                    "light_bright": 0, "light_dim": 0, "darkvision": 0,
                    "vision_override": None,
                    "bars": [], "placeholder_for_user": "",
                    "show_hp_to_players": True, "show_ac_to_players": True,
                    "per_map_positions": {s["active_map_id"]: {"x":150,"y":150,"placed":True}},
                }
                s["tokens"][tid] = new_tok
                emit("token_created", new_tok, room=sid)

        emit("user_joined",{"username":username,"role":role,
                            "users":list(s["users"].values())}, room=sid)
        # Roster an ALLE senden, damit der DM den neuen Spieler sofort sieht
        _emit_roster(s, sid)
        mark_dirty()
        # full_state nur an den beitretenden Client; Journal + Notizen je nach Rolle filtern
        state_copy = session_safe_copy(s)
        if role != "gm":
            state_copy["journal"] = _journal_for_players(s)
            # Charakterbögen der Mitspieler gehen Spieler nichts an.
            state_copy["roster"] = _roster_for_players(s)
        # Notizen: DM sieht alle, Spieler eigene + geteilte
        state_copy["notes"] = _notes_for_user(s, request.sid)
        emit("full_state", state_copy)

    @socketio.on("char_change_approve")
    def on_char_change_approve(data):
        sid = data["session_id"]; s = get_session(sid)
        req = next((p for p in s.get("pending_char_changes",[]) if p.get("request_id")==data.get("request_id")), None)
        if not req: return
        s.setdefault("approved_chars",{})[req["username"]] = req["new_char_id"]
        s["pending_char_changes"].remove(req); mark_dirty()
        emit("char_change_approved", {"username":req["username"],"new_char_id":req["new_char_id"],
                                      "message":"Charakterwechsel genehmigt! Bitte neu laden."}, room=sid)

    @socketio.on("char_change_deny")
    def on_char_change_deny(data):
        sid = data["session_id"]; s = get_session(sid)
        req = next((p for p in s.get("pending_char_changes",[]) if p.get("request_id")==data.get("request_id")), None)
        if not req: return
        s["pending_char_changes"].remove(req); mark_dirty()
        emit("char_change_denied", {"username":req["username"],
                                    "message":"Charakterwechsel abgelehnt."}, room=sid)

    @socketio.on("heartbeat")
    def on_heartbeat(data):
        """Regelmäßiges Lebenszeichen.

        Damit gilt der DM auch dann als anwesend, wenn er gerade nur zuschaut
        und nichts anklickt. Ohne das würde die Sitzung nach kurzer Zeit als
        verwaist gelten, obwohl er noch am Tisch sitzt.
        """
        sid = data.get("session_id")
        if not sid:
            return
        from game_state import _sessions
        s = _sessions.get(sid)
        if not s:
            return
        u = s["users"].get(request.sid)
        if u and u.get("role") == "gm" and u.get("username") == s.get("owner"):
            s["dm_last_seen"] = time.time()

    @socketio.on("disconnect")
    def on_disconnect():
        from game_state import _sessions
        for sid, s in _sessions.items():
            if request.sid in s["users"]:
                u = s["users"].pop(request.sid)
                for r in s["roster"].values():
                    if r.get("socket_id") == request.sid:
                        r["socket_id"] = None
                emit("user_left",{"username":u["name"],
                                  "users":list(s["users"].values())}, room=sid)
                for t in s["tokens"].values():
                    if t.get("owner") == request.sid:
                        t["owner_char_id"] = u.get("char_id","")
                        t["owner"] = ""
                # Der DM hat die Verbindung verloren.
                #
                # Früher wurde die Sitzung hier SOFORT auf privat gesetzt.
                # Das war der Grund für ein hartnäckiges Ärgernis: Ein kurzer
                # Netzwerk-Hänger genügte, und die Sitzung verschwand für alle
                # Spieler – der DM musste sie neu starten, obwohl er nie weg war.
                #
                # Jetzt bleibt sie sichtbar. Ob der DM erreichbar ist, sagt
                # "is_dm_online" anhand des Zeitstempels (mit Kulanzzeit).
                if u.get("role") == "gm" and u.get("username") == s.get("owner"):
                    s["dm_last_seen"] = time.time()
                    emit("dm_disconnected", {}, room=sid)
                mark_dirty()
                emit("token_ownership_changed",{"tokens":s["tokens"]}, room=sid)
                break

    # ── Maps ──────────────────────────────────────────────────────────────
    @socketio.on("map_create")
    def on_map_create(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        mid = new_id()
        m = _default_map(mid, data.get("name","Neue Karte"))
        # Kartengröße aus Feldern (cols/rows) berechnen
        gs = m.get("grid_size", 50)
        cols = data.get("cols"); rows = data.get("rows")
        if cols: m["width"]  = int(cols) * gs
        if rows: m["height"] = int(rows) * gs
        # Karteneinstellungen direkt beim Erstellen übernehmen
        settings = data.get("settings") or {}
        for key in ("grid_color","grid_opacity","grid_type","map_type","darkness","exploration"):
            if key in settings:
                m[key] = settings[key]
        # Optionales Kartenbild direkt setzen
        img = data.get("image_url","")
        if img:
            m["image_url"] = img
        s["maps"][mid] = m
        fid = data.get("folder_id","")
        if fid:
            for f in s.get("map_folders",[]):
                if f["id"]==fid: f.setdefault("map_ids",[]).append(mid)
        mark_dirty()
        emit("maps_updated",{"maps":s["maps"],"active_map_id":s["active_map_id"],
                             "map_folders":s.get("map_folders",[])}, room=sid)

    @socketio.on("map_switch")
    def on_map_switch(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        mid = data["map_id"]
        if mid not in s["maps"]: return
        s["active_map_id"] = mid
        mark_dirty()
        emit("map_switched",{"active_map_id":mid,"map":s["maps"][mid],
                             "tokens":s["tokens"]}, room=sid)

    @socketio.on("map_preview")
    def on_map_preview(data):
        """Öffnet eine Karte NUR beim DM (Vorschau/Bearbeiten), ohne die
        aktive Karte der Session zu ändern. Die Spieler bleiben, wo sie sind."""
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        mid = data["map_id"]
        if mid not in s["maps"]: return
        # Nur an den anfragenden DM zurücksenden (nicht an den Raum)
        emit("map_previewed", {
            "map_id": mid,
            "map": s["maps"][mid],
            "tokens": s["tokens"],
            "active_map_id": s["active_map_id"],   # bleibt unverändert
        })

    @socketio.on("map_delete")
    def on_map_delete(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        mid=data["map_id"]
        if mid==s["active_map_id"] or len(s["maps"])<=1: return
        s["maps"].pop(mid, None)
        for f in s.get("map_folders",[]):
            if mid in f.get("map_ids",[]): f["map_ids"].remove(mid)
        mark_dirty()
        emit("maps_updated",{"maps":s["maps"],"active_map_id":s["active_map_id"],
                             "map_folders":s.get("map_folders",[])}, room=sid)

    @socketio.on("map_rename")
    def on_map_rename(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        mid=data["map_id"]
        if mid in s["maps"]: s["maps"][mid]["name"]=data.get("name","Karte")
        mark_dirty()
        emit("maps_updated",{"maps":s["maps"],"active_map_id":s["active_map_id"],
                             "map_folders":s.get("map_folders",[])}, room=sid)

    @socketio.on("reset_exploration")
    def on_reset_exploration(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        # Broadcast an alle Spieler: Erinnerung für diese Karte löschen
        emit("exploration_reset", {"map_id": data.get("map_id","")}, room=sid)

    # ── Wände (Dynamic Lighting) ──────────────────────────────────────────
    @socketio.on("wall_add")
    def on_wall_add(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        mid = data.get("map_id") or s["active_map_id"]
        m = s["maps"].get(mid)
        if not m: return
        wall = {
            "id": new_id(),
            "x1": data["x1"], "y1": data["y1"], "x2": data["x2"], "y2": data["y2"],
            "type": data.get("type","opaque"),
            "open": False,
        }
        m.setdefault("walls", []).append(wall)
        mark_dirty()
        emit("walls_updated", {"map_id":mid, "walls":m["walls"]}, room=sid)

    @socketio.on("wall_delete")
    def on_wall_delete(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        mid = data.get("map_id") or s["active_map_id"]
        m = s["maps"].get(mid)
        if not m: return
        wid = data.get("wall_id")
        m["walls"] = [w for w in m.get("walls",[]) if w["id"]!=wid]
        mark_dirty()
        emit("walls_updated", {"map_id":mid, "walls":m["walls"]}, room=sid)

    @socketio.on("wall_clear")
    def on_wall_clear(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        mid = data.get("map_id") or s["active_map_id"]
        m = s["maps"].get(mid)
        if not m: return
        m["walls"] = []
        mark_dirty()
        emit("walls_updated", {"map_id":mid, "walls":[]}, room=sid)

    @socketio.on("door_toggle")
    def on_door_toggle(data):
        sid=data["session_id"]; s=get_session(sid)
        mid = data.get("map_id") or s["active_map_id"]
        m = s["maps"].get(mid)
        if not m: return
        wid = data.get("wall_id")
        for w in m.get("walls",[]):
            if w["id"]==wid and w.get("type")=="door":
                w["open"] = not w.get("open", False)
                break
        mark_dirty()
        emit("walls_updated", {"map_id":mid, "walls":m["walls"]}, room=sid)
        emit("door_toggled", {"map_id":mid}, room=sid)

    @socketio.on("weather_set")
    def on_weather_set(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        mid = s["active_map_id"]
        m = s["maps"].get(mid)
        if m is not None:
            m["weather"] = data.get("weather","none")
            mark_dirty()
        emit("weather_updated", {"weather": data.get("weather","none")}, room=sid, include_self=False)

    @socketio.on("preload_maps")
    def on_preload_maps(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        # Alle Spieler anweisen, die Kartenbilder vorzuladen
        emit("preload_maps_request", {}, room=sid, include_self=False)

    @socketio.on("map_image_set")
    def on_map_image_set(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        mid = data.get("map_id") or s["active_map_id"]
        url = data.get("url","")
        m = s["maps"].get(mid)
        if m is not None:
            m["url"] = url
            mark_dirty()
        # Sauber aus dem Socket-Kontext an ALLE (inkl. Absender) broadcasten
        emit("map_image_changed", {"map_id":mid, "url":url,
                                   "is_active": mid==s["active_map_id"]}, room=sid)

    @socketio.on("map_settings")
    def on_map_settings(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        target_id = data.get("map_id") or s["active_map_id"]
        m = s["maps"].get(target_id)
        if not m: return
        m.update(data.get("settings",{}))
        mark_dirty()
        if target_id == s["active_map_id"]:
            emit("map_settings_updated", m, room=sid)
        else:
            emit("maps_updated",{"maps":s["maps"],"active_map_id":s["active_map_id"],
                                 "map_folders":s.get("map_folders",[])}, room=sid)

    @socketio.on("map_folder_create")
    def on_map_folder_create(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        s.setdefault("map_folders",[]).append({
            "id":new_id(), "name":data.get("name","Ordner"),
            "map_ids":[], "parent_id":data.get("parent_id","")
        })
        mark_dirty()
        emit("maps_updated",{"maps":s["maps"],"active_map_id":s["active_map_id"],
                             "map_folders":s["map_folders"]}, room=sid)

    @socketio.on("map_folder_rename")
    def on_map_folder_rename(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        fid=data["folder_id"]; name=data.get("name","")
        for f in s.get("map_folders",[]):
            if f["id"]==fid: f["name"]=name; break
        mark_dirty()
        emit("maps_updated",{"maps":s["maps"],"active_map_id":s["active_map_id"],
                             "map_folders":s.get("map_folders",[])}, room=sid)

    @socketio.on("map_folder_assign")
    def on_map_folder_assign(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        mid=data["map_id"]; fid=data.get("folder_id","")
        for f in s.get("map_folders",[]):
            if mid in f.get("map_ids",[]): f["map_ids"].remove(mid)
        if fid:
            for f in s.get("map_folders",[]):
                if f["id"]==fid: f.setdefault("map_ids",[]).append(mid); break
        mark_dirty()
        emit("maps_updated",{"maps":s["maps"],"active_map_id":s["active_map_id"],
                             "map_folders":s.get("map_folders",[])}, room=sid)

    @socketio.on("map_folder_delete")
    def on_map_folder_delete(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        fid=data["folder_id"]
        # Rekursiv: alle Unterordner-IDs einsammeln
        folders = s.get("map_folders",[])
        to_delete = {fid}
        changed = True
        while changed:
            changed = False
            for f in folders:
                if f.get("parent_id","") in to_delete and f["id"] not in to_delete:
                    to_delete.add(f["id"]); changed = True
        s["map_folders"] = [f for f in folders if f["id"] not in to_delete]
        mark_dirty()
        emit("maps_updated",{"maps":s["maps"],"active_map_id":s["active_map_id"],
                             "map_folders":s.get("map_folders",[])}, room=sid)

    # ── Tokens ────────────────────────────────────────────────────────────
    @socketio.on("token_create")
    def on_token_create(data):
        sid=data["session_id"]; s=get_session(sid)
        # Only GM can create tokens now (for players, GM spawns their token)
        if not _require_gm(s): return
        tid=new_id()
        is_enemy = bool(data.get("is_enemy", False))
        t={
            "id":tid,"name":data.get("name","Token"),"url":data.get("url",""),
            "x":data.get("x",200),"y":data.get("y",200),"size":data.get("size",50),
            "hp":data.get("hp",20),"max_hp":data.get("max_hp",20),"ac":data.get("ac",10),
            "speed":data.get("speed",30),"initiative_bonus":data.get("initiative_bonus",0),
            "vision_range":data.get("vision_range",0),"conditions":[],
            "owner":data.get("owner",""),  # socket_id
            "owner_char_id":data.get("owner_char_id",""),
            "is_enemy":is_enemy,
            "map_id":data.get("map_id") or s["active_map_id"],
            "show_hp_to_players": data.get("show_hp_to_players", not is_enemy),
            "show_ac_to_players": data.get("show_ac_to_players", not is_enemy),
            "bars": data.get("bars", []),
            "perception": data.get("perception", 10),
            "perception_mod": data.get("perception_mod", 1.0),
            "light_bright": data.get("light_bright", 0),
            "light_dim": data.get("light_dim", 0),
            "darkvision": data.get("darkvision", 0),
            "vision_override": data.get("vision_override", None),
            "placeholder_for_user": data.get("placeholder_for_user", ""),
        }
        # Globale Sicht-Einstellung des Charakters übernehmen (falls vorhanden)
        cid = t.get("owner_char_id")
        if cid and cid in s.get("vision_settings", {}):
            vset = s["vision_settings"][cid]
            t["vision_override"] = vset.get("vision_override")
            t["perception_mod"]  = vset.get("perception_mod", 1.0)
        s["tokens"][tid]=t; mark_dirty()
        emit("token_created",t,room=sid)

    @socketio.on("token_move")
    def on_token_move(data):
        sid=data["session_id"]; s=get_session(sid)
        tid=data["token_id"]; t=s["tokens"].get(tid)
        if not t: return
        user=s["users"].get(request.sid,{})
        # GM moves anything; player moves own token (by owner socket OR owner_char_id)
        is_owner = (t.get("owner")==request.sid) or \
                   (user.get("char_id") and t.get("owner_char_id")==user.get("char_id"))
        if user.get("role")!="gm" and not is_owner: return
        t["x"]=data["x"]; t["y"]=data["y"]; mark_dirty()
        emit("token_moved",data,room=sid)

    @socketio.on("vision_set")
    def on_vision_set(data):
        # Setzt Sichtweite/Modifikator GLOBAL für einen Charakter (gilt auf allen Karten).
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        cid = data.get("char_id")
        if not cid: return
        vs = s.setdefault("vision_settings", {})
        entry = vs.setdefault(cid, {"vision_override": None, "perception_mod": 1.0})
        if "vision_override" in data:
            entry["vision_override"] = data["vision_override"]
        if "perception_mod" in data:
            entry["perception_mod"] = data["perception_mod"]
        # Auf ALLE Tokens dieses Charakters (alle Karten) anwenden
        for t in s["tokens"].values():
            if t.get("owner_char_id")==cid:
                t["vision_override"] = entry["vision_override"]
                t["perception_mod"]  = entry["perception_mod"]
                emit("token_updated",{"token_id":t["id"],"updates":t}, room=sid)
        mark_dirty()
        emit("vision_settings_updated", {"char_id":cid, "settings":entry}, room=sid)

    @socketio.on("token_update")
    def on_token_update(data):
        sid=data["session_id"]; s=get_session(sid)
        tid=data["token_id"]
        if tid in s["tokens"]:
            t = s["tokens"][tid]
            t.update(data.get("updates",{}))
            # Auto-death on HP <= 0
            conds = list(t.get("conditions",[]))
            if t.get("hp",0) <= 0 and t.get("max_hp",0) > 0:
                if "dead" not in conds:
                    conds.append("dead"); t["conditions"] = conds
                    data.setdefault("updates",{})["conditions"] = conds
            else:
                if "dead" in conds:
                    conds = [c for c in conds if c != "dead"]
                    t["conditions"] = conds
                    data.setdefault("updates",{})["conditions"] = conds
            # Sync linked initiative entry (if this token is in init)
            for e in s.get("initiative",[]):
                if e.get("token_id") == tid:
                    if "hp" in data.get("updates",{}): e["hp"] = t["hp"]
                    if "max_hp" in data.get("updates",{}): e["max_hp"] = t["max_hp"]
                    if "ac" in data.get("updates",{}): e["ac"] = t["ac"]
                    if "conditions" in data.get("updates",{}): e["conditions"] = t["conditions"]
            mark_dirty()
        emit("token_updated",data,room=sid)
        emit("initiative_updated",s["initiative"],room=sid)

    @socketio.on("token_delete")
    def on_token_delete(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        s["tokens"].pop(data["token_id"],None); mark_dirty()
        emit("token_deleted",{"token_id":data["token_id"]},room=sid)

    # ── Fog ───────────────────────────────────────────────────────────────
    @socketio.on("fog_update")
    def on_fog_update(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        m=active_map(s); fc=set(m["fog_cells"])
        for c in data.get("cells",[]):
            k=f"{c[0]},{c[1]}"
            fc.add(k) if data.get("action")=="add" else fc.discard(k)
        m["fog_cells"]=list(fc); mark_dirty()
        emit("fog_updated",{"action":data.get("action"),"cells":data.get("cells",[])},room=sid)

    @socketio.on("fog_clear_all")
    def on_fog_clear(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        active_map(s)["fog_cells"]=[]; mark_dirty()
        emit("fog_cleared",{},room=sid)

    @socketio.on("fog_cover_all")
    def on_fog_cover(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        m=active_map(s); gs=m["grid_size"]
        w=m["width"]//gs+1; h=m["height"]//gs+1
        m["fog_cells"]=[f"{x},{y}" for x in range(w) for y in range(h)]; mark_dirty()
        emit("fog_covered",{"cells":m["fog_cells"]},room=sid)

    # ── Drawing ───────────────────────────────────────────────────────────
    @socketio.on("draw_stroke")
    def on_draw_stroke(data):
        sid=data["session_id"]; s=get_session(sid)
        user=s["users"].get(request.sid,{})
        if user.get("role")!="gm" and not s["settings"].get("drawing_allowed",True): return
        s["drawing_strokes"].append(data["stroke"]); mark_dirty()
        emit("stroke_drawn",{"stroke":data["stroke"]},room=sid,include_self=False)

    @socketio.on("draw_clear")
    def on_draw_clear(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        s["drawing_strokes"]=[]; mark_dirty()
        emit("drawing_cleared",{},room=sid)

    @socketio.on("drawing_clear")
    def on_drawing_clear(data):
        """Zeichnungen entfernen. scope='all' (nur DM) löscht alle,
        scope='mine' löscht nur die eigenen Striche des Nutzers."""
        sid=data["session_id"]; s=get_session(sid)
        scope=data.get("scope","mine")
        if scope=="all":
            if not _require_gm(s): return
            s["drawing_strokes"]=[]
        else:
            # Nur die eigenen Striche des Nutzers entfernen
            username=data.get("username","")
            user=s["users"].get(request.sid,{})
            # Sicherheit: den Namen aus der Server-Sitzung nehmen, falls vorhanden
            me = user.get("username") or username
            s["drawing_strokes"]=[st for st in s["drawing_strokes"] if st.get("by")!=me]
        mark_dirty()
        # Alle Clients: komplette Strich-Liste neu setzen (einfachste konsistente Lösung)
        emit("drawing_replaced",{"strokes":s["drawing_strokes"]},room=sid)

    @socketio.on("gm_setting")
    def on_gm_setting(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        s["settings"][data["key"]]=data["value"]; mark_dirty()
        emit("settings_updated",s["settings"],room=sid)

    # ── Chat + Dice ───────────────────────────────────────────────────────
    @socketio.on("chat_message")
    def on_chat(data):
        sid=data["session_id"]; s=get_session(sid)
        msg={"id":new_id(),"author":data.get("author","?"),"role":data.get("role","player"),
             "color":data.get("color","#c9a96e"),"text":data.get("text",""),
             "type":data.get("type","chat"),"timestamp":time.time()}
        s["chat"].append(msg); mark_dirty()
        emit("chat_message",msg,room=sid)

    def _finalize_roll(sid, s, data, result):
        """Schreibt einen fertigen Wurf in den Chat, verteilt ihn und führt die
        Wahrnehmungs-/Sichtlogik aus. 'result' ist das dict aus dice.roll()."""
        msg = {"id": new_id(), "author": data.get("roller","?"),
               "role": data.get("role","player"), "color": data.get("color","#c9a96e"),
               "type": "gmroll" if data.get("secret") else "roll",
               "rolls": result, "label": data.get("label",""), "timestamp": time.time()}
        s["chat"].append(msg); mark_dirty()
        emit("chat_message", msg, room=sid)

        # 3D-Nachspielung: alle sehen denselben Wurf (gleiche Zahlen, gleicher
        # Startwert für die Bewegung). Geheime Würfe sieht nur der Werfer rollen.
        anim = animation_dice(result)
        if anim:
            pb = {"msg_id": msg["id"], "dice": anim, "seed": new_seed(),
                  "total": result.get("total"), "formula": result.get("formula", ""),
                  "label": data.get("label", ""), "roller_sid": data.get("_roller_sid", "")}
            emit("dice_playback", pb, room=(data.get("_roller_sid") if data.get("secret") else sid))

        # Wahrnehmungswurf: der natürliche Wurf bestimmt die Sichtweite.
        if data.get("is_perception") and data.get("char_id"):
            nat = None
            for p in result.get("parts", []):
                if p.get("type") == "dice" and p.get("rolls"):
                    nat = p["rolls"][0]
                    break
            if nat is not None:
                # Der Wurf bestimmt die Sichtweite:
                #    1 → praktisch blind (nur das Nächstliegende)
                #   20 → volle Sichtweite
                # Dazwischen linear. Ein kleiner Rest bleibt immer, sonst
                # könnte der Spieler nicht einmal das eigene Feld sehen.
                MIN_SIGHT = 0.05
                mod = round(MIN_SIGHT + (nat - 1) / 19 * (1.0 - MIN_SIGHT), 2)
                _apply_vision_mod(s, sid, data["char_id"], mod)

    def _apply_vision_mod(s, sid, char_id, mod):
        """Setzt den Sicht-Modifikator eines Charakters (aus dem Wahrnehmungs-
        wurf des Spielers) und verteilt ihn an alle Tokens dieses Charakters.
        Nutzt dieselbe Struktur wie 'vision_set' (der manuelle DM-Weg)."""
        vs = s.setdefault("vision_settings", {})
        entry = vs.setdefault(char_id, {"vision_override": None, "perception_mod": 1.0})
        entry["perception_mod"] = mod
        for t in s["tokens"].values():
            if t.get("owner_char_id") == char_id:
                t["perception_mod"] = mod
        mark_dirty()
        emit("vision_settings_updated", {"char_id": char_id, "settings": entry}, room=sid)

    @socketio.on("dice_roll")
    def on_dice_roll(data):
        """Ein Wurf. Der Server würfelt (sicherer Zufall), schreibt das Ergebnis
        in den Chat und verteilt die 3D-Nachspielung an alle."""
        sid = data["session_id"]; s = get_session(sid)
        data["_roller_sid"] = request.sid
        try:
            result = roll(str(data.get("formula", "1d20"))[:120])
        except DiceError as e:
            emit("toast", {"type": "error", "text": f"Würfelformel: {e}"}, room=request.sid)
            return
        _finalize_roll(sid, s, data, result)

    # ══════════════════════════════════════════════════════════════════════
    #  Statuseffekte durch Angriffe
    #
    #  Trifft ein Angriff, der einen Effekt mitbringt (z. B. "Vergiftet"),
    #  bekommt das Ziel diesen Zustand automatisch. Wie lange er hält, ist
    #  am Angriff hinterlegt:
    #
    #    until_my_next_turn_end     – bis der Angreifer seinen nächsten Zug
    #                                 beendet hat (der häufigste Fall)
    #    until_target_next_turn_end – bis das Ziel seinen Zug beendet hat
    #    rounds:N                   – für N Runden
    #    permanent                  – bis ihn jemand entfernt
    #
    #  Damit das automatisch abläuft, merken wir uns bei jedem Effekt, wann
    #  er endet. Bei jedem Zugwechsel wird geprüft, was fällig ist.
    # ══════════════════════════════════════════════════════════════════════

    COND_LABELS = {
        "blinded":"Blind", "charmed":"Bezaubert", "deafened":"Taub",
        "exhausted":"Erschöpft", "frightened":"Verängstigt", "grappled":"Gepackt",
        "incapacitated":"Kampfunfähig", "invisible":"Unsichtbar",
        "paralyzed":"Gelähmt", "petrified":"Versteinert", "poisoned":"Vergiftet",
        "prone":"Liegend", "restrained":"Festgesetzt", "stunned":"Betäubt",
        "unconscious":"Bewusstlos", "dead":"Tot",
    }

    def _init_entry_for_token(s, token_id):
        """Findet den Initiative-Eintrag, der zu einem Token gehört."""
        tok = s["tokens"].get(token_id)
        if not tok:
            return None
        for e in s.get("initiative", []):
            if e.get("token_id") == token_id:
                return e
            # Über den Charakter verknüpft?
            cid = tok.get("owner_char_id")
            if cid and (e.get("owner_char_id") == cid or e.get("char_id") == cid):
                return e
            if e.get("name") == tok.get("name"):
                return e
        return None

    def _apply_effect(s, sid, target_id, effect, duration, source_token_id, source_name):
        """Setzt einen Statuseffekt auf ein Ziel und merkt sich, wann er endet."""
        target = s["tokens"].get(target_id)
        if not target or not effect:
            return

        # Zustand aufs Token setzen
        conds = list(target.get("conditions", []))
        if effect not in conds:
            conds.append(effect)
            target["conditions"] = conds

        # Ablauf merken
        effects = s.setdefault("active_effects", [])
        # Denselben Effekt auf demselben Ziel nicht doppelt führen –
        # ein erneuter Treffer frischt die Dauer auf.
        effects[:] = [e for e in effects
                      if not (e["token_id"] == target_id and e["effect"] == effect)]

        rec = {
            "id": new_id(),
            "token_id": target_id,
            "effect": effect,
            "duration": duration or "permanent",
            "source_token_id": source_token_id,
            "source_name": source_name,
            "rounds_left": None,
        }
        if duration and duration.startswith("rounds:"):
            try:
                rec["rounds_left"] = int(duration.split(":")[1])
            except (ValueError, IndexError):
                rec["rounds_left"] = 1
        effects.append(rec)

        mark_dirty()
        emit("token_updated", {"token_id": target_id,
                               "updates": {"conditions": conds}}, room=sid)

        label = COND_LABELS.get(effect, effect)
        _chat_system(s, sid,
                     f"✨ <b>{target.get('name','Ziel')}</b> ist jetzt "
                     f"<b>{label}</b> ({_duration_text(duration)})", "#9a7fe0")

    def _duration_text(duration):
        if not duration or duration == "permanent":
            return "bis er entfernt wird"
        if duration == "until_my_next_turn_end":
            return "bis zum Ende des nächsten Zuges des Angreifers"
        if duration == "until_target_next_turn_end":
            return "bis zum Ende des eigenen Zuges"
        if duration.startswith("rounds:"):
            n = duration.split(":")[1]
            return f"{n} Runde{'n' if n != '1' else ''}"
        return duration

    def _expire_effects(s, sid, ended_token_id):
        """Wird aufgerufen, wenn jemand seinen Zug BEENDET hat.
        Prüft, welche Effekte dadurch auslaufen."""
        effects = s.get("active_effects", [])
        if not effects:
            return

        removed = []
        keep = []

        for e in effects:
            expired = False

            if e["duration"] == "until_my_next_turn_end":
                # Läuft ab, wenn der VERURSACHER seinen Zug beendet –
                # aber erst beim ZWEITEN Mal (der Zug, in dem er angegriffen
                # hat, zählt nicht mit).
                if e["source_token_id"] == ended_token_id:
                    if e.get("source_turn_seen"):
                        expired = True
                    else:
                        e["source_turn_seen"] = True

            elif e["duration"] == "until_target_next_turn_end":
                # Läuft ab, wenn das ZIEL seinen Zug beendet
                if e["token_id"] == ended_token_id:
                    expired = True

            elif e.get("rounds_left") is not None:
                # Rundenzähler: nur herunterzählen, wenn das Ziel dran war
                if e["token_id"] == ended_token_id:
                    e["rounds_left"] -= 1
                    if e["rounds_left"] <= 0:
                        expired = True

            if expired:
                removed.append(e)
            else:
                keep.append(e)

        if not removed:
            return

        s["active_effects"] = keep

        # Zustände von den Tokens nehmen
        for e in removed:
            tok = s["tokens"].get(e["token_id"])
            if not tok:
                continue
            conds = [c for c in tok.get("conditions", []) if c != e["effect"]]
            tok["conditions"] = conds
            emit("token_updated", {"token_id": e["token_id"],
                                   "updates": {"conditions": conds}}, room=sid)
            label = COND_LABELS.get(e["effect"], e["effect"])
            _chat_system(s, sid,
                         f"⏳ <b>{tok.get('name','?')}</b> ist nicht mehr "
                         f"<b>{label}</b>", "#8a8f9e")
        mark_dirty()

    def _chat_system(s, sid, text, color="#d4b578"):
        msg={"id":new_id(),"author":"⚔️ Kampf","role":"system","color":color,
             "type":"system","text":text,"timestamp":time.time()}
        s["chat"].append(msg); mark_dirty()
        emit("chat_message",msg,room=sid)

    def _chat_system_split(s, sid, dm_text, player_text, color="#d4b578"):
        """Schickt eine Kampf-Nachricht in ZWEI Fassungen:
        - dm_text: die volle Information (nur an den DM)
        - player_text: die gekürzte Fassung (an alle Spieler)
        So sieht der DM immer alle Werte, die Spieler nur das Erlaubte.
        Im gespeicherten Verlauf steht die DM-Fassung (der DM ist der Besitzer)."""
        base = {"id":new_id(),"author":"⚔️ Kampf","role":"system","color":color,
                "type":"system","timestamp":time.time()}
        dm_msg     = dict(base, text=dm_text)
        player_msg = dict(base, text=player_text)
        # Verlauf: volle Fassung speichern (der DM soll sie später noch sehen)
        s["chat"].append(dm_msg); mark_dirty()
        # Gezielt an die jeweiligen Verbindungen senden
        for socket_id, u in s["users"].items():
            if u.get("role")=="gm":
                emit("chat_message", dm_msg, room=socket_id)
            else:
                emit("chat_message", player_msg, room=socket_id)

    @socketio.on("attack_roll")
    def on_attack_roll(data):
        """Verarbeitet einen Angriff eines Spielers auf ein Ziel.
        - Trefferwurf (1d20+Bonus) gegen die AC des Ziels ODER
        - Rettungswurf: das Ziel würfelt automatisch gegen den SG.
        Das Ergebnis wird direkt im Chat angezeigt.
        """
        sid=data["session_id"]; s=get_session(sid)
        attacker_name = data.get("attacker_name","Spieler")
        atk_name      = data.get("attack_name","Angriff")
        target_id     = data.get("target_id")
        target = s["tokens"].get(target_id)
        if not target:
            emit("action_denied",{"message":"Ziel nicht gefunden."})
            return
        target_name = target.get("name","Ziel")

        save_type = data.get("save_type")   # z.B. "Weisheit" – wenn gesetzt: Rettungswurf

        # Ist das ZIEL ein Gegner? Dann dürfen seine Werte (RK) nicht im Klartext
        # im Chat stehen – die Spieler sollen die Werte der Gegner nicht kennen.
        target_is_enemy = bool(target.get("is_enemy", False))
        # Ist der ANGREIFER ein Gegner? Dann sollen dessen Würfe/Boni geheim
        # bleiben können (per DM-Einstellung).
        attacker_is_enemy = bool(data.get("attacker_is_enemy", False))

        # DM-Einstellungen (Standard: Gegner-Würfe verbergen)
        show_enemy_saves     = s["settings"].get("show_enemy_saves", False)
        show_enemy_attacks   = s["settings"].get("show_enemy_attacks", False)
        # Globaler Schalter: RK der Gegner im Chat zeigen (übersteuert den
        # Token-Schalter). Standard: aus – Spieler sollen die RK nicht kennen.
        show_enemy_ac_chat   = s["settings"].get("show_enemy_ac_in_chat", False)

        if save_type:
            # ── Zauber mit Rettungswurf: Ziel würfelt automatisch ──
            dc = int(data.get("save_dc",10))
            save_bonus = int(target.get("save_bonus",0))
            save_result = roll(f"1d20{'+'+str(save_bonus) if save_bonus>=0 else save_bonus}")
            rolled = save_result["total"]
            success = rolled >= dc
            outcome = ("besteht den Rettungswurf ✅" if success
                       else "scheitert am Rettungswurf ❌")
            color = "#4fae6d" if success else "#d64545"

            # DM sieht IMMER alles
            dm_text = (f"✨ <b>{attacker_name}</b> wirkt <b>{atk_name}</b> auf <b>{target_name}</b>. "
                       f"{target_name} würfelt {save_type}-Rettungswurf: <b>{rolled}</b> gegen SG {dc} → {outcome}")
            # Spieler: bei Gegner-Rettungswürfen ggf. die Zahl verbergen
            hide_for_players = target_is_enemy and not show_enemy_saves
            if hide_for_players:
                player_text = (f"✨ <b>{attacker_name}</b> wirkt <b>{atk_name}</b> auf <b>{target_name}</b>. "
                               f"{target_name} → {outcome}")
            else:
                player_text = dm_text
            _chat_system_split(s, sid, dm_text, player_text, color)

            # Bei einem Zauber wirkt der Effekt, wenn das Ziel den
            # Rettungswurf NICHT besteht.
            if not success:
                effect = data.get("effect", "")
                if effect:
                    _apply_effect(
                        s, sid,
                        target_id=target_id,
                        effect=effect,
                        duration=data.get("effect_dur", ""),
                        source_token_id=data.get("attacker_token_id", ""),
                        source_name=attacker_name,
                    )
        else:
            # ── Normaler Angriff: Trefferwurf gegen AC ──
            hit_bonus = int(data.get("hit_bonus",0))
            hit_result = roll(f"1d20{'+'+str(hit_bonus) if hit_bonus>=0 else hit_bonus}")
            rolled = hit_result["total"]
            nat = None
            for p in hit_result.get("parts",[]):
                if p.get("type")=="dice" and p.get("rolls"):
                    nat = p["rolls"][0]; break
            target_ac = int(target.get("ac",10))
            crit = (nat==20)
            crit_miss = (nat==1)
            if crit:
                hit = True; verdict = "KRITISCHER TREFFER! 🎯"
            elif crit_miss:
                hit = False; verdict = "Kritischer Fehlschlag! 💥"
            else:
                hit = rolled >= target_ac
                verdict = "TRIFFT ✅" if hit else "verfehlt ❌"
            color = "#4fae6d" if hit else "#d64545"

            # Darf die RK des Ziels den Spielern gezeigt werden?
            # Steuerung: pro Token über "show_ac_to_players" (Standard: bei
            # Gegnern aus, bei Spielern an). Der globale DM-Schalter
            # "show_enemy_ac_in_chat" kann das für Gegner übersteuern.
            show_target_ac = bool(target.get("show_ac_to_players",
                                             not target_is_enemy))
            if target_is_enemy and show_enemy_ac_chat:
                show_target_ac = True
            ac_suffix = f" gegen RK {target_ac}" if show_target_ac else ""

            # DM sieht IMMER alles (Wurf UND RK)
            dm_text = (f"🗡️ <b>{attacker_name}</b> greift <b>{target_name}</b> mit <b>{atk_name}</b> an: "
                       f"Wurf <b>{rolled}</b> gegen RK {target_ac} → {verdict}")

            # Spieler-Fassung je nach Situation
            if attacker_is_enemy and not show_enemy_attacks:
                # Gegner greift an: sein Wurf bleibt geheim.
                # Die RK des Ziels nur zeigen, wenn dafür freigegeben.
                player_text = (f"🗡️ <b>{attacker_name}</b> greift <b>{target_name}</b> mit <b>{atk_name}</b> an"
                               f"{' (RK '+str(target_ac)+')' if show_target_ac else ''} → {verdict}")
            else:
                # Angreifer-Wurf sichtbar; RK des Ziels nur wenn freigegeben.
                player_text = (f"🗡️ <b>{attacker_name}</b> greift <b>{target_name}</b> mit <b>{atk_name}</b> an: "
                               f"Wurf <b>{rolled}</b>{ac_suffix} → {verdict}")
            _chat_system_split(s, sid, dm_text, player_text, color)

            # Bringt der Angriff einen Statuseffekt mit und hat er getroffen,
            # bekommt das Ziel ihn automatisch (z. B. "Vergiftet").
            if hit:
                effect = data.get("effect", "")
                if effect:
                    _apply_effect(
                        s, sid,
                        target_id=target_id,
                        effect=effect,
                        duration=data.get("effect_dur", ""),
                        source_token_id=data.get("attacker_token_id", ""),
                        source_name=attacker_name,
                    )

    # ── Initiative ────────────────────────────────────────────────────────
    @socketio.on("initiative_add")
    def on_init_add(data):
        sid=data["session_id"]; s=get_session(sid)
        entry={"id":new_id(),"name":data["name"],"init":data["init"],
               "hp":data.get("hp",0),"max_hp":data.get("max_hp",0),
               "ac":data.get("ac",0),"conditions":data.get("conditions",[]),
               "token_id":data.get("token_id"),"is_enemy":data.get("is_enemy",False),
               "owner":data.get("owner",""),
               "owner_char_id":data.get("owner_char_id",""),
               "show_hp_to_players": data.get("show_hp_to_players", not data.get("is_enemy", False)),
               "show_ac_to_players": data.get("show_ac_to_players", not data.get("is_enemy", False))}
        s["initiative"].append(entry)
        s["initiative"].sort(key=lambda e:-e["init"]); mark_dirty()
        emit("initiative_updated",s["initiative"],room=sid)

    @socketio.on("initiative_update")
    def on_init_update(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        eid=data["id"]
        updates = data.get("updates",{})
        for e in s["initiative"]:
            if e["id"]==eid:
                e.update(updates)
                # Auto-death when HP drops to 0
                if "hp" in updates and e.get("max_hp",0) > 0:
                    if e["hp"] <= 0:
                        conds = list(e.get("conditions",[]))
                        if "dead" not in conds:
                            conds.append("dead"); e["conditions"] = conds
                    else:
                        e["conditions"] = [c for c in e.get("conditions",[]) if c != "dead"]
                # Sync back to linked token (über token_id ODER Namen)
                linked_token = None
                if e.get("token_id") and e["token_id"] in s["tokens"]:
                    linked_token = s["tokens"][e["token_id"]]
                else:
                    # Fallback: Token über Namen finden und verknüpfen
                    for tk in s["tokens"].values():
                        if tk.get("name") == e.get("name"):
                            linked_token = tk
                            e["token_id"] = tk["id"]   # Verknüpfung nachtragen
                            break
                if linked_token is not None:
                    t = linked_token
                    for k in ("hp","max_hp","ac","show_hp_to_players","show_ac_to_players"):
                        if k in updates: t[k] = updates[k]
                    if "conditions" in e:
                        t["conditions"] = e["conditions"]
                    emit("token_updated",{"token_id":t["id"],"updates":t}, room=sid)
                break
        mark_dirty()
        emit("initiative_updated",s["initiative"],room=sid)

    @socketio.on("initiative_remove")
    def on_init_remove(data):
        sid=data["session_id"]; s=get_session(sid)
        s["initiative"]=[e for e in s["initiative"] if e["id"]!=data["id"]]; mark_dirty()
        emit("initiative_updated",s["initiative"],room=sid)

    @socketio.on("initiative_clear")
    def on_init_clear(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        s["initiative"]=[]; s["current_turn_index"]=0; mark_dirty()
        emit("initiative_updated",[],room=sid)

    @socketio.on("initiative_next")
    def on_init_next(data):
        sid=data["session_id"]; s=get_session(sid)
        if not s["initiative"]: return
        # Berechtigung: DM darf immer. Ein Spieler nur, wenn er gerade dran ist.
        user = s["users"].get(request.sid)
        is_gm = user and user.get("role")=="gm"
        if not is_gm:
            idx = s.get("current_turn_index",0)
            if 0 <= idx < len(s["initiative"]):
                cur = s["initiative"][idx]
                my_char = user.get("char_id") if user else None
                # Spieler darf nur beenden, wenn der aktuelle Eintrag sein Charakter ist
                cur_char = cur.get("owner_char_id") or cur.get("char_id")
                if not (my_char and cur_char == my_char):
                    emit("action_denied", {"message":"Du bist gerade nicht am Zug."})
                    return
        idx=s.get("current_turn_index",0)

        # Wer hat gerade seinen Zug beendet? Das brauchen wir, um die
        # Statuseffekte ablaufen zu lassen ("bis Ende meines nächsten Zuges").
        ended = s["initiative"][idx] if idx < len(s["initiative"]) else None
        ended_token_id = ended.get("token_id") if ended else None
        if not ended_token_id and ended:
            # Über den Namen/Charakter zum Token finden
            for tid, t in s["tokens"].items():
                cid = ended.get("owner_char_id") or ended.get("char_id")
                if (cid and t.get("owner_char_id") == cid) or t.get("name") == ended.get("name"):
                    ended_token_id = tid
                    break

        idx=(idx+1)%len(s["initiative"]); s["current_turn_index"]=idx; mark_dirty()
        emit("initiative_turn",{"index":idx,"initiative":s["initiative"]},room=sid)

        # Jetzt prüfen, welche Effekte durch das Zugende auslaufen
        if ended_token_id:
            _expire_effects(s, sid, ended_token_id)

    # ── Enemies ───────────────────────────────────────────────────────────
    @socketio.on("enemy_create")
    def on_enemy_create(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        eid=new_id(); e=_default_enemy(eid,data)
        s["enemies"][eid]=e
        fid=e["folder_id"]
        for f in s["enemy_folders"]:
            if f["id"]==fid: f.setdefault("enemy_ids",[]).append(eid); break
        mark_dirty()
        emit("enemies_updated",{"enemies":s["enemies"],"enemy_folders":s["enemy_folders"]},room=sid)

    @socketio.on("enemy_update")
    def on_enemy_update(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        eid=data["enemy_id"]
        if eid in s["enemies"]: s["enemies"][eid].update(data.get("updates",{}))
        mark_dirty()
        emit("enemies_updated",{"enemies":s["enemies"],"enemy_folders":s["enemy_folders"]},room=sid)

    @socketio.on("roster_sheet_update")
    def on_roster_sheet_update(data):
        """Der DM ändert den Charakterbogen eines Spielers (im Inspektor).

        Die Änderung geht sowohl in den Roster der Sitzung als auch in den
        dauerhaft gespeicherten Charakter – sonst wäre sie beim nächsten
        Beitritt des Spielers wieder weg.
        """
        sid = data["session_id"]; s = get_session(sid)
        if not _require_gm(s): return
        cid = data.get("char_id")
        updates = data.get("updates", {})
        if not cid or not isinstance(updates, dict):
            return

        # Nur Felder des Charakterbogens zulassen
        allowed = {
            "stats", "save_profs", "skill_profs", "initiative_bonus",
            "hp", "max_hp", "ac", "speed", "level",
            "attacks", "inventory", "equipment", "money",
            "personality", "ideals", "bonds", "flaws", "backstory",
            "custom_resources", "spell_slots", "vision_range",
        }
        clean = {k: v for k, v in updates.items() if k in allowed}
        if not clean:
            return

        # 1) Im Roster der Sitzung
        entry = s.get("roster", {}).get(cid)
        if entry and isinstance(entry.get("character"), dict):
            entry["character"].update(clean)

        # 2) Im gespeicherten Charakter (damit es dauerhaft bleibt)
        from game_state import _characters
        ch = _characters.get(cid)
        if ch:
            ch.update(clean)

        mark_dirty()
        _emit_roster(s, sid)
        # Der betroffene Spieler soll seinen Bogen neu laden
        for socket_id, u in s.get("users", {}).items():
            if u.get("char_id") == cid:
                emit("sheet_updated", {"char_id": cid, "updates": clean},
                     room=socket_id)

    @socketio.on("enemy_delete")
    def on_enemy_delete(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        eid=data["id"]
        s["enemies"].pop(eid,None)
        for f in s["enemy_folders"]:
            if eid in f.get("enemy_ids",[]): f["enemy_ids"].remove(eid)
        mark_dirty()
        emit("enemies_updated",{"enemies":s["enemies"],"enemy_folders":s["enemy_folders"]},room=sid)

    @socketio.on("enemy_folder_create")
    def on_enemy_folder_create(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        s["enemy_folders"].append({"id":new_id(),"name":data.get("name","Ordner"),"enemy_ids":[]})
        mark_dirty()
        emit("enemies_updated",{"enemies":s["enemies"],"enemy_folders":s["enemy_folders"]},room=sid)

    @socketio.on("enemy_spawn")
    def on_enemy_spawn(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        e=s["enemies"].get(data["enemy_id"])
        if not e: return
        tid=new_id()
        token={"id":tid,"name":e["name"],"url":e.get("url",""),
               "x":data.get("x",300),"y":data.get("y",300),"size":50,
               "hp":e["hp"],"max_hp":e["max_hp"],"ac":e["ac"],"speed":e["speed"],
               "initiative_bonus":e.get("initiative_bonus",0),"vision_range":0,
               "conditions":[],"owner":"","owner_char_id":"","is_enemy":True,
               # Verweis auf den Gegner-Eintrag, damit der DM dessen
               # vollständigen Charakterbogen aufrufen kann.
               "enemy_id":e["id"],
               "map_id":s["active_map_id"],
               "show_hp_to_players":False,"show_ac_to_players":False}
        s["tokens"][tid]=token; mark_dirty()
        emit("token_created",token,room=sid)

    @socketio.on("enemy_add_to_initiative")
    def on_enemy_add_init(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        e=s["enemies"].get(data["enemy_id"])
        if not e: return
        dex_mod=math.floor((e["stats"].get("dex",10)-10)/2)
        init_roll=random.randint(1,20)+dex_mod+e.get("initiative_bonus",0)
        entry={"id":new_id(),"name":e["name"],"init":data.get("init",init_roll),
               "hp":e["hp"],"max_hp":e["max_hp"],"ac":e["ac"],
               "conditions":[],"token_id":None,"is_enemy":True,"owner":"",
               "show_hp_to_players":False,"show_ac_to_players":False}
        s["initiative"].append(entry); s["initiative"].sort(key=lambda x:-x["init"]); mark_dirty()
        emit("initiative_updated",s["initiative"],room=sid)

    # ── Roster / Character management (GM) ────────────────────────────────
    @socketio.on("roster_kick")
    def on_roster_kick(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        cid=data.get("char_id")
        # Remove their token(s) if any
        to_del=[t_id for t_id,t in s["tokens"].items()
                if t.get("owner_char_id")==cid or
                   (t.get("owner") and s["users"].get(t.get("owner"),{}).get("char_id")==cid)]
        for t_id in to_del:
            s["tokens"].pop(t_id,None)
            emit("token_deleted",{"token_id":t_id},room=sid)
        s["roster"].pop(cid,None); mark_dirty()
        # Disconnect user if still live
        for sock_id,u in list(s["users"].items()):
            if u.get("char_id")==cid:
                emit("force_disconnect",{"reason":"kicked by GM"}, room=sock_id)
        _emit_roster(s, sid)

    @socketio.on("roster_spawn_token")
    def on_roster_spawn(data):
        """GM spawns token for a roster character."""
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        cid=data.get("char_id")
        roster_entry=s["roster"].get(cid)
        if not roster_entry: return
        char=roster_entry.get("character",{})
        # Prüfen, ob auf der AKTIVEN Karte schon ein Token für diesen Charakter existiert
        existing=[t for t in s["tokens"].values()
                  if t.get("owner_char_id")==cid and t.get("map_id")==s["active_map_id"]]
        if existing:
            emit("chat_message",{"id":new_id(),"author":"System","role":"system",
                                 "color":"#e87070","text":f"{char.get('name','?')} hat auf dieser Karte bereits einen Token.",
                                 "type":"system","timestamp":time.time()}, room=sid)
            return
        # Find socket_id if user is live
        live_sid=""
        for sock_id,u in s["users"].items():
            if u.get("char_id")==cid: live_sid=sock_id; break
        tid=new_id()
        token={
            "id":tid,"name":char.get("name","?"),
            "url":char.get("pic_url","") or "/static/default-avatar.svg",
            "x":data.get("x",200),"y":data.get("y",200),"size":50,
            "hp":char.get("hp",20),"max_hp":char.get("max_hp",20),
            "ac":char.get("ac",10),"speed":char.get("speed",30),
            "initiative_bonus":char.get("initiative_bonus",0),
            "vision_range":char.get("vision_range",0),"conditions":[],
            "owner":live_sid,"owner_char_id":cid,"is_enemy":False,
            "map_id":s["active_map_id"],
            "show_hp_to_players":True,"show_ac_to_players":True,
        }
        s["tokens"][tid]=token; mark_dirty()
        emit("token_created",token,room=sid)

    @socketio.on("roster_update_char")
    def on_roster_update_char(data):
        """A player updated their character – update roster snapshot and maybe token."""
        sid=data["session_id"]; s=get_session(sid)
        user=s["users"].get(request.sid,{})
        cid=user.get("char_id")
        if not cid: return
        char=data.get("character")
        if not char: return
        # Update roster
        r=s["roster"].get(cid)
        if r:
            r["character"]=char
            r["name"]=char.get("name",r.get("name"))
            r["pic_url"]=char.get("pic_url", r.get("pic_url"))
        else:
            _update_roster(s, char, user.get("name"), request.sid)
        user["character"]=char
        # Also update user's token if exists
        for t in s["tokens"].values():
            if t.get("owner_char_id")==cid:
                t["name"]=char.get("name",t["name"])
                t["max_hp"]=char.get("max_hp",t["max_hp"])
                t["ac"]=char.get("ac",t["ac"])
                t["speed"]=char.get("speed",t["speed"])
                t["initiative_bonus"]=char.get("initiative_bonus",t.get("initiative_bonus",0))
                t["vision_range"]=char.get("vision_range",t.get("vision_range",0))
                if char.get("pic_url"): t["url"]=char["pic_url"]
                # don't override current hp by default (stay as-is)
                emit("token_updated",{"token_id":t["id"],"updates":t}, room=sid)
        mark_dirty()
        _emit_roster(s, sid)

    # ── Handouts ──────────────────────────────────────────────────────────
    @socketio.on("handout_create")
    def on_handout_create(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        h={"id":new_id(),"title":data["title"],"content":data["content"],
           "visible_to":data.get("visible_to","all")}
        s["handouts"].append(h); mark_dirty()
        emit("handout_created",h,room=sid)

    @socketio.on("ping_map")
    def on_ping(data):
        sid=data["session_id"]
        emit("map_ping",data,room=sid,include_self=False)

    def _broadcast_journal(s, sid):
        # Volle Daten an alle GMs (per Socket-ID), gefilterte an Spieler
        players_data = _journal_for_players(s)
        gm_data = _journal_for_broadcast(s)
        for socket_id, u in s["users"].items():
            target = gm_data if u.get("role")=="gm" else players_data
            emit("journal_updated", {"journal": target}, room=socket_id)

    # ── Journal / Wiki ────────────────────────────────────────────────────
    @socketio.on("journal_save")
    def on_journal_save(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        entries = s.setdefault("journal", [])
        eid = data.get("id")
        entry = None
        if eid:
            entry = next((e for e in entries if e["id"]==eid), None)
        if entry:
            entry["title"]      = data.get("title","")
            entry["content"]    = data.get("content","")
            entry["gm_notes"]   = data.get("gm_notes","")
            entry["visible_to_players"] = data.get("visible_to_players", False)
        else:
            entry = {
                "id": new_id(),
                "title": data.get("title","Neuer Eintrag"),
                "content": data.get("content",""),
                "gm_notes": data.get("gm_notes",""),
                "visible_to_players": data.get("visible_to_players", False),
            }
            entries.append(entry)
        mark_dirty()
        _broadcast_journal(s, sid)

    @socketio.on("journal_delete")
    def on_journal_delete(data):
        sid=data["session_id"]; s=get_session(sid)
        if not _require_gm(s): return
        eid=data.get("id")
        s["journal"] = [e for e in s.get("journal",[]) if e["id"]!=eid]
        mark_dirty()
        _broadcast_journal(s, sid)

    # ── Spieler-Notizen ──────────────────────────────────────────────────────
    def _broadcast_notes(s, sid):
        # Jedem Client seine passende Notiz-Sicht schicken
        for socket_id, u in list(s["users"].items()):
            emit("notes_updated", {"notes": _notes_for_user(s, socket_id)}, room=socket_id)

    @socketio.on("note_add")
    def on_note_add(data):
        sid=data["session_id"]; s=get_session(sid)
        user = s["users"].get(request.sid, {})
        # Nur Spieler erstellen Notizen (nicht der DM)
        if user.get("role")=="gm":
            emit("action_denied",{"message":"Notizen sind für Spieler gedacht. Nutze das Journal."})
            return
        note = {
            "id": new_id(),
            "author_char_id": user.get("char_id",""),
            "author_name": (user.get("character") or {}).get("name") or user.get("username","Spieler"),
            "title": data.get("title","Notiz"),
            "content": data.get("content",""),
            "shared": bool(data.get("shared", False)),
            "ts": time.time(),
        }
        s.setdefault("notes",[]).append(note)
        mark_dirty()
        _broadcast_notes(s, sid)

    @socketio.on("note_update")
    def on_note_update(data):
        sid=data["session_id"]; s=get_session(sid)
        user = s["users"].get(request.sid, {})
        my_char = user.get("char_id")
        nid = data.get("id")
        for n in s.get("notes",[]):
            if n["id"]==nid:
                # Nur der Autor darf bearbeiten
                if n.get("author_char_id")!=my_char:
                    emit("action_denied",{"message":"Nur der Autor kann diese Notiz bearbeiten."})
                    return
                if "title" in data:   n["title"]=data["title"]
                if "content" in data: n["content"]=data["content"]
                if "shared" in data:  n["shared"]=bool(data["shared"])
                mark_dirty(); _broadcast_notes(s, sid)
                return

    @socketio.on("note_delete")
    def on_note_delete(data):
        sid=data["session_id"]; s=get_session(sid)
        user = s["users"].get(request.sid, {})
        my_char = user.get("char_id")
        is_gm = user.get("role")=="gm"
        nid = data.get("id")
        # Autor darf löschen; DM darf auch löschen
        s["notes"] = [n for n in s.get("notes",[])
                      if not (n["id"]==nid and (is_gm or n.get("author_char_id")==my_char))]
        mark_dirty(); _broadcast_notes(s, sid)

    @socketio.on("force_save")
    def on_force_save(data):
        sid=data.get("session_id"); s=get_session(sid)
        if not _require_gm(s): return
        save_now(); emit("saved",{})
