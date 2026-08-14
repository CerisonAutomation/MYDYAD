/**
 * Local Lazy Edits - Provider-agnostic edit optimization
 *
 * This implements the V2-style prompt-driven approach that works with any provider.
 * It also provides client-side post-processing to convert full rewrites to targeted diffs.
 *
 * Based on:
 * - Turbo Edits V2 system prompt (search-replace format)
 * - Aider's approach to diff generation
 * - repo-intel's hotspot detection for identifying critical files
 */

import log from "electron-log";
import type { CodebaseFile } from "@/utils/codebase";

const logger = log.scope("local_lazy_edits");

export interface LazyEditsOptions {
  /** The LLM's response containing file edits */
  response: string;
  /** Original codebase files */
  files: CodebaseFile[];
  /** Whether to use aggressive optimization */
  aggressive?: boolean;
}

export interface LazyEditsResult {
  /** Optimized edits (search-replace format) */
  optimizedEdits: string;
  /** Original full rewrites count */
  originalRewrites: number;
  /** Optimized search-replace count */
  optimizedReplaces: number;
  /** Token savings estimate */
  tokenSavings: number;
}

// ─── Diff Extraction ────────────────────────────────────────────────────────

/**
 * Extract dyad-write blocks from LLM response.
 */
function extractWriteBlocks(
  response: string,
): Array<{ path: string; content: string }> {
  const blocks: Array<{ path: string; content: string }> = [];
  const writeRegex = /<dyad-write\s+path="([^"]+)">([\s\S]*?)<\/dyad-write>/g;

  let match;
  while ((match = writeRegex.exec(response)) !== null) {
    blocks.push({
      path: match[1],
      content: match[2],
    });
  }

  return blocks;
}

/**
 * Extract dyad-search-replace blocks from LLM response.
 */
