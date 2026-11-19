// Team-Liste im Dokument config/team: { emails: [...], admins: [...], updatedAt }.
// Wer in "emails" steht, darf die App benutzen. Wer in "admins" steht, darf die Liste ändern.
// Die Firestore-Regeln setzen das durch. Diese Datei liest und schreibt nur.
import { S, changed } from "./state.js";
import { loadDb } from "./firebase.js";

// E-Mails immer kleingeschrieben und ohne Doppelte (die Regeln vergleichen kleingeschrieben)
export const cleanEmails = (list) => [...new Set((Array.isArray(list) ? list : []).map((x) => String(x || "").trim().toLowerCase()).filter(Boolean))];
export const validEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
// Webhooks pro Map: nur Einträge mit Text behalten
const cleanHooks = (v) => (v && typeof v === "object" && !Array.isArray(v)
  ? Object.fromEntries(Object.entries(v).filter(([k, url]) => k && typeof url === "string" && url.trim()).map(([k, url]) => [k, url.trim()]))
  : {});

let stop = null;
let run = 0;   // zählt hoch, damit Antworten einer alten Abfrage ignoriert werden

export function stopTeam() {
  run++;
  if (stop) { stop(); stop = null; }
}

// Beobachtet config/team und meldet an cb, was für den angemeldeten Nutzer gilt:
//   { state: "member", team }  freigeschaltet
//   { state: "new" }           Lesen erlaubt, aber das Dokument fehlt: Das geht nur beim Besitzer
//   { state: "blocked" }       Lesen verboten: nicht auf der Liste
//   { state: "waiting" }       noch keine Antwort vom Server
//   { state: "error", error }  alles andere
export async function watchTeam(email, cb) {
  stopTeam();
  const mine = run;
  let db, F;
  try { ({ db, F } = await loadDb()); }
  catch (error) { if (mine === run) cb({ state: "error", error }); return; }
  if (mine !== run) return;

  stop = F.onSnapshot(F.doc(db, "config", "team"), { includeMetadataChanges: true }, (snap) => {
    if (mine !== run) return;
    const cached = snap.metadata.fromCache;
    if (!snap.exists()) { cb({ state: cached ? "waiting" : "new" }); return; }
    const d = snap.data();
    // discordWebhook: Standard-Adresse zum Posten in Discord (js/discord.js), leer = keine.
    // discordMaps: { "<Map>": Adresse } für einen eigenen Kanal pro Map (Wunsch Tim, 19.11.2026)
    const team = {
      emails: cleanEmails(d.emails), admins: cleanEmails(d.admins),
      discordWebhook: typeof d.discordWebhook === "string" ? d.discordWebhook : "",
      discordMaps: cleanHooks(d.discordMaps),
    };
    // Stammt die Liste nur aus dem Zwischenspeicher des Geräts, zählt sie erst, wenn man selbst draufsteht.
    // (Auf einem geteilten Gerät könnte sie von jemand anderem stammen.)
    const listed = team.emails.includes(email) || team.admins.includes(email);
    if (cached && !listed) { cb({ state: "waiting" }); return; }
    cb({ state: "member", team });
  }, (error) => {
    if (mine !== run) return;
    stop = null;
    cb(error.code === "permission-denied" ? { state: "blocked" } : { state: "error", error });
  });
}

// ---------- Schreiben ----------
// In der Vorschau (S.demo) wird nur die Liste im Arbeitsspeicher geändert.

function demoChange(fn) {
  const t = { emails: [...S.team.emails], admins: [...S.team.admins] };
  fn(t);
  S.team = { ...S.team, emails: cleanEmails(t.emails), admins: cleanEmails(t.admins) };
  changed();
}

async function teamRef() {
  const { db, F } = await loadDb();
  return { F, ref: F.doc(db, "config", "team") };
}

// Erster Start: Der Besitzer legt die Liste an und steht selbst als Mitglied und Admin drauf.
export async function createTeam(moreEmails) {
  const me = S.user.email;
  const { F, ref } = await teamRef();
  await F.setDoc(ref, { emails: cleanEmails([me, ...moreEmails]), admins: [me], updatedAt: F.serverTimestamp() });
}

export async function addMember(email, asAdmin) {
  if (S.demo) return demoChange((t) => { t.emails.push(email); if (asAdmin) t.admins.push(email); });
  const { F, ref } = await teamRef();
  const change = { emails: F.arrayUnion(email), updatedAt: F.serverTimestamp() };
  if (asAdmin) change.admins = F.arrayUnion(email);
  await F.updateDoc(ref, change);
}

export async function removeMember(email) {
  if (S.demo) return demoChange((t) => { t.emails = t.emails.filter((x) => x !== email); t.admins = t.admins.filter((x) => x !== email); });
  const { F, ref } = await teamRef();
  await F.updateDoc(ref, { emails: F.arrayRemove(email), admins: F.arrayRemove(email), updatedAt: F.serverTimestamp() });
}

// Discord-Webhooks speichern: Standard-Adresse (url, "" = keine) und eine Adresse pro Map (maps). Ersetzt beides
// ganz. Nur Admins (Firestore-Regeln: config/team).
export async function setDiscordHooks(url, maps) {
  const clean = cleanHooks(maps);
  if (S.demo) { S.team = { ...S.team, discordWebhook: url, discordMaps: clean }; changed(); return; }
  const { F, ref } = await teamRef();
  await F.updateDoc(ref, { discordWebhook: url, discordMaps: clean, updatedAt: F.serverTimestamp() });
}

export async function setAdmin(email, on) {
  if (S.demo) return demoChange((t) => { if (on) { t.admins.push(email); t.emails.push(email); } else t.admins = t.admins.filter((x) => x !== email); });
  const { F, ref } = await teamRef();
  const change = { admins: on ? F.arrayUnion(email) : F.arrayRemove(email), updatedAt: F.serverTimestamp() };
  if (on) change.emails = F.arrayUnion(email);   // ein Admin muss auch Mitglied sein, sonst darf er nichts lesen
  await F.updateDoc(ref, change);
}
