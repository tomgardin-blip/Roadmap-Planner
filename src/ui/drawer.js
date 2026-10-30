// Cell drawer: the issues behind one grid cell with the days they put there, plus the
// layout of the date buttons (disabled until checkpoint 5) and, on quarter totals, the
// push-out / pull-forward / quick-win suggestions (src/suggestions.js).

import { cellIssues } from '../capacity.js';
import { formatDate, lateVsCommit, potQuarters, potMonths } from '../periods.js';
import { pushOut, pullForward } from '../suggestions.js';
import { isAllowed } from '../notion/writes.js';

// Read-only mode (viewers who cannot edit the artifact): no write controls anywhere.
let readOnly = false;
export const setReadOnly = (v) => { readOnly = !!v; };

// Issues and FRs rendered in the drawer, by id, for the write flows (src/ui/actions.js).
const shown = { issues: new Map(), frs: new Map() };
export const shownIssue = (id) => shown.issues.get(id);

// Bulk select (Tom, 2026-10-26): ticked issues, moved together from the bulk bar. Survives redraws.
const selected = new Set();
export const selectedIssues = () => [...selected];
export const toggleSelected = (id, on) => { if (on) selected.add(id); else selected.delete(id); };
export const clearSelected = () => selected.clear();
function selBox(issue) {
  if (readOnly || !isAllowed('issue', issue.id)) return '';
  return `<input type="checkbox" class="bsel" data-bsel="${issue.id}" ${selected.has(issue.id) ? 'checked' : ''} title="Select to move several issues at once" aria-label="Select ${esc(issue.name)}">`;
}
export const shownFr = (id) => shown.frs.get(id);

// Bulk FR edit (Tom, 2026-10-29): ticked "No engineering issue" FRs, edited together. Survives redraws.
const frSelected = new Set();
export const selectedFrs = () => [...frSelected];
export const toggleFrSelected = (id, on) => { if (on) frSelected.add(id); else frSelected.delete(id); };
export const clearFrSelected = () => frSelected.clear();
function frSelBox(fr) {
  if (readOnly || !isAllowed('fr', fr.id)) return '';
  return `<input type="checkbox" class="frsel" data-frsel="${fr.id}" ${frSelected.has(fr.id) ? 'checked' : ''} title="Select to edit several FRs at once" aria-label="Select ${esc(fr.title || 'FR')}"> `;
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (Math.round(n * 10) / 10).toString();
const SKILL_KEY = { FE: 'frontend', BE: 'backend', MOB: 'mobile' };
const ALL_SKILL_LABELS = { frontend: 'FE', backend: 'BE', mobile: 'MOB', ai: 'AI', bi: 'BI', analyst: 'Analyst', infra: 'Infra' };

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
  shown.issues.set(issue.id, issue);
  if (readOnly) return '';
  const can = isAllowed('issue', issue.id);
  const pot = issue.start && issue.start === issue.end;
  const tip = (d) => (can ? `Set Start = End = ${formatDate(d)} in Notion` : 'No Notion id');
  const btn = (d, label, cur) => `<button ${can ? '' : 'disabled'} class="${cur ? 'cur' : ''}" data-move="${d}" data-label="${label}" data-issue="${issue.id}" title="${tip(d)}">${label}</button>`;
  // Months on one row, quarter pots on the row below (Tom, 2026-10-29).
  let h = '<div class="datebtns">';
  for (const m of potMonths(horizon)) h += btn(m.lastFriday, m.label, pot && issue.end === m.lastFriday && issue.end !== m.quarterEnd);
  h += '</div><div class="datebtns qbtns">';
  for (const q of potQuarters(horizon)) h += btn(q.lastFriday, q.shortLabel, pot && issue.end === q.lastFriday);
  return h + '</div>';
}

const FIELD_LABEL = { start: 'Start', end: 'End', fe: 'FE', be: 'BE', mob: 'MOB', team: 'Team', status: 'Status' };
const showVal = (k, v) => (v == null || v === '' ? '–' : (k === 'start' || k === 'end') ? formatDate(v) : String(v));

