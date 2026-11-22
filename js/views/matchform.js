// Formular "Match eintragen / bearbeiten". Es liegt als Überlagerung im Bereich #editor (außerhalb von #view),
// damit Eingaben erhalten bleiben, wenn die Seite darunter neu gezeichnet wird.
// Alle Eingaben stehen als Text in "ed" (dem Modell). Vor jedem Neuzeichnen holt pull() die Felder dorthin.
import { S } from "../state.js";
import { MAPS, AGENTS, TYPES, ALL_STAT_FIELDS, statFields, TINY_LABEL, AGENT_LOOKALIKE } from "../constants.js";
import { $, esc, norm, today, toast, fmtDate, copyText } from "../util.js";
import { roundInfo, sortMatches, cleanRounds } from "../stats.js";
import { create, change, remove, listAdd } from "../data.js";
import { run, setMsg, msgBox } from "./auth.js";
import { learn } from "../agentrefs.js";
import { anyHook, hookFor, postMatch } from "../discord.js";
import { points, pointKey, workItems } from "../review.js";

const SIDE = { atk: "Angriff", def: "Verteidigung" };
const MAX_ROWS = 10;
const MAX_FOES = 5;      // Gegner: höchstens fünf Zeilen
let ed = null;          // das offene Formular oder null

const clean = (s) => String(s || "").trim().replace(/\s+/g, " ");
const count = (text, ch) => text.split(ch).length - 1;
const byName = (a, b) => String(a.name).localeCompare(String(b.name), "de");

// Eingabe -> ganze Zahl ab 0. Leer = null (zählt nicht in Durchschnitte), ungültig = false.
function whole(v, max = 999) {
  const t = String(v ?? "").trim();
  if (!t) return null;
  const n = Number(t.replace(",", "."));
  return Number.isInteger(n) && n >= 0 && n <= max ? n : false;
}
// Score-Feld als Zahl oder null (auch wenn gerade Unsinn drinsteht)
const scoreOf = (v) => { const n = whole(v, 99); return n === false ? null : n; };

// Spieler finden: nur exakte Treffer auf den Anzeigenamen oder einen Ingame-Namen
// (Groß/Klein und "#Tag" egal). Keine Teilwort-Treffer: "Tim" darf nicht "Timo" treffen.
function findPlayer(key) {
  return S.players.find((p) => [p.name, ...(p.aliases || [])].some((x) => norm(x) === key)) || null;
}

// Wurde dieser Name schon einmal als "ehemaliger Spieler" gespeichert? Dann ist das beim nächsten Mal schon gewählt.
function formerKnown(key) {
  return S.matches.some((m) => (m.players || []).some((r) => r.former && norm(r.name) === key));
}

// ---------- Modell ----------

function rowOf(seed = {}) {
  const row = { playerId0: seed.playerId || null, former0: Boolean(seed.former), name0: seed.name || "", name: seed.name || "", agent: seed.agent || "" };
  for (const [f] of ALL_STAT_FIELDS) row[f] = seed[f] === null || seed[f] === undefined ? "" : String(seed[f]);
  return row;
}

// Vorschlag für ein neues Match: die Aufstellung des letzten Matches, sonst die Stammspieler
function lineup() {
  const last = sortMatches(S.matches).find((m) => (m.players || []).length);
  const known = last ? last.players.filter((r) => r.name && S.players.some((p) => p.id === r.playerId)) : [];
  if (known.length) return known.slice(0, 5).map((r) => ({ playerId: r.playerId, name: r.name }));
  return S.players.filter((p) => p.status !== "sub").sort(byName).slice(0, 5).map((p) => ({ playerId: p.id, name: p.name }));
}

const snapshot = () => JSON.stringify([ed.date, ed.type, ed.opponent, ed.map, ed.us, ed.them, ed.notes, ed.good, ed.work, ed.startSide, ed.rounds,
  ...[ed.rows, ed.foes].map((list) => list.map((r) => [r.name, r.agent, ...ALL_STAT_FIELDS.map(([f]) => r[f])]))]);

function open(match) {
  const m = match || {};
  const rows = match ? (m.players || []).map(rowOf) : lineup().map(rowOf);
  while (rows.length < (match ? 1 : 5)) rows.push(rowOf());
  ed = {
    id: match ? match.id : null,
    date: m.date || today(),
    type: m.type || (S.filters.type !== "alle" ? S.filters.type : "Scrim"),
    opponent: m.opponent || "", map: m.map || "",
    us: m.scoreUs === null || m.scoreUs === undefined ? "" : String(m.scoreUs),
    them: m.scoreThem === null || m.scoreThem === undefined ? "" : String(m.scoreThem),
    notes: m.notes || "",
    // Review: ein Punkt pro Zeile (js/review.js)
    good: m.good || "", work: m.work || "",
    startSide: m.startSide === "atk" || m.startSide === "def" ? m.startSide : null,
    rounds: cleanRounds(m.rounds),
    rows,
    // Scoreboard der Gegner (freiwillig): dieselben Zeilen, aber ohne Roster und ohne Statistik
    foes: match ? (Array.isArray(m.opponents) ? m.opponents : []).map(rowOf) : [],
    // Steht bei einem neuen Match noch das vorgeschlagene Datum (heute) da? Dann darf das Datum aus dem Screenshot es ersetzen.
    date0: m.date || today(), dateAuto: !match,
    // Dasselbe für die Art: Steht noch die vorgeschlagene da, darf "Premier" aus dem Screenshot sie ersetzen.
    type0: m.type || (S.filters.type !== "alle" ? S.filters.type : "Scrim"), typeAuto: !match,
    // Screenshot auslesen: gewählte Bilder, läuft gerade?, Bericht nach dem Auslesen
    scan: { board: null, line: null, busy: false, report: null },
    ask: [],            // unbekannte Namen: [{ key, name, choice }]
    confirm: null,      // Rückfrage in der Fußzeile: "delete" | "discard" | null
    // Nach dem Speichern automatisch in Discord posten (Wunsch Tim, 22.11.2026)? null = automatisch entscheiden (autoPost),
    // true/false = so hat es jemand im Formular eingestellt. Schon gepostet: merkt sich das Match (discordAt).
    post: null, posted: Boolean(match && match.discordAt),
    busy: false,
    snap: "",
  };
  ed.snap = snapshot();
  S.msg = null;
  fillLists();
  document.body.classList.add("lock");
  draw();
  $("#editor").scrollTop = 0;
  // Nur mit Maus/Tastatur gleich ins erste Feld: Am Handy ginge sonst sofort die Tastatur auf
  if (matchMedia("(pointer: fine)").matches) { const f = $("#ed-opponent"); if (f) f.focus(); }
}

export function closeEditor() {
  if (!ed) return;
  ed = null;
  const el = $("#editor");
  el.hidden = true;
  el.innerHTML = "";
  document.body.classList.remove("lock");
  S.msg = null;
}

// Schließen über ✕, "Abbrechen" oder Escape: bei ungespeicherten Eingaben erst nachfragen
function wantClose() {
  if (!ed || ed.busy) return;
  pull();
  if (snapshot() === ed.snap) return closeEditor();
  ed.confirm = "discard";
  draw();
  showFoot();
}

const showFoot = () => { const f = $("#ed-foot"); if (f) f.scrollIntoView({ block: "nearest" }); };

// Vorschlagslisten (die <datalist>-Elemente stehen in index.html)
function fillLists() {
  const opts = (list) => list.map((v) => `<option value="${esc(v)}"></option>`).join("");
  const uniq = (list) => { const seen = new Set(); return list.filter((v) => v && !seen.has(norm(v)) && seen.add(norm(v))); };
  const recent = sortMatches(S.matches);   // neueste zuerst: Die jüngste Schreibweise gewinnt
  $("#dl-opponents").innerHTML = opts(uniq(recent.map((m) => clean(m.opponent))).sort((a, b) => a.localeCompare(b, "de")));
  $("#dl-maps").innerHTML = opts(uniq([...MAPS, ...recent.map((m) => clean(m.map))]).sort((a, b) => a.localeCompare(b, "de")));
  $("#dl-agents").innerHTML = opts(uniq([...AGENTS, ...recent.flatMap((m) => (m.players || []).map((r) => clean(r.agent)))]).sort((a, b) => a.localeCompare(b, "de")));
  const names = [];
  for (const p of S.players.slice().sort(byName)) names.push(p.name, ...(p.aliases || []));
  $("#dl-players").innerHTML = opts([...new Set(names.filter(Boolean))]);
}

// ---------- Zeichnen ----------

// Felder aus der Seite ins Modell holen
function pull() {
  const el = $("#editor");
  el.querySelectorAll("[data-f]").forEach((inp) => {
    if (inp.dataset.row !== undefined) { const row = ed.rows[Number(inp.dataset.row)]; if (row) row[inp.dataset.f] = inp.value; }
    else if (inp.dataset.foe !== undefined) { const row = ed.foes[Number(inp.dataset.foe)]; if (row) row[inp.dataset.f] = inp.value; }
    else ed[inp.dataset.f] = inp.value;
  });
  el.querySelectorAll("[data-ask]").forEach((sel) => {
    const a = ed.ask.find((x) => x.key === sel.dataset.ask);
    if (a) a.choice = sel.value;
  });
}

