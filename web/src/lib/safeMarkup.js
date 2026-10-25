const TAGS = new Set(['b', 'i', 'em', 'strong', 'br', 'p', 'u']);
const ICONS = new Set(['star', 'unique', 'energy', 'mental', 'physical', 'wild', 'crisis', 'hazard', 'attack', 'boost']);

/**
 * Escape markup by default, restoring only formatting tags without attributes
 * and our fixed icon spans. Escaping every unmatched '<' also handles malformed
 * tags that a browser accepts but a tag-removal regexp would leave untouched.
 * Shared by the catalogue importer and the rendering boundary (cached data too).
 * @param {string} text
 * @returns {string}
 */
export function safeCardMarkup(text) {
  return text.replace(/<[^>]*>|</g, token => {
    const tag = /^<(\/?)([a-z]+)(?:\s[^<>]*)?\/?\s*>$/i.exec(token);
    if (tag && TAGS.has((tag[2] ?? '').toLowerCase())) return `<${tag[1]}${tag[2]?.toLowerCase()}>`;
    const icon = /^<span data-icon="([a-z]+)">$/i.exec(token);
    if (icon && ICONS.has(icon[1] ?? '')) return `<span data-icon="${icon[1]}">`;
    if (/^<\/span\s*>$/i.test(token)) return '</span>';
    return token.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  });
}
