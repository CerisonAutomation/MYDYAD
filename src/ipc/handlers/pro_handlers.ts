import { ipcMain } from "electron";
import { z } from "zod";

export const UserInfoResponseSchema = z.object({
  userId: z.string().optional(),
  email: z.string().optional(),
  plan: z.string().optional(),
  status: z.string().optional(),
});

export type UserInfoResponse = z.infer<typeof UserInfoResponseSchema>;

export function parseBillingActionUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function registerProHandlers() {
  ipcMain.handle("get_subscription_status", async () => null);
  ipcMain.handle("open_billing_action", async () => {});
  ipcMain.handle("get_dyad_pro_status", async () => ({
    enabled: true,
    plan: "pro",
  }));
  ipcMain.handle("get_user_info", async () => ({
    userId: "local",
    email: "local@dyad.local",
    plan: "pro",
    status: "active",
  }));
  // Stub budget handler for local mode
  ipcMain.handle("get-user-budget", async () => ({
    budget: 999999,
    used: 0,
    remaining: 999999,
    plan: "unlimited",
  }));
}
