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
  assert.equal(lateVsCommit({ start: '2026-10-12', end: '2026-10-30', committed: '2026-10-26' }), false); // same week (Mon 26 → Fri 30)
  assert.equal(lateVsCommit({ start: '2026-10-12', end: '2026-11-02', committed: '2026-10-30' }), true);  // next week
});

test('pot quarters: the three visible ones plus the next two, labelled with their year', async () => {
  const { horizon, potQuarters } = await import('../src/periods.js');
  const p = potQuarters(horizon('2026-10-26'));
  assert.deepEqual(p.map((x) => x.shortLabel), ["Q4 '26", 'Q1', 'Q2', 'Q3', 'Q4']);
  assert.deepEqual(p.slice(3).map((x) => x.lastFriday), ['2027-09-24', '2027-12-31']);
});

test('potMonths: month buttons up to the last pot quarter, later ones with the year (Tom, 2026-10-29)', async () => {
  const { horizon, potMonths } = await import('../src/periods.js');
  const m = potMonths(horizon('2026-10-29'));
  assert.equal(m.length, 15);
  assert.deepEqual(m.slice(9, 12).map((x) => x.label), ['Jul', 'Aug', 'Sep']);
  assert.equal(m[10].lastFriday, '2027-08-27');
  assert.equal(m[14].label, 'Dec');
  assert.equal(m[0].label, "Oct '26"); // only 2026 carries the year
  assert.equal(m[3].label, 'Jan');
});
