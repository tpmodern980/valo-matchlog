// Map-Veto-Helfer (#veto, Wunsch Tim, 22.11.2026). Erreichbar über den Tab "Maps".
//   1. Rangliste: welche Maps picken, welche bannen. Gewichtet vor allem nach der Map-Pool-Umfrage (Sterne und
//      Bann-Stimmen, js/views/mappool.js), dazu eure Winrate und, wenn ein Gegner gewählt ist, eure Bilanz gegen ihn.
//   2. Live-Veto Schritt für Schritt. Art (Premier, Turnier, Scrim) und Format (BO1, BO3, BO5) wählt ihr selbst
//      (Wunsch Tim, 22.11.2026: auch Turniere sind meist BO1, nur Halbfinale und Finale BO3).
//      BO1: abwechselnd bannen, bis eine Map übrig ist. BO3: Ban, Ban, Pick, Pick, dann bannen bis zum Decider.
//      BO5: bannen, bis 5 Maps übrig sind, dann vier Picks, die letzte Map ist der Decider.
//      Bei euren Schritten schlägt die App eine Map vor, bei den Schritten des Gegners tippt ihr an, was er gewählt hat.
//   3. Speichern: weeks/<id> = { kind: "veto", type, format, opponent, date, first, pool, steps: [{ who, act, map }], maps, by, at }
//      (Sammlung "weeks", dieselbe Firestore-Regel wie die Planung). Die Match-Seite zeigt das Veto, wenn Datum und
//      Gegner passen (vetoForMatch).
import { S, changed } from "../state.js";
import { esc, norm, pct, isoDate, fmtDate, toast } from "../util.js";
import { create, remove } from "../data.js";
import { mapStats } from "../stats.js";
import { errorText } from "../auth.js";
import { currentPool, results } from "./mappool.js";

const TYPES = ["Premier", "Turnier", "Scrim"];
const FORMATS = { bo1: "BO1", bo3: "BO3", bo5: "BO5" };
// "Turnier · BO3"; ältere Vetos ohne Art: nur das Format
export const vetoLabel = (x) => [x.type || "", FORMATS[x.format] || ""].filter(Boolean).join(" · ");
const multi = (f) => f === "bo3" || f === "bo5";
// "Wir bannen Bind" / "Gegner bannt Bind"
const ACT = { us: { ban: "bannen", pick: "picken" }, them: { ban: "bannt", pick: "pickt" } };
const actText = (s) => ((ACT[s.who] || ACT.them)[s.act] || "");
const WHO = { us: "Wir", them: "Gegner" };

// Zustand des Live-Vetos (nur im Arbeitsspeicher, bis gespeichert wird)
const v = { type: "Premier", format: "bo1", opponent: "", date: "", first: "us", out: [], steps: [], saved: false };
let busy = false;

const fail = (e) => toast(e && e.plain ? e.message : (errorText(e) || "Das hat nicht geklappt."));
const who = () => (S.user && (S.user.name || (S.user.email || "").split("@")[0])) || "";
const other = (x) => (x === "us" ? "them" : "us");

// ---------- Bewertung ----------

