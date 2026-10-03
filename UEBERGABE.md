# D&D 5e Virtual Tabletop – Übergabedokument

**Stand:** 30. September 2026
**Projektordner:** `dnd_v2/`
**Ansprechpartner / bisheriger Entwickler:** Thomas (Dungeon Master, Auftraggeber und Tester)

Dieses Dokument soll dir alles geben, was du brauchst, um an dem Projekt weiterzuarbeiten: was es ist, wie man es startet, wie es aufgebaut ist, was funktioniert, was nicht, und was als Nächstes ansteht. Das ausführliche, chronologische Änderungsprotokoll steht zusätzlich in `AENDERUNGEN.txt` (neueste Einträge oben).

---

## 1. Worum geht es?

Ein privates **Virtual Tabletop für Dungeons & Dragons 5e**, komplett auf Deutsch. Der Spielleiter (DM) hostet einen Server, die Mitspieler verbinden sich über das lokale Netzwerk oder als Desktop-App. Ziel ist eine **vollständig offline-fähige, selbstgehostete Anwendung** – keine Cloud, keine externen Dienste, alle Schriften und Bibliotheken liegen lokal im Projekt.

Das Programm wird für den privaten Spielbetrieb genutzt. Thomas testet Änderungen immer selbst auf seinem Windows-PC, und zwar gesammelt nach einer fertigen Arbeitsrunde (nicht Schritt für Schritt).

---

## 2. Schnellstart

### Entwicklungsmodus (empfohlen zum Weiterarbeiten)

```bash
cd dnd_v2
pip install -r requirements.txt      # flask, flask-socketio, pillow, simple-websocket
python app.py
```

Danach läuft der Server auf **http://localhost:5000**. Im Entwicklungsmodus öffnet sich der Browser automatisch (abschaltbar mit der Umgebungsvariable `VTT_OPEN_BROWSER=0`).

**Standard-Login:** Benutzer `Thomas`, Passwort `thomas`. Dieses Konto wird beim ersten Start automatisch angelegt, wenn noch keine `data/users.json` existiert.

Mitspieler im gleichen Netzwerk öffnen `http://<IP-des-Host-PCs>:5000`.

### Desktop-App bauen (Installer für Mitspieler)

Siehe `desktop/README-DESKTOP-APP.md`. Kurz: Python, Node.js und Rust installieren, dann unter Windows `build-windows.bat` ausführen (Mac: `build-mac.sh`). Das Skript bündelt den Python-Server per PyInstaller (`vtt-server.spec`) und bettet ihn in eine Tauri-App ein. Vor einem Neubau unter Windows alle laufenden `vtt-server`-Prozesse im Task-Manager beenden und in einen frischen Ordner entpacken (Details in `NEUSTART-ANLEITUNG.txt`).

### Konfiguration

`config.py` liest Umgebungsvariablen, u.a. `VTT_HOST` (Standard `0.0.0.0`), `VTT_PORT` (Standard `5000`), `VTT_DATA_DIR` (wo Spieldaten gespeichert werden) und `VTT_OPEN_BROWSER`.

---

## 3. Technik & Aufbau

| Bereich | Technik |
|---|---|
| Backend | Python 3.13, Flask, Flask-SocketIO (Echtzeit über WebSockets) |
| Frontend | Vanilla JavaScript, HTML Canvas 2D für die Karte |
| 3D-Würfel | Three.js + cannon-es (Physik), eigene Engine |
| Datenspeicherung | JSON-Dateien (kein Datenbankserver) |
| Desktop | Tauri als dünne Hülle + PyInstaller-gebündelter Server |

**Architektur-Grundsatz:** Der Flask-Server ist der Kern und die einzige Wahrheit. Die Desktop-App ist nur eine Brücke, die auf den Server wartet und dorthin weiterleitet. Der Server ist die Autorität über alle Spielzustände (auch über Würfelsummen).

### Ordnerstruktur

