// Ansicht "Analyse" (#analysis, Unterseiten #analysis-pistols, #analysis-comps, #analysis-foes).
// Überblick: die wichtigsten Erkenntnisse in ein paar Sätzen. Pistols: Seite, Folgerunden, Einfluss aufs Ergebnis.
// Comps: die meistgespielten Kompositionen pro Map und die Rollen-Verteilung. Gegner: Agents und Comps der Gegner.
// Der Agent-Pool steht auf der Detailseite jedes Spielers (js/views/player.js).
// Die Zahlen kommen aus js/analysis.js. Es gelten die Filter oben (Art, Map, Zeitraum).
import { S, changed } from "../state.js";
import { esc, pct } from "../util.js";
import { filtered } from "../stats.js";
import { pistolStats, compStats, foeStats, roleLabel } from "../analysis.js";
import { AGENT_ROLE_LIST } from "../constants.js";
import { barChart, chartTable } from "../charts.js";
import { filterBar, nMatches, tiles, chartPanel, noMatches } from "./parts.js";

const SUBS = [["", "Überblick"], ["pistols", "Pistols"], ["comps", "Comps"], ["foes", "Gegner"]];
const TOP = 3;              // so viele Comps pro Map, bevor "Alle anzeigen" kommt
const SURE = 3;             // ab so vielen Matches gilt ein Wert als einigermaßen aussagekräftig
const view = { allComps: false, singles: false, allFoeComps: false };

const cell = (label, value, cls = "") => `<td data-label="${esc(label)}"${cls ? ` class="${cls}"` : ""}>${value}</td>`;
// "58 % (7 von 12)", ohne Werte "–"
const share = (w, n) => (n ? `${pct(w / n)} <span class="muted">(${w} von ${n})</span>` : "–");
const small = (w, n) => (n ? `${w} von ${n}` : "noch keine Werte");
const agentTags = (agents) => agents.map((a) => `<span class="tag">${esc(a)}</span>`).join("");
// "3 Siege, 1 Niederlage" statt "3–1": eindeutig, auch ohne Spaltentitel
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const wins = (t) => [t.w ? plural(t.w, "Sieg", "Siege") : "", t.l ? plural(t.l, "Niederlage", "Niederlagen") : "", t.d ? plural(t.d, "Unentschieden", "Unentschieden") : ""]
  .filter(Boolean).join(", ") || "noch kein Ergebnis";
// Wenige Matches: Winrate grau, damit 1–0 nicht wie eine sichere Sache aussieht
const wrCell = (t) => cell("Winrate", t.wr === null ? "–" : t.n < SURE ? `<span class="muted" title="Erst ${nMatches(t.n)}: noch wenig aussagekräftig">${pct(t.wr)}</span>` : pct(t.wr), "strong");
const subLink = (sub) => "#analysis" + (sub ? "-" + sub : "");

