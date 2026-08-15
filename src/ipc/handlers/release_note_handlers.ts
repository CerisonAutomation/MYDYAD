import log from "electron-log";
import fetch from "node-fetch";
import { IS_TEST_BUILD } from "../utils/test_utils";
import { createTypedHandler } from "./base";
import { systemContracts } from "../types/system";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

const logger = log.scope("release_note_handlers");

/**
 * Result of checking whether a release note exists at a given URL.
 */
interface ReleaseNoteCheckResult {
  exists: boolean;
  url?: string;
}

/**
 * Interprets an HTTP response status into a release note check result.
 *
 * @param responseStatus - The HTTP status code from the HEAD request.
 * @param releaseNoteUrl - The URL that was checked.
 * @param version - The version string for log messages.
 * @returns The check result indicating existence and optional URL.
 */
function interpretReleaseNoteStatus(
  responseStatus: number,
  releaseNoteUrl: string,
  version: string,
): ReleaseNoteCheckResult {
  if (responseStatus === 200) {
    logger.debug(
      `Release note found for version ${version} at ${releaseNoteUrl}`,
    );
    return { exists: true, url: releaseNoteUrl };
  }
  if (responseStatus === 404) {
    logger.debug(
      `Release note not found for version ${version} at ${releaseNoteUrl}`,
    );
    return { exists: false };
  }
  // Log other non-404 errors but still treat as "not found" for the client,
  // as the primary goal is to check existence.
  logger.warn(
    `Unexpected status code ${responseStatus} when checking for release note: ${releaseNoteUrl}`,
  );
  return { exists: false };
}

/**
 * Checks whether a release note exists for the given version by issuing
 * a HEAD request to the Dyad docs site.
 *
 * @param version - The version string to check.
 * @returns The check result indicating whether the note exists.
 */
async function checkReleaseNoteExists(
  version: string,
): Promise<ReleaseNoteCheckResult> {
  const releaseNoteUrl = `https://www.dyad.sh/docs/releases/${version}`;
  logger.debug(`Checking for release note at: ${releaseNoteUrl}`);

  try {
    const response = await fetch(releaseNoteUrl, { method: "HEAD" });
    return interpretReleaseNoteStatus(response.status, releaseNoteUrl, version);
  } catch (error) {
    logger.error(
      `Error fetching release note for version ${version} at ${releaseNoteUrl}:`,
      error,
    );
    // In case of network errors, assume it doesn't exist or is inaccessible.
    return { exists: false };
  }
}

/**
 * Registers IPC handlers for release note queries.
 */
export function registerReleaseNoteHandlers() {
  createTypedHandler(
    systemContracts.doesReleaseNoteExist,
    async (_, params) => {
      const { version } = params;

      if (!version || typeof version !== "string") {
        throw new DyadError(
          "Invalid version provided",
          DyadErrorKind.Validation,
        );
      }

      // For E2E tests, we don't want to check for release notes
      // or show release notes, as it interferes with the tests.
      if (IS_TEST_BUILD) {
        return { exists: false };
      }

      return checkReleaseNoteExists(version);
    },
  );

  logger.debug("Registered release note IPC handlers");
}
