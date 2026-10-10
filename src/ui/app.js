// Entry point.
// Data, in order of preference:
//   1. live: the viewer's Lightdash + Notion connectors over the artifact `mcp` capability;
//   2. window.__RP_ROWS__: a saved Lightdash snapshot (local preview only);
//   3. fake Lightdash-shaped rows.
// All three run through the same capacity engine.

import { horizon as buildHorizon } from '../periods.js';
import { buildGrid, runCapacity, issuesWithoutTeam, toIssues, TEAMS } from '../capacity.js';
import { scoreRows, dealSizeMap, dealNameMap } from '../scoring.js';
import { fakeLightdashRows } from '../data/fake.js';
import { loadLive, loadExtras, syncBaseline, loadAudit, loadOwnerEmails, signedSet, explainError, NOTION } from '../data/live.js';
import { userName } from '../data/writer.js';
import { quarterKeyOf } from '../notion/baseline.js';
import { renderGrid } from './grid.js';
import { openDrawer, closeDrawer, renderTestPanel, shownIssue, shownFr, setDealNames, setReadOnly } from './drawer.js';
import { renderAtRisk, renderPrep, renderPushback, renderHistory, tabCounts } from './lists.js';
import { pushbackCandidates, overbookedCells } from '../pushback.js';
import { weeklyLoadChanges, dismissedFrs } from '../history.js';
import { GROUPS } from '../prep.js';
import { atRisk } from '../atrisk.js';
import { prepQueues } from '../prep.js';
import { startMove, startFrEdit, loadTestPages, startDismiss, startEstimatePost } from './actions.js';
import { closeSheet } from './sheet.js';
import { parseBlob } from '../scoring.js';
import { LOGO } from './logo.js';

const TODAY = new URLSearchParams(location.search).get('today') || new Date().toISOString().slice(0, 10);
const [ty, tm, td] = TODAY.split('-').map(Number);
const NOW = new Date(ty, tm - 1, td, 12);
const horizon = buildHorizon(TODAY);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function initialView() {
  try { const v = localStorage.getItem('rp.view'); if (v === 'quarters' || v === 'months') return v; } catch { /* storage unavailable */ }
  return matchMedia('(max-width: 700px)').matches ? 'quarters' : 'months';
}

const state = {
  tab: 'capacity', allFrTeams: false, pbOverbooked: false, readOnly: false,
  audit: null, auditError: null, owners: null, ownersLoading: false, users: new Map(), pushback: null,
  view: initialView(),
  teamFilter: 'all', mode: 'loading', status: null, run: null, grid: null, noTeam: [],
  rows: null, // default Lightdash rows (overlaid)
  // Background load (SPEC "Data flow"): scores need the uncommitted FRs, pull forward the unplanned backlog.
  extra: { scores: 'loading', backlog: 'loading', scoresError: null, backlogError: null, deals: new Map(), taskRows: [], featureRows: [] },
  scores: null, backlog: [], drawer: null, dealNames: new Map(), dealGolive: new Map(),
  baseline: null, baselineError: null,
  mcp: null, test: null, // test: null (closed) or { issue, fr, error } for the Test writes drawer
};

function themeToggle() {
  const root = document.documentElement;
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('rp.theme', root.dataset.theme); } catch { /* storage unavailable */ }
}

