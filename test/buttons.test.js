import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// Every button the UI renders with a data-* action must have a handler that looks it up (Tom, 2026-11-07:
// "None of the buttons work on mobile": the Create EI / Request estimate handlers had been deleted by mistake).
test('every data-* action on a rendered button has a handler', () => {
  const dir = new URL('../src/ui/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.js'));
  const src = files.map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');
  const actions = new Set();
  for (const m of src.matchAll(/<button\b[^>]*?\sdata-([a-z][a-z-]*)=/g)) actions.add(m[1]);
  // Attributes that only carry data for another action, not an action of their own.
  const dataOnly = new Set(['label', 'issue', 'grp', 'name', 'team', 'skill', 'period', 'theme']);
  const missing = [...actions].filter((a) => !dataOnly.has(a) && !src.includes(`[data-${a}`) && !src.includes(`dataset.${a.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}`));
  assert.deepEqual(missing, []);
  for (const a of ['eireq', 'eiupd', 'move', 'rmpost', 'fr-edit', 'qpx', 'dqfix']) assert.ok(src.includes(`[data-${a}`), `no handler for data-${a}`);
});
