import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ipc,
  type CreateCustomLanguageModelProviderParams,
  type LanguageModelProvider,
} from "@/ipc/types";
import { showError } from "@/lib/toast";
import { queryKeys } from "@/lib/queryKeys";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

function validateProviderParams(
  params: CreateCustomLanguageModelProviderParams,
): void {
  if (!params.id.trim()) {
    throw new DyadError("Provider ID is required", DyadErrorKind.Validation);
  }
  if (!params.name.trim()) {
    throw new DyadError(
      "Provider name is required",
      DyadErrorKind.Validation,
    );
  }
  if (!params.apiBaseUrl.trim()) {
    throw new DyadError(
      "API base URL is required",
      DyadErrorKind.Validation,
    );
  }
}

function normalizeProviderParams(
  params: CreateCustomLanguageModelProviderParams,
) {
  return {
    id: params.id.trim(),
    name: params.name.trim(),
    apiBaseUrl: params.apiBaseUrl.trim(),
    envVarName: params.envVarName?.trim() || undefined,
  };
}

export function useCustomLanguageModelProvider() {
  const queryClient = useQueryClient();

  const sharedMutationOptions = {
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.languageModels.providers,
      });
    },
    onError: (error: unknown) => {
      showError(error);
    },
  };

  const createProviderMutation = useMutation({
    mutationFn: async (
      params: CreateCustomLanguageModelProviderParams,
    ): Promise<LanguageModelProvider> => {
      validateProviderParams(params);
      return ipc.languageModel.createCustomProvider(
        normalizeProviderParams(params),
      );
    },
    ...sharedMutationOptions,
  });

  const editProviderMutation = useMutation({
    mutationFn: async (
      params: CreateCustomLanguageModelProviderParams,
    ): Promise<LanguageModelProvider> => {
      validateProviderParams(params);
      return ipc.languageModel.editCustomProvider(
        normalizeProviderParams(params),
      );
    },
    ...sharedMutationOptions,
  });

  const deleteProviderMutation = useMutation({
    mutationFn: async (providerId: string): Promise<void> => {
      if (!providerId) {
        throw new DyadError(
          "Provider ID is required",
          DyadErrorKind.Validation,
        );
      }
      return ipc.languageModel.deleteCustomProvider({ providerId });
    },
    ...sharedMutationOptions,
  });

  return {
    createProvider: (params: CreateCustomLanguageModelProviderParams) =>
      createProviderMutation.mutateAsync(params),
    editProvider: (params: CreateCustomLanguageModelProviderParams) =>
      editProviderMutation.mutateAsync(params),
    deleteProvider: (providerId: string) =>
      deleteProviderMutation.mutateAsync(providerId),
    isCreating: createProviderMutation.isPending,
    isEditing: editProviderMutation.isPending,
    isDeleting: deleteProviderMutation.isPending,
    error:
      createProviderMutation.error ||
      editProviderMutation.error ||
      deleteProviderMutation.error,
  };
}