// Hover (or long-press) explains the score: the formula and this issue's own numbers.
const SCORE_HOW = 'Score = customer demand ÷ effort days (FE + BE + MOB). Demand: each open FR adds its priority weight (Needed for go-live / 1 month before 10, Top 3 5, High 3, Medium 2, Low 1, others 0) × the customer\'s deal size (≥ £75k ×2, ≥ £25k ×1.5, else ×1). Higher = more customer value per day of work.';
const scoreTag = (s) => (s ? `<span class="tag score" tabindex="0" title="${SCORE_HOW}&#10;&#10;This issue: demand ${fmt(s.demand)} ÷ effort ${fmt(s.effort)} d = ${fmt(s.score ?? 0)} · ${s.frCount} FRs, ${s.customers} customers">Score ${fmt(s.score ?? 0)}</span>` : '');

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
// committed: the issue's (effective) committed date. The FR(s) with that same committed date set it
// (Tom, 2026-10-27): flagged in the summary and on the row, and listed first.
function frBlock(s, committed = null, issueId = null) {
  if (!s) return '';
  const day = committed ? String(committed).slice(0, 10) : null;
  if (!s.frs.length) return `<div class="frs none">0 FRs${day ? ` · ${commitSource(issueId, day) || 'commit not from an FR'}` : ''}</div>`;
  const setsCommit = (f) => !!day && f.committed === day;
  const setters = s.frs.filter(setsCommit);
  const gl = s.frs.filter((f) => GO_LIVE.has(f.priority)).length;
  const t3 = s.frs.filter((f) => f.priority === 'Top 3').length;
  const by = setters.length ? `commit set by ${esc(setters.map((f) => dealNames.get(nidOf(f.dealId)) || 'No customer').filter((v, i, a) => a.indexOf(v) === i).join(', '))}`
    : day ? (commitSource(issueId, day) || '<span title="No linked FR has this committed date: it comes from the issue itself or from an issue it blocks">commit not from an FR</span>') : '';
  const sum = [`<b>${s.frs.length} FR${s.frs.length === 1 ? '' : 's'}</b>`, `${s.customers} customer${s.customers === 1 ? '' : 's'}`, gl && `<span class="gl">${gl} go-live</span>`, t3 && `${t3} Top 3`, by].filter(Boolean).join(' · ');
  const rows = [...s.frs].sort((a, b) => setsCommit(b) - setsCommit(a) || b.points - a.points || String(a.priority).localeCompare(String(b.priority))).map((f) => {
    const cust = dealNames.get(nidOf(f.dealId)) || 'No customer';
    const t = f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.title || 'FR')}</a>` : esc(f.title || 'FR');
    return frLine({ ...f, setsCommit: setsCommit(f) }, cust, t, issueId);
  }).join('');
  return `<details class="frs"${issueId ? ` data-fold="frs-${issueId}"` : ''}><summary>${sum}</summary><ul>${rows}</ul></details>`;
}

// issueId: the engineering issue the FR is shown under, so the edit sheet can also set its status.
function frLine(f, cust, titleHtml, issueId = null, pre = '') {
  shown.frs.set(f.id, f);
  const edit = !readOnly && isAllowed('fr', f.id)
    ? `<button class="fredit" data-fr-edit="${f.id}"${issueId ? ` data-issue="${issueId}"` : ''}>Edit</button>`
    : '';
  const commit = f.setsCommit ? ` <span class="tag commit" title="This FR's committed date is the issue's committed date">Sets the commit · ${formatDate(f.committed)}</span>`
    : f.committed ? ` <span class="muted">commit ${formatDate(f.committed)}</span>` : '';
  return `<li>${pre}<span class="tag ${GO_LIVE.has(f.priority) ? 'late' : f.priority === 'Top 3' ? 'qw' : ''}">${esc(f.priority || 'No priority')}</span> <b>${esc(cust)}</b>${commit}${f.multiplier > 1 ? ` <span class="mult">×${f.multiplier}</span>` : ''}${edit}<div class="frt">${titleHtml}${f.meta ? ` · ${esc(f.meta)}` : ''}${f.status ? ` · <span title="Feature request status (Customer Tasks)">FR status: ${esc(f.status)}</span>` : ''}</div></li>`;
}

// FE, BE and MOB effort, the cell's skill in bold (Tom, 2026-10-30: see what pulling forward does to the other skills).
const effAll = (issue, skill) => ['FE', 'BE', 'MOB'].map((s) => { const v = issue.skillEfforts?.[SKILL_KEY[s]] || 0; return v ? (s === skill ? `<b>${s} ${fmt(v)} d</b>` : `${s} ${fmt(v)} d`) : null; }).filter(Boolean).join(' · ');

/** Compact row for a suggestion list. */
function suggestion(x, skill, label, keepBtn = false) {
  const { issue } = x;
  shown.issues.set(issue.id, issue); // the bulk bar moves ticked suggestions too (Tom, 2026-10-29)
  const title = issue.url ? `<a href="${esc(issue.url)}" target="_blank" rel="noopener">${esc(issue.name)}</a>` : esc(issue.name);
  const tags = [
    x.quickWin ? '<span class="tag qw">Quick win</span>' : '',
    x.late ? `<span class="tag late">After commit ${formatDate(issue.committed)}</span>` : issue.committed ? `<span class="tag commit">Commit ${formatDate(issue.committed)}</span>` : '',
    scoreTag(x.score),
    `<span class="tag">${whenOf(issue)}</span>`,
    issue.status ? `<span class="tag" title="Engineering issue status (Bugs & Features)">EI: ${esc(issue.status)}</span>` : '',
  ].join('');
  const keep = keepBtn && !readOnly && isAllowed('issue', issue.id) ? `<button type="button" class="fredit keepbtn" data-keep="${issue.id}" title="Take it out of the push-out suggestions (logged; Suggest again undoes it)">Keep, don't suggest</button>` : '';
  return `<div class="sugg"><div class="t">${selBox(issue)}${title}${keep}</div><div class="meta">${tags}<span class="eff">${effAll(issue, skill)}${label ? ` · ${label}` : ''}</span></div>${frBlock(x.score, x.issue?.committed, x.issue?.id)}</div>`;
}

