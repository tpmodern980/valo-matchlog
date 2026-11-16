// Screenshot-Auslesen (PLAN.md Abschnitt 7): Bild verkleinern, an die KI schicken, Antwort prüfen.
// Dieses Modul füllt nichts ins Formular und speichert nichts. Es liefert nur geprüfte Werte zurück,
// das Formular (views/matchform.js) entscheidet, was damit passiert.
//
// Die KI läuft über Firebase AI Logic mit der Gemini Developer API. Die Firebase-Module dafür werden erst
// geladen, wenn wirklich jemand ein Bild ausliest (loadAi in firebase.js). In der Vorschau (?demo=1) gibt es
// kein Firebase: Dort kommt eine feste Beispiel-Antwort zurück, die denselben Weg durch die Prüfung nimmt.
import { cfg } from "./config.js";
import { S } from "./state.js";
import { MAPS, AGENTS } from "./constants.js";
import { norm } from "./util.js";
import { loadAi } from "./firebase.js";
import { refSheet, PIC_SIDE } from "./agentrefs.js";

// Längste Seite des Bildes, das an die KI geht (größere Bilder werden verkleinert, kleinere bleiben so)
export const MAX_SIDE = 1600;
const JPEG_QUALITY = 0.9;
// Ausweich-Modelle, falls Google das eingestellte Modell abschaltet (Stand 14.11.2026, PLAN.md Abschnitt 2)
const FALLBACK_MODELS = ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"];

let goodModel = "";   // das Modell, das in dieser Sitzung zuletzt geantwortet hat

const clean = (s) => String(s ?? "").trim().replace(/\s+/g, " ");
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
// Eigener Fehler mit einer festen Art (siehe TEXT unten)
const fail = (kind, more = {}) => Object.assign(new Error(kind), { scan: kind, ...more });

// ---------- Bild verkleinern ----------

