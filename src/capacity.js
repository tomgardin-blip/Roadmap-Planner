// Capacity grid aggregation.
// CHECKPOINT 1: planned days are summed from issues and capacity comes from the
// input as-is. The real capacity formula (allocations, part-time, holidays)
// lands in checkpoint 2 and must match the Lightdash capacity planner exactly.

import { monthKey, quarterOf, lastFridayOfQuarter } from './periods.js';

export const TEAMS = ['Transport Planning', 'Order + Invoice', 'Trip Execution', 'Application Platform'];
export const SKILLS = ['FE', 'BE', 'MOB'];
export const SKILL_LABEL = { FE: 'Frontend', BE: 'Backend', MOB: 'Mobile' };

// SPEC.md > Capacity grid: quarter totals green within ±2 days, amber to ±5,
// red beyond. Month cells pass scale = month capacity / quarter capacity.
export function cellStatus(planned, capacity, scale = 1) {
  const diff = Math.abs(planned - capacity);
  if (diff <= 2 * scale + 1e-9) return 'ok';
  if (diff <= 5 * scale + 1e-9) return 'amber';
  return 'red';
}

/** Quarter-level = End on the quarter's last Friday and no committed date (SPEC.md). */
export function isQuarterLevel(issue) {
  if (!issue.end || issue.committed) return false;
  const { year, q } = quarterOf(issue.end);
  return issue.end === lastFridayOfQuarter(year, q);
}

/**
 * Where an issue's effort counts: [{ month, share }].
 * Quarter-level issues spread ⅓ over the quarter's months; others count fully in their End month.
 */
export function placement(issue) {
  if (!issue.end) return [];
  if (isQuarterLevel(issue)) {
    const { year, q } = quarterOf(issue.end);
    return [0, 1, 2].map((i) => ({ month: `${year}-${String((q - 1) * 3 + i + 1).padStart(2, '0')}`, share: 1 / 3 }));
  }
  return [{ month: monthKey(issue.end), share: 1 }];
}

export const cellId = (team, skill, period) => `${team}|${skill}|${period}`;

/**
 * Planned days per team × skill × month, keyed by cellId.
 * Effort is placed per placement(): quarter-level spread ⅓ per month, others in their End month.
 * Issues without a team or outside the horizon are returned separately.
 */
export function plannedByCell(issues, horizon) {
  const months = new Set(horizon.flatMap((q) => q.months.map((m) => m.key)));
  const cells = new Map();
  const noTeam = [];
  const outside = [];
  for (const issue of issues) {
    if (!issue.end) continue;
    const parts = placement(issue);
    if (!months.has(parts[0].month)) { outside.push(issue); continue; }
    if (!TEAMS.includes(issue.team)) { noTeam.push(issue); continue; }
    for (const skill of SKILLS) {
      const days = issue.effort[skill] || 0;
      if (!days) continue;
      for (const { month, share } of parts) {
        const id = cellId(issue.team, skill, month);
        cells.set(id, (cells.get(id) || 0) + days * share);
      }
    }
  }
  return { cells, noTeam, outside };
}

/** Build the full grid model: one row per team × skill, months plus quarter totals. */
export function buildGrid(issues, capacity, horizon) {
  const { cells, noTeam, outside } = plannedByCell(issues, horizon);
  const rows = [];
  for (const team of TEAMS) {
    for (const skill of SKILLS) {
      const quarters = horizon.map((q) => {
        const raw = q.months.map((m) => ({
          key: m.key,
          planned: cells.get(cellId(team, skill, m.key)) || 0,
          capacity: capacity[cellId(team, skill, m.key)] || 0,
        }));
        const planned = raw.reduce((s, m) => s + m.planned, 0);
        const cap = raw.reduce((s, m) => s + m.capacity, 0);
        const months = raw.map((m) => ({
          ...m, status: cellStatus(m.planned, m.capacity, cap ? m.capacity / cap : 1 / 3),
        }));
        return { key: q.key, months, planned, capacity: cap, status: cellStatus(planned, cap) };
      });
      rows.push({ team, skill, quarters });
    }
  }
  return { rows, noTeam, outside };
}

/**
 * Issues in one cell with the share of their effort counted there,
 * committed date first (earliest first, none last), then score high to low.
 */
export function issuesInCell(issues, team, skill, periodKeys) {
  const keys = new Set(periodKeys);
  return issues
    .filter((i) => i.team === team && (i.effort[skill] || 0) > 0)
    .map((i) => ({ issue: i, share: placement(i).filter((p) => keys.has(p.month)).reduce((s, p) => s + p.share, 0) }))
    .filter((x) => x.share > 0)
    .sort(({ issue: a }, { issue: b }) => {
      if (a.committed && b.committed) return a.committed.localeCompare(b.committed) || b.score - a.score;
      if (a.committed) return -1;
      if (b.committed) return 1;
      return b.score - a.score;
    });
}
