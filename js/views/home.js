// Startseite "Diese Woche" (#home, Wunsch Tim, 22.11.2026): was man beim Öffnen der App zuerst sehen will.
// Bilanz der Woche, nächster Termin (falls ein Wochenplan in der App steht), Stand der Wochenziele, die Ergebnisse
// der Woche und die wichtigsten Erkenntnisse aus dem Tab "Analyse". Rechnet nur mit dem, was schon geladen ist.
import { S } from "../state.js";
import { esc, isoDate, pct, signed1, daysAgo } from "../util.js";
import { teamSummary, sortMatches, playerStats, formOf, FORM_N } from "../stats.js";
import { formBadge } from "./player.js";
import { avatar } from "./profile.js";
import { installHint } from "./install.js";
import { matchesOfWeek } from "../recap.js";
import { goalsOf, goalTitle, goalStatus } from "../goals.js";
import { mondayOf, addDays, weekLabel, weekOf, dayLabel, planLink, REST, recapPostedAt } from "./plan.js";
import { planHookOn } from "../discord.js";
import { insights } from "./analysis.js";
import { workItems } from "../review.js";
import { tiles, matchRow, record } from "./parts.js";

const fmtShort = (iso) => { const p = String(iso || "").split("-"); return p.length === 3 ? `${p[2]}.${p[1]}.` : "–"; };
const STATE_CLS = { done: "good", track: "good", miss: "bad", behind: "warn", open: "", nodata: "" };

function nextEntry(today) {
  // Heute und die nächsten 7 Tage, aus dieser und der nächsten Woche
  const start = mondayOf(today);
  const entries = [weekOf(start), weekOf(addDays(start, 7))].filter(Boolean)
    .flatMap((w) => (w.plan || []).map((e) => ({ ...e, week: w.start })))
    .filter((e) => e.status !== "cancelled" && e.type !== REST && e.date >= today && e.date <= addDays(today, 7))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time || "").localeCompare(String(b.time || "")));
  return entries[0] || null;
}

