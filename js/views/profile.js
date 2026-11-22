// Spieler-Profile (Wunsch Tim, 22.11.2026): Jeder pflegt bei sich Profilbild, Riot-ID (mit Link zu tracker.gg),
// Main-Agents und Rolle. Bearbeiten darf, wem der Spieler gehört (Konto-Zuordnung im Tab "Team"), und jeder Admin.
// Gespeichert direkt am Spieler (players/<id>): riotId: "Name#Tag", mains: ["Jett", …] (höchstens 3),
// discordId: Discord-Benutzer-ID (17–20 Ziffern) zum Anpingen bei der Umfrage-Erinnerung (seit 22.11.2026),
// avatar: kleines JPEG als data:-Adresse (160 × 160, etwa 10 KB; Firebase Storage gibt es im Gratisplan nicht).
import { S, changed } from "../state.js";
import { AGENTS, ROLES } from "../constants.js";
import { esc, toast } from "../util.js";
import { change } from "../data.js";
import { errorText } from "../auth.js";

const SIDE = 160;
let editing = null;      // Spieler-ID, deren Profil gerade bearbeitet wird
let pic = undefined;     // neues Bild (data:-Adresse), null = entfernen, undefined = unverändert
let busy = false;
window.addEventListener("hashchange", () => { editing = null; pic = undefined; });

const links = () => (S.team && S.team.links) || {};
export const myPlayerId = () => { const l = S.user ? links()[S.user.email] : ""; return l && l !== "manager" ? l : ""; };
export const canEdit = (p) => Boolean(p && (S.isAdmin || myPlayerId() === p.id));