// Pro Map ein Wert zwischen etwa 0 und 1 (höher = lieber spielen). Gewichtung "vor allem Umfrage" (Entscheidung Tim):
//   55 % Ø Sterne, 20 % eure Winrate, 10 % Bilanz gegen diesen Gegner (sonst wieder die Winrate), minus Bann-Stimmen.
// Winrates werden zur Mitte gezogen ((Siege + 1) / (Matches + 2)), damit 1–0 nicht wie 100 % zählt.
export function rateMaps(pool, opponent) {
  const res = results(pool);
  const voters = Math.max(1, res.voters.length);
  const vs = opponent ? new Map(mapStats(S.matches.filter((m) => norm(m.opponent) === norm(opponent))).map((s) => [s.key, s])) : new Map();
  return res.rows.map((r) => {
    const st = r.st, o = vs.get(norm(r.map)) || null;
    const decided = (t) => (t ? t.w + t.l + t.d : 0);
    const wr = (decided(st) ? st.w + 1 : 1) / (decided(st) + 2);
    const owr = decided(o) ? (o.w + 1) / (decided(o) + 2) : null;
    const stars = r.avg === null ? 0.5 : (r.avg - 1) / 4;
    const ban = r.bans.length / voters;
    const score = 0.55 * stars + 0.2 * wr + 0.1 * (owr ?? wr) + 0.15 - 0.3 * ban;
    const bits = [
      r.avg === null ? "noch keine Sterne" : `★ ${r.avg.toFixed(1).replace(".", ",")}`,
      r.bans.length ? `${r.bans.length}× Bann-Wunsch` : "",
      decided(st) ? `${st.w}–${st.l}${st.d ? "–" + st.d : ""} (${pct(st.w / decided(st))})` : "noch nicht gespielt",
      o && decided(o) ? `gegen ${opponent}: ${o.w}–${o.l}${o.d ? "–" + o.d : ""}` : "",
    ].filter(Boolean);
    return { map: r.map, score, avg: r.avg, bans: r.bans, st, o, why: bits.join(" · ") };
  }).sort((a, b) => b.score - a.score || a.map.localeCompare(b.map, "de"));
}

// ---------- Ablauf ----------

// Wer ist wann dran? Liefert die Schritte für einen Pool mit n Maps.
// BO1: abwechselnd bannen, bis eine Map übrig ist (die wird gespielt).
// BO3: Ban, Ban, Pick, Pick, danach abwechselnd bannen, bis eine Map übrig ist (Decider).
// BO5: abwechselnd bannen, bis 5 Maps übrig sind, dann vier Picks; die letzte Map ist der Decider.
function plan(format, first, n) {
  const out = [];
  let turn = first;
  const push = (act) => { out.push({ who: turn, act }); turn = other(turn); };
  if (format === "bo3" && n >= 5) {
    push("ban"); push("ban"); push("pick"); push("pick");
    for (let left = n - 4; left > 1; left--) push("ban");
  } else if (format === "bo5" && n >= 5) {
    for (let left = n; left > 5; left--) push("ban");
    push("pick"); push("pick"); push("pick"); push("pick");
  } else {
    for (let left = n; left > 1; left--) push("ban");
  }
  return out;
}

const poolNow = () => currentPool().maps.filter((m) => !v.out.includes(m));
const taken = () => new Set(v.steps.map((s) => s.map));
const remaining = () => poolNow().filter((m) => !taken().has(m));
const order = () => plan(v.format, v.first, poolNow().length);
// Fertig: alle Schritte gemacht. Gespielt wird: BO3 die zwei Picks und der Decider, BO1 die letzte Map.
const finished = () => order().length > 0 && v.steps.length >= order().length;
function playedMaps() {
  const left = remaining();
  if (multi(v.format)) return [...v.steps.filter((s) => s.act === "pick").map((s) => s.map), ...left];
  return left;
}

// ---------- Ansicht ----------

const seg = (action, cur, list) => `<div class="seg" role="group" style="grid-template-columns: repeat(${list.length}, minmax(0, 1fr))">${list.map(([val, label]) =>
  `<button type="button" data-action="${action}" data-v="${val}" aria-pressed="${cur === val}">${esc(label)}</button>`).join("")}</div>`;

