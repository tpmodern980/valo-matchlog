// Bausteine, die mehrere Ansichten benutzen.
import { S } from "../state.js";
import { TYPES, MAPS, RES_LABEL } from "../constants.js";
import { esc, norm, fmtDate } from "../util.js";
import { result } from "../stats.js";

// Filterzeile (Art, Map, Zeitraum). Änderungen fängt main.js über data-filter ab.
// Muss vor filtered() aufgerufen werden: räumt einen gemerkten Map-Filter weg, den es nicht mehr gibt.
export function filterBar(showMap) {
  const f = S.filters;
  // Alle bekannten Maps, dazu jede, die in einem Match steht (z. B. eine neue Map, die noch nicht in MAPS ist)
  const seen = new Set();
  const maps = [...MAPS, ...S.matches.map((m) => m.map)]
    .filter((m) => m && !seen.has(norm(m)) && seen.add(norm(m)))
    .sort((a, b) => a.localeCompare(b, "de"));
  if (S.loaded.matches && f.map !== "alle" && !maps.some((m) => norm(m) === norm(f.map))) f.map = "alle";
  // Dasselbe für eine gemerkte Art, die es nicht mehr gibt
  if (f.type !== "alle" && !TYPES.includes(f.type)) f.type = "alle";
  const o = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
  return `<div class="filters">
    <label class="field"><span>Art</span><select id="f-type" data-filter="type">${o("alle", "Alle", f.type)}${TYPES.map((t) => o(t, t, f.type)).join("")}</select></label>
    ${showMap ? `<label class="field"><span>Map</span><select id="f-map" data-filter="map">${o("alle", "Alle", f.map)}${maps.map((m) => o(m, m, f.map)).join("")}</select></label>` : ""}
    <label class="field"><span>Zeitraum</span><select id="f-range" data-filter="range">${o("alle", "Gesamt", f.range)}${o("30", "Letzte 30 Tage", f.range)}${o("90", "Letzte 90 Tage", f.range)}</select></label>
  </div>`;
}

// Bilanz als "7–3" (mit Unentschieden "7–3–1")
export const record = (t) => `${t.w}–${t.l}${t.d ? "–" + t.d : ""}`;
export const nMatches = (n) => `${n} ${n === 1 ? "Match" : "Matches"}`;

// Kennzahlen-Kacheln: [[Titel, Wert, kleine Zeile darunter], …]
export const tiles = (list) => `<div class="summary">${list.map(([label, value, small]) =>
  `<div class="stat"><span>${esc(label)}</span><b>${esc(value)}</b>${small ? `<small>${esc(small)}</small>` : ""}</div>`).join("")}</div>`;

// Diagramm im Kasten: Titel, kurze Erklärung, das Diagramm und darunter dieselben Werte als Tabelle
export const chartPanel = (title, hint, chart, table = "") => `<section class="panel chart-panel">
  <div class="panel-head"><h2>${esc(title)}</h2>${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</div>
  <div class="panel-body">${chart}${table}</div></section>`;

// Zeile eines Matches in einer Liste (Matches-Tab, Gegner-Detail)
export function matchRow(m) {
  const r = result(m), d = fmtDate(m.date);
  const clipN = S.clips.filter((c) => c.matchId === m.id).length;
  return `<a class="mrow ${r}" href="#match-${esc(m.id)}">
      <div class="mrow-date"><b>${esc(d.day)}</b>${esc(d.wd)}</div>
      <div class="mrow-main"><div class="mrow-map">${esc(m.map || "Map?")}</div>
        <div class="mrow-sub"><span class="tag">${esc(m.type || "Match")}</span>vs ${esc(m.opponent || "unbekannt")}${clipN ? ` · ${clipN} ${clipN === 1 ? "Clip" : "Clips"}` : ""}</div></div>
      <div class="score">${esc(m.scoreUs ?? "?")}<span class="sep">:</span>${esc(m.scoreThem ?? "?")}</div>
      <div class="res ${r}">${RES_LABEL[r]}</div>
    </a>`;
}

// Leerer Zustand für alle Statistik-Seiten: noch gar kein Match oder keines für die gewählten Filter
export function noMatches(what) {
  return S.matches.length
    ? '<div class="empty"><h2>Keine Treffer</h2><p>Für diese Filter gibt es keine Matches. Stell oben einen anderen Zeitraum oder eine andere Art ein.</p></div>'
    : `<div class="empty"><h2>Noch keine Matches</h2><p>${esc(what)} Tragt im Tab „Matches“ das erste Match ein.</p></div>`;
}

// Platzhalter für Bereiche, die in einer späteren Etappe gebaut werden
export function soonView(eyebrow, title, text, stage) {
  return `<div class="view-head"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1></div></div>
    <div class="empty"><h2>Noch nicht gebaut</h2><p>${esc(text)}</p><p class="hint">Kommt in Etappe ${esc(stage)}.</p></div>`;
}