function extractSearchReplaceBlocks(response: string): Array<{
  path: string;
  description: string;
  blocks: Array<{ search: string; replace: string }>;
}> {
  const blocks: Array<{
    path: string;
    description: string;
    blocks: Array<{ search: string; replace: string }>;
  }> = [];

  const srRegex =
    /<dyad-search-replace\s+path="([^"]+)"\s+description="([^"]*)">([\s\S]*?)<\/dyad-search-replace>/g;

  let match;
  while ((match = srRegex.exec(response)) !== null) {
    const path = match[1];
    const description = match[2];
    const content = match[3];

    // Extract SEARCH/REPLACE pairs
    const searchReplacePairs: Array<{ search: string; replace: string }> = [];
    const pairRegex =
      /<<<<<<< SEARCH\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>> REPLACE/g;

    let pairMatch;
    while ((pairMatch = pairRegex.exec(content)) !== null) {
      searchReplacePairs.push({
        search: pairMatch[1].trim(),
        replace: pairMatch[2].trim(),
      });
    }

    blocks.push({ path, description, blocks: searchReplacePairs });
  }

  return blocks;
}

// ─── Diff Generation ────────────────────────────────────────────────────────

/**
 * Generate search-replace diff from full file rewrite.
 * This is the core optimization: convert a full file rewrite to targeted diffs.
 */
function generateSearchReplaceDiff(
  originalContent: string,
  newContent: string,
  _filePath: string,
): { search: string; replace: string } | null {
  const originalLines = originalContent.split("\n");
  const newLines = newContent.split("\n");

  // Find the first differing line
  let startLine = 0;
  while (
    startLine < Math.min(originalLines.length, newLines.length) &&
    originalLines[startLine] === newLines[startLine]
  ) {
    startLine++;
  }

  // Find the last differing line
  let endLineOrig = originalLines.length - 1;
  let endLineNew = newLines.length - 1;
  while (
    endLineOrig > startLine &&
    endLineNew > startLine &&
    originalLines[endLineOrig] === newLines[endLineNew]
  ) {
    endLineOrig--;
    endLineNew--;
  }

  // If no differences found, skip
  if (startLine > endLineOrig && startLine > endLineNew) {
    return null;
  }

  // Extract the differing sections
  const searchLines = originalLines.slice(startLine, endLineOrig + 1);
  const replaceLines = newLines.slice(startLine, endLineNew + 1);

  // Add context lines (2 lines before and after)
  const contextBefore = originalLines.slice(
    Math.max(0, startLine - 2),
    startLine,
  );
  const contextAfter = originalLines.slice(
    endLineOrig + 1,
    Math.min(originalLines.length, endLineOrig + 3),
  );

  const search = [...contextBefore, ...searchLines, ...contextAfter].join("\n");
  const replace = [...contextBefore, ...replaceLines, ...contextAfter].join(
    "\n",
  );

  return { search, replace };
}

// ─── Main Lazy Edits Function ───────────────────────────────────────────────

/**
 * Optimize LLM response by converting full rewrites to targeted diffs.
 *
 * This is the local equivalent of the Dyad Engine's server-side Lazy Edits.
 * It works with any provider by post-processing the LLM response.
 *
 * @param options - Lazy edits options
 * @returns Optimized edits
 */
export function optimizeLazyEdits(options: LazyEditsOptions): LazyEditsResult {
  const { response, files, aggressive: _aggressive = false } = options;

  const startTime = Date.now();
  logger.log(`Lazy Edits: Optimizing response (${response.length} chars)`);

  // Extract existing search-replace blocks
  const existingSRBlocks = extractSearchReplaceBlocks(response);

  // Extract full write blocks
  const writeBlocks = extractWriteBlocks(response);

  // Convert write blocks to search-replace format
  const newSRBlocks: Array<{
    path: string;
    description: string;
    blocks: Array<{ search: string; replace: string }>;
  }> = [];

  let tokenSavings = 0;

  for (const writeBlock of writeBlocks) {
    // Find the original file content
    const originalFile = files.find((f) => f.path === writeBlock.path);
    if (!originalFile) {
      logger.warn(`Lazy Edits: Original file not found for ${writeBlock.path}`);
      continue;
    }

    // Generate search-replace diff
    const diff = generateSearchReplaceDiff(
      originalFile.content,
      writeBlock.content,
      writeBlock.path,
    );

    if (diff) {
      newSRBlocks.push({
        path: writeBlock.path,
        description: `Optimized edit for ${writeBlock.path}`,
        blocks: [diff],
      });

      // Estimate token savings
      const originalTokens = Math.ceil(writeBlock.content.length / 4);
      const optimizedTokens = Math.ceil(
        (diff.search.length + diff.replace.length) / 4,
      );
      tokenSavings += originalTokens - optimizedTokens;
    }
  }

  // Combine existing and new search-replace blocks
  const allSRBlocks = [...existingSRBlocks, ...newSRBlocks];

  // Build optimized response
  const optimizedParts: string[] = [];

  // Keep non-edit parts of the response
  const nonEditResponse = response
    .replace(/<dyad-write[\s\S]*?<\/dyad-write>/g, "")
    .replace(/<dyad-search-replace[\s\S]*?<\/dyad-search-replace>/g, "")
    .trim();

  if (nonEditResponse) {
    optimizedParts.push(nonEditResponse);
  }

  // Add optimized search-replace blocks
  for (const block of allSRBlocks) {
    const srContent = block.blocks
      .map(
        (b) =>
          `<<<<<<< SEARCH\n${b.search}\n=======\n${b.replace}\n>>>>>>> REPLACE`,
      )
      .join("\n\n");

    optimizedParts.push(
      `<dyad-search-replace path="${block.path}" description="${block.description}">\n${srContent}\n</dyad-search-replace>`,
    );
  }

  const optimizedEdits = optimizedParts.join("\n\n");
  const elapsed = Date.now() - startTime;

  const result: LazyEditsResult = {
    optimizedEdits,
    originalRewrites: writeBlocks.length,
    optimizedReplaces: allSRBlocks.reduce((sum, b) => sum + b.blocks.length, 0),
    tokenSavings: Math.max(0, tokenSavings),
  };

  logger.log(
    `Lazy Edits: Optimized ${result.originalRewrites} rewrites → ${result.optimizedReplaces} search-replaces ` +
      `(saved ~${result.tokenSavings} tokens) in ${elapsed}ms`,
  );

  return result;
}

/**
 * Build the Lazy Edits system prompt for any provider.
 * This is the V2-style prompt that teaches the model to output diffs.
 */
export function buildLazyEditsPrompt(): string {
  return `
# Search-replace file edits

- Request to apply PRECISE, TARGETED modifications to an existing file by searching for specific sections of content and replacing them. This tool is for SURGICAL EDITS ONLY - specific changes to existing code.
- You can perform multiple distinct search and replace operations within a single \`dyad-search-replace\` call by providing multiple SEARCH/REPLACE blocks. This is the preferred way to make several targeted changes efficiently.
- The SEARCH section must match exactly ONE existing content section - it must be unique within the file, including whitespace and indentation.
- When applying the diffs, be extra careful to remember to change any closing brackets or other syntax that may be affected by the diff farther down in the file.
- ALWAYS make as many changes in a single 'dyad-search-replace' call as possible using multiple SEARCH/REPLACE blocks.
- Do not use both \`dyad-write\` and \`dyad-search-replace\` on the same file within a single response.
- Include a brief description of the changes you are making in the \`description\` parameter.

Diff format:
\`\`\`
<<<<<<< SEARCH
[exact content to find including whitespace]
=======
[new content to replace with]
>>>>>>> REPLACE
\`\`\`

Example:

Original file:
\`\`\`
def calculate_total(items):
    total = 0
    for item in items:
        total += item
    return total
\`\`\`

Search/Replace content:
\`\`\`
<<<<<<< SEARCH
def calculate_total(items):
    total = 0
    for item in items:
        total += item
    return total
=======
def calculate_total(items):
    """Calculate total with 10% markup"""
    return sum(item * 1.1 for item in items)
>>>>>>> REPLACE

\`\`\`

Usage:
<dyad-search-replace path="path/to/file.js" description="Brief description of the changes you are making">
<<<<<<< SEARCH
def calculate_total(items):
    sum = 0
=======
def calculate_sum(items):
    sum = 0
>>>>>>> REPLACE

<<<<<<< SEARCH
        total += item
    return total
=======
        sum += item
    return sum
>>>>>>> REPLACE
</dyad-search-replace>

`;
}
