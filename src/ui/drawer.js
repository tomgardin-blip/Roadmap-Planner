// Cell drawer: the issues behind one grid cell with the days they put there, plus the
// layout of the date buttons (disabled until checkpoint 5) and suggestions (checkpoint 4).

import { cellIssues } from '../capacity.js';
import { formatDate } from '../periods.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (Math.round(n * 10) / 10).toString();
const SKILL_KEY = { FE: 'frontend', BE: 'backend', MOB: 'mobile' };

/** Resolve a cell's label and numbers from the grid row. */
function cellInfo(row, horizon, period) {
  for (const [qi, q] of horizon.entries()) {
    const gq = row.quarters[qi];
    if (period === q.key) return { label: `${q.label} total`, c: gq };
    if (period === `${q.key}-pot`) return { label: `${q.label} pot`, c: { planned: gq.pot, capacity: null } };
    const mi = q.months.findIndex((m) => m.key === period);
    if (mi >= 0) return { label: `${q.months[mi].label} ${q.months[mi].year}`, c: gq.months[mi] };
  }
  return null;
}

function dateButtons(issue, horizon) {
  const pot = issue.start && issue.start === issue.end;
  let h = '<div class="datebtns">';
  for (const q of horizon) for (const m of q.months) {
    const cur = pot && issue.end === m.lastFriday && issue.end !== q.lastFriday;
    h += `<button disabled class="${cur ? 'cur' : ''}" title="Sets Start = End = ${formatDate(m.lastFriday)} (checkpoint 5)">${m.label}</button>`;
  }
  h += '<span class="sep"></span>';
  for (const q of horizon) {
    const cur = pot && issue.end === q.lastFriday;
    h += `<button disabled class="${cur ? 'cur' : ''}" title="Sets Start = End = ${formatDate(q.lastFriday)} (checkpoint 5)">${q.shortLabel}</button>`;
  }
  return h + '</div>';
}

const FIELD_LABEL = { start: 'Start', end: 'End', fe: 'FE', be: 'BE', mob: 'MOB', team: 'Team', status: 'Status' };
const showVal = (k, v) => (v == null || v === '' ? '–' : (k === 'start' || k === 'end') ? formatDate(v) : String(v));

function issueCard({ issue, days }, skill, horizon, change) {
  const late = issue.committed && issue.end && issue.end > issue.committed;
  const eff = ['FE', 'BE', 'MOB'].map((s) => {
    const v = issue.skillEfforts?.[SKILL_KEY[s]] || 0;
    return v ? (s === skill ? `<b>${s} ${fmt(v)}</b>` : `${s} ${fmt(v)}`) : null;
  }).filter(Boolean).join(' · ');
  const pot = issue.start && issue.start === issue.end;
  const when = pot ? `Pot · ${formatDate(issue.end)}` : `${formatDate(issue.start)} → ${formatDate(issue.end)}`;
  const tags = [
    issue.committed ? `<span class="tag ${late ? 'late' : 'commit'}">${late ? 'After commit ' : 'Commit '}${formatDate(issue.committed)}</span>` : '',
    `<span class="tag ${pot ? 'qtr' : ''}">${when}</span>`,
    issue.priority ? `<span class="tag">${esc(issue.priority)}</span>` : '',
    issue.status === 'Blocked' ? '<span class="tag blocked">Blocked</span>' : '',
    change ? `<span class="tag live" title="${esc(change.fields.map((k) => `${FIELD_LABEL[k]}: ${showVal(k, change.before[k])} → ${showVal(k, change.after[k])}`).join('\n'))}">Live from Notion: ${esc(change.fields.map((k) => FIELD_LABEL[k]).join(', '))} changed</span>` : '',
  ].join('');
  const title = issue.url && !issue.url.includes('example.invalid')
    ? `<a href="${esc(issue.url)}" target="_blank" rel="noopener">${esc(issue.name)}</a>` : esc(issue.name);
  return `<div class="issue"><div class="t">${title}</div>
    <div class="meta">${tags}<span class="eff">${eff} d</span><span><b>${fmt(days)}</b> d in this cell</span><span>${(issue.customers || []).length} FRs</span></div>
    ${dateButtons(issue, horizon)}</div>`;
}

export function openDrawer(el, { run, grid, horizon, changes = [], team, skill, period }) {
  const byId = new Map(changes.map((c) => [c.id, c]));
  const row = grid.rows.find((r) => r.team === team && r.skill === skill);
  const { label, c } = cellInfo(row, horizon, period);
  const list = cellIssues(run, team, skill, period);
  const hasCap = c.capacity != null;
  const diff = hasCap ? Math.round((c.planned - c.capacity) * 10) / 10 : 0;
  const over = diff > 0;

  el.innerHTML = `
    <div class="dh"><b>${esc(team)} · ${skill}</b><span class="sub">${label}</span><span class="spacer"></span>
      <button class="hx" data-close aria-label="Close">×</button></div>
    <div class="dsum">
      <div class="stat"><b>${fmt(c.planned)}</b>planned days</div>
      ${hasCap ? `<div class="stat"><b>${fmt(c.capacity)}</b>capacity</div>
      <div class="stat ${c.status}"><b>${over ? '+' : ''}${diff}</b>${over ? 'over' : 'free'}</div>` : ''}
      <div class="stat"><b>${list.length}</b>issues</div>
    </div>
    <div class="dbody">
      ${hasCap ? `<h4>${over ? 'Suggested to push out' : 'Suggested to pull forward'}</h4>
      <div class="placeholder">${over ? 'Lowest score, no commit, quick-win fillers first.' : 'Highest score that fits the free days.'} Arrives with scoring in checkpoint 4.</div>` : ''}
      <h4>Issues in this cell · by committed date, then days</h4>
      ${list.map((x) => issueCard(x, skill, horizon, byId.get(x.issue.id))).join('') || '<div class="placeholder">No issues.</div>'}
    </div>`;
  el.classList.add('open');
}

export function closeDrawer(el) {
  el.classList.remove('open');
}
