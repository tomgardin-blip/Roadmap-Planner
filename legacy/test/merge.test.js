import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeFields, mergePlan, frMoveInput, dupUpdateInput, targetFrsInput, mergeComments, mergeFyiMessage } from '../src/merge.js';

const A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; const B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const F1 = '11111111111111111111111111111111'; const F2 = '22222222222222222222222222222222'; const X = '33333333333333333333333333333333';
const dupProps = { Name: 'Dup', Type: 'Feature 🚀', Status: 'Backlog', 'All customer requests': [`https://app.notion.com/p/${F1}`, `https://app.notion.com/p/${F2}`],
  'Assigned to': ['user://u1'], 'Preplanned on': ['user://u2/x@y.z'], Contributors: ['user://u1'], 'date:Start:start': '2026-12-25', 'date:End:start': '2026-12-25' };

test('the duplicate: FRs, people into Contributors (no doubles), dates cleared, Status Duplicate', () => {
  const dup = mergeFields(dupProps, A); const target = mergeFields({ Name: 'Keep' }, B);
  const plan = mergePlan(dup, target);
  assert.deepEqual(plan.frs, [F1, F2]);
  assert.deepEqual(plan.contributors, ['u1', 'u2']);
  const x = dupUpdateInput(plan).properties;
  assert.equal(x.Status, 'Duplicate');
  assert.deepEqual(x.Contributors, ['user://u1', 'user://u2']);
  for (const k of ['All customer requests', 'Preplanned on', 'Assigned to', 'date:Start:start', 'date:End:start']) assert.equal(x[k], null);
});

test('FR: the duplicate swapped for the target, other links kept; nothing when already on the target', () => {
  assert.deepEqual(frMoveInput(F1, [`https://app.notion.com/p/${A}`, `https://app.notion.com/p/${X}`], A, B).properties['Engineering feature'].length, 2);
  const ids = frMoveInput(F1, [`https://app.notion.com/p/${A}`, `https://app.notion.com/p/${X}`], A, B).properties['Engineering feature'].map((s) => s.replace(/-/g, ''));
  assert.deepEqual(ids, [X, B]);
  assert.equal(frMoveInput(F1, [`https://app.notion.com/p/${B}`], A, B), null);
});

test('target: missing FRs added, none when all there; comments use page mentions, not markdown links', () => {
  assert.equal(targetFrsInput(B, [`https://app.notion.com/p/${F1}`, `https://app.notion.com/p/${F2}`], [F1, F2]), null);
  assert.equal(targetFrsInput(B, [`https://app.notion.com/p/${F1}`], [F1, F2]).properties['All customer requests'].length, 2);
  const plan = mergePlan(mergeFields(dupProps, A), mergeFields({ Name: 'Keep' }, B));
  const [c1, c2] = mergeComments(plan, 'Same change', 2);
  assert.equal(c1.rich_text[1].mention.page.id.replace(/-/g, ''), B);
  assert.equal(c2.rich_text[1].mention.page.id.replace(/-/g, ''), A);
  assert.match(c1.rich_text.map((r) => r.text?.content || '').join(''), /Same change[\s\S]*2 feature requests moved/);
  const fyi = mergeFyiMessage({ name: 'Dup', url: 'https://x/a', team: 'AP' }, { name: 'Keep', url: 'https://x/b', team: 'AP' }, [{ name: 'Wim', id: 'U1' }], 'Same change', 2);
  assert.match(fyi, /^@Wim FYI: merged 2 duplicate engineering issues\./);
  assert.match(fyi, /\*\*Kept:\*\* \[Keep\]\(https:\/\/x\/b\)/);
});
