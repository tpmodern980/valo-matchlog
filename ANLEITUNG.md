# Anleitung: Firebase einrichten

Diese Anleitung ist für den Admin, der die App einmal einrichtet. Sie wächst mit den Bau-Etappen. Bisher beschrieben: **Anmeldung und Zugriff**. Screenshot-Auslesen (AI Logic, App Check) und die Installation als App folgen später.

Du brauchst: ein Google-Konto und etwa 15 Minuten. Es kostet nichts. Du musst nirgends eine Kreditkarte angeben. Falls die Konsole ein Upgrade auf „Blaze“ anbietet: ablehnen.

Die Konsole wird ab und zu umgebaut. Heißt ein Knopf bei dir etwas anders, such nach dem ähnlichsten Namen.

## Schritt 1: Projekt anlegen

1. Öffne <https://console.firebase.google.com> und melde dich mit deinem Google-Konto an.
2. Klick auf **Projekt erstellen** (oder „Projekt hinzufügen“).
3. Name: zum Beispiel `valo-matchlog`.
4. **Google Analytics ausschalten** (wird nicht gebraucht). Weitere Angebote, etwa KI-Hilfe in der Konsole, kannst du überspringen.
5. Auf **Projekt erstellen** klicken und kurz warten.

Kontrolle: Unten links in der Konsole steht der Tarif **Spark** (kostenlos). So soll es bleiben.

## Schritt 2: Web-App registrieren

1. Auf der Projektübersicht auf das Symbol **`</>`** (Web) klicken. Falls du es nicht siehst: „App hinzufügen“ und dann „Web“.
2. Spitzname: `Valo Matchlog`.
3. Den Haken bei **Firebase Hosting nicht setzen**.
4. Auf **App registrieren** klicken.
5. Die Konsole zeigt jetzt einen Kasten mit Code. Wichtig ist nur dieser Teil (bei dir stehen andere Werte):

   ```js
   const firebaseConfig = {
     apiKey: "AIza...",
     authDomain: "valo-matchlog-1234.firebaseapp.com",
     projectId: "valo-matchlog-1234",
     storageBucket: "valo-matchlog-1234.firebasestorage.app",
     messagingSenderId: "123456789012",
     appId: "1:123456789012:web:abc123def456"
   };
   ```

   Das sind sechs Zeilen, jede mit einem Namen links und einem Wert in Anführungszeichen rechts. Den Rest des Kastens (`import …`, `initializeApp …`) brauchst du nicht. Steht dort zusätzlich eine Zeile `measurementId`, lass sie weg.

6. Öffne im Ordner `C:\dev\valo-matchlog` die Datei `firebase-config.js` mit dem Editor: **Rechtsklick → „Öffnen mit“ → Editor**. Kein Doppelklick, sonst versucht Windows, die Datei auszuführen.
7. In der Datei stehen dieselben sechs Namen, aber mit leeren Anführungszeichen, zum Beispiel `apiKey: "",`. Kopiere für jede Zeile den Wert aus der Konsole zwischen die Anführungszeichen der Zeile mit demselben Namen. Aus `apiKey: "",` wird also `apiKey: "AIza...",` mit deinem Wert. Das Komma am Zeilenende bleibt stehen.
8. Die Zeilen `recaptchaSiteKey` und `aiModel` nicht anfassen. Datei speichern (Strg+S).

Den Block findest du später wieder unter Zahnrad → **Projekteinstellungen** → Allgemein → „Meine Apps“.

Diese Werte sind keine Geheimnisse und dürfen im öffentlichen Repo stehen. Geschützt wird die App durch die Anmeldung und die Regeln aus Schritt 4. Es kann sein, dass GitHub oder Google dir eine Mail schickt, ein „API key“ sei öffentlich sichtbar. Bei diesem Schlüssel ist das so gewollt.

## Schritt 3: Anmeldung einschalten

1. Links im Menü: **Sicherheit → Authentifizierung** (englisch „Authentication“). Beim ersten Mal auf **Jetzt starten** klicken.
2. Reiter **Anmeldemethode**.
3. **Google** auswählen → aktivieren. „Öffentlicher Name des Projekts“: `Valo Matchlog` (das sehen die Leute im Google-Fenster). Support-E-Mail: deine Adresse auswählen. **Speichern**.
4. **Neuen Anbieter hinzufügen** → **E-Mail-Adresse/Passwort** → nur den **ersten** Schalter aktivieren. „E-Mail-Link (Anmeldung ohne Passwort)“ bleibt aus. **Speichern**.

