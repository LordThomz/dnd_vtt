#!/bin/bash
# ============================================================
#  VTT – Komplett-Build für macOS
#  Erzeugt aus dem Python-Server + der Tauri-App EINE Installer-Datei (.dmg).
#
#  Voraussetzungen (einmalig installieren):
#    - Python 3   (python.org oder brew)
#    - Node.js    (nodejs.org oder brew)
#    - Rust       (rust-lang.org)
#
#  Aufruf:  ./build-mac.sh
# ============================================================
set -e
echo ""
echo "=== VTT Build startet ==="
echo ""

# --- Schritt 1: PyInstaller sicherstellen ---
echo "[1/4] Prüfe PyInstaller ..."
if ! python3 -c "import PyInstaller" 2>/dev/null; then
    echo "      installiere PyInstaller ..."
    pip3 install pyinstaller
fi

# --- Schritt 2: Server bündeln ---
echo "[2/4] Bündle den Python-Server ..."
pyinstaller --clean --noconfirm vtt-server.spec

# --- Schritt 3: Server-Datei an die richtige Stelle kopieren ---
echo "[3/4] Kopiere Server in die App (mit Plattform-Namen) ..."
TARGET="desktop/src-tauri/binaries"
mkdir -p "$TARGET"

# Plattform-Kürzel ermitteln (Intel oder Apple Silicon)
ARCH=$(uname -m)
if [ "$ARCH" = "arm64" ]; then
    TRIPLE="aarch64-apple-darwin"
else
    TRIPLE="x86_64-apple-darwin"
fi
cp "dist/vtt-server" "$TARGET/vtt-server-$TRIPLE"
chmod +x "$TARGET/vtt-server-$TRIPLE"

# --- Schritt 4: Tauri-App bauen ---
echo "[4/4] Baue die Installer-App ..."
cd desktop
npm install
npm run build
cd ..

echo ""
echo "=== FERTIG ==="
echo "Die Installer-Datei liegt in:"
echo "  desktop/src-tauri/target/release/bundle/"
echo ""
