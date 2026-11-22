# Anleitung: Firebase einrichten

Diese Anleitung ist für den Admin, der die App einmal einrichtet. Sie wächst mit den Bau-Etappen. Bisher beschrieben: **Anmeldung und Zugriff** (Schritt 1 bis 6) und das **Screenshot-Auslesen** (Schritt 7 bis 9, freiwillig: Die App läuft auch ohne). Dazu **Discord verbinden** (Schritt 10, freiwillig) und die **Planung** (Schritt 11). Weiter unten: Backup, Installation auf dem Handy, **neue Versionen veröffentlichen** und **Logo austauschen**.

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
2. Spitzname: `ScrimStar`.
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
8. Die Zeilen `recaptchaSiteKey` und `aiModel` nicht anfassen (sie gehören zu Schritt 7 und 8). Die Zeile `googleClientId` kommt in Schritt 5 dran. Datei speichern (Strg+S).

Den Block findest du später wieder unter Zahnrad → **Projekteinstellungen** → Allgemein → „Meine Apps“.

Diese Werte sind keine Geheimnisse und dürfen im öffentlichen Repo stehen. Geschützt wird die App durch die Anmeldung und die Regeln aus Schritt 4. Es kann sein, dass GitHub oder Google dir eine Mail schickt, ein „API key“ sei öffentlich sichtbar. Bei diesem Schlüssel ist das so gewollt.

## Schritt 3: Anmeldung einschalten

1. Links im Menü: **Sicherheit → Authentifizierung** (englisch „Authentication“). Beim ersten Mal auf **Jetzt starten** klicken.
2. Reiter **Anmeldemethode**.
3. **Google** auswählen → aktivieren. „Öffentlicher Name des Projekts“: `ScrimStar` (das sehen die Leute im Google-Fenster). Support-E-Mail: deine Adresse auswählen. **Speichern**.
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

Die Adresse muss an zwei Stellen eingetragen sein: bei Firebase und bei Google.

**Bei Firebase:**

1. **Sicherheit → Authentifizierung** → Reiter **Einstellungen** → **Autorisierte Domains**.
2. **Domain hinzufügen**: `tpmodern980.github.io`
3. `localhost` steht schon in der Liste. Das brauchst du für den Test am eigenen Rechner.

**Bei Google (für „Mit Google anmelden“):**

1. Öffne <https://console.cloud.google.com/apis/credentials> und wähl oben dein Projekt aus (dasselbe wie in Firebase).
2. Unter **OAuth 2.0-Client-IDs** auf **Web client (auto created by Google Service)** klicken.
3. Auf der Seite gibt es **zwei Listen**, die sich ähnlich sehen. Die obere heißt „Autorisierte JavaScript-Quellen“: Dort nichts ändern. Meldet die Seite „Ungültiger Ursprung: URIs dürfen keinen Pfad enthalten“, bist du in dieser oberen Liste gelandet.
4. Weiter unten bei **Autorisierte Weiterleitungs-URIs** auf **URI hinzufügen** und diese zwei Adressen eintragen, genau so, mit dem Schrägstrich am Ende:
   - `https://tpmodern980.github.io/valo-matchlog/`
   - `http://localhost:8123/`
5. Den Eintrag, der dort schon steht (`…firebaseapp.com/__/auth/handler`), **nicht löschen**.
6. **Speichern**. Es kann ein paar Minuten dauern, bis Google die Änderung übernimmt.
7. Auf derselben Seite steht oben rechts die **Client-ID** (endet auf `.apps.googleusercontent.com`). Sie gehört in `firebase-config.js` in die Zeile `googleClientId`. Auch sie ist kein Geheimnis.

Warum das nötig ist: Für die Google-Anmeldung wechselt die App kurz zu Google und kommt dann zurück. Google schickt niemanden an eine Adresse zurück, die nicht in dieser Liste steht.

## Schritt 6: Ausprobieren

1. Doppelklick auf `server-starten.cmd`, dann <http://localhost:8123/> öffnen.
2. Es erscheint die Seite „Anmelden“. Melde dich mit der Adresse an, die du in Schritt 4 als `ADMIN_EMAIL` eingetragen hast.
3. Beim ersten Mal erscheint „Team anlegen“. Trag dort weitere E-Mail-Adressen ein (oder später unter „Team“) und klick auf **Team anlegen**.
4. Danach siehst du die App mit den Tabs.

Wer nicht auf der Liste steht, sieht nach der Anmeldung die Seite „Noch nicht freigeschaltet“ mit der eigenen Adresse. Diese Adresse trägst du unter „Team“ ein.

## Schritt 7: Screenshot-Auslesen einschalten (AI Logic)

Im Formular „Match eintragen“ gibt es den Bereich „Screenshot auslesen“. Er schickt die zwei Screenshots vom Match-Ende (Scoreboard und Timeline) an die KI „Gemini“ von Google und füllt das Formular vor. Dieser Schritt ist freiwillig: Von Hand eintragen geht immer.

Stand dieser Beschreibung: 16.11.2026. Schritt 7 und Schritt 8 (Teil A und B) sind an unserem Projekt durchgespielt. Teil C ist nach der Firebase-Dokumentation geschrieben.