## Schritt 4: Datenbank anlegen und Regeln einfügen

1. Links im Menü: **Datenbanken und Speicher → Firestore** → **Datenbank erstellen**.
2. Falls gefragt wird: Edition **Standard**. Die Datenbank-ID bleibt **`(default)`** (nur dafür gilt das kostenlose Kontingent).
3. Speicherort: **`eur3 (Europe)`**. Der Ort lässt sich später nicht mehr ändern.
4. Startmodus: **Produktionsmodus** (alles ist erst einmal gesperrt). **Erstellen**.
5. Wenn die Datenbank da ist: Reiter **Regeln**.
6. Den ganzen Text dort löschen und durch den Inhalt der Datei `firestore.rules` aus diesem Repo ersetzen.
7. In den Regeln `ADMIN_EMAIL` durch deine E-Mail-Adresse ersetzen: **komplett kleingeschrieben**, die Anführungszeichen bleiben stehen. Beispiel: `"max.muster@example.com"`. Es muss genau die Adresse sein, mit der du dich in der App anmeldest.
8. **Veröffentlichen**.

Deine echte E-Mail steht damit nur in der Konsole, nicht im Repo.

## Schritt 5: Adresse der App erlauben

1. **Sicherheit → Authentifizierung** → Reiter **Einstellungen** → **Autorisierte Domains**.
2. **Domain hinzufügen**: `tpmodern980.github.io`
3. `localhost` steht schon in der Liste. Das brauchst du für den Test am eigenen Rechner.

## Schritt 6: Ausprobieren

1. Doppelklick auf `server-starten.cmd`, dann <http://localhost:8123/> öffnen.
2. Es erscheint die Seite „Anmelden“. Melde dich mit der Adresse an, die du in Schritt 4 als `ADMIN_EMAIL` eingetragen hast.
3. Beim ersten Mal erscheint „Team anlegen“. Trag dort weitere E-Mail-Adressen ein (oder später unter „Team“) und klick auf **Team anlegen**.
4. Danach siehst du die App mit den Tabs.

Wer nicht auf der Liste steht, sieht nach der Anmeldung die Seite „Noch nicht freigeschaltet“ mit der eigenen Adresse. Diese Adresse trägst du unter „Team“ ein.

## Wenn etwas nicht klappt

| Was du siehst | Woran es meist liegt |
|---|---|
| „Firebase ist noch nicht eingerichtet“ | `firebase-config.js` ist noch leer oder nicht gespeichert (Schritt 2). |
| „Noch nicht freigeschaltet“, obwohl du der Besitzer bist | Die Regeln sind nicht veröffentlicht, oder `ADMIN_EMAIL` stimmt nicht genau mit deiner Adresse überein (Schritt 4: kleingeschrieben, kein Leerzeichen). |
| „Keine Verbindung“, obwohl das Internet geht | Die Firestore-Datenbank ist noch nicht angelegt (Schritt 4). |
| „Diese Anmeldeart ist in Firebase noch nicht eingeschaltet“ | Schritt 3 fehlt für Google oder für E-Mail/Passwort. |
| „… nicht als autorisierte Domain eingetragen“ | Schritt 5 fehlt. |
| Das Google-Fenster geht nicht auf | Der Browser blockiert Pop-ups. Für die Seite erlauben und noch einmal klicken. |

## Hinweise fürs Team

- **iPhone:** Die App auf dem Home-Bildschirm hat einen eigenen Speicher. Man muss sich dort neu anmelden, auch wenn man in Safari schon angemeldet war.
- **Konto mit E-Mail und Passwort:** Nach dem Anlegen kommt eine Mail mit einem Link. Der Link öffnet sich im Browser. Danach zurück in die App und auf „Ich habe bestätigt“ tippen.
- **Google oder Passwort?** Am einfachsten ist „Mit Google anmelden“. Wer kein Google-Konto nutzen will, legt ein Konto mit E-Mail und Passwort an.
