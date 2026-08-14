#!/usr/bin/env node
/**
 * sync-models.mjs — Automatically sync models from providers
 *
 * Fetches models from OpenRouter, Ollama, and other providers,
 * then updates the language_model_constants.ts file.
 *
 * Usage:
 *   node scripts/sync-models.mjs                    # Sync all providers
 *   node scripts/sync-models.mjs --openrouter        # Sync OpenRouter only
 *   node scripts/sync-models.mjs --ollama            # Sync Ollama only
 *   node scripts/sync-models.mjs --free-only         # Only free models
 *   node scripts/sync-models.mjs --dry-run           # Preview changes
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "..");
const CONSTANTS_FILE = path.join(
  PROJECT_ROOT,
  "src/ipc/shared/language_model_constants.ts",
);

// ── Colors ───────────────────────────────────────────────────────────────────
const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[1;33m";
const BLUE = "\x1b[0;34m";
const CYAN = "\x1b[0;36m";
const NC = "\x1b[0m";

const info = (msg) => console.log(`${BLUE}ℹ${NC} ${msg}`);
const success = (msg) => console.log(`${GREEN}✓${NC} ${msg}`);
const warn = (msg) => console.log(`${YELLOW}⚠${NC} ${msg}`);
const error = (msg) => console.log(`${RED}✗${NC} ${msg}`);

// ── Parse Arguments ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const syncOpenRouter =
  args.includes("--openrouter") || !args.includes("--ollama");
const syncOllama = args.includes("--ollama") || !args.includes("--openrouter");
const freeOnly = args.includes("--free-only");
const dryRun = args.includes("--dry-run");

// ── OpenRouter API ───────────────────────────────────────────────────────────

/**
 * Fetch models from OpenRouter API
 */
async function fetchOpenRouterModels(freeOnly = false) {
  info("Fetching models from OpenRouter...");

  try {
    const url = "https://openrouter.ai/api/v1/models";
    const response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const models = data.data || [];

    info(`Found ${models.length} models on OpenRouter`);

    // Filter for free models if requested
    const filteredModels = freeOnly
      ? models.filter((m) => {
          const promptPrice = parseFloat(m.pricing?.prompt || "1");
          const completionPrice = parseFloat(m.pricing?.completion || "1");
          return promptPrice === 0 && completionPrice === 0;
        })
      : models;

    info(
      `Filtered to ${filteredModels.length} models${freeOnly ? " (free only)" : ""}`,
    );

    return filteredModels.map((m) => ({
      id: m.id,
      name: m.id.split("/").pop() || m.id,
      displayName: m.name || m.id,
      description: m.description || `${m.id} via OpenRouter`,
      contextLength: m.context_length || 128000,
      maxOutputTokens: m.top_provider?.max_completion_tokens || 32000,
      pricing: {
        prompt: parseFloat(m.pricing?.prompt || "0"),
        completion: parseFloat(m.pricing?.completion || "0"),
      },
      isFree:
        parseFloat(m.pricing?.prompt || "1") === 0 &&
        parseFloat(m.pricing?.completion || "1") === 0,
    }));
  } catch (err) {
    error(`Failed to fetch OpenRouter models: ${err.message}`);
    return [];
  }
}

// ── Ollama API ───────────────────────────────────────────────────────────────

/**
 * Fetch models from local Ollama instance
 */
