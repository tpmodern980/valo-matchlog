// Seiten rund um die Anmeldung: Login, "Bitte E-Mail bestätigen", Sperrseite, keine Verbindung.
import { S, changed } from "../state.js";
import { $, esc, toast, copyText } from "../util.js";
import { loginGoogle, loginEmail, register, resetPassword, confirmVerified, resendVerification, logout, checkAccess, errorText } from "../auth.js";

// ---------- Bausteine ----------

export const msgBox = () => `<p class="msg ${S.msg ? esc(S.msg.kind) : ""}" id="auth-msg" role="alert"${S.msg ? "" : " hidden"}>${S.msg ? esc(S.msg.text) : ""}</p>`;

// Meldung setzen, ohne die Seite neu zu zeichnen (sonst wären die Eingaben weg)
export function setMsg(kind, text) {
  S.msg = text ? { kind, text } : null;
  const el = $("#auth-msg");
  if (!el) return;
  el.className = "msg " + (S.msg ? S.msg.kind : "");
  el.textContent = S.msg ? S.msg.text : "";
  el.hidden = !S.msg;
  if (S.msg) el.scrollIntoView({ block: "nearest" });
}

const busy = (on) => document.querySelectorAll("#view button, #status button").forEach((b) => { b.disabled = on; });

// Führt eine Aktion aus und zeigt Erfolg oder Fehler an.
// fn wird sofort aufgerufen (wichtig für das Google-Fenster: Es muss direkt im Klick aufgehen).
export async function run(fn, opt = {}) {
  setMsg();
  if (S.demo && !opt.demoOk) { toast("Vorschau: Hier ist die Anmeldung ausgeschaltet."); return; }
  if (!opt.keepEnabled) busy(true);
  try {
    const info = await fn();
    if (info) setMsg("ok", info);
  } catch (e) {
    const text = errorText(e);
    if (text) { if (!e.plain) console.warn("Aktion fehlgeschlagen:", e.code || e.message); setMsg("error", text); }
  } finally {
    if (!opt.keepEnabled) busy(false);
  }
}

const GOOGLE_G = `<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.96 10.71A5.41 5.41 0 0 1 3.68 9c0-.6.1-1.17.28-1.71V4.96H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.04l3-2.33z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58z"/></svg>`;

const emailField = (id) => `<label class="field"><span>E-Mail</span>
  <input type="email" id="${id}" name="email" data-keep autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" required></label>`;

// ---------- Login ----------

export function loginView() {
  if (S.authTab === "reset") {
    return `<section class="auth">
      <div class="auth-head"><div class="eyebrow">Team-Zugang</div><h1>Passwort vergessen</h1>
        <p>Gib deine E-Mail-Adresse ein. Du bekommst eine Mail mit einem Link, über den du ein neues Passwort festlegst.</p></div>
      <form class="auth-form" data-form="reset" novalidate>
        ${emailField("auth-email")}
        ${msgBox()}
        <button class="btn primary block" type="submit">Link senden</button>
      </form>
      <button class="linkish" type="button" data-action="auth-tab" data-tab="login">← Zurück zur Anmeldung</button>
    </section>`;
  }
  const reg = S.authTab === "register";
  return `<section class="auth">
    <div class="auth-head"><div class="eyebrow">Team-Zugang</div><h1>Anmelden</h1>
      <p>Nur für Mitglieder unseres Teams. Nach deiner ersten Anmeldung schaltet dich ein Admin frei.</p></div>
    <button class="btn block google" type="button" data-action="google">${GOOGLE_G}<span>Mit Google anmelden</span></button>
    <div class="or"><span>oder mit E-Mail</span></div>
    <div class="seg" role="group" aria-label="Anmelden oder neues Konto">
      <button type="button" data-action="auth-tab" data-tab="login" aria-pressed="${!reg}">Anmelden</button>
      <button type="button" data-action="auth-tab" data-tab="register" aria-pressed="${reg}">Neues Konto</button>
    </div>
    <form class="auth-form" data-form="${reg ? "register" : "login"}" novalidate>
      ${emailField("auth-email")}
      <label class="field"><span>Passwort</span>
        <span class="pw"><input type="password" id="auth-password" name="password" autocomplete="${reg ? "new-password" : "current-password"}" required>
        <button class="linkish" type="button" data-action="toggle-pw" aria-controls="auth-password">Zeigen</button></span></label>
      ${reg ? '<p class="hint">Mindestens 6 Zeichen. Danach bekommst du eine Mail, mit der du deine Adresse bestätigst.</p>' : ""}
      ${msgBox()}
      <button class="btn primary block" type="submit">${reg ? "Konto anlegen" : "Anmelden"}</button>
    </form>
    ${reg ? "" : '<button class="linkish" type="button" data-action="auth-tab" data-tab="reset">Passwort vergessen?</button>'}
  </section>`;
}

// ---------- Bitte E-Mail bestätigen ----------

