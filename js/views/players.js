// Ansicht "Spieler": oben die Statistik-Tabelle (aus player.js), darunter das Roster.
// Roster: Wer gehört zum Team, mit welchen Ingame-Namen, Stamm oder Sub.
import { avatar, myPlayerId } from "./profile.js";
import { S, changed } from "../state.js";
import { ROLES } from "../constants.js";
import { $, esc, norm, toast } from "../util.js";
import { create, change, remove, listAdd, listRemove } from "../data.js";
import { run, setMsg, msgBox } from "./auth.js";
import { filterBar } from "./parts.js";
import { playerTable } from "./player.js";

let openId = null;      // welcher Spieler gerade zum Bearbeiten aufgeklappt ist
let asking = false;     // Sicherheitsfrage "wirklich entfernen?" im aufgeklappten Spieler
let addStaff = false;   // im Formular "Spieler hinzufügen" ist Staff gewählt: dann keine Rollen (spielt nicht mit)
let msgAt = "add";      // wo die Meldung erscheint: im aufgeklappten Spieler ("row") oder beim Formular ("add")

// Meldung dorthin legen, wo gerade getippt wurde. Eingaben überleben das Neuzeichnen (data-keep).
function spot(where) {
  if (msgAt === where) return;
  msgAt = where;
  S.msg = null;
  changed();
}

const clean = (s) => String(s || "").trim().replace(/\s+/g, " ");
const sameText = (a, b) => a.toLowerCase() === b.toLowerCase();
const find = (id) => S.players.find((p) => p.id === id);

// Mehrere Ingame-Namen aus einem Feld: getrennt mit Komma, Strichpunkt oder Zeilenumbruch, ohne Doppelte
function splitNames(text) {
  const out = [];
  for (const part of String(text || "").split(/[,;\n]+/)) {
    const name = clean(part);
    if (name && !out.some((x) => sameText(x, name))) out.push(name);
  }
  return out;
}

// Wem gehört dieser Name schon? Verglichen wird wie später beim Scoreboard-Screenshot:
// Groß/Klein und "#Tag" sind egal. Zwei Spieler mit demselben Namen ließen sich dort nicht unterscheiden.
function owner(text, exceptId) {
  const key = norm(text);
  return S.players.find((p) => p.id !== exceptId && [p.name, ...(p.aliases || [])].some((x) => norm(x) === key));
}

// ---------- Ansicht ----------

const option = (v, label, cur) => `<option value="${esc(v)}"${v === cur ? " selected" : ""}>${esc(label)}</option>`;
// Jeder Spieler hat eine Rolle und auf Wunsch eine zweite (role2, sonst null)
const roleTags = (p) => [p.role, p.role2].filter(Boolean).map((r) => `<span class="tag">${esc(r)}</span>`).join("");

