// Strats aus Google Drive (Wunsch Tim, 22.11.2026). Die Bilder bleiben im Drive-Ordner des Teams, die App liest nur
// die Ordnerstruktur über die Drive-Schnittstelle (API-Schlüssel) und zeigt die Bilder direkt von Google an.
// Firestore wird dafür weder gelesen noch beschrieben; im Speicher des Gratisplans landet nichts.
//
// Voraussetzungen (ANLEITUNG.md, Schritt 12): Ordner in Drive auf "Jeder mit dem Link kann ansehen", Google Drive API
// im Cloud-Projekt eingeschaltet, API-Schlüssel nur für die eigene Seite und nur für die Drive API.
// Ordner-ID und Schlüssel stehen in config/team (stratsFolder, stratsKey), eingetragen im Tab "Team".
//
// Erwarteter Aufbau (so ist der Ordner des Teams angelegt, andere Namen gehen auch):
//   <Ordner>/<Map>[ (inactiv)]/<Attack|Defense>/[<Gruppe>/…]<Bild>
//   Bilder und Tabellen direkt im Ordner erscheinen oben als "Allgemein".
import { S, changed } from "./state.js";

const API = "https://www.googleapis.com/drive/v3/files";
const FOLDER = "application/vnd.google-apps.folder";
const CACHE_KEY = "valo-strats";
const FRESH_MS = 2 * 60 * 1000;   // so lange gilt der letzte Stand als frisch (Tab erneut öffnen lädt dann nicht neu)

// Ordner-ID aus einem Drive-Link (…/folders/<id>?usp=sharing) oder die ID selbst
export function folderId(text) {
  const s = String(text || "").trim();
  const m = /\/folders\/([\w-]{10,})/.exec(s) || /[?&]id=([\w-]{10,})/.exec(s);
  if (m) return m[1];
  return /^[\w-]{10,}$/.test(s) ? s : "";
}
export const validKey = (s) => /^AIza[\w-]{30,}$/.test(String(s || "").trim());
export const stratsOn = () => Boolean(S.team && S.team.stratsFolder && S.team.stratsKey);

// Bildadressen bei Google (Größe in Pixel Breite). Beispielbilder der Vorschau sind eingebettet.
export const thumbUrl = (f, w = 640) => (f.demo ? f.demo : `https://drive.google.com/thumbnail?id=${encodeURIComponent(f.id)}&sz=w${w}`);
export const driveUrl = (f) => (f.mimeType === "application/vnd.google-apps.spreadsheet" ? `https://docs.google.com/spreadsheets/d/${f.id}/edit`
  : f.mimeType === "application/vnd.google-apps.document" ? `https://docs.google.com/document/d/${f.id}/edit`
    : f.mimeType === FOLDER ? `https://drive.google.com/drive/folders/${f.id}` : `https://drive.google.com/file/d/${f.id}/view`);
export const isImage = (f) => String(f.mimeType || "").startsWith("image/");

// ---------- Zustand ----------
// tree: { folder, at, root: { files: [...] }, maps: [{ id, name, base, note, sides: [{ name, groups: [{ name, files }] }] }] }
const state = { tree: null, loading: false, error: "", run: 0 };
try {
  const v = JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
  if (v && v.folder && Array.isArray(v.maps)) state.tree = v;
} catch (e) { /* ohne Zwischenstand */ }

export function stratsState() {
  const folder = S.team && S.team.stratsFolder;
  const tree = state.tree && state.tree.folder === folder ? state.tree : null;
  return { tree, loading: state.loading, error: state.error };
}

// Lädt neu, wenn nötig (force: immer). Meldet sich über changed().
export async function loadStrats(force = false) {
  if (!stratsOn()) return;
  const { stratsFolder: folder, stratsKey: key } = S.team;
  const cur = stratsState().tree;
  if (state.loading || (!force && cur && Date.now() - cur.at < FRESH_MS)) return;
  const mine = ++state.run;
  state.loading = true; state.error = ""; changed();
  try {
    const files = S.demo ? demoFiles() : await walk(folder, key);
    if (mine !== state.run) return;
    state.tree = { folder, at: Date.now(), ...build(folder, files) };
    if (!S.demo) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(state.tree)); } catch (e) { /* zu groß: dann ohne */ } }
  } catch (e) {
    if (mine !== state.run) return;
    state.error = e && e.plain ? e.message : "Die Strats ließen sich nicht laden. Prüf die Verbindung und versuch es noch einmal.";
  } finally {
    if (mine === state.run) { state.loading = false; changed(); }
  }
}

// Verbindung prüfen (beim Speichern im Tab "Team"): liest nur die oberste Ebene. Wirft eine Meldung mit plain.
export async function testDrive(folder, key) {
  const files = await list([folder], key);
  return files.filter((f) => f.mimeType === FOLDER).length;
}

// ---------- Drive lesen ----------
const say = (text) => Object.assign(new Error(text), { plain: true });

