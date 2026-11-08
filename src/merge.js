// Merge a duplicate pair (Tom, 2026-11-08, Data quality → Possible duplicate issues: "I want the option to
// merge them, and choose which remains … there is a merge skill in the product plugin … post in roadmap
// product as an fyi"). Same steps as the product plugin's mark-duplicate skill, run by the page as the viewer:
//   1. every FR of the duplicate points to the issue that stays ("Engineering feature" on the FR; the
//      duplicate is swapped for the target, other links on the FR are kept);
//   2. the duplicate: Status "Duplicate", "All customer requests" cleared, "Preplanned on" and "Assigned to"
//      moved into "Contributors", Start and End cleared;
//   3. a comment on both issues, the other issue as a page mention (rich text: a <mention-page> tag in
//      markdown is stored as a broken link, per the skill);
//   4. the FRs are checked on the target ("All customer requests"); any missing are added there;
//   5. an FYI in #roadmap_product (the usual editable preview), and audit rows.
// Pure builders; the calls live in data/writer.js.

const nid = (x) => (String(x || '').replace(/-/g, '').match(/[0-9a-f]{32}/i) || [])[0]?.toLowerCase() || null;
export const dashed = (id) => { const h = nid(id); return h ? `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` : null; };
const list = (v) => (Array.isArray(v) ? v : v ? [v] : []);
const userId = (u) => String(u || '').replace(/^user:\/\//, '').split('/')[0] || null;

/** An issue's merge-relevant fields from its notion-fetch properties (empty people/relations are left out by fetch). */
export function mergeFields(props, id) {
  return {
    id: nid(id),
    name: props?.Name || '',
    type: props?.Type || '',
    status: props?.Status || null,
    frs: list(props?.['All customer requests']).map(nid).filter(Boolean),
    assigned: list(props?.['Assigned to']).map(userId).filter(Boolean),
    preplanned: list(props?.['Preplanned on']).map(userId).filter(Boolean),
    contributors: list(props?.Contributors).map(userId).filter(Boolean),
    start: props?.['date:Start:start'] ? String(props['date:Start:start']).slice(0, 10) : null,
    end: props?.['date:End:start'] ? String(props['date:End:start']).slice(0, 10) : null,
  };
}

/** What the merge will do, for the dry-run summary (skill step 2). */
export function mergePlan(dup, target) {
  const contributors = [...new Set([...dup.contributors, ...dup.preplanned, ...dup.assigned])];
  return { frs: dup.frs, movedPeople: [...new Set([...dup.preplanned, ...dup.assigned])], contributors, clearDates: !!(dup.start || dup.end), dup, target };
}

/** notion-update-page for one FR: its "Engineering feature" with the duplicate swapped for the target, or null when already there. */
export function frMoveInput(frId, current, dupId, targetId) {
  const ids = list(current).map(nid).filter(Boolean);
  if (ids.includes(nid(targetId)) && !ids.includes(nid(dupId))) return null;
  const next = [...new Set([...ids.filter((x) => x !== nid(dupId)), nid(targetId)])];
  return { page_id: dashed(frId), command: 'update_properties', properties: { 'Engineering feature': next.map(dashed) } };
}

/** notion-update-page for the duplicate (skill step 3b), one call. */
export function dupUpdateInput(plan) {
  return {
    page_id: dashed(plan.dup.id), command: 'update_properties',
    properties: {
      Status: 'Duplicate',
      'All customer requests': null,
      Contributors: plan.contributors.length ? plan.contributors.map((u) => `user://${u}`) : null,
      'Preplanned on': null,
      'Assigned to': null,
      'date:Start:start': null,
      'date:End:start': null,
    },
  };
}

/** notion-update-page adding FRs still missing on the target's "All customer requests" (step 4). */
export function targetFrsInput(targetId, current, frIds) {
  const have = list(current).map(nid).filter(Boolean);
  const missing = frIds.filter((x) => !have.includes(x));
  if (!missing.length) return null;
  return { page_id: dashed(targetId), command: 'update_properties', properties: { 'All customer requests': [...have, ...missing].map(dashed) } };
}

const t = (content) => ({ type: 'text', text: { content: String(content).slice(0, 2000) } });
const b = (content) => ({ type: 'text', text: { content }, annotations: { bold: true } });
const m = (id) => ({ type: 'mention', mention: { type: 'page', page: { id: dashed(id) } } });
const linked = (i) => (i.url ? `[${String(i.name).replace(/\[/g, '(').replace(/\]/g, ')')}](${i.url})` : `**${i.name}**`);
const n = (k) => `${k} feature request${k === 1 ? '' : 's'}`;

/** notion-create-comment inputs for both issues (skill step 3c). */
export function mergeComments(plan, reason, moved) {
  return [
    { page_id: dashed(plan.dup.id), rich_text: [t('Marked as duplicate of '), m(plan.target.id), t('.\n\n'), b('Reason:'), t(` ${reason}\n\n${n(moved)} moved to the target issue.`)] },
    { page_id: dashed(plan.target.id), rich_text: [t('The scope of '), m(plan.dup.id), t(` was taken up in this issue. ${n(moved)} ${moved === 1 ? 'was' : 'were'} moved.`)] },
  ];
}

/** The FYI in #roadmap_product after a merge (Tom, 2026-11-08): who is tagged, both issues, the reason. */
export function mergeFyiMessage(dup, target, leads, reason, moved) {
  const who = leads.map((l) => `@${l.name}`).join(' ');
  return [
    `${who} FYI: merged 2 duplicate engineering issues.`.trim(),
    '',
    `**Kept:** ${linked(target)} · ${target.team || 'no team'}`,
    `**Duplicate:** ${linked(dup)} · ${dup.team || 'no team'} (status Duplicate, dates cleared)`,
    `${n(moved)} moved to the kept issue.`,
    ...(reason ? ['', `Why: ${reason}`] : []),
  ].join('\n');
}
