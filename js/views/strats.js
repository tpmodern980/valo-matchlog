// Tab "Strats" (Wunsch Tim, 22.11.2026): Taktik-Screenshots aus dem Google-Drive-Ordner des Teams, nach Map und
// Attack/Defense, gruppiert nach den Unterordnern (Pistol, Defaults …). Antippen öffnet das Bild groß, mit Blättern.
// Daten: js/strats.js (liest Drive, nichts in Firestore). Adressen: #strats und #strats-<Map>.
import { S, changed } from "../state.js";
import { esc, norm, pct, toast, fmtDate, isoDate } from "../util.js";
import { upsertPath } from "../data.js";
import { errorText } from "../auth.js";
import { mapStats } from "../stats.js";
import { record } from "./parts.js";
import { poolAverage } from "./mappool.js";
import { stratsOn, stratsState, loadStrats, thumbUrl, driveUrl, isImage, stratTitle, countMap, countSide, isInactive } from "../strats.js";

const MAP_KEY = "valo-strats-map", SIDE_KEY = "valo-strats-side";
const remember = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* nur Bequemlichkeit */ } };
const recall = (k) => { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } };

let side = recall(SIDE_KEY) || "Attack";
let open = null;   // { scope: "root" | "side", id } = Bild groß offen
let editing = null;   // ID der Strat, deren Notiz gerade bearbeitet wird
window.addEventListener("hashchange", () => { setOpen(null); editing = null; });

// ---------- Notizen pro Strat (Wunsch Tim, 22.11.2026) ----------
// Ein Dokument mit fester ID in der Sammlung "weeks" (wie die Map-Pool-Umfrage, keine neue Firestore-Regel):
//   weeks/stratnotes = { kind: "stratnotes", notes: { <Drive-Datei-ID>: { text, clip: <clipId> | null, by, at } | null } }
// Jede Notiz ist ein eigener Feldpfad (upsertPath): Zwei, die gleichzeitig verschiedene Strats kommentieren, stören sich nicht.
// Alle im Team dürfen Notizen schreiben. Gelöscht wird, indem die Notiz auf null gesetzt wird.
const NOTES_ID = "stratnotes";
const noteOf = (fileId) => {
  const d = S.weeks.find((w) => w.id === NOTES_ID);
  const n = d && d.notes && d.notes[fileId];
  return n && (String(n.text || "").trim() || n.clip) ? n : null;
};
// Clips zum Verknüpfen: Clips aus Matches auf dieser Map, neueste zuerst
function clipsForMap(mapName) {
  const matches = new Map(S.matches.map((m) => [m.id, m]));
  return S.clips.filter((c) => { const m = matches.get(c.matchId); return m && norm(m.map) === norm(mapName); })
    .map((c) => ({ c, m: matches.get(c.matchId) }))
    .sort((a, b) => String(b.m.date || "").localeCompare(String(a.m.date || "")) || (b.c.createdAt || 0) - (a.c.createdAt || 0));
}
const clipLabel = ({ c, m }) => `${c.title || "Clip"} · ${fmtDate(m.date).day} vs ${m.opponent || "?"}`;
function clipLink(id) {
  const c = S.clips.find((x) => x.id === id), m = c && S.matches.find((x) => x.id === c.matchId);
  return c && m ? `<a class="lb-clip" href="#match-${esc(m.id)}">🎬 ${esc(clipLabel({ c, m }))}</a>` : "";
}

function noteArea(f, mapName) {
  const n = noteOf(f.id);
  if (editing === f.id) {
    const clips = mapName ? clipsForMap(mapName) : [];
    return `<form class="lb-note editing" data-form="strat-note" data-id="${esc(f.id)}" novalidate>
      <label class="field"><span>Notiz zu „${esc(stratTitle(f))}“</span>
        <textarea id="sn-text" name="text" data-keep rows="3" maxlength="500" placeholder="z. B. nur gegen Eco, Sova-Lineup im Clip, wer callt …">${esc(n ? n.text || "" : "")}</textarea></label>
      ${clips.length ? `<label class="field"><span>Clip verknüpfen (freiwillig)</span><select id="sn-clip" name="clip" data-keep>
        <option value="">kein Clip</option>
        ${clips.map((x) => `<option value="${esc(x.c.id)}"${n && n.clip === x.c.id ? " selected" : ""}>${esc(clipLabel(x))}</option>`).join("")}</select></label>` : ""}
      <div class="actions"><button class="btn primary small" type="submit">Speichern</button>
        <button class="btn small" type="button" data-action="strat-note-cancel">Abbrechen</button>
        ${n ? '<button class="btn small danger" type="button" data-action="strat-note-delete" data-id="' + esc(f.id) + '">Notiz löschen</button>' : ""}</div>
    </form>`;
  }
  if (!n) return `<div class="lb-note"><button class="btn small ghost" type="button" data-action="strat-note-edit" data-id="${esc(f.id)}">+ Notiz</button></div>`;
  return `<div class="lb-note"><div class="lb-note-text">${n.text ? esc(n.text).replace(/\n/g, "<br>") : ""}${n.clip ? clipLink(n.clip) : ""}
      <small class="muted">${esc(n.by || "")}${n.at ? ` · ${esc(fmtDate(isoDate(new Date(n.at))).day)}` : ""}</small></div>
    <button class="btn small ghost" type="button" data-action="strat-note-edit" data-id="${esc(f.id)}">Bearbeiten</button></div>`;
}

