// Abzeichen auf der Spieler-Seite (js/badges.js): Kacheln mit Stufe, Wert und wie viel bis zur nächsten Stufe fehlt
import { esc } from "../util.js";
import { TIERS, badgesFor } from "../badges.js";

const fmt = (n) => Math.round(n).toLocaleString("de-DE");

export function badgeCard(b) {
  const has = b.tier >= 0;
  const from = has ? b.steps[b.tier] : 0, to = b.next;
  const share = to ? Math.max(0, Math.min(1, (b.value - from) / (to - from))) : 1;
  const next = to ? `noch ${fmt(to - b.value)} bis ${TIERS[b.tier + 1]}` : "Höchste Stufe erreicht";
  return `<div class="badge ${has ? "t" + b.tier : "locked"}" title="${esc(b.what)}: ${fmt(b.value)}">
      <div class="badge-top"><span class="badge-icon" aria-hidden="true">${b.icon}</span><div><b>${esc(b.name)}</b><small>${has ? TIERS[b.tier] : "noch gesperrt"}</small></div></div>
      <div class="badge-val">${fmt(b.value)} <span>${esc(b.unit)}</span></div>
      <div class="badge-bar" aria-hidden="true"><i style="width:${Math.round(share * 100)}%"></i></div>
      <small class="badge-next">${esc(next)}</small>
    </div>`;
}

export function badgePanel(id) {
  const list = badgesFor(id);
  if (!list) return "";
  const got = list.filter((b) => b.tier >= 0).length;
  const sorted = list.slice().sort((a, b) => b.tier - a.tier || (b.next ? b.value / b.next : 1) - (a.next ? a.value / a.next : 1));
  return `<section class="panel"><div class="panel-head"><h2>Abzeichen</h2><span class="hint">${got} von ${list.length} · Stufen Eisen bis Radiant · aus allen Matches</span></div>
    <div class="badges">${sorted.map(badgeCard).join("")}</div></section>`;
}