function refocus(box, id) {
  if (!id) return;
  const f = document.getElementById(id);
  if (f && box.contains(f) && !f.disabled) f.focus({ preventScroll: true });
}

// Ganzes Formular neu zeichnen (Scroll-Position und Fokus bleiben)
function draw() {
  const el = $("#editor");
  const focusId = el.contains(document.activeElement) ? document.activeElement.id : null;
  const top = el.scrollTop;
  el.innerHTML = sheet();
  el.hidden = false;
  el.scrollTop = top;
  refocus(el, focusId);
}

// Nur den Rundenverlauf neu zeichnen (beim Antippen der Runden und wenn sich der Score ändert)
function drawRounds() {
  const box = $("#ed-rounds");
  if (!box) return;
  ed.us = $("#ed-us").value;
  ed.them = $("#ed-them").value;
  const focusId = box.contains(document.activeElement) ? document.activeElement.id : null;
  box.innerHTML = roundsInner();
  refocus(box, focusId);
}

const option = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;

// Eine Spielerzeile. foe = Zeile im Scoreboard der Gegner (eigene ids, keine Vorschläge aus dem Roster).
function rowHtml(row, i, foe = false) {
  const n = i + 1, id = `ed-${foe ? "f" : "r"}${i}`, at = `${foe ? "data-foe" : "data-row"}="${i}"`, who = foe ? "Gegner, " : "";
  // Bei Premier stehen sieben Zahlen nebeneinander (mit Trades): Am Handy bekommen sie dann kürzere Titel
  const wide = ed.type === "Premier";
  const stat = ([f, short, long]) => `<label class="mini"><span>${esc((wide && TINY_LABEL[f]) || short)}</span>
      <input type="text" class="numf" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" id="${id}-${f}" ${at} data-f="${f}" value="${esc(row[f])}" aria-label="${who}${esc(long)}, Zeile ${n}"></label>`;
  return `<div class="mp-row">
    <label class="mini mp-name"><span>${foe ? "Gegner" : "Spieler"}</span>
      <input type="text"${foe ? "" : ' list="dl-players"'} id="${id}-name" ${at} data-f="name" value="${esc(row.name)}" maxlength="40" placeholder="Ingame-Name" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="${who}Name, Zeile ${n}"></label>
    <label class="mini mp-agent"><span>Agent</span>
      <input type="text" list="dl-agents" id="${id}-agent" ${at} data-f="agent" value="${esc(row.agent)}" maxlength="20" placeholder="Agent" autocomplete="off" spellcheck="false" aria-label="${who}Agent, Zeile ${n}"></label>
    ${statFields(ed.type).map(stat).join("")}
    <button class="alias-x mp-x" type="button" id="${id}-x" data-action="${foe ? "mf-foe-remove" : "mf-row-remove"}" data-i="${i}" aria-label="${who}Zeile ${n} entfernen" title="Zeile entfernen">×</button>
  </div>`;
}

// Wie viele Runden-Felder zu sehen sind: 24, bei Overtime mehr (immer zwei dazu, solange es unentschieden steht)
function cellCount(rounds, us, them) {
  let n = 24;
  const total = us !== null && them !== null ? us + them : 0;
  if (total > n) n = total + (total % 2);
  if (rounds.length > n) n = rounds.length + (rounds.length % 2);
  if (rounds.length >= 24 && rounds.length === n && count(rounds, "W") * 2 === rounds.length) n += 2;
  return n;
}

function roundsInner() {
  const us = scoreOf(ed.us), them = scoreOf(ed.them);
  const r = ed.rounds, len = r.length, w = count(r, "W"), l = count(r, "L"), open = count(r, "?");
  const cells = cellCount(r, us, them), full = len >= cells;
  const start = ed.startSide, other = start === "atk" ? "def" : "atk";

  const half = (label, from, to, side) => {
    if (from >= cells) return "";
    let hw = 0, hl = 0, out = "";
    for (let i = from; i < Math.min(to, cells); i++) {
      const v = r[i] || "", pistol = i === 0 || i === 12;
      if (v === "W") hw++; else if (v === "L") hl++;
      const state = v === "W" ? "Sieg" : v === "L" ? "Niederlage" : "offen";
      // Jedes Feld lässt sich antippen, auch weiter hinten: Die Runden dazwischen bleiben offen ("?")
      out += `<button type="button" class="rd rdb ${v === "W" || v === "L" ? v : "E"}${pistol ? " pistol" : ""}${i === len ? " next" : ""}" id="ed-rd-${i}" data-action="mf-cell" data-i="${i}" aria-label="Runde ${i + 1}${pistol ? " (Pistol)" : ""}: ${state}"><small>${i + 1}</small><b>${v === "W" ? "S" : v === "L" ? "N" : ""}</b></button>`;
    }
    return `<div class="half"><div class="half-head"><span>${label}${side ? " · " + SIDE[side] : ""}</span><b>${hw}:${hl}</b></div><div class="rounds rd-grid">${out}</div></div>`;
  };

  const ri = roundInfo({ rounds: r, startSide: start });
  const facts = [];
  if (ri && start) {
    facts.push(`<div><span>Angriff</span> <b>${ri.atk.w}:${ri.atk.l}</b></div>`);
    facts.push(`<div><span>Verteidigung</span> <b>${ri.def.w}:${ri.def.l}</b></div>`);
  }
  if (ri && ri.pistolN) facts.push(`<div><span>Pistols</span> <b>${ri.pistolW} von ${ri.pistolN}</b></div>`);

  // Hinweis, wenn Verlauf und Score nicht zusammenpassen. Speichern bleibt erlaubt.
  let note = "";
  const take = (text) => `<button class="linkish" type="button" id="ed-take" data-action="mf-score-from-rounds">${text}</button>`;
  if (open) {
    note = `<p class="hint">${open === 1 ? "1 Runde ist" : `${open} Runden sind`} offen (nicht eingetragen). Das ist in Ordnung: Gezählt wird nur, was eingetragen ist.</p>`;
    if (us !== null && them !== null && (w > us || l > them)) note = `<p class="notice">Eingetragen sind ${w} Siege und ${l} Niederlagen, der Score ist aber nur ${us}:${them}. Speichern geht trotzdem.</p>` + note;
    if (!start) note += '<p class="hint">Ohne Startseite zählt der Verlauf nur für die Pistol-Runden, nicht für Angriff und Verteidigung.</p>';
  } else if (len) {
    if (us === null || them === null) note = `<p class="notice">Es ist noch kein Score eingetragen. ${take(`Score ${w}:${l} aus dem Verlauf übernehmen`)}</p>`;
    else if (w === us && l === them) note = `<p class="rd-ok">Passt zum Score ${us}:${them}.</p>`;
    else if (w <= us && l <= them) {
      const miss = us + them - len;
      note = `<p class="notice">Der Verlauf steht bei ${w}:${l}, der Score ist ${us}:${them}: ${miss === 1 ? "Es fehlt noch 1 Runde" : `Es fehlen noch ${miss} Runden`}. Speichern geht trotzdem.</p>`;
    } else note = `<p class="notice">Der Verlauf ergibt ${w}:${l}, als Score steht ${us}:${them} da. Speichern geht trotzdem. ${take(`Score ${w}:${l} übernehmen`)}</p>`;
    if (!start) note += '<p class="hint">Ohne Startseite zählt der Verlauf nur für die Pistol-Runden, nicht für Angriff und Verteidigung.</p>';
  }

  const now = full
    ? `<b>${w + l} Runden eingetragen</b><span>Stand ${w}:${l}</span>`
    : `<b>Runde ${len + 1}${len === 0 || len === 12 ? " · Pistol" : ""}</b><span>${len ? `Stand ${w}:${l}` : "Sieg oder Niederlage?"}</span>`;

  return `<div class="panel-head"><h2>Rundenverlauf</h2><span class="hint">freiwillig</span></div>
    <div class="panel-body rd-edit">
      <div class="field rd-side"><span>Wir starten im</span>
        <div class="seg" role="group" aria-label="Startseite">
          <button type="button" id="ed-side-atk" data-action="mf-side" data-side="atk" aria-pressed="${start === "atk"}">Angriff</button>
          <button type="button" id="ed-side-def" data-action="mf-side" data-side="def" aria-pressed="${start === "def"}">Verteidigung</button>
        </div></div>
      <div class="rd-now">${now}</div>
      <div class="rd-add">
        <button class="btn rd-w" type="button" id="ed-add-w" data-action="mf-round" data-r="W"${full ? " disabled" : ""}>Sieg</button>
        <button class="btn rd-l" type="button" id="ed-add-l" data-action="mf-round" data-r="L"${full ? " disabled" : ""}>Niederlage</button>
        <button class="btn" type="button" id="ed-undo" data-action="mf-round-undo"${len ? "" : " disabled"} aria-label="Letzte Runde zurücknehmen">Zurück</button>
      </div>
      <div class="halves">
        ${half("1. Hälfte", 0, 12, start)}${half("2. Hälfte", 12, 24, start ? other : null)}${half("Overtime", 24, cells, null)}
      </div>
      ${facts.length ? `<div class="round-facts">${facts.join("")}</div>` : ""}
      ${note}
      <p class="hint">Tipp auf „Sieg“ oder „Niederlage“ für die nächste Runde. Oder tipp direkt auf ein Feld: einmal = Sieg, zweimal = Niederlage, dreimal = wieder offen. So lassen sich bei alten Matches auch nur einzelne Runden nachtragen (z. B. die Pistols 1 und 13 mit ihren Folgerunden), der Rest bleibt offen. Unterstrichen = Pistol-Runde.${len ? ' <button class="linkish" type="button" id="ed-rd-clear" data-action="mf-rounds-clear">Verlauf leeren</button>' : ""}</p>
    </div>`;
}

