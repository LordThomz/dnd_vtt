"""
backup.py – Automatische Sicherung der Serverdaten.

Im zentralen Server-Modell liegen ALLE Daten (Konten, Charaktere, Bibliothek,
Adventures) auf dem Server. Fällt der Server aus, wären ohne Sicherung alle
Daten verloren. Dieses Modul erstellt deshalb regelmäßig automatische Backups.

Funktionsweise:
- Beim Start und danach täglich wird der gesamte Datenordner (data/) in ein
  Zip-Archiv gepackt und im Ordner backups/ abgelegt.
- Alte Backups werden automatisch aufgeräumt: die letzten N bleiben erhalten.
- Alles läuft in einem Hintergrund-Thread, ohne den Server zu blockieren.
"""
import time
import shutil
import threading
from datetime import datetime
from pathlib import Path


class BackupManager:
    def __init__(self, data_dir, backup_dir=None, keep=14, interval_hours=24):
        """
        data_dir       – der zu sichernde Datenordner (enthält data/)
        backup_dir     – wohin die Backups kommen (Standard: <data_dir>/backups)
        keep           – wie viele Backups aufbewahrt werden (ältere werden gelöscht)
        interval_hours – Abstand zwischen automatischen Backups (Standard: täglich)
        """
        self.data_dir = Path(data_dir)
        self.backup_dir = Path(backup_dir) if backup_dir else self.data_dir / "backups"
        self.keep = keep
        self.interval_seconds = interval_hours * 3600
        self._thread = None

    # ── Ein einzelnes Backup erstellen ─────────────────────────────────────
    def create_backup(self):
        """Packt den data/-Ordner in ein Zip-Archiv mit Zeitstempel im Namen."""
        source = self.data_dir / "data"
        if not source.exists():
            print("[backup] Kein data-Ordner gefunden - uebersprungen.")
            return None

        self.backup_dir.mkdir(parents=True, exist_ok=True)
        stamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
        archive_base = self.backup_dir / f"backup_{stamp}"
        try:
            # shutil erzeugt aus dem Ordner ein .zip-Archiv.
            archive_path = shutil.make_archive(str(archive_base), "zip", root_dir=str(source))
            size_kb = Path(archive_path).stat().st_size // 1024
            print(f"[backup] Sicherung erstellt: {Path(archive_path).name} ({size_kb} KB)")
            self._cleanup_old()
            return archive_path
        except Exception as e:
            print(f"[backup] Fehler beim Erstellen der Sicherung: {e}")
            return None

    # ── Alte Backups aufräumen ─────────────────────────────────────────────
    def _cleanup_old(self):
        """Behält nur die neuesten 'keep' Backups, löscht ältere."""
        backups = sorted(self.backup_dir.glob("backup_*.zip"))
        if len(backups) > self.keep:
            for old in backups[:-self.keep]:
                try:
                    old.unlink()
                    print(f"[backup] Altes Backup entfernt: {old.name}")
                except Exception as e:
                    print(f"[backup] Konnte {old.name} nicht loeschen: {e}")

    # ── Hintergrund-Automatik ──────────────────────────────────────────────
    def _loop(self):
        # Kurz warten, damit der Server erst vollständig hochfährt.
        time.sleep(10)
        # Ein Backup direkt beim Start (Sicherheit von Anfang an).
        self.create_backup()
        while True:
            time.sleep(self.interval_seconds)
            self.create_backup()

    def start(self):
        """Startet die automatische Sicherung im Hintergrund."""
        if self._thread and self._thread.is_alive():
            return
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()
        print(f"[backup] Automatische Sicherung aktiv "
              f"(alle {self.interval_seconds // 3600} h, {self.keep} Backups werden aufbewahrt).")

    # ── Wiederherstellung (manuell) ────────────────────────────────────────
    def list_backups(self):
        """Gibt die vorhandenen Backups zurück (neueste zuerst)."""
        if not self.backup_dir.exists():
            return []
        return sorted(self.backup_dir.glob("backup_*.zip"), reverse=True)
