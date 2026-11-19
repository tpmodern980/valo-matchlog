// Ergebnis in Discord posten (Wunsch Tim, 19.11.2026). Über Webhooks der Discord-Kanäle: Die Adressen trägt ein
// Admin im Tab "Team" ein, sie stehen in config/team (nur fürs Team lesbar, nicht im öffentlichen Repo).
// Ein Webhook gehört zu genau einem Kanal. Pro Map gibt es deshalb ein eigenes Ziel (discordMaps) und eine
// Standard-Adresse (discordWebhook) für Maps ohne eigenes Ziel. Ein Ziel pro Map ist entweder
//   - die Webhook-Adresse eines eigenen Kanals, oder
//   - der Link zu einem Beitrag in einem Forum-Kanal (oder nur dessen ID). Das Team hat ein Forum mit einem Beitrag
//     pro Map: Webhooks lassen sich nur fürs ganze Forum anlegen (das ist dann der Standard-Webhook), in den
//     Beitrag geht es über ?thread_id=<ID des Beitrags>.
// Discord nimmt Webhook-Posts direkt aus dem Browser an (geprüft am 19.11.2026), ein eigener Server ist nicht nötig.
import { S } from "./state.js";
import { num, fmt2, fmtDate, norm } from "./util.js";
import { result, roundInfo, kdOf } from "./stats.js";
import { appUrl } from "./auth.js";

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
const md = (s) => String(s ?? "").replace(/([\\*_~`|>#[\]])/g, "\\$1");
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

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
    const bits = [`\`${kda}\` **${md(name)}**`];
    if (r.agent) bits.push(md(r.agent));
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
  if (lines.length) fields.push({ name: "Scoreboard", value: cut(lines.join("\n"), 1024) });
  const ri = roundInfo(m);
  if (ri) {
    const parts = [];
    if (ri.atk.w + ri.atk.l) parts.push(`Angriff ${ri.atk.w}:${ri.atk.l}`);
    if (ri.def.w + ri.def.l) parts.push(`Verteidigung ${ri.def.w}:${ri.def.l}`);
    if (ri.pistolN) parts.push(`Pistols ${ri.pistolW}/${ri.pistolN}`);
    if (ri.overtime) parts.push("mit Overtime");
    if (parts.length) fields.push({ name: "Runden", value: parts.join(" · ") });
  }
  if (m.notes) fields.push({ name: "Notizen", value: cut(md(m.notes), 1024) });
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
