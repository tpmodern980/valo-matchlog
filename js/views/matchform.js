// Formular "Match eintragen / bearbeiten". Es liegt als Überlagerung im Bereich #editor (außerhalb von #view),
// damit Eingaben erhalten bleiben, wenn die Seite darunter neu gezeichnet wird.
// Alle Eingaben stehen als Text in "ed" (dem Modell). Vor jedem Neuzeichnen holt pull() die Felder dorthin.
import { S } from "../state.js";
import { MAPS, AGENTS, TYPES, STAT_FIELDS } from "../constants.js";
import { $, esc, norm, today, toast } from "../util.js";
import { roundInfo, sortMatches } from "../stats.js";
import { create, change, remove, listAdd } from "../data.js";
import { run, setMsg, msgBox } from "./auth.js";

const SIDE = { atk: "Angriff", def: "Verteidigung" };
const MAX_ROWS = 10;
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

// ---------- Modell ----------

function rowOf(seed = {}) {
  const row = { playerId0: seed.playerId || null, name0: seed.name || "", name: seed.name || "", agent: seed.agent || "" };
  for (const [f] of STAT_FIELDS) row[f] = seed[f] === null || seed[f] === undefined ? "" : String(seed[f]);
  return row;
}

// Vorschlag für ein neues Match: die Aufstellung des letzten Matches, sonst die Stammspieler
function lineup() {
  const last = sortMatches(S.matches).find((m) => (m.players || []).length);
  const known = last ? last.players.filter((r) => r.name && S.players.some((p) => p.id === r.playerId)) : [];
  if (known.length) return known.slice(0, 5).map((r) => ({ playerId: r.playerId, name: r.name }));
  return S.players.filter((p) => p.status !== "sub").sort(byName).slice(0, 5).map((p) => ({ playerId: p.id, name: p.name }));
}

const snapshot = () => JSON.stringify([ed.date, ed.type, ed.opponent, ed.map, ed.us, ed.them, ed.notes, ed.startSide, ed.rounds,
  ed.rows.map((r) => [r.name, r.agent, ...STAT_FIELDS.map(([f]) => r[f])])]);

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
    startSide: m.startSide === "atk" || m.startSide === "def" ? m.startSide : null,
    rounds: typeof m.rounds === "string" ? m.rounds.toUpperCase().replace(/[^WL]/g, "") : "",
    rows,
    ask: [],            // unbekannte Namen: [{ key, name, choice }]
    confirm: null,      // Rückfrage in der Fußzeile: "delete" | "discard" | null
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

