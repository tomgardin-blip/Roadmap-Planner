import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usable, CACHE_VERSION, CACHE_MAX_AGE_MS, readCache, writeCache } from '../src/data/cache.js';

test('cached snapshot: right version, rows, not older than 3 days', () => {
  const now = Date.parse('2026-11-18T12:00:00Z');
  const ok = { v: CACHE_VERSION, at: '2026-11-18T08:00:00Z', rows: [] };
  assert.equal(usable(ok, now), true);
  assert.equal(usable({ ...ok, v: CACHE_VERSION + 1 }, now), false);
  assert.equal(usable({ ...ok, rows: null }, now), false);
  assert.equal(usable({ ...ok, at: new Date(now - CACHE_MAX_AGE_MS - 1).toISOString() }, now), false);
  assert.equal(usable(null, now), false);
});

test('no IndexedDB (private window, Node): no cache, no error', async () => {
  assert.equal(await readCache(), null);
  assert.equal(await writeCache({ at: new Date().toISOString(), rows: [] }), false);
});
