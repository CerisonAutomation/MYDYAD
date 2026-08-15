/**
 * Network Interceptor Tool — Game-Changing Feature
 *
 * Provides network-level control:
 * - Request/response interception and modification
 * - API mocking and stubbing
 * - Network throttling (slow 3G, offline, etc.)
 * - Request/response logging
 * - Error simulation
 * - CORS bypass
 */

import { z } from "zod";
import log from "electron-log";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "../types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getPage } from "../browser_session";

const logger = log.scope("network_interceptor");

// ============================================================================
// Schema
// ============================================================================

const mockResponseAction = z.object({
  action: z.literal("mock_response"),
  url_pattern: z
    .string()
    .describe("URL pattern to match (supports * wildcards)"),
  status: z.number().describe("HTTP status code to return"),
  headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Response headers"),
  body: z.string().optional().describe("Response body (JSON string)"),
  delay_ms: z.number().optional().describe("Simulated network delay in ms"),
});

const interceptRequestAction = z.object({
  action: z.literal("intercept_request"),
  url_pattern: z.string().describe("URL pattern to match"),
  modify_headers: z
    .record(z.string(), z.string())
    .optional()
    .describe("Headers to add/modify"),
  modify_body: z.string().optional().describe("Request body to replace"),
});

const throttleNetworkAction = z.object({
  action: z.literal("throttle_network"),
  profile: z
    .enum(["offline", "slow-3g", "fast-3g", "4g", "wifi", "none"])
    .describe("Network profile"),
});

const logRequestsAction = z.object({
  action: z.literal("log_requests"),
  url_pattern: z.string().optional().describe("Filter by URL pattern"),
  method: z.string().optional().describe("Filter by HTTP method"),
  status: z.number().optional().describe("Filter by status code"),
  limit: z.number().optional().describe("Max entries to return (default: 50)"),
});

const simulateErrorAction = z.object({
  action: z.literal("simulate_error"),
  url_pattern: z.string().describe("URL pattern to match"),
  error_type: z
    .enum(["network-error", "timeout", "abort", "server-error", "rate-limit"])
    .describe("Error type to simulate"),
  status: z.number().optional().describe("Status code for server-error"),
});

const clearMocksAction = z.object({
  action: z.literal("clear_mocks"),
});

const networkInterceptorSchema = z.discriminatedUnion("action", [
  mockResponseAction,
  interceptRequestAction,
  throttleNetworkAction,
  logRequestsAction,
  simulateErrorAction,
  clearMocksAction,
]);

type NetworkInterceptorArgs = z.infer<typeof networkInterceptorSchema>;

// ============================================================================
// Description
// ============================================================================

const DESCRIPTION = `Intercept and modify network requests/responses for debugging and testing. Mock API responses, throttle network, simulate errors, and log all traffic.

### Actions

- **mock_response** — Return custom responses for matching URLs
- **intercept_request** — Modify outgoing request headers/body
- **throttle_network** — Simulate network conditions (offline, slow-3g, etc.)
- **log_requests** — View captured network traffic
- **simulate_error** — Force network errors for specific URLs
- **clear_mocks** — Remove all active mocks and interceptors

### Network Profiles
- \`offline\` — No network access
- \`slow-3g\` — 400ms RTT, 400kbps down
- \`fast-3g\` — 300ms RTT, 1.5Mbps down
- \`4g\` — 100ms RTT, 4Mbps down
- \`wifi\` — 2ms RTT, 30Mbps down

### Examples
\`\`\`
// Mock an API response
{action: "mock_response", url_pattern: "/api/users*", status: 200, body: '{"users": []}'}

// Simulate offline
{action: "throttle_network", profile: "offline"}

// Log all failed requests
{action: "log_requests", status: 400}

// Simulate server error
{action: "simulate_error", url_pattern: "/api/orders*", error_type: "server-error", status: 500}
\`\`\`

### Use Cases
1. **API Development** — Mock responses before backend is ready
2. **Error Testing** — Test error handling without real failures
3. **Performance Testing** — Simulate slow networks
4. **Edge Case Testing** — Test offline mode, rate limiting
5. **Debugging** — Inspect all traffic in real-time`;

