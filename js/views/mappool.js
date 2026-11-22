// Map-Pool-Umfrage im Tab "Maps" (Wunsch Tim, 22.11.2026): Jeder gibt pro Map des aktuellen Pools 1–5 Sterne
// ("wie gern / wie gut spiele ich sie") und kann Maps zum Bannen vorschlagen. Daraus: Rangliste mit Ø Sterne,
// Bann-Stimmen und der echten Bilanz aus den Matches. Hilft bei "welche Maps spielen wir im Turnier, welche bannen wir".
//
// Gespeichert in der Sammlung "weeks" als Dokument mit fester ID "mappool" (dieselbe Firestore-Regel wie die
// Planung, keine neue Zeile nötig):
//   { kind: "mappool", ratings: { <uid>: { email, name, stars: { <Map>: 1..5 }, ban: [<Map>], at } } }
// Jede Stimme ist ein eigener Feldpfad (upsertPath): Gleichzeitiges Abstimmen überschreibt nichts.
// Pool: aktive Maps aus dem Strats-Ordner in Google Drive (Ordner ohne Klammer wie "(inactiv)"), ohne Drive alle Maps.
// Offen wie die Planung: Alle sehen, wer was gewählt hat. Stimmen der Managerin zählen nicht (Konto-Zuordnung im Tab "Team").
import { S, changed } from "../state.js";
import { MAPS } from "../constants.js";
import { esc, norm, pct, toast } from "../util.js";
import { upsertPath, change } from "../data.js";
import { mapStats } from "../stats.js";
import { stratsOn, stratsState, loadStrats, hasStrats } from "../strats.js";
import { record } from "./parts.js";
import { stratsLink } from "./strats.js";
import { errorText } from "../auth.js";

export const POOL_ID = "mappool";
const STAR = "★";

const poolDoc = () => S.weeks.find((w) => w.id === POOL_ID) || null;
const uid = () => (S.user ? S.user.uid : "");
const links = () => (S.team && S.team.links) || {};
const playerName = (id) => { const p = S.players.find((x) => x.id === id); return p ? p.name : ""; };
// Wer ist eine Stimme? Zugeordnetes Konto -> Spielername; "manager" zählt nicht; sonst der Name aus der Stimme
const voterOf = (v) => {
  const l = v && v.email ? links()[v.email] : "";
  if (l === "manager") return null;
  return (l && playerName(l)) || v.name || (v.email ? v.email.split("@")[0] : "?");
};
const iAmManager = () => Boolean(S.user && links()[S.user.email] === "manager");

// Aktueller Pool: aktive Map-Ordner aus Drive, sonst alle bekannten Maps
export function currentPool() {
  if (stratsOn()) {
    const { tree } = stratsState();
    if (tree && tree.maps.length) {
      const active = tree.maps.filter((m) => !m.note).map((m) => MAPS.find((x) => norm(x) === norm(m.base)) || m.base);
      if (active.length) return { maps: active, from: "drive" };
    }
  }
  return { maps: MAPS.slice(), from: "all" };
}

// Auswertung pro Map: Ø Sterne, Anzahl Stimmen, Bann-Stimmen (Namen), Bilanz aus allen Matches
function results(pool) {
  const doc = poolDoc();
  const votes = Object.values((doc && doc.ratings) || {}).map((v) => ({ v, who: voterOf(v) })).filter((x) => x.who);
  // Derselbe Spieler doppelt (zwei Konten): die neuere Stimme zählt
  const byWho = new Map();
  for (const x of votes.sort((a, b) => (a.v.at || 0) - (b.v.at || 0))) byWho.set(x.who, x.v);
  const stats = new Map(mapStats(S.matches).map((s) => [s.key, s]));
  const rows = pool.map((map) => {
    const stars = [], bans = [];
    for (const [who, v] of byWho) {
      const s = Number((v.stars || {})[map]);
      if (s >= 1 && s <= 5) stars.push({ who, s });
      if ((v.ban || []).includes(map)) bans.push(who);
    }
    const avg = stars.length ? stars.reduce((n, x) => n + x.s, 0) / stars.length : null;
    return { map, avg, n: stars.length, stars, bans, st: stats.get(norm(map)) || null };
  });
  rows.sort((a, b) => (b.avg ?? -1) - (a.avg ?? -1) || a.bans.length - b.bans.length || a.map.localeCompare(b.map, "de"));
  return { rows, voters: [...byWho.entries()] };
}

