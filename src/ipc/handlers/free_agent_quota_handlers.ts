import { freeAgentQuotaContracts } from "../types/free_agent_quota";
import { registerTrustedIpcHandler } from "./trusted_handle";

export const QUOTA_WINDOW_MS = 23 * 60 * 60 * 1000;

export function registerFreeAgentQuotaHandlers() {
  registerTrustedIpcHandler(
    freeAgentQuotaContracts.getFreeAgentQuotaStatus.channel,
    async () => {
      return getFreeAgentQuotaStatus();
    },
  );
}

export async function markMessageAsUsingFreeAgentQuota() {
  // No-op - quota disabled
}

export async function unmarkMessageAsUsingFreeAgentQuota() {
  // No-op - quota disabled
}

export async function getFreeAgentQuotaStatus() {
  // Unlimited quota - always return fresh status
  return {
    messagesUsed: 0,
    messagesLimit: 999999999,
    isQuotaExceeded: false,
    windowStartTime: null,
    resetTime: null,
    hoursUntilReset: null,
  };
}
