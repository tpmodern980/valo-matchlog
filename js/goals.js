// Wochenziele (Wunsch Tim, 22.11.2026): pro Woche ein paar Ziele, die alle im Team anlegen, ändern und abhaken dürfen.
//   - Statistik-Ziele prüft die App selbst aus den Matches der Woche (z. B. "Pistol-Quote mindestens 60 %").
//   - Freie Ziele (z. B. "Retakes auf B üben") werden von Hand abgehakt.
// Angezeigt im Tab "Planung" (js/views/goals.js), in Discord mit dem Wochenplan und im Wochenrückblick (js/discord.js).
//
// Gespeichert in der Sammlung "weeks" (dieselbe Firestore-Regel wie die Planung) als eigenes Dokument pro Woche:
//   weeks/goals-JJJJMMTT = { kind: "goals", week: "JJJJ-MM-TT" (Montag),
//     goals: { <id>: { id, kind: "stat" | "free", metric, op: ">=" | "<=", target, player, map, type, text, done, by, at, deleted } } }
//   (Ziele von vor dem Baukasten haben kein op und keinen player: gelten als "mindestens" fürs ganze Team.)
// Bewusst ohne Feld "start": Das Dokument ist keine Umfrage (weekOf in plan.js sucht nach "start").
// Jedes Ziel ist ein eigener Feldpfad (upsertPath): Zwei gleichzeitig angelegte Ziele überschreiben sich nicht.
import { S } from "./state.js";
import { norm, pct, signed1, num } from "./util.js";
import { result, roundInfo, mapName, rowKey, roundsOf } from "./stats.js";
import { pistolStats } from "./analysis.js";
import { matchesOfWeek } from "./recap.js";

// Statistik-Ziele: alles, was die App aus den eingetragenen Matches messen kann (Wunsch Tim, 22.11.2026: eigene Ziele
// zusammenbauen). Pro Ziel: Kennzahl, "mindestens" oder "höchstens", Wert, optional Spieler, Map und Art.
//   unit: "%" (Ziel 0–100), "num" (Kommazahl), "int" (ganze Zahl)
//   group: Abschnitt in der Auswahl; row: Spieler-Wert (ohne Spieler: das ganze Team zusammen)
//   op: Vorschlag im Formular ("<=" z. B. bei Deaths)
export const METRICS = {
  winrate: { label: "Winrate", unit: "%", group: "Ergebnis", hint: "gewonnene Matches" },
  wins: { label: "Siege", unit: "int", group: "Ergebnis", hint: "Anzahl gewonnener Matches" },
  matches: { label: "Gespielte Matches", unit: "int", group: "Ergebnis", hint: "Anzahl Matches in der Woche" },
  diff: { label: "Ø Rundendifferenz", unit: "num", group: "Ergebnis", hint: "z. B. 3 = im Schnitt 3 Runden mehr als der Gegner" },
  roundsWon: { label: "Gewonnene Runden", unit: "%", group: "Runden und Pistols", hint: "aus dem Endstand" },
  atk: { label: "Runden im Angriff", unit: "%", group: "Runden und Pistols", hint: "braucht Rundenverlauf und Startseite" },
  def: { label: "Runden in der Verteidigung", unit: "%", group: "Runden und Pistols", hint: "braucht Rundenverlauf und Startseite" },
  pistol: { label: "Pistol-Quote", unit: "%", group: "Runden und Pistols", hint: "Runde 1 und 13" },
  pistolAtk: { label: "Pistol im Angriff", unit: "%", group: "Runden und Pistols", hint: "braucht die Startseite" },
  pistolDef: { label: "Pistol in der Verteidigung", unit: "%", group: "Runden und Pistols", hint: "braucht die Startseite" },
  conv: { label: "Runde nach Pistol-Sieg", unit: "%", group: "Runden und Pistols", hint: "Runde 2/14 nach gewonnener Pistol" },
  eco: { label: "Eco/Force nach Pistol-Niederlage", unit: "%", group: "Runden und Pistols", hint: "Runde 2/14 nach verlorener Pistol" },
  r3: { label: "Erste volle Runde nach Pistol-Niederlage", unit: "%", group: "Runden und Pistols", hint: "Runde 3/15" },
  kd: { label: "K/D", unit: "num", group: "Spieler-Werte", row: true, hint: "Kills geteilt durch Deaths" },
  kpr: { label: "KPR (Kills pro Runde)", unit: "num", group: "Spieler-Werte", row: true, hint: "Kills geteilt durch gespielte Runden" },
  kills: { label: "Kills pro Match", unit: "num", group: "Spieler-Werte", row: true, hint: "ohne Spieler: das ganze Team zusammen" },
  deaths: { label: "Deaths pro Match", unit: "num", group: "Spieler-Werte", row: true, op: "<=", hint: "hier meist „höchstens“" },
  assists: { label: "Assists pro Match", unit: "num", group: "Spieler-Werte", row: true, hint: "ohne Spieler: das ganze Team zusammen" },
  firstBloods: { label: "First Bloods pro Match", unit: "num", group: "Spieler-Werte", row: true, hint: "ohne Spieler: das ganze Team zusammen" },
  plants: { label: "Plants pro Match", unit: "num", group: "Spieler-Werte", row: true, hint: "ohne Spieler: das ganze Team zusammen" },
  defuses: { label: "Defuses pro Match", unit: "num", group: "Spieler-Werte", row: true, hint: "ohne Spieler: das ganze Team zusammen" },
  trades: { label: "Trades pro Match", unit: "num", group: "Spieler-Werte", row: true, hint: "nur Premier (nur dort zeigt Valorant Trades)" },
};
export const OPS = { ">=": "mindestens", "<=": "höchstens" };

