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
 * `<dyad-mcp-tool-call>` and Dyad tool tags and return a summary map
 * keyed by tool name. Returns null when no tool calls are found.
 */
export function extractToolCallSummary(
  content: string,
): Map<string, number> | null {
  const counts = new Map<string, number>();

  // Count MCP tool calls
  const mcpRegex = /<dyad-mcp-tool-call\s+[^>]*tool="([^"]*)"[^>]*>/g;
  let match;
  while ((match = mcpRegex.exec(content)) !== null) {
    const toolName = match[1];
    counts.set(toolName, (counts.get(toolName) ?? 0) + 1);
  }

  // Count Dyad built-in tool calls
  const dyadToolRegex =
    /<dyad-(write|read|edit|grep|explore-code|code-search|web-search|list-files|copy|rename|delete|add-dependency|execute-sql|search-replace|read-logs|search-chats|read-chat|explore-chat-history|codebase-context|script|git)\b/g;
  const DYAD_LABELS: Record<string, string> = {
    write: "write",
    read: "read",
    edit: "edit",
    grep: "grep",
    "explore-code": "explore",
    "code-search": "code-search",
    "web-search": "web-search",
    "list-files": "list-files",
    copy: "copy",
    rename: "rename",
    delete: "delete",
    "add-dependency": "add-dep",
    "execute-sql": "sql",
    "search-replace": "replace",
    "read-logs": "logs",
    "search-chats": "search-chats",
    "read-chat": "read-chat",
    "explore-chat-history": "explore-history",
    "codebase-context": "context",
    script: "script",
    git: "git",
  };
  while ((match = dyadToolRegex.exec(content)) !== null) {
    const tag = match[1];
    const label = DYAD_LABELS[tag] ?? tag;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return counts.size > 0 ? counts : null;
}

/**
 * Format a tool call summary into a compact, human-readable string.
 * Example: "5 tools: readx3, writex1, grepx1"
 */
export function formatToolCallSummary(counts: Map<string, number>): string {
  const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
  const parts = Array.from(counts.entries())
    .map(([name, count]) => (count > 1 ? `${name}\u00d7${count}` : name))
    .join(", ");
  return `${total} tool${total !== 1 ? "s" : ""}: ${parts}`;
}
