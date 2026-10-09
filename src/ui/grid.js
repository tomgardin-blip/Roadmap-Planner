// Capacity grid: rows = team × skill; per quarter its 3 months, the pot and the quarter total.

import { TEAMS } from '../capacity.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (Math.round(n * 10) / 10).toString();
const delta = (planned, cap) => {
  const d = Math.round((planned - cap) * 10) / 10;
  return d > 0 ? `+${d} over` : d < 0 ? `${-d} free` : 'on capacity';
};

const ROLE_LABEL = { current: 'Current', next: 'Next', pot: 'Pot' };

// Months are neutral: with pot work at quarter level, month load alone says little.
// Only quarter totals carry the green / amber / red status (Tom, 2026-10-09).
function cell(c, attrs, extraClass = '', neutral = false) {
  if (!c.capacity && !c.planned) return `<td class="cell empty ${extraClass}">–</td>`;
  return `<td class="cell ${neutral ? 'month' : c.status} ${extraClass}" ${attrs} title="${fmt(c.planned)} planned of ${fmt(c.capacity)} capacity">
    <div class="n">${fmt(c.planned)}<span class="cap"> / ${fmt(c.capacity)}</span></div>
    <div class="d">${delta(c.planned, c.capacity)}</div></td>`;
}

function bucketCell(days, attrs, kind) {
  if (!days) return `<td class="cell pot empty ${kind}">–</td>`;
  const title = kind === 'tbd' ? 'committed, no dates yet: counted in the quarter of the committed date' : 'Start = End, at quarter level';
  return `<td class="cell pot ${kind}" ${attrs} title="${fmt(days)} days ${title}"><div class="n">${fmt(days)}</div><div class="d">${kind === 'tbd' ? 'TBD' : 'in pot'}</div></td>`;
}

export function renderGrid(el, grid, horizon, { teamFilter = 'all' } = {}) {
  const teams = teamFilter === 'all' ? TEAMS : [teamFilter];
  let h = '<table class="grid"><colgroup><col class="c-team"><col class="c-skill">';
  for (let i = 0; i < horizon.length; i++) h += '<col><col><col><col class="c-pot"><col class="c-pot"><col class="c-qt">';
  h += '</colgroup><thead><tr class="q"><th class="lead" rowspan="2">Team</th><th class="lead2" rowspan="2">Skill</th>';
  for (const q of horizon) {
    h += `<th colspan="6" class="qdiv ${q.role}"><span class="role">${ROLE_LABEL[q.role]}</span>${esc(q.label)}</th>`;
  }
  h += '</tr><tr class="m">';
  for (const q of horizon) {
    q.months.forEach((m, i) => { h += `<th class="${i === 0 ? 'qdiv' : ''}">${m.label} ${String(m.year).slice(2)}</th>`; });
    h += `<th title="Issues with Start = End">Pot</th><th title="Committed, no dates yet">TBD</th><th>${q.shortLabel} total</th>`;
  }
  h += '</tr></thead><tbody>';

  for (const team of teams) {
    const rows = grid.rows.filter((r) => r.team === team);
    rows.forEach((row, ri) => {
      h += `<tr class="${ri === rows.length - 1 ? 'teamend' : ''}">`;
      if (ri === 0) {
        const sums = horizon.map((q, qi) => {
          const p = rows.reduce((s, r) => s + r.quarters[qi].planned, 0);
          const c = rows.reduce((s, r) => s + r.quarters[qi].capacity, 0);
          return `${q.shortLabel} ${fmt(p)}/${fmt(c)}`;
        });
        h += `<td class="lead" rowspan="${rows.length}">${esc(team)}${sums.map((s) => `<span class="tsum">${s}</span>`).join('')}</td>`;
      }
      h += `<td class="lead2">${row.skill}</td>`;
      const at = (period) => `data-team="${esc(team)}" data-skill="${row.skill}" data-period="${period}"`;
      row.quarters.forEach((q) => {
        q.months.forEach((m, i) => { h += cell(m, at(m.key), i === 0 ? 'qdiv' : '', true); });
        h += bucketCell(q.pot, at(`${q.key}-pot`), 'potc');
        h += bucketCell(q.tbd, at(`${q.key}-tbd`), 'tbd');
        h += cell(q, at(q.key), 'qt');
      });
      h += '</tr>';
    });
  }
  h += '</tbody></table>';
  el.innerHTML = h;
}
