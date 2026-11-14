// Statistik der Spieler: die Tabelle im Spieler-Tab (Stamm, Subs) und die Detailseite #player-<id>.
import { S } from "../state.js";
import { RES_LABEL } from "../constants.js";
import { esc, fmtDate, fmt0, fmt1, fmt2, pct } from "../util.js";
import { filtered, playerStats, rowKey } from "../stats.js";
import { lineChart, barChart, chartTable } from "../charts.js";
import { filterBar, record, nMatches, tiles, chartPanel, noMatches } from "./parts.js";

const BLOCKS = [["stamm", "Stammspieler"], ["sub", "Subs"], ["ex", "Nicht mehr im Roster"]];
const STATUS = { stamm: "Stammspieler", sub: "Sub", ex: "Nicht mehr im Roster" };

// Beste KPR zuerst, Spieler ohne Wert unten
const byKpr = (a, b) => (b.kpr ?? -1) - (a.kpr ?? -1) || b.n - a.n || a.name.localeCompare(b.name, "de");
// K/D/A zusammengezählt. Ein Wert, der in keinem Match eingetragen ist, wird "–" (nicht 0).
const kda = (s) => ["kills", "deaths", "assists"].map((f) => s.series.some((x) => x[f] !== null) ? s[f] : "–").join(" / ");
const link = (s) => `<a class="plink" href="#player-${esc(encodeURIComponent(s.id))}">${esc(s.name)}</a>`;

// ---------- Tabelle im Spieler-Tab ----------

// Am Handy wird aus jeder Zeile eine Karte: Die Beschriftung steht dann über dem Wert (data-label)
const cell = (label, value, cls = "") => `<td data-label="${esc(label)}"${cls ? ` class="${cls}"` : ""}>${value}</td>`;

function statRow(s) {
  const agents = s.agents.slice(0, 3).map((a) => `${esc(a.name)} <span class="muted">${a.n}</span>`).join(" · ") || "–";
  return `<tr><td class="name">${link(s)}</td>
    ${cell("Matches", s.n)}${cell("Win%", pct(s.wr))}${cell("K/D", fmt2(s.kd), "strong")}${cell("KPR", fmt2(s.kpr), "strong")}
    ${cell("K/D/A", s.n ? kda(s) : "–", "span2")}
    ${cell("FB/Match", fmt1(s.fbPer))}${cell("Plants", s.plantsN ? fmt0(s.plants) : "–")}${cell("Defuses", s.defusesN ? fmt0(s.defuses) : "–")}
    ${cell("Agents", agents, "l span3")}</tr>`;
}

// Statistik-Tabelle und KPR-Diagramm für den Spieler-Tab. filterBar muss vorher gelaufen sein.
export function playerTable() {
  if (!S.loaded.matches) return '<p class="loading">Lade Statistik …</p>';
  const list = filtered();
  if (!list.length) return noMatches("Hier steht dann für jeden Spieler K/D, KPR und mehr.");
  const stats = playerStats(list);
  const blocks = BLOCKS.map(([status, title]) => {
    const rows = stats.filter((s) => s.status === status).sort(byKpr);
    if (!rows.length) return "";
    return `<tbody><tr class="grp"><th colspan="10">${title} <span>${rows.length}</span></th></tr>${rows.map(statRow).join("")}</tbody>`;
  }).join("");
  const table = `<section class="panel"><div class="panel-head"><h2>Statistik</h2><span class="hint">${nMatches(list.length)} · Tipp auf einen Namen für die Detailseite</span></div>
    <div class="table-wrap"><table class="rtable pstats">
      <thead><tr><th>Spieler</th><th>Matches</th><th>Win%</th><th>K/D</th><th title="Kills pro Runde">KPR</th><th title="Kills / Deaths / Assists, zusammengezählt">K/D/A</th>
        <th title="First Bloods pro Match">FB/Match</th><th>Plants</th><th>Defuses</th><th class="l">Agents</th></tr></thead>
      ${blocks}</table></div></section>`;

  const ranked = stats.filter((s) => s.kpr !== null).sort(byKpr);
  const chart = chartPanel("KPR pro Spieler", "Kills pro Runde",
    barChart({
      rows: ranked.map((s) => ({ label: s.name, tag: s.status === "sub" ? "Sub" : "", value: s.kpr, text: fmt2(s.kpr), tip: `${s.kprK} Kills in ${s.kprR} Runden` })),
      unit: "KPR", empty: "Noch keine Werte: Für die KPR braucht ein Match den Score und die Kills.",
    }),
    chartTable(["Spieler", "Kills", "Runden", "KPR"], ranked.map((s) => [s.name, s.kprK, s.kprR, fmt2(s.kpr)])));
  return table + chart;
}

