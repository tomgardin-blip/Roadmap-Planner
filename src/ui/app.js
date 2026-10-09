// Entry point. Checkpoint 1: fake data only, no connectors.

import { horizon as buildHorizon } from '../periods.js';
import { buildGrid, TEAMS } from '../capacity.js';
import { fakeCapacity, fakeIssues } from '../data/fake.js';
import { renderGrid } from './grid.js';
import { openDrawer, closeDrawer } from './drawer.js';
import { LOGO } from './logo.js';

const TODAY = new URLSearchParams(location.search).get('today') || new Date().toISOString().slice(0, 10);

const state = { teamFilter: 'all', sel: null };
const horizon = buildHorizon(TODAY);
const issues = fakeIssues(horizon);
const grid = buildGrid(issues, fakeCapacity(horizon), horizon);

function themeToggle() {
  const root = document.documentElement;
  const dark = root.dataset.theme
    ? root.dataset.theme === 'dark'
    : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('rp.theme', root.dataset.theme); } catch { /* storage unavailable */ }
}

function shell() {
  try {
    const t = localStorage.getItem('rp.theme');
    if (t) document.documentElement.dataset.theme = t;
  } catch { /* storage unavailable */ }

  const noTeamDays = grid.noTeam.reduce((s, i) => s + i.effort.FE + i.effort.BE + i.effort.MOB, 0);
  // Render into our own root: replacing document.body would also delete the
  // <style> and <script> tags the artifact runtime puts inside it.
  let root = document.getElementById('rp-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'rp-root';
    document.body.appendChild(root);
  }
  root.innerHTML = `
    <header>
      <div class="topbar">
        <img class="logo" alt="Qargo" src="${LOGO}">
        <span class="brandbar"></span>
        <span class="brandtitle">Roadmap Planner</span>
        <span class="tsub">Engineering capacity · FE / BE / MOB · 4 teams</span>
        <span class="pill fake">FAKE DATA</span>
        <span class="spacer"></span>
        ${grid.noTeam.length ? `<span class="pill warn" title="Issues with effort but no team do not count in any capacity"><b>${grid.noTeam.length}</b> issue with no team · ${noTeamDays} d invisible</span>` : ''}
        <span class="pill">Today <b>${TODAY}</b></span>
        <span class="connwrap" title="Connectors arrive in checkpoints 2 and 3"><span class="connicon">L</span><span class="connicon">N</span></span>
      </div>
      <nav class="tabs">
        <button class="on">Capacity</button>
        <button disabled title="Checkpoint 6">Prep queues</button>
        <button disabled title="Checkpoint 6">At risk</button>
        <button disabled title="v2">Pushback</button>
        <button disabled title="v2">History</button>
      </nav>
      <div class="toolbar">
        <label class="fld">Team <select id="teamSel"><option value="all">All teams</option>${TEAMS.map((t) => `<option>${t}</option>`).join('')}</select></label>
        <span class="legend">
          <span><span class="sw ok"></span>within ±2 d</span>
          <span><span class="sw amber"></span>±2 to 5 d</span>
          <span><span class="sw red"></span>over ±5 d</span>
        </span>
        <span class="spacer" style="flex:1"></span>
        <button id="themeBtn" title="Light / dark">Theme</button>
      </div>
    </header>
    <main class="gridwrap" id="grid"></main>
    <div class="note">Planned days / capacity in effort days. An issue counts in the month of its End date, so quarter-level issues (End = last Friday of the quarter) land in the quarter's third month.</div>
    <aside class="drawer" id="drawer"></aside>`;

  document.getElementById('teamSel').addEventListener('change', (e) => { state.teamFilter = e.target.value; draw(); });
  document.getElementById('themeBtn').addEventListener('click', themeToggle);
  document.getElementById('grid').addEventListener('click', (e) => {
    const td = e.target.closest('td.cell[data-period]');
    if (!td) return;
    document.querySelectorAll('td.cell.sel').forEach((x) => x.classList.remove('sel'));
    td.classList.add('sel');
    openDrawer(document.getElementById('drawer'), { issues, grid, horizon, ...td.dataset });
  });
  document.getElementById('drawer').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) {
      closeDrawer(document.getElementById('drawer'));
      document.querySelectorAll('td.cell.sel').forEach((x) => x.classList.remove('sel'));
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(document.getElementById('drawer')); });
}

function draw() {
  renderGrid(document.getElementById('grid'), grid, horizon, state);
}

shell();
draw();
