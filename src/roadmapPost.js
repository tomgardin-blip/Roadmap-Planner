// #roadmap_product nudges (Tom, 2026-10-27): Tom writes the message, the planner always ends it with
// the engineering issue's link, its current planned start and end, and its committed date. Posted as
// the viewer, one message per Post, in the channel (no thread). Main use: issues still on a month or
// quarter pot that need a week planned to make their committed date.

import { formatDate, lastFridayOfMonth, lastFridayOfQuarter } from './periods.js';

export const ROADMAP_CHANNEL = { id: 'C0A32B4JQS1', name: '#roadmap_product' };
// The responsible of each team, tagged at the start of the post (Tom, 2026-10-27). No team: no tag.
export const TEAM_LEADS = {
  'Order + Invoice': { name: 'Sam Persoon', id: 'U01MKAWUTV4' },
  'Transport Planning': { name: 'Sam Buysse', id: 'U02SD5QCSSH' },
  'Trip Execution': { name: 'Jone Hoong', id: 'U041Z01AKFC' },
  'Application Platform': { name: 'Wim Onderbeke', id: 'U0421DD1LLC' },
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "26/10/2026 → 25/12/2026", or "25/12/2026 (Q4 pot)" for a pot (Start = End), or "not planned". */
export function plannedText({ start, end } = {}) {
  const s = start ? String(start).slice(0, 10) : null; const e = end ? String(end).slice(0, 10) : null;
  if (!s && !e) return 'not planned (no dates)';
  if (s && e && s !== e) return `${formatDate(s)} → ${formatDate(e)}`;
  const d = e || s; const [y, m] = d.split('-').map(Number);
  const pot = d === lastFridayOfQuarter(y, Math.floor((m - 1) / 3) + 1) ? `Q${Math.floor((m - 1) / 3) + 1} pot` : d === lastFridayOfMonth(y, m - 1) ? `${MONTHS[m - 1]} pot` : null;
  // A pot (Start = End): the pot date only (Tom, 2026-10-27).
  return `${formatDate(d)}${pot ? ` (${pot})` : ''}`;
}

/** The fixed end of every post. */
export function roadmapFooter(issue) {
  const link = issue.url ? linked({ ...issue, name: issue.name || 'Engineering issue' }) : (issue.name || 'Engineering issue');
  return [
    `• **Engineering issue:** ${link}`,
    `• **Planned:** ${plannedText(issue)}`,
    `• **Committed:** ${issue.committed ? `${formatDate(String(issue.committed).slice(0, 10))}${issue.commitSrc ? ` (${longSource(issue.commitSrc)})` : ''}` : 'none'}`,
  ].join('\n');
}

/** lead: TEAM_LEADS entry or null. Shown in the preview as "@Name", sent as a real <@id> mention. */
export function roadmapMessage(text, issue, lead = null, { preview = false } = {}) {
  const tag = lead ? `${preview ? `@${lead.name}` : `<@${lead.id}>`} ` : '';
  return `${tag}${String(text || '').trim()}\n\n${roadmapFooter(issue)}`;
}

/**
 * The message link from the slack_send_message result (Tom, 2026-10-27: shown next to the button to
 * follow replies). Uses the permalink when the result has one, else builds it from channel and ts.
 */
export function slackLink(result, channelId = ROADMAP_CHANNEL.id) {
  const s = typeof result === 'string' ? result : JSON.stringify(result ?? '');
  const m = /https:\/\/[a-z0-9.-]*slack\.com\/archives\/[A-Z0-9]+\/p\d+[^\s"'<>)\]\\]*/i.exec(s);
  if (m) return m[0];
  const ts = /"(?:message_)?ts"\s*:\s*"(\d+)\.(\d+)"/.exec(s) || /\bts[=:]\s*(\d{9,})\.(\d+)/.exec(s);
  return ts ? `https://qargotms.slack.com/archives/${channelId}/p${ts[1]}${ts[2]}` : null;
}

// Square brackets in a name would break the markdown link: shown as round ones.
const linked = (i) => (i.url ? `[${String(i.name).replace(/\[/g, '(').replace(/\]/g, ')')}](${i.url})` : `**${i.name}**`);
const tags = (leads) => [...new Map((leads || []).filter(Boolean).map((l) => [l.id, l])).values()];
const who = (leads) => tags(leads).map((l) => `@${l.name}`).join(' ');

/**
 * What sets an issue's committed date, as data (Tom, 2026-10-28: an issue named in a post must be a link):
 * { customers: [names] } or { blocks: { id, name, url } } (an issue it blocks), or null.
 */
function longSource(src) {
  if (src.customers) return `set by ${src.customers.join(', ')}`;
  return `set by the issue it blocks: ${linked(src.blocks)}`;
}
function shortSource(src, from) {
  if (!src) return '';
  if (src.customers) return ` (${src.customers.join(', ')})`;
  return src.blocks.id === from?.id ? ' (inherited from it)' : ` (via ${linked(src.blocks)})`;
}

/** Short planned text: "16/11 → 18/12/2026", "26/03/2027 (Q1 pot)" or "not planned". */
function shortPlan(i) {
  if (!i.start && !i.end) return 'not planned';
  const s = i.start ? String(i.start).slice(0, 10) : null; const e = i.end ? String(i.end).slice(0, 10) : null;
  if (s && e && s !== e) return `${formatDate(s).slice(0, 5)}${s.slice(0, 4) === e.slice(0, 4) ? '' : formatDate(s).slice(5)} → ${formatDate(e)}`;
  return plannedText(i);
}
const commitShort = (i, from) => (i.committed ? `commit ${formatDate(String(i.committed).slice(0, 10))}${shortSource(i.commitSrc, from)}` : 'no commit');
// Both templates end with one ask (Tom, 2026-10-28, replaces the Correct / Not correct options).
const ASK = 'Could u have a look and advise so we can amend accordingly?';
const line = (label, i, from) => `**${label}:** ${linked(i)} · ${i.team || 'no team'} · ${shortPlan(i)} · ${commitShort(i, from)}`;

/**
 * At risk → "Dependency in the wrong order" (Tom, 2026-10-28): ask the teams' leads whether the "Blocked by"
 * is right. One line per issue, the clash, then what each answer means.
 */
export function dependencyMessage(issue, blocker, leads) {
  const start = issue.start || issue.end;
  return [
    `${who(leads)} Is this dependency correct?`.trim(),
    '',
    line('Blocked', issue),
    line('Blocker', blocker, issue),
    '',
    blocker.end
      ? `⚠️ The blocker ends ${formatDate(String(blocker.end).slice(0, 10))}, after the blocked issue starts ${formatDate(String(start).slice(0, 10))}.`
      : `⚠️ The blocker has no dates, while the blocked issue starts ${formatDate(String(start).slice(0, 10))}.`,
    '',
    ASK,
  ].join('\n');
}

/**
 * At risk → "Committed, status Blocked/on hold" (Tom, 2026-10-28): ask the leads whether it is still blocked.
 * Its "Blocked by" issues are listed; none linked is called out, since the blocker should be linked there.
 */
export function blockedMessage(issue, leads, blockers = []) {
  return [
    `${who(leads)} Is this still blocked/on hold?`.trim(),
    '',
    line('Issue', issue),
    ...(blockers.length ? blockers.map((b) => line('Blocked by', b, issue)) : ['**Blocked by:** nothing linked']),
    '',
    ASK,
  ].join('\n');
}

/** Preview text → Slack text: every "@Lead Name" of the given leads becomes a real mention. */
export function withMentions(text, leads) {
  let out = String(text || '');
  for (const l of tags(leads)) out = out.split(`@${l.name}`).join(`<@${l.id}>`);
  return out;
}

/**
 * Pushback → "Ask COM/AM" (Tom, 2026-10-28): a friendly DM to the FR's Responsible Success asking whether
 * the priority or date may change, and to check with the customer. Shown in full and editable before Send.
 * ctx: { kind: 'over', quarterLabel, team } or { kind: 'late' }.
 */
export function askOwnerMessage({ ownerName, issue, fr, customer, ctx }) {
  const hi = ownerName ? `Hi @${ownerName}` : 'Hi';
  const commit = issue.committed ? formatDate(String(issue.committed).slice(0, 10)) : '–';
  const why = ctx.kind === 'over'
    ? `we're planning ${ctx.quarterLabel} and ${ctx.team} is overbooked. ${linked(issue)} is committed for ${commit}`
    : `${linked(issue)} is planned ${shortPlan(issue)}, after its committed date ${commit}. That date is set`;
  return `${hi}, ${why} because of ${customer}'s request ${linked(fr)} (${fr.priority || 'no priority'}). Would it be ok to lower the priority / move the date? Could u check with ${customer} and let me know? Thx!`;
}

/** slack_search_users result → { id, name } for the person with this email, or null. */
export function slackUserFromSearch(result, email) {
  const text = typeof result === 'string' ? result : result?.results || JSON.stringify(result ?? '');
  for (const block of String(text).split(/### Result/)) {
    const id = /User ID:\s*(U[A-Z0-9]+)/.exec(block)?.[1];
    const mail = /Email:\s*(\S+)/.exec(block)?.[1];
    const name = /Name:\s*(.+)/.exec(block)?.[1]?.trim();
    if (id && mail && mail.toLowerCase() === String(email).toLowerCase()) return { id, name: name || email };
  }
  return null;
}

/**
 * Data quality fixes (Tom, 2026-10-28): the DM to an FR's COM/AM, per check. "@Owner" is replaced by the
 * owner's name (and becomes a mention on Send). d: { fr: {name,url,priority}, issue?, customer, golive?, stage?, committed? }
 */
export function qualityDm(check, d) {
  const fr = linked(d.fr);
  const iss = d.issue ? linked(d.issue) : null;
  const gl = d.golive ? formatDate(d.golive) : null;
  switch (check) {
    case 'goLivePassed':
      return `Hi @Owner, ${fr} for ${d.customer} is "${d.fr.priority}", but the go-live in Notion (${gl}) has passed. Did they go live without it, or did the go-live move? If it moved, could u update the go-live date on the deal? Thx!`;
    case 'goLiveCustomerLive':
      return `Hi @Owner, ${fr} for ${d.customer} is still "${d.fr.priority}", but the deal is ${d.stage}. Is it still needed? If so, which priority should it get now? Thx!`;
    case 'goLiveNoDate':
      return `Hi @Owner, ${fr} for ${d.customer} is "${d.fr.priority}", but the deal has no go-live date${d.stage ? ` (stage ${d.stage})` : ''}, so it has no committed date. Could u set the go-live, or let me know if it's no longer needed? Thx!`;
    case 'frCommitPast':
      return `Hi @Owner, ${fr} for ${d.customer} was committed for ${formatDate(d.committed)}, but ${iss} is still ${d.issue?.status || 'open'}. Could u check with ${d.customer} and agree a new date? Thx!`;
    case 'issueDoneFrOpen':
      return `Hi @Owner, ${iss} is Done, so ${fr} for ${d.customer} is delivered. Could u let ${d.customer} know and close the FR? Thx!`;
    case 'integrationTagged':
      return `Hi @Owner, ${fr} for ${d.customer} is tagged both Feature Request and Integrations. Is it product work for the roadmap, or an integration? If it's an integration, could u change the Type/Category so it leaves the roadmap? Thx!`;
    default:
      return `Hi @Owner, could u have a look at ${fr} for ${d.customer}? Thx!`;
  }
}

/** Data quality → "Blocker already Done": ask the lead to remove the stale "Blocked by" link. */
export function staleBlockerMessage(issue, leads, blockers) {
  return [
    `${who(leads)} The "Blocked by" on this issue points to work that is already finished.`.trim(),
    '',
    line('Issue', issue),
    ...blockers.map((b) => `**Blocked by:** ${linked(b)} · ${b.status}`),
    '',
    'Could u remove the link (or link the real blocker) so the planning is right? Thx!',
  ].join('\n');
}