// ---------- Detailseite ----------

function historyRow(x) {
  const m = x.m, d = fmtDate(m.date);
  const kda = [x.kills, x.deaths, x.assists].map((v) => v === null ? "–" : v).join('<span class="sep">/</span>');
  const extra = [x.kd !== null ? "K/D " + fmt2(x.kd) : "", x.kpr !== null ? "KPR " + fmt2(x.kpr) : ""].filter(Boolean).join(" · ");
  const score = x.res === "Q" ? "" : ` · <span class="nw">${esc(m.scoreUs)}:${esc(m.scoreThem)}</span>`;
  return `<a class="mrow ${x.res}" href="#match-${esc(m.id)}">
    <div class="mrow-date"><b>${esc(d.day)}</b>${esc(d.wd)}</div>
    <div class="mrow-main"><div class="mrow-map">${esc(m.map || "Map?")}</div>
      <div class="mrow-sub">${x.agent ? `<span class="tag">${esc(x.agent)}</span>` : ""}vs ${esc(m.opponent || "unbekannt")}${score}</div></div>
    <div class="score hstat" title="Kills / Deaths / Assists">${kda}${extra ? `<small>${extra}</small>` : ""}</div>
    <div class="res ${x.res}">${RES_LABEL[x.res]}</div>
  </a>`;
}

