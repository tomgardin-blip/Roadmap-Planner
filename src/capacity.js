// Capacity grid: thin adapter around Sander's capacity engine (vendor/capacity-engine.js).
// The engine is used unchanged so capacity and load match the Lightdash Engineering
// Capacity Planner by construction (SPEC.md > Capacity). This module only:
//   1. feeds it the Lightdash serve_engineering_capacity rows,
//   2. supplies the glue the planner app normally provides (teams, emailToName, settings),
//   3. reshapes its weekly output into our quarter / month / pot grid.

import * as Engine from '../vendor/capacity-engine.js';

export const TEAMS = ['Transport Planning', 'Order + Invoice', 'Trip Execution', 'Application Platform'];
export const SKILLS = ['FE', 'BE', 'MOB'];
const ENGINE_SKILL = { FE: 'frontend', BE: 'backend', MOB: 'mobile' };

// SPEC.md > Capacity grid: quarter totals green within ±2 days, amber to ±5,
// red beyond. Month cells pass scale = month capacity / quarter capacity.
export function cellStatus(planned, capacity, scale = 1) {
  const diff = Math.abs(planned - capacity);
  if (diff <= 2 * scale + 1e-9) return 'ok';
  if (diff <= 5 * scale + 1e-9) return 'amber';
  return 'red';
}

/** Lightdash returns prefixed column names; the engine reads bare ones. */
export function toEngineRows(lightdashRows) {
  const col = (r, name) => r[`serve_engineering_capacity_${name}`] ?? r[name];
  return lightdashRows.map((r) => ({
    features: col(r, 'features'),
    customer_tasks: col(r, 'customer_tasks'),
    deals: col(r, 'deals'),
    engineering_team_allocations: col(r, 'engineering_team_allocations'),
  }));
}

/** Run the engine silently (it logs diagnostics). */
function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
}

/**
 * Run the engine on Lightdash rows.
 * Glue we supply (open question in SPEC.md, to confirm with Sander):
 * - config.teams: every team in the allocation plan, so assignee routing matches the planner.
 * - config.emailToName: allocation email → allocation title. Without it, planned holidays never count.
 * - settings: {} so the engine's defaults apply (ramp start month 2026-07).
 */
export function runCapacity(lightdashRows, { now = new Date() } = {}) {
  return quiet(() => {
    const rows = toEngineRows(lightdashRows);
    const { issues, customerTasks } = Engine.transformRows(rows);
    const alloc = Engine.buildAllocation(rows, {});
    const teams = Engine.buildTeams(alloc, alloc.teams.map((t) => t.name));
    const emailToName = {};
    alloc.people.forEach((p) => { if (p.email) emailToName[p.email] = p.name; });
    const { computed } = Engine.compute({ issues, config: { teams, emailToName } }, alloc, { now });
    const teamIdByLabel = Object.fromEntries(teams.map((t) => [t.label, t.id]));
    return { issues, customerTasks, computed, teamIdByLabel };
  });
}

const quarterIdx = (year, q) => year * 4 + (q - 1);
const sumMonth = (byWeek, monthKey) => Object.entries(byWeek || {})
  .reduce((s, [wk, v]) => s + (Engine.weekYm(wk) === monthKey ? v : 0), 0);

/**
 * Grid model: one row per team × skill; per quarter its 3 months, the pot and the total.
 * - Months: dated work (Start ≠ End) spread over working days; a week counts in the month of its Friday.
 * - Pot: issues with Start = End, at quarter level only (no month), exactly like the planner.
 * - Total: months + pot against the quarter's capacity.
 */
export function buildGrid(run, horizon) {
  const { computed: c, teamIdByLabel } = run;
  const rows = [];
  for (const team of TEAMS) {
    const tid = teamIdByLabel[team];
    for (const skill of SKILLS) {
      const sk = ENGINE_SKILL[skill];
      const quarters = horizon.map((q) => {
        const raw = q.months.map((m) => ({
          key: m.key,
          planned: sumMonth(c.newTeamSkillWeek?.[tid]?.[sk], m.key),
          capacity: sumMonth(c.capWeekTeamSkill?.[tid]?.[sk], m.key),
        }));
        const cap = raw.reduce((s, m) => s + m.capacity, 0);
        const months = raw.map((m) => ({ ...m, status: cellStatus(m.planned, m.capacity, cap ? m.capacity / cap : 1 / 3) }));
        const pot = c.newTeamSkillPotQ?.[tid]?.[sk]?.[quarterIdx(q.year, q.q)] || 0;
        const planned = months.reduce((s, m) => s + m.planned, 0) + pot;
        return { key: q.key, months, pot, planned, capacity: cap, status: cellStatus(planned, cap) };
      });
      rows.push({ team, skill, quarters });
    }
  }
  return { rows };
}

/**
 * Issues behind one cell with the days they put there, committed date first, then most days.
 * period = 'YYYY-MM' (month), 'YYYY-Qn' (quarter total) or 'YYYY-Qn-pot'.
 */
export function cellIssues(run, team, skill, period) {
  const { computed: c, issues, teamIdByLabel } = run;
  const tid = teamIdByLabel[team];
  const sk = ENGINE_SKILL[skill];
  const days = {};
  const add = (map) => Object.entries(map || {}).forEach(([idx, v]) => { days[idx] = (days[idx] || 0) + v; });
  const qm = /^(\d{4})-Q(\d)(-pot)?$/.exec(period);
  if (qm) {
    const [year, q, potOnly] = [Number(qm[1]), Number(qm[2]), !!qm[3]];
    add(c.newTeamSkillPotEntries?.[tid]?.[sk]?.[quarterIdx(year, q)]);
    if (!potOnly) {
      for (let i = 0; i < 3; i++) add(c.newTeamSkillMonthEntries?.[tid]?.[sk]?.[`${year}-${String((q - 1) * 3 + i + 1).padStart(2, '0')}`]);
    }
  } else {
    add(c.newTeamSkillMonthEntries?.[tid]?.[sk]?.[period]);
  }
  return Object.entries(days)
    .map(([idx, d]) => ({ issue: issues[idx], days: d }))
    .filter((x) => x.issue && x.days > 1e-9)
    .sort((a, b) => {
      const ca = a.issue.committed, cb = b.issue.committed;
      if (ca && cb && ca !== cb) return ca.localeCompare(cb);
      if (ca && !cb) return -1;
      if (!ca && cb) return 1;
      return b.days - a.days;
    });
}

/** Open issues with effort and a date but no team and no assignee: they count in no team's load (SPEC.md > Risks). */
export function issuesWithoutTeam(run) {
  return run.issues.filter((i) => !i.team && !(i.assignedTo || []).length && (i.start || i.end)
    && !['Done', "Won't do", 'Duplicate'].includes(i.status)
    && ['frontend', 'backend', 'mobile'].some((s) => (i.skillEfforts?.[s] || 0) > 0));
}
