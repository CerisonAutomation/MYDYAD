/**
 * Shared utilities for Visual Tools
 *
 * Common patterns used across all 17 visual analysis tools.
 * 100% local - no cloud dependencies.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { escapeXmlAttr } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

// ============================================================================
// Types
// ============================================================================

export interface Issue {
  file: string;
  line: number;
  severity: "low" | "medium" | "high" | "critical";
  message: string;
  fix?: string;
  category?: string;
}

export interface ScanOptions {
  /** File extensions to scan (default: tsx, ts, jsx, js, css, scss) */
  extensions?: RegExp;
  /** Directories to exclude */
  excludeDirs?: Set<string>;
  /** Maximum recursion depth (default: 8) */
  maxDepth?: number;
  /** Maximum number of issues to collect (default: 200) */
  maxIssues?: number;
  /** Maximum file size in bytes to process (default: 1MB) */
  maxFileSize?: number;
  /** Timeout in milliseconds for entire scan (default: 30s) */
  timeoutMs?: number;
  /** Specific file to scan (if provided, only scans this file) */
  filePath?: string;
}

export interface ScanResult<T extends Issue = Issue> {
  issues: T[];
  filesScanned: number;
  filesSkipped: number;
  timedOut: boolean;
}

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_EXCLUDE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "__pycache__",
  ".next",
  "coverage",
  ".cache",
  ".parcel-cache",
  "vendor",
  ".venv",
  "venv",
]);

export const DEFAULT_EXTENSIONS = /\.(tsx?|jsx?|css|scss|less|html)$/;

/** Default maximum file size: 1MB */
export const DEFAULT_MAX_FILE_SIZE = 1024 * 1024;

/** Default timeout: 30 seconds */
export const DEFAULT_TIMEOUT_MS = 30_000;

// ============================================================================
// Path Validation
// ============================================================================

/**
 * Validate that a file path stays within the target app directory.
 * Prevents path traversal attacks.
 */
export function validateFilePath(
  filePath: string,
  targetAppPath: string,
): string {
  const resolved = path.resolve(targetAppPath, filePath);
  const resolvedRoot = path.resolve(targetAppPath);
  if (!resolved.startsWith(resolvedRoot)) {
    throw new DyadError(
      "File path escapes the target app directory",
      DyadErrorKind.Validation,
    );
  }
  return resolved;
}

// ============================================================================
// File Scanning
// ============================================================================

/**
 * Recursively scan a directory for files matching the given extensions.
 * Includes timeout protection and file size guards.
 */
export async function scanDirectory<T extends Issue>(
  dir: string,
  callback: (
    filePath: string,
    content: string,
    relativePath: string,
  ) => T[] | Promise<T[]>,
  options: ScanOptions = {},
): Promise<ScanResult<T>> {
  const {
    extensions = DEFAULT_EXTENSIONS,
    excludeDirs = DEFAULT_EXCLUDE_DIRS,
    maxDepth = 8,
    maxIssues = 200,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const issues: T[] = [];
  let filesScanned = 0;
  let filesSkipped = 0;
  let timedOut = false;
  const startTime = Date.now();

  const scan = async (currentDir: string, depth: number): Promise<void> => {
    // Check timeout
    if (Date.now() - startTime > timeoutMs) {
      timedOut = true;
      return;
    }

    if (depth > maxDepth || issues.length >= maxIssues) return;

    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (excludeDirs.has(entry.name) || entry.name.startsWith(".")) continue;
      if (issues.length >= maxIssues || timedOut) break;

      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await scan(fullPath, depth + 1);
      } else if (extensions.test(entry.name)) {
        try {
          // Check file size before reading
          const stat = await fs.stat(fullPath);
          if (stat.size > maxFileSize) {
            filesSkipped++;
            continue;
          }

          // Check timeout again before reading
          if (Date.now() - startTime > timeoutMs) {
            timedOut = true;
            break;
          }

          const content = await fs.readFile(fullPath, "utf-8");
          const relativePath = path.relative(dir, fullPath);
          const results = await callback(fullPath, content, relativePath);
          issues.push(...results);
          filesScanned++;
        } catch {
          // Skip unreadable files
          filesSkipped++;
        }
      }
    }
  };

  await scan(dir, 0);
  return {
    issues: issues.slice(0, maxIssues),
    filesScanned,
    filesSkipped,
    timedOut,
  };
}

/**
 * Scan a single file with size guard.
 */
