import { unescapeXmlAttr } from "../../../shared/xmlEscape";

/** Extract <dyad-attachment> tags from message content and return parsed attachment data. */
export function extractAttachments(content: string): {
  name: string;
  type: string;
  url: string;
  path: string;
  attachmentType: string;
}[] {
  const tagRegex = /<dyad-attachment\s+([^>]*)><\/dyad-attachment>/g;
  const attrRegex = /([\w-]+)="([^"]*)"/g;
  const results: {
    name: string;
    type: string;
    url: string;
    path: string;
    attachmentType: string;
  }[] = [];

  let match;
  while ((match = tagRegex.exec(content)) !== null) {
    const attrs: Record<string, string> = {};
    attrRegex.lastIndex = 0;
    let attrMatch;
    while ((attrMatch = attrRegex.exec(match[1])) !== null) {
      attrs[attrMatch[1]] = unescapeXmlAttr(attrMatch[2]);
    }
    results.push({
      name: attrs.name || "",
      type: attrs.type || "",
      url: attrs.url || "",
      path: attrs.path || "",
      attachmentType: attrs["attachment-type"] || "chat-context",
    });
  }
  return results;
}

/** Strip <dyad-attachment> tags from user message content. */
export function stripAttachmentInfo(content: string): string {
  return content
    .replace(/<dyad-attachment\s+[^>]*><\/dyad-attachment>/g, "")
    .trim();
}

/**
 * Extract tool calls from assistant message content by parsing
 * `<dyad-mcp-tool-call>` tags and return a summary map keyed by tool name.
 */
export function extractToolCallSummary(
  content: string,
): Map<string, number> | null {
  const regex = /<dyad-mcp-tool-call\s+[^>]*tool="([^"]*)"[^>]*>/g;
  const counts = new Map<string, number>();
  let match;
  while ((match = regex.exec(content)) !== null) {
    const toolName = match[1];
    counts.set(toolName, (counts.get(toolName) ?? 0) + 1);
  }
  return counts.size > 0 ? counts : null;
}
