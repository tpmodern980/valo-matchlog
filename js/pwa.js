// Installierbare App: meldet den Service Worker (sw.js) an und zeigt „Neue Version – neu laden“,
// sobald eine neue Version der App geladen ist und wartet. Neu geladen wird nur auf Knopfdruck,
// damit niemandem ein halb ausgefülltes Formular verloren geht.
import { $ } from "./util.js";

let asked = false;   // "Neu laden" wurde getippt

export function startPwa() {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
  const sw = navigator.serviceWorker;
  // Lief die Seite schon über einen Service Worker? Beim allerersten Besuch nicht: Dann übernimmt er die Seite
  // gleich nach der Installation, das ist aber keine neue Version.
  let hadWorker = Boolean(sw.controller);

  sw.addEventListener("controllerchange", () => {
    if (asked) { location.reload(); return; }
    showVersion();
    // In einem anderen Fenster der App wurde die neue Version gestartet: hier anbieten, nachzuziehen
    if (hadWorker) offer(null);
    hadWorker = true;
  });

  sw.register("sw.js", { updateViaCache: "none" }).then((reg) => {
    showVersion();
    if (reg.waiting && sw.controller) offer(reg.waiting);
    reg.addEventListener("updatefound", () => {
      const next = reg.installing;
      if (!next) return;
      next.addEventListener("statechange", () => {
        // Beim allerersten Besuch gibt es noch keinen controller: Das ist keine "neue Version"
        if (next.state === "installed" && sw.controller) offer(next);
      });
    });
    // Eine installierte App bleibt oft tagelang offen: beim Zurückkommen nachsehen, ob es etwas Neues gibt
    let last = Date.now();
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || Date.now() - last < 60 * 1000) return;
      last = Date.now();
      reg.update().catch(() => {});
    });
  }).catch((e) => console.warn("Service Worker ließ sich nicht anmelden:", e));
}

// Hinweis unten einblenden. waiting = der wartende Service Worker (null: nur neu laden)
function offer(waiting) {
  const box = $("#update");
  box.hidden = false;
  $("#update-go").onclick = () => {
    asked = true;
    $("#update-go").disabled = true;
    if (waiting) waiting.postMessage({ type: "skip" });   // danach kommt "controllerchange" und die Seite lädt neu
    else location.reload();
    // Falls der Wechsel hängt: trotzdem neu laden
    setTimeout(() => location.reload(), 4000);
  };
  $("#update-later").onclick = () => { box.hidden = true; };
}

// Versionsnummer in der Fußzeile (hilft beim Nachsehen, ob ein Gerät schon den neuesten Stand hat)
async function showVersion() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const worker = navigator.serviceWorker.controller || reg.active;
    if (!worker) return;
    const ch = new MessageChannel();
    ch.port1.onmessage = (e) => { $("#app-version").textContent = ` · Version ${e.data}`; };
    worker.postMessage({ type: "version" }, [ch.port2]);
  } catch (e) { /* nur Anzeige */ }
}
