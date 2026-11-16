// Tab "Team": Team-Liste (E-Mails, Admins), Kurzanleitung zum Teilen, Export und Import (Backup), Papierkorb.
// Dazu die Seite "Team anlegen" beim allerersten Start des Besitzers.
// Papierkorb und Import sind nur für Admins (die Firestore-Regeln setzen das auch auf dem Server durch).
// Papierkorb, Export und Import haben eigene Meldungsfelder: msgBox (#auth-msg) gehört hier der Team-Liste.
import { S, changed } from "../state.js";
import { RES_LABEL } from "../constants.js";
import { $, esc, norm, toast, copyText, fmtDate } from "../util.js";
import { createTeam, addMember, removeMember, setAdmin, cleanEmails, validEmail } from "../team.js";
import { deletedOf, everything, known, restore, remove } from "../data.js";
import { buildCsv, buildJson, download, fileName, readImport, applyImport } from "../backup.js";
import { result } from "../stats.js";
import { appUrl, errorText } from "../auth.js";
import { run, setMsg, msgBox } from "./auth.js";

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

function membersPanel() {
  const t = S.team || { emails: [], admins: [] };
  const me = S.user ? S.user.email : "";
  const all = cleanEmails([...t.emails, ...t.admins]).sort((a, b) => (b === me) - (a === me) || a.localeCompare(b));
  const rows = all.map((email) => {
    const admin = t.admins.includes(email);
    const tools = S.isAdmin && email !== me
      ? `<div class="actions">
          <button class="btn small" type="button" data-action="team-admin" data-email="${esc(email)}" data-on="${admin ? "" : "1"}">${admin ? "Admin entziehen" : "Zum Admin machen"}</button>
          <button class="btn small danger" type="button" data-action="team-remove" data-email="${esc(email)}">Entfernen</button>
        </div>`
      : "";
    return `<div class="roster-row"><div class="member"><b class="mail">${esc(email)}</b>${admin ? ' <span class="tag">Admin</span>' : ""}${email === me ? ' <span class="tag">du</span>' : ""}</div>${tools}</div>`;
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
    <div class="panel-body"><div class="roster">${rows}</div>${addForm}</div></section>`;
}

function sharePanel() {
  const url = appUrl();
  return `<section class="panel"><div class="panel-head"><h2>Jemanden ins Team holen</h2></div>
    <div class="panel-body share">
      <div class="copybox"><code>${esc(url)}</code>
        <button class="btn small" type="button" data-action="share-copy">Link kopieren</button></div>
      <ol class="steps">
        <li><b>Link schicken.</b> Die Person öffnet ihn am Handy oder PC.</li>
        <li><b>Anmelden</b> mit Google oder mit E-Mail und Passwort (dann einmal die Bestätigungs-Mail öffnen).</li>
        <li><b>Freischalten:</b> Die App zeigt ihr „Noch nicht freigeschaltet“ und ihre E-Mail-Adresse. Die schickt sie einem Admin, der sie oben einträgt. Danach tippt sie auf „Erneut prüfen“.</li>
        <li><b>Zum Home-Bildschirm:</b>
          <span class="os"><b>iPhone:</b> in Safari öffnen → Teilen-Knopf (Quadrat mit Pfeil) → „Zum Home-Bildschirm“.</span>
          <span class="os"><b>Android:</b> in Chrome öffnen → Menü ⋮ → „App installieren“ (oder „Zum Startbildschirm hinzufügen“).</span></li>
      </ol>
      <p class="hint">Auf dem iPhone hat die App vom Home-Bildschirm einen eigenen Speicher: Dort muss man sich einmal neu anmelden, auch wenn man in Safari schon angemeldet war.</p>
    </div></section>`;
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
  return `<section class="panel"><div class="panel-head"><h2>Daten exportieren</h2>
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
  return `<section class="panel"><div class="panel-head"><h2>Papierkorb</h2><span class="hint">${allLoaded() ? plural(n, "Eintrag", "Einträge") : ""}</span></div>
    <div class="panel-body">
      ${box(trashMsg, "trash-msg")}
      ${body}
      <p class="hint trash-note">Gelöscht wird in der App nie endgültig. Clips eines gelöschten Matches stehen hier nicht einzeln: Sie kommen mit dem Match zurück. Gelöschte Clip-Notizen lassen sich nicht wiederherstellen.</p>
    </div></section>`;
}

// Agenten-Beispiele fürs Screenshot-Auslesen (js/agentrefs.js): ansehen und falsche entfernen
function refsPanel() {
  const refs = S.agentRefs.slice().sort((a, b) => String(a.agent).localeCompare(String(b.agent), "de") || (b.createdAt || 0) - (a.createdAt || 0));
  const tile = (r) => `<figure class="ref">
      <img src="data:image/jpeg;base64,${esc(r.pic || "")}" alt="${esc(r.agent)}" width="64" height="64">
      <figcaption><b>${esc(r.agent)}</b><small>${r.kind === "fix" ? `korrigiert${r.wrong ? ` (KI: ${esc(r.wrong)})` : ""}` : "bestätigt"}</small></figcaption>
      <button class="alias-x" type="button" data-action="ref-remove" data-id="${esc(r.id)}" aria-label="Beispiel ${esc(r.agent)} entfernen" title="Falsches Beispiel entfernen">×</button>
    </figure>`;
  const body = !S.loaded.agentRefs ? '<p class="hint">Lädt …</p>'
    : refs.length ? `<div class="refs">${refs.map(tile).join("")}</div>`
      : '<p class="hint">Noch keine Beispiele. Sie entstehen von selbst, sobald ihr nach dem Auslesen ein Match speichert.</p>';
  return `<section class="panel"><div class="panel-head"><h2>Agenten-Beispiele fürs Auslesen</h2><span class="hint">${S.loaded.agentRefs ? plural(refs.length, "Bild", "Bilder") : ""}</span></div>
    <div class="panel-body">
      <p class="hint">Damit die KI Agents nicht verwechselt: Korrigiert ihr nach dem Auslesen einen Agent und speichert, merkt sich die App das kleine Bild aus dem Screenshot mit dem richtigen Namen. Beim nächsten Auslesen vergleicht die KI mit diesen Bildern. Zeigt ein Bild etwas anderes als den Namen darunter, entfernt es mit ×.</p>
      ${body}
    </div></section>`;
}

export function teamView() {
  const me = S.user ? S.user.email : "";
  return `<div class="view-head"><div><div class="eyebrow">Verwaltung</div><h1>Team</h1>
      <p>Wer auf dieser Liste steht, darf die App benutzen.${me ? ` Du bist angemeldet als <b class="mail">${esc(me)}</b>.` : ""}</p></div></div>
    ${membersPanel()}
    ${sharePanel()}
    ${backupPanel()}
    ${refsPanel()}
    ${S.isAdmin ? trashPanel() : '<p class="hint">Gelöschte Matches, Spieler und Clips kann ein Admin im Papierkorb wiederherstellen.</p>'}`;
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
  if (m) el.scrollIntoView({ block: "nearest" });
}

// Beim Verlassen des Tabs: offene Vorschau und alte Meldungen weg
window.addEventListener("hashchange", () => {
  if (location.hash === "#team") return;
  if (!importing) plan = null;
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
  "team-admin": (el) => run(() => setAdmin(el.dataset.email, Boolean(el.dataset.on)), { demoOk: true }),
  "team-remove": (el) => run(async () => {
    await removeMember(el.dataset.email);
    toast(el.dataset.email + " entfernt.");
  }, { demoOk: true }),
  "share-copy": async () => {
    const ok = await copyText(appUrl());
    toast(ok ? "Link kopiert." : "Kopieren ging nicht. Markier den Link und kopier ihn von Hand.");
  },
  "trash-restore": (el) => doRestore(el.dataset.coll, el.dataset.id),
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