function section(title, hint, body) {
  return `<section class="panel"><div class="panel-head"><h2>${esc(title)}</h2>${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</div>${body}</section>`;
}
const table = (cls, head, rows) => `<div class="table-wrap"><table class="rtable ${cls}"><thead><tr>${head.map((h) => {
  const [text, title, l] = Array.isArray(h) ? h : [h];
  return `<th${title ? ` title="${esc(title)}"` : ""}${l ? ' class="l"' : ""}>${esc(text)}</th>`;
}).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
const empty = (text) => `<p class="hint pad">${esc(text)}</p>`;

// ---------- Überblick ----------

// Ein paar Sätze aus den Zahlen. Jeder Satz nur, wenn genug Matches dahinterstehen.
function insights(list) {
  const p = pistolStats(list), c = compStats(list), f = foeStats(list), out = [];
  const add = (tone, title, text, sub) => out.push({ tone, title, text, sub });

  if (p.all.n >= 4) {
    if (p.atk.n >= SURE && p.def.n >= SURE && Math.abs(p.atkRate - p.defRate) >= 0.15) {
      const atkWeak = p.atkRate < p.defRate;
      const [weakName, weak, weakRate, strongName, strongRate] = atkWeak
        ? ["im Angriff", p.atk, p.atkRate, "in der Verteidigung", p.defRate]
        : ["in der Verteidigung", p.def, p.defRate, "im Angriff", p.atkRate];
      add("bad", `Pistol ${weakName} schwächer`, `Nur ${pct(weakRate)} gewonnen (${weak.w} von ${weak.n}), ${strongName} ${pct(strongRate)}.`, "pistols");
    } else {
      add(p.rate >= 0.5 ? "good" : "bad", `Pistols: ${pct(p.rate)} gewonnen`, `${p.all.w} von ${p.all.n} Pistol-Runden.`, "pistols");
    }
  }
  if (p.afterWin.r2n >= SURE) {
    add(p.convRate >= 0.7 ? "good" : "bad", `Runde nach Pistol-Sieg: ${pct(p.convRate)}`,
      p.convRate >= 0.7 ? `Nach einer gewonnenen Pistol holt ihr meistens auch die nächste Runde (${p.afterWin.r2w} von ${p.afterWin.r2n}).`
        : `Nach einer gewonnenen Pistol geht die nächste Runde oft verloren (nur ${p.afterWin.r2w} von ${p.afterWin.r2n} gewonnen). Üblich sind eher 70–80 %.`, "pistols");
  }
  if (p.afterLoss.r2n >= SURE && p.ecoRate !== null && p.ecoRate >= 0.4) {
    add("good", `Eco/Force nach Pistol-Niederlage: ${pct(p.ecoRate)}`, `Nach einer verlorenen Pistol holt ihr Runde 2 trotzdem oft (${p.afterLoss.r2w} von ${p.afterLoss.r2n}).`, "pistols");
  }
  const both = p.impact[2], none = p.impact[0];
  if (both.n >= 2 && none.n >= 2) {
    add("info", "Pistols entscheiden mit", `Beide Pistols gewonnen: ${pct(both.wr)} der Matches gewonnen. Keine gewonnen: ${pct(none.wr)}.`, "pistols");
  }
  // Beste Comp pro Map (ab 2 Matches), höchstens drei Maps: die mit den meisten Matches
  const best = new Map();
  for (const x of c.comps) {
    if (x.n < 2 || x.wr === null) continue;
    const cur = best.get(x.map);
    if (!cur || x.wr > cur.wr || (x.wr === cur.wr && x.n > cur.n)) best.set(x.map, x);
  }
  for (const x of [...best.values()].sort((a, b) => b.n - a.n).slice(0, 3)) {
    add(x.wr >= 0.5 ? "good" : "bad", `Beste Comp auf ${x.map}`, `${x.agents.join(", ")}: ${wins(x)} (${pct(x.wr)}).`, "comps");
  }
  const hard = f.agents.filter((a) => a.n >= SURE && a.wr !== null && a.wr < 0.5).sort((a, b) => a.wr - b.wr || b.n - a.n)[0];
  if (hard) add("bad", `Schwer gegen ${hard.name}`, `Wenn der Gegner ${hard.name} hatte: ${wins(hard)} (${pct(hard.wr)}).`, "foes");
  return out;
}

function overview(list) {
  const items = insights(list);
  const cards = items.length
    ? `<div class="an-cards">${items.map((x) => `<a class="an-card ${x.tone}" href="${subLink(x.sub)}"><b>${esc(x.title)}</b><span>${esc(x.text)}</span><small>Details →</small></a>`).join("")}</div>`
    : '<div class="empty"><h2>Noch zu wenig Daten</h2><p>Für Erkenntnisse braucht es ein paar Matches mit Rundenverlauf und Agents. Die einzelnen Zahlen stehen trotzdem schon unter Pistols, Comps und Gegner.</p></div>';
  return cards + '<p class="hint">Grün = läuft gut, Rot = da ist Luft nach oben. Ein Satz erscheint erst, wenn genug Matches dahinterstehen.</p>';
}

// ---------- Pistols ----------

function pistolPage(list) {
  const p = pistolStats(list);
  if (!p.matches) return section("Pistols", "", empty("Noch kein Match mit Rundenverlauf. Trag beim Match die Runden ein (bei alten Matches reichen die Pistols 1 und 13 mit ihren Folgerunden), dann steht hier die Pistol-Analyse."));
  const sideNote = p.noSide ? ` ${p.noSide} davon ohne Startseite: Die zählen nicht bei Angriff/Verteidigung.` : "";
  const sides = tiles([
    ["Pistols gesamt", pct(p.rate), small(p.all.w, p.all.n)],
    ["Im Angriff", pct(p.atkRate), small(p.atk.w, p.atk.n)],
    ["In der Verteidigung", pct(p.defRate), small(p.def.w, p.def.n)],
  ]);
  const follow = tiles([
    ["Runde danach gewonnen", pct(p.convRate), "nach Pistol-Sieg · " + small(p.afterWin.r2w, p.afterWin.r2n)],
    ["Beide Folgerunden", pct(p.bothRate), "nach Pistol-Sieg · " + small(p.afterWin.bothW, p.afterWin.bothN)],
    ["Eco/Force geholt", pct(p.ecoRate), "nach Pistol-Niederlage · " + small(p.afterLoss.r2w, p.afterLoss.r2n)],
    ["Erste volle Runde", pct(p.r3Rate), "nach Pistol-Niederlage · " + small(p.afterLoss.r3w, p.afterLoss.r3n)],
  ]);
  const label = ["Keine", "Eine", "Beide"];
  const impact = chartPanel("Gewonnene Pistols und Ergebnis", "Wie viele Matches ihr gewinnt, je nachdem wie viele der zwei Pistols ihr holt (alle Matches mit beiden Pistols im Verlauf)",
    barChart({
      rows: p.impact.map((t) => ({
        label: label[t.won], value: t.wr ?? 0,
        text: t.n ? `${pct(t.wr)} · ${t.w} von ${t.n} Matches` : "noch kein Match", short: t.n ? pct(t.wr) : "–",
        tip: t.n ? wins(t) : "Noch kein Match",
      })),
      max: 1, room: 11, unit: "Winrate", empty: "Noch kein Match mit beiden Pistols im Verlauf.",
    }),
    chartTable(["Pistols gewonnen", "Matches", "Ergebnis", "Winrate"], p.impact.map((t) => [label[t.won], t.n, wins(t), pct(t.wr)])));
  const maps = section("Pro Map", "Prozent gewonnen (gewonnen von gespielt)",
    table("an-pistol", ["Map", "Pistols", "Angriff", "Verteidigung", ["Runde danach", "Pistol gewonnen → Runde 2/14 auch gewonnen"], ["Eco/Force", "Pistol verloren → Runde 2/14 trotzdem gewonnen"]],
      p.maps.map((mp) => `<tr><td class="name">${esc(mp.name)}</td>
        ${cell("Pistols", share(mp.all.w, mp.all.n), "span2")}${cell("Angriff", share(mp.atk.w, mp.atk.n), "span2")}
        ${cell("Verteidigung", share(mp.def.w, mp.def.n), "span2")}${cell("Runde danach", share(mp.r2w, mp.r2n), "span2")}
        ${cell("Eco/Force", share(mp.lr2w, mp.lr2n), "span2")}</tr>`)));
  return `<p class="hint">Aus ${nMatches(p.matches)} mit Rundenverlauf.${sideNote}</p>`
    + '<h3 class="an-h">Pistol-Runden (1 und 13)</h3>' + sides
    + '<h3 class="an-h">Nach der Pistol</h3>' + follow
    + impact + maps;
}

// ---------- Comps ----------

function compPage(list) {
  const c = compStats(list);
  if (!c.withComp) return section("Comps", "", empty("Noch kein Match mit fünf eingetragenen Agents."));
  // Einmal gespielte Comps erst auf Wunsch. Gibt es noch gar keine Comp mit 2 Matches, stehen alle da.
  const repeated = c.comps.filter((x) => x.n >= 2).length;
  const singles = view.singles || !repeated;
  const shown = c.comps.filter((x) => singles || x.n >= 2);
  const hidden = repeated ? c.comps.length - repeated : 0;
  // Pro Map: die meistgespielten zuerst, die Maps nach Anzahl Matches
  const byMap = new Map();
  for (const x of shown) { if (!byMap.has(x.map)) byMap.set(x.map, []); byMap.get(x.map).push(x); }
  const total = (arr) => arr.reduce((s, x) => s + x.n, 0);
  const maps = [...byMap.entries()].sort((a, b) => total(b[1]) - total(a[1]) || a[0].localeCompare(b[0], "de"));
  let cut = 0;
  const blocks = maps.map(([map, comps]) => {
    const rows = view.allComps ? comps : comps.slice(0, TOP);
    cut += comps.length - rows.length;
    return `<tbody><tr class="grp"><th colspan="4">${esc(map)} <span>${nMatches(total(comps))}</span></th></tr>${rows.map((x) => `<tr><td class="name tags">${agentTags(x.agents)}</td>
      ${cell("Rollen", esc(roleLabel(x.roles)), "l span2 an-wrap")}${cell("Ergebnis", esc(wins(x)), "an-wrap")}${wrCell(x)}</tr>`).join("")}</tbody>`;
  }).join("");
  const toggles = [
    cut || view.allComps ? `<button type="button" class="btn small ghost" data-action="an-toggle" data-key="allComps">${view.allComps ? `Nur Top ${TOP} pro Map` : `Alle anzeigen (${cut} mehr)`}</button>` : "",
    hidden ? `<button type="button" class="btn small ghost" data-action="an-toggle" data-key="singles">${view.singles ? "Einmal gespielte ausblenden" : `Einmal gespielte zeigen (${hidden})`}</button>` : "",
  ].filter(Boolean).join("");
  const compTable = section("Kompositionen pro Map", singles ? "meistgespielte zuerst" : "meistgespielte zuerst · nur ab 2 Matches",
    (blocks
      ? `<div class="table-wrap"><table class="rtable an-comp"><thead><tr><th class="l">Komposition</th><th class="l">Rollen</th><th>Ergebnis</th><th>Winrate</th></tr></thead>${blocks}</table></div>`
      : empty("Noch keine Komposition, die mindestens zweimal gespielt wurde."))
    + (toggles ? `<div class="an-more">${toggles}</div>` : ""));
  const roles = section("Rollen-Verteilung", S.filters.map === "alle" ? "alle Maps · oben eine Map wählen für eine einzelne Map" : S.filters.map,
    table("an-roles", [["Rollen", "", true], "Ergebnis", "Winrate", ["Maps (gewonnen/gespielt)", "", true]],
      c.roles.map((r) => `<tr><td class="name">${esc(r.label)}</td>
        ${cell("Ergebnis", esc(wins(r)), "span2 an-wrap")}${wrCell(r)}
        ${cell("Maps (gewonnen/gespielt)", r.maps.map((mp) => `<span class="tag" title="${esc(wins(mp))}">${esc(mp.name)} ${mp.w}/${mp.n}</span>`).join(""), "l wide tags")}</tr>`)));
  return `<p class="hint">Aus ${nMatches(c.withComp)} mit allen fünf Agents.</p>` + compTable + roles;
}

// ---------- Gegner ----------

// Farbe nach eurer Winrate: grün ab 50 %, rot darunter, grau bei weniger als SURE Matches
const tone = (t) => (t.wr === null || t.n < SURE ? "few" : t.wr >= 0.5 ? "good" : "bad");

function foePage(list) {
  const f = foeStats(list);
  if (!f.withFoes) return section("Gegner", "", empty("Noch kein Match mit Scoreboard der Gegner. Das kommt automatisch dazu, wenn ihr das Scoreboard auslest."));
  const note = `<p class="hint">Aus ${f.withFoes} von ${nMatches(list.length)} mit Scoreboard der Gegner. Die Prozente sind immer eure Winrate in den Matches, in denen der Gegner das hatte.</p>`;

  // Agents: kompakte Kacheln, nach Rolle gruppiert. "4× · 75 %" = in 4 Matches gesehen, davon 75 % gewonnen.
  const chip = (a) => `<span class="an-chip ${tone(a)}" title="${esc(wins(a))}"><b>${esc(a.name)}</b><small>${a.n}× · ${pct(a.wr)}</small></span>`;
  const groups = [...AGENT_ROLE_LIST, null].map((role) => {
    const list2 = f.agents.filter((a) => (a.role || null) === role);
    return list2.length ? `<div class="an-group"><h4>${esc(role || "Ohne Rolle")}</h4><div class="an-chips">${list2.map(chip).join("")}</div></div>` : "";
  }).join("");
  const hard = f.agents.filter((a) => a.n >= SURE && a.wr !== null && a.wr < 0.5).sort((a, b) => a.wr - b.wr || b.n - a.n);
  const hardLine = hard.length ? `<p class="an-warn">Schwer für euch: ${hard.slice(0, 3).map((a) => `<b>${esc(a.name)}</b> ${pct(a.wr)}`).join(" · ")}</p>` : "";
  const agents = section("Agents der Gegner", "Rot = ihr verliert meistens, Grau = erst wenige Matches",
    `<div class="panel-body">${hardLine}<div class="an-groups">${groups}</div></div>`);

  // Comps: dieselbe Comp auf mehreren Maps nur einmal, die häufigsten zuerst
  const rows = view.allFoeComps ? f.comps : f.comps.slice(0, 5);
  const comps = f.comps.length
    ? section("Comps der Gegner", f.comps.length === 1 ? "1 Comp" : `${f.comps.length} verschiedene · häufigste zuerst`,
      `<div class="an-list">${rows.map((x) => `<div class="an-item"><div class="an-item-main">${agentTags(x.agents)}</div>
        <div class="an-item-sub">${esc(x.maps.join(", "))}${x.teams.length ? ` · ${esc(x.teams.join(", "))}` : ""}</div>
        <div class="an-item-res ${tone(x)}"><b>${pct(x.wr)}</b><small>${esc(wins(x))}</small></div></div>`).join("")}</div>`
      + (f.comps.length > 5 ? `<div class="an-more"><button type="button" class="btn small ghost" data-action="an-toggle" data-key="allFoeComps">${view.allFoeComps ? "Nur die 5 häufigsten" : `Alle ${f.comps.length} anzeigen`}</button></div>` : ""))
    : "";
  return note + agents + comps;
}

export function analysisView(sub = "") {
  const cur = SUBS.some(([k]) => k === sub) ? sub : "";
  const head = `<div class="view-head"><div><div class="eyebrow">Statistik</div><h1>Analyse</h1>
    <p>Pistol-Runden, eure Kompositionen und gegen welche Agents es schwer wird. Den Agent-Pool jedes Spielers findest du auf seiner Spieler-Seite.</p></div>
    <div class="head-side">${filterBar(true)}</div></div>`;
  const nav = `<nav class="seg an-subs" aria-label="Analyse">${SUBS.map(([k, t]) => `<a href="${subLink(k)}"${k === cur ? ' aria-current="page"' : ""}>${t}</a>`).join("")}</nav>`;
  if (!S.loaded.matches) return head + nav + '<p class="loading">Lade Matches …</p>';
  const list = filtered();
  if (!list.length) return head + nav + noMatches("Hier stehen dann Pistols, Comps und die Agents der Gegner.");
  const body = cur === "pistols" ? pistolPage(list) : cur === "comps" ? compPage(list) : cur === "foes" ? foePage(list) : overview(list);
  return head + nav + body;
}

export const actions = {
  "an-toggle": (el) => { view[el.dataset.key] = !view[el.dataset.key]; changed(); },
};
