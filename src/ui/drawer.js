// Cell drawer: the issues behind one grid cell, plus the layout of the
// date buttons (disabled until checkpoint 5) and suggestions (checkpoint 4).

import { issuesInCell, SKILLS } from '../capacity.js';
import { formatDate, isQuarterPlacement, monthKey } from '../periods.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (Math.round(n * 10) / 10).toString();

function periodInfo(horizon, period) {
  for (const q of horizon) {
    if (q.key === period) return { label: q.label, keys: q.months.map((m) => m.key) };
    const m = q.months.find((x) => x.key === period);
    if (m) return { label: `${m.label} ${m.year}`, keys: [m.key] };
  }
  return null;
}

function dateButtons(issue, horizon) {
  const endMonth = monthKey(issue.end);
  const quarterLevel = isQuarterPlacement(issue.end);
  let h = '<div class="datebtns">';
  for (const q of horizon) for (const m of q.months) {
    const cur = !quarterLevel && m.key === endMonth;
    h += `<button disabled class="${cur ? 'cur' : ''}" title="Sets Start = End = ${formatDate(m.lastFriday)} (checkpoint 5)">${m.label}</button>`;
  }
  h += '<span class="sep"></span>';
  for (const q of horizon) {
    const cur = quarterLevel && issue.end === q.lastFriday;
    h += `<button disabled class="${cur ? 'cur' : ''}" title="Sets Start = End = ${formatDate(q.lastFriday)} (checkpoint 5)">${q.shortLabel}</button>`;
  }
  return h + '</div>';
}

function issueCard(issue, skill, horizon) {
  const late = issue.committed && issue.end > issue.committed;
  const eff = SKILLS.map((s) => (issue.effort[s] ? (s === skill ? `<b>${s} ${fmt(issue.effort[s])}</b>` : `${s} ${fmt(issue.effort[s])}`) : null))
    .filter(Boolean).join(' · ');
  const tags = [
    issue.committed ? `<span class="tag ${late ? 'late' : 'commit'}">${late ? 'After commit ' : 'Commit '}${formatDate(issue.committed)}</span>` : '',
    isQuarterPlacement(issue.end) ? '<span class="tag qtr">Quarter-level</span>' : `<span class="tag">End ${formatDate(issue.end)}</span>`,
    issue.priority ? `<span class="tag">${issue.priority}</span>` : '',
    issue.status === 'Blocked' ? '<span class="tag blocked">Blocked</span>' : '',
    `<span class="tag score">Score ${fmt(issue.score)}</span>`,
  ].join('');
  return `<div class="issue"><div class="t">${esc(issue.title)}</div>
    <div class="meta">${tags}<span class="eff">${eff} d</span><span>${issue.frCount} FRs</span></div>
    ${dateButtons(issue, horizon)}</div>`;
}

export function openDrawer(el, { issues, grid, horizon, team, skill, period }) {
  const info = periodInfo(horizon, period);
  const row = grid.rows.find((r) => r.team === team && r.skill === skill);
  let c = null;
  for (const q of row.quarters) {
    if (q.key === period) c = q;
    const m = q.months.find((x) => x.key === period);
    if (m) c = m;
  }
  const list = issuesInCell(issues, team, skill, info.keys);
  const diff = Math.round((c.planned - c.capacity) * 10) / 10;
  const over = diff > 0;

  el.innerHTML = `
    <div class="dh"><b>${esc(team)} · ${skill}</b><span class="sub">${info.label}</span><span class="spacer"></span>
      <button class="hx" data-close aria-label="Close">×</button></div>
    <div class="dsum">
      <div class="stat"><b>${fmt(c.planned)}</b>planned days</div>
      <div class="stat"><b>${fmt(c.capacity)}</b>capacity</div>
      <div class="stat ${c.status}"><b>${over ? '+' : ''}${diff}</b>${over ? 'over' : 'free'}</div>
      <div class="stat"><b>${list.length}</b>issues</div>
    </div>
    <div class="dbody">
      <h4>${over ? 'Suggested to push out' : 'Suggested to pull forward'}</h4>
      <div class="placeholder">${over
        ? 'Lowest score, no commit, quick-win fillers first.'
        : 'Highest score that fits the free days.'} Arrives with scoring in checkpoint 4.</div>
      <h4>Issues in this cell · by committed date, then score</h4>
      ${list.map((i) => issueCard(i, skill, horizon)).join('') || '<div class="placeholder">No issues.</div>'}
    </div>`;
  el.classList.add('open');
}

export function closeDrawer(el) {
  el.classList.remove('open');
}
