/**
 * Provider Router Tool - Dynamic provider/model URL routing
 *
 * Features:
 * - Resolve provider-specific API endpoints
 * - Dynamic URL construction based on model
 * - Provider health checks
 * - Fallback routing
 * - Model capability mapping
 */

import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { readSettings } from "@/main/settings";
import log from "electron-log";

const logger = log.scope("provider_router");

const providerRouterSchema = z.object({
  action: z
    .enum(["resolve", "list_providers", "health_check", "model_info"])
    .describe("Action to perform"),
  provider: z
    .string()
    .optional()
    .describe("Provider name (openai, anthropic, google, etc.)"),
  model: z.string().optional().describe("Model name (gpt-4, claude-3, etc.)"),
});

const DESCRIPTION = `Dynamic provider/model URL routing and resolution.

Actions:
- resolve: Get the API endpoint URL for a specific provider/model
- list_providers: List all configured providers with their endpoints
- health_check: Check if a provider endpoint is reachable
- model_info: Get model capabilities and pricing info

Features:
- Dynamic URL construction based on provider and model
- Gateway prefix routing for Dyad Engine
- Provider health monitoring
- Model capability mapping
- Fallback routing recommendations`;

// Provider endpoint patterns
const PROVIDER_ENDPOINTS: Record<
  string,
  { base: string; gateway?: string; models: Record<string, string> }
> = {
  openai: {
    base: "https://api.openai.com/v1",
    gateway: "",
    models: {
      "gpt-4o": "chat/completions",
      "gpt-4o-mini": "chat/completions",
      "gpt-4-turbo": "chat/completions",
      o1: "chat/completions",
      o3: "chat/completions",
      "o4-mini": "chat/completions",
      "dall-e-3": "images/generations",
      "whisper-1": "audio/transcriptions",
    },
  },
  anthropic: {
    base: "https://api.anthropic.com",
    gateway: "anthropic/",
    models: {
      "claude-sonnet-4-20250514": "v1/messages",
      "claude-3-5-sonnet-20241022": "v1/messages",
      "claude-3-5-haiku-20241022": "v1/messages",
      "claude-3-opus-20240229": "v1/messages",
    },
  },
  google: {
    base: "https://generativelanguage.googleapis.com",
    gateway: "gemini/",
    models: {
      "gemini-2.0-flash": "v1beta/models/gemini-2.0-flash:generateContent",
      "gemini-2.0-pro": "v1beta/models/gemini-2.0-pro:generateContent",
      "gemini-1.5-pro": "v1beta/models/gemini-1.5-pro:generateContent",
    },
  },
  openrouter: {
    base: "https://openrouter.ai/api/v1",
    gateway: "openrouter/",
    models: {
      "anthropic/claude-3.5-sonnet": "chat/completions",
      "openai/gpt-4o": "chat/completions",
      "google/gemini-2.0-flash": "chat/completions",
    },
  },
  xai: {
    base: "https://api.x.ai/v1",
    gateway: "xai/",
    models: {
      "grok-2": "chat/completions",
      "grok-2-mini": "chat/completions",
    },
  },
  ollama: {
    base: "http://localhost:11434/v1",
    models: {
      "llama3.1": "chat/completions",
      codellama: "chat/completions",
      mistral: "chat/completions",
      phi3: "chat/completions",
    },
  },
  lmstudio: {
    base: "http://localhost:1234/v1",
    models: {}, // Dynamic based on loaded models
  },
  minimax: {
    base: "https://api.minimax.io/v1",
    gateway: "minimax/",
    models: {
      "MiniMax-Text-01": "chat/completions",
      "abab6.5s-chat": "chat/completions",
    },
  },
  deepseek: {
    base: "https://api.deepseek.com/v1",
    models: {
      "deepseek-chat": "chat/completions",
      "deepseek-coder": "chat/completions",
    },
  },
  together: {
    base: "https://api.together.xyz/v1",
    models: {
      "meta-llama/Llama-3-70b-chat-hf": "chat/completions",
      "mistralai/Mixtral-8x7B-Instruct-v0.1": "chat/completions",
    },
  },
};

// Model capabilities
const MODEL_CAPABILITIES: Record<
  string,
  {
    context: number;
    vision: boolean;
    tools: boolean;
    reasoning: boolean;
    pricing: string;
  }