// Review: "Lief gut" und "Üben wir", ein Punkt pro Zeile. Unter "Üben wir" die schon genannten Punkte der letzten
// 60 Tage als Chips: antippen hängt den Punkt an (gleiche Schreibweise = zählt in den Baustellen zusammen).
function reviewHtml() {
  const have = new Set(points(ed.work).map(pointKey));
  const d = new Date(); d.setDate(d.getDate() - 60);
  const since = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const chips = workItems(since).filter((x) => !have.has(pointKey(x.text))).slice(0, 8);
  return `<section class="panel"><div class="panel-head"><h2>Review</h2><span class="hint">ein Punkt pro Zeile</span></div>
    <div class="panel-body rv-edit">
      <label class="field"><span>Lief gut</span><textarea id="ed-good" data-f="good" maxlength="1000" rows="3" placeholder="z. B. Retakes auf B&#10;Comms in der Overtime">${esc(ed.good)}</textarea></label>
      <label class="field"><span>Üben wir</span><textarea id="ed-work" data-f="work" maxlength="1000" rows="3" placeholder="z. B. Pistol in der Verteidigung&#10;Nicht einzeln auf A peeken">${esc(ed.work)}</textarea></label>
      ${chips.length ? `<div class="rv-chips"><span>Schon genannt (antippen = übernehmen):</span>${chips.map((x) => `<button type="button" class="tag rv-chip" data-action="mf-work-add" data-text="${esc(x.text)}">${esc(x.text)}${x.n > 1 ? ` <b>${x.n}×</b>` : ""}</button>`).join("")}</div>` : ""}
    </div></section>`;
}

function askHtml() {
  if (!ed.ask.length) return "";
  const players = S.players.slice().sort(byName);
  const items = ed.ask.map((a, i) => `<label class="field"><span>„${esc(a.name)}“ ist …</span>
      <select id="ed-ask-${i}" data-ask="${esc(a.key)}">
        ${option("", "Bitte wählen …", a.choice)}
        ${option("new-stamm", "ein neuer Stammspieler", a.choice)}
        ${option("new-sub", "ein neuer Sub", a.choice)}
        ${option("ex", "ein ehemaliger Spieler (zählt nicht)", a.choice)}
        ${players.length ? `<optgroup label="ein Ingame-Name von …">${players.map((p) => option("p:" + p.id, p.name, a.choice)).join("")}</optgroup>` : ""}
      </select></label>`).join("");
  return `<section class="panel ask" id="ed-ask"><div class="panel-head"><h2>Unbekannte Namen</h2></div>
    <div class="panel-body">
      <p class="hint">${ed.ask.length === 1 ? "Dieser Name steht" : "Diese Namen stehen"} noch nicht im Roster. Sag kurz, wer das ist, dann tipp noch einmal auf „Speichern“. Bei einem bestehenden Spieler wird der Name als Ingame-Name ergänzt. Neue Spieler bekommen erst die Rolle „Flex“ (änderbar im Tab „Spieler“). Ein ehemaliger Spieler steht nur im Scoreboard dieses Matches: Er kommt nicht ins Roster und zählt in keiner Statistik.</p>
      ${items}
    </div></section>`;
}

// Automatisch posten, wenn das Match noch nicht gepostet ist und nicht älter als 3 Tage (sonst würde jedes
// nachgetragene alte Scrim in Discord landen). Im Formular lässt es sich umstellen.
function autoPost() {
  if (ed.posted) return false;
  const d = new Date(); d.setDate(d.getDate() - 3);
  const cut = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return String(ed.date || "") >= cut;
}
const wantPost = () => (ed.post === null ? autoPost() : ed.post);

function footHtml() {
  if (ed.confirm === "delete") {
    // Die Clips werden nicht einzeln gelöscht: Sie hängen am Match und sind mit ihm weg (und mit ihm wieder da)
    const clipN = S.clips.filter((c) => c.matchId === ed.id).length;
    return `<div class="confirm"><span>Dieses Match wirklich löschen? Es verschwindet für alle aus der App${clipN ? (clipN === 1 ? ", sein Clip auch" : `, seine ${clipN} Clips auch`) : ""}.</span>
      <button class="btn small danger solid" type="button" id="ed-del-yes" data-action="mf-delete">Löschen</button>
      <button class="btn small" type="button" id="ed-del-no" data-action="mf-confirm-cancel">Abbrechen</button></div>`;
  }
  if (ed.confirm === "discard") {
    return `<div class="confirm"><span>Deine Eingaben sind noch nicht gespeichert. Wirklich verwerfen?</span>
      <button class="btn small danger solid" type="button" id="ed-drop-yes" data-action="mf-discard">Verwerfen</button>
      <button class="btn small" type="button" id="ed-drop-no" data-action="mf-confirm-cancel">Weiter bearbeiten</button></div>`;
  }
  const post = anyHook() ? `<button type="button" class="ed-post" id="ed-post" data-action="mf-post" aria-pressed="${wantPost()}">
      <span class="ed-post-box" aria-hidden="true">${wantPost() ? "✓" : ""}</span>Nach dem Speichern in Discord posten${ed.posted ? " (schon gepostet)" : ""}</button>` : "";
  return `${ed.id ? '<button class="btn danger" type="button" id="ed-del" data-action="mf-ask-delete">Match löschen</button>' : ""}
    ${post}
    <div class="foot-btns"><button class="btn ghost" type="button" id="ed-cancel" data-action="mf-close">Abbrechen</button>
      <button class="btn primary" type="button" id="ed-save" data-action="mf-save">Speichern</button></div>`;
}

// ---------- Screenshot auslesen ----------
// Die KI-Aufrufe stehen in js/scan.js (wird erst beim ersten Auslesen geladen). Hier: Bilder wählen,
// Werte ins Modell füllen, Bericht zeigen. Gespeichert wird dabei nichts.
// Meldungen haben hier ein eigenes Feld: msgBox (#auth-msg) steht schon in der Fußzeile des Formulars.

const SCAN = {
  board: ["Scoreboard", "Ergebnis-Übersicht"],
  line: ["Timeline", "Rundenverlauf"],
};
const quote = (s) => `„${s}“`;
// Steht die Zeile noch im Formular (bei uns oder bei den Gegnern)?
const alive = (row) => ed.rows.includes(row) || ed.foes.includes(row);
const hasValues = (row) => Boolean(clean(row.agent)) || ALL_STAT_FIELDS.some(([f]) => clean(row[f]));
const roundsText = (r) => { const w = count(r, "W"), l = count(r, "L"); return `${w + l} ${w + l === 1 ? "Runde" : "Runden"} (${w}:${l})`; };

