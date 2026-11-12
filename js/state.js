// Gemeinsamer Zustand der App. Die Ansichten lesen nur von hier.
// Woher die Daten kommen (Beispieldaten jetzt, Firestore ab Etappe 3), ist den Ansichten egal.

function loadFilters() {
  const def = { type: "alle", map: "alle", range: "alle" };
  try { return Object.assign(def, JSON.parse(localStorage.getItem("valo-filters") || "{}")); } catch (e) { return def; }
}

export const S = {
  // Welche Seite gerade dran ist:
  //   "boot"        App startet
  //   "setup"       firebase-config.js ist noch leer
  //   "login"       niemand angemeldet
  //   "verify"      angemeldet, aber die E-Mail ist noch nicht bestätigt
  //   "checking"    angemeldet, die Freischaltung wird gerade geprüft
  //   "offline"     Freischaltung lässt sich nicht prüfen (keine Verbindung)
  //   "blocked"     angemeldet, aber nicht auf der Team-Liste
  //   "team-setup"  Besitzer ist angemeldet, die Team-Liste gibt es noch nicht
  //   "app"         freigeschaltet: Die eigentliche App mit den Tabs
  //   "error"       etwas Unerwartetes (Meldung in S.error)
  mode: "boot",
  demo: false,          // Vorschau mit Beispieldaten (?demo=1): nichts wird gespeichert
  user: null,           // { uid, email (kleingeschrieben), name }
  team: null,           // { emails: [], admins: [] } aus config/team
  isAdmin: false,
  msg: null,            // Meldung auf den Anmelde-Seiten: { kind: "error" | "ok", text }
  error: "",
  authTab: "login",     // Login-Seite: "login" | "register" | "reset"
  players: [], matches: [], clips: [],
  loaded: { players: false, matches: false, clips: false },
  filters: loadFilters(),
};

// Neu zeichnen: main.js hängt hier seine render-Funktion ein, alle anderen rufen changed() auf.
let painter = () => {};
export const onChange = (fn) => { painter = fn; };
export const changed = () => painter();

export function saveFilters() {
  try { localStorage.setItem("valo-filters", JSON.stringify(S.filters)); } catch (e) { /* nicht schlimm */ }
}
