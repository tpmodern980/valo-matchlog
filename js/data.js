// Daten des Teams: Spieler, Matches und Clips aus Firestore, sparsam geladen (PLAN.md Abschnitt 6).
// Ablauf pro Sammlung:
//   1. Alles aus dem Zwischenspeicher des Geräts lesen und anzeigen (kostet keine Lesezugriffe).
//   2. Nur abonnieren, was seit dem neuesten gespeicherten Stand geändert wurde (updatedAt > letzter Stand).
// Gelöscht wird nur weich (deleted: true), sonst würde der Zwischenspeicher das Löschen nie erfahren.
// Die Ansichten lesen S.players, S.matches und S.clips: Dort stehen nur die nicht gelöschten Einträge.
import { S, changed } from "./state.js";
import { loadDb, clearDb, dbLoaded } from "./firebase.js";
import { newId, toast } from "./util.js";

const COLLS = ["players", "matches", "clips"];
const ID_PREFIX = { players: "p", matches: "m", clips: "c" };
// Merker im Browser: Auf diesem Gerät liegen geladene Daten (damit sie auch nach einer abgelaufenen Anmeldung entfernt werden)
const CACHE_FLAG = "valo-has-cache";

// Alle Dokumente pro Sammlung, auch die gelöschten (die braucht später der Papierkorb)
const all = { players: new Map(), matches: new Map(), clips: new Map() };
let stops = [];        // Abos beenden
let run = 0;           // zählt hoch, damit Antworten eines alten Starts ignoriert werden
let running = false;
let warned = false;

// Eigene Meldung, die schon fertig auf Deutsch ist (wie in auth.js)
const say = (text) => Object.assign(new Error(text), { plain: true });

function publish(coll) {
  S[coll] = [...all[coll].values()].filter((x) => !x.deleted);
}

// Firestore-Dokument als einfaches Objekt. updatedAt wird zu Millisekunden
// (bei einer eigenen, noch nicht bestätigten Änderung: die Zeit dieses Geräts).
function plain(d) {
  const x = d.data({ serverTimestamps: "estimate" });
  x.id = d.id;
  x.updatedAt = x.updatedAt && typeof x.updatedAt.toMillis === "function" ? x.updatedAt.toMillis() : null;
  x.deleted = x.deleted === true;
  return x;
}

// Vergleich ohne updatedAt und unabhängig von der Reihenfolge der Felder
const sortKeys = (k, v) => v && typeof v === "object" && !Array.isArray(v)
  ? Object.keys(v).sort().reduce((o, key) => { o[key] = v[key]; return o; }, {}) : v;
function same(a, b) {
  if (!a || !b) return false;
  return JSON.stringify({ ...a, updatedAt: 0 }, sortKeys) === JSON.stringify({ ...b, updatedAt: 0 }, sortKeys);
}

const later = (a, b) => a.seconds > b.seconds || (a.seconds === b.seconds && a.nanoseconds > b.nanoseconds);

// ---------- Laden ----------

// Startet das Laden für den angemeldeten, freigeschalteten Nutzer. Läuft es schon, passiert nichts.
export async function startData() {
  if (running || S.demo) return;
  running = true;
  const mine = run;
  try { localStorage.setItem(CACHE_FLAG, "1"); } catch (e) { /* nicht schlimm */ }
  let db, F;
  try { ({ db, F } = await loadDb()); }
  catch (e) {
    if (mine !== run) return;
    console.warn("Datenbank ließ sich nicht starten:", e.code || e.message);
    for (const coll of COLLS) S.loaded[coll] = true;
    changed();
    return;
  }
  if (mine !== run) return;
  await Promise.all(COLLS.map((coll) => watch(coll, db, F, mine)));
}

