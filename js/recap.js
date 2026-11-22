// Wochenrückblick (Wunsch Tim, 22.11.2026): fasst eine Woche (Montag bis Sonntag) zusammen. Angezeigt im Tab
// "Planung" bei jeder Woche mit Matches, auf Knopfdruck auch als Post im Discord-Planungs-Kanal (js/discord.js).
// Rechnet nur mit dem, was schon im Arbeitsspeicher liegt (Matches, Plan der Woche): kein zusätzlicher Lesezugriff.
import { S } from "./state.js";
import { TYPES } from "./constants.js";
import { result, teamSummary, mapStats, playerStats, kdOf, sortMatches, formOf } from "./stats.js";
import { linkedMatch } from "./views/plan.js";

const addDays = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); const t = new Date(y, m - 1, d + n); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };

export const matchesOfWeek = (start) => {
  const end = addDays(start, 6);
  return sortMatches(S.matches.filter((m) => m.date && m.date >= start && m.date <= end)).reverse();   // ältestes zuerst
};

// Alles für den Rückblick einer Woche. null, wenn in der Woche kein Match eingetragen ist.
export function weekRecap(start, w = null) {
  const list = matchesOfWeek(start);
  if (!list.length) return null;
  const sum = teamSummary(list);

  // Bilanz pro Art (Scrim, Premier, Turnier), nur Arten mit Matches
  const byType = TYPES.concat([...new Set(list.map((m) => m.type).filter((t) => t && !TYPES.includes(t)))])
    .map((type) => ({ type, ...teamSummary(list.filter((m) => m.type === type)) })).filter((t) => t.total);

  // Maps: meistgespielt und beste (nach Winrate, bei Gleichstand mehr Matches)
  const maps = mapStats(list).filter((s) => s.name !== "Map?");
  const decided = (s) => s.w + s.l + s.d;
  const most = maps.slice().sort((a, b) => b.n - a.n || (b.wr ?? -1) - (a.wr ?? -1))[0] || null;
  const best = maps.filter((s) => decided(s)).sort((a, b) => (b.wr ?? -1) - (a.wr ?? -1) || decided(b) - decided(a))[0] || null;

  // Spieler der Woche: beste K/D unter denen, die mindestens die Hälfte der Matches gespielt haben
  const minN = Math.max(1, Math.ceil(list.length / 2));
  const players = playerStats(list).filter((s) => s.n > 0 && s.name).map((s) => ({
    name: s.name, n: s.n, kills: s.kills, kd: s.kdN ? kdOf(s.kdK, s.kdD) : null, fb: s.fbN ? s.fb : null,
  }));
  const mvp = players.filter((p) => p.n >= minN && p.kd !== null).sort((a, b) => b.kd - a.kd || b.kills - a.kills)[0] || null;
  const topKills = players.filter((p) => p.kills > 0).sort((a, b) => b.kills - a.kills)[0] || null;
  const topFb = players.filter((p) => p.fb).sort((a, b) => b.fb - a.fb)[0] || null;

  // Plan der Woche (Tab "Planung"): wie viele Termine gespielt, abgesagt, Ruhetage
  let plan = null;
  if (w && Array.isArray(w.plan) && w.plan.length) {
    const rest = w.plan.filter((e) => e.type === "Ruhetag").length;
    const dates = w.plan.filter((e) => e.type !== "Ruhetag");
    const cancelled = dates.filter((e) => e.status === "cancelled").length;
    const games = dates.filter((e) => e.status !== "cancelled" && e.type !== "Training");
    const played = games.filter((e) => linkedMatch(e, w)).length;   // dieselbe Verknüpfung wie der grüne Haken im Plan
    plan = { total: games.length, played, cancelled, rest };
  }

  // Form-Trend (Wunsch Tim, 22.11.2026): wer zum Ende dieser Woche heiß oder kalt läuft (alle Matches bis Sonntag)
  const end = addDays(start, 6);
  const form = playerStats(S.matches.filter((m) => m.date && m.date <= end)).filter((s) => s.status !== "ex")
    .map((s) => ({ name: s.name, f: formOf(s) })).filter((x) => x.f && x.f.dir !== "flat")
    .map((x) => ({ name: x.name, dir: x.f.dir, delta: x.f.delta })).sort((a, b) => b.delta - a.delta);

  // Vorwoche zum Vergleich
  const prev = matchesOfWeek(addDays(start, -7));
  return { start, list, sum, byType, most, best, mvp, topKills, topFb, plan, form, prev: prev.length ? teamSummary(prev) : null, results: list.map((m) => ({ m, r: result(m) })) };
}
