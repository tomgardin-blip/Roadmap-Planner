import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCapacity, toIssues } from '../src/capacity.js';
import { atRisk } from '../src/atrisk.js';
import { prepQueues } from '../src/prep.js';
import { scoreRows } from '../src/scoring.js';
import { allocationRow as A, featureRow as F } from '../src/data/fake.js';

// Synthetic rows only.
const NOW = new Date(2026, 9, 9, 12);
const TP = 'Transport Planning';
const alloc = [A({ id: 'p1', title: 'Eng 1', email: 'e1@example.invalid', team: TP, be: 1, hol26: 0, hol27: 0 })];
const T = (id, priority, features = null) => [id, `https://example.invalid/${id}`, `FR ${id}`, 'Feature request', priority, 'Not Started', null, features, null, null];
const rowsOf = (feats, tasks = []) => [{
  serve_engineering_capacity_features: JSON.stringify(feats),
  serve_engineering_capacity_engineering_team_allocations: JSON.stringify(alloc),
  serve_engineering_capacity_customer_tasks: JSON.stringify(tasks),
}];
const ids = (xs) => xs.map((x) => (x.issue || x.fr).id).sort();

test('at risk: after commit, committed unplanned, blocked, dependency, no team, Claude review', () => {
  const feats = [
    F({ id: 'late', team: TP, be: 2, committed: '2026-11-30', start: '2026-12-25', end: '2026-12-25' }),
    F({ id: 'tbd', team: TP, be: 2, committed: '2026-12-31' }),
    F({ id: 'blk', team: TP, be: 2, committed: '2026-12-31', status: 'Blocked/on hold', start: '2026-11-27', end: '2026-11-27' }),
    F({ id: 'dep', team: TP, be: 1, start: '2026-11-27', end: '2026-11-27' }),
    F({ id: 'blocker', team: TP, be: 1, start: '2026-12-25', end: '2026-12-25' }),
    F({ id: 'orphan', be: 3, start: '2026-11-27', end: '2026-11-27' }),
    F({ id: 'claude', team: TP, be: 4, status: 'Claude - to review', start: '2027-01-29', end: '2027-01-29' }),
    F({ id: 'fine', team: TP, be: 1, committed: '2027-03-31', start: '2027-01-29', end: '2027-01-29' }),
  ];
  feats[4][10] = 'dep'; // blocker blocks dep
  const r = atRisk(runCapacity(rowsOf(feats), { now: NOW }));
  assert.deepEqual(ids(r.afterCommit), ['late']);
  assert.deepEqual(ids(r.committedUnplanned), ['tbd']);
  assert.deepEqual(ids(r.committedBlocked), ['blk']);
  assert.deepEqual(ids(r.dependency), ['dep']);
  assert.deepEqual(ids(r.noTeam), ['orphan']);
  assert.deepEqual(ids(r.claudeReview), ['claude']);
});

test('prep queues: no issue, no estimate, not planned; highest group wins; other priorities ignored', () => {
  const feats = [
    F({ id: 'est0', team: TP }),
    F({ id: 'unpl', team: TP, be: 3 }),
    F({ id: 'onGrid', team: TP, be: 3, start: '2026-11-27', end: '2026-11-27' }),
    F({ id: 'both', team: TP }),
    F({ id: 'otherTeam', team: 'Integration Hub' }),
    F({ id: 'orphan' }),
  ];
  const tasks = [
    T('gl1', 'Needed for go-live', 'est0'),
    T('t31', 'Top 3', 'unpl'),
    T('gl2', 'Needed 1 month before', 'onGrid'),
    T('t32', 'Top 3', 'both'), T('gl3', 'Needed for go-live', 'both'),
    T('lonely', 'Top 3'),
    T('gl4', 'Needed for go-live', 'otherTeam'), T('gl5', 'Needed for go-live', 'orphan'),
    T('hi', 'High'),
  ];
  const rows = rowsOf(feats, tasks);
  const run = runCapacity(rows, { now: NOW });
  const q = prepQueues({ run, scores: scoreRows(rows), taskRows: rows, featureRows: rows });
  assert.deepEqual(ids(q.goLive.noEstimate), ['both', 'est0', 'orphan']);
  assert.equal(q.goLive.noEstimate.find((e) => e.issue.id === 'orphan').noTeam, true);
  assert.deepEqual(ids(q.top3.notPlanned), ['unpl']);
  assert.deepEqual(ids(q.top3.noIssue), ['lonely']);
  assert.deepEqual(ids(q.goLive.notPlanned), []);
  assert.deepEqual(ids(q.top3.noEstimate), []);
});

test('prep queues include the unplanned backlog', () => {
  const rows = rowsOf([], [T('gl', 'Needed for go-live', 'bk')]);
  const extra = [{ serve_engineering_capacity_features: JSON.stringify([F({ id: 'bk', team: TP, fe: 2 })]) }];
  const run = runCapacity(rows, { now: NOW });
  const q = prepQueues({ run, backlog: toIssues(extra), scores: scoreRows([...rows, ...extra]), taskRows: rows, featureRows: [...rows, ...extra] });
  assert.deepEqual(ids(q.goLive.notPlanned), ['bk']);
});
