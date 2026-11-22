// Gegner bewerten (Wunsch Tim, 22.11.2026): Jeder im Team gibt pro Gegner-Team Daumen hoch/runter für
// "Wieder scrimmen?", "Pünktlich" und "Fair". Angezeigt auf der Gegner-Seite und in der Gegner-Liste.
// Gespeichert in der Sammlung "weeks" (dieselbe Regel wie die Planung) als Dokument mit fester ID:
//   weeks/opprating = { kind: "opprating", ratings: { <Gegner-Schlüssel>: { <uid>: { name, again, punctual, fair, at } } } }
//   Werte: 1 = Daumen hoch, -1 = runter, 0 = keine Angabe. Jede Stimme ist ein eigener Feldpfad (upsertPath).
import { S, changed } from "../state.js";
import { esc, norm, toast } from "../util.js";
import { upsertPath } from "../data.js";
import { errorText } from "../auth.js";

export const RATING_ID = "opprating";
export const CRITERIA = [["again", "Wieder scrimmen?"], ["punctual", "Pünktlich"], ["fair", "Fair"]];

// Schlüssel eines Gegners als Firestore-Feldname: nur a–z und 0–9 (andere Zeichen als _<Code>), wie oppKey ohne Groß/Klein
export const rateKey = (name) => {
  const n = norm(name);
  return n ? "o_" + [...n].map((c) => (/[a-z0-9]/.test(c) ? c : "_" + c.codePointAt(0).toString(36))).join("") : "";
};
const doc = () => S.weeks.find((w) => w.id === RATING_ID && !w.deleted) || null;
const uid = () => (S.user ? S.user.uid : "");
const links = () => (S.team && S.team.links) || {};
const myName = () => {
  const l = S.user ? links()[S.user.email] : "";
  const p = l && l !== "manager" ? S.players.find((x) => x.id === l) : null;
  return (p && p.name) || (S.user && (S.user.name || (S.user.email || "").split("@")[0])) || "";
};

// Summe pro Kriterium: { again: { up, down }, … , voters }
export function ratingOf(name) {
  const votes = Object.values((((doc() || {}).ratings) || {})[rateKey(name)] || {});
  const out = { voters: votes.length };
  for (const [c] of CRITERIA) out[c] = { up: votes.filter((v) => v[c] === 1).length, down: votes.filter((v) => v[c] === -1).length };
  return out;
}

// Kurz für die Gegner-Liste: "👍 3 · 👎 1" für "Wieder scrimmen?", Tooltip mit allem
export function ratingShort(name) {
  const r = ratingOf(name);
  if (!r.voters) return '<span class="muted">–</span>';
  const tip = CRITERIA.map(([c, l]) => `${l}: ${r[c].up}× ja, ${r[c].down}× nein`).join(" · ");
  return `<span class="rt-short" title="${esc(tip)}">👍 ${r.again.up} · 👎 ${r.again.down}</span>`;
}

// Panel auf der Gegner-Seite
export function ratingPanel(name) {
  const key = rateKey(name);
  if (!key || !S.loaded.weeks) return "";
  const mine = ((((doc() || {}).ratings) || {})[key] || {})[uid()] || {};
  const r = ratingOf(name);
  const rows = CRITERIA.map(([c, label]) => `<div class="rt-row"><span class="rt-label">${esc(label)}</span>
      <span class="rt-btns">
        <button type="button" class="rt-btn up" data-action="rate-opp" data-name="${esc(name)}" data-c="${c}" data-v="1" aria-pressed="${mine[c] === 1}" aria-label="${esc(label)}: ja">👍</button>
        <button type="button" class="rt-btn down" data-action="rate-opp" data-name="${esc(name)}" data-c="${c}" data-v="-1" aria-pressed="${mine[c] === -1}" aria-label="${esc(label)}: nein">👎</button>
      </span>
      <span class="rt-sum">${r[c].up || r[c].down ? `${r[c].up}× ja · ${r[c].down}× nein` : '<span class="muted">noch keine Stimme</span>'}</span></div>`).join("");
  return `<section class="panel"><div class="panel-head"><h2>Bewertung</h2><span class="hint">${r.voters ? `${r.voters} ${r.voters === 1 ? "Stimme" : "Stimmen"}` : "jeder im Team kann bewerten"}</span></div>
    <div class="panel-body"><div class="rt-list">${rows}</div><p class="hint">Deine Wahl ist markiert. Nochmal antippen nimmt sie zurück.</p></div></section>`;
}

export const actions = {
  "rate-opp": async (el) => {
    const name = el.dataset.name, c = el.dataset.c, val = Number(el.dataset.v), key = rateKey(name);
    if (!key || !uid() || !CRITERIA.some(([x]) => x === c)) return;
    const old = ((((doc() || {}).ratings) || {})[key] || {})[uid()] || {};
    const next = { again: old.again || 0, punctual: old.punctual || 0, fair: old.fair || 0, name: myName(), at: Date.now() };
    next[c] = old[c] === val ? 0 : val;
    try { await upsertPath("weeks", RATING_ID, ["ratings", key, uid()], next, { kind: "opprating" }); changed(); }
    catch (e) { toast(e && e.plain ? e.message : (errorText(e) || "Speichern hat nicht geklappt.")); }
  },
};