async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try { return await createImageBitmap(file); } catch (e) { /* manche Formate gehen nur über <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise((ok, no) => { img.onload = ok; img.onerror = no; img.src = url; });
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Ein Stück des Bildes als JPEG. cut = { x, y, w, h } als Anteile von Breite und Höhe (0 bis 1), ohne cut das ganze Bild.
// Die längste Seite des Ergebnisses hat höchstens maxSide Pixel. Größer gemacht wird nur mit cut.grow: Dann bekommt
// die längste Seite genau maxSide Pixel (höchstens dreifach vergrößert).
async function render(pic, maxSide, cut = { x: 0, y: 0, w: 1, h: 1 }) {
  const fromWidth = pic.naturalWidth || pic.width, fromHeight = pic.naturalHeight || pic.height;
  if (!fromWidth || !fromHeight) throw fail("bad-image");
  const sx = Math.round(fromWidth * cut.x), sy = Math.round(fromHeight * cut.y);
  const sw = Math.max(1, Math.round(fromWidth * cut.w)), sh = Math.max(1, Math.round(fromHeight * cut.h));
  const scale = Math.min(cut.grow ? 3 : 1, maxSide / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * scale)), height = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";            // JPEG kennt keine Durchsichtigkeit
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(pic, sx, sy, sw, sh, 0, 0, width, height);
  const blob = await new Promise((done) => canvas.toBlob(done, "image/jpeg", JPEG_QUALITY));
  if (!blob) throw fail("bad-image");
  const dataUrl = await new Promise((ok, no) => {
    const fr = new FileReader();
    fr.onload = () => ok(String(fr.result)); fr.onerror = no;
    fr.readAsDataURL(blob);
  });
  return { base64: dataUrl.slice(dataUrl.indexOf(",") + 1), mimeType: blob.type, width, height, bytes: blob.size, fromWidth, fromHeight };
}

// Macht aus der gewählten Datei ein JPEG mit höchstens MAX_SIDE Pixeln an der längsten Seite.
// Liefert { base64, mimeType, width, height, bytes, fromWidth, fromHeight }.
export async function shrink(file, maxSide = MAX_SIDE) {
  return (await pieces(file, [null], maxSide))[0];
}

// Mehrere Stücke aus einer Datei (das Bild wird nur einmal geöffnet). cuts: Liste aus null (ganzes Bild)
// oder { x, y, w, h }. Liefert die JPEGs in derselben Reihenfolge.
export async function pieces(file, cuts, maxSide = MAX_SIDE) {
  let pic;
  try { pic = await decode(file); } catch (e) { throw fail("bad-image"); }
  try {
    const out = [];
    for (const cut of cuts) out.push(await render(pic, (cut && cut.side) || maxSide, cut || undefined));
    return out;
  } finally {
    if (pic.close) pic.close();
  }
}

// ---------- Anweisungen an die KI ----------

// Unsere Spieler mit allen Ingame-Namen: hilft der KI bei ähnlich aussehenden Zeichen (l/I, O/0).
// Dazu die Agents, die jeder bisher gespielt hat (häufigste zuerst, höchstens fünf): Entscheidungshilfe nur bei
// Agents, die sich ähnlich sehen (Waylay/Deadlock wurde verwechselt, laut Tim 16.11.2026).
function rosterText() {
  const played = new Map();
  for (const m of S.matches) {
    for (const r of m.players || []) {
      const agent = clean(r.agent);
      if (!r.playerId || !agent) continue;
      if (!played.has(r.playerId)) played.set(r.playerId, new Map());
      const counts = played.get(r.playerId);
      counts.set(agent, (counts.get(agent) || 0) + 1);
    }
  }
  const lines = S.players.map((p) => {
    const names = [...new Set([p.name, ...(p.aliases || [])].map((n) => clean(String(n).replace(/#.*$/, ""))).filter(Boolean))];
    const top = [...(played.get(p.id) || new Map())].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([a, n]) => `${a} ${n}x`);
    return "- " + names.join(", ") + (top.length ? ` (agents played before: ${top.join(", ")})` : "");
  });
  return lines.length ? lines.join("\n") : "(none yet)";
}

function agentList() {
  const seen = new Set(), out = [];
  for (const a of [...AGENTS, ...S.matches.flatMap((m) => (m.players || []).map((r) => clean(r.agent)))]) {
    if (a && !seen.has(norm(a))) { seen.add(norm(a)); out.push(a); }
  }
  return out;
}

// sheet: Es geht eine Beispieltafel mit (Bild 3)
export const boardPrompt = (sheet = false) => `You read one screenshot from the game VALORANT and return JSON. The screenshot shows the post-match screen "Summary > Scoreboard".

What the screen looks like:
- Top left: the final score, written as "<number> VICTORY <number>" (or DEFEAT / DRAW). The FIRST number is our team, the SECOND number is the opponent.
- Top right, in small text: the date (for example "NOV 12, 2026"), the mode (for example "STANDARD - CUSTOM" or "PREMIER"), "MAP - <NAME>" and the match duration.
- A table with all ten players of both teams mixed together ("Individually sorted"). The header row names the columns. There is always a KDA column (written as "kills / deaths / assists") and the columns FIRST BLOODS, PLANTS and DEFUSES. Depending on the mode there are extra columns: PERFORMANCE SCORE (a number like 306) and TRADES. Ignore PERFORMANCE SCORE completely. Always use the column headers to find the right number: a value belongs to the header directly above it.
- The background colour of a row tells the team: GREEN/TEAL rows are our team. RED/MAROON rows are the opponent. Exactly one row has a different colour (yellow, gold, olive or grey-beige): it is the player who took the screenshot and also belongs to our team.
- In front of a name there can be a short team tag followed by a vertical bar, for example "ツ | Kairo" or "ABC | Someone". The tag and the bar are NOT part of the name. Some players have no tag.
- The agent of a player is only visible as a small portrait at the left end of the row.

You get two images of the same screenshot:
- Image 1 is the whole screenshot. Read everything except the agents from image 1.
- Image 2 is an enlarged cut-out of the left part of the table: the agent portraits with the player names next to them. Decide the agent of every row (our team and opponents) from image 2: find the row by the name next to the portrait. Only if image 2 does not show the portraits, use image 1.
- Look at the face of each portrait carefully. These agents are easy to confuse: GEKKO (a young man) and WAYLAY (a woman); ISO (a man) and VYSE (a woman); WAYLAY and DEADLOCK (both women). Before you answer one of these five, compare the portrait closely with what you know about both agents.
- For our players you also get the agents they played before (see the list of known players). Use this ONLY to decide between two look-alike agents. Players do pick new agents: if the portrait clearly shows another agent, write that agent.${sheet ? `
- Image 3 is a reference sheet our team made from earlier screenshots of this same game: small agent portraits, each with the CORRECT agent name written below it. Compare every portrait of image 2 with the sheet. If it matches a portrait on the sheet, use the name written below that one, even if you would have guessed another agent. The sheet does not contain every agent.` : ""}

Return these fields:
- map: the map name with normal capitalisation (for example "Haven").
- scoreUs: the first number of the final score. scoreThem: the second number.
- date: the date as "YYYY-MM-DD".
- mode: the mode text exactly as written in the top right corner (for example "STANDARD - CUSTOM" or "PREMIER").
- opponentTag: the team tag in front of the names in the RED rows, without the bar, if most red rows share the same tag. Otherwise null.
- players: ONLY the green/teal rows and the one differently coloured row of the screenshot taker (normally five rows), from top to bottom. Never include a red row.
  - name: the player name exactly as written, WITHOUT team tag and bar. Keep capitalisation, digits and special letters (like ä or ć) exactly as shown. Do not correct, translate or shorten names.
  - agent: one name from the agent list below, but only if you clearly recognise the portrait. Otherwise null.
  - box: where the agent portrait of this row is in IMAGE 2, as [ymin, xmin, ymax, xmax], each a whole number from 0 to 1000 relative to the height and width of image 2. Only the small square portrait, not the name. null if image 2 does not show it.
  - kills, deaths, assists: the three numbers of the KDA cell of that row, in this order.
  - firstBloods, plants, defuses: the numbers of that row below the headers FIRST BLOODS, PLANTS and DEFUSES.
  - trades: the number of that row below the header TRADES. If the table has no column with the header TRADES, return null. Never put the TRADES number into another field, and never use the PERFORMANCE SCORE number for any field.
- opponents: ONLY the red/maroon rows (normally five), from top to bottom, each with exactly the same fields as a player above (name without team tag and bar, agent, box, kills, deaths, assists, trades, firstBloods, plants, defuses).
- Every row of the table belongs to exactly one of the two lists: green/teal rows and the row of the screenshot taker go into players, red rows go into opponents. Never put a row into both lists and never leave a clearly visible row out.

Rules:
- Read only what is visible in the image. If a value is not clearly legible, cut off or covered, return null for it. Never guess, estimate or calculate a value.
- If the image is not this scoreboard screen, return null for every field and empty players and opponents lists.

Agent list: ${agentList().join(", ")}

Known players of our team (each line is one player with all of their in-game names; this list is only about the players list, not about opponents). If a name you read is the same as one of these except for upper/lower case or look-alike characters (l and I, O and 0), write it as in this list. Otherwise write exactly what the image shows. Never add a player who is not visible in the image.
${rosterText()}`;

// Die Symbole der Runden sind im ganzen Bild für die KI zu klein (am 14.11.2026 gegen gemini-3.6-flash getestet:
// 2 von 24 Runden falsch). Deshalb gehen bei der Timeline drei Bilder an die KI: das ganze Bild und zwei
// vergrößerte Ausschnitte der Runden-Leiste (linke und rechte Hälfte, in der Mitte überlappend).
// Die Leiste liegt im Beispielbild zwischen 25 % und 36 % der Höhe; der Ausschnitt lässt Luft nach oben und unten.
const STRIP_CUTS = [null, { x: 0, y: 0.15, w: 0.58, h: 0.3 }, { x: 0.42, y: 0.15, w: 0.58, h: 0.3 }];

// Beim Scoreboard sind die Agenten-Bilder im ganzen Bild nur etwa 45 Pixel groß (Waylay/Gekko und Iso/Vyse wurden
// verwechselt, laut Tim 16.11.2026). Deshalb geht zusätzlich ein vergrößerter Ausschnitt mit Bild und Namen mit.
// In den Beispielbildern (2000 × 1320) liegen die Bilder bei 21–25 % der Breite, die Namen bis etwa 35 %,
// die Zeilen zwischen 31 % und 75 % der Höhe. Der Ausschnitt lässt Luft für andere Bildformate.
// side: längste Seite dieses Ausschnitts (etwa doppelt so groß wie im Original).
const BOARD_CUTS = [null, { x: 0.17, y: 0.25, w: 0.28, h: 0.56, grow: true, side: 1400 }];

const LINE_PROMPT = `You read one screenshot from the game VALORANT and return JSON. The screenshot shows the screen "Match Details > Timeline".

You get three images of the same screenshot:
- Image 1 is the whole screenshot.
- Image 2 is an enlarged cut-out of its upper left part. Image 3 is an enlarged cut-out of its upper right part. Together they show the strip with the rounds. They overlap in the middle, so a few rounds are visible in both.
Read the round icons from images 2 and 3, because they are larger there. Use the round number printed above each column to tell which round it is, and report every round only once. Only if images 2 and 3 do not show the strip with the rounds, read it from image 1.

What the screen looks like:
- Top left: the final score, written as "<number> VICTORY <number>" (or DEFEAT / DRAW). The FIRST number is our team, the SECOND number is the opponent.
- Below it there is a horizontal strip with one column per round. The columns are numbered 1, 2, 3 ... from left to right (usually up to 24, more if there was overtime).
- Between round 12 and round 13 there is an icon with two circular arrows (the teams swap sides). It is NOT a round. Overtime may contain more such icons; they are never rounds.
- One column may have a frame around it (the currently selected round). It is a normal round.
- Each column shows, below two small vertical bars, exactly ONE small icon. Read this icon:
  - Its COLOUR tells who won the round: TEAL / TURQUOISE / GREEN means our team WON the round. RED means our team LOST the round. Do not use the bars above the icon for this.
  - Its SHAPE tells how the round ended. There are five shapes:
    - a square frame with a diagonal cross (X) inside it = all enemies eliminated ("elimination")
    - an open shape without a frame, with a pointed tip at the top and three or more spikes or tongues like a small flame, crown or splash = the spike exploded ("explosion")
    - a tool that looks like pliers or scissors, two crossed legs with a loop at the top = the spike was defused ("defuse")
    - an hourglass, two triangles touching at their tips = the time ran out ("time")
    - a star = the "best round". The star is always pale yellow: neither its colour nor its shape tells who won or how the round ended (see the special rule below)
    Look for the square frame: only an icon with a closed square frame is an elimination.
- The rest of the screen (event log, mini map, player list) belongs to one single round. Ignore it.
- The right edge of the strip can be partly covered by a friends list.

Return these fields:
- scoreUs: the first number of the final score. scoreThem: the second number.
- rounds: one entry per round column, from left to right, each with:
  - round: the round number written above the column.
  - result: "W" if the icon is teal/turquoise/green, "L" if the icon is red, "?" if you cannot clearly see the colour or if the icon is the star.
  - end: "elimination", "defuse", "explosion", "time", or "unknown" (use "unknown" for the star and whenever the shape is not clearly recognisable).
- Special rule for the round with the star: to the right, below the strip, there is a headline for the selected round, for example "ROUND 11 | (DEFUSE WIN) (YOUR BEST ROUND)". Only if this headline shows the same round number as the star column AND contains "YOUR BEST ROUND", use it: the word WIN means result "W", the word LOSS or DEFEAT means result "L", and ELIMINATION / DEFUSE / DETONATION (or EXPLOSION) / TIME give the end. In every other case the star round gets result "?" and end "unknown".

Rules:
- Go column by column and include every round number that is visible, without skipping one.
- Decide every round only by the colour of its own icon. The rounds do not have to add up to the final score: never change a round to make the numbers fit.
- Read only what is visible. Never guess. Do not use the final score to fill in or correct rounds.
- If the image is not this timeline screen, return null for both scores and an empty rounds list.`;

function schemaOf(kind, Schema) {
  const int = () => Schema.integer({ nullable: true });
  const str = () => Schema.string({ nullable: true });
  if (kind === "board") {
    // Eine Zeile der Tabelle: bei uns und bei den Gegnern dieselben Felder
    const rows = () => Schema.array({ items: Schema.object({ properties: {
      name: Schema.string(), agent: str(),
      box: Schema.array({ items: Schema.integer(), nullable: true }),
      kills: int(), deaths: int(), assists: int(), trades: int(), firstBloods: int(), plants: int(), defuses: int(),
    } }) });
    return Schema.object({ properties: {
      map: str(), scoreUs: int(), scoreThem: int(), date: str(), mode: str(), opponentTag: str(),
      players: rows(), opponents: rows(),
    } });
  }
  return Schema.object({ properties: {
    scoreUs: int(), scoreThem: int(),
    rounds: Schema.array({ items: Schema.object({ properties: {
      round: Schema.integer(),
      result: Schema.enumString({ enum: ["W", "L", "?"] }),
      end: Schema.enumString({ enum: ["elimination", "defuse", "explosion", "time", "unknown"] }),
    } }) }),
  } });
}

// ---------- Antwort prüfen ----------

// Ganze Zahl von 0 bis max, sonst null (nichts raten, nichts runden)
function whole(v, max) {
  if (typeof v === "string" && /^\d{1,3}$/.test(v.trim())) v = Number(v);
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : null;
}

// Lage eines Agenten-Bildes: [ymin, xmin, ymax, xmax] von 0 bis 1000 (bezogen auf Bild 2), sonst null
function boxOf(v) {
  if (!Array.isArray(v) || v.length !== 4) return null;
  const b = v.map((x) => (typeof x === "number" && Number.isFinite(x) ? Math.round(x) : NaN));
  if (b.some((x) => Number.isNaN(x) || x < 0 || x > 1000)) return null;
  return b[0] < b[2] && b[1] < b[3] ? b : null;
}

// Die Agenten-Bilder aus dem Original ausschneiden (für das Lernen aus Korrekturen, js/agentrefs.js).
// Die Lage kommt von der KI (bezogen auf den Ausschnitt BOARD_CUTS[1]); passt sie nicht zu einem kleinen,
// ungefähr quadratischen Bild, gibt es für diese Zeile keins. Setzt row.pic (JPEG base64) bei den Zeilen.
async function cutPortraits(file, rows) {
  const withBox = rows.filter((r) => r.box);
  if (!withBox.length) return;
  let pic;
  try { pic = await decode(file); } catch (e) { return; }
  try {
    const W = pic.naturalWidth || pic.width, H = pic.naturalHeight || pic.height, cut = BOARD_CUTS[1];
    for (const r of withBox) {
      const [y0, x0, y1, x1] = r.box;
      // in Pixel des Originals
      const left = (cut.x + (x0 / 1000) * cut.w) * W, right = (cut.x + (x1 / 1000) * cut.w) * W;
      const top = (cut.y + (y0 / 1000) * cut.h) * H, bottom = (cut.y + (y1 / 1000) * cut.h) * H;
      const w = right - left, h = bottom - top;
      if (w < 12 || h < 12 || w > W * 0.1 || h > H * 0.15 || w / h > 1.8 || h / w > 1.8) continue;
      // quadratisch um die Mitte
      const side = Math.max(w, h), cx = (left + right) / 2, cy = (top + bottom) / 2;
      const sx = Math.max(0, Math.min(W - side, cx - side / 2)), sy = Math.max(0, Math.min(H - side, cy - side / 2));
      try {
        const out = await render(pic, PIC_SIDE, { x: sx / W, y: sy / H, w: side / W, h: side / H, grow: true });
        r.pic = out.base64;
      } catch (e) { /* ohne Bild */ }
    }
  } finally {
    if (pic.close) pic.close();
  }
}