// Für den Tab "Strats": Ø Sterne und Bann-Stimmen einer Map (null = noch keine Stimme)
export function poolAverage(map) {
  if (!S.loaded.weeks || !poolDoc()) return null;
  const r = results([map]).rows[0];
  return r && r.avg !== null ? { avg: r.avg, n: r.n, bans: r.bans.length } : null;
}

let showWho = false;   // Tabelle "Wer hat was gewählt" offen
let panelOpen = null;  // null = automatisch (offen, bis man abgestimmt hat)
let resetSure = false;

export function mapPoolPanel() {
  if (stratsOn()) setTimeout(() => loadStrats(), 0);   // Pool aus Drive auf Stand halten (meist aus dem Zwischenspeicher)
  const { maps: pool, from } = currentPool();
  const doc = poolDoc();
  const mine = ((doc && doc.ratings) || {})[uid()] || {};
  // Klappbar: offen, solange man selbst noch nicht abgestimmt hat (oder bis man es selbst auf-/zuklappt)
  const voted = Object.keys(mine.stars || {}).length > 0;
  const isOpen = panelOpen === null ? !voted || iAmManager() : panelOpen;
  const head = (hint) => `<details class="panel fold pool-panel" data-pool-panel${isOpen ? " open" : ""}><summary class="panel-head"><h2>Map-Pool-Umfrage</h2><span class="hint">${hint}</span><span class="fold-mark" aria-hidden="true"></span></summary><div class="panel-body">`;
  if (!S.loaded.weeks) return head("") + '<p class="loading">Lade Umfrage …</p></div></details>';
  const { rows, voters } = results(pool);
  const top = rows.filter((r) => r.avg !== null).slice(0, 3).map((r) => `${r.map} ${r.avg.toFixed(1).replace(".", ",")}${STAR}`).join(" · ");

  // Eigene Stimme
  let mineHtml;
  if (iAmManager()) mineHtml = '<p class="hint">Als Managerin stimmst du nicht mit ab. Unten siehst du, was das Team denkt.</p>';
  else {
    mineHtml = `<div class="pool-vote">${pool.map((map) => {
      const s = Number((mine.stars || {})[map]) || 0, ban = (mine.ban || []).includes(map);
      const stars = [1, 2, 3, 4, 5].map((n) => `<button type="button" class="pool-star${n <= s ? " on" : ""}" data-action="mp-rate" data-map="${esc(map)}" data-stars="${n}" aria-label="${esc(map)}: ${n} von 5 Sternen" aria-pressed="${n === s}">${STAR}</button>`).join("");
      return `<div class="pool-row"><b class="pool-map">${esc(map)}</b><span class="pool-stars" role="group" aria-label="Sterne für ${esc(map)}">${stars}</span>
        <button type="button" class="chip-btn no pool-ban" data-action="pool-ban" data-map="${esc(map)}" aria-pressed="${ban}">bannen</button></div>`;
    }).join("")}</div>
    <p class="hint">Pro Map 1–5 Sterne: Wie gern und wie gut spielst du sie? Nochmal auf denselben Stern tippen löscht die Wertung. „bannen“ = diese Map würdest du im Turnier wegbannen. Gespeichert wird sofort, ändern geht jederzeit.</p>`;
  }

  // Ergebnis
  const starsText = (avg) => (avg === null ? "–" : `${avg.toFixed(1).replace(".", ",")} ${STAR}`);
  const resultRows = rows.map((r, i) => {
    const st = r.st, played = st && st.w + st.l + st.d;
    return `<tr>
      <td class="pool-rank">${r.avg === null ? "" : i + 1}</td>
      <th scope="row">${esc(r.map)}${hasStrats(r.map) ? ` <a class="pool-strats" href="${stratsLink(r.map)}" title="Strats für ${esc(r.map)}">Strats</a>` : ""}</th>
      <td><span class="pool-avg">${starsText(r.avg)}</span>${r.avg === null ? "" : `<span class="pool-bar" aria-hidden="true"><i style="width:${Math.round((r.avg / 5) * 100)}%"></i></span>`}<small class="muted">${r.n ? `${r.n} ${r.n === 1 ? "Stimme" : "Stimmen"}` : "noch keine"}</small></td>
      <td>${r.bans.length ? `<span class="st-x">${r.bans.length}×</span> <small class="muted">${r.bans.map(esc).join(", ")}</small>` : '<span class="muted">–</span>'}</td>
      <td>${played ? `${record(st)} <small class="muted">${pct(st.wr)}</small>` : '<span class="muted">kein Match</span>'}</td>
    </tr>`;
  }).join("");
  const table = `<div class="table-wrap"><table class="pool-table">
      <thead><tr><th></th><th scope="col">Map</th><th scope="col">Ø Sterne</th><th scope="col">Bannen</th><th scope="col">Eure Bilanz</th></tr></thead>
      <tbody>${resultRows}</tbody></table></div>`;

  // Wer hat was gewählt (offen, eingeklappt)
  const who = voters.length ? `<details class="pool-who"${showWho ? " open" : ""} data-pool-who><summary>Wer hat was gewählt? (${voters.length})</summary>
      <div class="table-wrap"><table class="pool-matrix"><thead><tr><th></th>${pool.map((m) => `<th scope="col">${esc(m)}</th>`).join("")}</tr></thead><tbody>
      ${voters.sort((a, b) => a[0].localeCompare(b[0], "de")).map(([name, v]) => `<tr><th scope="row">${esc(name)}</th>${pool.map((m) => {
        const s = Number((v.stars || {})[m]) || 0, ban = (v.ban || []).includes(m);
        return `<td>${s ? `${s}${STAR}` : '<span class="muted">·</span>'}${ban ? ' <span class="st-x" title="bannen">⛔</span>' : ""}</td>`;
      }).join("")}</tr>`).join("")}</tbody></table></div></details>` : "";

  const admin = S.isAdmin && voters.length ? `<div class="actions"><button class="btn small danger" type="button" data-action="mp-reset">${resetSure ? "Wirklich alle Stimmen löschen? Nochmal tippen" : "Umfrage zurücksetzen"}</button></div>
      <p class="hint">Zurücksetzen löscht alle Stimmen, z. B. wenn sich der Map-Pool ändert.</p>` : "";

  const poolHint = from === "drive" ? "Pool aus Drive" : "alle Maps";
  return head(`${voters.length} abgestimmt${top ? ` · ${esc(top)}` : ""}`) + `
      <p class="hint">Welche Maps wollen wir im Turnier spielen, welche bannen? ${from === "drive" ? "Der Pool sind die aktiven Maps aus eurem Strats-Ordner in Drive (Ordner mit „(inactiv)“ zählen nicht)." : "Ist im Tab „Team“ der Strats-Ordner verbunden, nimmt die Umfrage dessen aktive Maps als Pool."}</p>
      <h3 class="group">Deine Wertung</h3>${mineHtml}
      <h3 class="group">Ergebnis <span class="muted">${esc(poolHint)}</span></h3>${table}${who}${admin}
    </div></details>`;
}

