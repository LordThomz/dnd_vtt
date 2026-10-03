# Updates über GitHub – Einrichtung und Ablauf

So funktioniert es, wenn alles eingerichtet ist:

1. Du erhöhst die Versionsnummer und lädst den Code zu GitHub hoch.
2. GitHub baut automatisch den Windows-Installer (dauert ca. 15–20 Minuten).
3. Jeder, der die App startet, bekommt das Update **automatisch und ohne Nachfrage**: Der Launcher prüft beim Start, lädt, installiert und startet neu.

Deine Freunde installieren die App nur **ein einziges Mal** von der GitHub-Release-Seite. Danach aktualisiert sie sich selbst.

---

## Einmalige Einrichtung (ca. 30 Minuten)

### 1. GitHub-Konto und Programme
- Konto anlegen auf **github.com** (kostenlos).
- **GitHub Desktop** installieren (desktop.github.com), damit brauchst du keine Kommandozeile.
- Am eigenen PC müssen **Node.js** (nodejs.org) und **Python** installiert sein. Das ist für den Build schon der Fall.

### 2. Repository anlegen
1. In GitHub Desktop: *File → New repository*
   - Name: `dnd-vtt`
   - Local path: der Ordner, **in dem** `dnd_v2` liegt. Den Projektordner wählst du im nächsten Schritt.
2. Einfacher geht es so: *File → Add local repository* → den Ordner `dnd_v2` auswählen → „create a repository here" bestätigen.
3. Unten links „Commit to main", dann oben „Publish repository".
   - **Wichtig:** Ob das Häkchen „Keep this code private" gesetzt werden darf, hängt von der offenen Frage zur Grundregel-Bibliothek ab (siehe unten). Der Updater lädt die Installer **ohne Anmeldung** herunter, die Releases müssen also öffentlich sein.

> Die Datei `.gitignore` sorgt dafür, dass deine persönlichen Daten (Charaktere, Konten, Kampagnen, Uploads, Backups) **nie** hochgeladen werden.

### 3. Den Updater auf dein Repository zeigen lassen
Im Projektordner ein Terminal öffnen (in GitHub Desktop: *Repository → Open in Command Prompt*):
```
python tools/release.py --repo DEIN-GITHUB-NAME/dnd-vtt
```

### 4. Signatur-Schlüssel erzeugen
Damit niemand ein gefälschtes Update unterschieben kann, wird jedes Update digital unterschrieben. Im Ordner `desktop`:
```
cd desktop
npm install
npx tauri signer generate -w %USERPROFILE%\.tauri\vtt.key
```
Du wirst nach einem Passwort gefragt. Merk es dir gut.

Danach gibt es zwei Dateien:
- `vtt.key` ist der **private** Schlüssel. Er bleibt geheim und gehört **niemals** ins Repository.
- `vtt.key.pub` ist der **öffentliche** Schlüssel.

Den Inhalt von `vtt.key.pub` kopierst du in `desktop/src-tauri/tauri.conf.json` und ersetzt damit `HIER-DEN-OEFFENTLICHEN-SCHLUESSEL-EINTRAGEN`.

> ⚠️ Mach eine Sicherungskopie von `vtt.key`, zum Beispiel auf einem USB-Stick. Geht er verloren, können bestehende Installationen keine Updates mehr annehmen.

### 5. Den privaten Schlüssel bei GitHub hinterlegen
Auf github.com in deinem Repository: *Settings → Secrets and variables → Actions → New repository secret*
- `TAURI_SIGNING_PRIVATE_KEY` = kompletter Inhalt der Datei `vtt.key`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` = dein Passwort aus Schritt 4

### 6. Prüfen
```
python tools/release.py --check
```
Wenn hier `OK` erscheint, ist alles bereit. Committe und pushe die Änderungen mit GitHub Desktop.

---

## Ein Update veröffentlichen (jedes Mal)

1. Versionsnummer erhöhen (überall gleichzeitig):
   ```
   python tools/release.py 0.2.0
   ```
2. In GitHub Desktop: Commit („Version 0.2.0") → **Push**.
3. Tag anlegen: *History* → Rechtsklick auf deinen Commit → **Create Tag** → `v0.2.0` → danach **Push** (GitHub Desktop fragt, ob der Tag mitgesendet werden soll: ja).
4. Auf github.com unter **Actions** kannst du dem Build zusehen. Wenn er grün ist, steht das Release unter **Releases**.

Ab dann bekommt jeder beim nächsten App-Start automatisch die neue Version.

**Versionsnummern:** `0.2.0 → 0.2.1` für kleine Korrekturen, `0.2.0 → 0.3.0` für neue Funktionen.

---

## Wenn etwas schiefgeht

| Problem | Lösung |
|---|---|
| Build auf GitHub ist rot | Unter *Actions* auf den roten Lauf klicken. Der rote Schritt zeigt den Fehler. Schick mir den Text. |
| „Versionen stimmen nicht überein" | `python tools/release.py X.Y.Z` erneut ausführen und neu pushen |
| „Tag passt nicht zur Version" | Der Tag muss genau `v` + Versionsnummer sein, z. B. `v0.2.0` |
| Freund bekommt kein Update | Hat er die App seit dem Release neu gestartet? Ohne Internet startet die App ohne Update. Beim Verbinden mit dir verhindert dann der Versionsvergleich das Mitspielen, mit dem Hinweis, neu zu starten. |
| Update lässt sich nicht installieren | Der Launcher zeigt „Erneut versuchen". Notfalls den Installer manuell von der Release-Seite laden. |

---

## Wie es technisch zusammenhängt (für Entwickler)
- `desktop/src/index.html` – Launcher (Update-Pflicht, eigenes Spiel, Mitspielen, Übergabe)
- `desktop/src-tauri` – Tauri-App mit `tauri-plugin-updater` und `tauri-plugin-process`, Befehl `stop_server` (beendet den eigenen Server vor dem Installieren)
- `.github/workflows/release.yml` – Build und Release über `tauri-apps/tauri-action`, inklusive `latest.json`
- `tools/release.py` – Versionsnummer an allen vier Stellen, Prüfungen
- Der Updater fragt `https://github.com/<repo>/releases/latest/download/latest.json` ab
