// Kleine Helfer, die überall gebraucht werden.

export const $ = (sel, el = document) => el.querySelector(sel);

// Text sicher in HTML einsetzen
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Namen vergleichbar machen: Groß/Klein egal, "#Tag" weg, nur Buchstaben und Ziffern (alle Alphabete)
export const norm = (s) => String(s || "").toLowerCase().replace(/#.*$/, "").replace(/[^\p{L}\p{N}]/gu, "");

// IDs entstehen auf dem Gerät (nur a-z0-9), damit Speichern auch offline geht
export const newId = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

// Leere Eingaben werden zu null (zählen nicht in Durchschnitte)
export const num = (v) => (v === null || v === undefined || v === "" || !isFinite(Number(v))) ? null : Number(v);

// Datum immer in Ortszeit als "YYYY-MM-DD" (nicht toISOString: das wäre UTC)
export function isoDate(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
export const today = () => isoDate(new Date());
export function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d); }

// Zahlen deutsch formatieren; "–" wenn kein Wert da ist
const ok = (n) => n !== null && n !== undefined && isFinite(n);
export const fmt0 = (n) => ok(n) ? String(Math.round(n)) : "–";
export const fmt1 = (n) => ok(n) ? n.toFixed(1).replace(".", ",") : "–";
export const fmt2 = (n) => ok(n) ? n.toFixed(2).replace(".", ",") : "–";
export const pct = (n) => ok(n) ? Math.round(n * 100) + " %" : "–";
export const signed1 = (n) => ok(n) ? (n > 0 ? "+" : "") + fmt1(n) : "–";

const WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
export function fmtDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return { day: "–", wd: "", full: "–" };
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  const dd = String(d).padStart(2, "0"), mm = String(m).padStart(2, "0");
  // Das Jahr nur zeigen, wenn es nicht das laufende ist
  const year = y === new Date().getFullYear() ? "" : " " + y;
  return { day: dd + "." + mm + ".", wd: WEEKDAYS[dt.getDay()] + year, full: WEEKDAYS[dt.getDay()] + ", " + dd + "." + mm + "." + y };
}

// Sekunden <-> "m:ss" bzw. "h:mm:ss" (für Clip-Notizen)
export function fmtTime(t) {
  t = Math.max(0, Math.floor(Number(t) || 0));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
}
export function parseTime(str) {
  const parts = String(str || "").trim().split(":").map((x) => Number(x));
  if (!parts.length || parts.some((x) => !isFinite(x) || x < 0)) return null;
  return parts.reduce((acc, x) => acc * 60 + x, 0);
}

// Text in die Zwischenablage legen. Liefert true, wenn es geklappt hat.
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* älterer Browser: Ausweichweg unten */ }
  const ta = document.createElement("textarea");
  ta.value = text; ta.setAttribute("readonly", ""); ta.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (e) { /* bleibt false */ }
  ta.remove();
  return ok;
}

let toastTimer = null;
export function toast(msg) {
  const el = $("#toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 4200);
}
