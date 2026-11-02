import { test } from 'node:test';
import assert from 'node:assert/strict';
import { candidatePairs, judgePrompt, parseVerdicts, dismissedPairs, pairKey } from '../src/duplicates.js';
import { duplicateMessage } from '../src/roadmapPost.js';

// Synthetic issues only.
const iss = (id, name, extra = {}) => ({ id, name, url: `https://example.invalid/${id}`, type: 'Feature 🚀', status: 'Backlog', team: 'Order + Invoice', blocks: [], ...extra });

test('look-alike titles pair up; parents, siblings, blocks, dependency upgrades and closed issues do not', () => {
  const p = candidatePairs([
    iss('a1', 'Fuel surcharge based on full invoice instead of order level'),
    iss('a2', 'Fuel surcharge based on full invoice instead of order level', { status: 'Claude - to review' }),
    iss('b1', 'Reduce firestore document size for more stops', { parentUrl: 'https://example.invalid/Parent-00000000000000000000000000000001' }),
    iss('b2', 'Reduce firestore document size for more stops', { parentUrl: 'https://example.invalid/Parent-00000000000000000000000000000001' }),
    iss('c1', 'Dependency upgrades - AI - October 2026'), iss('c2', 'Dependency upgrades - AI - November 2026'),
    iss('d1', 'Show location email on detail page', { status: 'Done' }), iss('d2', 'Show location email on detail page'),
    iss('e1', 'Something entirely different about pallets'),
  ]);
  assert.deepEqual(p.map((x) => x.key), [pairKey('a1', 'a2')]);
});

test('Claude scores parse by pair number; the second pass carries the issue text; "Not a duplicate" rows hide a pair', () => {
  const pairs = [{ key: 'x|y', a: iss('x', 'A one'), b: iss('y', 'A two') }, { key: 'u|v', a: iss('u', 'B'), b: iss('v', 'C') }];
  assert.match(judgePrompt(pairs), /1\. A: "A one"/);
  assert.match(judgePrompt(pairs, () => [], new Map([['x', 'Lets users archive stops']])), /Text: Lets users archive stops/);
  const v = parseVerdicts([{ k: 1, score: 82, why: 'same' }, { k: 2, score: 'high' }, { k: 9, score: 90 }], pairs);
  assert.deepEqual([...v], [['x|y', { score: 82, why: 'same' }]]);
  assert.deepEqual([...dismissedPairs([{ category: 'Duplicate check', after: 'Not a duplicate', before: 'x|y' }])], ['x|y']);
});

test('the #roadmap_product post names both issues and asks to merge', () => {
  const m = duplicateMessage(iss('x', 'Issue X'), iss('y', 'Issue Y'), [{ id: 'U1', name: 'Lead' }], 'same change');
  assert.match(m, /^@Lead These 2 engineering issues look like duplicates\./);
  assert.match(m, /\*\*Issue 1:\*\* \[Issue X\]/);
  assert.match(m, /Why: same change/);
});

test('synonyms fold, and a "Won\'t do" issue pairs only with an open one', () => {
  const p = candidatePairs([
    iss('o1', 'Archive inactive trailers in the resource list'),
    iss('o2', 'Something about pallet labels and printing'),
  ], { wontDo: [iss('w1', 'Deactivate inactive trailers in the resource list'), iss('w2', 'Hide inactive trailers in the resource list')] });
  assert.deepEqual(p.map((x) => [x.a.id, x.b.id, x.wontDo]).sort(), [['o1', 'w1', true], ['o1', 'w2', true]]);
});

test('a pair with a Won\'t do issue asks whether that decision still stands', () => {
  const m = duplicateMessage(iss('x', 'New X'), { ...iss('y', 'Old X'), status: "Won't do" }, [], 'same change', true);
  assert.match(m, /looks like one we set to Won't do/);
  assert.match(m, /\*\*Won't do:\*\* \[Old X\]/);
  assert.match(m, /reopen it/);
});
