// List screens: At risk and Prep queues. Built from src/atrisk.js and src/prep.js; every card
// carries the same date buttons and FR edit as the drawer.

import { RULES } from '../atrisk.js';
import { formatDate, formatDateTime, formatDatesIn, lateVsCommit } from '../periods.js';
import { issueTeams, TEAMS, pickedTeams } from '../capacity.js';
import { ISSUE_PRIORITIES } from '../notion/writes.js';
import { GROUPS } from '../prep.js';
import { listCard, frCard, planActions, qualityFrCard, frBlock } from './drawer.js';
import { CHECKS, qualityCount } from '../quality.js';
import { teamCard } from './grid.js';
import { ESTIMATE_TARGETS } from '../estimate.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SK = ['frontend', 'backend', 'mobile'];
const days = (list) => Math.round(list.reduce((a, e) => a + SK.reduce((b, s) => b + (e.issue?.skillEfforts?.[s] || 0), 0), 0));
const LIMIT = 30;

// Default order (Tom, 2026-10-26): highest customer value first. Scored issues by score; issues with
// no effort (no score) by their demand; ties by committed date. 'commit' restores the old order.
export function sortEntries(list, scores, mode = 'value') {
  const commit = (e) => String(e.issue?.committed || '9');
  const byCommit = (a, b) => commit(a).localeCompare(commit(b));
  const s = (e) => scores?.get(e.issue?.id);
  const key = (e) => { const x = s(e); return x ? [x.score != null ? 1 : 0, x.score ?? x.demand ?? 0] : [0, -1]; };
  const byValue = (a, b) => { const ka = key(a), kb = key(b); return kb[0] - ka[0] || kb[1] - ka[1]; };
  // Committed date first, then customer value, so equal dates still show the most valuable first.
  if (mode === 'commit') return [...list].sort((a, b) => byCommit(a, b) || byValue(a, b));
  return [...list].sort((a, b) => byValue(a, b) || byCommit(a, b));
}
const sortSel = (mode, note = '') => `<label class="lchk lsort">Sort${note} <select id="listSort"><option value="value" ${mode !== 'commit' ? 'selected' : ''}>Customer value (score), highest first</option><option value="commit" ${mode === 'commit' ? 'selected' : ''}>Committed date, earliest first</option></select></label>`;

function section(id, title, count, sub, body, open = false) {
  return `<details class="lsec" ${open ? 'open' : ''} id="${id}"><summary><b>${esc(title)}</b><span class="cnt">${count}</span>${sub ? `<span class="lsub">${esc(sub)}</span>` : ''}</summary><div class="lbody">${body}</div></details>`;
}
function capped(items, render, key) {
  if (!items.length) return '<div class="placeholder">None.</div>';
  const head = items.slice(0, LIMIT).map(render).join('');
  const rest = items.slice(LIMIT).map(render).join('');
  return head + (rest ? `<details class="more" data-more="${key}"><summary>Show all ${items.length}</summary>${rest}</details>` : '');
}