async function watch(coll, db, F, mine) {
  const ref = F.collection(db, coll);

  // 1. Zwischenspeicher. Letzter Stand = höchstes vom Server bestätigtes updatedAt darin.
  //    Bei einer eigenen, noch nicht bestätigten Änderung zählt der Wert davor ("previous"),
  //    nie die Uhr dieses Geräts: Ginge sie vor, würden Änderungen der anderen übersprungen.
  let last = null, cached = 0;
  try {
    const snap = await F.getDocsFromCache(ref);
    if (mine !== run) return;
    for (const d of snap.docs) {
      all[coll].set(d.id, plain(d));
      const t = d.get("updatedAt", { serverTimestamps: "previous" });
      if (t && typeof t.toMillis === "function" && (!last || later(t, last))) last = t;
    }
    cached = snap.size;
  } catch (e) {
    if (mine !== run) return;
    console.warn(`Zwischenspeicher für „${coll}“ nicht lesbar, lade alles vom Server:`, e.code || e.message);
  }
  // Ist der Zwischenspeicher leer, bleibt "Lade …" stehen, bis der Server geantwortet hat
  // (sonst stünde beim allerersten Start kurz "Noch keine Matches" da). Ohne Verbindung gleich zeigen.
  if (cached || navigator.onLine === false) { publish(coll); S.loaded[coll] = true; changed(); }

  // 2. Nur das Neue abonnieren. Kein Filter auf "deleted": Der bräuchte einen zusammengesetzten Index.
  const q = last ? F.query(ref, F.where("updatedAt", ">", last)) : ref;
  let fresh = 0, synced = false;
  stops.push(F.onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    if (mine !== run) return;
    let dirty = !S.loaded[coll];
    for (const ch of snap.docChanges()) {
      // "removed" heißt hier nur: Das Dokument passt gerade nicht mehr zur Abfrage. Das passiert bei jeder
      // eigenen Änderung, solange der Server-Zeitstempel noch aussteht. Wirklich gelöscht wird nie.
      if (ch.type === "removed") continue;
      const next = plain(ch.doc);
      fresh++;
      const known = same(all[coll].get(next.id), next);
      all[coll].set(next.id, next);
      if (!known) dirty = true;
    }
    if (!synced && !snap.metadata.fromCache) {
      synced = true;
      // Nachweis fürs sparsame Laden: Jedes nachgeladene Dokument ist ein Lesezugriff
      console.info(`Daten „${coll}“: ${cached} aus dem Zwischenspeicher, ${fresh} vom Server nachgeladen.`);
    }
    if (dirty) { publish(coll); S.loaded[coll] = true; changed(); }
  }, (e) => {
    if (mine !== run) return;
    console.warn(`Daten „${coll}“ konnten nicht geladen werden:`, e.code || e.message);
    // Bei "permission-denied" zeigt auth.js ohnehin die Sperrseite
    if (e.code !== "permission-denied" && !warned) {
      warned = true;
      toast("Neue Daten konnten gerade nicht geladen werden. Du siehst den zuletzt gespeicherten Stand.");
    }
    if (!S.loaded[coll]) { publish(coll); S.loaded[coll] = true; changed(); }
  }));
}

// Abos beenden und die Daten aus dem Arbeitsspeicher nehmen
export function stopData() {
  run++;
  for (const stop of stops) stop();
  stops = [];
  running = false;
  warned = false;
  for (const coll of COLLS) { all[coll].clear(); S[coll] = []; S.loaded[coll] = false; }
}

// Beim Abmelden und auf der Sperrseite: alles stoppen und den Zwischenspeicher dieses Geräts leeren.
// Sind noch andere Tabs der App offen, klappt das Leeren erst beim nächsten Versuch (der Merker bleibt stehen).
export async function wipeData() {
  stopData();
  let flagged = false;
  try { flagged = Boolean(localStorage.getItem(CACHE_FLAG)); } catch (e) { /* bleibt false */ }
  if (!flagged && !dbLoaded()) return;
  try {
    await clearDb();
    try { localStorage.removeItem(CACHE_FLAG); } catch (e) { /* nicht schlimm */ }
  } catch (e) {
    console.warn("Zwischenspeicher konnte nicht geleert werden:", e.code || e.message);
  }
}

// Vorschau: Beispieldaten direkt einsetzen (demo.js)
export function setLocal(coll, list) {
  all[coll] = new Map(list.map((x) => [x.id, x]));
  publish(coll);
  S.loaded[coll] = true;
}

