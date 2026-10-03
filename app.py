"""D&D Virtual Tabletop – Start: python app.py"""
import os, sys, time, threading, webbrowser

# In der gebündelten Windows-App (Fenster ohne Konsole) kann es sein, dass es
# gar keine Ausgabe (stdout/stderr) gibt – dann ist sys.stdout None. Damit die
# print()-Aufrufe beim Start trotzdem NIE einen Absturz verursachen, fangen wir
# beide Fälle ab: keine Konsole vorhanden ODER alter Zeichensatz (cp1252).
def _harden_output():
    for name in ("stdout", "stderr"):
        stream = getattr(sys, name, None)
        if stream is None:
            # Keine Konsole (Fenster-App): Ausgabe ins Leere leiten.
            setattr(sys, name, open(os.devnull, "w", encoding="utf-8"))
            continue
        try:
            stream.reconfigure(encoding="utf-8")
        except Exception:
            pass
_harden_output()

from flask import Flask, request
from flask_socketio import SocketIO
from config import Config, app_base_dir, app_data_dir
from game_state import load_from_disk
from routes.api     import api_bp
from routes.pages   import pages_bp
from routes.sockets import register_socket_events

# Templates und statische Dateien aus dem Basisverzeichnis laden.
# Das funktioniert sowohl normal als auch in der gebündelten Exe.
_BASE = app_base_dir()
app = Flask(__name__,
            template_folder=str(_BASE / "templates"),
            static_folder=str(_BASE / "static"))
# Alle server-abhängigen Einstellungen kommen zentral aus config.py.
# Für den späteren Umzug auf einen gemieteten Server muss nur dort etwas geändert werden.
app.secret_key = Config.SECRET_KEY
# Wie lange die Anmeldung erhalten bleibt ("Gerät merken").
# 90 Tage – so muss man sich nicht bei jedem App-Start neu anmelden.
from datetime import timedelta
app.permanent_session_lifetime = timedelta(days=90)
# Cookie-Einstellungen, damit "Gerät merken" auch in der App-WebView über
# Neustarts hinweg erhalten bleibt. SameSite=Lax + kein Secure-Zwang (lokal
# läuft es über http), damit das Cookie zuverlässig gespeichert wird.
app.config.update(
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SECURE=False,
)
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")
app.register_blueprint(api_bp)
app.register_blueprint(pages_bp)
register_socket_events(socketio)

# CORS-Freigabe für alle HTTP-Antworten.
# Die Desktop-App (Tauri) läuft unter einem anderen "Ursprung" als der Server
# und würde sonst von der Sicherheitsprüfung des Browsers/WebViews blockiert.
# Diese Freigabe erlaubt es dem App-Fenster, die API anzusprechen.
# Freigegeben werden NUR die eigene App (Launcher) und gleiche Adressen.
# Früher wurde jede Herkunft mit Anmeldedaten erlaubt – damit hätte jede
# beliebige Webseite im Namen des Nutzers Anfragen an den lokalen Server
# schicken können.
_APP_ORIGINS = {"tauri://localhost", "http://tauri.localhost", "https://tauri.localhost"}
# Zum Entwickeln/Testen (z.B. Launcher im normalen Browser): weitere Adressen
# freigeben, kommagetrennt: VTT_DEV_ORIGINS=http://127.0.0.1:8765
_APP_ORIGINS |= {o.strip() for o in os.environ.get("VTT_DEV_ORIGINS", "").split(",") if o.strip()}

@app.after_request
def _add_cors_headers(response):
    origin = request.headers.get("Origin")
    if origin and (origin in _APP_ORIGINS or origin == request.host_url.rstrip("/")):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Credentials"] = "true"
        response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    # Die 3D-Würfel (dice-box) werden als ES-Modul geladen. Der Browser lädt ein
    # Modul aber NUR, wenn der Server einen JavaScript-MIME-Typ meldet.
    # Unter Windows liest Python die Typen aus der Registry, und dort ist .js
    # oft als "text/plain" hinterlegt – dann verweigert der Browser den Import
    # und die Würfel erscheinen gar nicht. Deshalb erzwingen wir den Typ hier.
    p = request.path.lower()
    if p.endswith(".js") or p.endswith(".mjs"):
        response.headers["Content-Type"] = "text/javascript; charset=utf-8"
    elif p.endswith(".wasm"):
        response.headers["Content-Type"] = "application/wasm"
    return response

