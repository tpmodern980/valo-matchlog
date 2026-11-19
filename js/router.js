// Seiten über den Teil hinter dem # in der Adresse:
// #matches, #match-<id>, #players, #player-<id>, #maps, #opponents, #opponent-<name>, #plan, #plan-<JJJJMMTT>, #team
// (#plan-20261123 = Planung der Woche, die am Montag 23.11.2026 beginnt; so verlinken die Discord-Posts)

const LISTS = ["matches", "players", "maps", "opponents", "plan", "team"];
// Zu welchem Tab eine Detailseite gehört
export const TAB_OF = { match: "matches", player: "players", opponent: "opponents" };

export function route() {
  let h = location.hash.slice(1);
  try { h = decodeURIComponent(h); } catch (e) { /* kaputte Adresse: unverändert lassen */ }
  const week = /^plan-(\d{8})$/.exec(h);
  if (week) return { name: "plan", id: week[1] };
  const detail = /^(match|player|opponent)-(.+)$/.exec(h);
  if (detail) return { name: detail[1], id: detail[2] };
  if (LISTS.includes(h)) return { name: h };
  return { name: "matches" };
}
