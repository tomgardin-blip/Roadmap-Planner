import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lastFridayOfMonth, lastFridayOfQuarter, horizon } from '../src/periods.js';

test('last Friday of month', () => {
  assert.equal(lastFridayOfMonth(2026, 9), '2026-10-30');
  assert.equal(lastFridayOfMonth(2026, 10), '2026-11-27');
  assert.equal(lastFridayOfMonth(2026, 11), '2026-12-25'); // Christmas: SPEC says bank holidays don't matter
  assert.equal(lastFridayOfMonth(2027, 1), '2027-02-26');
  assert.equal(lastFridayOfMonth(2027, 3), '2027-04-30'); // month ending on a Friday
});

test('last Friday of quarter', () => {
  assert.equal(lastFridayOfQuarter(2026, 4), '2026-12-25');
  assert.equal(lastFridayOfQuarter(2027, 1), '2027-03-26');
  assert.equal(lastFridayOfQuarter(2027, 2), '2027-06-25');
});

test('horizon on 2026-10-09 = Q4 2026 current, Q1 2027 next, Q2 2027 pot', () => {
  const h = horizon('2026-10-09');
  assert.deepEqual(h.map((q) => [q.key, q.role]), [['2026-Q4', 'current'], ['2027-Q1', 'next'], ['2027-Q2', 'pot']]);
  assert.deepEqual(h[1].months.map((m) => m.key), ['2027-01', '2027-02', '2027-03']);
});

test('horizon rolls over on the first day of a quarter', () => {
  assert.equal(horizon('2026-12-31')[0].key, '2026-Q4');
  assert.equal(horizon('2027-01-01')[0].key, '2027-Q1');
});
