// Firebase laden und starten.
// Das SDK kommt als ES-Module vom gstatic-CDN (feste Version aus config.js), ohne Build-Schritt.
// Diese Funktionen ruft die App nur auf, wenn firebase-config.js ausgefüllt ist und keine Vorschau läuft.
import { cfg, FIREBASE_VERSION } from "./config.js";

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;

let base = null;   // App + Anmeldung
let data = null;   // Datenbank (erst nach der Anmeldung nötig)

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

// Liefert { db, F }. F ist das Firestore-Modul mit seinen Funktionen.
export function loadDb() {
  if (!data) {
    data = (async () => {
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
    })();
    data.catch(() => { data = null; });
  }
  return data;
}
