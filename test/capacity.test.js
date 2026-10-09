import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cellStatus, buildGrid, issuesInCell, cellId } from '../src/capacity.js';
import { horizon } from '../src/periods.js';

test('cell status thresholds: ±2 green, ±5 amber, beyond red', () => {
  assert.equal(cellStatus(42, 40), 'ok');
  assert.equal(cellStatus(38, 40), 'ok');
  assert.equal(cellStatus(42.5, 40), 'amber');
  assert.equal(cellStatus(35, 40), 'amber');
  assert.equal(cellStatus(45.5, 40), 'red');
  assert.equal(cellStatus(30, 40), 'red');
});

const h = horizon('2026-10-09');
const mk = (id, team, end, effort, extra = {}) => ({ id, title: id, team, end, start: end, effort: { FE: 0, BE: 0, MOB: 0, ...effort }, score: 0, committed: null, ...extra });

test('effort lands in the month of End, per skill; quarter totals sum the months', () => {
  const issues = [
    mk('a', 'Trip Execution', '2026-11-27', { FE: 3, MOB: 5 }),
    mk('b', 'Trip Execution', '2026-12-25', { MOB: 4 }),
    mk('c', null, '2026-12-25', { BE: 50 }),
    mk('d', 'Trip Execution', '2027-09-24', { MOB: 9 }),
  ];
  const cap = { [cellId('Trip Execution', 'MOB', '2026-11')]: 10, [cellId('Trip Execution', 'MOB', '2026-12')]: 10 };
  const g = buildGrid(issues, cap, h);
  const mob = g.rows.find((r) => r.team === 'Trip Execution' && r.skill === 'MOB').quarters[0];
  assert.deepEqual(mob.months.map((m) => m.planned), [0, 5, 4]);
  assert.equal(mob.planned, 9);
  assert.equal(mob.capacity, 20);
  assert.equal(g.rows.find((r) => r.team === 'Trip Execution' && r.skill === 'FE').quarters[0].months[1].planned, 3);
  assert.deepEqual(g.noTeam.map((i) => i.id), ['c']);
  assert.deepEqual(g.outside.map((i) => i.id), ['d']);
});

test('cell issue order: committed date first, then score', () => {
  const issues = [
    mk('x', 'Order + Invoice', '2026-11-27', { BE: 2 }, { score: 9 }),
    mk('y', 'Order + Invoice', '2026-11-27', { BE: 2 }, { score: 1, committed: '2027-01-10' }),
    mk('z', 'Order + Invoice', '2026-11-27', { BE: 2 }, { score: 5, committed: '2026-12-15' }),
    mk('w', 'Order + Invoice', '2026-11-27', { FE: 2 }, { score: 99 }),
  ];
  assert.deepEqual(issuesInCell(issues, 'Order + Invoice', 'BE', ['2026-11']).map((i) => i.id), ['z', 'y', 'x']);
});
