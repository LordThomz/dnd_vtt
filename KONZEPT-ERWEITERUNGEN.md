# Konzept: Designs, Inhaltspakete, Launcher & Updates

Stand: 01.10.2026 · Status: Designs und Inhaltspakete umgesetzt, Launcher geplant

---

## 1. Designs (umgesetzt)

Drei unabhängige Bereiche, jeder Spieler wählt **lokal** im Design-Studio (🎨 am Spieltisch, Einstellungen im Hauptmenü):

| Bereich | Was sich ändert | Technik |
|---|---|---|
| Oberfläche | Menüs, Panels, Dialoge, Chat, Schriften, Radien | `data-ui-theme` auf `<html>`, Variablen in `themes.css` |
| Spieltisch | Hintergrund, Standard-Raster, Nebel, Lineal | `data-table-theme`, `map.js` liest die Werte über `Theme.tableVars()` |
| Würfel | Würfel-Sets (Vorlagen + Werkstatt) | `dice-presets.js`, `dice3d.js` |

Dazu **Komplett-Designs**, die alle drei aufeinander abstimmen (Arkanum, Schattenfeste, Pergament, Neonsphäre, Mondwald).

Ein neues Design braucht nur einen Variablen-Block in `themes.css` und einen Eintrag in `theme.js`. Damit lassen sich Designs später auch als **Inhaltspaket** verteilen (siehe 2.).

---

## 2. Inhaltspakete (`.vttpack`)

### Was ist ein Paket?
Eine ZIP-Datei mit der Endung `.vttpack`:

```
mein-paket.vttpack
├── manifest.json        Name, Version, Autor, Inhalt, Abhängigkeiten
├── library/             Klassen, Rassen, Unterklassen, Talente, Gegenstände …
│   ├── classes/*.json
│   └── subclasses/*.json
├── dice/*.json          Würfel-Sets
├── themes/*.json        Designs (nur Farb-/Schrift-Variablen, kein Code)
├── sounds/              Geräusche, Musik
└── maps/                Karten + Bilder
```

```json
{
  "id": "thomas.schattenreich",
  "name": "Schattenreich",
  "version": "1.2.0",
  "author": "Thomas",
  "description": "Neue Rassen und Unterklassen für eine düstere Kampagne",
  "contains": ["library", "dice", "themes"],
  "requires": { "app": ">=0.3.0", "packs": ["srd-5.1"] }
}
```

### Ordnung in der Bibliothek (dein wichtigster Punkt)
- Jeder Eintrag bekommt ein Feld **`source`** = Paket-Id. Nichts wird vermischt.
- Die Bibliothek bekommt einen **Quellen-Filter** (wie die Buch-Auswahl bei D&D Beyond): „SRD 5.1 ✓, Schattenreich ✓, Homebrew von Carlos ✗".
- **Pro Kampagne** legt der DM fest, welche Pakete erlaubt sind. Spieler sehen im Charakter-Builder nur diese. So bleibt es auch bei vielen Paketen übersichtlich.
- Pakete lassen sich jederzeit an-/abschalten oder entfernen, ohne dass Einträge anderer Pakete verloren gehen.
- Bei Konflikten (gleiche Id in zwei Paketen) gewinnt nichts stillschweigend – der Import zeigt den Konflikt an.

### Teilen unter Spielern
- **Exportieren:** In der Bibliothek Einträge auswählen → „Als Paket exportieren" → `.vttpack`-Datei.
- **Importieren:** Datei in den Launcher ziehen oder doppelklicken (Dateiverknüpfung). Vorschau zeigt den Inhalt, dann „Installieren".
- Würfel-Sets können zusätzlich einzeln exportiert werden (eine kleine `.vttdice`-Datei).

### Entscheidung: kein öffentlicher Katalog (01.10.2026)
Inhalte werden nur als Datei unter den Spielern geteilt. Das hält die Verantwortung für Buch-Inhalte im privaten Kreis und braucht keinerlei Server. Ein Katalog ließe sich später ergänzen (GitHub-Repository mit `index.json`) – das Paket-Format ist darauf vorbereitet.

---

## 3. Besitzer-Modell & Launcher (festgelegt 01.10.2026)

**Grundsatz:** Jede Installation gehört genau einer Person. Nur sie verwaltet Bibliotheken, Pakete, Würfel-Sets, Designs, Charaktere und Kampagnen. Geteilt wird ausschließlich per Datei.

