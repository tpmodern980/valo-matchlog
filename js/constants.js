// Stammdaten. Maps und Agents sind nur Vorschläge: In den Formularen ist freier Text erlaubt,
// damit neue Maps/Agents ohne Update eingetragen werden können.
// AGENTS ist auch die Liste für das Screenshot-Auslesen: Die KI darf nur Namen daraus nennen (js/scan.js), ein fehlender
// Agent wird sonst falsch erkannt oder weggelassen. Neuen Agent hier eintragen (und VERSION in sw.js erhöhen).
export const MAPS = ["Abyss", "Ascent", "Bind", "Breeze", "Corrode", "Fracture", "Haven", "Icebox", "Lotus", "Pearl", "Split", "Sunset"];
export const AGENTS = ["Astra", "Breach", "Brimstone", "Chamber", "Clove", "Cypher", "Deadlock", "Fade", "Gekko", "Harbor", "Hush", "Iso", "Jett", "KAY/O", "Killjoy", "Neon", "Omen", "Phoenix", "Raze", "Reyna", "Sage", "Skye", "Sova", "Tejo", "Veto", "Viper", "Vyse", "Waylay", "Yoru"];
// Agents, die die KI beim Auslesen leicht verwechselt (laut Tim, 16.11.2026; Fade/Hush seit 17.11.2026):
// Das Formular bittet dann ums Prüfen. Dieselben Paare stehen im Prompt (boardPrompt in js/scan.js).
export const AGENT_LOOKALIKE = {
  Gekko: ["Waylay"], Waylay: ["Gekko", "Deadlock"], Deadlock: ["Waylay"], Iso: ["Vyse"], Vyse: ["Iso"],
  Fade: ["Hush"], Hush: ["Fade"],
};
// Arten von Matches: mehr gibt es bei uns nicht (Entscheidung Tim, 13.11.2026)
export const TYPES = ["Scrim", "Premier", "Turnier"];
export const ROLES = ["Duelist", "Initiator", "Controller", "Sentinel", "Flex"];
// Werte pro Spieler und Match: genau das, was die Ergebnis-Übersicht nach dem Match zeigt
// [Feld, Kürzel, ausgeschrieben]
export const STAT_FIELDS = [
  ["kills", "K", "Kills"], ["deaths", "D", "Deaths"], ["assists", "A", "Assists"],
  ["firstBloods", "FB", "First Bloods"], ["plants", "Plants", "Plants"], ["defuses", "Defuses", "Defuses"],
];
// Ergebnis-Kürzel: W = Sieg, L = Niederlage, D = Unentschieden, Q = offen (Score fehlt)
export const RES_LABEL = { W: "Sieg", L: "Niederlage", D: "Unentsch.", Q: "Offen" };
export const RES_SHORT = { W: "S", L: "N", D: "U", Q: "?" };
// Trades zeigt Valorant nur im Scoreboard von Premier-Matches. Das Feld gibt es deshalb nur bei der Art "Premier"
// (Entscheidung Tim, 15.11.2026). In die Statistik gehen Trades nicht ein.
export const TRADES_FIELD = ["trades", "Trades", "Trades"];
// Alle Felder, die eine Spielerzeile haben kann (Reihenfolge wie im Spiel: Trades stehen nach K/D/A)
export const ALL_STAT_FIELDS = [...STAT_FIELDS.slice(0, 3), TRADES_FIELD, ...STAT_FIELDS.slice(3)];
// Die Felder für ein Match dieser Art
export const statFields = (type) => (type === "Premier" ? ALL_STAT_FIELDS : STAT_FIELDS);
// Kurze Spaltentitel für schmale Bildschirme, wenn sieben Zahlen nebeneinander stehen
export const TINY_LABEL = { trades: "Tr", plants: "Pl", defuses: "Def" };
