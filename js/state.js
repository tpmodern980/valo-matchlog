// Gemeinsamer Zustand der App. Die Ansichten lesen nur von hier.
// Woher die Daten kommen (Beispieldaten jetzt, Firestore ab Etappe 3), ist den Ansichten egal.

function loadFilters() {
  const def = { type: "alle", map: "alle", range: "alle" };
  try { return Object.assign(def, JSON.parse(localStorage.getItem("valo-filters") || "{}")); } catch (e) { return def; }
}

export const S = {
  // "boot" | "setup" (Firebase fehlt) | "pending" (Login folgt in Etappe 2) | "demo" (Beispieldaten)
  mode: "boot",
  players: [], matches: [], clips: [],
  loaded: { players: false, matches: false, clips: false },
  filters: loadFilters(),
};

export function saveFilters() {
  try { localStorage.setItem("valo-filters", JSON.stringify(S.filters)); } catch (e) { /* nicht schlimm */ }
}
