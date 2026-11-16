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
  [4, "Scrim", "Lowground", "Haven", 15, 9],   // Scrims gehen oft über alle 24 Runden
  [6, "Scrim", "Nordlicht", "Bind", 14, 12],
  [8, "Premier", "FC Spike", "Split", 13, 11, true],
  [9, "Scrim", "Mitternacht", "Sunset", 8, 13],
  [12, "Scrim", "Lowground", "Ascent", 13, 5],
  [15, "Turnier", "Team Kiesel", "Abyss", 13, 15, true],
  [16, "Scrim", "FC Spike", "Corrode", 13, 10],
  [22, "Premier", "Mitternacht", "Lotus", 13, 6],
  [27, "Scrim", "Nordlicht", "Split", 9, 13],
  [35, "Turnier", "Graue Wölfe", "Bind", 13, 8, true],
  [44, "Scrim", "Lowground", "Fracture", 10, 13],
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
    firstBloods: Math.round(rand() * kills * 0.22),
    plants: Math.floor(rand() * 4),
    defuses: Math.floor(rand() * 2.4),
  };
}

// Scoreboard der Gegner für die ersten Beispiel-Matches. Eigener Zufall mit eigenem Startwert:
// So bleiben alle Zahlen unseres Teams genau wie vorher.
const FOES = [["Vexo", "Neon"], ["Rasko", "Yoru"], ["Tibor77", "Omen"], ["Milaa", "Cypher"], ["Jonte", "Sova"]];
function makeFoes(i, type, rounds, won) {
  const rand = rng(900 + i);
  return FOES.map(([name, agent]) => {
    const kills = Math.round(rounds * 0.7 * (0.7 + rand() * 0.6) * (won ? 0.94 : 1.06));
    const row = {
      name, agent, kills,
      deaths: Math.max(4, Math.round(rounds * 0.7 * (0.8 + rand() * 0.4) * (won ? 1.05 : 0.93))),
      assists: Math.round(rounds * (0.15 + rand() * 0.25)),
      firstBloods: Math.round(rand() * kills * 0.2), plants: Math.floor(rand() * 4), defuses: Math.floor(rand() * 2.4),
    };
    return type === "Premier" ? { ...row, trades: (row.kills + row.assists) % 7 } : row;
  });
}