// "Select all" on a suggestion list (Tom, 2026-10-29), plus "down to the line" when part of it covers the overbooking.
function selAll(items, toLine = null) {
  if (readOnly) return '';
  const ids = (xs) => xs.map((x) => x.issue.id).filter((id) => isAllowed('issue', id)).join(',');
  return `<div class="selall"><button type="button" class="fredit" data-selall="${ids(items)}">Select all ${items.length}</button>${toLine && toLine.length < items.length ? `<button type="button" class="fredit" data-selall="${ids(toLine)}">Select down to the line (${toLine.length})</button>` : ''}<button type="button" class="fredit" data-selnone="${ids(items)}">Select none</button><span class="muted">then pick a month or quarter in the bar at the bottom</span></div>`;
}

function suggestions({ run, scores, backlog, extra, team, skill, quarter, c, kept, otherFree = {} }) {
  const diff = c.planned - c.capacity;
  if (extra.scores === 'loading') return '<h4>Suggestions</h4><div class="placeholder">Loading FR demand from Lightdash for the scores…</div>';
  if (extra.scores === 'error') return `<h4>Suggestions</h4><div class="placeholder">Scores unavailable: ${esc(extra.scoresError || '')}</div>`;
  if (diff > 1e-9) {
    const p = pushOut({ run, scores, team, skill, quarter, over: diff, kept });
    const ex = [p.excluded.committed && `${p.excluded.committed} committed`, p.excluded.inProgress && `${p.excluded.inProgress} in progress`, p.excluded.kept && `${p.excluded.kept} kept by you`, p.excluded.fixed && `${p.excluded.fixed} dependency upgrades (never moved)`].filter(Boolean).join(', ');
    let h = `<h4>Suggested to push out · ${fmt(diff)} d over</h4><div class="hint">No commit, not in progress. Lowest customer value per day first, then the biggest; quick wins last (keep those).${ex ? ` Not shown: ${ex}.` : ''}</div>`;
    if (!p.items.length) return `${h}<div class="placeholder">Nothing movable: everything here is committed or in progress.</div>`;
    h += selAll(p.items, p.coverIdx >= 0 ? p.items.slice(0, p.coverIdx + 1) : null);
    p.items.forEach((x, i) => {
      h += suggestion(x, skill, `${fmt(x.cumulative)} d moved`, true);
      if (i === p.coverIdx) h += `<div class="coverline">Overbooking covered above this line</div>`;
    });
    if (p.coverIdx < 0) h += `<div class="coverline bad">Still ${fmt(diff - p.items[p.items.length - 1].cumulative)} d over after moving all of these</div>`;
    return h;
  }
  const free = -diff;
  const p = pullForward({ run, scores, team, skill, quarter, free, backlog, otherFree });
  const note = extra.backlog === 'loading' ? ' Unplanned backlog still loading.' : extra.backlog === 'error' ? ' Unplanned backlog unavailable.' : '';
  const r1 = (v) => Math.round(v * 10) / 10;
  const others = Object.entries(otherFree).filter(([k, f]) => k !== skill && f != null);
  const full = others.filter(([, f]) => r1(f) <= 0).map(([k]) => k);
  // Other skills of this team and quarter, in plain sight (Tom, 2026-10-30: "I don't see this").
  const otherLine = others.length ? `<div class="othersk">${others.map(([k, f]) => `<span class="tag ${r1(f) < 0 ? 'late' : r1(f) === 0 ? '' : 'commit'}">${k} ${r1(f) < 0 ? `${fmt(-r1(f))} d over` : `${fmt(r1(f))} d free`}</span>`).join('')}<span>${full.length ? `Only issues without ${full.join(' or ')} effort` : 'Effort on these must fit too'}${p.otherSkill ? ` · ${p.otherSkill} left out for that` : ''}</span></div>` : '';
  let h = `<h4>Suggested to pull forward · ${fmt(free)} d free</h4><div class="hint">Planned later or not planned, fits the free days, not blocked. Committed first (buys margin), then highest score; quick wins are in the list, tagged.${note}</div>${otherLine}`;
  // Top 20, the rest behind "Show all" (decided 2026-10-10). Push out stays a full list.
  const top = p.items.slice(0, 20).map((x) => suggestion(x, skill)).join('');
  const rest = p.items.slice(20).map((x) => suggestion(x, skill)).join('');
  if (p.items.length) h += selAll(p.items);
  h += top || '<div class="placeholder">Nothing fits the free days.</div>';
  if (rest) h += `<details class="more"><summary>Show all ${p.items.length}</summary>${rest}</details>`;
  return h;
}

