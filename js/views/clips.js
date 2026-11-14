// Clips & Review in der Match-Detailseite (PLAN.md Abschnitt 7): Clips anlegen, ansehen, Notizen mit Zeitstempel.
//
// Wichtig: main.js zeichnet bei jeder Änderung die ganze Seite neu. Ein Player (YouTube-iframe oder <video>),
// der dabei neu eingehängt wird, lädt neu und beginnt von vorn. Deshalb:
//   - Der Bereich "Clips" trägt data-hold. main.js lässt ihn beim Neuzeichnen stehen, solange dieselbe
//     Match-Seite offen bleibt (er wird dabei nie aus der Seite genommen).
//   - syncClips() bringt danach nur die Teile auf Stand, die sich geändert haben (Clip-Liste, Notizen, Formulare).
//   - Den Player selbst (#clip-stage) fasst nur syncStage() an, und nur wenn ein anderer Clip geöffnet wird.
// Verlässt man die Match-Seite, räumt leave() auf: YouTube-Player zerstören, Datei-Adresse freigeben.
//
// Meldungen laufen hier über ein eigenes Feld (nicht msgBox aus views/auth.js): Dessen id gibt es auch im
// Match-Formular, das über dieser Seite liegen kann.
import { S } from "../state.js";
import { $, esc, fmtTime, parseTime, toast } from "../util.js";
import { create, remove, listAdd, listRemove } from "../data.js";
import { errorText } from "../auth.js";

const KIND = { youtube: "YouTube", link: "Link", local: "Lokale Datei" };
const YT_HOSTS = /^(www\.|m\.|music\.)?youtube(-nocookie)?\.com$/;
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
const TIME = /^\d{1,3}(:\d{1,2}){0,2}$/;   // "83", "1:23" oder "1:02:03"

let root = null;        // der Bereich "Clips" in der Seite (bleibt beim Neuzeichnen derselbe Knoten)
let matchId = null;
let sel = null;         // geöffneter Clip
let adding = false;     // Formular "Clip hinzufügen" offen
let addKind = "yt";     // "yt" (YouTube oder anderer Link) | "local"
let askClip = false;    // Rückfrage "Clip entfernen?"
let askNote = null;     // Schlüssel der Notiz mit Rückfrage
let msg = null;         // { at: "add" | "note", kind: "error" | "ok", text }
let stage = null;       // der laufende Player: { sig, clipId, kind, box, yt, video, url, ready }
const files = new Map();   // Clip-ID -> gewählte Videodatei (nur solange diese Match-Seite offen ist)

const clean = (s) => String(s || "").trim().replace(/\s+/g, " ");
const notesOf = (clip) => (Array.isArray(clip.notes) ? clip.notes : []).filter((n) => n && typeof n === "object");
const noteKey = (n) => `${n.at}|${n.t}`;
const nNotes = (n) => `${n} ${n === 1 ? "Notiz" : "Notizen"}`;
// Wer die Notiz geschrieben hat: der Name, sonst der Teil der E-Mail vor dem @
const me = () => (S.user && (S.user.name || String(S.user.email || "").split("@")[0])) || "";

// Was für ein Clip ist das? Ein YouTube-Clip ohne gültige Video-ID wird wie ein einfacher Link behandelt.
function kindOf(clip) {
  if (clip.kind === "local") return "local";
  return clip.kind === "youtube" && YT_ID.test(clip.ytId || "") ? "youtube" : "link";
}
// Nur http und https dürfen in einen Link (nie z. B. "javascript:")
const safeUrl = (url) => /^https?:\/\//i.test(String(url || "")) ? String(url) : "";

function clipsOf() {
  return S.clips.filter((c) => c.matchId === matchId)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || String(a.title).localeCompare(String(b.title), "de"));
}
const current = () => (sel && S.clips.find((c) => c.id === sel && c.matchId === matchId)) || null;

// ---------- Link erkennen ----------

