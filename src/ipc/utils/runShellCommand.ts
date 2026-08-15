import { spawn } from "child_process";
import log from "electron-log";

const logger = log.scope("runShellCommand");

/**
 * Allowlist of commands safe to execute via shell.
 * SECURITY: Only hardcoded, non-user-controllable commands are permitted.
 * Never pass user-provided input as the `command` parameter.
 */
const SAFE_COMMANDS = new Set([
  "node --version",
  "where node",
  "where.exe node",
  "which node",
  "command -v node",
  "pnpm --version",
  "npm --version",
]);

export function runShellCommand(
  command: string,
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<string | null> {
  if (!SAFE_COMMANDS.has(command)) {
    logger.error(
      `Refusing to run unallowlisted shell command: "${command}". ` +
        `Add it to SAFE_COMMANDS if it is safe.`,
    );
    return Promise.resolve(null);
  }

  // Sanitize command for logging — strip any embedded newlines or control chars
  const safeLogCommand = command.replace(/[\r\n\x00-\x1f]/g, "?");
  logger.debug(`Running command: ${safeLogCommand}`);
  return new Promise((resolve) => {
    let output = "";
    const process = spawn(command, {
      env: options.env,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"], // ignore stdin, pipe stdout/stderr
    });

    process.stdout?.on("data", (data) => {
      output += data.toString();
    });

    process.stderr?.on("data", (data) => {
      // Log stderr but don't treat it as a failure unless the exit code is non-zero
      logger.warn(`Stderr from "${command}": ${data.toString().trim()}`);
    });

    process.on("error", (error) => {
      logger.error(`Error executing command "${command}":`, error.message);
      resolve(null); // Command execution failed
    });

    process.on("close", (code) => {
      if (code === 0) {
        logger.debug(
          `Command "${command}" succeeded with code ${code}: ${output.trim()}`,
        );
        resolve(output.trim()); // Command succeeded, return trimmed output
      } else {
        logger.error(`Command "${command}" failed with code ${code}`);
        resolve(null); // Command failed
      }
    });
  });
}
