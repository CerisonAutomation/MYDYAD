/**
 * ModelSearchDialog — Premium Fuse.js-powered searchable model picker
 *
 * Only shows models from providers where an API key is configured.
 * Beautiful UI with smooth animations and provider status indicators.
 */

import { PriceBadge } from "@/components/PriceBadge";
import { ProviderIcon } from "@/components/ProviderIcon";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { LanguageModel, LocalModel } from "@/ipc/types";
import {
  type SearchableModel,
  buildModelSearchIndex,
  createModelFuse,
  searchModels,
} from "@/lib/model_search";
import { cn } from "@/lib/utils";
import {
  CheckIcon,
  KeyRoundIcon,
  SearchIcon,
  Settings2Icon,
  SparklesIcon,
  XIcon,
  ZapIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

interface ModelSearchDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (model: {
    name: string;
    provider: string;
    customModelId?: number;
    effortLevel?: string;
  }) => void;
  selectedModel: { name: string; provider: string; customModelId?: number };
  modelsByProviders: Record<string, LanguageModel[]> | undefined;
  providers:
    | Array<{ id: string; name: string; type: string; secondary?: boolean }>
    | undefined;
  ollamaModels: LocalModel[];
  lmStudioModels: LocalModel[];
  agent2Enabled: boolean;
  isProviderSetup: (providerId: string) => boolean;
  currentEffortLevel?: string;
  onOpenSettings?: () => void;
}