```
dnd_v2/
├── app.py               Einstiegspunkt (startet Server)
├── config.py            Einstellungen / Umgebungsvariablen
├── game_state.py        Zentraler Zustand, Laden/Speichern, Benutzer
├── dice.py              Würfelformel-Parser + Physik-Fluss (plan/assemble)
├── backup.py            Automatische Sicherungen
├── routes/
│   ├── pages.py         HTML-Seiten (/, /menu, /play, /dice …)
│   ├── api.py           REST-Endpunkte (Login, Sessions, Bibliothek, Uploads, Updates)
│   └── sockets.py       Alle Echtzeit-Ereignisse (62 Socket-Events)
├── templates/           HTML-Seiten (login, menu, index, table, dice, builder, library)
├── static/
│   ├── js/              Frontend-Module (siehe unten)
│   ├── lib/             three, cannon-es, RoomEnvironment, socket.io (alles lokal)
│   ├── css/, fonts/     Styles und lokal eingebundene Schriften
├── data/                characters.json, library/ (Regelwerk-Einträge); zur Laufzeit
│                        entstehen hier users.json und sessions.json
├── desktop/             Tauri-Projekt für die Desktop-App
├── AENDERUNGEN.txt      Ausführliches Änderungsprotokoll
└── UEBERGABE.md         Dieses Dokument
```

### Die Frontend-Module (`static/js/`)

| Datei | Aufgabe |
|---|---|
| `state.js` | Gemeinsamer Client-Zustand (`State`) |
| `socket.js` | Socket-Verbindung, verteilt Server-Ereignisse als `dnd:*`-Events |
| `map.js` | Karte, Raster, Zeichnen, Nebel, Wände/Türen |
| `tokens.js` | Spielfiguren auf der Karte |
| `chat.js` | Chat, Würfelbefehle (`/r`, `/gm`), Multiplayer-Würfelfluss |
| `character.js` | Charakterbögen |
| `inspector.js` | DM-Inspektor (Bogen, Angriffe, Inventar; Ansehen/Bearbeiten) |
| `modals.js` | Dialogfenster, u.a. Würfel-Dialog |
| `dialog.js` | Eigenes Dialogsystem (ersetzt alle Browser-Popups) |
| `journal.js`, `notes.js` | Tagebuch und Notizen |
| `weather.js` | Wettereffekte |
| `ui.js` | Allgemeine Oberflächenlogik |
| `dice3d.js`, `dice-geometry.js`, `dice-material.js`, `dice-sound.js` | 3D-Würfelsystem (siehe Kapitel 5) |

---

## 4. Was im Programm vorhanden ist

Die folgenden Funktionen sind implementiert und wurden in früheren Arbeitsrunden von Thomas im Spielbetrieb getestet. In der letzten Sitzung (30.09.) habe ich zusätzlich geprüft, dass **alle Python- und JavaScript-Dateien syntaktisch fehlerfrei sind und der Server sauber startet** (alle Seiten und Skripte werden ausgeliefert). Einen vollständigen Klick-Test aller Funktionen gab es in dieser Sitzung nicht.

**Konten & Sitzungen:** Registrierung, Login, Gastzugang, „Gerät merken" (Cookie, 90 Tage), Profil bearbeiten. Kampagnen/Sitzungen anlegen, beitreten (mit optionalem DM- bzw. Spielerpasswort), einladen/ausladen, klonen, löschen. Menü mit Spielen/Einstellungen/Updates/Beenden. Update-Prüfung und -Download über die API.

**Karte:** Mehrere Karten mit Ordnerstruktur, Kartenbilder hochladen, Raster-Einstellungen pro Karte, Vorschau für den DM, Karten vorladen. Wände und Türen (auf/zu), Nebel des Krieges (aufdecken/verdecken), Zeichnen, Pings, Wettereffekte.

**Figuren & Sicht:** Token erstellen/bewegen/bearbeiten, Sichtweiten pro Figur, Erkundungs-Reset.

**Kampf:** Initiative-Leiste mit Rundenzähler, Gegner anlegen/in Ordnern verwalten/auf die Karte setzen/zur Initiative hinzufügen, Angriffswürfe (Angriffe anlegen ist dem DM vorbehalten), Status-Effekte mit Rundenverfolgung (an die Initiative gekoppelt).

**Charaktere & Spieler:** Charakterbögen und Charakter-Builder, Spielerliste (Roster) mit Kick, Figur setzen, Charakteränderungen, die der DM freigeben oder ablehnen kann. DM-Inspektor-Panel.

**Weiteres:** Chat mit Würfelbefehlen und geheimen DM-Würfen, Handouts, Journal, Notizen, Regel-Bibliothek (Zustände, Talente u.a. unter `data/library/`), automatische Backups, manuelles Speichern.

**Behobener Stabilitätsfehler:** Wenn der DM die Verbindung verlor, wurde die Sitzung früher automatisch privat geschaltet – das ist behoben.

---

## 5. Das 3D-Würfelsystem (Hauptbaustelle)

