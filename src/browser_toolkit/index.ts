/**
 * Browser Toolkit — Module Exports
 *
 * Complete IAB browser toolkit with 100+ methods,
 * consolidated browser tools, and diagnostic capabilities.
 *
 * Adapted from zenith.mjs (v4) for dyad-main's Electron architecture.
 */

// Core toolkit
export { createZenithToolkit } from "./zenith";
export type { ZenithToolkit } from "./zenith";

// Tool definitions
export { TOOL_DEFINITIONS, TOOL_CATEGORIES, TOOL_SOURCES } from "./toolDefinitions";
export type { ToolDefinition, ToolParameter } from "./toolDefinitions";

// Tool executor
export { ToolExecutor } from "./toolExecutor";
export type { ToolCall, ToolResult } from "./toolExecutor";

// Types
export type {
  BrowserBackend,
  PageMeta,
  PageLinks,
  PageImages,
  PageHeadings,
  ElementInfo,
  FormData,
  ButtonInfo,
  InputInfo,
  AttributeMap,
  StyleMap,
  DiagnosticResult,
  ConsoleEntry,
  NetworkEntry,
  ContrastResult,
  ImageAuditEntry,
  LinkCheckEntry,
  UxAuditEntry,
  VisualDiagnosis,
  ZenithOptions,
  ZenithError,
  ZenithErrorCode,
} from "./types";
