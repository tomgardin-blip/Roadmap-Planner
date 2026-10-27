// At-risk rules (SPEC "Features and screens" > 4. At risk). Pure functions over the engine issues.
// Rules that need data the planner cannot reach yet are listed in UNAVAILABLE, never guessed.

import { formatDate, lateVsCommit } from './periods.js';
import { issueTeams, TEAMS } from './capacity.js';
import { effortGrowth } from './notion/baseline.js';

const CLOSED = new Set(['Done', "Won't do", 'Duplicate']);
const SKILLS = ['frontend', 'backend', 'mobile'];
const effortOf = (i) => SKILLS.reduce((a, s) => a + (i.skillEfforts?.[s] || 0), 0);

export const RULES = [
  { key: 'afterCommit', label: 'Planned after the committed date' },
  { key: 'committedUnplanned', label: 'Committed, not planned' },
  { key: 'committedBlocked', label: 'Committed, status Blocked/on hold' },
  { key: 'dependency', label: 'Dependency in the wrong order' },
  { key: 'noTeam', label: 'No team: invisible in capacity' },
  { key: 'claudeReview', label: 'Claude estimate not reviewed' },
  { key: 'effortGrowth', label: 'Effort grew 50% or more on a committed issue this quarter' },
];

// "Low confidence" was dropped by Tom on 2026-10-10 (no confidence field exists).

/**
 * @param run      runCapacity() result (issue.committed is the effective committed date)
 * @param opts.team  'all' or one of TEAMS
 * @param opts.baseline Map(issue id → quarter-start total effort), or null while loading
 * @returns { [ruleKey]: [{ issue, detail }] }
 */
export function atRisk(run, { team = 'all', baseline = null } = {}) {
  const open = run.issues.filter((i) => i.id && !CLOSED.has(i.status) && !(i.type || '').includes('Holiday'));
  const blockedBy = new Map();
  for (const b of open) for (const id of b.blocks || []) (blockedBy.get(id) || blockedBy.set(id, []).get(id)).push(b);
  const inScope = (i) => {
    const t = issueTeams(run, i);
    return team === 'all' ? [...t].some((x) => TEAMS.includes(x)) : t.has(team);
  };
  const out = Object.fromEntries(RULES.map((r) => [r.key, []]));
  for (const i of open) {
    const planned = i.start || i.end;
    if (inScope(i)) {
      if (lateVsCommit(i)) out.afterCommit.push({ issue: i, detail: `Ends ${formatDate(i.end)}, committed ${formatDate(i.committed)}` });
      if (i.committed && !planned && effortOf(i) > 0) out.committedUnplanned.push({ issue: i, detail: `Committed ${formatDate(i.committed)}, no dates` });
      if (i.committed && i.status === 'Blocked/on hold') out.committedBlocked.push({ issue: i, detail: `Committed ${formatDate(i.committed)}` });
      // A blocker that ends after this issue starts (pot issues: Start = End).
      const start = i.start || i.end;
      for (const b of blockedBy.get(i.id) || []) {
        if (start && b.end && b.end > start) out.dependency.push({ issue: i, detail: `Starts ${formatDate(start)}, blocked by "${b.name}" ending ${formatDate(b.end)}`, blocker: b });
        else if (start && !b.end) out.dependency.push({ issue: i, detail: `Starts ${formatDate(start)}, blocked by "${b.name}" which has no dates`, blocker: b });
      }
      if (i.status === 'Claude - to review' && effortOf(i) > 0) out.claudeReview.push({ issue: i, detail: `${effortOf(i)} d estimated by Claude, not reviewed` });
    }
    if (team === 'all' && !i.team && !(i.assignedTo || []).length && planned && effortOf(i) > 0) {
      out.noTeam.push({ issue: i, detail: `${effortOf(i)} d with dates, counted in no team` });
    }
  }
  out.effortGrowth = baseline ? effortGrowth(open.filter(inScope), baseline) : null;
  for (const k of Object.keys(out)) if (out[k]) out[k].sort((a, b) => String(a.issue.committed || '9').localeCompare(String(b.issue.committed || '9')) || effortOf(b.issue) - effortOf(a.issue));
  return out;
}
