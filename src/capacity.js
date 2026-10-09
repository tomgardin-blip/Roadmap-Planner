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

// Glue copied from the planner app (src/config.js, App.jsx in Sander's export of 9 Oct 2026).
// Keep in sync when Sander changes them.
export const TEAM_DISPLAY_ORDER = [
  'Order + Invoice', 'Transport Planning', 'Trip Execution', 'Application Platform',
  'SRE', 'AI', 'BI', 'Security', 'Integration Hub',
  'Connector: Order + Fleet', 'Connector: Bookings', 'Connector: Financials',
];
export const ALLOCATION_SETTINGS = { daysPerMonth: 10.2, horizon: 12, startMonth: '2026-07' };

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
 * Glue identical to the planner app (App.jsx): settings = ALLOCATION_SETTINGS,
 * emailToName = allocation email → allocation title, teams = buildTeams(allocation, TEAM_DISPLAY_ORDER).
 */
export function runCapacity(lightdashRows, { now = new Date() } = {}) {
  return quiet(() => {
    const rows = toEngineRows(lightdashRows);
    const { issues, customerTasks } = Engine.transformRows(rows);
    const alloc = Engine.buildAllocation(rows, ALLOCATION_SETTINGS);
    const teams = Engine.buildTeams(alloc, TEAM_DISPLAY_ORDER);
    const emailToName = {};
    alloc.people.forEach((p) => { if (p.email) emailToName[p.email] = p.name; });
    const { computed } = Engine.compute({ issues, config: { teams, emailToName } }, alloc, { now });
    const teamIdByLabel = Object.fromEntries(teams.map((t) => [t.label, t.id]));
    return { issues, customerTasks, computed, teamIdByLabel, now };
  });
}

const quarterIdx = (year, q) => year * 4 + (q - 1);
const sumMonth = (byWeek, monthKey) => Object.entries(byWeek || {})
  .reduce((s, [wk, v]) => s + (Engine.weekYm(wk) === monthKey ? v : 0), 0);

const currentQuarterIdx = (now) => now.getFullYear() * 4 + Math.floor(now.getMonth() / 3);

/**
 * "TBD" exactly like the planner's committedTbdMap (template-script.js): committed issues with
 * no Start and no End, counted in the quarter of their (effective) committed date; overdue
 * commitments fold into the current quarter; beyond the 3 visible quarters they are dropped.
 * Returns skill → quarterIdx → days, plus the issue indices per skill/quarter for the drawer.
 */
function tbdFor(run, tid) {
  const { computed: c, issues, now } = run;
  const base = currentQuarterIdx(now);
  const days = {};
  const entries = {};
  for (const idx of c.committedUnplanned?.[tid] || []) {
    const iss = issues[idx];
    if (!iss?.committed) continue;
    const [cy, cm] = String(iss.committed).split('-').map(Number);
    let qi = cy * 4 + Math.floor((cm - 1) / 3);
    if (qi < base) qi = base;
    if (qi > base + 2) continue;
    for (const [sk, v] of Object.entries(iss.skillEfforts || {})) {
      if (!(v > 0)) continue;
      ((days[sk] ||= {})[qi] = (days[sk][qi] || 0) + v);
      (((entries[sk] ||= {})[qi] ||= {})[idx] = v);
    }
  }
  return { days, entries };
}

/**
 * Grid model: one row per team × skill; per quarter its 3 months, the pot, the TBD and the total.
 * - Months: dated work (Start ≠ End) spread over working days; a week counts in the month of its Friday.
 * - Pot: issues with Start = End, at quarter level only (no month), exactly like the planner.
 * - TBD: committed issues with no dates, in the quarter of their committed date (see tbdFor).
 * - Total: months + pot + TBD against the quarter's capacity, as the planner's quarter cards.
 */
export function buildGrid(run, horizon) {
  const { computed: c, teamIdByLabel } = run;
  const rows = [];
  for (const team of TEAMS) {
    const tid = teamIdByLabel[team];
    const tbd = tbdFor(run, tid);
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
        const qi = quarterIdx(q.year, q.q);
        const pot = c.newTeamSkillPotQ?.[tid]?.[sk]?.[qi] || 0;
        const tbdDays = tbd.days[sk]?.[qi] || 0;
        const planned = months.reduce((s, m) => s + m.planned, 0) + pot + tbdDays;
        return { key: q.key, months, pot, tbd: tbdDays, planned, capacity: cap, status: cellStatus(planned, cap) };
      });
      rows.push({ team, skill, quarters });
    }
  }
  return { rows };
}

/**
 * Issues behind one cell with the days they put there, committed date first, then most days.
 * period = 'YYYY-MM' (month), 'YYYY-Qn' (quarter total), 'YYYY-Qn-pot' or 'YYYY-Qn-tbd'.
 */
export function cellIssues(run, team, skill, period) {
  const { computed: c, issues, teamIdByLabel } = run;
  const tid = teamIdByLabel[team];
  const sk = ENGINE_SKILL[skill];
  const days = {};
  const add = (map) => Object.entries(map || {}).forEach(([idx, v]) => { days[idx] = (days[idx] || 0) + v; });
  const qm = /^(\d{4})-Q(\d)(?:-(pot|tbd))?$/.exec(period);
  if (qm) {
    const [year, q, part] = [Number(qm[1]), Number(qm[2]), qm[3]];
    const qi = quarterIdx(year, q);
    if (part !== 'tbd') add(c.newTeamSkillPotEntries?.[tid]?.[sk]?.[qi]);
    if (part !== 'pot') add(tbdFor(run, tid).entries[sk]?.[qi]);
    if (!part) {
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