// Geprüfte Werte aus js/scan.js ins Modell füllen. Regel: Leere Felder werden gefüllt. Steht in einem Feld
// schon etwas anderes, bleibt es stehen und kommt als "Abweichung" in den Bericht (der Nutzer entscheidet).
// Einzige Ausnahmen, beide stehen im Bericht: das vorgeschlagene Datum (heute) bei einem neuen Match und
// Spielerzeilen, in denen nur ein Name steht (meist die vorgeschlagene Aufstellung).
function applyScan(res) {
  const rep = { demo: Boolean(res.demo && (res.board || res.line)), errors: [], done: [], warn: [], conflicts: [], same: false };
  for (const kind of ["board", "line"]) if (res.errors[kind]) rep.errors.push({ title: SCAN[kind][0], ...res.errors[kind] });
  // Derselbe Fehler bei beiden Bildern (z. B. keine Verbindung): nur einmal zeigen
  if (rep.errors.length === 2 && rep.errors[0].text === rep.errors[1].text) rep.errors = [{ ...rep.errors[0], title: "Beide Bilder" }];
  const b = res.board, t = res.line;
  // Tageskontingent des eingestellten Modells aufgebraucht: Ein Ausweich-Modell hat gelesen (js/scan.js)
  if (res.fallback && (b || t)) {
    const fb = res.fallback, why = [];
    if (fb.spent.length) why.push(`das Tageskontingent von ${fb.spent.map(quote).join(", ")} für heute aufgebraucht ist`);
    if (fb.busy.length) why.push(`${fb.busy.map(quote).join(", ")} gerade überlastet war`);
    rep.warn.push(`Gelesen mit dem Ausweich-Modell ${quote(fb.model)}, weil ${why.join(" und ")}. Es kann ungenauer lesen: Werte bitte besonders genau prüfen.`);
  }
  // Abweichung merken: get() liefert, was gerade im Formular steht; apply() übernimmt den Wert aus dem Bild
  // same() sagt, ob sich die Abweichung erledigt hat (Standard: Im Formular steht jetzt derselbe Text)
  const clash = (label, neu, get, apply, row = null, same = () => get() === neu) => rep.conflicts.push({ label, neu, get, apply, row, same });

  // Endstand: aus dem Scoreboard, sonst aus der Timeline
  const pair = (x) => (x && x.scoreUs !== null && x.scoreThem !== null ? [x.scoreUs, x.scoreThem] : null);
  const score = pair(b) || pair(t);
  if (score) {
    const [us, them] = score.map(String), cur = () => `${clean(ed.us) || "–"}:${clean(ed.them) || "–"}`;
    if (!clean(ed.us) && !clean(ed.them)) { ed.us = us; ed.them = them; rep.done.push(`Score ${us}:${them}`); }
    else if (cur() !== `${us}:${them}`) clash("Score", `${us}:${them}`, cur, () => { ed.us = us; ed.them = them; });
    if (pair(b) && pair(t) && pair(b).join(":") !== pair(t).join(":")) {
      rep.warn.push(`Die zwei Bilder zeigen verschiedene Endstände (Scoreboard ${pair(b).join(":")}, Timeline ${pair(t).join(":")}). Gehören sie zum selben Match?`);
    }
  } else if (b || t) rep.warn.push("Der Endstand war nicht lesbar.");

  if (b) {
    if (b.map) {
      if (!clean(ed.map)) { ed.map = b.map; rep.done.push(`Map ${b.map}`); }
      else if (norm(ed.map) !== norm(b.map)) clash("Map", b.map, () => clean(ed.map), () => { ed.map = b.map; });
    } else rep.warn.push("Die Map war nicht lesbar.");

    if (b.date && b.date !== ed.date) {
      const nice = fmtDate(b.date).full;
      if (!ed.date || (ed.dateAuto && ed.date === ed.date0)) {
        rep.done.push(`Datum ${nice}${ed.date ? " (vorher stand das heutige Datum da)" : ""}`);
        ed.date = b.date;
      } else clash("Datum", nice, () => fmtDate(ed.date).full, () => { ed.date = b.date; });
    }
    ed.dateAuto = false;

    // Art: Im Bild sicher erkennbar ist nur "Premier" (bei Custom-Spielen bleibt die Art, wie sie ist)
    if (b.type && b.type !== ed.type) {
      if (ed.typeAuto && ed.type === ed.type0) {
        rep.done.push(`Art ${b.type} (vorher stand ${quote(ed.type)} da)`);
        ed.type = b.type;
      } else clash("Art", b.type, () => ed.type, () => { ed.type = b.type; });
    }
    ed.typeAuto = false;

    // Das Kürzel der Gegner ist nur ein Vorschlag: Es kommt nur in ein leeres Feld
    if (b.opponentTag && !clean(ed.opponent)) {
      ed.opponent = b.opponentTag;
      rep.done.push(`Gegner: das Kürzel ${quote(b.opponentTag)} aus dem Bild. Ersetz es durch den Teamnamen, wenn ihr ihn kennt.`);
    }
    fillTeam("rows", b.players, b, rep, clash);
    fillTeam("foes", b.opponents || [], b, rep, clash);
    if (b.sheet) rep.done.push(`Agents mit ${b.sheet} Beispielbildern des Teams verglichen (Tab „Team“, „KI-Trainingsbilder“).`);
  }

  if (t) {
    if (t.rounds) {
      const w = count(t.rounds, "W"), l = t.rounds.length - w;
      if (!ed.rounds) { ed.rounds = t.rounds; rep.done.push(`Rundenverlauf: ${roundsText(t.rounds)}`); }
      else if (ed.rounds !== t.rounds) clash("Rundenverlauf", roundsText(t.rounds), () => roundsText(ed.rounds), () => { ed.rounds = t.rounds; }, null, () => ed.rounds === t.rounds);
      if (t.inferred) rep.warn.push(`Runde ${t.inferred.round} hat im Bild einen Stern („beste Runde“) statt eines farbigen Symbols. Aus dem Endstand folgt: ${t.inferred.result === "W" ? "Sieg" : "Niederlage"}. Schau kurz, ob das stimmt.`);
      if (t.cutAt) rep.warn.push(`Runde ${t.cutAt} war nicht lesbar. Der Verlauf aus dem Bild reicht deshalb nur bis Runde ${t.cutAt - 1}. Den Rest bitte von Hand eintragen.`);
      else if (t.scoreUs !== null && t.scoreThem !== null && (w !== t.scoreUs || l !== t.scoreThem)) {
        rep.warn.push(`Gelesen wurden ${roundsText(t.rounds)}, der Endstand im Bild ist aber ${t.scoreUs}:${t.scoreThem}. Vergleich den Rundenverlauf unten mit dem Bild.`);
      }
      if (t.startSide) {
        if (!ed.startSide) { ed.startSide = t.startSide; rep.done.push(`Startseite: ${SIDE[t.startSide]} (abgeleitet daraus, wie die Runden endeten)`); }
        else if (ed.startSide !== t.startSide) clash("Startseite", SIDE[t.startSide], () => SIDE[ed.startSide] || "keine", () => { ed.startSide = t.startSide; });
      } else if (!ed.startSide) {
        rep.warn.push(t.sideClash
          ? "Bei der Startseite widersprechen sich die Symbole. Wähl sie unten bitte selbst."
          : "Die Startseite ließ sich aus den Symbolen nicht ableiten. Wähl sie unten bitte selbst.");
      }
    } else rep.warn.push("Im Timeline-Bild waren keine Runden lesbar.");
  }

  rep.same = !rep.errors.length && !rep.done.length && !rep.warn.length && !rep.conflicts.length;
  return rep;
}

// Zeilen eines Teams aus dem Scoreboard füllen. key = "rows" (unser Team) oder "foes" (Gegner).
// Unser Team: Zugeordnet wird wie beim Speichern, nur exakte Treffer über norm (derselbe Name oder derselbe Spieler
// im Roster). Ein fremder Name bleibt fremd, das Formular fragt beim Speichern.
// Gegner: Zuordnung nur über den Namen, kein Roster, keine Rückfrage.
function fillTeam(key, scanned, b, rep, clash) {
  const ours = key === "rows", max = ours ? MAX_ROWS : MAX_FOES, pre = ours ? "" : "Gegner ";
  if (!scanned.length) { if (ours) rep.warn.push("Im Scoreboard waren keine Spielerzeilen unseres Teams lesbar."); return; }
  const pidOf = (name) => { const p = ours ? findPlayer(norm(name)) : null; return p ? p.id : null; };
  let wrote = 0;
  const used = new Set(), fresh = [], names = [], unknown = [], exes = [], noAgent = [], doubt = [], gaps = [], noRoom = [];

  const fill = (row, p) => {
    used.add(row);
    // Agenten-Bild aus dem Screenshot: Wird nach dem Speichern als Beispiel gemerkt (js/agentrefs.js),
    // als Korrektur, wenn in der Zeile dann ein anderer Agent steht als der gelesene
    row.scanPic = p.pic || null;
    row.scanAgent = p.agent || null;
    const shown = clean(row.name);
    names.push(shown);
    if (ours && !pidOf(shown)) (formerKnown(norm(shown)) ? exes : unknown).push(shown);
    if (p.agent && AGENT_LOOKALIKE[p.agent]) doubt.push(`${quote(shown)}: ${p.agent} (oder ${AGENT_LOOKALIKE[p.agent].join(", ")}?)`);
    if (!p.agent) { if (!clean(row.agent)) noAgent.push(shown); }
    else if (!clean(row.agent)) { row.agent = p.agent; wrote++; }
    else if (norm(row.agent) !== norm(p.agent)) clash(`${pre}${shown}: Agent`, p.agent, () => clean(row.agent) || "leer", () => { row.agent = p.agent; }, row);
    // Trades gibt es nur bei Premier. Bei anderen Arten ist das Feld nicht zu sehen: Dann wird ein gelesener Wert
    // still gemerkt (falls die Art noch auf Premier gestellt wird), aber weder vermisst noch als Abweichung gemeldet.
    const seen = statFields(ed.type);
    for (const field of ALL_STAT_FIELDS) {
      const [f, , long] = field, visible = seen.includes(field);
      if (p[f] === null || p[f] === undefined) { if (visible) gaps.push(`${long} bei ${shown}`); continue; }
      const v = String(p[f]);
      if (!clean(row[f])) { row[f] = v; wrote++; }
      else if (visible && clean(row[f]) !== v) clash(`${pre}${shown}: ${long}`, v, () => clean(row[f]) || "leer", () => { row[f] = v; }, row);
    }
  };

  // 1. Spieler, die schon in einer Zeile stehen
  for (const p of scanned) {
    const k = norm(p.name), pid = pidOf(p.name);
    const row = ed[key].find((r) => !used.has(r) && clean(r.name) && (norm(r.name) === k || (pid && pidOf(r.name) === pid)));
    if (row) fill(row, p); else fresh.push(p);
  }
  // 2. Nur unser Team: Zeilen, in denen nur ein Name steht (meist die vorgeschlagene Aufstellung) und die nicht im
  //    Bild vorkommen, fallen weg. Das steht im Bericht.
  const gone = ours ? ed.rows.filter((r) => !used.has(r) && clean(r.name) && !hasValues(r)) : [];
  if (gone.length) ed.rows = ed.rows.filter((r) => !gone.includes(r));
  // 3. Die übrigen Spieler aus dem Bild: erst in leere Zeilen, dann in neue
  for (const p of fresh) {
    let row = ed[key].find((r) => !used.has(r) && !clean(r.name) && !hasValues(r));
    if (!row) {
      if (ed[key].length >= max) { noRoom.push(p.name); continue; }
      row = rowOf();
      ed[key].push(row);
    }
    row.name = p.name;
    fill(row, p);
  }
  if (ours && !ed.rows.length) ed.rows.push(rowOf());
  const extra = ours ? ed.rows.filter((r) => !used.has(r) && clean(r.name)).map((r) => clean(r.name)) : [];

  const list = (arr) => arr.map(quote).join(", ");
  if (wrote) rep.done.push(`${names.length} ${ours ? "Spieler" : "Gegner"} mit ihren Werten: ${names.join(", ")}`);
  if (unknown.length) rep.warn.push(`Noch nicht im Roster: ${list(unknown)}. Beim Speichern fragt das Formular, wer das ist (auch „ehemaliger Spieler“ ist möglich).`);
  if (doubt.length) rep.warn.push(`${pre ? "Gegner, " : ""}Agent bitte prüfen, die KI verwechselt ihn leicht: ${doubt.join(", ")}.`);
  if (exes.length) rep.warn.push(`Ehemalige Spieler: ${list(exes)}. Sie stehen nur im Scoreboard dieses Matches und zählen nicht in die Statistik.`);
  if (gone.length) rep.warn.push(`Nicht im Bild und deshalb aus der Liste genommen: ${list(gone.map((r) => clean(r.name)))}. Dort stand nur der Name.`);
  if (extra.length) rep.warn.push(`Im Formular, aber nicht im Bild: ${list(extra)}. Die Zeile bleibt stehen.`);
  if (noRoom.length) rep.warn.push(`Kein Platz mehr für ${list(noRoom)} (höchstens ${max} Zeilen${ours ? "" : " bei den Gegnern"}).`);
  if (ours && b.tooMany) rep.warn.push(`Die KI hat ${scanned.length} Spieler geliefert, zu einem Team gehören fünf. Vielleicht sind Gegner dabei: Bitte die Zeilen prüfen.`);
  else if (ours && scanned.length < 5) rep.warn.push(`Im Bild ${scanned.length === 1 ? "war nur 1 Spieler" : `waren nur ${scanned.length} Spieler`} unseres Teams lesbar.`);
  if (gaps.length) rep.warn.push(`${ours ? "Nicht" : "Bei den Gegnern nicht"} lesbar und leer gelassen: ${gaps.join(", ")}.`);
  if (noAgent.length) rep.warn.push(`Agent nicht erkannt bei ${ours ? "" : "den Gegnern "}${list(noAgent)}.`);
}

