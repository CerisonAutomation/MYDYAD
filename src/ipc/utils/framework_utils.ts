import fs from "node:fs";
import * as path from "path";
import {
  ASTRO_CONFIG_FILES,
  type AppFrameworkType,
  EXPO_CONFIG_FILES,
  NEXTJS_CONFIG_FILES,
  NUXT_CONFIG_FILES,
  REMIX_CONFIG_FILES,
  SVELTEKIT_CONFIG_FILES,
  VITE_CONFIG_FILES,
} from "@/lib/framework_constants";

// LRU cache for framework detection — the result rarely changes for a given path.
const frameworkCache = new Map<string, AppFrameworkType | null>();
const FRAMEWORK_CACHE_MAX = 100;

function cacheFrameworkResult(
  appPath: string,
  result: AppFrameworkType | null,
): AppFrameworkType | null {
  if (frameworkCache.size >= FRAMEWORK_CACHE_MAX) {
    const oldest = frameworkCache.keys().next().value;
    if (oldest !== undefined) frameworkCache.delete(oldest);
  }
  frameworkCache.set(appPath, result);
  return result;
}

// Cache for Next.js major version detection
const nextVersionCache = new Map<string, number | null>();
const NEXT_VERSION_CACHE_MAX = 100;

function cacheNextVersion(
  appPath: string,
  result: number | null,
): number | null {
  if (nextVersionCache.size >= NEXT_VERSION_CACHE_MAX) {
    const oldest = nextVersionCache.keys().next().value;
    if (oldest !== undefined) nextVersionCache.delete(oldest);
  }
  nextVersionCache.set(appPath, result);
  return result;
}

/**
 * Detect the framework type for an app by checking config files and package.json.
 *
 * Vite apps with a Nitro server layer (added via `enable_nitro`) are reported
 * as `"vite-nitro"`. Detection looks for `nitro.config.{ts,js,mjs}` first, then
 * falls back to `nitro` in package.json deps — either is sufficient since the
 * tool writes the config file and installs the package together.
 */
export function detectFrameworkType(appPath: string): AppFrameworkType | null {
  const cached = frameworkCache.get(appPath);
  if (cached !== undefined) return cached;

  let result: AppFrameworkType | null;
  try {
    // Check for Next.js config files
    for (const config of NEXTJS_CONFIG_FILES) {
      if (fs.existsSync(path.join(appPath, config))) {
        result = "nextjs";
        return cacheFrameworkResult(appPath, result);
      }
    }

    // Check for Astro config files
    for (const config of ASTRO_CONFIG_FILES) {
      if (fs.existsSync(path.join(appPath, config))) {
        result = "astro";
        return cacheFrameworkResult(appPath, result);
      }
    }

    // Check for Remix config files
    for (const config of REMIX_CONFIG_FILES) {
      if (fs.existsSync(path.join(appPath, config))) {
        result = "remix";
        return cacheFrameworkResult(appPath, result);
      }
    }

    // Check for Nuxt config files
    for (const config of NUXT_CONFIG_FILES) {
      if (fs.existsSync(path.join(appPath, config))) {
        result = "nuxt";
        return cacheFrameworkResult(appPath, result);
      }
    }

    // Check for SvelteKit config files
    for (const config of SVELTEKIT_CONFIG_FILES) {
      if (fs.existsSync(path.join(appPath, config))) {
        result = "sveltekit";
        return cacheFrameworkResult(appPath, result);
      }
    }

    // Check for Expo config files
    for (const config of EXPO_CONFIG_FILES) {
      if (fs.existsSync(path.join(appPath, config))) {
        result = "expo";
        return cacheFrameworkResult(appPath, result);
      }
    }

    // Check for Vite config files
    let isVite = false;
    for (const config of VITE_CONFIG_FILES) {
      if (fs.existsSync(path.join(appPath, config))) {
        isVite = true;
        break;
      }
    }

    // Check package.json dependencies
    let packageJsonDeps: Record<string, string> | null = null;
    const packageJsonPath = path.join(appPath, "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
      const deps: Record<string, string> = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies,
      };
      packageJsonDeps = deps;
      if (!isVite && deps.next) {
        result = "nextjs";
        return cacheFrameworkResult(appPath, result);
      }
      if (!isVite && deps.astro) {
        result = "astro";
        return cacheFrameworkResult(appPath, result);
      }
      if (!isVite && deps["@remix-run/node"]) {
        result = "remix";
        return cacheFrameworkResult(appPath, result);
      }
      if (!isVite && deps.nuxt) {
        result = "nuxt";
        return cacheFrameworkResult(appPath, result);
      }
      if (!isVite && deps["@sveltejs/kit"]) {
        result = "sveltekit";
        return cacheFrameworkResult(appPath, result);
      }
      if (!isVite && deps.expo) {
        result = "expo";
        return cacheFrameworkResult(appPath, result);
      }
      if (!isVite && deps.vite) isVite = true;
    }

    if (isVite) {
      result = hasNitro(appPath, packageJsonDeps) ? "vite-nitro" : "vite";
      return cacheFrameworkResult(appPath, result);
    }

    // Check for static sites (no package.json or no dev script)
    const hasPackageJson = fs.existsSync(packageJsonPath);
    if (!hasPackageJson) {
      // Check for HTML files (static site)
      const hasIndex = fs.existsSync(path.join(appPath, "index.html"));
      if (hasIndex) {
        result = "static";
        return cacheFrameworkResult(appPath, result);
      }
    }

    result = "other";
    return cacheFrameworkResult(appPath, result);
  } catch {
    result = null;
    return cacheFrameworkResult(appPath, result);
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
 * Read the Next.js major version from the app's package.json.
 * Returns null when next is not installed or the version string is non-numeric
 * (e.g. "latest", "canary", a git URL).
 */
export function detectNextJsMajorVersion(appPath: string): number | null {
  const cached = nextVersionCache.get(appPath);
  if (cached !== undefined) return cached;

  let result: number | null;
  try {
    const packageJsonPath = path.join(appPath, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      result = null;
      return cacheNextVersion(appPath, result);
    }
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    const nextVersion =
      packageJson.dependencies?.next ?? packageJson.devDependencies?.next;
    if (typeof nextVersion !== "string") {
      result = null;
      return cacheNextVersion(appPath, result);
    }
    const match = nextVersion.match(/\d+/);
    if (!match) {
      result = null;
      return cacheNextVersion(appPath, result);
    }
    result = Number.parseInt(match[0], 10);
    return cacheNextVersion(appPath, result);
  } catch {
    result = null;
    return cacheNextVersion(appPath, result);
  }
}
