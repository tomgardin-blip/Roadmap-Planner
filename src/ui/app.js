// Entry point.
// Data, in order of preference:
//   1. live: the viewer's Lightdash + Notion connectors over the artifact `mcp` capability;
//   2. window.__RP_ROWS__: a saved Lightdash snapshot (local preview only);
//   3. fake Lightdash-shaped rows.
// All three run through the same capacity engine.

import { horizon as buildHorizon, formatDate, formatDateTime, potQuarters, potMonths } from '../periods.js';
import { buildGrid, runCapacity, issuesWithoutTeam, toIssues, TEAMS, pickedTeams, issueTeams } from '../capacity.js';
import { scoreRows, dealSizeMap, dealNameMap } from '../scoring.js';
import { fakeLightdashRows } from '../data/fake.js';
import { applyFeed } from '../data/capacityFeed.js';
import { loadFrComments, loadCapacityFeed, loadLive, loadExtras, syncBaseline, loadAudit, loadOwnerEmails, signedSet, featureFrSet, mixedMap, explainError, NOTION } from '../data/live.js';
import { userName, setIssuePriority, setPushOutKeep } from '../data/writer.js';
import { quarterKeyOf } from '../notion/baseline.js';
import { effectiveCommitted } from '../notion/writes.js';
import { renderGrid } from './grid.js';
import { selectedFrs, toggleFrSelected, clearFrSelected, openDrawer, closeDrawer, setCommitSource, setRoadmapPosts, setEstimatePosts, shownIssue, shownFr, setDealNames, setReadOnly, selectedIssues, toggleSelected, clearSelected } from './drawer.js';
import { renderQuarterPlan, renderAtRisk, renderPrep, renderPushback, renderHistory, renderQuality, tabCounts } from './lists.js';
import { dataQuality, qualityCount } from '../quality.js';
import { weeklyLoadChanges, dismissedFrs } from '../history.js';
import { GROUPS } from '../prep.js';
import { atRisk } from '../atrisk.js';
import { prepQueues } from '../prep.js';
import { ESTIMATE_TARGETS } from '../estimate.js';
import { startBulkFrEdit, startMove, startBulkMove, startFrEdit, startDismiss, startEstimatePost, startRoadmapPost, startAskOwner, startChoice, startIssueStatus, startClearDates } from './actions.js';
import { planFit } from '../fit.js';
import { TEAM_LEADS, dependencyMessage, blockedMessage, qualityDm, staleBlockerMessage } from '../roadmapPost.js';
import { closeSheet, toast } from './sheet.js';
import { parseBlob } from '../scoring.js';
import { LOGO } from './logo.js';

const TODAY = new URLSearchParams(location.search).get('today') || new Date().toISOString().slice(0, 10);
const [ty, tm, td] = TODAY.split('-').map(Number);
const NOW = new Date(ty, tm - 1, td, 12);
const horizon = buildHorizon(TODAY);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function initialSort() {
  try { return localStorage.getItem('rp.sort') === 'commit' ? 'commit' : 'value'; } catch { return 'value'; }
}

const state = {
  tab: 'capacity', qpQuarter: null, qpOpen: new Set(), listSort: initialSort(), readOnly: false,
  audit: null, auditError: null, owners: null, ownersLoading: false, users: new Map(), pushback: null,
  teamFilter: 'all', mode: 'loading', status: null, run: null, grid: null, noTeam: [],
  rows: null, // default Lightdash rows (overlaid)
  // Background load (SPEC "Data flow"): scores need the uncommitted FRs, pull forward the unplanned backlog.
  extra: { scores: 'loading', backlog: 'loading', scoresError: null, backlogError: null, deals: new Map(), taskRows: [], featureRows: [] },
  scores: null, backlog: [], drawer: null, dealNames: new Map(), dealGolive: new Map(),
  baseline: null, baselineError: null,
  frComments: new Map(), frCommentsLoading: false, // Notion comments of No-engineering-issue FRs
  feed: null, feedError: null, // Lightdash engineering_capacity per team × skill × week, or null with the error
  mcp: null,
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
  return isNaN(d) ? iso : formatDateTime(iso);
}

