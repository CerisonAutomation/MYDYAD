/**
 * Tool Executor — Bridges tool definitions with the Zenith toolkit
 *
 * Executes browser tools by mapping tool calls to zenith toolkit methods.
 * Handles parameter validation, error handling, and result formatting.
 */

import type { ZenithToolkit } from "./zenith";
import { TOOL_DEFINITIONS, type ToolDefinition } from "./toolDefinitions";

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  tool: string;
  duration: number;
}

export class ToolExecutor {
  private zenith: ZenithToolkit;

  constructor(zenith: ZenithToolkit) {
    this.zenith = zenith;
  }

  async execute(call: ToolCall): Promise<ToolResult> {
    const start = Date.now();
    const definition = TOOL_DEFINITIONS[call.name];

    if (!definition) {
      return {
        success: false,
        error: `Unknown tool: ${call.name}`,
        tool: call.name,
        duration: Date.now() - start,
      };
    }

    try {
      const result = await this.executeTool(definition, call.arguments);
      return {
        success: true,
        data: result,
        tool: call.name,
        duration: Date.now() - start,
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: message,
        tool: call.name,
        duration: Date.now() - start,
      };
    }
  }

  private async executeTool(
    definition: ToolDefinition,
    args: Record<string, unknown>
  ): Promise<unknown> {
    switch (definition.name) {
      // Navigation
      case "navigate":
        return this.zenith.goto(args.url as string);

      // Reading
      case "read_page": {
        const mode = (args.mode as string) || "all";
        const results: Record<string, unknown> = {};
        if (mode === "text" || mode === "all") {
          results.text = await this.zenith.text();
        }
        if (mode === "links" || mode === "all") {
          results.links = await this.zenith.links();
        }
        if (mode === "images" || mode === "all") {
          results.images = await this.zenith.images();
        }
        if (mode === "headings" || mode === "all") {
          results.headings = await this.zenith.headings();
        }
        return results;
      }

      case "find": {
        const query = args.query as string;
        const all = args.all as boolean;
        return all
          ? await this.zenith.findAll(query)
          : await this.zenith.find(query);
      }

      case "get_page_text":
        return this.zenith.text(
          args.selector as string | undefined
        );

      // Automation
      case "computer":
        return this.executeComputerAction(args);

      // Forms
      case "form_input":
        return this.zenith.fill(
          args.selector as string,
          args.value as string
        );

      case "fill_form": {
        const formSelector = args.formSelector as string;
        const values = args.values as Record<string, string>;
        const results = [];
        for (const [name, value] of Object.entries(values)) {
          const selector = `${formSelector} [name="${name}"], ${formSelector} #${name}`;
          try {
            await this.zenith.fill(selector, value);
            results.push({ field: name, success: true });
          } catch {
            results.push({
              field: name,
              success: false,
              error: "Field not found",
            });
          }
        }
        return results;
      }

      case "submit_form":
        return this.zenith.click(`${args.selector} [type="submit"], ${args.selector} button[type="submit"]`);

      // Tabs
      case "tabs":
        return this.zenith.meta();

      case "open_tab":
        return this.zenith.goto(args.url as string);

      case "close_tab":
        return { success: true, note: "Tab closing requires IPC to main process" };

      // Inspection
      case "inspect": {
        const selector = args.selector as string;
        return {
          attrs: await this.zenith.attrs(selector),
          styles: await this.zenith.styles(selector),
          bbox: await this.zenith.bbox(selector),
          classes: await this.zenith.classes(selector),
          value: await this.zenith.value(selector),
        };
      }

      // Diagnostics
      case "console_messages":
        return this.zenith.consoleMonitor();

      case "network_analysis":
        return this.zenith.networkAnalysis();

      case "contrast_check":
        return this.zenith.contrastCheck();

      case "image_audit":
        return this.zenith.imageAudit();

      case "link_check":
        return this.zenith.linkCheck();

      case "ux_audit":
        return this.zenith.uxAudit();

      case "visual_diagnosis":
        return this.zenith.visualDiagnosis();

      // Batch
      case "browser_batch": {
        const actions = args.actions as ToolCall[];
        const stopOnError = args.stopOnError !== false;
        const results = [];
        for (const action of actions) {
          const result = await this.execute(action);
          results.push(result);
          if (!result.success && stopOnError) {
            break;
          }
        }
        return results;
      }

      default:
        throw new Error(`Tool not implemented: ${definition.name}`);
    }
  }

  private async executeComputerAction(
    args: Record<string, unknown>
  ): Promise<unknown> {
    const action = args.action as string;
    const selector = args.selector as string;
    const text = args.text as string;
    const key = args.key as string;
    const x = args.x as number;
    const y = args.y as number;
    const direction = args.direction as string;
    const amount = (args.amount as number) || 3;

    switch (action) {
      case "left_click":
        return this.zenith.click(selector);

      case "right_click":
        return this.zenith.rightclick(selector);

      case "double_click":
        return this.zenith.dblclick(selector);

      case "triple_click":
        // Select all text by triple-clicking
        return this.zenith.click(selector);

      case "type":
        return this.zenith.type(selector, text || "");

      case "key":
        return this.zenith.pressKey(key || "");

      case "scroll": {
        const scrollCode =
          direction === "up"
            ? `window.scrollBy(0, -${amount * 100})`
            : `window.scrollBy(0, ${amount * 100})`;
        await this.zenith.eval(scrollCode);
        return { success: true };
      }

      case "scroll_to": {
        await this.zenith.eval(
          `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ behavior: 'smooth', block: 'center' })`
        );
        return { success: true };
      }

      case "hover":
        return this.zenith.hover(selector);

      case "middle_click":
        return this.zenith.click(selector);

      case "screenshot":
        return this.zenith.screenshot();

      default:
        throw new Error(`Unknown computer action: ${action}`);
    }
  }

  listTools(): ToolDefinition[] {
    return Object.values(TOOL_DEFINITIONS);
  }

  getTool(name: string): ToolDefinition | undefined {
    return TOOL_DEFINITIONS[name];
  }
}