export function ModelSearchDialog({
  open,
  onOpenChange,
  onSelect,
  selectedModel,
  modelsByProviders,
  providers,
  ollamaModels,
  lmStudioModels,
  agent2Enabled,
  isProviderSetup,
  currentEffortLevel: _currentEffortLevel,
  onOpenSettings,
}: ModelSearchDialogProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showProviders, setShowProviders] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Get configured providers (where API key is set)
  const configuredProviders = useMemo(() => {
    if (!providers) return [];
    return providers.filter((p) => isProviderSetup(p.id) || p.type === "local");
  }, [providers, isProviderSetup]);

  // Check if any providers are configured
  const hasConfiguredProviders = configuredProviders.length > 0;
  const hasLocalModels = ollamaModels.length > 0 || lmStudioModels.length > 0;

  // Build search index (only for configured providers)
  const allModels = useMemo(
    () =>
      buildModelSearchIndex({
        modelsByProviders,
        providers,
        ollamaModels,
        lmStudioModels,
        agent2Enabled,
        isProviderSetup,
        // Only include configured providers
        configuredProviderIds: configuredProviders.map((p) => p.id),
      }),
    [
      modelsByProviders,
      providers,
      ollamaModels,
      lmStudioModels,
      agent2Enabled,
      isProviderSetup,
      configuredProviders,
    ],
  );

  const fuse = useMemo(() => createModelFuse(allModels), [allModels]);

  // Search results
  const results = useMemo(
    () => searchModels(fuse, query, allModels),
    [fuse, query, allModels],
  );

  // Reset on open
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelectedIndex(0);
      setShowProviders(false);
      // Focus input after dialog opens
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((i) => Math.max(i - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (results[selectedIndex]) {
            handleSelect(results[selectedIndex]);
          }
          break;
        case "Escape":
          onOpenChange(false);
          break;
      }
    },
    [results, selectedIndex, onOpenChange],
  );

  // Scroll selected item into view
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const item = list.children[selectedIndex] as HTMLElement;
    if (item) {
      item.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  const handleSelect = useCallback(
    (model: SearchableModel) => {
      onSelect({
        name: model.apiName,
        provider: model.providerId,
        customModelId: model.customModelId,
      });
      onOpenChange(false);
    },
    [onSelect, onOpenChange],
  );

  const getProviderColor = (providerType: string) => {
    switch (providerType) {
      case "local":
        return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/20";
      case "custom":
        return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/20";
      default:
        return "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/20";
    }
  };

  // Empty state when no providers configured
  if (!hasConfiguredProviders && !hasLocalModels) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
          {/* Gradient header */}
          <div className="relative h-32 bg-gradient-to-br from-violet-500/10 via-blue-500/10 to-emerald-500/10 flex items-center justify-center">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(120,119,198,0.15),transparent_80%)]" />
            <div className="relative flex flex-col items-center gap-3">
              <div className="relative">
                <div className="absolute -inset-2 bg-gradient-to-r from-violet-500/20 to-blue-500/20 rounded-full blur-lg" />
                <div className="relative p-3 rounded-full bg-white/80 dark:bg-zinc-900/80 backdrop-blur-sm border border-white/20 dark:border-zinc-700/50 shadow-lg">
                  <KeyRoundIcon className="size-6 text-violet-600 dark:text-violet-400" />
                </div>
              </div>
              <div className="text-center">
                <h3 className="text-lg font-semibold">
                  No Providers Configured
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Add an API key to start using models
                </p>
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border border-border/50">
                <div className="p-1.5 rounded-md bg-blue-500/10">
                  <ZapIcon className="size-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-xs font-medium">Cloud Models</p>
                  <p className="text-[10px] text-muted-foreground">
                    OpenAI, Anthropic, etc.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border border-border/50">
                <div className="p-1.5 rounded-md bg-emerald-500/10">
                  <SparklesIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
                </div>
                <div>
                  <p className="text-xs font-medium">Local Models</p>
                  <p className="text-[10px] text-muted-foreground">
                    Ollama, LM Studio
                  </p>
                </div>
              </div>
            </div>

            <Button
              onClick={() => {
                onOpenChange(false);
                onOpenSettings?.();
              }}
              className="w-full"
              size="lg"
            >
              <Settings2Icon className="size-4 mr-2" />
              Configure Providers
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="flex items-center gap-2">
            <SearchIcon className="size-4 text-muted-foreground" />
            Select Model
            <Badge variant="secondary" className="ml-auto text-xs">
              {results.length} available
            </Badge>
          </DialogTitle>
        </DialogHeader>

        {/* Search input */}
        <div className="px-4 pb-2">
          <div className="relative">
            <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
            <Input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Search models, providers, or tags..."
              className="pl-9 pr-8"
              autoFocus
            />
            {query && (
              <button
                onClick={() => {
                  setQuery("");
                  inputRef.current?.focus();
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <XIcon className="size-4" />
              </button>
            )}
          </div>

          {/* Provider filter chips */}
          <div className="flex items-center gap-2 mt-2 overflow-x-auto pb-1 scrollbar-hide">
            <button
              onClick={() => setShowProviders(!showProviders)}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all",
                showProviders
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80",
              )}
            >
              <Settings2Icon className="size-3" />
              {configuredProviders.length} providers
            </button>
            {configuredProviders.slice(0, 3).map((provider) => (
              <div
                key={provider.id}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs bg-muted/50 text-muted-foreground"
              >
                <ProviderIcon providerId={provider.id} className="size-3" />
                {provider.name}
                <CheckIcon className="size-3 text-emerald-500" />
              </div>
            ))}
            {configuredProviders.length > 3 && (
              <div className="text-xs text-muted-foreground">
                +{configuredProviders.length - 3} more
              </div>
            )}
          </div>
        </div>

        {/* Keyboard hints */}
        <div className="px-4 pb-2 flex items-center gap-2 text-[10px] text-muted-foreground/70">
          <span>↑↓ navigate</span>
          <span>·</span>
          <span>↵ select</span>
          <span>·</span>
          <span>esc close</span>
        </div>

        {/* Results list */}
        <div
          ref={listRef}
          className="max-h-[400px] overflow-y-auto px-2 pb-2 scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent"
          role="listbox"
        >
          {results.length === 0 ? (
            <div className="text-center py-12">
              <div className="relative inline-flex">
                <div className="absolute -inset-4 bg-gradient-to-r from-violet-500/10 to-blue-500/10 rounded-full blur-lg" />
                <div className="relative p-4 rounded-full bg-muted/50">
                  <SearchIcon className="size-8 text-muted-foreground/50" />
                </div>
              </div>
              <p className="text-sm font-medium mt-4">No models found</p>
              <p className="text-xs text-muted-foreground mt-1">
                Try a different search term or configure more providers
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {results.map((model, index) => {
                const isSelected =
                  selectedModel.provider === model.providerId &&
                  selectedModel.name === model.apiName;
                const isCurrentIndex = index === selectedIndex;

                return (
                  <button
                    key={model.key}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(model)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    className={cn(
                      "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all duration-150",
                      isCurrentIndex && "bg-muted/80 shadow-sm",
                      isSelected && "bg-primary/8 ring-1 ring-primary/20",
                      "hover:bg-muted/60",
                    )}
                  >
                    {/* Provider icon */}
                    <div className="relative">
                      <ProviderIcon
                        providerId={model.providerId}
                        apiName={model.apiName}
                        className="size-5 shrink-0"
                      />
                      {isCurrentIndex && (
                        <div className="absolute -bottom-0.5 -right-0.5 size-2 rounded-full bg-primary animate-pulse" />
                      )}
                    </div>

                    {/* Model info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">
                          {model.displayName}
                        </span>
                        {model.tag && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0 h-4"
                          >
                            {model.tag}
                          </Badge>
                        )}
                        {model.isFree && (
                          <Badge
                            variant="secondary"
                            className="text-[10px] px-1.5 py-0 h-4 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/20"
                          >
                            Free
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted-foreground truncate">
                          {model.providerName}
                        </span>
                        {model.apiName !== model.displayName && (
                          <>
                            <span className="text-xs text-muted-foreground/50">
                              ·
                            </span>
                            <span className="text-xs text-muted-foreground/70 font-mono truncate max-w-[200px]">
                              {model.apiName}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Price */}
                    {model.dollarSigns != null && (
                      <PriceBadge dollarSigns={model.dollarSigns} />
                    )}

                    {/* Provider type badge */}
                    <Badge
                      variant="secondary"
                      className={cn(
                        "text-[10px] px-1.5 py-0 h-4 shrink-0 border",
                        getProviderColor(model.providerType),
                      )}
                    >
                      {model.providerType === "local"
                        ? "Local"
                        : model.providerType === "custom"
                          ? "Custom"
                          : "Cloud"}
                    </Badge>

                    {/* Selected indicator */}
                    {isSelected && (
                      <div className="size-5 rounded-full bg-primary flex items-center justify-center shrink-0">
                        <CheckIcon className="size-3 text-primary-foreground" />
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer with provider count */}
        <div className="px-4 py-2 border-t bg-muted/30">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {configuredProviders.length} provider
              {configuredProviders.length !== 1 ? "s" : ""} configured
            </span>
            <button
              onClick={() => {
                onOpenChange(false);
                onOpenSettings?.();
              }}
              className="flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <Settings2Icon className="size-3" />
              Add provider
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
