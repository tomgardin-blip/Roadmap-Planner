// Slack posts of "No estimate" issues to #product-create-ei-skill-trigger (SPEC 3, v2; channel
// changed from #dev_effort_estimate by Tom 2026-10-26):
// posted as the viewer after an editable preview. One post per issue, in the channel, not in a
// thread, each asking the claude_code bot to run the product-feature skill on the issue: that
// skill writes the estimate and brings the engineering issue up to date (Tom, 2026-10-26).

export const ESTIMATE_CHANNEL = { id: 'C0CC87L21GW', name: '#product-create-ei-skill-trigger' };
export const CLAUDE_CODE = 'U0BKLA7U9EW'; // Slack user id of the claude_code bot

/** entries: [{ issue }] → one editable line per issue, as shown in the preview. */
export function estimateLines(entries) {
  return entries.filter((e) => e.issue?.url).map((e) => `@claude_code run the product-feature skill on ${e.issue.url}`);
}

/** Preview text → Slack messages: one per non-empty line, "@claude_code" turned into a real mention. */
export function estimatePosts(text) {
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => l.replace(/^@claude_code\b/i, `<@${CLAUDE_CODE}>`));
}
