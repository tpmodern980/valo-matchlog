// Tab "Team": Team-Liste (E-Mails, Admins), Kurzanleitung zum Teilen, Export und Import (Backup), Papierkorb.
// Dazu die Seite "Team anlegen" beim allerersten Start des Besitzers.
// Papierkorb und Import sind nur für Admins (die Firestore-Regeln setzen das auch auf dem Server durch).
// Papierkorb, Export und Import haben eigene Meldungsfelder: msgBox (#auth-msg) gehört hier der Team-Liste.
import { S, changed } from "../state.js";
import { RES_LABEL, MAPS } from "../constants.js";
import { $, esc, norm, toast, fmtDate } from "../util.js";
import { createTeam, addMember, removeMember, setAdmin, setDiscordHooks, setLink, setStratsDrive, setSeasons, cleanEmails, validEmail } from "../team.js";
import { stratsOn, folderId, validKey, testDrive, loadStrats } from "../strats.js";
import { validWebhook, validMapTarget, anyHook } from "../discord.js";
import { deletedOf, everything, known, restore, remove, purgeTrash } from "../data.js";
import { buildCsv, buildJson, download, fileName, readImport, applyImport } from "../backup.js";
import { result } from "../stats.js";
import { errorText } from "../auth.js";
import { run, setMsg, msgBox } from "./auth.js";
import { approve, decline, setAccessHook, validAccessHook } from "../access.js";

// ---------- Erster Start: Team anlegen ----------

export function teamSetupView() {
  return `<section class="auth">
    <div class="auth-head"><div class="eyebrow">Einrichtung</div><h1>Team anlegen</h1>
      <p>Du bist als Besitzer angemeldet (<b class="mail">${esc(S.user.email)}</b>). Es gibt noch keine Team-Liste. Leg sie jetzt an: Du selbst stehst automatisch drauf und bist Admin.</p></div>
    <form class="auth-form" data-form="team-setup" novalidate>
      <label class="field"><span>Weitere E-Mail-Adressen (freiwillig, eine pro Zeile)</span>
        <textarea id="team-more" name="emails" data-keep rows="4" autocapitalize="none" spellcheck="false" placeholder="name@beispiel.de"></textarea></label>
      <p class="hint">Weitere Adressen und Admins kannst du später jederzeit unter „Team“ eintragen.</p>
      ${msgBox()}
      <button class="btn primary block" type="submit">Team anlegen</button>
    </form>
  </section>`;
}

// ---------- Zustand dieses Tabs ----------

let trashMsg = null;     // Meldung im Papierkorb: { kind, text }
let ioMsg = null;        // Meldung bei Export und Import
let plan = null;         // geprüfte Import-Datei, wartet auf Bestätigung (siehe backup.js)
let importing = false;
let purgeAsk = false;    // Rückfrage "Papierkorb endgültig leeren?" ist offen
const SHOW = 8;          // so viele Einträge pro Gruppe im Papierkorb, der Rest nach "Alle zeigen"
const showAll = { matches: false, players: false, clips: false };

const box = (m, id) => `<p class="msg ${m ? esc(m.kind) : ""}" id="${id}" role="alert"${m ? "" : " hidden"}>${m ? esc(m.text) : ""}</p>`;
const allLoaded = () => S.loaded.players && S.loaded.matches && S.loaded.clips;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
// Datum aus updatedAt (Millisekunden): beim Papierkorb ist das die Zeit des Löschens
const when = (ms) => {
  if (!ms) return "";
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
};

// ---------- Tab "Team" ----------

// Offene Zugangs-Anfragen (js/access.js): nur Admins
function requestsHtml() {
  const list = S.isAdmin ? (S.requests || []) : [];
  if (!list.length) return "";
  return `<div class="req-box"><h3 class="group">Zugangs-Anfragen <span class="tag">${list.length}</span></h3>
    ${list.map((r) => `<div class="member req"><span><b>${esc(r.name || r.email.split("@")[0])}</b> <span class="mail">${esc(r.email)}</span></span>
      <span class="req-btns"><button class="btn small primary" type="button" data-action="req-ok" data-uid="${esc(r.uid)}">Freischalten</button>
      <button class="btn small ghost" type="button" data-action="req-no" data-uid="${esc(r.uid)}">Ablehnen</button></span></div>`).join("")}</div>`;
}