async function fetchOllamaModels() {
  info("Fetching models from Ollama...");

  try {
    const url = "http://localhost:11434/api/tags";
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000), // 5 second timeout
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    const models = data.models || [];

    info(`Found ${models.length} models on Ollama`);

    return models.map((m) => ({
      id: m.name,
      name: m.name,
      displayName: m.name,
      description: `Local Ollama model (${formatBytes(m.size)})`,
      contextLength: 128000, // Default, Ollama doesn't report this
      maxOutputTokens: 32000,
      pricing: { prompt: 0, completion: 0 },
      isFree: true,
    }));
  } catch (err) {
    warn(`Ollama not available: ${err.message}`);
    return [];
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

/**
 * Convert OpenRouter model to MODEL_OPTIONS format
 */
function openRouterToModelOption(model) {
  // Calculate dollar signs based on pricing
  let dollarSigns = 0;
  if (!model.isFree) {
    const avgPrice = (model.pricing.prompt + model.pricing.completion) / 2;
    if (avgPrice > 0.01) dollarSigns = 5;
    else if (avgPrice > 0.005) dollarSigns = 4;
    else if (avgPrice > 0.002) dollarSigns = 3;
    else if (avgPrice > 0.0005) dollarSigns = 2;
    else dollarSigns = 1;
  }

  return {
    name: model.id,
    displayName: model.displayName,
    description: model.description,
    maxOutputTokens: model.maxOutputTokens,
    contextWindow: model.contextLength,
    temperature: 0,
    dollarSigns,
    tag: model.isFree ? "Free" : undefined,
    tagColor: model.isFree
      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
      : undefined,
  };
}

/**
 * Generate TypeScript code for OpenRouter models
 */
function generateOpenRouterCode(models) {
  const modelOptions = models.map(openRouterToModelOption);

  return `  openrouter: [
    // Auto-synced from OpenRouter API
    ${modelOptions
      .map((m) => {
        const lines = [];
        lines.push(`{`);
        lines.push(`name: "${m.name}",`);
        lines.push(`displayName: "${m.displayName}",`);
        lines.push(`description: "${m.description.replace(/"/g, '\\"')}",`);
        if (m.maxOutputTokens)
          lines.push(`maxOutputTokens: ${m.maxOutputTokens},`);
        lines.push(`contextWindow: ${m.contextWindow},`);
        lines.push(`temperature: ${m.temperature},`);
        if (m.dollarSigns) lines.push(`dollarSigns: ${m.dollarSigns},`);
        if (m.tag) {
          lines.push(`tag: "${m.tag}",`);
          lines.push(`tagColor: "${m.tagColor}",`);
        }
        return lines.join(" ");
      })
      .join(",\n    ")},
  ],`;
}

/**
 * Update the constants file with new models
 */
async function updateConstantsFile(openRouterModels, ollamaModels) {
  info("Reading current constants file...");

  const content = await fs.readFile(CONSTANTS_FILE, "utf-8");

  // Find and replace OpenRouter section
  const openrouterRegex =
    /openrouter: \[[\s\S]*?\],(?=\s*(?:auto|azure|xai|bedrock|minimax):)/;
  const openrouterMatch = content.match(openrouterRegex);

  if (!openrouterMatch) {
    error("Could not find openrouter section in constants file");
    return false;
  }

  const newOpenRouterCode = generateOpenRouterCode(openRouterModels);
  let newContent = content.replace(openrouterRegex, newOpenRouterCode);

  // Find and replace Ollama section in LOCAL_PROVIDERS
  const ollamaRegex = /ollama: \{[\s\S]*?\}/;
  const ollamaMatch = newContent.match(ollamaRegex);

  if (ollamaMatch && ollamaModels.length > 0) {
    const newOllamaCode = `ollama: {
    displayName: "Ollama",
    hasFreeTier: true,
  }`;
    newContent = newContent.replace(ollamaRegex, newOllamaCode);
  }

  // Write updated file
  if (dryRun) {
    info("Dry run - would write:");
    console.log(newContent.slice(0, 2000) + "...");
    return true;
  }

  await fs.writeFile(CONSTANTS_FILE, newContent);
  success(`Updated ${CONSTANTS_FILE}`);
  return true;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${CYAN}═══ Model Sync Tool ═══${NC}\n`);

  if (dryRun) {
    warn("Dry run mode - no changes will be written\n");
  }

  const openRouterModels = [];
  const ollamaModels = [];

  // Fetch from providers
  if (syncOpenRouter) {
    const models = await fetchOpenRouterModels(freeOnly);
    openRouterModels.push(...models);
    success(`OpenRouter: ${openRouterModels.length} models`);
  }

  if (syncOllama) {
    const models = await fetchOllamaModels();
    ollamaModels.push(...models);
    success(`Ollama: ${ollamaModels.length} models`);
  }

  // Summary
  console.log(`\n${CYAN}═══ Summary ═══${NC}\n`);
  info(`OpenRouter models: ${openRouterModels.length}`);
  info(`Ollama models: ${ollamaModels.length}`);

  if (openRouterModels.length === 0 && ollamaModels.length === 0) {
    warn("No models to sync");
    return;
  }

  // Show free models
  const freeOpenRouter = openRouterModels.filter((m) => m.isFree);
  if (freeOpenRouter.length > 0) {
    console.log(`\n${GREEN}Free OpenRouter models:${NC}`);
    freeOpenRouter.forEach((m) => {
      console.log(
        `  • ${m.displayName} (${m.contextLength.toLocaleString()} tokens)`,
      );
    });
  }

  // Update constants file
  if (!dryRun) {
    await updateConstantsFile(openRouterModels, ollamaModels);
  }

  console.log(`\n${GREEN}✓ Done!${NC}\n`);
}

// Run
main().catch((err) => {
  error(`Fatal error: ${err.message}`);
  process.exit(1);
});