// Liefert { kind: "youtube", ytId, url } oder { kind: "link", ytId: null, url } oder null (kein gültiger Link).
// Erkannt werden youtu.be/<id>, watch?v=<id>, /shorts/<id>, /live/<id> (und /embed/<id>), auch mit Zusätzen
// wie &t=30s oder ?si=…
export function parseLink(input) {
  let text = String(input || "").trim();
  if (!text || /\s/.test(text)) return null;
  if (!/^https?:\/\//i.test(text)) {
    if (text.includes("://")) return null;   // anderes Protokoll
    text = "https://" + text;                // "youtu.be/…" ohne https:// davor
  }
  let u;
  try { u = new URL(text); } catch (e) { return null; }
  if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username || u.password || !u.hostname.includes(".")) return null;
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  let id = null;
  if (host === "youtu.be") id = parts[0];
  else if (YT_HOSTS.test(host)) {
    if (parts[0] === "watch") id = u.searchParams.get("v");
    else if (["shorts", "live", "embed"].includes(parts[0])) id = parts[1];
  }
  if (id && YT_ID.test(id)) return { kind: "youtube", ytId: id, url: "https://www.youtube.com/watch?v=" + id };
  return { kind: "link", ytId: null, url: u.href };
}

// ---------- Gerüst und Teile ----------

// Kommt aus matchView. Der Inhalt der Teile entsteht in syncClips().
export function clipsPanel(m) {
  return `<section class="panel" id="clips" data-hold="clips-${esc(m.id)}" data-match="${esc(m.id)}">
    <div class="panel-head"><h2>Clips &amp; Review</h2><span class="hint" id="clips-count"></span></div>
    <div class="panel-body clips">
      <div class="clips-side"><div class="clip-list" id="clip-list"></div><div id="clip-add"></div><div id="clip-add-msg"></div></div>
      <div class="player">
        <div id="clip-head"></div>
        <div id="clip-stage"></div>
        <div id="clip-noteform"></div>
        <div id="clip-note-msg"></div>
        <div id="clip-notes"></div>
      </div>
    </div></section>`;
}

// Einen Teil nur dann neu schreiben, wenn sich sein Inhalt geändert hat. Eingaben mit data-keep bleiben erhalten.
const drawn = new WeakMap();
function put(id, html) {
  const el = root && root.querySelector("#" + id);
  if (!el || drawn.get(el) === html) return;
  const keep = {};
  el.querySelectorAll("[data-keep][id]").forEach((x) => { keep[x.id] = x.value; });
  const active = document.activeElement && el.contains(document.activeElement) ? document.activeElement.id : null;
  el.innerHTML = html;
  drawn.set(el, html);
  for (const k in keep) { const x = document.getElementById(k); if (x && x.hasAttribute("data-keep")) x.value = keep[k]; }
  if (active) { const x = document.getElementById(active); if (x) x.focus(); }
}

const msgHtml = (at) => msg && msg.at === at ? `<p class="msg ${esc(msg.kind)}" role="alert">${esc(msg.text)}</p>` : "";

function listHtml(list) {
  if (!S.loaded.clips) return '<p class="hint">Lade Clips …</p>';
  return list.map((c) => `<button class="clip-item" type="button" data-action="clip-open" data-id="${esc(c.id)}" aria-pressed="${c.id === sel}">
      <b>${esc(c.title || "Ohne Titel")}</b><small>${KIND[kindOf(c)]} · ${nNotes(notesOf(c).length)}</small></button>`).join("");
}

function addHtml() {
  if (!adding) return '<button class="btn" type="button" data-action="clip-add-open">+ Clip hinzufügen</button>';
  const local = addKind === "local";
  const body = local
    ? `<label class="field"><span>Videodatei (freiwillig)</span><input type="file" id="clip-new-file" accept="video/*" data-change="clip-add-file"></label>
       <p class="hint">Das Video wird nicht hochgeladen. Gespeichert werden nur Titel und Notizen. Zum Ansehen wählt jeder die Datei auf dem eigenen Gerät.</p>`
    : `<label class="field"><span>YouTube-Link</span>
         <input type="url" id="clip-url" name="url" data-keep maxlength="500" inputmode="url" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="https://youtu.be/…"></label>
       <p class="hint" id="clip-url-hint"></p>`;
  return `<form class="add-clip" data-form="clip-add" novalidate>
      <div class="seg" role="group" aria-label="Art des Clips">
        <button type="button" data-action="clip-add-kind" data-kind="yt" aria-pressed="${!local}">YouTube / Link</button>
        <button type="button" data-action="clip-add-kind" data-kind="local" aria-pressed="${local}">Lokale Datei</button>
      </div>
      <label class="field"><span>Titel</span>
        <input type="text" id="clip-title" name="title" data-keep maxlength="80" autocomplete="off" placeholder="z. B. Retake B, Runde 14"></label>
      ${body}
      <div class="actions"><button class="btn primary" type="submit">Clip speichern</button>
        <button class="btn" type="button" data-action="clip-add-cancel">Abbrechen</button></div>
    </form>`;
}

