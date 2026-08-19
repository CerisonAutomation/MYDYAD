import { getFreeProCompatibleChatMode } from "./freeProModel";
import {
  type ChatMode,
  type UserSettings,
  getEffectiveDefaultChatMode,
} from "./schemas";

export function getHomeDefaultChatMode(
  settings: UserSettings,
  envVars: Record<string, string | undefined>,
  freeAgentQuotaAvailable?: boolean,
): ChatMode {
  const effectiveDefault = getEffectiveDefaultChatMode(
    settings,
    envVars,
    freeAgentQuotaAvailable,
  );
  return getFreeProCompatibleChatMode(settings.selectedModel, effectiveDefault);
}