// Riot-ID "Name#Tag": Name 3–16 Zeichen, Tag 3–5 Buchstaben/Ziffern
export const validRiotId = (t) => /^[^#]{3,16}#[\p{L}\p{N}]{3,5}$/u.test(String(t || "").trim());
export const trackerUrl = (riotId) => `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(String(riotId).trim())}/overview`;

// Kleines rundes Bild (oder Anfangsbuchstabe)
export function avatar(p, size = 40) {
  const name = (p && p.name) || "?";
  return p && p.avatar
    ? `<img class="avatar" src="${esc(p.avatar)}" alt="" width="${size}" height="${size}" style="width:${size}px;height:${size}px">`
    : `<span class="avatar none" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px" aria-hidden="true">${esc(name.slice(0, 1).toUpperCase())}</span>`;
}

// Profil-Bereich auf der Spieler-Seite: Bild, Riot-ID mit Tracker-Link, Mains; bei Berechtigung "Profil bearbeiten"
export function profileHead(p) {
  if (!p) return "";
  const mains = (p.mains || []).filter(Boolean);
  const bits = [
    p.riotId ? `<a class="btn small" href="${esc(trackerUrl(p.riotId))}" target="_blank" rel="noopener">tracker.gg ↗</a> <span class="mail">${esc(p.riotId)}</span>` : "",
    mains.length ? `<span class="pf-mains">Mains: ${mains.map((a) => `<span class="tag">${esc(a)}</span>`).join("")}</span>` : "",
  ].filter(Boolean).join("");
  const edit = canEdit(p) ? `<button class="btn small ghost" type="button" data-action="pf-edit" data-id="${esc(p.id)}">${editing === p.id ? "Schließen" : "Profil bearbeiten"}</button>` : "";
  return `<div class="pf-head">${avatar(p, 72)}<div class="pf-info">${bits || (canEdit(p) ? '<span class="hint">Noch kein Profil: Bild, Riot-ID und Mains eintragen.</span>' : "")}${edit}</div></div>`
    + (editing === p.id ? editor(p) : "");
}

const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur ?? "") ? " selected" : ""}>${esc(label)}</option>`;

function editor(p) {
  const mains = [...(p.mains || []), "", "", ""].slice(0, 3);
  const shown = pic === undefined ? p.avatar : pic;
  return `<section class="panel"><div class="panel-head"><h2>Profil bearbeiten</h2></div>
    <form class="panel-body pf-form" data-form="pf-save" data-id="${esc(p.id)}" novalidate>
      <div class="pf-pic">${shown ? `<img class="avatar" src="${esc(shown)}" alt="Profilbild" width="96" height="96" style="width:96px;height:96px">` : avatar(p, 96)}
        <label class="btn small">Bild wählen<input type="file" accept="image/*" data-change="pf-pic" hidden></label>
        ${shown ? '<button class="btn small ghost" type="button" data-action="pf-pic-del">Bild entfernen</button>' : ""}</div>
      <label class="field"><span>Riot-ID (Name#Tag)</span><input type="text" name="riotId" maxlength="24" value="${esc(p.riotId || "")}" placeholder="z. B. Kairo#EUW" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
      <label class="field"><span>Discord-ID (zum Anpingen)</span><input type="text" name="discordId" inputmode="numeric" maxlength="20" value="${esc(p.discordId || "")}" placeholder="z. B. 123456789012345678" autocomplete="off"></label>
      <p class="hint">So findest du sie: Discord → Einstellungen → Erweitert → <b>Entwicklermodus</b> an. Dann auf deinen Namen tippen (am Handy lange drücken) → <b>Benutzer-ID kopieren</b>.</p>
      ${p.status === "staff" ? "" : `<div class="pf-row">${mains.map((m, i) => `<label class="field"><span>Main ${i + 1}</span><select name="main${i}">${opt("", "–", m)}${AGENTS.map((a) => opt(a, a, m)).join("")}</select></label>`).join("")}</div>
      <div class="pf-row"><label class="field"><span>Rolle</span><select name="role">${ROLES.map((r) => opt(r, r, p.role)).join("")}</select></label>
        <label class="field"><span>Zweite Rolle</span><select name="role2">${opt("", "keine", p.role2 || "")}${ROLES.map((r) => opt(r, r, p.role2)).join("")}</select></label></div>`}
      <div class="actions"><button class="btn primary" type="submit"${busy ? " disabled" : ""}>Speichern</button>
        <button class="btn" type="button" data-action="pf-cancel">Abbrechen</button></div>
    </form></section>`;
}

// Bild verkleinern: quadratisch zuschneiden (Mitte), 160 × 160, JPEG
async function shrinkPic(file) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const c = document.createElement("canvas");
  c.width = c.height = SIDE;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, SIDE, SIDE);
  if (bmp.close) bmp.close();
  return c.toDataURL("image/jpeg", 0.82);
}

export const actions = {
  "pf-edit": (el) => { editing = editing === el.dataset.id ? null : el.dataset.id; pic = undefined; changed(); },
  "pf-cancel": () => { editing = null; pic = undefined; changed(); },
  "pf-pic-del": () => { pic = null; changed(); },
};

export const changes = {
  "pf-pic": async (el) => {
    const file = el.files && el.files[0];
    if (!file) return;
    try { pic = await shrinkPic(file); changed(); }
    catch (e) { toast("Dieses Bild ließ sich nicht öffnen. Nimm ein JPG oder PNG."); }
  },
};

export const forms = {
  "pf-save": async (form) => {
    const p = S.players.find((x) => x.id === form.dataset.id);
    if (!p || !canEdit(p) || busy) return;
    const data = new FormData(form);
    const riotId = String(data.get("riotId") || "").trim();
    if (riotId && !validRiotId(riotId)) return toast("Riot-ID bitte als Name#Tag, z. B. Kairo#EUW.");
    const mains = [0, 1, 2].map((i) => String(data.get("main" + i) || "")).filter((a) => AGENTS.includes(a));
    const role = ROLES.includes(String(data.get("role"))) ? String(data.get("role")) : p.role;
    let role2 = ROLES.includes(String(data.get("role2"))) ? String(data.get("role2")) : null;
    if (role2 === role) role2 = null;
    const discordId = String(data.get("discordId") || "").replace(/\D/g, "");
    if (discordId && !/^\d{17,20}$/.test(discordId)) return toast("Die Discord-ID hat 17 bis 20 Ziffern (Benutzer-ID kopieren, nicht den Namen).");
    const fields = p.status === "staff" ? { riotId, discordId } : { riotId, discordId, mains: [...new Set(mains)], role, role2 };
    if (pic !== undefined) fields.avatar = pic;
    busy = true;
    try { await change("players", p.id, fields); editing = null; pic = undefined; toast("Profil gespeichert."); }
    catch (e) { toast(errorText(e) || "Speichern hat nicht geklappt."); }
    finally { busy = false; changed(); }
  },
};
