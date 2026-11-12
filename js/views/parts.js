// Bausteine, die mehrere Ansichten benutzen.
import { S } from "../state.js";
import { TYPES } from "../constants.js";
import { esc, norm } from "../util.js";

// Filterzeile (Art, Map, Zeitraum). Änderungen fängt main.js über data-filter ab.
// Muss vor filtered() aufgerufen werden: räumt einen gemerkten Map-Filter weg, den es nicht mehr gibt.
export function filterBar(showMap) {
  const f = S.filters;
  const maps = [...new Set(S.matches.map((m) => m.map).filter(Boolean))].sort();
  if (S.loaded.matches && f.map !== "alle" && !maps.some((m) => norm(m) === norm(f.map))) f.map = "alle";
  const o = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
  return `<div class="filters">
    <label class="field"><span>Art</span><select id="f-type" data-filter="type">${o("alle", "Alle", f.type)}${TYPES.map((t) => o(t, t, f.type)).join("")}</select></label>
    ${showMap ? `<label class="field"><span>Map</span><select id="f-map" data-filter="map">${o("alle", "Alle", f.map)}${maps.map((m) => o(m, m, f.map)).join("")}</select></label>` : ""}
    <label class="field"><span>Zeitraum</span><select id="f-range" data-filter="range">${o("alle", "Gesamt", f.range)}${o("30", "Letzte 30 Tage", f.range)}${o("90", "Letzte 90 Tage", f.range)}</select></label>
  </div>`;
}

// Platzhalter für Bereiche, die in einer späteren Etappe gebaut werden
export function soonView(eyebrow, title, text, stage) {
  return `<div class="view-head"><div><div class="eyebrow">${esc(eyebrow)}</div><h1>${esc(title)}</h1></div></div>
    <div class="empty"><h2>Noch nicht gebaut</h2><p>${esc(text)}</p><p class="hint">Kommt in Etappe ${esc(stage)}.</p></div>`;
}