Das Auslesen dauert meist 10 bis 40 Sekunden, manchmal länger. Die allererste Anfrage direkt nach dem Einschalten kann noch scheitern: dann kurz warten und noch einmal versuchen.

**Vorher wissen:**

- **Die Bilder gehen an Google.** Die App verkleinert sie und speichert sie nirgends, aber Google verarbeitet sie. Auf den Bildern stehen die Ingame-Namen aller zehn Spieler.
- **Nutzungsbedingungen:** Google schreibt für die Gemini-API vor, dass Apps für Nutzer im Europäischen Wirtschaftsraum, in der Schweiz und in Großbritannien nur die **Bezahl-Stufe** verwenden dürfen, und nennt ein Mindestalter von 18 Jahren. Die Gratis-Stufe läuft technisch auch ohne Bezahlkonto. Ob ihr sie nutzt, entscheidest du. Nachlesen: <https://ai.google.dev/gemini-api/terms>.
- **Kosten:** Ohne Bezahlkonto (Tarif Spark) können keine Kosten entstehen. Im schlimmsten Fall ist das kostenlose Kontingent für den Tag aufgebraucht.

**Einschalten:**

1. <https://console.firebase.google.com> öffnen, dein Projekt wählen.
2. Links im Menü: **AI Services → AI Logic** (deutsch eventuell „KI-Dienste“).
3. Auf **Get started** („Jetzt starten“) klicken.
4. Als Anbieter **Gemini Developer API** wählen. Nicht „Agent Platform“ oder „Vertex AI“: Das verlangt ein Bezahlkonto.
5. Den Ablauf bis zum Ende durchklicken. Bietet die Konsole ein Upgrade auf „Blaze“ an: ablehnen.

Dabei schaltet Firebase von selbst **App Check** für AI Logic scharf (seit Juli 2026 Pflicht). Deshalb klappt das Auslesen erst nach Schritt 8. Direkt nach dem Einschalten kann es ein paar Minuten dauern, bis alles bereit ist.

**Modell und Kontingent:**

- Welches KI-Modell die App nimmt, steht in `firebase-config.js` in der Zeile `aiModel` (Vorgabe `gemini-3.6-flash`). Schaltet Google dieses Modell irgendwann ab, probiert die App von selbst `gemini-3.8-flash` und `gemini-3.5-flash-lite`. Die aktuellen Namen stehen unter <https://firebase.google.com/docs/ai-logic/models>.
- Jedes Bild ist eine Anfrage, ein Match mit beiden Bildern also zwei. Wie viele Anfragen pro Tag kostenlos sind, zeigt Google nur noch für das eigene Projekt an: <https://aistudio.google.com> → oben das Projekt wählen → „Rate limits“ (Ratenlimits). Das Tageskontingent beginnt um Mitternacht kalifornischer Zeit neu, bei uns gegen 9 Uhr morgens.

## Schritt 8: App Check einrichten

App Check sorgt dafür, dass nur unsere App die KI benutzen kann und kein Fremder das Kontingent aufbraucht. Es gibt zwei Teile: einen für den Test am eigenen Rechner und einen für die App im Internet.

### Teil A: Am eigenen Rechner (localhost) mit Debug-Token

Am eigenen Rechner benutzt die App einen „Debug-Token“. Das ist ein langer Code, den die App für deinen Browser erzeugt. Er gilt erst, wenn du ihn in der Firebase-Konsole einträgst.

1. Server starten (`server-starten.cmd`), <http://localhost:8123/> öffnen und anmelden.
2. **Match eintragen** → im Bereich „Screenshot auslesen“ ein Bild wählen → **Auslesen**.
3. Es erscheint eine rote Meldung „Dieser Browser ist bei Firebase noch nicht als Testgerät eingetragen“ mit dem Debug-Token darunter. Auf **Kopieren** klicken.
   - Steht dort stattdessen „App Check ist im Firebase-Projekt noch nicht eingeschaltet“, fehlt Schritt 7 (oder er ist erst ein paar Minuten her).
4. In der Firebase-Konsole: **Sicherheit → App Check** (englisch „Security → App Check“) → Reiter **Apps**.
5. Neben der Web-App auf die **drei Punkte** klicken → **Debug-Tokens verwalten** („Manage debug tokens“).
6. **Debug-Token hinzufügen**: einen Namen eintragen, an dem du das Gerät erkennst (zum Beispiel „Laptop Brave“), den Token einfügen, **Speichern**.
7. Zurück in die App und noch einmal auf **Auslesen** tippen.

Der Token gilt nur für diesen einen Browser auf diesem Rechner. Für den zweiten Rechner (oder einen anderen Browser) wiederholst du Teil A. **Den Token nicht weitergeben und nicht ins Repo schreiben:** Wer ihn hat, kommt an App Check vorbei. Einen Token, den du nicht mehr brauchst, löschst du an derselben Stelle.

### Teil B: Für die App im Internet mit Fraud Defense (früher reCAPTCHA Enterprise)

Unter der Adresse `https://tpmodern980.github.io/valo-matchlog/` weist sich die App über Googles „Fraud Defense“ aus (so heißt reCAPTCHA Enterprise inzwischen). Das läuft unsichtbar im Hintergrund, niemand muss Bilder anklicken. Das alte „reCAPTCHA“ (v3, „Classic“) nimmt die Firebase-Konsole seit November 2026 nicht mehr an.

