import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataQuality } from '../src/quality.js';

const id = (n) => String(n).padStart(32, '0');
const task = (n, { priority = 'High', status = 'In progress', deal = 'd1', issues = [], committed = null } = {}) =>
  [id(n), `https://notion.so/${n}`, `FR ${n}`, 'Feature request', priority, status, deal, JSON.stringify(issues.map(id)), committed, 'Engineering'];
const issue = (n, o = {}) => ({ id: id(n), name: `Issue ${n}`, status: 'Backlog', team: 'Transport Planning', skillEfforts: { backend: 2 }, blocks: [], ...o });
const run = (issues) => ({ issues, teamsByEmail: {} });
const rows = (tasks, deals = []) => [{ serve_engineering_capacity_customer_tasks: JSON.stringify(tasks), serve_engineering_capacity_deals: JSON.stringify(deals) }];

test('data quality: FR checks', () => {
  const deals = [['d1', null, null, 'Live', null, '2026-09-01'], ['d2', null, null, 'Onboarding', null, null], ['d3', null, null, 'Onboarding', null, '2027-02-01']];
  const tasks = [
    task(1, { committed: '2027-01-01' }), // no issue
    task(2, { issues: [10] }), // issue Done, FR open
    task(3, { priority: 'Needed for go-live', issues: [11] }), // go-live passed + customer Live
    task(4, { committed: '2026-10-01', issues: [11] }), // commit past, issue open
    task(5, { priority: 'Needed for go-live', deal: 'd2', issues: [11] }), // no go-live
    task(6, { priority: 'Needed for go-live', deal: 'd3', issues: [11], committed: '2027-01-25' }), // fine
    task(7, { committed: '2027-01-01', status: 'Done' }), // closed: ignored
    task(8, { committed: '2027-01-01', deal: 'unsigned' }), // unsigned: ignored
  ];
  const q = dataQuality({ run: run([issue(10, { status: 'Done' }), issue(11)]), taskRows: rows(tasks, deals), dealRows: rows([], deals), signed: new Set(['d1', 'd2', 'd3']), today: '2026-10-28' });
  const ids = (k) => q[k].map((e) => e.fr.id.slice(-1));
  assert.deepEqual(ids('frNoIssue'), ['1']);
  assert.deepEqual(ids('issueDoneFrOpen'), ['2']);
  assert.deepEqual(ids('goLivePassed'), ['3']);
  assert.deepEqual(ids('goLiveCustomerLive'), ['3']);
  assert.deepEqual(ids('frCommitPast'), ['4']);
  assert.deepEqual(ids('goLiveNoDate'), ['5']);
  // Team filter: only FRs whose issue is in the picked teams.
  const t = dataQuality({ run: run([issue(10, { status: 'Done' }), issue(11)]), taskRows: rows(tasks, deals), dealRows: rows([], deals), signed: new Set(['d1', 'd2', 'd3']), team: ['Order + Invoice'], today: '2026-10-28' });
  assert.equal(t.frNoIssue.length + t.goLivePassed.length, 0);
});

test('data quality: issue checks', () => {
  const issues = [
    issue(1, { status: 'Blocked/on hold' }), // no blocker
    issue(2, { status: 'Blocked/on hold' }), // blocked by 3 (open): fine
    issue(3, { blocks: [id(2)] }),
    issue(4, { status: 'Done', blocks: [id(5)] }),
    issue(5, { start: '2027-01-29', end: '2027-01-29', status: 'Product scoping TODO' }), // scoping + stale blocker
    issue(6, { start: '2027-01-29', end: '2027-01-29', skillEfforts: {} }), // 0 effort
    issue(7, { start: '2027-01-29', end: '2027-01-29', skillEfforts: {}, team: 'SRE' }), // not ours
  ];
  const q = dataQuality({ run: run(issues), today: '2026-10-28' });
  const ids = (k) => q[k].map((e) => e.issue.id.slice(-1));
  assert.deepEqual(ids('blockedNoBlocker'), ['1']);
  assert.deepEqual(ids('plannedScoping'), ['5']);
  assert.deepEqual(ids('plannedNoEffort'), ['6']);
  assert.deepEqual(ids('staleBlocker'), ['5']);
});