function shell() {
  // Light by default, also on a dark-mode device (Tom, 2026-10-27); the Theme button's choice is remembered.
  let theme = 'light';
  try { theme = localStorage.getItem('rp.theme') || 'light'; } catch { /* storage unavailable */ }
  document.documentElement.dataset.theme = theme;
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
        <button id="refreshBtn" class="testbtn" hidden title="Re-read Lightdash and Notion now, without reloading the page">↻ Refresh</button>
        <span class="connwrap"><span class="connicon" id="connL" title="Lightdash">L</span><span class="connicon" id="connN" title="Notion">N</span></span>
      </div>
      <nav class="tabs">
        <button class="on" data-tab="capacity">Capacity</button>
        <button data-tab="qplan">Quarter plan</button>
        <button data-tab="prep">Prep queues<span class="cnt" id="cntPrep"></span></button>
        <button data-tab="risk">At risk<span class="cnt" id="cntRisk"></span></button>
        <button data-tab="pushback">Pushback<span class="cnt" id="cntPb"></span></button>
        <button data-tab="quality">Data quality<span class="cnt" id="cntDq"></span></button>
        <button data-tab="history">History</button>
      </nav>
      <div class="toolbar">
        <div class="fld teampick"><span class="flab">Team</span><button type="button" id="teamBtn" aria-haspopup="true" aria-expanded="false"><span id="teamLbl">All teams</span></button>
          <div class="teampanel" id="teamPanel" hidden>
            ${TEAMS.map((t) => `<label><input type="checkbox" data-team="${esc(t)}"> ${esc(t)}</label>`).join('')}
            <div class="tpacts"><button type="button" data-teamall>All teams</button><button type="button" class="primary" data-teamdone>Done</button></div>
          </div></div>
        <span class="spacer" style="flex:1"></span>
        <button id="themeBtn" title="Light / dark"><span class="tlabel">Theme</span><svg class="ticon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="currentColor"/></svg></button>
      </div>
      <div id="banners"></div>
    </header>
    <main class="gridwrap" id="grid"><div class="loading">Loading capacity from Lightdash…</div></main>
    <details class="note"><summary>How these numbers work</summary>Same layout and numbers as the Lightdash engineering capacity planner, computed by its own engine with Notion edits since the last Lightdash sync applied on top. Per skill: spare effort days, capacity minus demand (green = room left, red = overbooked). Months: dated work (Start ≠ End) by working day; a week counts in the month of its Friday. Pot: issues with Start = End, at quarter level (demand only, so negative). TBD: committed issues with no dates, in the quarter of their committed date (overdue ones in the current quarter). Qtr = months + pot + TBD. Card header: demand / spare for the quarter. The current quarter counts from this week. Tap any number to see the issues behind it.</details>
    <div class="bulkbar" id="bulkbar" hidden></div>
    <aside class="drawer" id="drawer"></aside>`;

  initTeamPicker();
  document.querySelector('nav.tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b || b.disabled) return;
    state.tab = b.dataset.tab;
    draw();
  });
  document.getElementById('grid').addEventListener('change', (e) => {
    if (e.target.matches?.('select.qpprio')) { setPriority(e.target); return; }
    if (e.target.id === 'listSort') { state.listSort = e.target.value; try { localStorage.setItem('rp.sort', state.listSort); } catch { /* storage unavailable */ } draw(); }
  });
  document.getElementById('themeBtn').addEventListener('click', themeToggle);
  document.addEventListener('change', (e) => {
    if (e.target.matches?.('input.frsel')) {
      toggleFrSelected(e.target.dataset.frsel, e.target.checked);
      document.querySelectorAll(`input.frsel[data-frsel="${e.target.dataset.frsel}"]`).forEach((x) => { x.checked = e.target.checked; });
      renderBulkBar(); return;
    }
    if (!e.target.matches?.('input.bsel')) return;
    toggleSelected(e.target.dataset.bsel, e.target.checked);
    // The same issue can show in several lists: keep every copy of its box in step.
    document.querySelectorAll(`input.bsel[data-bsel="${e.target.dataset.bsel}"]`).forEach((x) => { x.checked = e.target.checked; });
    renderBulkBar();
  });
  // Footnote open on desktop, folded on phones where it would cover half the grid.
  document.querySelector('.note').open = !matchMedia('(max-width: 700px)').matches;
  document.getElementById('grid').addEventListener('click', (e) => {
    const qp = e.target.closest('button[data-qp]');
    if (qp) { state.qpQuarter = qp.dataset.qp; draw(); return; }
    const qs = e.target.closest('button[data-qpsort]');
    if (qs) { const k = qs.dataset.qpsort; state.qpSort = { key: k, dir: state.qpSort?.key === k && k !== 'plan' ? -state.qpSort.dir : 1 }; draw(); return; }
    const qt = e.target.closest('button[data-qpteam]');
    if (qt) {
      // From All, a team button shows just that team; otherwise it toggles; none left = All.
      const cur = pickedTeams(state.teamFilter) || [];
      const t = qt.dataset.qpteam;
      setTeams(t === 'all' ? [] : cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]);
      return;
    }
    const qx = e.target.closest('button[data-qpx]');
    if (qx) { const id = qx.dataset.qpx; if (state.qpOpen.has(id)) state.qpOpen.delete(id); else state.qpOpen.add(id); draw(); return; }
    const sg = e.target.closest('button[data-suggest]');
    if (sg && state.run) {
      // Opens the cell drawer for that team, skill and quarter: its push-out / pull-in suggestions.
      document.querySelectorAll('td.cell.sel').forEach((x) => x.classList.remove('sel'));
      state.drawer = { team: sg.dataset.team, skill: sg.dataset.skill, period: sg.dataset.period };
      renderDrawer(); return;
    }
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
  document.getElementById('refreshBtn').addEventListener('click', refresh);
  // Write flows (delegated: buttons live in the drawer and the sheet).
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-sheet-close]')) { closeSheet(); return; }
    const mv = e.target.closest('button[data-move]');
    if (mv && !mv.disabled) {
      const issue = shownIssue(mv.dataset.issue);
      startMove({ mcp: state.mcp, issue, date: mv.dataset.move, label: mv.dataset.label, blockers: blockersOf(issue), onDone: (r) => afterMove(issue, r) });
      return;
    }
    const bm = e.target.closest('button[data-bulkmove]');
    if (bm) {
      const items = selectedIssues().map((id) => shownIssue(id)).filter(Boolean).map((issue) => ({ issue, blockers: blockersOf(issue) }));
      startBulkMove({ mcp: state.mcp, items, date: bm.dataset.bulkmove, label: bm.dataset.label, onDone: (done) => { done.forEach(({ issue }) => toggleSelected(issue.id, false)); afterMoves(done); renderBulkBar(); } });
      return;
    }
    const kp = e.target.closest('[data-keep],[data-unkeep]');
    if (kp) {
      const keep = kp.hasAttribute('data-keep');
      const id = kp.dataset.keep || kp.dataset.unkeep;
      const issue = shownIssue(id) || state.run?.issues.find((i) => i.id === id);
      if (!issue || !state.mcp) return;
      // Shown at once; the audit row is written in the background.
      state.audit = [{ category: 'Push-out override', field: 'Pushback', after: keep ? 'Kept' : 'Suggested to push out', issueId: id, itemName: issue.name, at: new Date().toISOString() }, ...(state.audit || [])];
      recompute(); renderDrawer();
      toast(`${keep ? 'Kept, no longer suggested' : 'Suggested again'}: ${issue.name}. Saving…`, 'busy');
      setPushOutKeep(state.mcp, { issue, keep }).then(() => toast(`${keep ? 'Kept' : 'Suggested again'}: ${issue.name}. Logged.`), (err) => toast(`Not logged: ${explainError(NOTION, err)}. It comes back on the next refresh.`, 'bad'));
      return;
    }
    const sa = e.target.closest('[data-selall],[data-selnone]');
    if (sa) {
      const on = sa.hasAttribute('data-selall');
      (sa.dataset.selall || sa.dataset.selnone || '').split(',').filter(Boolean).forEach((id) => {
        toggleSelected(id, on);
        document.querySelectorAll(`input.bsel[data-bsel="${id}"]`).forEach((x) => { x.checked = on; });
      });
      renderBulkBar(); return;
    }
    if (e.target.closest('[data-frbulkclear]')) { clearFrSelected(); document.querySelectorAll('input.frsel:checked').forEach((x) => { x.checked = false; }); renderBulkBar(); return; }
    if (e.target.closest('[data-frbulkedit]')) {
      startBulkFrEdit({ mcp: state.mcp, frs: selectedFrs().map((id) => shownFr(id)).filter(Boolean), horizon,
        onDone: (fr, r) => afterFrEdit(fr, r),
        onFinished: () => { clearFrSelected(); document.querySelectorAll('input.frsel:checked').forEach((x) => { x.checked = false; }); renderBulkBar(); } });
      return;
    }
    if (e.target.closest('[data-bulkclear]')) { clearSelected(); document.querySelectorAll('input.bsel:checked').forEach((x) => { x.checked = false; }); renderBulkBar(); return; }
    const dm = e.target.closest('button[data-dismiss]');
    if (dm) {
      const pb = (state.pushback || []).find((x) => x.issue.id === dm.dataset.issue && x.commit.setters.some((f) => f.id === dm.dataset.dismiss));
      const c = pb && { issue: pb.issue, fr: pb.commit.setters.find((f) => f.id === dm.dataset.dismiss) };
      if (c) startDismiss({ mcp: state.mcp, fr: c.fr, issue: c.issue, onDone: ({ reason }) => { state.audit = [{ category: 'Pushback override', frId: c.fr.id.replace(/-/g, '').toLowerCase(), itemName: c.fr.title, reason, at: new Date().toISOString(), field: 'Pushback' }, ...(state.audit || [])]; recompute(); draw(); } });
      return;
    }
    const rp = e.target.closest('button[data-rmpost]');
    if (rp) {
      const issue = shownIssue(rp.dataset.rmpost) || state.run?.issues.find((i) => i.id === rp.dataset.rmpost);
      if (!issue) return;
      // The team's responsible: by the issue's Team property, else the team its assignees route it to.
      const teamOf = (i) => TEAMS.find((t) => t.toLowerCase() === String(i.team || '').trim().toLowerCase()) || (state.run ? [...issueTeams(state.run, i)].find((t) => TEAM_LEADS[t]) : null) || i.team || null;
      const team = teamOf(issue);
      const full = (i) => ({ ...i, team: teamOf(i), commitSrc: commitSource(i) });
      // At risk dependency / blocked: a template asking the leads whether it is right (Tom, 2026-10-28).
      let template = null; let leads = [];
      if (rp.dataset.rmkind === 'dependency') {
        const blocker = state.run?.issues.find((i) => i.id === rp.dataset.rmblocker);
        if (blocker) { leads = [TEAM_LEADS[teamOf(issue)], TEAM_LEADS[teamOf(blocker)]].filter(Boolean); template = dependencyMessage(full(issue), full(blocker), leads); }
      } else if (rp.dataset.rmkind === 'blocked') {
        // Its "Blocked by": open issues that list it in their blocks; their leads are tagged too.
        const blockers = (state.run?.issues || []).filter((b) => (b.blocks || []).includes(issue.id) && !['Done', "Won't do", 'Duplicate'].includes(b.status)).map(full);
        leads = [TEAM_LEADS[team], ...blockers.map((b) => TEAM_LEADS[b.team])].filter(Boolean);
        leads = [...new Map(leads.map((l) => [l.id, l])).values()];
        template = blockedMessage(full(issue), leads, blockers);
      }
      leads = [...new Map(leads.map((l) => [l.id, l])).values()];
      startRoadmapPost({ mcp: state.mcp, issue: { ...issue, team, commitSrc: commitSource(issue) }, lead: TEAM_LEADS[team] || null, template, leads,
        onDone: ({ link }) => { state.audit = [{ category: 'Roadmap post', field: 'Slack', after: link || '', issueId: issue.id, itemName: issue.name, at: new Date().toISOString() }, ...(state.audit || [])]; draw(); renderDrawer(); } });
      return;
    }
    const ao = e.target.closest('button[data-askowner]');
    if (ao && !ao.disabled) {
      const row = (state.pushback || []).find((x) => x.issue.id === ao.dataset.issue);
      const fr = row?.commit.setters.find((f) => f.id === ao.dataset.askowner);
      if (!row || !fr) return;
      const nidf = fr.id.replace(/-/g, '').toLowerCase();
      const [kind, quarterLabel, teamName] = ao.dataset.ctx.split('|');
      startAskOwner({ mcp: state.mcp, issue: row.issue, fr, customer: String(state.dealNames.get(String(fr.dealId || '').replace(/-/g, '').toLowerCase()) || 'the customer').trim(),
        email: state.owners?.get(nidf), ctx: kind === 'over' ? { kind, quarterLabel, team: teamName } : { kind: 'late' },
        onDone: ({ link }) => { state.audit = [{ category: 'COM/AM asked', field: 'Slack', after: link || '', frId: nidf, issueId: row.issue.id, itemName: fr.title, at: new Date().toISOString() }, ...(state.audit || [])]; draw(); } });
      return;
    }
    const fx = e.target.closest('button[data-dqfix]');
    if (fx) { qualityFix(fx.dataset.dqfix, fx.dataset.dqid); return; }
    const qt = e.target.closest('button[data-qaiteam]');
    if (qt) {
      // One issue from a prep card: the same DM to Qai as At risk → No team, that issue ticked.
      const issue = shownIssue(qt.dataset.qaiteam) || state.run?.issues.find((i) => i.id === qt.dataset.qaiteam);
      if (issue) startEstimatePost({ mcp: state.mcp, groups: [{ label: 'No team', entries: [{ issue, frs: [] }] }], target: ESTIMATE_TARGETS.qaiTeam, preselect: [issue.id], onPosted: estimatePosted, posted: estimatePostsOf });
      return;
    }
    const qe = e.target.closest('button[data-qaiest]');
    if (qe) {
      // One No estimate issue: @Qai estimate in #dev_effort_estimate, that issue ticked (Tom, 2026-10-30).
      const entry = GROUPS.flatMap((g) => state.queues?.[g.key].noEstimate || []).find((x) => x.issue.id === qe.dataset.qaiest);
      if (entry) startEstimatePost({ mcp: state.mcp, groups: [{ label: 'No estimate', entries: [entry] }], target: ESTIMATE_TARGETS.qai, preselect: [entry.issue.id], onPosted: estimatePosted, posted: estimatePostsOf });
      return;
    }
    const ep = e.target.closest('button[data-estpost]');
    if (ep) {
      // No estimate issues, and the FRs with no engineering issue yet (Tom, 2026-10-27): the FR link is posted.
      const frEntry = (fr) => ({ fr: true, issue: { id: fr.id, name: fr.title || 'FR', url: fr.url, team: null, committed: fr.committed }, frs: [fr] });
      if (ep.dataset.estpost === 'qaiTeam') {
        startEstimatePost({ mcp: state.mcp, groups: [{ label: 'No team: invisible in capacity', entries: (state.risk?.noTeam || []).map((e) => ({ ...e, frs: [] })) }], target: ESTIMATE_TARGETS.qaiTeam, onPosted: estimatePosted, posted: estimatePostsOf });
        return;
      }
      const groups = GROUPS.flatMap((g) => [
        { label: `${g.label} · No estimate`, entries: state.queues?.[g.key].noEstimate || [] },
        { label: `${g.label} · No engineering issue`, entries: (state.queues?.[g.key].noIssue || []).filter((e) => e.fr.assignedTeam === 'Engineering').map((e) => frEntry(e.fr)) },
      ]);
      startEstimatePost({ mcp: state.mcp, groups, target: ESTIMATE_TARGETS[ep.dataset.estpost], onPosted: estimatePosted, posted: estimatePostsOf });
      return;
    }
    const fe = e.target.closest('button[data-fr-edit]');
    if (fe && !fe.disabled) {
      const fr = shownFr(fe.dataset.frEdit) || (state.pushback || []).flatMap((x) => x.commit.setters).find((f) => f.id === fe.dataset.frEdit);
      const iid = fe.dataset.issue;
      const issue = iid ? shownIssue(iid) || state.run?.issues.find((i) => i.id === iid) || { id: iid } : null;
      startFrEdit({ mcp: state.mcp, fr, issue, horizon, golive: fr.dealId ? state.dealGolive.get(String(fr.dealId).replace(/-/g, '').toLowerCase()) : null, onDone: (r) => afterFrEdit(fr, r), onIssueStatus: afterIssueStatus });
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('rp-sheet')) { closeSheet(); return; }
    closeDrawer(document.getElementById('drawer')); state.drawer = null;
  });
}

/**
 * Data quality → Fix (Tom, 2026-10-28): per check, the ways to solve one finding. Each opens an existing
 * flow, pre-filled: the FR edit sheet (writes Notion, comment tags the COM/AM), a DM to the COM/AM, a
 * #roadmap_product post to the team lead, the issue status, clearing the dates, or the estimate posts.
 */
function qualityFix(key, id) {
  const e = (state.quality?.[key] || []).find((x) => (x.fr ? x.fr.id : x.issue.id) === id);
  if (!e) return;
  const nidv = (v) => String(v || '').replace(/-/g, '').toLowerCase();
  const { fr, issue } = e;
  const mcp = state.mcp;
  const customer = fr ? String(state.dealNames.get(nidv(fr.dealId)) || 'the customer').trim() : '';
  const golive = fr?.dealId ? state.dealGolive.get(nidv(fr.dealId)) : null;
  const stage = fr?.dealId ? state.dealStage.get(nidv(fr.dealId)) : null;
  const frEdit = (preset) => () => startFrEdit({ mcp, fr, issue, horizon, golive, preset, onDone: (r) => afterFrEdit(fr, r), onIssueStatus: afterIssueStatus });
  const frLink = fr && { name: fr.title || 'FR', url: fr.url, priority: fr.priority };
  const issueLink = issue && { name: issue.name, url: issue.url, status: issue.status };
  const dm = () => () => startAskOwner({ mcp, issue, fr, customer,
    email: state.owners?.get(fr.id) || loadOwnerEmails(mcp, [fr.id]).then((m) => m.get(fr.id)),
    ctx: { kind: 'text', text: qualityDm(key, { fr: frLink, issue: issueLink, customer, golive, stage, committed: fr.committed }) },
    onDone: ({ link }) => { state.audit = [{ category: 'COM/AM asked', field: 'Slack', after: link || '', frId: fr.id, issueId: issue?.id, itemName: fr.title, at: new Date().toISOString() }, ...(state.audit || [])]; } });
  const post = (template = null, leads = []) => () => {
    const team = teamOf(issue);
    startRoadmapPost({ mcp, issue: { ...issue, team, commitSrc: commitSource(issue) }, lead: TEAM_LEADS[team] || null, template, leads,
      onDone: ({ link }) => { state.audit = [{ category: 'Roadmap post', field: 'Slack', after: link || '', issueId: issue.id, itemName: issue.name, at: new Date().toISOString() }, ...(state.audit || [])]; draw(); } });
  };
  const status = (note) => () => startIssueStatus({ mcp, issue, note, onDone: afterIssueStatus });
  const unplan = (why) => () => startClearDates({ mcp, issue, why, onDone: ({ after }) => afterMoves([{ issue, r: { after } }]) });
  const estimate = (target, entry) => () => startEstimatePost({ mcp, groups: [{ label: entry.fr ? 'No engineering issue' : 'No estimate', entries: [entry] }], target, preselect: [entry.issue.id], onPosted: estimatePosted, posted: estimatePostsOf });
  const frAsEntry = fr && { fr: true, issue: { id: fr.id, name: fr.title || 'FR', url: fr.url, team: null, committed: fr.committed }, frs: [fr] };
  const dmOpt = (label, desc) => ({ label, desc, run: dm() });
  const opts = {
    frNoIssue: [
      { label: 'Ask Claude to create or link the issue', desc: 'Post in #product-create-ei-skill-trigger: @claude_code runs the product-feature skill on this FR', run: estimate(ESTIMATE_TARGETS.productFeature, frAsEntry) },
      { label: 'Not needed any more', desc: 'FR edit with Priority "No longer needed" and a comment to the COM/AM', run: frEdit({ priority: 'No longer needed', note: 'Not needed any more: priority set to No longer needed. Check and Save.', comment: 'Closing this: no longer needed. Shout if that\'s wrong.' }) },
      { label: 'Edit the FR', desc: 'Priority, committed date or status, by hand', run: frEdit(null) },
    ],
    issueDoneFrOpen: [
      { label: 'Mark the FR Done and tell the COM/AM', desc: 'Writes FR Status Done; the comment tags the COM/AM to tell the customer', run: frEdit({ status: 'Done', note: `${issue?.name || 'The issue'} is Done: FR Status set to Done. Check and Save.`, comment: `Delivered: ${issue?.name || 'the engineering issue'} is Done. Could u let ${customer} know? Thx!` }) },
      dmOpt('Ask the COM/AM on Slack first', 'A DM asking them to tell the customer and close the FR'),
      { label: 'Not delivered yet: edit the FR', desc: 'If the Done issue does not cover this request', run: frEdit(null) },
    ],
    goLivePassed: [
      { label: 'Went live without it → Needed after go-live', desc: 'FR edit with the new priority and a comment to the COM/AM', run: frEdit({ priority: 'Needed after go-live', note: `Go-live ${golive ? formatDate(golive) : ''} has passed: priority set to Needed after go-live. Check and Save.`, comment: `${customer} went live without this, so it moves to Needed after go-live. Shout if that's wrong.` }) },
      dmOpt('Ask the COM/AM whether the go-live moved', 'A DM asking to update the go-live on the deal if it slipped'),
      { label: 'Edit the FR', desc: 'Priority, committed date or status, by hand', run: frEdit(null) },
    ],
    frCommitPast: [
      { label: 'Set a new committed date', desc: 'FR edit: pick the new Success Committed; the comment tags the COM/AM', run: frEdit({ note: `Committed ${formatDate(fr?.committed)} has passed and ${issue?.name || 'the issue'} is still ${issue?.status || 'open'}. Pick the new date.`, comment: 'The committed date has passed: new date set. Could u let the customer know? Thx!' }) },
      dmOpt('Ask the COM/AM to agree a new date', 'A DM asking them to check with the customer'),
      ...(issue ? [{ label: 'Ask the team lead in #roadmap_product', desc: 'Your message, tagging the lead, with the issue link, planned and committed dates', run: post() }] : []),
    ],
    goLiveCustomerLive: [
      { label: 'Needed after go-live', desc: `The customer is ${stage || 'past go-live'}: FR edit with the new priority`, run: frEdit({ priority: 'Needed after go-live', note: `Deal stage ${stage}: priority set to Needed after go-live. Check and Save.`, comment: `${customer} is ${stage} already, so this is no longer needed for go-live: moved to Needed after go-live.` }) },
      { label: 'No longer needed', desc: 'For a churned or lost customer', run: frEdit({ priority: 'No longer needed', note: `Deal stage ${stage}: priority set to No longer needed. Check and Save.`, comment: `${customer} is ${stage}, so this is no longer needed. Shout if that's wrong.` }) },
      dmOpt('Ask the COM/AM', 'A DM asking whether it is still needed and at which priority'),
    ],
    goLiveNoDate: [
      dmOpt('Ask the COM/AM to set the go-live', 'A DM: set the go-live on the deal, or say it is no longer needed'),
      { label: 'No longer needed', desc: `Deal ${stage || 'without go-live'}: FR edit with priority No longer needed`, run: frEdit({ priority: 'No longer needed', note: `The deal has no go-live${stage ? ` (stage ${stage})` : ''}: priority set to No longer needed. Check and Save.`, comment: `${customer} has no go-live date${stage ? ` (${stage})` : ''}, so this is no longer needed for now. Shout if that's wrong.` }) },
      { label: 'Needed after go-live', desc: 'Keep it, without a go-live commitment', run: frEdit({ priority: 'Needed after go-live', note: 'Priority set to Needed after go-live. Check and Save.' }) },
    ],
    integrationTagged: [
      { label: 'Open it in Notion', desc: 'Check the request; change Type or Category there if it is an integration', run: () => window.open(fr.url, '_blank', 'noopener') },
      dmOpt('Ask the COM/AM', 'A DM: product work or an integration?'),
      { label: 'Edit the FR', desc: 'Priority, committed date or status', run: frEdit(null) },
    ],
    blockedNoBlocker: [
      { label: 'Ask the team lead what blocks it', desc: 'Ready-made post in #roadmap_product: is it still blocked, and which issue blocks it?', run: () => document.querySelector(`button[data-rmpost="${issue?.id}"]`)?.click() },
      { label: 'Not blocked: change the status', desc: 'Set the engineering issue status', run: status('No open blocker is linked. Pick the right status.') },
    ],
    plannedScoping: [
      { label: 'Change the status', desc: 'Scoping is done: set the engineering issue status', run: status(`Planned for ${formatDate(issue?.end || issue?.start)} but still ${issue?.status}.`) },
      { label: 'Take it out of the plan', desc: 'Clear Start and End until scoping is done', run: unplan('Still in Product scoping') },
      { label: 'Ask the team lead in #roadmap_product', desc: 'Your message, tagging the lead', run: post() },
    ],
    plannedNoEffort: [
      { label: 'Ask Claude for an estimate', desc: 'Post in #product-create-ei-skill-trigger: @claude_code runs the product-feature skill', run: issue && estimate(ESTIMATE_TARGETS.productFeature, { issue, frs: state.scores?.get(issue.id)?.frs || [] }) },
      { label: 'Ask @Qai to estimate', desc: 'Post in #dev_effort_estimate (the old flow)', run: issue && estimate(ESTIMATE_TARGETS.qai, { issue, frs: state.scores?.get(issue.id)?.frs || [] }) },
      { label: 'Take it out of the plan', desc: 'Clear Start and End until it has an estimate', run: unplan('No estimate yet') },
    ],
    staleBlocker: [
      { label: 'Ask the team lead to remove the link', desc: 'Ready-made post in #roadmap_product, tagging the lead (the planner never edits links)', run: () => {
        const blockers = (state.run?.issues || []).concat(state.backlog || []).filter((b) => (b.blocks || []).includes(issue.id) && ['Done', "Won't do", 'Duplicate'].includes(b.status));
        const lead = TEAM_LEADS[teamOf(issue)];
        post(staleBlockerMessage({ ...issue, team: teamOf(issue), commitSrc: commitSource(issue) }, [lead], blockers), [lead].filter(Boolean))();
      } },
      { label: 'Open it in Notion', desc: 'Remove the "Blocked by" link yourself', run: () => window.open(issue.url, '_blank', 'noopener') },
    ],
  }[key];
  const what = fr ? `${customer} · ${fr.title || 'FR'}` : issue.name;
  startChoice({ title: 'Fix', sub: `${what}. ${e.detail}`, options: opts.filter((o) => o.run) });
}