function membersPanel() {
  const t = S.team || { emails: [], admins: [] };
  const me = S.user ? S.user.email : "";
  const all = cleanEmails([...t.emails, ...t.admins]).sort((a, b) => (b === me) - (a === me) || a.localeCompare(b));
  const links = t.links || {};
  const players = S.players.slice().sort((a, b) => a.name.localeCompare(b.name, "de"));
  // Wer ist dieses Konto? Spieler aus dem Roster oder die Managerin (für den Tab "Planung")
  const linkOf = (email) => {
    const v = links[email] || "";
    if (S.isAdmin) {
      const taken = new Set(Object.entries(links).filter(([e]) => e !== email).map(([, id]) => id));
      return `<label class="field link-pick"><span>Ist im Team</span><select data-change="team-link" data-email="${esc(email)}" aria-label="Wer ist ${esc(email)}?">
          <option value=""${v ? "" : " selected"}>– nicht zugeordnet –</option>
          <option value="manager"${v === "manager" ? " selected" : ""}>Managerin</option>
          ${players.map((p) => `<option value="${esc(p.id)}"${v === p.id ? " selected" : ""}${taken.has(p.id) ? " disabled" : ""}>${esc(p.name)}${taken.has(p.id) ? " (schon vergeben)" : ""}</option>`).join("")}
        </select></label>`;
    }
    const name = v === "manager" ? "Managerin" : (players.find((p) => p.id === v) || {}).name;
    return name ? `<small class="link-name">${esc(name)}</small>` : "";
  };
  const rows = all.map((email) => {
    const admin = t.admins.includes(email);
    const tools = S.isAdmin && email !== me
      ? `<div class="actions">
          <button class="btn small" type="button" data-action="team-admin" data-email="${esc(email)}" data-on="${admin ? "" : "1"}">${admin ? "Admin entziehen" : "Zum Admin machen"}</button>
          <button class="btn small danger" type="button" data-action="team-remove" data-email="${esc(email)}">Entfernen</button>
        </div>`
      : "";
    return `<div class="roster-row"><div class="member"><b class="mail">${esc(email)}</b>${admin ? ' <span class="tag">Admin</span>' : ""}${email === me ? ' <span class="tag">du</span>' : ""}</div>${tools}${linkOf(email)}</div>`;
  }).join("");

  const addForm = S.isAdmin
    ? `<form class="team-add" data-form="team-add" novalidate>
        <label class="field grow"><span>E-Mail hinzufügen</span>
          <input type="email" id="team-email" name="email" data-keep autocomplete="off" inputmode="email" autocapitalize="none" spellcheck="false" placeholder="name@beispiel.de"></label>
        <label class="check"><input type="checkbox" name="admin"> auch Admin</label>
        <button class="btn primary" type="submit">Hinzufügen</button>
      </form>
      ${msgBox()}
      <p class="hint">Die Adresse muss genau die sein, mit der sich die Person anmeldet. Am sichersten: Sie meldet sich einmal an und schickt dir die Adresse, die ihr die App dann anzeigt. Admins dürfen die Liste ändern, Gelöschtes wiederherstellen und ein Backup einspielen.</p>`
    : '<p class="hint team-note">Nur Admins können die Liste ändern.</p>';

  return `<section class="panel"><div class="panel-head"><h2>Freigeschaltete E-Mails</h2><span class="hint">${plural(all.length, "Adresse", "Adressen")}</span></div>
    <div class="panel-body">${requestsHtml()}<div class="roster">${rows}</div>${addForm}</div></section>`;
}


function backupPanel() {
  const ready = allLoaded();
  // Clips zählen nur, wenn ihr Match sichtbar ist (die eines gelöschten Matches sind mit ihm weg)
  const seen = new Set(S.matches.map((m) => m.id));
  const n = { m: S.matches.length, p: S.players.length, c: S.clips.filter((c) => seen.has(c.matchId)).length };
  const gone = deletedOf("matches").length + deletedOf("players").length + deletedOf("clips").length;
  const off = ready ? "" : " disabled";
  let imp = "";
  if (S.isAdmin) {
    imp = plan ? previewHtml(plan) : `<div class="io-row">
        <label class="btn filebtn${ready && !importing ? "" : " off"}">Backup einspielen …<input type="file" id="imp-file" accept=".json,application/json" data-change="imp-file" aria-label="Backup-Datei (JSON) wählen"${ready && !importing ? "" : " disabled"}></label>
        <p class="hint">Nur der JSON-Export dieser App. Einträge mit derselben ID werden überschrieben, fehlende angelegt, alles andere bleibt. Vor dem Schreiben kommt eine Vorschau.</p>
      </div>`;
    imp = `<h3 class="sub-head">Import (nur Admins)</h3>${imp}`;
  }
  return `<section class="panel"><div class="panel-head"><h2>Backups + Export</h2>
      <span class="hint">${ready ? `${plural(n.m, "Match", "Matches")} · ${n.p} Spieler · ${plural(n.c, "Clip", "Clips")}${gone ? ` · ${gone} im Papierkorb` : ""}` : "Daten laden noch …"}</span></div>
    <div class="panel-body io">
      <p class="hint">Im Gratisplan gibt es keine automatischen Backups. Lad ab und zu ein JSON-Backup herunter und heb es gut auf.</p>
      <div class="io-row">
        <button class="btn primary" type="button" data-action="export-json"${off}>Backup (JSON) herunterladen</button>
        <p class="hint">Alles: Spieler, Matches mit Gegner-Scoreboard und Trades, Clips mit Notizen, auch der Papierkorb. Nur damit lässt sich später alles wieder einspielen.</p>
      </div>
      <div class="io-row">
        <button class="btn" type="button" data-action="export-csv"${off}>Matches als CSV (Excel)</button>
        <p class="hint">Eine Zeile pro Spieler und Match, für Excel und Google Sheets. Die Spalte „Team“ sagt, ob die Zeile zu uns oder zu den Gegnern gehört. Gelöschte Matches fehlen hier.</p>
      </div>
      ${imp}
      ${box(ioMsg, "io-msg")}
    </div></section>`;
}

function previewHtml(p) {
  const c = p.colls;
  const line = (coll, one, many) => {
    const x = c[coll], todo = x.create + x.overwrite;
    const what = [x.create ? `${x.create} neu` : "", x.overwrite ? `${x.overwrite} überschrieben` : ""].filter(Boolean).join(", ");
    const file = [`in der Datei: ${x.count}`, x.deleted ? `davon ${x.deleted} im Papierkorb` : "", x.same ? `${x.same} schon genau so da` : ""].filter(Boolean).join(", ");
    return `<li><b>${plural(todo, one, many)}</b> ${todo === 1 ? "wird" : "werden"} eingespielt${what ? `: ${what}` : ""} <span class="hint">(${file})</span></li>`;
  };
  const date = p.exportedAt ? new Date(p.exportedAt) : null;
  const from = date && !isNaN(date) ? ` vom ${when(date.getTime())}, ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")} Uhr` : "";
  const warn = p.newer
    ? `<p class="msg error">${plural(p.newer, "Eintrag wurde", "Einträge wurden")} nach diesem Export noch geändert. Diese Änderungen gehen beim Einspielen verloren.</p>` : "";
  const nothing = !p.total;
  return `<div class="import-preview">
      <p><b>Vorschau:</b> ${esc(p.name || "Backup")}${esc(from)}</p>
      <ul>${line("matches", "Match", "Matches")}${line("players", "Spieler", "Spieler")}${line("clips", "Clip", "Clips")}</ul>
      ${warn}
      <p class="hint">${nothing ? "Alles in der Datei ist schon genau so in der App. Es gibt nichts zu tun." : `Das sind ${plural(p.total, "Schreibvorgang", "Schreibvorgänge")}. Einträge, die nicht in der Datei stehen, bleiben unverändert. Die Team-Liste wird nicht geändert.`}</p>
      <div class="actions">
        ${nothing ? "" : `<button class="btn primary" type="button" data-action="imp-go"${importing ? " disabled" : ""}>Jetzt einspielen</button>`}
        <button class="btn" type="button" data-action="imp-cancel"${importing ? " disabled" : ""}>${nothing ? "Schließen" : "Abbrechen"}</button>
      </div>
    </div>`;
}

