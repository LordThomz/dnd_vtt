# ⚔️ D&D – Virtual Tabletop

Modernes, projektorientiertes DnD-Tabletop als lokaler Webserver.

## 🚀 Start

```bash
# 1. Abhängigkeiten installieren
pip install flask flask-socketio pillow

# 2. Starten
python app.py
```

Browser öffnet sich automatisch auf **http://localhost:5000**

---

## 🌐 Mitspieler einladen (lokales Netzwerk)

```
http://DEINE-IP:5000
```
IP mit `ipconfig` (Windows) oder `ifconfig` (Mac/Linux) herausfinden.

---

## 📁 Projektstruktur

```
dnd_v2/
├── app.py                  # Einstiegspunkt – startet Server + Browser
├── game_state.py           # Zentraler In-Memory-State
├── dice.py                 # Würfelparser (Breakdown-Unterstützung)
├── requirements.txt
│
├── routes/
│   ├── pages.py            # HTML-Seitenrouten (/ und /table/<id>)
│   ├── api.py              # REST-Endpunkte (Sessions, Uploads)
│   └── sockets.py          # Alle Socket.IO-Events
│
├── templates/
│   ├── index.html          # Startseite (Session erstellen / beitreten)
│   └── table.html          # Spielfeld-Interface
│
├── static/
│   ├── css/
│   │   ├── base.css        # Design-Tokens, Reset, geteilte Komponenten
│   │   ├── index.css       # Stile für Startseite
│   │   └── table.css       # Stile für Spielfeld
│   └── js/
│       ├── state.js        # Gemeinsamer Client-State
│       ├── socket.js       # Socket.IO Events → CustomEvents
│       ├── map.js          # Karte, Viewport, Fog, Vision, Zeichnen
│       ├── tokens.js       # Token-Rendering und Drag & Drop
│       ├── chat.js         # Chat und Würfel-Breakdown
│       ├── character.js    # Charakterbogen + Angriffe
│       ├── modals.js       # Alle Modal-Dialoge
│       └── ui.js           # Tabs, Toast, ContextMenu, Toolbar, etc.
│
└── uploads/
    ├── maps/               # Hochgeladene Kartenbilder
    └── tokens/             # Hochgeladene Token-Bilder
```

---

## 🎮 Features

| Feature | Beschreibung |
|---|---|
| 🗺️ Virtuelle Karte | Kartenbilder hochladen, Zoom, Pan, Raster |
| 🌫️ Fog of War | DM verdeckt/zeigt Bereiche (nur DM!) |
| 💡 Dynamische Sichtweite | Spieler sehen nur ihren Sichtradius (in ft) |
| 🧙 Tokens | HP-Balken, Zustände, Sichtweite, Drag & Drop |
| 🎲 Würfelsystem | Vollständiger Breakdown: jeder Würfel einzeln |
| ⚔️ Initiative | Automatisch sortiert, Initiative aus Bogen |
| 📋 D&D 5e Charakterbogen | Attribute, Skills, HP, Ausrüstung |
| 🗡️ Angriffe & Zauber | Eigene Angriffsliste, 1-Klick-Würfeln |
| 🐉 Gegner-Editor | DM erstellt Gegner-Templates + Karte spawnen |
| ✏️ Zeichenwerkzeug | DM kann Spielern Zeichnen erlauben/sperren |
| 💬 Echtzeit-Chat | /roll, /gmroll, /me, /w |
| 📜 Handouts | DM teilt Notizen mit allen oder einzelnen |
| 🎵 Jukebox | Eigene Audio-Dateien laden (nur DM) |
| ⚙️ DM-Steuerung | Zeichnen an/aus, Karteneinstellungen |

---

## 🎲 Chat-Befehle

| Befehl | Funktion |
|---|---|
| `/roll 2d6+4` | Öffentlicher Würfelwurf mit Breakdown |
| `/r 1d20` | Kurzform |
| `/gmroll 1d20` | Nur DM sieht das Ergebnis |
| `/me greift an` | Emote / Handlung |
| `/w Flüsternachricht` | Flüstern |

---

## ⌨️ Tastaturkürzel

| Taste | Tool |
|---|---|
| `S` | Auswählen |
| `M` | Karte verschieben |
| `R` | Messen |
| `D` | Zeichnen |
| `P` | Ping/Markierung |
| Scrollrad | Zoom |


## Lizenz der mitgelieferten Regelinhalte

This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License available at https://creativecommons.org/licenses/by/4.0/legalcode.

Die Bibliothek im Repository enthält nur SRD-5.1-Inhalte. Alles andere (z. B. aus dem Player's Handbook) wird ausschließlich privat als Inhaltspaket geteilt – siehe `LIZENZ-SRD.txt`.