// Alle Dateien unter dem Ordner, Ebene für Ebene (pro Ebene wenige Abfragen, nicht eine pro Ordner)
async function walk(folder, key) {
  const all = [];
  let level = [folder];
  for (let depth = 0; level.length && depth < 6; depth++) {
    const found = await list(level, key);
    all.push(...found);
    level = found.filter((f) => f.mimeType === FOLDER).map((f) => f.id);
  }
  return all;
}

// Ohne Anmeldung (nur API-Schlüssel) lehnt Google Abfragen über mehrere Ordner mit "or" ab (403 "insufficient
// permissions", geprüft 22.11.2026). Deshalb eine Abfrage pro Ordner, bis zu 8 gleichzeitig.
async function list(parents, key) {
  const out = [];
  for (let i = 0; i < parents.length; i += 8) {
    const parts = await Promise.all(parents.slice(i, i + 8).map((p) => listOne(p, key)));
    for (const p of parts) out.push(...p);
  }
  return out;
}

async function listOne(parent, key) {
  const out = [];
  {
    const q = `'${parent}' in parents and trashed = false`;
    let token = "";
    do {
      const url = `${API}?${new URLSearchParams({ q, key, pageSize: "1000", fields: "nextPageToken,files(id,name,mimeType,parents,modifiedTime,imageMediaMetadata(width,height))", ...(token ? { pageToken: token } : {}) })}`;
      let res;
      try { res = await fetch(url); } catch (e) { throw say("Google Drive war nicht erreichbar. Prüf die Verbindung und versuch es noch einmal."); }
      if (!res.ok) throw await driveError(res);
      const body = await res.json();
      out.push(...(body.files || []));
      token = body.nextPageToken || "";
    } while (token);
  }
  return out;
}

async function driveError(res) {
  let reason = "", message = "";
  try { const b = await res.json(); reason = ((b.error && b.error.errors && b.error.errors[0]) || {}).reason || (b.error && b.error.status) || ""; message = (b.error && b.error.message) || ""; } catch (e) { /* ohne Einzelheiten */ }
  if (res.status === 400 && /key/i.test(message + reason)) return say("Der API-Schlüssel stimmt nicht. Ein Admin trägt im Tab „Team“ unter „Strats“ den richtigen ein.");
  if (res.status === 403 && /referer|blocked/i.test(message + reason)) return say("Der API-Schlüssel ist für diese Adresse nicht freigegeben. In der Google-Cloud-Konsole beim Schlüssel unter „Websites“ diese Seite eintragen.");
  if (res.status === 403 && /disabled|not been used|accessNotConfigured/i.test(message + reason)) return say("Die Google Drive API ist im Projekt nicht eingeschaltet (Google-Cloud-Konsole → APIs und Dienste → Bibliothek → Google Drive API → Aktivieren).");
  if (res.status === 404 || (res.status === 403 && /permission/i.test(message + reason))) return say("Der Drive-Ordner wurde nicht gefunden. Stimmt der Link, und steht er auf „Jeder mit dem Link kann ansehen“?");
  if (res.status === 429 || /rate|quota/i.test(reason)) return say("Google bremst gerade (zu viele Abfragen). Warte kurz und versuch es noch einmal.");
  return say(`Google Drive hat die Anfrage abgelehnt (Fehler ${res.status}).`);
}

// ---------- Aufbereiten ----------
const sideOf = (name) => (/attack|angriff|\batk\b/i.test(name) ? "Attack" : /def/i.test(name) || /verteid/i.test(name) ? "Defense" : name.trim());
const SIDE_ORDER = { Attack: 0, Defense: 1 };
const byName = (a, b) => a.name.localeCompare(b.name, "de", { numeric: true, sensitivity: "base" });
const slim = (f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, w: (f.imageMediaMetadata || {}).width || 0, h: (f.imageMediaMetadata || {}).height || 0, ...(f.demo ? { demo: f.demo } : {}) });
// Anzeigename einer Strat: Dateiname ohne Endung
export const stratTitle = (f) => String(f.name || "").replace(/\.(png|jpe?g|webp|gif|bmp|heic)$/i, "").trim() || "Strat";