export function renderAtRisk(el, { risk, horizon, scores, loading, baselineError, sort = 'value', readOnly = false, pbReq = null, owners = null }) {
  const baselineNote = baselineError ? `Effort baseline unavailable: ${baselineError}` : 'Reading the effort baseline from Notion…';
  const total = RULES.reduce((a, r) => a + (risk[r.key]?.length || 0), 0);
  let h = `<div class="lhead"><b>At risk</b><span class="lsub">${total} flags across ${RULES.length} rules${loading ? ' · scores loading' : ''}. Commit dates are effective commits (earliest of the issue, its FRs and what it blocks).</span>${sortSel(sort)}</div>`;
  for (const r of RULES) {
    const list = risk[r.key] && sortEntries(risk[r.key], scores, sort);
    if (!list) { h += section(`risk-${r.key}`, r.label, '…', baselineNote, `<div class="placeholder">${baselineNote}</div>`); continue; }
    const sub = list.length ? `${days(list)} d` : '';
    // No team: ask Qai to set the Team, one DM per ticked issue (Tom, 2026-10-27).
    const tools = r.key === 'noTeam' && list.length && !readOnly ? `<div class="lhead small"><button class="estbtn" data-estpost="qaiTeam" title="One DM to Qai per ticked issue, asking it to set the Team">${ESTIMATE_TARGETS.qaiTeam.button}</button></div>` : '';
    h += section(`risk-${r.key}`, r.label, list.length, sub, tools + capped(list, (e) => listCard(e.issue, horizon, scores?.get(e.issue.id), e.detail, '', r.key === 'dependency' ? { kind: 'dependency', blockerId: e.blocker?.id } : r.key === 'committedBlocked' ? { kind: 'blocked' } : null), r.key), r.key === 'afterCommit');    if (r.key === 'afterCommit') h += pushbackSection(pbReq, owners, readOnly);
  }
  el.innerHTML = `<div class="lists">${h}</div>`;
}

// FRs on "Pushback Req GL" (Tom, 2026-10-30): days waiting since it was set, the COM/AM, and a Slack reminder.
function pushbackSection(list, owners, readOnly) {
  const title = 'Pushback Req GL: customer still to be told';
  if (!list) return section('risk-pbreq', title, '…', 'needs all FRs', '<div class="placeholder">Loading the FRs from Lightdash…</div>');
  const card = (e) => {
    const owner = owners?.get(e.fr.id);
    const waited = e.days == null ? 'Set outside the planner, so the date is unknown' : `Set ${e.days} day${e.days === 1 ? '' : 's'} ago (${fd(String(e.since).slice(0, 10))})`;
    const known = owners?.has(e.fr.id);
    const who = owner ? `COM/AM ${owner}` : known ? 'No Responsible Success' : 'COM/AM loading…';
    const rem = e.reminded ? (e.reminded.link ? `<a class="rmlinks" href="${esc(e.reminded.link)}" target="_blank" rel="noopener">Reminded ${fd(String(e.reminded.at).slice(0, 10))} · open in Slack</a>` : `<span class="rmlinks">Reminded ${fd(String(e.reminded.at).slice(0, 10))}</span>`) : '';
    const btn = readOnly ? '' : `<button type="button" class="fredit" data-pbremind="${e.fr.id}" ${known && !owner ? 'disabled title="No Responsible Success on this FR"' : ''}>${e.reminded ? 'Remind again' : 'Remind COM/AM'}</button>`;
    const age = e.days != null && e.days >= 5 ? `<span class="tag late">${e.days} d waiting</span>` : e.days != null ? `<span class="tag">${e.days} d waiting</span>` : '<span class="tag">? d waiting</span>';
    return qualityFrCard(e.fr, `${waited} · ${who}`, e.issues[0] || null, `${age}${btn}${rem}`);
  };
  return section('risk-pbreq', title, list.length, list.length ? 'longest waiting first' : '', capped(list, card, 'pbreq'));
}

// "No team" on a prep card, with a button to DM Qai for that one issue (Tom, 2026-10-27), as on At risk.
const noTeamTag = (e, readOnly) => (!e.noTeam ? '' : `<span class="tag late">No team</span>${readOnly ? '' : `<button type="button" class="fredit qaiteam" data-qaiteam="${e.issue.id}" title="Send Qai a Slack DM to set the missing Team (preview first)">DM Qai for the team</button>`}`);

// Ask @Qai in #dev_effort_estimate for this one issue (Tom, 2026-10-30), same preview as the bulk button.
const qaiEstBtn = (e, readOnly) => (readOnly ? '' : `<button type="button" class="fredit qaiest" data-qaiest="${e.issue.id}" title="Post @Qai estimate for this issue in #dev_effort_estimate (preview first)">Ask @Qai in #dev_effort_estimate</button>`);

