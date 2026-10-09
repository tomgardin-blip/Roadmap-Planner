import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellStatus, buildGrid, issuesInCell, cellId, isQuarterLevel, placement } from '../src/capacity.js';
import { horizon } from '../src/periods.js';

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);

test('quarter thresholds: ±2 green, ±5 amber, beyond red', () => {
  assert.equal(cellStatus(42, 40), 'ok');
  assert.equal(cellStatus(38, 40), 'ok');
  assert.equal(cellStatus(42.5, 40), 'amber');
  assert.equal(cellStatus(35, 40), 'amber');
  assert.equal(cellStatus(45.5, 40), 'red');
  assert.equal(cellStatus(30, 40), 'red');
});

test('month thresholds scale with the month share of quarter capacity', () => {
  // Even quarter: scale 1/3 -> ±0.67 green, ±1.67 amber.
  assert.equal(cellStatus(30.6, 30, 1 / 3), 'ok');
  assert.equal(cellStatus(31, 30, 1 / 3), 'amber');
  assert.equal(cellStatus(31.7, 30, 1 / 3), 'red');
  // Exact boundaries are inclusive.
  assert.equal(cellStatus(32, 30, 1), 'ok');
  assert.equal(cellStatus(35, 30, 1), 'amber');
});

const h = horizon('2026-10-09');
const mk = (id, team, end, effort, extra = {}) => ({ id, title: id, team, end, start: end, effort: { FE: 0, BE: 0, MOB: 0, ...effort }, score: 0, committed: null, ...extra });

test('quarter-level = last Friday of quarter AND no committed date', () => {
  assert.equal(isQuarterLevel(mk('a', 'Trip Execution', '2026-12-25', {})), true);
  assert.equal(isQuarterLevel(mk('b', 'Trip Execution', '2026-12-25', {}, { committed: '2027-02-01' })), false);
  assert.equal(isQuarterLevel(mk('c', 'Trip Execution', '2026-11-27', {})), false);
  assert.deepEqual(placement(mk('a', 'X', '2027-03-26', {})).map((p) => p.month), ['2027-01', '2027-02', '2027-03']);
});

test('quarter-level effort spreads ⅓ per month; month-level counts fully in End month', () => {
  const issues = [
    mk('a', 'Trip Execution', '2026-11-27', { FE: 3, MOB: 5 }, { committed: '2027-01-15' }),
    mk('b', 'Trip Execution', '2026-12-25', { MOB: 9 }),                              // quarter-level
    mk('e', 'Trip Execution', '2026-12-25', { MOB: 2 }, { committed: '2027-02-01' }), // Dec, month-level
    mk('c', null, '2026-12-25', { BE: 50 }),
    mk('d', 'Trip Execution', '2027-09-24', { MOB: 9 }),
  ];
  const cap = { [cellId('Trip Execution', 'MOB', '2026-11')]: 10, [cellId('Trip Execution', 'MOB', '2026-12')]: 10 };
  const g = buildGrid(issues, cap, h);
  const mob = g.rows.find((r) => r.team === 'Trip Execution' && r.skill === 'MOB').quarters[0];
  const p = mob.months.map((m) => m.planned);
  close(p[0], 3); close(p[1], 8); close(p[2], 5);
  close(mob.planned, 16);
  assert.equal(mob.capacity, 20);
  assert.deepEqual(g.noTeam.map((i) => i.id), ['c']);
  assert.deepEqual(g.outside.map((i) => i.id), ['d']);
});

test('cell issues carry their share, ordered by committed date then score', () => {
  const issues = [
    mk('x', 'Order + Invoice', '2026-12-25', { BE: 2 }, { score: 9 }),               // quarter-level
    mk('y', 'Order + Invoice', '2026-11-27', { BE: 2 }, { score: 1, committed: '2027-01-10' }),
    mk('z', 'Order + Invoice', '2026-11-27', { BE: 2 }, { score: 5, committed: '2026-12-15' }),
    mk('w', 'Order + Invoice', '2026-11-27', { FE: 2 }, { score: 99, committed: '2026-12-01' }),
    mk('v', 'Order + Invoice', '2026-10-30', { BE: 2 }, { score: 50, committed: '2026-11-30' }),
  ];
  const nov = issuesInCell(issues, 'Order + Invoice', 'BE', ['2026-11']);
  assert.deepEqual(nov.map((x) => x.issue.id), ['z', 'y', 'x']);
  close(nov[2].share, 1 / 3);
  const q4 = issuesInCell(issues, 'Order + Invoice', 'BE', ['2026-10', '2026-11', '2026-12']);
  assert.deepEqual(q4.map((x) => [x.issue.id, Math.round(x.share * 3)]), [['v', 3], ['z', 3], ['y', 3], ['x', 3]]);
});
