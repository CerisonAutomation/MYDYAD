/**
 * Browser Toolkit IPC Handlers
 *
 * Wires the IAB browser toolkit and agent overlay into dyad-main's IPC system.
 * Handles tool execution, overlay state, and diagnostic requests from the renderer.
 */

import { ipcMain } from "electron";
import type { WebContents } from "electron";
import { createZenithToolkit, type ZenithToolkit } from "../browser_toolkit/zenith";
import { ToolExecutor, type ToolCall } from "../browser_toolkit/toolExecutor";

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════

interface ToolkitInstance {
  zenith: ZenithToolkit;
  executor: ToolExecutor;
  webContents: WebContents;
}

const toolkitInstances = new Map<number, ToolkitInstance>();

// ═══════════════════════════════════════════════════════════════════════════
// INSTANCE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

function getOrCreateToolkit(
  webContents: WebContents
): ToolkitInstance {
  const id = webContents.id;
  let instance = toolkitInstances.get(id);

  if (!instance) {
    const zenith = createZenithToolkit(webContents as any, {
      backend: "electron",
      retries: 2,
      retryDelay: 300,
      verbosity: "concise",
    });
    const executor = new ToolExecutor(zenith);
    instance = { zenith, executor, webContents };
    toolkitInstances.set(id, instance);
  }

  return instance;
}

function removeToolkit(webContentsId: number): void {
  toolkitInstances.delete(webContentsId);
}

// ═══════════════════════════════════════════════════════════════════════════
// IPC CHANNELS
// ═══════════════════════════════════════════════════════════════════════════

