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

import { formatDate, formatDatesIn } from '../src/periods.js';
test('dates show as DD/MM/YYYY everywhere', () => {
  assert.equal(formatDate('2027-01-04'), '04/01/2027');
  assert.equal(formatDate('2026-12-25T00:00:00.000Z'), '25/12/2026');
  assert.equal(formatDate(null), '');
  assert.equal(formatDatesIn('2026-11-27 / 2027-01-29'), '27/11/2026 / 29/01/2027');
});

import { lateVsCommit } from '../src/periods.js';
test('after commit: month pot in the commit month is covered, a later pot or dated end is late', () => {
  const pot = (d, c) => lateVsCommit({ start: d, end: d, committed: c });
  assert.equal(pot('2027-01-29', '2027-01-15'), false); // Jan month pot, commit 15/01: covered
  assert.equal(pot('2027-03-26', '2027-01-15'), true);  // Q1 pot (last Fri of March), commit 15/01: late
  assert.equal(pot('2027-03-26', '2027-03-10'), false); // March pot = Q1 pot date, commit in March: covered
  assert.equal(pot('2027-02-26', '2027-01-30'), true);  // Feb pot, commit end of Jan: late
  assert.equal(pot('2027-01-29', '2027-02-05'), false); // before the commit
  assert.equal(lateVsCommit({ start: '2027-01-04', end: '2027-01-20', committed: '2027-01-15' }), true); // dated work ends after
  assert.equal(lateVsCommit({ start: null, end: null, committed: '2027-01-15' }), false);
});