const compact = (iso) => iso.replace(/-/g, "");
export const goalsDocId = (start) => "goals-" + compact(start);
export const goalsDoc = (start) => S.weeks.find((w) => w.id === goalsDocId(start) && !w.deleted) || null;
// Ziele einer Woche, älteste zuerst, ohne gelöschte
export const goalsOf = (start) => Object.values((goalsDoc(start) || {}).goals || {})
  .filter((g) => g && !g.deleted).sort((a, b) => (a.at || 0) - (b.at || 0));

const de = (n, d = 2) => (Math.round(n * 10 ** d) / 10 ** d).toString().replace(".", ",");
// Zielwert lesbar: "60 %", "1,1", "4"
export function fmtTarget(metric, t) {
  const m = METRICS[metric];
  if (!m) return String(t);
  if (m.unit === "%") return `${de(Number(t), 1)} %`;
  if (metric === "diff") return signed1(Number(t));
  return m.unit === "int" ? String(Math.round(Number(t))) : de(Number(t));
}
const playerName = (id) => { const p = S.players.find((x) => x.id === id); return p ? p.name : "?"; };

// Ein Ziel als Satz: "Zeno: K/D mindestens 1,1 · auf Ascent · nur Premier"
export function goalTitle(g) {
  if (g.kind === "free") return String(g.text || "").trim() || "Ziel";
  const m = METRICS[g.metric];
  if (!m) return "Ziel";
  const op = OPS[g.op] || OPS[">="];
  return [`${g.player ? playerName(g.player) + ": " : ""}${m.label} ${op} ${fmtTarget(g.metric, g.target)}`,
    g.map ? `auf ${g.map}` : "", g.type ? `nur ${g.type}` : ""].filter(Boolean).join(" · ");
}

