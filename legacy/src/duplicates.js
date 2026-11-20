// Possible duplicate engineering issues (Tom, 2026-11-02, Data quality). Rules borrowed from the product
// plugin's duplicate-check skill (Tom, 2026-11-02: "GO"): synonym expansion, read the issue before deciding,
// score bands, and never quietly duplicate a "Won't do" issue.
//   1. candidatePairs: open Features, Bugs and Technical improvements (plus "Won't do" ones, paired only with
//      open issues) whose titles look alike (TF-IDF on title words, verbs folded to one synonym);
//      parents/sub-issues, "blocks" links and the monthly dependency upgrades are left out;
//   2. Claude scores each pair 0-100 from titles, type, team, status and FR titles; pairs scoring 40+ are
//      scored again with each issue's "AI summary" (the issue text). Bands: 70+ likely duplicate, 40-69 worth
//      a look, below dropped. Verdicts are kept per pair so a pair is asked once.
// A suspected pair goes to #roadmap_product for the product managers to review and merge.
// Pure functions; no I/O.

const KEEP = /Feature|Bug|Technical improvement/;
const CLOSED = new Set(['Done', "Won't do", 'Duplicate']);
export const WONT_DO = "Won't do";
export const LIKELY = 70;
export const REVIEW = 40;
const STOP = new Set(('the a an and or of to in on for with from by at as is be are it this that when not no into via per new '
  + 'make option fe be mob frontend backend mobile order invoice transport planning trip execution application platform '
  + 'team part v1 v2 v3').split(' '));
// The skill's synonym groups (product-feature references/duplicate-check.md), each folded to its first word,
// so "archive" and "deactivate" count as the same word.
const SYNONYMS = [
  ['archive', 'deactivate', 'disable', 'inactive', 'hide'],
  ['switch', 'change', 'convert', 'toggle', 'swap'],
  ['add', 'create', 'introduce', 'support', 'enable', 'allow'],
  ['remove', 'delete', 'clear', 'unset'],
  ['show', 'display', 'visible', 'view'],
];
const FOLD = new Map(SYNONYMS.flatMap((g) => g.map((w) => [w, g[0]])));
const nid = (u) => (String(u || '').replace(/-/g, '').match(/[0-9a-f]{32}/i) || [])[0]?.toLowerCase() || null;

export const tokens = (t) => (String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-z0-9]{3,}/g) || [])
  .map((w) => FOLD.get(w) || w).filter((w) => !STOP.has(w));
export const pairKey = (a, b) => [a, b].sort().join('|');

/** Parent/sub-issue, siblings of one parent, or one blocks the other: split on purpose, not duplicates. */
function related(a, b) {
  const pa = nid(a.parentUrl); const pb = nid(b.parentUrl);
  return pa === b.id || pb === a.id || (!!pa && pa === pb) || (a.blocks || []).includes(b.id) || (b.blocks || []).includes(a.id);
}

/**
 * @param issues engine issues (planned + backlog), any status
 * @param wontDo "Won't do" issues ({ id, name, url, type, team, status }), paired only with open issues
 * @param min    title similarity threshold (cosine on TF-IDF title words)
 * @returns [{ key, a, b, score, wontDo }], most alike first; with wontDo, b is the "Won't do" issue
 */
