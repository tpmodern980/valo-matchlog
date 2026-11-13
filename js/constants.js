// Stammdaten. Maps und Agents sind nur Vorschläge: In den Formularen ist freier Text erlaubt,
// damit neue Maps/Agents ohne Update eingetragen werden können.
export const MAPS = ["Abyss", "Ascent", "Bind", "Breeze", "Corrode", "Fracture", "Haven", "Icebox", "Lotus", "Pearl", "Split", "Sunset"];
export const AGENTS = ["Astra", "Breach", "Brimstone", "Chamber", "Clove", "Cypher", "Deadlock", "Fade", "Gekko", "Harbor", "Iso", "Jett", "KAY/O", "Killjoy", "Neon", "Omen", "Phoenix", "Raze", "Reyna", "Sage", "Skye", "Sova", "Tejo", "Veto", "Viper", "Vyse", "Waylay", "Yoru"];
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
