// Anmeldung und Freischaltung.
// Ablauf: nicht angemeldet -> "login". Angemeldet, E-Mail unbestätigt -> "verify".
// Bestätigt -> Team-Liste prüfen ("checking") -> "app", "blocked", "team-setup" oder "offline".
import { S, changed } from "./state.js";
import { cfg } from "./config.js";
import { loadFirebase } from "./firebase.js";
import { watchTeam, stopTeam } from "./team.js";
import { startData, stopData, wipeData } from "./data.js";

let fb = null;          // { auth, A } sobald Firebase geladen ist
let waitTimer = null;
let lastCheck = 0;

function go(mode) { S.mode = mode; changed(); }

// Eigene Meldung, die schon fertig auf Deutsch ist
const say = (text) => Object.assign(new Error(text), { plain: true });

// ---------- Start ----------

export async function startAuth() {
  // Kommt die Seite gerade von Google zurück? Dann zuerst den Ausweis aus der Adresszeile nehmen.
  const answer = takeGoogleAnswer();
  fb = await loadFirebase();
  if (answer) await finishGoogleLogin(answer).catch(showLoginError);
  // Meldet sich sofort mit dem gemerkten Nutzer (oder null) und danach bei jedem An- und Abmelden
  fb.A.onAuthStateChanged(fb.auth, evaluate);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") onReturn(); });
  // Manche Geräte laden die Seite bei der Rückkehr von Google nicht neu, sondern ändern nur den Teil hinter dem #
  window.addEventListener("hashchange", () => {
    const late = takeGoogleAnswer();
    if (late) finishGoogleLogin(late).catch((e) => { showLoginError(e); changed(); });
  });
}

function showLoginError(e) {
  if (!e.plain) console.warn("Google-Anmeldung fehlgeschlagen:", e.code || e.message);
  S.msg = { kind: "error", text: errorText(e) };
}

function evaluate(user) {
  stopTeam();
  stopData();
  clearTimeout(waitTimer);
  S.team = null; S.isAdmin = false;
  // Niemand (mehr) angemeldet: geladene Daten von diesem Gerät entfernen
  if (!user) { S.user = null; wipeData(); go("login"); return; }
  S.user = { uid: user.uid, email: String(user.email || "").toLowerCase(), name: user.displayName || "" };
  if (!user.emailVerified) { go("verify"); return; }
  checkAccess();
}

// ---------- Freischaltung ----------

// silent: Die Seite bleibt stehen, bis das Ergebnis da ist (für die Prüfung im Hintergrund).
export function checkAccess(silent) {
  if (!S.user) return;
  lastCheck = Date.now();
  if (!silent) go("checking");
  clearTimeout(waitTimer);
  // Kommt keine Antwort, liegt es fast immer an der Verbindung. Die Abfrage läuft im Hintergrund weiter.
  waitTimer = setTimeout(() => { if (S.mode === "checking") go("offline"); }, 8000);
  watchTeam(S.user.email, onTeam);
}

function onTeam(r) {
  if (r.state === "waiting") return;
  clearTimeout(waitTimer);
  if (r.state === "member") {
    const same = S.mode === "app" && JSON.stringify(S.team) === JSON.stringify(r.team);
    S.team = r.team;
    S.isAdmin = r.team.admins.includes(S.user.email);
    startData();   // Spieler, Matches und Clips laden (läuft es schon, passiert nichts)
    if (!same) go("app");
  } else if (r.state === "new") {
    if (S.mode !== "team-setup") go("team-setup");
  } else if (r.state === "blocked") {
    S.team = null; S.isAdmin = false;
    wipeData();   // nicht (mehr) freigeschaltet: geladene Daten von diesem Gerät entfernen
    go("blocked");
  } else if (isOffline(r.error)) {
    go("offline");
  } else {
    console.error(r.error);
    S.error = errorText(r.error);
    go("error");
  }
}

// Zurück in der App (z. B. nach dem Klick auf den Link in der Bestätigungs-Mail): still nachsehen, ob es weitergeht
function onReturn() {
  if (S.mode === "verify") confirmVerified(true).catch(() => {});
  else if (S.mode === "blocked" && Date.now() - lastCheck > 5000) checkAccess(true);
}

// ---------- Aktionen der Anmelde-Seiten ----------
// Jede Funktion wirft bei einem Fehler. Ein zurückgegebener Text ist eine Erfolgsmeldung.

// Google-Anmeldung. Mit googleClientId in firebase-config.js wechselt die ganze Seite zu Google und kommt
// mit einem Ausweis (ID-Token) hinter dem # zurück. Damit meldet sich die App dann bei Firebase an.
// Grund: Das Zwischenfenster von Firebase verliert in der installierten iPhone-App seinen Zustand
// ("missing initial state"). Ohne googleClientId bleibt es beim Fenster (Popup).
const GOOGLE_KEY = "valo-google-login";
const GOOGLE_MAX_MS = 15 * 60 * 1000;
const GOOGLE_MISMATCH = "Die Antwort von Google passt nicht zu dieser Anmeldung oder kam zu spät. Tipp noch einmal auf „Mit Google anmelden“.";

