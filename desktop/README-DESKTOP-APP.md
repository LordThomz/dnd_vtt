# Virtual Tabletop – Desktop-App

Diese App verpackt das Programm in eine **einzige Installer-Datei**:
Doppelklick → installiert → Icon auf dem Desktop → starten wie jedes andere
Programm. **Kein Python, keine losen Ordner, kein Gefummel** für deine Freunde.

M�glich macht das ein zweistufiger Bau:
1. Der Python-Server wird zu einer eigenständigen Datei gebündelt (PyInstaller).
2. Diese Datei wird in die App (Tauri) eingebettet, die daraus die Installer-Datei baut.

Beides erledigt EIN Build-Skript automatisch.

---

## Einmalige Vorbereitung (auf dem PC, der die App baut)

Installiere drei Dinge:

1. **Python 3** – https://python.org
2. **Node.js** (LTS) – https://nodejs.org
3. **Rust** – https://www.rust-lang.org/tools/install

> Nur der PC, der die App **baut**, braucht das. Deine Freunde, die die
> fertige App nur **benutzen**, brauchen nichts davon – sie bekommen die
> fertige Installer-Datei.

---

## Die App bauen (die fertige Installer-Datei erzeugen)

**Windows:** Doppelklick auf `build-windows.bat`
(oder im Terminal im Projektordner: `build-windows.bat`)

**Mac:** im Terminal im Projektordner:
```
chmod +x build-mac.sh      (nur beim ersten Mal)
./build-mac.sh
```

Das Skript erledigt automatisch alles:
- bündelt den Python-Server,
- kopiert ihn an die richtige Stelle,
- baut die Installer-Datei.

Beim ersten Mal dauert das einige Minuten (Rust lädt einmalig seine Bausteine).

**Ergebnis** liegt in:
```
desktop/src-tauri/target/release/bundle/
```
- Windows: eine `.msi`- oder `.exe`-Installationsdatei
- Mac: eine `.dmg`-Datei

Diese eine Datei gibst du deinen Freunden. Sie installieren sie, klicken auf
das Icon – fertig.

---

## Nur schnell testen (ohne fertige Installer-Datei)

Wenn du während der Entwicklung nur kurz schauen willst, ob alles läuft, kannst
du die App direkt starten (dann darf Python lokal vorhanden sein):

```
cd desktop
npm install        (nur beim ersten Mal)
npm run dev
```

---

## Wo landen die Spieldaten?

- **Normal (Entwicklung):** im Projektordner unter `data/`.
- **Installierte App:** in einem festen Ordner im Benutzerprofil
  (Windows: `AppData`, Mac: `Application Support`). So bleiben Charaktere und
  Einstellungen dauerhaft erhalten und werden bei einem Update nicht gelöscht.

---

## Später: Umzug auf einen echten Server

Setzt du die Umgebungsvariable `VTT_REMOTE`, startet die App **keinen** lokalen
Server, sondern verbindet sich zum echten Server. Der Rest bleibt gleich –
siehe `UMZUG-AUF-SERVER.md` im Hauptordner.

---

## Icon

Lege dein Wunsch-Icon als `icon.png` (mind. 512×512) in
`desktop/src-tauri/icons/` ab. Tauri erzeugt daraus beim Bauen automatisch
alle nötigen Formate für Windows und Mac.
