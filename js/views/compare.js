// Analyse → "Vergleich" (#analysis-compare): zwei Zeiträume nebeneinander, z. B. aktueller Act gegen den davor
// oder die letzten 30 Tage gegen die 30 Tage davor. Art und Map oben gelten, der Zeitraum oben nicht
// (den wählt man hier zweimal). Pfeile: ↑ besser, ↓ schlechter, → kaum Unterschied.
import { S, changed } from "../state.js";
import { esc, pct, signed1, fmt2, daysAgo, num } from "../util.js";
import { filtered, sortMatches, teamSummary, roundInfo, playerStats } from "../stats.js";
import { pistolStats } from "../analysis.js";
import { nMatches, record } from "./parts.js";

const SURE = 3;   // unter so vielen Matches ist ein Zeitraum noch wenig aussagekräftig
const sel = { a: null, b: null };

const seasons = () => (S.team && S.team.seasons) || [];
const inDays = (from, to) => (m) => (m.date || "") >= from && (!to || (m.date || "") < to);

// Alle wählbaren Zeiträume: [Schlüssel, Name, Auswahl aus der Liste]
function periods() {
  const out = [];
  for (const d of [7, 30, 90]) {
    out.push([`d${d}`, `Letzte ${d} Tage`, (l) => l.filter(inDays(daysAgo(d), null))]);
    out.push([`d${d}p`, `${d} Tage davor`, (l) => l.filter(inDays(daysAgo(2 * d), daysAgo(d)))]);
  }
  out.push(["m10", "Letzte 10 Matches", (l) => sortMatches(l).slice(0, 10)]);
  out.push(["m10p", "10 Matches davor", (l) => sortMatches(l).slice(10, 20)]);
  const acts = seasons(), list = [];
  acts.forEach((x, i) => {
    const to = acts[i + 1] ? acts[i + 1].start : null;
    list.push([`act:${x.start}`, i === acts.length - 1 ? `${x.name} (aktuell)` : x.name, (l) => l.filter(inDays(x.start, to))]);
  });
  out.push(...list.reverse());   // neuester Act zuerst
  out.push(["alle", "Gesamt", (l) => l]);
  return out;
}

// Standard: die letzten zwei Acts, sonst 30 Tage gegen die 30 davor
function defaults() {
  const acts = seasons();
  if (acts.length >= 2) return [`act:${acts[acts.length - 1].start}`, `act:${acts[acts.length - 2].start}`];
  return ["d30", "d30p"];
}

// Zahlen eines Zeitraums
function measure(list) {
  const sum = teamSummary(list);
  let rw = 0, rn = 0;
  const side = { atk: { w: 0, n: 0 }, def: { w: 0, n: 0 } };
  for (const m of list) {
    const a = num(m.scoreUs), b = num(m.scoreThem);
    if (a !== null && b !== null && a + b > 0) { rw += a; rn += a + b; }
    const ri = roundInfo(m);
    if (ri) for (const k of ["atk", "def"]) { side[k].w += ri[k].w; side[k].n += ri[k].w + ri[k].l; }
  }
  const ps = pistolStats(list);
  const rate = (t) => (t.n ? t.w / t.n : null);
  return {
    n: list.length, sum,
    wr: sum.wr, diff: sum.diff,
    roundWr: rn ? rw / rn : null,
    atk: rate(side.atk), def: rate(side.def),
    pistol: rate(ps.all), pistolAtk: rate(ps.atk), pistolDef: rate(ps.def),
    after: ps.afterWin.r2n ? ps.afterWin.r2w / ps.afterWin.r2n : null,
    players: playerStats(list),
  };
}

// Pfeil für "A gegenüber B". step: ab welchem Unterschied es als Veränderung zählt.
function delta(a, b, step, show) {
  if (a === null || b === null || a === undefined || b === undefined) return '<span class="muted">–</span>';
  const d = a - b, dir = d >= step ? "up" : d <= -step ? "down" : "flat";
  const arrow = { up: "↑", down: "↓", flat: "→" }[dir];
  return `<span class="form ${dir}">${arrow} ${show(d)}</span>`;
}
const pp = (d) => `${d > 0 ? "+" : d < 0 ? "−" : "±"}${Math.abs(Math.round(d * 100))} Pp.`;
const dec2 = (d) => `${d > 0 ? "+" : d < 0 ? "−" : "±"}${fmt2(Math.abs(d))}`;
const dec1 = (d) => (Math.abs(d) < 0.05 ? "±0" : signed1(d).replace("-", "−"));

const cell = (label, value, cls = "") => `<td data-label="${esc(label)}"${cls ? ` class="${cls}"` : ""}>${value}</td>`;

