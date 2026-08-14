/**
 * Returns the base URL for the Dyad engine API.
 *
 * In Agent2 mode with BYOK providers, this returns empty string by default.
 * Users can optionally set DYAD_ENGINE_URL environment variable to use a custom backend.
 *
 * Original behavior:
 * - Default: "https://engine.dyad.sh/v1"
 * - Override: process.env.DYAD_ENGINE_URL
 *
 * Agent2 mode:
 * - Default: "" (disabled, use BYOK providers directly)
 * - Optional: process.env.DYAD_ENGINE_URL (for users with custom backends)
 */
export function getDyadEngineBaseUrl(): string {
  // Agent2 mode: Dyad engine disabled by default
  // Users can optionally set DYAD_ENGINE_URL to use a custom backend
  return process.env.DYAD_ENGINE_URL ?? "";
}