function fmtTime(iso) {
  if (!iso) return '?';
  const d = new Date(iso);
  return isNaN(d) ? iso : d.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

function shell() {
  try { const t = localStorage.getItem('rp.theme'); if (t) document.documentElement.dataset.theme = t; } catch { /* storage unavailable */ }
  // Render into our own root: replacing document.body would also delete the
  // <style> and <script> tags the artifact runtime puts inside it.
  let root = document.getElementById('rp-root');
  if (!root) { root = document.createElement('div'); root.id = 'rp-root'; document.body.appendChild(root); }
  root.innerHTML = `
    <header>
      <div class="topbar">
        <img class="logo" alt="Qargo" src="${LOGO}">
        <span class="brandbar"></span>
        <span class="brandtitle">Roadmap Planner</span>
        <span class="tsub">Engineering capacity · FE / BE / MOB · 4 teams</span>
        <span id="modePill"></span>
        <span class="spacer"></span>
        <span id="pills"></span>
        <button id="testBtn" class="testbtn" hidden title="Try the Notion write-back on the test pages">Test writes</button>
        <span class="connwrap"><span class="connicon" id="connL" title="Lightdash">L</span><span class="connicon" id="connN" title="Notion">N</span></span>
      </div>
      <nav class="tabs">
        <button class="on" data-tab="capacity">Capacity</button>
        <button data-tab="prep">Prep queues<span class="cnt" id="cntPrep"></span></button>
        <button data-tab="risk">At risk<span class="cnt" id="cntRisk"></span></button>
        <button data-tab="pushback">Pushback<span class="cnt" id="cntPb"></span></button>
        <button data-tab="history">History</button>
      </nav>
      <div class="toolbar">
        <label class="fld">Team <select id="teamSel"><option value="all">All teams</option>${TEAMS.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
        <span class="legend">
          <span><span class="sw ok"></span>at or under capacity</span>
          <span><span class="sw red"></span>over capacity</span>
          <span>· quarter totals only</span>
        </span>
        <span class="seg" id="viewSeg"><button data-view="quarters">Quarters</button><button data-view="months">Months</button></span>
        <span class="spacer" style="flex:1"></span>
        <button id="themeBtn" title="Light / dark">Theme</button>
      </div>
      <div id="banners"></div>
    </header>
    <main class="gridwrap" id="grid"><div class="loading">Loading capacity from Lightdash…</div></main>
    <div class="note">Load / capacity in effort days, computed by the Lightdash planner's own engine, with Notion edits since the last Lightdash sync applied on top. Months: dated work (Start ≠ End) by working day; a week counts in the month of its Friday. Pot: issues with Start = End, at quarter level. TBD: committed issues with no dates, in the quarter of their committed date (overdue ones in the current quarter). Total = months + pot + TBD, as the planner's quarter cards. The current quarter counts from this week.</div>
    <aside class="drawer" id="drawer"></aside>`;

  document.getElementById('teamSel').addEventListener('change', (e) => { state.teamFilter = e.target.value; recompute(); draw(); });
  document.querySelector('nav.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b || b.disabled) return;
    state.tab = b.dataset.tab;
    draw();
  });
  document.getElementById('grid').addEventListener('change', (e) => {
    if (e.target.id === 'allFrTeams') { state.allFrTeams = e.target.checked; draw(); }
    if (e.target.id === 'pbOverbooked') { state.pbOverbooked = e.target.checked; recompute(); draw(); }
  });
  document.getElementById('themeBtn').addEventListener('click', themeToggle);
  document.getElementById('viewSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    state.view = b.dataset.view;
    try { localStorage.setItem('rp.view', state.view); } catch { /* storage unavailable */ }
    draw();
  });
  document.getElementById('grid').addEventListener('click', (e) => {
    const cell = e.target.closest('td.cell[data-period]');
    if (!cell || !state.run) return;
    document.querySelectorAll('td.cell.sel').forEach((x) => x.classList.remove('sel'));
    cell.classList.add('sel');
    state.drawer = { ...cell.dataset };
    state.test = null;
    renderDrawer();
  });
  document.getElementById('drawer').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) {
      closeDrawer(document.getElementById('drawer'));
      state.drawer = null;
      state.test = null;
      document.querySelectorAll('td.cell.sel').forEach((x) => x.classList.remove('sel'));
    }
  });
  document.getElementById('testBtn').addEventListener('click', openTest);
  // Write flows (delegated: buttons live in the drawer and the sheet).
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-sheet-close]')) { closeSheet(); return; }
    const mv = e.target.closest('button[data-move]');
    if (mv && !mv.disabled) {
      const issue = shownIssue(mv.dataset.issue);
      const blockers = (state.run?.issues || []).filter((i) => (i.blocks || []).includes(issue.id) && !['Done', "Won't do", 'Duplicate'].includes(i.status));
      startMove({ mcp: state.mcp, issue, date: mv.dataset.move, label: mv.dataset.label, blockers, onDone: (r) => afterMove(issue, r) });
      return;
    }
    const dm = e.target.closest('button[data-dismiss]');
    if (dm) {
      const c = state.pushback?.find((x) => x.fr.id === dm.dataset.dismiss);
      if (c) startDismiss({ mcp: state.mcp, fr: c.fr, issue: c.issue, onDone: ({ reason }) => { state.audit = [{ category: 'Pushback override', frId: c.fr.id.replace(/-/g, '').toLowerCase(), itemName: c.fr.title, reason, at: new Date().toISOString(), field: 'Pushback' }, ...(state.audit || [])]; recompute(); draw(); } });
      return;
    }
    if (e.target.closest('#estPost')) {
      const groups = GROUPS.map((g) => ({ label: g.label, entries: state.queues?.[g.key].noEstimate || [] }));
      startEstimatePost({ mcp: state.mcp, groups });
      return;
    }
    const fe = e.target.closest('button[data-fr-edit]');
    if (fe && !fe.disabled) {
      const fr = shownFr(fe.dataset.frEdit) || state.pushback?.find((x) => x.fr.id === fe.dataset.frEdit)?.fr;
      startFrEdit({ mcp: state.mcp, fr, golive: fr.dealId ? state.dealGolive.get(String(fr.dealId).replace(/-/g, '').toLowerCase()) : null, onDone: (r) => afterFrEdit(fr, r) });
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('rp-sheet')) { closeSheet(); return; }
    closeDrawer(document.getElementById('drawer')); state.drawer = null; state.test = null;
  });
}

