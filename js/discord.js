// Ergebnis in Discord posten (Wunsch Tim, 19.11.2026). Über Webhooks der Discord-Kanäle: Die Adressen trägt ein
// Admin im Tab "Team" ein, sie stehen in config/team (nur fürs Team lesbar, nicht im öffentlichen Repo).
// Ein Webhook gehört zu genau einem Kanal. Pro Map gibt es deshalb ein eigenes Ziel (discordMaps) und eine
// Standard-Adresse (discordWebhook) für Maps ohne eigenes Ziel. Ein Ziel pro Map ist entweder
//   - die Webhook-Adresse eines eigenen Kanals, oder
//   - der Link zu einem Beitrag in einem Forum-Kanal (oder nur dessen ID). Das Team hat ein Forum mit einem Beitrag
//     pro Map: Webhooks lassen sich nur fürs ganze Forum anlegen (das ist dann der Standard-Webhook), in den
//     Beitrag geht es über ?thread_id=<ID des Beitrags>.
// Discord nimmt Webhook-Posts direkt aus dem Browser an (geprüft am 19.11.2026), ein eigener Server ist nicht nötig.
import { badgeUps, TIERS } from "./badges.js";
import { seriesInfo, formatLabel } from "./series.js";
import { S } from "./state.js";
import { num, fmt2, fmtDate, norm } from "./util.js";
import { result, roundInfo, kdOf } from "./stats.js";
import { appUrl } from "./auth.js";
import { weekRecap } from "./recap.js";
import { goalLines, goalsOf, weekStarted } from "./goals.js";
import { points } from "./review.js";
// Planung: Datums- und Auswertungs-Helfer (Kreis-Import plan.js <-> discord.js ist in Ordnung: beide Seiten
// benutzen die Funktionen der anderen erst beim Aufruf, nie beim Laden)
import { lineupOf, lineupNames, KIND_LABEL, SLOTS, slotLabel, weekLabel, dayLabel, planLink, linkedMatch, REST, mondayOf } from "./views/plan.js";

// Webhook-Adressen von Discord (auch die Test-Versionen ptb/canary und die alte discordapp.com)
const WEBHOOK = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
export const validWebhook = (url) => WEBHOOK.test(String(url || "").trim());

// Link zu einem Forum-Beitrag (Rechtsklick → "Link kopieren"): https://discord.com/channels/<Server>/<Beitrag>
// (bei einem Nachrichten-Link folgt noch /<Nachricht>). Auch die nackte ID geht. Liefert die ID des Beitrags oder null.
const POST_LINK = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/\d+\/(\d+)(?:\/\d+)?\/?$/;
export function threadOf(value) {
  const s = String(value || "").trim();
  if (/^\d{15,22}$/.test(s)) return s;
  const m = POST_LINK.exec(s);
  return m ? m[1] : null;
}
// Gültiges Ziel für eine Map: eigener Webhook oder Forum-Beitrag
export const validMapTarget = (value) => validWebhook(value) || Boolean(threadOf(value));

// Wohin geht ein Match? Liefert { url, map, thread } oder null, wenn es kein Ziel gibt.
//   map    = Name der Map, wenn sie ein eigenes Ziel hat, sonst null (Standard)
//   thread = ID des Forum-Beitrags (dann geht es über den Standard-Webhook in diesen Beitrag), sonst null
export function hookFor(m) {
  const t = S.team || {};
  const maps = t.discordMaps || {};
  const def = validWebhook(t.discordWebhook) ? t.discordWebhook.trim() : null;
  const key = Object.keys(maps).find((k) => norm(k) === norm(m && m.map));
  const value = key ? maps[key] : "";
  if (validWebhook(value)) return { url: value.trim(), map: key, thread: null };
  const thread = threadOf(value);
  if (thread && def) return { url: def, map: key, thread };
  if (def) return { url: def, map: null, thread: null };
  return null;
}

// Ist überhaupt irgendein Ziel eingerichtet?
export function anyHook() {
  const t = S.team || {};
  return validWebhook(t.discordWebhook) || Object.values(t.discordMaps || {}).some(validWebhook);
}

const HEAD = {
  W: { icon: "✅", word: "Sieg", color: 0x1D8549 },
  L: { icon: "❌", word: "Niederlage", color: 0xC2362C },
  D: { icon: "➖", word: "Unentschieden", color: 0x8A6B12 },
  Q: { icon: "⏳", word: "Ergebnis offen", color: 0x0B7480 },
};

