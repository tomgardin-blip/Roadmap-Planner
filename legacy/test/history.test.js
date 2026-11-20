import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAudit, dismissedFrs, weeklyLoadChanges } from '../src/history.js';

// Shapes as returned by the Notion SQL query on 2026-10-10; synthetic values.
const row = (o) => ({ Category: 'Issue moved', Field: 'Start/End', Before: '2026-11-27 / 2026-11-27', After: '2027-01-29 / 2027-01-29', Reason: 'Capacity', Warning: null,
  'Item name': 'X', Issue: '["https://app.notion.com/aaaaaaaabbbbccccddddeeeeeeeeeeee"]', FR: null, 'Changed by': '["user://u-1"]', 'Changed by (unmatched)': null, 'Update ID': 'rp-1', createdTime: '2026-10-09 10:00:00Z', ...o });

test('parseAudit reads ids, user and time', () => {
  const [a] = parseAudit([row()]);
  assert.equal(a.issueId, 'aaaaaaaabbbbccccddddeeeeeeeeeeee');
  assert.equal(a.by, 'u-1');
  assert.equal(a.at, '2026-10-09T10:00:00Z');
  assert.equal(a.frId, null);
});

test('dismissed FRs come from Pushback override rows', () => {
  const audit = parseAudit([row({ Category: 'Pushback override', Issue: null, FR: '["https://app.notion.com/11111111222233334444555555555555"]' }), row()]);
  assert.deepEqual([...dismissedFrs(audit)], ['11111111222233334444555555555555']);
});

test('weekly load: planner moves in the last 7 days and Notion edits since sync', () => {
  const issues = [{ id: 'aaaaaaaabbbbccccddddeeeeeeeeeeee', skillEfforts: { backend: 5 } }];
  const audit = parseAudit([row(), row({ createdTime: '2026-09-01 10:00:00Z' })]);
  const changes = [{ name: 'N', before: { end: '2026-12-25', be: 2 }, after: { be: 6 } }];
  const m = weeklyLoadChanges({ audit, changes, issues, now: new Date('2026-10-10T12:00:00Z') });
  assert.deepEqual({ in: m.get('2027-Q1').in, out: m.get('2027-Q1').out }, { in: 5, out: 0 });
  assert.deepEqual({ in: m.get('2026-Q4').in, out: m.get('2026-Q4').out }, { in: 4, out: 5 });
});

import { estimateLines, estimatePosts, ESTIMATE_TARGETS } from '../src/estimate.js';
test('estimate posts: one line per issue, each its own post asking claude_code for the product-feature skill', () => {
  const e = (n) => ({ issue: { name: `Issue ${n}`, url: `https://example.invalid/${n}` } });
  const lines = estimateLines([e(1), e(2), { issue: { name: 'no url' } }]);
  assert.deepEqual(lines, ['@claude_code run the product-feature skill on https://example.invalid/1', '@claude_code run the product-feature skill on https://example.invalid/2']);
  const posts = estimatePosts(`${lines.join('\n')}\n\n  @claude_code run the product-feature skill on https://example.invalid/3  \n`);
  assert.deepEqual(posts, [1, 2, 3].map((n) => `<@U0BKLA7U9EW> run the product-feature skill on https://example.invalid/${n}`));
  assert.ok(posts.every((p) => !p.includes('--') && !p.includes('Qai')));
});

test('estimate posts, Qai flow: one post per issue in #dev_effort_estimate, @Qai estimate', () => {
  const q = ESTIMATE_TARGETS.qai;
  assert.equal(q.channel.id, 'C0C1CPJKZKK');
  const lines = estimateLines([{ issue: { url: 'https://example.invalid/1' } }, { issue: { url: 'https://example.invalid/2' } }], q);
  assert.deepEqual(lines, ['@Qai estimate https://example.invalid/1', '@Qai estimate https://example.invalid/2']);
  assert.deepEqual(estimatePosts(lines.join('\n'), q), ['<@U0C0Y7E5SQ4> estimate https://example.invalid/1', '<@U0C0Y7E5SQ4> estimate https://example.invalid/2']);
  assert.equal(ESTIMATE_TARGETS.productFeature.channel.id, 'C0CC87L21GW');
});