Hier lag in den letzten Monaten der Schwerpunkt, und hier sitzen auch die offenen Fehler. **Thomas' ausdrückliche Priorität: zuerst müssen die Würfel vollständig korrekt funktionieren, bevor irgendetwas anderes angefasst wird.**

### 5.1 Geschichte – warum es so aussieht, wie es aussieht

Es gab drei Anläufe. Das zu wissen, spart dir Umwege:

1. **Erste eigene Engine** (`dice3d.js.old-selfmade`) – selbst generierte Würfel, aber W4, W10 und W100 waren fehlerhaft.
2. **Umstieg auf die Bibliothek `@3d-dice/dice-box`** (Babylon.js/Ammo.js), später mit eigener Three.js-Engine um deren Modelle herum (`dice-engine.js`). Wurde aufgegeben, weil: nur zwei Materialtypen, keine echte Transparenz, keine frei drehbare Vorschau, und vor allem saßen die Zahlen aus deren Textur-Atlas nie zuverlässig auf den Flächen.
3. **Aktueller Stand: komplett eigene Engine**, bei der Form, Zahlen und Materialien vollständig per Code erzeugt werden. Grundlage waren die bereits vorhandenen, sehr guten Bausteine `dice-geometry.js` und `dice-material.js`; die Haupt-Engine `dice3d.js` wurde neu geschrieben.

### 5.2 Die drei (vier) Dateien

| Datei | Inhalt | Wo du ansetzt |
|---|---|---|
| `dice-geometry.js` | Erzeugt die 7 Würfelformen als echte mathematische Körper (Tetraeder, Würfel, Oktaeder, pentagonales Trapezoeder für W10/W100, Dodekaeder, Ikosaeder). Liefert sichtbare Geometrie mit UV-Koordinaten pro Fläche, den Physik-Collider und Flächendaten (Normale, Mittelpunkt, Ecken). | Formen, Proportionen (`_trapezohedron`, `ringY`), Collider (`buildPhysicsShape`) |
| `dice-material.js` | Zeichnet pro Fläche eine eigene Canvas-Textur: Zahl (Schrift, Farbe, Größe, Umrandung), Muster, Farbverlauf, Rahmen. 7 Oberflächen (Kunststoff, Metall, Glas, Kristall, Stein, Marmor, Holz) mit prozeduraler Struktur. Sonderfälle: eingravierte Zahlen, leuchtende Zahlen bei Glas, W4 mit Zahlen an den Ecken. | Aussehen (`SURFACES`, `PATTERNS`, `PRESET_COLORS`, `makeFaceTexture`, `makeD4FaceTexture`, `_labelsFor`) |
| `dice3d.js` | Die Engine: Szene, Licht, Physikwelt, Wurf, Ergebnis-Erkennung, Werkstatt-Vorschau, Ergebnis-Popup, Sets/Styles, öffentliche Schnittstelle `Dice3D`. In nummerierte Abschnitte 0–10 gegliedert. | Physik, Kamera, Wurfgefühl, Ergebnislogik |
| `dice-sound.js` | Würfelgeräusche | – |

Einbinden müssen die Seiten die Skripte **in dieser Reihenfolge**: `three.min.js` → `cannon-es.min.js` → `RoomEnvironment.js` → `dice-sound.js` → `dice-geometry.js` → `dice-material.js` → `dice3d.js`. So ist es in `templates/table.html` (Spieltisch) und `templates/dice.html` (Würfel-Werkstatt) umgesetzt.

**Stellschrauben:** Alle Werte, an denen man gefahrlos drehen kann, sind im Code mit `«STELLSCHRAUBE»` markiert – vor allem Abschnitt 0 in `dice3d.js` (Würfelgröße, Schwerkraft, Wandabstände, Kamerahöhe, Ruhe-Erkennung) sowie die Tabellen `PHYSICS` (Reibung/Sprungkraft/Dämpfung pro Würfeltyp) und `THROW_POWER` (Wurfkraft pro Würfeltyp).

### 5.3 Öffentliche Schnittstelle (`Dice3D`)

```
Dice3D.roll(diceList, meta, onComplete, opts)
    diceList   [{sides, value?}]   value = Zielzahl (W100 als 1–100)
    meta       {total?, formula?, label?}  – für das Ergebnis-Popup
    onComplete Rückruf, wenn alle Würfel liegen
    opts       {seed?, suppressPopup?}
Dice3D.preview(sides, style, canvas) / stopPreview(canvas)
Dice3D.testRoll(sides)                 Testwurf ohne Zielzahl
Dice3D.showFinalResult({total, formula, label})
Dice3D.getSets / getActiveSet / setActiveSet / saveSet / deleteSet / newSet
Dice3D.setEnabled / isEnabled / preload
```