const URL_HINT = {
  empty: "YouTube-Videos (auch Shorts und Livestreams) laufen direkt hier in der Seite. Tipp: bei YouTube als „Nicht gelistet“ hochladen, „Privat“ lässt sich nicht abspielen.",
  youtube: "Erkannt: YouTube-Video. Es läuft direkt hier in der Seite.",
  link: "Kein YouTube-Video erkannt. Der Clip wird als einfacher Link gespeichert und öffnet sich in einem neuen Tab.",
  bad: "Das sieht noch nicht nach einem Link aus.",
};
// Zeigt unter dem Link-Feld, was die App daraus macht
function urlHint() {
  const field = $("#clip-url"), hint = $("#clip-url-hint");
  if (!field || !hint) return;
  const link = field.value.trim() ? parseLink(field.value) : undefined;
  hint.textContent = URL_HINT[link === undefined ? "empty" : link ? link.kind : "bad"];
}

function headHtml(clip, list) {
  if (!clip) {
    if (!S.loaded.clips) return "";
    return `<p class="hint">${list.length
      ? "Wähl einen Clip aus der Liste: Dann kannst du ihn ansehen und Notizen mit Zeitstempel schreiben."
      : "Noch keine Clips zu diesem Match. Über „Clip hinzufügen“ kommt ein YouTube-Link, ein anderer Link oder ein Video von deinem Gerät dazu."}</p>`;
  }
  const n = notesOf(clip).length, title = clip.title || "Ohne Titel";
  if (askClip) {
    return `<div class="confirm"><span>Clip „${esc(title)}“${n ? ` mit ${n === 1 ? "seiner Notiz" : "seinen " + n + " Notizen"}` : ""} entfernen? Er verschwindet für alle aus der App.</span>
      <button class="btn small danger solid" type="button" data-action="clip-remove">Entfernen</button>
      <button class="btn small" type="button" data-action="clip-cancel">Abbrechen</button></div>`;
  }
  return `<div class="clip-head"><div><h3>${esc(title)}</h3><span class="hint">${KIND[kindOf(clip)]}</span></div>
    <button class="btn small danger" type="button" data-action="clip-ask-remove">Clip entfernen</button></div>`;
}

function noteFormHtml(clip) {
  if (!clip) return "";
  const link = kindOf(clip) === "link";
  return `<form class="note-form${link ? " by-hand" : ""}" data-form="clip-note" novalidate>
      ${link ? "" : '<button class="btn now" type="button" data-action="clip-now">Notiz bei aktueller Zeit</button>'}
      <label class="field tfield"><span>Zeit</span>
        <input type="text" id="note-t" name="t" data-keep maxlength="8" autocomplete="off" placeholder="m:ss"></label>
      <label class="field grow"><span>Notiz</span>
        <input type="text" id="note-text" name="text" data-keep maxlength="300" autocomplete="off" placeholder="Was ist hier passiert?"></label>
      <button class="btn primary" type="submit">Speichern</button>
    </form>
    ${link ? '<p class="hint">Bei einem einfachen Link trägst du die Zeit von Hand ein, z. B. 1:23.</p>' : ""}`;
}