const randomId = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

// Adresse dieser Seite ohne ?… und #…: Genau so muss sie bei Google als Weiterleitungs-URI eingetragen sein.
export const appUrl = () => location.origin + location.pathname.replace(/index\.html$/, "");

export function loginGoogle() {
  if (!cfg.googleClientId) {
    // Das Fenster muss direkt im Klick aufgehen, deshalb hier kein "await" vor signInWithPopup
    const provider = new fb.A.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    return fb.A.signInWithPopup(fb.auth, provider).then(() => "");
  }
  // Merkzettel für die Rückkehr: Nur eine Antwort, die dazu passt, wird angenommen
  const ticket = { state: randomId(), nonce: randomId(), at: Date.now() };
  try { localStorage.setItem(GOOGLE_KEY, JSON.stringify(ticket)); }
  catch (e) { return Promise.reject(say("Dieser Browser speichert nichts (privater Modus?). Nimm ein normales Browserfenster oder E-Mail und Passwort.")); }
  const query = new URLSearchParams({
    client_id: cfg.googleClientId, redirect_uri: appUrl(), response_type: "id_token", scope: "openid email profile",
    nonce: ticket.nonce, state: ticket.state, prompt: "select_account",
  });
  location.assign("https://accounts.google.com/o/oauth2/v2/auth?" + query);
  return new Promise(() => {});   // die Seite wird verlassen
}

// Steht hinter dem # eine Antwort von Google? Dann herausnehmen, damit der Ausweis nicht in der Adresszeile bleibt.
function takeGoogleAnswer() {
  const hash = location.hash.slice(1);
  if (!/(^|&)state=/.test(hash) || !/(^|&)(id_token|error)=/.test(hash)) return null;
  const p = new URLSearchParams(hash);
  history.replaceState(null, "", location.pathname + location.search);
  return { idToken: p.get("id_token"), error: p.get("error"), state: p.get("state") };
}

// Inhalt eines ID-Tokens lesen (mittlerer Teil, base64url). Geprüft wird das Token von Firebase.
function tokenClaims(token) {
  try {
    const part = String(token).split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(part), (c) => c.charCodeAt(0))));
  } catch (e) { return {}; }
}

async function finishGoogleLogin(answer) {
  let ticket = null;
  try { ticket = JSON.parse(localStorage.getItem(GOOGLE_KEY) || "null"); localStorage.removeItem(GOOGLE_KEY); } catch (e) { /* bleibt null */ }
  if (answer.error) {
    throw say(answer.error === "access_denied" ? "Die Anmeldung bei Google wurde abgebrochen." : `Google hat die Anmeldung abgelehnt (${answer.error}).`);
  }
  const fresh = ticket && ticket.state === answer.state && Date.now() - ticket.at < GOOGLE_MAX_MS;
  if (!fresh || tokenClaims(answer.idToken).nonce !== ticket.nonce) throw say(GOOGLE_MISMATCH);
  try {
    await fb.A.signInWithCredential(fb.auth, fb.A.GoogleAuthProvider.credential(answer.idToken));
  } catch (e) {
    if (e.code === "auth/invalid-credential") throw say("Firebase hat die Google-Anmeldung nicht angenommen. Stimmt googleClientId in firebase-config.js?");
    throw e;
  }
}

export async function loginEmail(email, password) {
  await fb.A.signInWithEmailAndPassword(fb.auth, email, password);
}

export async function register(email, password) {
  const cred = await fb.A.createUserWithEmailAndPassword(fb.auth, email, password);
  try { await fb.A.sendEmailVerification(cred.user); }
  catch (e) {
    console.error(e);
    throw say("Dein Konto ist angelegt, aber die Bestätigungs-Mail konnte nicht gesendet werden. Tipp gleich auf „Mail nochmal senden“.");
  }
}

export async function resetPassword(email) {
  await fb.A.sendPasswordResetEmail(fb.auth, email);
  return "Wenn es zu dieser Adresse ein Konto gibt, ist jetzt eine Mail zum Zurücksetzen unterwegs. Schau auch im Spam-Ordner nach.";
}

// "Ich habe bestätigt": Konto neu laden und ein frisches Token holen, sonst kennt Firestore die Bestätigung nicht.
export async function confirmVerified(silent) {
  const user = fb.auth.currentUser;
  if (!user) return;
  await user.reload();
  if (!user.emailVerified) {
    if (silent) return;
    throw say("Die Adresse ist noch nicht bestätigt. Tipp zuerst auf den Link in der Mail und dann noch einmal hier.");
  }
  await user.getIdToken(true);
  evaluate(user);
}

export async function resendVerification() {
  const user = fb.auth.currentUser;
  if (!user) return;
  await fb.A.sendEmailVerification(user);
  return "Die Mail ist unterwegs. Schau auch im Spam-Ordner nach.";
}

export async function logout() {
  stopTeam();
  stopData();   // der Zwischenspeicher wird geleert, sobald die Abmeldung durch ist (evaluate)
  S.authTab = "login";
  await fb.A.signOut(fb.auth);
}

// ---------- Fehlermeldungen auf Deutsch ----------

