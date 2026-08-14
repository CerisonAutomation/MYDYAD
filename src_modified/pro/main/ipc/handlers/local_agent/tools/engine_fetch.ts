/**
 * Shared utility for making fetch requests to the Dyad engine API.
 * Handles common headers including Authorization and X-Dyad-Request-Id.
 */

import { readSettings } from "@/main/settings";
import type { AgentContext } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getDyadEngineBaseUrl } from "@/ipc/utils/dyad_engine_url";

export interface EngineFetchOptions extends Omit<RequestInit, "headers"> {
  /** Additional headers to include */
  headers?: Record<string, string>;
}

/**
 * Fetch wrapper for Dyad engine API calls.
 * Automatically adds Authorization and X-Dyad-Request-Id headers.
 *
 * @param ctx - The agent context containing the request ID
 * @param endpoint - The API endpoint path (e.g., "/tools/web-search")
 * @param options - Fetch options (method, body, additional headers, etc.)
 * @returns The fetch Response
 * @throws Error if API key is not configured
 */
export async function engineFetch(
  ctx: Pick<AgentContext, "dyadRequestId">,
  endpoint: string,
  options: EngineFetchOptions = {},
): Promise<Response> {
  const settings = readSettings();
  const apiKey = settings.providerSettings?.auto?.apiKey?.value;

  if (!apiKey) {
    throw new DyadError(
      "API key is required for engine features",
      DyadErrorKind.Auth,
    );
  }

  const { headers: extraHeaders, ...restOptions } = options;

  const response = await fetch(`${getDyadEngineBaseUrl()}${endpoint}`, {
    ...restOptions,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Dyad-Request-Id": ctx.dyadRequestId,
      ...extraHeaders,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new DyadError(
      `Engine API error ${response.status}: ${body || response.statusText}`,
      DyadErrorKind.Internal,
    );
  }

  return response;
}
