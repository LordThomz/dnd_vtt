"""
config.py – Zentrale Konfiguration des VTT-Servers.

WICHTIG FÜR DEN SPÄTEREN UMZUG AUF EINEN GEMIETETEN SERVER:
--------------------------------------------------------------------
Alle Einstellungen, die vom Standort des Servers abhängen, stehen HIER
an einer einzigen Stelle. Während der Entwicklung ist dein eigener PC
der Server. Wenn du später einen echten Server mietest, musst du nur
die Umgebungsvariablen setzen (oder die Standardwerte unten anpassen) –
am restlichen Programm ändert sich nichts.

Jede Einstellung kann über eine Umgebungsvariable überschrieben werden.
Das ist der professionelle Weg: Der Code bleibt gleich, nur die
Umgebung (Entwicklung vs. echter Server) unterscheidet sich.
"""
import os
import sys
from pathlib import Path


def app_base_dir():
    """Liefert das Basisverzeichnis des Programms.

    Wichtig für die gebündelte Exe (PyInstaller):
    - Normal (python app.py): der Ordner, in dem app.py liegt.
    - Als gebündelte Exe: der Ordner, in den PyInstaller die mitgelieferten
      Dateien (templates, static) zur Laufzeit entpackt (sys._MEIPASS).

    So finden Templates und statische Dateien in beiden Fällen ihren Weg.
    """
    if getattr(sys, "frozen", False):
        # Läuft als gebündelte Exe.
        return Path(getattr(sys, "_MEIPASS", os.path.dirname(sys.executable)))
    # Läuft normal als Python-Skript. config.py liegt im Projektstamm.
    return Path(__file__).resolve().parent


def app_data_dir():
    """Liefert das Verzeichnis für veränderliche Daten (Sessions, Konten, Uploads).

    Wichtig: In der gebündelten Exe darf NICHT in den (schreibgeschützten,
    temporären) Programmordner geschrieben werden. Stattdessen wird ein
    fester Ordner im Benutzerprofil verwendet, damit Daten dauerhaft bleiben.
    - Normal: der Projektordner (wie bisher).
    - Als Exe: ein Ordner im Benutzerprofil (z. B. AppData unter Windows).
    Über die Umgebungsvariable VTT_DATA_DIR lässt sich das überschreiben.
    """
    override = os.environ.get("VTT_DATA_DIR")
    if override:
        return Path(override)
    if getattr(sys, "frozen", False):
        # Plattformabhängiger Ort für Anwendungsdaten.
        if sys.platform == "win32":
            root = Path(os.environ.get("APPDATA", Path.home()))
        elif sys.platform == "darwin":
            root = Path.home() / "Library" / "Application Support"
        else:
            root = Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local" / "share"))
        return root / "VirtualTabletop"
    # Normaler Betrieb: alles bleibt im Projektordner.
    return Path(__file__).resolve().parent


def _env(name, default):
    """Liest eine Umgebungsvariable, sonst den Standardwert."""
    return os.environ.get(name, default)


def _env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


def _env_bool(name, default):
    val = os.environ.get(name)
    if val is None:
        return default
    return val.strip().lower() in ("1", "true", "yes", "on", "ja")


class Config:
    # ── Netzwerk / Server-Adresse ──────────────────────────────────────────
    # HOST 0.0.0.0 bedeutet: von allen Netzwerk-Adressen erreichbar
    # (also auch für andere Geräte im WLAN – genau richtig zum Testen).
    HOST = _env("VTT_HOST", "0.0.0.0")
    PORT = _env_int("VTT_PORT", 5000)

    # Die öffentliche Basis-Adresse des Servers.
    # ENTWICKLUNG:  leer lassen -> die App ermittelt die Adresse automatisch
    #               (localhost bzw. die LAN-IP dieses PCs).
    # ECHTER SERVER: hier später die feste Adresse eintragen, z.B.
    #               "https://vtt.meinedomain.de"  – oder die Umgebungs-
    #               variable VTT_PUBLIC_URL auf dem Server setzen.
    PUBLIC_URL = _env("VTT_PUBLIC_URL", "")

    # ── Sicherheit ─────────────────────────────────────────────────────────
    # Der Secret Key sichert die Anmelde-Sitzungen ab.
    # ENTWICKLUNG:  der Standardwert ist ok.
    # ECHTER SERVER: unbedingt über die Umgebungsvariable VTT_SECRET_KEY
    #               einen eigenen, zufälligen Wert setzen!
    SECRET_KEY = _env("VTT_SECRET_KEY", "dnd_vtt_dev_secret_change_me")

    # ── Betriebsmodus ──────────────────────────────────────────────────────
    # "development" (dein PC) oder "production" (gemieteter Server).
    # Diese eine Einstellung ist der Schalter für den späteren Umzug.
    MODE = _env("VTT_MODE", "development")

    # Soll beim Start automatisch der Browser geöffnet werden?
    # Praktisch in der Entwicklung, unerwünscht auf einem echten Server.
    OPEN_BROWSER = _env_bool("VTT_OPEN_BROWSER", MODE == "development")

    # ── Besitzer-Prinzip ──────────────────────────────────────────────────
    # Jede Installation gehört EINER Person. Bibliothek, Inhaltspakete und
    # Kampagnen lassen sich dann nur direkt an diesem PC verwalten (Zugriff
    # von 127.0.0.1). Wer über das Netzwerk verbunden ist, kann mitspielen,
    # aber nichts an der Installation ändern.
    # Für einen zentralen, gemieteten Server (UMZUG-AUF-SERVER.md) auf 0 setzen.
    OWNER_ONLY = _env_bool("VTT_OWNER_ONLY", MODE != "production")

    # Debug-Ausgaben (nur in der Entwicklung sinnvoll).
    DEBUG = _env_bool("VTT_DEBUG", False)

    # ── Datensicherung (Backups) ───────────────────────────────────────────
    # Automatische tägliche Sicherung der Serverdaten.
    # Standardmäßig aktiv – im zentralen Server-Modell sind Backups Pflicht.
    BACKUP_ENABLED = _env_bool("VTT_BACKUP_ENABLED", True)
    # Wie viele Backups aufbewahrt werden (ältere werden automatisch gelöscht).
    BACKUP_KEEP = _env_int("VTT_BACKUP_KEEP", 14)
    # Abstand zwischen den Sicherungen in Stunden (24 = täglich).
    BACKUP_INTERVAL_HOURS = _env_int("VTT_BACKUP_INTERVAL_HOURS", 24)

    # ── Updates ────────────────────────────────────────────────────────────
    # Adresse, unter der neue App-Versionen heruntergeladen werden können.
    # Wird später auf die echte Download-Seite gesetzt (z. B. GitHub-Releases).
    UPDATE_DOWNLOAD_URL = _env("VTT_UPDATE_DOWNLOAD_URL", "")

    # ── Abgeleitete Helfer ─────────────────────────────────────────────────
    @classmethod
    def is_production(cls):
        return cls.MODE.strip().lower() == "production"

    @classmethod
    def summary(cls):
        """Kurze Übersicht der aktiven Konfiguration (für die Startausgabe)."""
        return {
            "Modus": cls.MODE,
            "Host": cls.HOST,
            "Port": cls.PORT,
            "Öffentliche Adresse": cls.PUBLIC_URL or "(automatisch ermittelt)",
            "Browser öffnen": "ja" if cls.OPEN_BROWSER else "nein",
        }
