// Slack posts of "No estimate" issues (SPEC 3, v2), posted as the viewer after an editable preview,
// one post per issue straight in the channel (never grouped, never in a thread). Two flows, both kept
// (Tom, 2026-10-26 / 2026-10-27):
//   productFeature: #product-create-ei-skill-trigger, asks claude_code to run the product-feature
//                   skill (writes the estimate and brings the issue up to date);
//   qai:            #dev_effort_estimate, the old flow, asks Qai for an estimate.

export const ESTIMATE_TARGETS = {
  productFeature: {
    channel: { id: 'C0CC87L21GW', name: '#product-create-ei-skill-trigger' },
    bot: { name: 'claude_code', id: 'U0BKLA7U9EW' },
    line: (url) => `@claude_code run the product-feature skill on ${url}`,
    button: 'Post No estimate to #product-create-ei-skill-trigger',
    how: 'each asking @claude_code to run the product-feature skill (writes the estimate and updates the issue)',
  },
  qai: {
    channel: { id: 'C0C1CPJKZKK', name: '#dev_effort_estimate' },
    bot: { name: 'Qai', id: 'U0C0Y7E5SQ4' },
    line: (url) => `@Qai estimate ${url}`,
    button: 'Ask @Qai in #dev_effort_estimate',
    how: 'each asking @Qai for an effort estimate',
  },
};

/** entries: [{ issue }] → one editable line per issue, as shown in the preview. */
export function estimateLines(entries, target = ESTIMATE_TARGETS.productFeature) {
  return entries.filter((e) => e.issue?.url).map((e) => target.line(e.issue.url));
}

/** Preview text → Slack messages: one per non-empty line, the leading @bot turned into a real mention. */
export function estimatePosts(text, target = ESTIMATE_TARGETS.productFeature) {
  const at = new RegExp(`^@${target.bot.name}\\b`, 'i');
  return String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => l.replace(at, `<@${target.bot.id}>`));
}