Es kostet nichts und braucht kein Bezahlkonto: 10.000 Prüfungen pro Monat sind frei, jedes Auslesen ist eine. Ist das Kontingent doch einmal aufgebraucht, geht das Auslesen online bis zum Monatsersten nicht mehr.

**Schlüssel anlegen (Google-Cloud-Konsole):**

1. <https://console.cloud.google.com/security/recaptcha> öffnen, mit dem Google-Konto des Firebase-Projekts.
2. Oben in der Projekt-Auswahl muss dein Firebase-Projekt stehen (`valo-matchlog`). Der Schlüssel gehört zu dem Projekt, das dort gewählt ist.
3. Fragt die Seite, ob die **reCAPTCHA Enterprise API** aktiviert werden soll: aktivieren. Ein Bezahlkonto ist dafür nicht nötig. Verlangt die Seite trotzdem eins: nicht weitermachen.
4. Reiter **Keys** („Schlüssel“) → **Create key** („Schlüssel erstellen“).
5. **Display name** (Anzeigename): `ScrimStar`.
6. **Application type** (Anwendungstyp): **Web**.
7. **Add a domain** (Domain hinzufügen): `tpmodern980.github.io` (ohne `https://`, ohne `/valo-matchlog`). **Nicht `localhost` eintragen**: Dafür gibt es Teil A.
8. Alles andere so lassen, wie es ist: „Disable domain verification“ bleibt aus, „Use checkbox challenge“ bleibt aus.
9. **Create key**. Danach steht der Schlüssel in der Liste: eine lange Zeichenfolge, die meist mit `6L` beginnt. Er ist öffentlich (kein Geheimnis). Kopieren.

**Schlüssel bei Firebase eintragen:**

1. Firebase-Konsole → **Sicherheit → App Check** → Reiter **Apps** → die Web-App aufklappen.
2. **Fraud Defense (früher reCAPTCHA Enterprise)** wählen (nicht „reCAPTCHA“ darunter).
3. Den Schlüssel einfügen → **Speichern**.

**Schlüssel in die App eintragen:**

1. In `firebase-config.js` den Schlüssel in die Zeile `recaptchaSiteKey` schreiben, zwischen die Anführungszeichen.
2. Speichern, committen und hochladen. Nach etwa 10 Minuten liefert GitHub Pages die neue Datei aus. Bis Google die Domain des Schlüssels kennt, kann es bis zu 30 Minuten dauern.

### Teil C: Prüfen, was erzwungen ist

1. **Sicherheit → App Check** → Reiter **APIs**.
2. In der Zeile **Firebase AI Logic** soll **Erzwungen** („Enforced“) stehen. Steht dort „Nicht erzwungen“: Zeile anklicken → einrichten → **Erzwungen** wählen. Im zweiten Fenster („Replay protection“, Schutz vor Wiederverwendung) kannst du die Vorgabe lassen; die App kommt mit jeder Einstellung dort zurecht.
3. **Wichtig: Bei „Cloud Firestore“ und „Authentication“ App Check nicht erzwingen.** Die App lädt App Check erst, wenn jemand ein Bild ausliest. Würdest du es dort erzwingen, käme niemand mehr an die Daten.

## Schritt 9: KI-Trainingsbilder einschalten (eine Zeile in den Regeln)

Die KI verwechselt beim Auslesen manchmal Agents, die sich ähnlich sehen (zum Beispiel Waylay und Deadlock). Deshalb lernt die App aus euren Korrekturen: Ändert jemand nach dem Auslesen einen falsch erkannten Agent und speichert das Match, merkt sie sich das kleine Agenten-Bild aus dem Screenshot mit dem richtigen Namen. Beim nächsten Auslesen bekommt die KI alle diese Bilder als beschriftete Beispieltafel zum Vergleich. Die Bilder liegen in Firestore (Sammlung `agentRefs`, je etwa 3 KB), nur das Team kann sie sehen. Ansehen und falsche entfernen: Tab **„Team“**, Bereich **„KI-Trainingsbilder“**.

Dafür braucht Firestore eine Regel mehr. **Einmal machen:**

1. Firebase-Konsole → **Datenbanken und Speicher → Firestore** → Reiter **Regeln**.
2. Die Zeile mit `match /clips/{id}` suchen. **Direkt darunter** diese Zeile einfügen:
   ```
   match /agentRefs/{id} { allow read: if isMember(); allow create: if canCreate(); allow update: if canUpdate(); }
   ```
   Alles andere bleibt, wie es ist (auch deine E-Mail bei `ADMIN_EMAIL`). Die vollständigen Regeln stehen in `firestore.rules`.
3. **Veröffentlichen**.

Ohne diese Zeile läuft die App ganz normal weiter, sie lernt nur nichts. In der Konsole des Browsers steht dann eine gelbe Warnung „… fehlt die Zeile für agentRefs“.

**Gut zu wissen:**
- Gelernt wird nur aus Bildern, die gerade ausgelesen wurden, und **nur aus Korrekturen**: In der Zeile steht beim Speichern ein anderer Agent als der, den die KI gelesen hat (oder die KI hatte gar keinen erkannt). Was die KI richtig erkannt hat, braucht kein Beispiel.
- **Höchstens 3 Bilder pro Agent.** Kommt eine weitere Korrektur dazu, ersetzt das neue Bild das älteste. So stehen nur die Agents da, die Probleme machen, und es werden nicht immer mehr.
- Steht unter einem Bild im Team-Tab der falsche Name, mit × entfernen. Sonst lernt die KI das Falsche.

