/**
 * Shared utilities for ripgrep integration
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

// Electron main process runs as CJS — __filename is always available.
// Vite replaces import.meta.url with undefined in CJS output.
const require = createRequire(__filename);

export const MAX_FILE_SEARCH_SIZE = 1024 * 1024;
export const RIPGREP_EXCLUDED_GLOBS = [
  "!node_modules/**",
  "!.git/**",
  "!.next/**",
];

/**
 * Get the path to the ripgrep executable.
 * Handles both development and packaged Electron app scenarios.
 */
export function getRgExecutablePath(): string {
  const isWindows = os.platform() === "win32";
  const executableName = isWindows ? "rg.exe" : "rg";

  // Preferred: let @vscode/ripgrep resolve its own platform-specific binary
  // (v1.18+ ships the binary in @vscode/ripgrep-<platform>-<arch>).
  try {
    const { rgPath } = require("@vscode/ripgrep") as { rgPath: string };
    if (rgPath && fs.existsSync(rgPath)) {
      return rgPath;
    }
  } catch {
    // Fall through to legacy path resolution below.
  }

  if (!app.isPackaged) {
    // Legacy layout: node_modules/@vscode/ripgrep/bin/rg
    const legacyDevPath = path.join(
      app.getAppPath(),
      "node_modules",
      "@vscode",
      "ripgrep",
      "bin",
      executableName,
    );
    if (fs.existsSync(legacyDevPath)) {
      return legacyDevPath;
    }
    // Platform sub-package in dev
    return path.join(
      app.getAppPath(),
      "node_modules",
      "@vscode",
      `ripgrep-${os.platform()}-${os.arch()}`,
      "bin",
      executableName,
    );
  }

  // Packaged app: ripgrep is bundled via extraResource
  // "node_modules/@vscode" is extracted to resources/@vscode
  const packagedCandidates = [
    path.join(
      process.resourcesPath,
      "@vscode",
      `ripgrep-${os.platform()}-${os.arch()}`,
      "bin",
      executableName,
    ),
    path.join(
      process.resourcesPath,
      "@vscode",
      "ripgrep",
      "bin",
      executableName,
    ),
  ];
  for (const candidate of packagedCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return packagedCandidates[0];
}