export function homeView() {
  const today = isoDate(new Date()), start = mondayOf(today);
  const head = `<div class="view-head"><div><div class="eyebrow">Übersicht</div><h1>Diese Woche</h1><p>${esc(weekLabel(start))}</p></div>
    <div class="head-side hm-actions"><button class="btn primary" type="button" data-action="mf-new">Match eintragen</button>
      <a class="btn" href="${planLink(start)}">Wochenziele</a></div></div>`;
  if (!S.loaded.matches) return head + '<p class="loading">Lade …</p>';

  const week = matchesOfWeek(start);
  const sum = teamSummary(week);
  const cards = week.length ? tiles([
    ["Bilanz", record(sum), `${week.length} ${week.length === 1 ? "Match" : "Matches"} diese Woche`],
    ["Winrate", pct(sum.wr), "gewertete Matches"],
    ["Ø Rundendiff.", signed1(sum.diff), "pro Match"],
    ["Pistols", sum.pistolN ? pct(sum.pistolWr) : "–", sum.pistolN ? `${sum.pistolW} von ${sum.pistolN}` : "kein Rundenverlauf"],
  ]) : '<div class="empty"><h2>Noch kein Match diese Woche</h2><p>Sobald ein Match eingetragen ist, steht hier die Bilanz der Woche.</p></div>';

  // Nächster Termin (nur, wenn ihr den Wochenplan in der App führt)
  const next = S.loaded.weeks ? nextEntry(today) : null;
  const nextPanel = next ? `<a class="hm-next" href="${planLink(next.week)}"><span>Nächster Termin</span>
      <b>${esc(next.date === today ? "Heute" : dayLabel(next.date))}${next.time ? ` · ${esc(next.time)}` : ""} · ${esc(next.type)}${next.opponent ? ` vs ${esc(next.opponent)}` : ""}</b>
      ${next.note ? `<small>${esc(next.note)}</small>` : ""}</a>` : "";

  // Wochenziele kurz
  const goals = S.loaded.weeks ? goalsOf(start) : [];
  const goalRows = goals.map((g) => {
    const s = goalStatus(g, start, today);
    return `<a class="hm-goal" href="${planLink(start)}"><span class="hm-goal-t">${esc(goalTitle(g))}${s.value ? `<small>${esc(s.value.text)}</small>` : ""}</span><span class="gl-state ${STATE_CLS[s.state] || ""}">${esc(s.label)}</span></a>`;
  }).join("");
  const goalPanel = `<section class="panel"><div class="panel-head"><h2>Wochenziele</h2><a class="linkish" href="${planLink(start)}">${goals.length ? "Alle Ziele →" : "Ziele anlegen →"}</a></div>
    ${goals.length ? `<div class="hm-goals">${goalRows}</div>` : '<p class="hint pad">Für diese Woche gibt es noch keine Ziele.</p>'}</section>`;

  // Ergebnisse: diese Woche, sonst die letzten drei
  const recent = week.length ? sortMatches(week) : sortMatches(S.matches).slice(0, 3);
  const results = recent.length ? `<section class="sec"><div class="sec-head"><h2>${week.length ? "Ergebnisse der Woche" : "Zuletzt gespielt"}</h2><a class="linkish" href="#matches">Alle Matches →</a></div>
    <div class="match-list">${recent.map(matchRow).join("")}</div></section>` : "";

  // Erkenntnisse aus den letzten 30 Tagen (wie im Tab "Analyse", höchstens drei)
  const last30 = S.matches.filter((m) => (m.date || "") >= daysAgo(30));
  const tips = insights(last30).slice(0, 3);
  const tipPanel = tips.length ? `<section class="sec"><div class="sec-head"><h2>Erkenntnisse</h2><a class="linkish" href="#analysis">Analyse →</a></div>
    <p class="hint">Aus den letzten 30 Tagen.</p>
    <div class="an-cards">${tips.map((x) => `<a class="an-card ${x.tone}" href="#analysis${x.sub ? "-" + x.sub : ""}"><b>${esc(x.title)}</b><span>${esc(x.text)}</span><small>Details →</small></a>`).join("")}</div></section>` : "";

  // Form der Spieler (Wunsch Tim, 22.11.2026): wer gerade heiß ↑ oder kalt ↓ läuft, aus allen Matches
  const form = playerStats(S.matches).filter((s) => s.status !== "ex").map((s) => ({ s, f: formOf(s) })).filter((x) => x.f)
    .sort((a, b) => b.f.delta - a.f.delta);
  const formPanel = form.length ? `<section class="panel"><div class="panel-head"><h2>Form der Spieler</h2><span class="hint">KPR der letzten ${FORM_N} Matches gegen den eigenen Schnitt</span></div>
    <div class="hm-form">${form.map(({ s }) => `<a class="hm-player" href="#player-${esc(encodeURIComponent(s.id))}"><span class="pl-av">${s.player ? avatar(s.player, 24) : ""}<b>${esc(s.name)}</b></span>${formBadge(s)}</a>`).join("")}</div></section>` : "";

  // Baustellen (js/review.js): was in den letzten 30 Tagen unter "Üben wir" stand, öfter genannte zuerst
  const work = workItems(daysAgo(30)).slice(0, 6);
  const workPanel = work.length ? `<section class="panel"><div class="panel-head"><h2>Baustellen</h2><span class="hint">„Üben wir“ aus den letzten 30 Tagen</span></div>
    <div class="hm-goals">${work.map((x) => `<a class="hm-goal" href="#match-${esc(x.ids[x.ids.length - 1])}"><span class="hm-goal-t">${esc(x.text)}<small>zuletzt ${esc(fmtShort(x.last))}</small></span><span class="gl-state${x.n > 1 ? " warn" : ""}">${x.n}× genannt</span></a>`).join("")}</div></section>` : "";

  // Admins: offene Zugangs-Anfragen (js/access.js)
  const reqs = S.isAdmin ? (S.requests || []).length : 0;
  const reqNote = reqs ? `<a class="hm-next hm-req" href="#team"><span>Zugang</span><b>${reqs} ${reqs === 1 ? "offene Anfrage" : "offene Anfragen"}</b><small>Im Tab „Team“ freischalten</small></a>` : "";
  // Rückblick der Vorwoche noch nicht gepostet (nur Admins, nur mit Planungs-Kanal): Hinweis mit Knopf
  const prevStart = addDays(start, -7), prevN = matchesOfWeek(prevStart).length;
  const recapNote = S.isAdmin && S.loaded.weeks && planHookOn() && prevN && !recapPostedAt(prevStart)
    ? `<div class="notice hm-recap"><span><b>Wochenrückblick ${esc(weekLabel(prevStart))}</b> ist noch nicht in Discord (${prevN} ${prevN === 1 ? "Match" : "Matches"}).
        <a class="linkish" href="${planLink(prevStart)}">Ansehen</a></span>
        <button class="btn small primary" type="button" data-action="plan-post-recap" data-start="${prevStart}">Jetzt posten</button></div>` : "";
  return head + installHint() + reqNote + recapNote + nextPanel + cards + goalPanel + workPanel + formPanel + results + tipPanel;
}
