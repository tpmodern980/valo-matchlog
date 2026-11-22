// Serien (seit 22.11.2026, Wunsch Tim): mehrere Maps eines BO3/BO5 gehören zusammen, z. B. Turnier-Halbfinale.
// Jedes Match einer Serie trägt dieselbe seriesId, dazu seriesName ("Halbfinale", freiwillig) und seriesFormat ("bo3" | "bo5").
// Eine eigene Sammlung gibt es nicht: Die Serie sind einfach alle Matches mit derselben seriesId.
import { S } from "./state.js";
import { norm } from "./util.js";
import { result } from "./stats.js";

export const FORMATS = [["bo3", "BO3"], ["bo5", "BO5"]];
export const formatLabel = (f) => (f === "bo5" ? "BO5" : "BO3");
export const newSeriesId = () => "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// Maps einer Serie, älteste zuerst (= Map 1, Map 2, …)
const order = (a, b) => (a.date || "").localeCompare(b.date || "") || (a.createdAt || 0) - (b.createdAt || 0);
export function seriesMaps(id, all = S.matches) {
  return id ? all.filter((m) => m.seriesId === id).sort(order) : [];
}

// Stand, Ergebnis und Name einer Serie
export function seriesInfo(id, all = S.matches) {
  const maps = seriesMaps(id, all);
  if (!maps.length) return null;
  let w = 0, l = 0;
  for (const m of maps) { const r = result(m); if (r === "W") w++; else if (r === "L") l++; }
  const format = (maps.find((m) => m.seriesFormat) || {}).seriesFormat || "bo3";
  const need = format === "bo5" ? 3 : 2;
  const res = w >= need ? "W" : l >= need ? "L" : "Q";   // Q = läuft noch (oder unvollständig eingetragen)
  const last = maps[maps.length - 1];
  const name = (maps.slice().reverse().find((m) => m.seriesName) || {}).seriesName || "";
  return { id, maps, w, l, res, format, name, opponent: last.opponent || "", date: maps[0].date, last };
}

// Serien-Bilanz für eine Liste von Matches (jede Serie zählt einmal, mit allen ihren Maps)
export function seriesSummary(list) {
  const ids = [...new Set(list.map((m) => m.seriesId).filter(Boolean))];
  const out = { w: 0, l: 0, open: 0, n: 0 };
  for (const id of ids) {
    const s = seriesInfo(id);
    if (!s) continue;
    out.n++;
    if (s.res === "W") out.w++; else if (s.res === "L") out.l++; else out.open++;
  }
  return out;
}

// Wozu könnte ein Match gehören? Serien und einzelne Matches gegen denselben Gegner bis 2 Tage vorher/nachher.
// Ergebnis: [{ value: "s:<id>" | "m:<matchId>", label }]
export function seriesChoices({ id, date, opponent, seriesId }) {
  const o = norm(opponent);
  const out = [], seen = new Set();
  const near = (d) => {
    if (!date || !d) return false;
    return Math.abs((new Date(d + "T12:00") - new Date(date + "T12:00")) / 86400000) <= 2;
  };
  const short = (d) => (d ? d.split("-").reverse().slice(0, 2).join(".") + "." : "");
  if (seriesId) seen.add(seriesId);
  const own = seriesId ? seriesInfo(seriesId) : null;
  if (seriesId) out.push({ value: "s:" + seriesId, label: own ? label(own, id) : "Diese Serie" });
  for (const m of S.matches) {
    if (m.id === id || !o || norm(m.opponent) !== o || !near(m.date)) continue;
    if (m.seriesId) {
      if (seen.has(m.seriesId)) continue;
      seen.add(m.seriesId);
      out.push({ value: "s:" + m.seriesId, label: label(seriesInfo(m.seriesId), id) });
    } else {
      out.push({ value: "m:" + m.id, label: `Neue Serie mit ${m.map || "Map?"} ${m.scoreUs ?? "?"}:${m.scoreThem ?? "?"} vom ${short(m.date)}` });
    }
  }
  return out;

  function label(s, self) {
    const others = s.maps.filter((m) => m.id !== self);
    return `${formatLabel(s.format)}${s.name ? " " + s.name : ""} vs ${s.opponent} (${short(s.date)}) · ${others.map((m) => m.map || "Map?").join(", ") || "noch leer"}`;
  }
}