function reportHtml() {
  const rep = ed.scan.report;
  if (!rep) return "";
  // Abweichungen, die sich erledigt haben (Zeile entfernt oder Wert von Hand angeglichen), fallen weg
  rep.conflicts = rep.conflicts.filter((c) => (!c.row || alive(c.row)) && !c.same());
  const items = (arr) => `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  const error = (e) => `<div class="msg error"><b>${esc(e.title)}:</b> ${esc(e.text)}${e.token
    ? `<span class="scan-token"><code id="ed-scan-token">${esc(e.token)}</code><button class="btn small" type="button" id="ed-scan-copy" data-action="mf-scan-copy">Kopieren</button></span>` : ""}</div>`;
  const clashes = rep.conflicts.map((c, i) => `<li><span><b>${esc(c.label)}:</b> im Formular ${esc(quote(c.get()))}, im Bild ${esc(quote(c.neu))}</span>
      <button class="btn small" type="button" id="ed-scan-take-${i}" data-action="mf-scan-take" data-i="${i}">Aus dem Bild nehmen</button></li>`).join("");
  return `<div class="scan-report" id="ed-scan-report">
    ${rep.demo ? '<p class="notice"><b>Vorschau: Beispielwerte, es wurde nichts ausgelesen.</b></p>' : ""}
    ${rep.errors.map(error).join("")}
    ${rep.done.length ? `<div class="scan-part ok"><h4>Eingetragen</h4>${items(rep.done)}</div>` : ""}
    ${rep.conflicts.length ? `<div class="scan-part clash"><h4>Abweichungen: nichts überschrieben</h4>
      <p class="hint">In diesen Feldern stand schon etwas anderes. Es bleibt so, bis du dich entscheidest.</p>
      <ul>${clashes}</ul>
      <div class="actions">${rep.conflicts.length > 1 ? '<button class="btn small" type="button" id="ed-scan-take-all" data-action="mf-scan-take-all">Alle aus dem Bild nehmen</button>' : ""}
        <button class="btn small ghost" type="button" id="ed-scan-keep" data-action="mf-scan-keep">So lassen</button></div></div>` : ""}
    ${rep.warn.length ? `<div class="scan-part warn"><h4>Bitte prüfen</h4>${items(rep.warn)}</div>` : ""}
    ${rep.same ? '<p class="rd-ok">Alles aus dem Bild steht schon genauso im Formular.</p>' : ""}
    ${rep.errors.length && !rep.done.length && !rep.conflicts.length && !rep.warn.length ? "" : '<p class="hint">Die KI kann sich irren, vor allem bei den Agents (die sind nur als kleines Bild zu sehen). Vergleich die Werte mit dem Screenshot. Gespeichert wird erst mit „Speichern“.</p>'}
  </div>`;
}

function scanHtml() {
  const sc = ed.scan, off = sc.busy ? " disabled" : "";
  const slot = (kind) => {
    const [title, sub] = SCAN[kind], file = sc[kind];
    return `<div class="scan-slot${file ? " has" : ""}" data-scan-slot="${kind}">
      <div class="scan-what"><b>${title}</b><small>${file ? esc(file.name) : sub}</small></div>
      <label class="btn small filebtn${sc.busy ? " off" : ""}">${file ? "Anderes Bild" : "Bild wählen"}<input type="file" accept="image/*" id="ed-scan-${kind}" data-change="mf-scan-file" data-kind="${kind}" aria-label="${title}: Bild wählen"${off}></label>
      ${file ? `<button class="alias-x" type="button" id="ed-scan-drop-${kind}" data-action="mf-scan-drop" data-kind="${kind}" aria-label="${title}-Bild entfernen" title="Bild entfernen"${off}>×</button>` : ""}
    </div>`;
  };
  const note = sc.busy ? "Das dauert meist 10 bis 40 Sekunden, manchmal länger. Du kannst unten schon weiterschreiben."
    : S.demo ? "Vorschau: Es wird nichts an die KI geschickt, es kommen Beispielwerte."
    : "Die Bilder gehen verkleinert an die KI von Google (Gemini). Die App speichert sie nirgends.";
  return `<section class="scan" id="ed-scan" aria-labelledby="ed-scan-title">
    <div class="scan-head"><h3 id="ed-scan-title">Screenshot auslesen</h3><span class="hint">freiwillig</span></div>
    <p class="scan-lead">Wähl die zwei Screenshots vom Match-Ende, einer allein geht auch. Die KI trägt die Werte unten ein. Gespeichert wird dabei noch nichts.<span class="scan-pc"> Am PC geht es auch ohne Explorer: Bilder einfach auf ein Feld ziehen, auch direkt aus Discord, oder mit Strg + V einfügen.</span></p>
    <div class="scan-slots">${slot("board")}${slot("line")}</div>
    <div class="scan-go"><button class="btn primary" type="button" id="ed-scan-go" data-action="mf-scan"${(sc.board || sc.line) && !sc.busy ? "" : " disabled"}>${sc.busy ? "Liest aus …" : "Auslesen"}</button>
      <span class="hint" role="status">${note}</span></div>
    ${reportHtml()}
  </section>`;
}

async function runScan() {
  if (!ed || ed.scan.busy || !(ed.scan.board || ed.scan.line)) return;
  const mine = ed, sc = ed.scan;
  pull();
  sc.busy = true;
  sc.report = null;
  draw();
  let res;
  try {
    const { scanImages } = await import("../scan.js");
    res = await scanImages({ board: sc.board, line: sc.line });
  } catch (e) {
    // Hierhin kommt es nur, wenn sich js/scan.js nicht laden ließ
    console.warn("Screenshot-Auslesen fehlgeschlagen:", e);
    const err = { kind: "offline", text: "Das Auslesen ließ sich nicht starten. Prüf deine Verbindung und versuch es noch einmal. Von Hand eintragen geht immer.", token: "" };
    res = { board: null, line: null, demo: false, errors: { board: sc.board ? err : null, line: sc.line ? err : null } };
  }
  sc.busy = false;
  if (ed !== mine) return;   // Formular wurde inzwischen geschlossen oder gespeichert
  pull();                    // was getippt wurde, während die KI las
  sc.report = applyScan(res);
  draw();
  const box = $("#ed-scan-report");
  if (box) box.scrollIntoView({ block: "nearest" });
}

function sheet() {
  const types = TYPES.includes(ed.type) ? TYPES : [...TYPES, ed.type];
  return `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="ed-title">
    <div class="sheet-head"><h2 id="ed-title">${ed.id ? "Match bearbeiten" : "Match eintragen"}</h2>
      <button class="icon-btn" type="button" id="ed-close" data-action="mf-close" aria-label="Schließen">✕</button></div>
    <div class="sheet-body">
      ${scanHtml()}
      <div class="grid-form">
        <label class="field"><span>Datum</span><input type="date" id="ed-date" data-f="date" value="${esc(ed.date)}"></label>
        <label class="field"><span>Art</span><select id="ed-type" data-f="type" data-change="mf-type">${types.map((t) => option(t, t, ed.type)).join("")}</select></label>
        <label class="field"><span>Gegner</span><input type="text" id="ed-opponent" data-f="opponent" list="dl-opponents" maxlength="60" value="${esc(ed.opponent)}" placeholder="Teamname" autocomplete="off"></label>
        <label class="field"><span>Map</span><input type="text" id="ed-map" data-f="map" list="dl-maps" maxlength="30" value="${esc(ed.map)}" placeholder="z. B. Ascent" autocomplete="off"></label>
        <div class="field"><span>Score (wir : die)</span><div class="scorebox">
          <input type="text" class="numf" inputmode="numeric" pattern="[0-9]*" maxlength="5" autocomplete="off" id="ed-us" data-f="us" value="${esc(ed.us)}" placeholder="wir" aria-label="Unsere Runden"><b>:</b>
          <input type="text" class="numf" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off" id="ed-them" data-f="them" value="${esc(ed.them)}" placeholder="die" aria-label="Runden der Gegner"></div></div>
      </div>

      <section class="panel"><div class="panel-head"><h2>Spieler</h2><span class="hint">Leere Felder bleiben leer und zählen nicht mit</span></div>
        <div class="panel-body">
          <div class="mp-list${ed.type === "Premier" ? " wide" : ""}">
            <div class="mp-head" aria-hidden="true"><span>Spieler</span><span>Agent</span>${statFields(ed.type).map(([, short, long]) => `<span title="${esc(long)}">${esc(short)}</span>`).join("")}<span></span></div>
            ${ed.rows.map((row, i) => rowHtml(row, i)).join("")}
          </div>
          <div class="actions mp-tools"><button class="btn small" type="button" id="ed-row-add" data-action="mf-row-add"${ed.rows.length >= MAX_ROWS ? " disabled" : ""}>+ Zeile</button>
            <span class="hint">K = Kills, D = Deaths, A = Assists, FB = First Bloods${ed.type === "Premier" ? ". Trades gibt es nur bei Premier." : ""}</span></div>
        </div></section>

      <section class="panel" id="ed-foes"><div class="panel-head"><h2>Gegner</h2><span class="hint">freiwillig · zählt nicht in die Statistik</span></div>
        <div class="panel-body">
          ${ed.foes.length ? `<div class="mp-list${ed.type === "Premier" ? " wide" : ""}">
            <div class="mp-head" aria-hidden="true"><span>Gegner</span><span>Agent</span>${statFields(ed.type).map(([, short, long]) => `<span title="${esc(long)}">${esc(short)}</span>`).join("")}<span></span></div>
            ${ed.foes.map((row, i) => rowHtml(row, i, true)).join("")}
          </div>` : '<p class="hint">Hier steht das Scoreboard der Gegner. Beim Auslesen eines Scoreboard-Screenshots füllt es sich von selbst, du kannst es aber auch von Hand eintragen.</p>'}
          <div class="actions mp-tools"><button class="btn small" type="button" id="ed-foe-add" data-action="mf-foe-add"${ed.foes.length >= MAX_FOES ? " disabled" : ""}>+ Zeile</button></div>
        </div></section>

      <section class="panel" id="ed-rounds">${roundsInner()}</section>

      ${reviewHtml()}
      <label class="field"><span>Weitere Notizen</span><textarea id="ed-notes" data-f="notes" maxlength="2000" rows="3" placeholder="Strats, Tendenzen der Gegner …">${esc(ed.notes)}</textarea></label>

      ${askHtml()}
    </div>
    <div class="sheet-foot" id="ed-foot">${msgBox()}${footHtml()}</div>
  </div>`;
}

// ---------- Speichern ----------

function save() {
  if (!ed || ed.busy) return;
  pull();
  const fail = (text, focusId) => {
    setMsg("error", text);
    const f = focusId ? document.getElementById(focusId) : null;
    if (f) f.focus();
  };

  // Kopf
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ed.date)) return fail("Bitte ein Datum wählen.", "ed-date");
  const map = clean(ed.map);
  if (!map) return fail("Bitte die Map eintragen.", "ed-map");
  const us = whole(ed.us, 99), them = whole(ed.them, 99);
  if (us === false) return fail("Der Score braucht ganze Zahlen von 0 bis 99.", "ed-us");
  if (them === false) return fail("Der Score braucht ganze Zahlen von 0 bis 99.", "ed-them");
  if ((us === null) !== (them === null)) {
    return fail("Beim Score fehlt eine Seite. Trag beide Zahlen ein oder lass beide leer.", us === null ? "ed-us" : "ed-them");
  }

  // Spielerzeilen: ganz leere Zeilen fallen weg
  const rows = [];
  for (let i = 0; i < ed.rows.length; i++) {
    const r = ed.rows[i], name = clean(r.name), agent = clean(r.agent), stats = {};
    let any = Boolean(agent);
    // Gespeichert werden nur die Felder dieser Art (Trades nur bei Premier)
    for (const [f, , long] of statFields(clean(ed.type) || TYPES[0])) {
      const v = whole(r[f]);
      if (v === false) return fail(`Zeile ${i + 1}: ${long} muss eine ganze Zahl ab 0 sein.`, `ed-r${i}-${f}`);
      stats[f] = v;
      if (v !== null) any = true;
    }
    if (!name) {
      if (any) return fail(`Zeile ${i + 1}: Da fehlt der Name.`, `ed-r${i}-name`);
      continue;
    }
    const key = norm(name);
    if (!key) return fail(`Zeile ${i + 1}: „${name}“ ist kein gültiger Name.`, `ed-r${i}-name`);
    // Unveränderter Name aus dem gespeicherten Match: Die Zuordnung bleibt, auch wenn der Spieler
    // inzwischen umbenannt oder aus dem Roster genommen wurde. Sonst: exakter Abgleich mit dem Roster.
    // Ein als "ehemaliger Spieler" gespeicherter Name bleibt das ebenso, solange er nicht geändert wird.
    let playerId = r.playerId0 && norm(r.name0) === key ? r.playerId0 : null;
    const former = !playerId && r.former0 && norm(r.name0) === key;
    if (!playerId && !former) { const p = findPlayer(key); playerId = p ? p.id : null; }
    rows.push({ i, name, key, agent, stats, playerId, former });
  }

  // Gegner: dieselbe Prüfung der Zahlen, aber ohne Roster und ohne Rückfrage. Ganz leere Zeilen fallen weg.
  const foes = [];
  for (let i = 0; i < ed.foes.length; i++) {
    const r = ed.foes[i], name = clean(r.name), agent = clean(r.agent), stats = {};
    let any = Boolean(agent);
    for (const [f, , long] of statFields(clean(ed.type) || TYPES[0])) {
      const v = whole(r[f]);
      if (v === false) return fail(`Gegner, Zeile ${i + 1}: ${long} muss eine ganze Zahl ab 0 sein.`, `ed-f${i}-${f}`);
      stats[f] = v;
      if (v !== null) any = true;
    }
    if (!name) {
      if (any) return fail(`Gegner, Zeile ${i + 1}: Da fehlt der Name.`, `ed-f${i}-name`);
      continue;
    }
    foes.push({ name, agent, ...stats });
  }

  // Unbekannte Namen: nichts still ins Roster übernehmen, sondern fragen
  // Namen, die schon einmal als "ehemaliger Spieler" gespeichert wurden, sind dabei schon so ausgewählt.
  const unknown = rows.filter((x) => !x.playerId && !x.former);
  const ask = [];
  for (const x of unknown) {
    if (ask.some((a) => a.key === x.key)) continue;
    const old = ed.ask.find((a) => a.key === x.key);
    ask.push({ key: x.key, name: x.name, choice: old ? old.choice : (formerKnown(x.key) ? "ex" : "") });
  }
  // Wer steht am Ende in welcher Zeile? (für die Prüfung auf doppelte Spieler)
  const who = (x) => {
    if (x.playerId) return "p:" + x.playerId;
    const a = ask.find((y) => y.key === x.key);
    return a && a.choice.startsWith("p:") && S.players.some((p) => "p:" + p.id === a.choice) ? a.choice : "n:" + x.key;
  };
  const seen = new Map();
  for (const x of rows) {
    const id = who(x);
    if (seen.has(id)) {
      const first = seen.get(id);
      return fail(`Zeile ${first.i + 1} und Zeile ${x.i + 1} sind derselbe Spieler („${first.name}“ und „${x.name}“). Ein Spieler kann nur einmal im Match stehen.`, `ed-r${x.i}-name`);
    }
    seen.set(id, x);
  }
  const changedAsk = ask.length !== ed.ask.length || ask.some((a, i) => a.key !== ed.ask[i].key);
  ed.ask = ask;
  const open = ask.filter((a) => !(a.choice === "new-stamm" || a.choice === "new-sub" || a.choice === "ex" || S.players.some((p) => "p:" + p.id === a.choice)));
  if (open.length) {
    S.msg = { kind: "error", text: ask.length === 1
      ? `„${ask[0].name}“ steht noch nicht im Roster. Wähl oben aus, wer das ist.`
      : "Einige Namen stehen noch nicht im Roster. Wähl oben aus, wer das jeweils ist." };
    draw();
    const box = $("#ed-ask");
    if (box) box.scrollIntoView({ block: "center" });
    return;
  }
  if (changedAsk) draw();

  const fields = {
    date: ed.date, type: clean(ed.type) || TYPES[0], opponent: clean(ed.opponent), map,
    scoreUs: us, scoreThem: them,
    startSide: ed.startSide, rounds: ed.rounds || null,
    notes: String(ed.notes || "").trim(),
    good: points(ed.good).join("\n"), work: points(ed.work).join("\n"),
    opponents: foes,
  };
  const mine = ed;
  ed.busy = true;
  run(async () => {
    try {
      // Erst das Roster (laut Entscheidung im Formular), dann das Match
      for (const a of ask) {
        let playerId;
        if (a.choice === "ex") {
          // Ehemaliger Spieler: bleibt nur im Scoreboard dieses Matches, kommt nicht ins Roster und zählt nirgends
          for (const x of rows) if (x.key === a.key) x.former = true;
          continue;
        }
        if (a.choice.startsWith("p:")) {
          playerId = a.choice.slice(2);
          await listAdd("players", playerId, "aliases", a.name);
        } else {
          // Anzeigename ohne "#Tag". Der volle Ingame-Name bleibt als Ingame-Name erhalten.
          const shown = clean(a.name.replace(/#.*$/, "")) || a.name;
          playerId = await create("players", {
            name: shown, aliases: shown === a.name ? [] : [a.name],
            role: "Flex", role2: null, status: a.choice === "new-sub" ? "sub" : "stamm", active: true,
          });
        }
        for (const x of rows) if (x.key === a.key) x.playerId = playerId;
      }
      fields.players = rows.map((x) => ({ playerId: x.former ? null : x.playerId, name: x.name, agent: x.agent, ...x.stats, ...(x.former ? { former: true } : {}) }));
      let id = mine.id;
      if (id) await change("matches", id, fields); else id = await create("matches", fields);
      // Agenten-Bilder aus dem Auslesen als Beispiele merken (Korrekturen und erste Bestätigungen). Läuft nebenher:
      // Scheitert es (z. B. weil die Firestore-Regel dafür fehlt), ist das Match trotzdem gespeichert.
      learn([...mine.rows, ...mine.foes]).catch((e) => console.warn("Agenten-Beispiele:", e.message || e));

      const w = count(mine.rounds, "W"), l = count(mine.rounds, "L");
      const off = mine.rounds && !mine.rounds.includes("?") && us !== null && (w !== us || l !== them);
      // Ergebnis automatisch in Discord (nur mit Score und wenn für die Map ein Ziel eingetragen ist)
      const send = anyHook() && wantPostOf(mine) && us !== null && them !== null;
      closeEditor();
      const saved = (mine.id ? "Match gespeichert." : "Match eingetragen.") + (off ? " Hinweis: Der Rundenverlauf passt nicht zum Score." : "");
      toast(saved);
      location.hash = "match-" + id;
      if (send) autoSend(id, saved);
    } finally {
      mine.busy = false;
    }
  }, { demoOk: true });
}

// wantPost für ein Formular, das schon geschlossen wird (ed ist dann null)
function wantPostOf(f) {
  const keep = ed; ed = f;
  try { return wantPost(); } finally { ed = keep; }
}

// Nach dem Speichern posten. Ein Fehler kostet nichts: Das Match ist gespeichert, posten geht auf der Match-Seite von Hand.
async function autoSend(id, saved) {
  const m = S.matches.find((x) => x.id === id);
  if (!m || !hookFor(m)) return;
  try {
    await postMatch(m);
    try { await change("matches", id, { discordAt: Date.now() }); } catch (e) { /* nur ein Merker */ }
    toast(S.demo ? `${saved} Vorschau: Das Ergebnis ginge jetzt an Discord.` : `${saved} Ergebnis in Discord gepostet.`);
  } catch (e) {
    toast(`${saved} Discord: ${e && e.plain ? e.message : "Posten hat nicht geklappt."} Auf der Match-Seite geht es von Hand.`);
  }
}

// ---------- Klicks ----------

// Feld antippen: offen → Sieg → Niederlage → offen
const next = (ch) => ch === "W" ? "L" : ch === "L" ? "?" : "W";

export const actions = {
  "mf-new": () => open(null),
  "mf-edit": (el) => {
    const m = S.matches.find((x) => x.id === el.dataset.id);
    if (m) open(m);
  },
  "mf-close": wantClose,
  "mf-save": save,
  // Schon genannten Punkt an "Üben wir" anhängen
  "mf-work-add": (el) => {
    const box = $("#ed-work");
    if (!box) return;
    const text = el.dataset.text || "";
    if (!points(box.value).some((p) => pointKey(p) === pointKey(text))) box.value = (box.value.trim() ? box.value.trim() + "\n" : "") + text;
    ed.work = box.value;
    const wrap = el.closest(".rv-chips");
    el.remove();
    if (wrap && !wrap.querySelector(".rv-chip")) wrap.remove();
  },
  "mf-post": () => { ed.post = !wantPost(); const b = $("#ed-post"); if (b) { b.setAttribute("aria-pressed", String(ed.post)); b.querySelector(".ed-post-box").textContent = ed.post ? "✓" : ""; } },

  "mf-row-add": () => {
    if (ed.rows.length >= MAX_ROWS) return;
    pull();
    ed.rows.push(rowOf());
    draw();
    if (matchMedia("(pointer: fine)").matches) { const f = $(`#ed-r${ed.rows.length - 1}-name`); if (f) f.focus(); }
  },
  "mf-row-remove": (el) => {
    pull();
    ed.rows.splice(Number(el.dataset.i), 1);
    if (!ed.rows.length) ed.rows.push(rowOf());
    draw();
  },

  // Scoreboard der Gegner
  "mf-foe-add": () => {
    if (ed.foes.length >= MAX_FOES) return;
    pull();
    ed.foes.push(rowOf());
    draw();
    if (matchMedia("(pointer: fine)").matches) { const f = $(`#ed-f${ed.foes.length - 1}-name`); if (f) f.focus(); }
  },
  "mf-foe-remove": (el) => { pull(); ed.foes.splice(Number(el.dataset.i), 1); draw(); },

  // Startseite: noch einmal antippen nimmt die Auswahl zurück
  "mf-side": (el) => { ed.startSide = ed.startSide === el.dataset.side ? null : el.dataset.side; drawRounds(); },
  // Nächste Runde eintragen
  "mf-round": (el) => {
    ed.us = $("#ed-us").value; ed.them = $("#ed-them").value;
    if (ed.rounds.length >= cellCount(ed.rounds, scoreOf(ed.us), scoreOf(ed.them))) return;
    ed.rounds += el.dataset.r === "L" ? "L" : "W";
    drawRounds();
  },
  // Feld antippen: offen → Sieg → Niederlage → offen. Ein Feld weiter hinten geht auch: Die Runden dazwischen
  // bleiben offen ("?"), so lassen sich bei alten Matches z. B. nur die Pistols und Folgerunden nachtragen.
  "mf-cell": (el) => {
    const i = Number(el.dataset.i), r = ed.rounds;
    if (i < r.length) ed.rounds = r.slice(0, i) + next(r[i]) + r.slice(i + 1);
    else ed.rounds = r + "?".repeat(i - r.length) + "W";
    ed.rounds = cleanRounds(ed.rounds);
    drawRounds();
  },
  "mf-round-undo": () => { ed.rounds = cleanRounds(ed.rounds.slice(0, -1)); drawRounds(); },
  "mf-rounds-clear": () => { ed.rounds = ""; drawRounds(); },
  "mf-score-from-rounds": () => {
    const w = count(ed.rounds, "W");
    $("#ed-us").value = String(w);
    $("#ed-them").value = String(count(ed.rounds, "L"));
    drawRounds();
  },

  // Screenshot auslesen
  "mf-scan": runScan,
  "mf-scan-drop": (el) => { if (ed.scan.busy) return; pull(); ed.scan[el.dataset.kind === "line" ? "line" : "board"] = null; draw(); },
  // Abweichung: den Wert aus dem Bild nehmen (einzeln oder alle) oder alles so lassen
  "mf-scan-take": (el) => {
    const rep = ed.scan.report, c = rep && rep.conflicts[Number(el.dataset.i)];
    if (!c) return;
    pull(); c.apply(); draw();
  },
  "mf-scan-take-all": () => {
    const rep = ed.scan.report;
    if (!rep) return;
    pull();
    for (const c of rep.conflicts) if (!c.row || alive(c.row)) c.apply();
    draw();
  },
  "mf-scan-keep": () => { if (ed.scan.report) { pull(); ed.scan.report.conflicts = []; draw(); } },
  "mf-scan-copy": async () => {
    const el = $("#ed-scan-token");
    if (el) toast((await copyText(el.textContent)) ? "Debug-Token kopiert." : "Kopieren hat nicht geklappt. Markier den Token und kopier ihn von Hand.");
  },

  "mf-ask-delete": () => { pull(); ed.confirm = "delete"; S.msg = null; draw(); showFoot(); },
  "mf-confirm-cancel": () => { pull(); ed.confirm = null; draw(); },
  "mf-discard": closeEditor,
  "mf-delete": () => {
    if (!ed || !ed.id || ed.busy) return;
    const mine = ed;
    ed.busy = true;
    run(async () => {
      try {
        await remove("matches", mine.id);
        closeEditor();
        toast("Match gelöscht.");
        location.hash = "matches";
      } finally {
        mine.busy = false;
      }
    }, { demoOk: true });
  },
};

