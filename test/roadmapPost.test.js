import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plannedText, roadmapMessage, TEAM_LEADS, slackLink } from '../src/roadmapPost.js';

test('roadmap post: Tom\'s text, then link, planned start and end, committed', () => {
  assert.equal(plannedText({ start: '2026-12-25', end: '2026-12-25' }), '25/12/2026 (Q4 pot)');
  assert.equal(plannedText({ start: '2027-01-29', end: '2027-01-29' }), '29/01/2027 (Jan pot)');
  assert.equal(plannedText({ start: '2026-10-26', end: '2026-11-06' }), '26/10/2026 → 06/11/2026');
  assert.equal(plannedText({}), 'not planned (no dates)');
  const m = roadmapMessage('  Can we plan a week for this?  ', { name: 'Orders | X', url: 'https://app.notion.com/p/abc', start: '2027-01-29', end: '2027-01-29', committed: '2027-01-15' });
  assert.equal(m, 'Can we plan a week for this?\n\n• **Engineering issue:** [Orders | X](https://app.notion.com/p/abc)\n• **Planned:** 29/01/2027 (Jan pot)\n• **Committed:** 15/01/2027');
  assert.match(roadmapMessage('Hi', { name: 'X', url: 'u' }, TEAM_LEADS['Trip Execution']), /^<@U041Z01AKFC> Hi\n\n/);
  assert.match(roadmapMessage('Hi', { name: 'X', url: 'u' }, TEAM_LEADS['Trip Execution'], { preview: true }), /^@Jone Hoong Hi/);
  assert.match(roadmapMessage('Hi', { name: 'X' }), /^Hi\n\n.*\*\*Committed:\*\* none$/s);
  assert.match(roadmapMessage('Hi', { name: 'X', url: 'u', committed: '2027-01-04', commitSrc: { customers: ['Tyneside Express'] } }), /\*\*Committed:\*\* 04\/01\/2027 \(set by Tyneside Express\)$/);
});

test('roadmap post: message link from the Slack result, permalink or built from ts', () => {
  assert.equal(slackLink({ text: 'Message sent: https://qargotms.slack.com/archives/C0A32B4JQS1/p1793132125000100 ok' }), 'https://qargotms.slack.com/archives/C0A32B4JQS1/p1793132125000100');
  assert.equal(slackLink({ ok: true, channel: 'C0A32B4JQS1', ts: '1793132125.000100' }), 'https://qargotms.slack.com/archives/C0A32B4JQS1/p1793132125000100');
  assert.equal(slackLink({ ok: true }), null);
});

test('roadmap post templates: one line per issue, linked commit source, concise answers', async () => {
  const { dependencyMessage, blockedMessage, withMentions, roadmapMessage } = await import('../src/roadmapPost.js');
  const C = { id: 'c', name: 'C', url: 'uc' };
  const a = { id: 'a', name: 'A', url: 'ua', team: 'Application Platform', start: '2026-11-16', end: '2026-12-18', committed: '2026-12-31', commitSrc: { blocks: C } };
  const b = { id: 'b', name: 'B', url: 'ub', team: 'Application Platform', start: '2026-11-02', end: '2026-12-25', committed: '2026-12-31', commitSrc: { blocks: { id: 'a', name: 'A', url: 'ua' } } };
  const m = dependencyMessage(a, b, [TEAM_LEADS['Application Platform']]);
  assert.equal(m, [
    '@Wim Onderbeke Is this dependency correct?', '',
    '**Blocked:** [A](ua) · Application Platform · 16/11 → 18/12/2026 · commit 31/12/2026 (via [C](uc))',
    '**Blocker:** [B](ub) · Application Platform · 02/11 → 25/12/2026 · commit 31/12/2026 (inherited from it)', '',
    '⚠️ The blocker ends 25/12/2026, after the blocked issue starts 16/11/2026.',
    '• **Correct:** we re-plan so the blocker lands first.',
    '• **Not correct:** please remove the "Blocked by" link.',
  ].join('\n'));
  assert.match(withMentions(m, [TEAM_LEADS['Application Platform']]), /^<@U0421DD1LLC> Is this/);
  const p = { id: 'p', name: 'P', url: 'up', team: 'Trip Execution', start: '2027-03-26', end: '2027-03-26', committed: '2027-01-04', commitSrc: { customers: ['Tyneside Express'] } };
  assert.match(blockedMessage(p, [TEAM_LEADS['Trip Execution']], []), /\*\*Issue:\*\* \[P\]\(up\) · Trip Execution · 26\/03\/2027 \(Q1 pot\) · commit 04\/01\/2027 \(Tyneside Express\)\n\*\*Blocked by:\*\* nothing linked/);
  assert.match(blockedMessage(p, [], [b]), /\*\*Blocked by:\*\* \[B\]\(ub\)/);
  assert.match(roadmapMessage('x', { ...a }), /set by the issue it blocks: \[C\]\(uc\)/);
  assert.match(blockedMessage({ ...p, name: '[Elasticsearch] Global search' }, []), /\[\(Elasticsearch\) Global search\]\(up\)/);
});
