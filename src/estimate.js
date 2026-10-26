// Slack posts of "No estimate" issues to #dev_effort_estimate (SPEC 3, v2, decided 2026-10-10):
// posted as the viewer after an editable preview. One post per issue, in the channel, not in a
// thread, each "@Qai estimate <issue link>" so the Qai agent estimates it (Tom, 2026-10-26).

export const ESTIMATE_CHANNEL = { id: 'C0C1CPJKZKK', name: '#dev_effort_estimate' };
export const QAI = 'U0C0Y7E5SQ4'; // Slack user id of the Qai agent

/** entries: [{ issue }] → one editable line per issue, as shown in the preview. */
export function estimateLines(entries) {
  return entries.filter((e) => e.issue?.url).map((e) => `@Qai estimate ${e.issue.url}`);
}

/** Preview text → Slack messages: one per non-empty line, "@Qai" turned into a real mention. */
export function estimatePosts(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => l.replace(/^@Qai\b/i, `<@${QAI}>`));
}
