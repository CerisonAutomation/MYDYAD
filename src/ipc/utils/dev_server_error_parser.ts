/**
 * Stub for dev_server_error_parser — the original file was missing.
 * This provides a minimal fallback so the build compiles.
 */

export interface ParsedError {
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export function parseCompilationError(
  buffer: string,
  _appPath: string,
): ParsedError | null {
  if (!buffer || buffer.trim().length === 0) return null;

  // Try to extract error info from the buffer
  const lines = buffer.split("\n");
  for (const line of lines) {
    if (line.includes("Error:") || line.includes("error TS")) {
      return { message: line.trim() };
    }
  }

  return null;
}