// Wert eines Statistik-Ziels: { value, text } oder null (keine Daten).
// list = Matches der Woche (schon nach Map und Art gefiltert). player = Spieler-ID oder "" (ganzes Team).
// Mit Spieler zählen nur Matches, in denen er mitgespielt hat (auch bei Winrate, Pistols usw.).
function measure(metric, all, player) {
  const mine = (m) => (m.players || []).filter((r) => { const k = rowKey(r); return k && (!player || k === player); });
  const list = player ? all.filter((m) => mine(m).length) : all;
  const share = (w, n) => (n ? { value: w / n, n, text: `${pct(w / n)} (${w} von ${n})` } : null);
  const nMatch = (n) => `${n} ${n === 1 ? "Match" : "Matches"}`;
  switch (metric) {
    case "winrate": { let w = 0, n = 0; for (const m of list) { const r = result(m); if (r === "Q") continue; n++; if (r === "W") w++; } return share(w, n); }
    case "wins": { const n = list.filter((m) => result(m) === "W").length; return { value: n, text: `${n} ${n === 1 ? "Sieg" : "Siege"}` }; }
    case "matches": return { value: list.length, text: nMatch(list.length) };
    case "diff": {
      const ds = list.filter((m) => result(m) !== "Q").map((m) => Number(m.scoreUs) - Number(m.scoreThem));
      if (!ds.length) return null;
      const avg = ds.reduce((s, x) => s + x, 0) / ds.length;
      return { value: avg, text: `${signed1(avg)} (aus ${nMatch(ds.length)})` };
    }
    case "roundsWon": { let w = 0, n = 0; for (const m of list) { if (result(m) === "Q") continue; w += Number(m.scoreUs); n += Number(m.scoreUs) + Number(m.scoreThem); } return share(w, n); }
    case "atk": case "def": { let w = 0, l = 0; for (const m of list) { const ri = roundInfo(m); if (ri) { w += ri[metric].w; l += ri[metric].l; } } return share(w, w + l); }
    default: break;
  }
  if (!METRICS[metric].row) {
    const p = pistolStats(list);
    if (metric === "pistol") return share(p.all.w, p.all.n);
    if (metric === "pistolAtk") return share(p.atk.w, p.atk.n);
    if (metric === "pistolDef") return share(p.def.w, p.def.n);
    if (metric === "conv") return share(p.afterWin.r2w, p.afterWin.r2n);
    if (metric === "eco") return share(p.afterLoss.r2w, p.afterLoss.r2n);
    if (metric === "r3") return share(p.afterLoss.r3w, p.afterLoss.r3n);
    return null;
  }
  // Spieler-Werte aus den Zeilen unseres Scoreboards
  if (metric === "kd") {
    let k = 0, d = 0, n = 0;
    for (const m of list) for (const r of mine(m)) { const a = num(r.kills), b = num(r.deaths); if (a !== null && b !== null) { k += a; d += b; n++; } }
    return n ? { value: k / Math.max(d, 1), text: `${de(k / Math.max(d, 1))} (${k} Kills : ${d} Deaths)` } : null;
  }
  if (metric === "kpr") {
    let k = 0, rounds = 0;
    for (const m of list) { const rr = roundsOf(m); if (!rr) continue; for (const r of mine(m)) { const a = num(r.kills); if (a !== null) { k += a; rounds += rr; } } }
    return rounds ? { value: k / rounds, text: `${de(k / rounds)} (${k} Kills in ${rounds} Runden${player ? "" : ", alle Spieler zusammen"})` } : null;
  }
  // "pro Match": Summe geteilt durch die Matches, in denen der Wert eingetragen ist (ohne Spieler: Team-Summe pro Match)
  let sum = 0, n = 0;
  for (const m of list) {
    const vals = mine(m).map((r) => num(r[metric])).filter((x) => x !== null);
    if (!vals.length) continue;
    sum += vals.reduce((s, x) => s + x, 0); n++;
  }
  return n ? { value: sum / n, text: `${de(sum / n, 1)} pro Match (${sum} in ${nMatch(n)})` } : null;
}

