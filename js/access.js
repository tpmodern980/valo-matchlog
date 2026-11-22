// Zugang anfragen (Wunsch Tim, 22.11.2026): Wer angemeldet ist, aber nicht auf der Team-Liste steht, tippt auf
// "Zugang anfragen". Die Anfrage landet in requests/<uid> = { email, name, at }. Admins sehen offene Anfragen im Tab
// "Team" (und als Hinweis auf der Startseite) und bestätigen mit einem Tipp: Dann steht die E-Mail auf der Team-Liste
// und die Anfrage wird gelöscht. Braucht eine Zeile in den Firestore-Regeln (firestore.rules, ANLEITUNG.md Schritt 13).
//
// Discord-Ping: Ist in config/public.accessHook ein Webhook eingetragen (Tab "Team" → Discord, nur Admins), postet
// die App bei jeder Anfrage dorthin. config/public darf jeder Angemeldete lesen (er ist ja noch kein Mitglied):
// Die Adresse ist damit nicht geheim. Deshalb ein eigener, privater Kanal nur für diese Meldungen (Entscheidung Tim).
import { S, changed } from "./state.js";
import { loadDb } from "./firebase.js";
import { addMember } from "./team.js";
import { appUrl } from "./auth.js";

const HOOK_RE = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
export const validAccessHook = (url) => typeof url === "string" && HOOK_RE.test(url.trim());

// Meldung in den Zugangs-Kanal. Fehler stören die Anfrage nicht (sie ist dann trotzdem gespeichert).
async function ping(db, F) {
  try {
    const snap = await F.getDoc(F.doc(db, "config", "public"));
    const url = snap.exists() ? snap.data().accessHook : "";
    if (!validAccessHook(url)) return;
    const who = S.user.name ? `${S.user.name} (${S.user.email})` : S.user.email;
    await fetch(url.trim(), {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "ScrimStar", embeds: [{
        title: "🔔 Neue Zugangs-Anfrage", url: appUrl() + "#team", color: 0x0B7480,
        description: `**${who.replace(/([\\*_~\`|>#[\]])/g, "\\$1")}** möchte in ScrimStar.\n[Im Tab „Team“ freischalten](${appUrl()}#team)`,
        footer: { text: "ScrimStar · Fan-Projekt, nicht mit Riot Games verbunden" },
      }] }),
    });
  } catch (e) { console.warn("Zugangs-Meldung an Discord ging nicht:", e && e.message); }
}

const say = (text) => Object.assign(new Error(text), { plain: true });
const sentKey = () => "valo-access-" + (S.user ? S.user.uid : "");

// Hat dieses Gerät schon angefragt? (Zeitpunkt oder 0)
export function sentAt() {
  try { return Number(localStorage.getItem(sentKey())) || 0; } catch (e) { return 0; }
}

export async function requestAccess() {
  if (!S.user) return;
  if (S.demo) { try { localStorage.setItem(sentKey(), String(Date.now())); } catch (e) { /* egal */ } changed(); return; }
  const { db, F } = await loadDb();
  try {
    await F.setDoc(F.doc(db, "requests", S.user.uid), {
      email: String(S.user.email || "").toLowerCase(), name: S.user.name || "", at: F.serverTimestamp(),
    });
  } catch (e) {
    if (e && e.code === "permission-denied") throw say("Die Anfrage ging nicht durch: In den Firestore-Regeln fehlt die Zeile für Anfragen (ANLEITUNG.md, Schritt 13). Schick dem Admin deine E-Mail-Adresse direkt.");
    throw e;
  }
  try { localStorage.setItem(sentKey(), String(Date.now())); } catch (e) { /* egal */ }
  await ping(db, F);
  changed();
}

// ---------- Admins: offene Anfragen beobachten ----------
let stop = null, stopHook = null, started = false;
export function watchRequests() {
  if (started || !S.isAdmin) return;
  started = true;
  if (S.demo) {
    S.requests = [{ uid: "udemo-neu", email: "neo@example.com", name: "Neo", at: Date.now() - 3600000 }];
    return;
  }
  loadDb().then(({ db, F }) => {
    // Webhook für Zugangs-Meldungen (config/public), damit der Tab "Team" ihn anzeigen kann
    stopHook = F.onSnapshot(F.doc(db, "config", "public"), (snap) => {
      S.accessHook = snap.exists() && typeof snap.data().accessHook === "string" ? snap.data().accessHook : "";
      changed();
    }, () => { S.accessHook = ""; });
    stop = F.onSnapshot(F.collection(db, "requests"), (snap) => {
      S.requests = snap.docs.map((d) => {
        const x = d.data();
        return { uid: d.id, email: String(x.email || ""), name: String(x.name || ""), at: x.at && x.at.toMillis ? x.at.toMillis() : 0 };
      }).filter((x) => x.email).sort((a, b) => a.at - b.at);
      changed();
    }, () => { S.requests = []; });   // Regel fehlt oder kein Admin: einfach keine Anfragen zeigen
  }).catch(() => { started = false; });
}
export function stopRequests() { if (stop) stop(); if (stopHook) stopHook(); stop = stopHook = null; started = false; S.requests = []; }

// Webhook für Zugangs-Meldungen speichern ("" = keiner). Nur Admins (Regel config/public).
export async function setAccessHook(url) {
  if (S.demo) { S.accessHook = url; changed(); return; }
  const { db, F } = await loadDb();
  await F.setDoc(F.doc(db, "config", "public"), { accessHook: url, updatedAt: F.serverTimestamp() }, { merge: true });
}

async function drop(uid) {
  if (S.demo) { S.requests = S.requests.filter((x) => x.uid !== uid); changed(); return; }
  const { db, F } = await loadDb();
  await F.deleteDoc(F.doc(db, "requests", uid));
}

export async function approve(uid) {
  const r = (S.requests || []).find((x) => x.uid === uid);
  if (!r) return;
  await addMember(r.email, false);
  await drop(uid);
}
export const decline = (uid) => drop(uid);