async function openTest() {
  state.drawer = null;
  state.test = {};
  renderDrawer();
  try { state.test = await loadTestPages(state.mcp); } catch (err) { state.test = { error: `Could not read the test pages: ${err?.message || err?.code || 'unknown error'}` }; }
  renderDrawer();
}

/** Patch a feature row's Start/End in the loaded rows so the grid follows the write. */
function afterMove(issue, { after }) {
  let hit = false;
  state.rows = state.rows.map((r) => {
    const blob = r.serve_engineering_capacity_features;
    if (blob == null) return r;
    const feats = parseBlob(blob).map((f) => {
      if (String(f[0]).replace(/-/g, '').toLowerCase() !== issue.id) return f;
      hit = true;
      const g = f.slice(); g[24] = after.start; g[25] = after.end; return g;
    });
    return hit ? { ...r, serve_engineering_capacity_features: JSON.stringify(feats) } : r;
  });
  if (hit) show(state.rows);
  if (state.test) openTest(); else renderDrawer();
}

/** Patch an FR's priority in the loaded task rows and rescore. */
function afterFrEdit(fr, { changes }) {
  const pr = changes.find((c) => c.field === 'Priority');
  if (pr) {
    const patch = (rows) => rows.map((r) => {
      const blob = r.serve_engineering_capacity_customer_tasks;
      if (blob == null) return r;
      const tasks = parseBlob(blob).map((t) => (String(t[0]).replace(/-/g, '').toLowerCase() === fr.id ? Object.assign(t.slice(), { 4: pr.after }) : t));
      return { ...r, serve_engineering_capacity_customer_tasks: JSON.stringify(tasks) };
    });
    state.rows = patch(state.rows);
    state.extra.taskRows = patch(state.extra.taskRows);
    if (state.extra.scores === 'ok') rescore();
  }
  if (state.test) openTest();
}

