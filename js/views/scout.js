// Gegner-Steckbrief (Scouting, seit 22.11.2026, Wunsch Tim): alles, was die App über einen Gegner weiß, auf einen Blick.
// Steht oben auf der Gegner-Seite (#opponent-<name>) und lässt sich vor dem Match in den Planungs-Kanal posten.
// Zählt immer alle Matches gegen den Gegner (die Filter oben gelten hier nicht). Kein zusätzlicher Lesezugriff.
import { S } from "../state.js";
import { esc, pct, toast } from "../util.js";
import { sortMatches, teamSummary, mapStats, oppKey } from "../stats.js";
import { foeStats } from "../analysis.js";
import { points, pointKey } from "../review.js";
import { seriesSummary } from "../series.js";
import { ratingOf, CRITERIA } from "./opprating.js";
import { rateMaps } from "./veto.js";
import { currentPool } from "./mappool.js";
import { planHookOn, sendPlanHook, md, cut } from "../discord.js";
import { appUrl, errorText } from "../auth.js";
import { run } from "./auth.js";
import { record } from "./parts.js";

const TOP_AGENTS = 6;

export function scout(name) {
  const key = oppKey(name);
  const list = sortMatches(S.matches.filter((m) => oppKey(m.opponent) === key));
  if (!list.length) return null;
  const sum = teamSummary(list), last = list[0];
  const maps = mapStats(list);
  const foes = foeStats(list);
  const rating = ratingOf(name);
  // Baustellen aus dem Review der Matches gegen sie (häufigste zuerst)
  const work = new Map();
  for (const m of list) for (const p of points(m.work)) {
    const k = pointKey(p);
    if (k) work.set(k, { text: p, n: ((work.get(k) || {}).n || 0) + 1 });
  }
  // Veto: Bewertung des Map-Pools mit der Bilanz gegen diesen Gegner (wie im Veto-Helfer)
  let veto = null;
  const pool = currentPool().maps;
  if (pool.length >= 2) {
    const rated = rateMaps(pool, name);
    veto = { pick: rated[0], ban: rated[rated.length - 1] };
  }
  return {
    name: String(last.opponent || name).trim(), list, sum, last, maps, foes, rating, veto,
    series: seriesSummary(list),
    work: [...work.values()].sort((a, b) => b.n - a.n).slice(0, 3),
  };
}

const lastLine = (m) => `${(m.date || "").split("-").reverse().slice(0, 2).join(".")}. ${m.map || "Map?"} ${m.scoreUs ?? "?"}:${m.scoreThem ?? "?"}`;
const ratingLine = (r) => (r.voters ? CRITERIA.map(([c, l]) => `${l} ${r[c].up}👍 ${r[c].down}👎`).join(" · ") : "");

// Kasten oben auf der Gegner-Seite
export function scoutPanel(name) {
  const s = scout(name);
  if (!s) return "";
  const agents = s.foes.agents.slice(0, TOP_AGENTS);
  const comp = s.foes.comps[0];
  const row = (label, value) => (value ? `<div class="sc-row"><span>${esc(label)}</span><div>${value}</div></div>` : "");
  const body = [
    row("Bilanz", `<b>${record(s.sum)}</b> (${pct(s.sum.wr)})${s.series.n ? ` · Serien ${s.series.w}–${s.series.l}` : ""} · zuletzt ${esc(lastLine(s.last))}`),
    row("Bewertung", s.rating.voters ? esc(ratingLine(s.rating)) : '<span class="muted">noch nicht bewertet (unten)</span>'),
    row("Maps", s.maps.map((mp) => `<span class="tag">${esc(mp.name)} ${record(mp)}</span>`).join("")),
    row("Ihre Agents", agents.length ? agents.map((a) => `<span class="tag">${esc(a.name)} ${a.n}×</span>`).join("")
      : '<span class="muted">unbekannt (dafür beim Eintragen das Gegner-Scoreboard mit auslesen)</span>'),
    row("Häufigste Comp", comp ? `${esc(comp.agents.join(" / "))} <span class="muted">(${comp.n}×, ${esc(comp.maps.join(", "))})</span>` : ""),
    row("Veto-Vorschlag", s.veto ? `<b>${esc(s.veto.ban.map)}</b> bannen · <b>${esc(s.veto.pick.map)}</b> picken <a class="linkish" href="#veto">Veto-Helfer →</a>` : ""),
    row("Baustellen gegen sie", s.work.map((w) => `<span class="tag">${esc(w.text)}${w.n > 1 ? ` ${w.n}×` : ""}</span>`).join("")),
  ].join("");
  const btn = planHookOn()
    ? `<button class="btn small" type="button" data-action="scout-post" data-name="${esc(s.name)}">In Discord posten</button>`
    : '<span class="hint">Discord: Planungs-Kanal unter „Team“ eintragen</span>';
  return `<section class="panel scout"><div class="panel-head"><h2>Steckbrief</h2>${btn}</div><div class="panel-body">${body}</div></section>`;
}

// Dieselben Infos als Discord-Embed
export function buildScoutPost(name) {
  const s = scout(name);
  const fields = [];
  const add = (n, v, inline = false) => { if (v) fields.push({ name: n, value: cut(v, 1024), inline }); };
  add("Bilanz", `**${record(s.sum)}** (${pct(s.sum.wr)})${s.series.n ? ` · Serien ${s.series.w}–${s.series.l}` : ""}\nZuletzt: ${md(lastLine(s.last))}`, true);
  add("Bewertung", s.rating.voters ? md(ratingLine(s.rating)) : "", true);
  add("Maps", s.maps.map((mp) => `${md(mp.name)} ${record(mp)}`).join(" · "));
  add("Ihre Agents", s.foes.agents.slice(0, TOP_AGENTS).map((a) => `${md(a.name)} ${a.n}×`).join(" · "));
  const comp = s.foes.comps[0];
  add("Häufigste Comp", comp ? `${md(comp.agents.join(" / "))} (${comp.n}×)` : "");
  add("Veto-Vorschlag", s.veto ? `🚫 ${md(s.veto.ban.map)} bannen · ✅ ${md(s.veto.pick.map)} picken` : "");
  add("Baustellen gegen sie", s.work.map((w) => `• ${md(w.text)}`).join("\n"));
  return {
    username: "ScrimStar",
    embeds: [{
      title: cut(`🔎 Steckbrief: ${s.name}`, 256), url: appUrl() + "#opponent-" + encodeURIComponent(s.name),
      color: 0x0B7480, fields, footer: { text: `${s.list.length} ${s.list.length === 1 ? "Match" : "Matches"} gegen ${s.name}` },
    }],
  };
}

export const actions = {
  "scout-post": (el) => run(async () => {
    try {
      await sendPlanHook(buildScoutPost(el.dataset.name));
      toast(S.demo ? "Vorschau: Steckbrief wäre jetzt in Discord." : "Steckbrief in Discord gepostet.");
    } catch (e) { toast(e.plain ? e.message : errorText(e)); }
  }, { demoOk: true }),
};
