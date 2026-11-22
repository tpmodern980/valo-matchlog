// Wochenziele im Tab "Planung" (Logik und Speicherformat: js/goals.js). Alle im Team dürfen Ziele anlegen,
// ändern, abhaken und löschen (Entscheidung Tim, 22.11.2026).
import { S, changed } from "../state.js";
import { TYPES, MAPS } from "../constants.js";
import { esc, isoDate, toast, pct, daysAgo } from "../util.js";
import { upsertPath } from "../data.js";
import { errorText } from "../auth.js";
import { METRICS, OPS, goalsOf, goalsDoc, goalsDocId, goalTitle, goalStatus, cleanMap, suggestGoals } from "../goals.js";
import { postGoals, planHookOn } from "../discord.js";

let formFor = null;     // Woche (Montag), für die das Formular "Ziel hinzufügen" offen ist
let formKind = "stat";  // "stat" | "free"
let editGoal = null;    // ID des Ziels, das gerade bearbeitet wird
let busy = false;
window.addEventListener("hashchange", () => { formFor = null; editGoal = null; });

const fail = (e) => toast(e && e.plain ? e.message : (errorText(e) || "Das hat nicht geklappt."));
const who = () => (S.user && (S.user.name || (S.user.email || "").split("@")[0])) || "";
const prevMonday = (start) => { const [y, m, d] = start.split("-").map(Number); return isoDate(new Date(y, m - 1, d - 7)); };
const save = (start, g) => upsertPath("weeks", goalsDocId(start), ["goals", g.id], g, { kind: "goals", week: start });

const STATE_CLS = { done: "good", track: "good", miss: "bad", behind: "warn", open: "", nodata: "" };

function goalRow(g, start, today) {
  const s = goalStatus(g, start, today);
  const bar = g.kind === "stat"
    ? `<div class="gl-bar" aria-hidden="true"><i style="width:${Math.round((s.progress || 0) * 100)}%"></i>${s.mark !== undefined ? `<b style="left:${Math.round(s.mark * 100)}%"></b>` : ""}</div>` : "";
  const value = g.kind === "stat" ? `<small>${s.value ? `Stand: ${esc(s.value.text)}` : esc(METRICS[g.metric] ? METRICS[g.metric].hint : "")}</small>` : "";
  const check = g.kind === "free"
    ? `<button type="button" class="gl-check${g.done ? " on" : ""}" data-action="goal-toggle" data-start="${start}" data-id="${esc(g.id)}" aria-pressed="${Boolean(g.done)}" aria-label="${esc(goalTitle(g))}: ${g.done ? "erledigt" : "offen"}">${g.done ? "✓" : ""}</button>`
    : '<span class="gl-auto" title="Prüft die App selbst">auto</span>';
  return `<div class="gl-row">
    ${check}
    <div class="gl-main"><b>${esc(goalTitle(g))}</b>${value}${bar}</div>
    <span class="gl-state ${STATE_CLS[s.state] || ""}">${esc(s.label)}</span>
    <span class="gl-tools">
      <button type="button" class="linkish" data-action="goal-edit" data-start="${start}" data-id="${esc(g.id)}">Ändern</button>
      <button type="button" class="alias-x" data-action="goal-delete" data-start="${start}" data-id="${esc(g.id)}" aria-label="Ziel löschen" title="Ziel löschen">×</button>
    </span>
  </div>`;
}

