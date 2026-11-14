// Ansicht "Match-Detail": Kopf mit Ergebnis, Scoreboard, Rundenverlauf, Notizen.
// (Clips kommen in Etappe 6 dazu. Das Formular zum Bearbeiten steht in matchform.js.)
import { S } from "../state.js";
import { RES_LABEL, STAT_FIELDS } from "../constants.js";
import { esc, fmtDate, fmt0, num, pct } from "../util.js";
import { result, roundInfo, rowKey } from "../stats.js";

const SIDE = { atk: "Angriff", def: "Verteidigung" };

export function matchView(id) {
  const back = '<a class="back" href="#matches">← Alle Matches</a>';
  if (!S.loaded.matches) return back + '<p class="loading">Lade Match …</p>';
  const m = S.matches.find((x) => x.id === id);
  if (!m) return back + '<div class="empty"><h2>Match nicht gefunden</h2><p>Vielleicht wurde es gelöscht.</p></div>';

  const r = result(m), d = fmtDate(m.date);
  const top = `<div class="detail-top">${back}
    <button class="btn" type="button" data-action="mf-edit" data-id="${esc(m.id)}">Bearbeiten</button></div>`;
  const head = `<div class="detail-head">
    <div><div class="eyebrow">${esc(m.type || "Match")} · ${esc(d.full)}</div><h1>${esc(m.map || "Map?")}</h1>
      <div class="detail-meta"><span>vs ${esc(m.opponent || "unbekannt")}</span></div></div>
    <div class="detail-score"><div class="score">${esc(m.scoreUs ?? "?")}<span class="sep">:</span>${esc(m.scoreThem ?? "?")}</div><div class="res ${r}">${RES_LABEL[r]}</div></div>
  </div>`;
  const notes = m.notes ? `<section class="panel"><div class="panel-head"><h2>Notizen</h2></div><div class="panel-body notes-text">${esc(m.notes)}</div></section>` : "";
  return top + head + scoreboard(m) + roundsPanel(m) + notes;
}

// K/D zum Vergleichen: ohne Deaths unendlich, ohne Werte ganz hinten
function kd(row) {
  const k = num(row.kills), d = num(row.deaths);
  if (k === null || d === null) return -1;
  return d === 0 ? Infinity : k / d;
}
const desc = (a, b) => a === b ? 0 : a > b ? -1 : 1;

function scoreboard(m) {
  // Sortiert nach Kills, bei Gleichstand nach der besseren K/D. Zeilen ohne Kills stehen unten.
  const rows = (m.players || []).slice().sort((a, b) => desc(num(a.kills) ?? -1, num(b.kills) ?? -1) || desc(kd(a), kd(b)));
  if (!rows.length) return "";
  const top = num(rows[0].kills) !== null ? rows[0] : null;
  const cell = (row, f) => num(row[f]) === null ? "–" : fmt0(num(row[f]));
  const body = rows.map((row) => {
    const p = S.players.find((x) => x.id === row.playerId);
    const name = p ? p.name : (row.name || "Unbekannt");
    // Am Handy steht der Agent unter dem Namen (agent-sm), die Agent-Spalte fällt dort weg: So passt die Tabelle auf 360 px
    // Der Name führt zur Detailseite des Spielers (auch wenn er nicht mehr im Roster steht: Seine Matches zählen weiter)
    const key = rowKey(row);
    const label = key ? `<a class="plink" href="#player-${esc(encodeURIComponent(key))}">${esc(name)}</a>` : esc(name);
    return `<tr><td class="name">${label}${p && p.status === "sub" ? ' <span class="tag">Sub</span>' : ""}${row === top ? '<span class="mvp" title="Meiste Kills">MVP</span>' : ""}${row.agent ? `<span class="agent-sm">${esc(row.agent)}</span>` : ""}</td>
      <td class="l agent col-agent">${esc(row.agent || "–")}</td>${STAT_FIELDS.map(([f]) => `<td>${cell(row, f)}</td>`).join("")}</tr>`;
  }).join("");
  return `<section class="panel"><div class="panel-head"><h2>Scoreboard</h2><span class="hint">sortiert nach Kills</span></div>
    <div class="table-wrap"><table class="sb"><thead><tr><th>Spieler</th><th class="l col-agent">Agent</th>${STAT_FIELDS.map(([, label, long]) => `<th title="${esc(long)}">${esc(label)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table></div></section>`;
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
  // Passt der Verlauf nicht zum Endstand, steht das dabei (gespeichert werden darf es trotzdem)
  const w = ri.rounds.split("W").length - 1, l = ri.n - w;
  const us = num(m.scoreUs), them = num(m.scoreThem);
  const off = us !== null && them !== null && (w !== us || l !== them)
    ? `<p class="notice">Der Verlauf ergibt ${w}:${l}, der Endstand ist ${us}:${them}. Über „Bearbeiten“ lässt sich das angleichen.</p>` : "";
  return `<section class="panel"><div class="panel-head"><h2>Rundenverlauf</h2><span class="hint">S = Sieg, N = Niederlage · unterstrichen = Pistol-Runde</span></div>
    <div class="panel-body halves">
      ${half("1. Hälfte", 0, 12)}${half("2. Hälfte", 12, 24)}${half("Overtime", 24, ri.n)}
      <div class="round-facts">${facts.join("")}</div>${off}
    </div></section>`;
}