function notesHtml(clip) {
  if (!clip) return "";
  const list = notesOf(clip).slice().sort((a, b) => (Number(a.t) || 0) - (Number(b.t) || 0) || (a.at || 0) - (b.at || 0));
  const jump = kindOf(clip) !== "link";
  if (askNote && !list.some((n) => noteKey(n) === askNote)) askNote = null;
  const rows = list.map((n) => {
    const key = esc(noteKey(n)), time = esc(fmtTime(n.t));
    const ts = jump
      ? `<button class="ts" type="button" data-action="clip-seek" data-t="${esc(Number(n.t) || 0)}" title="Im Video zu ${time} springen">${time}</button>`
      : `<span class="ts still">${time}</span>`;
    const tools = askNote === noteKey(n)
      ? `<div class="confirm"><span>Diese Notiz entfernen?</span>
          <button class="btn small danger solid" type="button" data-action="clip-note-remove" data-key="${key}">Entfernen</button>
          <button class="btn small" type="button" data-action="clip-note-cancel">Abbrechen</button></div>`
      : `<button class="alias-x" type="button" data-action="clip-note-ask" data-key="${key}" aria-label="Notiz bei ${time} entfernen" title="Entfernen">×</button>`;
    return `<div class="note">${ts}<p>${esc(n.text)}${n.by ? ` <small>${esc(n.by)}</small>` : ""}</p>${tools}</div>`;
  }).join("");
  return `<h3 class="group">Notizen <span>${list.length}</span></h3>
    ${list.length ? `<div class="notes">${rows}</div>`
      : `<p class="hint">Noch keine Notizen. ${jump ? "Halt das Video an der Stelle an, tipp auf „Notiz bei aktueller Zeit“ und schreib dazu, was dir auffällt." : ""}</p>`}`;
}

// Nach jedem Neuzeichnen (main.js) und nach jeder Änderung hier im Modul: Teile auf Stand bringen.
export function syncClips() {
  const el = document.getElementById("clips");
  if (!el) { if (root) leave(); return; }
  if (el !== root) { leave(); root = el; matchId = el.dataset.match; }

  const list = clipsOf();
  // Der geöffnete Clip ist weg (z. B. von jemand anderem entfernt): schließen
  if (sel && !list.some((c) => c.id === sel)) { sel = null; askClip = false; askNote = null; }
  const clip = current();

  put("clips-count", list.length ? `${list.length} ${list.length === 1 ? "Clip" : "Clips"}` : "");
  put("clip-list", listHtml(list));
  put("clip-add", addHtml());
  put("clip-add-msg", msgHtml("add"));
  put("clip-head", headHtml(clip, list));
  syncStage(clip);
  put("clip-noteform", noteFormHtml(clip));
  put("clip-note-msg", msgHtml("note"));
  put("clip-notes", notesHtml(clip));
  urlHint();
}

// Match-Seite verlassen (oder anderes Match): Player weg, alles zurück auf Anfang
function leave() {
  dropStage();
  files.clear();
  root = null; matchId = null; sel = null;
  adding = false; addKind = "yt"; askClip = false; askNote = null; msg = null;
}

function say(at, kind, text) {
  msg = text ? { at, kind, text } : null;
  syncClips();
}

// Führt eine Änderung aus und zeigt einen Fehler dort an, wo gerade gearbeitet wurde
async function act(at, fn) {
  say(at);
  try { await fn(); }
  catch (e) {
    if (!e.plain) console.warn("Clip-Aktion fehlgeschlagen:", e.code || e.message);
    say(at, "error", errorText(e));
  }
}

function select(id) {
  sel = id;
  askClip = false; askNote = null; msg = null;
  // Angefangene Notiz gehört zum alten Clip
  for (const f of ["note-t", "note-text"]) { const x = $("#" + f); if (x) x.value = ""; }
  syncClips();
}

// ---------- Player ----------

function syncStage(clip) {
  const sig = clip ? [clip.id, kindOf(clip), clip.ytId || "", clip.url || ""].join("|") : "";
  if (stage ? stage.sig === sig : !sig) return;   // derselbe Clip wie bisher: Player nicht anfassen
  dropStage();
  if (!clip) return;
  const st = stage = { sig, clipId: clip.id, kind: kindOf(clip), box: root.querySelector("#clip-stage"), yt: null, video: null, url: null, ready: false };
  if (st.kind === "youtube") mountYt(st, clip);
  else if (st.kind === "local") mountLocal(st);
  else st.box.innerHTML = linkCard(clip);
}