// ---------- Aktionen ----------
async function saveMine(edit) {
  if (!uid()) return;
  if (!S.loaded.weeks) return toast("Die Umfrage lädt noch.");
  const doc = poolDoc();
  const old = ((doc && doc.ratings) || {})[uid()] || {};
  const next = { stars: { ...(old.stars || {}) }, ban: [...(old.ban || [])] };
  edit(next);
  const name = (S.user && (S.user.name || (S.user.email || "").split("@")[0])) || "";
  try {
    await upsertPath("weeks", POOL_ID, ["ratings", uid()], { email: S.user ? S.user.email : "", name, stars: next.stars, ban: next.ban, at: Date.now() }, { kind: "mappool" });
  } catch (e) { toast(e && e.plain ? e.message : (errorText(e) || "Speichern hat nicht geklappt.")); }
}

export const actions = {
  "mp-rate": (el) => saveMine((v) => {
    const n = Number(el.dataset.stars), map = el.dataset.map;
    if (Number(v.stars[map]) === n) delete v.stars[map]; else v.stars[map] = n;
  }),
  "pool-ban": (el) => saveMine((v) => {
    const map = el.dataset.map;
    v.ban = v.ban.includes(map) ? v.ban.filter((x) => x !== map) : [...v.ban, map];
  }),
  "mp-reset": async () => {
    if (!S.isAdmin || !poolDoc()) return;
    if (!resetSure) { resetSure = true; changed(); setTimeout(() => { resetSure = false; changed(); }, 4000); return; }
    resetSure = false;
    try { await change("weeks", POOL_ID, { ratings: {} }); toast("Alle Stimmen der Map-Pool-Umfrage gelöscht."); }
    catch (e) { toast(e && e.plain ? e.message : (errorText(e) || "Das hat nicht geklappt.")); }
  },
};

// Auf- und Zuklappen von "Wer hat was gewählt" über das Neuzeichnen hinweg merken
document.addEventListener("toggle", (e) => {
  if (e.target && e.target.hasAttribute && e.target.hasAttribute("data-pool-who")) showWho = e.target.open;
  if (e.target && e.target.hasAttribute && e.target.hasAttribute("data-pool-panel")) panelOpen = e.target.open;
}, true);
