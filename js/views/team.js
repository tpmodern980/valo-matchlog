// Team-Liste: erste Einrichtung durch den Besitzer und eine einfache Verwaltung der E-Mails.
// (Papierkorb, Export und Import kommen in Etappe 8 dazu.)
import { S } from "../state.js";
import { $, esc, toast } from "../util.js";
import { createTeam, addMember, removeMember, setAdmin, cleanEmails, validEmail } from "../team.js";
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

// ---------- Tab "Team" ----------

export function teamView() {
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
      <p class="hint">Die Adresse muss genau die sein, mit der sich die Person anmeldet. Am sichersten: Sie meldet sich einmal an und schickt dir die Adresse, die ihr die App dann anzeigt.</p>`
    : '<p class="hint">Nur Admins können die Liste ändern.</p>';

  return `<div class="view-head"><div><div class="eyebrow">Verwaltung</div><h1>Team</h1>
      <p>Wer auf dieser Liste steht, darf die App benutzen.${me ? ` Du bist angemeldet als <b class="mail">${esc(me)}</b>.` : ""}</p></div></div>
    <section class="panel"><div class="panel-head"><h2>Freigeschaltete E-Mails</h2><span class="hint">${all.length} ${all.length === 1 ? "Adresse" : "Adressen"}</span></div>
      <div class="panel-body"><div class="roster">${rows}</div>${addForm}</div></section>
    <div class="empty"><h2>Noch nicht gebaut</h2><p>Papierkorb sowie Export und Import der Daten.</p><p class="hint">Kommt in Etappe 8.</p></div>`;
}

// ---------- Klicks und Formulare ----------

export const actions = {
  "team-admin": (el) => run(() => setAdmin(el.dataset.email, Boolean(el.dataset.on)), { demoOk: true }),
  "team-remove": (el) => run(async () => {
    await removeMember(el.dataset.email);
    toast(el.dataset.email + " entfernt.");
  }, { demoOk: true }),
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