function dropStage() {
  if (!stage) return;
  const st = stage;
  stage = null;
  if (st.yt) { try { st.yt.destroy(); } catch (e) { /* Seite war schon weg */ } }
  if (st.video) { try { st.video.pause(); st.video.removeAttribute("src"); st.video.load(); } catch (e) { /* egal */ } }
  if (st.url) URL.revokeObjectURL(st.url);
  st.box.innerHTML = "";
}

function linkCard(clip) {
  const url = safeUrl(clip.url);
  if (!url) return '<div class="linkcard"><b>Link fehlt</b><p class="hint">Zu diesem Clip ist kein gültiger Link gespeichert.</p></div>';
  return `<div class="linkcard"><b>Externer Link</b><span class="link-url">${esc(url.replace(/^https?:\/\//i, ""))}</span>
    <p class="hint">Dieser Link lässt sich nicht hier in der Seite abspielen. Er öffnet sich in einem neuen Tab.</p>
    <a class="btn" href="${esc(url)}" target="_blank" rel="noopener">Link öffnen ↗</a></div>`;
}

// YouTube: offizielle IFrame-Player-API. Sie wird erst geladen, wenn zum ersten Mal ein YouTube-Clip geöffnet wird.
let ytLoading = null;
function loadYt() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  if (ytLoading) return ytLoading;
  ytLoading = new Promise((resolve, reject) => {
    const fail = () => { ytLoading = null; reject(new Error("YouTube-API nicht geladen")); };
    const before = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (typeof before === "function") before(); resolve(window.YT); };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => { s.remove(); fail(); };
    document.head.appendChild(s);
    setTimeout(fail, 15000);   // z. B. von einem Werbeblocker verschluckt
  });
  return ytLoading;
}

const YT_ERROR = {
  2: "YouTube kennt dieses Video nicht. Stimmt der Link?",
  5: "Dieses Video lässt sich hier nicht abspielen.",
  100: "Das Video gibt es nicht (mehr) oder es ist privat. Tipp: bei YouTube „Nicht gelistet“ statt „Privat“ wählen.",
};
// 101 und 150 meldet YouTube auch bei Videos, die es gar nicht gibt, nicht nur bei gesperrtem Einbetten
YT_ERROR[101] = YT_ERROR[150] = "YouTube spielt dieses Video hier nicht ab: Das Einbetten ist ausgeschaltet, oder es gibt das Video nicht (mehr), oder es ist privat. Probier „Auf YouTube öffnen“.";

function mountYt(st, clip) {
  st.box.innerHTML = `<div class="yt-frame"><div></div></div>
    <div class="stage-foot"><span class="hint" role="status">Lade Player …</span>
      <a href="https://www.youtube.com/watch?v=${esc(clip.ytId)}" target="_blank" rel="noopener">Auf YouTube öffnen ↗</a></div>`;
  const info = (text) => { const el = st.box.querySelector(".stage-foot .hint"); if (el) el.textContent = text; };
  loadYt().then((YT) => {
    if (stage !== st) return;   // inzwischen ein anderer Clip
    st.yt = new YT.Player(st.box.querySelector(".yt-frame div"), {
      host: "https://www.youtube-nocookie.com",
      videoId: clip.ytId,
      width: "100%", height: "100%",
      playerVars: { playsinline: 1, rel: 0 },
      events: {
        onReady: () => { if (stage === st) { st.ready = true; info(""); } },
        onError: (e) => { if (stage === st) info(YT_ERROR[e.data] || "Das Video lässt sich gerade nicht abspielen."); },
      },
    });
  }).catch(() => {
    if (stage === st) info("YouTube ließ sich nicht laden. Prüf deine Verbindung oder öffne das Video direkt bei YouTube.");
  });
}