// ---------- Papierkorb ----------

const restoreBtn = (coll, id, label) =>
  `<button class="btn small" type="button" data-action="trash-restore" data-coll="${coll}" data-id="${esc(id)}" aria-label="${esc(label)} wiederherstellen">Wiederherstellen</button>`;

// Clips, die mit einem Match zurückkommen: nicht einzeln gelöscht, gehören aber zu diesem Match
const clipsWith = (matchId) => everything("clips").filter((c) => c.matchId === matchId && !c.deleted).length;

function matchLabel(m) {
  if (!m) return "unbekanntes Match";
  const d = fmtDate(m.date);
  return `${d.full === "–" ? "ohne Datum" : d.day} ${m.map || "Map?"} vs ${m.opponent || "unbekannt"}`;
}

function trashGroup(coll, title, list, row) {
  if (!list.length) return "";
  const shown = showAll[coll] ? list : list.slice(0, SHOW);
  const more = list.length - shown.length;
  return `<div class="group">${esc(title)} <span>${list.length}</span></div>
    <div class="roster trash">${shown.map(row).join("")}</div>
    ${more > 0 ? `<button class="linkish" type="button" data-action="trash-more" data-coll="${coll}">Alle ${list.length} zeigen</button>` : ""}`;
}

function trashPanel() {
  const matches = deletedOf("matches"), players = deletedOf("players"), clips = deletedOf("clips");
  const n = matches.length + players.length + clips.length;

  const matchRow = (m) => {
    const r = result(m), clipN = clipsWith(m.id);
    return `<div class="roster-row"><div class="member trash-what">
        <b>${esc(matchLabel(m))}</b>
        <small><span class="tag">${esc(m.type || "Match")}</span>${esc(m.scoreUs ?? "?")}:${esc(m.scoreThem ?? "?")} ${esc(RES_LABEL[r])}${clipN ? ` · kommt mit ${plural(clipN, "Clip", "Clips")} zurück` : ""}${m.updatedAt ? ` · gelöscht ${when(m.updatedAt)}` : ""}</small></div>
      ${restoreBtn("matches", m.id, matchLabel(m))}</div>`;
  };
  const playerRow = (p) => `<div class="roster-row"><div class="member trash-what">
        <b>${esc(p.name)}</b>
        <small><span class="tag">${p.status === "sub" ? "Sub" : "Stamm"}</span>${esc((p.aliases || []).join(", "))}${p.updatedAt ? ` · entfernt ${when(p.updatedAt)}` : ""}</small></div>
      ${restoreBtn("players", p.id, p.name)}</div>`;
  const clipRow = (c) => {
    const m = known("matches", c.matchId);
    const away = !m || m.deleted;
    return `<div class="roster-row"><div class="member trash-what">
        <b>${esc(c.title || "Clip")}</b>
        <small>${m && !m.deleted ? `<a href="#match-${esc(m.id)}">${esc(matchLabel(m))}</a>` : esc(matchLabel(m))}${(c.notes || []).length ? ` · ${plural(c.notes.length, "Notiz", "Notizen")}` : ""}${c.updatedAt ? ` · entfernt ${when(c.updatedAt)}` : ""}</small>
        ${away ? `<small class="warn-text">${m ? "Das Match liegt auch im Papierkorb. Der Clip ist erst wieder zu sehen, wenn das Match zurück ist." : "Das Match gibt es nicht mehr."}</small>` : ""}</div>
      ${restoreBtn("clips", c.id, c.title || "Clip")}</div>`;
  };

  const body = !allLoaded()
    ? '<p class="hint">Daten laden noch …</p>'
    : n
      ? trashGroup("matches", "Matches", matches, matchRow) + trashGroup("players", "Spieler", players, playerRow) + trashGroup("clips", "Einzeln entfernte Clips", clips, clipRow)
      : '<p class="hint">Der Papierkorb ist leer.</p>';
  // Papierkorb leeren (nur Admins, mit Rückfrage): js/data.js purgeTrash
  const purge = !allLoaded() || !n ? ""
    : purgeAsk
      ? `<div class="confirm purge"><span><b>${plural(n, "Eintrag", "Einträge")} endgültig entfernen?</b> Danach lässt sich nichts davon wiederherstellen, und es kommt auch nicht mehr ins Backup.${matches.length ? " Clips der Matches gehen mit." : ""} Lad vorher am besten ein Backup herunter (Bereich „Backups + Export“).</span>
          <button class="btn small danger solid" type="button" data-action="trash-purge">Endgültig leeren</button>
          <button class="btn small" type="button" data-action="trash-purge-cancel">Abbrechen</button></div>`
      : '<div class="actions purge"><button class="btn small danger" type="button" data-action="trash-purge-ask">Papierkorb leeren</button></div>';
  return `<section class="panel"><div class="panel-head"><h2>Papierkorb</h2><span class="hint">${allLoaded() ? plural(n, "Eintrag", "Einträge") : ""}</span></div>
    <div class="panel-body">
      ${box(trashMsg, "trash-msg")}
      ${body}
      ${purge}
      <p class="hint trash-note">Gelöschtes landet erst hier und lässt sich zurückholen. Endgültig weg ist es erst nach „Papierkorb leeren“. Clips eines gelöschten Matches stehen hier nicht einzeln: Sie kommen mit dem Match zurück. Gelöschte Clip-Notizen lassen sich nicht wiederherstellen.</p>
    </div></section>`;
}

