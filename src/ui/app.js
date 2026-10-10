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
import { loadLive, loadExtras } from '../data/live.js';
import { renderGrid } from './grid.js';
import { openDrawer, closeDrawer } from './drawer.js';
import { LOGO } from './logo.js';

const TODAY = new URLSearchParams(location.search).get('today') || new Date().toISOString().slice(0, 10);
const [ty, tm, td] = TODAY.split('-').map(Number);
const NOW = new Date(ty, tm - 1, td, 12);
const horizon = buildHorizon(TODAY);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = {
  teamFilter: 'all', mode: 'loading', status: null, run: null, grid: null, noTeam: [],
  rows: null, // default Lightdash rows (overlaid)
  // Background load (SPEC "Data flow"): scores need the uncommitted FRs, pull forward the unplanned backlog.
  extra: { scores: 'loading', backlog: 'loading', scoresError: null, backlogError: null, deals: new Map(), taskRows: [], featureRows: [] },
  scores: null, backlog: [], drawer: null, dealNames: new Map(),
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
        <span class="connwrap"><span class="connicon" id="connL" title="Lightdash">L</span><span class="connicon" id="connN" title="Notion">N</span></span>
      </div>
      <nav class="tabs">
        <button class="on">Capacity</button>
        <button disabled title="Checkpoint 6">Prep queues</button>
        <button disabled title="Checkpoint 6">At risk</button>
        <button disabled title="v2">Pushback</button>
        <button disabled title="v2">History</button>
      </nav>
      <div class="toolbar">
        <label class="fld">Team <select id="teamSel"><option value="all">All teams</option>${TEAMS.map((t) => `<option>${esc(t)}</option>`).join('')}</select></label>
        <span class="legend">
          <span><span class="sw ok"></span>within ±2 d</span>
          <span><span class="sw amber"></span>±2 to 5 d</span>
          <span><span class="sw red"></span>over ±5 d</span>
          <span>· quarter totals only</span>
        </span>
        <span class="spacer" style="flex:1"></span>
        <button id="themeBtn" title="Light / dark">Theme</button>
      </div>
      <div id="banners"></div>
    </header>
    <main class="gridwrap" id="grid"><div class="loading">Loading capacity from Lightdash…</div></main>
    <div class="note">Load / capacity in effort days, computed by the Lightdash planner's own engine, with Notion edits since the last Lightdash sync applied on top. Months: dated work (Start ≠ End) by working day; a week counts in the month of its Friday. Pot: issues with Start = End, at quarter level. TBD: committed issues with no dates, in the quarter of their committed date (overdue ones in the current quarter). Total = months + pot + TBD, as the planner's quarter cards. The current quarter counts from this week.</div>
    <aside class="drawer" id="drawer"></aside>`;

  document.getElementById('teamSel').addEventListener('change', (e) => { state.teamFilter = e.target.value; draw(); });
  document.getElementById('themeBtn').addEventListener('click', themeToggle);
  document.getElementById('grid').addEventListener('click', (e) => {
    const cell = e.target.closest('td.cell[data-period]');
    if (!cell || !state.run) return;
    document.querySelectorAll('td.cell.sel').forEach((x) => x.classList.remove('sel'));
    cell.classList.add('sel');
    state.drawer = { ...cell.dataset };
    renderDrawer();
  });
  document.getElementById('drawer').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) {
      closeDrawer(document.getElementById('drawer'));
      state.drawer = null;
      document.querySelectorAll('td.cell.sel').forEach((x) => x.classList.remove('sel'));
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(document.getElementById('drawer')); state.drawer = null; } });
}

function renderDrawer() {
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
  renderChrome();
  renderDrawer();
}

function onExtra(step, p) {
  const x = state.extra;
  if (p.error) { x[step] = 'error'; x[`${step}Error`] = p.error; }
  else if (step === 'scores') { x.scores = 'ok'; x.deals = dealSizeMap(p.deals); x.taskRows = p.tasks; }
  else { x.backlog = 'ok'; x.featureRows = p.features; }
  if (x.scores === 'ok') rescore(); else { renderChrome(); renderDrawer(); }
}

function setConn(id, s) {
  document.getElementById(id).className = `connicon ${{ ok: 'green', loading: 'orange', error: 'red' }[s] || ''}`;
}

function renderChrome() {
  const s = state.status || {};
  const mode = { live: '', snapshot: '<span class="pill">Lightdash snapshot</span>', fake: '<span class="pill fake">FAKE DATA</span>', loading: '' }[state.mode];
  document.getElementById('modePill').innerHTML = mode;
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

function draw() {
  if (state.grid) renderGrid(document.getElementById('grid'), state.grid, horizon, state);
}

function show(rows) {
  state.rows = rows;
  state.dealNames = dealNameMap(rows);
  state.run = runCapacity(rows, { now: NOW });
  state.grid = buildGrid(state.run, horizon);
  state.noTeam = issuesWithoutTeam(state.run);
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
    state.mode = 'live';
    state.status = { lightdash: 'loading', notion: 'loading' };
    renderChrome();
    const { rows, status } = await loadLive(mcp);
    state.status = status;
    if (rows) {
      show(rows);
      loadExtras(mcp, status.overlay, onExtra);
    } else { renderChrome(); document.getElementById('grid').innerHTML = ''; }
    return;
  }
  state.mode = Array.isArray(window.__RP_ROWS__) ? 'snapshot' : 'fake';
  show(state.mode === 'snapshot' ? window.__RP_ROWS__ : fakeLightdashRows(horizon));
  // Local preview: a saved backlog ({deals, tasks, features} Lightdash rows) if given, else none.
  const ex = window.__RP_EXTRA__ || {};
  onExtra('scores', { deals: ex.deals || [], tasks: ex.tasks || [] });
  onExtra('backlog', { features: ex.features || [] });
}

boot();
