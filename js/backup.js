// Export und Import (Backup), PLAN.md Abschnitt 7 "Export & Import".
// - CSV: alle Matches, eine Zeile pro Spieler und Match, für deutsches Excel (Semikolon, Dezimalkomma, UTF-8 mit BOM).
//   Unser Team und das Scoreboard der Gegner stehen beide drin, die Spalte "Team" sagt, wer wer ist.
// - JSON: alles (Spieler, Matches, Clips, auch der Papierkorb), so wie es in der Datenbank steht.
// - Import: liest einen JSON-Export, prüft ihn und rechnet aus, was neu ist und was überschrieben wird.
//   Geschrieben wird erst nach der Bestätigung, und nur über putMany in data.js.
// Alles arbeitet mit dem, was schon geladen ist: Export und Import kosten keine Lesezugriffe.
import { S } from "./state.js";
import { APP_NAME } from "./config.js";
import { ALL_STAT_FIELDS, RES_LABEL } from "./constants.js";
import { today, num } from "./util.js";
import { everything, known, putMany } from "./data.js";
import { result, kdOf } from "./stats.js";

export const FORMAT = 1;              // Version des JSON-Formats (für spätere Änderungen)
export const APP_KEY = "valo-matchlog";
const COLLS = ["players", "matches", "clips"];
const MAX_BYTES = 25 * 1024 * 1024;    // größere Dateien sind sicher kein Export dieser App

// ---------- JSON ----------

// Dokument für die Datei: Felder alphabetisch, damit zwei Exporte gut vergleichbar sind
const sorted = (x) => Object.keys(x).sort().reduce((o, k) => { o[k] = x[k]; return o; }, {});
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function buildJson() {
  const out = {
    app: APP_KEY, format: FORMAT, exportedAt: new Date().toISOString(),
    // Die Team-Liste steht nur zur Information drin. Der Import ändert sie nicht.
    team: S.team ? { emails: [...S.team.emails], admins: [...S.team.admins] } : null,
  };
  for (const coll of COLLS) out[coll] = everything(coll).map(sorted).sort(byId);
  return JSON.stringify(out, null, 2);
}

// ---------- CSV ----------

const SEP = ";";
// Zahl mit Dezimalkomma, leer wenn nichts eingetragen ist
const dec = (n, digits = 2) => (n === null || n === undefined || !isFinite(n) ? "" : Number(n).toFixed(digits).replace(".", ","));
const int = (n) => (n === null || n === undefined || !isFinite(n) ? "" : String(Math.round(n)));
// "2026-11-16" -> "16.11.2026" (erkennt deutsches Excel als Datum)
const deDate = (iso) => (/^\d{4}-\d{2}-\d{2}$/.test(iso || "") ? iso.slice(8, 10) + "." + iso.slice(5, 7) + "." + iso.slice(0, 4) : String(iso || ""));
const SIDE = { atk: "Angriff", def: "Verteidigung" };