// Baukasten für Statistik-Ziele: wer, was, mindestens/höchstens, Wert, Map, Art (Wunsch Tim, 22.11.2026)
function statFields(g, maps) {
  const groups = [...new Set(Object.values(METRICS).map((m) => m.group))];
  const metric = g ? g.metric : "pistol";
  const players = S.players.filter((p) => p.status !== "ex" && p.status !== "staff").slice().sort((a, b) => (a.status === "sub") - (b.status === "sub") || a.name.localeCompare(b.name, "de"));
  return `<label class="field"><span>Wer</span><select name="player">${opt("", "Ganzes Team", g ? g.player : "")}${players.map((p) => opt(p.id, p.name + (p.status === "sub" ? " (Sub)" : ""), g ? g.player : "")).join("")}</select></label>
    <label class="field wide2"><span>Was</span><select name="metric">${groups.map((gr) => `<optgroup label="${esc(gr)}">${Object.entries(METRICS).filter(([, m]) => m.group === gr).map(([k, m]) => opt(k, m.label, metric)).join("")}</optgroup>`).join("")}</select></label>
    <label class="field"><span>Vergleich</span><select name="op">${Object.entries(OPS).map(([k, t]) => opt(k, t, g ? g.op || ">=" : ">=")).join("")}</select></label>
    <label class="field"><span>Wert</span><input type="text" name="target" inputmode="decimal" maxlength="6" required value="${esc(g ? String(g.target).replace(".", ",") : "60")}" placeholder="60" autocomplete="off"></label>
    <label class="field"><span>Map</span><select name="map">${opt("", "alle", g ? g.map : "")}${maps.map((m) => opt(m, m, g ? g.map : "")).join("")}</select></label>
    <label class="field"><span>Art</span><select name="type">${opt("", "alle", g ? g.type : "")}${TYPES.map((t) => opt(t, t, g ? g.type : "")).join("")}</select></label>
    <p class="hint wide">Prozent als Zahl (60 = 60 %), K/D und Co. mit Komma (1,1). Mit einem Spieler zählen nur Matches, in denen er dabei war. Bei Deaths passt meist „höchstens“.</p>
    ${g ? "" : `<p class="hint wide gl-free-hint">Nicht dabei, was ihr messen wollt (z. B. Lineups, Comms, VODs)? Die App kennt nur, was in den Matches eingetragen ist. Dann <button type="button" class="linkish" data-action="goal-kind" data-kind="free">als freies Ziel anlegen</button> und selbst abhaken.</p>`}`;
}

const opt = (v, label, cur) => `<option value="${esc(v)}"${String(v) === String(cur ?? "") ? " selected" : ""}>${esc(label)}</option>`;

function goalForm(start, g = null) {
  const kind = g ? g.kind : formKind;
  const seg = g ? "" : `<div class="seg" role="group" aria-label="Art des Ziels">
      <button type="button" data-action="goal-kind" data-kind="stat" aria-pressed="${kind === "stat"}">Statistik (prüft die App)</button>
      <button type="button" data-action="goal-kind" data-kind="free" aria-pressed="${kind === "free"}">Frei (zum Abhaken)</button></div>`;
  const maps = [...new Set([...MAPS, ...S.matches.map((m) => cleanMap(m.map)).filter(Boolean)])].sort((a, b) => a.localeCompare(b, "de"));
  const fields = kind === "free"
    ? `<label class="field wide"><span>Ziel</span><input type="text" name="text" maxlength="100" required value="${esc(g ? g.text : "")}" placeholder="z. B. Retakes auf B üben" autocomplete="off"></label>`
    : statFields(g, maps);
  // Vorschläge aus den Schwächen der letzten 30 Tage: antippen = Ziel sofort anlegen
  const tips = !g && kind === "stat" ? suggestGoals(start, daysAgo(30)) : [];
  const tipBox = !g && kind === "stat"
    ? `<div class="gl-tips"><span>Vorschläge aus den letzten 30 Tagen (antippen = Ziel anlegen)</span>${tips.length
      ? `<div class="gl-tip-list">${tips.map((t) => `<button type="button" class="gl-tip" data-action="goal-suggest" data-start="${start}" data-metric="${t.metric}" data-target="${t.target}"><b>${esc(METRICS[t.metric].label)} mindestens ${t.target} %</b><small>jetzt ${pct(t.now)}</small></button>`).join("")}</div>`
      : '<small class="hint">Gerade keine klare Schwäche (oder noch zu wenige Matches mit Rundenverlauf).</small>'}</div>` : "";
  return `<form class="gl-form" data-form="goal-save" data-start="${start}" data-id="${esc(g ? g.id : "")}" data-kind="${kind}">
    ${seg}${tipBox}<div class="gl-fields">${fields}</div>
    <div class="actions"><button class="btn primary" type="submit"${busy ? " disabled" : ""}>${g ? "Speichern" : "Ziel hinzufügen"}</button>
      <button class="btn" type="button" data-action="goal-cancel">Abbrechen</button></div></form>`;
}