// Discord: Webhooks für "In Discord posten" auf der Match-Seite (js/discord.js). Eintragen dürfen nur Admins.
// Ein Webhook gehört zu einem Kanal. Das Team hat einen Kanal pro Map: oben der Standard-Kanal, darunter eins pro Map.
// Welche Maps es gibt: die bekannten (MAPS), die aus den Matches und die, für die schon etwas eingetragen ist.
function discordMaps() {
  const list = [...MAPS];
  const add = (name) => { const n = String(name || "").trim(); if (n && !list.some((x) => norm(x) === norm(n))) list.push(n); };
  for (const m of S.matches) add(m.map);
  for (const k of Object.keys((S.team && S.team.discordMaps) || {})) add(k);
  return list.sort((a, b) => a.localeCompare(b, "de"));
}
const mapHook = (name) => {
  const maps = (S.team && S.team.discordMaps) || {};
  const key = Object.keys(maps).find((k) => norm(k) === norm(name));
  return key ? maps[key] : "";
};

function discordPanel() {
  const def = (S.team && S.team.discordWebhook) || "";
  const maps = discordMaps();
  const mapCount = maps.filter((n) => validMapTarget(mapHook(n))).length;
  const planHook = (S.team && S.team.discordPlan) || "", schedHook = (S.team && S.team.discordSchedule) || "";
  const parts = [validWebhook(def) ? "Standard" : "", mapCount ? `${mapCount} ${mapCount === 1 ? "Map" : "Maps"}` : "", validWebhook(planHook) ? "Planung" : "", validWebhook(schedHook) ? "Wochenplan" : ""].filter(Boolean);
  const state = `<span class="hint">${parts.length ? parts.join(" + ") : "nicht eingerichtet"}</span>`;
  if (!S.isAdmin) {
    return `<section class="panel"><div class="panel-head"><h2>Discord</h2>${state}</div>
      <div class="panel-body"><p class="hint">${anyHook() ? "Auf der Match-Seite gibt es den Knopf „In Discord posten“: Er schickt Ergebnis und Scoreboard in den Discord-Kanal der Map (oder in den Standard-Kanal)." : "Ein Admin kann hier Discord verbinden. Dann lässt sich jedes Match mit einem Knopf in Discord posten."}</p></div></section>`;
  }
  const field = (id, name, label, value, hint) => `<label class="field"><span>${label}</span>
      <input type="text" id="${id}" name="${esc(name)}" data-keep maxlength="300" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="url" placeholder="${hint}" value="${esc(value)}"></label>`;
  return `<section class="panel"><div class="panel-head"><h2>Discord</h2>${state}</div>
    <div class="panel-body">
      <p class="hint">ScrimStar schickt Ergebnis und Scoreboard eines Matches nach Discord (Knopf „In Discord posten“ auf der Match-Seite), und zwar dorthin, wo die Map des Matches hingehört.</p>
      <p class="hint"><b>Forum-Kanal mit einem Beitrag pro Map:</b> Oben den Webhook des Forums eintragen (In Discord: <b>Servereinstellungen → Integrationen → Webhooks → Neuer Webhook</b>, das Forum als Kanal wählen, <b>Webhook-URL kopieren</b>). Bei jeder Map den Link ihres Beitrags (Rechtsklick auf den Beitrag → <b>Link kopieren</b>).<br>
      <b>Eigene Kanäle:</b> Bei einer Map geht statt des Links auch die Webhook-Adresse eines eigenen Kanals. Maps ohne Eintrag gehen in den Kanal oben (bei einem Forum geht das nicht: Dort braucht jede Map ihren Beitrag).<br>
      Wer eine Webhook-Adresse kennt, kann in diesen Kanal schreiben: Sie sind nur für euer Team sichtbar, gib sie nicht weiter.</p>
      <form class="dc-hooks" data-form="discord-hooks" novalidate>
        ${field("dh-default", "default", "Webhook (Forum oder Standard-Kanal)", def, "https://discord.com/api/webhooks/…")}
        <h3 class="group">Pro Map: Link zum Forum-Beitrag oder eigener Webhook</h3>
        ${maps.map((n, i) => field(`dh-${i}`, "map:" + n, esc(n), mapHook(n), "https://discord.com/channels/…")).join("")}
        <h3 class="group">Planungs-Kanal (Tab „Planung“)</h3>
        <p class="hint">Hierhin gehen Wochenziele, Wochenrückblick und Gegner-Steckbrief (und Umfrage und Wochenplan, wenn darunter nichts steht). Ein normaler Text-Kanal (kein Forum): eigenen Webhook für diesen Kanal anlegen.</p>
        ${field("dh-plan", "plan", "Webhook des Planungs-Kanals", planHook, "https://discord.com/api/webhooks/…")}
        <p class="hint">Freiwillig: ein <b>eigener Kanal für Umfrage und Wochenplan</b> (z. B. #scrim-zeiten). Leer lassen = die gehen auch in den Planungs-Kanal oben.</p>
        ${field("dh-sched", "sched", "Webhook für Umfrage und Wochenplan", schedHook, "https://discord.com/api/webhooks/…")}
        <div class="actions"><button class="btn primary" type="submit">Speichern</button></div>
      </form>
      <form class="dc-hooks" data-form="access-hook" novalidate>
        <h3 class="group">Zugangs-Anfragen</h3>
        <p class="hint">Hierhin meldet die App jede neue Zugangs-Anfrage. Nimm einen <b>privaten Kanal</b>, den nur die Admins sehen: Diese Adresse können auch Leute lesen, die noch nicht freigeschaltet sind. Braucht die Regel für <code>config/public</code> (ANLEITUNG.md, Schritt 13).</p>
        ${field("dh-access", "access", "Webhook des Zugangs-Kanals", S.accessHook || "", "https://discord.com/api/webhooks/…")}
        <div class="actions"><button class="btn primary" type="submit">Speichern</button></div>
      </form>
    </div></section>`;
}

