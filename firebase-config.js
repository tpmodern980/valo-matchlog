// Einstellungen für die App. Diese Datei füllt der Admin einmal aus (siehe ANLEITUNG.md).
// Die Firebase-Web-Config ist öffentlich gedacht: Der Schutz läuft über Login + Firestore-Regeln.
// Hier gehören KEINE Passwörter oder geheimen Schlüssel hinein.
window.VALO_CONFIG = {
  firebase: {
    apiKey: "AIzaSyBPvZSuMAEpTZJmai4GOtfCdv0OFzy0Tfk",
    authDomain: "valo-matchlog.firebaseapp.com",
    projectId: "valo-matchlog",
    storageBucket: "valo-matchlog.firebasestorage.app",
    messagingSenderId: "548202036420",
    appId: "1:548202036420:web:f34a866685a047c42e9d91",
  },
  // Web-Client-ID für "Mit Google anmelden" (ANLEITUNG.md, Schritt 5). Ebenfalls öffentlich.
  // Leer = Anmeldung über ein Google-Fenster (klappt in der installierten iPhone-App nicht zuverlässig).
  googleClientId: "548202036420-93un7vnen64m5cl6t5ss6li4gdbd2bp2.apps.googleusercontent.com",
  recaptchaSiteKey: "",          // für App Check (leer = App Check aus)
  aiModel: "gemini-3.6-flash",   // Modell fürs Screenshot-Auslesen
};
