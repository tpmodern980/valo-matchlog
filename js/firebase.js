// Firebase laden und starten.
// Das SDK kommt als ES-Module vom gstatic-CDN (feste Version aus config.js), ohne Build-Schritt.
// Diese Funktionen ruft die App nur auf, wenn firebase-config.js ausgefüllt ist und keine Vorschau läuft.
import { cfg, FIREBASE_VERSION } from "./config.js";

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;

let base = null;   // App + Anmeldung
let data = null;   // Datenbank (erst nach der Anmeldung nötig)
let cleanup = Promise.resolve();   // letztes Aufräumen (clearDb): Ein neuer Start der Datenbank wartet darauf
let guard = null;  // App Check (erst beim Screenshot-Auslesen nötig)
let ki = null;     // KI (Firebase AI Logic, erst beim Screenshot-Auslesen nötig)

// Liefert { app, auth, A }. A ist das Auth-Modul mit seinen Funktionen.
export function loadFirebase() {
  if (!base) {
    base = (async () => {
      const [appMod, A] = await Promise.all([import(CDN + "firebase-app.js"), import(CDN + "firebase-auth.js")]);
      const app = appMod.initializeApp(cfg.firebase);
      const auth = A.getAuth(app);
      auth.languageCode = "de";   // Bestätigungs- und Passwort-Mails auf Deutsch
      return { app, auth, A };
    })();
    base.catch(() => { base = null; });   // nach einem Fehlschlag darf man es erneut versuchen
  }
  return base;
}

async function openDb() {
  const { app } = await loadFirebase();
  const F = await import(CDN + "firebase-firestore.js");
  let db;
  try {
    // Dauerhafter Zwischenspeicher auf dem Gerät (PLAN.md Abschnitt 6): spart Lesezugriffe, Daten auch offline.
    db = F.initializeFirestore(app, {
      localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager(), cacheSizeBytes: F.CACHE_SIZE_UNLIMITED }),
    });
  } catch (e) {
    // z. B. privater Modus ohne IndexedDB: dann nur im Arbeitsspeicher
    db = F.getFirestore(app);
  }
  return { db, F };
}

// Liefert { db, F }. F ist das Firestore-Modul mit seinen Funktionen.
export function loadDb() {
  if (!data) {
    const mine = cleanup.then(openDb);
    data = mine;
    mine.catch(() => { if (data === mine) data = null; });
  }
  return data;
}

// Wurde die Datenbank in dieser Sitzung schon gestartet?
export const dbLoaded = () => Boolean(data);

// Zwischenspeicher dieses Geräts leeren (beim Abmelden und auf der Sperrseite), damit keine Daten
// eines früheren Nutzers liegen bleiben. Firestore erlaubt das nur bei beendeter Datenbank:
// Deshalb wird sie beendet und beim nächsten loadDb() frisch gestartet.
// Vorher müssen alle Abos (onSnapshot) gestoppt sein.
export function clearDb() {
  const old = data;
  data = null;
  const job = cleanup.then(async () => {
    const { db, F } = await (old || openDb());
    await F.terminate(db);
    await F.clearIndexedDbPersistence(db);
  });
  cleanup = job.catch(() => {});   // auch nach einem Fehlschlag darf die Datenbank wieder starten
  return job;
}

// ---------- Screenshot-Auslesen: App Check und KI ----------
// Beides wird erst geladen, wenn jemand wirklich ein Bild ausliest (nie beim Start der App).

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
const DEBUG_KEY = "valo-appcheck-debug";

// Debug-Token für den Test am eigenen Rechner: einmal erzeugt und im Browser gemerkt.
// Er gilt erst, wenn der Admin ihn in der Firebase-Konsole einträgt (ANLEITUNG.md, Schritt 8).
function debugToken() {
  let token = "";
  try { token = localStorage.getItem(DEBUG_KEY) || ""; } catch (e) { /* kein Speicher: Token gilt nur bis zum Neuladen */ }
  if (!/^[0-9a-f-]{36}$/i.test(token)) {
    token = crypto.randomUUID();
    try { localStorage.setItem(DEBUG_KEY, token); } catch (e) { /* siehe oben */ }
  }
  return token;
}