export function playerView(id) {
  const back = '<a class="back" href="#players">← Alle Spieler</a>';
  if (!S.loaded.players || !S.loaded.matches) return back + '<p class="loading">Lade Spieler …</p>';
  const p = S.players.find((x) => x.id === id);
  const inMatches = S.matches.some((m) => (m.players || []).some((row) => rowKey(row) === id));
  if (!p && !inMatches) return back + '<div class="empty"><h2>Spieler nicht gefunden</h2><p>Diesen Spieler gibt es nicht (mehr), und er steht in keinem Match.</p></div>';

  const bar = filterBar(true);   // vor filtered(): räumt veraltete Filter weg
  const s = playerStats(filtered()).find((x) => x.id === id)
    // Nicht mehr im Roster und kein Match für diese Filter: leere Zeile mit dem Namen aus den alten Matches
    || { ...playerStats([], [{ id, name: playerStats(S.matches).find((x) => x.id === id).name }])[0], player: null, status: "ex" };

  const roles = p ? [p.role, p.role2].filter(Boolean).map((r) => `<span class="tag">${esc(r)}</span>`).join("") : "";
  const aliases = p && (p.aliases || []).length ? p.aliases.map(esc).join(" · ") : "";
  const head = `<div class="view-head"><div><div class="eyebrow">Spieler · ${STATUS[s.status]}</div><h1>${esc(s.name)}</h1>
      ${roles || aliases ? `<p class="pmeta">${roles}${aliases}</p>` : ""}</div>
    <div class="head-side">${bar}</div></div>`;
  if (!s.n) {
    return back + head + (S.matches.length && !inMatches
      ? `<div class="empty"><h2>Noch kein Match</h2><p>${esc(s.name)} steht noch in keinem Match. Sobald ein Match mit diesem Spieler eingetragen ist, erscheinen hier Kennzahlen und Diagramme.</p></div>`
      : noMatches("Hier stehen dann Kennzahlen und Diagramme."));
  }

  const cards = tiles([
    ["K/D", fmt2(s.kd), s.kdN ? `${s.kdK} Kills : ${s.kdD} Deaths` : "keine Werte eingetragen"],
    ["KPR", fmt2(s.kpr), s.kprR ? `${s.kprK} Kills in ${s.kprR} Runden` : "braucht Score und Kills"],
    ["FB/Match", fmt1(s.fbPer), s.fbN ? `${s.fb} First Bloods` : "keine Werte eingetragen"],
    ["Plants/Match", fmt1(s.plantsPer), s.plantsN ? `${s.plants} Plants` : "keine Werte eingetragen"],
    ["Defuses/Match", fmt1(s.defusesPer), s.defusesN ? `${s.defuses} Defuses` : "keine Werte eingetragen"],
    ["Winrate", pct(s.wr), `${record(s)} in ${nMatches(s.n)}`],
  ]);

  // Diagramme: älteste Matches links. Die Tabellen darunter: neueste oben, wie überall in der App.
  const point = (x, value) => {
    const d = fmtDate(x.m.date), year = d.wd.split(" ")[1] || "";   // das Jahr nur, wenn es nicht das laufende ist
    return { value, text: fmt2(value), title: d.full, sub: `${x.m.map || "Map?"} · vs ${x.m.opponent || "unbekannt"}`, x: d.day + year };
  };
  const where = (x) => [fmtDate(x.m.date).full, x.m.map || "–", x.m.opponent || "–"];
  const kprSeries = s.series.filter((x) => x.kpr !== null), kdSeries = s.series.filter((x) => x.kd !== null);
  const kprChart = chartPanel("KPR pro Match", "Kills pro Runde",
    lineChart({ points: kprSeries.map((x) => point(x, x.kpr)), area: true, unit: "KPR", label: "KPR pro Match", empty: "Noch keine Werte: Für die KPR braucht ein Match den Score und die Kills." }),
    chartTable(["Datum", "Map", "Gegner", "Kills", "Runden", "KPR"], kprSeries.slice().reverse().map((x) => [...where(x), x.kills, x.rounds, fmt2(x.kpr)])));
  const kdChart = chartPanel("K/D pro Match", "Linie bei 1,0: so viele Kills wie Deaths",
    lineChart({ points: kdSeries.map((x) => point(x, x.kd)), ref: 1, unit: "K/D", label: "K/D pro Match", empty: "Noch keine Werte: Für die K/D braucht ein Match Kills und Deaths." }),
    chartTable(["Datum", "Map", "Gegner", "Kills", "Deaths", "K/D"], kdSeries.slice().reverse().map((x) => [...where(x), x.kills, x.deaths, fmt2(x.kd)])));

  const maps = s.maps.filter((mp) => mp.kd !== null).sort((a, b) => b.kd - a.kd || a.name.localeCompare(b.name, "de"));
  const mapChart = chartPanel("K/D nach Map", "Strich bei 1,0",
    barChart({ rows: maps.map((mp) => ({ label: mp.name, value: mp.kd, text: fmt2(mp.kd), tip: `${mp.k} Kills : ${mp.d} Deaths in ${nMatches(mp.kdN)}` })), ref: 1, unit: "K/D", empty: "Noch keine Werte." }),
    chartTable(["Map", "Matches", "Kills", "Deaths", "K/D"], maps.map((mp) => [mp.name, mp.kdN, mp.k, mp.d, fmt2(mp.kd)])));
  const agentChart = chartPanel("Agents", "Anzahl Matches · Winrate",
    barChart({ rows: s.agents.map((a) => ({ label: a.name, value: a.n, text: `${a.n} · ${pct(a.wr)}`, short: String(a.n), tip: `Bilanz ${record(a)}, Winrate ${pct(a.wr)}` })), room: 5.5, unit: "Matches", empty: "Noch kein Agent eingetragen." }),
    chartTable(["Agent", "Matches", "Bilanz", "Winrate"], s.agents.map((a) => [a.name, a.n, record(a), pct(a.wr)])));

  const history = `<section class="sec"><div class="sec-head"><h2>Match-Historie</h2><span class="hint">${nMatches(s.n)}</span></div>
    <div class="match-list">${s.series.slice().reverse().map(historyRow).join("")}</div></section>`;

  return back + head + cards + `<div class="chart-grid">${kprChart}${kdChart}${mapChart}${agentChart}</div>` + history;
}