// Zeichen, die Discord als Formatierung liest, entschärfen (Namen wie "x_X_x" oder "**Tim**")
export const md = (s) => String(s ?? "").replace(/([\\*_~`|>#[\]])/g, "\\$1");
export const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// Scoreboard unseres Teams: nach Kills sortiert, bei Gleichstand nach K/D (wie auf der Match-Seite)
function boardLines(m) {
  const rows = (m.players || []).slice().sort((a, b) =>
    ((num(b.kills) ?? -1) - (num(a.kills) ?? -1)) || ((kdOf(num(b.kills), num(b.deaths)) ?? -1) - (kdOf(num(a.kills), num(a.deaths)) ?? -1)));
  const top = rows.length && num(rows[0].kills) !== null ? rows[0] : null;
  return rows.map((r) => {
    const p = r.playerId ? S.players.find((x) => x.id === r.playerId) : null;
    const name = p ? p.name : (r.name || "Unbekannt");
    const k = num(r.kills), d = num(r.deaths), a = num(r.assists);
    const kda = [k, d, a].map((v) => (v === null ? "–" : v)).join("/");
    const kd = kdOf(k, d);
    // Agent direkt am Namen (Wunsch Tim, 22.11.2026: Agents im Scoreboard gut sichtbar)
    const bits = [`\`${kda}\` **${md(name)}**${r.agent ? ` (${md(r.agent)})` : ""}`];
    if (kd !== null) bits.push(`K/D ${fmt2(kd)}`);
    if (r.former) bits.push("(ehemalig)");
    return bits.join(" · ") + (r === top ? " ⭐ MVP" : "");
  });
}

// Die Nachricht für Discord (ein "Embed"). Liefert das JSON für den Webhook.
export function buildPost(m) {
  const r = result(m), h = HEAD[r], d = fmtDate(m.date);
  const score = r === "Q" ? "" : ` ${num(m.scoreUs)}:${num(m.scoreThem)}`;
  const fields = [];
  const lines = boardLines(m);
  // Teil einer Serie (BO3/BO5): welche Map und wie es steht
  const ser = m.seriesId ? seriesInfo(m.seriesId) : null;
  if (ser) {
    const no = ser.maps.findIndex((x) => x.id === m.id) + 1;
    const state = ser.res === "W" ? "Serie gewonnen" : ser.res === "L" ? "Serie verloren" : "Stand";
    fields.push({ name: `${formatLabel(ser.format)}${ser.name ? " · " + md(ser.name) : ""}`, value: `Map ${no || ser.maps.length} · ${state} **${ser.w}:${ser.l}**` });
  }
  if (lines.length) fields.push({ name: "Scoreboard", value: cut(lines.join("\n"), 1024) });
  // Abzeichen, die mit diesem Match aufgestiegen sind (js/badges.js)
  const ups = badgeUps(m);
  if (ups.length) fields.push({ name: "🏅 Neue Abzeichen", value: cut(ups.map((u) => `${u.badge.icon} **${md(u.name)}**: ${md(u.badge.name)} ${TIERS[u.badge.tier]}`).join("\n"), 1024) });
  const ri = roundInfo(m);
  if (ri) {
    const parts = [];
    if (ri.atk.w + ri.atk.l) parts.push(`Angriff ${ri.atk.w}:${ri.atk.l}`);
    if (ri.def.w + ri.def.l) parts.push(`Verteidigung ${ri.def.w}:${ri.def.l}`);
    if (ri.pistolN) parts.push(`Pistols ${ri.pistolW}/${ri.pistolN}`);
    if (ri.overtime) parts.push("mit Overtime");
    if (parts.length) fields.push({ name: "Runden", value: parts.join(" · ") });
  }
  // Review (js/review.js)
  const good = points(m.good), work = points(m.work);
  if (good.length) fields.push({ name: "👍 Lief gut", value: cut(good.map((x) => `• ${md(x)}`).join("\n"), 1024) });
  if (work.length) fields.push({ name: "🛠️ Üben wir", value: cut(work.map((x) => `• ${md(x)}`).join("\n"), 1024) });
  if (m.notes) fields.push({ name: "Notizen", value: cut(md(m.notes), 1024) });
  // Stand der Wochenziele der Woche dieses Matches (js/goals.js), mit diesem Match schon eingerechnet
  if (m.date) {
    const goals = goalLines(mondayOf(m.date), true, isoToday());
    if (goals.length) fields.push({ name: "Wochenziele", value: cut(goals.join("\n"), 1024) });
  }
  return {
    username: "ScrimStar",
    embeds: [{
      title: cut(`${h.icon} ${h.word}${score} gegen ${m.opponent || "unbekannt"}`, 256),
      url: appUrl() + "#match-" + encodeURIComponent(m.id),
      description: [m.map ? `**${md(m.map)}**` : "", md(m.type || "Match"), d.full !== "–" ? d.full : ""].filter(Boolean).join(" · "),
      color: h.color,
      fields,
      footer: { text: "ScrimStar · Fan-Projekt, nicht mit Riot Games verbunden" },
    }],
  };
}

