// Berechnungen: reine Funktionen ohne Seiteneffekte.
// Alle Statistiken (Team, Spieler, Maps, Gegner) rechnen auf der Liste aus filtered().
import { S } from "./state.js";
import { MAPS } from "./constants.js";
import { num, norm, daysAgo } from "./util.js";

// W = Sieg, L = Niederlage, D = Unentschieden, Q = offen (Score fehlt)
export function result(m) {
  const a = num(m.scoreUs), b = num(m.scoreThem);
  if (a === null || b === null) return "Q";
  return a > b ? "W" : a < b ? "L" : "D";
}

// Matches nach den Filtern oben (Art, Map, Zeitraum). Gelöschte sind schon vorher aussortiert.
// anyMap: Die Maps-Seite vergleicht alle Maps, dort gilt der Map-Filter nicht (und wird auch nicht angezeigt).
export function filtered({ anyMap = false } = {}) {
  const f = S.filters;
  const cutoff = f.range !== "alle" ? daysAgo(Number(f.range)) : null;
  return S.matches.filter((m) =>
    (f.type === "alle" || m.type === f.type) &&
    (anyMap || f.map === "alle" || norm(m.map) === norm(f.map)) &&
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

// ---------- Statistik pro Spieler, Map und Gegner (Etappe 5) ----------

const oldestFirst = (list) => sortMatches(list).reverse();

// Gespielte Runden eines Matches (null, wenn der Score fehlt)
export function roundsOf(m) {
  const a = num(m.scoreUs), b = num(m.scoreThem);
  return a === null || b === null ? null : a + b;
}

// K/D. Ohne einen einzigen Death wird durch 1 geteilt (sonst wäre der Wert unendlich).
export const kdOf = (kills, deaths) => kills === null || deaths === null ? null : kills / Math.max(deaths, 1);

// Unter welchem Schlüssel eine Spielerzeile zählt: die playerId, sonst (z. B. nach einem Import) der Name
export const rowKey = (row) => row.playerId || (norm(row.name) ? "n-" + norm(row.name) : "");

const tally = () => ({ n: 0, w: 0, l: 0, d: 0 });
function count(t, res) { t.n++; if (res === "W") t.w++; else if (res === "L") t.l++; else if (res === "D") t.d++; }
const winrate = (t) => (t.w + t.l + t.d) ? t.w / (t.w + t.l + t.d) : null;

// Schreibweise einer Map: die aus MAPS, wenn es sie dort gibt, sonst wie eingetragen
function mapName(text) {
  const key = norm(text);
  return MAPS.find((x) => norm(x) === key) || String(text || "").trim();
}

// Eine Zeile pro Spieler: alle aus dem Roster (auch ohne Match) und alle, die in den Matches stehen.
// Leere Werte (null) zählen nirgends mit: Jeder Durchschnitt teilt nur durch die Matches, in denen der Wert eingetragen ist.
//   kd  = Summe Kills / Summe Deaths (nur Matches, in denen beides eingetragen ist)
//   kpr = Summe Kills / Summe Runden (nur Matches mit Score und Kills): Ein langes Match zählt von selbst mehr
export function playerStats(list, roster = S.players) {
  const by = new Map();
  const get = (id) => {
    if (!by.has(id)) {
      by.set(id, {
        id, player: null, name: "", ...tally(), kills: 0, deaths: 0, assists: 0, kdK: 0, kdD: 0, kdN: 0, kprK: 0, kprR: 0,
        fb: 0, fbN: 0, plants: 0, plantsN: 0, defuses: 0, defusesN: 0, agents: new Map(), maps: new Map(), series: [],
      });
    }
    return by.get(id);
  };
  for (const p of roster) { const s = get(p.id); s.player = p; s.name = p.name; }
  for (const m of oldestFirst(list)) {
    const res = result(m), rounds = roundsOf(m), seen = new Set();
    for (const row of m.players || []) {
      const id = rowKey(row);
      if (!id || seen.has(id)) continue;   // derselbe Spieler doppelt im Match: nur einmal zählen
      seen.add(id);
      const s = get(id);
      if (!s.player && row.name) s.name = row.name;   // nicht mehr im Roster: der jüngste Name aus den Matches
      const k = num(row.kills), d = num(row.deaths), a = num(row.assists);
      count(s, res);
      if (k !== null) s.kills += k;
      if (d !== null) s.deaths += d;
      if (a !== null) s.assists += a;
      if (k !== null && d !== null) { s.kdK += k; s.kdD += d; s.kdN++; }
      const kprOk = k !== null && rounds !== null && rounds > 0;
      if (kprOk) { s.kprK += k; s.kprR += rounds; }
      for (const [f, sum, n] of [["firstBloods", "fb", "fbN"], ["plants", "plants", "plantsN"], ["defuses", "defuses", "defusesN"]]) {
        const v = num(row[f]);
        if (v !== null) { s[sum] += v; s[n]++; }
      }
      const agent = String(row.agent || "").trim();
      if (agent) {
        const key = norm(agent) || agent.toLowerCase();
        if (!s.agents.has(key)) s.agents.set(key, { name: agent, ...tally() });
        count(s.agents.get(key), res);
      }
      const mapKey = norm(m.map);
      if (mapKey) {
        if (!s.maps.has(mapKey)) s.maps.set(mapKey, { name: mapName(m.map), ...tally(), k: 0, d: 0, kdN: 0 });
        const mp = s.maps.get(mapKey);
        count(mp, res);
        if (k !== null && d !== null) { mp.k += k; mp.d += d; mp.kdN++; }
      }
      s.series.push({ m, res, agent, kills: k, deaths: d, assists: a, rounds, kd: kdOf(k, d), kpr: kprOk ? k / rounds : null });
    }
  }
  return [...by.values()].map((s) => ({
    ...s,
    name: s.name || "Unbekannt",
    status: s.player ? (s.player.status === "sub" ? "sub" : "stamm") : "ex",
    wr: winrate(s),
    kd: s.kdN ? s.kdK / Math.max(s.kdD, 1) : null,
    kpr: s.kprR ? s.kprK / s.kprR : null,
    fbPer: s.fbN ? s.fb / s.fbN : null,
    plantsPer: s.plantsN ? s.plants / s.plantsN : null,
    defusesPer: s.defusesN ? s.defuses / s.defusesN : null,
    agents: [...s.agents.values()].map((a) => ({ ...a, wr: winrate(a) })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "de")),
    maps: [...s.maps.values()].map((mp) => ({ ...mp, wr: winrate(mp), kd: mp.kdN ? mp.k / Math.max(mp.d, 1) : null })),
  }));
}

// Eine Zeile pro Map, die in der Liste vorkommt.
// Angriff, Verteidigung und Pistols kommen nur aus Matches mit Rundenverlauf (die Seiten zusätzlich nur mit Startseite).
export function mapStats(list) {
  const by = new Map();
  for (const m of oldestFirst(list)) {
    const key = norm(m.map);
    if (!by.has(key)) {
      by.set(key, {
        key, name: mapName(m.map) || "Map?", ...tally(), diffSum: 0, diffN: 0,
        atk: { w: 0, l: 0 }, def: { w: 0, l: 0 }, pistolW: 0, pistolN: 0, withRounds: 0, comps: new Map(),
      });
    }
    const s = by.get(key), res = result(m);
    count(s, res);
    if (res !== "Q") { s.diffSum += num(m.scoreUs) - num(m.scoreThem); s.diffN++; }
    const ri = roundInfo(m);
    if (ri) {
      s.withRounds++;
      s.atk.w += ri.atk.w; s.atk.l += ri.atk.l; s.def.w += ri.def.w; s.def.l += ri.def.l;
      s.pistolW += ri.pistolW; s.pistolN += ri.pistolN;
    }
    // Komposition: nur wenn fünf Agents eingetragen sind. Die Reihenfolge der Spieler ist egal.
    const agents = (m.players || []).map((r) => String(r.agent || "").trim()).filter(Boolean);
    if (agents.length >= 5) {
      const sorted = agents.slice().sort((a, b) => a.localeCompare(b, "de"));
      const ck = sorted.map((a) => norm(a) || a.toLowerCase()).join("|");
      if (!s.comps.has(ck)) s.comps.set(ck, { agents: sorted, ...tally(), order: 0 });
      const c = s.comps.get(ck);
      count(c, res);
      c.order = s.n;   // bei gleicher Anzahl gewinnt die zuletzt gespielte
    }
  }
  const rate = (side) => (side.w + side.l) ? side.w / (side.w + side.l) : null;
  return [...by.values()].map((s) => ({
    ...s,
    wr: winrate(s),
    diff: s.diffN ? s.diffSum / s.diffN : null,
    atkRate: rate(s.atk), defRate: rate(s.def),
    pistolWr: s.pistolN ? s.pistolW / s.pistolN : null,
    comp: [...s.comps.values()].sort((a, b) => b.n - a.n || b.order - a.order)[0] || null,
  })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "de"));
}

