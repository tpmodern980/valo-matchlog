// Match-Review (Wunsch Tim, 22.11.2026): pro Match zwei Felder "Lief gut" (m.good) und "Üben wir" (m.work),
// ein Punkt pro Zeile. Aus "Üben wir" entsteht die Liste "Baustellen" (Startseite): Punkte, die öfter genannt werden,
// stehen oben. Gleich zählt, was nach Kleinschreibung und ohne Satzzeichen gleich ist ("Retakes B" = "retakes b.").
// Damit Punkte gleich geschrieben werden, schlägt das Formular die schon genannten als Chips vor.
import { S } from "./state.js";
import { sortMatches } from "./stats.js";

// Zeilen eines Feldes: ohne Aufzählungszeichen, leere weg, höchstens 120 Zeichen pro Punkt
export const points = (text) => String(text || "").split(/\r?\n/)
  .map((x) => x.replace(/^\s*[-•*–]\s*/, "").trim().slice(0, 120)).filter(Boolean);
export const pointKey = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

// Baustellen aus den Matches seit "since" (JJJJ-MM-TT): [{ text, n, last, ids }] – öfter genannte zuerst, dann neuere
export function workItems(since = "") {
  const by = new Map();
  for (const m of sortMatches(S.matches).reverse()) {   // älteste zuerst: der neueste Wortlaut gewinnt
    if (since && (m.date || "") < since) continue;
    const seen = new Set();
    for (const p of points(m.work)) {
      const k = pointKey(p);
      if (!k || seen.has(k)) continue;
      seen.add(k);
      const x = by.get(k) || { text: p, n: 0, last: "", ids: [] };
      x.text = p; x.n++; x.last = m.date || x.last; x.ids.push(m.id);
      by.set(k, x);
    }
  }
  return [...by.values()].sort((a, b) => b.n - a.n || String(b.last).localeCompare(String(a.last)));
}
