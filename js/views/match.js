// Ansicht "Match-Detail": Kopf mit Ergebnis, Scoreboard, Rundenverlauf.
// (Bearbeiten, Notizen und Clips kommen in Etappe 4 und 6 dazu.)
import { S } from "../state.js";
import { RES_LABEL, STAT_FIELDS } from "../constants.js";
import { esc, fmtDate, fmt0, num, pct } from "../util.js";
import { result, roundInfo } from "../stats.js";

const SIDE = { atk: "Angriff", def: "Verteidigung" };

export function matchView(id) {
  const back = '<a class="back" href="#matches">← Alle Matches</a>';
  if (!S.loaded.matches) return back + '<p class="loading">Lade Match …</p>';
  const m = S.matches.find((x) => x.id === id);
  if (!m) return back + '<div class="empty"><h2>Match nicht gefunden</h2><p>Vielleicht wurde es gelöscht.</p></div>';

  const r = result(m), d = fmtDate(m.date);
  const head = `<div class="detail-head">
    <div><div class="eyebrow">${esc(m.type || "Match")} · ${esc(d.full)}</div><h1>${esc(m.map || "Map?")}</h1>
      <div class="detail-meta"><span>vs ${esc(m.opponent || "unbekannt")}</span></div></div>
    <div class="detail-score"><div class="score">${esc(m.scoreUs ?? "?")}<span class="sep">:</span>${esc(m.scoreThem ?? "?")}</div><div class="res ${r}">${RES_LABEL[r]}</div></div>
  </div>`;
  const notes = m.notes ? `<section class="panel"><div class="panel-head"><h2>Notizen</h2></div><div class="panel-body">${esc(m.notes)}</div></section>` : "";
  return back + head + scoreboard(m) + roundsPanel(m) + notes;
}

function scoreboard(m) {
  const rows = (m.players || []).slice().sort((a, b) => (num(b.acs) ?? -1) - (num(a.acs) ?? -1));
  if (!rows.length) return "";
  const top = num(rows[0].acs) !== null ? rows[0] : null;
  const cell = (row, f) => num(row[f]) === null ? "–" : fmt0(num(row[f])) + (f === "hsPct" ? " %" : "");
  const body = rows.map((row) => {
    const p = S.players.find((x) => x.id === row.playerId);
    const name = p ? p.name : (row.name || "Unbekannt");
    return `<tr><td class="name">${esc(name)}${p && p.status === "sub" ? ' <span class="tag">Sub</span>' : ""}${row === top ? '<span class="mvp">MVP</span>' : ""}</td>
      <td class="l agent">${esc(row.agent || "–")}</td>${STAT_FIELDS.map(([f]) => `<td>${cell(row, f)}</td>`).join("")}</tr>`;
  }).join("");
  return `<section class="panel"><div class="panel-head"><h2>Scoreboard</h2><span class="hint">sortiert nach ACS</span></div>
    <div class="table-wrap"><table><thead><tr><th>Spieler</th><th class="l">Agent</th>${STAT_FIELDS.map(([, label]) => `<th>${esc(label)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div></section>`;
}

function roundsPanel(m) {
  const ri = roundInfo(m);
  if (!ri) return "";
  const half = (label, from, to) => {
    let w = 0, l = 0;
    const cells = [];
    for (let i = from; i < Math.min(to, ri.n); i++) {
      const won = ri.rounds[i] === "W", pistol = i === 0 || i === 12;
      if (won) w++; else l++;
      cells.push(`<span class="rd ${won ? "W" : "L"}${pistol ? " pistol" : ""}" title="Runde ${i + 1}${pistol ? " (Pistol)" : ""}: ${won ? "gewonnen" : "verloren"}">${won ? "S" : "N"}</span>`);
    }
    if (!cells.length) return "";
    const side = to <= 24 ? ri.sides[from] : null;
    return `<div><div class="half-head"><span>${label}${side ? " · " + SIDE[side] : ""}</span><b>${w}:${l}</b></div><div class="rounds">${cells.join("")}</div></div>`;
  };
  const facts = [];
  if (ri.sides[0]) {
    facts.push(`<div><span>Angriff</span> <b>${ri.atk.w}:${ri.atk.l}</b></div>`);
    facts.push(`<div><span>Verteidigung</span> <b>${ri.def.w}:${ri.def.l}</b></div>`);
  }
  if (ri.pistolN) facts.push(`<div><span>Pistols</span> <b>${ri.pistolW} von ${ri.pistolN}</b> <span>(${pct(ri.pistolW / ri.pistolN)})</span></div>`);
  return `<section class="panel"><div class="panel-head"><h2>Rundenverlauf</h2><span class="hint">S = Sieg, N = Niederlage · unterstrichen = Pistol-Runde</span></div>
    <div class="panel-body halves">
      ${half("1. Hälfte", 0, 12)}${half("2. Hälfte", 12, 24)}${half("Overtime", 24, ri.n)}
      <div class="round-facts">${facts.join("")}</div>
    </div></section>`;
}
