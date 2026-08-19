
import { promises as fsPromises } from "node:fs";
import path from "node:path";
import fsExtra from "fs-extra";
import { normalizePath } from "../../../shared/normalizePath";
import { generateCuteAppName } from "../../lib/utils";

// Directories to exclude when scanning files
const EXCLUDED_DIRS = ["node_modules", ".git", ".next"];

/**
 * Recursively gets all files in a directory, excluding node_modules and .git.
 * @param dir The directory to scan
 * @param baseDir The base directory for calculating relative paths
 * @param opts Optional limits to prevent unbounded traversal
 * @returns Array of file paths relative to the base directory
 */
export async function getFilesRecursively(
  dir: string,
  baseDir: string,
  opts?: { maxDepth?: number; maxFiles?: number },
  _depth = 0,
): Promise<string[]> {
  const maxDepth = opts?.maxDepth ?? 30;
  const maxFiles = opts?.maxFiles ?? 10_000;

  if (_depth > maxDepth) {
    return [];
  }

  let dirents;
  try {
    dirents = await fsPromises.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  dirents.sort((a, b) => a.name.localeCompare(b.name));
  const files: string[] = [];

  for (const dirent of dirents) {
    if (files.length >= maxFiles) {
      break;
    }

    const res = path.join(dir, dirent.name);
    if (dirent.isDirectory()) {
      // For directories, concat the results of recursive call
      // Exclude specified directories
      if (!EXCLUDED_DIRS.includes(dirent.name)) {
        files.push(
          ...(await getFilesRecursively(res, baseDir, opts, _depth + 1)),
        );
      }
    } else {
      // For files, add the relative path
      files.push(normalizePath(path.relative(baseDir, res)));
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

export async function copyDirectoryRecursive(
  source: string,
  destination: string,
) {
  await fsPromises.mkdir(destination, { recursive: true });

  try {
    const entries = await fsPromises.readdir(source, { withFileTypes: true });
    // Why do we sort? This ensures stable ordering of files across platforms
    // which is helpful for tests (and has no practical downsides).
    entries.sort();

    for (const entry of entries) {
      const srcPath = path.join(source, entry.name);
      const destPath = path.join(destination, entry.name);

      if (entry.isDirectory()) {
        // Exclude node_modules directories
        if (entry.name !== "node_modules") {
          await copyDirectoryRecursive(srcPath, destPath);
        }
      } else {
        await fsPromises.copyFile(srcPath, destPath);
      }
    }
  } catch (error) {
    // Clean up the partially-copied destination on failure
    try {
      await fsPromises.rm(destination, { recursive: true, force: true });
    } catch {
      // Best effort cleanup — if rm fails, the partial directory remains
    }
    throw error;
  }
}

export async function writeMigrationFile(
  appPath: string,
  queryContent: string,
  queryDescription?: string,
): Promise<string> {
  const migrationsDir = path.join(appPath, "supabase", "migrations");
  await fsExtra.ensureDir(migrationsDir);

  const files = await fsExtra.readdir(migrationsDir);
  const migrationNumbers = files
    .map((file) => {
      const match = file.match(/^(\d{4})_/);
      return match ? Number.parseInt(match[1], 10) : -1;
    })
    .filter((num) => num !== -1);

  const nextMigrationNumber =
    migrationNumbers.length > 0 ? Math.max(...migrationNumbers) + 1 : 0;
  const paddedNumber = String(nextMigrationNumber).padStart(4, "0");

  let description = "migration";
  if (queryDescription) {
    description = queryDescription.toLowerCase().replace(/[\s\W-]+/g, "_");
  } else {
    description = generateCuteAppName().replace(/-/g, "_");
  }

  const migrationFileName = `${paddedNumber}_${description}.sql`;
  const migrationFilePath = path.join(migrationsDir, migrationFileName);

  await fsExtra.writeFile(migrationFilePath, queryContent);
  return normalizePath(path.relative(appPath, migrationFilePath));
}

export async function fileExists(filePath: string) {
  return fsPromises
    .access(filePath)
    .then(() => true)
    .catch(() => false);
}