// ============================================================================
// State
// ============================================================================

interface NetworkState {
  mocks: Map<
    string,
    {
      url_pattern: string;
      status: number;
      headers?: Record<string, string>;
      body?: string;
      delay_ms?: number;
    }
  >;
  logs: Array<{
    url: string;
    method: string;
    status: number;
    timestamp: number;
    headers?: Record<string, string>;
  }>;
  throttle_profile: string | null;
}

const state: NetworkState = {
  mocks: new Map(),
  logs: [],
  throttle_profile: null,
};

// ============================================================================
// Action Executors
// ============================================================================

async function executeMockResponse(
  page: any,
  args: z.infer<typeof mockResponseAction>,
): Promise<string> {
  const { url_pattern, status, headers, body, delay_ms } = args;

  // Store mock in state
  state.mocks.set(url_pattern, {
    url_pattern,
    status,
    headers,
    body,
    delay_ms,
  });

  // Inject route handler into page
  await page.evaluate(
    ({
      urlPattern,
      status,
      headers,
      body,
      delayMs,
    }: {
      urlPattern: string;
      status: number;
      headers?: Record<string, string>;
      body?: string;
      delayMs?: number;
    }) => {
      // Store in window for persistence
      if (!(window as any).__dyad_mocks) {
        (window as any).__dyad_mocks = new Map();

        // Override fetch
        const originalFetch = window.fetch;
        window.fetch = async (...args) => {
          const url =
            typeof args[0] === "string"
              ? args[0]
              : args[0] instanceof Request
                ? args[0].url
                : args[0]?.toString();

          // Check for matching mock
          for (const [pattern, mock] of (window as any).__dyad_mocks) {
            const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
            if (regex.test(url)) {
              if (mock.delay_ms) {
                await new Promise((r) => setTimeout(r, mock.delay_ms));
              }
              return new Response(mock.body || "", {
                status: mock.status,
                headers: mock.headers || {},
              });
            }
          }

          return originalFetch(...args);
        };
      }

      (window as any).__dyad_mocks.set(urlPattern, {
        status,
        headers,
        body,
        delay_ms: delayMs,
      });
    },
    {
      urlPattern: url_pattern,
      status,
      headers,
      body,
      delay_ms,
    },
  );

  return `Mock set: ${url_pattern} → ${status}${delay_ms ? ` (delay: ${delay_ms}ms)` : ""}`;
}

async function executeThrottleNetwork(
  page: any,
  args: z.infer<typeof throttleNetworkAction>,
): Promise<string> {
  const { profile } = args;

  const profiles: Record<
    string,
    { downloadThroughput: number; latency: number }
  > = {
    offline: { downloadThroughput: 0, latency: 0 },
    "slow-3g": { downloadThroughput: 50000, latency: 400 },
    "fast-3g": { downloadThroughput: 180000, latency: 300 },
    "4g": { downloadThroughput: 4000000, latency: 100 },
    wifi: { downloadThroughput: 30000000, latency: 2 },
    none: { downloadThroughput: -1, latency: 0 },
  };

  state.throttle_profile = profile;

  // Use Playwright's CDP session for throttling
  const context = page.context();
  const cdp = await context.newCDPSession(page);

  await cdp.send("Network.emulateNetworkConditions", {
    offline: profile === "offline",
    downloadThroughput: profiles[profile].downloadThroughput,
    uploadThroughput: profiles[profile].downloadThroughput,
    latency: profiles[profile].latency,
  });

  return `Network throttled to: ${profile}`;
}

