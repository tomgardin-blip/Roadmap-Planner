// List screens: At risk and Prep queues. Built from src/atrisk.js and src/prep.js; every card
// carries the same date buttons and FR edit as the drawer.

import { RULES } from '../atrisk.js';
import { GROUPS } from '../prep.js';
import { listCard, frCard } from './drawer.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SK = ['frontend', 'backend', 'mobile'];
const days = (list) => Math.round(list.reduce((a, e) => a + SK.reduce((b, s) => b + (e.issue?.skillEfforts?.[s] || 0), 0), 0));
const LIMIT = 30;

// Default order (Tom, 2026-10-26): highest customer value first. Scored issues by score; issues with
// no effort (no score) by their demand; ties by committed date. 'commit' restores the old order.
export function sortEntries(list, scores, mode = 'value') {
  const commit = (e) => String(e.issue?.committed || '9');
  const byCommit = (a, b) => commit(a).localeCompare(commit(b));
  if (mode === 'commit') return [...list].sort(byCommit);
  const s = (e) => scores?.get(e.issue?.id);
  const key = (e) => { const x = s(e); return x ? [x.score != null ? 1 : 0, x.score ?? x.demand ?? 0] : [0, -1]; };
  return [...list].sort((a, b) => { const ka = key(a), kb = key(b); return kb[0] - ka[0] || kb[1] - ka[1] || byCommit(a, b); });
}
const sortSel = (mode) => `<label class="lchk lsort">Sort <select id="listSort"><option value="value" ${mode !== 'commit' ? 'selected' : ''}>Customer value (score), highest first</option><option value="commit" ${mode === 'commit' ? 'selected' : ''}>Committed date, earliest first</option></select></label>`;

function section(id, title, count, sub, body, open = false) {
  return `<details class="lsec" ${open ? 'open' : ''} id="${id}"><summary><b>${esc(title)}</b><span class="cnt">${count}</span>${sub ? `<span class="lsub">${esc(sub)}</span>` : ''}</summary><div class="lbody">${body}</div></details>`;
}
function capped(items, render, key) {
  if (!items.length) return '<div class="placeholder">None.</div>';
  const head = items.slice(0, LIMIT).map(render).join('');
  const rest = items.slice(LIMIT).map(render).join('');
  return head + (rest ? `<details class="more" data-more="${key}"><summary>Show all ${items.length}</summary>${rest}</details>` : '');
}

export function renderAtRisk(el, { risk, horizon, scores, loading, baselineError, sort = 'value' }) {
  const baselineNote = baselineError ? `Effort baseline unavailable: ${baselineError}` : 'Reading the effort baseline from Notion…';
  const total = RULES.reduce((a, r) => a + (risk[r.key]?.length || 0), 0);
  let h = `<div class="lhead"><b>At risk</b><span class="lsub">${total} flags across ${RULES.length} rules${loading ? ' · scores loading' : ''}. Commit dates are effective commits (earliest of the issue, its FRs and what it blocks).</span>${sortSel(sort)}</div>`;
  for (const r of RULES) {
    const list = risk[r.key] && sortEntries(risk[r.key], scores, sort);
    if (!list) { h += section(`risk-${r.key}`, r.label, '…', baselineNote, `<div class="placeholder">${baselineNote}</div>`); continue; }
    const sub = r.key === 'effortGrowth' ? 'vs. effort when first seen this quarter (baseline kept since 10 Oct 2026)' : list.length ? `${days(list)} d` : '';
    h += section(`risk-${r.key}`, r.label, list.length, sub, capped(list, (e) => listCard(e.issue, horizon, scores?.get(e.issue.id), e.detail), r.key), r.key === 'afterCommit');
  }
  el.innerHTML = `<div class="lists">${h}</div>`;
}

