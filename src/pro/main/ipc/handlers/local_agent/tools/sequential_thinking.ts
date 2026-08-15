import { z } from "zod";
import { ToolDefinition, AgentContext, escapeXmlContent } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import log from "electron-log";

const logger = log.scope("sequential_thinking");

// Official MCP Sequential Thinking schema
const thoughtDataSchema = z.object({
  thought: z.string().describe("The thinking step"),
  thoughtNumber: z.number().int().min(1).describe("Current thought number"),
  totalThoughts: z.number().int().min(1).describe("Total thoughts needed"),
  isRevision: z
    .boolean()
    .optional()
    .describe("If true, this revises a previous thought"),
  revisesThought: z
    .number()
    .int()
    .optional()
    .describe("Which thought is being revised"),
  branchFromThought: z
    .number()
    .int()
    .optional()
    .describe("Branch from which thought"),
  branchId: z.string().optional().describe("Branch identifier"),
  needsMoreThoughts: z
    .boolean()
    .optional()
    .describe("If true, more thoughts are needed"),
  nextThoughtNeeded: z.boolean().describe("Whether another thought is needed"),
});

type ThoughtData = z.infer<typeof thoughtDataSchema>;

const DESCRIPTION = `Forces multi-step reasoning with revision and branching. Official MCP Gold Standard.

- Structured thinking with thought tracking
- Supports revision of previous thoughts
- Supports branching into alternative reasoning
- Maintains thought history across turns
- Use for complex debugging, architecture decisions, multi-step problems

Based on modelcontextprotocol/servers (88k★ official MCP reference).`;

// Per-context thinking state
interface ThinkingState {
  thoughtHistory: ThoughtData[];
  branches: Record<string, ThoughtData[]>;
}

const MAX_THINKING_STATES = 100;
const thinkingStates = new Map<string, ThinkingState>();

function getState(ctx: AgentContext): ThinkingState {
  const key = `${ctx.appId}-${ctx.chatId}`;
  if (!thinkingStates.has(key)) {
    thinkingStates.set(key, { thoughtHistory: [], branches: {} });
    // LRU eviction: remove oldest entries when cache exceeds max size
    if (thinkingStates.size > MAX_THINKING_STATES) {
      const oldest = thinkingStates.keys().next().value;
      if (oldest !== undefined) {
        thinkingStates.delete(oldest);
      }
    }
  }
  return thinkingStates.get(key)!;
}

function formatThought(data: ThoughtData): string {
  const {
    thoughtNumber,
    totalThoughts,
    thought,
    isRevision,
    revisesThought,
    branchFromThought,
    branchId,
  } = data;

  let prefix = "";
  let context = "";

  if (isRevision) {
    prefix = "🔄 Revision";
    context = revisesThought ? ` (revising thought ${revisesThought})` : "";
  } else if (branchFromThought) {
    prefix = "🌿 Branch";
    context = ` (from thought ${branchFromThought}${branchId ? `, ID: ${branchId}` : ""})`;
  } else {
    prefix = "💭 Thought";
  }

  const header = `${prefix} ${thoughtNumber}/${totalThoughts}${context}`;
  const border = "─".repeat(Math.max(header.length, thought.length) + 4);

  return `
┌${border}┐
│ ${header} │
├${border}┤
│ ${thought.padEnd(border.length - 2)} │
└${border}┘`;
}

function processThought(
  state: ThinkingState,
  input: ThoughtData,
): { content: string; isError?: boolean } {
  try {
    // Adjust totalThoughts if thoughtNumber exceeds it
    if (input.thoughtNumber > input.totalThoughts) {
      input.totalThoughts = input.thoughtNumber;
    }

    state.thoughtHistory.push(input);
    // Cap history to prevent unbounded growth in long sessions
    const MAX_THOUGHT_HISTORY = 200;
    if (state.thoughtHistory.length > MAX_THOUGHT_HISTORY) {
      state.thoughtHistory.splice(
        0,
        state.thoughtHistory.length - MAX_THOUGHT_HISTORY,
      );
    }
    if (input.branchFromThought && input.branchId) {
      if (!state.branches[input.branchId]) {
        state.branches[input.branchId] = [];
      }
      state.branches[input.branchId].push(input);
    }

    // Format the thought
    const formattedThought = formatThought(input);

    // Build response
    const response = {
      thoughtNumber: input.thoughtNumber,
      totalThoughts: input.totalThoughts,
      nextThoughtNeeded: input.nextThoughtNeeded,
      branches: Object.keys(state.branches),
      thoughtHistoryLength: state.thoughtHistory.length,
    };

    return {
      content: `${formattedThought}\n\n${JSON.stringify(response, null, 2)}`,
    };
  } catch (error) {
    return {
      content: JSON.stringify(
        {
          error: error instanceof Error ? error.message : String(error),
          status: "failed",
        },
        null,
        2,
      ),
      isError: true,
    };
  }
}

function buildAttributes(
  args: Partial<ThoughtData>,
  state?: ThinkingState,
): string {
  const attrs: string[] = [];
  attrs.push(`thought="${args.thoughtNumber || 1}/${args.totalThoughts || 1}"`);
  if (args.isRevision) attrs.push(`revision="true"`);
  if (args.branchId) attrs.push(`branch="${args.branchId}"`);
  if (state) attrs.push(`history="${state.thoughtHistory.length}"`);
  return attrs.join(" ");
}

export const sequentialThinkingTool: ToolDefinition<ThoughtData> = {
  name: "sequential_thinking",
  description: DESCRIPTION,
  inputSchema: thoughtDataSchema,
  defaultConsent: "always",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) =>
    `Step ${args.thoughtNumber}/${args.totalThoughts}: ${args.thought.substring(0, 100)}${args.thought.length > 100 ? "..." : ""}`,

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-thinking ${buildAttributes(args)}>Thinking step ${args.thoughtNumber}...</dyad-thinking>`;
  },

  execute: async (args, ctx: AgentContext) => {
    logger.log(`Thinking step ${args.thoughtNumber}/${args.totalThoughts}`);

    try {
      const state = getState(ctx);
      processThought(state, args);

      const attrs = buildAttributes(args, state);

      let resultText = `Step ${args.thoughtNumber}/${args.totalThoughts}\n\n`;
      resultText += args.thought;

      if (state.thoughtHistory.length > 1) {
        resultText += `\n\n--- Thinking History (${state.thoughtHistory.length} steps) ---`;
        state.thoughtHistory.slice(-3).forEach((s, i) => {
          const num = state.thoughtHistory.length - 2 + i;
          resultText += `\n${num}. ${s.thought.substring(0, 80)}...`;
        });
      }

      if (Object.keys(state.branches).length > 0) {
        resultText += `\n\n🌿 Active Branches: ${Object.keys(state.branches).join(", ")}`;
      }

      if (!args.nextThoughtNeeded) {
        resultText += "\n\n✅ Thinking complete. Ready to proceed with action.";
        thinkingStates.delete(`${ctx.appId}-${ctx.chatId}`);
      }

      ctx.onXmlComplete(
        `<dyad-thinking ${attrs}>\n${escapeXmlContent(resultText)}\n</dyad-thinking>`,
      );
      return resultText;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed in sequential thinking: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    }
  },
};