export function loadDemo() {
  const rand = rng(20261112);
  const now = Date.now();
  // setLocal legt die Daten so ab wie das echte Laden: Das Roster lässt sich in der Vorschau ändern (nur im Arbeitsspeicher)
  // Papierkorb (Etappe 8): ein entfernter Spieler, ein gelöschtes Match mit Clips, ein einzeln entfernter Clip.
  // Feste Zahlen ohne den Zufall: So bleiben alle übrigen Beispielzahlen genau wie vorher.
  const gone = (days) => ({ deleted: true, updatedAt: now - days * 86400000 });
  setLocal("players", [
    ...PLAYERS.map(({ skill, agents, ...p }) => ({ ...p, active: true, deleted: false })),
    { id: "pdemo7", name: "Nox", aliases: ["nox#old"], role: "Duelist", role2: null, status: "sub", active: true, createdAt: now - 90 * 86400000, createdBy: null, ...gone(20) },
  ]);
  const trashedMatch = {
    id: "mdemo16", date: daysAgo(5), type: "Scrim", opponent: "Eisbrecher", map: "Pearl", scoreUs: 7, scoreThem: 13,
    startSide: null, rounds: null, notes: "Aus Versehen doppelt eingetragen.", createdAt: now - 5 * 86400000, createdBy: null,
    players: PLAYERS.filter((p) => p.status === "stamm").map((p, i) => ({
      playerId: p.id, name: p.aliases[0], agent: p.agents[0], kills: 12 + i, deaths: 15 - i, assists: 4 + i, firstBloods: i % 3, plants: i % 2, defuses: 0,
    })),
    opponents: [], ...gone(2),
  };
  // Im ältesten Match spielte noch ein ehemaliger Spieler mit (former: steht nur im Scoreboard, zählt nirgends).
  // Seine Zeile ersetzt die letzte Zeile erst nach dem Zufall: So bleiben alle übrigen Beispielzahlen gleich.
  const exRow = (m, i) => (i !== GAMES.length - 1 ? m : {
    ...m, players: m.players.map((row, k) => (k === m.players.length - 1 ? { ...row, playerId: null, name: "Vento#EUW", former: true } : row)),
  });
  setLocal("matches", [...GAMES.map(([days, type, opponent, map, us, them, withSub], i) => {
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
        ? lineup.map((p) => ({ playerId: p.id, name: p.aliases[0], agent: p.agents[0], kills: null, deaths: null, assists: null, firstBloods: null, plants: null, defuses: null }))
        // Trades gibt es nur bei Premier. Der Wert entsteht aus den anderen Zahlen, ohne den Zufall zu bemühen:
        // So bleiben alle übrigen Beispielzahlen genau wie vorher.
        : lineup.map((p) => makeRow(p, rounds, us > them, rand)).map((row) => (type === "Premier" ? { ...row, trades: (row.kills + row.assists) % 7 } : row)),
      // Die neuesten Matches haben auch das Scoreboard der Gegner (freiwillig, ältere Matches haben keins)
      opponents: !open && i < 5 ? makeFoes(i, type, rounds, us > them) : [],
    };
  }).map(exRow), trashedMatch]);
  // Alle drei Arten von Clips. Das YouTube-Beispiel ist der frei lizenzierte Kurzfilm "Big Buck Bunny"
  // (Blender Foundation, CC BY), er darf eingebettet werden. Die Adresse example.com gehört niemandem.
  const clip = (n, matchId, title, kind, more = {}) => ({
    id: "cdemo" + n, matchId, title, kind, url: null, ytId: null, notes: [],
    createdAt: now - 86400000 + n * 60000, createdBy: null, deleted: false, ...more,
  });
  const note = (t, text, by, n) => ({ t, text, by, at: now - 80000000 + n * 60000 });
  setLocal("clips", [
    clip(1, "mdemo1", "Beispiel: Review bei YouTube", "youtube", {
      url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ", ytId: "aqz-KE-bpKQ",
      notes: [
        note(95, "Guter Trade. So wollen wir das öfter sehen.", "Mats", 2),
        note(12, "So sieht eine Notiz aus: Tipp auf die Zeit, dann springt das Video dorthin.", "Kairo", 1),
        note(47, "Utility zu früh benutzt. Beim nächsten Mal auf den Call warten.", "Kairo", 3),
      ],
    }),
    clip(2, "mdemo1", "Retake B, Runde 14", "local"),
    clip(3, "mdemo1", "VOD vom Gegner (anderer Link)", "link", {
      url: "https://example.com/vods/nordlicht-ascent",
      notes: [note(754, "Ihr Standard-Setup auf A: zwei vorne, einer hält Heaven.", "Lumo", 4)],
    }),
    clip(4, "mdemo1", "Pistol Verteidigung", "local"),
    clip(5, "mdemo5", "Overtime, letzte Runde", "local"),
    // Papierkorb: einzeln entfernt (Match sichtbar), einzeln entfernt (Match auch gelöscht),
    // und ein Clip des gelöschten Matches, der mit dem Match zurückkommt (steht nicht im Papierkorb)
    clip(6, "mdemo2", "Falscher Clip", "local", gone(1)),
    clip(7, "mdemo16", "Alter Clip vom Doppel-Match", "local", gone(3)),
    clip(8, "mdemo16", "Pistol Angriff", "link", { url: "https://example.com/vods/eisbrecher-pearl", notes: [note(30, "Zu langsam auf A.", "Mats", 5)] }),
  ]);
  // Agenten-Beispiele fürs Auslesen (js/agentrefs.js). Echte Agenten-Bilder gehören nicht ins öffentliche Repo:
  // In der Vorschau sind es farbige Kacheln mit Kürzel.
  const tile = (bg, text) => {
    const c = document.createElement("canvas");
    c.width = c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = bg; g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#fff"; g.font = "bold 22px Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(text, 32, 34);
    const url = c.toDataURL("image/jpeg", 0.85);
    return url.slice(url.indexOf(",") + 1);
  };
  const ref = (n, agent, kind, wrong, bg) => ({
    id: "rdemo" + n, agent, pic: tile(bg, agent.slice(0, 2).toUpperCase()), kind, wrong,
    createdAt: now - n * 3600000, createdBy: null, deleted: false,
  });
  setLocal("agentRefs", [
    ref(1, "Waylay", "fix", "Deadlock", "#7A4FA0"),
    ref(2, "Deadlock", "ok", null, "#5D6B78"),
    ref(3, "Gekko", "ok", null, "#3E8F4F"),
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