// Posten. Wirft einen Fehler mit deutscher Meldung (e.plain), wenn es nicht klappt.
export async function postMatch(m) {
  const hook = hookFor(m);
  const say = (text) => Object.assign(new Error(text), { plain: true });
  if (!hook) throw say("Für diese Map ist kein Discord-Kanal eingetragen und es gibt keinen Standard-Kanal (Tab „Team“, nur Admins).");
  const url = hook.url;
  if (S.demo) {
    console.info("Vorschau: Diese Nachricht ginge an Discord:", buildPost(m));
    return;
  }
  let res;
  try {
    const query = "?wait=true" + (hook.thread ? "&thread_id=" + hook.thread : "");
    res = await fetch(url + query, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildPost(m)) });
  } catch (e) {
    throw say("Discord war nicht erreichbar. Prüf die Verbindung (ein Werbeblocker kann discord.com sperren) und versuch es noch einmal.");
  }
  if (res.ok) return;
  let code = 0;
  try { code = Number((await res.json()).code) || 0; } catch (e) { /* ohne Einzelheiten */ }
  const where = hook.map ? `für ${hook.map}` : "des Standard-Kanals";
  // 220001: Der Standard-Webhook gehört zu einem Forum, und für diese Map ist kein Beitrag eingetragen
  if (code === 220001) throw say(`Der Standard-Webhook gehört zu einem Forum-Kanal. Dort braucht jede Map ihren Beitrag: Ein Admin trägt im Tab „Team“ bei ${m.map || "dieser Map"} den Link zum Forum-Beitrag ein.`);
  // 10003: Den Beitrag gibt es nicht (mehr) oder er liegt nicht im Forum dieses Webhooks
  if (code === 10003) throw say(`Den Forum-Beitrag ${where} findet Discord nicht (gelöscht oder in einem anderen Forum als der Standard-Webhook). Ein Admin trägt im Tab „Team“ den richtigen Link ein.`);
  if (res.status === 404 || res.status === 401) throw say(`Discord kennt den Webhook ${hook.thread ? "des Forums" : where} nicht (mehr). Ein Admin trägt im Tab „Team“ einen neuen ein.`);
  if (res.status === 429) throw say("Discord bremst gerade (zu viele Nachrichten). Warte kurz und versuch es noch einmal.");
  throw say(`Discord hat die Nachricht nicht angenommen (Fehler ${res.status}).`);
}

// ---------- Planung (Tab "Planung", js/views/plan.js) ----------
// Eigener Webhook für den Planungs-Kanal (config/team.discordPlan): Umfrage ankündigen und Wochenplan posten.

export const planHookOn = () => validWebhook(S.team && S.team.discordPlan);
// Umfrage und Wochenplan: eigener Kanal (discordSchedule), sonst der Planungs-Kanal
const scheduleUrl = () => (validWebhook(S.team && S.team.discordSchedule) ? S.team.discordSchedule : S.team && S.team.discordPlan);
export const scheduleHookOn = () => validWebhook(scheduleUrl());

