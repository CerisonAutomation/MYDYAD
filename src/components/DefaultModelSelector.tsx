import { useSettings } from "@/hooks/useSettings";
import { useLanguageModelsByProviders } from "@/hooks/useLanguageModelsByProviders";
import { useLanguageModelProviders } from "@/hooks/useLanguageModelProviders";
import { SettingField } from "@/components/settings/SettingField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@/components/ui/skeleton";

export function DefaultModelSelector() {
  const { settings, updateSettings } = useSettings();
  const { data: modelsByProviders, isLoading: modelsLoading } =
    useLanguageModelsByProviders();
  const { data: providers, isLoading: providersLoading } =
    useLanguageModelProviders();
  const { t } = useTranslation("settings");

  if (!settings) return null;

  const isLoading = modelsLoading || providersLoading;
  const selectedModel = settings.selectedModel;
  const currentValue = `${selectedModel.provider}::${selectedModel.name}`;

  const handleModelChange = (value: string | null) => {
    if (!value) return;
    const parts = value.split("::");
    const provider = parts[0];
    const name = parts.slice(1).join("::");
    updateSettings({ selectedModel: { provider, name } });
  };

  if (isLoading) {
    return (
      <SettingField
        htmlFor="default-model"
        label={t("ai.defaultModel")}
        description={t("ai.defaultModelDescription")}
      >
        <Skeleton className="h-10 w-full sm:w-[240px]" />
      </SettingField>
    );
  }

  // Build flat list of all models
  const allModels: { value: string; label: string; provider: string }[] = [];

  // Add Auto option
  allModels.push({
    value: "auto::auto",
    label: "Auto — Let Dyad choose",
    provider: "auto",
  });

  // Add models from all providers
  providers
    ?.filter((p) => p.type !== "local")
    .forEach((provider) => {
      const models = modelsByProviders?.[provider.id];
      if (!models) return;
      models.forEach((model) => {
        allModels.push({
          value: `${provider.id}::${model.apiName}`,
          label: `${model.displayName} (${provider.name})`,
          provider: provider.id,
        });
      });
    });

  // If no models available, just show Auto
  if (allModels.length <= 1) {
    return (
      <SettingField
        htmlFor="default-model"
        label={t("ai.defaultModel")}
        description={t("ai.defaultModelDescription")}
      >
        <p className="text-sm text-muted-foreground">
          No models available. Add an API key in{" "}
          <strong>Model Providers</strong> to see models here.
        </p>
      </SettingField>
    );
  }

  return (
    <SettingField
      htmlFor="default-model"
      label={t("ai.defaultModel")}
      description={t("ai.defaultModelDescription")}
    >
      <Select value={currentValue} onValueChange={handleModelChange}>
        <SelectTrigger className="w-full sm:w-[240px]" id="default-model">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allModels.map((m) => (
            <SelectItem key={m.value} value={m.value}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingField>
  );
}
