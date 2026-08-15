/**
 * Stub for dev_server_detector — the original file was missing.
 * Returns null to indicate no existing dev server was found.
 */

export interface DevServerInfo {
  port: number;
  pid?: number;
}

export async function detectExistingDevServer(
  _frameworkType: string,
  _appPath: string,
): Promise<DevServerInfo | null> {
  // Stub: always return null (no existing server found)
  return null;
}