export async function sendPlanHook(payload, url = S.team && S.team.discordPlan) {
  const say = (text) => Object.assign(new Error(text), { plain: true });
  if (!validWebhook(url)) throw say("Für die Planung ist kein Discord-Kanal eingetragen (Tab „Team“ → Discord).");
  if (S.demo) { console.info("Vorschau: Diese Nachricht ginge an Discord:", payload); return; }
  let res;
  try {
    res = await fetch(url.trim() + "?wait=true", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  } catch (e) {
    throw say("Discord war nicht erreichbar. Prüf die Verbindung (ein Werbeblocker kann discord.com sperren) und versuch es noch einmal.");
  }
  if (res.ok) return;
  let code = 0;
  try { code = Number((await res.json()).code) || 0; } catch (e) { /* ohne Einzelheiten */ }
  if (code === 220001) throw say("Der Planungs-Webhook gehört zu einem Forum-Kanal. Nimm für die Planung einen normalen Text-Kanal.");
  if (res.status === 404 || res.status === 401) throw say("Discord kennt diesen Webhook nicht (mehr). Ein Admin trägt im Tab „Team“ unter Discord einen neuen ein.");
  if (res.status === 429) throw say("Discord bremst gerade (zu viele Nachrichten). Warte kurz und versuch es noch einmal.");
  throw say(`Discord hat die Nachricht nicht angenommen (Fehler ${res.status}).`);
}

const isoToday = () => { const t = new Date(); return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`; };
const FOOT = { text: "ScrimStar · Fan-Projekt, nicht mit Riot Games verbunden" };

// Umfrage ankündigen: welche Tage, welche Uhrzeiten, Link zum Abstimmen
export function buildPollPost(w) {
  const link = appUrl() + planLink(w.start);
  const lines = (w.days || []).map((d) => `**${dayLabel(d.date)}** · ${KIND_LABEL[d.kind] || "Scrim"} · ${(SLOTS[d.kind] || SLOTS.scrim).map(slotLabel).join(" / ")}`);
  return {
    username: "ScrimStar",
    embeds: [{
      title: cut(`📅 Umfrage ${weekLabel(w.start)}`, 256), url: link, color: 0x0B7480,
      description: cut(`Wann könnt ihr? Bitte in ScrimStar abstimmen, mehrere Uhrzeiten gehen.\n**[Jetzt abstimmen](${link})**\n\n${lines.join("\n")}`, 4000),
      footer: FOOT,
    }],
  };
}
export const postPoll = (w) => sendPlanHook(buildPollPost(w), scheduleUrl());

// Erinnerung an die Umfrage (Wunsch Tim, 22.11.2026): wer noch nicht (ganz) abgestimmt hat, mit Link. Geht wie die Umfrage
// in den Kanal für Umfrage und Wochenplan.
export function buildRemindPost(w, miss) {
  const link = appUrl() + planLink(w.start);
  const who = miss.map((x) => `• **${md(x.name)}**${x.all ? "" : ` (${x.open} ${x.open === 1 ? "Tag" : "Tage"} offen)`}`);
  // Anpingen geht nur im normalen Text (content), nicht im Kasten (Embed). allowed_mentions: nur genau diese Leute
  const ids = miss.map((x) => x.discordId).filter(Boolean);
  return {
    username: "ScrimStar",
    ...(ids.length ? { content: `${ids.map((id) => `<@${id}>`).join(" ")} bitte noch abstimmen 🗳️`, allowed_mentions: { parse: [], users: ids } } : {}),
    embeds: [{
      title: cut(`⏰ Erinnerung: Umfrage ${weekLabel(w.start)}`, 256), url: link, color: 0xD1A12A,
      description: cut(`Bitte noch abstimmen, damit der Wochenplan steht.\n**[Jetzt abstimmen](${link})**\n\n${who.join("\n")}`, 4000),
      footer: FOOT,
    }],
  };
}
export const postRemind = (w, miss) => sendPlanHook(buildRemindPost(w, miss), scheduleUrl());

// Discord-ID eines Spielers (für Pings), sonst ""
const pingId = (id) => { const p = S.players.find((x) => x.id === id); return p && /^\d{17,20}$/.test(p.discordId || "") ? p.discordId : ""; };
const nameOf = (id) => (S.players.find((x) => x.id === id) || {}).name || "?";

// Absage für einen Termin ("Ich kann doch nicht"): wer abgesagt hat, wer nachrückt (wird angepingt), neue Aufstellung
export function buildAbsencePost(w, e, who, sub, lu) {
  const when = `${dayLabel(e.date)}${e.time ? ` ${e.time}` : ""} · ${e.type}${e.opponent ? ` vs ${e.opponent}` : ""}`;
  const lines = [sub ? `🔁 **Ersatz:** ${md(nameOf(sub))} (kann laut Umfrage)` : "⚠️ **Kein Ersatz in der Umfrage.** Wer kann einspringen?"];
  if (lu.ids.length) lines.push(`👥 **Aufstellung jetzt:** ${lineupNames(lu.ids).map(md).join(", ")}${lu.ids.length < 5 ? ` (noch ${5 - lu.ids.length} offen)` : ""}`);
  lines.push(`**[Zum Wochenplan](${appUrl() + planLink(w.start)})**`);
  const ids = sub && pingId(sub) ? [pingId(sub)] : [];
  return {
    username: "ScrimStar",
    ...(ids.length ? { content: `<@${ids[0]}> du rückst nach für ${md(when)} 🎮`, allowed_mentions: { parse: [], users: ids } } : {}),
    embeds: [{ title: cut(`❌ ${nameOf(who)} kann doch nicht · ${when}`, 256), color: 0xC8374E, description: cut(lines.join("\n"), 4000), footer: FOOT }],
  };
}
export const postAbsence = (w, e, who, sub, lu) => sendPlanHook(buildAbsencePost(w, e, who, sub, lu), scheduleUrl());

// Wochenplan: alle Termine der Woche, abgesagte durchgestrichen, gespielte mit Ergebnis
export function buildPlanPost(w) {
  const link = appUrl() + planLink(w.start);
  const plan = (w.plan || []).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.time || "").localeCompare(String(b.time || "")));
  // Jeder Tag als eigene Überschrift, darunter seine Termine (Wunsch Tim, 22.11.2026: alle Tage gleich, keiner als Unterpunkt)
  // Kein Anpingen hier (Tim, 22.11.2026: spielt eh jeder irgendwann in der Woche). Pings gibt es bei Erinnerung und Ersatz.
  const lines = [];
  for (const e of plan) {
    if (!lines.length || lines.lastDay !== e.date) { lines.push(`### ${dayLabel(e.date)}`); lines.lastDay = e.date; }
    lines.push(line(e));
    // Wer spielt (Aufstellung aus der Umfrage oder von Hand, js/views/plan.js)
    const lu = lineupOf(w, e);
    if (lu.ids.length) lines.push(`\u2003👥 ${lineupNames(lu.ids).map(md).join(", ")}`);
    else if (lu.need) lines.push(`\u2003👥 ${lu.avail.length} können, Aufstellung folgt`);
  }
  function line(e) {
    if (e.type === REST) return `💤 Ruhetag${e.note ? ` – ${md(e.note)}` : ""}`;
    const mm = e.status === "cancelled" ? null : linkedMatch(e, w), opp = e.opponent || (mm && String(mm.opponent || "").trim()) || "";
    const text = `${e.time ? `**${e.time}** · ` : ""}${md(e.type)}${opp ? ` vs ${md(opp)}` : ""}${e.note ? ` – ${md(e.note)}` : ""}`;
    if (e.status === "cancelled") return `❌ ~~${text}~~ (abgesagt)`;
    const m = linkedMatch(e, w);
    if (m) return result(m) === "Q" ? `✅ ${text} (gespielt)` : `✅ ${text} → ${num(m.scoreUs)}:${num(m.scoreThem)} ${HEAD[result(m)].word}`;
    return `▫️ ${text}`;
  }
  // Wochenziele (js/goals.js) unter den Terminen
  const goals = goalLines(w.start, false, isoToday());
  if (goals.length) lines.push("### Wochenziele", ...goals);
  return {
    username: "ScrimStar",
    embeds: [{
      title: cut(`🗓️ Wochenplan ${weekLabel(w.start)}`, 256), url: link, color: 0x0B7480,
      description: cut(lines.length ? lines.join("\n") : "Noch keine Termine.", 4000),
      footer: FOOT,
    }],
  };
}
export const postPlan = (w) => sendPlanHook(buildPlanPost(w), scheduleUrl());