function setupPanel(pool) {
  const opps = [...new Set(S.matches.map((m) => String(m.opponent || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
  const all = currentPool().maps;
  const chips = all.map((m) => `<button type="button" class="vt-pool${v.out.includes(m) ? " out" : ""}" data-action="veto-pool" data-map="${esc(m)}" aria-pressed="${!v.out.includes(m)}"${v.steps.length ? " disabled" : ""}>${esc(m)}</button>`).join("");
  return `<section class="panel"><div class="panel-head"><h2>Vorbereitung</h2><span class="hint">${pool.length} Maps im Pool</span></div>
    <div class="panel-body vt-setup">
      <div class="field"><span>Art</span>${seg("veto-type", v.type, TYPES.map((t) => [t, t]))}</div>
      <div class="field"><span>Format</span>${seg("veto-format", v.format, Object.entries(FORMATS))}</div>
      <label class="field"><span>Gegner (freiwillig)</span><input type="text" id="vt-opp" data-change="veto-opp" list="vt-opps" maxlength="40" value="${esc(v.opponent)}" placeholder="Teamname" autocomplete="off">
        <datalist id="vt-opps">${opps.map((o) => `<option value="${esc(o)}">`).join("")}</datalist></label>
      <label class="field"><span>Datum</span><input type="date" id="vt-date" data-change="veto-date" value="${esc(v.date || isoDate(new Date()))}"></label>
      <div class="field"><span>Wer fängt an?</span>${seg("veto-first", v.first, [["us", "Wir"], ["them", "Gegner"]])}</div>
      <div class="field wide"><span>Map-Pool ${v.steps.length ? "(steht fest, sobald das Veto läuft)" : "(antippen = für dieses Veto raus)"}</span><div class="vt-pools">${chips}</div></div>
      ${currentPool().from === "drive" ? '<p class="hint wide">Der Pool kommt aus dem Strats-Ordner (aktive Maps).</p>' : '<p class="hint wide">Ohne Strats-Ordner stehen alle Maps da. Nimm die raus, die gerade nicht im Pool sind (Premier hat 7 Maps).</p>'}
    </div></section>`;
}

function rankPanel(rated) {
  const n = rated.length, pickN = Math.min(3, Math.floor(n / 3)), banN = Math.min(3, Math.floor(n / 3));
  const rows = rated.map((r, i) => {
    const tag = i < pickN ? ["pick", "Picken"] : i >= n - banN ? ["ban", "Bannen"] : ["mid", ""];
    return `<div class="vt-rank ${tag[0]}"><b class="vt-no">${i + 1}</b><div class="vt-what"><b>${esc(r.map)}</b><small>${esc(r.why)}</small></div>${tag[1] ? `<span class="vt-tag ${tag[0]}">${tag[1]}</span>` : ""}</div>`;
  }).join("");
  return `<section class="panel"><div class="panel-head"><h2>Rangliste</h2><span class="hint">vor allem nach eurer Map-Pool-Umfrage${v.opponent ? ` · mit ${esc(v.opponent)}` : ""}</span></div>
    <div class="panel-body"><div class="vt-ranks">${rows}</div>
    <p class="hint">Grundlage: Ø Sterne und Bann-Wünsche aus der Umfrage im Tab „Maps“ (zählt am meisten), eure Bilanz auf der Map${v.opponent ? " und gegen diesen Gegner" : ""}. Wenige Matches zählen weniger.</p></div></section>`;
}

function livePanel(rated) {
  const steps = order(), left = remaining(), done = finished();
  const score = new Map(rated.map((r) => [r.map, r.score]));
  const history = v.steps.map((s, i) => `<li class="${s.who}"><span>${i + 1}.</span> <b>${WHO[s.who]}</b> ${actText(s)} <b>${esc(s.map)}</b></li>`).join("");
  let body;
  if (!steps.length) body = '<p class="hint">Zu wenige Maps im Pool.</p>';
  else if (done) {
    const maps = playedMaps();
    body = `<div class="vt-result"><span>Gespielt wird</span><b>${maps.map(esc).join(" → ")}</b>${multi(v.format) && maps.length > 1 ? `<small>${maps.slice(0, -1).map((_, i) => `Map ${i + 1}`).join(" · ")} · Decider</small>` : ""}</div>
      <div class="actions">${v.saved ? '<span class="tag">gespeichert</span>' : `<button class="btn primary" type="button" data-action="veto-save"${busy ? " disabled" : ""}>Veto speichern</button>`}
        <button class="btn" type="button" data-action="veto-undo">Zurück</button>
        <button class="btn ghost" type="button" data-action="veto-reset">Neues Veto</button></div>
      ${v.saved ? "" : '<p class="hint">Gespeichert erscheint das Veto auf der Seite des Matches (gleiches Datum und gleicher Gegner).</p>'}`;
  } else {
    const step = steps[v.steps.length];
    const ours = step.who === "us";
    // Vorschlag: beim Bannen die schwächste, beim Picken die stärkste übrige Map
    const sorted = left.slice().sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0));
    const tip = ours ? (step.act === "pick" ? sorted[0] : sorted[sorted.length - 1]) : null;
    const title = ours ? `Ihr ${step.act === "pick" ? "pickt" : "bannt"}` : `Der Gegner ${step.act === "pick" ? "pickt" : "bannt"}`;
    const btns = sorted.map((m) => `<button type="button" class="vt-map${m === tip ? " tip" : ""}" data-action="veto-step" data-map="${esc(m)}">${esc(m)}${m === tip ? "<small>Vorschlag</small>" : ""}</button>`).join("");
    body = `<div class="vt-now ${ours ? "us" : "them"}"><span>Schritt ${v.steps.length + 1} von ${steps.length}</span><b>${title}</b>
        <small>${ours ? `Vorschlag: <b>${esc(tip)}</b>. Tipp die Map an, die ihr ${step.act === "pick" ? "pickt" : "bannt"}.` : `Tipp an, welche Map der Gegner ${step.act === "pick" ? "gepickt" : "gebannt"} hat.`}</small></div>
      <div class="vt-maps">${btns}</div>
      <div class="actions"><button class="btn" type="button" data-action="veto-undo"${v.steps.length ? "" : " disabled"}>Zurück</button>
        ${v.steps.length ? '<button class="btn ghost" type="button" data-action="veto-reset">Neu anfangen</button>' : ""}</div>`;
  }
  const flow = steps.map((s, i) => `<span class="vt-flow ${s.who}${i < v.steps.length ? " done" : i === v.steps.length ? " cur" : ""}">${s.who === "us" ? "Wir" : "Geg."} ${s.act === "pick" ? "Pick" : "Ban"}</span>`).join("")
    + (steps.length ? `<span class="vt-flow dec">${multi(v.format) ? "Decider" : "Map"}</span>` : "");
  return `<section class="panel"><div class="panel-head"><h2>Live-Veto</h2><span class="hint">${esc(vetoLabel(v))}</span></div>
    <div class="panel-body"><div class="vt-flows">${flow}</div>${body}${history ? `<ol class="vt-hist">${history}</ol>` : ""}</div></section>`;
}

// Gespeicherte Vetos (neueste zuerst)
export const savedVetos = () => S.weeks.filter((w) => w.kind === "veto" && !w.deleted).sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.at || 0) - (a.at || 0));

