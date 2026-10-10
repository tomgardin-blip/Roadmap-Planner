// List screens: At risk and Prep queues. Built from src/atrisk.js and src/prep.js; every card
// carries the same date buttons and FR edit as the drawer.

import { RULES } from '../atrisk.js';
import { GROUPS } from '../prep.js';
import { listCard, frCard } from './drawer.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SK = ['frontend', 'backend', 'mobile'];
const days = (list) => Math.round(list.reduce((a, e) => a + SK.reduce((b, s) => b + (e.issue?.skillEfforts?.[s] || 0), 0), 0));
const LIMIT = 30;

function section(id, title, count, sub, body, open = false) {
  return `<details class="lsec" ${open ? 'open' : ''} id="${id}"><summary><b>${esc(title)}</b><span class="cnt">${count}</span>${sub ? `<span class="lsub">${esc(sub)}</span>` : ''}</summary><div class="lbody">${body}</div></details>`;
}
function capped(items, render, key) {
  if (!items.length) return '<div class="placeholder">None.</div>';
  const head = items.slice(0, LIMIT).map(render).join('');
  const rest = items.slice(LIMIT).map(render).join('');
  return head + (rest ? `<details class="more" data-more="${key}"><summary>Show all ${items.length}</summary>${rest}</details>` : '');
}

export function renderAtRisk(el, { risk, horizon, scores, loading, baselineError }) {
  const baselineNote = baselineError ? `Effort baseline unavailable: ${baselineError}` : 'Reading the effort baseline from Notion…';
  const total = RULES.reduce((a, r) => a + (risk[r.key]?.length || 0), 0);
  let h = `<div class="lhead"><b>At risk</b><span class="lsub">${total} flags across ${RULES.length} rules${loading ? ' · scores loading' : ''}. Commit dates are effective commits (earliest of the issue, its FRs and what it blocks).</span></div>`;
  for (const r of RULES) {
    const list = risk[r.key];
    if (!list) { h += section(`risk-${r.key}`, r.label, '…', baselineNote, `<div class="placeholder">${baselineNote}</div>`); continue; }
    const sub = r.key === 'effortGrowth' ? 'vs. effort when first seen this quarter (baseline kept since 10 Oct 2026)' : list.length ? `${days(list)} d` : '';
    h += section(`risk-${r.key}`, r.label, list.length, sub, capped(list, (e) => listCard(e.issue, horizon, scores?.get(e.issue.id), e.detail), r.key), r.key === 'afterCommit');
  }
  el.innerHTML = `<div class="lists">${h}</div>`;
}

export function renderPrep(el, { queues, horizon, scores, loading, allFrTeams }) {
  if (!queues) { el.innerHTML = `<div class="lists"><div class="placeholder">${loading ? 'Prep queues need all FRs and the unplanned backlog. Loading them from Lightdash…' : 'Prep queues unavailable: the FR or backlog load failed.'}</div></div>`; return; }
  let h = `<div class="lhead"><b>Prep queues</b><span class="lsub">What blocks planning, per FR priority. An issue sits under its highest-priority FR.</span>
    <label class="lchk"><input type="checkbox" id="allFrTeams" ${allFrTeams ? 'checked' : ''}> No-issue list: include FRs not assigned to Engineering</label></div>`;
  for (const g of GROUPS) {
    const q = queues[g.key];
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
