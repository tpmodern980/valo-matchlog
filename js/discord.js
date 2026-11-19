// Ergebnis in Discord posten (Wunsch Tim, 19.11.2026). Über einen Webhook des Discord-Kanals: Die Adresse trägt ein
// Admin im Tab "Team" ein, sie steht in config/team (nur fürs Team lesbar, nicht im öffentlichen Repo).
// Discord nimmt Webhook-Posts direkt aus dem Browser an (geprüft am 19.11.2026), ein eigener Server ist nicht nötig.
import { S } from "./state.js";
import { num, fmt2, fmtDate } from "./util.js";
import { result, roundInfo, kdOf } from "./stats.js";
import { appUrl } from "./auth.js";

// Webhook-Adressen von Discord (auch die Test-Versionen ptb/canary und die alte discordapp.com)
const WEBHOOK = /^https:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;
export const validWebhook = (url) => WEBHOOK.test(String(url || "").trim());

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
  const url = S.team && S.team.discordWebhook;
  const say = (text) => Object.assign(new Error(text), { plain: true });
  if (!validWebhook(url)) throw say("Für Discord ist noch kein Webhook eingetragen (Tab „Team“, nur Admins).");
  if (S.demo) {
    console.info("Vorschau: Diese Nachricht ginge an Discord:", buildPost(m));
    return;
  }
  let res;
  try {
    res = await fetch(url + "?wait=true", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(buildPost(m)) });
  } catch (e) {
    throw say("Discord war nicht erreichbar. Prüf die Verbindung (ein Werbeblocker kann discord.com sperren) und versuch es noch einmal.");
  }
  if (res.ok) return;
  if (res.status === 404 || res.status === 401) throw say("Discord kennt diesen Webhook nicht (mehr). Ein Admin trägt im Tab „Team“ einen neuen ein.");
  if (res.status === 429) throw say("Discord bremst gerade (zu viele Nachrichten). Warte kurz und versuch es noch einmal.");
  throw say(`Discord hat die Nachricht nicht angenommen (Fehler ${res.status}).`);
}
