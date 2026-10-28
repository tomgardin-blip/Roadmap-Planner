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
    '• **Correct:** we re-plan so the blocker lands first.',
    '• **Not correct:** please remove the "Blocked by" link.',
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
    blockers.length
      ? `• **Still blocked:** the blocker${blockers.length > 1 ? 's' : ''} must land first, so we re-plan to make the commit.`
      : '• **Still blocked:** which issue blocks it? Please link it in "Blocked by" so we can plan around it.',
    '• **Not blocked:** please update the status' + (blockers.length ? ' and the "Blocked by" link.' : '.'),
  ].join('\n');
}

/** Preview text → Slack text: every "@Lead Name" of the given leads becomes a real mention. */
export function withMentions(text, leads) {
  let out = String(text || '');
  for (const l of tags(leads)) out = out.split(`@${l.name}`).join(`<@${l.id}>`);
  return out;
}
