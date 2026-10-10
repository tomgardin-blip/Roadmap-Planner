import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCapacity, buildGrid } from '../src/capacity.js';
import { pushbackCandidates, overbookedCells } from '../src/pushback.js';
import { horizon } from '../src/periods.js';
import { allocationRow as A, featureRow as F } from '../src/data/fake.js';

// Synthetic rows only.
const NOW = new Date(2026, 9, 9, 12);
const TP = 'Transport Planning';
const run = (feats) => runCapacity([{
  serve_engineering_capacity_features: JSON.stringify(feats),
  serve_engineering_capacity_engineering_team_allocations: JSON.stringify([A({ id: 'p1', title: 'E', email: 'e@example.invalid', team: TP, be: 1, hol26: 0, hol27: 0 })]),
}], { now: NOW });
const sc = (o) => new Map(Object.entries(o));

test('ranking: fewest customers, then highest effort, then smallest deal; committed FRs only; dismissed out', () => {
  const r = run([
    F({ id: 'a', team: TP, be: 2, start: '2026-11-27', end: '2026-11-27' }),
    F({ id: 'b', team: TP, be: 8, start: '2026-11-27', end: '2026-11-27' }),
    F({ id: 'c', team: TP, be: 8, start: '2026-11-27', end: '2026-11-27' }),
    F({ id: 'd', team: 'SRE', be: 8, start: '2026-11-27', end: '2026-11-27' }),
  ]);
  const scores = sc({
    a: { customers: 1, frs: [{ id: 'fa', dealId: 'd1' }] },
    b: { customers: 1, frs: [{ id: 'fb', dealId: 'd2' }, { id: 'fx', dealId: 'd1' }] },
    c: { customers: 3, frs: [{ id: 'fc', dealId: 'd1' }, { id: 'fz', dealId: 'd1' }] },
    d: { customers: 1, frs: [{ id: 'fd', dealId: 'd1' }] },
  });
  const taskCommitted = new Map([['fa', '2026-12-01'], ['fb', '2026-12-01'], ['fx', '2026-12-01'], ['fc', '2026-12-01'], ['fd', '2026-12-01']]);
  const list = pushbackCandidates({ run: r, scores, taskCommitted, dealSize: new Map([['d2', 80000]]), dismissed: new Set(['fx']) });
  assert.deepEqual(list.map((x) => x.fr.id), ['fb', 'fa', 'fc']);
});

test('overbooked filter keeps issues in a quarter over capacity for their team and skill', () => {
  const r = run([
    F({ id: 'big', team: TP, be: 200, start: '2026-11-27', end: '2026-11-27' }),
    F({ id: 'later', team: TP, be: 1, start: '2027-01-29', end: '2027-01-29' }),
  ]);
  const ob = overbookedCells(buildGrid(r, horizon('2026-10-09')));
  assert.ok(ob.has(`${TP}|2026-Q4|BE`));
  const scores = sc({ big: { customers: 1, frs: [{ id: 'f1' }] }, later: { customers: 1, frs: [{ id: 'f2' }] } });
  const list = pushbackCandidates({ run: r, scores, taskCommitted: new Map([['f1', '2026-12-01'], ['f2', '2027-02-01']]), overbooked: ob });
  assert.deepEqual(list.map((x) => x.fr.id), ['f1']);
});