// Datei-Felder (data-change): Ein Screenshot wurde gewählt
export const changes = {
  // Art geändert: Bei Premier kommt die Spalte "Trades" dazu, sonst fällt sie weg
  "mf-type": () => { if (ed) { pull(); draw(); } },
  "mf-scan-file": (el) => {
    const file = el.files && el.files[0];
    if (!ed || ed.scan.busy || !file) return;
    if (!isImage(file)) { el.value = ""; toast("Das ist kein Bild. Wähl bitte einen Screenshot."); return; }
    takeScan([file], el.dataset.kind, false);
  },
};

// ---------- Screenshots reinziehen oder einfügen (Strg + V) ----------
// Statt über "Bild wählen" (Explorer) kommen die Bilder auch per Ziehen auf das Formular oder aus der
// Zwischenablage (z. B. nach Windows + Umschalt + S). kind = Feld, auf das gezogen wurde; ohne kind erst das freie Feld.

const isImage = (f) => Boolean(f) && (!f.type || f.type.startsWith("image/"));

// files: Bilder in der Reihenfolge, in der sie kamen. Zwei Bilder auf einmal füllen beide Felder.
function takeScan(files, kind, say = true) {
  if (!ed || ed.scan.busy) return;
  const pics = files.filter(isImage).slice(0, 2);
  if (!pics.length) { toast("Das ist kein Bild. Zieh bitte einen Screenshot hierher."); return; }
  const sc = ed.scan;
  let order;
  if (kind === "board" || kind === "line") order = [kind, kind === "board" ? "line" : "board"];
  else if (pics.length > 1) order = ["board", "line"];
  else order = [!sc.board ? "board" : !sc.line ? "line" : "board"];
  pull();
  pics.forEach((f, i) => { sc[order[i]] = f; });
  draw();
  if (say) toast(pics.length > 1 ? "Zwei Bilder übernommen: erst Scoreboard, dann Timeline. Bei Bedarf tauschen." : `Bild übernommen (${order[0] === "board" ? "Scoreboard" : "Timeline"}).`);
}

