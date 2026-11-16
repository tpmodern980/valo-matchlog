# ScrimStar

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
| `manifest.webmanifest` | Angaben für die Installation als App (Name, Farben, Icons) |
| `sw.js` | Service Worker: hält die App-Dateien auf dem Gerät (offline), meldet neue Versionen. **Bei jeder Änderung `VERSION` erhöhen** |
| `icons/` | Logo (`logo.svg`, Quelle) und die daraus erzeugten PNG-Icons |
| `tools/icons.html` | Erzeugt die PNG-Icons aus dem Logo (siehe `ANLEITUNG.md`, „Logo austauschen“) |
| `firebase-config.js` | Einstellungen, füllt der Admin aus |
| `ANLEITUNG.md` | Firebase Schritt für Schritt einrichten |
| `firestore.rules` | Zugriffsregeln für die Datenbank (in der Firebase-Konsole einfügen) |
| `css/app.css` | Gesamtes Aussehen (hell und dunkel) |
| `js/main.js` | Start und Rendern |
| `js/pwa.js` | Meldet den Service Worker an, Hinweis „Neue Version – neu laden“ |
| `js/firebase.js` | Lädt das Firebase-SDK vom CDN und startet es |
| `js/auth.js` | Anmeldung und Freischaltung |
| `js/team.js` | Team-Liste (wer die App benutzen darf) |
| `js/views/` | Die einzelnen Ansichten |
| `js/stats.js` | Berechnungen |
| `js/demo.js` | Beispieldaten für die Vorschau |
| `fonts/` | Schriften Barlow und Chakra Petch (SIL Open Font License, Lizenztexte liegen dabei) |
| `tools/serve.ps1` | Kleiner Webserver zum Testen |