| Rolle | Was passiert | Status |
|---|---|---|
| Besitzer am eigenen PC | darf alles verwalten | ✅ (`config.OWNER_ONLY`, `_owner_guard`) |
| Über das Netzwerk verbunden | spielt mit, sieht die Bibliothek nur an, kann Pakete herunterladen | ✅ |
| DM | wählt pro Kampagne, welche seiner Pakete gelten | ✅ |
| Spieler bringt Charakter mit | `.vttchar`-Datei → Prüfung gegen die Kampagne → bei fehlenden Inhalten klare Meldung mit Paketname, sonst Beitritt | ✅ |

**Wie Inhalte zwischen Installationen zusammenpassen:** Charaktere verweisen per **Name** auf Rasse, Klasse, Unterklasse und Hintergrund und merken sich zusätzlich die Quelle (`content_refs`). Der DM-Server sucht den Namen in den für die Kampagne freigegebenen Inhalten. Selbst erstelltes Homebrew des Spielers passt deshalb auch, wenn es beim DM als importiertes Paket liegt.

### Was der Launcher dafür noch lösen muss
1. **Persönliches läuft mit.** Würfel-Sets und Designs liegen im Browser-Speicher, und der ist an die Server-Adresse gebunden. Verbindet sich ein Spieler mit dem DM, wären seine Würfel dort zunächst weg. Der Launcher übergibt sie deshalb beim Beitreten an das Spielfenster.
2. **Charakter ohne Datei-Hin-und-her.** Der Launcher liest die eigenen Charaktere aus der lokalen Installation und reicht den gewählten direkt an die Kampagne weiter (gleiche Prüfung wie beim Datei-Import).
3. **Start:** Launcher → Update-Prüfung → „Spielen" (eigener Server, als DM) oder „Beitreten" (Adresse des DM).
4. **Updates (Pflicht):** Beim Start prüft der Launcher GitHub Releases und installiert eine neue Version ohne Nachfrage.

---

## 4. Updates über GitHub Releases

Tauri hat dafür ein offizielles **Updater-Plugin**. Der Ablauf:

1. Du erhöhst die Versionsnummer und lädst den Code zu GitHub hoch (`git push` mit Versions-Tag).
2. Eine **GitHub Action** baut automatisch den Windows-Installer und veröffentlicht ihn als Release, samt einer kleinen `latest.json` und einer digitalen Signatur.
3. Jeder Launcher prüft beim Start `latest.json`. Ist eine neue Version da: Knopf „Aktualisieren".
4. Die Signatur stellt sicher, dass nur **deine** Updates installiert werden, niemand kann ein manipuliertes Update unterschieben.

Vorteile gegenüber dem bisherigen Weg (`UPDATES-HERAUSGEBEN.md`, Updates vom eigenen PC über Tailscale): Dein PC muss nicht laufen, der Build passiert automatisch, und die Updates sind signiert.

### Was du dafür einmalig tun musst (ich führe dich Schritt für Schritt)
1. GitHub-Konto anlegen (kostenlos).
2. Repository `dnd-vtt` anlegen und das Projekt hochladen (GitHub Desktop, ohne Kommandozeile).
3. Einen Signatur-Schlüssel erzeugen (ein Befehl) und als „Secret" im Repository hinterlegen.
4. Fertig. Ab dann reicht pro Update: Version erhöhen → in GitHub Desktop „Push" → Release anlegen.

Ob das Repository öffentlich oder privat ist, ist egal. Für öffentliche Repositories sind die Build-Minuten unbegrenzt kostenlos, für private gibt es ein monatliches Freikontingent.

---

## 5. Reihenfolge der Umsetzung

1. ✅ Würfel-Engine V3, Offline-Fix
2. ✅ Design-System (5 Oberflächen, 5 Tische, 10 Würfel-Vorlagen, Design-Studio)
3. ✅ Bibliothek: `source`-Feld, Quellen-Filter, Pakete pro Kampagne
4. ✅ Paket-Format: Export/Import `.vttpack` (inkl. Würfel-Sets)
5. ✅ Besitzer-Prinzip, Charakter mitbringen mit Inhalts-Prüfung
6. ✅ Launcher + Pflicht-Updates über GitHub (Code fertig, Einrichtung siehe UPDATES.md)
7. ⬜ Design-Feinschliff aller Seiten (Builder, Bibliothek, Charakterbogen)