// Das Team-Kürzel vor dem Strich gehört nicht zum Namen: "ツ | Kairo" -> "Kairo"
export function stripTag(raw) {
  const s = clean(raw);
  const m = /^[^|｜│┃¦]{0,12}[|｜│┃¦]\s*(.*)$/u.exec(s);
  return m ? m[1].trim() : s;   // nur Kürzel und Strich ohne Namen dahinter: leer
}

function isoDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(clean(v));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getFullYear() === Number(m[1]) && d.getMonth() === Number(m[2]) - 1 && d.getDate() === Number(m[3]) ? m[0] : null;
}

// Bekannte Schreibweise übernehmen ("HAVEN" -> "Haven"). Unbekanntes bleibt bei der Map so stehen, wie es kam
// (neue Maps gibt es ab und zu, und der Name steht als Text im Bild). Bei strict wird Unbekanntes leer:
// Agents sind nur als Bild zu sehen, ein Name außerhalb der Liste wäre geraten.
function known(value, list, maxLen, strict = false) {
  const text = clean(value).slice(0, maxLen);
  if (!text || !norm(text)) return "";
  const hit = list.find((x) => norm(x) === norm(text));
  if (hit) return hit;
  if (strict) return "";
  return text === text.toUpperCase() ? text.charAt(0) + text.slice(1).toLowerCase() : text;
}