function editor(p) {
  const id = esc(p.id);
  const aliases = (p.aliases || []).map((a) => `<li class="alias"><span>${esc(a)}</span>
      <button class="alias-x" type="button" data-action="roster-alias-remove" data-id="${id}" data-alias="${esc(a)}" aria-label="${esc(a)} entfernen" title="Entfernen">×</button></li>`).join("");
  // Verschieben: in jede der beiden anderen Gruppen
  const MOVE = { stamm: "Zum Stamm verschieben", sub: "Zu den Subs verschieben", staff: "Zum Staff (spielt nicht mit)" };
  const cur = p.status === "sub" || p.status === "staff" ? p.status : "stamm";
  const tools = asking
    ? `<div class="confirm"><span>${esc(p.name)} aus dem Roster nehmen? Alte Matches behalten den Namen.</span>
        <button class="btn small danger solid" type="button" data-action="roster-remove" data-id="${id}">Entfernen</button>
        <button class="btn small" type="button" data-action="roster-cancel">Abbrechen</button></div>`
    : `<div class="actions">
        ${Object.keys(MOVE).filter((k) => k !== cur).map((k) => `<button class="btn small" type="button" data-action="roster-status" data-id="${id}" data-status="${k}">${MOVE[k]}</button>`).join("")}
        <button class="btn small danger" type="button" data-action="roster-ask-remove">Aus dem Roster entfernen</button>
      </div>`;
  return `<div class="prow-edit">
    <form class="alias-add" data-form="roster-rename" data-id="${id}" novalidate>
      <label class="field"><span>Anzeigename</span>
        <input type="text" id="rename-${id}" name="name" data-keep maxlength="40" autocomplete="off" value="${esc(p.name)}"></label>
      <button class="btn" type="submit">Umbenennen</button>
    </form>
    <div class="field"><span>Ingame-Namen</span>
      ${aliases ? `<ul class="alias-list">${aliases}</ul>` : '<p class="hint">Noch keine eingetragen.</p>'}</div>
    <form class="alias-add" data-form="roster-alias" data-id="${id}" novalidate>
      <label class="field"><span>Ingame-Namen hinzufügen</span>
        <input type="text" id="alias-new-${id}" name="alias" data-keep maxlength="40" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="z. B. Name#TAG"></label>
      <button class="btn" type="submit">Hinzufügen</button>
    </form>
    ${p.status === "staff" ? '<p class="hint">Staff spielt nicht mit, deshalb ohne Rolle.</p>' : `<div class="role-edit">
      <label class="field"><span>Rolle</span>
        <select id="role-${id}" data-change="roster-role" data-id="${id}" data-which="role">${ROLES.map((r) => option(r, r, p.role)).join("")}</select></label>
      <label class="field"><span>Zweite Rolle</span>
        <select id="role2-${id}" data-change="roster-role" data-id="${id}" data-which="role2">${option("", "keine", p.role2 || "")}${ROLES.filter((r) => r !== p.role).map((r) => option(r, r, p.role2)).join("")}</select></label>
    </div>`}
    ${msgAt === "row" ? msgBox() : ""}
    ${tools}
  </div>`;
}

function row(p) {
  const open = p.id === openId;
  const names = (p.aliases || []).length ? p.aliases.map(esc).join(" · ") : "Keine Ingame-Namen eingetragen";
  return `<div class="roster-row prow${open ? " open" : ""}">
    <div class="member"><a class="plink pl-av" href="#player-${esc(encodeURIComponent(p.id))}">${avatar(p, 28)}<b>${esc(p.name)}</b></a>${p.status === "staff" ? '<span class="tag">Staff</span>' : roleTags(p)}</div>
    <button class="btn small" type="button" data-action="roster-open" data-id="${esc(p.id)}" aria-expanded="${open}">${open ? "Schließen" : "Bearbeiten"}</button>
    ${open ? editor(p) : `<div class="prow-names">${names}</div>`}
  </div>`;
}

const block = (title, list, emptyText) => `<h3 class="group">${title} <span>${list.length}</span></h3>
  ${list.length ? `<div class="roster">${list.map(row).join("")}</div>` : `<p class="hint">${emptyText}</p>`}`;

