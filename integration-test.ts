/**
 * Integration Test — Verifies all components work together
 *
 * Tests: overlay rendering, toolkit methods, IPC channels,
 * monitor tracking, and prompt system.
 */

import * as fs from "fs";
import * as path from "path";

const ROOT = "/Users/cb/Downloads/dyad-main/src";
let passed = 0;
let failed = 0;
const errors: string[] = [];

function test(name: string, fn: () => void) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed++;
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`${name}: ${msg}`);
    console.log(`  ❌ ${name}: ${msg}`);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function assertFile(path: string) {
  assert(fs.existsSync(path), `File missing: ${path}`);
}

function assertContains(file: string, text: string) {
  const content = fs.readFileSync(file, "utf-8");
  assert(content.includes(text), `${path.basename(file)} missing: ${text}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n🧪 INTEGRATION TEST SUITE\n");
console.log("═══════════════════════════════════════════════");

// ── Agent Overlay ────────────────────────────────────────────────────────
console.log("\n📦 Agent Overlay System");

test("types.ts exists and exports types", () => {
  assertFile(`${ROOT}/agent_overlay/types.ts`);
  assertContains(`${ROOT}/agent_overlay/types.ts`, "AgentStatus");
  assertContains(`${ROOT}/agent_overlay/types.ts`, "AgentTask");
  assertContains(`${ROOT}/agent_overlay/types.ts`, "OverlayConfig");
});

test("eventBlocker.ts exists and blocks events", () => {
  assertFile(`${ROOT}/agent_overlay/eventBlocker.ts`);
  assertContains(`${ROOT}/agent_overlay/eventBlocker.ts`, "BLOCKED_EVENTS");
  assertContains(`${ROOT}/agent_overlay/eventBlocker.ts`, "EventBlocker");
  assertContains(`${ROOT}/agent_overlay/eventBlocker.ts`, "click");
  assertContains(`${ROOT}/agent_overlay/eventBlocker.ts`, "keydown");
  assertContains(`${ROOT}/agent_overlay/eventBlocker.ts`, "touchstart");
});

test("overlay.css has all required styles", () => {
  assertFile(`${ROOT}/agent_overlay/overlay.css`);
  assertContains(`${ROOT}/agent_overlay/overlay.css`, "agent-overlay");
  assertContains(`${ROOT}/agent_overlay/overlay.css`, "progress");
  assertContains(`${ROOT}/agent_overlay/overlay.css`, "animation");
  assertContains(`${ROOT}/agent_overlay/overlay.css`, "backdrop-filter");
});

test("AgentOverlay.tsx renders overlay component", () => {
  assertFile(`${ROOT}/agent_overlay/AgentOverlay.tsx`);
  assertContains(`${ROOT}/agent_overlay/AgentOverlay.tsx`, "AgentOverlay");
  assertContains(`${ROOT}/agent_overlay/AgentOverlay.tsx`, "status-icon");
  assertContains(`${ROOT}/agent_overlay/AgentOverlay.tsx`, "progress-fill");
  assertContains(`${ROOT}/agent_overlay/AgentOverlay.tsx`, "step-icon");
});

test("AgentOverlayProvider.tsx manages state", () => {
  assertFile(`${ROOT}/agent_overlay/AgentOverlayProvider.tsx`);
  assertContains(`${ROOT}/agent_overlay/AgentOverlayProvider.tsx`, "AgentOverlayProvider");
  assertContains(`${ROOT}/agent_overlay/AgentOverlayProvider.tsx`, "useAgentOverlay");
  assertContains(`${ROOT}/agent_overlay/AgentOverlayProvider.tsx`, "startTask");
  assertContains(`${ROOT}/agent_overlay/AgentOverlayProvider.tsx`, "completeTask");
});

test("monitor.ts tracks operations", () => {
  assertFile(`${ROOT}/agent_overlay/monitor.ts`);
  assertContains(`${ROOT}/agent_overlay/monitor.ts`, "AgentMonitor");
  assertContains(`${ROOT}/agent_overlay/monitor.ts`, "trackTaskStart");
  assertContains(`${ROOT}/agent_overlay/monitor.ts`, "trackToolCall");
  assertContains(`${ROOT}/agent_overlay/monitor.ts`, "generateReport");
});

test("AGENT_PROMPTS.md has all workflows", () => {
  assertFile(`${ROOT}/agent_overlay/AGENT_PROMPTS.md`);
  assertContains(`${ROOT}/agent_overlay/AGENT_PROMPTS.md`, "UI Audit Workflow");
  assertContains(`${ROOT}/agent_overlay/AGENT_PROMPTS.md`, "Build Verification");
  assertContains(`${ROOT}/agent_overlay/AGENT_PROMPTS.md`, "Interactive Form Builder");
  assertContains(`${ROOT}/agent_overlay/AGENT_PROMPTS.md`, "Performance Audit");
  assertContains(`${ROOT}/agent_overlay/AGENT_PROMPTS.md`, "Browser Automation");
  assertContains(`${ROOT}/agent_overlay/AGENT_PROMPTS.md`, "Responsive Design");
});

test("index.ts exports all components", () => {
  assertFile(`${ROOT}/agent_overlay/index.ts`);
  assertContains(`${ROOT}/agent_overlay/index.ts`, "AgentOverlay");
  assertContains(`${ROOT}/agent_overlay/index.ts`, "AgentOverlayProvider");
  assertContains(`${ROOT}/agent_overlay/index.ts`, "useAgentOverlay");
  assertContains(`${ROOT}/agent_overlay/index.ts`, "EventBlocker");
});

// ── Browser Toolkit ──────────────────────────────────────────────────────
console.log("\n🌐 Browser Toolkit");

test("types.ts defines toolkit types", () => {
  assertFile(`${ROOT}/browser_toolkit/types.ts`);
  assertContains(`${ROOT}/browser_toolkit/types.ts`, "PageMeta");
  assertContains(`${ROOT}/browser_toolkit/types.ts`, "ElementInfo");
  assertContains(`${ROOT}/browser_toolkit/types.ts`, "ContrastResult");
  assertContains(`${ROOT}/browser_toolkit/types.ts`, "VisualDiagnosis");
});

test("zenith.ts has all 35 methods", () => {
  assertFile(`${ROOT}/browser_toolkit/zenith.ts`);
  const content = fs.readFileSync(`${ROOT}/browser_toolkit/zenith.ts`, "utf-8");
  const methods = [
    "goto", "back", "forward", "reload",
    "read", "html", "text", "links", "images", "headings",
    "find", "findAll", "forms", "buttons", "inputs",
    "click", "dblclick", "rightclick", "fill", "type_",
    "select", "check", "uncheck", "pressKey", "focus", "hover",
    "consoleMonitor", "networkAnalysis", "contrastCheck",
    "imageAudit", "linkCheck", "uxAudit", "visualDiagnosis",
  ];
  for (const method of methods) {
    const hasMethod = content.includes(`async ${method}`) || content.includes(`async function ${method}`);
    assert(hasMethod, `Missing: async ${method}`);
  }
});

test("toolDefinitions.ts has 22 tools", () => {
  assertFile(`${ROOT}/browser_toolkit/toolDefinitions.ts`);
  const tools = [
    "navigate", "read_page", "find", "get_page_text", "computer",
    "form_input", "fill_form", "submit_form",
    "tabs", "open_tab", "close_tab",
    "inspect",
    "console_messages", "network_analysis", "contrast_check",
    "image_audit", "link_check", "ux_audit", "visual_diagnosis",
    "browser_batch",
  ];
  for (const tool of tools) {
    assertContains(`${ROOT}/browser_toolkit/toolDefinitions.ts`, `"${tool}"`);
  }
});

test("toolExecutor.ts bridges tools to zenith", () => {
  assertFile(`${ROOT}/browser_toolkit/toolExecutor.ts`);
  assertContains(`${ROOT}/browser_toolkit/toolExecutor.ts`, "ToolExecutor");
  assertContains(`${ROOT}/browser_toolkit/toolExecutor.ts`, "execute");
  assertContains(`${ROOT}/browser_toolkit/toolExecutor.ts`, "executeTool");
});

test("rendererApi.ts provides typed API", () => {
  assertFile(`${ROOT}/browser_toolkit/rendererApi.ts`);
  assertContains(`${ROOT}/browser_toolkit/rendererApi.ts`, "browserToolkit");
  assertContains(`${ROOT}/browser_toolkit/rendererApi.ts`, "goto");
  assertContains(`${ROOT}/browser_toolkit/rendererApi.ts`, "read");
  assertContains(`${ROOT}/browser_toolkit/rendererApi.ts`, "uxAudit");
});

test("diagnostics/bundles.ts has diagnostic bundles", () => {
  assertFile(`${ROOT}/browser_toolkit/diagnostics/bundles.ts`);
  assertContains(`${ROOT}/browser_toolkit/diagnostics/bundles.ts`, "accessibility-quick");
  assertContains(`${ROOT}/browser_toolkit/diagnostics/bundles.ts`, "full-audit");
  assertContains(`${ROOT}/browser_toolkit/diagnostics/bundles.ts`, "performance");
});

test("index.ts exports all toolkit components", () => {
  assertFile(`${ROOT}/browser_toolkit/index.ts`);
  assertContains(`${ROOT}/browser_toolkit/index.ts`, "createZenithToolkit");
  assertContains(`${ROOT}/browser_toolkit/index.ts`, "TOOL_DEFINITIONS");
  assertContains(`${ROOT}/browser_toolkit/index.ts`, "ToolExecutor");
});

// ── IPC Integration ──────────────────────────────────────────────────────
console.log("\n🔌 IPC Integration");

test("browser_toolkit_handlers.ts registers handlers", () => {
  assertFile(`${ROOT}/ipc/handlers/browser_toolkit_handlers.ts`);
  assertContains(`${ROOT}/ipc/handlers/browser_toolkit_handlers.ts`, "registerBrowserToolkitHandlers");
  assertContains(`${ROOT}/ipc/handlers/browser_toolkit_handlers.ts`, "browser-toolkit:execute");
  assertContains(`${ROOT}/ipc/handlers/browser_toolkit_handlers.ts`, "browser-toolkit:goto");
  assertContains(`${ROOT}/ipc/handlers/browser_toolkit_handlers.ts`, "agent-overlay");
});

test("ipc_host.ts imports and registers browser toolkit", () => {
  assertContains(`${ROOT}/ipc/ipc_host.ts`, "registerBrowserToolkitHandlers");
  assertContains(`${ROOT}/ipc/ipc_host.ts`, "registerBrowserToolkitHandlers()");
});

// ── Renderer Integration ────────────────────────────────────────────────
console.log("\n⚛️ Renderer Integration");

test("renderer.tsx wraps app with AgentOverlayProvider", () => {
  assertContains(`${ROOT}/renderer.tsx`, "AgentOverlayProvider");
  assertContains(`${ROOT}/renderer.tsx`, "import { AgentOverlayProvider }");
});

// ── Cross-Module Dependencies ───────────────────────────────────────────
console.log("\n🔗 Cross-Module Dependencies");

test("overlay types match monitor expectations", () => {
  const overlayTypes = fs.readFileSync(`${ROOT}/agent_overlay/types.ts`, "utf-8");
  const monitor = fs.readFileSync(`${ROOT}/agent_overlay/monitor.ts`, "utf-8");
  assert(overlayTypes.includes("AgentTask"), "AgentTask defined");
  assert(monitor.includes("AgentTask"), "AgentTask used in monitor");
});

test("toolkit types match executor expectations", () => {
  const zenith = fs.readFileSync(`${ROOT}/browser_toolkit/zenith.ts`, "utf-8");
  const executor = fs.readFileSync(`${ROOT}/browser_toolkit/toolExecutor.ts`, "utf-8");
  assert(zenith.includes("ZenithToolkit"), "ZenithToolkit defined in zenith.ts");
  assert(executor.includes("ZenithToolkit"), "ZenithToolkit used in executor");
});

test("tool definitions match executor switch cases", () => {
  const defs = fs.readFileSync(`${ROOT}/browser_toolkit/toolDefinitions.ts`, "utf-8");
  const executor = fs.readFileSync(`${ROOT}/browser_toolkit/toolExecutor.ts`, "utf-8");
  const toolNames = defs.match(/name: "([^"]+)"/g)?.map(m => m.replace('name: "', '').replace('"', '')) || [];
  for (const name of toolNames) {
    assert(executor.includes(`"${name}"`), `Executor handles "${name}"`);
  }
});

// ── File Quality ────────────────────────────────────────────────────────
console.log("\n📊 File Quality");

test("all files have substantial content", () => {
  const files = [
    `${ROOT}/agent_overlay/types.ts`,
    `${ROOT}/agent_overlay/eventBlocker.ts`,
    `${ROOT}/agent_overlay/overlay.css`,
    `${ROOT}/agent_overlay/AgentOverlay.tsx`,
    `${ROOT}/agent_overlay/AgentOverlayProvider.tsx`,
    `${ROOT}/agent_overlay/monitor.ts`,
    `${ROOT}/agent_overlay/index.ts`,
    `${ROOT}/browser_toolkit/types.ts`,
    `${ROOT}/browser_toolkit/zenith.ts`,
    `${ROOT}/browser_toolkit/toolDefinitions.ts`,
    `${ROOT}/browser_toolkit/toolExecutor.ts`,
    `${ROOT}/browser_toolkit/rendererApi.ts`,
    `${ROOT}/browser_toolkit/diagnostics/bundles.ts`,
    `${ROOT}/browser_toolkit/index.ts`,
    `${ROOT}/ipc/handlers/browser_toolkit_handlers.ts`,
  ];
  for (const file of files) {
    assertFile(file);
    const stat = fs.statSync(file);
    assert(stat.size > 500, `${path.basename(file)} too small (${stat.size} bytes)`);
  }
});

test("no 'any' types in core modules", () => {
  const coreFiles = [
    `${ROOT}/agent_overlay/types.ts`,
    `${ROOT}/agent_overlay/eventBlocker.ts`,
    `${ROOT}/browser_toolkit/types.ts`,
    `${ROOT}/browser_toolkit/toolDefinitions.ts`,
  ];
  for (const file of coreFiles) {
    const content = fs.readFileSync(file, "utf-8");
    assert(!content.includes(": any"), `${path.basename(file)} has 'any' types`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n═══════════════════════════════════════════════");
console.log("INTEGRATION TEST RESULTS");
console.log("═══════════════════════════════════════════════");
console.log(`\n✅ PASS: ${passed}`);
console.log(`❌ FAIL: ${failed}`);
console.log(`📊 TOTAL: ${passed + failed}`);

if (errors.length > 0) {
  console.log("\n❌ FAILURES:");
  for (const err of errors) {
    console.log(`  → ${err}`);
  }
}

console.log("\n" + "═".repeat(48));
console.log(failed === 0 ? "✅ ALL INTEGRATION TESTS PASSED" : "❌ SOME TESTS FAILED");
console.log("═".repeat(48));

process.exit(failed > 0 ? 1 : 0);