// Strats aus Google Drive (js/strats.js): Ordner-Link und API-Schlüssel
function stratsPanel() {
  const on = stratsOn();
  const state = `<span class="hint">${on ? "verbunden" : "nicht eingerichtet"}</span>`;
  if (!S.isAdmin) {
    return `<section class="panel"><div class="panel-head"><h2>Strats (Google Drive)</h2>${state}</div>
      <div class="panel-body"><p class="hint">${on ? "Der Tab „Strats“ zeigt die Taktiken aus eurem Google-Drive-Ordner." : "Ein Admin kann hier euren Google-Drive-Ordner mit den Strats verbinden."}</p></div></section>`;
  }
  const folder = (S.team && S.team.stratsFolder) || "", key = (S.team && S.team.stratsKey) || "";
  const shown = folder && !S.demo ? `https://drive.google.com/drive/folders/${folder}` : folder;
  return `<section class="panel"><div class="panel-head"><h2>Strats (Google Drive)</h2>${state}</div>
    <div class="panel-body">
      <p class="hint">Der Tab „Strats“ zeigt die Bilder direkt aus eurem Drive-Ordner (pro Map ein Ordner, darin „Attack“ und „Defense“). Gespeichert wird nichts davon in der App. Der Ordner muss auf <b>„Jeder mit dem Link kann ansehen“</b> stehen. Den API-Schlüssel legt ihr in der Google-Cloud-Konsole an, nur für eure Seite und nur für die Google Drive API (ANLEITUNG.md, Schritt 12).<br>
      Link und Schlüssel liegen nur hier in eurer Datenbank, nicht im öffentlichen Code. Gib den Ordner-Link nicht weiter.</p>
      <form class="dc-hooks" data-form="strats-drive" novalidate>
        <label class="field"><span>Link zum Drive-Ordner</span>
          <input type="text" id="sd-folder" name="folder" data-keep maxlength="300" autocomplete="off" autocapitalize="none" spellcheck="false" inputmode="url" placeholder="https://drive.google.com/drive/folders/…" value="${esc(shown)}"></label>
        <label class="field"><span>API-Schlüssel</span>
          <input type="text" id="sd-key" name="key" data-keep maxlength="100" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="AIza…" value="${esc(key)}"></label>
        <div class="actions"><button class="btn primary" type="submit">Prüfen und speichern</button>
          ${on ? '<a class="btn" href="#strats">Zu den Strats</a>' : ""}</div>
      </form>
    </div></section>`;
}

// Acts/Saisons (Wunsch Tim, 22.11.2026): stehen im Filter "Zeitraum" (js/stats.js rangeOptions). Anlegen nur Admins.
function seasonsPanel() {
  const list = ((S.team && S.team.seasons) || []).slice().reverse();
  const rows = list.map((x, i) => `<div class="member"><span><b>${esc(x.name)}</b> <span class="muted">ab ${esc(fmtDate(x.start).full)}</span>${i === 0 ? ' <span class="tag">aktuell</span>' : ""}</span>
      ${S.isAdmin ? `<button class="alias-x" type="button" data-action="season-del" data-start="${esc(x.start)}" aria-label="${esc(x.name)} löschen" title="Löschen">×</button>` : ""}</div>`).join("");
  const form = S.isAdmin ? `<form class="dc-hooks season-form" data-form="season-add" novalidate>
      <label class="field"><span>Name</span><input type="text" name="name" maxlength="40" required placeholder="z. B. V26 Act 6" autocomplete="off"></label>
      <label class="field"><span>Start</span><input type="date" name="start" required></label>
      <div class="actions"><button class="btn primary" type="submit">Act hinzufügen</button></div></form>` : "";
  return `<section class="panel"><div class="panel-head"><h2>Acts / Saisons</h2><span class="hint">${list.length ? `${list.length} ${list.length === 1 ? "Act" : "Acts"}` : "noch keine"}</span></div>
    <div class="panel-body">
      <p class="hint">Jeder Act steht im Filter „Zeitraum“ (der neueste als „Aktueller Act“). Ein Act geht vom Start bis zum Start des nächsten.${S.isAdmin ? "" : " Anlegen kann ein Admin."}</p>
      ${rows ? `<div class="roster">${rows}</div>` : ""}
      ${form}
    </div></section>`;
}

// Agenten-Beispiele fürs Screenshot-Auslesen (js/agentrefs.js): ansehen und falsche entfernen
function refsPanel() {
  const refs = S.agentRefs.slice().sort((a, b) => String(a.agent).localeCompare(String(b.agent), "de") || (b.createdAt || 0) - (a.createdAt || 0));
  const tile = (r) => `<figure class="ref">
      <img src="data:image/jpeg;base64,${esc(r.pic || "")}" alt="${esc(r.agent)}" width="64" height="64">
      <figcaption><b>${esc(r.agent)}</b><small>${r.kind === "fix" ? (r.wrong ? `korrigiert (KI: ${esc(r.wrong)})` : "ergänzt (KI erkannte nichts)") : "bestätigt"}</small></figcaption>
      <button class="alias-x" type="button" data-action="ref-remove" data-id="${esc(r.id)}" aria-label="Beispiel ${esc(r.agent)} entfernen" title="Falsches Beispiel entfernen">×</button>
    </figure>`;
  const body = !S.loaded.agentRefs ? '<p class="hint">Lädt …</p>'
    : refs.length ? `<div class="refs">${refs.map(tile).join("")}</div>`
      : '<p class="hint">Noch keine Beispiele. Sie entstehen von selbst, sobald ihr nach dem Auslesen einen falsch erkannten Agent korrigiert und das Match speichert.</p>';
  return `<section class="panel"><div class="panel-head"><h2>KI-Trainingsbilder</h2><span class="hint">${S.loaded.agentRefs ? plural(refs.length, "Bild", "Bilder") : ""}</span></div>
    <div class="panel-body">
      <p class="hint">Damit die KI Agents nicht verwechselt: Korrigiert ihr nach dem Auslesen einen Agent und speichert, merkt sich die App das kleine Bild aus dem Screenshot mit dem richtigen Namen. Beim nächsten Auslesen vergleicht die KI mit diesen Bildern. Pro Agent bleiben höchstens 3, ein neues ersetzt das älteste. Zeigt ein Bild etwas anderes als den Namen darunter, entfernt es mit ×.</p>
      ${body}
    </div></section>`;
}

