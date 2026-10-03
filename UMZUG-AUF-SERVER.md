# Umzug auf einen gemieteten Server

Während der Entwicklung ist **dein PC der Server**. Wenn du später einen echten
Server mietest, ziehst du das Programm mit wenigen Schritten um. Am Code selbst
ändert sich dabei **nichts** – nur die Konfiguration.

## Der Grundgedanke

Alle Einstellungen, die vom Standort des Servers abhängen, stehen zentral in
`config.py` und lassen sich über **Umgebungsvariablen** überschreiben. Der Code
liest immer aus der Config – egal ob dein PC oder ein Mietserver.

## Während der Entwicklung (jetzt)

Einfach starten:

```
python app.py
```

Es läuft im Entwicklungsmodus. Standard-Login: `Thomas / thomas`.
Andere Geräte im selben WLAN können über die angezeigte Adresse mitspielen.

## Später: Umzug auf den Mietserver

1. **Server mieten** (kleiner VPS, ca. 4–5 €/Monat) und Python installieren.
2. **Projektordner hochladen** (das komplette Verzeichnis, inklusive `data/`
   und `uploads/`, wenn bestehende Daten mitkommen sollen).
3. **Umgebungsvariablen setzen** (statt `config.py` zu bearbeiten):

   | Variable            | Beispielwert                    | Bedeutung                          |
   |---------------------|---------------------------------|------------------------------------|
   | `VTT_MODE`          | `production`                    | schaltet in den Server-Modus       |
   | `VTT_PUBLIC_URL`    | `https://vtt.meinedomain.de`    | die öffentliche Adresse            |
   | `VTT_PORT`          | `8080`                          | Port (je nach Server)              |
   | `VTT_SECRET_KEY`    | `<langer Zufallswert>`          | sichert die Anmeldungen ab         |
   | `VTT_OPEN_BROWSER`  | `false`                         | kein Browser auf dem Server        |
   | `VTT_BACKUP_KEEP`   | `14`                            | wie viele Backups aufbewahrt werden|
   | `VTT_BACKUP_INTERVAL_HOURS` | `24`                    | Backup-Abstand (24 = täglich)      |
   | `VTT_UPDATE_DOWNLOAD_URL` | `https://.../download`    | Download-Seite für App-Updates     |

## Datensicherung (Backups)

Der Server erstellt automatisch tägliche Backups des `data/`-Ordners im
Unterordner `data/backups/` (als Zip-Archive mit Zeitstempel). Es werden
standardmäßig die letzten 14 Sicherungen aufbewahrt, ältere automatisch
gelöscht.

**Empfehlung für den echten Server:** Kopiere die Backups zusätzlich
regelmäßig an einen anderen Ort (z. B. per automatischem Cloud-Sync), damit
sie auch bei einem Totalausfall des Servers erhalten bleiben.

## App-Updates

Die App prüft beim Start über `/api/server/check_update`, ob eine neuere
Version verfügbar ist. Erhöhst du die Version (in `routes/api.py` die Variable
`APP_VERSION` und in `desktop/src/index.html` die Variable `APP_VERSION`) und
setzt `VTT_UPDATE_DOWNLOAD_URL`, sehen alle Nutzer beim Start den Hinweis
"Eine neue Version ist verfügbar".

4. **Starten** – fertig. Der Server ist jetzt öffentlich erreichbar.

## Wichtig für den echten Betrieb

- **Backups**: Da nun alle Daten zentral liegen, richte ein tägliches Backup
  des `data/`-Ordners ein.
- **Secret Key**: Unbedingt einen eigenen, zufälligen `VTT_SECRET_KEY` setzen.
- Die App (Startbildschirm) fragt `/api/server/info` ab und erkennt darüber,
  mit welchem Server sie verbunden ist.
