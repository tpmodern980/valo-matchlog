// Zentrale Einstellungen der App.
// Der App-Name steht außerdem in index.html (<title>, Kopfzeile) und später in manifest.webmanifest.
export const APP_NAME = "Valo Matchlog";

// Feste Version des Firebase-SDK vom gstatic-CDN (nicht automatisch erhöhen).
export const FIREBASE_VERSION = "13.2.0";

const raw = window.VALO_CONFIG || {};
export const cfg = {
  firebase: raw.firebase || {},
  recaptchaSiteKey: raw.recaptchaSiteKey || "",
  aiModel: raw.aiModel || "gemini-3.6-flash",
};

// Ohne diese Werte kann Firebase nicht starten: Dann zeigt die App die Einrichtungsseite.
export const isConfigured = Boolean(cfg.firebase.apiKey && cfg.firebase.projectId && cfg.firebase.appId);

// Vorschau mit Beispieldaten: index.html?demo=1 (nichts wird gespeichert).
export const isDemo = new URLSearchParams(location.search).has("demo");
