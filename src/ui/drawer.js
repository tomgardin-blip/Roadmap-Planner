// Cell drawer: the issues behind one grid cell with the days they put there, plus the
// layout of the date buttons (disabled until checkpoint 5) and, on quarter totals, the
// push-out / pull-forward / quick-win suggestions (src/suggestions.js).

import { cellIssues } from '../capacity.js';
import { formatDate } from '../periods.js';
import { pushOut, pullForward } from '../suggestions.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (Math.round(n * 10) / 10).toString();
const SKILL_KEY = { FE: 'frontend', BE: 'backend', MOB: 'mobile' };

/** Resolve a cell's label and numbers from the grid row. */
function cellInfo(row, horizon, period) {
  for (const [qi, q] of horizon.entries()) {
    const gq = row.quarters[qi];
    if (period === q.key) return { label: `${q.label} total`, c: gq };
    if (period === `${q.key}-pot`) return { label: `${q.label} pot`, c: { planned: gq.pot, capacity: null } };
    if (period === `${q.key}-tbd`) return { label: `${q.label} TBD (committed, no dates)`, c: { planned: gq.tbd, capacity: null } };
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

const scoreTag = (s) => (s ? `<span class="tag score" title="Demand ${fmt(s.demand)} ÷ effort ${fmt(s.effort)} d · ${s.frCount} FRs, ${s.customers} customers">Score ${fmt(s.score ?? 0)}</span>` : '');

function whenOf(issue) {
  const pot = issue.start && issue.start === issue.end;
  return !issue.start && !issue.end ? (issue.committed ? 'No dates (TBD)' : 'Not planned') : pot ? `Pot · ${formatDate(issue.end)}` : `${formatDate(issue.start)} → ${formatDate(issue.end)}`;
}

let dealNames = new Map();
const nidOf = (x) => String(x || '').replace(/-/g, '').toLowerCase();
const GO_LIVE = new Set(['Needed for go-live', 'Needed 1 month before']);

/**
 * Bird's-eye FR count (with go-live and Top 3 counts), tap to see each FR with its priority,
 * customer and deal-size multiplier. Native <details>, so it works on touch without JS.
 */
function frBlock(s) {
  if (!s) return '';
  if (!s.frs.length) return '<div class="frs none">0 FRs</div>';
  const gl = s.frs.filter((f) => GO_LIVE.has(f.priority)).length;
  const t3 = s.frs.filter((f) => f.priority === 'Top 3').length;
  const sum = [`<b>${s.frs.length} FR${s.frs.length === 1 ? '' : 's'}</b>`, `${s.customers} customer${s.customers === 1 ? '' : 's'}`, gl && `<span class="gl">${gl} go-live</span>`, t3 && `${t3} Top 3`].filter(Boolean).join(' · ');
  const rows = [...s.frs].sort((a, b) => b.points - a.points || String(a.priority).localeCompare(String(b.priority))).map((f) => {
    const cust = dealNames.get(nidOf(f.dealId)) || 'No customer';
    const t = f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.title || 'FR')}</a>` : esc(f.title || 'FR');
    return `<li><span class="tag ${GO_LIVE.has(f.priority) ? 'late' : f.priority === 'Top 3' ? 'qw' : ''}">${esc(f.priority || 'No priority')}</span> <b>${esc(cust)}</b>${f.multiplier > 1 ? ` <span class="mult">×${f.multiplier}</span>` : ''}<div class="frt">${t}${f.status ? ` · ${esc(f.status)}` : ''}</div></li>`;
  }).join('');
  return `<details class="frs"><summary>${sum}</summary><ul>${rows}</ul></details>`;
}

/** Compact row for a suggestion list. */
function suggestion(x, skill, label) {
  const { issue } = x;
  const title = issue.url ? `<a href="${esc(issue.url)}" target="_blank" rel="noopener">${esc(issue.name)}</a>` : esc(issue.name);
  const tags = [
    x.quickWin ? '<span class="tag qw">Quick win</span>' : '',
    x.late ? `<span class="tag late">After commit ${formatDate(issue.committed)}</span>` : issue.committed ? `<span class="tag commit">Commit ${formatDate(issue.committed)}</span>` : '',
    scoreTag(x.score),
    `<span class="tag">${whenOf(issue)}</span>`,
    issue.status ? `<span class="tag">${esc(issue.status)}</span>` : '',
  ].join('');
  return `<div class="sugg"><div class="t">${title}</div><div class="meta">${tags}<span class="eff"><b>${skill} ${fmt(x.days)} d</b>${label ? ` · ${label}` : ''}</span></div>${frBlock(x.score)}</div>`;
}

function suggestions({ run, scores, backlog, extra, team, skill, quarter, c }) {
  const diff = c.planned - c.capacity;
  if (extra.scores === 'loading') return '<h4>Suggestions</h4><div class="placeholder">Loading FR demand from Lightdash for the scores…</div>';
  if (extra.scores === 'error') return `<h4>Suggestions</h4><div class="placeholder">Scores unavailable: ${esc(extra.scoresError || '')}</div>`;
  if (diff > 1e-9) {
    const p = pushOut({ run, scores, team, skill, quarter, over: diff });
    const ex = [p.excluded.committed && `${p.excluded.committed} committed`, p.excluded.inProgress && `${p.excluded.inProgress} in progress`].filter(Boolean).join(', ');
    let h = `<h4>Suggested to push out · ${fmt(diff)} d over</h4><div class="hint">No commit, not in progress. Quick wins first, then lowest score.${ex ? ` Not shown: ${ex}.` : ''}</div>`;
    if (!p.items.length) return `${h}<div class="placeholder">Nothing movable: everything here is committed or in progress.</div>`;
    p.items.forEach((x, i) => {
      h += suggestion(x, skill, `${fmt(x.cumulative)} d moved`);
      if (i === p.coverIdx) h += `<div class="coverline">Overbooking covered above this line</div>`;
    });
    if (p.coverIdx < 0) h += `<div class="coverline bad">Still ${fmt(diff - p.items[p.items.length - 1].cumulative)} d over after moving all of these</div>`;
    return h;
  }
  const free = -diff;
  const p = pullForward({ run, scores, team, skill, quarter, free, backlog });
  const note = extra.backlog === 'loading' ? ' Unplanned backlog still loading.' : extra.backlog === 'error' ? ' Unplanned backlog unavailable.' : '';
  let h = `<h4>Suggested to pull forward · ${fmt(free)} d free</h4><div class="hint">Planned later or not planned, fits the free days, not blocked. Committed first (buys margin), then highest score.${note}</div>`;
  h += p.items.map((x) => suggestion(x, skill)).join('') || '<div class="placeholder">Nothing fits the free days.</div>';
  h += `<h4>Quick wins that fit · ${p.quickWins.length}</h4><div class="hint">No commit, at most 2 d total effort, highest score first. Your call.</div>`;
  h += p.quickWins.map((x) => suggestion(x, skill)).join('') || '<div class="placeholder">No quick wins fit.</div>';
  return h;
}

function issueCard({ issue, days }, skill, horizon, change, score) {
  const late = issue.committed && issue.end && issue.end > issue.committed;
  const eff = ['FE', 'BE', 'MOB'].map((s) => {
    const v = issue.skillEfforts?.[SKILL_KEY[s]] || 0;
    return v ? (s === skill ? `<b>${s} ${fmt(v)}</b>` : `${s} ${fmt(v)}`) : null;
  }).filter(Boolean).join(' · ');
  const pot = issue.start && issue.start === issue.end;
  const when = !issue.start && !issue.end ? 'No dates (TBD)' : pot ? `Pot · ${formatDate(issue.end)}` : `${formatDate(issue.start)} → ${formatDate(issue.end)}`;
  const tags = [
    issue.committed ? `<span class="tag ${late ? 'late' : 'commit'}">${late ? 'After commit ' : 'Commit '}${formatDate(issue.committed)}</span>` : '',
    `<span class="tag ${pot ? 'qtr' : ''}">${when}</span>`,
    scoreTag(score),
    issue.priority ? `<span class="tag">${esc(issue.priority)}</span>` : '',
    issue.status === 'Blocked' ? '<span class="tag blocked">Blocked</span>' : '',
    change ? `<span class="tag live" title="${esc(change.fields.map((k) => `${FIELD_LABEL[k]}: ${showVal(k, change.before[k])} → ${showVal(k, change.after[k])}`).join('\n'))}">Live from Notion: ${esc(change.fields.map((k) => FIELD_LABEL[k]).join(', '))} changed</span>` : '',
  ].join('');
  const title = issue.url && !issue.url.includes('example.invalid')
    ? `<a href="${esc(issue.url)}" target="_blank" rel="noopener">${esc(issue.name)}</a>` : esc(issue.name);
  return `<div class="issue"><div class="t">${title}</div>
    <div class="meta">${tags}<span class="eff">${eff} d</span><span><b>${fmt(days)}</b> d in this cell</span></div>
    ${frBlock(score)}
    ${dateButtons(issue, horizon)}</div>`;
}

export function openDrawer(el, { run, grid, horizon, changes = [], scores = null, backlog = [], extra = {}, names = new Map(), team, skill, period }) {
  dealNames = names;
  const byId = new Map(changes.map((c) => [c.id, c]));
  const row = grid.rows.find((r) => r.team === team && r.skill === skill);
  const { label, c } = cellInfo(row, horizon, period);
  const sc = (x) => scores?.get(x.issue.id)?.score ?? -1;
  // SPEC: issues in a cell sorted by committed date, then score.
  const list = cellIssues(run, team, skill, period).sort((a, b) => {
    const ca = a.issue.committed, cb = b.issue.committed;
    if (ca && cb && ca !== cb) return ca.localeCompare(cb);
    if (ca && !cb) return -1;
    if (!ca && cb) return 1;
    return sc(b) - sc(a) || b.days - a.days;
  });
  const quarter = horizon.find((q) => q.key === period);
  const hasCap = c.capacity != null;
  const diff = hasCap ? Math.round((c.planned - c.capacity) * 10) / 10 : 0;
  const over = diff > 0;

  el.innerHTML = `
    <div class="dh"><b>${esc(team)} · ${skill}</b><span class="sub">${label}</span><span class="spacer"></span>
      <button class="hx" data-close aria-label="Close">×</button></div>
    <div class="dsum">
      <div class="stat"><b>${fmt(c.planned)}</b>planned days</div>
      ${hasCap ? `<div class="stat"><b>${fmt(c.capacity)}</b>capacity</div>
      <div class="stat ${c.status}"><b>${over ? '+' : ''}${fmt(Math.abs(diff))}</b>${over ? 'over' : 'free'}</div>` : ''}
      <div class="stat"><b>${list.length}</b>issues</div>
    </div>
    <div class="dbody">
      ${quarter ? suggestions({ run, scores, backlog, extra, team, skill, quarter, c }) : hasCap ? '<div class="hint">Suggestions are on the quarter total: month cells are neutral.</div>' : ''}
      <h4>Issues in this cell · by committed date, then score</h4>
      ${list.map((x) => issueCard(x, skill, horizon, byId.get(x.issue.id), scores?.get(x.issue.id))).join('') || '<div class="placeholder">No issues.</div>'}
    </div>`;
  el.classList.add('open');
}

export function closeDrawer(el) {
  el.classList.remove('open');
}
