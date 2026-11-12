// Berechnungen: reine Funktionen ohne Seiteneffekte.
// (Spieler-, Map- und Gegner-Statistik kommen in Etappe 5 dazu.)
import { S } from "./state.js";
import { num, norm, daysAgo } from "./util.js";

// W = Sieg, L = Niederlage, D = Unentschieden, Q = offen (Score fehlt)
export function result(m) {
  const a = num(m.scoreUs), b = num(m.scoreThem);
  if (a === null || b === null) return "Q";
  return a > b ? "W" : a < b ? "L" : "D";
}

// Matches nach den Filtern oben (Art, Map, Zeitraum). Gelöschte sind schon vorher aussortiert.
export function filtered() {
  const f = S.filters;
  const cutoff = f.range !== "alle" ? daysAgo(Number(f.range)) : null;
  return S.matches.filter((m) =>
    (f.type === "alle" || m.type === f.type) &&
    (f.map === "alle" || norm(m.map) === norm(f.map)) &&
    (!cutoff || (m.date || "") >= cutoff));
}

// Neueste zuerst
export function sortMatches(list) {
  return list.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0));
}

// Rundenverlauf auswerten. rounds = "WWLW…" (ein Zeichen pro Runde), startSide = "atk" | "def".
// Runden 1–12 auf der Startseite, 13–24 auf der anderen, ab 25 (Overtime) Wechsel jede Runde.
// Pistol-Runden sind Runde 1 und Runde 13. Gibt null zurück, wenn kein Verlauf eingetragen ist.
export function roundInfo(m) {
  const r = typeof m.rounds === "string" ? m.rounds.toUpperCase().replace(/[^WL]/g, "") : "";
  if (!r) return null;
  const start = m.startSide === "atk" || m.startSide === "def" ? m.startSide : null;
  const other = start === "atk" ? "def" : "atk";
  const sideOf = (i) => !start ? null : i < 12 ? start : i < 24 ? other : ((i - 24) % 2 === 0 ? start : other);
  const info = { rounds: r, n: r.length, overtime: r.length > 24, atk: { w: 0, l: 0 }, def: { w: 0, l: 0 }, pistolW: 0, pistolN: 0, sides: [] };
  for (let i = 0; i < r.length; i++) {
    const side = sideOf(i);
    info.sides.push(side);
    if (side) info[side][r[i] === "W" ? "w" : "l"]++;
  }
  for (const i of [0, 12]) if (r[i]) { info.pistolN++; if (r[i] === "W") info.pistolW++; }
  return info;
}

// Kopfleiste: Bilanz, Winrate, Ø Rundendifferenz, Pistol-Quote
export function teamSummary(list) {
  let w = 0, l = 0, d = 0, diff = 0, diffN = 0, pistolW = 0, pistolN = 0;
  for (const m of list) {
    const r = result(m);
    if (r === "W") w++; else if (r === "L") l++; else if (r === "D") d++;
    if (r !== "Q") { diff += num(m.scoreUs) - num(m.scoreThem); diffN++; }
    const ri = roundInfo(m);
    if (ri) { pistolW += ri.pistolW; pistolN += ri.pistolN; }
  }
  const decided = w + l + d;
  return {
    w, l, d, total: list.length,
    wr: decided ? w / decided : null,
    diff: diffN ? diff / diffN : null,
    pistolW, pistolN, pistolWr: pistolN ? pistolW / pistolN : null,
  };
}
