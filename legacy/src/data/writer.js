// Executes the planner's Notion writes over the `mcp` capability, each followed by its audit row.
// Input shapes come from src/notion/writes.js (verified against Notion on 2026-10-10 on the test pages).
// Order per action: read the live "before" from Notion, write, then audit. A failed audit after a
// successful write is reported, never silently dropped.

import { mergeFields, mergePlan, frMoveInput, dupUpdateInput, targetFrsInput, mergeComments } from '../merge.js';
import { eiRequestInput, eiUpdateInput, createdRowUrl, EI_APP, ESTIMATE_CHANGE } from '../eiRequest.js';
import { ROADMAP_CHANNEL, slackLink, slackUserFromSearch, channelsFromSearch } from '../roadmapPost.js';
import { call, runQuery, LIGHTDASH, NOTION } from './live.js';
import {
  TEST_FR, assertAllowed, issueDatesInput, issuePriorityInput, issueStatusInput, frUpdateInput, ownerCommentInput, ownerCommentText,
  auditRowInput, readIssueDates, readFr, moveWarnings, parseFetchedProperties,
} from '../notion/writes.js';

const dashed = (id) => { const h = String(id).replace(/-/g, '').toLowerCase(); return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`; };
const updateId = () => `rp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

let me = null;
/** The viewer as a Notion user ({id, name, email}), for "Changed by" and the test-FR ping. */
export async function whoAmI(mcp) {
  if (me) return me;
  const r = await call(mcp, NOTION, 'notion-get-users', { user_id: 'self' });
  const u = r?.results?.[0] || r?.user || r;
  me = u?.id ? { id: u.id, name: u.name || '', email: u.email || '' } : { id: null, name: '', email: '' };
  return me;
}

async function audit(mcp, row) {
  const who = await whoAmI(mcp).catch(() => ({}));
  try {
    await call(mcp, NOTION, 'notion-create-pages', auditRowInput({ ...row, changedById: who.id, changedByText: who.name }));
  } catch (err) {
    throw Object.assign(new Error('The change is saved in Notion, but its audit row failed. Tell Claude: audit row missing.'), { code: 'audit_failed', cause: err });
  }
}

export async function readIssue(mcp, id) {
  return readIssueDates(await call(mcp, NOTION, 'notion-fetch', { id: dashed(id) }));
}
export async function readFrLive(mcp, id) {
  return readFr(await call(mcp, NOTION, 'notion-fetch', { id: dashed(id) }));
}

/** Set an issue's Start and End. Warnings (after commit, blocker) are shown, never blocking. */
export async function moveIssue(mcp, { issue, start, end, reason, blockers = [] }) {
  assertAllowed('issue', issue.id);
  const before = await readIssue(mcp, issue.id);
  await call(mcp, NOTION, 'notion-update-page', issueDatesInput(issue.id, start, end));
  const warnings = moveWarnings(issue, end, blockers);
  await audit(mcp, {
    category: warnings.some((w) => w.startsWith('After commit')) ? 'Moved past commit' : 'Issue moved',
    field: 'Start/End',
    before: `${before.start || '–'} / ${before.end || '–'}`,
    after: `${start || '–'} / ${end || '–'}`,
    reason, warning: warnings.join('; '), issueId: issue.id, itemName: issue.name || before.name, updateId: updateId(),
  });
  return { before, after: { start, end }, warnings };
}

/** Set an engineering issue's Priority (Quarter plan), then audit it. */
export async function setIssuePriority(mcp, { issue, priority }) {
  assertAllowed('issue', issue.id);
  const before = await readIssue(mcp, issue.id);
  if (before.priority === priority) return { before, changed: false };
  await call(mcp, NOTION, 'notion-update-page', issuePriorityInput(issue.id, priority));
  await audit(mcp, {
    category: 'Issue priority changed', field: 'Priority', before: before.priority || '', after: priority,
    issueId: issue.id, itemName: issue.name || before.name, updateId: updateId(),
  });
  return { before, changed: true };
}

/** Set an engineering issue's Status (FR edit sheet), then audit it. Returns the change for the comment. */
export async function setIssueStatus(mcp, { issue, status, reason, updateId: uid }) {
  assertAllowed('issue', issue.id);
  const before = await readIssue(mcp, issue.id);
  if (before.status === status) return { before, change: null };
  await call(mcp, NOTION, 'notion-update-page', issueStatusInput(issue.id, status));
  await audit(mcp, {
    category: 'EI status changed', field: 'Status', before: before.status || '', after: status,
    reason, issueId: issue.id, itemName: issue.name || before.name, updateId: uid || updateId(),
  });
  return { before, change: { field: 'EI Status', category: 'EI status changed', label: 'EI status', before: before.status, after: status } };
}

/** Change an FR's Success Committed and/or Priority. Returns the changes for the owner ping. */
export async function editFr(mcp, { fr, successCommitted, priority, status, reason }) {
  assertAllowed('fr', fr.id);
  const before = await readFrLive(mcp, fr.id);
  const patch = {};
  if (successCommitted !== undefined && successCommitted !== before.successCommitted) patch.successCommitted = successCommitted;
  if (priority !== undefined && priority !== before.priority) patch.priority = priority;
  if (status !== undefined && status !== before.status) patch.status = status;
  if (!Object.keys(patch).length) return { before, changes: [] };
  await call(mcp, NOTION, 'notion-update-page', frUpdateInput(fr.id, patch));
  const uid = updateId();
  const changes = [];
  if ('successCommitted' in patch) changes.push({ field: 'Success Committed', category: 'FR committed changed', label: 'Committed', before: before.successCommitted, after: patch.successCommitted });
  if ('priority' in patch) changes.push({ field: 'Priority', category: 'FR priority changed', label: 'Priority', before: before.priority, after: patch.priority });
  if ('status' in patch) changes.push({ field: 'Status', category: 'FR status changed', label: 'Status', before: before.status, after: patch.status });
  for (const c of changes) {
    await audit(mcp, { category: c.category, field: c.field, before: c.before, after: c.after, reason, frId: fr.id, itemName: fr.title || before.name, updateId: uid });
  }
  return { before, changes, updateId: uid, name: fr.title || before.name };
}

/**
 * The FR's Responsible Success as a Notion user, or null (no ping, never a fallback: Tom 2026-10-10).
 * Lightdash "Responsible success email" → Notion user by email. Test FR: the viewer (test hook).
 */
export async function findOwner(mcp, frId) {
  let email;
  if (String(frId).replace(/-/g, '') === TEST_FR) email = (await whoAmI(mcp)).email;
  else {
    const rows = await runQuery(mcp, 'Roadmap Planner: FR owner', {
      exploreName: 'deals_extract',
      dimensions: ['customer_tasks_customer_task_notion_page_id', 'customer_tasks_responsible_success_email'],
      metrics: [], sorts: [], limit: 1,
      filters: { type: 'and', dimensions: [{ fieldId: 'customer_tasks_customer_task_notion_page_id', fieldType: 'string', fieldFilterType: 'string', operator: 'equals', values: [dashed(frId)] }] },
    });
    email = rows?.[0]?.customer_tasks_responsible_success_email;
  }
  if (!email) return null;
  const r = await call(mcp, NOTION, 'notion-get-users', { query: email });
  const u = (r?.results || []).find((x) => String(x.email || '').toLowerCase() === email.toLowerCase());
  return u ? { id: u.id, name: u.name || email, email } : null;
}

export function previewComment({ owner, changes, comment }) {
  const text = ownerCommentText({ changes, comment });
  return owner ? `@${owner.name} ${text}` : text;
}

/** Post the comment on the FR (tagging the owner when there is one), then audit it. */
export async function adviseOwner(mcp, { fr, owner, changes = [], comment, updateId: uid, tag = false }) {
  assertAllowed('fr', fr.id);
  // No tag in Notion any more (Tom and Lee, 2026-10-30): the COM/AM is tagged in the customer's Slack channel.
  await call(mcp, NOTION, 'notion-create-comment', ownerCommentInput(fr.id, { ownerId: tag ? owner?.id : null, changes, comment }));
  await audit(mcp, {
    category: 'Owner advised', field: 'Comment', before: '',
    after: [changes.map((c) => `${c.label}: ${c.before || '–'} → ${c.after || '–'}`).join('; '), comment].filter(Boolean).join(' · '),
    reason: comment, frId: fr.id, itemName: fr.title, ownerId: owner?.id, updateId: uid || updateId(),
  });
}

/** Data quality → "Not a duplicate" on a suspected pair (Tom, 2026-11-02). Audit row only, Before = the pair key. */
export async function dismissDuplicate(mcp, { a, b, key }) {
  assertAllowed('issue', a.id);
  await audit(mcp, { category: 'Duplicate check', field: 'Duplicate', before: key, after: 'Not a duplicate', issueId: a.id, itemName: `${a.name} / ${b.name}`.slice(0, 1900), updateId: updateId() });
}

/** Keep an issue out of the push-out suggestions, or suggest it again (Tom, 2026-10-29). Audit row only. */
export async function setPushOutKeep(mcp, { issue, keep, reason }) {
  assertAllowed('issue', issue.id);
  await audit(mcp, {
    category: 'Push-out override', field: 'Pushback', before: keep ? 'Suggested to push out' : 'Kept', after: keep ? 'Kept' : 'Suggested to push out',
    reason, issueId: issue.id, itemName: issue.name, updateId: updateId(),
  });
}

/** #roadmap_product post about an issue, then an audit row holding the message link (Tom, 2026-10-27). */
export async function postRoadmap(mcp, { issue, message }) {
  const res = await postSlack(mcp, ROADMAP_CHANNEL.id, message);
  const link = slackLink(res);
  await audit(mcp, {
    category: 'Roadmap post', field: 'Slack', before: '', after: link || 'Posted (no link returned)',
    reason: message.slice(0, 1900), issueId: issue.id, itemName: issue.name, updateId: updateId(),
  });
  return link;
}

/**
 * A product-feature skill / @Qai estimate / Qai team post for one issue or FR (Tom, 2026-10-29: record the
 * Slack thread on the issue). Posts, then an audit row "Estimate post": Before = channel, After = link.
 * item: { id, name, fr: bool }
 */
export async function postEstimate(mcp, { channel, item, message }) {
  const res = await postSlack(mcp, channel.id, message);
  const link = slackLink(res, channel.id);
  await audit(mcp, {
    category: 'Estimate post', field: 'Slack', before: channel.name, after: link || 'Posted (no link returned)',
    reason: message.slice(0, 1900), ...(item.fr ? { frId: item.id } : { issueId: item.id }), itemName: item.name, updateId: updateId(),
  });
  return link;
}

/** The Slack account of a person by email (slack_search_users), or null. */
export async function findSlackUser(mcp, email) {
  if (!email) return null;
  return slackUserFromSearch(await call(mcp, 'Slack', 'slack_search_users', { query: email }), email);
}

/**
 * Pushback → "Ask COM/AM" (Tom, 2026-10-28): a DM to the FR's Responsible Success as the viewer, then an
 * audit row (category "COM/AM asked") holding the message link.
 */
export async function askOwner(mcp, { user, issue, fr, message }) {
  const res = await postSlack(mcp, user.id, message.split(`@${user.name}`).join(`<@${user.id}>`));
  const link = slackLink(res, user.id);
  await audit(mcp, {
    category: 'COM/AM asked', field: 'Slack', before: '', after: link || 'Sent (no link returned)',
    reason: message.slice(0, 1900), frId: fr.id, issueId: issue?.id, itemName: fr.title || fr.name, updateId: updateId(),
  });
  return link;
}

/** Customer Slack channels matching a word (public and private ones the viewer can see). */
export async function findChannels(mcp, word) {
  if (!word) return [];
  return channelsFromSearch(await call(mcp, 'Slack', 'slack_search_channels', { keywords: [word], natural_language_query: `customer channel ${word}`, channel_types: 'public_channel,private_channel', response_format: 'detailed', limit: 20 }));
}

/** The COM/AM tag in the customer channel (Tom and Lee, 2026-10-30), audit row "COM/AM asked" with Before = the channel. */
export async function postCustomerChannel(mcp, { channel, user, fr, issue, message }) {
  const res = await postSlack(mcp, channel.id, user ? message.split(`@${user.name}`).join(`<@${user.id}>`) : message);
  const link = slackLink(res, channel.id);
  await audit(mcp, {
    category: 'COM/AM asked', field: 'Slack', before: `#${channel.name}`, after: link || 'Posted (no link returned)',
    reason: message.slice(0, 1900), frId: fr.id, issueId: issue?.id, itemName: fr.title || fr.name, updateId: updateId(),
  });
  return link;
}

/** Post a message to Slack as the viewer. */
export async function postSlack(mcp, channelId, message) {
  return call(mcp, 'Slack', 'slack_send_message', { channel_id: channelId, message });
}

const userNames = new Map();
/** Notion user id → display name (cached). */
export async function userName(mcp, id) {
  if (!userNames.has(id)) {
    const r = await call(mcp, NOTION, 'notion-get-users', { user_id: id }).catch(() => null);
    const u = r?.results?.[0] || r;
    userNames.set(id, u?.name || '');
  }
  return userNames.get(id);
}

/**
 * Create an engineering issue for an FR through the Engineering Issues app (Tom, 2026-11-07): the same queue
 * row the app writes (the Mac mini runner then writes the EI with product-feature), as the viewer, then an
 * audit row "EI requested" (Field "Engineering Issues app", After = the queue row). Returns the row URL.
 */
export async function requestEi(mcp, fr) {
  const res = await call(mcp, NOTION, 'notion-create-pages', eiRequestInput(fr));
  const row = createdRowUrl(res);
  await audit(mcp, {
    category: 'EI requested', field: EI_APP, before: '', after: row || 'Requested (no link returned)',
    frId: fr.id, itemName: fr.title || 'FR', updateId: updateId(),
  });
  return row;
}

/**
 * Get a No estimate issue estimated through the Engineering Issues app (Tom, 2026-11-07): the app's "Update issue"
 * row for the EI, as the viewer, then an audit row "EI requested" on the issue (Before "Update issue").
 */
export async function requestEiUpdate(mcp, issue, change = ESTIMATE_CHANGE) {
  const res = await call(mcp, NOTION, 'notion-create-pages', eiUpdateInput(issue, change));
  const row = createdRowUrl(res);
  await audit(mcp, {
    category: 'EI requested', field: EI_APP, before: 'Update issue', after: row || 'Requested (no link returned)',
    reason: change, issueId: issue.id, itemName: issue.name || 'Issue', updateId: updateId(),
  });
  return row;
}

/** Read both issues of a pair for the merge summary: { dup, target, plan }. */
export async function readMerge(mcp, dupId, targetId) {
  const [d, t] = await Promise.all([dupId, targetId].map((id) => call(mcp, NOTION, 'notion-fetch', { id: dashed(id) })));
  const dup = mergeFields(parseFetchedProperties(d), dupId);
  const target = mergeFields(parseFetchedProperties(t), targetId);
  return { dup, target, plan: mergePlan(dup, target) };
}

/**
 * Merge a duplicate into the issue that stays (Tom, 2026-11-08), the product plugin's mark-duplicate steps:
 * FRs moved, the duplicate closed as Duplicate, comments on both, FRs checked on the target. No rollback on a
 * partial failure (as the skill): returns what happened, step by step. Audit rows: "Issue merged" on the
 * duplicate (Status) and one per moved FR (field "Engineering feature").
 */
export async function mergeIssues(mcp, { plan, reason, onStep = () => {} }) {
  assertAllowed('issue', plan.dup.id); assertAllowed('issue', plan.target.id);
  const uid = updateId();
  const report = { moved: 0, already: 0, failed: [], dupUpdated: false, comments: 0, addedOnTarget: 0, errors: [] };
  for (const fr of plan.frs) {
    onStep(`Moving FRs ${report.moved + report.already + report.failed.length + 1}/${plan.frs.length}…`);
    try {
      const props = parseFetchedProperties(await call(mcp, NOTION, 'notion-fetch', { id: dashed(fr) }));
      const input = frMoveInput(fr, props['Engineering feature'], plan.dup.id, plan.target.id);
      if (!input) { report.already++; continue; }
      await call(mcp, NOTION, 'notion-update-page', input);
      report.moved++;
      await audit(mcp, { category: 'Issue merged', field: 'Engineering feature', before: plan.dup.name, after: plan.target.name, reason, frId: fr, issueId: plan.target.id, itemName: props.task || props.Name || 'FR', updateId: uid }).catch((e) => report.errors.push(`audit row for an FR: ${e.message}`));
    } catch (err) { report.failed.push(fr); report.errors.push(`FR ${fr}: ${err?.message || err?.code || 'failed'}`); }
  }
  onStep('Closing the duplicate…');
  try {
    await call(mcp, NOTION, 'notion-update-page', dupUpdateInput(plan));
    report.dupUpdated = true;
    await audit(mcp, { category: 'Issue merged', field: 'Status', before: plan.dup.status || '', after: 'Duplicate', reason, warning: `Merged into ${plan.target.name}`, issueId: plan.dup.id, itemName: plan.dup.name, updateId: uid }).catch((e) => report.errors.push(`audit row: ${e.message}`));
  } catch (err) { report.errors.push(`Duplicate not updated: ${err?.message || err?.code || 'failed'}`); }
  onStep('Commenting on both issues…');
  for (const c of mergeComments(plan, reason, report.moved + report.already)) {
    try { await call(mcp, NOTION, 'notion-create-comment', c); report.comments++; } catch (err) { report.errors.push(`Comment not added: ${err?.message || err?.code || 'failed'}`); }
  }
  onStep('Checking the FRs on the kept issue…');
  try {
    const t = parseFetchedProperties(await call(mcp, NOTION, 'notion-fetch', { id: dashed(plan.target.id) }));
    const ok = plan.frs.filter((x) => !report.failed.includes(x));
    const input = targetFrsInput(plan.target.id, t['All customer requests'], ok);
    if (input) { await call(mcp, NOTION, 'notion-update-page', input); report.addedOnTarget = input.properties['All customer requests'].length - (t['All customer requests'] || []).length; }
  } catch (err) { report.errors.push(`FR check on the kept issue: ${err?.message || err?.code || 'failed'}`); }
  return report;
}
