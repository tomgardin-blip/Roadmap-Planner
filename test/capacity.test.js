import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellStatus, runCapacity, buildGrid, cellIssues, issuesWithoutTeam } from '../src/capacity.js';
import { allocationRow as A, featureRow as F } from '../src/data/fake.js';
import { horizon } from '../src/periods.js';

// Synthetic rows only. Expected values are worked out by hand from the engine's rules:
// capacity = (5 days × part-time × ramp − holiday days) × 0.6 per week; a week counts in the
// month of its Friday; the window starts at the current week's Monday.
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);
const NOW = new Date(2026, 9, 9, 12); // Fri 9 Oct 2026, week of Mon 5 Oct
const H = horizon('2026-10-09');
const rows = (allocs, feats = []) => [{
  serve_engineering_capacity_features: JSON.stringify(feats),
  serve_engineering_capacity_engineering_team_allocations: JSON.stringify(allocs),
}];
const grid = (allocs, feats) => { const run = runCapacity(rows(allocs, feats), { now: NOW }); return { run, g: buildGrid(run, H) }; };
const row = (g, team, skill) => g.rows.find((r) => r.team === team && r.skill === skill);
const TP = 'Transport Planning';
const fe = (id, extra = {}) => A({ id, title: `Eng ${id}`, email: `${id}@example.invalid`, team: TP, fe: 1, hol26: 0, hol27: 0, ...extra });

test('colour: over capacity red, at or under green (Tom, 2026-10-10)', () => {
  assert.equal(cellStatus(113.1, 128.9), 'ok');
  assert.equal(cellStatus(40, 40), 'ok');
  assert.equal(cellStatus(40.1, 40), 'red');
  assert.equal(cellStatus(0, 40), 'ok');
});

test('full-time FE, no holidays: 3 days/week; Q4 from this week = 12 weeks = 36, Q1 = 13 weeks = 39', () => {
  const { g } = grid([fe('a1')]);
  const q = row(g, TP, 'FE').quarters;
  q[0].months.forEach((m) => close(m.capacity, 12));
  close(q[0].capacity, 36);
  close(q[1].capacity, 39);
  close(row(g, TP, 'BE').quarters[0].capacity, 0);
});

test('team lead carries 0 capacity', () => {
  const { g } = grid([fe('a1', { lead: true })]);
  close(row(g, TP, 'FE').quarters[0].capacity, 0);
});

test('FE 1 + MOB 1 splits 50/50', () => {
  const { g } = grid([fe('a1', { mob: 1 })]);
  close(row(g, TP, 'FE').quarters[0].capacity, 18);
  close(row(g, TP, 'MOB').quarters[0].capacity, 18);
});

test('joiner ramps 1/3 then 2/3: start 2 Nov = 4 (Nov) + 8 (Dec)', () => {
  const { g } = grid([fe('a1', { start: '2026-11-02' })]);
  const m = row(g, TP, 'FE').quarters[0].months;
  close(m[0].capacity, 0); close(m[1].capacity, 4); close(m[2].capacity, 8);
});

test('planned holiday (mapped by email) removes that week: Nov loses 3 days', () => {
  const hol = F({ id: 'h1', title: 'Holiday', type: 'Holidays 🌴', assignee: 'a1@example.invalid', start: '2026-11-09', end: '2026-11-13' });
  const { g } = grid([fe('a1')], [hol]);
  close(row(g, TP, 'FE').quarters[0].months[1].capacity, 9);
});

test('Start = End lands in the quarter pot, not a month', () => {
  const pot = F({ id: 'p1', title: 'Pot item', team: TP, start: '2026-12-25', end: '2026-12-25', fe: 6 });
  const monthPlaced = F({ id: 'p2', title: 'Committed month item', team: TP, start: '2026-11-27', end: '2026-11-27', committed: '2027-01-10', fe: 4 });
  const { run, g } = grid([fe('a1')], [pot, monthPlaced]);
  const q4 = row(g, TP, 'FE').quarters[0];
  q4.months.forEach((m) => close(m.planned, 0));
  close(q4.pot, 10);
  close(q4.planned, 10);
  assert.deepEqual(cellIssues(run, TP, 'FE', '2026-Q4-pot').map((x) => x.issue.id), ['p2', 'p1']); // committed first
});

test('dated work spreads over working days; a week counts in the month of its Friday', () => {
  const nov = F({ id: 'd1', title: 'Two weeks in Nov', team: TP, start: '2026-11-02', end: '2026-11-13', be: 10 });
  const edge = F({ id: 'd2', title: 'Week of Mon 30 Nov', team: TP, start: '2026-11-30', end: '2026-12-04', fe: 5 });
  const { run, g } = grid([fe('a1')], [nov, edge]);
  close(row(g, TP, 'BE').quarters[0].months[1].planned, 10);
  close(row(g, TP, 'FE').quarters[0].months[1].planned, 0);
  close(row(g, TP, 'FE').quarters[0].months[2].planned, 5);
  assert.deepEqual(cellIssues(run, TP, 'FE', '2026-12').map((x) => [x.issue.id, x.days]), [['d2', 5]]);
  assert.deepEqual(cellIssues(run, TP, 'BE', '2026-Q4').map((x) => x.issue.id), ['d1']);
});

test('issues with effort but no team or assignee are flagged', () => {
  const orphan = F({ id: 'o1', title: 'No team', start: '2026-12-25', end: '2026-12-25', be: 50 });
  const { run } = grid([fe('a1')], [orphan]);
  assert.deepEqual(issuesWithoutTeam(run).map((i) => i.id), ['o1']);
});

test('TBD: committed issues without dates count in their committed quarter (overdue → current, beyond window → dropped)', () => {
  const q1 = F({ id: 't1', title: 'Committed Feb, unplanned', team: TP, committed: '2027-02-10', fe: 7 });
  const overdue = F({ id: 't2', title: 'Committed Aug, unplanned', team: TP, committed: '2026-08-01', fe: 3 });
  const far = F({ id: 't3', title: 'Committed 2028', team: TP, committed: '2028-02-01', fe: 9 });
  const { run, g } = grid([fe('a1')], [q1, overdue, far]);
  const q = row(g, TP, 'FE').quarters;
  close(q[0].tbd, 3); close(q[0].planned, 3);
  close(q[1].tbd, 7); close(q[1].planned, 7);
  close(q[2].tbd, 0);
  assert.deepEqual(cellIssues(run, TP, 'FE', '2027-Q1-tbd').map((x) => x.issue.id), ['t1']);
  assert.deepEqual(cellIssues(run, TP, 'FE', '2026-Q4').map((x) => x.issue.id), ['t2']);
});