// ---------- Schreiben ----------
// Jede Änderung steht sofort in S und geht gleichzeitig an Firestore. Auf die Bestätigung des Servers wird
// nicht gewartet: Ohne Verbindung liegt die Änderung im Zwischenspeicher und wird später übertragen.
// In der Vorschau (S.demo) wird nur der Arbeitsspeicher geändert.
// Die Regeln verlangen bei jedem Schreiben updatedAt als Server-Zeitstempel.

function current(coll, id) {
  const old = all[coll].get(id);
  if (!old || old.deleted) throw say("Diesen Eintrag gibt es nicht mehr. Vielleicht hat ihn gerade jemand gelöscht.");
  return old;
}

function show(coll, id, next) {
  all[coll].set(id, next);
  publish(coll);
  changed();
}

// fields(F) liefert die Felder. F ist das Firestore-Modul (für arrayUnion und arrayRemove).
async function send(coll, id, fields, isNew) {
  if (S.demo) return;
  const { db, F } = await loadDb();
  const mine = run;
  const ref = F.doc(db, coll, id);
  const body = { ...fields(F), updatedAt: F.serverTimestamp() };
  (isNew ? F.setDoc(ref, body) : F.updateDoc(ref, body)).catch((e) => failed(coll, e, mine));
}

// Der Server hat eine Änderung abgelehnt: Bescheid sagen und die Anzeige auf den echten Stand zurücksetzen
async function failed(coll, e, mine) {
  console.warn("Speichern fehlgeschlagen:", e.code || e.message);
  if (mine !== run) return;
  toast(e.code === "permission-denied"
    ? "Nicht gespeichert: Dafür fehlt dir die Berechtigung."
    : "Speichern hat nicht geklappt. Die Änderung wurde zurückgenommen." + (e.code ? ` (Fehler: ${e.code})` : ""));
  try {
    const { db, F } = await loadDb();
    const snap = await F.getDocsFromCache(F.collection(db, coll));
    if (mine !== run) return;
    all[coll] = new Map(snap.docs.map((d) => [d.id, plain(d)]));
    publish(coll);
    changed();
  } catch (err) { /* Anzeige bleibt, wie sie ist */ }
}

// Neu anlegen. Liefert die ID (entsteht auf dem Gerät, damit es auch offline geht).
export async function create(coll, fields) {
  const id = newId(ID_PREFIX[coll]);
  const doc = { ...fields, createdAt: Date.now(), createdBy: S.user ? S.user.uid : null, deleted: false };
  await send(coll, id, () => doc, true);
  show(coll, id, { ...doc, id, updatedAt: Date.now() });
  return id;
}

// Einzelne Felder ändern. "deleted" bleibt, wie es ist: Eine Änderung holt nichts aus dem Papierkorb zurück.
export async function change(coll, id, fields) {
  const old = current(coll, id);
  await send(coll, id, () => fields);
  show(coll, id, { ...old, ...fields, updatedAt: Date.now() });
}

// Einen Wert an eine Liste anhängen oder herausnehmen (arrayUnion/arrayRemove):
// So geht nichts verloren, wenn zwei gleichzeitig an derselben Liste arbeiten.
export async function listAdd(coll, id, field, value) {
  const old = current(coll, id);
  await send(coll, id, (F) => ({ [field]: F.arrayUnion(value) }));
  const list = Array.isArray(old[field]) ? old[field] : [];
  show(coll, id, { ...old, [field]: list.includes(value) ? list : [...list, value], updatedAt: Date.now() });
}

export async function listRemove(coll, id, field, value) {
  const old = current(coll, id);
  await send(coll, id, (F) => ({ [field]: F.arrayRemove(value) }));
  const list = Array.isArray(old[field]) ? old[field] : [];
  show(coll, id, { ...old, [field]: list.filter((x) => x !== value), updatedAt: Date.now() });
}

// Weich löschen: Der Eintrag verschwindet aus den Ansichten, bleibt aber in der Datenbank.
export async function remove(coll, id) {
  const old = current(coll, id);
  await send(coll, id, () => ({ deleted: true }));
  show(coll, id, { ...old, deleted: true, updatedAt: Date.now() });
}