// Panel für eine Woche (start = Montag)
export function goalsPanel(start) {
  if (!S.loaded.weeks) return "";
  const today = isoDate(new Date());
  const goals = goalsOf(start);
  const rows = goals.map((g) => (editGoal === g.id ? `<div class="gl-row gl-editing">${goalForm(start, g)}</div>` : goalRow(g, start, today))).join("");
  const prev = goalsOf(prevMonday(start));
  const [y, m, d] = start.split("-").map(Number);
  const over = isoDate(new Date(y, m - 1, d + 6)) < today;   // Woche liegt komplett zurück
  const add = formFor === start && !editGoal
    ? goalForm(start)
    : `<div class="actions"><button class="btn small" type="button" data-action="goal-new" data-start="${start}">+ Ziel</button>${!goals.length && prev.length ? `<button class="btn small ghost" type="button" data-action="goal-copy" data-start="${start}"${busy ? " disabled" : ""}>Ziele der Vorwoche übernehmen (${prev.length})</button>` : ""}${goals.length && planHookOn() ? `<button class="btn small" type="button" data-action="goal-post" data-start="${start}"${busy ? " disabled" : ""}>Ziele in Discord posten</button>` : ""}</div>`;
  const doc = goalsDoc(start);
  const posted = doc && doc.postedAt ? `<p class="hint">Zuletzt in Discord gepostet: ${esc(new Date(doc.postedAt).toLocaleString("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }))}${doc.postedBy ? ` von ${esc(doc.postedBy)}` : ""}.</p>` : "";
  const reached = goals.filter((g) => ["done", "track"].includes(goalStatus(g, start, today).state)).length;
  return `<section class="panel gl"><div class="panel-head"><h2>Wochenziele</h2><span class="hint">${goals.length ? `${reached} von ${goals.length} ${over ? "erreicht" : "erreicht oder auf Kurs"}` : "alle können Ziele anlegen"}</span></div>
    <div class="panel-body">
      ${rows ? `<div class="gl-list">${rows}</div>` : '<p class="hint">Noch keine Ziele für diese Woche. Statistik-Ziele (z. B. „Pistol-Quote mindestens 60 %“) prüft die App selbst aus den Matches der Woche, freie Ziele hakt ihr ab.</p>'}
      ${add}${formFor === start || editGoal ? "" : posted}
      ${goals.length && !planHookOn() && !formFor && !editGoal ? '<p class="hint">Zum Posten in Discord trägt ein Admin im Tab „Team“ den Planungs-Kanal ein.</p>' : ""}
    </div></section>`;
}

