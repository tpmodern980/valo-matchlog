// Seiten, die erscheinen, bevor die eigentliche App läuft.

// firebase-config.js ist noch leer
export function setupView() {
  return `<div class="empty">
    <div class="eyebrow">Einrichtung</div>
    <h2>Firebase ist noch nicht eingerichtet</h2>
    <p>Die App speichert ihre Daten in einem Firebase-Projekt. Die Angaben dazu fehlen noch in der Datei <code>firebase-config.js</code>.</p>
    <ol>
      <li>Firebase-Projekt anlegen und eine Web-App registrieren.</li>
      <li>Die angezeigten Werte in <code>firebase-config.js</code> eintragen.</li>
      <li>Seite neu laden.</li>
    </ol>
    <p>Die ganze Einrichtung steht Schritt für Schritt in <code>ANLEITUNG.md</code>.</p>
    <a class="btn" href="?demo=1">Vorschau mit Beispieldaten ansehen</a>
  </div>`;
}

// Etwas ist beim Starten schiefgegangen
export function errorView(message) {
  const safe = String(message || "Unbekannter Fehler").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  return `<div class="empty">
    <h2>Die App konnte nicht starten</h2>
    <p>Lade die Seite neu. Wenn das nicht hilft, schick dem Admin diese Meldung:</p>
    <p><code>${safe}</code></p>
  </div>`;
}
