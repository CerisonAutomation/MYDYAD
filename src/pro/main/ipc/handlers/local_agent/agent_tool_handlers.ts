/**
 * IPC handlers for agent tool consent management
 */

import { createLoggedHandler } from "@/ipc/handlers/safe_handle";
import type { AgentTool, SetAgentToolConsentParams } from "@/ipc/types";
import log from "electron-log";
import {
  type AgentToolName,
  TOOL_DEFINITIONS,
  getAllAgentToolConsents,
  getDefaultConsent,
  setAgentToolConsent,
} from "./tool_definitions";

const logger = log.scope("agent_tool_handlers");
const handle = createLoggedHandler(logger);
export function registerAgentToolHandlers() {
  // Get list of available tools with their consent settings
  handle("agent-tool:get-tools", async (): Promise<AgentTool[]> => {
    const consents = getAllAgentToolConsents();
    return TOOL_DEFINITIONS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      isAllowedByDefault: getDefaultConsent(tool.name) === "always",
      consent: consents[tool.name],
    }));
  });

  // Set consent for a single tool
  handle(
    "agent-tool:set-consent",
    async (_event, params: SetAgentToolConsentParams) => {
      setAgentToolConsent(params.toolName as AgentToolName, params.consent);
      return { success: true };
    },
  );
}
