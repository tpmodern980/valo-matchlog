// Berechnungen für den Tab "Analyse" (js/views/analysis.js): Pistol-Runden genauer, Kompositionen,
// Rollen-Verteilung, Agent-Pool pro Spieler und die Agents der Gegner. Reine Funktionen wie in stats.js,
// alle rechnen auf der Liste aus filtered().
import { AGENTS, AGENT_ROLE, AGENT_ROLE_LIST } from "./constants.js";
import { norm } from "./util.js";
import { result, roundInfo, rowKey, sortMatches, mapName, playerStats } from "./stats.js";

const tally = () => ({ n: 0, w: 0, l: 0, d: 0 });
function count(t, res) { t.n++; if (res === "W") t.w++; else if (res === "L") t.l++; else if (res === "D") t.d++; }
export const winrate = (t) => (t.w + t.l + t.d) ? t.w / (t.w + t.l + t.d) : null;
const rate = (w, n) => (n ? w / n : null);
const oldestFirst = (list) => sortMatches(list).reverse();
const known = (c) => c === "W" || c === "L";
const byCount = (a, b) => b.n - a.n || (winrate(b) ?? -1) - (winrate(a) ?? -1);

// ---------- Agents und Rollen ----------

// Schreibweise eines Agents: die aus AGENTS, wenn es ihn dort gibt, sonst wie eingetragen
export function agentName(text) {
  const t = String(text || "").trim(), key = norm(t);
  return (key && AGENTS.find((a) => norm(a) === key)) || t;
}
export const roleOf = (agent) => AGENT_ROLE[agentName(agent)] || null;

// Die Agents einer Seite eines Matches (unsere Zeilen oder die der Gegner), sortiert.
// Eine Komposition gibt es nur, wenn alle fünf Agents eingetragen sind (wie mapStats in stats.js).
function agentsOf(rows) {
  return (rows || []).map((r) => agentName(r.agent)).filter(Boolean).sort((a, b) => a.localeCompare(b, "de"));
}
const compKey = (agents) => agents.map((a) => norm(a) || a.toLowerCase()).join("|");

// Rollen einer Komposition: { Duelist: 2, Initiator: 1, …, "?": 0 }
function roleCounts(agents) {
  const c = Object.fromEntries([...AGENT_ROLE_LIST, "?"].map((r) => [r, 0]));
  for (const a of agents) c[roleOf(a) || "?"]++;
  return c;
}
// "2× Duelist · 1× Initiator · 1× Controller · 1× Sentinel" (Rollen mit 0 fallen weg)
export function roleLabel(c) {
  return [...AGENT_ROLE_LIST, "?"].filter((r) => c[r]).map((r) => `${c[r]}× ${r === "?" ? "unbekannt" : r}`).join(" · ");
}
// Kurz: "2-1-1-1" in der Reihenfolge Duelist-Initiator-Controller-Sentinel
export const roleShort = (c) => AGENT_ROLE_LIST.map((r) => c[r]).join("-") + (c["?"] ? ` +${c["?"]}?` : "");

// ---------- Pistol-Runden ----------

