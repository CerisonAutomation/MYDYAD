import { RouterProvider } from "@tanstack/react-router";
import log from "electron-log";
import posthog from "posthog-js";
import { PostHogProvider } from "posthog-js/react";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./router";

// Fix EIO/ENOTTY/EBADF errors when renderer console transport writes to a
// closed file descriptor (happens during shutdown or packaged builds).
// Mirrors the same protection already applied to the main process in main.ts.
try {
  const consoleTransport = (log as any).transports?.console;
  if (consoleTransport && typeof consoleTransport.writeFn === "function") {
    const originalWriteFn = consoleTransport.writeFn;
    consoleTransport.writeFn = (args: any) => {
      try {
        originalWriteFn(args);
      } catch (e: any) {
        if (
          e?.code === "EIO" ||
          e?.code === "ENOTTY" ||
          e?.code === "EBADF" ||
          e?.code === "EPIPE"
        ) {
          return;
        }
        throw e;
      }
    };
  }
} catch {
  // Transport override is best-effort — not critical
}
import {
  getTelemetryUserId,
  isDyadProUser,
  isTelemetryOptedIn,
} from "./hooks/useSettings";

// Initialize i18next before any rendering
import "./i18n";
import {
  MutationCache,
  QueryCache,
  QueryClient,
  QueryClientProvider,
  useQueryClient,
} from "@tanstack/react-query";
import { useStore } from "jotai";
import {
  earlyTelemetryEvents,
  registerEarlyRendererEvents,
} from "./app_wiring/early_renderer_events";
import { registerRendererIpcListeners } from "./app_wiring/registerRendererIpcListeners";
import {
  ensureRecentViewedChatIdAtom,
  initializeChatTabSessionStorageAtom,
} from "./atoms/chatAtoms";
import { clearRecorderForAppAtom } from "./atoms/recorderAtoms";
import { clearTestRuntimeForAppAtom } from "./atoms/testRuntimeAtoms";
import {
  ChatStreamProvider,
  useChatStreamManager,
} from "./chat_stream/ChatStreamProvider";
import { ipc } from "./ipc/types";
import {
  createExceptionFromTelemetry,
  getExceptionTelemetryContext,
  shouldBypassNonProTelemetrySampling,
  shouldFilterPostHogExceptionEvent,
} from "./lib/posthogTelemetry";
import { queryKeys } from "./lib/queryKeys";
import { showError } from "./lib/toast";
import {
  EntityDisposalProvider,
  useEntityDisposal,
  useRegisterEntityDisposer,
} from "./state_machines/react";
import { AgentOverlayProvider } from "./agent_overlay";
import {
  captureErrorScreenshot,
  getLastErrorScreenshot,
} from "./utils/error_screenshot";
import {
  configureChatTabWindowSession,
  promoteMostRecentChatTabSession,
  pruneChatTabWindowSessions,
} from "./window_infrastructure/chat_tab_session_storage";
import { initialWindowNavigation } from "./window_infrastructure/initial_window_navigation";
import type { VisibleEntity } from "./window_infrastructure/types";

// @ts-ignore
registerEarlyRendererEvents();

// ── Global Error Screenshot Capture ──────────────────────────────────────────
// When an unhandled error or promise rejection occurs, capture a preview
// screenshot BEFORE PostHog reports the exception. The screenshot is stored
// so the PostHog before_send hook can attach it to the $exception event.

// Debounce: only capture one screenshot per 3 seconds to avoid flooding
let lastGlobalCaptureTime = 0;
const GLOBAL_CAPTURE_DEBOUNCE_MS = 3000;

function onGlobalError(event: ErrorEvent) {
  const now = Date.now();
  if (now - lastGlobalCaptureTime < GLOBAL_CAPTURE_DEBOUNCE_MS) return;
  lastGlobalCaptureTime = now;
  // Fire-and-forget: capture screenshot for next PostHog exception event
  void captureErrorScreenshot();
}

