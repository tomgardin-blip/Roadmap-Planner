// Possible duplicate engineering issues (Tom, 2026-11-02, Data quality). Two steps:
//   1. candidatePairs: open Features, Bugs and Technical improvements whose titles look alike (TF-IDF on
//      title words); parents/sub-issues, "blocks" links and the monthly dependency upgrades are left out;
//   2. Claude judges each candidate pair (the page's `sample` capability), from both titles, their type,
//      team, status and linked FR titles. Verdicts are kept per pair so a pair is asked once.
// A suspected pair goes to #roadmap_product for the product managers to review and merge.
// Pure functions; no I/O.

const KEEP = /Feature|Bug|Technical improvement/;
const CLOSED = new Set(['Done', "Won't do", 'Duplicate']);
const STOP = new Set(('the a an and or of to in on for with from by at as is be are it this that when not no into via per new add '
  + 'allow show use can should able make support option fe be mob frontend backend mobile order invoice transport planning '
  + 'trip execution application platform team part v1 v2 v3').split(' '));
const nid = (u) => (String(u || '').replace(/-/g, '').match(/[0-9a-f]{32}/i) || [])[0]?.toLowerCase() || null;

export const tokens = (t) => (String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{3,}/g) || []).filter((w) => !STOP.has(w));
export const pairKey = (a, b) => [a, b].sort().join('|');

/** Parent/sub-issue, siblings of one parent, or one blocks the other: split on purpose, not duplicates. */
function related(a, b) {
  const pa = nid(a.parentUrl); const pb = nid(b.parentUrl);
  return pa === b.id || pb === a.id || (!!pa && pa === pb) || (a.blocks || []).includes(b.id) || (b.blocks || []).includes(a.id);
}

/**
 * @param issues engine issues (planned + backlog), any status
 * @param min    title similarity threshold (cosine on TF-IDF title words)
 * @returns [{ key, a, b, score }], most alike first
 */
export function candidatePairs(issues, { min = 0.6 } = {}) {
  const seen = new Set();
  const list = issues.filter((i) => i.id && !seen.has(i.id) && seen.add(i.id) && KEEP.test(i.type || '') && !CLOSED.has(i.status)
    && !i.isParent && !/^dependency upgrades?\b/i.test(i.name || '') && tokens(i.name).length >= 3);
  const docs = list.map((i) => ({ i, t: tokens(i.name) }));
  const df = new Map();
  for (const d of docs) for (const w of new Set(d.t)) df.set(w, (df.get(w) || 0) + 1);
  const N = docs.length;
  for (const d of docs) {
    const v = new Map();
    for (const w of d.t) v.set(w, (v.get(w) || 0) + 1);
    let n = 0;
    for (const [w, c] of v) { const x = c * Math.log(N / df.get(w)); v.set(w, x); n += x * x; }
    d.v = v; d.n = Math.sqrt(n) || 1;
  }
  // Only words shared by fewer than 200 titles find candidates (common words would pair everything).
  const inv = new Map();
  docs.forEach((d, k) => { for (const w of d.v.keys()) if (df.get(w) <= 200) (inv.get(w) || inv.set(w, []).get(w)).push(k); });
  const out = [];
  docs.forEach((d, k) => {
    const cand = new Set();
    for (const w of d.v.keys()) for (const j of inv.get(w) || []) if (j > k) cand.add(j);
    for (const j of cand) {
      const e = docs[j];
      if (related(d.i, e.i)) continue;
      let s = 0;
      for (const [w, x] of d.v) { const y = e.v.get(w); if (y) s += x * y; }
      s /= d.n * e.n;
      if (s >= min) out.push({ key: pairKey(d.i.id, e.i.id), a: d.i, b: e.i, score: Math.round(s * 100) / 100 });
    }
  });
  return out.sort((x, y) => y.score - x.score);
}

/**
 * The prompt for one batch. frTitles(issueId) → [FR titles] (up to 3 used).
 * Reply: a JSON array of { k, dup, why } — k the pair number, dup true/false, why one short line.
 */
export function judgePrompt(pairs, frTitles = () => []) {
  const side = (i) => {
    const frs = frTitles(i.id).slice(0, 3);
    return `"${i.name}" (${(i.type || '').replace(/[^\w ]/g, '').trim() || 'issue'}, ${i.team || 'no team'}, ${i.status || 'no status'})${frs.length ? `; customer requests: ${frs.map((t) => `"${t}"`).join(', ')}` : ''}`;
  };
  return [
    'You check a product backlog (a transport management system, Qargo) for duplicate engineering issues.',
    'For each numbered pair, decide whether both issues ask for the SAME change, so one should be merged into the other.',
    'Not duplicates: the same kind of change for a different screen, entity, integration partner, customer or field (e.g. "add columns on Orders" vs "add columns on Trips"; "error mapper for UPN" vs "for Trimble"); a version 1 vs version 2; a bug vs the feature it is in.',
    'When unsure, answer false.',
    'Reply with only a JSON array, one object per pair: {"k": <pair number>, "dup": true|false, "why": "<at most 15 words>"}.',
    '',
    ...pairs.map((p, n) => `${n + 1}. A: ${side(p.a)}\n   B: ${side(p.b)}`),
  ].join('\n');
}

/** Claude's reply → Map(pair key → { dup, why }). Unknown or malformed entries are skipped. */
export function parseVerdicts(reply, pairs) {
  const out = new Map();
  for (const r of Array.isArray(reply) ? reply : []) {
    const p = pairs[Number(r?.k) - 1];
    if (p && typeof r.dup === 'boolean') out.set(p.key, { dup: r.dup, why: String(r.why || '').slice(0, 200) });
  }
  return out;
}

/** Pair keys a person marked "Not a duplicate" in the planner (audit rows "Duplicate check"). */
export const dismissedPairs = (audit) => new Set((audit || []).filter((a) => a.category === 'Duplicate check' && a.after === 'Not a duplicate').map((a) => a.before));
