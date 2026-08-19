import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { assertNotPrivateIp } from "@/pro/main/ipc/handlers/local_agent/tools/network_utils";
import log from "electron-log";
import fetch from "node-fetch";
import { systemContracts } from "../types/system";
import { createTypedHandler } from "./base";

const logger = log.scope("upload_handlers");

export function registerUploadHandlers() {
  createTypedHandler(systemContracts.uploadToSignedUrl, async (_, params) => {
    const { url, contentType, data } = params;
    logger.debug("IPC: upload-to-signed-url called");

    // Validate the signed URL
    if (!url || typeof url !== "string" || !url.startsWith("https://")) {
      throw new DyadError(
        "Invalid signed URL provided",
        DyadErrorKind.Validation,
      );
    }

    // SSRF protection: block private/internal IP addresses
    assertNotPrivateIp(url);

    // Validate content type
    if (!contentType || typeof contentType !== "string") {
      throw new DyadError(
        "Invalid content type provided",
        DyadErrorKind.Validation,
      );
    }

    // Perform the upload to the signed URL
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        "Content-Type": contentType,
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      throw new Error(
        `Upload failed with status ${response.status}: ${response.statusText}`,
      );
    }

    logger.debug("Successfully uploaded data to signed URL");
  });

  logger.debug("Registered upload IPC handlers");
}
