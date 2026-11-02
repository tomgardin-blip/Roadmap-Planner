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

test('Claude verdicts parse by pair number; "Not a duplicate" rows hide a pair', () => {
  const pairs = [{ key: 'x|y', a: iss('x', 'A one'), b: iss('y', 'A two') }, { key: 'u|v', a: iss('u', 'B'), b: iss('v', 'C') }];
  assert.match(judgePrompt(pairs), /1\. A: "A one"/);
  const v = parseVerdicts([{ k: 1, dup: true, why: 'same' }, { k: 2, dup: 'maybe' }, { k: 9, dup: true }], pairs);
  assert.deepEqual([...v], [['x|y', { dup: true, why: 'same' }]]);
  assert.deepEqual([...dismissedPairs([{ category: 'Duplicate check', after: 'Not a duplicate', before: 'x|y' }])], ['x|y']);
});

test('the #roadmap_product post names both issues and asks to merge', () => {
  const m = duplicateMessage(iss('x', 'Issue X'), iss('y', 'Issue Y'), [{ id: 'U1', name: 'Lead' }], 'same change');
  assert.match(m, /^@Lead These 2 engineering issues look like duplicates\./);
  assert.match(m, /\*\*Issue 1:\*\* \[Issue X\]/);
  assert.match(m, /Why: same change/);
});
