// Ansicht "Matches": Bilanz-Leiste und Liste aller Matches (neueste zuerst).
import { S } from "../state.js";
import { RES_SHORT } from "../constants.js";
import { esc, pct, signed1 } from "../util.js";
import { filtered, sortMatches, teamSummary, result } from "../stats.js";
import { filterBar, matchRow } from "./parts.js";
import { seriesInfo, seriesSummary, formatLabel } from "../series.js";

export function matchesView() {
  // Kopf zuerst: filterBar räumt veraltete Filter weg, bevor gefiltert wird
  const head = `<div class="view-head"><div><div class="eyebrow">Team-Bilanz</div><h1>Matches</h1>
    <p>Alle Scrims und Matches eures Teams. Tipp auf ein Match für Scoreboard, Rundenverlauf, Notizen und Clips.</p></div>
    <div class="head-side">${filterBar(true)}<button class="btn primary" type="button" data-action="mf-new">Match eintragen</button></div></div>`;
  const list = sortMatches(filtered());
  const sum = teamSummary(list);
  const last5 = sortMatches(S.matches).slice(0, 5).reverse();
  if (!S.loaded.matches) return head + '<p class="loading">Lade Matches …</p>';

  if (!S.matches.length) {
    return head + `<div class="empty"><h2>Noch keine Matches</h2>
      <p>Hier landen eure Scrims, Premier-Matches und Turniere. Tragt oben über „Match eintragen“ das erste Match ein.</p></div>`;
  }

  const dots = last5.map((m) => {
    const r = result(m);
    return `<span class="dot ${r}" title="${esc((m.map || "") + " " + (m.scoreUs ?? "?") + ":" + (m.scoreThem ?? "?"))}">${RES_SHORT[r]}</span>`;
  }).join("");
  const ser = seriesSummary(list);
  const summary = `<div class="summary">
    <div class="stat"><span>Bilanz</span><b>${sum.w}–${sum.l}${sum.d ? "–" + sum.d : ""}</b><small>${sum.total} ${sum.total === 1 ? "Match" : "Matches"}</small></div>
    <div class="stat"><span>Winrate</span><b>${pct(sum.wr)}</b><small>gewertete Matches</small></div>
    <div class="stat"><span>Ø Rundendiff.</span><b>${signed1(sum.diff)}</b><small>pro Match</small></div>
    ${ser.n ? `<div class="stat"><span>Serien</span><b>${ser.w}–${ser.l}</b><small>BO3/BO5${ser.open ? ` · ${ser.open} offen` : ""}</small></div>` : ""}
    ${sum.pistolN ? `<div class="stat"><span>Pistols</span><b>${pct(sum.pistolWr)}</b><small>${sum.pistolW} von ${sum.pistolN} gewonnen</small></div>` : ""}
    <div class="stat"><span>Letzte 5</span><div class="form-dots">${dots}</div></div>
  </div>`;

  if (!list.length) return head + summary + '<div class="empty"><h2>Keine Treffer</h2><p>Für diese Filter gibt es keine Matches.</p></div>';
  const search = `<div class="ml-search"><input type="search" id="ml-q" value="${esc(query)}" placeholder="Suchen: Gegner, Map, Spieler, Notizen …" aria-label="Matches durchsuchen" autocomplete="off" spellcheck="false" maxlength="60"></div>`;
  return head + summary + search + `<div id="ml-list">${listHtml(list)}</div>`;
}

// ---------- Suche und Monatsgruppen ----------

let query = "";   // bleibt beim Tab-Wechsel stehen, bis man es löscht

const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const fold = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

// Alles, wonach man suchen kann: Gegner, Map, Art, Notizen, Review, Spieler und Agents
function haystack(m) {
  const who = (m.players || []).map((p) => `${p.name || ""} ${p.agent || ""}`).join(" ");
  return fold([m.opponent, m.map, m.type, m.notes, m.good, m.work, who].join(" "));
}

function searched(list) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return list;
  return list.filter((m) => { const h = haystack(m); return words.every((w) => h.includes(w)); });
}

function listHtml(all) {
  const list = searched(all);
  if (!list.length) return `<div class="empty"><h2>Nichts gefunden</h2><p>Kein Match passt zu „${esc(query.trim())}“.</p></div>`;
  const groups = [];
  for (const m of list) {
    const key = String(m.date || "").slice(0, 7) || "?";
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) groups.push(g = { key, items: [] });
    g.items.push(m);
  }
  const hit = query.trim() ? `<p class="hint ml-hits">${list.length} von ${all.length} ${all.length === 1 ? "Match" : "Matches"}</p>` : "";
  return hit + groups.map((g) => {
    const [y, mo] = g.key.split("-");
    const name = MONTHS[Number(mo) - 1] ? `${MONTHS[Number(mo) - 1]} ${y}` : "Ohne Datum";
    const s = teamSummary(g.items);
    return `<section class="ml-month"><h3><span>${esc(name)}</span><small>${s.w}–${s.l}${s.d ? "–" + s.d : ""} · ${pct(s.wr)}</small></h3>
      <div class="match-list">${rowsWithSeries(g.items)}</div></section>`;
  }).join("");
}

// Maps einer Serie stehen als ein Block zusammen (an der Stelle der neuesten Map), darin Map 1, 2, 3 der Reihe nach
const RES_WORD = { W: "Sieg", L: "Niederlage", Q: "läuft" };
function rowsWithSeries(items) {
  const done = new Set();
  return items.map((m) => {
    if (!m.seriesId) return matchRow(m);
    if (done.has(m.seriesId)) return "";
    done.add(m.seriesId);
    const s = seriesInfo(m.seriesId);
    if (!s) return matchRow(m);
    const shown = new Set(items.filter((x) => x.seriesId === m.seriesId).map((x) => x.id));
    const rows = s.maps.filter((x) => shown.has(x.id)).map((x) => matchRow(x, s.maps.indexOf(x) + 1)).join("");
    return `<div class="series-block ${s.res}"><div class="series-head">
        <span class="tag">${formatLabel(s.format)}</span><b>${esc(s.name || "Serie")}</b><span class="muted">vs ${esc(s.opponent || "unbekannt")}</span>
        <span class="series-score">${s.w}:${s.l}</span><span class="res ${s.res === "Q" ? "Q" : s.res}">${RES_WORD[s.res]}</span></div>
      <div class="match-list">${rows}</div></div>`;
  }).join("");
}

// Tippen filtert sofort, nur die Liste wird neu gezeichnet (das Feld behält Fokus und Cursor)
document.addEventListener("input", (e) => {
  if (e.target.id !== "ml-q") return;
  query = e.target.value;
  const box = document.getElementById("ml-list");
  if (box) box.innerHTML = listHtml(sortMatches(filtered()));
});