export function verifyView() {
  return `<section class="auth">
    <div class="auth-head"><div class="eyebrow">Fast geschafft</div><h1>Bitte <span class="nw">E-Mail</span> bestätigen</h1>
      <p>Wir haben eine Mail an <b class="mail">${esc(S.user.email)}</b> geschickt. Öffne sie, tipp auf den Link darin und komm dann hierher zurück.</p></div>
    ${msgBox()}
    <div class="auth-btns">
      <button class="btn primary" type="button" data-action="verified">Ich habe bestätigt</button>
      <button class="btn" type="button" data-action="resend">Mail nochmal senden</button>
    </div>
    <p class="hint">Nichts angekommen? Schau im Spam-Ordner nach. Der Link öffnet sich im Browser: Das ist richtig so, danach geht es hier in der App weiter.</p>
    <p class="hint">Falsche Adresse? <button class="linkish" type="button" data-action="logout">Abmelden</button> und ein neues Konto anlegen.</p>
  </section>`;
}

// ---------- Freischaltung ----------

export function checkingView() {
  return '<p class="loading">Prüfe Freischaltung …</p>';
}

export function blockedView() {
  return `<section class="auth">
    <div class="auth-head"><div class="eyebrow">Zugang</div><h1>Noch nicht freigeschaltet</h1>
      <p>Du bist angemeldet, stehst aber noch nicht auf der Team-Liste. Schick dem Admin diese E-Mail-Adresse, damit er dich freischaltet:</p></div>
    <div class="copybox"><code id="my-email">${esc(S.user.email)}</code>
      <button class="btn small" type="button" data-action="copy-email">Kopieren</button></div>
    ${msgBox()}
    <div class="auth-btns">
      <button class="btn primary" type="button" data-action="recheck">Erneut prüfen</button>
      <button class="btn" type="button" data-action="logout">Abmelden</button>
    </div>
    <p class="hint">Sobald der Admin dich eingetragen hat, tipp auf „Erneut prüfen“.</p>
  </section>`;
}

export function offlineView() {
  return `<section class="auth">
    <div class="auth-head"><div class="eyebrow">Verbindung</div><h1>Keine Verbindung</h1>
      <p>Deine Freischaltung konnte gerade nicht geprüft werden. Sobald du wieder online bist, geht es von selbst weiter.</p></div>
    <div class="auth-btns">
      <button class="btn primary" type="button" data-action="recheck">Erneut versuchen</button>
      <button class="btn" type="button" data-action="logout">Abmelden</button>
    </div>
    <p class="hint">Du richtest die App gerade ein? Dann prüf, ob die Firestore-Datenbank schon angelegt ist (ANLEITUNG.md, Schritt 4).</p>
  </section>`;
}

// Unerwarteter Fehler: beim Start (niemand angemeldet) oder beim Prüfen der Freischaltung
export function problemView() {
  return `<section class="auth">
    <div class="auth-head"><div class="eyebrow">Hinweis</div><h1>Da stimmt etwas nicht</h1>
      <p>${esc(S.error || "Unbekannter Fehler")}</p></div>
    <div class="auth-btns">
      ${S.user
        ? '<button class="btn primary" type="button" data-action="recheck">Erneut versuchen</button><button class="btn" type="button" data-action="logout">Abmelden</button>'
        : '<button class="btn primary" type="button" data-action="reload">Neu laden</button>'}
    </div>
  </section>`;
}

// ---------- Klicks und Formulare ----------

const readEmail = (form) => String(new FormData(form).get("email") || "").trim();
const readPassword = (form) => String(new FormData(form).get("password") || "");

export const actions = {
  "auth-tab": (el) => {
    S.authTab = el.dataset.tab; S.msg = null; changed();
    // Nur mit Maus/Tastatur gleich ins Feld springen: Am Handy würde sonst sofort die Tastatur aufgehen
    const field = $("#auth-email");
    if (field && !field.value && matchMedia("(pointer: fine)").matches) field.focus();
  },
  "toggle-pw": (el) => {
    const input = $("#auth-password");
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    el.textContent = show ? "Verbergen" : "Zeigen";
  },
  // Die Knöpfe bleiben benutzbar: Wer das Google-Fenster schließt, kann sofort neu klicken
  "google": () => run(loginGoogle, { keepEnabled: true }),
  "verified": () => run(() => confirmVerified()),
  "resend": () => run(resendVerification),
  "recheck": () => { if (S.demo) toast("Vorschau: Hier ist die Anmeldung ausgeschaltet."); else { S.msg = null; checkAccess(); } },
  "logout": () => run(logout),
  "reload": () => location.reload(),
  "copy-email": async () => {
    const ok = await copyText(S.user.email);
    toast(ok ? "E-Mail-Adresse kopiert." : "Kopieren ging nicht. Markier die Adresse und kopier sie von Hand.");
  },
};

export const forms = {
  login: (form) => {
    const email = readEmail(form), password = readPassword(form);
    if (!email) return setMsg("error", "Bitte gib deine E-Mail-Adresse ein.");
    if (!password) return setMsg("error", "Bitte gib dein Passwort ein.");
    run(() => loginEmail(email, password));
  },
  register: (form) => {
    const email = readEmail(form), password = readPassword(form);
    if (!email) return setMsg("error", "Bitte gib deine E-Mail-Adresse ein.");
    if (password.length < 6) return setMsg("error", "Das Passwort braucht mindestens 6 Zeichen.");
    run(() => register(email, password));
  },
  reset: (form) => {
    const email = readEmail(form);
    if (!email) return setMsg("error", "Bitte gib deine E-Mail-Adresse ein.");
    run(() => resetPassword(email));
  },
};
