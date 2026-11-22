// Hinweis "Als App installieren" (Wunsch Tim, 22.11.2026): auf der Startseite für alle, die ScrimStar noch im
// Browser nutzen. Einmal wegklickbar ("Nicht mehr zeigen" merkt sich das Gerät, "Später" nur bis zum Neuladen).
// Wo der Browser es anbietet (Chrome/Edge, Android), installiert der Knopf direkt; sonst steht die Anleitung da.
import { changed } from "../state.js";

let deferred = null;     // beforeinstallprompt-Ereignis (Chrome, Edge, Android)
let later = false;
const KEY = "valo-install-hint";

window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e; changed(); });
window.addEventListener("appinstalled", () => { deferred = null; try { localStorage.setItem(KEY, "no"); } catch (e) { /* egal */ } changed(); });

const standalone = () => window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const ua = navigator.userAgent || "";
const isIos = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);

export function installHint() {
  if (standalone() || later) return "";
  try { if (localStorage.getItem(KEY) === "no") return ""; } catch (e) { /* zeigen */ }
  let how;
  if (deferred) how = '<button class="btn primary small" type="button" data-action="install-now">Jetzt installieren</button>';
  else if (isIos) how = "<span>In Safari unten auf <b>Teilen</b> (Quadrat mit Pfeil nach oben) tippen, dann <b>„Zum Home-Bildschirm“</b>. Geht nur in Safari, nicht in Chrome.</span>";
  else if (isAndroid) how = "<span>Im Browser-Menü <b>⋮</b> oben rechts auf <b>„App installieren“</b> oder <b>„Zum Startbildschirm hinzufügen“</b> tippen.</span>";
  else how = "<span>In der Adressleiste rechts auf das <b>Installieren-Symbol</b> klicken (Chrome/Edge) oder im Menü <b>„App installieren“</b> wählen.</span>";
  return `<section class="panel inst"><div class="panel-body inst-body">
    <div class="inst-text"><b class="inst-title">ScrimStar als App installieren</b><small>Startet wie eine richtige App vom Home-Bildschirm, im Vollbild und schneller.</small>${how}</div>
    <div class="inst-btns"><button class="btn small ghost" type="button" data-action="install-later">Später</button>
      <button class="btn small ghost" type="button" data-action="install-never">Nicht mehr zeigen</button></div>
  </div></section>`;
}

export const actions = {
  "install-now": async () => {
    if (!deferred) return;
    const e = deferred; deferred = null;
    try { await e.prompt(); await e.userChoice; } catch (err) { /* abgebrochen */ }
    changed();
  },
  "install-later": () => { later = true; changed(); },
  "install-never": () => { try { localStorage.setItem(KEY, "no"); } catch (e) { /* egal */ } changed(); },
};
