import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankIssues, revenueMultiplier, priorityWeight, scoreIssue, scoreFeatures, dealSizeMap, idList } from '../src/scoring.js';
import { featureRow as F } from '../src/data/fake.js';

// Synthetic data only. Expected values worked out by hand from SPEC's tables.
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≈ ${b}`);
const T = ({ id, priority = 'High', status = 'Not Started', type = 'Feature request', deal = null, features = null }) =>
  [id, `https://example.invalid/${id}`, `FR ${id}`, type, priority, status, deal, features, null, null];

test('revenue bands: <25k ×1, 25k to 75k ×1.5, 75k+ ×2, unknown ×1', () => {
  assert.equal(revenueMultiplier(24999), 1);
  assert.equal(revenueMultiplier(25000), 1.5);
  assert.equal(revenueMultiplier(74999), 1.5);
  assert.equal(revenueMultiplier(75000), 2);
  assert.equal(revenueMultiplier('656250'), 2);
  assert.equal(revenueMultiplier(null), 1);
  assert.equal(revenueMultiplier(undefined, 0.5), 0.5);
});

test('priority weights per SPEC table', () => {
  assert.equal(priorityWeight('Needed 1 month before'), 10);
  assert.equal(priorityWeight('Needed for go-live'), 10);
  assert.equal(priorityWeight('Top 3'), 5);
  assert.equal(priorityWeight('High'), 3);
  assert.equal(priorityWeight('Medium'), 2);
  assert.equal(priorityWeight('Low'), 1);
  assert.equal(priorityWeight('Needed after go-live'), 0);
  assert.equal(priorityWeight("Won't do"), 0);
  assert.equal(priorityWeight(null), 0);
});

test('score = Σ(weight × multiplier) ÷ (FE+BE+MOB)', () => {
  const sizes = new Map([['d1', 100000], ['d2', 30000]]);
  const r = scoreIssue({ fe: 2, be: 3, mob: 0 }, [
    { id: 'a', priority: 'Needed for go-live', dealId: 'd1' }, // 10 × 2 = 20
    { id: 'b', priority: 'High', dealId: 'd2' },               // 3 × 1.5 = 4.5
    { id: 'c', priority: 'Low', dealId: 'd3' },                // 1 × 1 = 1
  ], sizes);
  close(r.demand, 25.5);
  assert.equal(r.effort, 5);
  close(r.score, 5.1);
  assert.equal(r.frCount, 3);
  assert.equal(r.customers, 3);
});

test('no effort = unscored, not infinite', () => {
  const r = scoreIssue({}, [{ id: 'a', priority: 'Top 3' }]);
  assert.equal(r.score, null);
  assert.equal(r.demand, 5);
});

test('effort but no FRs = score 0', () => {
  assert.equal(scoreIssue({ be: 4 }, []).score, 0);
});

test('closed tasks and filtered types do not count', () => {
  const frs = [{ id: 'a', priority: 'High', status: 'Done' }, { id: 'b', priority: 'High', type: 'Integration request' }, { id: 'c', priority: 'High', type: 'Feature request' }];
  assert.equal(scoreIssue({ be: 1 }, frs).demand, 6);
  assert.equal(scoreIssue({ be: 1 }, frs, new Map(), { types: ['Feature request'] }).demand, 3);
});

test('perCustomerOnce keeps one FR per customer at its highest weight', () => {
  const frs = [{ id: 'a', priority: 'High', dealId: 'd1' }, { id: 'b', priority: 'Top 3', dealId: 'd1' }, { id: 'c', priority: 'Low', dealId: 'd2' }];
  assert.equal(scoreIssue({ be: 1 }, frs).demand, 9);
  assert.equal(scoreIssue({ be: 1 }, frs, new Map(), { perCustomerOnce: true }).demand, 6);
});

test('scoreFeatures joins links from both sides, once each', () => {
  const feats = [F({ id: 'f1', be: 2 }), F({ id: 'f2', fe: 1, mob: 1 })];
  feats[0][12] = JSON.stringify(['t1']);                     // feature → task
  const tasks = [
    T({ id: 't1', priority: 'Top 3', deal: 'd1', features: 'f1' }), // linked from both sides: counts once
    T({ id: 't2', priority: 'High', features: 'f1,f2' }),           // task → two features, comma string
  ];
  const s = scoreFeatures(feats, tasks, dealSizeMap([{ deals_extract_notion_page_id: 'd1', deals_extract_onboarding_deal_size_gbp: '80000' }]));
  close(s.get('f1').demand, 5 * 2 + 3);
  close(s.get('f1').score, 13 / 2);
  close(s.get('f2').score, 3 / 2);
});

test('inheritParentFRs passes a parent\'s FRs to its sub-tasks', () => {
  const feats = [F({ id: 'p' }), F({ id: 's', be: 2 })];
  feats[1][8] = 'p';
  const tasks = [T({ id: 't', priority: 'High', features: 'p' })];
  assert.equal(scoreFeatures(feats, tasks).get('s').demand, 0);
  assert.equal(scoreFeatures(feats, tasks, new Map(), { inheritParentFRs: true }).get('s').demand, 3);
});

test('idList handles JSON arrays, comma strings, dashes and null', () => {
  assert.deepEqual(idList('["A-1","b-2"]'), ['a1', 'b2']);
  assert.deepEqual(idList('a-1, b'), ['a1', 'b']);
  assert.deepEqual(idList(null), []);
});

test('rankIssues: quick wins (effort <= 2 by default) apart, unscored out, score 0 last in main', () => {
  const items = [
    { id: 'tiny', effort: 0.5, score: 40 },
    { id: 'big', effort: 14, score: 31 },
    { id: 'edge', effort: 2, score: 10 },
    { id: 'zero', effort: 5, score: 0 },
    { id: 'zeroSmall', effort: 1, score: 0 },
    { id: 'none', effort: 0, score: null },
    { id: 'mid', effort: 4, score: 50 },
  ];
  const r = rankIssues(items);
  assert.deepEqual(r.main.map((x) => x.id), ['mid', 'big', 'zeroSmall', 'zero']);
  assert.deepEqual(r.quickWins.map((x) => x.id), ['tiny', 'edge']);
  assert.deepEqual(rankIssues(items, { quickWinMaxEffort: 1 }).quickWins.map((x) => x.id), ['tiny']);
});