function onUnhandledRejection(event: PromiseRejectionEvent) {
  const now = Date.now();
  if (now - lastGlobalCaptureTime < GLOBAL_CAPTURE_DEBOUNCE_MS) return;
  lastGlobalCaptureTime = now;
  void captureErrorScreenshot();
}

window.addEventListener("error", onGlobalError);
window.addEventListener("unhandledrejection", onUnhandledRejection);

interface MyMeta extends Record<string, unknown> {
  showErrorToast: boolean;
}

declare module "@tanstack/react-query" {
  interface Register {
    queryMeta: MyMeta;
    mutationMeta: MyMeta;
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.meta?.showErrorToast) {
        showError(error);
      }
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.meta?.showErrorToast) {
        showError(error);
      }
    },
  }),
});

// PostHog init: the SDK's init() is synchronous for local state setup but
// fires network requests (decide endpoint) immediately. We keep it eager
// because the client reference is needed by the before_send callback and
// PostHogProvider. The network requests are non-blocking async I/O.
const posthogClient = posthog.init(
  "phc_5Vxx0XT8Ug3eWROhP6mm4D6D2DgIIKT232q4AKxC2ab",
  {
    api_host: "https://us.i.posthog.com",
    // @ts-ignore
    debug: import.meta.env.MODE === "development",
    autocapture: false,
    capture_exceptions: true,
    capture_pageview: false,
    before_send: (event) => {
      if (!isTelemetryOptedIn()) {
        console.debug("Telemetry not opted in, skipping event");
        return null;
      }

      if (shouldFilterPostHogExceptionEvent(event)) {
        console.debug(
          "Filtering generic fetch failed exception from telemetry",
        );
        return null;
      }
      const telemetryUserId = getTelemetryUserId();
      if (telemetryUserId) {
        posthogClient.identify(telemetryUserId);
      }

      if (event?.properties["$ip"]) {
        event.properties["$ip"] = null;
      }

      // For non-Pro users, only send 10% of events (but always send errors,
      // app:initial-load, promo_click, and sandbox.script.* — see
      // shouldBypassNonProTelemetrySampling).
      if (!isDyadProUser()) {
        if (
          !shouldBypassNonProTelemetrySampling(event) &&
          Math.random() > 0.1
        ) {
          console.debug("Non-Pro user: sampling out event", event?.event);
          return null;
        }
      }

      console.debug(
        "Telemetry opted in - UUID:",
        telemetryUserId,
        "sending event",
        event,
      );

      // Attach auto-captured error screenshot to exception events (free, via capturePage)
      if (event?.event === "$exception" || event?.properties?.$exception_type) {
        const screenshot = getLastErrorScreenshot();
        if (screenshot?.dataUrl) {
          event.properties = event.properties || {};
          event.properties.error_screenshot = screenshot.dataUrl;
          event.properties.error_screenshot_timestamp = screenshot.timestamp;
        }
      }

      return event;
    },
    persistence: "localStorage",
  },
);

function App() {
  return (
    <ChatStreamProvider>
      <RendererServices />
    </ChatStreamProvider>
  );
}

