// Lernen aus Korrekturen (Wunsch Tim, 16.11.2026): Die KI verwechselt beim Auslesen manche Agents
// (Waylay/Deadlock, Waylay/Gekko, Iso/Vyse). Deshalb merkt sich die App kleine Agenten-Bilder aus echten
// Screenshots mit dem richtigen Namen (Sammlung "agentRefs" in Firestore, nur fürs Team lesbar) und schickt sie
// beim Auslesen als beschriftete Beispieltafel mit.
//
// Dokument: { agent, pic (JPEG 64 × 64 als base64, wenige KB), kind: "fix" | "ok", wrong (was die KI las) }
//   "fix" = jemand hat den Agent nach dem Auslesen korrigiert, "ok" = so übernommen (nur, solange es von
//   diesem Agent noch wenige Beispiele gibt, und nie bei Agents aus AGENT_LOOKALIKE).
import { S } from "./state.js";
import { AGENTS, AGENT_LOOKALIKE } from "./constants.js";
import { norm } from "./util.js";
import { create } from "./data.js";

const MAX_OK = 2;          // bestätigte Beispiele pro Agent
const MAX_FIX = 6;         // Korrekturen pro Agent (danach kommen keine neuen dazu)
const SHEET_PER_AGENT = 3; // so viele Bilder pro Agent auf der Tafel (neueste zuerst, Korrekturen vorn)
const SHEET_MAX = 48;      // höchstens so viele Bilder auf der Tafel
export const PIC_SIDE = 64;

const agentName = (text) => AGENTS.find((a) => norm(a) === norm(text)) || null;

const refsOf = (agent) => S.agentRefs.filter((r) => r.agent === agent);

// Nach dem Speichern eines Matches: Zeilen mit Bild aus dem Auslesen (row.scanPic) als Beispiel merken.
// rows: die Zeilen des Formulars (unser Team und Gegner). Liefert die Zahl der neuen Beispiele.
export async function learn(rows) {
  let added = 0;
  for (const row of rows) {
    if (!row || !row.scanPic) continue;
    const agent = agentName(row.agent);
    const read = row.scanAgent || null;
    const pic = row.scanPic;
    row.scanPic = null;   // nie zweimal
    if (!agent) continue;
    const fix = agent !== read;
    // Bei Agents, die die KI leicht verwechselt, zählt nur eine echte Korrektur: Hat jemand eine Verwechslung
    // übersehen, stünde sonst ein falsches Bild als "bestätigt" auf der Tafel
    if (!fix && AGENT_LOOKALIKE[agent]) continue;
    const have =refsOf(agent).filter((r) => (r.kind === "fix") === fix).length;
    if (have >= (fix ? MAX_FIX : MAX_OK)) continue;
    try {
      await create("agentRefs", { agent, pic, kind: fix ? "fix" : "ok", wrong: fix ? read : null });
      added++;
    } catch (e) {
      console.warn("Agenten-Beispiel nicht gespeichert:", e.code || e.message);
    }
  }
  return added;
}

// Welche Beispiele auf die Tafel kommen: pro Agent die Korrekturen zuerst, dann die neuesten
export function sheetRefs() {
  const by = new Map();
  for (const r of S.agentRefs) {
    if (!r.pic || !agentName(r.agent)) continue;
    if (!by.has(r.agent)) by.set(r.agent, []);
    by.get(r.agent).push(r);
  }
  const out = [];
  for (const agent of [...by.keys()].sort((a, b) => a.localeCompare(b, "de"))) {
    const list = by.get(agent).sort((a, b) => (a.kind === "fix" ? 0 : 1) - (b.kind === "fix" ? 0 : 1) || (b.createdAt || 0) - (a.createdAt || 0));
    out.push(...list.slice(0, SHEET_PER_AGENT));
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