// Warum lehnt Firebase den Debug-Token ab? Die Bibliothek verrät nur "403". Diese Abfrage stellt dieselbe
// Anfrage noch einmal und liest den Grund aus der Antwort: "SERVICE_DISABLED" heißt, App Check ist im Projekt
// noch gar nicht eingeschaltet (dann hilft es nichts, den Token einzutragen). Liefert "" bei unbekanntem Grund.
async function debugReason(token) {
  try {
    const f = cfg.firebase;
    const res = await fetch(`https://content-firebaseappcheck.googleapis.com/v1/projects/${f.projectId}/apps/${f.appId}:exchangeDebugToken?key=${f.apiKey}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ debug_token: token, limited_use: true }),
    });
    if (res.ok) return "";
    const err = ((await res.json()) || {}).error || {};
    const hit = (err.details || []).find((d) => d && d.reason);
    return String((hit && hit.reason) || "");
  } catch (e) {
    return "";
  }
}

// App Check weist gegenüber Firebase nach, dass die Anfrage aus unserer App kommt. Firebase verlangt das
// für die KI. Drei Fälle:
//   - am eigenen Rechner (localhost): Debug-Token, reCAPTCHA wird gar nicht geladen
//   - online mit recaptchaSiteKey: reCAPTCHA Enterprise (heißt bei Google inzwischen "Fraud Defense"). Das alte
//     reCAPTCHA v3 ("Classic") nimmt die Firebase-Konsole seit November 2026 nicht mehr an.
//   - online ohne recaptchaSiteKey: App Check aus (die KI lehnt dann ab, solange Firebase App Check erzwingt)
// Liefert { mode: "debug" | "recaptcha" | "off", token (nur bei "debug"), probe(), why() }.
// probe() versucht, ein Token zu holen, und wirft den genauen Fehler, falls das nicht klappt.
function loadAppCheck() {
  if (!guard) {
    guard = (async () => {
      const { app } = await loadFirebase();
      const local = LOCAL_HOSTS.includes(location.hostname);
      if (!local && !cfg.recaptchaSiteKey) return { mode: "off", token: "", probe: async () => {}, why: async () => "" };
      const AC = await import(CDN + "firebase-app-check.js");
      let token = "", provider;
      if (local) {
        token = debugToken();
        self.FIREBASE_APPCHECK_DEBUG_TOKEN = token;   // muss vor initializeAppCheck gesetzt sein
        provider = new AC.CustomProvider({ getToken: () => Promise.reject(new Error("debug-only")) });
      } else {
        provider = new AC.ReCaptchaEnterpriseProvider(cfg.recaptchaSiteKey);
      }
      // Kein dauerndes Erneuern: Ein Token wird nur geholt, wenn wirklich ein Bild ausgelesen wird
      const appCheck = AC.initializeAppCheck(app, { provider, isTokenAutoRefreshEnabled: false });
      return { mode: local ? "debug" : "recaptcha", token, probe: () => AC.getLimitedUseToken(appCheck), why: () => (local ? debugReason(token) : Promise.resolve("")) };
    })();
    guard.catch(() => { guard = null; });
  }
  return guard;
}

// Liefert { ai, AIM, check }. AIM ist das Modul "firebase-ai" mit seinen Funktionen, check kommt aus loadAppCheck().
// App Check muss vor der KI gestartet sein: Die KI merkt sich beim Start, ob es App Check gibt.
export function loadAi() {
  if (!ki) {
    ki = (async () => {
      const { app } = await loadFirebase();
      const check = await loadAppCheck();
      const AIM = await import(CDN + "firebase-ai.js");
      // Gemini Developer API (läuft ohne Bezahlkonto). Kurzlebige Einmal-Tokens, passend zum Schutz vor
      // Wiederverwendung ("Replay protection") in der Firebase-Konsole.
      const ai = AIM.getAI(app, { backend: new AIM.GoogleAIBackend(), useLimitedUseAppCheckTokens: check.mode !== "off" });
      return { ai, AIM, check };
    })();
    ki.catch(() => { ki = null; });
  }
  return ki;
}
