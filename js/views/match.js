// Ansicht "Match-Detail": Kopf mit Ergebnis, Scoreboard, Rundenverlauf, Notizen, Clips.
// (Die Clips stehen in clips.js, das Formular zum Bearbeiten in matchform.js.)
import { S, changed } from "../state.js";
import { clipsPanel } from "./clips.js";
import { RES_LABEL, STAT_FIELDS, ALL_STAT_FIELDS, TINY_LABEL } from "../constants.js";
import { esc, fmtDate, fmt0, num, pct, toast, isoDate } from "../util.js";
import { result, roundInfo, rowKey } from "../stats.js";
import { change } from "../data.js";
import { buildPost, postMatch, hookFor } from "../discord.js";
import { errorText } from "../auth.js";
import { hasStrats } from "../strats.js";
import { stratsLink } from "./strats.js";
import { vetoForMatch, vetoSteps, vetoLabel } from "./veto.js";
import { points } from "../review.js";

const SIDE = { atk: "Angriff", def: "Verteidigung" };

// ---------- In Discord posten (js/discord.js) ----------
// Der Knopf zeigt erst eine Vorschau der Nachricht, gepostet wird erst nach "Jetzt posten".
let dcOpen = null;     // Match-ID, deren Vorschau offen ist
let dcBusy = false;
window.addEventListener("hashchange", () => { dcOpen = null; });

// Gibt es für dieses Match einen Discord-Kanal (eigener Kanal seiner Map oder der Standard-Kanal)?
const hookOn = (m) => Boolean(hookFor(m));