function RendererServices() {
  const queryClient = useQueryClient();
  const store = useStore();
  const chatStreamManager = useChatStreamManager();
  const entityDisposal = useEntityDisposal();
  const [windowReady, setWindowReady] = useState(false);
  const clearAppRuntime = useCallback(
    (appId: number) => {
      store.set(clearTestRuntimeForAppAtom, appId);
      // Recorded interactions can carry whatever the user typed into the app;
      // a deleted app must not leave them (or its draft) resident for the rest
      // of the renderer's life.
      store.set(clearRecorderForAppAtom, appId);
      // The main process holds its own copies: a parked draft, and possibly a
      // live session still serving an isolated database and holding the app's
      // lock. Clearing the atoms only takes away the UI that could have ended
      // them. (`stopApp` during deletion ends the session too, but deletion
      // paths that never started the app wouldn't have.)
      void ipc.recording.discardRecordedTestDraft({ appId }).catch(() => {});
      void ipc.recording.stopRecording({ appId }).catch(() => {});
    },
    [store],
  );
  useRegisterEntityDisposer("app", clearAppRuntime);

  // Fetch user budget on app load
  useEffect(() => {
    queryClient.prefetchQuery({
      queryKey: queryKeys.userBudget.info,
      queryFn: () => ipc.instructions.getUserBudget(),
    });
  }, [queryClient]);

  useEffect(() => {
    // Subscribe to navigation state changes
    const unsubscribe = router.subscribe("onResolved", (navigation) => {
      // Capture the navigation event in PostHog
      posthog.capture("navigation", {
        toPath: navigation.toLocation.pathname,
        fromPath: navigation.fromLocation?.pathname,
      });

      // Optionally capture as a standard pageview as well
      posthog.capture("$pageview", {
        path: navigation.toLocation.pathname,
      });
    });

    // Clean up subscription when component unmounts
    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(
    () =>
      earlyTelemetryEvents.subscribe(({ eventName, properties }) => {
        if (eventName === "$exception") {
          posthog.captureException(
            createExceptionFromTelemetry(properties),
            getExceptionTelemetryContext(properties),
          );
          return;
        }

        posthog.capture(eventName, properties);
      }),
    [],
  );

  useEffect(() => {
    let disposed = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelayMs = 100;
    const bootstrapWindow = () => {
      void ipc.windowInfrastructure
        .bootstrap({})
        .then((bootstrap) => {
          if (disposed) return;
          configureChatTabWindowSession(bootstrap.windowSessionId, {
            mayMigrateLegacySession: bootstrap.mayMigrateLegacyChatTabSession,
          });
          try {
            if (bootstrap.mayMigrateLegacyChatTabSession) {
              promoteMostRecentChatTabSession(
                window.localStorage,
                bootstrap.windowSessionId,
              );
            }
            pruneChatTabWindowSessions(
              window.localStorage,
              bootstrap.restorableWindowSessionIds,
            );
            store.set(initializeChatTabSessionStorageAtom);
          } catch (error) {
            // Browser storage is optional presentation state. A denied or full
            // localStorage must not turn a successful main-process bootstrap
            // into a permanently blank product window.
            console.error(
              "Failed to initialize chat tab session storage",
              error,
            );
          }
          const entity: VisibleEntity | undefined = bootstrap.initialEntity;
          if (entity?.kind === "chat") {
            // Seed the tab before route navigation. ChatTabs hydration merges
            // pre-hydration opens, so this works even with a collapsed sidebar.
            store.set(ensureRecentViewedChatIdAtom, entity.id);
          }
          const navigation = initialWindowNavigation(
            entity,
            bootstrap.initialChatAppId,
          );
          if (navigation) {
            void router.navigate({ ...navigation, replace: true });
          }
          setWindowReady(true);
        })
        .catch((error) => {
          if (disposed) return;
          console.error("Failed to initialize window session", error);
          retryTimer = setTimeout(bootstrapWindow, retryDelayMs);
          retryDelayMs = Math.min(retryDelayMs * 2, 5_000);
        });
    };
    bootstrapWindow();
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, []);

  useEffect(() => {
    if (!windowReady) return;
    return registerRendererIpcListeners({
      ipcClient: ipc,
      store,
      queryClient,
      chatStreamManager,
      entityDisposal,
      getCurrentPathname: () => router.state.location.pathname,
      subscribeToNavigation: (listener) =>
        router.subscribe("onResolved", listener),
    });
  }, [chatStreamManager, entityDisposal, queryClient, store, windowReady]);

  return windowReady ? <RouterProvider router={router} /> : null;
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <PostHogProvider client={posthogClient}>
        <AgentOverlayProvider>
          <EntityDisposalProvider>
            <App />
          </EntityDisposalProvider>
        </AgentOverlayProvider>
      </PostHogProvider>
    </QueryClientProvider>
  </StrictMode>,
);
