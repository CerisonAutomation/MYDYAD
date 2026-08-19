/**
 * ModelSearch — Fuse.js-powered intelligent model/provider search
 *
 * Provides fuzzy search across all models, providers, and tags.
 * Only includes models from providers where an API key is configured.
 */

import type { LanguageModel, LocalModel } from "@/ipc/types";
import Fuse from "fuse.js";

export interface SearchableModel {
  /** Unique key */
  key: string;
  /** Display name */
  displayName: string;
  /** API name (what gets sent to the provider) */
  apiName: string;
  /** Provider ID */
  providerId: string;
  /** Provider display name */
  providerName: string;
  /** Provider type */
  providerType: "cloud" | "custom" | "local";
  /** Model description */
  description?: string;
  /** Tag (e.g., "Fast", "Reasoning") */
  tag?: string;
  /** Price tier */
  dollarSigns?: number;
  /** Context window size */
  contextWindow?: number;
  /** Max output tokens */
  maxOutputTokens?: number;
  /** Effort levels available */
  effortLevels?: string[];
  /** Is this a free model? */
  isFree?: boolean;
  /** Custom model ID */
  customModelId?: number;
}

/**
 * Build a flat searchable index from all model sources.
 * Only includes models from configured providers (where API key is set).
 */
export function buildModelSearchIndex(input: {
  modelsByProviders: Record<string, LanguageModel[]> | undefined;
  providers:
    | Array<{ id: string; name: string; type: string; secondary?: boolean }>
    | undefined;
  ollamaModels: LocalModel[];
  lmStudioModels: LocalModel[];
  agent2Enabled: boolean;
  isProviderSetup: (providerId: string) => boolean;
  /** If provided, only include models from these provider IDs */
  configuredProviderIds?: string[];
}): SearchableModel[] {
  const {
    modelsByProviders,
    providers,
    ollamaModels,
    lmStudioModels,
    configuredProviderIds,
  } = input;

  const models: SearchableModel[] = [];

  // Create a set of configured provider IDs for O(1) lookup
  const configuredSet = configuredProviderIds
    ? new Set(configuredProviderIds)
    : null;

  // Add cloud models (only from configured providers)
  if (modelsByProviders) {
    for (const [providerId, providerModels] of Object.entries(
      modelsByProviders,
    )) {
      if (providerId === "auto") continue;

      // If configuredProviderIds is provided, skip unconfigured providers
      if (configuredSet && !configuredSet.has(providerId)) continue;

      const provider = providers?.find((p) => p.id === providerId);
      const providerName = provider?.name ?? providerId;
      const providerType = (provider?.type as "custom" | "local") ?? "custom";

      for (const model of providerModels) {
        models.push({
          key: `${providerId}::${model.apiName}`,
          displayName: model.displayName,
          apiName: model.apiName,
          providerId,
          providerName,
          providerType,
          description: model.description,
          tag: model.tag,
          dollarSigns: model.dollarSigns,
          contextWindow: model.contextWindow,
          maxOutputTokens: model.maxOutputTokens,
          effortLevels: model.effortSettings?.possibleEffortLevels,
          isFree: model.dollarSigns === 0,
          customModelId: model.type === "custom" ? Number(model.id) : undefined,
        });
      }
    }
  }

  // Add Ollama models (always available)
  for (const model of ollamaModels) {
    models.push({
      key: `ollama::${model.modelName}`,
      displayName: model.displayName,
      apiName: model.modelName,
      providerId: "ollama",
      providerName: "Ollama",
      providerType: "local",
      description: `Local Ollama model`,
      isFree: true,
    });
  }

  // Add LM Studio models (always available)
  for (const model of lmStudioModels) {
    models.push({
      key: `lmstudio::${model.modelName}`,
      displayName: model.displayName,
      apiName: model.modelName,
      providerId: "lmstudio",
      providerName: "LM Studio",
      providerType: "local",
      description: `Local LM Studio model`,
      isFree: true,
    });
  }

  return models;
}

/**
 * Create a Fuse.js instance for fuzzy search
 */
export function createModelFuse(
  models: SearchableModel[],
): Fuse<SearchableModel> {
  return new Fuse(models, {
    keys: [
      { name: "displayName", weight: 0.4 },
      { name: "apiName", weight: 0.3 },
      { name: "providerName", weight: 0.15 },
      { name: "tag", weight: 0.1 },
      { name: "description", weight: 0.05 },
    ],
    threshold: 0.4,
    includeScore: true,
    minMatchCharLength: 1,
    shouldSort: true,
  });
}

/**
 * Search models with fuzzy matching.
 * When query is empty, returns all models in original order.
 */
export function searchModels(
  fuse: Fuse<SearchableModel>,
  query: string,
  allModels: SearchableModel[],
): SearchableModel[] {
  if (!query.trim()) {
    return allModels;
  }
  return fuse.search(query).map((result) => result.item);
}
