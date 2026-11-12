// Einstellungen für die App. Diese Datei füllt der Admin einmal aus (siehe ANLEITUNG.md).
// Die Firebase-Web-Config ist öffentlich gedacht: Der Schutz läuft über Login + Firestore-Regeln.
// Hier gehören KEINE Passwörter oder geheimen Schlüssel hinein.
window.VALO_CONFIG = {
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    storageBucket: "",
    messagingSenderId: "",
    appId: "",
  },
  recaptchaSiteKey: "",          // für App Check (leer = App Check aus)
  aiModel: "gemini-3.6-flash",   // Modell fürs Screenshot-Auslesen
};