export function playersView() {
  // Kopf zuerst: filterBar räumt veraltete Filter weg, bevor die Statistik rechnet
  const head = `<div class="view-head"><div><div class="eyebrow">Team</div><h1>Spieler</h1>
    <p>Statistik pro Spieler, Stammspieler und Subs getrennt. Darunter das Roster mit den Ingame-Namen, über die die App die Spieler erkennt.</p>
    ${myPlayerId() ? `<p><a class="btn small" href="#player-${esc(encodeURIComponent(myPlayerId()))}">Mein Profil</a></p>` : ""}</div>
    <div class="head-side">${filterBar(true)}</div></div>`;
  if (!S.loaded.players) return head + '<p class="loading">Lade Spieler …</p>';

  // Der aufgeklappte Spieler ist weg (z. B. von jemand anderem entfernt): zuklappen
  if (openId && !find(openId)) { openId = null; asking = false; msgAt = "add"; }

  const sorted = S.players.slice().sort((a, b) => String(a.name).localeCompare(String(b.name), "de"));
  const stamm = sorted.filter((p) => p.status !== "sub" && p.status !== "staff"), subs = sorted.filter((p) => p.status === "sub");
  const staff = sorted.filter((p) => p.status === "staff");   // z. B. die Managerin: Profil ja, Statistik nein
  const count = `${stamm.length} Stamm · ${subs.length} ${subs.length === 1 ? "Sub" : "Subs"}${staff.length ? ` · ${staff.length} Staff` : ""}`;
  const body = sorted.length
    ? block("Stammspieler", stamm, "Noch keine Stammspieler.") + (subs.length ? block("Subs", subs, "") : "") + (staff.length ? block("Staff (spielt nicht mit)", staff, "") : "")
    : '<p class="hint">Noch kein Roster. Trag unten eure Spieler mit ihren Ingame-Namen ein.</p>';

  const o = (v, label) => option(v, label);
  const addForm = `<form class="player-add" data-form="roster-add" novalidate>
      <label class="field"><span>Anzeigename</span>
        <input type="text" id="np-name" name="name" data-keep maxlength="40" autocomplete="off" placeholder="z. B. Tim"></label>
      <label class="field wide"><span>Ingame-Namen</span>
        <input type="text" id="np-aliases" name="aliases" data-keep maxlength="200" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="z. B. Tim#EUW, TimAlt#1234"></label>
      <label class="field"><span>Stamm, Sub oder Staff</span><select id="np-status" name="status" data-keep data-change="roster-add-status">${o("stamm", "Stamm")}${o("sub", "Sub")}${o("staff", "Staff (z. B. Managerin, spielt nicht mit)")}</select></label>
      ${addStaff ? "" : `<label class="field"><span>Rolle</span><select id="np-role" name="role" data-keep>${ROLES.map((r) => o(r, r)).join("")}</select></label>
      <label class="field"><span>Zweite Rolle</span><select id="np-role2" name="role2" data-keep>${o("", "keine")}${ROLES.map((r) => o(r, r)).join("")}</select></label>`}
      <button class="btn primary" type="submit">Spieler hinzufügen</button>
    </form>
    ${msgAt === "add" ? msgBox() : ""}
    <p class="hint">Mehrere Ingame-Namen mit Komma trennen (Zweitaccounts, frühere Namen). Weitere lassen sich später über „Bearbeiten“ ergänzen.</p>`;

  return head + playerTable()
    + `<section class="panel"><div class="panel-head"><h2>Roster</h2><span class="hint">${count}</span></div>
        <div class="panel-body">${body}</div></section>
      <section class="panel"><div class="panel-head"><h2>Spieler hinzufügen</h2></div>
        <div class="panel-body">${addForm}</div></section>`;
}

// ---------- Klicks und Formulare ----------

const opt = { demoOk: true };   // in der Vorschau erlaubt: Dort ändert sich nur der Arbeitsspeicher

export const actions = {
  "roster-open": (el) => {
    openId = openId === el.dataset.id ? null : el.dataset.id;
    asking = false;
    msgAt = openId ? "row" : "add";
    S.msg = null;
    changed();
  },
  "roster-alias-remove": (el) => {
    spot("row");
    run(() => listRemove("players", el.dataset.id, "aliases", el.dataset.alias), opt);
  },
  "roster-status": (el) => {
    const p = find(el.dataset.id), status = ["sub", "staff"].includes(el.dataset.status) ? el.dataset.status : "stamm";
    if (!p) return;
    spot("row");
    run(async () => {
      // Vom Staff zurück zu den Spielern: Rolle "Flex", bis jemand eine wählt
      await change("players", p.id, status !== "staff" && !p.role ? { status, role: "Flex" } : { status });
      toast(p.name + (status === "sub" ? " ist jetzt Sub." : status === "staff" ? " ist jetzt Staff (spielt nicht mit)." : " ist jetzt Stammspieler."));
    }, opt);
  },
  "roster-ask-remove": () => { asking = true; S.msg = null; changed(); },
  "roster-cancel": () => { asking = false; changed(); },
  "roster-remove": (el) => {
    const p = find(el.dataset.id);
    if (!p) return;
    run(async () => {
      await remove("players", p.id);   // zeichnet neu: Der Spieler ist weg, die Zeile klappt zu
      toast(p.name + " wurde aus dem Roster genommen.");
    }, opt);
  },
};

