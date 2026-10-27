// Prep queues (SPEC "Features and screens" > 3). Per FR priority group, what blocks planning:
//   noIssue:    open FRs with no engineering issue linked
//   noEstimate: linked issues with no FE/BE/MOB effort
//   notPlanned: linked issues with effort but no Start/End (not on the month/pot grid)
// An issue sits in the highest group among its linked FRs.
// Only FRs of signed customers count (HubSpot deal status Closed-Won; Tom, 2026-10-10) when
// `signed` is given; FRs with no customer are dropped then too.
// Only feature requests count: FR Type "Feature request" with Category containing "Feature Request"
// (Tom, 2026-10-26). Integration requests, onboarding tasks, change requests and feature requests in
// other categories (BigQuery, Pallet Network, Custom Exports…) are left out. Category is not in the
// capacity rows, so `featureFrs` (FR ids that pass both rules) comes from a separate Lightdash query;
// without it only the Type rule applies.

import { issueTeams, TEAMS, pickedTeams } from './capacity.js';

export const GROUPS = [
  { key: 'goLive', label: 'Required for GO LIVE', priorities: ['Needed 1 month before', 'Needed for go-live'] },
  { key: 'top3', label: 'Top 3', priorities: ['Top 3'] },
];
const CLOSED = new Set(['Done', "Won't do", 'Duplicate']);
export const FR_TYPE = 'Feature request';
const SKILLS = ['frontend', 'backend', 'mobile'];
const effortOf = (i) => SKILLS.reduce((a, s) => a + (i.skillEfforts?.[s] || 0), 0);
const nid = (x) => String(x || '').replace(/-/g, '').toLowerCase();
const groupOf = (priority) => GROUPS.find((g) => g.priorities.includes(priority))?.key || null;
const blob = (r, n) => { const v = r[`serve_engineering_capacity_${n}`]; return Array.isArray(v) ? v : v ? JSON.parse(v) : []; };

/**
 * @param run      runCapacity() result
 * @param backlog  engine issues of the unplanned backlog (toIssues), may be []
 * @param scores   Map(issue id → scoreIssue result incl. frs[{id, priority, dealId, title, url}])
 * @param taskRows Lightdash rows carrying customer_tasks (default + extra)
 * @param featureRows Lightdash rows carrying features (default + extra), for FR → issue links
 */
export function prepQueues({ run, backlog = [], scores, taskRows = [], featureRows = [], team = 'all', signed = null, featureFrs = null }) {
  const isSigned = (dealId) => !signed || (!!dealId && signed.has(nid(dealId)));
  const isFeature = (id, type) => type === FR_TYPE && (!featureFrs || featureFrs.has(nid(id)));
  const out = Object.fromEntries(GROUPS.map((g) => [g.key, { noIssue: [], noEstimate: [], notPlanned: [] }]));
  // FR ids linked to any feature, from both sides.
  const linked = new Set();
  for (const f of featureRows.flatMap((r) => blob(r, 'features'))) {
    const v = f[12]; const ids = !v ? [] : String(v).trim().startsWith('[') ? JSON.parse(v) : String(v).split(',');
    ids.forEach((x) => linked.add(nid(x)));
  }
  const seenTask = new Set();
  for (const t of taskRows.flatMap((r) => blob(r, 'customer_tasks'))) {
    const id = nid(t[0]);
    if (seenTask.has(id)) continue;
    seenTask.add(id);
    const g = groupOf(t[4]);
    if (!g || CLOSED.has(t[5]) || !isSigned(t[6]) || !isFeature(id, t[3])) continue;
    const hasFeature = t[7] && String(t[7]).replace(/[[\]"\s]/g, '').length;
    if (!hasFeature && !linked.has(id)) out[g].noIssue.push({ fr: { id, title: t[2], url: t[1], priority: t[4], status: t[5], dealId: t[6], committed: t[8], assignedTeam: t[9] || null } });
  }
  const seen = new Set();
  for (const i of [...run.issues, ...backlog]) {
    if (!i.id || seen.has(i.id) || CLOSED.has(i.status) || i.isParent) continue;
    seen.add(i.id);
    const frs = (scores?.get(i.id)?.frs || []).filter((f) => isSigned(f.dealId) && isFeature(f.id, f.type));
    const groups = frs.map((f) => groupOf(f.priority)).filter(Boolean);
    if (!groups.length) continue;
    const g = GROUPS.find((x) => groups.includes(x.key)).key;
    const teams = issueTeams(run, i);
    const ours = [...teams].some((x) => TEAMS.includes(x));
    // Truly unrouted: no Team property and no assignee. Other teams' issues are out of scope.
    const noTeam = !i.team && !(i.assignedTo || []).length;
    const picked = pickedTeams(team);
    if (picked ? !picked.some((x) => teams.has(x)) : !(ours || noTeam)) continue;
    const entry = { issue: i, frs: frs.filter((f) => groupOf(f.priority)), noTeam };
    if (effortOf(i) === 0) out[g].noEstimate.push(entry);
    else if (!(i.start || i.end)) out[g].notPlanned.push(entry);
  }
  const byCommit = (a, b) => String((a.issue || a.fr).committed || '9').localeCompare(String((b.issue || b.fr).committed || '9'));
  for (const g of Object.values(out)) for (const k of Object.keys(g)) g[k].sort(byCommit);
  return out;
}