const NO_NET = "Keine Verbindung. Prüf dein Internet und versuch es noch einmal.";

const TEXT = {
  // Anmeldung
  "auth/invalid-credential": "E-Mail oder Passwort stimmt nicht. Falls du dich sonst mit Google anmeldest, nimm den Google-Knopf.",
  "auth/invalid-login-credentials": "E-Mail oder Passwort stimmt nicht. Falls du dich sonst mit Google anmeldest, nimm den Google-Knopf.",
  "auth/wrong-password": "Das Passwort stimmt nicht.",
  "auth/user-not-found": "Zu dieser E-Mail gibt es kein Konto. Leg unter „Neues Konto“ eins an.",
  "auth/invalid-email": "Das ist keine gültige E-Mail-Adresse.",
  "auth/missing-email": "Bitte gib deine E-Mail-Adresse ein.",
  "auth/missing-password": "Bitte gib dein Passwort ein.",
  "auth/email-already-in-use": "Für diese E-Mail gibt es schon ein Konto. Wechsle auf „Anmelden“ oder nimm den Google-Knopf, falls du dich damit angemeldet hast.",
  "auth/weak-password": "Das Passwort ist zu schwach. Nimm mindestens 6 Zeichen.",
  "auth/password-does-not-meet-requirements": "Das Passwort erfüllt die Vorgaben nicht. Nimm ein längeres mit Buchstaben und Zahlen.",
  "auth/too-many-requests": "Zu viele Versuche. Warte ein paar Minuten und probier es dann noch einmal.",
  "auth/quota-exceeded": "Für heute sind zu viele Mails verschickt worden. Versuch es später noch einmal.",
  "auth/user-disabled": "Dieses Konto wurde gesperrt. Wende dich an den Admin.",
  "auth/user-token-expired": "Die Anmeldung ist abgelaufen. Melde dich bitte neu an.",
  "auth/requires-recent-login": "Die Anmeldung ist abgelaufen. Melde dich bitte neu an.",
  "auth/account-exists-with-different-credential": "Für diese E-Mail gibt es schon ein Konto mit einer anderen Anmeldeart. Melde dich so an wie beim ersten Mal.",
  // Google-Fenster
  "auth/popup-blocked": "Der Browser hat das Google-Fenster blockiert. Erlaube Pop-ups für diese Seite und tipp noch einmal auf den Knopf.",
  "auth/popup-closed-by-user": "Das Google-Fenster wurde geschlossen, bevor die Anmeldung fertig war.",
  "auth/user-cancelled": "Die Anmeldung wurde abgebrochen.",
  "auth/cancelled-popup-request": "",   // ein neuer Klick hat das alte Fenster ersetzt: keine Meldung
  "auth/web-storage-unsupported": "In diesem Browser geht die Google-Anmeldung nicht (privater Modus oder Speicher blockiert). Nimm E-Mail und Passwort oder einen anderen Browser.",
  "auth/operation-not-supported-in-this-environment": "In diesem Browser geht die Google-Anmeldung nicht. Nimm E-Mail und Passwort oder einen anderen Browser.",
  // Verbindung
  "auth/network-request-failed": NO_NET,
  "auth/timeout": NO_NET,
  "unavailable": NO_NET,
  "deadline-exceeded": NO_NET,
  // Einrichtung (sieht normalerweise nur der Admin)
  "auth/operation-not-allowed": "Diese Anmeldeart ist in Firebase noch nicht eingeschaltet (Authentication → Anmeldemethode).",
  "auth/unauthorized-domain": "Diese Adresse ist in Firebase nicht als autorisierte Domain eingetragen (Authentication → Einstellungen → Autorisierte Domains).",
  "auth/configuration-not-found": "Authentication ist im Firebase-Projekt noch nicht eingerichtet (ANLEITUNG.md, Schritt 3).",
  "auth/invalid-api-key": "Die Angaben in firebase-config.js stimmen nicht: Der API-Schlüssel ist ungültig.",
  "auth/api-key-not-valid.-please-pass-a-valid-api-key.": "Die Angaben in firebase-config.js stimmen nicht: Der API-Schlüssel ist ungültig.",
  // Datenbank
  "permission-denied": "Dafür fehlt dir die Berechtigung.",
  "not-found": "Die Firestore-Datenbank wurde nicht gefunden. Ist sie in der Firebase-Konsole angelegt (ANLEITUNG.md, Schritt 4)?",
};

// Das SDK ließ sich nicht vom CDN laden oder eine Anfrage kam nicht durch
function isOffline(e) {
  if (!e) return false;
  if (TEXT[e.code] === NO_NET) return true;
  return !e.code && (e instanceof TypeError || /dynamically imported module|Importing a module script failed|Failed to fetch|Load failed/i.test(String(e.message)));
}

export function errorText(e) {
  if (!e) return "";
  if (e.plain) return e.message;
  if (isOffline(e)) return NO_NET;
  if (e.code in TEXT) return TEXT[e.code];
  return "Das hat nicht geklappt. Versuch es noch einmal." + (e.code ? ` (Fehler: ${e.code})` : "");
}