// Wo steht ein Ziel? { state, label, value, progress (0–1, für den Balken), mark (Zielwert auf dem Balken) }
//   state: "done" (erreicht/abgehakt), "miss" (Woche vorbei, nicht erreicht), "track" (läuft, liegt drüber),
//          "behind" (läuft, liegt drunter), "open" (freies Ziel, noch offen), "nodata" (noch keine Werte)
export function goalStatus(g, start, today) {
  const over = addDaysIso(start, 6) < today;
  if (g.kind === "free") {
    if (g.done) return { state: "done", label: "erledigt", value: null, progress: 1 };
    return over ? { state: "miss", label: "nicht geschafft", value: null, progress: 0 } : { state: "open", label: "offen", value: null, progress: 0 };
  }
  const m = METRICS[g.metric];
  if (!m) return { state: "nodata", label: "unbekanntes Ziel", value: null, progress: 0 };
  const list = matchesOfWeek(start).filter((x) => (!g.map || norm(x.map) === norm(g.map)) && (!g.type || x.type === g.type));
  const v = measure(g.metric, list, g.player || "");
  if (!v) return { state: over ? "miss" : "nodata", label: over ? "keine Daten" : "noch keine Daten", value: null, progress: 0 };
  const goal = m.unit === "%" ? Number(g.target) / 100 : Number(g.target);
  const atMost = g.op === "<=";
  const ok = atMost ? v.value <= goal + 1e-9 : v.value >= goal - 1e-9;
  // Balken: Prozent von 0 bis 100 %, Rundendifferenz von -13 bis +13, sonst bis anderthalbmal Zielwert
  let progress, mark;
  if (m.unit === "%") { progress = v.value; mark = goal; }
  else if (g.metric === "diff") { progress = (v.value + 13) / 26; mark = (goal + 13) / 26; }
  else { const top = Math.max(goal * 1.5, v.value * 1.1, 1); progress = v.value / top; mark = goal / top; }
  const clip = (x) => Math.max(0, Math.min(1, x));
  progress = clip(progress); mark = clip(mark);
  if (over) return { state: ok ? "done" : "miss", label: ok ? "erreicht" : "verfehlt", value: v, progress, mark };
  return { state: ok ? "track" : "behind", label: ok ? "auf Kurs" : atMost ? "noch drüber" : "noch drunter", value: v, progress, mark };
}

// Für Discord: eine Zeile pro Ziel. withState = mit Stand (✅ erreicht/auf Kurs, ❌ verfehlt/noch drunter),
// sonst nur die Ziele (🎯), z. B. zu Beginn der Woche.
export function goalLines(start, withState, today) {
  return goalsOf(start).map((g) => {
    if (!withState) return `🎯 ${goalTitle(g)}`;
    const s = goalStatus(g, start, today);
    const icon = s.state === "done" || s.state === "track" ? "✅" : s.state === "miss" || s.state === "behind" ? "❌" : g.kind === "free" ? "⬜" : "🎯";
    const now = s.value ? ` → ${s.value.text}` : "";
    return `${icon} ${goalTitle(g)}${now} *(${s.label})*`;
  });
}

// Hat die Woche schon angefangen? (Dann geht der Discord-Post mit Stand raus.)
export const weekStarted = (start, today) => start <= today;

// Wie plan.js addDays, hier ohne Import aus einer Ansicht (vermeidet einen Kreis-Import beim Laden)
function addDaysIso(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export const cleanMap = (text) => (text ? mapName(text) : "");

// Ziel-Vorschläge aus euren Schwächen (Wunsch Tim, 22.11.2026): Team-Werte der letzten 30 Tage gegen einen
// üblichen Richtwert. Vorschlag = etwa 10 Prozentpunkte besser als jetzt (auf 5 gerundet), höchstens der Richtwert.
// Nur Werte mit mindestens 4 Fällen, ohne Kennzahlen, für die es in der Woche schon ein Team-Ziel gibt.
const BENCH = { pistolDef: 0.5, pistolAtk: 0.5, conv: 0.75, eco: 0.3, def: 0.5, atk: 0.5, pistol: 0.5, winrate: 0.5, roundsWon: 0.5 };
export function suggestGoals(start, since) {
  const list = S.matches.filter((m) => (m.date || "") >= since);
  const taken = new Set(goalsOf(start).filter((g) => g.kind === "stat" && !g.player && !g.map && !g.type).map((g) => g.metric));
  const out = [];
  for (const [metric, bench] of Object.entries(BENCH)) {
    if (taken.has(metric)) continue;
    const v = measure(metric, list, "");
    if (!v || (v.n ?? 0) < 4 || v.value >= bench) continue;
    const target = Math.min(bench, Math.ceil((v.value + 0.1) * 20) / 20);
    out.push({ metric, now: v.value, target: Math.round(target * 100), gap: (bench - v.value) / bench });
  }
  // Pistol gesamt nur, wenn nicht schon eine Seite vorgeschlagen ist (sonst doppelt)
  const sides = out.some((x) => x.metric === "pistolAtk" || x.metric === "pistolDef");
  return out.filter((x) => !(sides && x.metric === "pistol")).sort((a, b) => b.gap - a.gap).slice(0, 3);
}
