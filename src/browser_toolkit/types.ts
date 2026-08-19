/**
 * IAB Browser Toolkit — Types
 *
 * Adapted from zenith.mjs for dyad-main's Electron architecture.
 * Provides unified browser automation API across IAB, CDP, and extension modes.
 */

export type BrowserBackend = "electron" | "cdp" | "iab" | "extension";

export interface PageMeta {
  url: string;
  title: string;
  readyState: string;
  timestamp: number;
}

export interface PageLinks {
  links: Array<{ text: string; href: string; title?: string }>;
  count: number;
}

export interface PageImages {
  images: Array<{ src: string; alt: string; width: number; height: number }>;
  count: number;
}

export interface PageHeadings {
  headings: Array<{ level: number; text: string; id?: string }>;
  count: number;
}

export interface ElementInfo {
  tag: string;
  text: string;
  id?: string;
  classes: string[];
  rect: { x: number; y: number; w: number; h: number };
}

export interface FormData {
  formIndex: number;
  action: string;
  method: string;
  inputs: Array<{
    name: string;
    type: string;
    value: string;
    placeholder?: string;
  }>;
}

export interface ButtonInfo {
  index: number;
  text: string;
  type: string;
  disabled: boolean;
  rect: { x: number; y: number; w: number; h: number };
}

export interface InputInfo {
  index: number;
  name: string;
  type: string;
  value: string;
  placeholder?: string;
  required: boolean;
  rect: { x: number; y: number; w: number; h: number };
}

export interface AttributeMap {
  [key: string]: string;
}

export interface StyleMap {
  [key: string]: string;
}

export interface DiagnosticResult {
  tool: string;
  timestamp: number;
  data: unknown;
  warnings: string[];
  errors: string[];
}

export interface ConsoleEntry {
  level: string;
  text: string;
  source?: string;
  timestamp: number;
}

export interface NetworkEntry {
  url: string;
  method: string;
  status: number;
  type: string;
  size: number;
  duration: number;
  timestamp: number;
}

export interface ContrastResult {
  element: string;
  foreground: string;
  background: string;
  ratio: number;
  passes: boolean;
  level: "AAA" | "AA" | "A" | "fail";
}

export interface ImageAuditEntry {
  src: string;
  alt: string;
  hasAlt: boolean;
  isDecorative: boolean;
  width: number;
  height: number;
  format: string;
  size: number;
  issues: string[];
}

export interface LinkCheckEntry {
  href: string;
  text: string;
  status: "valid" | "broken" | "redirect" | "timeout" | "error";
  statusCode?: number;
  redirectUrl?: string;
}

export interface UxAuditEntry {
  category: string;
  severity: "info" | "warning" | "error";
  message: string;
  element?: string;
  suggestion?: string;
}

export interface VisualDiagnosis {
  hasViewportMeta: boolean;
  viewportWidth: number;
  viewportHeight: number;
  responsiveBreakpoints: number[];
  hasHorizontalScroll: boolean;
  imagesWithoutAlt: number;
  linksWithoutText: number;
  formsWithoutLabels: number;
  colorContrastIssues: number;
  score: number;
}

export interface ZenithOptions {
  backend?: BrowserBackend;
  retries?: number;
  retryDelay?: number;
  verbosity?: "concise" | "verbose" | "minimal";
}

export type ZenithErrorCode =
  | "BOOTSTRAP"
  | "NAVIGATION"
  | "ELEMENT"
  | "INTERACTION"
  | "SANDBOX"
  | "TIMEOUT"
  | "BACKEND"
  | "UNKNOWN";

export interface ZenithError {
  code: ZenithErrorCode;
  message: string;
  suggestion: string;
}
