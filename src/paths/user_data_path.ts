import * as path from "node:path";

export function getUserDataPath(): string {
  const electron = getElectron();
  const devUserDataDir = process.env.DYAD_DEV_USER_DATA_DIR?.trim();

  if (process.env.NODE_ENV === "development" && devUserDataDir) {
    return path.resolve(devUserDataDir);
  }

  // When running in Electron and app is ready
  if (process.env.NODE_ENV !== "development" && electron) {
    return electron!.app.getPath("userData");
  }

  // For development or when the Electron app object isn't available
  return path.resolve("./userData");
}

/**
 * Get a reference to electron in a way that won't break in non-electron environments
 */
export function getElectron(): typeof import("electron") | undefined {
  let electron: typeof import("electron") | undefined;
  try {
    // Check if we're in an Electron environment
    if (process.versions.electron) {
      electron = require("electron");
    }
  } catch {
    // Not in Electron environment
  }
  return electron;
}