export const actions = {
  "goal-new": (el) => { formFor = el.dataset.start; editGoal = null; changed(); },
  "goal-kind": (el) => { formKind = el.dataset.kind === "free" ? "free" : "stat"; changed(); },
  "goal-cancel": () => { formFor = null; editGoal = null; changed(); },
  "goal-edit": (el) => { editGoal = el.dataset.id; formFor = null; changed(); },
  "goal-toggle": async (el) => {
    const start = el.dataset.start, g = goalsOf(start).find((x) => x.id === el.dataset.id);
    if (!g) return;
    try { await save(start, { ...g, done: !g.done, doneBy: !g.done ? who() : null }); } catch (e) { fail(e); }
  },
  "goal-delete": async (el) => {
    const start = el.dataset.start, g = goalsOf(start).find((x) => x.id === el.dataset.id);
    if (!g) return;
    if (!el.dataset.sure) {
      el.dataset.sure = "1"; el.textContent = "Löschen?"; el.classList.add("sure");
      setTimeout(() => { if (el.isConnected) changed(); }, 4000);
      return;
    }
    try { await save(start, { ...g, deleted: true }); toast("Ziel gelöscht."); } catch (e) { fail(e); }
  },
  // Vorschlag antippen: Team-Ziel "mindestens" sofort anlegen
  "goal-suggest": async (el) => {
    const start = el.dataset.start, metric = el.dataset.metric, target = Number(el.dataset.target);
    if (busy || !METRICS[metric] || !isFinite(target)) return;
    busy = true;
    try {
      const id = "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      await save(start, { id, kind: "stat", metric, op: ">=", target, player: "", map: "", type: "", text: "", done: false, doneBy: null, by: who(), at: Date.now(), deleted: false });
      formFor = null;
      toast("Ziel hinzugefügt.");
    } catch (e) { fail(e); }
    finally { busy = false; changed(); }
  },
  // Ziele einzeln in den Discord-Planungs-Kanal posten (alle dürfen, wie beim Anlegen der Ziele)
  "goal-post": async (el) => {
    const start = el.dataset.start;
    if (busy || !goalsOf(start).length) return;
    busy = true; changed();
    try {
      await postGoals(start);
      await upsertPath("weeks", goalsDocId(start), ["postedAt"], Date.now(), { kind: "goals", week: start });
      await upsertPath("weeks", goalsDocId(start), ["postedBy"], who(), { kind: "goals", week: start });
      toast(S.demo ? "Vorschau: Die Ziele würden jetzt in Discord gepostet." : "Wochenziele in Discord gepostet.");
    } catch (e) { fail(e); }
    finally { busy = false; changed(); }
  },
  "goal-copy": async (el) => {
    const start = el.dataset.start, prev = goalsOf(prevMonday(start));
    if (!prev.length || busy) return;
    busy = true; changed();
    try {
      for (const [i, g] of prev.entries()) {
        const id = "g" + Date.now().toString(36) + i + Math.random().toString(36).slice(2, 5);
        await save(start, { ...g, id, done: false, doneBy: null, by: who(), at: Date.now() + i });
      }
      toast(`${prev.length} ${prev.length === 1 ? "Ziel" : "Ziele"} übernommen.`);
    } catch (e) { fail(e); }
    finally { busy = false; changed(); }
  },
};

export const forms = {
  "goal-save": async (form) => {
    if (busy) return;
    const start = form.dataset.start, data = new FormData(form), kind = form.dataset.kind === "free" ? "free" : "stat";
    const old = form.dataset.id ? goalsOf(start).find((x) => x.id === form.dataset.id) : null;
    let g;
    if (kind === "free") {
      const text = String(data.get("text") || "").trim().slice(0, 100);
      if (!text) return toast("Bitte das Ziel eintragen.");
      g = { kind, text, metric: null, op: null, target: null, player: "", map: "", type: "" };
    } else {
      const metric = String(data.get("metric")), m = METRICS[metric];
      if (!m) return;
      const raw = String(data.get("target") || "").replace(",", ".").replace("%", "").trim();
      const target = raw === "" ? NaN : Number(raw);
      if (!isFinite(target)) return toast("Bitte eine Zahl eintragen, z. B. 60 oder 1,1.");
      if (m.unit === "%" && (target < 0 || target > 100)) return toast("Prozent-Ziele bitte zwischen 0 und 100.");
      if (metric === "diff" && Math.abs(target) > 13) return toast("Die Rundendifferenz liegt zwischen -13 und 13.");
      if (metric !== "diff" && (target < 0 || target > 999)) return toast("Bitte eine Zahl zwischen 0 und 999.");
      if (m.unit === "int" && !Number.isInteger(target)) return toast(`Bei „${m.label}“ bitte eine ganze Zahl.`);
      const type = String(data.get("type") || ""), player = String(data.get("player") || "");
      g = {
        kind, metric, op: data.get("op") === "<=" ? "<=" : ">=", target: Math.round(target * 100) / 100,
        player: S.players.some((p) => p.id === player) ? player : "",
        map: cleanMap(String(data.get("map") || "")), type: TYPES.includes(type) ? type : "", text: "",
      };
    }
    const id = old ? old.id : "g" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    busy = true;
    try {
      await save(start, { ...(old || { done: false, doneBy: null, by: who(), at: Date.now() }), ...g, id, deleted: false });
      formFor = null; editGoal = null;
      toast(old ? "Ziel gespeichert." : "Ziel hinzugefügt.");
    } catch (e) { fail(e); }
    finally { busy = false; changed(); }
  },
};