function issueCard({ issue, days }, skill, horizon, change, score, kept = false) {
  const late = lateVsCommit(issue);
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
    issue.status ? `<span class="tag ${/^Blocked/.test(issue.status) ? 'blocked' : ''}" title="Engineering issue status (Bugs & Features)">EI: ${esc(issue.status)}</span>` : '',
    change ? `<span class="tag live" title="${esc(change.fields.map((k) => `${FIELD_LABEL[k]}: ${showVal(k, change.before[k])} → ${showVal(k, change.after[k])}`).join('\n'))}">Live from Notion: ${esc(change.fields.map((k) => FIELD_LABEL[k]).join(', '))} changed</span>` : '',
  ].join('');
  const title = issue.url && !issue.url.includes('example.invalid')
    ? `<a href="${esc(issue.url)}" target="_blank" rel="noopener">${esc(issue.name)}</a>` : esc(issue.name);
  const keepTag = kept ? `<span class="tag">Kept, not suggested</span>${readOnly ? '' : `<button type="button" class="fredit keepbtn" data-unkeep="${issue.id}" title="Put it back in the push-out suggestions (logged)">Suggest again</button>`}` : '';
  return `<div class="issue"><div class="t">${selBox(issue)}${title}</div>
    <div class="meta">${tags}${keepTag}<span class="eff">${eff} d</span><span><b>${fmt(days)}</b> d in this cell</span></div>
    ${frBlock(score, issue.committed, issue.id)}
    ${dateButtons(issue, horizon)}</div>`;
}

/** Planning actions for one issue (Quarter plan row): its FRs with Edit, then the month and quarter pot buttons. */
export function planActions(issue, horizon, score) {
  return `${frBlock(score, issue.committed, issue.id)}${estimateLinks(issue.id)}${dateButtons(issue, horizon)}${roadmapBtn(issue)}`;
}

// Post in #roadmap_product about this issue (Tom, 2026-10-27).
// Posts already made show as a link to the Slack message, to follow the replies (Tom, 2026-10-27).
let roadmapPosts = () => [];
export const setRoadmapPosts = (fn) => { roadmapPosts = fn; };
const roadmapBtn = (issue, rm = null) => {
  if (!issue.id) return '';
  const posts = roadmapPosts(issue.id);
  const last = posts[0];
  const links = last ? `<span class="rmlinks">${last.link ? `<a href="${esc(last.link)}" target="_blank" rel="noopener">Posted ${formatDate(String(last.at).slice(0, 10))} · open in Slack</a>` : `Posted ${formatDate(String(last.at).slice(0, 10))}`}${posts.length > 1 ? ` <span class="muted">(${posts.length} posts)</span>` : ''}</span>` : '';
  const btn = readOnly ? '' : `<button type="button" class="fredit rmpost" data-rmpost="${issue.id}"${rm ? ` data-rmkind="${rm.kind}"${rm.blockerId ? ` data-rmblocker="${rm.blockerId}"` : ''}` : ''} title="Post in #roadmap_product: your message, tagging the team's responsible, ending with the link, planned dates and committed date">${last ? 'Post again' : 'Post in #roadmap_product'}</button>`;
  return btn || links ? `<div class="cardacts">${btn}${links}</div>` : '';
};