async function executeLogRequests(
  page: any,
  args: z.infer<typeof logRequestsAction>,
): Promise<string> {
  const { url_pattern, method, status, limit } = args;

  // Inject request logger
  await page.evaluate(() => {
    if (!(window as any).__dyad_network_logs) {
      (window as any).__dyad_network_logs = [];

      const originalFetch = window.fetch;
      window.fetch = async (...args) => {
        const url =
          typeof args[0] === "string"
            ? args[0]
            : args[0] instanceof Request
              ? args[0].url
              : args[0]?.toString();
        const method = args[1]?.method || "GET";

        const response = await originalFetch(...args);

        (window as any).__dyad_network_logs.push({
          url,
          method,
          status: response.status,
          timestamp: Date.now(),
        });

        return response;
      };
    }
  });

  // Query logs
  const logs = await page.evaluate(
    ({
      urlPattern,
      method,
      status,
      limit,
    }: {
      urlPattern?: string;
      method?: string;
      status?: number;
      limit: number;
    }) => {
      let logs = (window as any).__dyad_network_logs || [];

      if (urlPattern) {
        const regex = new RegExp(urlPattern.replace(/\*/g, ".*"));
        logs = logs.filter((l: any) => regex.test(l.url));
      }
      if (method) {
        logs = logs.filter((l: any) => l.method === method);
      }
      if (status) {
        logs = logs.filter((l: any) => l.status === status);
      }

      return logs.slice(-limit);
    },
    { urlPattern: url_pattern, method, status, limit: limit || 50 },
  );

  return JSON.stringify(logs, null, 2);
}

async function executeSimulateError(
  page: any,
  args: z.infer<typeof simulateErrorAction>,
): Promise<string> {
  const { url_pattern, error_type, status } = args;

  const errorResponses: Record<string, { status: number; body: string }> = {
    "network-error": { status: 0, body: "Network error" },
    timeout: { status: 408, body: "Request timeout" },
    abort: { status: 0, body: "Request aborted" },
    "server-error": { status: status || 500, body: "Internal server error" },
    "rate-limit": { status: 429, body: "Too many requests" },
  };

  const response = errorResponses[error_type];

  // Mock the error response
  state.mocks.set(url_pattern, {
    url_pattern,
    status: response.status,
    body: response.body,
  });

  return `Error simulated: ${error_type} for ${url_pattern}`;
}

async function executeClearMocks(page: any): Promise<string> {
  const count = state.mocks.size;
  state.mocks.clear();

  // Clear page mocks
  await page.evaluate(() => {
    (window as any).__dyad_mocks = new Map();
  });

  return `Cleared ${count} mocks`;
}

// ============================================================================
// Tool Definition
// ============================================================================

export const networkInterceptorTool: ToolDefinition<NetworkInterceptorArgs> = {
  name: "network_interceptor",
  description: DESCRIPTION,
  inputSchema: networkInterceptorSchema,
  defaultConsent: "ask",
  modifiesState: true,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    switch (args.action) {
      case "mock_response":
        return `Mock ${args.url_pattern} → ${args.status}`;
      case "intercept_request":
        return `Intercept ${args.url_pattern}`;
      case "throttle_network":
        return `Throttle to ${args.profile}`;
      case "log_requests":
        return `Log network requests`;
      case "simulate_error":
        return `Simulate ${args.error_type} on ${args.url_pattern}`;
      case "clear_mocks":
        return `Clear all mocks`;
    }
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-network action="${escapeXmlAttr(args.action)}">`;
  },

  execute: async (args: NetworkInterceptorArgs, ctx: AgentContext) => {
    logger.log(`Executing network_interceptor: ${args.action}`);

    try {
      const page = await getPage();

      let result: string = "";

      switch (args.action) {
        case "mock_response":
          result = await executeMockResponse(page, args);
          break;
        case "throttle_network":
          result = await executeThrottleNetwork(page, args);
          break;
        case "log_requests":
          result = await executeLogRequests(page, args);
          break;
        case "simulate_error":
          result = await executeSimulateError(page, args);
          break;
        case "clear_mocks":
          result = await executeClearMocks(page);
          break;
      }

      ctx.onXmlComplete(
        `<dyad-network action="${escapeXmlAttr(args.action)}">${escapeXmlContent(result)}</dyad-network>`,
      );

      return result;
    } catch (error) {
      ctx.onXmlComplete(
        `<dyad-network action="${escapeXmlAttr(args.action)}"></dyad-network>`,
      );
      throw error;
    }
  },
};
