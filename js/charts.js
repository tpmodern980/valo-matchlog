// Diagramme ohne Bibliothek (Regeln: PLAN.md Abschnitt 8).
// lineChart und barChart liefern HTML als Text, wie die Ansichten. Die Tooltips hängen einmal am Dokument
// (unten), damit sie das Neuzeichnen der Seite überleben.
// Aufbau: Linien und Gitter als SVG, das sich in der Breite dehnt (Strichstärke bleibt gleich),
// Punkte, Achsen-Texte und Balken als HTML. So bleibt alles bei jeder Breite scharf und Texte werden nie gestaucht.
import { esc } from "./util.js";

const de = (n, digits) => n.toFixed(digits).replace(".", ",");

// Runde Achsen-Schritte: 1, 2, 2,5 oder 5 mal eine Zehnerpotenz
function axis(max, steps = 4) {
  if (!(max > 0)) max = 1;
  const raw = max / steps, mag = 10 ** Math.floor(Math.log10(raw)), n = raw / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  const count = Math.ceil(max / step - 1e-9);
  const digits = step >= 1 ? 0 : (Math.round(step * 100) % 10 ? 2 : 1);
  return { top: count * step, ticks: Array.from({ length: count + 1 }, (_, i) => i * step), digits };
}

const noData = (text) => `<p class="ch-none">${esc(text || "Noch keine Werte.")}</p>`;

// Liniendiagramm über Matches (gleicher Abstand pro Match, älteste links).
//   points: [{ value, text (Wert als Text), title (z. B. Datum), sub (z. B. Map und Gegner), x (kurzes Datum für die Achse) }]
//   ref:    Bezugslinie (z. B. 1 bei K/D)
//   label:  Beschreibung für Vorlese-Programme
export function lineChart({ points, ref = null, area = false, label = "", unit = "", empty = "" }) {
  const n = points.length;
  if (!n) return noData(empty);
  const ax = axis(Math.max(...points.map((p) => p.value), ref ?? 0));
  const X = (i) => n === 1 ? 50 : (i / (n - 1)) * 100;
  const Y = (v) => (1 - v / ax.top) * 100;
  const r = (v) => Math.round(v * 100) / 100;
  const path = points.map((p, i) => r(X(i)) + "," + r(Y(p.value))).join(" ");
  const ticks = ax.ticks.slice();
  if (ref !== null && !ticks.some((t) => Math.abs(t - ref) < 1e-9)) ticks.push(ref);

  const grid = ax.ticks.map((t) => `<line class="ch-grid${t === 0 ? " zero" : ""}" x1="0" x2="100" y1="${r(Y(t))}" y2="${r(Y(t))}"/>`).join("");
  const refLine = ref !== null ? `<line class="ch-ref" x1="0" x2="100" y1="${r(Y(ref))}" y2="${r(Y(ref))}"/>` : "";
  const wash = area && n > 1 ? `<polygon class="ch-wash" points="${path} 100,100 0,100"/>` : "";
  const line = n > 1 ? `<polyline class="ch-line" points="${path}"/>` : "";
  const dots = points.map((p, i) => `<i class="ch-pt" style="left:${r(X(i))}%;top:${r(Y(p.value))}%" data-v="${esc(p.text)}" data-t="${esc(p.title || "")}" data-s="${esc(p.sub || "")}"></i>`).join("");
  const yTicks = ticks.map((t) => `<span class="ch-ytick${ref !== null && Math.abs(t - ref) < 1e-9 ? " ref" : ""}" style="top:${r(Y(t))}%">${de(t, ax.digits)}</span>`).join("");
  const last = points[n - 1];
  const aria = `${label}: ${n} ${n === 1 ? "Wert" : "Werte"}, zuletzt ${last.text}. Mit den Pfeiltasten durch die Matches gehen; alle Werte stehen in der Tabelle darunter.`;

  // Bis 40 Punkte sind alle sichtbar, darüber nur der gerade gewählte (sonst wird die Linie zur Perlenkette)
  return `<div class="ch-line-chart${n > 40 ? " many" : ""}">
    <div class="ch-area" tabindex="0" role="img" aria-label="${esc(aria)}" data-unit="${esc(unit)}">
      <svg class="ch-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false">${grid}${refLine}${wash}${line}</svg>
      ${yTicks}<i class="ch-cross" hidden></i>${dots}
    </div>
    <div class="ch-xaxis" aria-hidden="true"><span>${esc(points[0].x || "")}</span>${n > 1 ? `<span>${esc(last.x || "")}</span>` : ""}</div>
  </div>`;
}