### 5.4 Ergebnis-Logik: „Server entscheidet, Physik zeigt" (seit 30.09.)

1. Der Server würfelt (`dice.roll`, `secrets.SystemRandom`) und sendet `dice_playback` mit Zahlen und `seed` an alle (geheime Würfe nur an den Werfer).
2. Jeder Client simuliert den Wurf unsichtbar komplett durch (`_simulate` in `dice3d.js`, fester 120-Hz-Takt), zeichnet jede Position auf und verwirft Versuche, bei denen ein Würfel schief liegt oder nicht zur Ruhe kommt.
3. `DiceGeometry.symmetry(sides, von, nach)` liefert eine Drehung, die den Körper auf sich selbst abbildet und das Zielmerkmal (Fläche, beim W4 Ecke) auf das tatsächlich oben gelandete. Diese Drehung wird beim Abspielen an jede Frame-Drehung angehängt: Die Bewegung ist exakt die berechnete Physik, nur die Beschriftung ist mitgedreht.

Die Beschriftung je Fläche kommt aus **einer** Quelle: `DiceGeometry.build(sides).values`. Material und Ergebnis-Erkennung lesen beide daraus – die frühere Fehlerquelle „Labels passen nicht zu `_faceIndexToValue`" gibt es nicht mehr.

### 5.5 Stellschrauben

Abschnitt 0 in `dice3d.js` (Größe, Schwerkraft, Kamera, Haltezeit), `PHYSICS` und `THROW_POWER` (Abschnitt 5, Rollgefühl je Würfel), in `dice-material.js` `RES` (Texturauflösung), `EDGE_STYLES` und die Zahlengröße in `_drawNumbers`.

### 5.6 Prüfstand (30.09.)

- 1.475 simulierte Würfe über alle sieben Würfeltypen: 0 falsche Ergebnisse, alle flach gelandet, 1–6 ms Rechenzeit pro Wurf.
- Browsertest mit echtem Server: ein Klick → Würfel rollen sofort; Chat, Popup und Würfel zeigen dieselben Zahlen.
- Screenshots (Headless-Chrome mit SwiftShader, Flags `--use-angle=swiftshader --enable-unsafe-swiftshader`) funktionieren und wurden angesehen.

### 5.7 Teuer erkaufte Erkenntnisse (bitte nicht wiederholen)

- **Wände in cannon-es:** Eine `CANNON.Plane` blockiert den Halbraum *entgegen* ihrer Normale – Wandnormalen müssen nach innen zeigen.
- **Collider:** eindeutige Eckpunkte, nach außen gewickelte Flächen.
- **Broadphase:** `NaiveBroadphase` statt `SAPBroadphase`.
- **Flächennormale ≠ Mittelpunkt-Richtung** bei nicht-regelmäßigen Körpern (W10: 19,5° Abweichung).
- **Textur-v zeigt nach oben, Canvas-y nach unten** – beim Zeichnen an UV-Positionen immer umrechnen.
- **Nie nachträglich einrasten:** Vorab simulieren und per Symmetrie umbeschriften.
- **`RoomEnvironment.js`** setzt `THREE.RoomEnvironment` global (kein ES-Modul).
- **Keine CDN-Links:** alles unter `static/lib/` ablegen, sonst ist das Programm nicht offline-fähig.

## Design-System (seit 01.10.2026)

Drei unabhängige Bereiche: **Oberfläche** (`data-ui-theme`), **Spieltisch** (`data-table-theme`), **Würfel** (Sets/Vorlagen). Alle Farben und Schriften laufen über Variablen in `static/css/themes.css`, gesteuert von `static/js/theme.js`; Auswahl im Design-Studio (`static/js/design-studio.js`).

Regeln für neuen Code:
- **Keine festen Farben** in CSS oder `style="…"`. Immer `var(--gold)`, `rgba(var(--gold-rgb),.3)` usw. (Rollen der Variablen: Kopf von `themes.css`).
- Canvas-Zeichnungen (Karte) lesen Tischfarben über `Theme.tableVars()` und zeichnen bei `window`-Ereignis `vtt:theme` neu.
- Schrift auf Akzentflächen: `var(--on-accent)`. Schwebende Panels über der Karte: `rgba(var(--panel-rgb),.85)`. Abdunkeln hinter Dialogen: `rgba(var(--shade-rgb),.6)`.
- Jede Änderung in mindestens einem dunklen Design UND „Pergament" (hell) prüfen.

