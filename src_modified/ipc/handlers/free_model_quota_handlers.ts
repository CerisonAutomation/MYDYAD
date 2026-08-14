/**
 * Free model quota handlers — stubbed for BYOK build.
 * Always returns unlimited quota. No Dyad hosted engine calls.
 */
import log from "electron-log";
import { createTypedHandler } from "./base";
import { freeModelQuotaContracts } from "../types/free_model_quota";

const logger = log.scope("free_model_quota_handlers");

export function registerFreeModelQuotaHandlers() {
  createTypedHandler(
    freeModelQuotaContracts.getFreeModelQuotaStatus,
    async () => getFreeModelQuotaStatus(),
  );
  logger.log("Free model quota handlers registered (BYOK stub — unlimited)");
}

export async function getFreeModelQuotaStatus() {
  return {
    messagesUsed: 0,
    messagesLimit: 999999,
    messagesRemaining: 999999,
    isQuotaExceeded: false,
    resetTime: null,
  };
}