# Antwort auf Vorab-Anfragen (OPTIONS), die der Browser vor manchen Aufrufen schickt.
@app.route("/<path:_any>", methods=["OPTIONS"])
@app.route("/", methods=["OPTIONS"])
def _cors_preflight(_any=""):
    return ("", 204)

if __name__ == "__main__":
    # Ordner im (ggf. gebündelten) Datenverzeichnis anlegen.
    _data = app_data_dir()
    for _d in ("uploads/maps", "uploads/tokens", "uploads/enemies", "data"):
        (_data / _d).mkdir(parents=True, exist_ok=True)
    load_from_disk()
    import packs as _packs
    _packs.load()          # Quellen/Inhaltspakete der Bibliothek

    # Automatische tägliche Datensicherung starten.
    # Im zentralen Server-Modell sind Backups Pflicht, damit bei einem
    # Server-Ausfall keine Daten verloren gehen.
    if Config.BACKUP_ENABLED:
        from backup import BackupManager
        _backup = BackupManager(
            data_dir=app_data_dir(),
            keep=Config.BACKUP_KEEP,
            interval_hours=Config.BACKUP_INTERVAL_HOURS,
        )
        _backup.start()

    import socket as _sock
    def _get_lan_ip():
        try:
            s = _sock.socket(_sock.AF_INET, _sock.SOCK_DGRAM)
            s.connect(("8.8.8.8", 80)); ip = s.getsockname()[0]; s.close()
            return ip
        except: return "???"
    lan_ip = _get_lan_ip()

    port = Config.PORT
    mode_label = "ECHTER SERVER (production)" if Config.is_production() else "Entwicklung (dein PC ist der Server)"

    # Startmeldung ausgeben. Falls die Konsole bestimmte Sonderzeichen nicht
    # darstellen kann, bricht der Server NICHT ab, sondern gibt eine einfache
    # Variante aus.
    def _safe_print(text):
        try:
            print(text)
        except UnicodeEncodeError:
            # Auf reine ASCII-Zeichen zurückfallen
            print(text.encode("ascii", "replace").decode("ascii"))

    _safe_print("\n" + "="*56)
    _safe_print("   D&D Virtual Tabletop - Server")
    _safe_print("  -----------------------------------------")
    _safe_print(f"   Modus:          {mode_label}")
    if Config.PUBLIC_URL:
        _safe_print(f"   Oeffentlich:    {Config.PUBLIC_URL}")
    _safe_print(f"   Dieser PC:      http://localhost:{port}")
    _safe_print(f"   Andere Geraete: http://{lan_ip}:{port}")
    _safe_print("  -----------------------------------------")
    if Config.is_production():
        _safe_print("   Produktionsmodus - Server ist oeffentlich erreichbar.")
    else:
        _safe_print("   Alle im selben WLAN koennen mitspielen!")
        _safe_print("   Standard-Login: Thomas / thomas")
        _safe_print("   Umzug spaeter: nur config.py bzw. Umgebungsvariablen aendern.")
    _safe_print("="*56 + "\n")

    if Config.OPEN_BROWSER:
        def _open():
            time.sleep(1.5); webbrowser.open(f"http://localhost:{port}")
        threading.Thread(target=_open, daemon=True).start()

    # threaded=True + großzügiger Thread-Pool, damit viele Spieler gleichzeitig
    # verbunden sein können (jede Long-Polling-/WebSocket-Verbindung belegt einen Thread).
    socketio.run(app, host=Config.HOST, port=port, debug=Config.DEBUG,
                 allow_unsafe_werkzeug=True)