Nächste Schritte siehe `KONZEPT-ERWEITERUNGEN.md`.

## Inhaltspakete & Quellen (seit 01.10.2026)

Jeder Bibliotheks-Eintrag hat `source` (`basis`, `eigene` oder eine Paket-Id). Logik in `packs.py`, Oberfläche in `static/js/pack-manager.js`, DM-Auswahl pro Kampagne im DM-Reiter (`session["packs"]`, `null` = alle aktiven). Geteilt wird nur per Datei, es gibt keinen öffentlichen Katalog.

Regeln für neuen Code:
- Alles, was Spielern Inhalte zur Auswahl anbietet, lädt `/api/library?session=<id>` (ohne Kampagne `?active=1`). Nur die Bibliotheks-Verwaltung lädt ungefiltert.
- Neue Verweise zwischen Einträgen (wie `parent_class`) zusätzlich als Namen speichern und in `packs._relink` auflösen – IDs sind auf jedem Rechner anders.
- Neue Bibliotheks-Kategorien in `game_state.LIBRARY_CATEGORIES` und `PackManager.CAT_LABEL` eintragen.

## Besitzer-Prinzip (seit 01.10.2026)

Jede Installation gehört einer Person. Verwaltende Endpunkte rufen `_owner_guard()` auf (nur Zugriff vom eigenen PC, abschaltbar mit `VTT_OWNER_ONLY=0`). Die Oberfläche fragt `/api/server/info` → `is_owner` ab und blendet Verwaltung für Netzwerk-Gäste aus.

Regel für neuen Code: **Jeder neue Endpunkt, der Daten der Installation verändert (Bibliothek, Pakete, Kampagnen, Einstellungen), braucht `_owner_guard()`.** Ausnahmen sind nur Dinge, die dem Spieler selbst gehören (seine Charaktere, seine Spielzüge am Tisch).

Charaktere: `content_refs` (Quelle von Rasse/Klasse/Unterklasse/Hintergrund) werden beim Speichern gesetzt (`packs.annotate_character`), Prüfung gegen eine Kampagne mit `packs.check_character`.

## Launcher & Updates (seit 01.10.2026)

Die App startet mit dem Launcher (`desktop/src/index.html`): Pflicht-Update über GitHub Releases, danach „Eigenes Spiel" oder „Mitspielen". Einrichtung und Veröffentlichen: **UPDATES.md**. Versionsnummer nur noch mit `python tools/release.py X.Y.Z` ändern.

Persönliche Einstellungen (Würfel-Sets, Designs) spiegelt `theme.js` auf der eigenen Installation nach `/api/profile`. Der Launcher übergibt sie beim Mitspielen samt Charakteren per `#vttprofile=…`. **Neue persönliche localStorage-Schlüssel müssen in `PROFILE_KEYS` (theme.js UND routes/api.py) eingetragen werden**, sonst reisen sie nicht mit.

## Rechtliches: Was ins Repository darf (seit 01.10.2026)

Das Repository und damit der öffentliche Installer enthalten **nur SRD-5.1-Inhalte** (CC-BY-4.0, Namensnennung in `LIZENZ-SRD.txt`). Inhalte aus dem Player's Handbook oder anderen Büchern werden **nur privat als `.vttpack`** geteilt und gehören nie in `data/library` oder die `_DEFAULT_*`-Listen in `routes/api.py`. Neue Grundregel-Inhalte erreichen bestehende Installationen automatisch (`packs._sync_basis`).

## Aufteilung Launcher / Spiel (seit 03.10.2026)

**Jede Einstellung gibt es nur an einer Stelle.** Der Launcher *verwaltet* (Erweiterungen an/aus, importieren, exportieren; Würfel-Sets und Designs ein-/ausblenden, importieren, exportieren). Das Spiel *benutzt und bearbeitet* (Kampagnen, Mitspielen, Charaktere, Bibliothek im Detail, Würfel-Werkstatt, Design-Studio). Neue Funktionen bitte genau einer Seite zuordnen.

Würfel-Sets und Designs liegen im Profil der Installation (`/api/profile`, `data/profile.json`); Seiten bekommen es per `window.__VTT_PROFILE__`. Verwaltende Anfragen des Launchers senden `X-VTT-App: 1`.

## Designs (seit 03.10.2026)

