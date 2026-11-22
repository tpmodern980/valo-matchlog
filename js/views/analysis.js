// Ansicht "Analyse" (#analysis): Pistol-Runden genauer (Seite, Folgerunden, Einfluss aufs Ergebnis),
// alle Kompositionen pro Map, Rollen-Verteilung, Agent-Pool pro Spieler und die Agents der Gegner.
// Die Zahlen kommen aus js/analysis.js. Es gelten die Filter oben (Art, Map, Zeitraum).
import { S } from "../state.js";
import { esc, pct } from "../util.js";
import { filtered } from "../stats.js";
import { pistolStats, compStats, agentPool, foeStats, roleLabel, roleShort } from "../analysis.js";
import { barChart, chartTable } from "../charts.js";
import { filterBar, record, nMatches, tiles, chartPanel, noMatches } from "./parts.js";

const cell = (label, value, cls = "") => `<td data-label="${esc(label)}"${cls ? ` class="${cls}"` : ""}>${value}</td>`;
// "58 % (7 von 12)", ohne Werte "–"
const share = (w, n) => (n ? `${pct(w / n)} <span class="muted">(${w} von ${n})</span>` : "–");
const small = (w, n) => (n ? `${w} von ${n}` : "noch keine Werte");
const agentTags = (agents) => agents.map((a) => `<span class="tag">${esc(a)}</span>`).join("");
// Wenige Matches: Winrate grau, damit 1–0 nicht wie eine sichere Sache aussieht
const wrCell = (t) => cell("Winrate", t.wr === null ? "–" : t.n < 3 ? `<span class="muted" title="Erst ${nMatches(t.n)}: noch wenig aussagekräftig">${pct(t.wr)}</span>` : pct(t.wr), "strong");

function section(title, hint, body) {
  return `<section class="panel"><div class="panel-head"><h2>${esc(title)}</h2>${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</div>${body}</section>`;
}
const table = (cls, head, rows) => `<div class="table-wrap"><table class="rtable ${cls}"><thead><tr>${head.map((h) => {
  const [text, title, l] = Array.isArray(h) ? h : [h];
  return `<th${title ? ` title="${esc(title)}"` : ""}${l ? ' class="l"' : ""}>${esc(text)}</th>`;
}).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`;
const empty = (text) => `<p class="hint pad">${esc(text)}</p>`;

// ---------- Pistols ----------

function pistolPart(list) {
  const p = pistolStats(list);
  const title = '<div class="sec-head an-sec"><h2>Pistol-Runden</h2><span class="hint">Runde 1 und 13</span></div>';
  if (!p.matches) return title + section("Pistols", "", empty("Noch kein Match mit Rundenverlauf. Trag beim Match den Verlauf ein (oder lies die Timeline aus), dann steht hier die Pistol-Analyse."));
  const sideNote = p.noSide ? ` · ${p.noSide} ohne Startseite (zählen nicht bei Angriff/Verteidigung)` : "";
  const cards = tiles([
    ["Pistols gesamt", pct(p.rate), small(p.all.w, p.all.n)],
    ["Pistol im Angriff", pct(p.atkRate), small(p.atk.w, p.atk.n)],
    ["Pistol in Verteidigung", pct(p.defRate), small(p.def.w, p.def.n)],
    ["Runde danach gewonnen", pct(p.convRate), "nach gewonnener Pistol · " + small(p.afterWin.r2w, p.afterWin.r2n)],
    ["Beide Folgerunden", pct(p.bothRate), "nach gewonnener Pistol · " + small(p.afterWin.bothW, p.afterWin.bothN)],
    ["Eco/Force geholt", pct(p.ecoRate), "Runde 2/14 nach verlorener Pistol · " + small(p.afterLoss.r2w, p.afterLoss.r2n)],
    ["Erste volle Runde", pct(p.r3Rate), "Runde 3/15 nach verlorener Pistol · " + small(p.afterLoss.r3w, p.afterLoss.r3n)],
  ]);
  const imp = p.impact.filter((t) => t.n);
  const impact = chartPanel("Pistols und Ergebnis", "Winrate nach Anzahl gewonnener Pistols im Match",
    barChart({
      rows: p.impact.map((t) => ({
        label: `${t.won} von 2 Pistols`, value: t.wr ?? 0, text: t.n ? `${pct(t.wr)} · ${record(t)}` : "kein Match", short: t.n ? pct(t.wr) : "–",
        tip: t.n ? `Bilanz ${record(t)} in ${nMatches(t.n)}` : "Noch kein Match",
      })),
      max: 1, room: 7.5, unit: "Winrate", empty: "Noch kein Match mit beiden Pistols im Verlauf.",
    }),
    chartTable(["Pistols gewonnen", "Matches", "Bilanz", "Winrate"], p.impact.map((t) => [`${t.won} von 2`, t.n, record(t), pct(t.wr)])));
  const maps = section("Pistols pro Map", "Angriff / Verteidigung aus der Startseite",
    table("an-pistol", ["Map", "Pistols", "Angriff", "Verteidigung", ["Runde danach", "Pistol gewonnen → Runde 2/14 auch gewonnen"], ["Eco/Force", "Pistol verloren → Runde 2/14 trotzdem gewonnen"]],
      p.maps.map((mp) => `<tr><td class="name">${esc(mp.name)}</td>
        ${cell("Pistols", share(mp.all.w, mp.all.n), "span2")}${cell("Angriff", share(mp.atk.w, mp.atk.n), "span2")}
        ${cell("Verteidigung", share(mp.def.w, mp.def.n), "span2")}${cell("Runde danach", share(mp.r2w, mp.r2n), "span2")}
        ${cell("Eco/Force", share(mp.lr2w, mp.lr2n), "span2")}</tr>`)));
  return title + `<p class="hint">Aus ${nMatches(p.matches)} mit Rundenverlauf${sideNote}.${imp.length ? "" : " Für „Pistols und Ergebnis“ braucht ein Match beide Pistol-Runden im Verlauf."}</p>`
    + cards + `<div class="chart-grid">${impact}</div>` + maps;
}