function renderDrawer() {
  if (state.test) { renderTestPanel(document.getElementById('drawer'), { horizon, ...state.test }); return; }
  if (!state.drawer || !state.run) return;
  openDrawer(document.getElementById('drawer'), {
    run: state.run, grid: state.grid, horizon, changes: state.status?.changed || [],
    scores: state.scores, backlog: state.backlog, extra: state.extra, names: state.dealNames, ...state.drawer,
  });
}

function rescore() {
  const x = state.extra;
  state.scores = scoreRows([...state.rows, ...x.taskRows, ...x.featureRows], x.deals);
  state.backlog = x.featureRows.length ? toIssues(x.featureRows) : [];
  recompute();
  renderChrome();
  if (state.tab !== 'capacity') draw();
  renderDrawer();
}

function onExtra(step, p) {
  const x = state.extra;
  if (p.error) { x[step] = 'error'; x[`${step}Error`] = p.error; }
  else if (step === 'scores') { x.scores = 'ok'; x.deals = dealSizeMap(p.deals); x.taskRows = p.tasks; x.signed = p.signed instanceof Set ? p.signed : p.signed ? signedSet(p.signed) : null; }
  else { x.backlog = 'ok'; x.featureRows = p.features; }
  if (x.scores === 'ok') rescore(); else { recompute(); renderChrome(); if (state.tab !== 'capacity') draw(); renderDrawer(); }
}

function setConn(id, s) {
  document.getElementById(id).className = `connicon ${{ ok: 'green', loading: 'orange', error: 'red' }[s] || ''}`;
}

function renderChrome() {
  const s = state.status || {};
  const mode = { live: '', snapshot: '<span class="pill">Lightdash snapshot</span>', fake: '<span class="pill fake">FAKE DATA</span>', loading: '' }[state.mode];
  document.getElementById('modePill').innerHTML = mode + (state.readOnly ? ' <span class="pill ro" title="You can view this planner. Ask Tom for Editor access to move issues or edit FRs.">Read only</span>' : '');
  setConn('connL', state.mode === 'live' ? s.lightdash : '');
  setConn('connN', state.mode === 'live' ? s.notion : '');

  const pills = [];
  if (state.mode === 'live' && s.syncedAt) {
    const n = (s.changed?.length || 0) + (s.added?.length || 0);
    pills.push(`<span class="pill" title="Lightdash last synced from Notion at ${esc(fmtTime(s.syncedAt))}. Issues edited in Notion since then are read live and applied on top.">Lightdash ${esc(fmtTime(s.syncedAt))} · <b>${n}</b> live from Notion</span>`);
  }
  if (state.noTeam.length) {
    const days = state.noTeam.reduce((a, i) => a + (i.skillEfforts.frontend || 0) + (i.skillEfforts.backend || 0) + (i.skillEfforts.mobile || 0), 0);
    pills.push(`<span class="pill warn" title="Issues with effort and dates but no team or assignee count in no team's load"><b>${state.noTeam.length}</b> with no team · ${Math.round(days)} d invisible</span>`);
  }
  const x = state.extra;
  if (state.run) {
    const sc = { loading: 'Scores loading…', ok: 'Scores ready', error: 'Scores unavailable' }[x.scores];
    const bl = x.scores === 'ok' ? { loading: ' · backlog loading…', ok: '', error: ' · backlog unavailable' }[x.backlog] : '';
    const warn = x.scores === 'error' || x.backlog === 'error';
    pills.push(`<span class="pill ${warn ? 'warn' : ''}" title="${esc([x.scoresError, x.backlogError].filter(Boolean).join(' ') || 'FR demand and the unplanned backlog load in the background after the grid.')}">${sc}${bl}</span>`);
  }
  pills.push(`<span class="pill">Today <b>${esc(TODAY)}</b></span>`);
  document.getElementById('pills').innerHTML = pills.join(' ');

  const banners = [];
  if (s.lightdashError) banners.push(`<div class="banner bad"><b>No capacity data.</b> ${esc(s.lightdashError)}</div>`);
  if (s.notionError) banners.push(`<div class="banner warn"><b>Notion not read.</b> ${esc(s.notionError)} Showing Lightdash as of ${esc(fmtTime(s.syncedAt))}; edits made after that are missing.</div>`);
  document.getElementById('banners').innerHTML = banners.join('');
}