async function saveNote(fileId, value) {
  if (!S.loaded.weeks) return toast("Die Notizen laden noch.");
  try {
    await upsertPath("weeks", NOTES_ID, ["notes", fileId], value, { kind: "stratnotes" });
    editing = null; changed();
    toast(value ? "Notiz gespeichert." : "Notiz gelöscht.");
  } catch (e) { toast(e && e.plain ? e.message : (errorText(e) || "Speichern hat nicht geklappt.")); }
}

export const forms = {
  "strat-note": (form) => {
    const data = new FormData(form);
    const text = String(data.get("text") || "").trim().slice(0, 500), clip = String(data.get("clip") || "") || null;
    const who = (S.user && (S.user.name || (S.user.email || "").split("@")[0])) || "";
    saveNote(form.dataset.id, text || clip ? { text, clip, by: who, at: Date.now() } : null);
  },
};

export const stratsLink = (base) => "#strats-" + encodeURIComponent(base);

function setOpen(v) {
  open = v;
  document.body.classList.toggle("lb-open", Boolean(v));
}

// Welche Map ist gewählt? Aus der Adresse, sonst zuletzt gewählt, sonst die erste aktive mit Strats.
function pickMap(maps, id) {
  const find = (name) => name && maps.find((m) => norm(m.base) === norm(name));
  return find(id) || find(recall(MAP_KEY)) || maps.find((m) => !isInactive(m) && countMap(m)) || maps.find((m) => countMap(m)) || maps[0] || null;
}

