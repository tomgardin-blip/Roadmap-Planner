import { test } from 'node:test';
import assert from 'node:assert/strict';

test('prep: effort on any skill counts as estimated (Tom, 2026-10-29: AI-only issue showed as No estimate)', async () => {
  const { prepQueues } = await import('../src/prep.js');
  const issue = { id: 'i1', status: 'Backlog', team: 'Transport Planning', start: '2026-11-02', end: '2026-11-06', skillEfforts: { frontend: 0, backend: 0, mobile: 0, ai: 2 } };
  const scores = new Map([['i1', { frs: [{ id: 'f1', priority: 'Needed for go-live', dealId: 'd1', type: 'Feature request' }] }]]);
  const q = prepQueues({ run: { issues: [issue], teamsByEmail: {} }, scores });
  assert.equal(q.goLive.noEstimate.length, 0);
  assert.equal(q.goLive.notPlanned.length, 0);
});