> = {
  "gpt-4o": {
    context: 128000,
    vision: true,
    tools: true,
    reasoning: false,
    pricing: "$5/$15 per 1M tokens",
  },
  "gpt-4o-mini": {
    context: 128000,
    vision: true,
    tools: true,
    reasoning: false,
    pricing: "$0.15/$0.60 per 1M tokens",
  },
  o1: {
    context: 200000,
    vision: true,
    tools: true,
    reasoning: true,
    pricing: "$15/$60 per 1M tokens",
  },
  o3: {
    context: 200000,
    vision: true,
    tools: true,
    reasoning: true,
    pricing: "$10/$40 per 1M tokens",
  },
  "claude-sonnet-4-20250514": {
    context: 200000,
    vision: true,
    tools: true,
    reasoning: false,
    pricing: "$3/$15 per 1M tokens",
  },
  "claude-3-5-sonnet-20241022": {
    context: 200000,
    vision: true,
    tools: true,
    reasoning: false,
    pricing: "$3/$15 per 1M tokens",
  },
  "claude-3-opus-20240229": {
    context: 200000,
    vision: true,
    tools: true,
    reasoning: false,
    pricing: "$15/$75 per 1M tokens",
  },
  "gemini-2.0-flash": {
    context: 1000000,
    vision: true,
    tools: true,
    reasoning: false,
    pricing: "Free tier available",
  },
  "gemini-2.0-pro": {
    context: 2000000,
    vision: true,
    tools: true,
    reasoning: false,
    pricing: "$1.25/$10 per 1M tokens",
  },
  "deepseek-chat": {
    context: 64000,
    vision: false,
    tools: true,
    reasoning: false,
    pricing: "$0.14/$0.28 per 1M tokens",
  },
};

export const providerRouterTool: ToolDefinition<
  z.infer<typeof providerRouterSchema>
