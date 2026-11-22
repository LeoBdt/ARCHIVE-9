const EMOJI_ONLY =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u{200D}|\u{FE0F}|\u{20E3}|<a?:\w+:\d+>|\s)+$/u;

/** True for messages with nothing to answer: empty, whitespace, or emojis only. */
export function isTrivialContent(content: string): boolean {
  const trimmed = content.trim();
  return trimmed === "" || EMOJI_ONLY.test(trimmed);
}

const FORGED_PREFIX = /^\[[^\]\n]{0,80}\(ID[^\]\n]{0,80}\)\]\s*:?/gmu;

/**
 * Neutralises lines that imitate the system `[Name (ID 123)]` prefix, so a member
 * can't pass their text off as someone else's message.
 */
export function neutraliseForgedPrefixes(content: string): string {
  return content.replace(FORGED_PREFIX, (match) => match.replaceAll("[", "［").replaceAll("]", "］"));
}

export function truncate(content: string, max: number): string {
  return content.length <= max ? content : `${content.slice(0, max - 1)}…`;
}