/** FR id → committed date, from the customer_tasks blobs. */
function taskCommittedMap(rows) {
  const m = new Map();
  for (const r of rows) for (const t of parseBlob(r.serve_engineering_capacity_customer_tasks)) if (t[8]) m.set(String(t[0]).replace(/-/g, '').toLowerCase(), String(t[8]).slice(0, 10));
  return m;
}

/** COM/AM emails for the pushback list, loaded once when the tab first opens. */
async function loadOwners() {
  if (state.owners || state.ownersLoading || !state.mcp || !state.pushback) return;
  state.ownersLoading = true;
  try { state.owners = await loadOwnerEmails(state.mcp, [...new Set(state.pushback.map((c) => c.fr.id.replace(/-/g, '').toLowerCase()))]); } catch { state.owners = new Map(); }
  state.ownersLoading = false;
  if (state.tab === 'pushback') draw();
}

/** At-risk flags (from the run) and prep queues (once all FRs and the backlog are in). */
function recompute() {
  if (!state.run) return;
  state.risk = atRisk(state.run, { team: state.teamFilter, baseline: state.baseline });
  const x = state.extra;
  state.queues = x.scores === 'ok' && x.backlog !== 'loading'
    ? prepQueues({ run: state.run, backlog: state.backlog, scores: state.scores, taskRows: [...state.rows, ...x.taskRows], featureRows: [...state.rows, ...x.featureRows], team: state.teamFilter, signed: x.signed })
    : null;
  state.pushback = x.scores === 'ok' ? pushbackCandidates({
    run: state.run, backlog: state.backlog, scores: state.scores, team: state.teamFilter,
    taskCommitted: taskCommittedMap([...state.rows, ...x.taskRows]), dealSize: x.deals,
    dismissed: state.audit ? dismissedFrs(state.audit) : new Set(), overbooked: state.pbOverbooked ? overbookedCells(state.grid) : null,
  }) : null;
  state.weekly = state.audit ? weeklyLoadChanges({ audit: state.audit, changes: state.status?.changed || [], issues: state.run.issues, now: NOW }) : null;
  document.getElementById('cntPb').textContent = state.pushback ? state.pushback.length : '';
  const c = tabCounts(state.risk, state.queues);
  document.getElementById('cntRisk').textContent = c.risk ?? '';
  document.getElementById('cntPrep').textContent = c.prep ?? '';
}

