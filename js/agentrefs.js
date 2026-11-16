// Lernen aus Korrekturen (Wunsch Tim, 16.11.2026): Die KI verwechselt beim Auslesen manche Agents
// (Waylay/Deadlock, Waylay/Gekko, Iso/Vyse). Deshalb merkt sich die App kleine Agenten-Bilder aus echten
// Screenshots mit dem richtigen Namen (Sammlung "agentRefs" in Firestore, nur fürs Team lesbar) und schickt sie
// beim Auslesen als beschriftete Beispieltafel mit.
//
// Dokument: { agent, pic (JPEG 64 × 64 als base64, wenige KB), kind: "fix", wrong (was die KI las, oder null) }
// Gespeichert werden nur Korrekturen (in der Zeile steht beim Speichern ein anderer Agent als der gelesene),
// höchstens MAX_PER_AGENT pro Agent: Ein neues Bild ersetzt dann das älteste. So stehen nur die Agents da, die
// wirklich Probleme machen (Wunsch Tim: nicht hunderte Bilder). Ältere Dokumente mit kind "ok" (bestätigt) aus
// der ersten Fassung zählen mit und werden genauso ersetzt.
import { S } from "./state.js";
import { AGENTS } from "./constants.js";
import { norm } from "./util.js";
import { create, remove } from "./data.js";

const MAX_PER_AGENT = 3;   // Bilder pro Agent (das neueste ersetzt das älteste)
const SHEET_MAX = 48;      // höchstens so viele Bilder auf der Tafel
export const PIC_SIDE = 64;

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
    if (!agent || agent === read) continue;   // nur Korrekturen (auch: KI hatte keinen Agent erkannt)
    try {
      // Platz machen: Sind schon MAX_PER_AGENT Bilder von diesem Agent da, fliegt das älteste raus
      const old = refsOf(agent).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
      for (const r of old.slice(0, Math.max(0, old.length - MAX_PER_AGENT + 1))) await remove("agentRefs", r.id);
      await create("agentRefs", { agent, pic, kind: "fix", wrong: read });
      added++;
    } catch (e) {
      console.warn("Agenten-Beispiel nicht gespeichert:", e.code || e.message);
    }
  }
  return added;
}

// Welche Beispiele auf die Tafel kommen: pro Agent die neuesten (höchstens MAX_PER_AGENT), nach Agent sortiert
export function sheetRefs() {
  const by = new Map();
  for (const r of S.agentRefs) {
    if (!r.pic || !agentName(r.agent)) continue;
    if (!by.has(r.agent)) by.set(r.agent, []);
    by.get(r.agent).push(r);
  }
  const out = [];
  for (const agent of [...by.keys()].sort((a, b) => a.localeCompare(b, "de"))) {
    const list = by.get(agent).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    out.push(...list.slice(0, MAX_PER_AGENT));
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