// Schlüssel eines Gegners: Groß/Klein und Leerzeichen egal. Matches ohne Gegner landen zusammen unter "-".
export const oppKey = (name) => norm(name) || "-";

// Eine Zeile pro Gegner. Angezeigt wird die jüngste Schreibweise.
export function opponentStats(list) {
  const by = new Map();
  for (const m of oldestFirst(list)) {
    const key = oppKey(m.opponent);
    if (!by.has(key)) by.set(key, { key, name: "", ...tally(), diffSum: 0, diffN: 0, last: null, maps: new Map(), matches: [] });
    const s = by.get(key), res = result(m);
    const name = String(m.opponent || "").trim();
    if (name) s.name = name;
    count(s, res);
    if (res !== "Q") { s.diffSum += num(m.scoreUs) - num(m.scoreThem); s.diffN++; }
    s.last = m;
    s.matches.unshift(m);   // neueste zuerst
    const mk = norm(m.map);
    if (!s.maps.has(mk)) s.maps.set(mk, { name: mapName(m.map) || "Map?", ...tally() });
    count(s.maps.get(mk), res);
  }
  return [...by.values()].map((s) => ({
    ...s,
    name: s.name || "Ohne Namen",
    wr: winrate(s),
    diff: s.diffN ? s.diffSum / s.diffN : null,
    lastMap: mapName(s.last.map) || "Map?",
    maps: [...s.maps.values()].map((mp) => ({ ...mp, wr: winrate(mp) })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "de")),
  })).sort((a, b) => b.n - a.n || (b.last.date || "").localeCompare(a.last.date || "") || a.name.localeCompare(b.name, "de"));
}