// ---------- Klappbare Bereiche (Wunsch Tim, 19.11.2026: "übersichtlicher") ----------
// Jeder Bereich ist eine Zeile mit Titel und Kurz-Info, aufgeklappt wird nur, was man braucht. Welche offen sind,
// merkt sich das Gerät (localStorage). Beim ersten Mal ist nur die Team-Liste offen.
const FOLD_KEY = "valo-team-open";
const openFolds = (() => {
  try {
    const v = JSON.parse(localStorage.getItem(FOLD_KEY) || "null");
    return new Set(Array.isArray(v) ? v : ["members"]);
  } catch (e) { return new Set(["members"]); }
})();

// Macht aus einem Bereich (<section class="panel"> mit <div class="panel-head">) einen Klapp-Bereich
function fold(key, html) {
  return html
    .replace(/^\s*<section class="panel"><div class="panel-head">([\s\S]*?)<\/div>/, (_, head) =>
      `<details class="panel fold" data-fold="${key}"${openFolds.has(key) ? " open" : ""}><summary class="panel-head">${head}<span class="fold-mark" aria-hidden="true"></span></summary>`)
    .replace(/<\/section>\s*$/, "</details>");
}

// Auf- und Zuklappen merken ("toggle" steigt nicht auf, deshalb in der Capture-Phase)
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (!d || !d.dataset || !d.dataset.fold) return;
  if (d.open) openFolds.add(d.dataset.fold); else openFolds.delete(d.dataset.fold);
  try { localStorage.setItem(FOLD_KEY, JSON.stringify([...openFolds])); } catch (err) { /* nur Bequemlichkeit */ }
}, true);

export function teamView() {
  const me = S.user ? S.user.email : "";
  return `<div class="view-head"><div><div class="eyebrow">Verwaltung</div><h1>Team</h1>
      <p>Wer auf dieser Liste steht, darf die App benutzen.${me ? ` Du bist angemeldet als <b class="mail">${esc(me)}</b>.` : ""} Tipp auf einen Bereich, um ihn auf- oder zuzuklappen.</p></div></div>
    <div class="folds">
    ${fold("members", membersPanel())}
    ${fold("discord", discordPanel())}
    ${fold("strats", stratsPanel())}
    ${fold("seasons", seasonsPanel())}
    ${fold("refs", refsPanel())}
    ${fold("backup", backupPanel())}
    ${S.isAdmin ? fold("trash", trashPanel()) : '<p class="hint">Gelöschte Matches, Spieler und Clips kann ein Admin im Papierkorb wiederherstellen.</p>'}
    </div>`;
}

// ---------- Meldungen ohne Neuzeichnen ----------

function say(which, kind, text) {
  const m = text ? { kind, text } : null;
  if (which === "trash") trashMsg = m; else ioMsg = m;
  const el = $(which === "trash" ? "#trash-msg" : "#io-msg");
  if (!el) return;
  el.className = "msg " + (m ? m.kind : "");
  el.textContent = m ? m.text : "";
  el.hidden = !m;
  // Steht die Meldung in einem zugeklappten Bereich: aufklappen, sonst sähe sie niemand
  const d = el.closest("details");
  if (m && d && !d.open) d.open = true;
  if (m) el.scrollIntoView({ block: "nearest" });
}

// Beim Verlassen des Tabs: offene Vorschau und alte Meldungen weg
window.addEventListener("hashchange", () => {
  if (location.hash === "#team") return;
  if (!importing) plan = null;
  purgeAsk = false;
  trashMsg = null; ioMsg = null;
});

// Wäre der Spieler nach dem Wiederherstellen doppelt im Roster? (Name oder Ingame-Name schon vergeben)
function clash(p) {
  const keys = [p.name, ...(p.aliases || [])].map(norm).filter(Boolean);
  for (const other of S.players) {
    const hit = [other.name, ...(other.aliases || [])].find((x) => keys.includes(norm(x)));
    if (hit) return { other, hit };
  }
  return null;
}

async function doRestore(coll, id) {
  say("trash");
  const doc = known(coll, id);
  if (!doc || !doc.deleted) return;
  if (coll === "players") {
    const c = clash(doc);
    if (c) {
      return say("trash", "error", `${doc.name} lässt sich nicht wiederherstellen: „${c.hit}“ gehört schon zu ${c.other.name} im Roster. Nimm den Namen dort erst heraus (Tab „Spieler“).`);
    }
  }
  try {
    await restore(coll, id);
  } catch (e) {
    return say("trash", "error", errorText(e) || "Wiederherstellen hat nicht geklappt.");
  }
  if (coll === "matches") {
    const n = clipsWith(id);
    toast(`${matchLabel(doc)} ist wieder da${n ? `, mit ${plural(n, "Clip", "Clips")}` : ""}.`);
  } else if (coll === "players") {
    toast(`${doc.name} ist wieder im Roster.`);
  } else {
    const m = known("matches", doc.matchId);
    if (m && !m.deleted) toast(`Clip „${doc.title || "Clip"}“ ist wieder da.`);
    else say("trash", "ok", `Clip „${doc.title || "Clip"}“ ist wiederhergestellt. Zu sehen ist er erst, wenn auch sein Match zurück ist.`);
  }
}

// ---------- Klicks, Formulare, Datei-Auswahl ----------

