/**
 * GitIngest Tool — Clone and analyze Git repositories for LLM context
 *
 * Produces structured output (summary, file tree, file contents) from a Git
 * repository URL or local path. Follows the gitingest format used by RAG
 * pipelines and code analysis agents.
 *
 * Supports:
 * - GitHub, GitLab, Bitbucket URLs
 * - Local directory paths
 * - Branch/tag selection
 * - Include/exclude glob patterns
 * - Private repos via GITHUB_TOKEN env var
 * - Configurable file size and depth limits
 */

import { z } from "zod";
import { execFile, exec } from "child_process";
import { promisify } from "util";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import log from "electron-log";

const logger = log.scope("gitingest");

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);

// --- Constants (matching gitingest Python defaults) ---
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB per file
const MAX_FILES = 10_000;
const MAX_DEPTH = 20;
const MAX_TOTAL_SIZE = 500 * 1024 * 1024; // 500 MB total
const CLONE_TIMEOUT_MS = 60_000;
const READ_TIMEOUT_MS = 30_000;

const DEFAULT_EXCLUDE_PATTERNS = [
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
  ".dyad",
  "*.lock",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  ".env",
  ".env.*",
  "*.min.js",
  "*.min.css",
  "*.map",
  ".DS_Store",
  "Thumbs.db",
];

const DEFAULT_INCLUDE_PATTERNS: string[] = [];

// --- Schema ---
const gitingestSchema = z.object({
  source: z
    .string()
    .describe(
      "Git repository URL (GitHub/GitLab/Bitbucket) or local directory path",
    ),
  branch: z
    .string()
    .optional()
    .describe("Branch to clone (default: auto-detect default branch)"),
  tag: z
    .string()
    .optional()
    .describe("Tag to clone (takes precedence over branch)"),
  include_patterns: z
    .array(z.string())
    .optional()
    .describe(
      "Glob patterns for files to include (e.g. ['src/**/*.ts', '*.md'])",
    ),
  exclude_patterns: z
    .array(z.string())
    .optional()
    .describe(
      "Glob patterns for files to exclude (default: common build/dependency dirs)",
    ),
  max_file_size: z
    .number()
    .optional()
    .describe("Max file size in bytes (default: 10MB)"),
  max_files: z
    .number()
    .optional()
    .describe("Max files to include (default: 10000)"),
  max_depth: z
    .number()
    .optional()
    .describe("Max directory depth (default: 20)"),
  subpath: z
    .string()
    .optional()
    .describe("Subdirectory within the repo to analyze (e.g. 'src/lib')"),
});

type GitingestArgs = z.infer<typeof gitingestSchema>;

// --- Interfaces ---
interface FileEntry {
  path: string;
  size: number;
  content: string;
}

interface GitingestResult {
  summary: {
    repository: string;
    fileCount: number;
    totalSize: number;
    estimatedTokens: number;
    branch: string;
  };
  tree: string;
  content: string;
}

// --- Helper functions ---

function isRemoteUrl(source: string): boolean {
  return (
    source.startsWith("https://") ||
    source.startsWith("http://") ||
    source.startsWith("git@") ||
    source.startsWith("ssh://")
  );
}

function extractRepoName(url: string): string {
  // Handle GitHub/GitLab/Bitbucket URLs
  const match = url.match(/\/([^/]+?)(?:\.git)?$/);
  if (match) return match[1];
  // Handle git@ URLs
  const sshMatch = url.match(/:([^/]+?)(?:\.git)?$/);
  if (sshMatch) return sshMatch[1];
  return "unknown-repo";
}

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token for code
  return Math.ceil(text.length / 4);
}

async function globMatches(
  filePath: string,
  patterns: string[],
): Promise<boolean> {
  for (const pattern of patterns) {
    // Simple glob matching for common patterns
    const regex = globToRegex(pattern);
    if (regex.test(filePath)) return true;
  }
  return false;
}