export function renderPrep(el, { queues, horizon, scores, loading, allFrTeams, readOnly, sort = 'value' }) {
  if (!queues) { el.innerHTML = `<div class="lists"><div class="placeholder">${loading ? 'Prep queues need all FRs and the unplanned backlog. Loading them from Lightdash…' : 'Prep queues unavailable: the FR or backlog load failed.'}</div></div>`; return; }
  let h = `<div class="lhead"><b>Prep queues</b><span class="lsub">What blocks planning, per FR priority. Only FRs of signed customers (deal Closed-Won) count. An issue sits under its highest-priority FR.</span>
    ${readOnly ? '' : '<button class="estbtn" id="estPost" title="Post the No estimate issues to #product-create-ei-skill-trigger after a preview">Post No estimate to #product-create-ei-skill-trigger</button>'}
    <label class="lchk"><input type="checkbox" id="allFrTeams" ${allFrTeams ? 'checked' : ''}> No-issue list: include FRs not assigned to Engineering</label>${sortSel(sort)}</div>`;
  for (const g of GROUPS) {
    const q = { ...queues[g.key], noEstimate: sortEntries(queues[g.key].noEstimate, scores, sort), notPlanned: sortEntries(queues[g.key].notPlanned, scores, sort) };
    const noIssue = allFrTeams ? q.noIssue : q.noIssue.filter((e) => e.fr.assignedTeam === 'Engineering');
    h += `<h3 class="lgroup">${esc(g.label)}</h3>`;
    h += section(`prep-${g.key}-noIssue`, 'No engineering issue', noIssue.length, 'Product to create or link one', capped(noIssue, (e) => frCard(e.fr), `${g.key}-noIssue`));
    h += section(`prep-${g.key}-noEstimate`, 'No estimate', q.noEstimate.length, 'Issue without FE/BE/MOB effort', capped(q.noEstimate, (e) => listCard(e.issue, horizon, scores?.get(e.issue.id), '', e.noTeam ? '<span class="tag late">No team</span>' : ''), `${g.key}-noEstimate`));
    h += section(`prep-${g.key}-notPlanned`, 'Not planned', q.notPlanned.length, q.notPlanned.length ? `${days(q.notPlanned)} d · the to-do list` : 'the to-do list', capped(q.notPlanned, (e) => listCard(e.issue, horizon, scores?.get(e.issue.id), '', e.noTeam ? '<span class="tag late">No team</span>' : ''), `${g.key}-notPlanned`), true);
  }
  el.innerHTML = `<div class="lists">${h}</div>`;
}

export function tabCounts(risk, queues) {
  const r = risk ? RULES.reduce((a, x) => a + (risk[x.key]?.length || 0), 0) : null;
  const p = queues ? GROUPS.reduce((a, g) => a + queues[g.key].noEstimate.length + queues[g.key].notPlanned.length, 0) : null;
  return { risk: r, prep: p };
}