function rowHtml(row, i) {
  const n = i + 1;
  const stat = ([f, short, long]) => `<label class="mini"><span>${esc(short)}</span>
      <input type="text" class="numf" inputmode="numeric" pattern="[0-9]*" maxlength="3" autocomplete="off" id="ed-r${i}-${f}" data-row="${i}" data-f="${f}" value="${esc(row[f])}" aria-label="${esc(long)}, Zeile ${n}"></label>`;
  return `<div class="mp-row">
    <label class="mini mp-name"><span>Spieler</span>
      <input type="text" list="dl-players" id="ed-r${i}-name" data-row="${i}" data-f="name" value="${esc(row.name)}" maxlength="40" placeholder="Ingame-Name" autocomplete="off" autocapitalize="none" spellcheck="false" aria-label="Spieler, Zeile ${n}"></label>
    <label class="mini mp-agent"><span>Agent</span>
      <input type="text" list="dl-agents" id="ed-r${i}-agent" data-row="${i}" data-f="agent" value="${esc(row.agent)}" maxlength="20" placeholder="Agent" autocomplete="off" spellcheck="false" aria-label="Agent, Zeile ${n}"></label>
    ${STAT_FIELDS.map(stat).join("")}
    <button class="alias-x mp-x" type="button" id="ed-r${i}-x" data-action="mf-row-remove" data-i="${i}" aria-label="Zeile ${n} entfernen" title="Zeile entfernen">×</button>
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
  const r = ed.rounds, len = r.length, w = count(r, "W"), l = len - w;
  const cells = cellCount(r, us, them), full = len >= cells;
  const start = ed.startSide, other = start === "atk" ? "def" : "atk";

  const half = (label, from, to, side) => {
    if (from >= cells) return "";
    let hw = 0, hl = 0, out = "";
    for (let i = from; i < Math.min(to, cells); i++) {
      const v = r[i] || "", pistol = i === 0 || i === 12;
      if (v === "W") hw++; else if (v === "L") hl++;
      const state = v === "W" ? "Sieg" : v === "L" ? "Niederlage" : "offen";
      out += `<button type="button" class="rd rdb ${v || "E"}${pistol ? " pistol" : ""}${i === len ? " next" : ""}" id="ed-rd-${i}" data-action="mf-cell" data-i="${i}"${i > len ? " disabled" : ""} aria-label="Runde ${i + 1}${pistol ? " (Pistol)" : ""}: ${state}"><small>${i + 1}</small><b>${v === "W" ? "S" : v === "L" ? "N" : ""}</b></button>`;
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
  if (len) {
    if (us === null || them === null) note = `<p class="notice">Es ist noch kein Score eingetragen. ${take(`Score ${w}:${l} aus dem Verlauf übernehmen`)}</p>`;
    else if (w === us && l === them) note = `<p class="rd-ok">Passt zum Score ${us}:${them}.</p>`;
    else if (w <= us && l <= them) {
      const miss = us + them - len;
      note = `<p class="notice">Der Verlauf steht bei ${w}:${l}, der Score ist ${us}:${them}: ${miss === 1 ? "Es fehlt noch 1 Runde" : `Es fehlen noch ${miss} Runden`}. Speichern geht trotzdem.</p>`;
    } else note = `<p class="notice">Der Verlauf ergibt ${w}:${l}, als Score steht ${us}:${them} da. Speichern geht trotzdem. ${take(`Score ${w}:${l} übernehmen`)}</p>`;
    if (!start) note += '<p class="hint">Ohne Startseite zählt der Verlauf nur für die Pistol-Runden, nicht für Angriff und Verteidigung.</p>';
  }

  const now = full
    ? `<b>${len} Runden eingetragen</b><span>Stand ${w}:${l}</span>`
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
      <p class="hint">Tipp auf „Sieg“ oder „Niederlage“ für die nächste Runde. Ein Feld antippen dreht die Runde um. Unterstrichen = Pistol-Runde.${len ? ' <button class="linkish" type="button" id="ed-rd-clear" data-action="mf-rounds-clear">Verlauf leeren</button>' : ""}</p>
    </div>`;
}

function askHtml() {
  if (!ed.ask.length) return "";
  const players = S.players.slice().sort(byName);
  const items = ed.ask.map((a, i) => `<label class="field"><span>„${esc(a.name)}“ ist …</span>
      <select id="ed-ask-${i}" data-ask="${esc(a.key)}">
        ${option("", "Bitte wählen …", a.choice)}
        ${option("new-stamm", "ein neuer Stammspieler", a.choice)}
        ${option("new-sub", "ein neuer Sub", a.choice)}
        ${players.length ? `<optgroup label="ein Ingame-Name von …">${players.map((p) => option("p:" + p.id, p.name, a.choice)).join("")}</optgroup>` : ""}
      </select></label>`).join("");
  return `<section class="panel ask" id="ed-ask"><div class="panel-head"><h2>Unbekannte Namen</h2></div>
    <div class="panel-body">
      <p class="hint">${ed.ask.length === 1 ? "Dieser Name steht" : "Diese Namen stehen"} noch nicht im Roster. Sag kurz, wer das ist, dann tipp noch einmal auf „Speichern“. Bei einem bestehenden Spieler wird der Name als Ingame-Name ergänzt. Neue Spieler bekommen erst die Rolle „Flex“ (änderbar im Tab „Spieler“).</p>
      ${items}
    </div></section>`;
}