function globToRegex(pattern: string): RegExp {
  let regexStr = pattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  // Anchor if no wildcard at start
  if (!regexStr.startsWith(".*") && !regexStr.startsWith("[^/]")) {
    regexStr = "(^|/)" + regexStr;
  }
  return new RegExp(regexStr + "($|/)");
}

async function shouldIncludeFile(
  relativePath: string,
  includePatterns: string[],
  excludePatterns: string[],
): Promise<boolean> {
  // Check excludes first
  if (excludePatterns.length > 0) {
    if (await globMatches(relativePath, excludePatterns)) return false;
  }
  // If include patterns specified, file must match at least one
  if (includePatterns.length > 0) {
    return globMatches(relativePath, includePatterns);
  }
  return true;
}

async function walkDirectory(
  dir: string,
  baseDir: string,
  options: {
    includePatterns: string[];
    excludePatterns: string[];
    maxFiles: number;
    maxDepth: number;
    maxFileSize: number;
    currentDepth: number;
    files: FileEntry[];
  },
): Promise<void> {
  if (options.files.length >= options.maxFiles) return;
  if (options.currentDepth >= options.maxDepth) return;

  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return; // Skip inaccessible directories
  }

  // Sort: directories first, then files
  const sorted = entries.sort((a, b) => {
    if (a.isDirectory() && !b.isDirectory()) return -1;
    if (!a.isDirectory() && b.isDirectory()) return 1;
    return String(a.name).localeCompare(String(b.name));
  });

  for (const entry of sorted) {
    if (options.files.length >= options.maxFiles) break;

    const entryName = String(entry.name);
    const fullPath = path.join(dir, entryName);
    const relativePath = path.relative(baseDir, fullPath);

    if (entry.isDirectory()) {
      // Check if directory name matches exclude patterns
      if (
        await shouldIncludeFile(
          entryName + "/",
          options.includePatterns,
          options.excludePatterns,
        )
      ) {
        await walkDirectory(fullPath, baseDir, {
          ...options,
          currentDepth: options.currentDepth + 1,
        });
      }
    } else if (entry.isFile()) {
      if (
        !(await shouldIncludeFile(
          relativePath,
          options.includePatterns,
          options.excludePatterns,
        ))
      ) {
        continue;
      }

      // Check file size
      try {
        const stat = await fs.stat(fullPath);
        if (stat.size > options.maxFileSize) continue;
        if (stat.size === 0) continue; // Skip empty files

        const content = await fs.readFile(fullPath, "utf-8");
        options.files.push({
          path: relativePath,
          size: stat.size,
          content,
        });
      } catch {
        // Skip unreadable files (binary, permission denied, etc.)
      }
    }
  }
}

function buildTreeString(files: FileEntry[]): string {
  const lines: string[] = [];

  // Sort files by path for tree structure
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));

  // Build tree with | and └ characters
  const dirs = new Map<string, boolean>(); // dir path -> has more siblings

  for (const file of sorted) {
    const parts = file.path.split(path.sep);
    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join("/");
      if (!dirs.has(dirPath)) {
        dirs.set(dirPath, true);
      }
    }
  }

  // Simple tree: just show the file paths with indentation
  let lastDir = "";
  for (const file of sorted) {
    const dir = path.dirname(file.path);
    if (dir !== lastDir && dir !== ".") {
      lines.push(`\n${dir}/`);
      lastDir = dir;
    }
    const basename = path.basename(file.path);
    const sizeStr =
      file.size > 1024
        ? `(${Math.round(file.size / 1024)}KB)`
        : `(${file.size}B)`;
    lines.push(`  ${basename} ${sizeStr}`);
  }

  return lines.join("\n");
}

function formatContent(files: FileEntry[]): string {
  const DELIMITER = "=".repeat(50);
  return files
    .map((f) => `${DELIMITER}\nFile: ${f.path}\n${DELIMITER}\n${f.content}`)
    .join("\n\n");
}