// Lokale Datei: Das Video bleibt auf dem Gerät, abgespielt wird über eine Object-URL
function mountLocal(st, problem) {
  if (st.url) { URL.revokeObjectURL(st.url); st.url = null; }
  st.video = null; st.ready = false;
  const pick = (label) => `<label class="btn filebtn">${label}<input type="file" accept="video/*" data-change="clip-file"></label>`;
  const file = files.get(st.clipId);
  if (!file) {
    st.box.innerHTML = `<div class="linkcard"><b>Video von deinem Gerät</b>
      ${problem ? `<p class="msg error" role="alert">${esc(problem)}</p>` : ""}
      <p class="hint">Dieses Video liegt nicht in der App. Wähl die Datei auf deinem Gerät aus: Sie wird nur hier abgespielt und nicht hochgeladen. Die Notizen sehen alle im Team.</p>
      ${pick("Videodatei wählen")}</div>`;
    return;
  }
  st.url = URL.createObjectURL(file);
  st.box.innerHTML = `<video controls playsinline preload="metadata"></video>
    <div class="stage-foot"><span class="hint file-name">${esc(file.name)}</span>${pick("Andere Datei wählen")}</div>`;
  const v = st.box.querySelector("video");
  st.video = v;
  v.addEventListener("loadedmetadata", () => { if (stage === st && st.video === v) st.ready = true; });
  v.addEventListener("error", () => {
    if (stage !== st || st.video !== v) return;
    files.delete(st.clipId);
    mountLocal(st, `„${file.name}“ kann dieser Browser nicht abspielen. Am sichersten ist eine MP4-Datei.`);
  });
  v.src = st.url;
}

// Aktuelle Stelle im Video in ganzen Sekunden, oder null, wenn gerade kein Video bereit ist
function nowTime() {
  const st = stage;
  if (!st || !st.ready) return null;
  if (st.yt && typeof st.yt.getCurrentTime === "function") return Math.floor(Number(st.yt.getCurrentTime()) || 0);
  if (st.video) return Math.floor(st.video.currentTime || 0);
  return null;
}

const notReady = () => stage && stage.kind === "local" && !stage.video
  ? "Wähl erst die Videodatei aus." : "Das Video ist noch nicht bereit. Versuch es gleich noch einmal.";

// ---------- Klicks und Formulare ----------

export const actions = {
  // Noch einmal antippen schließt den Clip (und beendet den Player)
  "clip-open": (el) => {
    select(el.dataset.id === sel ? null : el.dataset.id);
    const box = sel && root && root.querySelector(".player");
    if (box) box.scrollIntoView({ block: "nearest" });
  },
  "clip-add-open": () => {
    adding = true; addKind = "yt"; msg = null;
    syncClips();
    if (matchMedia("(pointer: fine)").matches) { const f = $("#clip-title"); if (f) f.focus(); }
  },
  "clip-add-cancel": () => { adding = false; msg = null; syncClips(); },
  "clip-add-kind": (el) => { addKind = el.dataset.kind === "local" ? "local" : "yt"; msg = null; syncClips(); },

  "clip-ask-remove": () => { askClip = true; syncClips(); },
  "clip-cancel": () => { askClip = false; syncClips(); },
  "clip-remove": () => {
    const clip = current();
    if (!clip) return;
    act("note", async () => {
      await remove("clips", clip.id);   // zeichnet neu: Der Clip ist weg, der Player wird beendet
      toast("Clip entfernt.");
    });
  },

  "clip-now": () => {
    const t = nowTime();
    if (t === null) return toast(notReady());
    const tf = $("#note-t"), text = $("#note-text");
    if (tf) tf.value = fmtTime(t);
    if (text) text.focus();
  },
  "clip-seek": (el) => {
    const t = Number(el.dataset.t) || 0, st = stage;
    if (!st || !st.ready) return toast(notReady());
    if (st.yt) { st.yt.seekTo(t, true); st.yt.playVideo(); }
    else if (st.video) { st.video.currentTime = t; const p = st.video.play(); if (p && p.catch) p.catch(() => {}); }
    st.box.scrollIntoView({ block: "nearest" });
  },

  "clip-note-ask": (el) => { askNote = el.dataset.key; syncClips(); },
  "clip-note-cancel": () => { askNote = null; syncClips(); },
  "clip-note-remove": (el) => {
    const clip = current();
    const note = clip && notesOf(clip).find((n) => noteKey(n) === el.dataset.key);
    askNote = null;
    if (!note) return syncClips();
    // arrayRemove: nimmt genau diese eine Notiz heraus, die anderen bleiben unberührt
    act("note", () => listRemove("clips", clip.id, "notes", note));
  },
};

