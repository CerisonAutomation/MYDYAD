## Plan: Add Default Model Selector to Settings Page

### Context

Model selection is only available per-chat via the ModelPicker dropdown. The global default model (`settings.selectedModel`) exists in the schema but has no dedicated UI in Settings. We'll add one.

### Changes

**1. New file: `src/components/DefaultModelSelector.tsx`**

- Follows the `DefaultChatModeSelector` pattern (uses `SettingField` + `Select`)
- Uses `useLanguageModelsByProviders()` for catalog models grouped by provider
- Uses `useLanguageModelProviders()` for provider metadata/setup status
- Uses `useLocalModels()` / `useLMStudioModels()` for Ollama/LM Studio models
- On change: `updateSettings({ selectedModel: { name, provider } })`
- Default fallback: `{ provider: "auto", name: "auto" }`

**2. `src/lib/settingsSearchIndex.ts`**

- Add `defaultModel: "setting-default-model"` to `SETTING_IDS`
- Add search index entry (label: "Default Model", keywords: model, provider, AI, GPT, Claude)

**3. `src/pages/settings.tsx`**

- Import `DefaultModelSelector`
- Add as first child in `AISettings` section (before MaxChatTurnsSelector)

### Verification

- Build, lint, type-check all pass
- Settings > AI section shows the new Default Model selector