// Auswahlfelder, die sofort speichern (data-change)
export const changes = {
  // Staff gewählt: Rollen ausblenden (und wieder einblenden, wenn es doch ein Spieler ist)
  "roster-add-status": (el) => { addStaff = el.value === "staff"; changed(); },
  "roster-role": (el) => {
    const p = find(el.dataset.id), which = el.dataset.which, value = el.value;
    if (!p) return;
    let role = p.role, role2 = p.role2 || null;
    if (which === "role2") {
      role2 = ROLES.includes(value) && value !== role ? value : null;
    } else if (ROLES.includes(value)) {
      // Wird die bisherige zweite Rolle zur ersten, tauschen die beiden die Plätze
      if (role2 === value) role2 = ROLES.includes(role) ? role : null;
      role = value;
    }
    spot("row");
    run(async () => {
      await change("players", p.id, { role, role2 });
      toast(`${p.name}: ${[role, role2].filter(Boolean).join(" und ")}.`);
    }, opt);
  },
};

export const forms = {
  "roster-add": (form) => {
    const data = new FormData(form);
    const name = clean(data.get("name"));
    const aliases = splitNames(data.get("aliases"));
    const role = ROLES.includes(data.get("role")) ? data.get("role") : "Flex";
    const role2 = ROLES.includes(data.get("role2")) ? data.get("role2") : null;
    const status = ["sub", "staff"].includes(data.get("status")) ? data.get("status") : "stamm";
    const staff = status === "staff";
    spot("add");
    if (!norm(name)) return setMsg("error", "Bitte gib einen Anzeigenamen ein.");
    if (!staff && role2 === role) return setMsg("error", "Die zweite Rolle muss eine andere sein als die erste. Wähl „keine“, wenn es nur eine gibt.");
    const twin = owner(name);
    if (twin) return setMsg("error", `„${name}“ steht schon im Roster${sameText(twin.name, name) ? "" : " (als Ingame-Name von " + twin.name + ")"}.`);
    for (const a of aliases) {
      if (!norm(a)) return setMsg("error", `„${a}“ ist kein gültiger Ingame-Name.`);
      const other = owner(a);
      if (other) return setMsg("error", `Der Ingame-Name „${a}“ gehört schon zu ${other.name}.`);
    }
    run(async () => {
      addStaff = false;
      await create("players", { name, aliases, role: staff ? null : role, role2: staff ? null : role2, status, active: true });
      // Formular leeren (die Auswahlfelder springen auf den ersten Eintrag zurück)
      for (const id of ["np-name", "np-aliases"]) { const el = $("#" + id); if (el) el.value = ""; }
      for (const id of ["np-role", "np-role2", "np-status"]) { const el = $("#" + id); if (el) el.selectedIndex = 0; }
      changed();
      toast(name + " ist jetzt im Roster.");
    }, opt);
  },
  // Anzeigename ändern (z. B. vertippt). Matches kennen den Spieler über seine ID: Der neue Name steht danach
  // überall (Statistik, Scoreboards, Spieler-Seite). Die Ingame-Namen in alten Matches bleiben, wie sie waren.
  "roster-rename": (form) => {
    const id = form.dataset.id;
    const name = clean(new FormData(form).get("name"));
    spot("row");
    const p = find(id);
    if (!p) return;
    if (!norm(name)) return setMsg("error", "Bitte gib einen Anzeigenamen ein.");
    if (name === p.name) return setMsg("ok", "Der Name ist unverändert.");
    const twin = owner(name, id);
    if (twin) return setMsg("error", `„${name}“ steht schon im Roster${sameText(twin.name, name) ? "" : " (als Ingame-Name von " + twin.name + ")"}.`);
    const old = p.name;
    run(async () => {
      await change("players", id, { name });
      toast(`${old} heißt jetzt ${name}.`);
    }, opt);
  },
  "roster-alias": (form) => {
    const id = form.dataset.id;
    const alias = clean(new FormData(form).get("alias"));
    spot("row");
    const p = find(id);
    if (!p) return;
    if (!norm(alias)) return setMsg("error", "Bitte gib einen Ingame-Namen ein.");
    if ((p.aliases || []).some((x) => sameText(x, alias))) return setMsg("error", `„${alias}“ steht schon bei ${p.name}.`);
    const other = owner(alias, id);
    if (other) return setMsg("error", `Dieser Ingame-Name gehört schon zu ${other.name}.`);
    run(async () => {
      await listAdd("players", id, "aliases", alias);
      const el = $("#alias-new-" + id);
      if (el) el.value = "";
    }, opt);
  },
};
