/**
 * GlitchTip Integration for Dyad (main process)
 *
 * GlitchTip is a free, open-source Sentry alternative.
 * This module initializes GlitchTip error tracking using the Sentry-compatible SDK.
 *
 * The `@sentry/electron` package is an OPTIONAL dependency: if it is not
 * installed, these functions degrade gracefully (no-op) instead of crashing
 * the app at import time.
 *
 * Setup:
 * 1. Install: npm install @sentry/electron
 * 2. Set GLITCHTIP_DSN in .env
 * 3. Import and call initGlitchTip() in main.ts
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type SentryScope = { setExtras: (extras: Record<string, any>) => void };
type SentryEvent = {
  request?: { headers?: Record<string, string> };
  exception?: {
    values?: Array<{
      stacktrace?: { frames?: Array<{ filename?: string }> };
    }>;
  };
};

type SentryModule = {
  init: (options: Record<string, any>) => void;
  withScope: (callback: (scope: SentryScope) => void) => void;
  captureException: (error: Error) => void;
  captureMessage: (message: string, level?: string) => void;
  setUser: (user: Record<string, any>) => void;
  addBreadcrumb: (breadcrumb: Record<string, any>) => void;
  browserTracingIntegration?: () => unknown;
  SeverityLevel?: unknown;
};

const GLITCHTIP_DSN =
  process.env.GLITCHTIP_DSN || "http://localhost:9000/api/1/envelope/";

let initialized = false;
let Sentry: SentryModule | null = null;

function loadSentry(): SentryModule | null {
  if (Sentry) {
    return Sentry;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Sentry = require("@sentry/electron") as SentryModule;
  } catch {
    Sentry = null;
  }
  return Sentry;
}

export function initGlitchTip() {
  if (initialized) {
    return;
  }

  const sdk = loadSentry();
  if (!sdk) {
    console.warn(
      "[GlitchTip] @sentry/electron not installed — skipping initialization",
    );
    return;
  }

  try {
    sdk.init({
      dsn: GLITCHTIP_DSN,

      // Environment
      environment: process.env.NODE_ENV || "development",

      // Release tracking
      release: process.env.APP_VERSION || "dev",

      // Sample rate (1.0 = 100% of errors)
      tracesSampleRate: 1.0,

      // Enable spotlight in development
      spotlight: process.env.NODE_ENV === "development",

      // Before send hook to filter sensitive data
      beforeSend(event: SentryEvent) {
        // Remove sensitive data
        if (event.request?.headers) {
          delete event.request.headers["Authorization"];
          delete event.request.headers["Cookie"];
        }

        // Remove local file paths
        if (event.exception?.values) {
          for (const exception of event.exception.values) {
            if (exception.stacktrace?.frames) {
              for (const frame of exception.stacktrace.frames) {
                if (frame.filename) {
                  // Replace user home directory with ~
                  frame.filename = frame.filename.replace(
                    /\/Users\/[^/]+/,
                    "/~",
                  );
                }
              }
            }
          }
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
    console.error("[GlitchTip] Failed to initialize:", error);
  }
}

export function captureException(error: Error, context?: Record<string, any>) {
  const sdk = loadSentry();
  if (!initialized || !sdk) {
    console.error("[GlitchTip] Not initialized, logging error:", error);
    return;
  }

  sdk.withScope((scope) => {
    if (context) {
      scope.setExtras(context);
    }
    sdk.captureException(error);
  });
}

export function captureMessage(message: string, level: string = "info") {
  const sdk = loadSentry();
  if (!initialized || !sdk) {
    return;
  }

  sdk.captureMessage(message, level);
}

export function setUser(user: {
  id?: string;
  email?: string;
  username?: string;
}) {
  const sdk = loadSentry();
  if (!initialized || !sdk) {
    return;
  }

  sdk.setUser(user);
}

export function addBreadcrumb(breadcrumb: {
  category: string;
  message: string;
  level?: string;
  data?: Record<string, any>;
}) {
  const sdk = loadSentry();
  if (!initialized || !sdk) {
    return;
  }

  sdk.addBreadcrumb({
    category: breadcrumb.category,
    message: breadcrumb.message,
    level: breadcrumb.level || "info",
    data: breadcrumb.data,
  });
}
