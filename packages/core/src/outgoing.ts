const TAGS: Record<string, string> = { em: "*", i: "*", strong: "**", b: "**", u: "__", s: "~~", strike: "~~", del: "~~", code: "`" };
const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };
const TLDS = "fr|com|net|org|io|gg|dev|app|xyz|me|tv|eu|co|be|ch|ca|uk|de|info|ai|ly|to|sh|so|site|online|tech|fm|link|games|wiki";
// A domain nobody wrote a scheme for: not after "://", "@", a dot or a slash.
const BARE_LINK = new RegExp(`(?<![\\w/@.:-])((?:[a-z0-9-]+\\.)+(?:${TLDS}))(?![\\w-])(\\/[^\\s<>()\\[\\]]*[^\\s<>()\\[\\].,;:!?'"])?`, "gi");
// Code blocks and inline code are left as they are.
const CODE = /(```[\s\S]*?```|`[^`\n]*`)/g;

function fixProse(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>\s*/gi, "\n")
    .replace(/<p>/gi, "")
    .replace(/<a\s+href="([^"]+)"\s*>([^<]*)<\/a>/gi, (_m, href: string, label: string) => (label && label !== href ? `${label} (${href})` : href))
    .replace(/<(\/?)(em|i|strong|b|u|s|strike|del|code)>/gi, (_m, _slash: string, tag: string) => TAGS[tag.toLowerCase()] ?? "")
    .replace(/&(nbsp|amp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m] ?? m)
    .replace(BARE_LINK, (_m, domain: string, path: string | undefined) => `https://${domain}${path ?? ""}`);
}

/**
 * Last pass on what ARCHIVE-9 sends: HTML the model wrote by habit becomes Discord
 * markdown, and a bare domain gets its https://, so Discord makes it a link.
 */
export function cleanOutgoing(text: string): string {
  return text
    .split(CODE)
    .map((part, i) => (i % 2 === 1 ? part : fixProse(part)))
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
