# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller-Konfiguration für den VTT-Server.

Diese Konfiguration erzeugt EINE EINZIGE eigenständige Programmdatei
(vtt-server.exe), die kein installiertes Python braucht und auch KEINEN
separaten _internal-Ordner. Alles ist in der einen Datei enthalten.

Das ist wichtig, damit beim Verpacken in die App nichts verloren gehen kann.

Bauen:
    pip install pyinstaller
    pyinstaller vtt-server.spec

Ergebnis:
    dist/vtt-server.exe   – der komplette Server in EINER Datei
"""

block_cipher = None

# Mitzuliefernde Datenordner: Templates, statische Dateien und die Start-
# Bibliothek. Diese werden zur Laufzeit über app_base_dir() gefunden.
added_files = [
    ("templates", "templates"),
    ("static", "static"),
    ("data/library", "data/library"),
]

# Module, die PyInstaller nicht automatisch findet (SocketIO/Engine.IO
# nutzen dynamische Importe), müssen ausdrücklich benannt werden.
hidden = [
    "engineio.async_drivers.threading",
    "simple_websocket",
    "flask_socketio",
]

a = Analysis(
    ["app.py"],
    pathex=[],
    binaries=[],
    datas=added_files,
    hiddenimports=hidden,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# EINE-DATEI-Modus: binaries, zipfiles und datas kommen direkt in die EXE.
# Dadurch entsteht kein separater _internal-Ordner.
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name="vtt-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,          # kein separates Konsolenfenster
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
