"""
tools/release.py – Versionsnummer an ALLEN Stellen setzen bzw. prüfen
═════════════════════════════════════════════════════════════════════

Die Version steht an vier Stellen und muss überall gleich sein, sonst
erkennt der Updater neue Versionen nicht richtig:
    routes/api.py                    APP_VERSION = "x.y.z"   (Server)
    desktop/src-tauri/tauri.conf.json  "version": "x.y.z"    (App/Updater)
    desktop/src-tauri/Cargo.toml       version = "x.y.z"
    desktop/package.json               "version": "x.y.z"

Benutzung:
    python tools/release.py 0.2.0          setzt überall 0.2.0
    python tools/release.py --check v0.2.0 prüft (für GitHub Actions)
    python tools/release.py --show         zeigt die aktuelle Version
    python tools/release.py --repo NAME/REPO   trägt das GitHub-Repository
                                               für den Updater ein
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FILES = {
    "api":   ROOT / "routes" / "api.py",
    "tauri": ROOT / "desktop" / "src-tauri" / "tauri.conf.json",
    "cargo": ROOT / "desktop" / "src-tauri" / "Cargo.toml",
    "npm":   ROOT / "desktop" / "package.json",
}
VER_RE = re.compile(r"^\d+\.\d+\.\d+$")


def read_versions():
    v = {}
    v["api"] = re.search(r'^APP_VERSION\s*=\s*"([^"]+)"', FILES["api"].read_text(encoding="utf-8"), re.M).group(1)
    v["tauri"] = json.loads(FILES["tauri"].read_text(encoding="utf-8"))["version"]
    v["cargo"] = re.search(r'^version\s*=\s*"([^"]+)"', FILES["cargo"].read_text(encoding="utf-8"), re.M).group(1)
    v["npm"] = json.loads(FILES["npm"].read_text(encoding="utf-8"))["version"]
    return v


def set_version(ver):
    if not VER_RE.match(ver):
        sys.exit(f"Ungültige Version „{ver}“ – Format: 1.2.3")
    t = FILES["api"].read_text(encoding="utf-8")
    FILES["api"].write_text(re.sub(r'^APP_VERSION\s*=\s*"[^"]+"', f'APP_VERSION = "{ver}"', t, count=1, flags=re.M), encoding="utf-8")
    for key in ("tauri", "npm"):
        d = json.loads(FILES[key].read_text(encoding="utf-8"))
        d["version"] = ver
        FILES[key].write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    t = FILES["cargo"].read_text(encoding="utf-8")
    FILES["cargo"].write_text(re.sub(r'^version\s*=\s*"[^"]+"', f'version = "{ver}"', t, count=1, flags=re.M), encoding="utf-8")
    print(f"Version überall auf {ver} gesetzt.")


def set_repo(repo):
    if not re.match(r"^[A-Za-z0-9-]+/[A-Za-z0-9._-]+$", repo):
        sys.exit("Format: GITHUB-NUTZER/REPOSITORY")
    d = json.loads(FILES["tauri"].read_text(encoding="utf-8"))
    d["plugins"]["updater"]["endpoints"] = [f"https://github.com/{repo}/releases/latest/download/latest.json"]
    FILES["tauri"].write_text(json.dumps(d, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Updater sucht jetzt bei github.com/{repo}")


def main(argv):
    if not argv or argv[0] in ("-h", "--help"):
        print(__doc__); return
    if argv[0] == "--show":
        print(read_versions()); return
    if argv[0] == "--repo":
        set_repo(argv[1]); return
    if argv[0] == "--check":
        tag = argv[1].lstrip("v") if len(argv) > 1 else None
        v = read_versions()
        if len(set(v.values())) != 1:
            sys.exit(f"Versionen stimmen nicht überein: {v} – bitte „python tools/release.py X.Y.Z“ ausführen.")
        if tag and tag != v["api"]:
            sys.exit(f"Tag v{tag} passt nicht zur Version {v['api']} im Code.")
        d = json.loads(FILES["tauri"].read_text(encoding="utf-8"))
        up = d.get("plugins", {}).get("updater", {})
        if "GITHUB-NUTZER" in json.dumps(up) or "HIER-DEN" in up.get("pubkey", ""):
            sys.exit("Updater ist noch nicht eingerichtet (Repository / öffentlicher Schlüssel fehlt) – siehe UPDATES.md.")
        print(f"OK – Version {v['api']} überall gleich, Updater eingerichtet.")
        return
    set_version(argv[0])


if __name__ == "__main__":
    main(sys.argv[1:])
