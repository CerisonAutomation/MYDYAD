import fs from "node:fs";
import * as path from "path";
import {
  NEXTJS_CONFIG_FILES,
  VITE_CONFIG_FILES,
  type AppFrameworkType,
} from "@/lib/framework_constants";

/**
 * LRU cache for framework detection results to avoid repeated filesystem calls.
 * Keyed by appPath, stores the detection result.
 */
const frameworkCache = new Map<string, AppFrameworkType | null>();
const FRAMEWORK_CACHE_MAX = 50;

function getCachedResult(appPath: string): AppFrameworkType | null | undefined {
  return frameworkCache.get(appPath);
}

function setCachedResult(
  appPath: string,
  result: AppFrameworkType | null,
): void {
  if (frameworkCache.size >= FRAMEWORK_CACHE_MAX) {
    // Evict oldest entry
    const firstKey = frameworkCache.keys().next().value;
    if (firstKey !== undefined) {
      frameworkCache.delete(firstKey);
    }
  }
  frameworkCache.set(appPath, result);
}

/**
 * Detect the framework type for an app by checking config files and package.json.
 *
 * Vite apps with a Nitro server layer (added via `enable_nitro`) are reported
 * as `"vite-nitro"`. Detection looks for `nitro.config.{ts,js,mjs}` first, then
 * falls back to `nitro` in package.json deps — either is sufficient since the
 * tool writes the config file and installs the package together.
 *
 * Results are cached to avoid repeated filesystem calls for the same app.
 */
export function detectFrameworkType(appPath: string): AppFrameworkType | null {
  // Check cache first
  const cached = getCachedResult(appPath);
  if (cached !== undefined) {
    return cached;
  }

  try {
    // Batch-check all config files with fewer syscalls
    // Check Next.js configs first (more specific)
    for (const config of NEXTJS_CONFIG_FILES) {
      if (fs.existsSync(path.join(appPath, config))) {
        setCachedResult(appPath, "nextjs");
        return "nextjs";
      }
    }

    // Check Vite configs
    let isVite = false;
    for (const config of VITE_CONFIG_FILES) {
      if (fs.existsSync(path.join(appPath, config))) {
        isVite = true;
        break;
      }
    }

    // Read package.json once for dependency checks
    let packageJsonDeps: Record<string, string> | null = null;
    const packageJsonPath = path.join(appPath, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      let packageJson: Record<string, unknown>;
      try {
        packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      } catch {
        setCachedResult(appPath, isVite ? "vite" : "other");
        return isVite ? "vite" : "other";
      }
      const deps: Record<string, string> = {
        ...(typeof packageJson.dependencies === "object" &&
        packageJson.dependencies !== null
          ? (packageJson.dependencies as Record<string, string>)
          : {}),
        ...(typeof packageJson.devDependencies === "object" &&
        packageJson.devDependencies !== null
          ? (packageJson.devDependencies as Record<string, string>)
          : {}),
      };
      packageJsonDeps = deps;
      if (!isVite && deps.next) {
        setCachedResult(appPath, "nextjs");
        return "nextjs";
      }
      if (!isVite && deps.vite) isVite = true;
    }

    if (isVite) {
      const result = hasNitro(appPath, packageJsonDeps) ? "vite-nitro" : "vite";
      setCachedResult(appPath, result);
      return result;
    }

    setCachedResult(appPath, "other");
    return "other";
  } catch {
    setCachedResult(appPath, null);
    return null;
  }
}

/**
 * Clear the framework detection cache. Call this when app directories are
 * modified (e.g., after rebuild, package install, or config changes).
 */
export function clearFrameworkCache(appPath?: string): void {
  if (appPath) {
    frameworkCache.delete(appPath);
  } else {
    frameworkCache.clear();
  }
}

function hasNitro(
  appPath: string,
  deps: Record<string, string> | null,
): boolean {
  const nitroConfigs = [
    "nitro.config.ts",
    "nitro.config.js",
    "nitro.config.mjs",
  ];
  for (const config of nitroConfigs) {
    if (fs.existsSync(path.join(appPath, config))) return true;
  }
  return Boolean(deps?.nitro);
}

/**
 * Cache for Next.js version detection to avoid repeated file reads.
 */
const nextVersionCache = new Map<string, number | null>();
const NEXT_VERSION_CACHE_MAX = 50;

/**
 * Read the Next.js major version from the app's package.json.
 * Returns null when next is not installed or the version string is non-numeric
 * (e.g. "latest", "canary", a git URL).
 *
 * Results are cached to avoid repeated filesystem calls for the same app.
 */
export function detectNextJsMajorVersion(appPath: string): number | null {
  // Check cache first
  const cached = nextVersionCache.get(appPath);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const packageJsonPath = path.join(appPath, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      nextVersionCache.set(appPath, null);
      return null;
    }
    let packageJson: Record<string, unknown>;
    try {
      packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    } catch {
      nextVersionCache.set(appPath, null);
      return null;
    }
    const deps =
      typeof packageJson.dependencies === "object" &&
      packageJson.dependencies !== null
        ? (packageJson.dependencies as Record<string, string>)
        : {};
    const devDeps =
      typeof packageJson.devDependencies === "object" &&
      packageJson.devDependencies !== null
        ? (packageJson.devDependencies as Record<string, string>)
        : {};
    const nextVersion = deps.next ?? devDeps.next;
    if (typeof nextVersion !== "string") {
      nextVersionCache.set(appPath, null);
      return null;
    }
    const match = nextVersion.match(/\d+/);
    if (!match) {
      nextVersionCache.set(appPath, null);
      return null;
    }
    const result = parseInt(match[0], 10);

    // Manage cache size
    if (nextVersionCache.size >= NEXT_VERSION_CACHE_MAX) {
      const firstKey = nextVersionCache.keys().next().value;
      if (firstKey !== undefined) {
        nextVersionCache.delete(firstKey);
      }
    }
    nextVersionCache.set(appPath, result);
    return result;
  } catch {
    nextVersionCache.set(appPath, null);
    return null;
  }
}

/**
 * Clear the Next.js version cache. Call this when package.json is modified.
 */
export function clearNextVersionCache(appPath?: string): void {
  if (appPath) {
    nextVersionCache.delete(appPath);
  } else {
    nextVersionCache.clear();
  }
}
