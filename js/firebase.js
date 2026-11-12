// Firebase laden und starten.
// Das SDK kommt als ES-Module vom gstatic-CDN (feste Version aus config.js), ohne Build-Schritt.
// Diese Funktionen ruft die App nur auf, wenn firebase-config.js ausgefüllt ist und keine Vorschau läuft.
import { cfg, FIREBASE_VERSION } from "./config.js";

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;

let base = null;   // App + Anmeldung
let data = null;   // Datenbank (erst nach der Anmeldung nötig)
let cleanup = Promise.resolve();   // letztes Aufräumen (clearDb): Ein neuer Start der Datenbank wartet darauf

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
