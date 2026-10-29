// Pushback = "make the plan fit" (Tom, 2026-10-28). Tom plans every committed issue on its quarter pot,
// then needs to know what to move or push back where a team's quarter is over capacity. Per over-capacity
// team × quarter × skill: first the uncommitted work that can simply move out, then the committed issues
// ranked by how pushable their commit is, with a running total and the point where it fits. A second list
// holds the committed issues planned after their commit. Pure functions.

import { cellIssues, issueTeams, TEAMS, pickedTeams } from './capacity.js';
import { pushOut, IN_PROGRESS, CLOSED } from './suggestions.js';
import { lateVsCommit } from './periods.js';

const nid = (x) => String(x || '').replace(/-/g, '').toLowerCase();
const day = (d) => (d ? String(d).slice(0, 10) : null);

// Softest commit first: a go-live need is the hardest to push back.
export const PRIORITY_HARDNESS = { 'Needed for go-live': 3, 'Needed 1 month before': 2, 'Needed after go-live': 1 };
const hardness = (p) => PRIORITY_HARDNESS[p] ?? 0;

/**
 * The FRs that set an issue's commit and what the commit would become without them.
 * scores: signed FRs (what is shown); allScores: every linked FR (an unsigned one can still hold a date).
 */
export function commitSetters(issue, { scores, allScores, dealSize = new Map(), dismissed = new Set() }) {
  const d = day(issue.committed);
  if (!d) return null;
  const frs = (allScores?.get(issue.id)?.frs || scores?.get(issue.id)?.frs || []).filter((f) => f.committed);
  const setters = frs.filter((f) => day(f.committed) === d);
  if (!setters.length) return null; // the date comes from an issue it blocks or the issue itself
  const next = frs.filter((f) => day(f.committed) !== d).map((f) => day(f.committed)).sort()[0] || null;
  const rows = setters.map((f) => ({ ...f, deal: dealSize.get(nid(f.dealId)) || 0, dismissed: dismissed.has(nid(f.id)) }));
  return {
    setters: rows,
    next,
    hardness: Math.max(...rows.map((f) => hardness(f.priority))),
    deal: Math.max(...rows.map((f) => f.deal)),
    allDismissed: rows.every((f) => f.dismissed),
  };
}

// Easiest to push back first: softest priority, fewest customers, then the most days freed per
// conversation, then the smallest deal.
const byPushability = (a, b) => a.commit.hardness - b.commit.hardness
  || (a.customers - b.customers)
  || (b.days - a.days)
  || (a.commit.deal - b.commit.deal);

/**
 * @returns { cells: [{ team, skill, quarter, over, capacity, planned, uncommitted: { count, days },
 *            committed: [{ issue, days, customers, commit, cumulative, covers }], coverIdx, fits }],
 *           late: [{ issue, customers, commit }] }
 */
export function planFit({ run, grid, horizon, scores, allScores, dealSize, dismissed, kept = new Set(), team = 'all' }) {
  const picked = pickedTeams(team) || TEAMS;
  const ctx = { scores, allScores, dealSize, dismissed };
  const cells = [];
  for (const r of grid.rows) {
    if (!picked.includes(r.team)) continue;
    horizon.forEach((q, qi) => {
      const c = r.quarters[qi];
      const over = (c.planned || 0) - (c.capacity || 0);
      if (!(c.capacity > 0) || over <= 1e-9) return;
      const out = pushOut({ run, scores, team: r.team, skill: r.skill, quarter: q, over, kept });
      const uncommitted = { count: out.items.length, days: out.items.reduce((a, x) => a + x.days, 0) };
      const committed = [];
      for (const { issue, days } of cellIssues(run, r.team, r.skill, q.key)) {
        if (CLOSED.has(issue.status) || IN_PROGRESS.has(issue.status) || !issue.committed) continue;
        const commit = commitSetters(issue, ctx);
        if (!commit || commit.allDismissed) continue;
        committed.push({ issue, days, customers: scores?.get(issue.id)?.customers ?? commit.setters.length, commit });
      }
      committed.sort(byPushability);
      let sum = uncommitted.days;
      for (const x of committed) { sum += x.days; x.cumulative = sum; x.covers = sum >= over - 1e-9; }
      cells.push({
        team: r.team, skill: r.skill, quarter: q, over, capacity: c.capacity, planned: c.planned,
        uncommitted, committed, coverIdx: committed.findIndex((x) => x.covers), fits: uncommitted.days >= over - 1e-9,
      });
    });
  }
  cells.sort((a, b) => b.over - a.over);

  const late = [];
  const seen = new Set();
  for (const issue of run.issues) {
    if (!issue.id || seen.has(issue.id) || CLOSED.has(issue.status) || !lateVsCommit(issue)) continue;
    if (![...issueTeams(run, issue)].some((t) => picked.includes(t))) continue;
    seen.add(issue.id);
    const commit = commitSetters(issue, ctx);
    if (!commit || commit.allDismissed) continue;
    late.push({ issue, customers: scores?.get(issue.id)?.customers ?? commit.setters.length, commit, days: 0 });
  }
  late.sort((a, b) => String(a.issue.committed).localeCompare(String(b.issue.committed)) || byPushability(a, b));
  return { cells, late };
}
