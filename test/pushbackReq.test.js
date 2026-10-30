import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pushbackReqList, heldByPushback, pushbackSince, PUSHBACK_REQ } from '../src/pushbackReq.js';
import { atRisk } from '../src/atrisk.js';
import { pushbackReminder } from '../src/roadmapPost.js';

// Synthetic rows only.
const TE = 'Trip Execution';
const iss = { id: 'i1', name: 'Issue 1', url: 'https://example.invalid/i1', team: TE, start: '2027-02-01', end: '2027-02-26', committed: '2027-01-15', skillEfforts: { backend: 2 }, assignedTo: [], status: 'Backlog' };
const run = { issues: [iss], teamIdByLabel: {}, teamsByEmail: new Map(), now: new Date(2026, 9, 30) };
const task = (id, priority, committed) => [id, `https://example.invalid/${id}`, `FR ${id}`, 'Feature request', priority, 'Not Started', 'deal1', JSON.stringify(['i1']), committed, null];
const rows = [{ serve_engineering_capacity_customer_tasks: JSON.stringify([task('f1', PUSHBACK_REQ, '2027-01-15'), task('f2', 'High', null)]) }];
const audit = [
  { category: 'FR priority changed', frId: 'f1', after: PUSHBACK_REQ, at: '2026-10-20T09:00:00Z' },
  { category: 'COM/AM asked', frId: 'f1', after: 'https://slack.example.invalid/x', at: '2026-10-27T09:00:00Z' },
];

test('Pushback Req GL FRs are listed with days waiting and the last reminder', () => {
  const l = pushbackReqList({ run, taskRows: rows, audit, today: '2026-10-30' });
  assert.deepEqual(l.map((e) => e.fr.id), ['f1']);
  assert.equal(l[0].days, 10);
  assert.equal(l[0].reminded.link, 'https://slack.example.invalid/x');
  assert.equal(pushbackSince([], 'f1'), null);
});

test('an issue whose commit a Pushback Req GL FR sets leaves "Planned after the committed date"', () => {
  const l = pushbackReqList({ run, taskRows: rows, audit, today: '2026-10-30' });
  assert.deepEqual([...heldByPushback(l)], ['i1']);
  assert.equal(atRisk(run, { held: heldByPushback(l) }).afterCommit.length, 0);
  assert.equal(atRisk(run).afterCommit.length, 1);
});

test('reminder DM names the FR, the customer and the next step', () => {
  const m = pushbackReminder({ fr: { name: 'FR f1', url: 'https://example.invalid/f1' }, customer: 'Acme', since: '2026-10-20T09:00:00Z' });
  assert.match(m, /^Hi @Owner, reminder: we set \[FR f1\]\(https:\/\/example.invalid\/f1\) for Acme to "Pushback Req GL" on 20\/10\/2026/);
  assert.match(m, /Needed after go-live/);
});
