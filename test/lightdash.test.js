import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FEATURE_FIELDS, TASK_FIELDS, ALLOCATION_FIELDS, DEAL_FIELDS, fromPositional, parseCapacityRows,
} from '../src/data/lightdash.js';

// Synthetic rows only. No real Qargo data in tests.
const at = (fields, values) => fields.map((f) => (f in values ? values[f] : null));

test('field counts match the explore contract (35 / 13 / 18 / 7)', () => {
  assert.equal(FEATURE_FIELDS.length, 35);
  assert.equal(TASK_FIELDS.length, 13);
  assert.equal(ALLOCATION_FIELDS.length, 18);
  assert.equal(DEAL_FIELDS.length, 7);
  // Spot-check indices SPEC.md relies on.
  assert.equal(FEATURE_FIELDS[11], 'blockedByIds');
  assert.equal(FEATURE_FIELDS[14], 'effortBE');
  assert.equal(FEATURE_FIELDS[15], 'effortFE');
  assert.equal(FEATURE_FIELDS[26], 'committed');
  assert.equal(FEATURE_FIELDS[29], 'team');
  assert.equal(FEATURE_FIELDS[30], 'effortMOB');
  assert.equal(FEATURE_FIELDS[33], 'priority');
  assert.equal(TASK_FIELDS[4], 'priority');
  assert.equal(TASK_FIELDS[8], 'committed');
  assert.equal(ALLOCATION_FIELDS[9], 'capFE');
  assert.equal(ALLOCATION_FIELDS[11], 'capMOB');
});

test('a changed field order fails loudly instead of shifting values', () => {
  assert.throws(() => fromPositional([1, 2, 3], DEAL_FIELDS, 'deal'), /expected 7 elements, got 3/);
});

test('parses both explore rows into one model', () => {
  const feature = at(FEATURE_FIELDS, {
    id: 'f1', title: 'Synthetic feature', team: 'Trip Execution', effortFE: 2, effortBE: '3.5', effortMOB: null,
    start: '2026-12-25', end: '2026-12-25', committed: '2027-01-15T00:00:00', blockedByIds: ['f0'], customerTaskIds: ['t1'],
  });
  const feature2 = at(FEATURE_FIELDS, { id: 'f2', title: 'Backlog feature' });
  const task = at(TASK_FIELDS, { id: 't1', priority: 'Needed for go-live', dealId: 'd1', featureIds: ['f1'], committed: '2027-01-20' });
  const alloc = at(ALLOCATION_FIELDS, { id: 'a1', title: 'Engineer A', team: 'Trip Execution', capFE: 1, capMOB: 1, isLead: false, start: '2026-06-01' });
  const deal = at(DEAL_FIELDS, { id: 'd1', companyName: 'Synthetic Co', goLive: '2027-02-01' });
  const rows = [
    {
      serve_engineering_capacity_is_default: true,
      serve_engineering_capacity_features: JSON.stringify([feature]),
      serve_engineering_capacity_customer_tasks: JSON.stringify([task]),
      serve_engineering_capacity_engineering_team_allocations: JSON.stringify([alloc]),
      serve_engineering_capacity_deals: JSON.stringify([deal]),
    },
    {
      serve_engineering_capacity_is_default: false,
      serve_engineering_capacity_features: JSON.stringify([feature2]),
      serve_engineering_capacity_customer_tasks: '[]',
      serve_engineering_capacity_engineering_team_allocations: '[]',
      serve_engineering_capacity_deals: '[]',
    },
  ];
  const m = parseCapacityRows(rows);
  assert.deepEqual(m.features.map((f) => f.id), ['f1', 'f2']);
  assert.deepEqual(m.features[0].effort, { FE: 2, BE: 3.5, MOB: 0 });
  assert.equal(m.features[0].committed, '2027-01-15');
  assert.deepEqual(m.features[0].blockedByIds, ['f0']);
  assert.deepEqual(m.features[1].effort, { FE: 0, BE: 0, MOB: 0 });
  assert.deepEqual(m.features[1].customerTaskIds, []);
  assert.equal(m.tasks[0].priority, 'Needed for go-live');
  assert.deepEqual(m.allocations[0].skills, { FE: 1, BE: 0, MOB: 1 });
  assert.equal(m.deals[0].goLive, '2027-02-01');
});
