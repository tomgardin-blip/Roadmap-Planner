// Drawer suggestions for one quarter total (SPEC "Capacity grid", decided 2026-10-10).
// - Push out (over capacity): the quarter's issues with no commit and not in progress,
//   lowest score first, then most days, quick wins last. Full list; the point where the overbooking is
//   covered is marked.
// - Pull forward (under capacity): issues planned later or not planned, same team and skill,
//   whose effort in that skill fits the free days, not blocked. Committed first (pulling them
//   forward buys margin): planned after their commit, then by committed date; then the rest
//   by highest score. Uncommitted quick wins go to their own list.
// - Quick wins: uncommitted quick wins that fit, highest score first.
// Pure functions; scores = Map(issue id → scoreIssue result) or null while loading.

import { lateVsCommit } from './periods.js';
import { cellIssues, issueTeams } from './capacity.js';
import { SCORING_DEFAULTS } from './scoring.js';

export const CLOSED = new Set(['Done', "Won't do", 'Duplicate']);
// Work already started: never suggested to push out.
export const IN_PROGRESS = new Set(['Implementing', 'To implement this week', 'To test', 'Production Ready']);
export const BLOCKED = new Set(['Blocked/on hold']);
const SK = { FE: 'frontend', BE: 'backend', MOB: 'mobile' };

const isQuickWin = (s, max) => !!s && s.score > 0 && s.effort <= max;

/** Ids of issues with an open "Blocked by": some open issue lists them in its `blocks`. */
export function blockedIds(issues) {
  const out = new Set();
  for (const i of issues) if (!CLOSED.has(i.status)) for (const b of i.blocks || []) out.add(b);
  return out;
}

/** Last calendar day of a horizon quarter. */
const quarterEnd = (q) => `${q.year}-${String(q.q * 3).padStart(2, '0')}-${q.q === 1 || q.q === 4 ? 31 : 30}`;

export function pushOut({ run, scores, team, skill, quarter, over, quickWinMaxEffort = SCORING_DEFAULTS.quickWinMaxEffort }) {
  const all = cellIssues(run, team, skill, quarter.key);
  const excluded = { committed: 0, inProgress: 0 };
  const items = [];
  for (const { issue, days } of all) {
    if (CLOSED.has(issue.status)) continue;
    if (issue.committed) { excluded.committed++; continue; }
    if (IN_PROGRESS.has(issue.status)) { excluded.inProgress++; continue; }
    const s = scores?.get(issue.id) || null;
    items.push({ issue, days, score: s, quickWin: isQuickWin(s, quickWinMaxEffort) });
  }
  // Postponing (Tom, 2026-10-27): the ones to move are the big, low-value, uncommitted ones. Lowest
  // score first, then most days; quick wins last (they free little and are the work worth keeping).
  items.sort((a, b) => (a.quickWin - b.quickWin)
    || ((a.score?.score ?? Infinity) - (b.score?.score ?? Infinity))
    || b.days - a.days);
  let sum = 0;
  for (const x of items) { sum += x.days; x.cumulative = sum; x.covers = sum >= over - 1e-9; }
  const coverIdx = items.findIndex((x) => x.covers);
  return { items, excluded, coverIdx, over };
}

export function pullForward({ run, scores, team, skill, quarter, free, backlog = [], quickWinMaxEffort = SCORING_DEFAULTS.quickWinMaxEffort }) {
  const sk = SK[skill];
  const end = quarterEnd(quarter);
  const seen = new Set();
  const pool = [...run.issues, ...backlog].filter((i) => i.id && !seen.has(i.id) && seen.add(i.id));
  const blocked = blockedIds(pool);
  const main = [];
  const quickWins = [];
  for (const issue of pool) {
    const need = issue.skillEfforts?.[sk] || 0;
    if (!(need > 0) || need > free + 1e-9) continue;
    if (CLOSED.has(issue.status) || BLOCKED.has(issue.status) || blocked.has(issue.id) || issue.isParent) continue;
    const planned = issue.start || issue.end;
    const later = planned ? planned > end : !issue.committed || issue.committed > end;
    if (!later) continue;
    if (!issueTeams(run, issue).has(team)) continue;
    const s = scores?.get(issue.id) || null;
    const late = lateVsCommit(issue);
    const x = { issue, days: need, score: s, quickWin: isQuickWin(s, quickWinMaxEffort), late, tier: late ? 1 : issue.committed ? 2 : 3 };
    if (x.tier === 3 && x.quickWin) quickWins.push(x); else main.push(x);
  }
  main.sort((a, b) => a.tier - b.tier
    || (a.tier < 3 ? String(a.issue.committed).localeCompare(String(b.issue.committed)) : 0)
    || ((b.score?.score ?? -1) - (a.score?.score ?? -1))
    || a.days - b.days);
  quickWins.sort((a, b) => b.score.score - a.score.score || a.days - b.days);
  return { items: main, quickWins, free };
}
