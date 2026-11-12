// Beispieldaten für die Vorschau (index.html?demo=1). Alles erfunden, nichts wird gespeichert.
// Die Zahlen entstehen aus einem festen Zufalls-Startwert, sind also bei jedem Laden gleich.
import { S } from "./state.js";
import { setLocal } from "./data.js";
import { daysAgo } from "./util.js";

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

const PLAYERS = [
  { id: "pdemo1", name: "Kairo", aliases: ["Kairo#EUW", "kairo2#7781"], role: "Duelist", status: "stamm", skill: 1.18, agents: ["Jett", "Raze", "Neon"] },
  { id: "pdemo2", name: "Mats", aliases: ["matsn#4711"], role: "Initiator", role2: "Controller", status: "stamm", skill: 1.0, agents: ["Sova", "Fade", "Skye"] },
  { id: "pdemo3", name: "Lumo", aliases: ["Lumo#0001"], role: "Controller", status: "stamm", skill: 0.94, agents: ["Omen", "Viper", "Clove"] },
  { id: "pdemo4", name: "Feli", aliases: ["feli#cat"], role: "Sentinel", status: "stamm", skill: 0.9, agents: ["Killjoy", "Cypher", "Vyse"] },
  { id: "pdemo5", name: "Brix", aliases: ["Brix#EUW"], role: "Flex", status: "stamm", skill: 1.02, agents: ["KAY/O", "Breach", "Gekko"] },
  { id: "pdemo6", name: "Zeno", aliases: ["zeno#sub"], role: "Flex", status: "sub", skill: 0.84, agents: ["Sage", "Phoenix", "Tejo"] },
];

// [Tage her, Art, Gegner, Map, wir, die, Sub spielt statt Feli]
const GAMES = [
  [1, "Scrim", "Nordlicht", "Ascent", 13, 9],
  [2, "Premier", "Team Kiesel", "Lotus", 11, 13],
  [3, "Scrim", "Graue Wölfe", "Haven", null, null],
  [4, "Scrim", "Lowground", "Haven", 13, 7],
  [6, "Scrim", "Nordlicht", "Bind", 14, 12],
  [8, "Liga", "FC Spike", "Split", 13, 11, true],
  [9, "Scrim", "Mitternacht", "Sunset", 8, 13],
  [12, "Scrim", "Lowground", "Ascent", 13, 5],
  [15, "Turnier", "Team Kiesel", "Abyss", 13, 15, true],
  [16, "Scrim", "FC Spike", "Corrode", 13, 10],
  [22, "Premier", "Mitternacht", "Lotus", 13, 6],
  [27, "Scrim", "Nordlicht", "Split", 9, 13],
  [35, "Liga", "Graue Wölfe", "Bind", 13, 8, true],
  [44, "Scrim", "Lowground", "Sunset", 10, 13],
  [58, "Scrim", "FC Spike", "Ascent", 13, 11],
];

// Rundenverlauf passend zum Endstand erzeugen
function makeRounds(us, them, rand) {
  const shuffle = (arr) => {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  };
  const fill = (n, c) => Array(Math.max(0, n)).fill(c);
  const winner = us > them ? "W" : "L";
  if (Math.min(us, them) < 12) {
    // Normales Ende: Die letzte Runde gewinnt der Sieger
    return shuffle([...fill(us - (winner === "W" ? 1 : 0), "W"), ...fill(them - (winner === "L" ? 1 : 0), "L")]).join("") + winner;
  }
  // Overtime: 12:12 nach 24 Runden, dann abwechselnd, am Ende zwei Runden für den Sieger
  const pairs = Math.min(us, them) - 12;
  return shuffle([...fill(12, "W"), ...fill(12, "L")]).join("") + "WL".repeat(pairs) + winner + winner;
}

function makeRow(p, rounds, won, rand) {
  const kpr = 0.7 * p.skill * (0.72 + rand() * 0.56) * (won ? 1.06 : 0.94);
  const kills = Math.round(kpr * rounds);
  return {
    playerId: p.id, name: p.aliases[0],
    agent: p.agents[Math.floor(rand() * rand() * p.agents.length)],
    kills,
    deaths: Math.max(4, Math.round(rounds * (0.7 / p.skill) * (0.8 + rand() * 0.35) * (won ? 0.93 : 1.05))),
    assists: Math.round(rounds * (0.18 + rand() * 0.25)),
    acs: Math.round(kpr * 265 + 20 + rand() * 30),
    hsPct: Math.round(14 + rand() * 20),
    firstBloods: Math.round(rand() * kills * 0.22),
    plants: Math.floor(rand() * 4),
    defuses: Math.floor(rand() * 2.4),
    trades: Math.round(rand() * 6),
  };
}

export function loadDemo() {
  const rand = rng(20261112);
  const now = Date.now();
  // setLocal legt die Daten so ab wie das echte Laden: Das Roster lässt sich in der Vorschau ändern (nur im Arbeitsspeicher)
  setLocal("players", PLAYERS.map(({ skill, agents, ...p }) => ({ ...p, active: true, deleted: false })));
  setLocal("matches", GAMES.map(([days, type, opponent, map, us, them, withSub], i) => {
    const open = us === null;
    const lineup = PLAYERS.filter((p) => withSub ? p.id !== "pdemo4" : p.status === "stamm");
    const rounds = open ? null : us + them;
    return {
      id: "mdemo" + (i + 1),
      date: daysAgo(days), type, opponent, map, scoreUs: us, scoreThem: them,
      startSide: open ? null : (i % 2 ? "def" : "atk"),
      // Ein Match bewusst ohne Verlauf: Der Rundenverlauf ist freiwillig
      rounds: open || i === 9 ? null : makeRounds(us, them, rand),
      notes: i === 0 ? "Gute Retakes auf B. Auf A zu oft einzeln gepeekt." : "",
      createdAt: now - days * 86400000, createdBy: null, deleted: false,
      players: open
        ? lineup.map((p) => ({ playerId: p.id, name: p.aliases[0], agent: p.agents[0], kills: null, deaths: null, assists: null, acs: null, hsPct: null, firstBloods: null, plants: null, defuses: null, trades: null }))
        : lineup.map((p) => makeRow(p, rounds, us > them, rand)),
    };
  }));
  setLocal("clips", [
    { id: "cdemo1", matchId: "mdemo1", title: "Retake B, Runde 14", kind: "local", notes: [], deleted: false },
    { id: "cdemo2", matchId: "mdemo1", title: "Pistol Verteidigung", kind: "local", notes: [], deleted: false },
    { id: "cdemo3", matchId: "mdemo5", title: "Overtime, letzte Runde", kind: "local", notes: [], deleted: false },
  ]);
  // Erfundener angemeldeter Admin und eine Team-Liste (example.com gehört niemandem)
  S.demo = true;
  S.user = { uid: "demo", email: "kairo@example.com", name: "Kairo" };
  S.team = {
    emails: ["kairo@example.com", "managerin@example.com", "mats@example.com", "lumo@example.com", "feli@example.com", "brix@example.com", "zeno@example.com"],
    admins: ["kairo@example.com", "managerin@example.com"],
  };
  S.isAdmin = true;
}
