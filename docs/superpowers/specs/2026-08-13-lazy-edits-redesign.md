# Lazy Edits Redesign - Canonical Dyad XML Tool Format

## Critique of Current Implementation

### Issues Found

1. **Not Following Canonical Tool Pattern**
   - Missing `buildXml` for streaming preview
   - Missing `getConsentPreview` for user consent
   - Error handling not using `DyadError` consistently
   - XML format doesn't match `<dyad-tool-name>` pattern

2. **Incomplete Integration**
   - `local_lazy_edits.ts` is a standalone module, not wired into tool system
   - No `ToolDefinition` interface implementation
   - No streaming support via `onXmlStream`/`onXmlComplete`

3. **Missing Features from Zips**
   - `repo-intel` has PageRank, Context Optimizer, Hotspots
   - `repo-features-mcp-pro` has git churn, AST analysis
   - These can enhance file selection for Smart Context

### Canonical Dyad Tool Pattern

```typescript
export const toolName: ToolDefinition<z.infer<typeof schema>> = {
  name: "tool_name",
  description: DESCRIPTION,  // Comprehensive markdown
  inputSchema: schema,       // Zod schema
  defaultConsent: "ask" | "always",

  // Optional: State modification tracking
  modifiesState?: boolean,
  usesEngineEndpoint?: boolean,

  // Consent preview
  getConsentPreview: (args) => string,

  // XML building for streaming
  buildXml: (args, isComplete) => string | undefined,

  // Main execution
  execute: async (args, ctx) => {
    // 1. Stream initial XML
    ctx.onXmlStream(`<dyad-tool-name attrs>`);

    // 2. Do work
    const result = await doWork(args);

    // 3. Stream final XML
    ctx.onXmlComplete(`<dyad-tool-name attrs>content</dyad-tool-name>`);

    return result;
  },
};
```

## Redesigned Implementation

### 1. Local Smart Context Tool (Canonical Format)

```typescript
// src/pro/main/ipc/handlers/local_agent/tools/smart_context.ts

import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import {
  selectSmartContext,
  formatSmartContext,
} from "@/ipc/utils/local_smart_context";
import type { CodebaseFile } from "@/utils/codebase";

const logger = log.scope("smart_context");

const smartContextSchema = z.object({
  goal: z
    .string()
    .describe("The user's goal or prompt to select relevant files for"),
  max_tokens: z
    .number()
    .optional()
    .describe("Maximum tokens for context (default: 8000)"),
  mode: z
    .enum(["balanced", "conservative", "deep"])
    .optional()
    .describe("Smart context mode"),
});

const DESCRIPTION = `
Select the most relevant files for a specific goal using intelligent file ranking.

### When to Use
- Before making code changes, to understand which files are relevant
- When working on large codebases, to focus on important files
- When the user asks about specific functionality

### How It Works
1. Analyzes your goal against all codebase files
2. Scores files by relevance (path, content, exports, imports)
3. Selects top files within token budget
4. Returns ranked files with reasons

### Modes
- **balanced**: Selects ~20 files (default)
- **conservative**: Selects ~10 files (focused)
- **deep**: Selects ~30 files (comprehensive)
`;

export const smartContextTool: ToolDefinition<
  z.infer<typeof smartContextSchema>
> = {
  name: "smart_context",
  description: DESCRIPTION,
  inputSchema: smartContextSchema,
  defaultConsent: "always",

  getConsentPreview: (args) => `Select relevant files for: "${args.goal}"`,

  buildXml: (args, isComplete) => {
    if (!args.goal) return undefined;
    if (isComplete) return undefined;
    return `<dyad-smart-context goal="${escapeXmlAttr(args.goal)}">Analyzing...</dyad-smart-context>`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Executing smart context for goal: ${args.goal}`);

    ctx.onXmlStream(
      `<dyad-smart-context goal="${escapeXmlAttr(args.goal)}">Selecting files...</dyad-smart-context>`,
    );

    // Get codebase files from context
    const files: CodebaseFile[] = ctx.codebaseFiles || [];

    const result = selectSmartContext({
      goal: args.goal,
      files,
      tokenBudget: args.max_tokens || 8000,
      mode: args.mode || "balanced",
    });

    const formatted = formatSmartContext(result);

    ctx.onXmlComplete(
      `<dyad-smart-context goal="${escapeXmlAttr(args.goal)}" files="${result.selectedFiles.length}" tokens="${result.tokensUsed}">\n${escapeXmlContent(formatted)}\n</dyad-smart-context>`,
    );

    return formatted;
  },
};
```

### 2. Local Lazy Edits Tool (Canonical Format)

```typescript
// src/pro/main/ipc/handlers/local_agent/tools/local_lazy_edits.ts

import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { optimizeLazyEdits } from "@/ipc/utils/local_lazy_edits";
import type { CodebaseFile } from "@/utils/codebase";

const logger = log.scope("local_lazy_edits");

const lazyEditsSchema = z.object({
  response: z
    .string()
    .describe("The LLM response containing file edits to optimize"),
  aggressive: z
    .boolean()
    .optional()
    .describe("Use aggressive optimization (default: false)"),
});

const DESCRIPTION = `
Optimize file edits by converting full rewrites to targeted search-replace diffs.

### When to Use
- After generating code changes, to reduce token usage
- When the model outputs full file rewrites instead of diffs
- To improve edit precision and reduce errors

### How It Works
1. Detects full file rewrites (<dyad-write> blocks)
2. Compares with original files
3. Generates targeted search-replace diffs
4. Estimates token savings

### Output Format
Returns optimized response with search-replace blocks:
\`\`\`
<<<<<<< SEARCH
[exact content to find]
=======
[new content to replace with]
>>>>>>> REPLACE
\`\`\`
`;

