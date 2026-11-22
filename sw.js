// Service Worker von ScrimStar: hält die App-Dateien auf dem Gerät (schneller Start, läuft auch ohne Netz)
// und sorgt dafür, dass die App eine neue Version meldet („Neue Version – neu laden“, siehe js/pwa.js).
//
// WICHTIG bei jeder Änderung an der App (HTML, CSS, JS, Icons, Schriften, firebase-config.js):
//   VERSION unten erhöhen (Datum von heute, am selben Tag .2, .3 …). Nur dann merken installierte Apps,
//   dass es etwas Neues gibt. Ohne neue VERSION behalten sie ihre alten Dateien.
// Neue Datei in der App? Zusätzlich in APP_FILES eintragen (sonst kommt sie erst beim ersten Gebrauch in den Speicher).
//
// Nicht angefasst wird alles, was nicht zur App gehört: Firestore, Anmeldung (Firebase, Google), KI (AI Logic),
// App Check, reCAPTCHA / Fraud Defense, YouTube und blob:-Adressen (Downloads, lokale Videos) laufen direkt ins Netz.
// Die Google-Anmeldung kommt mit dem Ausweis hinter dem # zurück: Der Teil hinter dem # erreicht den Service Worker nie,
// die Seite liest ihn selbst (js/auth.js).

const VERSION = "2026-11-22.22";
const FIREBASE_VERSION = "13.2.0";   // muss zu FIREBASE_VERSION in js/config.js passen

const APP_FILES = [
  "./",
  "manifest.webmanifest",
  "firebase-config.js",
  "css/app.css",
  "js/access.js", "js/agentrefs.js", "js/analysis.js", "js/auth.js", "js/backup.js", "js/charts.js", "js/config.js", "js/constants.js", "js/data.js", "js/demo.js", "js/discord.js",
  "js/firebase.js", "js/goals.js", "js/main.js", "js/pwa.js", "js/recap.js", "js/review.js", "js/router.js", "js/scan.js", "js/state.js", "js/stats.js", "js/strats.js",
  "js/team.js", "js/util.js",
  "js/views/analysis.js", "js/views/auth.js", "js/views/clips.js", "js/views/goals.js", "js/views/home.js", "js/views/install.js", "js/views/mappool.js", "js/views/maps.js", "js/views/match.js", "js/views/matches.js", "js/views/opprating.js",
  "js/views/matchform.js", "js/views/opponents.js", "js/views/parts.js", "js/views/plan.js", "js/views/player.js", "js/views/players.js", "js/views/profile.js",
  "js/views/setup.js", "js/views/strats.js", "js/views/team.js", "js/views/veto.js",
  "fonts/barlow-400-latin.woff2", "fonts/barlow-400-latin-ext.woff2",
  "fonts/barlow-600-latin.woff2", "fonts/barlow-600-latin-ext.woff2",
  "fonts/barlow-700-latin.woff2", "fonts/barlow-700-latin-ext.woff2",
  "fonts/chakra-petch-600-latin.woff2", "fonts/chakra-petch-600-latin-ext.woff2",
  "fonts/chakra-petch-700-latin.woff2", "fonts/chakra-petch-700-latin-ext.woff2",
  "icons/logo.svg", "icons/favicon-32.png", "icons/apple-touch-icon.png",
  "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png",
];

// Firebase-SDK vom gstatic-CDN. Diese drei braucht jeder Start, sie kommen gleich beim Installieren in den Speicher.
// firebase-ai.js und firebase-app-check.js (Screenshot-Auslesen) kommen beim ersten Gebrauch dazu.
const SDK_BASE = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/`;
const SDK_FIRST = ["firebase-app.js", "firebase-auth.js", "firebase-firestore.js"];

const APP_CACHE = "scrimstar-app-" + VERSION;
const SDK_CACHE = "scrimstar-firebase-" + FIREBASE_VERSION;
const SCOPE = new URL("./", self.location.href).href;   // z. B. https://tpmodern980.github.io/valo-matchlog/
const SHELL = SCOPE;                                      // unter dieser Adresse liegt index.html im Speicher

// Am eigenen Rechner (Test-Server) immer zuerst die frischen Dateien holen, damit Änderungen sofort zu sehen sind.
// Der Speicher springt dort nur ein, wenn der Server nicht läuft.
const LOCAL = ["localhost", "127.0.0.1", "[::1]"].includes(self.location.hostname);

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await Promise.all(APP_FILES.map(async (path) => {
      const url = new URL(path, SCOPE).href;
      // ?v=… und cache: "reload": an jedem Zwischenspeicher vorbei (GitHub Pages hält Dateien ~10 Minuten)
      const res = await fetch(url + "?v=" + encodeURIComponent(VERSION), { cache: "reload" });
      if (!res.ok) throw new Error(`${path}: ${res.status}`);
      await cache.put(url, res);
    }));
    // Das SDK ist nicht Pflicht für die Installation: klappt es jetzt nicht, kommt es beim nächsten Start
    const sdk = await caches.open(SDK_CACHE);
    await Promise.all(SDK_FIRST.map(async (file) => {
      try {
        if (await sdk.match(SDK_BASE + file)) return;
        const res = await fetch(SDK_BASE + file);
        if (res.ok) await sdk.put(SDK_BASE + file, res);
      } catch (e) { /* später */ }
    }));
  })());
  // Kein skipWaiting hier: Eine neue Version wartet, bis jemand „Neu laden“ tippt oder die App ganz geschlossen war.
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const old = (await caches.keys()).filter((k) =>
      (k.startsWith("scrimstar-app-") && k !== APP_CACHE) || (k.startsWith("scrimstar-firebase-") && k !== SDK_CACHE));
    await Promise.all(old.map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const type = event.data && event.data.type;
  if (type === "skip") self.skipWaiting();
  if (type === "version" && event.ports[0]) event.ports[0].postMessage(VERSION);
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.headers.has("range")) return;
  const url = new URL(req.url);

  if (url.href.startsWith(SDK_BASE)) { event.respondWith(sdkFile(req)); return; }
  // Alles außerhalb der App: nicht anfassen (siehe oben)
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;

  if (req.mode === "navigate") {
    const plain = url.origin + url.pathname;
    // Nur die App selbst (mit oder ohne ?demo=…). Andere Seiten im Ordner (z. B. tools/icons.html) laufen normal.
    if (plain === SCOPE || plain === SCOPE + "index.html") event.respondWith(page(req));
    return;
  }
  if (url.search) return;   // Adressen mit ?… gehören nicht zur App (z. B. Testaufrufe)
  event.respondWith(appFile(req, url.href));
});

async function page(req) {
  const cache = await caches.open(APP_CACHE);
  if (LOCAL) {
    try {
      const res = await fetch(req);
      if (res.ok) await cache.put(SHELL, res.clone());
      return res;
    } catch (e) {
      return (await cache.match(SHELL)) || Response.error();
    }
  }
  return (await cache.match(SHELL)) || fetch(req);
}

async function appFile(req, key) {
  const cache = await caches.open(APP_CACHE);
  if (!LOCAL) {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  try {
    const res = await fetch(new Request(req, { cache: "no-cache" }));
    if (res.ok && res.type === "basic") await cache.put(key, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(key);
    if (hit) return hit;
    throw e;
  }
}

// Die SDK-Adressen enthalten die Version, ihr Inhalt ändert sich nie: aus dem Speicher, sonst einmal holen.
async function sdkFile(req) {
  const cache = await caches.open(SDK_CACHE);
  const hit = await cache.match(req.url);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) await cache.put(req.url, res.clone());
  return res;
}
