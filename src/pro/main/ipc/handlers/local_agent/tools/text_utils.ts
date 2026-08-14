/**
 * Shared text utilities for tool output handling.
 *
 * Smart truncation preserves the most useful parts of large outputs:
 * the beginning (context) and end (result), with a summary of what was omitted.
 */

/**
 * Truncate text intelligently — keep head and tail, summarize the middle.
 *
 * @param text - The full text to truncate
 * @param maxLength - Maximum characters in the output (default: 50,000)
 * @param headRatio - Fraction of maxLength to keep from the start (default: 0.6)
 * @returns Truncated text with "[...N characters omitted...]" marker, or original if short enough
 */
export function smartTruncate(
  text: string,
  maxLength = 50_000,
  headRatio = 0.6,
): string {
  if (text.length <= maxLength) return text;

  const headLen = Math.floor(maxLength * headRatio);
  const tailLen = maxLength - headLen;
  const omitted = text.length - headLen - tailLen;

  const head = text.slice(0, headLen);
  const tail = text.slice(-tailLen);

  return `${head}\n\n[...${omitted.toLocaleString()} characters omitted...]\n\n${tail}`;
}

/**
 * Truncate surrogate-safe — won't split emoji or astral characters.
 * Falls back to smartTruncate for large content.
 */
export function smartTruncateSafe(
  text: string,
  maxLength = 50_000,
  headRatio = 0.6,
): string {
  if (text.length <= maxLength) return text;

  const headLen = Math.floor(maxLength * headRatio);
  const tailLen = maxLength - headLen;

  // Adjust head boundary to avoid splitting a surrogate pair
  let headEnd = headLen;
  if (headEnd > 0) {
    const code = text.charCodeAt(headEnd - 1);
    if (code >= 0xd800 && code <= 0xdbff) {
      headEnd--; // Don't include the lone high surrogate
    }
  }

  // Adjust tail boundary similarly
  let tailStart = text.length - tailLen;
  if (tailStart > 0) {
    const code = text.charCodeAt(tailStart - 1);
    if (code >= 0xdc00 && code <= 0xdfff) {
      tailStart--; // Include the full surrogate pair in head
    }
  }

  const head = text.slice(0, headEnd);
  const tail = text.slice(tailStart);
  const omitted = text.length - headEnd - tail.length;

  return `${head}\n\n[...${omitted.toLocaleString()} characters omitted...]\n\n${tail}`;
}