export function renderPrep(el, { queues, horizon, scores, loading, readOnly, sort = 'value', comments = new Map() }) {
  if (!queues) { el.innerHTML = `<div class="lists"><div class="placeholder">${loading ? 'Prep queues need all FRs and the unplanned backlog. Loading them from Lightdash…' : 'Prep queues unavailable: the FR or backlog load failed.'}</div></div>`; return; }
  let h = `<div class="lhead"><b>Prep queues</b><span class="lsub">What blocks planning, per FR priority. Only FRs of signed customers (deal Closed-Won) count. An issue sits under its highest-priority FR.</span>
    ${readOnly ? '' : `<span class="estbtns"><button class="estbtn" data-estpost="productFeature" title="One post per ticked issue: @claude_code runs the product-feature skill">Post to #product-create-ei-skill-trigger</button><button class="estbtn" data-estpost="qai" title="One post per ticked issue: @Qai estimate (the old flow)">Ask @Qai in #dev_effort_estimate</button></span>`}
    ${sortSel(sort, ' No estimate')}</div>`;
  for (const g of GROUPS) {
    const q = { ...queues[g.key], noEstimate: sortEntries(queues[g.key].noEstimate, scores, sort), notPlanned: sortEntries(queues[g.key].notPlanned, scores, 'commit') }; // Not planned: always by committed date (Tom, 2026-10-26)
    const noIssue = q.noIssue.filter((e) => e.fr.assignedTeam === 'Engineering');
    h += `<h3 class="lgroup">${esc(g.label)}</h3>`;
    // FRs with Notion comments first: the product-feature skill usually ran but found or made no issue,
    // so they need a manual check (Tom, 2026-10-26). Then the ones without comments.
    const cm = (e) => comments.get(e.fr.id);
    const withC = noIssue.filter((e) => cm(e)?.count > 0);
    const rest = noIssue.filter((e) => !(cm(e)?.count > 0));
    const sub = (label, n) => `<div class="lsubhead">${esc(label)} <span class="cnt">${n}</span></div>`;
    const body = (withC.length ? sub('Has comments: check manually', withC.length) + capped(withC, (e) => frCard(e.fr, cm(e)), `${g.key}-noIssueC`) : '')
      + (withC.length && rest.length ? sub('No comments yet', rest.length) : '') + capped(rest, (e) => frCard(e.fr, cm(e)), `${g.key}-noIssue`);
    h += section(`prep-${g.key}-noIssue`, 'No engineering issue', noIssue.length, withC.length ? `Product to create or link one · ${withC.length} with comments` : 'Product to create or link one', noIssue.length ? body : '<div class="placeholder">None.</div>');
    h += section(`prep-${g.key}-noEstimate`, 'No estimate', q.noEstimate.length, 'Issue without FE/BE/MOB effort', capped(q.noEstimate, (e) => listCard(e.issue, horizon, scores?.get(e.issue.id), '', noTeamTag(e, readOnly) + qaiEstBtn(e, readOnly)), `${g.key}-noEstimate`));
    h += section(`prep-${g.key}-notPlanned`, 'Not planned', q.notPlanned.length, q.notPlanned.length ? `${days(q.notPlanned)} d · the to-do list, by committed date` : 'the to-do list', capped(q.notPlanned, (e) => listCard(e.issue, horizon, scores?.get(e.issue.id), '', noTeamTag(e, readOnly)), `${g.key}-notPlanned`), true);
  }
  el.innerHTML = `<div class="lists">${h}</div>`;
}

export function tabCounts(risk, queues) {
  const r = risk ? RULES.reduce((a, x) => a + (risk[x.key]?.length || 0), 0) : null;
  // Tab count: Required for GO LIVE only (Tom, 2026-10-29), No estimate + Not planned; Top 3 still listed in the tab.
  const p = queues ? queues.goLive.noEstimate.length + queues.goLive.notPlanned.length : null;
  return { risk: r, prep: p };
}

const fd = (iso) => (iso ? formatDate(iso) : '–');
const link = (url, text) => (url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text));


const day = (d) => (d ? String(d).slice(0, 10) : null);
function planned(i) {
  if (!i.start && !i.end) return 'Not planned';
  if (i.start && i.end && day(i.start) !== day(i.end)) return `${fd(day(i.start))} → ${fd(day(i.end))}`;
  return `Pot · ${fd(day(i.end || i.start))}`;
}

/** History: this week per quarter, planner changes, Notion edits since the last sync. */
export function renderHistory(el, { audit, auditError, weekly, changes, users, syncedAt, growth, growthError, horizon = [], scores = null }) {
  const qs = [...(weekly || new Map()).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const weekRows = qs.map(([q, v]) => `<tr><td><b>${esc(q)}</b></td><td class="num">+${Math.round(v.in * 10) / 10}</td><td class="num">−${Math.round(v.out * 10) / 10}</td><td class="num"><b>${v.in - v.out >= 0 ? '+' : '−'}${Math.round(Math.abs(v.in - v.out) * 10) / 10}</b></td>
    <td>${v.items.map((i) => `<div class="hitem">${esc(i.name)}: ${esc(i.from || '–')} → ${esc(i.to || '–')} · ${Math.round(i.days * 10) / 10} d · <span class="${i.source === 'Notion' ? 'warnt' : ''}">${esc(i.source === 'Notion' ? 'Notion, no reason given' : i.reason || 'Planner, no reason')}</span></div>`).join('')}</td></tr>`).join('');
  const who = (a) => esc((a.by && users?.get(a.by)) || a.byText || 'Someone');
  const auditHtml = auditError ? `<div class="placeholder">Audit log unavailable: ${esc(auditError)}</div>` : !audit ? '<div class="placeholder">Reading the audit log from Notion…</div>'
    : audit.length ? audit.map((a) => `<div class="hrow"><div class="hwhen">${esc(formatDateTime(a.at))}<br><span class="muted">${who(a)}</span></div>
      <div><span class="tag">${esc(a.category)}</span> <b>${esc(a.itemName)}</b>${a.field === 'Comment' || a.field === 'Pushback' ? '' : `<div class="muted">${esc(a.field)}: ${esc(formatDatesIn(a.before) || '–')} → ${esc(formatDatesIn(a.after) || '–')}</div>`}
      ${a.reason ? `<div>Reason: ${esc(a.reason)}</div>` : ''}${a.warning ? `<div class="warnt">⚠ ${esc(formatDatesIn(a.warning))}</div>` : ''}</div></div>`).join('') : '<div class="placeholder">No planner changes yet.</div>';
  const notionHtml = (changes || []).length ? changes.map((c) => `<div class="hrow"><div class="hwhen muted">Notion</div><div><b>${esc(c.name)}</b><div class="muted">${c.fields.map((k) => `${esc(k)}: ${esc(formatDatesIn(c.before[k]) || '–')} → ${esc(formatDatesIn(c.after[k]) || '–')}`).join(' · ')}</div><div class="warnt">No reason given</div></div></div>`).join('')
    : '<div class="placeholder">No issues edited in Notion since the last sync.</div>';
  el.innerHTML = `<div class="lists">
    <div class="lhead"><b>History</b><span class="lsub">Planner changes from the audit log; Notion edits since the last Lightdash sync${syncedAt ? ` (${esc(formatDateTime(syncedAt))})` : ''}. Older Notion edits arrive once the snapshots are in Lightdash.</span></div>
    <h3 class="lgroup">This week, load per quarter</h3>
    ${qs.length ? `<table class="htable"><thead><tr><th>Quarter</th><th>In</th><th>Out</th><th>Net</th><th>What moved</th></tr></thead><tbody>${weekRows}</tbody></table>` : '<div class="placeholder">No load moved between quarters this week.</div>'}
    ${section('hist-planner', 'Planner changes', audit ? audit.length : '…', 'newest first', auditHtml, true)}
    ${section('hist-notion', 'Edited in Notion since the last sync', (changes || []).length, 'no reason given', notionHtml)}
    ${growth ? section('hist-growth', 'Effort grew 50% or more on a committed issue this quarter', growth.length, 'vs. effort when first seen this quarter (baseline kept since 10/10/2026)', capped(growth, (e) => listCard(e.issue, horizon, scores?.get(e.issue.id), e.detail), 'hist-growth'))
    : section('hist-growth', 'Effort grew 50% or more on a committed issue this quarter', '…', '', `<div class="placeholder">${growthError ? `Effort baseline unavailable: ${esc(growthError)}` : 'Reading the effort baseline from Notion…'}</div>`)}
  </div>`;
}

/**
 * Quarter plan (Tom, 2026-10-27): per quarter and team, every open engineering issue planned in it
 * (its end date falls in the quarter), with where it is planned, its committed date and its Priority,
 * which can be set right here. Sorted month pots, quarter pot, dated work; then committed date (none last).
 */
export function renderQuarterPlan(el, { run, grid, horizon, quarterKey, team = 'all', readOnly, scores = null, open = new Set(), sort = { key: 'plan', dir: 1 } }) {
  const q = horizon.find((x) => x.key === quarterKey) || horizon[0];
  const qi = horizon.indexOf(q);
  const qOf = (d) => { const [y, m] = String(d).split('-').map(Number); return `${y}-Q${Math.floor((m - 1) / 3) + 1}`; };
  const closed = new Set(['Done', "Won't do", 'Duplicate']);
  const inQ = (i) => i.end && qOf(i.end) === `${q.year}-Q${q.q}` && !closed.has(i.status) && !i.isParent && !(i.type || '').includes('Holiday');
  const planned = (i) => {
    if (i.start && i.start !== i.end) return `${formatDate(i.start)} → ${formatDate(i.end)}`;
    const m = q.months.find((x) => x.lastFriday === i.end);
    const label = i.end === q.lastFriday ? `${q.shortLabel} pot` : m ? `${m.label} pot` : 'Pot';
    return `${label} · ${formatDate(i.end)}`;
  };
  // Sort (Tom, 2026-10-27): month pots first (month order), then the quarter pot, then dated work by end
  // date; within each, committed date earliest first, issues with no commit after them.
  const rank = (i) => {
    if (i.start && i.start !== i.end) return [2, String(i.end)];
    if (i.end === q.lastFriday) return [1, '']; // same date as the last month's pot: shown as the quarter pot
    const m = q.months.findIndex((x) => x.lastFriday === i.end);
    return m >= 0 ? [0, String(m)] : [2, String(i.end)];
  };
  const byPlan = (a, b) => {
    const [ga, ka] = rank(a); const [gb, kb] = rank(b);
    return ga - gb || ka.localeCompare(kb) || (!a.committed) - (!b.committed) || String(a.committed || '').localeCompare(String(b.committed || ''));
  };
  // Column sort (Tom, 2026-10-30): click a header; again flips it. Effort largest first, dates earliest first,
  // priority Urgent first; empty values always last. "Planned" is the default order above.
  const PRIO = ['Urgent', 'High', 'Medium', 'Low', 'Not assigned'];
  const last = (v) => (v == null || v === '' ? null : v);
  const cmp = (f, desc = false) => (a, b) => { const x = last(f(a)), y = last(f(b)); if (x == null || y == null) return (x == null) - (y == null); const r = x < y ? -1 : x > y ? 1 : 0; return (desc ? -r : r) * sort.dir; };
  const sortBy = (k) => ({
    name: cmp((i) => String(i.name || '').toLowerCase()),
    fe: cmp((i) => i.skillEfforts?.frontend || null, true), be: cmp((i) => i.skillEfforts?.backend || null, true), mob: cmp((i) => i.skillEfforts?.mobile || null, true),
    committed: cmp((i) => i.committed || null),
    priority: cmp((i) => (PRIO.includes(i.priority) ? PRIO.indexOf(i.priority) : i.priority ? 5 : null)),
  }[k] || (() => 0));
  const th = (k, label, cls = '', title = '') => `<th class="${cls}"${title ? ` title="${title}"` : ''}><button type="button" class="qpsort ${sort.key === k ? 'on' : ''}" data-qpsort="${k}">${label}${sort.key === k ? (k === 'plan' ? ' ▾' : sort.dir === 1 ? ' ▾' : ' ▴') : ''}</button></th>`;
  const seg = `<span class="seg qpseg">${horizon.map((x) => `<button data-qp="${x.key}" class="${x.key === q.key ? 'on' : ''}">${esc(x.label)}</button>`).join('')}</span>`;
  const picked = pickedTeams(team);
  // One team filter only: the toolbar's (Tom, 2026-10-29: "2 ways to filter on team" was a bit much).
  let h = `<div class="lhead"><b>Quarter plan</b>${seg}<span class="lsub">Engineering issues planned in ${esc(q.label)} (end date in the quarter), per team. Set the issue Priority here; it is written to Notion and logged.</span></div>`;
  const teams = pickedTeams(team) || TEAMS;
  for (const tm of teams) {
    const list = run.issues.filter((i) => inQ(i) && issueTeams(run, i).has(tm)).sort(byPlan);
    if (sort.key !== 'plan') list.sort((a, b) => sortBy(sort.key)(a, b) || byPlan(a, b));
    const rows = list.map((i) => {
      const late = lateVsCommit(i);
      const pr = i.priority;
      const opts = [pr && !ISSUE_PRIORITIES.includes(pr) ? pr : null, ...ISSUE_PRIORITIES].filter(Boolean);
      const sel = readOnly ? esc(pr || '–') : `<select class="qpprio" data-qpissue="${i.id}" aria-label="Priority of ${esc(i.name)}">${pr ? '' : '<option value="" selected>–</option>'}${opts.map((o) => `<option ${o === pr ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      const name = i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.name)}</a>` : esc(i.name);
      const isOpen = open.has(i.id);
      const plan = `<button type="button" class="qpx ${isOpen ? 'on' : ''}" data-qpx="${i.id}" aria-expanded="${isOpen}" title="Move it, edit its FRs (commit, priority, comment)">${isOpen ? 'Close' : 'Plan'}</button>`;
      // Effort per skill in days (Tom, 2026-10-27); '–' when none. Phones show them as one line under the name.
      const ef = ['frontend', 'backend', 'mobile'].map((k) => Math.round((i.skillEfforts?.[k] || 0) * 10) / 10);
      const effCells = ef.map((v) => `<td class="num qpeff">${v ? v : '–'}</td>`).join('');
      const effLine = ['FE', 'BE', 'MOB'].map((s, k) => (ef[k] ? `${s} ${ef[k]}` : null)).filter(Boolean).join(' · ');
      const tiTag = /technical improvement/i.test(i.type || '') ? ' <span class="tag qtr" title="Technical improvement: counts against the team\'s tech improvement budget">Tech impr</span>' : '';
      // FRs and who drives the commit, under the name; click to open the FR list with Edit, as on the cards (Tom, 2026-10-30).
      const frs = scores ? `<div class="qpfr">${frBlock(scores.get(i.id), i.committed, i.id)}</div>` : '';
      const row = `<tr class="${isOpen ? 'qpopen' : ''}"><td>${name}${tiTag}${effLine ? `<span class="qpeffm"> · ${effLine} d</span>` : ''}${frs}</td>${effCells}<td class="num">${planned(i)}</td><td class="num qpcom ${late ? 'warnt' : ''}" ${late ? 'title="Planned after the committed date: move it to a month pot"' : ''}>${i.committed ? formatDate(i.committed) : '–'}</td><td>${sel}</td><td class="qpacts">${plan}</td></tr>`;
      return isOpen ? `${row}<tr class="qpact"><td colspan="8">${planActions(i, horizon, scores?.get(i.id))}</td></tr>` : row;
    }).join('');
    h += `<h3 class="lgroup">${esc(tm)} <span class="cnt">${list.length}</span></h3>`;
    // The team's capacity for this quarter, recalculated after every move (Tom, 2026-10-27), and per skill
    // a button to the suggestions (what to push out when over, what to pull in when there is room).
    const card = grid && qi >= 0 ? teamCard(grid, tm, q, qi) : '';
    if (card) {
      const sugg = grid.rows.filter((r) => r.team === tm && (r.quarters[qi].capacity || r.quarters[qi].planned)).map((r) => {
        const c = r.quarters[qi]; const d = Math.round((c.planned - c.capacity) * 10) / 10;
        return `<button type="button" class="chip ${d > 0 ? 'over' : ''}" data-suggest="1" data-team="${esc(tm)}" data-skill="${r.skill}" data-period="${q.key}">${r.skill} ${d > 0 ? `${d.toFixed(1)} d over: what to move out` : `${(-d).toFixed(1)} d free: what to pull in`}</button>`;
      }).join('');
      h += `<div class="qpcap">${card}<div class="chips qpsugg">${sugg}</div></div>`;
    }
    h += list.length ? `<table class="htable qptable"><thead><tr>${th('name', 'Issue')}${th('fe', 'FE', 'num', 'Frontend effort, days')}${th('be', 'BE', 'num', 'Backend effort, days')}${th('mob', 'MOB', 'num', 'Mobile effort, days')}${th('plan', 'Planned', 'num')}${th('committed', 'Committed', 'num')}${th('priority', 'Priority')}<th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="placeholder">Nothing planned in this quarter.</div>';
  }
  el.innerHTML = `<div class="lists">${h}</div>`;
}

/**
 * Data quality (Tom, 2026-10-28): one section per check, FR checks first. FR cards have Edit (priority,
 * committed date, Status Done / Won't do, the issue's status); issue cards the usual date buttons and
 * the #roadmap_product post (a template asking the lead for "Blocked/on hold, no open blocker").
 */
export function renderQuality(el, { quality, horizon, scores, loading, team, readOnly = false }) {
  if (!quality) { el.innerHTML = `<div class="lists"><div class="placeholder">${loading ? 'Data quality needs all FRs and the backlog. Loading them from Lightdash…' : 'Data quality unavailable: the FR or backlog load failed.'}</div></div>`; return; }
  const picked = pickedTeams(team);
  let h = `<div class="lhead"><b>Data quality</b><span class="lsub">${qualityCount(quality)} to fix across ${CHECKS.length} checks. Only FRs of signed customers count.${picked ? ' FRs show when one of their issues is in the picked teams; FRs with no issue only under All teams.' : ''}</span></div>`;
  let side = null;
  for (const c of CHECKS) {
    if (c.side !== side) { side = c.side; h += `<h3 class="lgroup">${side === 'fr' ? 'Feature requests' : 'Engineering issues'}</h3>`; }
    const list = quality[c.key];
    // Fix… opens the ways to solve this finding (Tom, 2026-10-28).
    const fix = (e) => (readOnly ? '' : `<button type="button" class="fixbtn" data-dqfix="${c.key}" data-dqid="${e.fr ? e.fr.id : e.issue.id}" title="${esc(c.fix)}">Fix…</button>`);
    const card = (e) => (e.fr ? qualityFrCard(e.fr, e.detail, e.issue, fix(e)) : listCard(e.issue, horizon, scores?.get(e.issue.id), e.detail, fix(e), c.key === 'blockedNoBlocker' ? { kind: 'blocked' } : null));
    h += section(`dq-${c.key}`, c.label, list.length, c.fix, capped(list, card, `dq-${c.key}`));
  }
  el.innerHTML = `<div class="lists">${h}</div>`;
}