// Balkendiagramm, waagerecht: ein Balken pro Zeile, Wert am Balkenende.
//   rows: [{ label, value, text (Wert am Balkenende), short (Wert im Tooltip, wenn kürzer als text),
//            tip (zweite Zeile im Tooltip), tag (kleiner Zusatz am Namen) }]
//   max:  rechtes Ende der Skala (sonst der größte Wert)
//   ref:  Bezugslinie (z. B. 1 bei K/D)
//   room: Platz für den Text am Balkenende, in Buchstaben-Breiten
export function barChart({ rows, max = null, ref = null, room = 4, unit = "", empty = "" }) {
  if (!rows.length) return noData(empty);
  const top = max ?? Math.max(...rows.map((x) => x.value), ref ?? 0, 1e-9);
  const w = (v) => `calc((100% - ${room}em) * ${Math.max(0, Math.min(1, v / top)).toFixed(4)})`;
  const body = rows.map((x) => `<div class="ch-row" tabindex="0" data-v="${esc(x.short ?? x.text)}" data-t="${esc(x.label)}" data-s="${esc(x.tip || "")}" data-unit="${esc(unit)}">
      <span class="ch-label" title="${esc(x.label)}">${esc(x.label)}${x.tag ? ` <small>${esc(x.tag)}</small>` : ""}</span>
      <span class="ch-track"><i class="ch-bar" style="width:${w(x.value)}"></i><b class="ch-val">${esc(x.text)}</b>${ref !== null ? `<i class="ch-refmark" style="left:${w(ref)}"></i>` : ""}</span>
    </div>`).join("");
  return `<div class="ch-bars">${body}</div>`;
}

// Jedes Diagramm gibt es auch als Tabelle (aufklappbar unter dem Diagramm)
export function chartTable(head, rows) {
  if (!rows.length) return "";
  return `<details class="ch-data"><summary>Werte als Tabelle</summary>
    <div class="table-wrap"><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div></details>`;
}

// ---------- Tooltip: bei Hover, Antippen und Tastatur ----------

let tipEl = null;
let active = null;   // { area, index } oder { row }

function tip() {
  if (!tipEl) {
    tipEl = document.createElement("div");
    tipEl.id = "ch-tip";
    tipEl.setAttribute("role", "status");
    tipEl.hidden = true;
    document.body.appendChild(tipEl);
  }
  return tipEl;
}

export function hideTip() {
  if (active && active.area) {
    const cross = active.area.querySelector(".ch-cross");
    if (cross) cross.hidden = true;
    active.area.querySelectorAll(".ch-pt.on").forEach((p) => p.classList.remove("on"));
  }
  if (active && active.row) active.row.classList.remove("on");
  active = null;
  if (tipEl) tipEl.hidden = true;
}

// Inhalt als Text setzen (nie als HTML: Namen von Gegnern und Spielern sind freie Eingaben)
function fill(el, unit) {
  const t = tip();
  t.textContent = "";
  const head = document.createElement("div");
  const b = document.createElement("b");
  b.textContent = el.dataset.v || "";
  head.appendChild(b);
  if (unit) head.appendChild(document.createTextNode(" " + unit));
  t.appendChild(head);
  for (const key of ["t", "s"]) {
    if (!el.dataset[key]) continue;
    const line = document.createElement("div");
    line.className = "ch-tip-sub";
    line.textContent = el.dataset[key];
    t.appendChild(line);
  }
  t.hidden = false;
  return t;
}