// Das Veto zu einem Match: gleicher Tag, gleicher Gegner (ohne Groß/Klein), die Map des Matches unter den gespielten
export function vetoForMatch(m) {
  if (!S.loaded.weeks || !m.date || !norm(m.opponent)) return null;
  const list = savedVetos().filter((x) => x.date === m.date && norm(x.opponent) === norm(m.opponent));
  return list.find((x) => (x.maps || []).some((mp) => norm(mp) === norm(m.map))) || list[0] || null;
}

export function vetoSteps(x) {
  const line = (s, i) => (s.act === "decider"
    ? `<li class="dec"><span>${i + 1}.</span> ${multi(x.format) ? "Decider" : "Gespielt wird"}: <b>${esc(s.map)}</b></li>`
    : `<li class="${s.who}"><span>${i + 1}.</span> <b>${WHO[s.who] || "?"}</b> ${actText(s)} <b>${esc(s.map)}</b></li>`);
  return `<ol class="vt-hist">${(x.steps || []).map(line).join("")}</ol>`;
}

function savedPanel() {
  const list = savedVetos();
  if (!list.length) return "";
  const rows = list.slice(0, 10).map((x) => `<div class="vt-saved"><div><b>${esc(fmtDate(x.date).full)}</b> · ${esc(vetoLabel(x))}${x.opponent ? ` · vs ${esc(x.opponent)}` : ""}
      <small>Gespielt: ${(x.maps || []).map(esc).join(", ") || "–"}</small></div>
      <details><summary>Ablauf</summary>${vetoSteps(x)}</details>
      <button type="button" class="alias-x" data-action="veto-delete" data-id="${esc(x.id)}" aria-label="Veto löschen" title="Veto löschen">×</button></div>`).join("");
  return `<section class="panel"><div class="panel-head"><h2>Gespeicherte Vetos</h2><span class="hint">${list.length}</span></div><div class="panel-body">${rows}</div></section>`;
}

