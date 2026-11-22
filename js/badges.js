// Abzeichen (seit 22.11.2026, Wunsch Tim): pro Spieler, aus allen Matches, mit Stufen zum Aufsteigen wie die Ränge in
// Valorant (Eisen bis Radiant). Zählt immer alle Matches, die Filter oben gelten nicht. Kein zusätzlicher Lesezugriff.
import { S } from "./state.js";
import { num } from "./util.js";
import { playerStats, rowKey } from "./stats.js";

export const TIERS = ["Eisen", "Bronze", "Silber", "Gold", "Platin", "Diamant", "Unsterblich", "Radiant"];

// [id, Name, Symbol, Einheit, Erklärung, Schwellen für die 8 Stufen, Wert aus den Zahlen des Spielers]
export const BADGES = [
  ["kills", "Killer", "🔫", "Kills", "Kills insgesamt", [50, 150, 300, 600, 1000, 1500, 2500, 4000], (x) => x.s.kills],
  ["games", "Dauerbrenner", "🎮", "Matches", "Matches gespielt", [5, 15, 30, 50, 80, 120, 180, 250], (x) => x.s.n],
  ["wins", "Sieger", "🏆", "Siege", "Matches gewonnen", [3, 10, 20, 35, 55, 80, 120, 170], (x) => x.s.w],
  ["fb", "Eröffner", "⚡", "First Bloods", "First Bloods insgesamt", [10, 30, 60, 100, 160, 250, 400, 600], (x) => x.s.fb],
  ["assists", "Teamplayer", "🤝", "Assists", "Assists insgesamt", [30, 100, 200, 350, 550, 800, 1200, 1800], (x) => x.s.assists],
  ["mvp", "MVP", "⭐", "Matches als MVP", "Meiste Kills im Team (MVP im Match)", [1, 3, 6, 10, 15, 22, 30, 40], (x) => x.mvp],
  ["spike", "Spike-Profi", "💣", "Plants + Defuses", "Spike gelegt oder entschärft", [5, 15, 30, 50, 80, 120, 180, 250], (x) => x.s.plants + x.s.defuses],
  ["streak", "Siegesserie", "🔥", "Siege am Stück", "Längste Siegesserie (eigene Matches)", [2, 3, 4, 5, 6, 8, 10, 12], (x) => x.streak],
  ["bomb", "Bombe", "💥", "Kills", "Meiste Kills in einem Match", [15, 20, 25, 30, 35, 40, 45, 50], (x) => x.best],
  ["agents", "Allrounder", "🎭", "Agents", "Verschiedene Agents gespielt", [2, 3, 4, 5, 6, 8, 10, 12], (x) => x.s.agents.length],
];

// Stufe zu einem Wert: -1 = noch keine, 0 = Eisen … 7 = Radiant
export const tierOf = (value, steps) => steps.reduce((t, need, i) => (value >= need ? i : t), -1);

// Zusatzwerte, die playerStats nicht kennt: MVP-Zahl, längste Siegesserie, meiste Kills in einem Match
function extras(list, id) {
  let mvp = 0;
  for (const m of list) {
    const rows = (m.players || []).filter((r) => num(r.kills) !== null);
    if (!rows.length) continue;
    const top = Math.max(...rows.map((r) => num(r.kills)));
    if (rows.some((r) => rowKey(r) === id && num(r.kills) === top)) mvp++;
  }
  return { mvp };
}

// Alle Abzeichen eines Spielers. list = die Matches, die zählen (Standard: alle)
export function badgesFor(id, list = S.matches) {
  const s = playerStats(list).find((x) => x.id === id);
  if (!s || !s.n) return null;
  let streak = 0, run = 0, best = 0;
  for (const x of s.series) {
    run = x.res === "W" ? run + 1 : 0;
    streak = Math.max(streak, run);
    if (x.kills !== null) best = Math.max(best, x.kills);
  }
  const ctx = { s, streak, best, ...extras(list, id) };
  return BADGES.map(([key, name, icon, unit, what, steps, value]) => {
    const v = value(ctx) || 0, tier = tierOf(v, steps);
    return { key, name, icon, unit, what, steps, value: v, tier, next: tier < steps.length - 1 ? steps[tier + 1] : null };
  });
}

// Aufstiege durch ein Match: welche Abzeichen hat wer mit diesem Match eine Stufe höher (für Discord und die Match-Seite)
export function badgeUps(match) {
  if (!match) return [];
  // Nur was bis zu diesem Match gespielt war: Ein späteres Match zählt hier nicht mit
  const older = (m) => (m.date || "") < (match.date || "") || ((m.date || "") === (match.date || "") && (m.createdAt || 0) < (match.createdAt || Infinity));
  const before = S.matches.filter((m) => m.id !== match.id && older(m));
  const after = before.concat([match]);
  const out = [];
  for (const row of match.players || []) {
    const id = rowKey(row);
    if (!id || row.former || !S.players.some((p) => p.id === id)) continue;
    const a = badgesFor(id, before) || [], b = badgesFor(id, after) || [];
    for (const x of b) {
      const old = a.find((y) => y.key === x.key);
      if (x.tier > (old ? old.tier : -1)) out.push({ id, name: (S.players.find((p) => p.id === id) || {}).name || row.name, badge: x });
    }
  }
  return out;
}