## Schritt 10: Discord verbinden (freiwillig)

Damit lässt sich jedes Match mit einem Knopf in euren Discord-Kanal posten: Ergebnis, Map, Art, Gegner, Scoreboard (K/D/A, Agent, MVP), Rundenverlauf und Notizen, mit Link zum Match in ScrimStar.

ScrimStar postet jedes Match dorthin, wo seine Map hingehört. Ein Webhook gehört in Discord zu genau einem Kanal; bei einem **Forum-Kanal** lässt er sich nur fürs ganze Forum anlegen, nicht für einzelne Beiträge. Deshalb gibt es zwei Wege:

**A) Forum-Kanal mit einem Beitrag pro Map** (so ist es bei uns):
1. **Webhook fürs Forum:** In Discord Rechtsklick auf euren Server → **Servereinstellungen** → **Integrationen** → **Webhooks** → **Neuer Webhook**. Namen geben (z. B. „ScrimStar“), als Kanal **das Forum** wählen, **Webhook-URL kopieren**. Dafür brauchst du auf dem Server das Recht „Webhooks verwalten“.
2. **Links zu den Beiträgen:** Im Forum Rechtsklick auf den Beitrag einer Map (z. B. „Ascent“) → **Link kopieren**. Für jede Map wiederholen.
3. **In ScrimStar** (als Admin): Tab **„Team“** → Bereich **„Discord“** → oben den Webhook des Forums einfügen, bei jeder Map den Link ihres Beitrags → **Speichern**.

**B) Eigene Kanäle:** Für jeden Kanal einen Webhook anlegen wie oben und die Webhook-Adresse direkt bei der Map eintragen. Oben ein Standard-Kanal für Maps ohne Eintrag (leer lassen = dort kein Knopf). Beides lässt sich mischen.

Ein Feld leeren und speichern nimmt den Eintrag wieder heraus. Bei einem Forum braucht jede Map, die ihr spielt, ihren Beitrag; fehlt einer, sagt die App beim Posten Bescheid.
**Danach bei jedem Match:** Auf der Match-Seite steht oben **„In Discord posten“**. Der Knopf zeigt erst eine Vorschau und sagt, in welchen Kanal oder Beitrag es geht; gepostet wird mit **„Jetzt posten“**. Danach steht dort „Discord ✓“; ein zweites Mal posten geht, die App fragt aber vorher nach.

**Gut zu wissen:** Wer die Webhook-Adresse kennt, kann in diesen Kanal schreiben. Sie liegt nur in Firestore bei der Team-Liste (nur fürs Team lesbar, nicht im öffentlichen Repo). Gib sie nicht weiter. Ist sie doch rausgerutscht: in Discord den Webhook löschen, einen neuen anlegen und hier eintragen. Ein Feld im Tab „Team“ leeren und speichern entfernt die Adresse aus der App. Blockiert ein Werbeblocker `discord.com`, kommt beim Posten eine Meldung; dann für ScrimStar ausschalten.

## Schritt 11: Planung einschalten (eine Zeile in den Regeln)

Im Tab **„Planung“** läuft die Wochenumfrage („Wann könnt ihr?“) und der Wochenplan. Die Daten liegen in Firestore in der Sammlung `weeks`. Dafür braucht Firestore eine Regel mehr. **Einmal machen:**

1. Firebase-Konsole → **Firestore** → Reiter **Regeln**.
2. Unter der Zeile mit `match /agentRefs/{id}` diese Zeile einfügen:
   ```
   match /weeks/{id}     { allow read: if isMember(); allow create: if canCreate(); allow update: if canUpdate(); }
   ```
3. **Veröffentlichen**.

Ohne diese Zeile zeigt der Tab nur „Lade Planung …“, alles andere läuft weiter.

**Für den Discord-Planungs-Kanal** (freiwillig): In Discord für euren Planungs-Kanal (ein normaler Text-Kanal, kein Forum) einen Webhook anlegen, im Tab **„Team“** → **„Discord“** → **„Planungs-Kanal“** einfügen → Speichern. Dann kündigt die App neue Umfragen dort an und postet auf Knopfdruck den Wochenplan.

**Einmal vorher: Konten zuordnen.** Tab **„Team“** → „Freigeschaltete E-Mails“: Bei jeder Adresse unter **„Ist im Team“** den passenden Spieler wählen, bei der Managerin **„Managerin“**. Dann stimmt jeder automatisch als er selbst ab und kann sich nicht verklicken; die Managerin stimmt nicht mit ab. Jeder Spieler lässt sich nur einem Konto zuordnen. Wer noch nicht zugeordnet ist, wählt in der Planung selbst unter „Ich bin“ (dort lassen sich vergebene Spieler nicht wählen).