export function vetoView() {
  const back = '<a class="back" href="#maps">← Maps</a>';
  const head = `<div class="view-head"><div><div class="eyebrow">Maps</div><h1>Map-Veto</h1>
    <p>Welche Maps ihr picken und bannen solltet, und Schritt für Schritt durchs echte Veto.</p></div></div>`;
  if (!S.loaded.weeks || !S.loaded.matches) return back + head + '<p class="loading">Lade …</p>';
  const pool = poolNow();
  const rated = rateMaps(pool, v.opponent);
  return back + head + setupPanel(pool) + `<div class="vt-grid">${livePanel(rated)}${rankPanel(rated)}</div>` + savedPanel();
}

// ---------- Aktionen ----------

const resetSteps = () => { v.steps = []; v.saved = false; };

export const actions = {
  "veto-format": (el) => { if (v.steps.length && el.dataset.v !== v.format && !confirm2(el)) return; v.format = FORMATS[el.dataset.v] ? el.dataset.v : "bo1"; resetSteps(); changed(); },
  // Art ändert am Ablauf nichts: kein Neustart nötig
  "veto-type": (el) => { v.type = TYPES.includes(el.dataset.v) ? el.dataset.v : "Premier"; v.saved = false; changed(); },
  "veto-first": (el) => { if (v.steps.length && el.dataset.v !== v.first && !confirm2(el)) return; v.first = el.dataset.v === "them" ? "them" : "us"; resetSteps(); changed(); },
  "veto-pool": (el) => {
    if (v.steps.length) return;
    const m = el.dataset.map;
    v.out = v.out.includes(m) ? v.out.filter((x) => x !== m) : [...v.out, m];
    changed();
  },
  "veto-step": (el) => {
    const steps = order();
    if (finished() || !remaining().includes(el.dataset.map)) return;
    const s = steps[v.steps.length];
    v.steps.push({ who: s.who, act: s.act, map: el.dataset.map });
    v.saved = false;
    changed();
  },
  "veto-undo": () => { v.steps.pop(); v.saved = false; changed(); },
  "veto-reset": () => { resetSteps(); changed(); },
  "veto-save": async () => {
    if (!finished() || busy || v.saved) return;
    busy = true; changed();
    const maps = playedMaps();
    const steps = [...v.steps, ...maps.slice(multi(v.format) ? maps.length - 1 : 0).map((map) => ({ who: null, act: "decider", map }))];
    try {
      await create("weeks", {
        kind: "veto", type: v.type, format: v.format, opponent: v.opponent.trim().slice(0, 40), date: v.date || isoDate(new Date()), first: v.first,
        pool: poolNow(), steps, maps, by: who(), at: Date.now(),
      });
      v.saved = true;
      toast("Veto gespeichert.");
    } catch (e) { fail(e); }
    finally { busy = false; changed(); }
  },
  "veto-delete": async (el) => {
    if (!el.dataset.sure) { el.dataset.sure = "1"; el.textContent = "Löschen?"; el.classList.add("sure"); setTimeout(() => { if (el.isConnected) changed(); }, 4000); return; }
    try { await remove("weeks", el.dataset.id); toast("Veto gelöscht."); } catch (e) { fail(e); }
  },
};

// Format oder Startteam mitten im Veto ändern: zweimal tippen, dann fängt das Veto neu an
function confirm2(el) {
  if (el.dataset.sure) return true;
  el.dataset.sure = "1";
  toast("Das Veto läuft schon. Nochmal tippen, dann fängt es neu an.");
  setTimeout(() => { if (el.isConnected) delete el.dataset.sure; }, 4000);
  return false;
}

export const changes = {
  "veto-opp": (el) => { v.opponent = el.value.trim(); v.saved = false; changed(); },
  "veto-date": (el) => { v.date = el.value; v.saved = false; changed(); },
};