// Posts to #product-create-ei-skill-trigger, #dev_effort_estimate or the Qai DM about this issue or FR
// (Tom, 2026-10-29): the latest per channel, linking to the Slack thread to follow the replies.
let estimatePosts = () => [];
export const setEstimatePosts = (fn) => { estimatePosts = fn; };
function estimateLinks(id) {
  const latest = new Map();
  for (const p of estimatePosts(id)) if (!latest.has(p.channel)) latest.set(p.channel, p);
  if (!latest.size) return '';
  const one = (p) => { const t = `${esc(p.channel)} ${formatDate(String(p.at).slice(0, 10))}`; return p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener" title="Open the Slack thread">${t} · open in Slack</a>` : `${t} (no link saved)`; };
  return `<div class="estlinks">Posted: ${[...latest.values()].map(one).join(' · ')}</div>`;
}

export const setDealNames = (m) => { dealNames = m; };
// (issueId, day) → html naming what sets an issue's committed date when no listed FR does (Tom, 2026-10-27).
let commitSource = () => null;
export const setCommitSource = (fn) => { commitSource = fn; };

/** Issue card for the list screens (at risk, prep queues): same tags, FRs and date buttons as the drawer. */
export function listCard(issue, horizon, score, detail, extraTags = '', rm = null) {
  // Every skill with effort, not only FE/BE/MOB (Tom, 2026-10-29: an AI-only issue showed "No effort").
  const eff = Object.entries(ALL_SKILL_LABELS).map(([k, l]) => { const v = issue.skillEfforts?.[k] || 0; return v ? `${l} ${fmt(v)}` : null; }).filter(Boolean).join(' · ') || 'No effort';
  const late = lateVsCommit(issue);
  const tags = [
    issue.committed ? `<span class="tag ${late ? 'late' : 'commit'}">${late ? 'After commit ' : 'Commit '}${formatDate(issue.committed)}</span>` : '',
    `<span class="tag">${whenOf(issue)}</span>`,
    scoreTag(score),
    issue.team ? `<span class="tag">${esc(issue.team)}</span>` : '',
    issue.status ? `<span class="tag ${issue.status === 'Blocked/on hold' ? 'blocked' : ''}" title="Engineering issue status (Bugs & Features)">EI: ${esc(issue.status)}</span>` : '',
    extraTags,
  ].join('');
  const title = issue.url ? `<a href="${esc(issue.url)}" target="_blank" rel="noopener">${esc(issue.name)}</a>` : esc(issue.name);
  return `<div class="issue"><div class="t">${selBox(issue)}${title}</div>
    <div class="meta">${tags}<span class="eff">${eff === 'No effort' ? eff : `${eff} d`}</span></div>
    ${detail ? `<div class="detail">${esc(detail)}</div>` : ''}
    ${frBlock(score, issue.committed, issue.id)}
    ${estimateLinks(issue.id)}${dateButtons(issue, horizon)}${roadmapBtn(issue, rm)}</div>`;
}

/** FR card for the "no engineering issue" queue. */
export function frCard(fr, comments) {
  const cust = dealNames.get(nidOf(fr.dealId)) || 'No customer';
  const title = fr.url ? `<a href="${esc(fr.url)}" target="_blank" rel="noopener">${esc(fr.title || 'FR')}</a>` : esc(fr.title || 'FR');
  const meta = [fr.committed ? `Committed ${formatDate(String(fr.committed).slice(0, 10))}` : '', fr.assignedTeam ? `Team ${fr.assignedTeam}` : 'No assigned team'].filter(Boolean).join(' · ');
  return `<div class="issue"><ul class="frlist">${frLine({ ...fr, meta }, cust, title, null, frSelBox(fr))}</ul>${commentLine(comments)}${estimateLinks(fr.id)}</div>`;
}

/** FR card for Data quality (Tom, 2026-10-28): the FR with Edit (opened from its issue, so the issue status is editable too), what is wrong, and its issue. */
export function qualityFrCard(fr, detail, issue = null, fix = '') {
  const cust = dealNames.get(nidOf(fr.dealId)) || 'No customer';
  const title = fr.url ? `<a href="${esc(fr.url)}" target="_blank" rel="noopener">${esc(fr.title || 'FR')}</a>` : esc(fr.title || 'FR');
  const iss = issue ? `<div class="detail muted">Issue: ${issue.url ? `<a href="${esc(issue.url)}" target="_blank" rel="noopener">${esc(issue.name)}</a>` : esc(issue.name)}${issue.status ? ` · EI: ${esc(issue.status)}` : ''}${issue.team ? ` · ${esc(issue.team)}` : ''}</div>` : '';
  return `<div class="issue"><ul class="frlist">${frLine({ ...fr, setsCommit: false }, cust, title, issue?.id || null)}</ul>${detail ? `<div class="detail">${esc(detail)}</div>` : ''}${iss}${estimateLinks(fr.id)}${fix ? `<div class="cardacts">${fix}</div>` : ''}</div>`;
}

// Comments on the FR in Notion: count, and the latest one (who, when, first words).
function commentLine(c) {
  if (c === undefined) return '<div class="cmt muted">Comments loading…</div>';
  if (!c || c.error) return `<div class="cmt muted">Comments unavailable${c?.error ? `: ${esc(c.error)}` : ''}</div>`;
  if (!c.count) return '<div class="cmt muted">No comments</div>';
  const t = c.last.text.length > 220 ? `${c.last.text.slice(0, 220)}…` : c.last.text;
  return `<div class="cmt"><span class="tag qw">💬 ${c.count} comment${c.count === 1 ? '' : 's'}</span> <span class="muted">Latest${c.last.name ? ` by ${esc(c.last.name)}` : ''}${c.last.at ? `, ${formatDate(c.last.at.slice(0, 10))}` : ''}:</span> ${esc(t)}</div>`;
}

export function openDrawer(el, { run, grid, horizon, changes = [], scores = null, backlog = [], extra = {}, names = new Map(), kept = new Set(), team, skill, period }) {
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
  // Cell list (Tom, 2026-10-29): suggestions first, then the other uncommitted issues (suggested ones not
  // repeated), committed issues at the bottom.
  // Free days of the team's other skills in this quarter, so pull forward never overbooks them (Tom, 2026-10-30).
  const otherFree = {};
  if (quarter) for (const s of ['FE', 'BE', 'MOB']) {
    const r = grid.rows.find((x) => x.team === team && x.skill === s);
    const oc = r && cellInfo(r, horizon, period).c;
    otherFree[s] = oc && oc.capacity != null ? oc.capacity - oc.planned : null;
  }
  const sugg = quarter ? suggestions({ run, scores, backlog, extra, team, skill, quarter, c, kept, otherFree }) : hasCap ? '<div class="hint">Suggestions are on the quarter total: month cells are neutral.</div>' : '';
  const suggested = new Set(quarter && over && extra.scores === 'ok' ? pushOut({ run, scores, team, skill, quarter, over: diff, kept }).items.map((x) => x.issue.id) : []);
  // Kept ones show in the uncommitted list with "Suggest again".
  const card = (x) => issueCard(x, skill, horizon, byId.get(x.issue.id), scores?.get(x.issue.id), kept.has(x.issue.id));
  const committed = list.filter((x) => x.issue.committed);
  const rest = list.filter((x) => !x.issue.committed && !suggested.has(x.issue.id));

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
      ${sugg}
      ${rest.length ? `<h4>${suggested.size ? 'Other uncommitted issues in this cell, not suggested' : 'Uncommitted issues in this cell'} · ${rest.length}</h4>${suggested.size ? '<div class="hint">In progress, kept by you, or a dependency upgrade, so not suggested. Suggested ones are listed above only.</div>' : ''}${rest.map(card).join('')}` : ''}
      <h4>Committed issues in this cell · ${committed.length}</h4><div class="hint">Never suggested: moving them needs a pushback first. Earliest commit first.</div>
      ${committed.map(card).join('') || '<div class="placeholder">None.</div>'}
    </div>`;
  el.classList.add('open');
}

export function closeDrawer(el) {
  el.classList.remove('open');
}