export const actions = {
  "req-ok": async (el) => {
    if (!S.isAdmin) return;
    el.disabled = true;
    try { await approve(el.dataset.uid); toast("Freigeschaltet. Die Person tippt jetzt auf „Erneut prüfen“."); }
    catch (e) { el.disabled = false; toast(errorText(e) || "Freischalten hat nicht geklappt."); }
  },
  "req-no": async (el) => {
    if (!S.isAdmin) return;
    if (!el.dataset.sure) { el.dataset.sure = "1"; el.textContent = "Wirklich ablehnen?"; setTimeout(() => { if (el.isConnected) changed(); }, 4000); return; }
    try { await decline(el.dataset.uid); toast("Anfrage abgelehnt."); } catch (e) { toast(errorText(e) || "Das hat nicht geklappt."); }
  },
  "season-del": async (el) => {
    if (!S.isAdmin) return;
    if (!el.dataset.sure) { el.dataset.sure = "1"; el.textContent = "Löschen?"; el.style.width = "auto"; setTimeout(() => { if (el.isConnected) changed(); }, 4000); return; }
    try { await setSeasons(((S.team && S.team.seasons) || []).filter((x) => x.start !== el.dataset.start)); toast("Act gelöscht."); }
    catch (e) { toast(errorText(e) || "Löschen hat nicht geklappt."); }
  },
  "team-admin": (el) => run(() => setAdmin(el.dataset.email, Boolean(el.dataset.on)), { demoOk: true }),
  "team-remove": (el) => run(async () => {
    await removeMember(el.dataset.email);
    toast(el.dataset.email + " entfernt.");
  }, { demoOk: true }),
  "trash-restore": (el) => doRestore(el.dataset.coll, el.dataset.id),
  "trash-purge-ask": () => { if (S.isAdmin) { purgeAsk = true; changed(); } },
  "trash-purge-cancel": () => { purgeAsk = false; changed(); },
  "trash-purge": async () => {
    if (!S.isAdmin) return;
    purgeAsk = false;
    try {
      const c = await purgeTrash();
      const parts = [c.matches ? plural(c.matches, "Match", "Matches") : "", c.players ? `${c.players} Spieler` : "", c.clips ? plural(c.clips, "Clip", "Clips") : ""].filter(Boolean);
      say("trash", "ok", `Papierkorb geleert: ${parts.join(", ") || "nichts"} endgültig entfernt.${S.demo ? " (Vorschau: nur im Arbeitsspeicher.)" : ""}`);
    } catch (e) {
      say("trash", "error", errorText(e) || "Leeren hat nicht geklappt.");
    }
    changed();
  },
  "ref-remove": async (el) => {
    const r = S.agentRefs.find((x) => x.id === el.dataset.id);
    if (!r) return;
    try {
      await remove("agentRefs", r.id);
      toast(`Beispiel ${r.agent} entfernt.`);
    } catch (e) { toast(errorText(e) || "Entfernen hat nicht geklappt."); }
  },
  "trash-more": (el) => { showAll[el.dataset.coll] = true; changed(); },
  "export-json": () => {
    if (!allLoaded()) return;
    download(buildJson(), fileName("backup"), "application/json");
    say("io", "ok", "Backup heruntergeladen. Heb die Datei gut auf (z. B. in deinem Cloud-Speicher).");
  },
  "export-csv": () => {
    if (!allLoaded()) return;
    download(buildCsv(), fileName("matches"), "text/csv;charset=utf-8");
    say("io", "ok", "CSV heruntergeladen. Öffnen mit Excel (Doppelklick) oder in Google Sheets über Datei → Importieren.");
  },
  "imp-cancel": () => { if (importing) return; plan = null; ioMsg = null; changed(); },
  "imp-go": async () => {
    if (!plan || importing || !S.isAdmin) return;
    importing = true;
    changed();
    const p = plan;
    try {
      await applyImport(p);
      plan = null;
      const c = p.colls;
      ioMsg = { kind: "ok", text: `Eingespielt: ${plural(c.matches.docs.length, "Match", "Matches")}, ${c.players.docs.length} Spieler, ${plural(c.clips.docs.length, "Clip", "Clips")}.${S.demo ? " (Vorschau: nur im Arbeitsspeicher, nichts gespeichert.)" : ""}` };
    } catch (e) {
      ioMsg = { kind: "error", text: errorText(e) || "Einspielen hat nicht geklappt." };
    } finally {
      importing = false;
      changed();
    }
  },
};

export const changes = {
  // Konto einem Spieler (oder der Managerin) zuordnen
  "team-link": async (el) => {
    if (!S.isAdmin) return;
    const email = el.dataset.email, value = el.value;
    const links = (S.team && S.team.links) || {};
    if (value && value !== "manager" && Object.entries(links).some(([e, id]) => e !== email && id === value)) {
      toast("Dieser Spieler gehört schon zu einer anderen E-Mail.");
      changed();
      return;
    }
    try {
      await setLink(email, value);
      const name = value === "manager" ? "Managerin" : (S.players.find((p) => p.id === value) || {}).name;
      toast(value ? `${email} ist jetzt ${name}.` : `Zuordnung für ${email} entfernt.`);
    } catch (e) { toast(errorText(e) || "Speichern hat nicht geklappt."); changed(); }
  },
  "imp-file": async (el) => {
    const file = el.files && el.files[0];
    el.value = "";          // dieselbe Datei lässt sich so noch einmal wählen
    if (!file || !S.isAdmin) return;
    say("io");
    try {
      plan = await readImport(file);
      ioMsg = null;
    } catch (e) {
      plan = null;
      if (!e.plain) console.warn("Import-Datei nicht lesbar:", e.message);
      ioMsg = { kind: "error", text: e.plain ? e.message : "Die Datei ließ sich nicht lesen." };
    }
    changed();
  },
};

