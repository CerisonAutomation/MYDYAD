import * as fs from "node:fs";
import * as path from "node:path";
import type {
  CodeExplorerFileResult,
  CodeExplorerResult,
  CodeExplorerSourceWindow,
} from "../../../shared/code_explorer_types";
import { GraphIndex, GraphNode } from "./types";

const LINE_PADDING = 4;
const MERGE_DISTANCE = 12;
const MAX_WINDOWS_PER_FILE = 3;
const MAX_LINES_PER_FILE = 120;
const MAX_TOTAL_LINES = 450;
const MAX_CHARS = 40_000;

/**
 * Aggregates selected nodes into per-file scores and node lists.
 *
 * @param index - The graph index for node lookup.
 * @param selected - Map of node IDs to their relevance scores.
 * @returns A tuple of [fileScores, fileNodes] where fileScores maps file
 *   paths to accumulated scores, and fileNodes maps file paths to their
 *   matching graph nodes.
 */
function rankSelectedNodes(
  index: GraphIndex,
  selected: Map<string, number>,
): [Map<string, number>, Map<string, GraphNode[]>] {
  const fileScores = new Map<string, number>();
  const fileNodes = new Map<string, GraphNode[]>();

  for (const [nodeId, score] of selected) {
    const node = index.nodes.get(nodeId);
    if (!node || node.kind === "file") continue;
    fileScores.set(node.filePath, (fileScores.get(node.filePath) ?? 0) + score);
    const nodes = fileNodes.get(node.filePath) ?? [];
    nodes.push(node);
    fileNodes.set(node.filePath, nodes);
  }

  return [fileScores, fileNodes];
}

/**
 * Reads source windows for a single file, capping lines and characters
 * against the running totals.
 *
 * @param relativePath - The file path relative to the app root.
 * @param nodes - The graph nodes within this file, sorted by start line.
 * @param appPath - The absolute path to the app root.
 * @param totalLines - Running total of lines emitted so far (mutated).
 * @param totalChars - Running total of characters emitted so far (mutated).
 * @returns An object with the capped source windows and whether output was
 *   truncated.
 */
function renderFileWindows(
  relativePath: string,
  nodes: GraphNode[],
  appPath: string,
  totalLines: { value: number },
  totalChars: { value: number },
): { windows: CodeExplorerSourceWindow[]; truncated: boolean } {
  const sourcePath = path.join(appPath, relativePath);
  const source = fs.readFileSync(sourcePath, "utf8");
  const sourceLines = source.split(/\r?\n/);
  const windows = buildWindows(nodes, sourceLines.length);
  const cappedWindows: CodeExplorerSourceWindow[] = [];
  let fileLineCount = 0;
  let truncated = false;

  for (const window of windows.slice(0, MAX_WINDOWS_PER_FILE)) {
    if (totalLines.value >= MAX_TOTAL_LINES || totalChars.value >= MAX_CHARS) {
      truncated = true;
      break;
    }

    const remainingFileLines = MAX_LINES_PER_FILE - fileLineCount;
    const remainingTotalLines = MAX_TOTAL_LINES - totalLines.value;
    const maxWindowLines = Math.min(
      window.endLine - window.startLine + 1,
      remainingFileLines,
      remainingTotalLines,
    );
    if (maxWindowLines <= 0) {
      truncated = true;
      break;
    }

    const lines = sourceLines
      .slice(window.startLine - 1, window.startLine - 1 + maxWindowLines)
      .map((line, index) => `${window.startLine + index} ${line}`);
    const charCount = lines.join("\n").length;
    if (totalChars.value + charCount > MAX_CHARS) {
      truncated = true;
      break;
    }

    cappedWindows.push({
      startLine: window.startLine,
      endLine: window.startLine + lines.length - 1,
      lines,
    });
    fileLineCount += lines.length;
    totalLines.value += lines.length;
    totalChars.value += charCount;
  }

  if (windows.length > cappedWindows.length) {
    truncated = true;
  }

  return { windows: cappedWindows, truncated };
}

export function renderResult({
  index,
  query,
  selected,
  maxFiles,
  indexMs,
  searchMs,
}: {
  index: GraphIndex;
  query: string;
  selected: Map<string, number>;
  maxFiles: number;
  indexMs: number;
  searchMs: number;
}): CodeExplorerResult {
  const notes: string[] = [];
  const [fileScores, fileNodes] = rankSelectedNodes(index, selected);

  const rankedFiles = [...fileScores.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxFiles);
  if (fileScores.size > rankedFiles.length) {
    notes.push(
      `Truncated to ${rankedFiles.length} of ${fileScores.size} matching files.`,
    );
  }

  const totalLines = { value: 0 };
  const totalChars = { value: 0 };
  let truncated = notes.length > 0;
  const files: CodeExplorerFileResult[] = [];

  for (const [relativePath] of rankedFiles) {
    const nodes = (fileNodes.get(relativePath) ?? []).sort(
      (a, b) => a.startLine - b.startLine,
    );
    const result = renderFileWindows(
      relativePath,
      nodes,
      index.appPath,
      totalLines,
      totalChars,
    );
    truncated = truncated || result.truncated;

    files.push({
      path: relativePath,
      symbols: nodes.slice(0, 12).map((node) => ({
        name: node.qualifiedName || node.name,
        kind: node.kind,
        line: node.startLine,
      })),
      windows: result.windows,
    });
  }

  if (truncated && !notes.some((note) => note.startsWith("Output truncated"))) {
    notes.push("Output truncated by file, line, or character caps.");
  }

  return {
    query,
    totalSymbols: selected.size,
    totalFiles: fileScores.size,
    indexedFileCount: new Set(index.rootFileNames).size,
    indexMs,
    searchMs,
    files,
    truncated,
    notes,
  };
}

function buildWindows(
  nodes: GraphNode[],
  totalLines: number,
): Array<{ startLine: number; endLine: number }> {
  const ranges = nodes
    .map((node) => ({
      startLine: Math.max(1, node.startLine - LINE_PADDING),
      endLine: Math.min(totalLines, node.endLine + LINE_PADDING),
    }))
    .sort((a, b) => a.startLine - b.startLine);

  const merged: Array<{ startLine: number; endLine: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.startLine <= last.endLine + MERGE_DISTANCE) {
      last.endLine = Math.max(last.endLine, range.endLine);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
}
