import { useQuery } from "@tanstack/react-query";
import { ipc, type SubscriptionStatus } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

export const SUBSCRIPTION_STATUS_REFRESH_INTERVAL_MS = 60 * 60 * 1000;

export function useSubscriptionStatus() {
  return useQuery<SubscriptionStatus | null>({
    queryKey: queryKeys.instructions.subscriptionStatus,
    queryFn: () => ipc.instructions.getSubscriptionStatus(),
    staleTime: SUBSCRIPTION_STATUS_REFRESH_INTERVAL_MS,
    refetchInterval: SUBSCRIPTION_STATUS_REFRESH_INTERVAL_MS,
    refetchOnWindowFocus: "always",
    retry: false,
  });
}