// Runde 1 und 13. Pro Pistol: Seite (aus der Startseite), gewonnen?, und die zwei Runden danach.
//   afterWin:  Pistol gewonnen → Runde 2 (bzw. 14) gewonnen? Und beide Folgerunden gewonnen?
//   afterLoss: Pistol verloren → Runde 2 gewonnen (Eco/Force geholt)? Runde 3 gewonnen (erste volle Runde)?
//   impact:    Matches mit beiden Pistols im Verlauf, nach Anzahl gewonnener Pistols (0, 1, 2)
export function pistolStats(list) {
  const out = {
    matches: 0, noSide: 0,
    all: { n: 0, w: 0 }, atk: { n: 0, w: 0 }, def: { n: 0, w: 0 },
    afterWin: { n: 0, r2n: 0, r2w: 0, bothN: 0, bothW: 0 },
    afterLoss: { n: 0, r2n: 0, r2w: 0, r3n: 0, r3w: 0 },
    impact: [tally(), tally(), tally()],
    maps: new Map(),
  };
  for (const m of oldestFirst(list)) {
    const ri = roundInfo(m);
    if (!ri) continue;
    const r = ri.rounds, res = result(m);
    let won = 0, seen = 0;
    const mk = norm(m.map) || "-";
    if (!out.maps.has(mk)) {
      out.maps.set(mk, { name: mapName(m.map) || "Map?", all: { n: 0, w: 0 }, atk: { n: 0, w: 0 }, def: { n: 0, w: 0 }, r2n: 0, r2w: 0, lr2n: 0, lr2w: 0 });
    }
    const mp = out.maps.get(mk);
    let any = false;
    for (const p of [0, 12]) {
      if (!known(r[p])) continue;
      any = true; seen++;
      const w = r[p] === "W", side = ri.sides[p];
      if (w) won++;
      for (const t of [out.all, mp.all]) { t.n++; if (w) t.w++; }
      if (side) for (const t of [out[side], mp[side]]) { t.n++; if (w) t.w++; }
      const next = known(r[p + 1]) ? r[p + 1] : null, third = known(r[p + 2]) ? r[p + 2] : null;
      if (w) {
        out.afterWin.n++;
        if (next) { out.afterWin.r2n++; mp.r2n++; if (next === "W") { out.afterWin.r2w++; mp.r2w++; } }
        if (next && third) { out.afterWin.bothN++; if (next === "W" && third === "W") out.afterWin.bothW++; }
      } else {
        out.afterLoss.n++;
        if (next) { out.afterLoss.r2n++; mp.lr2n++; if (next === "W") { out.afterLoss.r2w++; mp.lr2w++; } }
        if (third) { out.afterLoss.r3n++; if (third === "W") out.afterLoss.r3w++; }
      }
    }
    if (!any) continue;
    out.matches++;
    if (!ri.sides[0]) out.noSide++;
    if (seen === 2 && res !== "Q") count(out.impact[won], res);
  }
  return {
    ...out,
    rate: rate(out.all.w, out.all.n), atkRate: rate(out.atk.w, out.atk.n), defRate: rate(out.def.w, out.def.n),
    convRate: rate(out.afterWin.r2w, out.afterWin.r2n), bothRate: rate(out.afterWin.bothW, out.afterWin.bothN),
    ecoRate: rate(out.afterLoss.r2w, out.afterLoss.r2n), r3Rate: rate(out.afterLoss.r3w, out.afterLoss.r3n),
    impact: out.impact.map((t, k) => ({ ...t, won: k, wr: winrate(t) })),
    maps: [...out.maps.values()].map((mp) => ({
      ...mp, rate: rate(mp.all.w, mp.all.n), atkRate: rate(mp.atk.w, mp.atk.n), defRate: rate(mp.def.w, mp.def.n),
      convRate: rate(mp.r2w, mp.r2n), ecoRate: rate(mp.lr2w, mp.lr2n),
    })).sort((a, b) => b.all.n - a.all.n || a.name.localeCompare(b.name, "de")),
  };
}

// ---------- Kompositionen und Rollen (unser Team) ----------

// comps: jede gespielte Komposition pro Map. roles: jede Rollen-Verteilung über alle Maps der Liste.
export function compStats(list) {
  const comps = new Map(), roles = new Map();
  let withComp = 0;
  for (const m of oldestFirst(list)) {
    const agents = agentsOf(m.players);
    if (agents.length < 5) continue;
    withComp++;
    const res = result(m), mk = norm(m.map) || "-";
    const key = mk + "#" + compKey(agents);
    if (!comps.has(key)) comps.set(key, { map: mapName(m.map) || "Map?", agents, roles: roleCounts(agents), ...tally(), last: m });
    const c = comps.get(key);
    count(c, res); c.last = m;
    const rc = roleCounts(agents), rk = roleShort(rc);
    if (!roles.has(rk)) roles.set(rk, { key: rk, counts: rc, label: roleLabel(rc), ...tally(), maps: new Map() });
    const ro = roles.get(rk);
    count(ro, res);
    if (!ro.maps.has(mk)) ro.maps.set(mk, { name: mapName(m.map) || "Map?", ...tally() });
    count(ro.maps.get(mk), res);
  }
  return {
    withComp,
    comps: [...comps.values()].map((c) => ({ ...c, wr: winrate(c) })).sort(byCount),
    roles: [...roles.values()].map((r) => ({
      ...r, wr: winrate(r),
      maps: [...r.maps.values()].map((mp) => ({ ...mp, wr: winrate(mp) })).sort(byCount),
    })).sort(byCount),
  };
}

