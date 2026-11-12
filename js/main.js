// Start der App: entscheidet, welche Seite gezeigt wird, und rendert bei jeder Änderung neu.
import { APP_NAME, isConfigured, isDemo } from "./config.js";
import { S, saveFilters } from "./state.js";
import { $, esc } from "./util.js";
import { route, TAB_OF } from "./router.js";
import { matchesView } from "./views/matches.js";
import { matchView } from "./views/match.js";
import { soonView } from "./views/parts.js";
import { setupView, pendingView, errorView } from "./views/setup.js";

// Darf der Nutzer die eigentliche App sehen? (Ab Etappe 2: angemeldet und freigeschaltet.)
const inApp = () => S.mode === "demo";

function viewHtml(r) {
  if (S.mode === "setup") return setupView();
  if (S.mode === "pending") return pendingView();
  switch (r.name) {
    case "match": return matchView(r.id);
    case "players": return soonView("Statistik", "Spieler", "Tabelle aller Spieler mit ACS, K/D, KPR und Diagrammen. Stammspieler oben, Subs in einem eigenen Block. Dazu das Roster.", "5");
    case "player": return soonView("Statistik", "Spieler-Detail", "Kennzahlen, Verlauf von ACS und K/D, ACS nach Map, Agents und Match-Historie.", "5");
    case "maps": return soonView("Statistik", "Maps", "Bilanz und Winrate pro Map, Angriff und Verteidigung getrennt, Pistol-Quote.", "5");
    case "opponents":
    case "opponent": return soonView("Statistik", "Gegner", "Bilanz, Winrate und alle Matches pro Gegner.", "5");
    case "team": return soonView("Verwaltung", "Team", "Freigeschaltete E-Mails, Admins, Papierkorb sowie Export und Import der Daten.", "8");
    default: return matchesView();
  }
}

function renderStatus() {
  const bits = [];
  if (S.mode === "demo") bits.push(`<span class="chip warn" title="Erfundene Beispieldaten, nichts wird gespeichert">Vorschau · <a href="${esc(location.pathname)}">beenden</a></span>`);
  $("#status").innerHTML = bits.join("");
}

function render() {
  const r = route();
  const app = inApp();
  document.body.classList.toggle("no-nav", !app);
  $("#tabs").hidden = !app;
  const tab = TAB_OF[r.name] || r.name;
  document.querySelectorAll("[data-tab]").forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  renderStatus();

  const main = $("#view");
  const activeId = document.activeElement && main.contains(document.activeElement) ? document.activeElement.id : null;
  main.innerHTML = viewHtml(r);
  if (activeId) { const el = document.getElementById(activeId); if (el) el.focus(); }
}

window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });

// Filter oben (Art, Map, Zeitraum) gelten für alle Ansichten
document.addEventListener("change", (e) => {
  const key = e.target.dataset ? e.target.dataset.filter : null;
  if (!key) return;
  S.filters[key] = e.target.value;
  saveFilters();
  render();
});

async function boot() {
  document.title = APP_NAME;
  $("#brand-name").textContent = APP_NAME;
  if (isDemo) {
    const { loadDemo } = await import("./demo.js");
    loadDemo();
    S.mode = "demo";
  } else {
    S.mode = isConfigured ? "pending" : "setup";
  }
  render();
}

boot().catch((e) => {
  console.error(e);
  $("#view").innerHTML = errorView(e && e.message);
});