Designs sind Dateien (`.vttdesign`, Logik in `static/js/design-runtime.js`). Eingebaut sind nur Arkanum und Arkaner Tisch (`themes.css`); alle weiteren liegen im Katalog `designs/` (+ `designs/index.json`) und werden im Launcher heruntergeladen. **Neues Katalog-Design:** Datei in `designs/` legen, Eintrag in `index.json`, pushen – fertig, ohne App-Update. Erlaubte Variablen stehen in `DesignRuntime.UI_VARS`/`TABLE_VARS`.

## Animationen, Klänge, Symbole (seit 03.10.2026)

`fx.js`/`fx.css` hängen sich automatisch an Knöpfe, Fenster, Listen, Chat und Spieltisch. Eigene Ereignisse: `vtt:hp` (Schaden/Heilung), `vtt:crit` (kritisch/Patzer). Klänge entstehen in `sfx.js` (keine Dateien). Emojis in Bedienelementen ersetzt `icons.js` durch Lucide-Symbole – **neue Symbole dort in ICONS/EMOJI ergänzen**. `sfx.js` und `icons.js` liegen zusätzlich als identische Kopie in `desktop/src/` (Launcher) – bei Änderungen beide anpassen.

## Startbildschirm & Spieltisch-Layout (seit 03.10.2026)

Hauptmenü und Spielen-Seite sind ein Startbildschirm (`templates/index.html`, Routen `/`, `/menu`, `/play`). `menu.html` gibt es nicht mehr. Am Spieltisch verschiebt ein Skript in `table.html` die Werkzeuggruppen aus der Kopfzeile in `#tool-dock`; das Aussehen steht in `static/css/table-layout.css`. **Neue Werkzeuge** einfach wie bisher als `.tb-btn` in eine `.tb-group` der Kopfzeile schreiben – sie landen automatisch im Dock. **Neue Reiter** als `.p-tab` mit `.t-icon` und Beschriftung anlegen – die Beschriftung wird zum Tooltip der Schiene.

## 6. Was als Nächstes zu tun ist

### Priorität 1 – Würfel: erledigt am 30.09. (siehe AENDERUNGEN.txt)

Offen: Angriffs- und Rettungswürfe aus Charakterbogen/Inspektor werden noch nicht in 3D gezeigt; Rollgefühl auf echter Hardware abnehmen.

### Priorität 2 – geplante Funktionen (aus früheren Planungen)

- Nebel des Krieges mit dynamischer Sichtweite der Spieler
- Status-Effekt-Symbole direkt an den Token
- Multi-Karten-Verwaltung weiter ausbauen (Ordnerstruktur)
- Entfernungsmessung in 5-Fuß-Schritten mit sichtbarer Rückmeldung
- Charakter-Porträts hochladen
- Rasterfarbe und -stärke pro Karte einstellbar
- Linkes Seitenpanel ein-/ausklappbar und in der Breite veränderbar

### Kleinere Aufräumarbeiten

- `README.md` ist teilweise veraltet (beschreibt eine frühere, kleinere Projektstruktur) und sollte an dieses Dokument angeglichen werden.

---

## 7. Arbeitsweise & Konventionen

Damit der Code einheitlich bleibt und Thomas gut mitarbeiten kann:

- **Sprache:** Alles auf Deutsch – Oberflächentexte, Kommentare, Dokumentation.
- **Kommentare:** Ausführlich und erklärend, gern mit dem *Warum* (viele Kommentare dokumentieren, welcher frühere Fehler an der Stelle behoben wurde).
- **Größere Dateien** in nummerierte Abschnitte gliedern (Vorbild: `dice3d.js`, Abschnitte 0–10 mit `══`-Balken).
- **Einstellbare Werte** mit `«STELLSCHRAUBE»` markieren.
- **Jede Änderung** oben in `AENDERUNGEN.txt` eintragen (was, warum, wie geprüft).
- **Vorgehen bei Änderungen:** erst den Code durchsuchen und verstehen, dann gezielt ändern, danach Syntax prüfen (`node -c datei.js` bzw. `python -c "import ast; ast.parse(open('datei.py').read())"`).
- **Vor dem Weitergeben:** Testseiten und Testdateien entfernen und keine Laufzeitdaten mitgeben (`data/users.json`, `data/sessions.json`, `uploads/`, `backups/`, `__pycache__/`).
- **Design-Entscheidungen** mit Thomas absprechen statt raten. Er testet gesammelt nach einer Arbeitsrunde und meldet Fehler meist mit Screenshots oder Videos.
