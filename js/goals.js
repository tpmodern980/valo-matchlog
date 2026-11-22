// Wochenziele (Wunsch Tim, 22.11.2026): pro Woche ein paar Ziele, die alle im Team anlegen, ändern und abhaken dürfen.
//   - Statistik-Ziele prüft die App selbst aus den Matches der Woche (z. B. "Pistol-Quote mindestens 60 %").
//   - Freie Ziele (z. B. "Retakes auf B üben") werden von Hand abgehakt.
// Angezeigt im Tab "Planung" (js/views/goals.js), in Discord mit dem Wochenplan und im Wochenrückblick (js/discord.js).
//
// Gespeichert in der Sammlung "weeks" (dieselbe Firestore-Regel wie die Planung) als eigenes Dokument pro Woche:
//   weeks/goals-JJJJMMTT = { kind: "goals", week: "JJJJ-MM-TT" (Montag),
//     goals: { <id>: { id, kind: "stat" | "free", metric, target, map, type, text, done, by, at, deleted } } }
// Bewusst ohne Feld "start": Das Dokument ist keine Umfrage (weekOf in plan.js sucht nach "start").
// Jedes Ziel ist ein eigener Feldpfad (upsertPath): Zwei gleichzeitig angelegte Ziele überschreiben sich nicht.
import { S } from "./state.js";
import { norm, pct, signed1 } from "./util.js";
import { result, roundInfo, mapName } from "./stats.js";
import { pistolStats } from "./analysis.js";
import { matchesOfWeek } from "./recap.js";

// Statistik-Ziele. Alle sind "mindestens": höher ist besser. unit "%" = Ziel in Prozent, "" = Zahl (Rundendifferenz).
export const METRICS = {
  winrate: { label: "Winrate", unit: "%", hint: "gewonnene Matches" },
  pistol: { label: "Pistol-Quote", unit: "%", hint: "Runde 1 und 13" },
  pistolAtk: { label: "Pistol im Angriff", unit: "%", hint: "braucht die Startseite" },
  pistolDef: { label: "Pistol in der Verteidigung", unit: "%", hint: "braucht die Startseite" },
  conv: { label: "Runde nach Pistol-Sieg", unit: "%", hint: "Runde 2/14 nach gewonnener Pistol" },
  eco: { label: "Eco/Force nach Pistol-Niederlage", unit: "%", hint: "Runde 2/14 nach verlorener Pistol" },
  atk: { label: "Runden im Angriff", unit: "%", hint: "braucht die Startseite" },
  def: { label: "Runden in der Verteidigung", unit: "%", hint: "braucht die Startseite" },
  diff: { label: "Ø Rundendifferenz", unit: "", hint: "z. B. +3 = im Schnitt 3 Runden mehr als der Gegner" },
};

const compact = (iso) => iso.replace(/-/g, "");
export const goalsDocId = (start) => "goals-" + compact(start);
export const goalsDoc = (start) => S.weeks.find((w) => w.id === goalsDocId(start) && !w.deleted) || null;
// Ziele einer Woche, älteste zuerst, ohne gelöschte
export const goalsOf = (start) => Object.values((goalsDoc(start) || {}).goals || {})
  .filter((g) => g && !g.deleted).sort((a, b) => (a.at || 0) - (b.at || 0));

// Ein Ziel als Satz: "Pistol-Quote mindestens 60 % · auf Ascent · nur Premier"
export function goalTitle(g) {
  if (g.kind === "free") return String(g.text || "").trim() || "Ziel";
  const m = METRICS[g.metric];
  if (!m) return "Ziel";
  const target = m.unit === "%" ? `${g.target} %` : signed1(Number(g.target));
  return [`${m.label} mindestens ${target}`, g.map ? `auf ${g.map}` : "", g.type ? `nur ${g.type}` : ""].filter(Boolean).join(" · ");
}

// Wert eines Statistik-Ziels aus einer Liste von Matches: { value (0–1 oder Zahl), w, n, text } oder null (keine Daten)
function measure(metric, list) {
  const share = (w, n) => (n ? { value: w / n, w, n, text: `${pct(w / n)} (${w} von ${n})` } : null);
  if (metric === "winrate") {
    let w = 0, n = 0;
    for (const m of list) { const r = result(m); if (r === "Q") continue; n++; if (r === "W") w++; }
    return share(w, n);
  }
  if (metric === "diff") {
    const ds = list.filter((m) => result(m) !== "Q").map((m) => Number(m.scoreUs) - Number(m.scoreThem));
    return ds.length ? { value: ds.reduce((s, x) => s + x, 0) / ds.length, w: null, n: ds.length, text: `${signed1(ds.reduce((s, x) => s + x, 0) / ds.length)} (aus ${ds.length} ${ds.length === 1 ? "Match" : "Matches"})` } : null;
  }
  if (metric === "atk" || metric === "def") {
    let w = 0, l = 0;
    for (const m of list) { const ri = roundInfo(m); if (ri) { w += ri[metric].w; l += ri[metric].l; } }
    return share(w, w + l);
  }
  const p = pistolStats(list);
  if (metric === "pistol") return share(p.all.w, p.all.n);
  if (metric === "pistolAtk") return share(p.atk.w, p.atk.n);
  if (metric === "pistolDef") return share(p.def.w, p.def.n);
  if (metric === "conv") return share(p.afterWin.r2w, p.afterWin.r2n);
  if (metric === "eco") return share(p.afterLoss.r2w, p.afterLoss.r2n);
  return null;
}

// Wo steht ein Ziel? { state, label, value, progress (0–1, für den Balken) }
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
  const v = measure(g.metric, list);
  if (!v) return { state: over ? "miss" : "nodata", label: over ? "keine Daten" : "noch keine Daten", value: null, progress: 0 };
  const goal = m.unit === "%" ? Number(g.target) / 100 : Number(g.target);
  const ok = v.value >= goal - 1e-9;
  // Balken: bei Prozent der Wert selbst (Ziel als Strich), bei der Rundendifferenz -13 … +13
  const progress = m.unit === "%" ? v.value : Math.max(0, Math.min(1, (v.value + 13) / 26));
  const mark = m.unit === "%" ? goal : Math.max(0, Math.min(1, (goal + 13) / 26));
  if (over) return { state: ok ? "done" : "miss", label: ok ? "erreicht" : "verfehlt", value: v, progress, mark };
  return { state: ok ? "track" : "behind", label: ok ? "auf Kurs" : "noch drunter", value: v, progress, mark };
}

// Für Discord: eine Zeile pro Ziel. withState = mit ✅/❌ (Rückblick), sonst 🎯 (Wochenplan).
export function goalLines(start, withState, today) {
  return goalsOf(start).map((g) => {
    if (!withState) return `🎯 ${goalTitle(g)}`;
    const s = goalStatus(g, start, today);
    const icon = s.state === "done" || s.state === "track" ? "✅" : s.state === "miss" || s.state === "behind" ? "❌" : "▫️";
    return `${icon} ${goalTitle(g)}${s.value ? ` → ${s.value.text}` : g.kind === "free" ? "" : " → keine Daten"}`;
  });
}

// Wie plan.js addDays, hier ohne Import aus einer Ansicht (vermeidet einen Kreis-Import beim Laden)
function addDaysIso(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

export const cleanMap = (text) => (text ? mapName(text) : "");
