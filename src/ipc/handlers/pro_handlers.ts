import { z } from "zod";
import { registerTrustedIpcHandler } from "./trusted_handle";

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
  registerTrustedIpcHandler("get_subscription_status", async () => null);
  registerTrustedIpcHandler("open_billing_action", async () => {});
  registerTrustedIpcHandler("get_dyad_pro_status", async () => ({
    enabled: true,
    plan: "pro",
  }));
  registerTrustedIpcHandler("get_user_info", async () => ({
    userId: "local",
    email: "local@dyad.local",
    plan: "pro",
    status: "active",
  }));
  // Stub budget handler for local mode
  registerTrustedIpcHandler("get-user-budget", async () => ({
    budget: 999999,
    used: 0,
    remaining: 999999,
    plan: "unlimited",
  }));
}