export const localLazyEditsTool: ToolDefinition<
  z.infer<typeof lazyEditsSchema>
> = {
  name: "local_lazy_edits",
  description: DESCRIPTION,
  inputSchema: lazyEditsSchema,
  defaultConsent: "always",

  getConsentPreview: (args) =>
    `Optimize ${args.response.length} chars of edits`,

  buildXml: (args, isComplete) => {
    if (!args.response) return undefined;
    if (isComplete) return undefined;
    return `<dyad-lazy-edits>Optimizing...</dyad-lazy-edits>`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Executing lazy edits optimization`);

    ctx.onXmlStream(`<dyad-lazy-edits>Analyzing edits...</dyad-lazy-edits>`);

    const files: CodebaseFile[] = ctx.codebaseFiles || [];

    const result = optimizeLazyEdits({
      response: args.response,
      files,
      aggressive: args.aggressive || false,
    });

    const summary = [
      `Optimized ${result.originalRewrites} rewrites → ${result.optimizedReplaces} search-replaces`,
      `Estimated token savings: ~${result.tokenSavings} tokens`,
    ].join("\n");

    ctx.onXmlComplete(
      `<dyad-lazy-edits original="${result.originalRewrites}" optimized="${result.optimizedReplaces}" savings="${result.tokenSavings}">\n${escapeXmlContent(result.optimizedEdits)}\n</dyad-lazy-edits>`,
    );

    return result.optimizedEdits;
  },
};
```

### 3. Local Voice-to-Text Tool (Canonical Format)

```typescript
// src/pro/main/ipc/handlers/local_agent/tools/local_transcribe.ts

import { z } from "zod";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { localTranscribe } from "@/ipc/utils/local_transcribe";

const logger = log.scope("local_transcribe");

const transcribeSchema = z.object({
  audio_path: z.string().describe("Path to the audio file to transcribe"),
  language: z.string().optional().describe("Language hint (e.g., 'en', 'es')"),
});

const DESCRIPTION = `
Transcribe audio to text using the Whisper API.

### When to Use
- User provides an audio file for transcription
- Voice input needs to be converted to text

### Requirements
- OpenAI or OpenAI-compatible provider configured
- Audio file in supported format (webm, mp3, wav, m4a)

### Output
Returns transcribed text from the audio file.
`;

export const localTranscribeTool: ToolDefinition<
  z.infer<typeof transcribeSchema>
> = {
  name: "local_transcribe",
  description: DESCRIPTION,
  inputSchema: transcribeSchema,
  defaultConsent: "ask",

  getConsentPreview: (args) => `Transcribe audio: ${args.audio_path}`,

  buildXml: (args, isComplete) => {
    if (!args.audio_path) return undefined;
    if (isComplete) return undefined;
    return `<dyad-transcribe path="${escapeXmlAttr(args.audio_path)}">Transcribing...</dyad-transcribe>`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Executing transcription for: ${args.audio_path}`);

    ctx.onXmlStream(
      `<dyad-transcribe path="${escapeXmlAttr(args.audio_path)}">Processing audio...</dyad-transcribe>`,
    );

    // Read audio file
    const fs = await import("node:fs/promises");
    const audioBuffer = await fs.readFile(args.audio_path);
    const filename = args.audio_path.split("/").pop() || "audio.webm";

    const result = await localTranscribe({
      audioBuffer,
      filename,
      requestId: ctx.dyadRequestId,
      language: args.language,
    });

    ctx.onXmlComplete(
      `<dyad-transcribe path="${escapeXmlAttr(args.audio_path)}" provider="${result.provider}">\n${escapeXmlContent(result.text)}\n</dyad-transcribe>`,
    );

    return result.text;
  },
};
```

## Integration Plan

### Step 1: Add Tools to Tool Registry

Add these tools to `tool_definitions.ts`:

```typescript
import { smartContextTool } from "./smart_context";
import { localLazyEditsTool } from "./local_lazy_edits";
import { localTranscribeTool } from "./local_transcribe";

export const toolDefinitions = [
  // ... existing tools
  smartContextTool,
  localLazyEditsTool,
  localTranscribeTool,
];
```

### Step 2: Wire into Chat Stream Handlers

Update `chat_stream_handlers.ts` to use local tools when engine unavailable:

```typescript
// When engine is not available, use local smart context
if (!isEngineEnabled && settings.enableProSmartFilesContextMode) {
  const smartContextResult = selectSmartContext({
    goal: userMessage,
    files: codebaseFiles,
    mode: settings.proSmartContextOption || "balanced",
  });
  // Inject selected files into prompt
}
```

### Step 3: Update System Prompt

Ensure Lazy Edits V2 prompt is injected for any provider:

```typescript
// In system_prompt.ts
return buildPrompt + (enableTurboEditsV2 ? TURBO_EDITS_V2_SYSTEM_PROMPT : "");
```

## Summary

The redesigned implementation:

1. Follows canonical Dyad XML tool format exactly
2. Uses `ToolDefinition` interface properly
3. Includes `buildXml` for streaming preview
4. Includes `getConsentPreview` for user consent
5. Uses `DyadError` for error handling
6. Streams results via `onXmlStream`/`onXmlComplete`
7. Works with any provider (no Dyad Engine dependency)