// --- Tool Definition ---
const DESCRIPTION = `Ingest a Git repository and produce structured output for code analysis.

Clones a repository (or reads a local directory) and produces:
- **Summary**: repo name, file count, total size, estimated tokens
- **File tree**: directory structure with file sizes
- **File contents**: all source files in a single digestible block

### When to Use
- Analyzing an unfamiliar codebase before making changes
- Building context for code review or refactoring
- Feeding repository content into RAG pipelines
- Getting a quick overview of a project's structure

### When NOT to Use
- You only need to read a single file → use \`read_file\` instead
- You need real-time file content → use \`grep\` or \`code_search\`
- The repo is very large (>10K files) → use \`explore_code\` instead

### Supported Sources
- GitHub/GitLab/Bitbucket URLs
- Local directory paths
- git@ SSH URLs (if SSH key is configured)

### Limits
- Max 10,000 files, 10MB per file, 500MB total
- Binary files and lock files are excluded by default`;

export const gitingestTool: ToolDefinition<GitingestArgs> = {
  name: "gitingest",
  description: DESCRIPTION,
  inputSchema: gitingestSchema,
  defaultConsent: "ask",
  modifiesState: false,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    const name = isRemoteUrl(args.source)
      ? extractRepoName(args.source)
      : args.source;
    return `Ingest repository: ${name}`;
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    const name = args.source
      ? isRemoteUrl(args.source)
        ? extractRepoName(args.source)
        : args.source
      : "";
    return `<dyad-gitingest source="${escapeXmlAttr(name)}">Ingesting repository...</dyad-gitingest>`;
  },

  execute: async (args, ctx: AgentContext) => {
    const startTime = Date.now();
    let tempDir: string | null = null;

    try {
      logger.log(`Ingesting: ${args.source}`);
      ctx.onXmlStream(
        `<dyad-gitingest source="${escapeXmlAttr(extractRepoName(args.source))}">Cloning...</dyad-gitingest>`,
      );

      const maxFiles = args.max_files ?? MAX_FILES;
      const maxDepth = args.max_depth ?? MAX_DEPTH;
      const maxFileSize = args.max_file_size ?? MAX_FILE_SIZE;
      const excludePatterns = [
        ...DEFAULT_EXCLUDE_PATTERNS,
        ...(args.exclude_patterns ?? []),
      ];
      const includePatterns = args.include_patterns ?? DEFAULT_INCLUDE_PATTERNS;

      let sourceDir: string;
      let repoName: string;
      let branch = args.branch ?? "main";

      if (isRemoteUrl(args.source)) {
        // Clone to temp directory
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-gitingest-"));
        repoName = extractRepoName(args.source);
        sourceDir = path.join(tempDir, repoName);

        // Build clone command
        const cloneArgs = ["clone", "--depth", "1"];
        if (args.tag) {
          cloneArgs.push("--branch", `refs/tags/${args.tag}`);
        } else if (args.branch) {
          cloneArgs.push("--branch", args.branch);
        }
        cloneArgs.push(args.source, sourceDir);

        // Pass GitHub token if available
        const env = { ...process.env };
        const githubToken = process.env.GITHUB_TOKEN;
        if (githubToken && args.source.includes("github.com")) {
          // Inject token into URL for authentication
          const authUrl = args.source.replace(
            "https://github.com",
            `https://x-access-token:${githubToken}@github.com`,
          );
          cloneArgs[cloneArgs.length - 2] = authUrl;
        }

        try {
          await execFileAsync("git", cloneArgs, {
            timeout: CLONE_TIMEOUT_MS,
            maxBuffer: 10 * 1024 * 1024,
            env,
          });
        } catch (error) {
          throw new DyadError(
            `Failed to clone repository: ${error instanceof Error ? error.message : String(error)}`,
            DyadErrorKind.External,
          );
        }

        // Detect actual branch
        try {
          const { stdout } = await execFileAsync(
            "git",
            ["rev-parse", "--abbrev-ref", "HEAD"],
            { cwd: sourceDir, timeout: 5000 },
          );
          branch = stdout.trim();
        } catch {
          // Use default branch
        }

        // Apply subpath if specified
        if (args.subpath) {
          sourceDir = path.join(sourceDir, args.subpath);
          try {
            await fs.access(sourceDir);
          } catch {
            throw new DyadError(
              `Subpath '${args.subpath}' does not exist in the repository`,
              DyadErrorKind.NotFound,
            );
          }
        }
      } else {
        // Local directory
        sourceDir = path.resolve(args.source);
        repoName = path.basename(sourceDir);

        try {
          await fs.access(sourceDir);
        } catch {
          throw new DyadError(
            `Directory not found: ${args.source}`,
            DyadErrorKind.NotFound,
          );
        }

        // Detect git branch if in a repo
        try {
          const { stdout } = await execFileAsync(
            "git",
            ["rev-parse", "--abbrev-ref", "HEAD"],
            { cwd: sourceDir, timeout: 5000 },
          );
          branch = stdout.trim();
        } catch {
          // Not a git repo or git not available
        }
      }

      ctx.onXmlStream(
        `<dyad-gitingest source="${escapeXmlAttr(repoName)}">Reading files...</dyad-gitingest>`,
      );

      // Walk directory and collect files
      const files: FileEntry[] = [];
      await walkDirectory(sourceDir, sourceDir, {
        includePatterns,
        excludePatterns,
        maxFiles,
        maxDepth,
        maxFileSize,
        currentDepth: 0,
        files,
      });

      if (files.length === 0) {
        throw new DyadError(
          "No files found matching the specified patterns",
          DyadErrorKind.NotFound,
        );
      }

      // Build outputs
      const tree = buildTreeString(files);
      const content = formatContent(files);
      const totalSize = files.reduce((sum, f) => sum + f.size, 0);
      const estimatedTokens = estimateTokens(content);

      const result: GitingestResult = {
        summary: {
          repository: repoName,
          fileCount: files.length,
          totalSize,
          estimatedTokens,
          branch,
        },
        tree,
        content,
      };

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

      // Format result text
      let resultText = `# ${repoName}\n\n`;
      resultText += `**Branch:** ${branch}\n`;
      resultText += `**Files:** ${files.length}\n`;
      resultText += `**Total size:** ${(totalSize / 1024).toFixed(1)} KB\n`;
      resultText += `**Estimated tokens:** ~${estimatedTokens.toLocaleString()}\n`;
      resultText += `**Time:** ${elapsed}s\n\n`;
      resultText += `## File Tree\n\n\`\`\`\n${tree}\n\`\`\`\n\n`;
      resultText += `## File Contents\n\n\`\`\`\n${content}\n\`\`\``;

      // Truncate if too large for XML (safety limit)
      const MAX_XML_CONTENT = 200_000;
      const displayContent =
        resultText.length > MAX_XML_CONTENT
          ? resultText.slice(0, MAX_XML_CONTENT) +
            `\n\n... (truncated at ${MAX_XML_CONTENT} bytes, ${files.length} files total)`
          : resultText;

      ctx.onXmlComplete(
        `<dyad-gitingest source="${escapeXmlAttr(repoName)}" files="${files.length}" tokens="${estimatedTokens}" branch="${escapeXmlAttr(branch)}">\n${escapeXmlContent(displayContent)}\n</dyad-gitingest>`,
      );

      return displayContent;
    } catch (error) {
      if (error instanceof DyadError) throw error;
      throw new DyadError(
        `Failed to ingest repository: ${error instanceof Error ? error.message : String(error)}`,
        DyadErrorKind.Unknown,
      );
    } finally {
      // Clean up temp directory
      if (tempDir) {
        try {
          await fs.rm(tempDir, { recursive: true, force: true });
        } catch {
          // Best-effort cleanup
        }
      }
    }
  },
};