**So läuft eine Woche:**
1. **Managerin (oder ein anderer Admin):** Tab „Planung“, mit den Pfeilen die Woche wählen → **„Umfrage erstellen“** → Tage anhaken, pro Tag Scrim (18 / 19 / 20 Uhr) oder Premier (18:00 / 18:30) → **„Umfrage starten“**. Ist der Planungs-Kanal eingetragen, steht die Umfrage sofort mit Link in Discord.
2. **Spieler:** Link antippen oder Tab „Planung“ öffnen (oben steht „Du stimmst ab als …“). Dann pro Tag alle Uhrzeiten antippen, zu denen man kann, oder „kann nicht“. Gespeichert wird sofort.
3. **Alle sehen** unter „Wer kann wann?“ pro Tag und Uhrzeit, wer kann. Grün = mindestens 5. Darunter steht, wer noch nicht abgestimmt hat.
4. **Managerin:** Unter „Wochenplan“ mit **„+ Termin“** die Termine eintragen (Tag, Uhrzeit, Art, Gegner, Notiz). Die App schlägt die Uhrzeit vor, zu der die meisten können. Freie Tage mit **„+ Ruhetag“** eintragen (Tag und auf Wunsch eine Notiz). Dann **„Wochenplan in Discord posten“**.
5. **Während der Woche:** Wird ein Match eingetragen (gleicher Tag, gleiche Art), bekommt der Termin von selbst einen **grünen Haken** mit Ergebnis, Antippen springt zum Match. Fällt ein Termin aus: „Bearbeiten“ → Status **„abgesagt“** → **rotes X**. Bei „Bearbeiten“ lässt sich auch ein anderes Match von Hand verknüpfen.

## Schritt 12: Strats aus Google Drive (freiwillig)

Der Tab **„Strats“** zeigt eure Taktik-Screenshots direkt aus einem Google-Drive-Ordner. Die Bilder bleiben in Drive. Die App speichert nichts davon, Firestore und der Gratisplan bleiben unberührt. Neue Strats legt ihr einfach in Drive ab.

**Aufbau des Ordners:** pro Map ein Ordner (z. B. `Bind`), darin `Attack` und `Defense`. Darunter dürfen Unterordner liegen (z. B. `Pistol`, `Defaults`), die App zeigt sie als Gruppen. Maps mit Klammer im Namen, z. B. `Ascent (inactiv)` oder `Lotus (perma bann)`, stehen eingeklappt unter „Weitere Maps“. Dateien direkt im obersten Ordner (z. B. ein Plan als Bild oder eine Tabelle) erscheinen oben als Knöpfe. Der Dateiname ohne `.png` ist der Name der Strat.

**Einmal einrichten:**
1. **Ordner freigeben:** In Google Drive Rechtsklick auf den Ordner → **Teilen** → **Teilen** → bei „Allgemeiner Zugriff“ **„Jeder, der über den Link verfügt“**, Rolle **Betrachter** → **Link kopieren**. Wer den Link kennt, sieht die Strats. Gebt ihn deshalb nicht weiter.
2. **Drive-Schnittstelle einschalten:** https://console.cloud.google.com → oben das Firebase-Projekt wählen → **APIs und Dienste → Bibliothek** → „Google Drive API“ → **Aktivieren**.
3. **Schlüssel anlegen:** **APIs und Dienste → Anmeldedaten → Anmeldedaten erstellen → API-Schlüssel**. Den Schlüssel öffnen:
   - **Anwendungseinschränkungen:** „Websites“, Einträge `https://tpmodern980.github.io/*` und `http://localhost:8123/*` (bei einer neuen Adresse der App diese dazu).
   - **API-Einschränkungen:** „Schlüssel einschränken“, nur **Google Drive API**.
   - **Speichern.**
4. **In der App:** Tab **„Team“** → **„Strats (Google Drive)“** → Ordner-Link und Schlüssel einfügen → **„Prüfen und speichern“**. Die App fragt Drive einmal an und speichert nur, wenn es klappt.

Link und Schlüssel liegen in Firestore (`config/team`), nicht im öffentlichen Code. Eine neue Firestore-Regel braucht es nicht.

**Hinweise:** Beim ersten Öffnen dauert das Laden ein paar Sekunden (eine Abfrage pro Ordner). Danach zeigt die App sofort den letzten Stand und holt Neues im Hintergrund. Mit **„Aktualisieren“** holt sie es sofort. Ein Bild antippen öffnet es groß. Blättern geht mit den Pfeilen, mit Wischen oder mit den Pfeiltasten. **„In Drive“** öffnet das Original.

## Wenn etwas nicht klappt

