// Capacity grid aggregation.
// CHECKPOINT 1: planned days are summed from issues and capacity comes from the
// input as-is. The real capacity formula (allocations, part-time, holidays)
// lands in checkpoint 2 and must match the Lightdash capacity planner exactly.

import { monthKey } from './periods.js';

export const TEAMS = ['Transport Planning', 'Order + Invoice', 'Trip Execution', 'Application Platform'];
export const SKILLS = ['FE', 'BE', 'MOB'];
export const SKILL_LABEL = { FE: 'Frontend', BE: 'Backend', MOB: 'Mobile' };

// SPEC.md > Capacity grid: green within ±2 days, amber to ±5, red beyond.
export function cellStatus(planned, capacity) {
  const diff = Math.abs(planned - capacity);
  if (diff <= 2) return 'ok';
  if (diff <= 5) return 'amber';
  return 'red';
}

export const cellId = (team, skill, period) => `${team}|${skill}|${period}`;

/**
 * Planned days per team × skill × month, keyed by cellId.
 * An issue counts in the month of its End date (placeholder Start = End).
 * Issues without a team or outside the horizon are returned separately.
 */
export function plannedByCell(issues, horizon) {
  const months = new Set(horizon.flatMap((q) => q.months.map((m) => m.key)));
  const cells = new Map();
  const noTeam = [];
  const outside = [];
  for (const issue of issues) {
    if (!issue.end) continue;
    const mk = monthKey(issue.end);
    if (!months.has(mk)) { outside.push(issue); continue; }
    if (!TEAMS.includes(issue.team)) { noTeam.push(issue); continue; }
    for (const skill of SKILLS) {
      const days = issue.effort[skill] || 0;
      if (!days) continue;
      const id = cellId(issue.team, skill, mk);
      cells.set(id, (cells.get(id) || 0) + days);
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
        const months = q.months.map((m) => {
          const planned = cells.get(cellId(team, skill, m.key)) || 0;
          const cap = capacity[cellId(team, skill, m.key)] || 0;
          return { key: m.key, planned, capacity: cap, status: cellStatus(planned, cap) };
        });
        const planned = months.reduce((s, m) => s + m.planned, 0);
        const cap = months.reduce((s, m) => s + m.capacity, 0);
        return { key: q.key, months, planned, capacity: cap, status: cellStatus(planned, cap) };
      });
      rows.push({ team, skill, quarters });
    }
  }
  return { rows, noTeam, outside };
}

/** Issues in one cell: committed date first (earliest first, none last), then score high to low. */
export function issuesInCell(issues, team, skill, periodKeys) {
  const keys = new Set(periodKeys);
  return issues
    .filter((i) => i.team === team && i.end && keys.has(monthKey(i.end)) && (i.effort[skill] || 0) > 0)
    .sort((a, b) => {
      if (a.committed && b.committed) return a.committed.localeCompare(b.committed) || b.score - a.score;
      if (a.committed) return -1;
      if (b.committed) return 1;
      return b.score - a.score;
    });
}
