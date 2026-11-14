// Ansichten "Gegner" (Liste) und "Gegner-Detail" (#opponent-<name>): Bilanz pro Gegner und alle Matches gegen ihn.
import { S } from "../state.js";
import { esc, fmtDate, pct, signed1 } from "../util.js";
import { filtered, opponentStats, oppKey } from "../stats.js";
import { filterBar, record, nMatches, tiles, matchRow, noMatches } from "./parts.js";

// Die Adresse trägt den Namen in der jüngsten Schreibweise; verglichen wird ohne Groß/Klein und Leerzeichen
const href = (s) => "#opponent-" + encodeURIComponent(s.key === "-" ? "-" : s.name);
const cell = (label, value, cls = "") => `<td data-label="${esc(label)}"${cls ? ` class="${cls}"` : ""}>${value}</td>`;
const mapTags = (s) => s.maps.map((mp) => `<span class="tag" title="Bilanz ${record(mp)}">${esc(mp.name)}${mp.n > 1 ? " " + mp.n + "×" : ""}</span>`).join("");

// "Mi, 12.11." und das Jahr nur, wenn es nicht das laufende ist
function lastDate(s) {
  const d = fmtDate(s.last.date), [wd, year] = d.wd.split(" ");
  return wd ? `${wd}, ${d.day}${year ? " " + year : ""}` : d.day;
}

function row(s) {
  return `<tr><td class="name"><a class="plink" href="${esc(href(s))}">${esc(s.name)}</a></td>
    ${cell("Bilanz", record(s), "strong")}${cell("Winrate", pct(s.wr))}${cell("Ø Diff.", signed1(s.diff))}${cell("Matches", s.n)}
    ${cell("Letzte Begegnung", esc(lastDate(s)), "span2")}
    ${cell("Maps", mapTags(s), "l wide tags")}</tr>`;
}

export function opponentsView() {
  const head = `<div class="view-head"><div><div class="eyebrow">Statistik</div><h1>Gegner</h1>
    <p>Gegen wen läuft es gut, gegen wen nicht? Tipp auf einen Gegner für alle Matches gegen ihn.</p></div>
    <div class="head-side">${filterBar(true)}</div></div>`;
  if (!S.loaded.matches) return head + '<p class="loading">Lade Matches …</p>';
  const list = filtered();
  if (!list.length) return head + noMatches("Hier steht dann die Bilanz gegen jeden Gegner.");
  const stats = opponentStats(list);
  return head + `<section class="panel"><div class="panel-head"><h2>Alle Gegner</h2><span class="hint">${stats.length} Gegner · ${nMatches(list.length)}</span></div>
    <div class="table-wrap"><table class="rtable ostats">
      <thead><tr><th>Gegner</th><th>Bilanz</th><th>Winrate</th><th title="Durchschnittliche Rundendifferenz pro Match">Ø Rundendiff.</th><th>Matches</th><th>Letzte Begegnung</th><th class="l">Maps</th></tr></thead>
      <tbody>${stats.map(row).join("")}</tbody></table></div></section>`;
}

export function opponentView(name) {
  const back = '<a class="back" href="#opponents">← Alle Gegner</a>';
  if (!S.loaded.matches) return back + '<p class="loading">Lade Matches …</p>';
  const key = oppKey(name);
  // Name aus allen Matches (auch wenn die Filter gerade keines übrig lassen)
  const known = opponentStats(S.matches).find((x) => x.key === key);
  if (!known) return back + '<div class="empty"><h2>Gegner nicht gefunden</h2><p>Gegen diesen Gegner ist kein Match eingetragen.</p></div>';

  const bar = filterBar(true);   // vor filtered(): räumt veraltete Filter weg
  const head = `<div class="view-head"><div><div class="eyebrow">Gegner</div><h1>${esc(known.name)}</h1></div>
    <div class="head-side">${bar}</div></div>`;
  const s = opponentStats(filtered()).find((x) => x.key === key);
  if (!s) return back + head + noMatches("");

  const cards = tiles([
    ["Bilanz", record(s), nMatches(s.n)],
    ["Winrate", pct(s.wr), "gewertete Matches"],
    ["Ø Rundendiff.", signed1(s.diff), "pro Match"],
    ["Letzte Begegnung", fmtDate(s.last.date).day, [fmtDate(s.last.date).wd, s.lastMap].filter(Boolean).join(" · ")],
  ]);
  const maps = `<section class="panel"><div class="panel-head"><h2>Gespielte Maps</h2></div>
    <div class="table-wrap"><table><thead><tr><th>Map</th><th>Matches</th><th>Bilanz</th><th>Winrate</th></tr></thead>
    <tbody>${s.maps.map((mp) => `<tr><td class="name">${esc(mp.name)}</td><td>${mp.n}</td><td>${record(mp)}</td><td>${pct(mp.wr)}</td></tr>`).join("")}</tbody></table></div></section>`;
  const matches = `<section class="sec"><div class="sec-head"><h2>Matches gegen ${esc(s.name)}</h2><span class="hint">${nMatches(s.n)}</span></div>
    <div class="match-list">${s.matches.map(matchRow).join("")}</div></section>`;
  return back + head + cards + maps + matches;
}