| Was du siehst | Woran es meist liegt |
|---|---|
| Tab „Strats“: „Der API-Schlüssel ist für diese Adresse nicht freigegeben“ | Beim Schlüssel in der Google-Cloud-Konsole fehlt die Adresse der App unter „Websites“ (Schritt 12). |
| Tab „Strats“: „Der Drive-Ordner wurde nicht gefunden“ | Ordner steht nicht auf „Jeder mit dem Link“, oder der Link ist falsch (Schritt 12). |
| „Firebase ist noch nicht eingerichtet“ | `firebase-config.js` ist noch leer oder nicht gespeichert (Schritt 2). |
| „Noch nicht freigeschaltet“, obwohl du der Besitzer bist | Die Regeln sind nicht veröffentlicht, oder `ADMIN_EMAIL` stimmt nicht genau mit deiner Adresse überein (Schritt 4: kleingeschrieben, kein Leerzeichen). |
| „Keine Verbindung“, obwohl das Internet geht | Die Firestore-Datenbank ist noch nicht angelegt (Schritt 4). |
| „Diese Anmeldeart ist in Firebase noch nicht eingeschaltet“ | Schritt 3 fehlt für Google oder für E-Mail/Passwort. |
| „… nicht als autorisierte Domain eingetragen“ | Schritt 5 fehlt. |
| Google zeigt „Fehler 400: redirect_uri_mismatch“ | Die Adresse der App fehlt bei Google oder ist anders geschrieben (Schritt 5, Teil „Bei Google“). Nach dem Speichern ein paar Minuten warten. |
| „Unable to process request due to missing initial state“ | In `firebase-config.js` fehlt die `googleClientId` (Schritt 5). Dann nutzt die App ein Google-Fenster, das in der installierten iPhone-App nicht zuverlässig funktioniert. |
| „Die Antwort von Google passt nicht zu dieser Anmeldung“ | Die Anmeldung hat länger als 15 Minuten gedauert oder wurde in einem anderen Browser beendet. Noch einmal auf „Mit Google anmelden“ tippen. |
| Ein Gerät zeigt nach dem Hochladen noch den alten Stand | Ein paar Minuten warten, App schließen und neu öffnen: Dann kommt der Hinweis „Neue Version“. Kommt er nie: In `sw.js` wurde die Versionsnummer nicht erhöht (Abschnitt „Neue Version der App veröffentlichen“). Die Version des Geräts steht unten in der Fußzeile. |
| Im Google-Fenster steht noch „Valo Matchlog“ | Das ist der öffentliche Name des Firebase-Projekts. Ändern (freiwillig): Schritt 3, bei Google den Stift → „Öffentlicher Name des Projekts“: `ScrimStar` → Speichern. Steht er danach immer noch da: <https://console.cloud.google.com/auth/branding> → „App-Name“. |

**Beim Screenshot-Auslesen** (die Meldungen stehen im Formular direkt unter dem Knopf „Auslesen“; Einzelheiten zusätzlich in der Konsole des Browsers):

| Was du siehst | Woran es meist liegt |
|---|---|
| „Das Screenshot-Auslesen ist in Firebase noch nicht eingeschaltet (AI Logic)“ | Schritt 7 fehlt. Direkt danach ein paar Minuten warten. |
| „App Check ist im Firebase-Projekt noch nicht eingeschaltet“ | Schritt 7 fehlt ebenfalls: App Check wird beim Einrichten von AI Logic mit eingeschaltet. |
| „Dieser Browser ist bei Firebase noch nicht als Testgerät eingetragen“ | Schritt 8, Teil A: den angezeigten Debug-Token in der Konsole eintragen. Kommt die Meldung danach wieder: Stimmt der Token Zeichen für Zeichen? Jeder Browser hat einen eigenen. Wurden die Browser-Daten gelöscht, erzeugt die App einen neuen Token. |
| „App Check fehlt … kein recaptchaSiteKey“ | Online-Version ohne Schritt 8, Teil B. |
| „App Check konnte diesen Browser nicht bestätigen (reCAPTCHA)“ | Ein Werbeblocker sperrt reCAPTCHA (bei Brave: Schutz für diese Seite ausschalten), die Domain beim Schlüssel stimmt nicht, der Schlüssel in `firebase-config.js` ist nicht derselbe wie in der Firebase-Konsole, oder in der Firebase-Konsole ist noch das alte „reCAPTCHA“ statt „Fraud Defense“ gewählt (Schritt 8 Teil B). Nach einer Korrektur die Seite neu laden: Die App versucht es nach einem Fehlschlag sonst erst später wieder. |
| „Firebase verlangt, dass App Check für AI Logic erzwungen ist“ oder „Firebase hat AI Logic … abgeschaltet“ | Schritt 8, Teil C. |
| „Der API-Schlüssel des Projekts darf die Firebase AI Logic API nicht aufrufen“ | <https://console.cloud.google.com/apis/credentials> → den API-Schlüssel des Projekts öffnen („Browser key“) → bei den API-Einschränkungen **Firebase AI Logic API** mit auswählen → Speichern. Bis zu fünf Minuten warten. |
| „Das kostenlose Kontingent der KI ist gerade erschöpft“ oder „Tageskontingent … aufgebraucht“ | Zu viele Anfragen. Eine Minute warten, sonst am nächsten Tag ab etwa 9 Uhr. Wie viel frei ist, steht in AI Studio (Schritt 7). |
| „Keins der KI-Modelle wurde gefunden“ | Google hat die Modelle abgelöst. In `firebase-config.js` bei `aiModel` einen aktuellen Namen eintragen (Schritt 7). |
| „Auf dem Bild war keine Ergebnis-Übersicht zu erkennen“ oder „… keine Timeline …“ | Falsches Bild oder im falschen Feld. Gebraucht werden die zwei Ansichten nach dem Match: „Summary → Scoreboard“ und „Timeline“. |
| Werte stimmen nicht mit dem Bild überein | Die KI kann sich irren, vor allem bei den Agents. Deshalb speichert die App nichts von selbst: Werte prüfen, korrigieren, dann „Speichern“. |

## Backup und Wiederherstellen

Im Gratisplan von Firebase gibt es **keine automatischen Backups**. Alles dafür steht im Tab **„Team“**, Bereiche **„Backups + Export“** und **„Papierkorb“**.