export function candidatePairs(issues, { min = 0.6, wontDo = [] } = {}) {
  const seen = new Set();
  const ok = (i) => KEEP.test(i.type || '') && !i.isParent && !/^dependency upgrades?\b/i.test(i.name || '') && tokens(i.name).length >= 3;
  const open = issues.filter((i) => i.id && !seen.has(i.id) && seen.add(i.id) && !CLOSED.has(i.status) && ok(i));
  const wd = wontDo.filter((i) => i.id && !seen.has(i.id) && seen.add(i.id) && ok(i)).map((i) => ({ ...i, status: WONT_DO }));
  const docs = [...open, ...wd].map((i) => ({ i, t: tokens(i.name), w: i.status === WONT_DO }));
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
  // Only words shared by fewer than 250 titles find candidates (common words would pair everything).
  const inv = new Map();
  docs.forEach((d, k) => { for (const w of d.v.keys()) if (df.get(w) <= 250) (inv.get(w) || inv.set(w, []).get(w)).push(k); });
  const out = [];
  docs.forEach((d, k) => {
    const cand = new Set();
    for (const w of d.v.keys()) for (const j of inv.get(w) || []) if (j > k) cand.add(j);
    for (const j of cand) {
      const e = docs[j];
      if ((d.w && e.w) || related(d.i, e.i)) continue;
      let s = 0;
      for (const [w, x] of d.v) { const y = e.v.get(w); if (y) s += x * y; }
      s /= d.n * e.n;
      if (s < min) continue;
      const [a, b] = d.w ? [e.i, d.i] : [d.i, e.i];
      out.push({ key: pairKey(a.id, b.id), a, b, score: Math.round(s * 100) / 100, wontDo: d.w || e.w });
    }
  });
  return out.sort((x, y) => y.score - x.score);
}

const RULES = [
  'You check a product backlog (a transport management system, Qargo) for duplicate engineering issues.',
  'For each numbered pair, score 0-100 how likely both issues ask for the SAME change, so one should be merged into the other: 70+ the same change, 40-69 overlapping (one may cover the other), below 40 different.',
  'Different, score low: the same kind of change for a different screen, entity, integration partner, customer or field (e.g. "add columns on Orders" vs "add columns on Trips"; "error mapper for UPN" vs "for Trimble"); a version 1 vs version 2; a bug vs the feature it is in.',
  'Different words for the same thing are the most common way duplicates hide (archive/deactivate/hide, remove/delete/clear): judge the meaning, not the wording. When unsure, score lower.',
  'Reply with only a JSON array, one object per pair: {"k": <pair number>, "score": <0-100>, "why": "<at most 15 words>"}.',
];

/**
 * The prompt for one batch. frTitles(issueId) → [FR titles] (up to 3 used). texts: Map(issue id → AI summary),
 * given on the second pass so Claude reads the issue text (skill: open the body, never title and snippet only).
 */
export function judgePrompt(pairs, frTitles = () => [], texts = null) {
  const side = (i) => {
    const frs = frTitles(i.id).slice(0, 3);
    const text = texts?.get(i.id);
    return `"${i.name}" (${(i.type || '').replace(/[^\w ]/g, '').trim() || 'issue'}, ${i.team || 'no team'}, ${i.status || 'no status'})`
      + `${frs.length ? `; customer requests: ${frs.map((t) => `"${t}"`).join(', ')}` : ''}`
      + `${text ? `\n      Text: ${String(text).replace(/\s+/g, ' ').slice(0, 600)}` : ''}`;
  };
  return [...RULES, ...(texts ? ['Each issue also has its text: decide on it, not the title alone.'] : []), '',
    ...pairs.map((p, n) => `${n + 1}. A: ${side(p.a)}\n   B: ${side(p.b)}`)].join('\n');
}

/** Claude's reply → Map(pair key → { score, why }). Unknown or malformed entries are skipped. */
export function parseVerdicts(reply, pairs) {
  const out = new Map();
  for (const r of Array.isArray(reply) ? reply : []) {
    const p = pairs[Number(r?.k) - 1];
    const score = Number(r?.score);
    if (p && Number.isFinite(score)) out.set(p.key, { score: Math.max(0, Math.min(100, Math.round(score))), why: String(r.why || '').slice(0, 200) });
  }
  return out;
}

/** What is kept of an issue with its verdict, so a pair can be shown even when one side is not loaded ("Won't do"). */
export const snapshot = (i) => ({ id: i.id, name: i.name, url: i.url, team: i.team || null, status: i.status || null, type: i.type || null });

/** Pair keys a person marked "Not a duplicate" in the planner (audit rows "Duplicate check"). */
export const dismissedPairs = (audit) => new Set((audit || []).filter((a) => a.category === 'Duplicate check' && a.after === 'Not a duplicate').map((a) => a.before));
