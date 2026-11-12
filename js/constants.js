// Stammdaten. Maps und Agents sind nur Vorschläge: In den Formularen ist freier Text erlaubt,
// damit neue Maps/Agents ohne Update eingetragen werden können.
export const MAPS = ["Abyss", "Ascent", "Bind", "Breeze", "Corrode", "Fracture", "Haven", "Icebox", "Lotus", "Pearl", "Split", "Sunset"];
export const AGENTS = ["Astra", "Breach", "Brimstone", "Chamber", "Clove", "Cypher", "Deadlock", "Fade", "Gekko", "Harbor", "Iso", "Jett", "KAY/O", "Killjoy", "Neon", "Omen", "Phoenix", "Raze", "Reyna", "Sage", "Skye", "Sova", "Tejo", "Veto", "Viper", "Vyse", "Waylay", "Yoru"];
export const TYPES = ["Scrim", "Premier", "Liga", "Turnier", "5-Stack Ranked", "Sonstiges"];
export const ROLES = ["Duelist", "Initiator", "Controller", "Sentinel", "Flex"];
export const STAT_FIELDS = [
  ["kills", "K"], ["deaths", "D"], ["assists", "A"], ["acs", "ACS"], ["hsPct", "HS%"],
  ["firstBloods", "FB"], ["plants", "Plants"], ["defuses", "Defuses"], ["trades", "Trades"],
];
// Ergebnis-Kürzel: W = Sieg, L = Niederlage, D = Unentschieden, Q = offen (Score fehlt)
export const RES_LABEL = { W: "Sieg", L: "Niederlage", D: "Unentsch.", Q: "Offen" };
export const RES_SHORT = { W: "S", L: "N", D: "U", Q: "?" };
