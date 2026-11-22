// Tab "Planung" (Wunsch Tim, 19.11.2026): Umfrage pro Woche ("ab wann könnt ihr?"), Übersicht der Stimmen und
// Wochenplan. Bisher lief das als Umfragen in Discord. Abgestimmt wird jetzt hier (Discord kann Antworten nicht an
// die App zurückgeben); Discord bekommt die Umfrage und den fertigen Plan als Nachricht (js/discord.js).
//
// Ein Dokument pro Woche in der Sammlung "weeks":
//   { start: "JJJJ-MM-TT" (Montag), days: [{ date, kind: "scrim" | "premier" }],
//     votes: { <uid>: { email, playerId | null, name, picks: { <date>: ["18", "19"] | ["no"] }, at } },
//     (Für wen eine Stimme zählt: feste Zuordnung des Kontos aus config/team.links, sonst playerId aus "Ich bin")
//     plan: [{ id, date, time: "19:00", type, opponent, note, status: "planned" | "cancelled", match: null | "none" | <matchId> }],
//     (Ruhetag: type "Ruhetag", time "", opponent "", match "none")
//     pollPostedAt, planPostedAt }
// Abstimmen dürfen alle, Umfrage und Plan anlegen und ändern nur Admins (die Managerin ist Admin).
// Jede Stimme wird als eigenes Feld votes.<uid> geschrieben (setPath): Gleichzeitiges Abstimmen überschreibt nichts.
import { S, changed } from "../state.js";
import { TYPES, RES_LABEL } from "../constants.js";
import { $, esc, norm, toast, isoDate, fmtDate, pct, signed1, fmt2 } from "../util.js";
import { weekRecap } from "../recap.js";
import { create, change, remove, setPath, upsertPath } from "../data.js";
import { result, oppKey } from "../stats.js";
import { postPoll, postPlan, postRecap, planHookOn, scheduleHookOn } from "../discord.js";
import { errorText } from "../auth.js";
import { goalsPanel } from "./goals.js";

// Uhrzeiten, die zur Wahl stehen: Scrim-Tage "ab 18/19/20 Uhr", Premier-Samstag Treffen 18:00 oder 18:30
export const SLOTS = { scrim: ["18", "19", "20"], premier: ["18:00", "18:30"], vod: ["18", "19", "20"] };
export const slotLabel = (s) => (s.includes(":") ? s : s + " Uhr");
export const KIND_LABEL = { scrim: "Scrim", premier: "Premier", vod: "VOD-Review" };
// VOD-Review (Wunsch Tim, 22.11.2026): Termin ohne Match, wie Training
export const VOD = "VOD-Review";
const PLAN_TYPES = [...TYPES, "Training", VOD];
export const noMatchType = (type) => type === "Training" || type === VOD;
// Ruhetag (Wunsch Tim, 22.11.2026): eigener Eintrag im Wochenplan ohne Uhrzeit, Gegner und Match
export const REST = "Ruhetag";
const isRest = (e) => e && e.type === REST;
const FULL = 5;   // so viele braucht ein Team: ab da ist ein Zeitfenster grün

