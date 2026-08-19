/**
 * Browser Toolkit — Renderer API
 *
 * Provides typed access to browser toolkit methods from the renderer process.
 * Wraps IPC calls with proper error handling and type safety.
 */

import type {
  ButtonInfo,
  ContrastResult,
  ElementInfo,
  FormData,
  ImageAuditEntry,
  InputInfo,
  LinkCheckEntry,
  NetworkEntry,
  PageHeadings,
  PageImages,
  PageLinks,
  PageMeta,
  UxAuditEntry,
  VisualDiagnosis,
} from "./types";
import type { ToolCall, ToolResult } from "./toolExecutor";
import type { ToolDefinition } from "./toolDefinitions";

// ═══════════════════════════════════════════════════════════════════════════
// IPC BRIDGE (renderer side)
// ═══════════════════════════════════════════════════════════════════════════

// In dyad-main, the renderer uses window.electron.ipcRenderer.invoke()
// This is the standard Electron IPC bridge pattern.

const ipc = {
  invoke: (channel: string, ...args: unknown[]): Promise<unknown> => {
    return (window as any).electron?.ipcRenderer?.invoke(channel, ...args);
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// CHANNELS (must match main process)
// ═══════════════════════════════════════════════════════════════════════════

const CH = {
  TOOL_EXECUTE: "browser-toolkit:execute",
  TOOL_LIST: "browser-toolkit:list-tools",
  TOOL_GET: "browser-toolkit:get-tool",
  GOTO: "browser-toolkit:goto",
  BACK: "browser-toolkit:back",
  FORWARD: "browser-toolkit:forward",
  RELOAD: "browser-toolkit:reload",
  READ: "browser-toolkit:read",
  FIND: "browser-toolkit:find",
  TEXT: "browser-toolkit:text",
  HTML: "browser-toolkit:html",
  CLICK: "browser-toolkit:click",
  TYPE: "browser-toolkit:type",
  FILL: "browser-toolkit:fill",
  PRESS: "browser-toolkit:press-key",
  DIAGNOSTICS: "browser-toolkit:diagnostics",
  CONTRAST: "browser-toolkit:contrast-check",
  IMAGE_AUDIT: "browser-toolkit:image-audit",
  UX_AUDIT: "browser-toolkit:ux-audit",
  VISUAL: "browser-toolkit:visual-diagnosis",
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// BROWSER TOOLKIT API
// ═══════════════════════════════════════════════════════════════════════════

export const browserToolkit = {
  // ── Generic tool execution ──────────────────────────────────────────────

  async execute(call: ToolCall): Promise<ToolResult> {
    return ipc.invoke(CH.TOOL_EXECUTE, call) as Promise<ToolResult>;
  },

  async listTools(): Promise<ToolDefinition[]> {
    return ipc.invoke(CH.TOOL_LIST) as Promise<ToolDefinition[]>;
  },

  async getTool(name: string): Promise<ToolDefinition | null> {
    return ipc.invoke(CH.TOOL_GET, name) as Promise<ToolDefinition | null>;
  },

  // ── Navigation ─────────────────────────────────────────────────────────

  async goto(url: string): Promise<PageMeta> {
    return ipc.invoke(CH.GOTO, url) as Promise<PageMeta>;
  },

  async back(): Promise<PageMeta> {
    return ipc.invoke(CH.BACK) as Promise<PageMeta>;
  },

  async forward(): Promise<PageMeta> {
    return ipc.invoke(CH.FORWARD) as Promise<PageMeta>;
  },

  async reload(): Promise<PageMeta> {
    return ipc.invoke(CH.RELOAD) as Promise<PageMeta>;
  },

  // ── Reading ────────────────────────────────────────────────────────────

  async read(): Promise<string> {
    return ipc.invoke(CH.READ) as Promise<string>;
  },

  async find(
    query: string,
    all?: boolean
  ): Promise<ElementInfo | ElementInfo[]> {
    return ipc.invoke(CH.FIND, query, all) as Promise<
      ElementInfo | ElementInfo[]
    >;
  },

  async text(selector?: string): Promise<string> {
    return ipc.invoke(CH.TEXT, selector) as Promise<string>;
  },

  async html(): Promise<string> {
    return ipc.invoke(CH.HTML) as Promise<string>;
  },

  // ── Interaction ────────────────────────────────────────────────────────

  async click(selector: string): Promise<boolean> {
    return ipc.invoke(CH.CLICK, selector) as Promise<boolean>;
  },

  async type(selector: string, text: string): Promise<boolean> {
    return ipc.invoke(CH.TYPE, selector, text) as Promise<boolean>;
  },

  async fill(selector: string, value: string): Promise<boolean> {
    return ipc.invoke(CH.FILL, selector, value) as Promise<boolean>;
  },

  async pressKey(key: string): Promise<boolean> {
    return ipc.invoke(CH.PRESS, key) as Promise<boolean>;
  },

  // ── Diagnostics ────────────────────────────────────────────────────────

  async diagnostics(
    tools: string[]
  ): Promise<Record<string, unknown>> {
    return ipc.invoke(
      CH.DIAGNOSTICS,
      tools
    ) as Promise<Record<string, unknown>>;
  },

  async contrastCheck(): Promise<ContrastResult[]> {
    return ipc.invoke(CH.CONTRAST) as Promise<ContrastResult[]>;
  },

  async imageAudit(): Promise<ImageAuditEntry[]> {
    return ipc.invoke(CH.IMAGE_AUDIT) as Promise<ImageAuditEntry[]>;
  },

  async uxAudit(): Promise<UxAuditEntry[]> {
    return ipc.invoke(CH.UX_AUDIT) as Promise<UxAuditEntry[]>;
  },

  async visualDiagnosis(): Promise<VisualDiagnosis> {
    return ipc.invoke(CH.VISUAL) as Promise<VisualDiagnosis>;
  },

  // ── Batch execution ────────────────────────────────────────────────────

  async batch(
    actions: ToolCall[],
    stopOnError = true
  ): Promise<ToolResult[]> {
    return ipc.invoke(
      CH.TOOL_EXECUTE,
      { name: "browser_batch", arguments: { actions, stopOnError } }
    ) as Promise<ToolResult[]>;
  },
};

export default browserToolkit;
