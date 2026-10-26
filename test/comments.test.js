import test from 'node:test';
import assert from 'node:assert/strict';
import { parseComments } from '../src/notion/comments.js';

test('FR comments: count, latest comment, mentions as @name', () => {
  const xml = `<discussions total-count="2"><discussion id="d1" comment-count="2">
<comment id="c1" user-url="user://aaaaaaaa-1111-2222-3333-444444444444/a@example.invalid" datetime="2026-10-10T10:17:45.985Z"><mention url="user://x">Some One</mention> fyi: first &amp; one</comment>
<comment id="c2" user-url="user://bbbbbbbb-1111-2222-3333-444444444444/b@example.invalid" datetime="2026-10-20T08:00:00.000Z">No match found, <b>no EI</b> created</comment>
</discussion></discussions>`;
  const r = parseComments(xml);
  assert.equal(r.count, 2);
  assert.equal(r.last.at, '2026-10-20T08:00:00.000Z');
  assert.equal(r.last.by, 'bbbbbbbb-1111-2222-3333-444444444444');
  assert.equal(r.last.text, 'No match found, no EI created');
  assert.deepEqual(parseComments('<discussions total-count="0"></discussions>'), { count: 0, last: null });
});
