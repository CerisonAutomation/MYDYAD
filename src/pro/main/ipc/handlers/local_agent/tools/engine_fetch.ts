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
 * @throws Error if Dyad Pro API key is not configured
 */
export async function engineFetch(
  ctx: Pick<AgentContext, "dyadRequestId">,
  endpoint: string,
  options: EngineFetchOptions = {},
): Promise<Response> {
  // Agent2 mode: Dyad engine is disabled.
  // These tools (web_search, web_fetch, web_crawl, code_search, generate_image)
  // require a backend API. In BYOK mode, use the provider's native tools instead.
  const engineUrl = getDyadEngineBaseUrl();
  if (!engineUrl) {
    throw new DyadError(
      `Tool endpoint "${endpoint}" requires a backend API. ` +
        `In Agent2 mode with BYOK providers, use the provider's native tools or ` +
        `configure a custom backend URL via DYAD_ENGINE_URL environment variable.`,
      DyadErrorKind.Auth,
    );
  }

  const settings = readSettings();
  // Get API key from any configured provider
  const apiKey = Object.values(settings.providerSettings || {}).find(
    (provider) => provider?.apiKey?.value,
  )?.apiKey?.value;

  if (!apiKey) {
    throw new DyadError("API key is required", DyadErrorKind.Auth);
  }

  const { headers: extraHeaders, ...restOptions } = options;

  return fetch(`${engineUrl}${endpoint}`, {
    ...restOptions,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-Dyad-Request-Id": ctx.dyadRequestId,
      ...extraHeaders,
    },
  });
}