function footHtml() {
  if (ed.confirm === "delete") {
    return `<div class="confirm"><span>Dieses Match wirklich löschen? Es verschwindet für alle aus der App.</span>
      <button class="btn small danger solid" type="button" id="ed-del-yes" data-action="mf-delete">Löschen</button>
      <button class="btn small" type="button" id="ed-del-no" data-action="mf-confirm-cancel">Abbrechen</button></div>`;
  }
  if (ed.confirm === "discard") {
    return `<div class="confirm"><span>Deine Eingaben sind noch nicht gespeichert. Wirklich verwerfen?</span>
      <button class="btn small danger solid" type="button" id="ed-drop-yes" data-action="mf-discard">Verwerfen</button>
      <button class="btn small" type="button" id="ed-drop-no" data-action="mf-confirm-cancel">Weiter bearbeiten</button></div>`;
  }
  return `${ed.id ? '<button class="btn danger" type="button" id="ed-del" data-action="mf-ask-delete">Match löschen</button>' : ""}
    <div class="foot-btns"><button class="btn ghost" type="button" id="ed-cancel" data-action="mf-close">Abbrechen</button>
      <button class="btn primary" type="button" id="ed-save" data-action="mf-save">Speichern</button></div>`;
}

function sheet() {
  const types = TYPES.includes(ed.type) ? TYPES : [...TYPES, ed.type];
  return `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="ed-title">
    <div class="sheet-head"><h2 id="ed-title">${ed.id ? "Match bearbeiten" : "Match eintragen"}</h2>
      <button class="icon-btn" type="button" id="ed-close" data-action="mf-close" aria-label="Schließen">✕</button></div>
    <div class="sheet-body">
      <div class="grid-form">
        <label class="field"><span>Datum</span><input type="date" id="ed-date" data-f="date" value="${esc(ed.date)}"></label>
        <label class="field"><span>Art</span><select id="ed-type" data-f="type">${types.map((t) => option(t, t, ed.type)).join("")}</select></label>
        <label class="field"><span>Gegner</span><input type="text" id="ed-opponent" data-f="opponent" list="dl-opponents" maxlength="60" value="${esc(ed.opponent)}" placeholder="Teamname" autocomplete="off"></label>
        <label class="field"><span>Map</span><input type="text" id="ed-map" data-f="map" list="dl-maps" maxlength="30" value="${esc(ed.map)}" placeholder="z. B. Ascent" autocomplete="off"></label>
        <div class="field"><span>Score (wir : die)</span><div class="scorebox">
          <input type="text" class="numf" inputmode="numeric" pattern="[0-9]*" maxlength="5" autocomplete="off" id="ed-us" data-f="us" value="${esc(ed.us)}" placeholder="wir" aria-label="Unsere Runden"><b>:</b>
          <input type="text" class="numf" inputmode="numeric" pattern="[0-9]*" maxlength="2" autocomplete="off" id="ed-them" data-f="them" value="${esc(ed.them)}" placeholder="die" aria-label="Runden der Gegner"></div></div>
      </div>

      <section class="panel"><div class="panel-head"><h2>Spieler</h2><span class="hint">Leere Felder bleiben leer und zählen nicht mit</span></div>
        <div class="panel-body">
          <div class="mp-list">
            <div class="mp-head" aria-hidden="true"><span>Spieler</span><span>Agent</span>${STAT_FIELDS.map(([, short, long]) => `<span title="${esc(long)}">${esc(short)}</span>`).join("")}<span></span></div>
            ${ed.rows.map(rowHtml).join("")}
          </div>
          <div class="actions mp-tools"><button class="btn small" type="button" id="ed-row-add" data-action="mf-row-add"${ed.rows.length >= MAX_ROWS ? " disabled" : ""}>+ Zeile</button>
            <span class="hint">K = Kills, D = Deaths, A = Assists, FB = First Bloods</span></div>
        </div></section>

      <section class="panel" id="ed-rounds">${roundsInner()}</section>

      <label class="field"><span>Notizen</span><textarea id="ed-notes" data-f="notes" maxlength="2000" rows="3" placeholder="Was lief gut, was nicht? Strats, Tendenzen der Gegner …">${esc(ed.notes)}</textarea></label>

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
    for (const [f, , long] of STAT_FIELDS) {
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
    let playerId = r.playerId0 && norm(r.name0) === key ? r.playerId0 : null;
    if (!playerId) { const p = findPlayer(key); playerId = p ? p.id : null; }
    rows.push({ i, name, key, agent, stats, playerId });
  }

  // Unbekannte Namen: nichts still ins Roster übernehmen, sondern fragen
  const unknown = rows.filter((x) => !x.playerId);
  const ask = [];
  for (const x of unknown) {
    if (ask.some((a) => a.key === x.key)) continue;
    const old = ed.ask.find((a) => a.key === x.key);
    ask.push({ key: x.key, name: x.name, choice: old ? old.choice : "" });
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
  const open = ask.filter((a) => !(a.choice === "new-stamm" || a.choice === "new-sub" || S.players.some((p) => "p:" + p.id === a.choice)));
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
  };
  const mine = ed;
  ed.busy = true;
  run(async () => {
    try {
      // Erst das Roster (laut Entscheidung im Formular), dann das Match
      for (const a of ask) {
        let playerId;
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
      fields.players = rows.map((x) => ({ playerId: x.playerId, name: x.name, agent: x.agent, ...x.stats }));
      let id = mine.id;
      if (id) await change("matches", id, fields); else id = await create("matches", fields);

      const w = count(mine.rounds, "W"), l = mine.rounds.length - w;
      const off = mine.rounds && us !== null && (w !== us || l !== them);
      closeEditor();
      toast((mine.id ? "Match gespeichert." : "Match eingetragen.") + (off ? " Hinweis: Der Rundenverlauf passt nicht zum Score." : ""));
      location.hash = "match-" + id;
    } finally {
      mine.busy = false;
    }
  }, { demoOk: true });
}

// ---------- Klicks ----------

const flip = (ch) => ch === "W" ? "L" : "W";

export const actions = {
  "mf-new": () => open(null),
  "mf-edit": (el) => {
    const m = S.matches.find((x) => x.id === el.dataset.id);
    if (m) open(m);
  },
  "mf-close": wantClose,
  "mf-save": save,

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

  // Startseite: noch einmal antippen nimmt die Auswahl zurück
  "mf-side": (el) => { ed.startSide = ed.startSide === el.dataset.side ? null : el.dataset.side; drawRounds(); },
  // Nächste Runde eintragen
  "mf-round": (el) => {
    ed.us = $("#ed-us").value; ed.them = $("#ed-them").value;
    if (ed.rounds.length >= cellCount(ed.rounds, scoreOf(ed.us), scoreOf(ed.them))) return;
    ed.rounds += el.dataset.r === "L" ? "L" : "W";
    drawRounds();
  },
  // Feld antippen: eingetragene Runde umdrehen, das nächste offene Feld wird ein Sieg (zweimal tippen = Niederlage)
  "mf-cell": (el) => {
    const i = Number(el.dataset.i), r = ed.rounds;
    if (i < r.length) ed.rounds = r.slice(0, i) + flip(r[i]) + r.slice(i + 1);
    else if (i === r.length) ed.rounds = r + "W";
    drawRounds();
  },
  "mf-round-undo": () => { ed.rounds = ed.rounds.slice(0, -1); drawRounds(); },
  "mf-rounds-clear": () => { ed.rounds = ""; drawRounds(); },
  "mf-score-from-rounds": () => {
    const w = count(ed.rounds, "W");
    $("#ed-us").value = String(w);
    $("#ed-them").value = String(ed.rounds.length - w);
    drawRounds();
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