/** A skill-trigger / @Qai / Qai DM post just made: record it locally as the audit log will, so the card shows its Slack link at once. */
function estimatePosted({ item, link, channel }) {
  if (!item) return;
  state.audit = [{ category: 'Estimate post', field: 'Slack', before: channel, after: link || '', ...(item.fr ? { frId: item.id } : { issueId: item.id }), itemName: item.name, at: new Date().toISOString() }, ...(state.audit || [])];
  if (state.tab !== 'capacity') draw();
  renderDrawer();
}

/** Skill-trigger / @Qai / Qai DM posts of an issue or FR from the audit log, newest first. */
function estimatePostsOf(id) {
  return (state.audit || []).filter((a) => a.category === 'Estimate post' && (a.issueId === id || a.frId === id))
    .map((a) => ({ at: a.at, channel: a.before || 'Slack', link: /^https:/.test(a.after || '') ? a.after : null }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/** The team an issue routes to: its Team property, else its assignees' team. */
function teamOf(i) {
  return TEAMS.find((t) => t.toLowerCase() === String(i.team || '').trim().toLowerCase()) || (state.run ? [...issueTeams(state.run, i)].find((t) => TEAM_LEADS[t]) : null) || i.team || null;
}

/** Patch a feature row's Start/End in the loaded rows so the grid follows the write. */
function blockersOf(issue) {
  return (state.run?.issues || []).filter((i) => (i.blocks || []).includes(issue.id) && !['Done', "Won't do", 'Duplicate'].includes(i.status));
}

function afterMove(issue, r) { afterMoves([{ issue, r }]); }

/** Patch the new dates into the loaded rows and redraw once. done: [{ issue, r: { after } }] */
function afterMoves(done) {
  const next = new Map(done.map(({ issue, r }) => [issue.id, r.after]));
  let hit = false;
  state.rows = state.rows.map((r) => {
    const blob = r.serve_engineering_capacity_features;
    if (blob == null) return r;
    let changed = false;
    const feats = parseBlob(blob).map((f) => {
      const after = next.get(String(f[0]).replace(/-/g, '').toLowerCase());
      if (!after) return f;
      hit = changed = true;
      const g = f.slice(); g[24] = after.start; g[25] = after.end; return g;
    });
    return changed ? { ...r, serve_engineering_capacity_features: JSON.stringify(feats) } : r;
  });
  if (hit) show(state.rows);
  renderDrawer();
}

/** Bulk bar: shows while issues are ticked; same month / quarter buttons as on a card. */
/** Notion comments for the No-engineering-issue FRs on screen, read once per FR in the background. */
function loadComments() {
  if (!state.mcp || !state.queues || state.frCommentsLoading) return;
  const ids = [...new Set(GROUPS.flatMap((g) => state.queues[g.key].noIssue)
    .filter((e) => e.fr.assignedTeam === 'Engineering').map((e) => e.fr.id))].filter((id) => !state.frComments.has(id));
  if (!ids.length) return;
  state.frCommentsLoading = true;
  loadFrComments(state.mcp, ids)
    .then(async (m) => {
      for (const [id, c] of m) {
        if (c.last?.by) { if (!state.users.has(c.last.by)) state.users.set(c.last.by, await userName(state.mcp, c.last.by)); c.last.name = state.users.get(c.last.by) || ''; }
        state.frComments.set(id, c);
      }
    })
    .finally(() => { state.frCommentsLoading = false; if (state.tab === 'prep') draw(); });
}

/** Quarter plan: set an issue's Priority in Notion straight from the select (audited). */
async function setPriority(sel) {
  const issue = state.run?.issues.find((i) => i.id === sel.dataset.qpissue);
  const priority = sel.value;
  if (!issue || !priority || !state.mcp) return;
  const prev = issue.priority || '';
  sel.disabled = true;
  try {
    const r = await setIssuePriority(state.mcp, { issue, priority });
    // Keep it in the loaded rows so redraws and a later reload of this view show the new value.
    state.rows = state.rows.map((row) => {
      const blob = row.serve_engineering_capacity_features;
      if (blob == null) return row;
      let hit = false;
      const feats = parseBlob(blob).map((f) => { if (String(f[0]).replace(/-/g, '').toLowerCase() !== issue.id) return f; hit = true; const g = f.slice(); g[33] = priority; return g; });
      return hit ? { ...row, serve_engineering_capacity_features: JSON.stringify(feats) } : row;
    });
    issue.priority = priority;
    toast(r.changed ? `Priority set to ${priority}: ${issue.name}. Logged.` : `Already ${priority} in Notion.`);
  } catch (err) {
    sel.value = prev;
    toast(`Priority not saved: ${explainError(NOTION, err)}`, 'bad');
  } finally { sel.disabled = false; }
}

/** Patch an engineering issue's new Status into the loaded rows and recompute (Done / Won't do drop it). */
function afterIssueStatus(issue, status) {
  const id = String(issue.id).replace(/-/g, '').toLowerCase();
  let hit = false;
  const rows = state.rows.map((row) => {
    const blob = row.serve_engineering_capacity_features;
    if (blob == null) return row;
    let changed = false;
    const feats = parseBlob(blob).map((f) => { if (String(f[0]).replace(/-/g, '').toLowerCase() !== id) return f; hit = changed = true; const g = f.slice(); g[5] = status; return g; });
    return changed ? { ...row, serve_engineering_capacity_features: JSON.stringify(feats) } : row;
  });
  const local = { category: 'EI status changed', field: 'Status', after: status, issueId: id, itemName: issue.name, at: new Date().toISOString() };
  state.audit = [local, ...(state.audit || [])];
  if (hit) { show(rows); if (state.extra.scores === 'ok') rescore(); }
}

/**
 * Team filter as a tick list (Tom, 2026-10-27): one or more teams, none or all four = All teams.
 * Applies to every tab; remembered per viewer in this browser.
 */
let setTeams = () => {};
function initTeamPicker() {
  const btn = document.getElementById('teamBtn'); const panel = document.getElementById('teamPanel');
  const boxes = [...panel.querySelectorAll('input[data-team]')];
  const label = () => {
    const p = pickedTeams(state.teamFilter);
    document.getElementById('teamLbl').textContent = !p ? 'All teams' : p.length === 1 ? p[0] : `${p.length} teams: ${p.join(', ')}`;
    btn.title = p ? p.join(', ') : 'All teams';
  };
  const apply = () => {
    const picked = boxes.filter((b) => b.checked).map((b) => b.dataset.team);
    state.teamFilter = pickedTeams(picked) ? picked : 'all';
    try { localStorage.setItem('rp.teams', JSON.stringify(pickedTeams(state.teamFilter) || [])); } catch { /* storage unavailable */ }
    label(); recompute(); draw();
  };
  const open = (on) => { panel.hidden = !on; btn.setAttribute('aria-expanded', String(on)); };
  try { const saved = JSON.parse(localStorage.getItem('rp.teams') || '[]'); if (pickedTeams(saved)) state.teamFilter = pickedTeams(saved); } catch { /* storage unavailable */ }
  const p0 = pickedTeams(state.teamFilter);
  boxes.forEach((b) => { b.checked = !!p0?.includes(b.dataset.team); });
  label();
  // Same filter from the team toggles in the Quarter plan header.
  setTeams = (list) => { boxes.forEach((b) => { b.checked = list.includes(b.dataset.team); }); apply(); };
  btn.addEventListener('click', () => open(panel.hidden));
  panel.addEventListener('change', apply);
  panel.addEventListener('click', (e) => {
    if (e.target.closest('[data-teamall]')) { boxes.forEach((b) => { b.checked = false; }); apply(); }
    if (e.target.closest('[data-teamdone]')) open(false);
  });
  document.addEventListener('click', (e) => { if (!panel.hidden && !e.target.closest('.teampick')) open(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !panel.hidden) open(false); });
}

/** Issues kept out of the push-out suggestions (Tom, 2026-10-29): the latest "Push-out override" row per issue decides. */
function keptSet() {
  const last = new Map();
  for (const a of [...(state.audit || [])].sort((x, y) => String(x.at).localeCompare(String(y.at)))) if (a.category === 'Push-out override' && a.issueId) last.set(a.issueId, a.after === 'Kept');
  return new Set([...last].filter(([, k]) => k).map(([id]) => id));
}

/** FR id → its "COM/AM asked" DMs from the audit log, newest first. */
function askedMap() {
  const m = new Map();
  for (const a of state.audit || []) if (a.category === 'COM/AM asked' && a.frId) (m.get(a.frId) || m.set(a.frId, []).get(a.frId)).push({ at: a.at, link: /^https:/.test(a.after || '') ? a.after : null });
  for (const v of m.values()) v.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return m;
}

function renderBulkBar() {
  const bar = document.getElementById('bulkbar');
  const n = selectedIssues().length;
  const nf = selectedFrs().length;
  bar.hidden = (!n && !nf) || state.readOnly;
  if (bar.hidden) return;
  // Ticked FRs (No engineering issue): one Edit for all of them (Tom, 2026-10-29).
  if (!n) {
    bar.innerHTML = `<span class="bcount"><b>${nf}</b> FR${nf === 1 ? '' : 's'} selected</span><button class="bedit" data-frbulkedit>Edit ${nf} FR${nf === 1 ? '' : 's'}</button><button class="bclear" data-frbulkclear>Clear</button>`;
    return;
  }
  const btn = (d, label) => `<button data-bulkmove="${d}" data-label="${label}" title="Set Start = End = ${d} on the ${n} selected">${label}</button>`;
  let h = `<span class="bcount"><b>${n}</b> selected</span><span class="datebtns">`;
  for (const m of potMonths(horizon)) h += btn(m.lastFriday, m.label);
  h += '<span class="sep"></span>';
  for (const q of potQuarters(horizon)) h += btn(q.lastFriday, q.shortLabel);
  bar.innerHTML = `${h}</span><button class="bclear" data-bulkclear>Clear</button>${nf ? `<button class="bedit" data-frbulkedit>Edit ${nf} FR${nf === 1 ? '' : 's'}</button>` : ''}`;
}

/** Patch an FR's priority in the loaded task rows and rescore. */
/**
 * Patch an FR edit into the loaded rows and recompute at once, so the change shows without a refresh
 * (Tom, 2026-10-27): priority (moves it between prep groups or out), status (Won't do drops it), and
 * the FR's effective committed date (earliest of Success Committed and go-live when "Needed for
 * go-live"), which the engine also carries onto its issues.
 */
function afterFrEdit(fr, { changes, before = {}, commented = false, comment = '' }) {
  // Record it locally as the audit log will, so the Pushback to-do list and History update at once.
  const frId = String(fr.id).replace(/-/g, '').toLowerCase();
  const now = new Date().toISOString();
  const local = commented
    ? [{ category: 'Owner advised', field: 'Comment', frId, itemName: fr.title, reason: comment, at: now, after: changes.map((c) => `${c.label}: ${c.before || '–'} → ${c.after || '–'}`).join('; ') }]
    : changes.map((c) => ({ category: c.category, field: c.field, before: c.before, after: c.after, frId, itemName: fr.title, reason: comment, at: now }));
  if (local.length) state.audit = [...local, ...(state.audit || [])];
  if (commented || !changes.length) { recompute(); if (state.tab !== 'capacity') draw(); return; }
  const val = (field, cur) => { const c = changes.find((x) => x.field === field); return c ? c.after : cur; };
  const priority = val('Priority', before.priority);
  const status = val('Status', before.status);
  const golive = fr.dealId ? state.dealGolive.get(String(fr.dealId).replace(/-/g, '').toLowerCase()) : null;
  const committed = effectiveCommitted({ successCommitted: val('Success Committed', before.successCommitted), priority, golive });
  // Closed or dropped FRs carry no committed date (as Lightdash: NULL for Won't do).
  const gone = status === "Won't do" || status === 'Done' || priority === "Won't do" || priority === 'No longer needed';
  const upd = { 4: priority, 5: status, 8: gone ? null : committed };
  const patch = (rows) => rows.map((r) => {
    const blob = r.serve_engineering_capacity_customer_tasks;
    if (blob == null) return r;
    let hit = false;
    const tasks = parseBlob(blob).map((t) => {
      if (String(t[0]).replace(/-/g, '').toLowerCase() !== fr.id) return t;
      hit = true; return Object.assign(t.slice(), upd);
    });
    return hit ? { ...r, serve_engineering_capacity_customer_tasks: JSON.stringify(tasks) } : r;
  });
  // Issues linked to this FR (Tom, 2026-10-27): Lightdash's issue date is a stored copy of the earliest
  // FR committed date, so it is recalculated from the FRs as they are now.
  const minC = (frs) => (frs || []).map((f) => f.committed && String(f.committed).slice(0, 10)).filter(Boolean).sort()[0] || null;
  const affected = [...(state.allScores || state.scores || new Map())].filter(([, s]) => s.frs?.some((f) => f.id === fr.id)).map(([iid]) => iid);
  state.extra.taskRows = patch(state.extra.taskRows);
  show(patch(state.rows)); // reruns the engine: the issue's committed date and TBD placement follow
  if (state.extra.scores !== 'ok') return;
  rescore();
  const issueById = new Map([...(state.run?.issues || []), ...(state.backlog || [])].map((i) => [i.id, i]));
  const recommit = new Map();
  // Notion's issue "Committed" is a formula over its FRs: the stored copy becomes the earliest FR date now.
  for (const iid of affected) {
    const own = issueById.get(iid)?.committedOwn;
    const now = minC((state.allScores || state.scores).get(iid)?.frs);
    if ((own ? String(own).slice(0, 10) : null) !== now) recommit.set(iid, now);
  }
  if (!recommit.size) return;
  const setCommit = (rows) => rows.map((r) => {
    const blob = r.serve_engineering_capacity_features;
    if (blob == null) return r;
    let hit = false;
    const feats = parseBlob(blob).map((f) => {
      const id = String(f[0]).replace(/-/g, '').toLowerCase();
      if (!recommit.has(id)) return f;
      hit = true; const g = f.slice(); g[26] = recommit.get(id); return g;
    });
    return hit ? { ...r, serve_engineering_capacity_features: JSON.stringify(feats) } : r;
  });
  state.extra.featureRows = setCommit(state.extra.featureRows);
  show(setCommit(state.rows));
  rescore();
}

function renderDrawer() {
  if (!state.drawer || !state.run) return;
  openDrawer(document.getElementById('drawer'), {
    run: state.run, grid: state.grid, horizon, changes: state.status?.changed || [],
    scores: state.scores, backlog: state.backlog, extra: state.extra, names: state.dealNames, kept: keptSet(), ...state.drawer,
  });
  restoreFolds(document.getElementById('drawer'));
}

/**
 * What sets an issue's committed date when no shown FR has it (Tom, 2026-10-27), in the engine's order:
 * an issue it blocks (it inherits that deadline), a linked FR left out of the list (unsigned customer,
 * no customer, not a feature request, closed), or the issue's own committed date in Lightdash.
 */
function commitSourceOf(issueId, day) {
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const all = [...(state.run?.issues || []), ...(state.backlog || [])];
  const byId = new Map(all.map((i) => [i.id, i]));
  const issue = byId.get(issueId);
  if (!issue) return null;
  const blocked = (issue.blocks || []).map((id) => byId.get(id)).find((b) => b && String(b.committed || '').slice(0, 10) === day);
  if (blocked) {
    const name = blocked.url ? `<a href="${esc(blocked.url)}" target="_blank" rel="noopener" title="Open the issue that carries this committed date in Notion">${esc(blocked.name)}</a>` : esc(blocked.name);
    return `<span title="This issue blocks it, so it inherits that deadline">commit set by the issue it blocks: ${name}</span>`;
  }
  const fr = (state.allScores?.get(issueId)?.frs || []).find((f) => f.committed === day);
  if (fr) {
    const deal = String(fr.dealId || '').replace(/-/g, '').toLowerCase();
    const why = !deal ? 'no customer' : state.extra.signed && !state.extra.signed.has(deal) ? 'customer not signed' : fr.type && fr.type !== 'Feature request' ? `type ${fr.type}` : fr.status ? `FR status ${fr.status}` : 'not in this list';
    const link = fr.url ? `<a href="${esc(fr.url)}" target="_blank" rel="noopener">${esc(fr.title || 'FR')}</a>` : esc(fr.title || 'FR');
    return `commit set by an FR not listed here (${esc(why)}): ${esc(state.dealNames.get(deal) || 'No customer')} · ${link}`;
  }
  if (String(issue.committedOwn || '').slice(0, 10) === day) return '<span title="The committed date stored on the engineering issue in Lightdash, from an FR that is closed or no longer linked, or set by hand">commit set on the issue itself (no open FR has this date)</span>';
  return null;
}

/**
 * What sets an issue's committed date, for Slack posts (Tom, 2026-10-28): { customers } whose FR has the
 * date, or { blocks: issue } it inherits it from, or null. Same order as the card's commit source.
 */
function commitSource(issue) {
  const day = issue.committed ? String(issue.committed).slice(0, 10) : null;
  if (!day) return null;
  const nid = (v) => String(v || '').replace(/-/g, '').toLowerCase();
  const names = (frs) => [...new Set(frs.filter((f) => f.committed === day).map((f) => String(state.dealNames.get(nid(f.dealId)) || 'No customer').trim()))];
  const shown = names(state.scores?.get(issue.id)?.frs || []);
  if (shown.length) return { customers: shown };
  const byId = new Map([...(state.run?.issues || []), ...(state.backlog || [])].map((i) => [i.id, i]));
  const blocked = (issue.blocks || []).map((id) => byId.get(id)).find((b) => b && String(b.committed || '').slice(0, 10) === day);
  if (blocked) return { blocks: { id: blocked.id, name: blocked.name, url: blocked.url } };
  const hidden = names(state.allScores?.get(issue.id)?.frs || []);
  return hidden.length ? { customers: hidden } : null;
}

function rescore() {
  const x = state.extra;
  state.scores = scoreRows([...state.rows, ...x.taskRows, ...x.featureRows], x.deals, { signed: x.signed });
  // Every linked FR, signed or not: only to name what sets a committed date the shown FRs don't explain.
  state.allScores = x.signed ? scoreRows([...state.rows, ...x.taskRows, ...x.featureRows], x.deals) : state.scores;
  state.backlog = x.featureRows.length ? toIssues(x.featureRows) : [];
  recompute();
  renderChrome();
  if (state.tab !== 'capacity') draw();
  renderDrawer();
}

function onExtra(step, p) {
  const x = state.extra;
  if (p.error) { x[step] = 'error'; x[`${step}Error`] = p.error; }
  else if (step === 'scores') { x.scores = 'ok'; x.deals = dealSizeMap(p.deals); x.taskRows = p.tasks; x.signed = p.signed instanceof Set ? p.signed : p.signed ? signedSet(p.signed) : null; x.featureFrs = p.frs instanceof Set ? p.frs : p.frs ? featureFrSet(p.frs) : null; x.nonFeature = p.nonFeature instanceof Set ? p.nonFeature : p.nonFeature ? featureFrSet(p.nonFeature) : null; x.mixed = p.mixed instanceof Map ? p.mixed : p.mixed ? mixedMap(p.mixed) : null; }
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
  pills.push(`<span class="pill">Today <b>${esc(formatDate(TODAY))}</b></span>`);
  if (state.mode === 'live' && state.run) {
    // Where capacity comes from: Lightdash engineering_capacity (the data app's engine, rebuilt hourly), the Notion feed, or our own copy.
    const src = state.run.capacitySource;
    const ld = /Lightdash/.test(src?.engine || '');
    if (src) pills.push(`<span class="pill" title="${ld ? 'Capacity from Lightdash engineering_capacity: the data app\'s own engine, rebuilt hourly, read when the planner opened.' : `Capacity from the data app's own engine (Sander's daily run${src.engine ? `, engine ${esc(src.engine)}` : ''}).`} Demand from the planner's engine copy.">Capacity ${ld ? 'Lightdash ' : ''}${esc(fmtTime(src.run))}</span>`);
    else {
      const why = `Lightdash engineering_capacity not read${state.feedError ? `: ${state.feedError}` : ''}`;
      pills.push(`<span class="pill bad" title="${esc(why)}. Capacity, Quarter plan and Pushback are blocked until it loads: no fallback, so no wrong numbers. Refresh to retry.">Capacity unavailable</span>`);
    }
  }
  document.getElementById('pills').innerHTML = pills.join(' ');

  const banners = [];
  if (s.lightdashError) banners.push(`<div class="banner bad"><b>No capacity data.</b> ${esc(s.lightdashError)}</div>`);
  if (s.notionError) banners.push(`<div class="banner warn"><b>Notion not read.</b> ${esc(s.notionError)} Showing Lightdash as of ${esc(fmtTime(s.syncedAt))}; edits made after that are missing.</div>`);
  document.getElementById('banners').innerHTML = banners.join('');
}

/** COM/AM emails for the pushback list, loaded once when the tab first opens. */
async function loadOwners() {
  if (state.owners || state.ownersLoading || !state.mcp || !state.pushback) return;
  state.ownersLoading = true;
  try { state.owners = await loadOwnerEmails(state.mcp, [...new Set(state.pushback.flatMap((x) => x.commit.setters.map((f) => f.id.replace(/-/g, '').toLowerCase())))]); } catch { state.owners = new Map(); }
  state.ownersLoading = false;
  if (state.tab === 'pushback') draw();
}

/** At-risk flags (from the run) and prep queues (once all FRs and the backlog are in). */
function recompute() {
  if (!state.run) return;
  state.risk = atRisk(state.run, { team: state.teamFilter, baseline: state.baseline });
  const x = state.extra;
  state.queues = x.scores === 'ok' && x.backlog !== 'loading'
    ? prepQueues({ run: state.run, backlog: state.backlog, scores: state.scores, taskRows: [...state.rows, ...x.taskRows], featureRows: [...state.rows, ...x.featureRows], team: state.teamFilter, signed: x.signed, featureFrs: x.featureFrs })
    : null;
  // Pushback = make the plan fit (Tom, 2026-10-28). Only "Not a pushback" hides an FR here.
  const notPushback = new Set((state.audit || []).filter((a) => a.category === 'Pushback override' && a.frId).map((a) => a.frId));
  state.fit = x.scores === 'ok' && state.grid && capacityOk() ? planFit({
    run: state.run, grid: state.grid, horizon, scores: state.scores, allScores: state.allScores,
    dealSize: x.deals, dismissed: notPushback, kept: keptSet(), team: state.teamFilter,
  }) : null;
  state.pushback = state.fit ? [...state.fit.cells.flatMap((c) => (c.fits ? [] : c.committed)), ...state.fit.late] : null;
  // Data quality (Tom, 2026-10-28): once all FRs and the backlog are in.
  state.quality = x.scores === 'ok' && x.backlog !== 'loading' ? dataQuality({
    run: state.run, backlog: state.backlog, taskRows: [...state.rows, ...x.taskRows], featureRows: [...state.rows, ...x.featureRows],
    dealRows: state.rows, signed: x.signed, nonFeature: x.nonFeature, mixed: x.mixed, team: state.teamFilter, today: TODAY,
  }) : null;
  document.getElementById('cntDq').textContent = qualityCount(state.quality) ?? '';
  state.weekly = state.audit ? weeklyLoadChanges({ audit: state.audit, changes: state.status?.changed || [], issues: state.run.issues, now: NOW }) : null;
  document.getElementById('cntPb').textContent = state.pushback ? new Set(state.pushback.map((x) => x.issue.id)).size : '';
  const c = tabCounts(state.risk, state.queues);
  document.getElementById('cntRisk').textContent = c.risk ?? '';
  document.getElementById('cntPrep').textContent = c.prep ?? '';
}

/** Live page: capacity read from Lightdash. No fallback (Tom, 2026-10-29); the local preview uses the engine copy. */
const capacityOk = () => state.mode !== 'live' || !!state.run?.capacitySource;

/**
 * Open / closed toggles survive redraws (Tom, 2026-10-29: every action collapsed the lists again).
 * Each section, "Show all" and FR list remembers what the viewer last did, per tab (and the cell drawer),
 * for this page load.
 */
const folds = new Map();
function foldKey(d) {
  const id = d.id || d.dataset.more || d.dataset.fold;
  return id ? `${d.closest('#drawer') ? 'drawer' : state.tab}:${id}` : null;
}
document.addEventListener('toggle', (e) => {
  if (e.target.tagName !== 'DETAILS') return;
  const k = foldKey(e.target);
  if (k) folds.set(k, e.target.open);
}, true);
function restoreFolds(root) {
  root?.querySelectorAll('details').forEach((d) => { const k = foldKey(d); if (k && folds.has(k)) d.open = folds.get(k); });
}

function draw() {
  drawTab();
  restoreFolds(document.getElementById('grid'));
}

function drawTab() {
  document.querySelectorAll('nav.tabs button[data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab));
  const onGrid = state.tab === 'capacity';
  document.querySelector('.note').hidden = !onGrid;
  const main = document.getElementById('grid');
  if (['capacity', 'qplan', 'pushback'].includes(state.tab) && state.run && !capacityOk()) {
    main.innerHTML = `<div class="lists"><div class="banner bad"><b>Capacity unavailable.</b> Lightdash engineering_capacity was not read${state.feedError ? `: ${esc(state.feedError.replace(/\.$/, ''))}` : ''}. Capacity, Quarter plan and Pushback stay blocked rather than show wrong numbers. Use ↻ Refresh to retry; Prep queues, At risk, Data quality and History still work.</div></div>`;
    return;
  }
  if (state.tab === 'risk' && state.risk) { renderAtRisk(main, { risk: state.risk, horizon, scores: state.scores, loading: state.extra.scores === 'loading', baselineError: state.baselineError, sort: state.listSort, readOnly: state.readOnly || !state.mcp }); return; }
  if (state.tab === 'prep') { loadComments(); renderPrep(main, { queues: state.queues, horizon, scores: state.scores, loading: state.extra.scores === 'loading' || state.extra.backlog === 'loading', readOnly: state.readOnly || !state.mcp, sort: state.listSort, comments: state.frComments }); return; }
  if (state.tab === 'pushback') { loadOwners(); renderPushback(main, { fit: state.fit, loading: state.extra.scores === 'loading', owners: state.mcp ? state.owners : new Map(), names: state.dealNames, readOnly: state.readOnly, team: state.teamFilter, asked: askedMap() }); return; }
  if (state.tab === 'qplan') { if (state.run) renderQuarterPlan(main, { run: state.run, grid: state.grid, scores: state.scores, open: state.qpOpen, horizon, quarterKey: state.qpQuarter || horizon[0].key, team: state.teamFilter, readOnly: state.readOnly || !state.mcp, sort: state.qpSort || { key: 'plan', dir: 1 } }); return; }
  if (state.tab === 'quality') { renderQuality(main, { quality: state.quality, horizon, scores: state.scores, loading: state.extra.scores === 'loading' || state.extra.backlog === 'loading', team: state.teamFilter, readOnly: state.readOnly || !state.mcp }); return; }
  if (state.tab === 'history') { renderHistory(main, { audit: state.audit, auditError: state.auditError, weekly: state.weekly, changes: state.status?.changed || [], users: state.users, syncedAt: state.status?.syncedAt, growth: state.risk?.effortGrowth, growthError: state.baselineError, horizon, scores: state.scores }); return; }
  if (state.grid) renderGrid(document.getElementById('grid'), state.grid, horizon, state);
}

function show(rows) {
  state.rows = rows;
  state.dealNames = dealNameMap(rows);
  state.dealStage = new Map(rows.flatMap((r) => parseBlob(r.serve_engineering_capacity_deals)).filter((d) => d[0] && d[3]).map((d) => [String(d[0]).replace(/-/g, '').toLowerCase(), String(d[3]).trim()]));
  state.dealGolive = new Map(rows.flatMap((r) => parseBlob(r.serve_engineering_capacity_deals)).filter((d) => d[0] && d[5]).map((d) => [String(d[0]).replace(/-/g, '').toLowerCase(), String(d[5]).slice(0, 10)]));
  state.run = runCapacity(rows, { now: NOW });
  if (state.feed) applyFeed(state.run, state.feed);
  state.grid = buildGrid(state.run, horizon);
  state.noTeam = issuesWithoutTeam(state.run);
  setDealNames(state.dealNames);
  setCommitSource(commitSourceOf);
  // #roadmap_product posts per issue, newest first, from the audit log (and the ones made this session).
  // Skill-trigger / @Qai / Qai DM posts per issue or FR (Tom, 2026-10-29), newest first.
  setEstimatePosts(estimatePostsOf);
  setRoadmapPosts((id) => (state.audit || []).filter((a) => a.category === 'Roadmap post' && a.issueId === id).map((a) => ({ at: a.at, link: /^https:/.test(a.after || '') ? a.after : null })).sort((a, b) => String(b.at).localeCompare(String(a.at))));
  recompute();
  renderChrome();
  draw();
}

/**
 * Everything the live page reads: Lightdash rows with the Notion overlay, the capacity feed, then in
 * the background the extras (scores, backlog), audit log and effort baseline. Used on open and by the
 * Refresh button, which keeps the open tab, team filter, sort and ticked issues.
 */
async function loadAllLive(mcp) {
  state.loadingAll = true;
  try { return await loadAllLiveOnce(mcp); } finally { state.loadingAll = false; }
}
async function loadAllLiveOnce(mcp) {
  state.status = { ...(state.status || {}), lightdash: 'loading', notion: 'loading' };
  renderChrome();
  state.feedError = null;
  const [{ rows, status }, feed] = await Promise.all([
    loadLive(mcp),
    loadCapacityFeed(mcp).catch((err) => { state.feedError = explainError('Lightdash', err); return null; }),
  ]);
  state.feed = feed;
  state.status = status;
  if (!rows) { renderChrome(); document.getElementById('grid').innerHTML = ''; return false; }
  state.frComments = new Map(); // re-read on the next Prep queues draw
  show(rows);
  renderDrawer();
  const background = [
    loadExtras(mcp, status.overlay, onExtra, { frOverlay: status.frOverlay, golive: status.golive }),
    loadAudit(mcp)
      .then(async (audit) => {
        state.audit = audit; state.auditError = null;
        for (const id of new Set(audit.map((a) => a.by).filter(Boolean))) if (!state.users.has(id)) state.users.set(id, await userName(mcp, id));
      })
      .catch((err) => { state.auditError = explainError(NOTION, err); })
      .finally(() => { recompute(); if (['history', 'pushback'].includes(state.tab)) draw(); }),
    // Baseline from the Notion-overlaid rows, so first-seen effort is today's live value.
    syncBaseline(mcp, state.run, quarterKeyOf(NOW), { write: !state.readOnly })
      .then(({ baseline }) => { state.baseline = baseline; state.baselineError = null; })
      .catch((err) => { state.baselineError = explainError(NOTION, err); })
      .finally(() => { recompute(); if (['risk', 'history'].includes(state.tab)) draw(); }),
  ];
  await Promise.allSettled(background);
  return true;
}

async function refresh() {
  if (!state.mcp || state.refreshing) return;
  if (state.loadingAll) return toast('Still loading, try again in a few seconds.');
  const btn = document.getElementById('refreshBtn');
  state.refreshing = true; btn.disabled = true; btn.textContent = '↻ Refreshing…';
  try {
    const ok = await loadAllLive(state.mcp);
    toast(ok ? `Refreshed. Lightdash ${fmtTime(state.status?.syncedAt)}, Notion live.` : 'Refresh failed: see the connector icons.', ok ? '' : 'bad');
  } catch (err) {
    toast(`Refresh failed: ${explainError('Lightdash', err)}`, 'bad');
  } finally {
    state.refreshing = false; btn.disabled = false; btn.textContent = '↻ Refresh';
  }
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
    document.getElementById('refreshBtn').hidden = false;
    // Read-only for anyone who cannot edit the artifact (Tom picks Editor/Viewer in Share).
    const user = await window.claude.use('user').catch(() => null);
    state.readOnly = !(await user?.canEdit?.().catch(() => false));
    setReadOnly(state.readOnly);
    state.mode = 'live';
    await loadAllLive(mcp);
    return;
  }
  state.mode = Array.isArray(window.__RP_ROWS__) ? 'snapshot' : 'fake';
  state.baselineError = 'only kept on the live page.';
  show(state.mode === 'snapshot' ? window.__RP_ROWS__ : fakeLightdashRows(horizon));
  // Local preview: a saved backlog ({deals, tasks, features} Lightdash rows) if given, else none.
  const ex = window.__RP_EXTRA__ || {};
  onExtra('scores', { deals: ex.deals || [], tasks: ex.tasks || [], signed: ex.signed || null, frs: ex.frs || null });
  onExtra('backlog', { features: ex.features || [] });
}

boot();