// Wochenrückblick (js/recap.js): Bilanz, Ergebnisse, Spieler der Woche, Maps, Plan. Geht in den Planungs-Kanal.
const de1 = (n) => n.toFixed(1).replace(".", ","), de2 = (n) => n.toFixed(2).replace(".", ",");
const rec = (t) => `${t.w}–${t.l}${t.d ? "–" + t.d : ""}`;
const pc = (n) => (n === null ? "" : ` (${Math.round(n * 100)} %)`);
export function buildRecapPost(start, w = null) {
  const r = weekRecap(start, w);
  const link = appUrl() + planLink(start);
  if (!r) throw Object.assign(new Error("In dieser Woche ist noch kein Match eingetragen."), { plain: true });
  const s = r.sum;
  const lines = [];
  lines.push(`**Bilanz ${rec(s)}**${pc(s.wr)}${s.diff !== null ? ` · Ø Rundendiff. ${s.diff > 0 ? "+" : ""}${de1(s.diff)}` : ""}${s.pistolN ? ` · Pistols ${s.pistolW}/${s.pistolN}` : ""}`);
  if (r.byType.length > 1) lines.push(r.byType.map((t) => `${md(t.type)} ${rec(t)}`).join(" · "));
  if (r.prev) lines.push(`Vorwoche: ${rec(r.prev)}${pc(r.prev.wr)}`);
  lines.push("", "**Ergebnisse**");
  for (const { m, r: res } of r.results) {
    const score = res === "Q" ? "offen" : `${num(m.scoreUs)}:${num(m.scoreThem)}`;
    lines.push(`${HEAD[res].icon} ${dayLabel(m.date)} · ${md(m.type || "Match")} · ${md(m.map || "Map?")} vs ${md(m.opponent || "?")} · ${score}`);
  }
  const people = [];
  if (r.mvp) people.push(`🏆 **Spieler der Woche: ${md(r.mvp.name)}** · K/D ${de2(r.mvp.kd)} · ${r.mvp.kills} Kills in ${r.mvp.n} ${r.mvp.n === 1 ? "Match" : "Matches"}`);
  const more = [r.topKills ? `Meiste Kills: ${md(r.topKills.name)} (${r.topKills.kills})` : "", r.topFb ? `Meiste First Bloods: ${md(r.topFb.name)} (${r.topFb.fb})` : ""].filter(Boolean);
  if (more.length) people.push(more.join(" · "));
  if (people.length) lines.push("", ...people);
  const mapBits = [r.most ? `meistgespielt ${md(r.most.name)} (${r.most.n}×, ${rec(r.most)})` : "", r.best && (!r.most || r.best.key !== r.most.key) ? `beste ${md(r.best.name)} (${rec(r.best)})` : ""].filter(Boolean);
  if (mapBits.length) lines.push("", `🗺️ Maps: ${mapBits.join(" · ")}`);
  if (r.form.length) lines.push(`📈 Form: ${r.form.map((x) => `${x.dir === "up" ? "↑" : "↓"} ${md(x.name)} ${x.delta > 0 ? "+" : "−"}${Math.abs(Math.round(x.delta * 100))} %`).join(" · ")}`);
  const goals = goalLines(start, true, isoToday());
  if (goals.length) lines.push("", "**Wochenziele**", ...goals);
  if (r.plan) lines.push(`🗓️ Plan: ${r.plan.played} von ${r.plan.total} ${r.plan.total === 1 ? "Termin" : "Terminen"} gespielt${r.plan.cancelled ? ` · ${r.plan.cancelled} abgesagt` : ""}${r.plan.rest ? ` · ${r.plan.rest} ${r.plan.rest === 1 ? "Ruhetag" : "Ruhetage"}` : ""}`);
  lines.push("", `[In ScrimStar ansehen](${link})`);
  const color = s.wr === null ? 0x0B7480 : s.wr > 0.5 ? HEAD.W.color : s.wr < 0.5 ? HEAD.L.color : HEAD.D.color;
  return {
    username: "ScrimStar",
    embeds: [{ title: cut(`📊 Wochenrückblick ${weekLabel(start)}`, 256), url: link, color, description: cut(lines.join("\n"), 4000), footer: FOOT }],
  };
}
export const postRecap = (start, w) => sendPlanHook(buildRecapPost(start, w));

// Wochenziele einzeln posten (Wunsch Tim, 22.11.2026: Der Wochenplan läuft vorerst nicht über die App).
// Vor der Woche nur die Ziele, ab Wochenbeginn mit dem aktuellen Stand. Geht in den Planungs-Kanal.
export function buildGoalsPost(start) {
  const goals = goalsOf(start);
  if (!goals.length) throw Object.assign(new Error("Für diese Woche gibt es noch keine Ziele."), { plain: true });
  const today = isoToday(), link = appUrl() + planLink(start);
  const started = weekStarted(start, today);
  const lines = [...goalLines(start, started, today), "", `[In ScrimStar ansehen](${link})`];
  return {
    username: "ScrimStar",
    embeds: [{ title: cut(`🎯 Wochenziele ${weekLabel(start)}`, 256), url: link, color: 0x0B7480, description: cut(lines.join("\n"), 4000), footer: FOOT }],
  };
}
export const postGoals = (start) => sendPlanHook(buildGoalsPost(start));
