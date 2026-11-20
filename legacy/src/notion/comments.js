// FR comments for the "No engineering issue" queue (Tom, 2026-10-26): an FR that already has
// comments usually means the product-feature skill ran but found no match and created no issue,
// so Tom checks those by hand. Parses notion-get-comments' <discussions> text.

const unescape = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

/** → { count, last: { at, by, text } | null }. by = Notion user id or null. */
export function parseComments(text) {
  const s = String(text || '');
  const comments = [...s.matchAll(/<comment\b([^>]*)>([\s\S]*?)<\/comment>/g)].map((m) => {
    const attr = (k) => (m[1].match(new RegExp(`${k}="([^"]*)"`)) || [])[1] || null;
    const user = attr('user-url');
    return {
      at: attr('datetime'),
      by: user ? (user.match(/user:\/\/([0-9a-f-]+)/) || [])[1] || null : null,
      text: unescape(m[2].replace(/<mention[^>]*>([\s\S]*?)<\/mention>/g, '@$1').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(),
    };
  });
  const last = comments.reduce((a, c) => (!a || String(c.at) > String(a.at) ? c : a), null);
  return { count: comments.length, last };
}