const CHANNELS = {
  // Tool execution
  BROWSER_TOOL_EXECUTE: "browser-toolkit:execute",
  BROWSER_TOOL_LIST: "browser-toolkit:list-tools",
  BROWSER_TOOL_GET: "browser-toolkit:get-tool",

  // Navigation shortcuts
  BROWSER_GOTO: "browser-toolkit:goto",
  BROWSER_BACK: "browser-toolkit:back",
  BROWSER_FORWARD: "browser-toolkit:forward",
  BROWSER_RELOAD: "browser-toolkit:reload",

  // Reading shortcuts
  BROWSER_READ: "browser-toolkit:read",
  BROWSER_FIND: "browser-toolkit:find",
  BROWSER_TEXT: "browser-toolkit:text",
  BROWSER_HTML: "browser-toolkit:html",

  // Interaction shortcuts
  BROWSER_CLICK: "browser-toolkit:click",
  BROWSER_TYPE: "browser-toolkit:type",
  BROWSER_FILL: "browser-toolkit:fill",
  BROWSER_PRESS: "browser-toolkit:press-key",

  // Diagnostics
  BROWSER_DIAGNOSTICS: "browser-toolkit:diagnostics",
  BROWSER_CONTRAST: "browser-toolkit:contrast-check",
  BROWSER_IMAGE_AUDIT: "browser-toolkit:image-audit",
  BROWSER_UX_AUDIT: "browser-toolkit:ux-audit",
  BROWSER_VISUAL: "browser-toolkit:visual-diagnosis",

  // Overlay control
  OVERLAY_START: "agent-overlay:start",
  OVERLAY_UPDATE: "agent-overlay:update",
  OVERLAY_COMPLETE: "agent-overlay:complete",
  OVERLAY_PAUSE: "agent-overlay:pause",
  OVERLAY_RESUME: "agent-overlay:resume",
  OVERLAY_CANCEL: "agent-overlay:cancel",
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER REGISTRATION
// ═══════════════════════════════════════════════════════════════════════════

export function registerBrowserToolkitHandlers(): void {
  // ── Tool execution ─────────────────────────────────────────────────────

  ipcMain.handle(
    CHANNELS.BROWSER_TOOL_EXECUTE,
    async (event, call: ToolCall) => {
      const toolkit = getOrCreateToolkit(event.sender);
      return toolkit.executor.execute(call);
    }
  );

  ipcMain.handle(CHANNELS.BROWSER_TOOL_LIST, () => {
    const { TOOL_DEFINITIONS } = require("../browser_toolkit/toolDefinitions");
    return Object.values(TOOL_DEFINITIONS);
  });

  ipcMain.handle(CHANNELS.BROWSER_TOOL_GET, (_, name: string) => {
    const { TOOL_DEFINITIONS } = require("../browser_toolkit/toolDefinitions");
    return TOOL_DEFINITIONS[name] || null;
  });

  // ── Navigation shortcuts ───────────────────────────────────────────────

  ipcMain.handle(
    CHANNELS.BROWSER_GOTO,
    async (event, url: string) => {
      const toolkit = getOrCreateToolkit(event.sender);
      return toolkit.zenith.goto(url);
    }
  );

  ipcMain.handle(CHANNELS.BROWSER_BACK, async (event) => {
    const toolkit = getOrCreateToolkit(event.sender);
    return toolkit.zenith.back();
  });

  ipcMain.handle(CHANNELS.BROWSER_FORWARD, async (event) => {
    const toolkit = getOrCreateToolkit(event.sender);
    return toolkit.zenith.forward();
  });

  ipcMain.handle(CHANNELS.BROWSER_RELOAD, async (event) => {
    const toolkit = getOrCreateToolkit(event.sender);
    return toolkit.zenith.reload();
  });

  // ── Reading shortcuts ──────────────────────────────────────────────────

  ipcMain.handle(CHANNELS.BROWSER_READ, async (event) => {
    const toolkit = getOrCreateToolkit(event.sender);
    return toolkit.zenith.read();
  });

  ipcMain.handle(
    CHANNELS.BROWSER_FIND,
    async (event, query: string, all?: boolean) => {
      const toolkit = getOrCreateToolkit(event.sender);
      return all
        ? toolkit.zenith.findAll(query)
        : toolkit.zenith.find(query);
    }
  );

  ipcMain.handle(
    CHANNELS.BROWSER_TEXT,
    async (event, selector?: string) => {
      const toolkit = getOrCreateToolkit(event.sender);
      return toolkit.zenith.text(selector);
    }
  );

  ipcMain.handle(CHANNELS.BROWSER_HTML, async (event) => {
    const toolkit = getOrCreateToolkit(event.sender);
    return toolkit.zenith.html();
  });

  // ── Interaction shortcuts ──────────────────────────────────────────────

  ipcMain.handle(
    CHANNELS.BROWSER_CLICK,
    async (event, selector: string) => {
      const toolkit = getOrCreateToolkit(event.sender);
      return toolkit.zenith.click(selector);
    }
  );

  ipcMain.handle(
    CHANNELS.BROWSER_TYPE,
    async (event, selector: string, text: string) => {
      const toolkit = getOrCreateToolkit(event.sender);
      return toolkit.zenith.type(selector, text);
    }
  );

  ipcMain.handle(
    CHANNELS.BROWSER_FILL,
    async (event, selector: string, value: string) => {
      const toolkit = getOrCreateToolkit(event.sender);
      return toolkit.zenith.fill(selector, value);
    }
  );

  ipcMain.handle(
    CHANNELS.BROWSER_PRESS,
    async (event, key: string) => {
      const toolkit = getOrCreateToolkit(event.sender);
      return toolkit.zenith.pressKey(key);
    }
  );

  // ── Diagnostics ────────────────────────────────────────────────────────

  ipcMain.handle(CHANNELS.BROWSER_DIAGNOSTICS, async (event, tools: string[]) => {
    const toolkit = getOrCreateToolkit(event.sender);
    const results: Record<string, unknown> = {};

    for (const tool of tools) {
      switch (tool) {
        case "console":
          results.console = await toolkit.zenith.consoleMonitor();
          break;
        case "network":
          results.network = await toolkit.zenith.networkAnalysis();
          break;
        case "contrast":
          results.contrast = await toolkit.zenith.contrastCheck();
          break;
        case "images":
          results.images = await toolkit.zenith.imageAudit();
          break;
        case "links":
          results.links = await toolkit.zenith.linkCheck();
          break;
        case "ux":
          results.ux = await toolkit.zenith.uxAudit();
          break;
        case "visual":
          results.visual = await toolkit.zenith.visualDiagnosis();
          break;
      }
    }

    return results;
  });

  ipcMain.handle(CHANNELS.BROWSER_CONTRAST, async (event) => {
    const toolkit = getOrCreateToolkit(event.sender);
    return toolkit.zenith.contrastCheck();
  });

  ipcMain.handle(CHANNELS.BROWSER_IMAGE_AUDIT, async (event) => {
    const toolkit = getOrCreateToolkit(event.sender);
    return toolkit.zenith.imageAudit();
  });

  ipcMain.handle(CHANNELS.BROWSER_UX_AUDIT, async (event) => {
    const toolkit = getOrCreateToolkit(event.sender);
    return toolkit.zenith.uxAudit();
  });

  ipcMain.handle(CHANNELS.BROWSER_VISUAL, async (event) => {
    const toolkit = getOrCreateToolkit(event.sender);
    return toolkit.zenith.visualDiagnosis();
  });

  // ── Cleanup on webContents destroy ─────────────────────────────────────

  ipcMain.on("renderer-disconnected", (_, webContentsId: number) => {
    removeToolkit(webContentsId);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export { CHANNELS as BROWSER_TOOLKIT_CHANNELS };
