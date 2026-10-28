import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitSetters, PRIORITY_HARDNESS } from '../src/fit.js';

test('fit: the FRs that set the commit, what it becomes without them, and how hard the commit is', () => {
  const issue = { id: 'i', committed: '2027-01-15' };
  const frs = [
    { id: 'a', committed: '2027-01-15', priority: 'Needed for go-live', dealId: 'd1' },
    { id: 'b', committed: '2027-01-15', priority: 'High', dealId: 'd2' },
    { id: 'c', committed: '2027-03-01', priority: 'Top 3', dealId: 'd3' },
    { id: 'd', committed: null, priority: 'Low', dealId: 'd4' },
  ];
  const r = commitSetters(issue, { allScores: new Map([['i', { frs }]]), dealSize: new Map([['d1', 50000], ['d2', 90000]]), dismissed: new Set(['b']) });
  assert.deepEqual(r.setters.map((f) => f.id), ['a', 'b']);
  assert.equal(r.next, '2027-03-01');
  assert.equal(r.hardness, PRIORITY_HARDNESS['Needed for go-live']);
  assert.equal(r.deal, 90000);
  assert.equal(r.allDismissed, false);
  assert.equal(commitSetters({ id: 'i', committed: '2027-05-05' }, { allScores: new Map([['i', { frs }]]) }), null); // set by something else
  assert.equal(commitSetters({ id: 'i' }, { allScores: new Map() }), null);
});