// Discord-Formatierung für die Vorschau in HTML: **fett**, `Code`, \-Escapes
function mdHtml(text) {
  return esc(text).replace(/\\([\\*_~`|>#[\]])/g, "$1")
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\n/g, "<br>");
}

function discordPanel(m) {
  if (dcOpen !== m.id || !hookOn(m)) return "";
  const e = buildPost(m).embeds[0];
  const target = hookFor(m);
  const where = `<p class="hint dc-where">${target.thread ? `Geht in den Forum-Beitrag für <b>${esc(target.map)}</b>.`
    : target.map ? `Geht in den Discord-Kanal für <b>${esc(target.map)}</b>.`
    : "Geht in den <b>Standard-Kanal</b> (für diese Map ist nichts Eigenes eingetragen)."}</p>`;
  const done = m.discordAt ? `<p class="hint warn-text">Dieses Match wurde schon am ${esc(fmtDate(isoDate(new Date(m.discordAt))).full)} in Discord gepostet. Noch einmal posten?</p>` : "";
  return `<section class="panel dc"><div class="panel-head"><h2>In Discord posten</h2><span class="hint">Vorschau</span></div>
    <div class="panel-body">
      ${where}
      <div class="dc-embed" style="--dc:#${e.color.toString(16).padStart(6, "0")}">
        <div class="dc-title">${esc(e.title)}</div>
        <div class="dc-desc">${mdHtml(e.description)}</div>
        ${e.fields.map((f) => `<div class="dc-field"><div class="dc-name">${esc(f.name)}</div><div>${mdHtml(f.value)}</div></div>`).join("")}
        <div class="dc-foot">${esc(e.footer.text)}</div>
      </div>
      ${done}
      <div class="actions">
        <button class="btn primary" type="button" data-action="dc-send" data-id="${esc(m.id)}"${dcBusy ? " disabled" : ""}>${dcBusy ? "Wird gepostet …" : m.discordAt ? "Nochmal posten" : "Jetzt posten"}</button>
        <button class="btn" type="button" data-action="dc-cancel">Abbrechen</button>
      </div>
      ${S.demo ? '<p class="hint">Vorschau: Es wird nichts an Discord geschickt.</p>' : ""}
    </div></section>`;
}

export const actions = {
  "dc-open": (el) => { dcOpen = el.dataset.id; changed(); },
  "dc-cancel": () => { dcOpen = null; changed(); },
  "dc-send": async (el) => {
    const m = S.matches.find((x) => x.id === el.dataset.id);
    if (!m || dcBusy) return;
    dcBusy = true; changed();
    try {
      await postMatch(m);
      dcOpen = null;
      toast(S.demo ? "Vorschau: Nichts gesendet. Echt geht die Nachricht in euren Discord-Kanal." : "In Discord gepostet.");
      // Merken, dass es gepostet ist (damit niemand aus Versehen doppelt postet)
      try { await change("matches", m.id, { discordAt: Date.now() }); } catch (e) { /* nur ein Merker */ }
    } catch (e) {
      toast(e.plain ? e.message : (errorText(e) || "Posten hat nicht geklappt."));
    } finally {
      dcBusy = false; changed();
    }
  },
};

export function matchView(id) {
  const back = '<a class="back" href="#matches">← Alle Matches</a>';
  if (!S.loaded.matches) return back + '<p class="loading">Lade Match …</p>';
  const m = S.matches.find((x) => x.id === id);
  if (!m) return back + '<div class="empty"><h2>Match nicht gefunden</h2><p>Vielleicht wurde es gelöscht.</p></div>';

  const r = result(m), d = fmtDate(m.date);
  const dcBtn = hookOn(m) && dcOpen !== m.id
    ? `<button class="btn" type="button" data-action="dc-open" data-id="${esc(m.id)}" title="${m.discordAt ? "Schon in Discord gepostet" : "Ergebnis und Scoreboard in euren Discord-Kanal posten"}">${m.discordAt ? "Discord ✓" : "In Discord posten"}</button>` : "";
  const stratsBtn = hasStrats(m.map) ? `<a class="btn" href="${stratsLink(m.map)}" title="Taktiken für ${esc(m.map)} aus eurem Drive-Ordner">Strats ${esc(m.map)}</a>` : "";
  const top = `<div class="detail-top">${back}
    <div class="detail-btns">${stratsBtn}${dcBtn}<button class="btn" type="button" data-action="mf-edit" data-id="${esc(m.id)}">Bearbeiten</button></div></div>`;
  const head = `<div class="detail-head">
    <div><div class="eyebrow">${esc(m.type || "Match")} · ${esc(d.full)}</div><h1>${esc(m.map || "Map?")}</h1>
      <div class="detail-meta"><span>vs ${esc(m.opponent || "unbekannt")}</span></div></div>
    <div class="detail-score"><div class="score">${esc(m.scoreUs ?? "?")}<span class="sep">:</span>${esc(m.scoreThem ?? "?")}</div><div class="res ${r}">${RES_LABEL[r]}</div></div>
  </div>`;
  // Review (js/review.js): "Lief gut" und "Üben wir" als Listen, darunter die freien Notizen
  const list = (text, cls) => { const p = points(text); return p.length ? `<ul class="rv-list ${cls}">${p.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""; };
  const good = list(m.good, "good"), work = list(m.work, "work");
  const notes = good || work || m.notes ? `<section class="panel"><div class="panel-head"><h2>Review</h2></div><div class="panel-body">
      ${good || work ? `<div class="rv-cols">${good ? `<div><h3 class="rv-h good">Lief gut</h3>${good}</div>` : ""}${work ? `<div><h3 class="rv-h work">Üben wir</h3>${work}</div>` : ""}</div>` : ""}
      ${m.notes ? `<div class="notes-text">${esc(m.notes)}</div>` : ""}</div></section>` : "";
  return top + head + discordPanel(m) + scoreboard(m) + roundsPanel(m) + vetoPanel(m) + notes + clipsPanel(m);
}

// K/D zum Vergleichen: ohne Deaths unendlich, ohne Werte ganz hinten
function kd(row) {
  const k = num(row.kills), d = num(row.deaths);
  if (k === null || d === null) return -1;
  return d === 0 ? Infinity : k / d;
}
const desc = (a, b) => a === b ? 0 : a > b ? -1 : 1;

// Eine Scoreboard-Tabelle. ours = unser Team (Namen führen zur Spieler-Seite, MVP), sonst die Gegner (nur Text).
function board(m, list, ours) {
  // Sortiert nach Kills, bei Gleichstand nach der besseren K/D. Zeilen ohne Kills stehen unten.
  const rows = (list || []).slice().sort((a, b) => desc(num(a.kills) ?? -1, num(b.kills) ?? -1) || desc(kd(a), kd(b)));
  if (!rows.length) return "";
  const top = ours && num(rows[0].kills) !== null ? rows[0] : null;
  // Trades gibt es nur bei Premier (und nur, wenn welche eingetragen sind). Dann stehen sieben Zahlen nebeneinander:
  // Am Handy bekommen die Spalten kürzere Titel, damit die Tabelle weiter auf 360 px passt.
  const wide = m.type === "Premier" && rows.some((row) => num(row.trades) !== null);
  const fields = wide ? ALL_STAT_FIELDS : STAT_FIELDS;
  const cell = (row, f) => num(row[f]) === null ? "–" : fmt0(num(row[f]));
  const body = rows.map((row) => {
    const p = ours ? S.players.find((x) => x.id === row.playerId) : null;
    const name = p ? p.name : (row.name || "Unbekannt");
    // Am Handy steht der Agent unter dem Namen (agent-sm), die Agent-Spalte fällt dort weg: So passt die Tabelle auf 360 px
    // Der Name führt zur Detailseite des Spielers (auch wenn er nicht mehr im Roster steht: Seine Matches zählen weiter)
    const key = ours ? rowKey(row) : null;
    const label = key ? `<a class="plink" href="#player-${esc(encodeURIComponent(key))}">${esc(name)}</a>` : esc(name);
    return `<tr><td class="name">${label}${p && p.status === "sub" ? ' <span class="tag">Sub</span>' : ""}${ours && row.former ? ' <span class="tag" title="Ehemaliger Spieler: steht nur hier, zählt in keiner Statistik">Ehemalig</span>' : ""}${row === top ? '<span class="mvp" title="Meiste Kills">MVP</span>' : ""}${row.agent ? `<span class="agent-sm">${esc(row.agent)}</span>` : ""}</td>
      <td class="l agent col-agent">${esc(row.agent || "–")}</td>${fields.map(([f]) => `<td>${cell(row, f)}</td>`).join("")}</tr>`;
  }).join("");
  const th = ([f, label, long]) => `<th title="${esc(long)}">${wide && TINY_LABEL[f] ? `<span class="th-long">${esc(label)}</span><span class="th-tiny">${esc(TINY_LABEL[f])}</span>` : esc(label)}</th>`;
  const title = ours ? "Scoreboard" : "Gegner";
  const hint = ours ? "sortiert nach Kills" : `${m.opponent ? esc(m.opponent) + " · " : ""}zählt nicht in die Statistik`;
  return `<section class="panel"><div class="panel-head"><h2>${title}</h2><span class="hint">${hint}</span></div>
    <div class="table-wrap"><table class="sb${wide ? " sb-wide" : ""}"><thead><tr><th>${ours ? "Spieler" : "Gegner"}</th><th class="l col-agent">Agent</th>${fields.map(th).join("")}</tr></thead><tbody>${body}</tbody></table></div></section>`;
}
// Unser Scoreboard, darunter (falls eingetragen) das der Gegner
const scoreboard = (m) => board(m, m.players, true) + board(m, m.opponents, false);

// Gespeichertes Map-Veto (js/views/veto.js): gleiches Datum, gleicher Gegner
function vetoPanel(m) {
  const x = vetoForMatch(m);
  if (!x) return "";
  return `<section class="panel"><div class="panel-head"><h2>Map-Veto</h2><span class="hint">${esc(vetoLabel(x))} · ${x.first === "them" ? "Gegner hat angefangen" : "wir haben angefangen"}</span></div>
    <div class="panel-body">${vetoSteps(x)}</div></section>`;
}

function roundsPanel(m) {
  const ri = roundInfo(m);
  if (!ri) return "";
  const half = (label, from, to) => {
    let w = 0, l = 0;
    const cells = [];
    for (let i = from; i < Math.min(to, ri.n); i++) {
      const v = ri.rounds[i], pistol = i === 0 || i === 12;
      if (v === "W") w++; else if (v === "L") l++;
      const [cls, txt, what] = v === "W" ? ["W", "S", "gewonnen"] : v === "L" ? ["L", "N", "verloren"] : ["U", "?", "nicht eingetragen"];
      cells.push(`<span class="rd ${cls}${pistol ? " pistol" : ""}" title="Runde ${i + 1}${pistol ? " (Pistol)" : ""}: ${what}">${txt}</span>`);
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
  const w = ri.w, l = ri.l;
  const us = num(m.scoreUs), them = num(m.scoreThem);
  // Teilweise eingetragen (z. B. nur Pistols und Folgerunden nachgetragen): kein Abgleich mit dem Endstand
  const off = ri.open || (us !== null && them !== null && w + l < us + them && w <= us && l <= them)
    ? `<p class="hint">Teilweise eingetragen: ${w + l} von ${us !== null && them !== null ? us + them : "?"} Runden. Gezählt wird nur, was eingetragen ist.</p>`
    : us !== null && them !== null && (w !== us || l !== them)
      ? `<p class="notice">Der Verlauf ergibt ${w}:${l}, der Endstand ist ${us}:${them}. Über „Bearbeiten“ lässt sich das angleichen.</p>` : "";
  return `<section class="panel"><div class="panel-head"><h2>Rundenverlauf</h2><span class="hint">S = Sieg, N = Niederlage, ? = nicht eingetragen · unterstrichen = Pistol-Runde</span></div>
    <div class="panel-body halves">
      ${half("1. Hälfte", 0, 12)}${half("2. Hälfte", 12, 24)}${half("Overtime", 24, ri.n)}
      <div class="round-facts">${facts.join("")}</div>${off}
    </div></section>`;
}
