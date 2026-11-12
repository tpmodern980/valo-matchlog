// Ansicht "Matches": Bilanz-Leiste und Liste aller Matches (neueste zuerst).
import { S } from "../state.js";
import { RES_LABEL, RES_SHORT } from "../constants.js";
import { esc, fmtDate, pct, signed1 } from "../util.js";
import { filtered, sortMatches, teamSummary, result } from "../stats.js";
import { filterBar } from "./parts.js";

export function matchesView() {
  // Kopf zuerst: filterBar räumt veraltete Filter weg, bevor gefiltert wird
  const head = `<div class="view-head"><div><div class="eyebrow">Team-Bilanz</div><h1>Matches</h1>
    <p>Alle Scrims und Matches eures Teams. Tipp auf ein Match für Scoreboard, Rundenverlauf, Notizen und Clips.</p></div>${filterBar(true)}</div>`;
  const list = sortMatches(filtered());
  const sum = teamSummary(list);
  const last5 = sortMatches(S.matches).slice(0, 5).reverse();
  if (!S.loaded.matches) return head + '<p class="loading">Lade Matches …</p>';

  if (!S.matches.length) {
    return head + `<div class="empty"><h2>Noch keine Matches</h2>
      <p>Hier landen eure Scrims, Liga-Spiele und Turniere. Tragt das erste Match ein: von Hand oder aus einem Scoreboard-Screenshot.</p></div>`;
  }

  const dots = last5.map((m) => {
    const r = result(m);
    return `<span class="dot ${r}" title="${esc((m.map || "") + " " + (m.scoreUs ?? "?") + ":" + (m.scoreThem ?? "?"))}">${RES_SHORT[r]}</span>`;
  }).join("");
  const summary = `<div class="summary">
    <div class="stat"><span>Bilanz</span><b>${sum.w}–${sum.l}${sum.d ? "–" + sum.d : ""}</b><small>${sum.total} ${sum.total === 1 ? "Match" : "Matches"}</small></div>
    <div class="stat"><span>Winrate</span><b>${pct(sum.wr)}</b><small>gewertete Matches</small></div>
    <div class="stat"><span>Ø Rundendiff.</span><b>${signed1(sum.diff)}</b><small>pro Match</small></div>
    ${sum.pistolN ? `<div class="stat"><span>Pistols</span><b>${pct(sum.pistolWr)}</b><small>${sum.pistolW} von ${sum.pistolN} gewonnen</small></div>` : ""}
    <div class="stat"><span>Letzte 5</span><div class="form-dots">${dots}</div></div>
  </div>`;

  const rows = list.map((m) => {
    const r = result(m), d = fmtDate(m.date);
    const clipN = S.clips.filter((c) => c.matchId === m.id).length;
    return `<a class="mrow ${r}" href="#match-${esc(m.id)}">
      <div class="mrow-date"><b>${esc(d.day)}</b>${esc(d.wd)}</div>
      <div class="mrow-main"><div class="mrow-map">${esc(m.map || "Map?")}</div>
        <div class="mrow-sub"><span class="tag">${esc(m.type || "Match")}</span>vs ${esc(m.opponent || "unbekannt")}${clipN ? ` · ${clipN} ${clipN === 1 ? "Clip" : "Clips"}` : ""}</div></div>
      <div class="score">${esc(m.scoreUs ?? "?")}<span class="sep">:</span>${esc(m.scoreThem ?? "?")}</div>
      <div class="res ${r}">${RES_LABEL[r]}</div>
    </a>`;
  }).join("");

  return head + summary + (list.length
    ? `<div class="match-list">${rows}</div>`
    : '<div class="empty"><h2>Keine Treffer</h2><p>Für diese Filter gibt es keine Matches.</p></div>');
}