// ---------- Comps (unser Team) ----------

function compPart(list) {
  const c = compStats(list);
  const title = '<div class="sec-head an-sec"><h2>Kompositionen</h2><span class="hint">nur Matches mit allen fünf Agents</span></div>';
  if (!c.withComp) return title + section("Kompositionen", "", empty("Noch kein Match mit fünf eingetragenen Agents."));
  const comps = section("Alle Kompositionen", `${c.comps.length} verschiedene · aus ${nMatches(c.withComp)}`,
    table("an-comp", [["Komposition", "", true], "Map", ["Rollen", "Duelist-Initiator-Controller-Sentinel"], "Bilanz", "Winrate"],
      c.comps.map((x) => `<tr><td class="name tags">${agentTags(x.agents)}</td>
        ${cell("Map", esc(x.map))}${cell("Rollen", `<span title="${esc(roleLabel(x.roles))}">${esc(roleShort(x.roles))}</span>`)}
        ${cell("Bilanz", record(x))}${wrCell(x)}</tr>`)));
  const roles = section("Rollen-Verteilung", S.filters.map === "alle" ? "alle Maps · Map oben wählen für eine Map" : S.filters.map,
    table("an-roles", [["Rollen", "", true], "Matches", "Bilanz", "Winrate", ["Maps", "", true]],
      c.roles.map((r) => `<tr><td class="name">${esc(r.label)}</td>
        ${cell("Matches", r.n)}${cell("Bilanz", record(r))}${wrCell(r)}
        ${cell("Maps", r.maps.map((mp) => `<span class="tag" title="Bilanz ${record(mp)}">${esc(mp.name)} ${record(mp)}</span>`).join(""), "l wide tags")}</tr>`)));
  return title + comps + roles;
}

// ---------- Agent-Pool ----------

const STATUS = { stamm: "", sub: "Sub", ex: "nicht mehr im Roster" };

function poolPart(list) {
  const pool = agentPool(list);
  const title = '<div class="sec-head an-sec"><h2>Agent-Pool</h2><span class="hint">wer spielt was, und wie läuft es</span></div>';
  if (!pool.length) return title + section("Agent-Pool", "", empty("Noch keine Agents eingetragen."));
  const rows = pool.map((p) => {
    const agents = p.agents.map((a) => `<span class="tag" title="${esc(a.role || "Rolle unbekannt")} · Bilanz ${record(a)}">${esc(a.name)} ${a.n}× · ${pct(a.wr)}</span>`).join("");
    const roles = p.roles.map((r) => `${esc(r.role === "?" ? "unbekannt" : r.role)} ${pct(r.share)}`).join(" · ");
    const maps = p.maps.map((mp) => `<div class="an-line"><b>${esc(mp.name)}</b> ${mp.agents.map(([a, n]) => esc(a) + (n > 1 ? ` ${n}×` : "")).join(", ")}</div>`).join("");
    return `<tr><td class="name"><a class="plink" href="#player-${esc(encodeURIComponent(p.id))}">${esc(p.name)}</a>${STATUS[p.status] ? ` <span class="tag">${esc(STATUS[p.status])}</span>` : ""}</td>
      ${cell("Matches", p.total)}${cell("Rollen", roles, "l span3 an-wrap")}
      ${cell("Agents", agents, "l wide tags")}${cell("Pro Map", maps, "l wide")}</tr>`;
  });
  return title + section("Agents pro Spieler", "Winrate pro Agent · darunter, wer auf welcher Map was gespielt hat",
    table("an-pool", ["Spieler", "Matches", ["Rollen", "", true], ["Agents", "", true], ["Pro Map", "", true]], rows));
}

