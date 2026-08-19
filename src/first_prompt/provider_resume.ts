import { type FreeAgentQuotaStatus, ipc } from "@/ipc/types";
import { getHomeDefaultChatMode } from "@/lib/homeChatMode";
import { queryKeys } from "@/lib/queryKeys";
import { type ChatMode, type UserSettings, hasDyadProKey } from "@/lib/schemas";
import type { QueryClient } from "@tanstack/react-query";

export async function resolveFirstPromptDefaultChatMode({
  settings,
  envVars,
  quotaStatus,
  queryClient,
}: {
  settings: UserSettings;
  envVars: Record<string, string | undefined>;
  quotaStatus?: FreeAgentQuotaStatus;
  queryClient: QueryClient;
}): Promise<ChatMode> {
  let resolvedQuotaStatus = quotaStatus;
  if (!hasDyadProKey(settings) && !resolvedQuotaStatus) {
    try {
      resolvedQuotaStatus = await queryClient.fetchQuery({
        queryKey: queryKeys.freeAgentQuota.status,
        queryFn: () => ipc.freeAgentQuota.getFreeAgentQuotaStatus(),
      });
    } catch {
      // Preserve the safe Build-mode fallback when quota cannot be resolved.
    }
  }

  return getHomeDefaultChatMode(
    settings,
    envVars,
    resolvedQuotaStatus ? !resolvedQuotaStatus.isQuotaExceeded : undefined,
  );
}