const fd = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '–');
const link = (url, text) => (url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>` : esc(text));

/** Pushback candidates: one row per committed FR, easiest to challenge first. */
export function renderPushback(el, { list, loading, owners, names, overbookedOnly, readOnly, team }) {
  if (!list) { el.innerHTML = `<div class="lists"><div class="placeholder">${loading ? 'Pushback needs all FRs and scores. Loading them from Lightdash…' : 'Pushback unavailable: the FR load failed.'}</div></div>`; return; }
  const row = (c) => {
    const owner = owners?.get(c.fr.id.replace(/-/g, ''));
    const cust = names.get(String(c.fr.dealId || '').replace(/-/g, '').toLowerCase()) || 'No customer';
    const btns = readOnly ? '' : `<button class="fredit" data-fr-edit="${c.fr.id}">Edit FR</button><button class="fredit" data-dismiss="${c.fr.id}" data-issue="${c.issue.id}">Not a pushback</button>`;
    return `<div class="issue pb"><div class="t">${link(c.fr.url, c.fr.title || 'FR')} ${btns}</div>
      <div class="meta"><span class="tag">${esc(c.fr.priority || 'No priority')}</span><span class="tag commit">Commit ${fd(c.fr.committed)}</span><b>${esc(cust)}</b>
        <span class="tag ${owner ? '' : 'late'}">${owner ? `COM/AM ${esc(owner)}` : owners ? 'No Responsible Success' : 'COM/AM loading…'}</span></div>
      <div class="meta">Issue ${link(c.issue.url, c.issue.name)} · ${esc(c.issue.team || '')} · <b>${c.customers}</b> customer${c.customers === 1 ? '' : 's'} · <b>${Math.round(c.effort * 10) / 10}</b> d${c.quarter ? ` · ${esc(c.quarter)}` : ''}${c.inOverbooked ? ' <span class="tag late">Overbooked quarter</span>' : ''}${c.deal ? ` · deal £${Math.round(c.deal / 1000)}k` : ''}</div></div>`;
  };
  el.innerHTML = `<div class="lists"><div class="lhead"><b>Pushback candidates</b><span class="lsub">${list.length} committed FRs${team !== 'all' ? ` · ${esc(team)}` : ''}. Easiest to challenge first: fewest customers on the issue, then highest effort, then smallest deal. A suggestion; "Not a pushback" is logged.</span>
    <label class="lchk"><input type="checkbox" id="pbOverbooked" ${overbookedOnly ? 'checked' : ''}> Only issues in overbooked quarters</label></div>
    ${capped(list, row, 'pushback')}</div>`;
}

/** History: this week per quarter, planner changes, Notion edits since the last sync. */
export function renderHistory(el, { audit, auditError, weekly, changes, users, syncedAt }) {
  const qs = [...(weekly || new Map()).entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const weekRows = qs.map(([q, v]) => `<tr><td><b>${esc(q)}</b></td><td class="num">+${Math.round(v.in * 10) / 10}</td><td class="num">−${Math.round(v.out * 10) / 10}</td><td class="num"><b>${v.in - v.out >= 0 ? '+' : '−'}${Math.round(Math.abs(v.in - v.out) * 10) / 10}</b></td>
    <td>${v.items.map((i) => `<div class="hitem">${esc(i.name)}: ${esc(i.from || '–')} → ${esc(i.to || '–')} · ${Math.round(i.days * 10) / 10} d · <span class="${i.source === 'Notion' ? 'warnt' : ''}">${esc(i.source === 'Notion' ? 'Notion, no reason given' : i.reason || 'Planner, no reason')}</span></div>`).join('')}</td></tr>`).join('');
  const who = (a) => esc((a.by && users?.get(a.by)) || a.byText || 'Someone');
  const auditHtml = auditError ? `<div class="placeholder">Audit log unavailable: ${esc(auditError)}</div>` : !audit ? '<div class="placeholder">Reading the audit log from Notion…</div>'
    : audit.length ? audit.map((a) => `<div class="hrow"><div class="hwhen">${esc(new Date(a.at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}<br><span class="muted">${who(a)}</span></div>
      <div><span class="tag">${esc(a.category)}</span> <b>${esc(a.itemName)}</b>${a.field === 'Comment' || a.field === 'Pushback' ? '' : `<div class="muted">${esc(a.field)}: ${esc(a.before || '–')} → ${esc(a.after || '–')}</div>`}
      ${a.reason ? `<div>Reason: ${esc(a.reason)}</div>` : ''}${a.warning ? `<div class="warnt">⚠ ${esc(a.warning)}</div>` : ''}</div></div>`).join('') : '<div class="placeholder">No planner changes yet.</div>';
  const notionHtml = (changes || []).length ? changes.map((c) => `<div class="hrow"><div class="hwhen muted">Notion</div><div><b>${esc(c.name)}</b><div class="muted">${c.fields.map((k) => `${esc(k)}: ${esc(c.before[k] ?? '–')} → ${esc(c.after[k] ?? '–')}`).join(' · ')}</div><div class="warnt">No reason given</div></div></div>`).join('')
    : '<div class="placeholder">No issues edited in Notion since the last sync.</div>';
  el.innerHTML = `<div class="lists">
    <div class="lhead"><b>History</b><span class="lsub">Planner changes from the audit log; Notion edits since the last Lightdash sync${syncedAt ? ` (${esc(new Date(syncedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))})` : ''}. Older Notion edits arrive once the snapshots are in Lightdash.</span></div>
    <h3 class="lgroup">This week, load per quarter</h3>
    ${qs.length ? `<table class="htable"><thead><tr><th>Quarter</th><th>In</th><th>Out</th><th>Net</th><th>What moved</th></tr></thead><tbody>${weekRows}</tbody></table>` : '<div class="placeholder">No load moved between quarters this week.</div>'}
    ${section('hist-planner', 'Planner changes', audit ? audit.length : '…', 'newest first', auditHtml, true)}
    ${section('hist-notion', 'Edited in Notion since the last sync', (changes || []).length, 'no reason given', notionHtml)}
  </div>`;
}