// Antwort zum Scoreboard -> { map, scoreUs, scoreThem, date, type, opponentTag, players: [...], tooMany, opponents: [...] }
// Alles, was nicht eindeutig gültig ist, wird null bzw. leer.
export function checkBoard(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const maps = [...MAPS, ...S.matches.map((m) => clean(m.map))].filter(Boolean);
  const agents = agentList();
  const seen = new Set();   // jeder Name nur einmal, auch nicht in beiden Teams
  const team = (list) => {
    const out = [];
    for (const p of Array.isArray(list) ? list : []) {
      if (!p || typeof p !== "object") continue;
      const name = stripTag(p.name).slice(0, 40), key = norm(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push({
        name, agent: known(p.agent, agents, 20, true),
        box: boxOf(p.box),   // Lage des Agenten-Bildes in Bild 2 (zum Ausschneiden), sonst null
        kills: whole(p.kills, 999), deaths: whole(p.deaths, 999), assists: whole(p.assists, 999),
        trades: whole(p.trades, 999),   // nur bei Premier im Bild, sonst null
        firstBloods: whole(p.firstBloods, 999), plants: whole(p.plants, 999), defuses: whole(p.defuses, 999),
      });
    }
    return out;
  };
  // Erst unser Team: Steht ein Name in beiden Listen, zählt er zu uns
  const players = team(r.players), opponents = team(r.opponents);
  const out = {
    map: known(r.map, maps, 30) || null,
    scoreUs: whole(r.scoreUs, 99), scoreThem: whole(r.scoreThem, 99),
    date: isoDate(r.date),
    // Art des Matches: Sicher erkennbar ist nur Premier. "Custom" kann ein Scrim oder ein Turnier sein: bleibt offen.
    type: /premier/i.test(clean(r.mode)) ? "Premier" : null,
    opponentTag: clean(r.opponentTag).replace(/[|｜│┃¦]/g, "").trim().slice(0, 12) || null,
    players: players.slice(0, 10),
    tooMany: players.length > 5,   // mehr als fünf: Die KI hat wohl auch Gegner mitgenommen
    opponents: opponents.slice(0, 5),   // die roten Zeilen (Scoreboard der Gegner)
  };
  if (!out.players.length && out.scoreUs === null && out.scoreThem === null && !out.map) throw fail("unreadable-board");
  return out;
}

const END = { elimination: "E", defuse: "D", explosion: "X", time: "T" };

// Startseite aus der Art ableiten, wie die Runden endeten (PLAN.md Abschnitt 7):
// Wer durch Explosion gewinnt, war im Angriff. Wer durch Entschärfen oder Zeitablauf gewinnt, in der Verteidigung.
// rounds: "WLW…", ends: gleich lang, je Runde E, D, X, T oder "-". Liefert { side: "atk" | "def" | null, clash }.
// side bleibt null, wenn es keinen Hinweis gibt oder sich die Hinweise widersprechen (dann ist clash wahr).
// Overtime zählt nicht mit.
export function sideFrom(rounds, ends) {
  const votes = new Set();
  for (let i = 0; i < Math.min(rounds.length, ends.length, 24); i++) {
    const won = rounds[i] === "W", end = ends[i];
    let ours = null;   // unsere Seite in dieser Runde
    if (end === "X") ours = won ? "atk" : "def";
    else if (end === "D" || end === "T") ours = won ? "def" : "atk";
    if (!ours) continue;
    votes.add(i < 12 ? ours : (ours === "atk" ? "def" : "atk"));
  }
  return { side: votes.size === 1 ? [...votes][0] : null, clash: votes.size > 1 };
}

// Antwort zur Timeline -> { scoreUs, scoreThem, rounds, startSide, cutAt, sideClash, inferred }
// rounds enthält nur W und L ohne Lücken. Ist eine Runde unlesbar oder fehlt eine Nummer, endet der Verlauf davor
// (cutAt = Nummer der ersten Runde, die fehlt).
// Einzige Ausnahme: Genau EINE Runde ist unlesbar, alle anderen sind da, und die Zahl der Runden passt zum Endstand.
// Das ist der Normalfall bei der "besten Runde": Dort steht ein gelber Stern statt eines farbigen Symbols.
// Dann ergibt sich diese eine Runde zwingend aus dem Endstand (inferred = { round, result }), und das Formular sagt es.
export function checkLine(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const byNo = new Map();
  for (const x of Array.isArray(r.rounds) ? r.rounds : []) {
    const no = x && typeof x === "object" ? whole(x.round, 60) : null;
    if (no && !byNo.has(no)) byNo.set(no, x);
  }
  const scoreUs = whole(r.scoreUs, 99), scoreThem = whole(r.scoreThem, 99);
  const last = byNo.size ? Math.max(...byNo.keys()) : 0;
  const list = [];   // pro Runde "W", "L" oder "" (unlesbar oder Nummer fehlt)
  for (let no = 1; no <= last; no++) {
    const x = byNo.get(no), res = x ? String(x.result || "").toUpperCase() : "";
    list.push(res === "W" || res === "L" ? res : "");
  }
  let inferred = null;
  const gaps = list.map((v, i) => (v ? 0 : i + 1)).filter(Boolean);
  if (gaps.length === 1 && byNo.has(gaps[0]) && scoreUs !== null && scoreThem !== null && last === scoreUs + scoreThem) {
    const w = list.filter((v) => v === "W").length, l = list.filter((v) => v === "L").length;
    const result = w === scoreUs - 1 && l === scoreThem ? "W" : w === scoreUs && l === scoreThem - 1 ? "L" : "";
    if (result) { list[gaps[0] - 1] = result; inferred = { round: gaps[0], result }; }
  }
  let rounds = "", ends = "", cutAt = null;
  for (let no = 1; no <= last; no++) {
    if (!list[no - 1]) { cutAt = no; break; }
    rounds += list[no - 1];
    ends += END[String(byNo.get(no).end || "").toLowerCase()] || "-";
  }
  const out = { scoreUs, scoreThem, rounds, startSide: null, cutAt, sideClash: false, inferred };
  if (!rounds && scoreUs === null && scoreThem === null) throw fail("unreadable-line");
  // Widersprechen sich die Hinweise, bleibt die Startseite leer, und das Formular sagt es
  const from = sideFrom(rounds, ends);
  out.startSide = from.side;
  out.sideClash = from.clash;
  return out;
}

// ---------- Beispiel-Antworten für die Vorschau ----------
// Die Zahlen stammen aus den zwei echten Beispielbildern (Haven, 15:9), die Namen aus den erfundenen Beispieldaten
// der Vorschau: Echte Spielernamen gehören nicht ins öffentliche Repo. Ein Name steht bewusst nicht im Roster.
const DEMO = {
  board: {
    map: "HAVEN", scoreUs: 15, scoreThem: 9, date: "2026-11-12", mode: "STANDARD - CUSTOM", opponentTag: "LWG",
    // box: Lage der Agenten-Bilder im Ausschnitt (Bild 2), passend zum Beispielbild 1 (2000 × 1320):
    // Zeile n liegt bei ymin = 111 + (n − 1) · 79, Höhe 73, x 163 bis 263. Mit anderen Bildern landet sie irgendwo.
    players: [
      { name: "ツ | Kairo", agent: "Sova", box: [111, 163, 184, 263], kills: 31, deaths: 14, assists: 11, firstBloods: 3, plants: 6, defuses: 2 },
      { name: "ツ | Lumo", agent: "Omen", box: [190, 163, 263, 263], kills: 23, deaths: 14, assists: 11, firstBloods: 1, plants: 1, defuses: 1 },
      { name: "ツ | matsn", agent: "Chamber", box: [349, 163, 422, 263], kills: 19, deaths: 15, assists: 7, firstBloods: 3, plants: 2, defuses: 0 },
      { name: "ツ | Nyxo", agent: "Gekko", box: [507, 163, 580, 263], kills: 17, deaths: 16, assists: 5, firstBloods: 3, plants: 1, defuses: 2 },
      { name: "ツ | feli", agent: null, box: [587, 163, 660, 263], kills: 15, deaths: 17, assists: 17, firstBloods: 3, plants: 1, defuses: 0 },
    ],
    // Die roten Zeilen: Zahlen aus dem Beispielbild, Namen erfunden. Einer hat (wie im Bild) kein Team-Kürzel.
    opponents: [
      { name: "LWG | Vexo", agent: "Neon", box: [269, 163, 342, 263], kills: 20, deaths: 18, assists: 4, firstBloods: 2, plants: 0, defuses: 2 },
      { name: "LWG | Rasko", agent: "Yoru", box: [428, 163, 501, 263], kills: 19, deaths: 22, assists: 3, firstBloods: 3, plants: 0, defuses: 0 },
      { name: "Tibor77", agent: "Omen", box: [666, 163, 739, 263], kills: 14, deaths: 23, assists: 7, firstBloods: 4, plants: 0, defuses: 0 },
      { name: "LWG | Milaa", agent: "Vyse", box: [745, 163, 818, 263], kills: 13, deaths: 22, assists: 6, firstBloods: 2, plants: 0, defuses: 2 },
      { name: "LWG | Jonte", agent: "Sova", box: [824, 163, 897, 263], kills: 10, deaths: 20, assists: 12, firstBloods: 0, plants: 9, defuses: 0 },
    ],
  },
  // Der Verlauf aus dem Timeline-Beispiel: 1. Hälfte 7:5, 2. Hälfte 8:4. In Runde 1 entschärft der Gegner: Wir starten im Angriff.
  line: {
    scoreUs: 15, scoreThem: 9,
    rounds: [..."LLLWLWWWWLWWLLWWLWWLWWWW"].map((result, i) => ({
      round: i + 1, result,
      end: { E: "elimination", D: "defuse", X: "explosion", T: "time", S: "unknown" }["DEDSDXEEEDXEXEDTXDDEEDED"[i]],
    })),
  },
};

// ---------- Die KI fragen ----------

// Das Tageskontingent gilt bei Google pro Modell. Ist es bei einem Modell aufgebraucht, nimmt die App das nächste
// aus der Liste und merkt sich das bis zum nächsten Tag (das Kontingent beginnt um Mitternacht in Kalifornien neu).
const SPENT_KEY = "valo-ai-spent";
const quotaDay = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(new Date());
function spentModels() {
  try {
    const v = JSON.parse(localStorage.getItem(SPENT_KEY) || "null");
    return v && v.day === quotaDay() && Array.isArray(v.models) ? v.models : [];
  } catch (e) { return []; }
}
function markSpent(name) {
  const models = [...new Set([...spentModels(), name])];
  try { localStorage.setItem(SPENT_KEY, JSON.stringify({ day: quotaDay(), models })); } catch (e) { /* nur für diesen Tag */ }
}

function modelNames() {
  const list = [...new Set([goodModel, cfg.aiModel, ...FALLBACK_MODELS].map((m) => clean(m)).filter(Boolean))];
  const spent = spentModels();
  const left = list.filter((m) => !spent.includes(m));
  return left.length ? left : list;   // alle aufgebraucht: trotzdem versuchen (vielleicht schon wieder frei)
}

const statusOf = (e) => {
  const s = e && e.customErrorData && e.customErrorData.status;
  if (typeof s === "number") return s;
  const m = /\[(\d{3})\b/.exec(String((e && e.message) || ""));
  return m ? Number(m[1]) : 0;
};
// 404 heißt meist "Modell nicht gefunden". Ausnahme: AI Logic ist im Projekt noch gar nicht eingerichtet.
const notSetUp = (e) => (e && e.code === "api-not-enabled") || (statusOf(e) === 404 && /genai config/i.test(String(e.message)));
const modelMissing = (e) => statusOf(e) === 404 && !notSetUp(e);

function parseJson(text) {
  const t = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const v = JSON.parse(t);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
  } catch (e) { /* unten */ }
  throw fail("bad-json");
}

// jpegs: die Bilder für diese Anfrage (Scoreboard: ganzes Bild plus Ausschnitt mit den Agenten-Bildern,
// dazu ggf. die Beispieltafel (sheet = true); Timeline: ganzes Bild plus zwei Ausschnitte)
async function ask(kind, jpegs, sheet = false) {
  if (S.demo) {
    await wait(900);
    return { raw: DEMO[kind], model: "" };
  }
  if (navigator.onLine === false) throw fail("offline");
  const { ai, AIM, check } = await loadAi();
  const prompt = kind === "board" ? boardPrompt(sheet) : LINE_PROMPT;
  const images = jpegs.map((j) => ({ inlineData: { data: j.base64, mimeType: j.mimeType } }));
  const tried = [], spent = [];
  let quotaError = null;
  try {
    for (const name of modelNames()) {
      tried.push(name);
      try {
        // Keine "temperature": Die Modelle ab Gemini 3 beachten sie laut Firebase-Doku nicht mehr.
        const model = AIM.getGenerativeModel(ai, {
          model: name,
          generationConfig: { responseMimeType: "application/json", responseSchema: schemaOf(kind, AIM.Schema) },
        });
        const result = await model.generateContent([prompt, ...images]);
        const raw = parseJson(result.response.text());
        if (goodModel !== name) console.info(`Screenshot-Auslesen: Modell „${name}“ antwortet.`);
        goodModel = name;
        return { raw, model: name, spent };
      } catch (e) {
        if (kindOf(e) === "quota-day") {
          // Tageskontingent dieses Modells aufgebraucht: nächstes Modell
          console.warn(`Screenshot-Auslesen: Tageskontingent von „${name}“ aufgebraucht, probiere das nächste Modell.`);
          markSpent(name);
          spent.push(name);
          quotaError = e;
          continue;
        }
        if (!modelMissing(e)) throw e;
        console.warn(`Screenshot-Auslesen: Modell „${name}“ nicht gefunden, probiere das nächste.`);
      }
    }
    if (quotaError) throw quotaError;   // bei allen Modellen aufgebraucht
    throw fail("no-model", { tried });
  } catch (e) {
    // Abgelehnt (401/403): nachsehen, ob App Check überhaupt ein Token bekommt. Das macht die Meldung genauer.
    const st = statusOf(e);
    // Mit Einmal-Tokens scheitert schon das Holen des Tokens: Dann steht "appCheck/…" in der Meldung (ohne Status).
    const acFail = /appCheck\//i.test(String(e.message));
    if (!e.scan && acFail) e.appCheck = { mode: check.mode, token: check.token, probeError: e };
    else if (!e.scan && (st === 401 || st === 403)) {
      let probeError = null;
      try { await check.probe(); } catch (err) { probeError = err; }
      e.appCheck = { mode: check.mode, token: check.token, probeError };
    }
    // Am eigenen Rechner: nachfragen, warum der Debug-Token nicht gilt (Token fehlt oder App Check noch gar nicht an)
    if (e.appCheck && e.appCheck.probeError && check.mode === "debug") e.appCheck.reason = await check.why();
    throw e;
  }
}

// ---------- Fehlermeldungen ----------

const BY_HAND = " Von Hand eintragen geht immer.";
const ADMIN = " Das richtet der Admin einmal ein (ANLEITUNG.md, ";
const TEXT = {
  "bad-image": () => "Das Bild ließ sich nicht öffnen. Wähl bitte einen Screenshot als PNG, JPG oder WebP.",
  "unreadable-board": () => "Auf dem Bild war keine Ergebnis-Übersicht zu erkennen. Gebraucht wird der Screenshot nach dem Match: Reiter „Summary“, links „Scoreboard“.",
  "unreadable-line": () => "Auf dem Bild war keine Timeline zu erkennen. Gebraucht wird der Screenshot nach dem Match: links der Reiter „Timeline“, oben die Leiste mit den Runden.",
  "bad-json": () => "Die Antwort der KI war nicht lesbar (kein gültiges JSON). Tipp noch einmal auf „Auslesen“.",
  blocked: () => "Die KI hat zu diesem Bild keine Antwort geliefert. Probier es noch einmal oder mit einem anderen Screenshot.",
  offline: () => "Keine Verbindung: Das Auslesen braucht das Internet. Blockiert bei dir ein Werbeblocker Adressen von Google, schalt ihn für diese Seite aus." + BY_HAND,
  timeout: () => "Die KI hat zu lange gebraucht. Versuch es gleich noch einmal." + BY_HAND,
  overloaded: () => "Die KI ist gerade überlastet oder gestört. Versuch es in einer Minute noch einmal." + BY_HAND,
  "quota-minute": () => "Zu viele Anfragen kurz hintereinander. Warte eine Minute und tipp dann noch einmal auf „Auslesen“.",
  "quota-day": () => "Das kostenlose Tageskontingent der KI ist aufgebraucht, auch bei den Ausweich-Modellen. Ein neues gibt es täglich gegen 9 Uhr morgens." + BY_HAND,
  quota: () => "Das kostenlose Kontingent der KI ist gerade erschöpft (zu viele Anfragen). Warte eine Minute und versuch es noch einmal. Kommt die Meldung wieder, ist das Tageskontingent aufgebraucht: Dann geht es am nächsten Tag gegen 9 Uhr weiter." + BY_HAND,
  "not-enabled": () => "Das Screenshot-Auslesen ist in Firebase noch nicht eingeschaltet (AI Logic)." + ADMIN + "Schritt 7). Direkt danach kann es ein paar Minuten dauern, bis es geht.",
  "no-model": (e) => `Keins der KI-Modelle wurde gefunden (probiert: ${(e.tried || []).join(", ")}). Google hat sie vermutlich abgelöst: In firebase-config.js bei „aiModel“ einen aktuellen Namen eintragen (ANLEITUNG.md, Schritt 7).`,
  "appcheck-missing": () => "App Check fehlt: Firebase nimmt Anfragen an die KI nur mit App Check an, und in firebase-config.js steht noch kein „recaptchaSiteKey“." + ADMIN + "Schritt 8).",
  "appcheck-off": () => "App Check ist im Firebase-Projekt noch nicht eingeschaltet. Das passiert beim Einrichten von AI Logic." + ADMIN + "Schritt 7). Direkt danach kann es ein paar Minuten dauern, bis es geht.",
  "appcheck-debug": () => "Dieser Browser ist bei Firebase noch nicht als Testgerät eingetragen (App Check). Trag den Debug-Token unten in der Firebase-Konsole ein: Sicherheit → App Check → Apps → die drei Punkte neben der Web-App → „Debug-Tokens verwalten“. Dann noch einmal auf „Auslesen“ tippen.",
  "appcheck-client": (e) => `App Check konnte diesen Browser nicht bestätigen (reCAPTCHA).${e.detail ? ` (${e.detail})` : ""} Lad die Seite neu und versuch es noch einmal. Bleibt es dabei: Blockiert ein Werbeblocker reCAPTCHA? Sonst stimmt die Einrichtung nicht (ANLEITUNG.md, Schritt 8: Schlüssel und Domain).`,
  "appcheck-rejected": () => "Firebase hat die Anfrage abgelehnt, obwohl App Check ein Token geliefert hat. Meist passt die Einrichtung noch nicht ganz (ANLEITUNG.md, Schritt 7 und 8). Direkt nach einer Änderung in der Konsole ein paar Minuten warten.",
  "appcheck-unenforced": () => "Firebase verlangt, dass App Check für AI Logic erzwungen ist. In der Firebase-Konsole: Sicherheit → App Check → APIs → „Firebase AI Logic“ → erzwingen (ANLEITUNG.md, Schritt 8).",
  deactivated: () => "Firebase hat AI Logic für dieses Projekt abgeschaltet, weil App Check nicht erzwungen war. In der Firebase-Konsole: Sicherheit → App Check → APIs → „Firebase AI Logic“ → erzwingen (ANLEITUNG.md, Schritt 8).",
  "key-blocked": () => "Der API-Schlüssel des Projekts darf die „Firebase AI Logic API“ nicht aufrufen." + ADMIN + "Abschnitt „Wenn etwas nicht klappt“).",
  "key-invalid": () => "Der API-Schlüssel in firebase-config.js ist ungültig. Trag die Werte aus der Firebase-Konsole noch einmal ein (ANLEITUNG.md, Schritt 2).",
  "too-large": () => "Das Bild ist zu groß für die KI. Wähl bitte einen normalen Screenshot.",
  unknown: (e) => "Das Auslesen hat nicht geklappt. Versuch es noch einmal." + (e.detail ? ` (Fehler: ${e.detail})` : "") + BY_HAND,
};

// Welche Art Fehler ist das? (für explain und zum Testen)
export function kindOf(e) {
  if (!e) return "unknown";
  if (e.scan) return e.scan;
  const st = statusOf(e), code = String(e.code || "");
  // Die Einzelheiten von Google (z. B. welches Kontingent) stehen teils nur in den Fehler-Details
  let msg = String(e.message || "");
  try { msg += " " + JSON.stringify((e.customErrorData && e.customErrorData.errorDetails) || ""); } catch (err) { /* egal */ }
  if (e.name === "AbortError" || /timeout has expired/i.test(msg)) return "timeout";
  if (notSetUp(e) || (st === 403 && /SERVICE_DISABLED|has not been used in project|it is disabled/i.test(msg))) return "not-enabled";
  if (st === 403 && /deactivated/i.test(msg)) return "deactivated";
  if (st === 403 && /must enforce Firebase App Check/i.test(msg)) return "appcheck-unenforced";
  if (st === 403 && /are blocked/i.test(msg)) return "key-blocked";
  if (st === 400 && /API key not valid/i.test(msg)) return "key-invalid";
  // App Check kam selbst nicht ins Netz: Das ist keine Frage der Einrichtung
  if (/appCheck\/fetch-network-error/i.test(msg) || (e.appCheck && e.appCheck.probeError && /fetch-network-error/.test(String(e.appCheck.probeError.code)))) return "offline";
  if (st === 401 || st === 403 || (e.appCheck && e.appCheck.probeError === e)) {
    const ac = e.appCheck || {};
    if (!ac.mode || ac.mode === "off") return "appcheck-missing";
    if (ac.reason === "SERVICE_DISABLED") return "appcheck-off";
    if (ac.probeError) return ac.mode === "debug" ? "appcheck-debug" : "appcheck-client";
    return "appcheck-rejected";
  }
  if (st === 404) return "no-model";
  if (st === 429) return /per ?day|perday|daily/i.test(msg) ? "quota-day" : /per ?minute|perminute/i.test(msg) ? "quota-minute" : "quota";
  if (st === 413) return "too-large";
  if (st >= 500) return "overloaded";
  if (code === "response-error") return "blocked";
  if (code === "parse-failed") return "bad-json";
  if (navigator.onLine === false) return "offline";
  // Die Anfrage kam gar nicht an (auch: Das Firebase-Modul ließ sich nicht laden)
  if (/failed to fetch|networkerror|load failed|network request failed|dynamically imported module|error loading/i.test(msg)) return "offline";
  return "unknown";
}

// Fehler -> { kind, text, token }. token ist nur gesetzt, wenn der Debug-Token angezeigt werden soll.
export function explain(e) {
  const kind = kindOf(e), ac = (e && e.appCheck) || {};
  const info = { tried: e && e.tried, detail: "" };
  if (kind === "unknown") info.detail = statusOf(e) ? String(statusOf(e)) : clean((e && (e.code || e.message)) || "").slice(0, 80);
  if (kind === "appcheck-client" && ac.probeError) {
    // Der eigentliche Grund steht als "appCheck/…" in der Meldung (die KI-Bibliothek packt ihn in ihren eigenen Fehler)
    const inner = /appCheck\/[a-z-]+/i.exec(String(ac.probeError.message));
    info.detail = inner ? inner[0] : clean(ac.probeError.code || ac.probeError.message).slice(0, 80);
  }
  return { kind, text: (TEXT[kind] || TEXT.unknown)(info), token: kind === "appcheck-debug" ? ac.token || "" : "" };
}

// ---------- Aufruf aus dem Formular ----------

async function readOne(kind, file) {
  const jpegs = await pieces(file, kind === "board" ? BOARD_CUTS : STRIP_CUTS);
  // Beim Scoreboard: die Beispieltafel des Teams als drittes Bild (falls es schon Beispiele gibt)
  let sheet = null;
  if (kind === "board") {
    try { sheet = await refSheet(); } catch (e) { console.warn("Beispieltafel ließ sich nicht bauen:", e.message || e); }
    if (sheet) jpegs.push(sheet);
  }
  const { raw, model, spent } = await ask(kind, jpegs, Boolean(sheet));
  if (kind !== "board") return { data: checkLine(raw), model, spent };
  const data = checkBoard(raw);
  await cutPortraits(file, [...data.players, ...data.opponents]);
  data.sheet = sheet ? sheet.count : 0;
  return { data, model, spent };
}

// Hat ein anderes Modell als das eingestellte geantwortet (weil dessen Tageskontingent aufgebraucht war)?
// Liefert { model, spent: [...] } oder null. Das Formular schreibt es in den Bericht.
function fallbackInfo(model, spent) {
  const main = clean(cfg.aiModel);
  if (!model || model === main) return null;
  const gone = [...new Set([...(spent || []), ...spentModels()])];
  return gone.length ? { model, spent: gone } : null;
}

// Liest die gewählten Bilder aus (eins oder beide, gleichzeitig).
// files = { board: File | null, line: File | null }
// Liefert { board, line, errors: { board, line }, model, fallback, demo }: board und line sind die geprüften Werte oder null,
// fallback ist gesetzt, wenn wegen eines aufgebrauchten Tageskontingents ein Ausweich-Modell geantwortet hat,
// errors enthält pro Bild null oder { kind, text, token }.
export async function scanImages(files) {
  const out = { board: null, line: null, errors: { board: null, line: null }, model: "", fallback: null, demo: Boolean(S.demo) };
  await Promise.all(["board", "line"].map(async (kind) => {
    if (!files[kind]) return;
    try {
      const res = await readOne(kind, files[kind]);
      out[kind] = res.data;
      out.model = res.model || out.model;
      out.fallback = fallbackInfo(res.model, res.spent) || out.fallback;
    } catch (e) {
      if (!e.scan) console.warn("Screenshot-Auslesen fehlgeschlagen:", e.code || "", e.message || e, e.appCheck && e.appCheck.probeError && e.appCheck.probeError !== e ? e.appCheck.probeError : "");
      out.errors[kind] = explain(e);
    }
  }));
  return out;
}