const typesOf = (e) => (e.dataTransfer ? [...(e.dataTransfer.types || [])] : []);
const dragFiles = (e) => typesOf(e).includes("Files");
// Aus Discord (oder einer Webseite) kommt oft keine Datei, sondern nur die Adresse des Bildes
const dragLink = (e) => typesOf(e).some((t) => t === "text/uri-list" || t === "text/html");
const slotOf = (el) => (el && el.closest ? el.closest("[data-scan-slot]") : null);
// Ein Link oder Text, der in ein Textfeld gezogen wird, landet dort wie immer
const inText = (el) => Boolean(el && el.closest && el.closest("input, textarea, select")) && !slotOf(el);

// Adresse des gezogenen Bildes: erst das <img> aus dem HTML, sonst die erste Adresse der Liste. Nur http(s).
function linkOf(dt) {
  const html = dt.getData("text/html") || "";
  const img = /<img[^>]+src\s*=\s*["']([^"']+)["']/i.exec(html);
  const list = (dt.getData("text/uri-list") || "").split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
  for (const raw of [img && img[1].replace(/&amp;/g, "&"), list[0]]) {
    try { const u = new URL(raw); if (u.protocol === "https:" || u.protocol === "http:") return u; } catch (e) { /* weiter */ }
  }
  return null;
}