export function comparePage() {
  const all = filtered({ anyRange: true });
  const opts = periods();
  const [da, db] = defaults();
  if (!opts.some(([k]) => k === sel.a)) sel.a = da;
  if (!opts.some(([k]) => k === sel.b)) sel.b = db;
  const pa = opts.find(([k]) => k === sel.a), pb = opts.find(([k]) => k === sel.b);
  const A = measure(pa[2](all)), B = measure(pb[2](all));
  const la = pa[1], lb = pb[1];

  const o = (cur) => opts.map(([k, t]) => `<option value="${esc(k)}"${k === cur ? " selected" : ""}>${esc(t)}</option>`).join("");
  const pick = `<div class="cmp-pick">
      <label class="field"><span>Zeitraum A</span><select id="cmp-a" data-change="cmp-pick" data-side="a">${o(sel.a)}</select></label>
      <span class="cmp-vs">gegen</span>
      <label class="field"><span>Zeitraum B</span><select id="cmp-b" data-change="cmp-pick" data-side="b">${o(sel.b)}</select></label>
      <button class="btn small" type="button" data-action="cmp-swap" title="A und B tauschen">⇄ Tauschen</button>
    </div>
    ${seasons().length < 2 ? '<p class="hint">Tipp: Legt unter „Team“ die Acts an, dann könnt ihr hier Act gegen Act vergleichen.</p>' : ""}`;

  const thin = (X) => (X.n < SURE ? ` <span class="muted" title="Wenig Matches: noch wenig aussagekräftig">(wenig Daten)</span>` : "");
  const rows = [
    ["Matches", nMatches(A.n) + thin(A), nMatches(B.n) + thin(B), '<span class="muted">–</span>'],
    ["Bilanz", A.n ? record(A.sum) : "–", B.n ? record(B.sum) : "–", '<span class="muted">–</span>'],
    ["Winrate", pct(A.wr), pct(B.wr), delta(A.wr, B.wr, 0.03, pp)],
    ["Ø Rundendiff.", signed1(A.diff), signed1(B.diff), delta(A.diff, B.diff, 0.5, dec1)],
    ["Runden gewonnen", pct(A.roundWr), pct(B.roundWr), delta(A.roundWr, B.roundWr, 0.02, pp)],
    ["Angriff (Runden)", pct(A.atk), pct(B.atk), delta(A.atk, B.atk, 0.03, pp)],
    ["Verteidigung (Runden)", pct(A.def), pct(B.def), delta(A.def, B.def, 0.03, pp)],
    ["Pistols", pct(A.pistol), pct(B.pistol), delta(A.pistol, B.pistol, 0.05, pp)],
    ["Pistols im Angriff", pct(A.pistolAtk), pct(B.pistolAtk), delta(A.pistolAtk, B.pistolAtk, 0.05, pp)],
    ["Pistols in der Verteidigung", pct(A.pistolDef), pct(B.pistolDef), delta(A.pistolDef, B.pistolDef, 0.05, pp)],
    ["Folgerunde nach Pistol-Sieg", pct(A.after), pct(B.after), delta(A.after, B.after, 0.05, pp)],
  ].map(([k, a, b, d]) => `<tr><td class="name l">${esc(k)}</td>${cell(la, a)}${cell(lb, b)}${cell("Veränderung", d, "strong")}</tr>`);
  const head = (first) => `<thead><tr><th class="l">${esc(first)}</th><th>${esc(la)}</th><th>${esc(lb)}</th><th>Veränderung</th></tr></thead>`;
  const team = `<section class="panel"><div class="panel-head"><h2>Team</h2><span class="hint">A gegenüber B · Pp. = Prozentpunkte</span></div>
    <div class="table-wrap"><table class="rtable cmp-table">${head("Kennzahl")}<tbody>${rows.join("")}</tbody></table></div></section>`;

  // Spieler: alle aus dem Roster, die in einem der beiden Zeiträume gespielt haben
  const byId = new Map(B.players.map((p) => [p.id, p]));
  const people = A.players.map((p) => [p, byId.get(p.id)]);
  for (const p of B.players) if (!A.players.some((x) => x.id === p.id)) people.push([null, p]);
  const prow = people
    .filter(([a, b]) => ((a && a.n) || (b && b.n)) && (a || b).status !== "ex")
    .sort(([a1, b1], [a2, b2]) => ((a2 && a2.n) || 0) + ((b2 && b2.n) || 0) - ((a1 && a1.n) || 0) - ((b1 && b1.n) || 0))
    .map(([a, b]) => {
      const p = a || b, kprA = a && a.n ? a.kpr : null, kprB = b && b.n ? b.kpr : null;
      const kdA = a && a.n ? a.kd : null, kdB = b && b.n ? b.kd : null;
      const nA = a ? a.n : 0, nB = b ? b.n : 0;
      const v = (x, n) => (x === null ? "–" : `${fmt2(x)}${n < SURE ? '<span class="muted"> *</span>' : ""}`);
      return `<tr><td class="name l"><a href="#player-${esc(p.id)}">${esc(p.name)}</a><small class="muted"> ${nA} / ${nB}</small></td>
        ${cell("KPR A", v(kprA, nA))}${cell("KPR B", v(kprB, nB))}${cell("KPR ±", delta(kprA, kprB, 0.03, dec2), "strong")}
        ${cell("K/D A", v(kdA, nA))}${cell("K/D B", v(kdB, nB))}${cell("K/D ±", delta(kdA, kdB, 0.08, dec2))}</tr>`;
    });
  const players = `<section class="panel"><div class="panel-head"><h2>Spieler</h2><span class="hint">A = ${esc(la)}, B = ${esc(lb)} · Zahl hinter dem Namen: Matches in A / B · * = unter ${SURE} Matches</span></div>
    ${prow.length ? `<div class="table-wrap"><table class="rtable cmp-table"><thead><tr><th class="l">Spieler</th>
      <th title="Kills pro Runde in A">KPR A</th><th title="Kills pro Runde in B">KPR B</th><th>±</th><th title="K/D in A">K/D A</th><th title="K/D in B">K/D B</th><th>±</th></tr></thead>
      <tbody>${prow.join("")}</tbody></table></div>` : '<p class="hint pad">In diesen Zeiträumen hat noch kein Spieler aus dem Roster gespielt.</p>'}</section>`;

  const none = !A.n && !B.n ? '<div class="empty"><h2>Keine Matches</h2><p>In beiden Zeiträumen gibt es keine Matches (für Art und Map oben). Wähl andere Zeiträume.</p></div>' : "";
  return pick + (none || team + players);
}

export const actions = {
  "cmp-swap": () => { [sel.a, sel.b] = [sel.b, sel.a]; changed(); },
};
export const changes = {
  "cmp-pick": (el) => { sel[el.dataset.side] = el.value; changed(); },
};