function draw() {
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', b.dataset.view === state.view));
  document.querySelectorAll('nav.tabs button[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  const onGrid = state.tab === 'capacity';
  document.querySelector('.toolbar .legend').hidden = !onGrid;
  document.getElementById('viewSeg').hidden = !onGrid;
  document.querySelector('.note').hidden = !onGrid;
  const main = document.getElementById('grid');
  if (state.tab === 'risk' && state.risk) { renderAtRisk(main, { risk: state.risk, horizon, scores: state.scores, loading: state.extra.scores === 'loading', baselineError: state.baselineError }); return; }
  if (state.tab === 'prep') { renderPrep(main, { queues: state.queues, horizon, scores: state.scores, loading: state.extra.scores === 'loading' || state.extra.backlog === 'loading', allFrTeams: state.allFrTeams, readOnly: state.readOnly || !state.mcp }); return; }
  if (state.tab === 'pushback') { loadOwners(); renderPushback(main, { list: state.pushback, loading: state.extra.scores === 'loading', owners: state.mcp ? state.owners : new Map(), names: state.dealNames, overbookedOnly: state.pbOverbooked, readOnly: state.readOnly, team: state.teamFilter }); return; }
  if (state.tab === 'history') { renderHistory(main, { audit: state.audit, auditError: state.auditError, weekly: state.weekly, changes: state.status?.changed || [], users: state.users, syncedAt: state.status?.syncedAt }); return; }
  if (state.grid) renderGrid(document.getElementById('grid'), state.grid, horizon, state);
}

function show(rows) {
  state.rows = rows;
  state.dealNames = dealNameMap(rows);
  state.dealGolive = new Map(rows.flatMap((r) => parseBlob(r.serve_engineering_capacity_deals)).filter((d) => d[0] && d[5]).map((d) => [String(d[0]).replace(/-/g, '').toLowerCase(), String(d[5]).slice(0, 10)]));
  state.run = runCapacity(rows, { now: NOW });
  state.grid = buildGrid(state.run, horizon);
  state.noTeam = issuesWithoutTeam(state.run);
  setDealNames(state.dealNames);
  recompute();
  renderChrome();
  draw();
}

async function boot() {
  shell();
  renderChrome();
  const inViewer = !!(window.claude && typeof window.claude.use === 'function');
  const mcp = inViewer ? await window.claude.use('mcp').catch(() => null) : null;
  if (inViewer && !mcp) {
    // Inside claude.ai but no connector access: never fall back to fake numbers here.
    state.mode = 'live';
    state.status = { lightdash: 'error', notion: 'error', lightdashError: 'Connectors are not available in this view. Open the page in claude.ai, allow Lightdash and Notion when asked, and check both are connected under Settings → Connectors.' };
    renderChrome();
    document.getElementById('grid').innerHTML = '';
    return;
  }
  if (mcp) {
    state.mcp = mcp;
    // Read-only for anyone who cannot edit the artifact (Tom picks Editor/Viewer in Share).
    const user = await window.claude.use('user').catch(() => null);
    state.readOnly = !(await user?.canEdit?.().catch(() => false));
    setReadOnly(state.readOnly);
    document.getElementById('testBtn').hidden = state.readOnly;
    state.mode = 'live';
    state.status = { lightdash: 'loading', notion: 'loading' };
    renderChrome();
    const { rows, status } = await loadLive(mcp);
    state.status = status;
    if (rows) {
      show(rows);
      loadExtras(mcp, status.overlay, onExtra);
      // Baseline from the Notion-overlaid rows, so first-seen effort is today's live value.
      loadAudit(mcp)
        .then(async (audit) => {
          state.audit = audit;
          for (const id of new Set(audit.map((a) => a.by).filter(Boolean))) state.users.set(id, await userName(mcp, id));
        })
        .catch((err) => { state.auditError = explainError(NOTION, err); })
        .finally(() => { recompute(); if (['history', 'pushback'].includes(state.tab)) draw(); });
      syncBaseline(mcp, state.run, quarterKeyOf(NOW), { write: !state.readOnly })
        .then(({ baseline }) => { state.baseline = baseline; })
        .catch((err) => { state.baselineError = explainError(NOTION, err); })
        .finally(() => { recompute(); if (state.tab === 'risk') draw(); });
    } else { renderChrome(); document.getElementById('grid').innerHTML = ''; }
    return;
  }
  state.mode = Array.isArray(window.__RP_ROWS__) ? 'snapshot' : 'fake';
  state.baselineError = 'only kept on the live page.';
  show(state.mode === 'snapshot' ? window.__RP_ROWS__ : fakeLightdashRows(horizon));
  // Local preview: a saved backlog ({deals, tasks, features} Lightdash rows) if given, else none.
  const ex = window.__RP_EXTRA__ || {};
  onExtra('scores', { deals: ex.deals || [], tasks: ex.tasks || [], signed: ex.signed || null });
  onExtra('backlog', { features: ex.features || [] });
}

boot();
