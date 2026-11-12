# Valo Matchlog

Team-Tracker als installierbare Web-App (PWA): Matches eintragen, Statistiken pro Spieler, Map und Gegner ansehen, Clips mit Zeitstempel-Notizen reviewen.

Fan-Projekt, nicht mit Riot Games verbunden.

## Technik

- Reines HTML, CSS und JavaScript (ES-Module), **kein Build-Schritt**.
- Daten und Login über Firebase (Gratisplan „Spark“), Hosting über GitHub Pages.
- Die Firebase-Web-Config in `firebase-config.js` ist öffentlich gedacht. Der Schutz läuft über Login und Firestore-Regeln.

## Lokal testen

1. Doppelklick auf `server-starten.cmd`.
2. Im Browser `http://localhost:8123/` öffnen.
3. Für eine Vorschau mit erfundenen Beispieldaten: `http://localhost:8123/?demo=1`.

Die Seite direkt als Datei zu öffnen (`file://`) funktioniert nicht, weil ES-Module, Service Worker und Login einen Webserver brauchen.

## Aufbau

| Ordner / Datei | Inhalt |
|---|---|
| `index.html` | Grundgerüst der Seite |
| `firebase-config.js` | Einstellungen, füllt der Admin aus |
| `css/app.css` | Gesamtes Aussehen (hell und dunkel) |
| `js/main.js` | Start und Rendern |
| `js/views/` | Die einzelnen Ansichten |
| `js/stats.js` | Berechnungen |
| `js/demo.js` | Beispieldaten für die Vorschau |
| `fonts/` | Schriften Barlow und Chakra Petch (SIL Open Font License, Lizenztexte liegen dabei) |
| `tools/serve.ps1` | Kleiner Webserver zum Testen |