// ---------- Gegner ----------

function foePart(list) {
  const f = foeStats(list);
  const title = '<div class="sec-head an-sec"><h2>Gegner-Comps</h2><span class="hint">Bilanz = unsere Bilanz in diesen Matches</span></div>';
  if (!f.withFoes) return title + section("Gegner-Comps", "", empty("Noch kein Match mit Scoreboard der Gegner. Das kommt automatisch, wenn ihr das Scoreboard auslest."));
  const note = `<p class="hint">Aus ${f.withFoes} von ${nMatches(list.length)} mit Scoreboard der Gegner.</p>`;
  const agents = section("Agents der Gegner", "sortiert nach Häufigkeit",
    table("an-foes", [["Agent", "", true], "Rolle", ["Matches", "So oft hatte der Gegner diesen Agent"], "Bilanz", "Winrate"],
      f.agents.map((a) => `<tr><td class="name">${esc(a.name)}</td>
        ${cell("Rolle", esc(a.role || "–"))}${cell("Matches", a.n)}${cell("Bilanz", record(a))}${wrCell(a)}</tr>`)));
  const worst = f.agents.filter((a) => a.n >= 3 && a.wr !== null).sort((a, b) => a.wr - b.wr || b.n - a.n).slice(0, 3);
  const warn = worst.length && worst[0].wr < 0.5
    ? `<p class="hint">Schwer für euch (ab 3 Matches): ${worst.filter((a) => a.wr < 0.5).map((a) => `${esc(a.name)} ${pct(a.wr)}`).join(" · ")}</p>` : "";
  const comps = f.comps.length
    ? section("Kompositionen der Gegner", `${f.comps.length} verschiedene`,
      table("an-comp", [["Komposition", "", true], "Map", ["Rollen", "Duelist-Initiator-Controller-Sentinel"], "Bilanz", "Winrate", ["Gegner", "", true]],
        f.comps.map((x) => `<tr><td class="name tags">${agentTags(x.agents)}</td>
          ${cell("Map", esc(x.map))}${cell("Rollen", `<span title="${esc(roleLabel(x.roles))}">${esc(roleShort(x.roles))}</span>`)}
          ${cell("Bilanz", record(x))}${wrCell(x)}${cell("Gegner", esc(x.teams.join(", ") || "–"), "l wide an-wrap")}</tr>`)))
    : "";
  return title + note + warn + agents + comps;
}

export function analysisView() {
  const head = `<div class="view-head"><div><div class="eyebrow">Statistik</div><h1>Analyse</h1>
    <p>Pistol-Runden im Detail, eure Kompositionen und Rollen, wer welche Agents spielt und gegen welche Agents es schwer wird.</p></div>
    <div class="head-side">${filterBar(true)}</div></div>`;
  if (!S.loaded.matches) return head + '<p class="loading">Lade Matches …</p>';
  const list = filtered();
  if (!list.length) return head + noMatches("Hier stehen dann Pistols, Comps und Agent-Pool.");
  const jump = `<nav class="an-jump" aria-label="Abschnitte">${[["an-pistols", "Pistols"], ["an-comps", "Comps"], ["an-pool", "Agent-Pool"], ["an-foes", "Gegner-Comps"]].map(([id, t]) => `<button type="button" class="btn small ghost" data-action="an-jump" data-to="${id}">${t}</button>`).join("")}</nav>`;
  return head + jump
    + `<div id="an-pistols">${pistolPart(list)}</div>`
    + `<div id="an-comps">${compPart(list)}</div>`
    + `<div id="an-pool">${poolPart(list)}</div>`
    + `<div id="an-foes">${foePart(list)}</div>`;
}

// Sprung zu einem Abschnitt (die Adresse hinter dem # gehört dem Router, deshalb kein Anker-Link)
export const actions = {
  "an-jump": (el) => {
    const to = document.getElementById(el.dataset.to);
    if (to) to.scrollIntoView({ behavior: "smooth", block: "start" });
  },
};
