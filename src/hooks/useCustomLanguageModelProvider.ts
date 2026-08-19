import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  type CreateCustomLanguageModelProviderParams,
  type LanguageModelProvider,
  ipc,
} from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { showError } from "@/lib/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";

/**
 * Validates that the required fields of a custom language model provider
 * are present and non-empty. Throws a DyadError for any missing field.
 *
 * @param params - The provider parameters to validate.
 */
function validateCustomProviderParams(
  params: CreateCustomLanguageModelProviderParams,
): void {
  if (!params.id.trim()) {
    throw new DyadError("Provider ID is required", DyadErrorKind.Validation);
  }
  if (!params.name.trim()) {
    throw new DyadError("Provider name is required", DyadErrorKind.Validation);
  }
  if (!params.apiBaseUrl.trim()) {
    throw new DyadError("API base URL is required", DyadErrorKind.Validation);
  }
}

/**
 * Returns trimmed provider parameters suitable for IPC calls.
 *
 * @param params - The raw provider parameters.
 * @returns Trimmed parameters with optional envVarName cleaned up.
 */
function trimProviderParams(params: CreateCustomLanguageModelProviderParams) {
  return {
    id: params.id.trim(),
    name: params.name.trim(),
    apiBaseUrl: params.apiBaseUrl.trim(),
    envVarName: params.envVarName?.trim() || undefined,
  };
}

/**
 * Validates that a provider ID string is non-empty.
 *
 * @param providerId - The provider ID to validate.
 * @throws DyadError if the provider ID is empty or falsy.
 */
function validateProviderId(providerId: string): void {
  if (!providerId) {
    throw new DyadError("Provider ID is required", DyadErrorKind.Validation);
  }
}

/**
 * Returns the first non-null error from a list of mutation errors.
 *
 * @param errors - The mutation errors to combine.
 * @returns The first non-null error, or null if all are null.
 */
function combineErrors(...errors: unknown[]): Error | null {
  for (const error of errors) {
    if (error != null) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }
  return null;
}

export function useCustomLanguageModelProvider() {
  const queryClient = useQueryClient();

  const invalidateProvidersQuery = () => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.languageModels.providers,
    });
  };

  const handleMutationError = (error: unknown) => {
    showError(error);
  };

  const createProviderMutation = useMutation({
    mutationFn: async (
      params: CreateCustomLanguageModelProviderParams,
    ): Promise<LanguageModelProvider> => {
      validateCustomProviderParams(params);
      return ipc.languageModel.createCustomProvider(trimProviderParams(params));
    },
    onSuccess: invalidateProvidersQuery,
    onError: handleMutationError,
  });

  const editProviderMutation = useMutation({
    mutationFn: async (
      params: CreateCustomLanguageModelProviderParams,
    ): Promise<LanguageModelProvider> => {
      validateCustomProviderParams(params);
      return ipc.languageModel.editCustomProvider(trimProviderParams(params));
    },
    onSuccess: invalidateProvidersQuery,
    onError: handleMutationError,
  });

  const deleteProviderMutation = useMutation({
    mutationFn: async (providerId: string): Promise<void> => {
      validateProviderId(providerId);
      return ipc.languageModel.deleteCustomProvider({ providerId });
    },
    onSuccess: invalidateProvidersQuery,
    onError: handleMutationError,
  });

  return {
    createProvider: createProviderMutation.mutateAsync,
    editProvider: editProviderMutation.mutateAsync,
    deleteProvider: deleteProviderMutation.mutateAsync,
    isCreating: createProviderMutation.isPending,
    isEditing: editProviderMutation.isPending,
    isDeleting: deleteProviderMutation.isPending,
    error: combineErrors(
      createProviderMutation.error,
      editProviderMutation.error,
      deleteProviderMutation.error,
    ),
  };
}
