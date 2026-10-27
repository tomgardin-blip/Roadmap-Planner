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
  const link = issue.url ? `[${issue.name || 'Engineering issue'}](${issue.url})` : (issue.name || 'Engineering issue');
  return [
    `• **Engineering issue:** ${link}`,
    `• **Planned:** ${plannedText(issue)}`,
    `• **Committed:** ${issue.committed ? `${formatDate(String(issue.committed).slice(0, 10))}${issue.commitBy ? ` (${issue.commitBy})` : ''}` : 'none'}`,
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
