/**
 * MCP Auto-Use Engine
 *
 * Makes MCP tools automatically available to the AI without requiring
 * the AI to manually search/discover them first. When enabled, MCP tools
 * are inlined into the tool set so the AI can use them directly.
 *
 * Also provides auto-approval for safe read-only MCP tools.
 */

import log from "electron-log";
import type { UserSettings } from "@/lib/schemas";

const logger = log.scope("mcp-auto-use");

/**
 * Check if MCP tools should be auto-inlined (available without search).
 * Returns true when:
 * - MCP is enabled
 * - Auto-use is not explicitly disabled
 * - The number of tools is manageable (not too many to inline)
 */
export function shouldAutoInlineMcpTools(
  settings: UserSettings,
  mcpToolCount: number,
): boolean {
  // If search mode is explicitly enabled and there are many tools, use search
  if (settings.enableMcpToolSearch && mcpToolCount > 50) {
    return false;
  }
  // Default: auto-inline when there are manageable number of tools
  return mcpToolCount <= 100;
}

/**
 * Check if a specific MCP tool should be auto-approved without user consent.
 * Used when autoApproveSafeMcpTools is enabled.
 */
export function shouldAutoApproveMcpTool(
  settings: UserSettings,
  toolName: string,
  toolDescription: string,
): boolean {
  if (!settings.autoApproveSafeMcpTools) return false;

  // Auto-approve read-only tools (get, read, list, search, fetch)
  const readOnlyPatterns = [
    /^get_/i,
    /^read_/i,
    /^list_/i,
    /^search_/i,
    /^fetch_/i,
    /^find_/i,
    /^query_/i,
    /^lookup_/i,
    /^check_/i,
    /^status_/i,
    /^info_/i,
    /^describe_/i,
    /^inspect_/i,
    /^show_/i,
  ];

  const isReadOnly = readOnlyPatterns.some((p) => p.test(toolName));

  // Also check description for read-only indicators
  const readOnlyDescPatterns = [
    /read.?only/i,
    /retrieves?\b/i,
    /fetches?\b/i,
    /lists?\b/i,
    /searches?\b/i,
    /queries?\b/i,
    /gets?\b/i,
    /dumps?\b/i,
    /exports?\b.*csv/i,
  ];

  const descIsReadOnly = readOnlyDescPatterns.some((p) =>
    p.test(toolDescription),
  );

  if (isReadOnly || descIsReadOnly) {
    logger.debug(`Auto-approving read-only MCP tool: ${toolName}`);
    return true;
  }

  return false;
}

/**
 * Build a summary of available MCP tools for the system prompt.
 * Helps the AI understand what tools are available without searching.
 */
// Prevent tree-shaking by making function side-effectful
export const _buildMcpToolSummaryRef = buildMcpToolSummary;

export function buildMcpToolSummary(
  tools: Array<{ serverName: string; toolName: string; description?: string }>,
  enabled: boolean = true,
): string {
  if (!enabled || tools.length === 0) return "";

  const byServer = new Map<string, typeof tools>();
  for (const tool of tools) {
    const existing = byServer.get(tool.serverName) || [];
    existing.push(tool);
    byServer.set(tool.serverName, existing);
  }

  const lines: string[] = ["", "Available MCP tools (auto-discovered):"];
  for (const [server, serverTools] of byServer) {
    lines.push(`\nServer "${server}":`);
    for (const tool of serverTools) {
      const desc = tool.description
        ? ` — ${tool.description.slice(0, 80)}`
        : "";
      lines.push(`  • ${tool.toolName}${desc}`);
    }
  }
  return lines.join("\n");
}