**Backup herunterladen (alle im Team):** „Backup (JSON) herunterladen“. Die Datei enthält alles: Spieler, Matches (mit dem Scoreboard der Gegner und den Trades bei Premier), Clips mit Notizen und den Papierkorb. Am besten regelmäßig, etwa einmal im Monat, und die Datei an einem sicheren Ort aufheben (z. B. OneDrive oder Google Drive). Der Download kostet keine Lesezugriffe: Die App nimmt, was sie schon geladen hat.

**Matches als CSV (Excel):** eine Zeile pro Spieler und Match, zum Auswerten in Excel oder Google Sheets. Die Spalte „Team“ sagt, ob die Zeile zu uns („Wir“) oder zu den Gegnern gehört. Gelöschte Matches stehen nicht drin. Die CSV ist **kein** Backup: Einspielen lässt sich nur die JSON-Datei.
- **Excel:** Datei doppelt anklicken. Sie ist für deutsches Excel gemacht (Semikolon, Komma bei Zahlen, Umlaute).
- **Google Sheets:** Datei → Importieren → Hochladen → Trennzeichen „Semikolon“ wählen. Damit Zahlen wie „1,25“ als Zahl erkannt werden, muss das Gebietsschema der Tabelle „Deutschland“ sein (Datei → Einstellungen).

**Papierkorb (nur Admins):** Gelöschte Matches, entfernte Spieler und einzeln entfernte Clips stehen dort, mit dem Knopf „Wiederherstellen“.
- **„Papierkorb leeren“** (mit Rückfrage) entfernt alles darin endgültig: Es lässt sich nicht mehr wiederherstellen und kommt nicht mehr ins Backup. Clips eines Matches aus dem Papierkorb gehen mit. Vorher am besten ein Backup herunterladen. Technisch bleibt in der Datenbank ein unsichtbarer Rest (ein paar KB): Nur so erfahren alle Geräte, dass der Eintrag weg ist.
- Clips eines gelöschten Matches stehen nicht einzeln im Papierkorb: Sie kommen mit dem Match zurück.
- Ein Spieler lässt sich nicht zurückholen, wenn sein Name oder Ingame-Name inzwischen einem anderen Spieler gehört. Dann erst dort den Namen herausnehmen.
- Entfernte Clip-Notizen lassen sich nicht wiederherstellen (höchstens aus einem Backup).

**Backup einspielen (nur Admins):** „Backup einspielen …“ → die JSON-Datei wählen. Die App zeigt erst eine Vorschau („x Matches, y Spieler, z Clips werden eingespielt“) und schreibt erst nach „Jetzt einspielen“.
- Einträge mit derselben ID werden **überschrieben**, fehlende angelegt. Was nicht in der Datei steht, bleibt unverändert. Die Team-Liste wird nie geändert.
- Was schon genau so in der App ist, wird übersprungen (spart Schreibvorgänge).
- Wurde ein Eintrag nach dem Backup noch geändert, warnt die Vorschau: Diese Änderung ginge beim Einspielen verloren.
- Jeder eingespielte Eintrag ist ein Schreibvorgang (Gratisplan: 20.000 am Tag). Auf den anderen Geräten wird er danach einmal neu geladen (ein Lesezugriff pro Eintrag).

| Was du siehst | Woran es meist liegt |
|---|---|
| „… ist keine JSON-Datei“ | Die CSV oder eine andere Datei gewählt. Gebraucht wird die Datei `valo-matchlog-backup-….json`. |
| „Diese Datei ist kein Export von ScrimStar“ | Eine fremde JSON-Datei. (Backups aus der Zeit, als die App noch „Valo Matchlog“ hieß, passen weiter.) |
| „… stammt aus einer neueren Version der App“ | Die App auf diesem Gerät ist veraltet: auf den Hinweis „Neue Version“ unten warten und „Neu laden“ tippen (oder die App ganz schließen und neu öffnen), dann noch einmal. |
| „Nicht gespeichert: Dafür fehlt dir die Berechtigung.“ | Nur Admins dürfen wiederherstellen und einspielen. Steht man auf der Admin-Liste, die Seite neu laden. |

## Als App auf den Home-Bildschirm legen

Die App kommt nicht aus dem App Store. Man öffnet die Adresse im Browser und legt sie von dort auf den Home-Bildschirm. Danach startet sie wie eine eigene App: mit dem Namen **ScrimStar**, dem Icon (weißer Stern auf Petrol, ein Platzhalter bis zum eigenen Logo) und ohne Adresszeile.

- **iPhone:** Die Adresse in **Safari** öffnen → Teilen-Symbol (Viereck mit Pfeil nach oben) → **Zum Home-Bildschirm** → Hinzufügen. Falls dort ein Schalter „Als Web-App öffnen“ steht: eingeschaltet lassen.
- **Android:** Die Adresse in **Chrome** öffnen → Menü mit den drei Punkten → **App installieren** (oder „Zum Startbildschirm hinzufügen“).
- **PC (Chrome, Edge, Brave):** In der Adresszeile rechts erscheint ein kleines Symbol „App installieren“. Muss man nicht, geht aber.

