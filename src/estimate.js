// Slack post of the "No estimate" queue to #dev_effort_estimate (SPEC 3, v2, decided 2026-10-10):
// posted as the viewer after an editable preview. Opens with @Qai, the agent that runs the
// effort-estimate skill on what is listed (Tom, 2026-10-26). No other tags.

export const ESTIMATE_CHANNEL = { id: 'C0C1CPJKZKK', name: '#dev_effort_estimate' };
export const QAI = 'U0C0Y7E5SQ4'; // Slack user id of the Qai agent
const MAX = 4800; // Slack limit is 5000 chars per text element
const day = (iso) => (iso ? new Date(`${String(iso).slice(0, 10)}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : null);

/** groups: [{ label, entries: [{ issue, frs }] }] → markdown, trimmed to fit one Slack message. */
export function estimateMessage(groups) {
  const total = groups.reduce((a, g) => a + g.entries.length, 0);
  let text = `<@${QAI}> estimate the issues below\n\n**${total} issues need an FE/BE/MOB estimate before they can be planned**\n`;
  let shown = 0;
  for (const g of groups) {
    if (!g.entries.length) continue;
    text += `\n**${g.label}** (${g.entries.length})\n`;
    for (const { issue, frs } of g.entries) {
      const meta = [issue.team || 'No team', `${frs.length} FR${frs.length === 1 ? '' : 's'}`, issue.committed ? `commit ${day(issue.committed)}` : null].filter(Boolean).join(' · ');
      const line = `• [${String(issue.name).replace(/[[\]]/g, '')}](${issue.url}) · ${meta}\n`;
      if (text.length + line.length > MAX) { text += `• and ${total - shown} more in the Roadmap Planner\n`; return text.trimEnd(); }
      text += line; shown++;
    }
  }
  return text.trimEnd();
}
