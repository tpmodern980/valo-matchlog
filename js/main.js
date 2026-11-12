// Start der App: entscheidet, welche Seite gezeigt wird, und rendert bei jeder Änderung neu.
import { APP_NAME, isConfigured, isDemo, demoPage } from "./config.js";
import { S, saveFilters, onChange } from "./state.js";
import { $, esc } from "./util.js";
import { route, TAB_OF } from "./router.js";
import { startAuth, errorText } from "./auth.js";
import { matchesView } from "./views/matches.js";
import { matchView } from "./views/match.js";
import { soonView } from "./views/parts.js";
import { setupView, errorView } from "./views/setup.js";
import * as authPages from "./views/auth.js";
import * as teamPages from "./views/team.js";

// Darf der Nutzer die eigentliche App sehen? Nur angemeldet und freigeschaltet (oder in der Vorschau).
const inApp = () => S.mode === "app";

// Seiten vor der eigentlichen App
const GATES = {
  boot: () => '<p class="loading">Lädt …</p>',
  setup: setupView,
  login: authPages.loginView,
  verify: authPages.verifyView,
  checking: authPages.checkingView,
  offline: authPages.offlineView,
  blocked: authPages.blockedView,
  "team-setup": teamPages.teamSetupView,
  error: authPages.problemView,
};

function viewHtml(r) {
  if (!inApp()) return (GATES[S.mode] || GATES.boot)();
  switch (r.name) {
    case "match": return matchView(r.id);
    case "players": return soonView("Statistik", "Spieler", "Tabelle aller Spieler mit ACS, K/D, KPR und Diagrammen. Stammspieler oben, Subs in einem eigenen Block. Dazu das Roster.", "5");
    case "player": return soonView("Statistik", "Spieler-Detail", "Kennzahlen, Verlauf von ACS und K/D, ACS nach Map, Agents und Match-Historie.", "5");
    case "maps": return soonView("Statistik", "Maps", "Bilanz und Winrate pro Map, Angriff und Verteidigung getrennt, Pistol-Quote.", "5");
    case "opponents":
    case "opponent": return soonView("Statistik", "Gegner", "Bilanz, Winrate und alle Matches pro Gegner.", "5");
    case "team": return teamPages.teamView();
    default: return matchesView();
  }
}

function renderStatus() {
  const bits = [];
  if (S.demo) {
    bits.push(`<span class="chip warn" title="Erfundene Beispieldaten, nichts wird gespeichert">Vorschau · <a href="${esc(location.pathname)}">beenden</a></span>`);
  } else if (S.user) {
    bits.push(`<span class="chip user" title="Angemeldet als ${esc(S.user.email)}">${esc(S.user.email)}</span>`);
    bits.push('<button class="btn small ghost" type="button" data-action="logout">Abmelden</button>');
  }
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
  // Eingaben mit data-keep überleben das Neuzeichnen (z. B. die E-Mail beim Wechsel zu "Neues Konto")
  const kept = {};
  main.querySelectorAll("[data-keep][id]").forEach((el) => { kept[el.id] = el.value; });
  main.innerHTML = viewHtml(r);
  for (const id in kept) { const el = document.getElementById(id); if (el && el.hasAttribute("data-keep")) el.value = kept[id]; }
  if (activeId) { const el = document.getElementById(activeId); if (el) el.focus(); }
}

onChange(render);
window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });

// Filter oben (Art, Map, Zeitraum) gelten für alle Ansichten
document.addEventListener("change", (e) => {
  const key = e.target.dataset ? e.target.dataset.filter : null;
  if (!key) return;
  S.filters[key] = e.target.value;
  saveFilters();
  render();
});

// Knöpfe mit data-action und Formulare mit data-form: Die Ansichten bringen ihre Funktionen dafür mit.
const ACTIONS = { ...authPages.actions, ...teamPages.actions };
const FORMS = { ...authPages.forms, ...teamPages.forms };

document.addEventListener("click", (e) => {
  const el = e.target.closest ? e.target.closest("[data-action]") : null;
  const fn = el && ACTIONS[el.dataset.action];
  if (!fn) return;
  e.preventDefault();
  fn(el);
});

document.addEventListener("submit", (e) => {
  const fn = e.target.dataset ? FORMS[e.target.dataset.form] : null;
  if (!fn) return;
  e.preventDefault();
  fn(e.target);
});

async function boot() {
  document.title = APP_NAME;
  $("#brand-name").textContent = APP_NAME;
  if (isDemo) {
    // Vorschau: Beispieldaten, Firebase wird gar nicht erst geladen
    const { loadDemo } = await import("./demo.js");
    loadDemo();
    S.mode = Object.hasOwn(GATES, demoPage) ? demoPage : "app";
    render();
  } else if (!isConfigured) {
    S.mode = "setup";
    render();
  } else {
    // Ab hier meldet sich die Anmeldung selbst und zeichnet neu (siehe auth.js)
    await startAuth();
  }
}

boot().catch((e) => {
  console.error(e);
  // Meist: Firebase ließ sich nicht laden (keine Verbindung)
  const text = errorText(e);
  if (S.mode === "boot" && isConfigured && !isDemo) { S.error = text; S.mode = "error"; render(); }
  else $("#view").innerHTML = errorView(e && e.message);
});