export const changes = {
  // Lokaler Clip: Datei zum Ansehen gewählt
  "clip-file": (el) => {
    const file = el.files && el.files[0];
    if (!file || !stage || stage.kind !== "local") return;
    files.set(stage.clipId, file);
    mountLocal(stage);
  },
  // Formular "Clip hinzufügen": Der Dateiname wird zum Titel, wenn noch keiner dasteht
  "clip-add-file": (el) => {
    const file = el.files && el.files[0], title = $("#clip-title");
    if (file && title && !title.value.trim()) title.value = clean(file.name.replace(/\.[^.]+$/, "")).slice(0, 80);
  },
};

export const forms = {
  "clip-add": (form) => {
    const title = clean(new FormData(form).get("title"));
    let fields, file = null;
    if (addKind === "local") {
      const input = form.querySelector("#clip-new-file");
      file = (input && input.files && input.files[0]) || null;
      fields = { kind: "local", url: null, ytId: null };
    } else {
      const raw = String(new FormData(form).get("url") || "").trim();
      if (!raw) return say("add", "error", "Bitte füg den Link zum Video ein. Für ein Video auf deinem Gerät wähl oben „Lokale Datei“.");
      const link = parseLink(raw);
      if (!link) return say("add", "error", "Das ist kein gültiger Link. Kopier ihn am besten direkt aus YouTube („Teilen“).");
      fields = link;
    }
    if (!title) return say("add", "error", "Bitte gib dem Clip einen Titel.");
    const match = matchId;
    act("add", async () => {
      const id = await create("clips", { matchId: match, title, ...fields, notes: [] });
      if (match !== matchId) return;   // inzwischen woanders
      if (file) files.set(id, file);
      adding = false;
      select(id);
      toast(fields.kind === "youtube" ? "YouTube-Clip gespeichert." : fields.kind === "link" ? "Clip als Link gespeichert." : "Clip gespeichert.");
    });
  },

  "clip-note": (form) => {
    const clip = current();
    if (!clip) return;
    const data = new FormData(form);
    const text = clean(data.get("text")), rawT = String(data.get("t") || "").trim();
    let t;
    if (rawT) {
      t = TIME.test(rawT) ? parseTime(rawT) : null;
      if (t === null) return say("note", "error", "Schreib die Zeit bitte als Minuten:Sekunden, z. B. 1:23.");
    } else {
      // Kein Zeitstempel eingetragen: die Stelle nehmen, an der das Video gerade steht
      t = nowTime();
      if (t === null) return say("note", "error", kindOf(clip) === "link"
        ? "Bitte trag eine Zeit ein, z. B. 1:23."
        : "Bitte trag eine Zeit ein (z. B. 1:23) oder tipp bei laufendem Video auf „Notiz bei aktueller Zeit“.");
    }
    if (!text) return say("note", "error", "Bitte schreib einen Text zur Notiz.");
    act("note", async () => {
      // arrayUnion: hängt nur diese Notiz an. "at" ist die Uhr des Geräts (ein Server-Zeitstempel geht in Listen nicht).
      await listAdd("clips", clip.id, "notes", { t, text, by: me(), at: Date.now() });
      for (const f of ["note-t", "note-text"]) { const x = $("#" + f); if (x) x.value = ""; }
    });
  },
};

document.addEventListener("input", (e) => {
  const id = e.target && e.target.id;
  if (id === "clip-url") urlHint();
  // Wer einfach lostippt, bekommt die Stelle festgehalten, an der das Video beim ersten Buchstaben stand
  else if (id === "note-text") {
    const tf = $("#note-t");
    if (tf && !tf.value.trim() && e.target.value) { const t = nowTime(); if (t !== null) tf.value = fmtTime(t); }
  }
});
