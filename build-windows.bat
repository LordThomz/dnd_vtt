@echo off
REM ============================================================
REM  VTT - Komplett-Build fuer Windows
REM  Erzeugt aus dem Python-Server + der Tauri-App EINE Installer-Datei.
REM
REM  Voraussetzungen (einmalig installieren):
REM    - Python           (python.org)
REM    - Node.js          (nodejs.org)
REM    - Rust             (rust-lang.org)
REM
REM  Aufruf: einfach diese Datei doppelklicken oder im Terminal starten.
REM ============================================================
setlocal
echo.
echo === VTT Build startet ===
echo.

REM --- Schritt 1: PyInstaller sicherstellen ---
echo [1/4] Pruefe PyInstaller ...
pip show pyinstaller >nul 2>&1
if errorlevel 1 (
    echo      installiere PyInstaller ...
    pip install pyinstaller
)

REM --- Schritt 2: Server buendeln (EINE Datei, kein _internal-Ordner) ---
echo [2/4] Buendle den Python-Server ...
pyinstaller --clean --noconfirm vtt-server.spec
if errorlevel 1 (
    echo FEHLER beim Buendeln des Servers.
    pause
    exit /b 1
)

REM --- Schritt 3: Die EINE Server-Datei an die richtige Stelle kopieren ---
echo [3/4] Kopiere Server in die App ...
set TARGET=desktop\src-tauri\binaries
if not exist "%TARGET%" mkdir "%TARGET%"
REM Alte Reste aufraeumen, damit nichts Falsches liegen bleibt.
if exist "%TARGET%\vtt-server-data" rmdir /S /Q "%TARGET%\vtt-server-data"
REM Tauri erwartet den Sidecar mit angehaengtem Plattform-Kuerzel.
REM Im Ein-Datei-Modus liegt die Datei direkt unter dist\vtt-server.exe
copy /Y "dist\vtt-server.exe" "%TARGET%\vtt-server-x86_64-pc-windows-msvc.exe" >nul
if errorlevel 1 (
    echo FEHLER: Server-Datei nicht gefunden.
    pause
    exit /b 1
)

REM --- Schritt 4: Tauri-App bauen ---
echo [4/4] Baue die Installer-App ...
cd desktop
call npm install
REM Lokale Test-Builds: Ohne privaten Signatur-Schluessel werden keine
REM Update-Dateien erzeugt (sonst bricht der Build ab). Veroeffentlichte
REM Updates baut GitHub automatisch - siehe UPDATES.md.
if defined TAURI_SIGNING_PRIVATE_KEY (
    call npm run build
) else (
    call npx tauri build --config "{\"bundle\":{\"createUpdaterArtifacts\":false}}"
)
cd ..

REM --- Schritt 5: Installer in den updates-Ordner kopieren ---
REM Damit stellt DEIN Server die neueste Version automatisch fuer Freunde bereit,
REM die per Tailscale verbunden sind und "Nach Updates suchen" klicken.
echo [5/5] Stelle Update fuer Freunde bereit ...
if not exist "data\updates" mkdir "data\updates"
REM Alte Update-Dateien entfernen, damit nur die neueste bereitsteht
del /Q "data\updates\*.exe" 2>nul
for /r "desktop\src-tauri\target\release\bundle\nsis" %%f in (*.exe) do copy /Y "%%f" "data\updates\" >nul
echo    Update in data\updates\ bereitgestellt.

echo.
echo === FERTIG ===
echo Die Installer-Datei liegt in:
echo   desktop\src-tauri\target\release\bundle\nsis\
echo.
echo Deine Freunde koennen das Update jetzt ueber "Nach Updates suchen"
echo direkt von deinem PC laden (wenn ihr per Tailscale verbunden seid
echo und deine App laeuft).
echo.
pause