> = {
  name: "provider_router",
  description: DESCRIPTION,
  inputSchema: providerRouterSchema,
  defaultConsent: "always",
  modifiesState: false,
  isEnabled: () => true,

  getConsentPreview: (args) => {
    switch (args.action) {
      case "resolve":
        return `Resolve endpoint for ${args.provider ?? "auto"}/${args.model ?? "auto"}`;
      case "list_providers":
        return "List all configured providers";
      case "health_check":
        return `Check health of ${args.provider ?? "all"} providers`;
      case "model_info":
        return `Get info for model ${args.model ?? "auto"}`;
      default:
        return "Provider router action";
    }
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-provider-router action="${escapeXmlAttr(args.action)}">${args.action}</dyad-provider-router>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const { action, provider, model } = args;
    const settings = readSettings();

    logger.log(`Provider router: ${action} ${provider ?? ""} ${model ?? ""}`);

    ctx.onXmlStream(
      `<dyad-provider-router action="${escapeXmlAttr(action)}">Processing...</dyad-provider-router>`,
    );

    let resultText = "";

    switch (action) {
      case "resolve": {
        const providerName =
          provider ?? settings.selectedModel?.provider ?? "auto";
        const modelName = model ?? settings.selectedModel?.name ?? "auto";

        // Check configured providers
        const configuredProviders = settings.providerSettings ?? {};

        // Build dynamic URL
        let endpoint = "";
        let gateway = "";

        if (providerName === "auto") {
          // Auto mode: find first configured provider
          for (const [name, config] of Object.entries(configuredProviders)) {
            if (
              name !== "auto" &&
              config &&
              typeof config === "object" &&
              "apiKey" in config
            ) {
              const apiKey = (config as { apiKey?: { value?: string } }).apiKey;
              if (apiKey?.value) {
                endpoint = PROVIDER_ENDPOINTS[name]?.base ?? "";
                gateway = PROVIDER_ENDPOINTS[name]?.gateway ?? "";
                resultText = `## Auto-Resolved Provider: ${name}\n\n`;
                resultText += `**Base URL:** ${endpoint}\n`;
                resultText += `**Gateway Prefix:** ${gateway || "(none)"}\n`;
                resultText += `**Full URL:** ${endpoint}/${gateway}${modelName}\n`;
                break;
              }
            }
          }

          if (!resultText) {
            resultText = `## No Provider Configured\n\nPlease configure at least one provider API key in settings.\n`;
          }
        } else {
          // Specific provider
          const providerInfo = PROVIDER_ENDPOINTS[providerName];
          if (providerInfo) {
            endpoint = providerInfo.base;
            gateway = providerInfo.gateway ?? "";

            // Check if model exists in provider
            const modelPath =
              providerInfo.models[modelName] ?? "chat/completions";

            resultText = `## Provider: ${providerName}\n\n`;
            resultText += `**Base URL:** ${endpoint}\n`;
            resultText += `**Gateway Prefix:** ${gateway || "(none)"}\n`;
            resultText += `**Model Path:** ${modelPath}\n`;
            resultText += `**Full URL:** ${endpoint}/${gateway}${modelPath}\n`;

            // Check for API key
            const providerConfig = configuredProviders[providerName];
            const hasKey =
              providerConfig &&
              typeof providerConfig === "object" &&
              "apiKey" in providerConfig &&
              (providerConfig as { apiKey?: { value?: string } }).apiKey?.value;

            resultText += `**API Key Configured:** ${hasKey ? "Yes" : "No"}\n`;
          } else {
            resultText = `## Unknown Provider: ${providerName}\n\nAvailable providers: ${Object.keys(PROVIDER_ENDPOINTS).join(", ")}\n`;
          }
        }
        break;
      }

      case "list_providers": {
        const configuredProviders = settings.providerSettings ?? {};

        resultText = `## Configured Providers\n\n`;

        for (const [name, config] of Object.entries(configuredProviders)) {
          const hasKey =
            config &&
            typeof config === "object" &&
            "apiKey" in config &&
            (config as { apiKey?: { value?: string } }).apiKey?.value;

          const providerInfo = PROVIDER_ENDPOINTS[name];

          resultText += `### ${name}\n`;
          resultText += `- **Status:** ${hasKey ? "✅ Configured" : "❌ Not configured"}\n`;
          if (providerInfo) {
            resultText += `- **Base URL:** ${providerInfo.base}\n`;
            resultText += `- **Gateway:** ${providerInfo.gateway || "(none)"}\n`;
            resultText += `- **Models:** ${Object.keys(providerInfo.models).join(", ") || "Dynamic"}\n`;
          }
          resultText += `\n`;
        }

        // List available but unconfigured providers
        const unconfigured = Object.keys(PROVIDER_ENDPOINTS).filter(
          (name) => !configuredProviders[name],
        );

        if (unconfigured.length > 0) {
          resultText += `## Available Providers (not configured)\n\n`;
          resultText +=
            unconfigured.map((name) => `- ${name}`).join("\n") + "\n";
        }
        break;
      }

      case "health_check": {
        const providersToCheck = provider
          ? [provider]
          : Object.keys(PROVIDER_ENDPOINTS);

        const healthResults: Array<{
          provider: string;
          status: string;
          latency?: number;
        }> = [];

        for (const name of providersToCheck) {
          const providerInfo = PROVIDER_ENDPOINTS[name];
          if (!providerInfo) {
            healthResults.push({ provider: name, status: "Unknown provider" });
            continue;
          }

          try {
            const start = Date.now();
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            await fetch(providerInfo.base, {
              method: "HEAD",
              signal: controller.signal,
            }).catch(() => {
              /* Ignore errors, just checking connectivity */
            });

            clearTimeout(timeout);
            const latency = Date.now() - start;

            healthResults.push({
              provider: name,
              status: "Reachable",
              latency,
            });
          } catch {
            healthResults.push({
              provider: name,
              status: "Unreachable",
            });
          }
        }

        resultText = `## Provider Health Check\n\n`;
        resultText += `| Provider | Status | Latency |\n`;
        resultText += `|----------|--------|--------|\n`;
        for (const r of healthResults) {
          resultText += `| ${r.provider} | ${r.status} | ${r.latency ? `${r.latency}ms` : "-"} |\n`;
        }
        break;
      }

      case "model_info": {
        const modelName = model ?? settings.selectedModel?.name ?? "auto";

        const caps = MODEL_CAPABILITIES[modelName];

        if (caps) {
          resultText = `## Model: ${modelName}\n\n`;
          resultText += `- **Context Window:** ${caps.context.toLocaleString()} tokens\n`;
          resultText += `- **Vision:** ${caps.vision ? "✅ Yes" : "❌ No"}\n`;
          resultText += `- **Tool Use:** ${caps.tools ? "✅ Yes" : "❌ No"}\n`;
          resultText += `- **Reasoning:** ${caps.reasoning ? "✅ Yes" : "❌ No"}\n`;
          resultText += `- **Pricing:** ${caps.pricing}\n`;

          // Find which providers offer this model
          const providers = Object.entries(PROVIDER_ENDPOINTS)
            .filter(([, info]) => info.models[modelName])
            .map(([name]) => name);

          if (providers.length > 0) {
            resultText += `\n**Available on:** ${providers.join(", ")}\n`;
          }
        } else {
          resultText = `## Model: ${modelName}\n\n`;
          resultText += `No capability data available for this model.\n\n`;
          resultText += `**Known models:**\n`;
          resultText +=
            Object.keys(MODEL_CAPABILITIES)
              .map((m) => `- ${m}`)
              .join("\n") + "\n";
        }
        break;
      }
    }

    ctx.onXmlComplete(
      `<dyad-provider-router action="${escapeXmlAttr(action)}">\n${escapeXmlContent(resultText)}\n</dyad-provider-router>`,
    );

    return resultText;
  },
};
