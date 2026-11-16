// Zentrale Einstellungen der App.
// Der App-Name steht außerdem in index.html (<title>, Kopfzeile, apple-mobile-web-app-title), in manifest.webmanifest
// und in den Texten von README.md und ANLEITUNG.md. Repo-Name, Adresse (valo-matchlog) und Speicher-Schlüssel (valo-…) bleiben.
export const APP_NAME = "ScrimStar";

// Feste Version des Firebase-SDK vom gstatic-CDN (nicht automatisch erhöhen).
export const FIREBASE_VERSION = "13.2.0";

const raw = window.VALO_CONFIG || {};
export const cfg = {
  firebase: raw.firebase || {},
  googleClientId: raw.googleClientId || "",
  recaptchaSiteKey: raw.recaptchaSiteKey || "",
  aiModel: raw.aiModel || "gemini-3.6-flash",
};

// Ohne diese Werte kann Firebase nicht starten: Dann zeigt die App die Einrichtungsseite.
export const isConfigured = Boolean(cfg.firebase.apiKey && cfg.firebase.projectId && cfg.firebase.appId);

// Vorschau mit Beispieldaten: index.html?demo=1 (nichts wird gespeichert, Firebase wird nicht geladen).
// Die Seiten rund um die Anmeldung lassen sich einzeln ansehen:
// ?demo=login, ?demo=verify, ?demo=blocked, ?demo=offline, ?demo=team-setup
const params = new URLSearchParams(location.search);
export const isDemo = params.has("demo");
export const demoPage = params.get("demo") || "";