// Text-Zelle: in Anführungszeichen, wenn nötig. Beginnt sie mit = + - @, setzt Excel sonst eine Formel daraus:
// Dann kommt ein Apostroph davor (zeigt Excel nicht an).
function cell(v) {
  if (v === null || v === undefined) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export const CSV_HEAD = [
  "Match-ID", "Datum", "Art", "Gegner", "Map", "Score wir", "Score die", "Ergebnis", "Runden", "Startseite", "Rundenverlauf",
  "Team", "Spieler-ID", "Spieler (Roster)", "Ingame-Name", "Agent",
  ...ALL_STAT_FIELDS.map(([, , long]) => long), "K/D", "Notizen",
];

export function buildCsv() {
  const roster = new Map(everything("players").map((p) => [p.id, p.name]));
  // Gelöschte Matches stehen nicht in der CSV (die ist zum Auswerten da). Im JSON sind sie drin.
  const matches = S.matches.slice().sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")) || byId(a, b));
  const lines = [CSV_HEAD.map(cell).join(SEP)];
  for (const m of matches) {
    const us = num(m.scoreUs), them = num(m.scoreThem);
    const rounds = us !== null && them !== null ? us + them : null;
    const head = [
      cell(m.id), cell(deDate(m.date)), cell(m.type), cell(m.opponent), cell(m.map), int(us), int(them),
      cell(RES_LABEL[result(m)]), int(rounds), cell(SIDE[m.startSide] || ""), cell(m.rounds || ""),
    ];
    const row = (team, p) => {
      const kd = p ? kdOf(num(p.kills), num(p.deaths)) : null;
      return [
        ...head, cell(team), cell(p ? p.playerId || "" : ""), cell(p && p.playerId ? roster.get(p.playerId) || "" : ""),
        cell(p ? p.name : ""), cell(p ? p.agent : ""),
        ...ALL_STAT_FIELDS.map(([key]) => int(p ? p[key] : null)), dec(kd), cell(m.notes || ""),
      ].join(SEP);
    };
    const ours = Array.isArray(m.players) ? m.players : [];
    const foes = Array.isArray(m.opponents) ? m.opponents : [];
    // Ein Match ohne Spielerzeilen bekommt trotzdem eine Zeile, damit es nicht fehlt
    if (!ours.length && !foes.length) lines.push(row("Wir", null));
    for (const p of ours) lines.push(row("Wir", p));
    for (const p of foes) lines.push(row("Gegner", p));
  }
  // BOM vorne, Zeilenende wie unter Windows: So öffnet Excel die Datei mit Umlauten und in Spalten
  return "﻿" + lines.join("\r\n") + "\r\n";
}

// ---------- Herunterladen ----------

export const fileName = (kind) => `${APP_KEY}-${kind}-${today()}.${kind === "matches" ? "csv" : "json"}`;

export function download(text, name, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.rel = "noopener"; a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Erst später freigeben: Manche Browser (Safari) brauchen die Adresse noch einen Moment
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// ---------- Import ----------

const bad = (text) => Object.assign(new Error(text), { plain: true });
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const LABEL = { players: "Spieler", matches: "Matches", clips: "Clips" };
const ID_RE = /^[a-z0-9]{1,64}$/;

// Firestore kennt keine Listen in Listen und kein undefined. Tiefe begrenzen, damit nichts Seltsames durchrutscht.
function storable(v, depth = 0, inList = false) {
  if (v === null || typeof v === "string" || typeof v === "boolean") return true;
  if (typeof v === "number") return isFinite(v);
  if (depth > 6) return false;
  if (Array.isArray(v)) return !inList && v.every((x) => storable(x, depth + 1, true));
  if (isObj(v)) return Object.keys(v).every((k) => k && !k.startsWith("__")) && Object.values(v).every((x) => storable(x, depth + 1, false));
  return false;
}

// Prüft ein Dokument und liefert es so, wie es geschrieben wird (ohne updatedAt, deleted immer true/false)
function cleanDoc(coll, d, n) {
  const where = `${LABEL[coll]}, Eintrag ${n}`;
  if (!isObj(d)) throw bad(`${where}: kein gültiger Eintrag.`);
  if (typeof d.id !== "string" || !ID_RE.test(d.id)) throw bad(`${where}: Die ID fehlt oder ist ungültig.`);
  const { updatedAt, ...rest } = d;
  if (!storable(rest)) throw bad(`${where} (${d.id}): enthält Werte, die sich nicht speichern lassen.`);
  if (JSON.stringify(rest).length > 900000) throw bad(`${where} (${d.id}): ist zu groß.`);
  if (coll === "players" && typeof d.name !== "string") throw bad(`${where} (${d.id}): Der Name fehlt.`);
  if (coll === "matches") {
    if (!Array.isArray(d.players)) throw bad(`${where} (${d.id}): Die Spielerliste fehlt.`);
    if (!d.players.every(isObj)) throw bad(`${where} (${d.id}): Die Spielerliste ist kaputt.`);
    if (d.opponents !== undefined && (!Array.isArray(d.opponents) || !d.opponents.every(isObj))) throw bad(`${where} (${d.id}): Das Scoreboard der Gegner ist kaputt.`);
  }
  if (coll === "clips") {
    if (typeof d.matchId !== "string") throw bad(`${where} (${d.id}): Das zugehörige Match fehlt.`);
    if (d.notes !== undefined && !Array.isArray(d.notes)) throw bad(`${where} (${d.id}): Die Notizen sind kaputt.`);
  }
  return { ...rest, deleted: rest.deleted === true };
}

// Datei lesen und prüfen. Liefert den Plan für die Vorschau oder wirft einen Fehler mit deutscher Meldung.
export async function readImport(file) {
  if (!file) throw bad("Keine Datei gewählt.");
  if (file.size > MAX_BYTES) throw bad("Die Datei ist zu groß für einen Export dieser App.");
  let text;
  try { text = await file.text(); } catch (e) { throw bad("Die Datei ließ sich nicht lesen."); }
  return planImport(text, file.name);
}

// Vergleich ohne updatedAt und unabhängig von der Reihenfolge der Felder (wie in data.js)
const deep = (k, v) => (isObj(v) ? Object.keys(v).sort().reduce((o, key) => { o[key] = v[key]; return o; }, {}) : v);
const sameDoc = (a, b) => JSON.stringify({ ...a, updatedAt: 0 }, deep) === JSON.stringify({ ...b, updatedAt: 0 }, deep);

export function planImport(text, name = "") {
  let data;
  try { data = JSON.parse(String(text).replace(/^﻿/, "")); }
  catch (e) { throw bad(`„${name || "Die Datei"}“ ist keine JSON-Datei. Gewählt werden muss der JSON-Export dieser App (nicht die CSV).`); }
  if (!isObj(data) || data.app !== APP_KEY) throw bad(`Diese Datei ist kein Export von ${APP_NAME}.`);
  if (!Number.isInteger(data.format) || data.format < 1) throw bad("Die Datei hat kein gültiges Format.");
  if (data.format > FORMAT) throw bad("Diese Datei stammt aus einer neueren Version der App. Bitte erst die App neu laden (Strg + F5).");
  const plan = { name, exportedAt: typeof data.exportedAt === "string" ? data.exportedAt : null, total: 0, newer: 0, colls: {} };
  for (const coll of COLLS) {
    const list = data[coll] === undefined ? [] : data[coll];
    if (!Array.isArray(list)) throw bad(`In der Datei sind die ${LABEL[coll]} keine Liste.`);
    const seen = new Set();
    const c = { docs: [], create: 0, overwrite: 0, same: 0, deleted: 0, count: list.length };
    list.forEach((raw, i) => {
      const doc = cleanDoc(coll, raw, i + 1);
      if (seen.has(doc.id)) throw bad(`${LABEL[coll]}: Die ID ${doc.id} kommt doppelt vor.`);
      seen.add(doc.id);
      if (doc.deleted) c.deleted++;
      const old = known(coll, doc.id);
      if (!old) { c.create++; c.docs.push(doc); return; }
      if (sameDoc(old, doc)) { c.same++; return; }   // schon genau so da: kein Schreibvorgang nötig
      c.overwrite++;
      c.docs.push(doc);
      // Nach dem Export noch geändert? Diese Änderung ginge beim Einspielen verloren.
      if (old.updatedAt && !(typeof raw.updatedAt === "number" && raw.updatedAt >= old.updatedAt)) plan.newer++;
    });
    plan.colls[coll] = c;
    plan.total += c.docs.length;
  }
  if (!COLLS.some((coll) => plan.colls[coll].count)) throw bad("Die Datei enthält keine Matches, Spieler oder Clips.");
  return plan;
}

// Plan schreiben: Spieler zuerst (Matches verweisen auf sie), dann Matches, dann Clips
export async function applyImport(plan) {
  for (const coll of COLLS) await putMany(coll, plan.colls[coll].docs);
}
