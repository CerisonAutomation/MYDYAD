import { ipcMain } from "electron";

export function registerFreeModelQuotaHandlers() {
  ipcMain.handle("free-model-quota:get-status", async () => {
    return {
      messagesUsed: 0,
      messagesLimit: 999999,
      messagesRemaining: 999999,
      isQuotaExceeded: false,
      resetTime: null,
    };
  });
}
