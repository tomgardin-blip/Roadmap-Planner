// At-risk rules (SPEC "Features and screens" > 4. At risk). Pure functions over the engine issues.
// Rules that need data the planner cannot reach yet are listed in UNAVAILABLE, never guessed.

import { issueTeams, TEAMS } from './capacity.js';

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
];

// SPEC rules the planner cannot evaluate from Lightdash or Notion today.
export const UNAVAILABLE = [
  { key: 'effortGrowth', label: 'Effort grew 50% or more on a committed issue this quarter', why: 'Needs an effort baseline from the start of the quarter. The daily snapshots live in BigQuery and are not exposed in Lightdash.' },
  { key: 'lowConfidence', label: 'Claude estimate with low confidence', why: 'No confidence field exists on the issues.' },
];

/**
 * @param run      runCapacity() result (issue.committed is the effective committed date)
 * @param opts.team  'all' or one of TEAMS
 * @returns { [ruleKey]: [{ issue, detail }] }
 */
export function atRisk(run, { team = 'all' } = {}) {
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
      if (i.committed && i.end && i.end > i.committed) out.afterCommit.push({ issue: i, detail: `Ends ${i.end}, committed ${i.committed}` });
      if (i.committed && !planned && effortOf(i) > 0) out.committedUnplanned.push({ issue: i, detail: `Committed ${i.committed}, no dates` });
      if (i.committed && i.status === 'Blocked/on hold') out.committedBlocked.push({ issue: i, detail: `Committed ${i.committed}` });
      // A blocker that ends after this issue starts (pot issues: Start = End).
      const start = i.start || i.end;
      for (const b of blockedBy.get(i.id) || []) {
        if (start && b.end && b.end > start) out.dependency.push({ issue: i, detail: `Starts ${start}, blocked by "${b.name}" ending ${b.end}`, blocker: b });
        else if (start && !b.end) out.dependency.push({ issue: i, detail: `Starts ${start}, blocked by "${b.name}" which has no dates`, blocker: b });
      }
      if (i.status === 'Claude - to review' && effortOf(i) > 0) out.claudeReview.push({ issue: i, detail: `${effortOf(i)} d estimated by Claude, not reviewed` });
    }
    if (team === 'all' && !i.team && !(i.assignedTo || []).length && planned && effortOf(i) > 0) {
      out.noTeam.push({ issue: i, detail: `${effortOf(i)} d with dates, counted in no team` });
    }
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => String(a.issue.committed || '9').localeCompare(String(b.issue.committed || '9')) || effortOf(b.issue) - effortOf(a.issue));
  return out;
}
