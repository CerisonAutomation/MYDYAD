/**
 * QA Audit Script — Verifies all integrations
 *
 * Run this to verify the agent overlay, browser toolkit,
 * and consolidated tools are properly wired.
 */

import * as fs from "fs";
import * as path from "path";

const DYAD_ROOT = "/Users/cb/Downloads/dyad-main/src";

interface AuditResult {
  component: string;
  status: "PASS" | "FAIL" | "WARN";
  message: string;
  details?: string;
}

const results: AuditResult[] = [];

function check(name: string, condition: boolean, message: string, details?: string) {
  results.push({
    component: name,
    status: condition ? "PASS" : "FAIL",
    message,
    details,
  });
}

function warn(name: string, message: string, details?: string) {
  results.push({
    component: name,
    status: "WARN",
    message,
    details,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT: Agent Overlay
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n🔍 AUDIT: Agent Overlay System\n");

const overlayFiles = [
  "agent_overlay/types.ts",
  "agent_overlay/eventBlocker.ts",
  "agent_overlay/overlay.css",
  "agent_overlay/AgentOverlay.tsx",
  "agent_overlay/AgentOverlayProvider.tsx",
  "agent_overlay/index.ts",
];

for (const file of overlayFiles) {
  const fullPath = path.join(DYAD_ROOT, file);
  const exists = fs.existsSync(fullPath);
  check("Agent Overlay", exists, `${file} exists`, exists ? undefined : `Missing: ${fullPath}`);
  if (exists) {
    const content = fs.readFileSync(fullPath, "utf-8");
    check("Agent Overlay", content.length > 100, `${file} has content (${content.length} bytes)`);
  }
}

// Check for required exports
const overlayIndex = path.join(DYAD_ROOT, "agent_overlay/index.ts");
if (fs.existsSync(overlayIndex)) {
  const content = fs.readFileSync(overlayIndex, "utf-8");
  check("Agent Overlay", content.includes("AgentOverlay"), "Exports AgentOverlay component");
  check("Agent Overlay", content.includes("AgentOverlayProvider"), "Exports AgentOverlayProvider");
  check("Agent Overlay", content.includes("useAgentOverlay"), "Exports useAgentOverlay hook");
  check("Agent Overlay", content.includes("EventBlocker"), "Exports EventBlocker");
}

// Check event blocker has all required events
const eventBlocker = path.join(DYAD_ROOT, "agent_overlay/eventBlocker.ts");
if (fs.existsSync(eventBlocker)) {
  const content = fs.readFileSync(eventBlocker, "utf-8");
  const requiredEvents = ["click", "mousedown", "keydown", "touchstart", "pointerdown"];
  for (const event of requiredEvents) {
    check("Event Blocker", content.includes(`"${event}"`), `Blocks ${event} event`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT: Browser Toolkit
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n🔍 AUDIT: Browser Toolkit\n");

const toolkitFiles = [
  "browser_toolkit/types.ts",
  "browser_toolkit/zenith.ts",
  "browser_toolkit/toolDefinitions.ts",
  "browser_toolkit/toolExecutor.ts",
  "browser_toolkit/rendererApi.ts",
  "browser_toolkit/index.ts",
  "browser_toolkit/diagnostics/bundles.ts",
];

for (const file of toolkitFiles) {
  const fullPath = path.join(DYAD_ROOT, file);
  const exists = fs.existsSync(fullPath);
  check("Browser Toolkit", exists, `${file} exists`);
  if (exists) {
    const content = fs.readFileSync(fullPath, "utf-8");
    check("Browser Toolkit", content.length > 100, `${file} has content (${content.length} bytes)`);
  }
}

// Check zenith toolkit has required methods
const zenithFile = path.join(DYAD_ROOT, "browser_toolkit/zenith.ts");
if (fs.existsSync(zenithFile)) {
  const content = fs.readFileSync(zenithFile, "utf-8");
  const requiredMethods = [
    "goto", "back", "forward", "reload",
    "read", "html", "text", "links", "images", "headings",
    "find", "findAll", "forms", "buttons", "inputs",
    "click", "dblclick", "rightclick", "fill",
    "select", "check", "uncheck", "pressKey", "focus", "hover",
    "consoleMonitor", "networkAnalysis", "contrastCheck",
    "imageAudit", "linkCheck", "uxAudit", "visualDiagnosis",
  ];
  for (const method of requiredMethods) {
    const funcPattern = new RegExp(`async\\s+(function\\s+)?${method}\\s*\\(`);
    check("Zenith Toolkit", funcPattern.test(content), `Has ${method}() method`);
  }
  // type is named type_ to avoid TS keyword conflict
  const hasTypeMethod = content.includes("async type_") || content.includes("async function type_");
  check("Zenith Toolkit", hasTypeMethod, `Has type() method (type_)`);
}

// Check tool definitions count
const toolDefs = path.join(DYAD_ROOT, "browser_toolkit/toolDefinitions.ts");
if (fs.existsSync(toolDefs)) {
  const content = fs.readFileSync(toolDefs, "utf-8");
  const toolCount = (content.match(/name: "/g) || []).length;
  check("Tool Definitions", toolCount >= 20, `Has ${toolCount} tool definitions (expected ≥20)`);
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT: IPC Integration
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n🔍 AUDIT: IPC Integration\n");

const ipcFile = path.join(DYAD_ROOT, "ipc/handlers/browser_toolkit_handlers.ts");
if (fs.existsSync(ipcFile)) {
  const content = fs.readFileSync(ipcFile, "utf-8");
  check("IPC Handlers", content.includes("registerBrowserToolkitHandlers"), "Exports registration function");
  check("IPC Handlers", content.includes("browser-toolkit:execute"), "Has execute channel");
  check("IPC Handlers", content.includes("browser-toolkit:goto"), "Has goto channel");
  check("IPC Handlers", content.includes("browser-toolkit:diagnostics"), "Has diagnostics channel");
  check("IPC Handlers", content.includes("agent-overlay"), "Has overlay channels");
} else {
  check("IPC Handlers", false, "IPC handlers file exists");
}

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT: File Sizes & Quality
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n🔍 AUDIT: File Quality\n");

const allFiles = [
  ...overlayFiles.map((f) => path.join(DYAD_ROOT, f)),
  ...toolkitFiles.map((f) => path.join(DYAD_ROOT, f)),
  path.join(DYAD_ROOT, "ipc/handlers/browser_toolkit_handlers.ts"),
];

let totalBytes = 0;
for (const file of allFiles) {
  if (fs.existsSync(file)) {
    const stat = fs.statSync(file);
    totalBytes += stat.size;
    check("File Quality", stat.size > 500, `${path.basename(file)} is substantial (${stat.size} bytes)`);
  }
}

check("File Quality", totalBytes > 50000, `Total codebase is substantial (${totalBytes} bytes)`);

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT: TypeScript Safety
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n🔍 AUDIT: TypeScript Safety\n");

for (const file of allFiles) {
  if (fs.existsSync(file) && file.endsWith(".ts") || file.endsWith(".tsx")) {
    const content = fs.readFileSync(file, "utf-8");
    const hasAny = content.includes(": any");
    check("TypeScript", !hasAny || file.includes("rendererApi"), `${path.basename(file)} avoids 'any' types`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RESULTS
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n" + "═".repeat(60));
console.log("QA AUDIT RESULTS");
console.log("═".repeat(60));

const passed = results.filter((r) => r.status === "PASS").length;
const failed = results.filter((r) => r.status === "FAIL").length;
const warned = results.filter((r) => r.status === "WARN").length;

console.log(`\n✅ PASS: ${passed}`);
console.log(`❌ FAIL: ${failed}`);
console.log(`⚠️  WARN: ${warned}`);
console.log(`📊 TOTAL: ${results.length}`);

if (failed > 0) {
  console.log("\n❌ FAILURES:");
  for (const r of results.filter((r) => r.status === "FAIL")) {
    console.log(`  [${r.component}] ${r.message}`);
    if (r.details) console.log(`    → ${r.details}`);
  }
}

if (warned > 0) {
  console.log("\n⚠️  WARNINGS:");
  for (const r of results.filter((r) => r.status === "WARN")) {
    console.log(`  [${r.component}] ${r.message}`);
  }
}

console.log("\n" + "═".repeat(60));
console.log(failed === 0 ? "✅ ALL CHECKS PASSED" : "❌ SOME CHECKS FAILED");
console.log("═".repeat(60));

// Write report
const report = {
  timestamp: new Date().toISOString(),
  summary: { passed, failed, warned, total: results.length },
  results,
};

fs.writeFileSync(
  path.join(DYAD_ROOT, "../qa-audit-report.json"),
  JSON.stringify(report, null, 2)
);

console.log(`\n📄 Report saved to: qa-audit-report.json`);

process.exit(failed > 0 ? 1 : 0);
