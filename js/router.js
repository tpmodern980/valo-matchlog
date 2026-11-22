// Seiten über den Teil hinter dem # in der Adresse:
// #home (Startseite), #matches, #match-<id>, #players, #player-<id>, #maps, #veto, #analysis, #analysis-<pistols|comps|foes>, #opponents, #opponent-<name>, #strats, #strats-<Map>, #plan, #plan-<JJJJMMTT>, #team
// (#plan-20261123 = Planung der Woche, die am Montag 23.11.2026 beginnt; so verlinken die Discord-Posts)

const LISTS = ["home", "matches", "players", "maps", "veto", "analysis", "opponents", "strats", "plan", "team"];
// Zu welchem Tab eine Detailseite gehört
// Maps, Gegner und Veto gehören seit 22.11.2026 zum Bereich "Analyse"
export const TAB_OF = { match: "matches", player: "players", opponent: "analysis", opponents: "analysis", maps: "analysis", veto: "analysis" };

export function route() {
  let h = location.hash.slice(1);
  try { h = decodeURIComponent(h); } catch (e) { /* kaputte Adresse: unverändert lassen */ }
  const week = /^plan-(\d{8})$/.exec(h);
  if (week) return { name: "plan", id: week[1] };
  const analysis = /^analysis-(.+)$/.exec(h);
  if (analysis) return { name: "analysis", id: analysis[1] };
  const strats = /^strats-(.+)$/.exec(h);
  if (strats) return { name: "strats", id: strats[1] };
  const detail = /^(match|player|opponent)-(.+)$/.exec(h);
  if (detail) return { name: detail[1], id: detail[2] };
  if (LISTS.includes(h)) return { name: h };
  return { name: "home" };   // Startseite "Diese Woche" (seit 22.11.2026, vorher die Match-Liste)
}
