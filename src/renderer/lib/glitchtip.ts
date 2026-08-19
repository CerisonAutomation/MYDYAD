/**
 * GlitchTip Integration for Dyad Renderer
 *
 * This module initializes GlitchTip error tracking in the renderer process.
 * It uses the Sentry-compatible SDK for browser environments.
 *
 * The `@sentry/react` package is an OPTIONAL dependency: if it is not
 * installed, these functions degrade gracefully (no-op) instead of crashing
 * the renderer at import time.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type SentryScope = { setExtras: (extras: Record<string, any>) => void };
type SentryEvent = { request?: { headers?: Record<string, string> } };

type SentryModule = {
  init: (options: Record<string, any>) => void;
  withScope: (callback: (scope: SentryScope) => void) => void;
  captureException: (error: Error) => void;
  captureMessage: (message: string, level?: string) => void;
  browserTracingIntegration?: () => unknown;
};

let initialized = false;
let Sentry: SentryModule | null = null;

function loadSentry(): SentryModule | null {
  if (Sentry) {
    return Sentry;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Sentry = require("@sentry/react") as SentryModule;
  } catch {
    Sentry = null;
  }
  return Sentry;
}

const getDsn = (): string => {
  const env = (import.meta as any).env;
  return env?.VITE_GLITCHTIP_DSN || "http://localhost:9000/api/1/envelope/";
};

const getMode = (): string => {
  const env = (import.meta as any).env;
  return env?.MODE || "development";
};

const getAppVersion = (): string => {
  const env = (import.meta as any).env;
  return env?.VITE_APP_VERSION || "dev";
};

export function initGlitchTipRenderer() {
  if (initialized) {
    return;
  }

  const sdk = loadSentry();
  if (!sdk) {
    console.warn(
      "[GlitchTip] @sentry/react not installed — skipping initialization",
    );
    return;
  }

  try {
    sdk.init({
      dsn: getDsn(),

      // Environment
      environment: getMode(),

      // Release tracking
      release: getAppVersion(),

      // Sample rate
      tracesSampleRate: 1.0,

      // Enable spotlight in development
      spotlight: getMode() === "development",

      // Before send hook
      beforeSend(event: SentryEvent) {
        // Remove sensitive data
        if (event.request?.headers) {
          delete event.request.headers["Authorization"];
          delete event.request.headers["Cookie"];
        }

        return event;
      },

      // Integrations
      integrations: sdk.browserTracingIntegration
        ? [sdk.browserTracingIntegration()]
        : [],
    });

    initialized = true;
  } catch (error) {
    console.error("[GlitchTip] Renderer failed to initialize:", error);
  }
}

export function captureRendererException(
  error: Error,
  context?: Record<string, any>,
) {
  const sdk = loadSentry();
  if (!initialized || !sdk) {
    console.error(
      "[GlitchTip] Renderer not initialized, logging error:",
      error,
    );
    return;
  }

  sdk.withScope((scope) => {
    if (context) {
      scope.setExtras(context);
    }
    sdk.captureException(error);
  });
}

export function captureRendererMessage(
  message: string,
  level = "info",
) {
  const sdk = loadSentry();
  if (!initialized || !sdk) {
    return;
  }

  sdk.captureMessage(message, level);
}