export async function scanFile<T>(
  filePath: string,
  rootDir: string,
  callback: (
    filePath: string,
    content: string,
    relativePath: string,
  ) => T[] | Promise<T[]>,
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
): Promise<T[]> {
  try {
    // Check file size before reading
    const stat = await fs.stat(filePath);
    if (stat.size > maxFileSize) {
      return [];
    }

    const content = await fs.readFile(filePath, "utf-8");
    const relativePath = path.relative(rootDir, filePath);
    return await callback(filePath, content, relativePath);
  } catch {
    return [];
  }
}

// ============================================================================
// Safe File Reading
// ============================================================================

/**
 * Safely read a file with size and timeout guards.
 * Returns null if file is too large, unreadable, or times out.
 */
export async function safeReadFile(
  filePath: string,
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
  timeoutMs = 5000,
): Promise<string | null> {
  try {
    // Check file size
    const stat = await fs.stat(filePath);
    if (stat.size > maxFileSize) {
      return null;
    }

    // Read with timeout - clear the timer if the read wins the race
    let timer: ReturnType<typeof setTimeout>;
    const content = await Promise.race([
      fs.readFile(filePath, "utf-8").then((c) => {
        clearTimeout(timer);
        return c;
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Read timeout")), timeoutMs);
      }),
    ]);

    return content;
  } catch {
    return null;
  }
}

/**
 * Validate that a directory exists and is accessible.
 */
export async function validateDirectory(dirPath: string): Promise<boolean> {
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

// ============================================================================
// Issue Formatting
// ============================================================================

/**
 * Format a single issue for output.
 */
export function formatIssue(issue: Issue, index: number): string {
  const fix = issue.fix ? `\n   Fix: ${issue.fix}` : "";
  return `${index + 1}. ${issue.file}:${issue.line} [${issue.severity}] ${issue.message}${fix}`;
}

/**
 * Format multiple issues for output.
 */
export function formatIssues(issues: Issue[], maxItems = 25): string {
  const sorted = [...issues].sort((a, b) => {
    const order = { critical: 0, high: 1, medium: 2, low: 3 };
    return (order[a.severity] ?? 4) - (order[b.severity] ?? 4);
  });

  return sorted
    .slice(0, maxItems)
    .map((issue, i) => formatIssue(issue, i))
    .join("\n\n");
}

/**
 * Generate a summary of issues by severity.
 */
export function summarizeIssues(issues: Issue[]): string {
  const counts = issues.reduce(
    (acc, issue) => {
      acc[issue.severity] = (acc[issue.severity] || 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  return Object.entries(counts)
    .map(([severity, count]) => `${count} ${severity}`)
    .join(", ");
}

// ============================================================================
// XML Helpers
// ============================================================================

/**
 * Build XML attributes string from key-value pairs.
 */
export function buildXmlAttributes(
  attrs: Record<string, string | number | undefined>,
): string {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}="${escapeXmlAttr(String(value))}"`)
    .join(" ");
}

/**
 * Build the opening XML tag with attributes.
 */
export function buildOpeningTag(
  tagName: string,
  attrs: Record<string, string | number | undefined>,
  content?: string,
): string {
  const attrStr = buildXmlAttributes(attrs);
  const attrsXml = attrStr ? ` ${attrStr}` : "";
  if (content !== undefined) {
    return `<${tagName}${attrsXml}>${content}</${tagName}>`;
  }
  return `<${tagName}${attrsXml}>`;
}

// ============================================================================
// Pattern Matching
// ============================================================================

/**
 * Extract line numbers where a pattern matches.
 */
export function findPatternMatches(content: string, pattern: RegExp): number[] {
  const matches: number[] = [];
  const lines = content.split("\n");
  lines.forEach((line, i) => {
    if (pattern.test(line)) {
      matches.push(i + 1);
    }
  });
  return matches;
}

/**
 * Check if content has any of the given patterns.
 */
export function hasPattern(content: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(content));
}

// ============================================================================
// Severity Helpers
// ============================================================================

/**
 * Calculate a health score from issues (0-100).
 */
export function calculateHealthScore(issues: Issue[]): number {
  let score = 100;
  for (const issue of issues) {
    switch (issue.severity) {
      case "critical":
        score -= 15;
        break;
      case "high":
        score -= 10;
        break;
      case "medium":
        score -= 5;
        break;
      case "low":
        score -= 2;
        break;
    }
  }
  return Math.max(0, score);
}

/**
 * Get severity label for display.
 */
export function severityLabel(score: number): string {
  if (score >= 90) return "EXCELLENT";
  if (score >= 75) return "GOOD";
  if (score >= 50) return "NEEDS_WORK";
  return "POOR";
}
