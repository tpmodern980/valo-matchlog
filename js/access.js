// Zugang anfragen (Wunsch Tim, 22.11.2026): Wer angemeldet ist, aber nicht auf der Team-Liste steht, tippt auf
// "Zugang anfragen". Die Anfrage landet in requests/<uid> = { email, name, at }. Admins sehen offene Anfragen im Tab
// "Team" (und als Hinweis auf der Startseite) und bestätigen mit einem Tipp: Dann steht die E-Mail auf der Team-Liste
// und die Anfrage wird gelöscht. Braucht eine Zeile in den Firestore-Regeln (firestore.rules, ANLEITUNG.md Schritt 13).
import { S, changed } from "./state.js";
import { loadDb } from "./firebase.js";
import { addMember } from "./team.js";

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
  changed();
}

// ---------- Admins: offene Anfragen beobachten ----------
let stop = null, started = false;
export function watchRequests() {
  if (started || !S.isAdmin) return;
  started = true;
  if (S.demo) {
    S.requests = [{ uid: "udemo-neu", email: "neo@example.com", name: "Neo", at: Date.now() - 3600000 }];
    return;
  }
  loadDb().then(({ db, F }) => {
    stop = F.onSnapshot(F.collection(db, "requests"), (snap) => {
      S.requests = snap.docs.map((d) => {
        const x = d.data();
        return { uid: d.id, email: String(x.email || ""), name: String(x.name || ""), at: x.at && x.at.toMillis ? x.at.toMillis() : 0 };
      }).filter((x) => x.email).sort((a, b) => a.at - b.at);
      changed();
    }, () => { S.requests = []; });   // Regel fehlt oder kein Admin: einfach keine Anfragen zeigen
  }).catch(() => { started = false; });
}
export function stopRequests() { if (stop) stop(); stop = null; started = false; S.requests = []; }

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