function build(folder, files) {
  const kids = new Map();
  for (const f of files) for (const p of f.parents || []) { if (!kids.has(p)) kids.set(p, []); kids.get(p).push(f); }
  const childrenOf = (id) => (kids.get(id) || []).slice().sort(byName);
  // Alle Bilder unter einem Ordner, gruppiert nach Unterordner-Pfad ("" = direkt darin)
  const collect = (id, path, groups) => {
    for (const f of childrenOf(id)) {
      if (f.mimeType === FOLDER) collect(f.id, path ? `${path} / ${f.name.trim()}` : f.name.trim(), groups);
      else if (isImage(f)) { if (!groups.has(path)) groups.set(path, []); groups.get(path).push(slim(f)); }
    }
    return groups;
  };
  const toGroups = (m) => [...m.entries()].map(([name, list]) => ({ name, files: list }))
    .sort((a, b) => (a.name === "" ? -1 : b.name === "" ? 1 : a.name.localeCompare(b.name, "de", { numeric: true, sensitivity: "base" })));

  const top = childrenOf(folder);
  const maps = top.filter((f) => f.mimeType === FOLDER).map((mf) => {
    const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(mf.name.trim());
    const base = (m ? m[1] : mf.name).trim(), note = m ? m[2].trim() : "";
    const sides = [];
    const loose = new Map();
    for (const f of childrenOf(mf.id)) {
      if (f.mimeType === FOLDER) {
        const groups = toGroups(collect(f.id, "", new Map()));
        const name = sideOf(f.name);
        const have = sides.find((s) => s.name === name);
        if (have) have.groups.push(...groups); else sides.push({ name, groups });
      } else if (isImage(f)) { if (!loose.has("")) loose.set("", []); loose.get("").push(slim(f)); }
    }
    if (loose.size) sides.push({ name: "Allgemein", groups: toGroups(loose) });
    sides.sort((a, b) => (SIDE_ORDER[a.name] ?? 2) - (SIDE_ORDER[b.name] ?? 2) || a.name.localeCompare(b.name, "de"));
    return { id: mf.id, name: mf.name.trim(), base, note, sides };
  }).sort((a, b) => a.base.localeCompare(b.base, "de"));
  const root = { files: top.filter((f) => f.mimeType !== FOLDER).map(slim) };
  return { root, maps };
}

// Wie viele Strats hat eine Map / Seite?
export const countSide = (s) => s.groups.reduce((n, g) => n + g.files.length, 0);
export const countMap = (m) => m.sides.reduce((n, s) => n + countSide(s), 0);

// ---------- Vorschau (?demo=1): erfundener Ordner mit gezeichneten Beispielbildern ----------
function demoPic(title, hue) {
  const t = String(title).replace(/[<&>"]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 1050"><rect width="1400" height="1050" fill="hsl(${hue},18%,16%)"/>`
    + `<path d="M260 180h520v240h260v460H520V640H260z" fill="hsl(${hue},14%,30%)" stroke="hsl(${hue},20%,55%)" stroke-width="6"/>`
    + `<circle cx="420" cy="300" r="34" fill="#36c5cf"/><circle cx="640" cy="520" r="34" fill="#36c5cf"/><circle cx="880" cy="760" r="34" fill="#ff6b6b"/>`
    + `<path d="M420 300 C520 380 560 460 640 520 S 820 700 880 760" fill="none" stroke="#f2c14e" stroke-width="10" stroke-dasharray="26 18"/>`
    + `<text x="60" y="1000" font-family="sans-serif" font-size="64" font-weight="700" fill="#e8edf2">${t}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
function demoFiles() {
  const out = [];
  let n = 0;
  const id = () => "demo" + (++n);
  const folder = (name, parent) => { const f = { id: id(), name, mimeType: FOLDER, parents: [parent] }; out.push(f); return f.id; };
  const pic = (name, parent, hue) => out.push({ id: id(), name: name + ".png", mimeType: "image/png", parents: [parent], imageMediaMetadata: { width: 1400, height: 1050 }, demo: demoPic(name, hue) });
  const root = "demo-root";
  out.push({ id: id(), name: "Teambook", mimeType: "application/vnd.google-apps.spreadsheet", parents: [root] });
  pic("Premier Plan", root, 200);
  const layout = {
    Bind: [210, { Attack: ["A Push", "B Push", "Default", "Fake Hookah", { Pistol: ["Pistol", "Hookah Contact"] }], Defense: ["A Retake", "B Retake", "Default", { Pistol: ["A Push"] }, { "Short Push": ["Short Push 1", "Short Push 2"] }] }],
    Haven: [160, { Attack: ["A Long Take", "C Pop aus Smoke", "Walk Up B", { Pistol: ["B Hit"] }], Defense: ["122 Default", "C Retake", { Pistol: ["122 Start"] }] }],
    Sunset: [20, { Attack: ["A Rush", "B Split", { Default: ["Mid Default", "131 Default"] }], Defense: [{ Defaults: ["Default 221", "Default B Main Presure"] }, { "mid contest": ["Mid Push"] }] }],
    "Ascent (inactiv)": [280, { Attack: ["B Rush", "Default"], Defense: ["Trap Play"] }],
    "Lotus (perma bann)": [330, { Attack: ["A Take"], Defense: [] }],
  };
  for (const [map, [hue, sides]] of Object.entries(layout)) {
    const m = folder(map, root);
    for (const [side, items] of Object.entries(sides)) {
      const s = folder(side, m);
      for (const it of items) {
        if (typeof it === "string") pic(it, s, hue);
        else for (const [g, list] of Object.entries(it)) { const gid = folder(g, s); list.forEach((x) => pic(x, gid, hue)); }
      }
    }
  }
  folder("Fracture (inactiv)", root);
  return out;
}
export const DEMO_FOLDER = "demo-root";
