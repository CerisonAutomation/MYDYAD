/**
 * Free agent quota handlers — stubbed for BYOK build.
 * All quota checks return unlimited. No Dyad hosted engine calls.
 */
import { createTypedHandler } from "./base";
import { freeAgentQuotaContracts } from "../types/free_agent_quota";
import log from "electron-log";

const logger = log.scope("free_agent_quota_handlers");

/**
 * Gets the current free agent quota status.
 * Stubbed for BYOK build — always returns unlimited quota.
 */
export async function getFreeAgentQuotaStatus() {
  return {
    messagesUsed: 0,
    messagesLimit: 999999,
    isQuotaExceeded: false,
    windowStartTime: null,
    resetTime: null,
    hoursUntilReset: null,
  };
}

/**
 * Marks a message as using the free agent quota.
 * No-op in BYOK build.
 */
export async function markMessageAsUsingFreeAgentQuota(
  messageId: number,
): Promise<void> {
  logger.log(`[BYOK stub] Marked message ${messageId} (no-op)`);
}

/**
 * Unmarks a message as using the free agent quota (refunds quota).
 * No-op in BYOK build.
 */
export async function unmarkMessageAsUsingFreeAgentQuota(
  messageId: number,
): Promise<void> {
  logger.log(`[BYOK stub] Unmarked message ${messageId} (no-op)`);
}

/**
 * Registers free agent quota IPC handlers.
 * Returns unlimited quota status.
 */
export function registerFreeAgentQuotaHandlers() {
  createTypedHandler(
    freeAgentQuotaContracts.getFreeAgentQuotaStatus,
    async () => {
      return getFreeAgentQuotaStatus();
    },
  );

  logger.log("Free agent quota handlers registered (BYOK stub — unlimited)");
}
