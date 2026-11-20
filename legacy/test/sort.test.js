import test from 'node:test';
import assert from 'node:assert/strict';
import { sortEntries } from '../src/ui/lists.js';

test('lists sort by customer value: score, then demand of unscored, then committed date', () => {
  const e = (id, committed) => ({ issue: { id, committed } });
  const scores = new Map([
    ['lo', { score: 1, demand: 3 }], ['hi', { score: 5, demand: 10 }], ['tie', { score: 1, demand: 2 }],
    ['noEff', { score: null, demand: 20 }], ['noEff2', { score: null, demand: 4 }],
  ]);
  const list = [e('noEff2'), e('lo', '2027-02-01'), e('none'), e('tie', '2026-12-01'), e('hi'), e('noEff')];
  assert.deepEqual(sortEntries(list, scores).map((x) => x.issue.id), ['hi', 'tie', 'lo', 'noEff', 'noEff2', 'none']);
  assert.deepEqual(sortEntries(list, scores, 'commit').map((x) => x.issue.id), ['tie', 'lo', 'hi', 'noEff', 'noEff2', 'none']);
});
