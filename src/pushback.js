// Pushback candidates (SPEC "Scoring and prioritisation" > Pushback, decided 2026-10-10).
// Committed FRs on open issues of our 4 teams, ranked by how easy they are to challenge:
// fewest customers on the issue, then highest effort, then smallest deal. "In previous TMS"
// and "niche wording" are not used. Pure functions.

import { issueTeams, TEAMS } from './capacity.js';

const CLOSED = new Set(['Done', "Won't do", 'Duplicate']);
const SK = { FE: 'frontend', BE: 'backend', MOB: 'mobile' };
const nid = (x) => String(x || '').replace(/-/g, '').toLowerCase();
const effortOf = (i) => Object.values(SK).reduce((a, s) => a + (i.skillEfforts?.[s] || 0), 0);
const quarterOf = (iso) => { const [y, m] = String(iso).split('-').map(Number); return `${y}-Q${Math.floor((m - 1) / 3) + 1}`; };

/** Quarter keys over capacity per team, from buildGrid(): Set of `${team}|${quarter}|${skill}`. */
export function overbookedCells(grid) {
  const s = new Set();
  for (const r of grid.rows) for (const q of r.quarters) if (q.capacity > 0 && q.planned > q.capacity + 1e-9) s.add(`${r.team}|${q.key}|${r.skill}`);
  return s;
}

/**
 * @param run, backlog  engine issues
 * @param scores        Map(issue id → { frs:[{id,title,url,priority,dealId,committed?}], customers })
 * @param taskCommitted Map(FR id → committed date) for FRs with a commit
 * @param dealSize      Map(deal id → GBP)
 * @param dismissed     Set(FR id) overridden as "Not a pushback"
 * @param overbooked    Set from overbookedCells(), or null for no filter
 */
export function pushbackCandidates({ run, backlog = [], scores, taskCommitted, dealSize = new Map(), dismissed = new Set(), overbooked = null, team = 'all' }) {
  const out = [];
  const seen = new Set();
  for (const issue of [...run.issues, ...backlog]) {
    if (!issue.id || seen.has(issue.id) || CLOSED.has(issue.status)) continue;
    seen.add(issue.id);
    const teams = [...issueTeams(run, issue)].filter((t) => TEAMS.includes(t));
    if (!teams.length || (team !== 'all' && !teams.includes(team))) continue;
    const s = scores?.get(issue.id);
    if (!s) continue;
    const when = issue.end || issue.committed;
    const q = when ? quarterOf(when) : null;
    const inOverbooked = !!q && teams.some((t) => Object.keys(SK).some((k) => (issue.skillEfforts?.[SK[k]] || 0) > 0 && overbooked?.has(`${t}|${q}|${k}`)));
    if (overbooked && !inOverbooked) continue;
    for (const fr of s.frs) {
      const committed = taskCommitted.get(nid(fr.id));
      if (!committed || dismissed.has(nid(fr.id))) continue;
      out.push({ fr: { ...fr, committed }, issue, customers: s.customers, effort: effortOf(issue), deal: dealSize.get(nid(fr.dealId)) || 0, quarter: q, inOverbooked });
    }
  }
  out.sort((a, b) => a.customers - b.customers || b.effort - a.effort || a.deal - b.deal);
  return out;
}