// ---------- Datum ----------
const parse = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
export const addDays = (iso, n) => { const d = parse(iso); d.setDate(d.getDate() + n); return isoDate(d); };
export const mondayOf = (iso) => { const d = parse(iso); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return isoDate(d); };
const compact = (iso) => iso.replace(/-/g, "");
const fromCompact = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
export function weekNo(iso) {
  const d = parse(iso);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const jan4 = new Date(d.getFullYear(), 0, 4);
  return 1 + Math.round(((d - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
}
export const weekLabel = (start) => `KW ${weekNo(start)} · ${fmtDate(start).day}–${fmtDate(addDays(start, 6)).day}`;
export const dayLabel = (iso) => { const f = fmtDate(iso); return `${f.wd.slice(0, 2)} ${f.day}`; };
export const planLink = (start) => "#plan-" + compact(start);

// ---------- Zustand der Ansicht ----------
let creating = false;   // Formular "Umfrage erstellen" offen
let editId = null;      // Plan-Eintrag, der gerade bearbeitet wird ("new" = neuer)
let busy = false;
let oppId = null;       // Plan-Eintrag, bei dem gerade "+ Gegner" offen ist (Gegner erst am Spieltag bekannt)
window.addEventListener("hashchange", () => { creating = false; editId = null; });

// Wann wurde der Rückblick einer Woche gepostet? Steht am Wochenplan (recapPostedAt) und, seit 22.11.2026, auch in
// weeks/recaps (posted.w<JJJJMMTT>): Wochen ohne Plan in der App haben kein eigenes Dokument (Hinweis auf der Startseite).
const RECAPS_ID = "recaps";
const recapKey = (start) => "w" + start.replace(/-/g, "");
export function recapPostedAt(start) {
  const w = weekOf(start), doc = S.weeks.find((x) => x.id === RECAPS_ID && !x.deleted);
  return Math.max((w && w.recapPostedAt) || 0, (doc && doc.posted && doc.posted[recapKey(start)]) || 0) || null;
}

export const weekOf = (start) => S.weeks.filter((w) => w.start === start).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
const uid = () => (S.user ? S.user.uid : "");
const byTime = (a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time || "").localeCompare(String(b.time || ""));

// Wer bin ich im Roster? Aus der eigenen Stimme dieser Woche, sonst aus einer früheren Woche, sonst aus diesem Gerät.
// "none" = spielt nicht mit (z. B. die Managerin).
function myPlayer(w) {
  const l = myLink();
  if (l) return staff(l) ? "none" : l;
  const mine = w && w.votes && w.votes[uid()];
  if (mine && "playerId" in mine) return mine.playerId || "none";
  for (const x of S.weeks) { const v = x.votes && x.votes[uid()]; if (v && "playerId" in v) return v.playerId || "none"; }
  try { return localStorage.getItem("valo-plan-me") || ""; } catch (e) { return ""; }
}
const playerName = (id) => { const p = S.players.find((x) => x.id === id); return p ? p.name : ""; };
// Feste Zuordnung Konto -> Spieler aus dem Tab "Team" (config/team.links): Spieler-ID oder "manager"
const links = () => (S.team && S.team.links) || {};
const myLink = () => (S.user ? links()[S.user.email] || "" : "");
// Managerin: als "manager" zugeordnet oder einem Staff-Eintrag im Roster (spielt nicht mit, hat aber ein Profil)
const staff = (l) => l === "manager" || S.players.some((p) => p.id === l && p.status === "staff");
// Für wen zählt eine Stimme? Ist das Konto fest zugeordnet, gilt das (auch rückwirkend für alte Stimmen),
// sonst das, was bei "Ich bin" gewählt war. null = zählt nicht (Managerin, "spiele nicht mit").
const votePid = (v) => {
  const l = v && v.email ? links()[v.email] : "";
  if (l) return staff(l) ? null : l;
  return (v && v.playerId) || null;
};
const voteName = (v) => (votePid(v) && playerName(votePid(v))) || v.name || "?";

// ---------- Auswertung ----------
// Wer kann an einem Tag zu welcher Zeit? Liefert { slots: { <slot>: [Namen] }, no: [Namen], open: [Namen] }
function dayStats(w, day) {
  const slots = Object.fromEntries((SLOTS[day.kind] || SLOTS.scrim).map((s) => [s, []]));
  const no = [], answered = new Set();
  // Stimmen von fest zugeordneten Konten zuerst: Ist ein Spieler doppelt da (alter Verklicker bei "Ich bin"),
  // zählt seine eigene Stimme
  const fixed = (v) => (v && v.email && links()[v.email] ? 1 : 0);
  for (const v of Object.values(w.votes || {}).sort((a, b) => fixed(b) - fixed(a))) {
    const pid = votePid(v);
    if (!pid) continue;   // nur Stimmen von Spielern zählen (Managerin, "spiele nicht mit" zählen nicht)
    const picks = (v.picks || {})[day.date];
    if (!picks || !picks.length) continue;
    if (answered.has(pid)) continue;   // derselbe Spieler doppelt (früher verklickt): nur einmal zählen
    answered.add(pid);
    if (picks.includes("no")) { no.push(voteName(v)); continue; }
    for (const s of picks) if (slots[s]) slots[s].push(voteName(v));
  }
  // Noch offen: Spieler im Roster (Stamm und Subs), die für diesen Tag nichts angegeben haben
  const open = S.players.filter((p) => p.status !== "staff" && !answered.has(p.id)).map((p) => p.name);
  return { slots, no, open };
}
// Bester Zeitpunkt eines Tages (für den Vorschlag beim Planen)
function bestSlot(w, day) {
  const st = dayStats(w, day);
  let best = null;
  for (const [s, names] of Object.entries(st.slots)) if (!best || names.length > best.n) best = { slot: s, n: names.length };
  return best && best.n ? best : null;
}

// Welches Match gehört zu einem Plan-Eintrag? Von Hand gewählt (match = ID), keins (match = "none"), sonst automatisch:
// Match am selben Tag mit derselben Art; gleicher Gegner zuerst; bei mehreren Terminen derselben Art der Reihe nach.
export function linkedMatch(entry, w) {
  if (entry.status === "cancelled" || entry.match === "none" || noMatchType(entry.type) || isRest(entry)) return null;
  if (entry.match) return S.matches.find((m) => m.id === entry.match) || null;
  const plan = (w.plan || []).filter((e) => e.status !== "cancelled");
  // Matches, die schon von Hand einem Termin zugeordnet sind, fallen weg
  const taken = new Set(plan.filter((e) => e.match && e.match !== "none").map((e) => e.match));
  const pool = S.matches.filter((m) => m.date === entry.date && norm(m.type) === norm(entry.type) && !taken.has(m.id))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  // Alle automatischen Termine dieses Tages und dieser Art: erst die mit passendem Gegner, dann der Reihe nach
  const autos = plan.filter((e) => !e.match && e.date === entry.date && e.type === entry.type).sort(byTime);
  const got = new Map();
  for (const e of autos) {
    if (!e.opponent) continue;
    const i = pool.findIndex((m) => norm(m.opponent) === norm(e.opponent));
    if (i >= 0) got.set(e, pool.splice(i, 1)[0]);
  }
  for (const e of autos) if (!got.has(e) && pool.length) got.set(e, pool.shift());
  return got.get(entry) || null;
}

// ---------- Ansicht ----------
export function planView(id) {
  const thisWeek = mondayOf(isoDate(new Date()));
  let start = id ? fromCompact(id) : thisWeek;
  if (!id && !weekOf(thisWeek) && weekOf(addDays(thisWeek, 7))) start = addDays(thisWeek, 7);   // nächste Woche hat schon eine Umfrage
  start = mondayOf(start);
  const w = weekOf(start);
  const nav = `<div class="wk-nav">
      <a class="btn small" href="${planLink(addDays(start, -7))}" aria-label="Vorherige Woche">←</a>
      <div class="wk-title"><b>${esc(weekLabel(start))}</b>${start === thisWeek ? '<span class="tag">diese Woche</span>' : start === addDays(thisWeek, 7) ? '<span class="tag">nächste Woche</span>' : ""}</div>
      <a class="btn small" href="${planLink(addDays(start, 7))}" aria-label="Nächste Woche">→</a>
    </div>`;
  const head = `<div class="view-head"><div><div class="eyebrow">Team</div><h1>Planung</h1>
    <p>Umfrage „Wann könnt ihr?“ für die Woche, darunter der Wochenplan und die Wochenziele. Abstimmen und Ziele anlegen können alle, Umfrage und Plan erstellt ein Admin.</p></div></div>`;
  if (!S.loaded.weeks) return head + nav + '<p class="loading">Lade Planung …</p>';
  // Wochenrückblick: bei vergangenen Wochen ganz oben, sonst unter dem Plan (nur wenn es Matches in der Woche gibt)
  const recap = S.loaded.matches ? recapPanel(start, w) : "";
  const over = addDays(start, 6) < isoDate(new Date());
  // Wochenziele (js/views/goals.js): gibt es für jede Woche, auch ohne Umfrage
  const goals = goalsPanel(start);
  if (!w) return head + nav + (over ? recap + goals : "") + (S.isAdmin ? createPanel(start) : '<div class="empty"><h2>Noch keine Umfrage</h2><p>Für diese Woche hat noch niemand eine Umfrage erstellt.</p></div>') + (over ? "" : goals + recap);
  if (over) return head + nav + recap + goals + planPanel(w) + overviewPanel(w) + votePanel(w) + (S.isAdmin ? adminPanel(w) : "");
  return head + nav + votePanel(w) + overviewPanel(w) + planPanel(w) + goals + recap + (S.isAdmin ? adminPanel(w) : "");
}

// ---------- Wochenrückblick (js/recap.js) ----------
const rec = (t) => `${t.w}–${t.l}${t.d ? "–" + t.d : ""}`;
function recapPanel(start, w) {
  const r = weekRecap(start, w);
  if (!r) return "";
  const s = r.sum;
  const res = r.results.map(({ m, r: x }) => `<a class="rc-row" href="#match-${esc(m.id)}">
      <span class="res-dot ${x}" aria-hidden="true"></span><b>${esc(dayLabel(m.date))}</b>
      <span class="rc-what"><span class="tag">${esc(m.type || "Match")}</span> ${esc(m.map || "Map?")} <span class="muted">vs ${esc(m.opponent || "?")}</span></span>
      <span class="rc-score ${x}">${x === "Q" ? "offen" : `${esc(m.scoreUs)}:${esc(m.scoreThem)}`}</span></a>`).join("");
  const kv = (label, value) => `<div class="rc-kv"><span>${label}</span><b>${value}</b></div>`;
  const facts = [
    kv("Bilanz", `${rec(s)}${s.wr === null ? "" : ` <small class="muted">${pct(s.wr)}</small>`}`),
    s.diff !== null ? kv("Ø Rundendiff.", signed1(s.diff)) : "",
    s.pistolN ? kv("Pistols", `${s.pistolW}/${s.pistolN}`) : "",
    r.prev ? kv("Vorwoche", rec(r.prev)) : "",
  ].join("");
  const types = r.byType.length > 1 ? `<p class="hint">${r.byType.map((t) => `${esc(t.type)} ${rec(t)}`).join(" · ")}</p>` : "";
  const people = [
    r.mvp ? `<p class="rc-mvp">🏆 <b>Spieler der Woche: ${esc(r.mvp.name)}</b> · K/D ${fmt2(r.mvp.kd)} · ${r.mvp.kills} Kills in ${r.mvp.n} ${r.mvp.n === 1 ? "Match" : "Matches"}</p>` : "",
    [r.topKills ? `Meiste Kills: <b>${esc(r.topKills.name)}</b> (${r.topKills.kills})` : "", r.topFb ? `Meiste First Bloods: <b>${esc(r.topFb.name)}</b> (${r.topFb.fb})` : ""].filter(Boolean).join(" · "),
  ].filter(Boolean).map((x) => (x.startsWith("<p") ? x : `<p class="hint">${x}</p>`)).join("");
  const mapBits = [r.most ? `meistgespielt <b>${esc(r.most.name)}</b> (${r.most.n}×, ${rec(r.most)})` : "", r.best && (!r.most || r.best.key !== r.most.key) ? `beste <b>${esc(r.best.name)}</b> (${rec(r.best)})` : ""].filter(Boolean).join(" · ");
  const pc = (d) => `${d > 0 ? "+" : "−"}${Math.abs(Math.round(d * 100))} %`;
  const formLine = r.form.length ? `Form (KPR letzte 5 Matches): ${r.form.map((x) => `<span class="form ${x.dir}">${x.dir === "up" ? "↑" : "↓"} ${esc(x.name)} ${pc(x.delta)}</span>`).join(" · ")}` : "";
  const planLine = r.plan ? `Plan: ${r.plan.played} von ${r.plan.total} ${r.plan.total === 1 ? "Termin" : "Terminen"} gespielt${r.plan.cancelled ? ` · ${r.plan.cancelled} abgesagt` : ""}${r.plan.rest ? ` · ${r.plan.rest} ${r.plan.rest === 1 ? "Ruhetag" : "Ruhetage"}` : ""}` : "";
  const when = (t) => (t ? fmtDate(isoDate(new Date(t))).full : "");
  const btn = S.isAdmin && planHookOn()
    ? `<div class="actions"><button class="btn" type="button" data-action="plan-post-recap" data-start="${start}"${busy ? " disabled" : ""}>Rückblick in Discord posten</button></div>
      ${recapPostedAt(start) ? `<p class="hint">Zuletzt gepostet am ${esc(when(recapPostedAt(start)))}.</p>` : ""}` : "";
  return `<section class="panel rc"><div class="panel-head"><h2>Wochenrückblick</h2><span class="hint">${r.list.length} ${r.list.length === 1 ? "Match" : "Matches"}</span></div>
    <div class="panel-body">
      <div class="rc-facts">${facts}</div>${types}
      <div class="rc-list">${res}</div>
      ${people}
      ${mapBits ? `<p class="hint">Maps: ${mapBits}</p>` : ""}
      ${formLine ? `<p class="hint">${formLine}</p>` : ""}
      ${planLine ? `<p class="hint">${planLine}</p>` : ""}
      ${btn}
    </div></section>`;
}

function createPanel(start) {
  if (!creating) {
    return `<div class="empty"><h2>Noch keine Umfrage</h2><p>Erstelle die Umfrage für diese Woche. Danach stimmen alle ab, und du planst anhand der Antworten.</p>
      <button class="btn primary" type="button" data-action="plan-create-open">Umfrage erstellen</button></div>`;
  }
  const rows = [0, 1, 2, 3, 4, 5, 6].map((i) => {
    const date = addDays(start, i), sat = i === 5;
    return `<div class="pc-day"><label class="check"><input type="checkbox" name="day" value="${date}" checked> <b>${esc(dayLabel(date))}</b></label>
      <select name="kind-${date}" aria-label="Art am ${esc(dayLabel(date))}">
        <option value="scrim"${sat ? "" : " selected"}>Scrim (18 / 19 / 20 Uhr)</option>
        <option value="premier"${sat ? " selected" : ""}>Premier (18:00 / 18:30)</option>
        <option value="vod">VOD-Review (18 / 19 / 20 Uhr)</option></select></div>`;
  }).join("");
  return `<section class="panel"><div class="panel-head"><h2>Umfrage erstellen</h2><span class="hint">${esc(weekLabel(start))}</span></div>
    <div class="panel-body">
      <form class="pc-form" data-form="plan-create" data-start="${start}" novalidate>
        <p class="hint">Welche Tage sollen in die Umfrage? Bei jedem Tag: Scrim, Premier oder VOD-Review (bestimmt die Uhrzeiten zur Auswahl).</p>
        ${rows}
        <div class="actions"><button class="btn primary" type="submit"${busy ? " disabled" : ""}>Umfrage starten</button>
          <button class="btn" type="button" data-action="plan-create-cancel">Abbrechen</button></div>
        <p class="hint">${scheduleHookOn() ? "Die Umfrage wird danach automatisch in Discord angekündigt." : "Tipp: Im Tab „Team“ unter „Discord“ lässt sich ein Planungs-Kanal eintragen. Dann kündigt die App die Umfrage dort an."}</p>
      </form>
    </div></section>`;
}

function votePanel(w) {
  const me = myPlayer(w), linked = myLink();
  const players = S.players.filter((p) => p.status !== "staff").sort((a, b) => a.name.localeCompare(b.name, "de"));
  // Ist das Konto im Tab "Team" fest zugeordnet, gibt es nichts zu wählen. Sonst "Ich bin" als Notlösung:
  // Spieler, die schon einem anderen Konto gehören, lassen sich dort nicht wählen.
  const taken = new Set(Object.values(links()).filter((id) => id !== "manager"));
  const who = linked
    ? `<p class="pv-me-fixed">${staff(linked) ? "Du bist als <b>Managerin</b> eingetragen." : `Du stimmst ab als <b>${esc(playerName(linked) || "?")}</b>.`}</p>`
    : `<label class="field pv-me"><span>Ich bin</span>
      <select data-change="plan-me" data-week="${esc(w.id)}">
        <option value=""${me ? "" : " selected"}>Bitte wählen …</option>
        ${players.map((p) => `<option value="${esc(p.id)}"${me === p.id ? " selected" : ""}${taken.has(p.id) ? " disabled" : ""}>${esc(p.name)}${taken.has(p.id) ? " (anderes Konto)" : ""}</option>`).join("")}
        <option value="none"${me === "none" ? " selected" : ""}>Ich spiele nicht mit</option>
      </select></label>`;
  let body;
  if (!me) body = '<p class="hint">Wähl zuerst aus, wer du im Roster bist. Das merkt sich die App. (Ein Admin kann dein Konto im Tab „Team“ auch fest zuordnen.)</p>';
  else if (me === "none") body = `<p class="hint">${staff(linked) ? "Als Managerin stimmst du nicht mit ab." : "Du spielst nicht mit, deshalb gibt es für dich nichts abzustimmen."} Unten siehst du, wer wann kann.</p>`;
  else {
    const picks = ((w.votes || {})[uid()] || {}).picks || {};
    body = `<div class="pv-days">${(w.days || []).map((day) => {
      const mine = picks[day.date] || [];
      const chip = (slot, label, cls = "") => `<button class="chip-btn${cls}" type="button" data-action="plan-pick" data-week="${esc(w.id)}" data-date="${day.date}" data-slot="${slot}" aria-pressed="${mine.includes(slot)}">${label}</button>`;
      return `<div class="pv-day"><div class="pv-label"><b>${esc(dayLabel(day.date))}</b><span class="tag">${KIND_LABEL[day.kind] || "Scrim"}</span></div>
        <div class="chips">${(SLOTS[day.kind] || SLOTS.scrim).map((s) => chip(s, slotLabel(s))).join("")}${chip("no", "kann nicht", " no")}</div></div>`;
    }).join("")}</div>
    <p class="hint">Alle Uhrzeiten antippen, zu denen du kannst (mehrere gehen). Gespeichert wird sofort.</p>`;
  }
  const voted = new Set(Object.values(w.votes || {}).filter((v) => v && votePid(v) && Object.values(v.picks || {}).some((p) => p && p.length)).map(votePid)).size;
  return `<section class="panel"><div class="panel-head"><h2>Abstimmen</h2><span class="hint">${voted} abgestimmt</span></div>
    <div class="panel-body">${who}${body}</div></section>`;
}

function overviewPanel(w) {
  const days = (w.days || []).map((day) => {
    const st = dayStats(w, day);
    const slots = Object.entries(st.slots).map(([s, names]) => `<div class="ov-slot${names.length >= FULL ? " ok" : ""}">
        <div class="ov-time">${esc(slotLabel(s))} <b>${names.length}</b></div>
        <div class="ov-names">${names.length ? names.map(esc).join(", ") : "–"}</div></div>`).join("");
    const rest = (w.plan || []).some((e) => isRest(e) && e.date === day.date);
    return `<div class="ov-day"><div class="pv-label"><b>${esc(dayLabel(day.date))}</b><span class="tag">${KIND_LABEL[day.kind] || "Scrim"}</span>${rest ? '<span class="tag rest">Ruhetag</span>' : ""}</div>
      <div class="ov-slots">${slots}</div>
      ${st.no.length ? `<div class="ov-extra"><span class="st-x">kann nicht:</span> ${st.no.map(esc).join(", ")}</div>` : ""}
      ${st.open.length ? `<div class="ov-extra muted">noch offen: ${st.open.map(esc).join(", ")}</div>` : ""}</div>`;
  }).join("");
  return `<section class="panel"><div class="panel-head"><h2>Wer kann wann?</h2><span class="hint">grün = mindestens ${FULL}</span></div>
    <div class="panel-body ov">${days || '<p class="hint">Keine Tage in dieser Umfrage.</p>'}</div></section>`;
}

// Ruhetag eintragen oder ändern: nur Tag und Notiz
function restForm(w, e) {
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(w.start, i));
  // Vorschlag für einen neuen Ruhetag: erster Tag der Woche, an dem noch nichts geplant ist
  const busyDays = new Set((w.plan || []).map((x) => x.date));
  const date = e ? e.date : days.find((d) => !busyDays.has(d)) || days[days.length - 1];
  return `<form class="pe-form" data-form="plan-entry" data-week="${esc(w.id)}" data-id="${e ? esc(e.id) : "new"}" novalidate>
      <input type="hidden" name="type" value="${REST}">
      <label class="field"><span>Ruhetag am</span><select name="date">${days.map((d) => `<option value="${d}"${d === date ? " selected" : ""}>${esc(dayLabel(d))}</option>`).join("")}</select></label>
      <label class="field wide"><span>Notiz (freiwillig)</span><input type="text" name="note" maxlength="120" value="${esc(e ? e.note || "" : "")}" placeholder="z. B. Pause vor Premier" autocomplete="off"></label>
      <div class="actions wide"><button class="btn primary" type="submit">${e ? "Speichern" : "Ruhetag eintragen"}</button>
        <button class="btn" type="button" data-action="plan-entry-cancel">Abbrechen</button>
        ${e ? `<button class="btn danger" type="button" data-action="plan-entry-delete" data-week="${esc(w.id)}" data-id="${esc(e.id)}">Ruhetag löschen</button>` : ""}</div>
    </form>`;
}

function entryForm(w, e) {
  if (isRest(e)) return restForm(w, e);
  const days = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(w.start, i));
  const date = e ? e.date : ((w.days || [])[0] || {}).date || w.start;
  const day = (w.days || []).find((d) => d.date === date);
  const best = day ? bestSlot(w, day) : null;
  const time = e ? e.time : best ? (best.slot.includes(":") ? best.slot : best.slot + ":00") : "19:00";
  const type = e ? e.type : day && day.kind === "premier" ? "Premier" : day && day.kind === "vod" ? VOD : "Scrim";
  const matchesThatDay = S.matches.filter((m) => m.date === date);
  const opts = (list, cur) => list.map((x) => `<option value="${esc(x)}"${x === cur ? " selected" : ""}>${esc(x)}</option>`).join("");
  const oppList = [...new Set(S.matches.map((m) => String(m.opponent || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
  return `<form class="pe-form" data-form="plan-entry" data-week="${esc(w.id)}" data-id="${e ? esc(e.id) : "new"}" novalidate>
      <label class="field"><span>Tag</span><select name="date">${days.map((d) => `<option value="${d}"${d === date ? " selected" : ""}>${esc(dayLabel(d))}</option>`).join("")}</select></label>
      <label class="field"><span>Uhrzeit(en)</span><input type="text" name="time" class="time-in" inputmode="text" autocomplete="off" maxlength="40" value="${esc(time)}" placeholder="19:00, 20:30"></label>
      <label class="field"><span>Art</span><select name="type">${opts(PLAN_TYPES, type)}</select></label>
      <p class="hint wide">Mehrere Scrims am selben Tag: Uhrzeiten mit Komma trennen (z. B. <b>19:00, 20:30</b>), dann wird jede ein eigener Termin. Gegner genauso, in derselben Reihenfolge.</p>
      <label class="field wide"><span>Gegner (falls bekannt)</span><input type="text" name="opponent" list="dl-plan-opp" maxlength="40" value="${esc(e ? e.opponent || "" : "")}" autocomplete="off"></label>
      <datalist id="dl-plan-opp">${oppList.map((o) => `<option value="${esc(o)}"></option>`).join("")}</datalist>
      <label class="field wide"><span>Notiz</span><input type="text" name="note" maxlength="120" value="${esc(e ? e.note || "" : "")}" autocomplete="off"></label>
      ${e ? `<label class="field"><span>Status</span><select name="status">
          <option value="planned"${e.status !== "cancelled" ? " selected" : ""}>geplant / gespielt</option>
          <option value="cancelled"${e.status === "cancelled" ? " selected" : ""}>abgesagt (rotes X)</option></select></label>
        <label class="field wide"><span>Match</span><select name="match">
          <option value=""${!e.match ? " selected" : ""}>automatisch (gleicher Tag und Art)</option>
          <option value="none"${e.match === "none" ? " selected" : ""}>keins verknüpfen</option>
          ${matchesThatDay.map((m) => `<option value="${esc(m.id)}"${e.match === m.id ? " selected" : ""}>${esc(`${m.type || "Match"} · ${m.map || "Map?"} vs ${m.opponent || "?"} ${m.scoreUs ?? "?"}:${m.scoreThem ?? "?"}`)}</option>`).join("")}
        </select></label>` : ""}
      ${!e && best ? `<p class="hint wide">Vorschlag aus der Umfrage: ${esc(slotLabel(best.slot))}, da können ${best.n}.</p>` : ""}
      <div class="actions wide"><button class="btn primary" type="submit">${e ? "Speichern" : "Termin eintragen"}</button>
        <button class="btn" type="button" data-action="plan-entry-cancel">Abbrechen</button>
        ${e ? `<button class="btn danger" type="button" data-action="plan-entry-delete" data-week="${esc(w.id)}" data-id="${esc(e.id)}">Termin löschen</button>` : ""}</div>
    </form>`;
}

function planPanel(w) {
  const plan = (w.plan || []).slice().sort(byTime);
  const todayIso = isoDate(new Date());
  // Ein Kasten pro Tag (Wunsch Tim, 22.11.2026): Mehrere Termine am selben Tag stehen untereinander im selben Kasten
  const item = (e) => {
    if (editId === e.id) return `<div class="pl-row editing">${entryForm(w, e)}</div>`;
    if (isRest(e)) {
      return `<div class="pl-row rest"><div class="pl-main"><div class="pl-when"><span>frei</span></div>
        <div class="pl-what"><span class="tag rest">Ruhetag</span>${e.note ? `<small>${esc(e.note)}</small>` : ""}</div></div>
        ${S.isAdmin ? `<button class="btn small ghost" type="button" data-action="plan-entry-edit" data-id="${esc(e.id)}">Bearbeiten</button>` : ""}</div>`;
    }
    const m = linkedMatch(e, w);
    let status;
    if (e.status === "cancelled") status = '<span class="pl-st st-x" title="Abgesagt">✗ abgesagt</span>';
    else if (m) {
      const r = result(m);
      status = `<a class="pl-st st-ok" href="#match-${esc(m.id)}" title="Zum Match">✓ ${r === "Q" ? "eingetragen" : `${esc(m.scoreUs)}:${esc(m.scoreThem)} ${esc(RES_LABEL[r])}`}</a>`;
    }
    else if (noMatchType(e.type)) status = "";
    else if (e.date < todayIso) status = '<span class="pl-st muted">noch kein Match eingetragen</span>';
    else status = '<span class="pl-st muted">geplant</span>';
    // Gegner steht oft erst am Spieltag fest (Wunsch Tim, 22.11.2026): schnell nachtragen, ohne den ganzen Termin zu öffnen.
    // Kennt die App den Gegner schon aus Matches, führt "Steckbrief" zu seiner Seite.
    const open = e.status !== "cancelled" && !m && !noMatchType(e.type) && e.date >= todayIso;
    const known = e.opponent && S.matches.some((x) => oppKey(x.opponent) === oppKey(e.opponent));
    const oppTools = oppId === e.id
      ? `<form class="pl-opp" data-form="plan-opp" data-week="${esc(w.id)}" data-id="${esc(e.id)}" novalidate>
          <input type="text" id="pl-opp-${esc(e.id)}" name="opponent" list="dl-plan-opp2" maxlength="40" value="${esc(e.opponent || "")}" placeholder="Gegner" autocomplete="off" aria-label="Gegner">
          <datalist id="dl-plan-opp2">${[...new Set(S.matches.map((x) => String(x.opponent || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de")).map((o) => `<option value="${esc(o)}"></option>`).join("")}</datalist>
          <button class="btn small primary" type="submit">OK</button><button class="btn small ghost" type="button" data-action="plan-opp-cancel">✕</button></form>`
      : open ? `<button class="btn small ghost" type="button" data-action="plan-opp" data-id="${esc(e.id)}">${e.opponent ? "Gegner ändern" : "+ Gegner"}</button>` : "";
    const scoutLink = known && !m && e.status !== "cancelled" ? `<a class="linkish pl-scout" href="#opponent-${esc(encodeURIComponent(e.opponent))}">🔎 Steckbrief</a>` : "";
    const main = `<div class="pl-when"><b>${esc(e.time || "–")}</b></div>
      <div class="pl-what"><span class="tag">${esc(e.type)}</span>${e.opponent ? ` vs ${esc(e.opponent)}` : ""}${e.note ? `<small>${esc(e.note)}</small>` : ""}</div>`;
    return `<div class="pl-row${e.status === "cancelled" ? " cancelled" : ""}">
      ${m ? `<a class="pl-main" href="#match-${esc(m.id)}">${main}</a>` : `<div class="pl-main">${main}</div>`}
      ${status}${scoutLink}${oppTools}
      ${S.isAdmin ? `<button class="btn small ghost" type="button" data-action="plan-entry-edit" data-id="${esc(e.id)}">Bearbeiten</button>` : ""}</div>`;
  };
  const days = [];
  for (const e of plan) { const d = days[days.length - 1]; if (d && d.date === e.date) d.list.push(e); else days.push({ date: e.date, list: [e] }); }
  const rows = days.map((d) => `<div class="pl-day${d.list.every(isRest) ? " rest" : ""}"><div class="pl-day-label"><b>${esc(dayLabel(d.date))}</b>${d.list.length > 1 ? `<small>${d.list.length} Termine</small>` : ""}</div>
      <div class="pl-items">${d.list.map(item).join("")}</div></div>`).join("");
  const add = !S.isAdmin ? ""
    : editId === "new" ? `<div class="pl-row editing">${entryForm(w, null)}</div>`
    : editId === "rest" ? `<div class="pl-row editing">${restForm(w, null)}</div>`
    : `<div class="actions"><button class="btn" type="button" data-action="plan-entry-new">+ Termin</button>
        <button class="btn" type="button" data-action="plan-rest-new">+ Ruhetag</button></div>`;
  const rests = plan.filter(isRest).length, dates = plan.length - rests;
  const count = [dates ? `${dates} ${dates === 1 ? "Termin" : "Termine"}` : "", rests ? `${rests} ${rests === 1 ? "Ruhetag" : "Ruhetage"}` : ""].filter(Boolean).join(" · ");
  return `<section class="panel"><div class="panel-head"><h2>Wochenplan</h2><span class="hint">${count || "noch leer"}</span></div>
    <div class="panel-body">
      ${rows ? `<div class="pl-list">${rows}</div>` : `<p class="hint">${S.isAdmin ? "Noch keine Termine. Schau oben, wann die meisten können, und trag die Termine ein." : "Die Managerin hat den Plan noch nicht eingetragen."}</p>`}
      ${add}
      <p class="hint">✓ = Match gespielt (antippen springt zum Match), ✗ = abgesagt, Ruhetag = bewusst frei.</p>
    </div></section>`;
}

function adminPanel(w) {
  const hook = scheduleHookOn();
  const when = (t) => (t ? fmtDate(isoDate(new Date(t))).full : "");
  return `<section class="panel"><div class="panel-head"><h2>Discord und Umfrage</h2><span class="hint">nur Admins</span></div>
    <div class="panel-body">
      ${hook ? `<div class="actions">
          <button class="btn primary" type="button" data-action="plan-post-plan" data-week="${esc(w.id)}"${busy ? " disabled" : ""}>Wochenplan in Discord posten</button>
          <button class="btn" type="button" data-action="plan-post-poll" data-week="${esc(w.id)}"${busy ? " disabled" : ""}>Umfrage nochmal ankündigen</button></div>
        <p class="hint">${w.planPostedAt ? `Plan zuletzt gepostet am ${esc(when(w.planPostedAt))}. ` : ""}${w.pollPostedAt ? `Umfrage angekündigt am ${esc(when(w.pollPostedAt))}.` : ""}</p>`
      : '<p class="hint">Für Discord-Posts im Tab „Team“ unter „Discord“ einen Planungs-Kanal eintragen.</p>'}
      <div class="actions"><button class="btn danger" type="button" data-action="plan-delete" data-week="${esc(w.id)}">Umfrage und Plan dieser Woche löschen</button></div>
    </div></section>`;
}

// ---------- Aktionen ----------
const wk = (el) => S.weeks.find((x) => x.id === el.dataset.week);
const fail = (e) => toast(e && e.plain ? e.message : (errorText(e) || "Das hat nicht geklappt."));

async function savePicks(w, date, picks) {
  const me = myPlayer(w);
  const old = (w.votes || {})[uid()] || {};
  const next = { email: S.user ? S.user.email : "", playerId: me && me !== "none" ? me : null, name: playerName(me) || (S.user && S.user.name) || "", picks: { ...(old.picks || {}), [date]: picks }, at: Date.now() };
  await setPath("weeks", w.id, ["votes", uid()], next);
}

export const actions = {
  "plan-create-open": () => { creating = true; changed(); },
  "plan-create-cancel": () => { creating = false; changed(); },
  "plan-pick": async (el) => {
    const w = wk(el);
    if (!w || !uid()) return;
    const date = el.dataset.date, slot = el.dataset.slot;
    const cur = (((w.votes || {})[uid()] || {}).picks || {})[date] || [];
    let next;
    if (slot === "no") next = cur.includes("no") ? [] : ["no"];
    else next = cur.includes(slot) ? cur.filter((s) => s !== slot) : [...cur.filter((s) => s !== "no"), slot];
    try { await savePicks(w, date, next); } catch (e) { fail(e); }
  },
  "plan-entry-new": () => { editId = "new"; changed(); },
  "plan-opp": (el) => { oppId = el.dataset.id; changed(); const f = document.getElementById("pl-opp-" + oppId); if (f) f.focus(); },
  "plan-opp-cancel": () => { oppId = null; changed(); },
  "plan-rest-new": () => { editId = "rest"; changed(); },
  "plan-entry-edit": (el) => { editId = el.dataset.id; changed(); },
  "plan-entry-cancel": () => { editId = null; changed(); },
  "plan-entry-delete": async (el) => {
    const w = wk(el);
    if (!w || !S.isAdmin) return;
    try { await change("weeks", w.id, { plan: (w.plan || []).filter((e) => e.id !== el.dataset.id) }); editId = null; changed(); toast("Termin gelöscht."); }
    catch (e) { fail(e); }
  },
  "plan-post-poll": async (el) => postNow(wk(el), "poll"),
  "plan-post-plan": async (el) => postNow(wk(el), "plan"),
  // Rückblick geht auch für Wochen ohne Umfrage (dann wird nicht vermerkt, wann gepostet wurde)
  "plan-post-recap": async (el) => {
    if (!S.isAdmin || busy) return;
    const start = el.dataset.start, w = weekOf(start);
    busy = true; changed();
    try {
      await postRecap(start, w);
      if (w) await change("weeks", w.id, { recapPostedAt: Date.now() });
      await upsertPath("weeks", RECAPS_ID, ["posted", recapKey(start)], Date.now(), { kind: "recaps" });
      toast(S.demo ? "Vorschau: Rückblick würde jetzt in Discord gepostet." : "Wochenrückblick in Discord gepostet.");
    } catch (e) { fail(e); }
    finally { busy = false; changed(); }
  },
  "plan-delete": async (el) => {
    const w = wk(el);
    if (!w || !S.isAdmin) return;
    if (!confirmTwice(el, "Wirklich löschen? Nochmal tippen")) return;
    try { await remove("weeks", w.id); toast("Umfrage und Plan dieser Woche gelöscht (Admins können das im Papierkorb nicht zurückholen)."); }
    catch (e) { fail(e); }
  },
};

// Zweimal tippen statt eines Browser-Dialogs (der Knopf zeigt beim ersten Mal die Rückfrage)
function confirmTwice(el, text) {
  if (el.dataset.sure) return true;
  el.dataset.sure = "1";
  el.textContent = text;
  setTimeout(() => { if (el.isConnected) { delete el.dataset.sure; changed(); } }, 4000);
  return false;
}

async function postNow(w, what) {
  if (!w || !S.isAdmin || busy) return;
  busy = true; changed();
  try {
    if (what === "poll") { await postPoll(w); await change("weeks", w.id, { pollPostedAt: Date.now() }); toast(S.demo ? "Vorschau: Umfrage würde jetzt in Discord angekündigt." : "Umfrage in Discord angekündigt."); }
    else { await postPlan(w); await change("weeks", w.id, { planPostedAt: Date.now() }); toast(S.demo ? "Vorschau: Wochenplan würde jetzt in Discord gepostet." : "Wochenplan in Discord gepostet."); }
  } catch (e) { fail(e); }
  finally { busy = false; changed(); }
}

export const forms = {
  // Gegner am Spieltag nachtragen: darf jeder im Team (nur dieses Feld ändert sich)
  "plan-opp": async (form) => {
    const w = S.weeks.find((x) => x.id === form.dataset.week);
    if (!w) return;
    const opponent = String(new FormData(form).get("opponent") || "").trim().slice(0, 40);
    const plan = (w.plan || []).map((e) => (e.id === form.dataset.id ? { ...e, opponent } : e));
    try { await change("weeks", w.id, { plan }); oppId = null; changed(); toast(opponent ? `Gegner eingetragen: ${opponent}.` : "Gegner entfernt."); }
    catch (e) { fail(e); }
  },
  "plan-create": async (form) => {
    if (!S.isAdmin || busy) return;
    const data = new FormData(form);
    const start = form.dataset.start;
    const days = data.getAll("day").map(String).sort().map((date) => ({ date, kind: ["premier", "vod"].includes(data.get("kind-" + date)) ? data.get("kind-" + date) : "scrim" }));
    if (!days.length) return toast("Bitte mindestens einen Tag anhaken.");
    if (weekOf(start)) return toast("Für diese Woche gibt es schon eine Umfrage.");
    busy = true; changed();
    try {
      const id = await create("weeks", { start, days, votes: {}, plan: [] });
      creating = false;
      if (scheduleHookOn()) {
        try { await postPoll(weekOf(start) || { id, start, days }); await change("weeks", id, { pollPostedAt: Date.now() }); toast(S.demo ? "Umfrage erstellt (Vorschau: nichts an Discord gesendet)." : "Umfrage erstellt und in Discord angekündigt."); }
        catch (e) { toast("Umfrage erstellt, aber Discord: " + (e.plain ? e.message : "Posten hat nicht geklappt.")); }
      } else toast("Umfrage erstellt. Sag dem Team Bescheid, dass abgestimmt werden kann.");
    } catch (e) { fail(e); }
    finally { busy = false; changed(); }
  },
  "plan-entry": async (form) => {
    const w = S.weeks.find((x) => x.id === form.dataset.week);
    if (!w || !S.isAdmin) return;
    const data = new FormData(form);
    const isNew = form.dataset.id === "new";
    const plan = (w.plan || []).slice();
    if (data.get("type") === REST) {
      const date = String(data.get("date"));
      if (plan.some((e) => isRest(e) && e.date === date && e.id !== form.dataset.id)) return toast("An dem Tag ist schon ein Ruhetag eingetragen.");
      const rest = { date, time: "", type: REST, opponent: "", note: String(data.get("note") || "").trim().slice(0, 120), status: "planned", match: "none" };
      if (isNew) plan.push({ id: "e" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...rest });
      else {
        const i = plan.findIndex((e) => e.id === form.dataset.id);
        if (i < 0) return;
        plan[i] = { ...plan[i], ...rest };
      }
      try { await change("weeks", w.id, { plan }); editId = null; changed(); toast(isNew ? "Ruhetag eingetragen." : "Ruhetag gespeichert."); }
      catch (e) { fail(e); }
      return;
    }
    // 19 → 19:00, 1930 → 19:30, 930 → 09:30, 19.30 / 19,30 → 19:30
    const fix = (t) => t.trim().replace(/^(\d{1,2})[.,h](\d{2})$/, "$1:$2").replace(/^(\d{1,2})(\d{2})$/, "$1:$2").replace(/^(\d{1,2})$/, "$1:00").replace(/^(\d):/, "0$1:");
    // Neuer Termin: mehrere Uhrzeiten mit Komma = mehrere Termine am selben Tag (Wunsch Tim, 22.11.2026)
    // Auch beim Bearbeiten: weitere Uhrzeiten werden zusätzliche Termine am selben Tag
    const times = [...new Set(String(data.get("time") || "").split(/[,;]+|\s+(?=\d)/).map(fix).filter(Boolean))];
    if (times.some((t) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t))) return toast("Uhrzeit bitte als 19:00 oder 18:30 eintragen (mehrere mit Komma).");
    if (times.length > 6) return toast("Höchstens 6 Termine auf einmal.");
    const opps = String(data.get("opponent") || "").split(times.length > 1 ? /\s*[,;]\s*/ : /$^/).map((x) => x.trim().slice(0, 40));
    const base = {
      date: String(data.get("date")),
      type: PLAN_TYPES.includes(String(data.get("type"))) ? String(data.get("type")) : "Scrim",
      note: String(data.get("note") || "").trim().slice(0, 120),
    };
    const fields = { ...base, time: times[0] || "", opponent: opps[0] || "" };
    const extra = (from) => (times.length ? times : [""]).forEach((t, i) => i >= from && plan.push({
        id: "e" + Date.now().toString(36) + i + Math.random().toString(36).slice(2, 6), ...base, time: t,
        opponent: opps.length === 1 ? opps[0] : opps[i] || "", status: "planned", match: null,
      }));
    if (isNew) extra(0);
    else {
      const i = plan.findIndex((e) => e.id === form.dataset.id);
      if (i < 0) return;
      const match = String(data.get("match") || "");
      plan[i] = { ...plan[i], ...fields, status: data.get("status") === "cancelled" ? "cancelled" : "planned", match: match || null };
      extra(1);
    }
    try { await change("weeks", w.id, { plan }); editId = null; changed(); toast(times.length > 1 ? `${times.length} Termine ${isNew ? "eingetragen" : "gespeichert"}.` : isNew ? "Termin eingetragen." : "Termin gespeichert."); }
    catch (e) { fail(e); }
  },
};

// Uhrzeit tippen: Nach vier Ziffern kommt der Doppelpunkt von selbst (1930 → 19:30). Der Doppelpunkt geht auch direkt.
document.addEventListener("input", (e) => {
  const el = e.target;
  if (!el.classList || !el.classList.contains("time-in") || e.inputType === "deleteContentBackward") return;
  const v = el.value.replace(/(^|[,;]\s*|\s)(\d{2})(\d{2})(?=$|[,;\s])/g, "$1$2:$3");
  if (v !== el.value) el.value = v;
});

export const changes = {
  // "Ich bin …": merken (auf diesem Gerät und in der eigenen Stimme dieser Woche)
  "plan-me": async (el) => {
    const w = S.weeks.find((x) => x.id === el.dataset.week);
    const val = el.value;
    try { localStorage.setItem("valo-plan-me", val); } catch (e) { /* nur Bequemlichkeit */ }
    if (!w || !uid() || !val) { changed(); return; }
    const old = (w.votes || {})[uid()] || {};
    try {
      // Die Stimmen bleiben erhalten (auch bei "spiele nicht mit"): Wer sich nur verklickt hat, verliert nichts.
      // Gezählt werden sie nur mit Spieler (dayStats).
      await setPath("weeks", w.id, ["votes", uid()], { email: S.user ? S.user.email : "", playerId: val === "none" ? null : val, name: playerName(val) || (S.user && S.user.name) || "", picks: old.picks || {}, at: Date.now() });
    } catch (e) { fail(e); }
  },
};