export function stratsView(id) {
  const head = `<div class="view-head"><div><div class="eyebrow">Team</div><h1>Strats</h1>
    <p>Eure Taktiken aus dem Google-Drive-Ordner. Neue Screenshots einfach in Drive ablegen, hier erscheinen sie von selbst.</p></div></div>`;
  if (!stratsOn()) {
    return head + `<div class="empty"><h2>Noch kein Drive-Ordner verbunden</h2>
      <p>${S.isAdmin ? "Im Tab „Team“ unter „Strats (Google Drive)“ den Ordner-Link und den API-Schlüssel eintragen (Anleitung: ANLEITUNG.md, Schritt 12)." : "Ein Admin verbindet im Tab „Team“ den Google-Drive-Ordner mit euren Strats."}</p>
      ${S.isAdmin ? '<a class="btn primary" href="#team">Zum Tab „Team“</a>' : ""}</div>`;
  }
  setTimeout(() => loadStrats(), 0);   // nicht mitten im Zeichnen: loadStrats meldet sich selbst mit changed()
  const { tree, loading, error } = stratsState();
  const errBox = error ? `<div class="msg error" role="alert">${esc(error)} <button class="btn small" type="button" data-action="strats-reload">Nochmal versuchen</button></div>` : "";
  if (!tree) return head + (errBox || '<p class="loading">Lade Strats aus Google Drive …</p>');

  const map = pickMap(tree.maps, id);
  const stand = new Date(tree.at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  const tools = `<div class="st-tools"><span class="hint st-stand">${loading ? "Aktualisiere …" : `Stand ${esc(stand)} Uhr`}</span>
      <button class="btn small ghost" type="button" data-action="strats-reload"${loading ? " disabled" : ""}>Aktualisieren</button></div>`;

  // Oben: Dateien direkt im Ordner (Premier-Plan, Teambook …)
  const rootFiles = tree.root.files;
  const general = `<div class="st-top"><div class="st-general">${rootFiles.map((f) => isImage(f)
    ? `<button class="btn small" type="button" data-action="strat-open" data-scope="root" data-id="${esc(f.id)}">🖼️ ${esc(stratTitle(f))}</button>`
    : `<a class="btn small" href="${esc(driveUrl(f))}" target="_blank" rel="noopener">📄 ${esc(f.name)} ↗</a>`).join("")}</div>${tools}</div>`;

  // Map-Auswahl: aktive Maps als Knöpfe, inaktive/gebannte eingeklappt
  const chip = (m) => `<a class="chip-btn" href="${stratsLink(m.base)}" aria-pressed="${map && m.id === map.id}">${esc(m.base)} <small>${m.note ? `${esc(m.note)} · ` : ""}${countMap(m)}</small></a>`;
  const active = tree.maps.filter((m) => !isInactive(m)), other = tree.maps.filter(isInactive);
  const otherOpen = map && isInactive(map);
  const picker = `<div class="st-maps chips">${active.map(chip).join("")}</div>
    ${other.length ? `<details class="st-more"${otherOpen ? " open" : ""}><summary>Weitere Maps (${other.length})</summary>
      <div class="chips">${other.map((m) => `<a class="chip-btn" href="${stratsLink(m.base)}" aria-pressed="${map && m.id === map.id}">${esc(m.base)} <small>${esc(m.note)} · ${countMap(m)}</small></a>`).join("")}</div></details>` : ""}`;

  if (!map) return head + errBox + general + '<div class="empty"><h2>Keine Map-Ordner</h2><p>Im Drive-Ordner gibt es noch keine Unterordner. Legt pro Map einen an (darin „Attack“ und „Defense“).</p></div>';

  const sides = map.sides;
  const cur = sides.find((s) => s.name === side) || sides[0];
  const sideBar = sides.length > 1 ? `<div class="seg st-sides" role="group" aria-label="Seite" style="grid-template-columns: repeat(${sides.length}, minmax(0, 1fr))">${sides.map((s) => `<button type="button" class="seg-btn" data-action="strats-side" data-side="${esc(s.name)}" aria-pressed="${cur && s.name === cur.name}">${esc(s.name)} <small>${countSide(s)}</small></button>`).join("")}</div>` : "";
  const groups = cur ? cur.groups.filter((g) => g.files.length) : [];
  const body = groups.length ? groups.map((g) => `<section class="st-group">${g.name ? `<h3 class="group">${esc(g.name)}</h3>` : ""}
      <div class="st-grid">${g.files.map((f) => `<button class="st-tile" type="button" data-action="strat-open" data-scope="side" data-id="${esc(f.id)}">
        <img src="${esc(thumbUrl(f, 480))}" alt="" loading="lazy" decoding="async"${f.w && f.h ? ` width="${f.w}" height="${f.h}"` : ""}>
        <span>${esc(stratTitle(f))}${noteOf(f.id) ? `<small class="st-note">📝 ${esc(noteOf(f.id).text || "Clip verknüpft")}</small>` : ""}</span></button>`).join("")}</div></section>`).join("")
    : `<p class="hint">Für ${esc(map.base)}${cur ? ` (${esc(cur.name)})` : ""} liegen noch keine Strats im Ordner.</p>`;

  // Bilanz aus den Matches und Ergebnis der Map-Pool-Umfrage für diese Map (Link in den Tab "Maps")
  const st = S.loaded.matches ? mapStats(S.matches).find((s) => s.key === norm(map.base)) : null;
  const played = st ? st.w + st.l + st.d : 0;
  const vote = poolAverage(map.base);
  const facts = [played ? `Bilanz <b>${record(st)}</b> (${pct(st.wr)})` : "noch kein Match", vote ? `Umfrage <b>${vote.avg.toFixed(1).replace(".", ",")} ★</b>${vote.bans ? ` · ${vote.bans}× bannen` : ""}` : ""].filter(Boolean);
  const panel = `<section class="panel"><div class="panel-head"><h2>${esc(map.base)}${map.note ? ` <small class="muted">(${esc(map.note)})</small>` : ""}</h2>
      <a class="hint" href="${esc(driveUrl({ id: map.id, mimeType: "application/vnd.google-apps.folder" }))}" target="_blank" rel="noopener">Ordner in Drive ↗</a></div>
    <div class="panel-body"><p class="st-facts"><a href="#maps">${facts.join(" · ")}</a></p>${sideBar}${body}</div></section>`;

  return head + errBox + general + picker + panel + lightbox(tree, map, cur);
}

// Großansicht mit Blättern (Pfeile, Wischen, Tastatur)
function lightbox(tree, map, cur) {
  if (!open) return "";
  const list = listFor(tree, cur);
  const i = list.findIndex((f) => f.id === open.id);
  if (i < 0) return "";
  const f = list[i];
  const nav = list.length > 1;
  return `<div class="lb" role="dialog" aria-modal="true" aria-label="${esc(stratTitle(f))}">
    <div class="lb-bar"><div class="lb-title"><b>${esc(stratTitle(f))}</b><small>${open.scope === "root" ? "Allgemein" : `${esc(map.base)} · ${esc(cur.name)}`}${nav ? ` · ${i + 1} / ${list.length}` : ""}</small></div>
      <a class="btn small ghost" href="${esc(driveUrl(f))}" target="_blank" rel="noopener">In Drive ↗</a>
      <button class="btn small" type="button" data-action="strat-close" aria-label="Schließen">✕</button></div>
    <div class="lb-img" data-action="strat-close"><img data-action="strat-stay" src="${esc(thumbUrl(f, 2000))}" alt="${esc(stratTitle(f))}"></div>
    ${noteArea(f, open.scope === "root" ? "" : map.base)}
    ${nav ? `<button class="lb-nav prev" type="button" data-action="strat-step" data-step="-1" aria-label="Vorherige Strat">‹</button>
      <button class="lb-nav next" type="button" data-action="strat-step" data-step="1" aria-label="Nächste Strat">›</button>` : ""}
  </div>`;
}

function listFor(tree, cur) {
  if (open && open.scope === "root") return tree.root.files.filter(isImage);
  return cur ? cur.groups.flatMap((g) => g.files) : [];
}

function step(n) {
  const { tree } = stratsState();
  if (!open || !tree) return;
  const r = /^strats-(.+)$/.exec(decodeURIComponent(location.hash.slice(1)));
  const map = pickMap(tree.maps, r ? r[1] : "");
  const cur = map && (map.sides.find((s) => s.name === side) || map.sides[0]);
  const list = listFor(tree, cur);
  const i = list.findIndex((f) => f.id === open.id);
  if (i < 0 || list.length < 2) return;
  setOpen({ ...open, id: list[(i + n + list.length) % list.length].id });
  editing = null;
  changed();
}

export const actions = {
  "strats-reload": () => loadStrats(true),
  "strats-side": (el) => { side = el.dataset.side; remember(SIDE_KEY, side); changed(); },
  "strat-open": (el) => { setOpen({ scope: el.dataset.scope, id: el.dataset.id }); changed(); },
  // Klick auf den dunklen Rand um das Bild schließt, Klick aufs Bild selbst nicht
  "strat-close": () => { setOpen(null); editing = null; changed(); },
  "strat-stay": () => {},
  "strat-step": (el) => step(Number(el.dataset.step) || 1),
  "strat-note-edit": (el) => { editing = el.dataset.id; changed(); setTimeout(() => { const t = document.getElementById("sn-text"); if (t) t.focus(); }, 0); },
  "strat-note-cancel": () => { editing = null; changed(); },
  "strat-note-delete": (el) => saveNote(el.dataset.id, null),
};

// Gewählte Map merken (über die Adresse #strats-<Map>)
window.addEventListener("hashchange", () => {
  const r = /^strats-(.+)$/.exec(location.hash.slice(1));
  if (r) { try { remember(MAP_KEY, decodeURIComponent(r[1])); } catch (e) { /* kaputte Adresse */ } }
});

// Tastatur und Wischen in der Großansicht
document.addEventListener("keydown", (e) => {
  if (!open) return;
  // Beim Schreiben einer Notiz: Pfeiltasten gehören dem Textfeld, Escape bricht nur das Bearbeiten ab
  if (e.target && e.target.closest && e.target.closest("input, textarea, select")) {
    if (e.key === "Escape" && editing) { editing = null; changed(); }
    return;
  }
  if (e.key === "Escape") { setOpen(null); editing = null; changed(); }
  else if (e.key === "ArrowRight") step(1);
  else if (e.key === "ArrowLeft") step(-1);
});
let touchX = null;
document.addEventListener("touchstart", (e) => { touchX = open && e.target.closest && e.target.closest(".lb") && !e.target.closest(".lb-note") ? e.touches[0].clientX : null; }, { passive: true });
document.addEventListener("touchend", (e) => {
  if (touchX === null || !open) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
}, { passive: true });