// Bild von seiner Adresse holen. Discord: Die Vorschau (media.discordapp.net) ist verkleinert und lässt sich nicht
// immer laden, deshalb zuerst das Original auf cdn.discordapp.com. Geht nichts, hilft "Bild kopieren" + Strg + V.
async function fromLink(url, kind) {
  const tries = [];
  if (url.hostname === "media.discordapp.net") {
    const cdn = new URL(url.href);
    cdn.hostname = "cdn.discordapp.com";
    for (const k of ["format", "width", "height", "quality"]) cdn.searchParams.delete(k);
    tries.push(cdn.href);
  }
  tries.push(url.href);
  toast("Bild wird geladen …");
  for (const href of tries) {
    try {
      const res = await fetch(href, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer" });
      if (!res.ok) continue;
      const blob = await res.blob();
      if (!blob.type.startsWith("image/")) continue;
      let name = "";
      try { name = decodeURIComponent(new URL(href).pathname.split("/").pop() || ""); } catch (e) { /* bleibt leer */ }
      takeScan([new File([blob], name || "Bild aus Discord", { type: blob.type })], kind);
      return;
    } catch (e) { /* nächster Versuch */ }
  }
  toast("Das Bild ließ sich von dort nicht laden. In Discord: Rechtsklick auf das Bild → „Bild kopieren“, dann hier Strg + V.");
}
let lit = null;   // Feld, über dem gerade ein Bild schwebt
const light = (slot) => {
  if (lit === slot) return;
  if (lit) lit.classList.remove("drop");
  lit = slot;
  if (lit) lit.classList.add("drop");
};

// Solange das Formular offen ist, landet ein Bild nie als neue Seite im Browser (sonst wäre das Formular weg)
document.addEventListener("dragover", (e) => {
  if (!ed) return;
  const files = dragFiles(e);
  if (!files && !dragLink(e)) return;
  if (!files && inText(e.target)) return;
  e.preventDefault();
  const busy = ed.scan.busy;
  e.dataTransfer.dropEffect = busy ? "none" : "copy";
  light(busy ? null : slotOf(e.target));
});
document.addEventListener("dragleave", (e) => { if (ed && !e.relatedTarget) light(null); });
document.addEventListener("drop", (e) => {
  if (!ed) return;
  const files = dragFiles(e) ? [...e.dataTransfer.files] : [];
  if (!files.length && (!dragLink(e) || inText(e.target))) return;
  e.preventDefault();
  const slot = slotOf(e.target), kind = slot ? slot.dataset.scanSlot : null;
  light(null);
  if (ed.scan.busy) return;
  if (files.length) { takeScan(files, kind); return; }
  const url = linkOf(e.dataTransfer);
  if (url) fromLink(url, kind);
  else toast("Das ist kein Bild. Zieh bitte einen Screenshot hierher.");
});

document.addEventListener("paste", (e) => {
  if (!ed || !e.clipboardData) return;
  const files = [...e.clipboardData.files].filter(isImage);
  if (!files.length) return;   // Text wird ganz normal eingefügt
  e.preventDefault();
  takeScan(files.map((f, i) => (f.name && f.name !== "image.png" ? f : new File([f], `Eingefügtes Bild${files.length > 1 ? " " + (i + 1) : ""}.png`, { type: f.type || "image/png" }))), null);
});

// Ändert sich der Score, ändert sich auch der Hinweis beim Rundenverlauf (und die Zahl der Felder)
// Zahlenfelder sind bewusst einfache Textfelder mit Ziffern-Tastatur (inputmode), keine type="number"-Felder:
// Die schlucken je nach Browser Eingaben, ohne etwas zu zeigen. Hier bleiben nur Ziffern stehen.
document.addEventListener("input", (e) => {
  const el = e.target;
  if (!ed || !el.classList || !el.classList.contains("numf")) return;
  // "15:9" (auch mit "-" oder Leerzeichen) im ersten Score-Feld: auf beide Felder verteilen
  const both = el.id === "ed-us" ? /^(\d{1,2})\s*[:\-–\s]\s*(\d{0,2})$/.exec(el.value) : null;
  if (both) {
    const them = $("#ed-them");
    el.value = both[1];
    them.value = both[2];
    them.focus();
  } else {
    const digits = el.value.replace(/\D/g, "").slice(0, el.id === "ed-us" || el.id === "ed-them" ? 2 : 3);
    if (digits !== el.value) el.value = digits;
  }
  if (el.id === "ed-us" || el.id === "ed-them") drawRounds();
});
document.addEventListener("keydown", (e) => {
  if (ed && e.key === "Escape") { e.preventDefault(); wantClose(); }
});
