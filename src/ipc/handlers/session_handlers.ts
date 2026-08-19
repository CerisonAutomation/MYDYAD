import fs from "node:fs/promises";
import { getTypeScriptCachePath } from "@/paths/paths";
import { session } from "electron";
import { systemContracts } from "../types/system";
import { createTypedHandler } from "./base";

export const registerSessionHandlers = () => {
  createTypedHandler(systemContracts.clearSessionData, async () => {
    const defaultAppSession = session.defaultSession;

    await defaultAppSession.clearStorageData({
      storages: ["cookies", "localstorage"],
    });
    console.info(`[IPC] All session data cleared for default session`);

    // Clear custom cache data (like tsbuildinfo)
    try {
      await fs.rm(getTypeScriptCachePath(), { recursive: true, force: true });
    } catch {
      // Directory might not exist
    }
  });
};
