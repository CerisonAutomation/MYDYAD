// startProxy.js – helper to launch proxy.js as a worker

import { Worker } from "worker_threads";
import path from "path";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  PROXY_FALLBACK_MAX_ATTEMPTS,
  getProxyFallbackPortStart,
} from "../../../shared/ports";

const logger = log.scope("start_proxy_server");

const PROXY_MAX_RESTART_ATTEMPTS = 3;
const PROXY_RESTART_DELAY_MS = 1_000;

// WeakMap to track restart state per worker without changing the Worker type
const restartState = new WeakMap<
  Worker,
  { count: number; disposed: boolean; targetOrigin: string; opts: ProxyOpts }
>();

interface ProxyOpts {
  port: number;
  onStarted?: (proxyUrl: string) => void;
  onError?: (error: DyadError) => void;
  onCrash?: (exitCode: number | null) => void;
  fixedHeaders?: Record<string, string>;
}

function createWorker(targetOrigin: string, opts: ProxyOpts): Worker {
  const fallbackPortStart = getProxyFallbackPortStart();

  const worker = new Worker(
    path.resolve(__dirname, "..", "..", "worker", "proxy_server.js"),
    {
      workerData: {
        targetOrigin,
        port: opts.port,
        fallbackPortStart,
        maxPortAttempts: PROXY_FALLBACK_MAX_ATTEMPTS,
        fixedHeaders: opts.fixedHeaders,
      },
    },
  );

  worker.on("message", (m) => {
    logger.info("[proxy]", m);
    if (typeof m === "string" && m.startsWith("proxy-server-start url=")) {
      const url = m.substring("proxy-server-start url=".length);
      opts.onStarted?.(url);
    } else if (typeof m === "string" && m.startsWith("proxy-server-error")) {
      logger.error("[proxy] failed to bind:", m);
      opts.onError?.(
        new DyadError(
          `Could not start the preview proxy: every port from ${opts.port} to ${fallbackPortStart + PROXY_FALLBACK_MAX_ATTEMPTS - 1} is in use. Free up a port and restart the app.`,
          DyadErrorKind.Conflict,
        ),
      );
    } else if (typeof m === "string" && m.includes("upstream UNREACHABLE")) {
      logger.warn("[proxy] upstream unreachable:", m);
    } else if (typeof m === "string" && m.includes("FATAL")) {
      logger.error("[proxy] fatal error in worker:", m);
    }
  });

  worker.on("error", (e) => logger.error("[proxy] error:", e));

  worker.on("exit", (code) => {
    logger.info("[proxy] exit", code);
    const state = restartState.get(worker);
    if (!state || state.disposed) return;

    // Non-zero exit = crash — attempt restart
    if (code !== 0 && state.count < PROXY_MAX_RESTART_ATTEMPTS) {
      state.count++;
      logger.warn(
        `[proxy] worker crashed with code ${code}, restarting (attempt ${state.count}/${PROXY_MAX_RESTART_ATTEMPTS})`,
      );
      setTimeout(() => {
        if (!state.disposed) {
          const newWorker = createWorker(targetOrigin, opts);
          restartState.set(newWorker, state);
          // Note: caller still holds reference to old worker;
          // the WeakMap entry for the old worker will be GC'd.
        }
      }, PROXY_RESTART_DELAY_MS);
    } else if (code !== 0) {
      logger.error(
        `[proxy] worker crashed ${PROXY_MAX_RESTART_ATTEMPTS} times, giving up`,
      );
      opts.onCrash?.(code);
    }
  });

  return worker;
}

export async function startProxy(
  targetOrigin: string,
  opts: ProxyOpts,
): Promise<Worker> {
  if (!/^https?:\/\//.test(targetOrigin))
    throw new DyadError(
      "startProxy: targetOrigin must be absolute http/https URL",
      DyadErrorKind.Validation,
    );

  logger.info("Starting proxy on port", opts.port);

  const worker = createWorker(targetOrigin, opts);
  restartState.set(worker, {
    count: 0,
    disposed: false,
    targetOrigin,
    opts,
  });

  return worker;
}
