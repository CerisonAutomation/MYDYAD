# Dyad BYOK Setup Guide - Design Specification

## Overview

This guide enables users to run Dyad with their own API keys (Bring Your Own Key) for all supported providers, maximizing the features available without requiring a Dyad Pro subscription.

## Architecture Analysis

### Pro Feature Gating Mechanism

Dyad's pro features are gated by two functions in `src/lib/schemas.ts`:

```typescript
export function isDyadProEnabled(settings: UserSettings): boolean {
  return settings.enableDyadPro === true && hasDyadProKey(settings);
}

export function hasDyadProKey(settings: UserSettings): boolean {
  return !!settings.providerSettings?.auto?.apiKey?.value;
}
```

**Key insight**: `hasDyadProKey` ONLY checks for the `auto` provider (Dyad's managed service). Any other provider key (OpenAI, Anthropic, etc.) is ignored for pro feature gating.

### Feature Categories

#### Category 1: Software-Gated Features (Could Work with BYOK)

These check `isDyadProEnabled(settings)` and could theoretically accept any provider key:

| Feature          | Location                         | What It Does                           |
| ---------------- | -------------------------------- | -------------------------------------- |
| Local Agent Mode | `local_agent_handler.ts:562-567` | Tool-calling agent loop with 95+ tools |
| Code Search      | `code_search.ts:113-114`         | Search codebase by query               |
| Explore Code     | `explore_code.ts:38`             | Deep code analysis                     |
| Generate Image   | `generate_image.ts:127`          | AI image generation                    |
| Smart Context UI | `ProModeSelector.tsx`            | File context selection toggle          |
| Turbo Edits UI   | `ProModeSelector.tsx`            | Streaming edit mode toggle             |
| Web Access UI    | `ProModeSelector.tsx`            | Web search toggle                      |

#### Category 2: Engine-Dependent Features (Server-Side Only)

These make HTTP calls to `engine.dyad.sh` and fundamentally require the Dyad Engine backend:

| Feature          | Endpoint                                 | Why It's Server-Side             |
| ---------------- | ---------------------------------------- | -------------------------------- |
| Web Search       | `engine.dyad.sh/v1/tools/web-search`     | Proxied search API               |
| Web Fetch        | `engine.dyad.sh/v1/tools/web-crawl`      | Proxied web scraping             |
| Web Crawl        | `engine.dyad.sh/v1/tools/web-crawl`      | Proxied content extraction       |
| Smart Context    | Dyad Engine backend                      | Server-side file selection logic |
| Turbo Edits v1   | Dyad Engine backend                      | Server-side edit optimization    |
| Voice-to-Text    | `engine.dyad.sh/v1/audio/transcriptions` | Proxied Whisper API              |
| Free Model Quota | `engine.dyad.sh/v1/free/quota`           | Dyad's quota system              |

#### Category 3: Subagent Dependencies

These run sub-agents that call the Dyad Engine for LLM completions:

- `explore_code_subagent.ts:324` - asserts `providerSettings?.auto?.apiKey`
- `explore_chat_history_subagent.ts:206` - asserts `providerSettings?.auto?.apiKey`
- `mcp_auto_consent.ts:148-149` - gated on `isDyadPro`

### Provider Configuration

#### Supported Providers

From `src/ipc/shared/language_model_constants.ts`:

| Provider   | Gateway Prefix | Models                                                      |
| ---------- | -------------- | ----------------------------------------------------------- |
| openai     | `openai/`      | GPT 5.5, 5.2, 5.1, 5, 4.1, 4.1-mini, 4.1-nano, o3, o4-mini  |
| anthropic  | `anthropic/`   | Claude Opus 4.8, 4.6, Sonnet 4.6, 4.5, Haiku 4.5, 3.5 Haiku |
| google     | `gemini/`      | Gemini 3.1 Pro, 3.5 Flash, 3 Flash, 2.5 Pro, 2.5 Flash      |
| vertex     | `vertex_ai/`   | Same as Google (requires service account)                   |
| openrouter | `openrouter/`  | All OpenRouter models                                       |
| xai        | `xai/`         | Grok 4, 3                                                   |
| bedrock    | `bedrock/`     | Claude, Llama, Mistral via AWS                              |
| minimax    | `minimax/`     | MiniMax M2.7, M2.5                                          |
| ollama     | `ollama/`      | Local models                                                |
| lmstudio   | `lmstudio/`    | Local models                                                |

#### API Key Storage

From `src/main/settings.ts` and `src/lib/schemas.ts`:

```typescript
// Provider settings structure
providerSettings: {
  [provider: string]: {
    apiKey?: {
      value: string;
      encrypted: boolean;
    };
    // Vertex-specific
    serviceAccountKey?: { value: string; encrypted: boolean };
    projectId?: string;
    location?: string;
    // Azure-specific
    resourceName?: string;
  };
}
```

API keys can also come from environment variables (mapped in `PROVIDER_TO_ENV_VAR`):

- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GOOGLE_API_KEY`
- `OPENROUTER_API_KEY`
- `XAI_API_KEY`
- etc.

### Settings Schema

From `src/lib/schemas.ts`:

```typescript
export const userSettingsSchema = z.object({
  // Model selection
  selectedModel: z
    .object({
      provider: z.string(),
      name: z.string(),
    })
    .optional(),

  // Provider API keys
  providerSettings: z.record(z.string(), providerSettingsSchema).optional(),

  // Pro feature toggles (these check enableDyadPro)
  enableDyadPro: z.boolean().optional(),
  enableProSmartFilesContextMode: z.boolean().optional(),
  proSmartContextOption: z
    .enum(["balanced", "conservative", "deep"])
    .optional(),
  enableProLazyEditsMode: z.boolean().optional(),
  proLazyEditsMode: z.enum(["v1", "v2"]).optional(),
  enableProWebSearch: z.boolean().optional(),

  // Model effort
  modelEffortPreferences: z
    .record(z.string(), z.enum(["low", "medium", "high"]))
    .optional(),

  // Chat mode
  selectedChatMode: z
    .enum(["build", "agent", "ask", "local-agent", "plan"])
    .optional(),
});
```

## Design: BYOK Setup Guide

### Section 1: Provider Setup Instructions

#### OpenAI

1. Get API key from https://platform.openai.com/api-keys
2. In Dyad Settings → Providers → OpenAI
3. Paste API key
4. Select model (recommended: GPT-4.1 or o4-mini)

#### Anthropic

1. Get API key from https://console.anthropic.com/
2. In Dyad Settings → Providers → Anthropic
3. Paste API key
4. Select model (recommended: Claude Sonnet 4.6)

#### Google

1. Get API key from https://aistudio.google.com/apikey
2. In Dyad Settings → Providers → Google
3. Paste API key
4. Select model (recommended: Gemini 2.5 Pro)

#### OpenRouter

1. Get API key from https://openrouter.ai/keys
2. In Dyad Settings → Providers → OpenRouter
3. Paste API key
4. Select model (recommended: Claude Sonnet 4.6 or GPT-4.1)

#### Ollama (Local)

1. Install Ollama: https://ollama.com
2. Pull a model: `ollama pull llama3.1`
3. In Dyad Settings → Providers → Ollama
4. No API key needed (uses localhost:11434)
5. Select model

### Section 2: Feature Availability Matrix

| Feature             | Dyad Pro | BYOK (Any Provider)     | BYOK (Ollama/LMStudio)  |
| ------------------- | -------- | ----------------------- | ----------------------- |
| Agent Mode (Agent2) | ✅       | ⚠️ Requires code change | ⚠️ Requires code change |
| Code Search         | ✅       | ⚠️ Requires code change | ⚠️ Requires code change |
| Explore Code        | ✅       | ⚠️ Requires code change | ⚠️ Requires code change |
| File Operations     | ✅       | ⚠️ Requires code change | ⚠️ Requires code change |
| Git Tools           | ✅       | ⚠️ Requires code change | ⚠️ Requires code change |
| Testing Tools       | ✅       | ⚠️ Requires code change | ⚠️ Requires code change |
| Generate Image      | ✅       | ⚠️ Requires code change | ⚠️ Requires code change |
| Web Search          | ✅       | ❌ Server-side only     | ❌ Server-side only     |
| Web Fetch           | ✅       | ❌ Server-side only     | ❌ Server-side only     |
| Smart Context       | ✅       | ❌ Server-side only     | ❌ Server-side only     |
| Turbo Edits v1      | ✅       | ❌ Server-side only     | ❌ Server-side only     |
| Turbo Edits v2      | ✅       | ⚠️ Partial (local)      | ⚠️ Partial (local)      |
| Voice-to-Text       | ✅       | ❌ Server-side only     | ❌ Server-side only     |
| Free Model Quota    | ✅       | ❌ Dyad-only            | ❌ Dyad-only            |

**Legend:**

- ✅ = Works out of the box
- ⚠️ = Requires code modification to `isDyadProEnabled` or `hasDyadProKey`
- ❌ = Cannot work without Dyad Engine backend

### Section 3: Workarounds for Missing Features

#### Web Search Alternative

For BYOK users, use the `web_fetch` tool with direct URLs instead of `web_search`:

```
Instead of: web_search("latest React patterns")
Use: web_fetch("https://react.dev/learn")
```

#### Smart Context Alternative

Manually reference files in your prompts:

```
"Using the files in src/components/ and src/hooks/, create a..."
```

#### Turbo Edits Alternative

Use standard code generation (slower but works):

```
"Rewrite the entire file with the following changes..."
```

### Section 4: Next.js Template Improvements

#### Current Template

From `src/shared/templates.ts`:

```typescript
{
  id: "next",
  title: "Next.js Template",
  description: "Uses Next.js, React.js, Shadcn, Tailwind and TypeScript.",
  githubUrl: "https://github.com/dyad-sh/nextjs-template",
  isOfficial: true,
}
```

#### Recommended Improvements

1. **Add App Router support** (currently uses Pages Router)
2. **Include shadcn/ui components** pre-installed
3. **Add authentication template** (NextAuth.js)
4. **Include database setup** (Prisma + SQLite)
5. **Add deployment config** (Vercel/Netlify)

#### Enhanced Template Structure

```
nextjs-template/
├── src/
│   ├── app/                    # App Router
│   │   ├── layout.tsx
│   │   ├── page.tsx
│   │   └── api/               # API routes
│   ├── components/
│   │   └── ui/                # shadcn/ui components
│   ├── lib/
│   │   ├── utils.ts
│   │   └── prisma.ts          # Database client
│   └── styles/
│       └── globals.css
├── prisma/
│   └── schema.prisma          # Database schema
├── public/
├── next.config.js
├── tailwind.config.js
├── tsconfig.json
└── package.json
```

### Section 5: Agent Prompt Optimization for Next.js

#### Current Agent Behavior

The Local Agent uses tools to:

1. Explore codebase structure
2. Read/write files
3. Run commands
4. Test changes

#### Next.js-Specific Enhancements

1. **Framework Detection**: Agent should detect Next.js and use appropriate tools
2. **Route Generation**: Prefer App Router conventions
3. **Component Patterns**: Use shadcn/ui + Tailwind
4. **API Routes**: Generate proper Next.js API routes
5. **Server Components**: Default to server components when possible

#### Optimized Prompt Template

```
You are building a Next.js application with App Router.

Key conventions:
- Use Server Components by default
- Client Components only when needed (interactivity, browser APIs)
- Use shadcn/ui for UI components
- Use Tailwind CSS for styling
- API routes go in src/app/api/
- Use server actions for mutations when possible

When creating:
- Pages: src/app/[route]/page.tsx
- Components: src/components/[name].tsx
- API routes: src/app/api/[route]/route.ts
- Utilities: src/lib/[name].ts
```

## Implementation Plan

### Phase 1: Documentation (No Code Changes)

Create comprehensive setup guide covering:

1. Provider configuration for each supported provider
2. Feature availability matrix
3. Workarounds for missing features
4. Next.js template usage guide

### Phase 2: Code Modifications (Optional)

If BYOK pro features are desired, modify:

1. `src/lib/schemas.ts` - Redefine `hasDyadProKey` to accept any provider
2. `src/pro/main/ipc/handlers/local_agent/local_agent_handler.ts` - Relax agent mode gate
3. `src/pro/main/ipc/handlers/local_agent/tools/*.ts` - Remove `ctx.isDyadPro` checks
4. `src/components/ProModeSelector.tsx` - Enable toggles for BYOK users

### Phase 3: Next.js Template Enhancement

1. Update `src/shared/templates.ts` with improved template
2. Create new template repository with App Router
3. Add E2E tests for new template
4. Update documentation

## Success Criteria

1. ✅ Users can configure any supported provider
2. ✅ Agent2 works with BYOK (after code changes)
3. ✅ Most tools work without Dyad Pro
4. ✅ Clear documentation of feature availability
5. ✅ Next.js template uses modern conventions
6. ✅ Agent optimized for Next.js development

## Risks and Mitigations

| Risk                                  | Impact | Mitigation                                                 |
| ------------------------------------- | ------ | ---------------------------------------------------------- |
| Code changes break existing Pro users | High   | Test thoroughly, maintain backward compatibility           |
| Engine-dependent features unavailable | Medium | Document clearly, provide alternatives                     |
| Next.js template outdated             | Medium | Update to App Router, add modern features                  |
| Provider API rate limits              | Low    | Document rate limits, suggest OpenRouter for higher limits |

## Appendix: Key File Locations

| Purpose              | File Path                                                      |
| -------------------- | -------------------------------------------------------------- |
| Pro feature gating   | `src/lib/schemas.ts:532-538`                                   |
| Agent handler        | `src/pro/main/ipc/handlers/local_agent/local_agent_handler.ts` |
| Tool definitions     | `src/pro/main/ipc/handlers/local_agent/tool_definitions.ts`    |
| Provider constants   | `src/ipc/shared/language_model_constants.ts`                   |
| Settings schema      | `src/lib/schemas.ts:400-500`                                   |
| Settings storage     | `src/main/settings.ts`                                         |
| Model client routing | `src/ipc/utils/get_model_client.ts`                            |
| Pro UI toggles       | `src/components/ProModeSelector.tsx`                           |
| Templates            | `src/shared/templates.ts`                                      |
| Agent architecture   | `docs/agent_architecture.md`                                   |
