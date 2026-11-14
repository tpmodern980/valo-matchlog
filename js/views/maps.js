// Ansicht "Maps": Bilanz pro Map, Angriff und Verteidigung, Pistols, meistgespielte Komposition.
import { S } from "../state.js";
import { MAPS } from "../constants.js";
import { esc, norm, pct, signed1 } from "../util.js";
import { filtered, mapStats } from "../stats.js";
import { barChart, chartTable } from "../charts.js";
import { filterBar, record, nMatches, chartPanel, noMatches } from "./parts.js";

const kv = (label, value, title = "") => `<div class="kv"${title ? ` title="${esc(title)}"` : ""}><span>${esc(label)}</span><b>${value}</b></div>`;
// Rundenquote einer Seite: "58 % (35:25)"
const side = (rate, t) => rate === null ? "–" : `${pct(rate)} <span class="muted">(${t.w}:${t.l})</span>`;

function card(s) {
  const comp = s.comp
    ? `<div class="comp"><span>Meistgespielte Komposition</span><b>${s.comp.agents.map(esc).join(" · ")}</b><small>${s.comp.n}× gespielt, Bilanz ${record(s.comp)}</small></div>`
    : '<div class="comp"><span>Meistgespielte Komposition</span><small>Noch kein Match mit fünf eingetragenen Agents.</small></div>';
  const rounds = s.withRounds
    ? kv("Angriff", side(s.atkRate, s.atk), "Gewonnene Runden im Angriff") + kv("Verteidigung", side(s.defRate, s.def), "Gewonnene Runden in der Verteidigung")
      + kv("Pistols", s.pistolN ? `${pct(s.pistolWr)} <span class="muted">(${s.pistolW} von ${s.pistolN})</span>` : "–", "Gewonnene Pistol-Runden (Runde 1 und 13)")
      + `<p class="hint">Aus ${s.withRounds} von ${nMatches(s.n)} mit Rundenverlauf.</p>`
    : '<p class="hint">Angriff, Verteidigung und Pistols: noch kein Match mit Rundenverlauf.</p>';
  return `<article class="map-card">
    <h3>${esc(s.name)}</h3>
    <div class="map-wr"><b>${pct(s.wr)}</b><span>Winrate</span></div>
    ${s.wr === null ? "" : `<div class="bar" aria-hidden="true"><i style="width:${Math.round(s.wr * 100)}%"></i></div>`}
    ${kv("Bilanz", record(s))}${kv("Matches", s.n)}${kv("Ø Rundendiff.", signed1(s.diff))}
    <div class="map-sep"></div>${rounds}
    <div class="map-sep"></div>${comp}
  </article>`;
}

export function mapsView() {
  // Hier ohne Map-Filter: Die Seite vergleicht die Maps miteinander
  const head = `<div class="view-head"><div><div class="eyebrow">Statistik</div><h1>Maps</h1>
    <p>Wie läuft es auf welcher Map? Bilanz und Winrate, Runden im Angriff und in der Verteidigung, Pistol-Runden.</p></div>
    <div class="head-side">${filterBar(false)}</div></div>`;
  if (!S.loaded.matches) return head + '<p class="loading">Lade Matches …</p>';
  const list = filtered({ anyMap: true });
  if (!list.length) return head + noMatches("Hier steht dann die Bilanz pro Map.");
  const stats = mapStats(list);

  const ranked = stats.filter((s) => s.wr !== null).sort((a, b) => b.wr - a.wr || b.n - a.n || a.name.localeCompare(b.name, "de"));
  const chart = chartPanel("Winrate pro Map", "Anteil gewonnener Matches · Bilanz",
    barChart({
      rows: ranked.map((s) => ({ label: s.name, value: s.wr, text: `${pct(s.wr)} · ${record(s)}`, short: pct(s.wr), tip: `Bilanz ${record(s)} in ${nMatches(s.w + s.l + s.d)}` })),
      max: 1, room: 7.5, unit: "Winrate", empty: "Noch kein Match mit Score.",
    }),
    chartTable(["Map", "Matches", "Bilanz", "Winrate"], ranked.map((s) => [s.name, s.w + s.l + s.d, record(s), pct(s.wr)])));

  const played = new Set(stats.map((s) => s.key));
  const rest = MAPS.filter((m) => !played.has(norm(m)));
  return head + chart + `<div class="map-grid">${stats.map(card).join("")}</div>`
    + (rest.length ? `<p class="hint">Noch ohne Match${S.filters.type !== "alle" || S.filters.range !== "alle" ? " (für diese Filter)" : ""}: ${rest.map(esc).join(", ")}</p>` : "");
}