// ---------- Agent-Pool pro Spieler ----------

// Pro Spieler: welche Agents (mit Bilanz), auf welcher Map welcher Agent, Anteil der Rollen.
// Namen und Status (Stamm, Sub, nicht mehr im Roster) kommen aus playerStats.
export function agentPool(list) {
  const base = new Map(playerStats(list).filter((s) => s.n).map((s) => [s.id, s]));
  const by = new Map();
  for (const m of oldestFirst(list)) {
    const res = result(m), mk = norm(m.map) || "-", seen = new Set();
    for (const row of m.players || []) {
      const id = rowKey(row), agent = agentName(row.agent);
      if (!id || !agent || seen.has(id) || !base.has(id)) continue;
      seen.add(id);
      if (!by.has(id)) by.set(id, { id, agents: new Map(), maps: new Map(), roles: new Map(), total: 0 });
      const p = by.get(id);
      p.total++;
      const ak = norm(agent) || agent.toLowerCase();
      if (!p.agents.has(ak)) p.agents.set(ak, { name: agent, role: roleOf(agent), ...tally() });
      count(p.agents.get(ak), res);
      if (!p.maps.has(mk)) p.maps.set(mk, { name: mapName(m.map) || "Map?", n: 0, agents: new Map() });
      const mp = p.maps.get(mk);
      mp.n++;
      mp.agents.set(agent, (mp.agents.get(agent) || 0) + 1);
      const role = roleOf(agent) || "?";
      p.roles.set(role, (p.roles.get(role) || 0) + 1);
    }
  }
  return [...by.values()].map((p) => {
    const s = base.get(p.id);
    return {
      id: p.id, name: s.name, status: s.status, total: p.total,
      agents: [...p.agents.values()].map((a) => ({ ...a, wr: winrate(a) })).sort(byCount),
      maps: [...p.maps.values()].map((mp) => ({
        name: mp.name, n: mp.n, agents: [...mp.agents].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de")),
      })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name, "de")),
      roles: [...AGENT_ROLE_LIST, "?"].filter((r) => p.roles.get(r)).map((r) => ({ role: r, n: p.roles.get(r), share: p.roles.get(r) / p.total })),
    };
  }).sort((a, b) => ({ stamm: 0, sub: 1, ex: 2 }[a.status] - { stamm: 0, sub: 1, ex: 2 }[b.status]) || b.total - a.total || a.name.localeCompare(b.name, "de"));
}

// ---------- Agents und Kompositionen der Gegner ----------

// Nur Matches mit Gegner-Scoreboard (m.opponents). Die Bilanz ist immer unsere Bilanz in diesen Matches.
export function foeStats(list) {
  const agents = new Map(), comps = new Map();
  let withFoes = 0;
  for (const m of oldestFirst(list)) {
    const picked = agentsOf(m.opponents);
    if (!picked.length) continue;
    withFoes++;
    const res = result(m);
    for (const a of new Set(picked)) {
      const k = norm(a) || a.toLowerCase();
      if (!agents.has(k)) agents.set(k, { name: a, role: roleOf(a), ...tally() });
      count(agents.get(k), res);
    }
    if (picked.length >= 5) {
      const mk = norm(m.map) || "-", key = mk + "#" + compKey(picked);
      if (!comps.has(key)) comps.set(key, { map: mapName(m.map) || "Map?", agents: picked, roles: roleCounts(picked), ...tally(), teams: new Set() });
      const c = comps.get(key);
      count(c, res);
      const team = String(m.opponent || "").trim();
      if (team) c.teams.add(team);
    }
  }
  return {
    withFoes,
    agents: [...agents.values()].map((a) => ({ ...a, wr: winrate(a) })).sort(byCount),
    comps: [...comps.values()].map((c) => ({ ...c, teams: [...c.teams], wr: winrate(c) })).sort(byCount),
  };
}