**Wer die App schon vor dem neuen Namen auf dem Home-Bildschirm hatte:** Android übernimmt Name und Icon nach einiger Zeit von selbst. Auf dem iPhone bleiben der alte Name und das alte Bild, bis man das Symbol löscht (lange drücken → App entfernen) und neu hinzufügt. Danach muss man sich dort einmal neu anmelden.

**Ohne Internet:** Die App startet auch ohne Verbindung und zeigt den zuletzt geladenen Stand. Eintragen geht auch; gespeichert wird, sobald wieder Netz da ist. Das Screenshot-Auslesen und YouTube-Clips brauchen Internet.

**Statusleiste oben (Uhrzeit, Akku):** Sie liegt über der App, nicht darin, und hat die Farbe des Hintergrunds (hell oder dunkel, je nach Einstellung des Handys).

## Neue Version der App veröffentlichen

Die App speichert ihre Dateien auf jedem Gerät (das macht der „Service Worker“ in `sw.js`). Dadurch startet sie schnell und läuft auch ohne Internet. Damit eine Änderung auf den Geräten ankommt, gilt:

1. **Bei jeder Änderung an der App die Versionsnummer erhöhen:** In `sw.js` oben die Zeile `const VERSION = "…";`. Am besten das Datum von heute, bei mehreren Änderungen am selben Tag mit `.2`, `.3` usw. dahinter (zum Beispiel `"2026-11-20.1"`). **Ohne neue Nummer behalten die Geräte die alten Dateien.**
2. Kommt eine **neue Datei** dazu (z. B. ein neues Modul in `js/`), sie in `sw.js` in die Liste `APP_FILES` eintragen.
3. Committen und hochladen wie immer. GitHub Pages braucht danach ein paar Minuten (bis zu etwa 10).
4. Auf den Geräten erscheint unten der Hinweis **„Neue Version – Neu laden“**, sobald die App geöffnet wird oder man zu ihr zurückwechselt. „Neu laden“ tippen. „Später“ blendet ihn aus; dann kommt die neue Version beim nächsten kompletten Neustart der App.

Welche Version ein Gerät gerade hat, steht ganz unten in der Fußzeile („Version …“).

Am eigenen Rechner (`http://localhost:8123/`) holt die App immer die frischen Dateien vom Test-Server. Den Hinweis „Neue Version“ sieht man dort nur, wenn sich `sw.js` geändert hat.

## Logo austauschen

Das Icon ist ein Platzhalter. Die Quelle ist die Datei `icons/logo.svg`, daraus entstehen alle Bilder (App-Icons für Android und iPhone, Favicon, Logo oben links in der Kopfzeile).

1. **Logo vorbereiten:** am besten als SVG, sonst PNG. Quadratisch, mindestens 1024 × 1024 Pixel. Hintergrund **nicht durchsichtig** (das iPhone füllt Durchsichtiges schwarz). Das Wichtige in die Mitte: Android schneidet bei runden Icons bis zu einem Fünftel am Rand ab.
2. **Als SVG:** die Datei `icons/logo.svg` durch das neue Logo ersetzen (gleicher Name). **Als PNG:** `icons/logo.svg` erst einmal liegen lassen.
3. Test-Server starten (Doppelklick auf `server-starten.cmd`) und `http://localhost:8123/tools/icons.html` öffnen. Die Seite zeigt alle Icons als Vorschau. Für ein PNG oben bei „Andere Datei“ die Datei wählen.
4. Passt die Hintergrundfarbe für das runde Icon nicht, sie bei „Hintergrund für den Rand“ ändern.
5. **„Alle herunterladen“**. Die fünf Dateien (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon.png`, `favicon-32.png`) landen im Download-Ordner. Sie in den Ordner `C:\dev\valo-matchlog\icons\` verschieben und die alten ersetzen.
6. War das Logo ein PNG: In `index.html` steht zweimal `icons/logo.svg` (Favicon und Kopfzeile). Beide Male durch `icons/icon-192.png` ersetzen. Die Datei `icons/logo.svg` dann löschen und in `sw.js` aus `APP_FILES` herausnehmen.
7. In `sw.js` die Versionsnummer erhöhen (siehe oben), committen, hochladen.

Auf den Handys erscheint das neue Icon auf dem Home-Bildschirm erst nach einiger Zeit (Android) oder nach dem Neu-Hinzufügen (iPhone).

**Name ändern:** Der Name steht in `js/config.js` (`APP_NAME`), in `index.html` (`<title>`, Kopfzeile, `apple-mobile-web-app-title`) und in `manifest.webmanifest` (`name`, `short_name`; der kurze Name steht unter dem Icon, höchstens etwa 12 Zeichen). Die Adresse `…/valo-matchlog/` bleibt davon unberührt.

## Hinweise fürs Team

- **iPhone:** Die App auf dem Home-Bildschirm hat einen eigenen Speicher. Man muss sich dort neu anmelden, auch wenn man in Safari schon angemeldet war.
- **Konto mit E-Mail und Passwort:** Nach dem Anlegen kommt eine Mail mit einem Link. Der Link öffnet sich im Browser. Danach zurück in die App und auf „Ich habe bestätigt“ tippen.
- **Google oder Passwort?** Am einfachsten ist „Mit Google anmelden“. Wer kein Google-Konto nutzen will, legt ein Konto mit E-Mail und Passwort an.