export const forms = {
  "access-hook": async (form) => {
    if (!S.isAdmin) return;
    const url = String(new FormData(form).get("access") || "").trim();
    if (url && !validAccessHook(url)) return toast("Das ist keine Webhook-Adresse von Discord. Sie beginnt mit https://discord.com/api/webhooks/");
    try { await setAccessHook(url); toast(url ? "Gespeichert. Neue Zugangs-Anfragen kommen jetzt in Discord an." : "Zugangs-Kanal entfernt."); }
    catch (e) { toast(e && e.code === "permission-denied" ? "Speichern ging nicht: In den Firestore-Regeln fehlt die Zeile für config/public (ANLEITUNG.md, Schritt 13)." : (errorText(e) || "Speichern hat nicht geklappt.")); }
  },
  "season-add": async (form) => {
    if (!S.isAdmin) return;
    const data = new FormData(form);
    const name = String(data.get("name") || "").trim(), start = String(data.get("start") || "");
    if (!name) return toast("Bitte einen Namen eintragen, z. B. V26 Act 6.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) return toast("Bitte das Startdatum wählen.");
    const list = (S.team && S.team.seasons) || [];
    if (list.some((x) => x.start === start)) return toast("An diesem Tag beginnt schon ein Act.");
    try { await setSeasons([...list, { name, start }]); toast(`„${name}“ angelegt. Er steht jetzt im Filter „Zeitraum“.`); }
    catch (e) { toast(errorText(e) || "Speichern hat nicht geklappt."); }
  },
  "discord-hooks": (form) => {
    if (!S.isAdmin) return;
    let def = "", plan = "", sched = "";
    const maps = {};
    for (const [name, raw] of new FormData(form).entries()) {
      const url = String(raw || "").trim();
      if (name === "default") {
        if (url && !validWebhook(url)) return toast("Webhook oben: Das ist keine Webhook-Adresse von Discord. Sie beginnt mit https://discord.com/api/webhooks/");
        def = url;
      } else if (name === "plan") {
        if (url && !validWebhook(url)) return toast("Planungs-Kanal: Das ist keine Webhook-Adresse von Discord. Sie beginnt mit https://discord.com/api/webhooks/");
        plan = url;
      } else if (name === "sched") {
        if (url && !validWebhook(url)) return toast("Umfrage und Wochenplan: Das ist keine Webhook-Adresse von Discord. Sie beginnt mit https://discord.com/api/webhooks/");
        sched = url;
      } else if (url) {
        if (!validMapTarget(url)) return toast(`${name.slice(4)}: Das ist weder ein Link zu einem Discord-Beitrag (https://discord.com/channels/…) noch eine Webhook-Adresse.`);
        maps[name.slice(4)] = url;
      }
    }
    // Ein Forum-Beitrag braucht den Webhook des Forums oben
    const posts = Object.entries(maps).filter(([, v]) => !validWebhook(v)).map(([k]) => k);
    if (posts.length && !def) return toast(`Für die Forum-Beiträge (${posts.join(", ")}) fehlt oben der Webhook des Forums.`);
    const n = Object.keys(maps).length;
    setDiscordHooks(def, maps, plan, sched).then(() => toast(def || n || plan || sched
      ? `Gespeichert: ${[def ? "Standard-Kanal" : "", n ? `${n} ${n === 1 ? "Map" : "Maps"}` : "", plan ? "Planungs-Kanal" : "", sched ? "Wochenplan-Kanal" : ""].filter(Boolean).join(", ")}.`
      : "Discord ist getrennt (keine Adresse eingetragen)."))
      .catch((e) => toast(errorText(e) || "Speichern hat nicht geklappt."));
  },
  "strats-drive": async (form) => {
    if (!S.isAdmin) return;
    const data = new FormData(form);
    const rawFolder = String(data.get("folder") || "").trim(), key = String(data.get("key") || "").trim();
    if (!rawFolder && !key) {
      return setStratsDrive("", "").then(() => toast("Drive-Ordner getrennt. Der Tab „Strats“ ist jetzt leer."))
        .catch((e) => toast(errorText(e) || "Speichern hat nicht geklappt."));
    }
    const folder = S.demo && rawFolder === S.team.stratsFolder ? rawFolder : folderId(rawFolder);
    if (!folder) return toast("Das ist kein Link zu einem Drive-Ordner. Er sieht so aus: https://drive.google.com/drive/folders/…");
    if (!S.demo && !validKey(key)) return toast("Das sieht nicht nach einem API-Schlüssel aus. Er beginnt mit „AIza“.");
    const btn = form.querySelector("button[type=submit]");
    if (btn) { btn.disabled = true; btn.textContent = "Prüfe …"; }
    try {
      // Erst prüfen, ob Google den Ordner mit diesem Schlüssel herausgibt, dann speichern
      const maps = S.demo ? 5 : await testDrive(folder, key);
      await setStratsDrive(folder, key);
      toast(`Gespeichert. Drive antwortet: ${maps} Ordner gefunden.`);
      loadStrats(true);
    } catch (e) {
      toast(e && e.plain ? e.message : (errorText(e) || "Speichern hat nicht geklappt."));
    } finally {
      if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = "Prüfen und speichern"; }
    }
  },
  "team-setup": (form) => {
    const lines = cleanEmails(String(new FormData(form).get("emails") || "").split(/[\s,;]+/));
    const bad = lines.filter((x) => !validEmail(x));
    if (bad.length) return setMsg("error", "Das sieht nicht nach einer E-Mail-Adresse aus: " + bad.join(", "));
    run(() => createTeam(lines));
  },
  "team-add": (form) => {
    const data = new FormData(form);
    const email = String(data.get("email") || "").trim().toLowerCase();
    if (!validEmail(email)) return setMsg("error", "Bitte gib eine gültige E-Mail-Adresse ein.");
    if (S.team && S.team.emails.includes(email)) return setMsg("error", "Diese Adresse steht schon auf der Liste.");
    run(async () => {
      await addMember(email, data.get("admin") === "on");
      const field = $("#team-email");
      if (field) field.value = "";
      toast(email + " freigeschaltet.");
    }, { demoOk: true });
  },
};
