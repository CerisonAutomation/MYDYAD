import { type LanguageModelProvider, ipc } from "@/ipc/types";
import { isProviderSetup as isProviderSetupUtil } from "@/lib/providerUtils";
import { queryKeys } from "@/lib/queryKeys";
import { cloudProviders } from "@/lib/schemas";
import { useQuery } from "@tanstack/react-query";
import { useSettings } from "./useSettings";

const localProviders = new Set(["ollama", "lmstudio"]);

export function useLanguageModelProviders() {
  const { settings, envVars } = useSettings();

  const queryResult = useQuery<LanguageModelProvider[], Error>({
    queryKey: queryKeys.languageModels.providers,
    queryFn: async () => {
      return ipc.languageModel.getProviders();
    },
  });

  const isProviderSetup = (provider: string) => {
    return isProviderSetupUtil(provider, {
      settings,
      envVars,
      providerData: queryResult.data,
      isLoading: queryResult.isLoading,
    });
  };

  const isAnyProviderSetup = () => {
    if (
      settings?.selectedModel.provider &&
      localProviders.has(settings.selectedModel.provider) &&
      settings.selectedModel.name.trim()
    ) {
      return true;
    }

    // Check hardcoded cloud providers
    if (cloudProviders.some((provider) => isProviderSetup(provider))) {
      return true;
    }

    // Check custom providers
    const customProviders = queryResult.data?.filter(
      (provider) => provider.type === "custom",
    );
    return (
      customProviders?.some((provider) => isProviderSetup(provider.id)) ?? false
    );
  };

  return {
    ...queryResult,
    isProviderSetup,
    isAnyProviderSetup,
  };
}