// Über den Punkt setzen (oder darunter, wenn oben kein Platz ist), nie über den Rand des Fensters hinaus
function place(t, x, y, gap) {
  const w = t.offsetWidth, h = t.offsetHeight, vw = document.documentElement.clientWidth;
  const left = Math.max(8, Math.min(vw - w - 8, x - w / 2));
  const top = y - h - gap >= 8 ? y - h - gap : y + gap;
  t.style.left = left + "px";
  t.style.top = top + "px";
}

function showPoint(area, index) {
  const pts = area.querySelectorAll(".ch-pt");
  if (!pts.length) return;
  index = Math.max(0, Math.min(pts.length - 1, index));
  if (active && active.area === area && active.index === index) return;
  hideTip();
  const pt = pts[index];
  pt.classList.add("on");
  const cross = area.querySelector(".ch-cross");
  cross.style.left = pt.style.left;
  cross.hidden = false;
  active = { area, index };
  const box = pt.getBoundingClientRect();
  place(fill(pt, area.dataset.unit), box.left + box.width / 2, box.top + box.height / 2, 14);
}

// Fadenkreuz am nächsten Match: Man zielt auf eine Stelle der Zeitachse, nicht auf die 2 px dicke Linie
function pointAt(area, clientX) {
  const box = area.getBoundingClientRect();
  const n = area.querySelectorAll(".ch-pt").length;
  const frac = box.width ? (clientX - box.left) / box.width : 0;
  showPoint(area, n === 1 ? 0 : Math.round(frac * (n - 1)));
}

function showRow(row) {
  if (active && active.row === row) return;
  hideTip();
  row.classList.add("on");
  active = { row };
  const bar = row.querySelector(".ch-bar").getBoundingClientRect();
  const track = row.querySelector(".ch-track").getBoundingClientRect();
  place(fill(row, row.dataset.unit), Math.max(bar.right, track.left + 24), bar.top, 8);
}

function onPointer(e) {
  const el = e.target instanceof Element ? e.target : null;
  const area = el && el.closest(".ch-area");
  if (area) return pointAt(area, e.clientX);
  const row = el && el.closest(".ch-row");
  if (row) return showRow(row);
  hideTip();
}

if (typeof document !== "undefined") {
  document.addEventListener("pointermove", onPointer);
  document.addEventListener("pointerdown", onPointer);
  document.addEventListener("focusin", (e) => {
    const el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    // Nur bei Tastatur-Bedienung: Beim Antippen hat pointerdown den Tooltip schon an die richtige Stelle gesetzt
    if (!el.matches(":focus-visible")) return;
    if (el.matches(".ch-area")) showPoint(el, el.querySelectorAll(".ch-pt").length - 1);
    else if (el.matches(".ch-row")) showRow(el);
  });
  document.addEventListener("focusout", (e) => {
    const el = e.target instanceof Element ? e.target : null;
    if (el && el.matches(".ch-area, .ch-row")) hideTip();
  });
  document.addEventListener("keydown", (e) => {
    const el = e.target instanceof Element ? e.target : null;
    if (e.key === "Escape") return hideTip();
    if (!el || !el.matches(".ch-area") || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    e.preventDefault();
    const n = el.querySelectorAll(".ch-pt").length;
    const cur = active && active.area === el ? active.index : n - 1;
    showPoint(el, cur + (e.key === "ArrowRight" ? 1 : -1));
  });
  // Der Tooltip steht fest im Fenster: Beim Scrollen und beim Seitenwechsel muss er weg
  window.addEventListener("scroll", hideTip, { passive: true, capture: true });
  window.addEventListener("hashchange", hideTip);
  window.addEventListener("resize", hideTip);
}
