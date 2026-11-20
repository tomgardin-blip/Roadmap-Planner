import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCapacity } from '../src/capacity.js';
import { atRisk } from '../src/atrisk.js';
import * as B from '../src/notion/baseline.js';
import { allocationRow as A, featureRow as F } from '../src/data/fake.js';

// Synthetic rows only; ids are 32-hex so they pass the page-id check.
const NOW = new Date(2026, 9, 9, 12);
const TP = 'Transport Planning';
const id = (n) => String(n).padStart(32, 'a');
const run = (feats) => runCapacity([{
  serve_engineering_capacity_features: JSON.stringify(feats),
  serve_engineering_capacity_engineering_team_allocations: JSON.stringify([A({ id: 'p1', title: 'E', email: 'e@example.invalid', team: TP, be: 1, hol26: 0, hol27: 0 })]),
}], { now: NOW });

test('quarter key', () => {
  assert.equal(B.quarterKeyOf(new Date(2026, 9, 10)), '2026-Q4');
  assert.equal(B.quarterKeyOf(new Date(2027, 0, 2)), '2027-Q1');
});

test('missing baselines: committed, open, our teams, with effort, not yet captured', () => {
  const r = run([
    F({ id: id(1), team: TP, be: 4, committed: '2026-12-31' }),
    F({ id: id(2), team: TP, be: 4 }),                                   // not committed
    F({ id: id(3), team: 'SRE', be: 4, committed: '2026-12-31' }),       // other team
    F({ id: id(4), team: TP, committed: '2026-12-31' }),                 // no effort
    F({ id: id(5), team: TP, fe: 2, committed: '2026-12-31' }),          // already captured
  ]);
  const miss = B.missingBaselines(r, new Map([[id(5), 2]]));
  assert.deepEqual(miss.map((i) => i.id), [id(1)]);
  const [input] = B.baselineRowsInputs(miss, '2026-Q4');
  assert.equal(input.parent.data_source_id, B.BASELINE_DS);
  assert.deepEqual(input.pages[0].properties, {
    Name: `2026-Q4 — ${id(1)}`, 'Issue ID': id(1), Issue: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1'], Quarter: '2026-Q4', FE: 0, BE: 4, MOB: 0, Total: 4,
  });
});

test('rows are chunked by 100', () => {
  const issues = Array.from({ length: 230 }, (_, k) => ({ id: id(k + 1), name: 'x', skillEfforts: { backend: 1 } }));
  assert.deepEqual(B.baselineRowsInputs(issues, 'Q').map((x) => x.pages.length), [100, 100, 30]);
});

test('parse baseline: earliest row per issue wins', () => {
  const m = B.parseBaseline([{ 'Issue ID': id(1), Total: 4 }, { 'Issue ID': id(1), Total: 9 }, { 'Issue ID': id(2), Total: '' }]);
  assert.deepEqual([...m], [[id(1), 4]]);
});

test('effort growth at risk: ≥ 50% over baseline, committed only; null baseline = not loaded', () => {
  const r = run([
    F({ id: id(1), team: TP, be: 6, committed: '2026-12-31', start: '2026-11-27', end: '2026-11-27' }),
    F({ id: id(2), team: TP, be: 5, committed: '2026-12-31', start: '2026-11-27', end: '2026-11-27' }),
  ]);
  const flagged = atRisk(r, { baseline: new Map([[id(1), 4], [id(2), 4]]) }).effortGrowth;
  assert.deepEqual(flagged.map((e) => e.issue.id), [id(1)]);
  assert.match(flagged[0].detail, /4 → 6 d \(\+50%\)/);
  assert.equal(atRisk(r).effortGrowth, null);
});
