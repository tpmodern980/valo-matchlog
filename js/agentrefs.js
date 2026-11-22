// Lernen aus Korrekturen (Wunsch Tim, 16.11.2026): Die KI verwechselt beim Auslesen manche Agents
// (Waylay/Deadlock, Waylay/Gekko, Iso/Vyse). Deshalb merkt sich die App kleine Agenten-Bilder aus echten
// Screenshots mit dem richtigen Namen (Sammlung "agentRefs" in Firestore, nur fürs Team lesbar) und schickt sie
// beim Auslesen als beschriftete Beispieltafel mit.
//
// Dokument: { agent, pic (JPEG als base64, wenige KB), kind: "fix" | "ok", wrong (was die KI las, oder null) }
// Gespeichert werden
//   - Korrekturen ("fix"): in der Zeile steht beim Speichern ein anderer Agent als der gelesene,
//   - seit 22.11.2026 (bessere Erkennung) auch Bestätigungen ("ok"), aber nur für die Verwechslungs-Agents
//     (AGENT_LOOKALIKE) und nur, bis ein Agent OK_MAX Bilder hat: So stehen auf der Tafel beide Seiten eines Paares
//     (z. B. Waylay UND Deadlock), und die KI kann vergleichen statt nur eine Seite zu kennen.
// Höchstens maxOf(agent) Bilder pro Agent: Ein neues Bild ersetzt das älteste. Weiterhin keine hunderte Bilder
// (Wunsch Tim): Für andere Agents gibt es nur Korrekturen.
// Bildgröße: neue Bilder 96 × 96 (vorher 64 × 64, ältere bleiben so und werden auf der Tafel hochskaliert).
import { S } from "./state.js";
import { AGENTS, AGENT_LOOKALIKE } from "./constants.js";
import { norm } from "./util.js";
import { create, remove } from "./data.js";

const MAX_PER_AGENT = 3;      // Bilder pro Agent (das neueste ersetzt das älteste)
const MAX_LOOKALIKE = 5;      // … bei Agents, die leicht verwechselt werden
const OK_MAX = 2;             // Bestätigungen nur, solange ein Verwechslungs-Agent weniger Bilder hat
const SHEET_MAX = 64;         // höchstens so viele Bilder auf der Tafel
export const PIC_SIDE = 96;
const lookalike = (agent) => Object.hasOwn(AGENT_LOOKALIKE, agent);
const maxOf = (agent) => (lookalike(agent) ? MAX_LOOKALIKE : MAX_PER_AGENT);

const agentName = (text) => AGENTS.find((a) => norm(a) === norm(text)) || null;

const refsOf = (agent) => S.agentRefs.filter((r) => r.agent === agent);

// Nach dem Speichern eines Matches: Zeilen mit Bild aus dem Auslesen (row.scanPic), deren Agent korrigiert wurde,
// als Beispiel merken. rows: die Zeilen des Formulars (unser Team und Gegner). Liefert die Zahl der neuen Beispiele.
export async function learn(rows) {
  let added = 0;
  for (const row of rows) {
    if (!row || !row.scanPic) continue;
    const agent = agentName(row.agent);
    const read = row.scanAgent || null;
    const pic = row.scanPic;
    row.scanPic = null;   // nie zweimal
    if (!agent) continue;
    const fix = agent !== read;   // Korrektur (auch: KI hatte keinen Agent erkannt)
    // Bestätigung: nur Verwechslungs-Agents, nur solange sie noch wenige Bilder haben
    if (!fix && (!lookalike(agent) || refsOf(agent).length >= OK_MAX)) continue;
    try {
      // Platz machen: Sind schon maxOf(agent) Bilder von diesem Agent da, fliegt das älteste raus
      const old = refsOf(agent).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      for (const r of old.slice(0, Math.max(0, old.length - maxOf(agent) + 1))) await remove("agentRefs", r.id);
      await create("agentRefs", { agent, pic, kind: fix ? "fix" : "ok", wrong: fix ? read : null });
      added++;
    } catch (e) {
      console.warn("Agenten-Beispiel nicht gespeichert:", e.code || e.message);
    }
  }
  return added;
}

// Welche Beispiele auf die Tafel kommen: pro Agent die neuesten (höchstens maxOf), Korrekturen vor Bestätigungen.
// Reihenfolge: erst die Verwechslungs-Paare nebeneinander (Gekko, Waylay, Deadlock, Iso, Vyse, Fade, Hush), dann der Rest.
const PAIR_ORDER = ["Gekko", "Waylay", "Deadlock", "Iso", "Vyse", "Fade", "Hush"];
export function sheetRefs() {
  const by = new Map();
  for (const r of S.agentRefs) {
    if (!r.pic || !agentName(r.agent)) continue;
    if (!by.has(r.agent)) by.set(r.agent, []);
    by.get(r.agent).push(r);
  }
  const out = [];
  const rank = (a) => { const i = PAIR_ORDER.indexOf(a); return i < 0 ? 99 : i; };
  for (const agent of [...by.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, "de"))) {
    const list = by.get(agent).sort((a, b) => (a.kind === "ok") - (b.kind === "ok") || (b.createdAt || 0) - (a.createdAt || 0));
    out.push(...list.slice(0, maxOf(agent)));
  }
  return out.slice(0, SHEET_MAX);
}

const loadPic = (b64) => new Promise((ok, no) => {
  const img = new Image();
  img.onload = () => ok(img);
  img.onerror = no;
  img.src = "data:image/jpeg;base64," + b64;
});

// Beispieltafel als JPEG: Kacheln mit Bild und Namen darunter. Liefert { base64, mimeType, count } oder null.
export async function refSheet() {
  const refs = sheetRefs();
  if (!refs.length) return null;
  const TILE = 128, LABEL = 26, GAP = 8, COLS = Math.min(8, refs.length);
  const rows = Math.ceil(refs.length / COLS);
  const canvas = document.createElement("canvas");
  canvas.width = COLS * (TILE + GAP) + GAP;
  canvas.height = rows * (TILE + LABEL + GAP) + GAP;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#101418";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 18px Arial, Helvetica, sans-serif";
  let drawn = 0;
  for (let i = 0; i < refs.length; i++) {
    const x = GAP + (i % COLS) * (TILE + GAP), y = GAP + Math.floor(i / COLS) * (TILE + LABEL + GAP);
    try {
      const img = await loadPic(refs[i].pic);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, x, y, TILE, TILE);
    } catch (e) { continue; }
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(refs[i].agent.toUpperCase(), x + TILE / 2, y + TILE + LABEL / 2);
    drawn++;
  }
  if (!drawn) return null;
  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mimeType: "image/jpeg", count: drawn };
}
