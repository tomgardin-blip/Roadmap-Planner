// Capacity view, laid out like the Lightdash engineering capacity planner (Tom, 2026-10-26):
// per team, one card per quarter; per skill the spare days (capacity − demand) per month,
// then pot and TBD (demand only, so negative) and the quarter total. Header: demand / spare.

import { TEAMS, pickedTeams, TECH_IMPR_SHARE } from '../capacity.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r1 = (n) => Math.round(n * 10) / 10;
const signed = (n) => { const v = r1(n); return v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1); };
const tone = (n) => { const v = r1(n); return v < 0 ? 'neg' : v > 0 ? 'pos' : 'zero'; };
const SKILL_LABEL = { FE: 'Frontend', BE: 'Backend', MOB: 'Mobile' };

function num(v, attrs, extra = '') {
  return `<td class="cell num ${tone(v)} ${extra}" ${attrs}>${signed(v)}</td>`;
}

function card(team, rows, q, qi) {
  const spare = (c) => (c.capacity || 0) - (c.planned || 0);
  const at = (skill, period) => `data-team="${esc(team)}" data-skill="${skill}" data-period="${period}"`;
  const demand = rows.reduce((s, r) => s + r.quarters[qi].planned, 0);
  const qSpare = rows.reduce((s, r) => s + spare(r.quarters[qi]), 0);
  let h = `<section class="qcard"><div class="qhead"><span class="qname">${esc(q.label)}${q.role === 'current' ? ' <small>(from this week)</small>' : ''}</span>
    <span class="qtot"><span class="qdem">${r1(demand).toFixed(1)}d</span> / <b class="${tone(qSpare)}">${signed(qSpare)}d</b></span></div>
    <table class="qt"><thead><tr><th>Skill</th>${q.months.map((m) => `<th>${esc(m.label)}</th>`).join('')}<th class="sep pot">Pot</th><th class="tbd">TBD</th><th class="sep">Qtr</th></tr></thead><tbody>`;
  const tot = { months: q.months.map(() => 0), pot: 0, tbd: 0, q: 0 };
  for (const row of rows) {
    const c = row.quarters[qi];
    h += `<tr><td class="sk">${SKILL_LABEL[row.skill] || row.skill}</td>`;
    c.months.forEach((m, i) => { tot.months[i] += spare(m); h += num(spare(m), at(row.skill, m.key)); });
    tot.pot -= c.pot; tot.tbd -= c.tbd; tot.q += spare(c);
    h += num(-c.pot, at(row.skill, `${q.key}-pot`), 'sep') + num(-c.tbd, at(row.skill, `${q.key}-tbd`)) + num(spare(c), at(row.skill, q.key), 'sep');
    h += '</tr>';
  }
  h += `<tr class="total"><td class="sk">Total</td>${tot.months.map((v) => `<td class="num ${tone(v)}">${signed(v)}</td>`).join('')}
    <td class="num sep ${tone(tot.pot)}">${signed(tot.pot)}</td><td class="num ${tone(tot.tbd)}">${signed(tot.tbd)}</td><td class="num sep ${tone(tot.q)}">${signed(tot.q)}</td></tr>`;
  // Tech improvement: spent vs 15% of capacity, as in the engineering planner (Tom, 2026-10-29).
  const spent = rows.reduce((s, r) => s + (r.quarters[qi].ti || 0), 0);
  const budget = TECH_IMPR_SHARE * rows.reduce((s, r) => s + (r.quarters[qi].capacity || 0), 0);
  const left = budget - spent;
  const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : spent > 0 ? 100 : 0;
  const ti = `<div class="ti" title="Tech improvement: days on Technical improvement issues this quarter (FE + BE + MOB, Done included) vs a budget of ${Math.round(TECH_IMPR_SHARE * 100)}% of the quarter's capacity"><div class="tihead"><span>Tech impr</span><span>${r1(spent).toFixed(1)} / ${r1(budget).toFixed(1)}d · <b class="${left < 0 ? 'tiover' : 'tiunder'}">${r1(Math.abs(left)).toFixed(1)}d ${left < 0 ? 'over' : 'under'}</b></span></div><div class="tibar"><span class="${left < 0 ? 'tiover' : 'tiunder'}" style="width:${pct.toFixed(1)}%"></span></div></div>`;
  return `${h}</tbody></table>${ti}</section>`;
}

/** One team's card for one quarter (Quarter plan, Tom 2026-10-27), or '' when the team has no capacity or demand. */
export function teamCard(grid, team, q, qi) {
  const rows = grid.rows.filter((r) => r.team === team && r.quarters.some((x) => x.capacity || x.planned));
  return rows.length ? card(team, rows, q, qi) : '';
}

export function renderGrid(el, grid, horizon, { teamFilter = 'all' } = {}) {
  const teams = pickedTeams(teamFilter) || TEAMS;
  let h = '<div class="cards">';
  for (const team of teams) {
    // Skills with neither capacity nor demand anywhere in the horizon are left out, as in the planner.
    const rows = grid.rows.filter((r) => r.team === team && r.quarters.some((q) => q.capacity || q.planned));
    if (!rows.length) continue;
    h += `<div class="teamblock"><h3>${esc(team)}</h3><div class="qrow">${horizon.map((q, qi) => card(team, rows, q, qi)).join('')}</div></div>`;
  }
  el.innerHTML = `${h}</div>`;
}
