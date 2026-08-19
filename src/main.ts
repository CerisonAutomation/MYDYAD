import { randomUUID } from "node:crypto";
import * as path from "node:path";
import {
  net,
  BrowserWindow,
  type Event as ElectronEvent,
  Menu,
  app,
  autoUpdater,
  crashReporter,
  dialog,
  nativeImage,
  protocol,
  session,
} from "electron";

// Suppress harmless EPIPE errors from console.error writing to dead pipes
// (e.g. logging after Docker container or dev server process exits)
process.on("uncaughtException", (err) => {
  if (err instanceof Error && (err as any).code === "EPIPE") return;
  console.error("[main] uncaughtException:", err);
});
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import dotenv from "dotenv";
// @ts-ignore
import started from "electron-squirrel-startup";
import { registerIpcHandlers } from "./ipc/ipc_host";
console.log(
  "[BOOT] main.ts loaded, E2E_TEST_BUILD=",
  process.env.E2E_TEST_BUILD,
);

// Force Chromium to use a basic file-based password store instead of the
// macOS Keychain. This must run before app.whenReady() so that os_crypt
// never attempts a Keychain lookup. Combined with DYAD_NO_KEYCHAIN=1
// (which bypasses Dyad's own safeStorage calls), this eliminates all
// Keychain prompts.
app.commandLine.appendSwitch("password-store", "basic");

import fs from "fs";
import { pathToFileURL } from "node:url";
import { eq } from "drizzle-orm";
import log from "electron-log";
import { UpdateSourceType, updateElectronApp } from "update-electron-app";
import { BackupManager } from "./backup_manager";
import { closeDatabase, db, getDatabasePath, initializeDatabase } from "./db";
import { apps } from "./db/schema";
import { DyadError, DyadErrorKind, isDyadError } from "./errors/dyad_error";
import {
  AddMcpServerConfigSchema,
  type AddMcpServerPayload,
  AddPromptDataSchema,
  type AddPromptPayload,
} from "./ipc/deep_link_data";
import {
  disposeConnectionFlowsForShutdown,
  runOAuthReturnExchange,
} from "./ipc/handlers/connection_flow_handlers";
import { remoteMachineHost } from "./ipc/services/distributed_machine_host";
import { scrubGithubTokenFromRemotes } from "./ipc/utils/git_remote_token_scrub";
import { gitAddSafeDirectory } from "./ipc/utils/git_utils";
import {
  applyManagedNodeToProcessPath,
  getManagedNodeVersion,
  maybeUpgradeManagedNode,
} from "./ipc/utils/managed_node";
import { disposeMcpOAuthForShutdown } from "./ipc/utils/mcp_oauth_flow";
import { encryptStoredMcpSecrets } from "./ipc/utils/mcp_secret_encryption";
import {
  createMcpBeforeQuitHandler,
  disposeMcpClientsForShutdown,
} from "./ipc/utils/mcp_shutdown";
import { cleanupOldMediaFiles } from "./ipc/utils/media_cleanup";
import {
  createPlatformThumbnailFromPath,
  getMediaThumbnailCacheRoot,
} from "./ipc/utils/media_thumbnail";
import { reconcileOrphanTestBranches } from "./ipc/utils/neon_test_branch";
import {
  stopAllAppsSync,
  stopAppGarbageCollection,
} from "./ipc/utils/process_manager";
import { configureTrustedRenderer } from "./ipc/utils/renderer_security";
import {
  applyManagedPnpmToProcessPath,
  getManagedPnpmBinDir,
  getManagedPnpmInstallDir,
} from "./ipc/utils/socket_firewall";
import { reconcileOrphanTestUsers } from "./ipc/utils/supabase_test_user";
import {
  sendTelemetryEvent,
  sendTelemetryEventToWindow,
} from "./ipc/utils/telemetry";
import { IS_TEST_BUILD } from "./ipc/utils/test_utils";
import type { UserSettings } from "./lib/schemas";
import { appRelaunchRequest } from "./main/app_relaunch_request";
import { createDeepLinkQueue } from "./main/deep_link_queue";
import { DeepLinkWindowReadiness } from "./main/deep_link_window_readiness";
import { createDyadMediaProtocolHandler } from "./main/dyad_media_protocol";
import { registerDyadProtocolLinux } from "./main/linux_protocol_registration";
import { handleDyadProReturn } from "./main/pro";
import {
  clearCrashSentinel,
  clearRendererCrashRecord,
  crashSentinelExists,
  getSettingsFilePath,
  readCrashSentinel,
  readEffectiveSettings,
  readRendererCrashRecord,
  readSettings,
  recordRendererCrash,
  setInitialLoadIsFirstSession,
  tryWriteSettings,
  writeCrashSentinel,
} from "./main/settings";
import { recordUpdaterError } from "./main/updater_state";
import {
  shouldCreateWindowOnActivate,
  shouldQuitAfterAllWindowsClosed,
  shouldRequestRelaunchOnActivate,
  shouldRetainClosedWindowForActivation,
} from "./main/window_lifecycle_policy";
import {
  getWindowOpenHandlerResponse,
  securePreviewPopupOptions,
  shouldBlockMainWindowNavigation,
} from "./main/window_security";
import { handleNeonOAuthReturn } from "./neon_admin/neon_return_handler";
import {
  getDyadAppPath,
  getDyadAppsBaseDirectory,
  getUserDataPath,
} from "./paths/paths";
import { cleanupOldAiMessagesJson } from "./pro/main/ipc/handlers/local_agent/ai_messages_cleanup";
import {
  startChatSearchIndexer,
  stopChatSearchIndexer,
} from "./pro/main/ipc/handlers/local_agent/chat_search_indexer";
import { handleSupabaseOAuthReturn } from "./supabase_admin/supabase_return_handler";
import {
  listDumpFilesRecursive,
  moveDump,
  pruneDumps,
} from "./utils/crash_dumps";
import {
  crashAnnotationEventFields,
  crashPerformanceEventFields,
} from "./utils/crash_telemetry_fields";
import {
  type MinidumpSummary,
  browserCrashAttribution,
  parseMinidumpSummary,
} from "./utils/minidump_summary";
import { classifyOom } from "./utils/oom_classifier";
import {
  startPerformanceMonitoring,
  stopPerformanceMonitoring,
} from "./utils/performance_monitor";
import {
  awaitProductWindowRenderer,
  configureWindowProductController,
} from "./window_infrastructure/main/window_product_controller";
import { windowRegistry } from "./window_infrastructure/main/window_registry";
import {
  MAX_PRODUCT_WINDOWS,
  type WindowSessionDescriptor,
  clearLegacyWindowSessionPersistence,
  restorableVisibleEntity,
} from "./window_infrastructure/main/window_session";
import {
  PRIMARY_WINDOW_SESSION_ID,
  type WindowSessionId,
} from "./window_infrastructure/types";

log.errorHandler.startCatching();
log.eventLogger.startLogging();
log.scope.labelPadding = false;

// ── EPIPE suppression (three layers) ──────────────────────────────────
// When stdout/stderr pipes break (terminal closed, headless session),
// console.error → process.stderr.write throws EPIPE synchronously.
// electron-log's own writeFn catch block sometimes misses it because
// Node streams can emit the error before the try/catch frame returns.
// Fix: patch at the stream level + transport level + global handler.

function patchStreamEpipe(stream: NodeJS.WriteStream | NodeJS.Socket) {
  const originalWrite = stream.write;
  const patchedWrite = function patchedWrite(
    this: typeof stream,
    ...args: Parameters<typeof originalWrite>
  ): boolean {
    try {
      return originalWrite.apply(this, args);
    } catch (err: any) {
      if (err?.code === "EPIPE") return true; // silently swallow
      throw err;
    }
  } as typeof originalWrite;
  stream.write = patchedWrite;
}

if (process.stdout) patchStreamEpipe(process.stdout);
if (process.stderr) patchStreamEpipe(process.stderr);

const consoleTransport = log.transports.console;
if (consoleTransport) {
  const originalWriteFn = (consoleTransport as any).writeFn;
  if (typeof originalWriteFn === "function") {
    (consoleTransport as any).writeFn = (args: any) => {
      try {
        originalWriteFn(args);
      } catch (err: any) {
        if (err?.code === "EPIPE") return;
        throw err;
      }
    };
  }
}

process.on("uncaughtException", (error: Error) => {
  if ((error as NodeJS.ErrnoException).code === "EPIPE") return;
  throw error;
});
const execFileAsync = promisify(execFile);

// Prefer the Dyad-managed pnpm (if installed) for everything spawned from the
// main process. Runs after all module imports, so it wins over the shell PATH
// that fixPath() restores at app_runtime_service load time.
applyManagedPnpmToProcessPath();

async function resolveStartupExecutablePath(
  command: string,
): Promise<string | null> {
  try {
    const { stdout } =
      process.platform === "win32"
        ? await execFileAsync("where.exe", [command], {
            encoding: "utf8",
            env: process.env,
          })
        : await execFileAsync("which", [command], {
            encoding: "utf8",
            env: process.env,
          });
    return (
      stdout
        .split(/\r?\n/)
        .find((line) => line.trim())
        ?.trim() ?? null
    );
  } catch {
    return null;
  }
}

async function logStartupExecutablePaths(): Promise<void> {
  const [node, npm, pnpm] = await Promise.all([
    resolveStartupExecutablePath("node"),
    resolveStartupExecutablePath("npm"),
    resolveStartupExecutablePath("pnpm"),
  ]);

  log.info("Startup executable paths", {
    node,
    npm,
    pnpm,
    managedPnpmBinDir: getManagedPnpmBinDir(),
    managedPnpmInstallDir: getManagedPnpmInstallDir(),
  });
}

void logStartupExecutablePaths();

// In dev, keep minidumps under the project's ./userData (matching where Dyad
// writes its other dev files) instead of the OS userData dir, so they don't
// mingle with a prod install's dumps. Must run before crashReporter.start.
if (process.env.NODE_ENV === "development") {
  const devUserData = getUserDataPath();
  fs.mkdirSync(devUserData, { recursive: true });
  app.setPath("userData", devUserData);

  const devCrashDumps = path.join(devUserData, "Crashpad");
  fs.mkdirSync(devCrashDumps, { recursive: true });
  app.setPath("crashDumps", devCrashDumps);
}

// Capture native crashes (main/renderer/GPU/utility) as local minidumps. Not
// uploaded; parsed on the next launch into a summary we send as telemetry.
// Must start before the app is ready. globalExtra annotates every dump with
// static context; dynamic GPU status is added in onReady.
crashReporter.start({
  uploadToServer: false,
  compress: true,
  globalExtra: {
    app_version: app.getVersion(),
    electron_version: process.versions.electron ?? "unknown",
    chrome_version: process.versions.chrome ?? "unknown",
    os: process.platform,
    arch: process.arch,
  },
});

const logger = log.scope("main");

// Cap retained dumps so they don't accumulate indefinitely; keep only a few
// recent ones for examination/export.
const MAX_RETAINED_DUMPS = 5;
let nativeCrashDumpsProcessed = false;
let pendingNativeBrowserCrash: {
  summary: MinidumpSummary;
  attribution: "ptype" | "sentinel";
} | null = null;

// Summarize each new minidump (signal, faulting module + offset, process type —
// no memory). A main-process crash is the app crash, so its summary is stashed
// and attached to app:crash_detected; other (survived child) crashes are left
// to their own paths. Each dump is then kept under a timestamped name for later
// examination. Runs once per session.
function processNativeCrashDumps(): void {
  if (nativeCrashDumpsProcessed) {
    return;
  }
  nativeCrashDumpsProcessed = true;

  const crashDumpsDir = app.getPath("crashDumps");
  // Where we keep dumps we've already reported, for later examination. Under
  // userData (not inside crashDumpsDir) so it stays separate from Crashpad's
  // own dump dirs and isn't picked up by the scan above.
  const retainDir = path.join(app.getPath("userData"), "dyad-crash-reports");
  try {
    fs.mkdirSync(retainDir, { recursive: true });
  } catch (error) {
    // Without the retain dir, moving a dump would fail and drop it. Leave the
    // dumps in place and try again on the next launch.
    logger.warn("Could not create crash reports directory:", error);
    return;
  }

  for (const file of listDumpFilesRecursive(crashDumpsDir)) {
    const summary = parseMinidumpSummary(file);
    if (summary) {
      logger.info(
        "Native crash:",
        summary.ptype,
        summary.crashReason,
        summary.faultingModule,
        summary.faultingOffset,
      );
      // The sentinel check in onReady runs before the window exists, so
      // pendingCrashDetected already reflects it by the time this runs
      // from did-finish-load.
      const attribution = browserCrashAttribution(
        summary,
        pendingCrashDetected,
      );
      // A ptype dump outranks a sentinel-attributed one, so a stripped
      // child dump cannot claim the crash when the labeled browser dump
      // is also in the scan.
      const outranks =
        attribution === "ptype" &&
        pendingNativeBrowserCrash?.attribution === "sentinel";
      if (attribution && (!pendingNativeBrowserCrash || outranks)) {
        pendingNativeBrowserCrash = { summary, attribution };
        // A browser-process dump is direct evidence of a main-process crash,
        // so report it even if the crash sentinel wasn't written (e.g. a
        // crash during early startup).
        pendingCrashDetected = true;
      }
    }
    // Retain (timestamp-named) so it can be examined/exported and isn't
    // re-summarized next launch; this also drains Crashpad's dump dirs.
    moveDump(file, path.join(retainDir, crashReportName(file)));
  }
  pruneDumps(retainDir, MAX_RETAINED_DUMPS);
}

// A readable, sortable dump name from the crash time (the dump's mtime), with a
// short id suffix to avoid collisions: crash-2026-06-07T20-41-55-123Z-9ac4d4e8.dmp
function crashReportName(dumpPath: string): string {
  let mtimeMs = Date.now();
  try {
    mtimeMs = fs.statSync(dumpPath).mtimeMs;
  } catch {
    // fall back to now
  }
  const ts = new Date(mtimeMs).toISOString().replace(/[:.]/g, "-");
  const id = path.basename(dumpPath).slice(0, 8);
  return `crash-${ts}-${id}.dmp`;
}
const deepLinkQueue = createDeepLinkQueue(handleDeepLinkReturn);
const deepLinkWindowReadiness = new DeepLinkWindowReadiness<BrowserWindow>(
  deepLinkQueue,
);
let crashRecoveryWindowReadiness: DeepLinkWindowReadiness<BrowserWindow>;
crashRecoveryWindowReadiness = new DeepLinkWindowReadiness<BrowserWindow>({
  markReady: () => {
    const target = crashRecoveryWindowReadiness.getTarget();
    if (target) deliverPendingCrashRecovery(target);
  },
  markNotReady: () => undefined,
});

// Load environment variables from .env file (dev only)
if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

// Register IPC handlers before app is ready
registerIpcHandlers();

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Decide the git directory depending on environment
function resolveLocalGitDirectory() {
  if (!app.isPackaged) {
    // Dev: app.getAppPath() is the project root
    return path.join(app.getAppPath(), "node_modules/dugite/git");
  }

  // Packaged app: git is bundled via extraResource
  return path.join(process.resourcesPath, "git");
}

const gitDir = resolveLocalGitDirectory();
if (fs.existsSync(gitDir)) {
  process.env.LOCAL_GIT_DIRECTORY = gitDir;
}

// https://www.electronjs.org/docs/latest/tutorial/launch-app-from-url-in-another-app#main-process-mainjs
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("dyad", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient("dyad");
}

/**
 * Dev-only startup diagnostics. Writes a timestamped trace to
 * <userData>/debug.log so blank-window / boot failures are visible
 * without a debugger attached. No-op in production builds.
 */
function debugLog(msg: string) {
  if (process.env.NODE_ENV !== "development") return;
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    const debugPath = path.join(app.getPath("userData"), "debug.log");
    fs.appendFileSync(debugPath, line);
  } catch {
    // Ignore write errors in debug logging
  }
}

export async function onReady() {
  debugLog("onReady() STARTED");

  // ── Content Security Policy (fixes blank screen + preview iframe) ─────────
  // Allow the preview proxy port (42100-52099) in frame-src and frame-ancestors
  // so the iframe can load the proxied dev server. Without port wildcards,
  // Electron blocks framing on non-default ports.
  const isDev = !app.isPackaged;
  // CSP3: host-sources without a port match ANY port — no wildcard-port syntax needed
  const csp = isDev
    ? "default-src 'self' unsafe-inline unsafe-eval blob: data: https: http:; script-src 'self' 'unsafe-eval' 'unsafe-inline' blob: data: https: http:; style-src 'self' 'unsafe-inline' blob: data: https: http:; connect-src 'self' ws://localhost:* http://localhost:* http://127.0.0.1:* https: http: blob: data:; worker-src 'self' blob: data:; frame-src 'self' http://localhost:* http://127.0.0.1:* file: blob: data: https: http:; frame-ancestors 'self' file: http://localhost:* http://127.0.0.1:* https://* http://*; img-src 'self' data: blob: https://* http://* dyad-media:; font-src 'self' data: blob: https://* http://*;"
    : "default-src 'self'; script-src 'self'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-src 'self' http://localhost:* http://127.0.0.1:* file: blob:; frame-ancestors 'self' file: http://localhost:* http://127.0.0.1:* https://*; img-src 'self' data: blob: dyad-media:; font-src 'self' data:;";
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [csp],
      },
    });
  });

  // Linux: claim the dyad:// scheme for this build (best-effort, see module).
  // setAsDefaultProtocolClient above is unreliable on Linux. Pass this instance's
  // userData so a browser-launched deep link forwards here, not a second window.
  void registerDyadProtocolLinux(app.getPath("userData"));
  debugLog("registerDyadProtocolLinux done");

  // React DevTools extension loading is intentionally disabled. In Electron it
  // can spam startup logs with:
  // "Unchecked runtime.lastError: Could not establish connection. Receiving end does not exist."
  // from chrome-extension://fmkadmapgofadopljbjfkapdkoienihi/main.html.

  try {
    const backupManager = new BackupManager({
      settingsFile: getSettingsFilePath(),
      dbFile: getDatabasePath(),
    });
    await backupManager.initialize();
    debugLog("backupManager initialized");
  } catch (e) {
    logger.error("Error initializing backup manager", e);
  }
  try {
    initializeDatabase();
    debugLog("database initialized OK");
  } catch (error) {
    logger.error("Failed to initialize database", error);
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox(
      "Database Migration Failed",
      `Dyad could not initialize its local database. ${message}`,
    );
    app.quit();
    return;
  }

  // Reconcile any Neon test branches / Supabase test users leaked by a previous
  // session that crashed mid test-run. Fire-and-forget: best-effort cleanup
  // must not block startup.
  void reconcileOrphanTestBranches();
  void reconcileOrphanTestUsers();

  // Cleanup old ai_messages_json entries to prevent database bloat
  void cleanupOldAiMessagesJson().catch((error) =>
    logger.error("Failed to cleanup old ai_messages_json:", error),
  );

  // Start the chat-search FTS index maintenance (backfill runs in the
  // background; never blocks startup)
  startChatSearchIndexer();

  // Cleanup old media files to reclaim disk space
  void cleanupOldMediaFiles().catch((error) =>
    logger.error("Failed to cleanup old media files:", error),
  );

  // Remove GitHub tokens that older versions embedded in git remote URLs
  void scrubGithubTokenFromRemotes().catch((error) =>
    logger.error("Failed to scrub GitHub tokens from remotes:", error),
  );

  // Encrypt MCP headers and env vars that are still stored as
  // plaintext. Awaited so no MCP read can see a row the pass is about
  // to correct. It returns rather than throwing on failure, and does
  // no work at all once there are no plaintext values left.
  await encryptStoredMcpSecrets();

  const settings = await readEffectiveSettings();

  // Add dyad-apps directory to git safe.directory (required for Windows).
  // The trailing /* allows access to all repositories under the named directory.
  // See: https://git-scm.com/docs/git-config#Documentation/git-config.txt-safedirectory
  // Don't need to await because this only needs to run before
  // the user starts interacting with Dyad app and uses a git-related feature.
  gitAddSafeDirectory(`${getDyadAppsBaseDirectory()}/*`);

  // Check if app was force-closed by checking for the crash sentinel file.
  // The sentinel is written at startup and deleted in before-quit on clean exit.
  // If it exists at startup, the previous session ended without a clean quit.
  //
  // Migration fallback: builds prior to the sentinel approach used a
  // settings.isRunning flag to detect crashes. On first launch of a new build
  // after a force-close of an old build, the sentinel won't exist yet but
  // settings.isRunning may still be true. Honour it once, then clear it so
  // subsequent runs rely solely on the sentinel.
  const legacyIsRunningCrash = settings.isRunning === true;
  if (crashSentinelExists() || legacyIsRunningCrash) {
    logger.warn("App was force-closed on previous run");
    pendingCrashDetected = true;

    // Store performance data to send after window is created
    if (settings.lastKnownPerformance) {
      logger.warn("Last known performance:", settings.lastKnownPerformance);
      pendingForceCloseData = settings.lastKnownPerformance;
    }

    // The chat that was streaming when the crash happened, if any, so the
    // dialog can offer a one-click upload of it.
    pendingActiveChatId = readCrashSentinel()?.activeChatId ?? null;
  }

  // TODO: Remove legacyIsRunningCrash migration path after a few releases
  // once existing users have launched at least once on the sentinel build.
  if (legacyIsRunningCrash) {
    tryWriteSettings(
      { isRunning: false },
      "clearing the legacy isRunning crash flag",
    );
  }

  writeCrashSentinel();

  // Record the GPU's feature status (is compositing / WebGL hardware-accelerated)
  // on every dump written from here on. It's useful context when reading a dump,
  // since the GPU driver can be involved in a crash. This can't go in
  // crashReporter.start's globalExtra because the status isn't known until the
  // app is ready; addExtraParameter adds it to all later dumps.
  try {
    const gpu = app.getGPUFeatureStatus();
    crashReporter.addExtraParameter(
      "gpu_compositing",
      String(gpu?.gpu_compositing ?? "unknown"),
    );
    crashReporter.addExtraParameter(
      "gpu_webgl",
      String(gpu?.webgl ?? "unknown"),
    );
  } catch (error) {
    logger.warn("Could not read GPU status for crash context:", error);
  }
  logger.info("Crash dumps directory:", app.getPath("crashDumps"));

  // Start performance monitoring
  startPerformanceMonitoring();

  // Handle dyad-media:// requests. Media-library tiles use bounded, cached
  // derivatives while explicit previews continue to receive the source file.
  protocol.handle(
    "dyad-media",
    createDyadMediaProtocolHandler({
      cacheRoot: getMediaThumbnailCacheRoot(app.getPath("sessionData")),
      resolveAppPath: getDyadAppPath,
      resolveAppId: async (appId) => {
        const appRecord = await db.query.apps.findFirst({
          where: eq(apps.id, appId),
          columns: { path: true },
        });
        return appRecord ? getDyadAppPath(appRecord.path) : null;
      },
      fetchFile: (url) => net.fetch(url),
      createThumbnailFromPath: (sourcePath, size) =>
        createPlatformThumbnailFromPath(nativeImage, sourcePath, size),
    }),
  );
  debugLog("protocol registered OK");

  const shouldUseManagedNode =
    settings.nodeRuntimePreference === "managed" && !settings.customNodePath;
  debugLog("calling getManagedNodeVersion...");
  const managedNodeVersion = await getManagedNodeVersion();
  debugLog("getManagedNodeVersion done, version=" + String(managedNodeVersion));
  if (shouldUseManagedNode) {
    if (managedNodeVersion) {
      applyManagedNodeToProcessPath();
    } else {
      logger.warn(
        "Managed Node.js is selected, but no usable managed runtime is installed.",
      );
    }
    void maybeUpgradeManagedNode();
  }

  await onFirstRunMaybe(settings);
  debugLog("onFirstRunMaybe done");
  await createFreshStartupWindow();
  debugLog("createFreshStartupWindow done");
  createApplicationMenu();

  sendTelemetryEvent("runtime_source", {
    runtime_source: settings.customNodePath
      ? "custom"
      : shouldUseManagedNode && managedNodeVersion
        ? "managed"
        : "system",
    managed_node_installed: !!managedNodeVersion,
    managed_node_version: managedNodeVersion,
  });

  logger.info("Auto-update enabled=", settings.enableAutoUpdate);
  if (settings.enableAutoUpdate) {
    // Technically we could just pass the releaseChannel directly to the host,
    // but this is more explicit and falls back to stable if there's an unknown
    // release channel.
    const postfix = settings.releaseChannel === "beta" ? "beta" : "stable";
    const host = `https://api.dyad.sh/v1/update/${postfix}`;
    logger.info("Auto-update release channel=", postfix);
    // update-electron-app logs updater errors at info level, which the
    // warn-filtered bug-report logs drop — leaving only the orphaned stack
    // trace tail. Log at error level and record for debug bundles.
    autoUpdater.on("error", (error) => {
      logger.error("Auto-updater error:", error);
      recordUpdaterError(error);
    });
    updateElectronApp({
      logger,
      updateInterval: "60 minutes",
      updateSource: {
        type: UpdateSourceType.ElectronPublicUpdateService,
        repo: "dyad-sh/dyad",
        host,
      },
    }); // additional configuration options available
  }
}

function scheduleSafeStorageKeychainUnlockRetryAfterRendererLoad(): void {
  // Keychain access is fully disabled in this build (password-store=basic +
  // DYAD_NO_KEYCHAIN=1). No retry needed.
}

export async function onFirstRunMaybe(settings: UserSettings) {
  const isFirstSession = settings.hasRunBefore === false;
  setInitialLoadIsFirstSession(isFirstSession);

  if (isFirstSession) {
    await promptMoveToApplicationsFolder();
    tryWriteSettings({ hasRunBefore: true }, "marking first run complete");
  }
  if (IS_TEST_BUILD) {
    tryWriteSettings({ isTestMode: true }, "marking test mode");
  }
}

/**
 * Ask the user if the app should be moved to the
 * applications folder.
 */
async function promptMoveToApplicationsFolder(): Promise<void> {
  // Why not in e2e tests?
  // There's no way to stub this dialog in time, so we just skip it
  // in e2e testing mode.
  if (IS_TEST_BUILD) return;
  if (process.platform !== "darwin") return;
  if (app.isInApplicationsFolder()) return;

  // Never-block-startup escape hatch: set DYAD_SKIP_MOVE_PROMPT=1 to suppress.
  if (process.env.DYAD_SKIP_MOVE_PROMPT === "1") return;

  logger.log("Prompting user to move to applications folder");

  // CRITICAL: this dialog must NEVER block window creation. If it goes
  // unanswered (headless launch, dialog hidden behind other windows, user
  // away), onReady would hang forever and the app would show a blank screen.
  // Auto-dismiss as "Do Not Move" after 15 seconds and continue startup.
  const answer = await Promise.race([
    dialog.showMessageBox({
      type: "question",
      buttons: ["Move to Applications Folder", "Do Not Move"],
      defaultId: 0,
      message: "Move to Applications Folder? (required for auto-update)",
    }),
    new Promise<{ response: number }>((resolve) =>
      setTimeout(() => resolve({ response: 1 }), 15000),
    ),
  ]);

  if (answer.response === 0) {
    logger.log("User chose to move to applications folder");
    app.moveToApplicationsFolder();
  } else {
    logger.log(
      "User chose not to move to applications folder (or dialog timed out)",
    );
  }
}

declare global {
  const MAIN_WINDOW_VITE_DEV_SERVER_URL: string;
}

let mainWindow: BrowserWindow | null = null;
const productWindows = new Map<WindowSessionId, BrowserWindow>();
const productWindowDescriptors = new Map<
  WindowSessionId,
  WindowSessionDescriptor
>();
let lastClosedWindowSession: WindowSessionDescriptor | undefined;
let hasCreatedInitialWindow = false;
let pendingForceCloseData: any = null;
let pendingActiveChatId: number | null = null;
let pendingCrashDetected = false;
let isAppQuitting = false;

const lifecycleLogger = log.scope("app_lifecycle");
const lifecycleStartedAt = Date.now();
let lifecycleSequence = 0;

function logLifecycle(
  event: string,
  details: Record<string, unknown> = {},
): void {
  let windows: Array<{
    id: number;
    destroyed: boolean;
    visible: boolean;
    focused: boolean;
    webContentsDestroyed: boolean;
  }> = [];
  try {
    windows = BrowserWindow.getAllWindows().map((window) => ({
      id: window.id,
      destroyed: window.isDestroyed(),
      visible: window.isVisible(),
      focused: window.isFocused(),
      webContentsDestroyed: window.webContents.isDestroyed(),
    }));
  } catch (error) {
    lifecycleLogger.warn("snapshot-failed", event, error);
  }

  lifecycleLogger.info(event, {
    sequence: ++lifecycleSequence,
    elapsedMs: Date.now() - lifecycleStartedAt,
    isAppQuitting,
    hasCreatedInitialWindow,
    mainWindowId:
      mainWindow && !mainWindow.isDestroyed() ? mainWindow.id : null,
    productWindowCount: productWindows.size,
    windows,
    ...details,
  });
}

async function observeLifecycleCleanup(
  name: string,
  cleanup: () => Promise<void>,
): Promise<void> {
  const startedAt = Date.now();
  logLifecycle("cleanup:start", { name });
  try {
    await cleanup();
    logLifecycle("cleanup:settled", {
      name,
      durationMs: Date.now() - startedAt,
      outcome: "fulfilled",
    });
  } catch (error) {
    logLifecycle("cleanup:settled", {
      name,
      durationMs: Date.now() - startedAt,
      outcome: "rejected",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function requestRelaunchAfterQuit(deepLinkUrl?: string): void {
  if (appRelaunchRequest.request({ deepLinkUrl })) {
    logger.info("Reopen requested during shutdown; relaunching after cleanup");
    logLifecycle("relaunch:requested", { hasDeepLink: !!deepLinkUrl });
  }
}

function deliverPendingCrashRecovery(target: BrowserWindow): void {
  if (!pendingCrashDetected || target !== mainWindow || target.isDestroyed()) {
    return;
  }

  target.webContents.send("force-close-detected", {
    ...(pendingForceCloseData && {
      performanceData: pendingForceCloseData,
    }),
    ...(pendingActiveChatId != null && {
      activeChatId: pendingActiveChatId,
    }),
  });

  const nativeCrash = pendingNativeBrowserCrash?.summary ?? null;
  const nativeCrashAttribution = pendingNativeBrowserCrash?.attribution ?? null;
  pendingNativeBrowserCrash = null;

  const oom = classifyOom({
    nativeCrash,
    performance: pendingForceCloseData,
  });

  sendTelemetryEventToWindow(target, "app:crash_detected", {
    // Mark as error so renderer PostHog before_send sampling does not
    // drop 90% of events for non-Pro users (see src/renderer.tsx).
    error: true,
    has_performance_data: !!pendingForceCloseData,
    ...(pendingForceCloseData &&
      crashPerformanceEventFields(pendingForceCloseData)),
    // "native" when a minidump was attributed to this crash, else
    // "unknown" (no dump: force-kill / OOM-kill / power loss / missed).
    crash_cause: nativeCrash ? "native" : "unknown",
    ...(nativeCrash && {
      // "ptype" when the dump named the browser process itself; "sentinel"
      // when an annotation-stripped dump was correlated with the crash
      // sentinel instead (see browserCrashAttribution). Sentinel
      // attribution is weaker: the dump could belong to a child process
      // that also lost its labels.
      crash_attribution: nativeCrashAttribution,
      crash_reason: nativeCrash.crashReason,
      exception_code: nativeCrash.exceptionCode,
      fault_address: nativeCrash.faultAddress,
      access_type: nativeCrash.accessType,
      in_page_error_status: nativeCrash.inPageErrorStatus,
      oom_allocation_size_bytes: nativeCrash.oomAllocationSizeBytes,
      fast_fail_code: nativeCrash.fastFailCode,
      faulting_module: nativeCrash.faultingModule,
      faulting_offset: nativeCrash.faultingOffset,
      faulting_debug_file: nativeCrash.faultingDebugFile,
      faulting_debug_id: nativeCrash.faultingDebugId,
    }),
    ...(nativeCrash?.annotations &&
      crashAnnotationEventFields(nativeCrash.annotations)),
    // The OOM verdict and the signals behind it (see classifyOom).
    // Comma-joined: crash event properties stay scalar for PostHog.
    oom_verdict: oom.verdict,
    ...(oom.signals.length > 0 && { oom_signals: oom.signals.join(",") }),
  });

  pendingForceCloseData = null;
  pendingActiveChatId = null;
  pendingCrashDetected = false;
}

const createWindow = ({
  windowSessionId = randomUUID() as WindowSessionId,
  visibleEntity,
}: Partial<WindowSessionDescriptor> = {}): {
  windowSessionId: WindowSessionId;
  browserWindow: BrowserWindow;
  rendererLoad: Promise<void>;
} => {
  if (isAppQuitting) {
    throw new DyadError("Dyad is shutting down", DyadErrorKind.Precondition);
  }

  // Create the browser window.
  debugLog("createWindow: creating BrowserWindow...");
  const browserWindow = new BrowserWindow({
    width: process.env.NODE_ENV === "development" ? 1280 : 960,
    minWidth: 800,
    height: 700,
    minHeight: 500,
    titleBarStyle: "hidden",
    titleBarOverlay: false,
    trafficLightPosition: {
      x: 13,
      y: 13,
    },
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload: path.join(__dirname, "preload.js"),
      // Startup/reload efficiency: skip the V8 code-cache heat check so the
      // renderer reuses cached bytecode immediately after the first run.
      v8CacheOptions: "bypassHeatCheck",
      // Renderer memory/CPU: the chat surface never needs spellcheck, and the
      // spellchecker keeps a loaded dictionary in every renderer process.
      spellcheck: false,
      // transparent: true,
    },
    icon: path.join(app.getAppPath(), "assets/icon/logo.png"),
    // backgroundColor: "#00000001",
    // frame: false,
  });
  debugLog(
    "createWindow: BrowserWindow created, id=" + String(browserWindow.id),
  );
  mainWindow = browserWindow;
  deepLinkWindowReadiness.setTarget(browserWindow);
  crashRecoveryWindowReadiness.setTarget(browserWindow);
  productWindows.set(windowSessionId, browserWindow);
  productWindowDescriptors.set(windowSessionId, {
    windowSessionId,
    visibleEntity,
  });
  logLifecycle("window:created", {
    windowId: browserWindow.id,
    windowSessionId,
  });
  windowRegistry.register(browserWindow.webContents, windowSessionId);
  browserWindow.on("focus", () => {
    mainWindow = browserWindow;
    deepLinkWindowReadiness.setTarget(browserWindow);
    crashRecoveryWindowReadiness.setTarget(browserWindow);
    windowRegistry.setFocused(windowSessionId);
  });
  browserWindow.once("closed", () => {
    const descriptor = productWindowDescriptors.get(windowSessionId);
    const retainForActivation = shouldRetainClosedWindowForActivation({
      isAppQuitting,
      openWindowCountBeforeClose: productWindows.size,
    });
    productWindows.delete(windowSessionId);
    productWindowDescriptors.delete(windowSessionId);
    if (retainForActivation && descriptor) {
      lastClosedWindowSession = descriptor;
    }
    if (mainWindow === browserWindow) {
      mainWindow =
        [...productWindows.values()].find((window) => window.isFocused()) ??
        [...productWindows.values()].at(-1) ??
        null;
      deepLinkWindowReadiness.setTarget(mainWindow);
      crashRecoveryWindowReadiness.setTarget(mainWindow);
    }
    logLifecycle("window:closed", {
      windowId: browserWindow.id,
      windowSessionId,
      retainedForActivation: retainForActivation,
    });
  });
  browserWindow.on("close", (event) => {
    logLifecycle("window:close", {
      windowId: browserWindow.id,
      windowSessionId,
      defaultPrevented: event.defaultPrevented,
    });
  });
  browserWindow.on("unresponsive", () => {
    logLifecycle("window:unresponsive", {
      windowId: browserWindow.id,
      windowSessionId,
    });
  });
  browserWindow.on("responsive", () => {
    logLifecycle("window:responsive", {
      windowId: browserWindow.id,
      windowSessionId,
    });
  });
  browserWindow.webContents.on("will-prevent-unload", (event) => {
    logLifecycle("renderer:will-prevent-unload", {
      windowId: browserWindow.id,
      windowSessionId,
      defaultPrevented: event.defaultPrevented,
    });
  });
  const packagedRendererUrl = pathToFileURL(
    path.join(__dirname, "../renderer/main_window/index.html"),
  ).href;
  const allowedDevServerUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL || undefined;
  configureTrustedRenderer({
    devServerUrl: allowedDevServerUrl,
    packagedRendererUrl,
  });
  const rejectUnexpectedNavigation = (
    event: ElectronEvent<{ isMainFrame: boolean; url: string }>,
  ) => {
    if (
      shouldBlockMainWindowNavigation(
        event.url,
        event.isMainFrame,
        allowedDevServerUrl,
        packagedRendererUrl,
      )
    ) {
      event.preventDefault();
      logger.warn("Blocked unexpected main-window navigation:", event.url);
    }
  };
  browserWindow.webContents.on("will-navigate", rejectUnexpectedNavigation);
  browserWindow.webContents.on("will-redirect", rejectUnexpectedNavigation);
  const previewPopupWindows = new Set<BrowserWindow>();
  browserWindow.webContents.setWindowOpenHandler((details) => {
    const response = getWindowOpenHandlerResponse(details, allowedDevServerUrl);
    if (response.action === "deny") {
      logger.warn("Blocked unexpected child window:", details.url);
      return response;
    }

    logger.debug("Allowing sandboxed preview child window:", details.url);
    return {
      ...response,
      createWindow: (options) => {
        const popup = new BrowserWindow(securePreviewPopupOptions(options));
        previewPopupWindows.add(popup);
        popup.once("closed", () => previewPopupWindows.delete(popup));
        popup.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
        return popup.webContents;
      },
    };
  });
  browserWindow.webContents.on(
    "did-start-navigation",
    (_event, _url, isInPlace, isMainFrame) => {
      if (!isMainFrame || isInPlace) return;

      deepLinkWindowReadiness.markNotReady(browserWindow);
      crashRecoveryWindowReadiness.markNotReady(browserWindow);
    },
  );

  // and load the index.html of the app.
  let initialLoad: Promise<void>;
  debugLog("createWindow: loading renderer...");
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    debugLog("loading URL=" + MAIN_WINDOW_VITE_DEV_SERVER_URL);
    // In dev mode, wait for the Vite dev server to be ready before loading.
    // This avoids ERR_CONNECTION_REFUSED when Electron starts before Vite
    // is fully listening.
    const waitForDevServer = async (
      url: string,
      retries = 10,
      delayMs = 1000,
    ): Promise<void> => {
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          const response = await fetch(url, {
            method: "HEAD",
            signal: AbortSignal.timeout(3000),
          });
          if (response.ok || response.status < 500) return;
        } catch {
          // Server not ready yet
        }
        if (attempt < retries) {
          debugLog(
            `Waiting for Vite dev server (attempt ${attempt}/${retries})...`,
          );
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    };
    initialLoad = waitForDevServer(MAIN_WINDOW_VITE_DEV_SERVER_URL).then(() =>
      browserWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL),
    );
  } else {
    const rendererPath = path.join(
      __dirname,
      "../renderer/main_window/index.html",
    );
    debugLog("loading file=" + rendererPath);
    debugLog("__dirname=" + __dirname);
    initialLoad = browserWindow.loadFile(rendererPath);
  }
  void initialLoad.catch((error) => {
    debugLog("ERROR: Product window renderer FAILED to load: " + String(error));
    logger.error("Product window renderer failed to load:", error);
  });

  // Handle force-close message and development reload coordination
  let devToolsReloadedCount = 0;
  browserWindow.webContents.on("did-finish-load", () => {
    // Mark every completed load ready before development-only coordination so
    // transport readiness does not depend on the DevTools reload heuristic.
    deepLinkWindowReadiness.markReady(browserWindow);

    if (process.env.NODE_ENV === "development") {
      // In dev, wait until AFTER the DevTools-triggered reload before sending the message
      if (devToolsReloadedCount === 0) {
        devToolsReloadedCount++;
        return; // Ignore first load, we will reload momentarily
      }
    }

    // Summarize native crash minidumps before sending app:crash_detected. If
    // the main process crashed natively, that summary becomes the crash cause
    // reported in app:crash_detected.
    processNativeCrashDumps();
    // Crash recovery follows the focused/current product window and waits for
    // its post-DevTools-reload renderer. Background product windows cannot
    // consume the one-shot dialog or telemetry event.
    crashRecoveryWindowReadiness.markReady(browserWindow);

    // Forward any pending renderer crash recorded on a previous load. We send
    // this from `did-finish-load` rather than `render-process-gone` because the
    // renderer (which owns the PostHog client) is dead at crash time.
    const rendererCrash = readRendererCrashRecord();
    if (rendererCrash) {
      const perf = rendererCrash.performance;
      sendTelemetryEventToWindow(browserWindow, "renderer:crash_detected", {
        // Mark as error so renderer PostHog before_send sampling does not
        // drop 90% of events for non-Pro users (see src/renderer.tsx).
        error: true,
        reason: rendererCrash.reason,
        exit_code: rendererCrash.exitCode,
        crash_count: rendererCrash.count,
        crash_timestamp: rendererCrash.timestamp,
        ms_since_crash: Date.now() - rendererCrash.timestamp,
        // Mirror the `app:crash_detected` performance fields so the two
        // events can be unioned in PostHog without per-event field mapping.
        has_performance_data: !!perf,
        ...(perf && crashPerformanceEventFields(perf)),
      });
      clearRendererCrashRecord();
    }

    scheduleSafeStorageKeychainUnlockRetryAfterRendererLoad();
  });
  // Start the development-only DevTools reload after the initial renderer load
  // succeeds. Explicit new-window creation can safely await `initialLoad`
  // without that intentional reload aborting its promise.
  if (process.env.NODE_ENV === "development") {
    void initialLoad.then(
      () => {
        if (browserWindow.isDestroyed()) return;
        browserWindow.webContents.once("devtools-opened", () => {
          setTimeout(() => {
            if (!browserWindow.isDestroyed()) {
              browserWindow.webContents.reloadIgnoringCache();
            }
          }, 300);
        });
        browserWindow.webContents.openDevTools();
      },
      () => undefined,
    );
  }

  // Persist any non-clean renderer-process termination so we can report it on
  // the next successful renderer load. We deliberately do nothing here besides
  // writing the record: triggering reloads/dialogs is out of scope for the
  // telemetry hook.
  let rendererCrashRestartCount = 0;
  const MAX_RENDERER_CRASH_RESTARTS = 3;
  browserWindow.webContents.on("render-process-gone", (_event, details) => {
    if (isAppQuitting) {
      return;
    }
    if (details.reason === "clean-exit") {
      return;
    }
    logger.error(
      "Renderer process gone:",
      details.reason,
      "exitCode=",
      details.exitCode,
    );
    // Capture the latest heartbeat snapshot synchronously so the record pins
    // the pre-crash performance state, matching the semantics of
    // `app:crash_detected`. `readSettings` returns `DEFAULT_SETTINGS` on any
    // I/O or parse failure rather than throwing, so this is safe to inline.
    recordRendererCrash({
      reason: details.reason,
      exitCode: details.exitCode,
      performance: readSettings().lastKnownPerformance,
    });

    rendererCrashRestartCount++;

    // ── Never-blank recovery: reload the renderer after a crash ──
    // Limit restart attempts to prevent infinite crash loops
    const crashTarget = browserWindow.webContents.getURL();
    if (
      crashTarget &&
      !crashTarget.startsWith("data:") &&
      !browserWindow.isDestroyed()
    ) {
      if (rendererCrashRestartCount > MAX_RENDERER_CRASH_RESTARTS) {
        logger.warn(
          `Renderer crash restart limit (${MAX_RENDERER_CRASH_RESTARTS}) reached. Showing recovery page.`,
        );
        // Show a recovery page instead of attempting another restart
        const recoveryHtml = `<!doctype html><html><head><meta charset="utf-8"><title>Dyad - Recovery</title>
<style>
  html,body{margin:0;height:100%;background:#0d0d12;color:#e8e8ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center}
  .card{text-align:center;max-width:460px;padding:40px}
  .logo{font-size:44px;margin-bottom:12px}
  h1{font-size:20px;font-weight:600;margin:0 0 8px}
  p{font-size:14px;color:#9a9aa5;margin:0 0 20px;line-height:1.5}
  button{background:#575ecf;color:#fff;border:0;border-radius:8px;padding:10px 22px;font-size:14px;cursor:pointer}
  button:hover{background:#656de0}
</style></head><body><div class="card">
  <div class="logo">⚠️</div>
  <h1>Recovering from crash...</h1>
  <p>The renderer process crashed multiple times. This may indicate a critical issue. Please try restarting Dyad.</p>
  <button onclick="location.reload()">Retry</button>
</div></body></html>`;
        browserWindow
          .loadURL(
            "data:text/html;charset=utf-8," + encodeURIComponent(recoveryHtml),
          )
          .catch(() => {});
        return;
      }

      const delayMs = 1500 * rendererCrashRestartCount; // Exponential-ish backoff
      logger.info(
        `Scheduling renderer restart #${rendererCrashRestartCount}/${MAX_RENDERER_CRASH_RESTARTS} after ${delayMs}ms`,
      );
      setTimeout(() => {
        if (!browserWindow.isDestroyed()) {
          debugLog(
            `recovery: reloading renderer after crash #${rendererCrashRestartCount} (${details.reason})`,
          );
          browserWindow.loadURL(crashTarget).catch(() => {
            debugLog(
              "recovery: reload after crash failed — will retry via did-fail-load",
            );
          });
        }
      }, delayMs);
    }
  });

  // ── Never-blank recovery: retry failed loads with backoff, then show a
  // branded fallback page instead of a white/blank window. This covers the
  // case where the Vite dev server dies or restarts while Electron is up.
  {
    let failCount = 0;
    const MAX_FAILS = 15;
    let _lastRendererUrl: string | undefined;
    const fallbackPage = () => {
      const html = `<!doctype html><html><head><meta charset="utf-8"><title>Dyad</title>
<style>
  html,body{margin:0;height:100%;background:#0d0d12;color:#e8e8ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center}
  .card{text-align:center;max-width:460px;padding:40px}
  .logo{font-size:44px;margin-bottom:12px}
  h1{font-size:20px;font-weight:600;margin:0 0 8px}
  p{font-size:14px;color:#9a9aa5;margin:0 0 20px;line-height:1.5}
  .spinner{width:28px;height:28px;border:3px solid #2a2a35;border-top-color:#575ecf;border-radius:50%;margin:0 auto 20px;animation:spin 1s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  button{background:#575ecf;color:#fff;border:0;border-radius:8px;padding:10px 22px;font-size:14px;cursor:pointer}
  button:hover{background:#656de0}
  .status{font-size:12px;color:#6a6a75;margin-top:14px}
</style></head><body><div class="card">
  <div class="logo">⚡</div>
  <h1>Dyad is reconnecting…</h1>
  <p>The renderer service is not responding.<br/>Retrying automatically — no action needed.</p>
  <div class="spinner"></div>
  <button onclick="location.reload()">Retry now</button>
  <div class="status">Auto-retry every few seconds</div>
</div></body></html>`;
      if (browserWindow.isDestroyed()) return;
      debugLog("recovery: showing fallback page (never blank)");
      browserWindow
        .loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html))
        .catch(() => {});
    };
    browserWindow.webContents.on(
      "did-fail-load",
      (_e, code, desc, url, isMainFrame) => {
        if (!isMainFrame || isAppQuitting) return;
        if (url.startsWith("data:")) return;
        failCount++;
        _lastRendererUrl = url;
        debugLog(
          `recovery: did-fail-load #${failCount} (${code} ${desc}) url=${url}`,
        );
        if (failCount > MAX_FAILS) {
          fallbackPage();
          return;
        }
        const delay = Math.min(
          1000 * Math.pow(2, Math.floor(failCount / 3)),
          10000,
        );
        setTimeout(() => {
          if (browserWindow.isDestroyed()) return;
          if (failCount >= 5) fallbackPage();
          browserWindow.loadURL(url).catch(() => {
            debugLog("recovery: loadURL rejected, will retry");
          });
        }, delay);
      },
    );
    browserWindow.webContents.on("did-finish-load", () => {
      failCount = 0;
    });
  }

  // Enable native context menu on right-click
  browserWindow.webContents.on("context-menu", (event, params) => {
    // Prevent any default behavior and show our own menu
    event.preventDefault();

    const template: Electron.MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      template.push(
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "delete" },
      );
      if (params.misspelledWord) {
        const suggestions: Electron.MenuItemConstructorOptions[] =
          params.dictionarySuggestions.slice(0, 5).map((suggestion) => ({
            label: suggestion,
            click: () => {
              try {
                browserWindow.webContents.replaceMisspelling(suggestion);
              } catch (error) {
                logger.error("Failed to replace misspelling:", error);
              }
            },
          }));
        template.push(
          { type: "separator" },
          {
            type: "submenu",
            label: `Correct "${params.misspelledWord}"`,
            submenu: suggestions,
          },
        );
      }
      template.push({ type: "separator" }, { role: "selectAll" });
    } else {
      if (params.selectionText && params.selectionText.length > 0) {
        template.push({ role: "copy" });
      }
      template.push({ role: "selectAll" });
    }

    if (process.env.NODE_ENV === "development") {
      template.push(
        { type: "separator" },
        {
          label: "Inspect Element",
          click: () =>
            browserWindow.webContents.inspectElement(params.x, params.y),
        },
      );
    }

    const menu = Menu.buildFromTemplate(template);
    menu.popup({ window: browserWindow });
  });
  return { windowSessionId, browserWindow, rendererLoad: initialLoad };
};

async function createFreshStartupWindow(): Promise<void> {
  debugLog("createFreshStartupWindow: clearing legacy sessions...");
  try {
    await clearLegacyWindowSessionPersistence(app.getPath("userData"));
  } catch (error) {
    logger.error(
      "Failed to clear legacy window sessions; continuing with one fresh window:",
      error,
    );
  }
  debugLog("createFreshStartupWindow: isAppQuitting=" + String(isAppQuitting));
  if (isAppQuitting) {
    logger.info("Skipping initial window creation during shutdown");
    return;
  }
  debugLog("createFreshStartupWindow: calling createWindow...");
  createWindow({ windowSessionId: PRIMARY_WINDOW_SESSION_ID });
  hasCreatedInitialWindow = true;
  debugLog(
    "createFreshStartupWindow: createWindow returned, setting hasCreatedInitialWindow",
  );
}

configureWindowProductController({
  openEntityInNewWindow: async (entity) => {
    if (productWindows.size >= MAX_PRODUCT_WINDOWS) {
      throw new DyadError(
        `Dyad supports up to ${MAX_PRODUCT_WINDOWS} open windows`,
        DyadErrorKind.Precondition,
      );
    }
    try {
      const created = createWindow({
        windowSessionId: randomUUID() as WindowSessionId,
        visibleEntity: entity,
      });
      return await awaitProductWindowRenderer({
        rendererLoad: created.rendererLoad,
        result: created.windowSessionId,
        rollback: () => {
          const {
            windowSessionId: failedSessionId,
            browserWindow: failedWindow,
          } = created;
          const failedWebContentsId = failedWindow.webContents.id;
          productWindows.delete(failedSessionId);
          productWindowDescriptors.delete(failedSessionId);
          if (!failedWindow.isDestroyed()) failedWindow.destroy();
          windowRegistry.unregister(failedWebContentsId);
        },
      });
    } catch (error) {
      if (isDyadError(error)) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new DyadError(
        `Failed to open a new window: ${detail}`,
        DyadErrorKind.External,
        { cause: error },
      );
    }
  },
  initialEntityForSession: (windowSessionId) =>
    productWindowDescriptors.get(windowSessionId)?.visibleEntity,
  setVisibleEntities: (windowSessionId, entities) => {
    const descriptor = productWindowDescriptors.get(windowSessionId);
    if (!descriptor) return;
    productWindowDescriptors.set(windowSessionId, {
      ...descriptor,
      visibleEntity: restorableVisibleEntity(entities),
    });
  },
  mayMigrateLegacyChatTabSession: (windowSessionId) =>
    productWindows.keys().next().value === windowSessionId,
  restorableWindowSessionIds: () => [...productWindows.keys()],
});

/**
 * Create application menu with Edit shortcuts (Undo, Redo, Cut, Copy, Paste, etc.)
 * This enables standard keyboard shortcuts like Cmd/Ctrl+C, Cmd/Ctrl+V, etc.
 */
const createApplicationMenu = () => {
  const isMac = process.platform === "darwin";

  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" as const },
              { type: "separator" as const },
              { role: "services" as const },
              { type: "separator" as const },
              { role: "hide" as const },
              { role: "hideOthers" as const },
              { role: "unhide" as const },
              { type: "separator" as const },
              { role: "quit" as const },
            ],
          },
        ]
      : []),
    // Edit menu - enables keyboard shortcuts for clipboard operations
    {
      label: "Edit",
      submenu: [
        { role: "undo" as const },
        { role: "redo" as const },
        { type: "separator" as const },
        { role: "cut" as const },
        { role: "copy" as const },
        { role: "paste" as const },
        { role: "delete" as const },
        { type: "separator" as const },
        { role: "selectAll" as const },
      ],
    },
    // View menu
    {
      label: "View",
      submenu: [
        { role: "reload" as const },
        { role: "forceReload" as const },
        ...(process.env.NODE_ENV === "development"
          ? [{ role: "toggleDevTools" as const }]
          : []),
        { type: "separator" as const },
        { role: "togglefullscreen" as const },
      ],
    },
    // Window menu
    {
      label: "Window",
      submenu: [
        { role: "minimize" as const },
        { role: "zoom" as const },
        ...(isMac
          ? [
              { type: "separator" as const },
              { role: "front" as const },
              { type: "separator" as const },
              { role: "window" as const },
            ]
          : [{ role: "close" as const }]),
      ],
    },
  ];

  const appMenu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(appMenu);
};

// Register dyad-media:// protocol for serving persistent media attachments.
// Must be called before app.whenReady().
protocol.registerSchemesAsPrivileged([
  {
    scheme: "dyad-media",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);

// A cold-start protocol URL arrives in argv before any renderer is ready.
// Queue it in both production and E2E builds; the latter skips only the
// singleton lock so parallel test processes can coexist.
const initialDeepLink = process.argv.find((arg) => arg.startsWith("dyad://"));
if (initialDeepLink) {
  deepLinkQueue.handle(initialDeepLink);
}

// Defense-in-depth: enable sandbox globally before any window is created.
// Individual windows also set sandbox:true, but this ensures all new
// BrowserWindows default to sandboxed mode even if a creation path omits it.
app.enableSandbox();

// Clean up stale SingletonLock from previous crashes to prevent launch failures.
try {
  const lockPath = path.join(app.getPath("userData"), "SingletonLock");
  const fsSync = require("node:fs") as typeof import("node:fs");
  if (fsSync.existsSync(lockPath)) {
    const stat = fsSync.lstatSync(lockPath);
    if (stat.isSymbolicLink()) {
      const target = fsSync.readlinkSync(lockPath);
      const pid = Number(target.split("-").pop());
      if (!Number.isSafeInteger(pid) || pid <= 0) {
        // Malformed lock, remove it
        fsSync.unlinkSync(lockPath);
        debugLog("Removed malformed SingletonLock");
      } else {
        try {
          process.kill(pid, 0);
        } catch {
          // Process not running — stale lock, remove it
          fsSync.unlinkSync(lockPath);
          debugLog("Removed stale SingletonLock");
        }
      }
    }
  }
} catch {
  // Best effort — don't block startup
}

// Skip singleton lock for E2E test builds to allow parallel test execution.
// Deep link handling still works via the 'open-url' event registered below.
// The 'second-instance' handler is intentionally omitted since it requires the singleton lock.
if (IS_TEST_BUILD) {
  startAppWhenReady();
} else {
  const gotTheLock = app.requestSingleInstanceLock();

  if (!gotTheLock) {
    app.quit();
  } else {
    app.on("second-instance", (_event, commandLine, _workingDirectory) => {
      const url = commandLine.find((arg) => arg.startsWith("dyad://"));
      if (isAppQuitting) {
        requestRelaunchAfterQuit(url);
        return;
      }

      // Someone tried to run a second instance, we should focus our window.
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
      if (url) {
        deepLinkQueue.handle(url);
      }
    });

    startAppWhenReady();
  }
}

// Handle the protocol. In this case, we choose to show an Error Box.
app.on("open-url", (event, url) => {
  if (isAppQuitting) {
    requestRelaunchAfterQuit(url);
    return;
  }
  deepLinkQueue.handle(url);
});

function startAppWhenReady() {
  debugLog("startAppWhenReady called");
  // Disable GPU to prevent GPU process crashes (exit code 15) on macOS.
  // The GPU process crashes with exit code 15 and 99% CPU on certain
  // macOS configurations even with --disable-gpu alone.
  //
  // Strategy: layer multiple disable mechanisms so no GPU subprocess is ever
  // spawned, regardless of what Chromium decides internally:
  // 1. disableHardwareAcceleration() — Electron API, required before whenReady()
  // 2. --disable-gpu — belt-and-suspenders; mirrors the API
  // 3. --disable-gpu-compositing — disables compositor GPU path
  // 4. --disable-gpu-sandbox — prevents sandbox setup failures
  // 5. --in-process-gpu — merges GPU INTO browser process (key fix)
  // 6. --disable-software-rasterizer — prevents SwiftShader CPU fallback
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch("disable-gpu");
  app.commandLine.appendSwitch("disable-gpu-compositing");
  app.commandLine.appendSwitch("disable-gpu-sandbox");
  app.commandLine.appendSwitch("in-process-gpu");
  app.commandLine.appendSwitch("disable-software-rasterizer");
  app
    .whenReady()
    .then(onReady)
    .catch((error) => {
      debugLog("ERROR: onReady FAILED: " + String(error));
      logger.error("onReady failed:", error);
    });
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function showDeepLinkSettingsError(action: string, error: unknown): void {
  logger.error(`Failed to ${action}:`, error);
  dialog.showErrorBox(
    "Unable to Save Settings",
    `Failed to ${action}: ${getErrorMessage(error)}`,
  );
}

async function handleDeepLinkReturn(url: string) {
  // example url: "dyad://supabase-oauth-return?token=a&refreshToken=b"
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    log.info("Invalid deep link URL", url);
    return;
  }

  // Intentionally do NOT log the full URL which may contain sensitive tokens.
  log.log(
    "Handling deep link: protocol",
    parsed.protocol,
    "hostname",
    parsed.hostname,
  );
  if (parsed.protocol !== "dyad:") {
    dialog.showErrorBox(
      "Invalid Protocol",
      `Expected dyad://, got ${parsed.protocol}. Full URL: ${url}`,
    );
    return;
  }
  if (parsed.hostname === "neon-oauth-return") {
    const token = parsed.searchParams.get("token");
    const refreshToken = parsed.searchParams.get("refreshToken");
    const expiresIn = Number(parsed.searchParams.get("expiresIn"));
    if (!token || !refreshToken || !expiresIn) {
      dialog.showErrorBox(
        "Invalid URL",
        "Expected token, refreshToken, and expiresIn",
      );
      return;
    }
    {
      // Runs the token write through the connection flow machine: an active
      // flow advances (awaiting-return -> exchanging-token -> ...), while a
      // return with no matching flow (cold start, restart mid-flow, or a
      // return that lost the race against a timeout) still stores tokens and
      // is broadcast as unsolicited so the renderer refreshes.
      const outcome = await runOAuthReturnExchange("neon", () => {
        handleNeonOAuthReturn({ token, refreshToken, expiresIn });
      });
      if (!outcome.ok) {
        // A claimed failure is surfaced by the renderer as a flow-failure
        // toast; only unclaimed (unsolicited) failures need the dialog.
        if (!outcome.claimed) {
          showDeepLinkSettingsError("save Neon credentials", outcome.error);
        }
        return;
      }
    }
    return;
  }
  if (parsed.hostname === "supabase-oauth-return") {
    const token = parsed.searchParams.get("token");
    const refreshToken = parsed.searchParams.get("refreshToken");
    const expiresIn = Number(parsed.searchParams.get("expiresIn"));
    if (!token || !refreshToken || !expiresIn) {
      dialog.showErrorBox(
        "Invalid URL",
        "Expected token, refreshToken, and expiresIn",
      );
      return;
    }
    {
      // See the neon-oauth-return branch above for why the token write is
      // wrapped by the connection flow machine.
      const outcome = await runOAuthReturnExchange("supabase", async () => {
        await handleSupabaseOAuthReturn({ token, refreshToken, expiresIn });
      });
      if (!outcome.ok) {
        // A claimed failure is surfaced by the renderer as a flow-failure
        // toast; only unclaimed (unsolicited) failures need the dialog.
        if (!outcome.claimed) {
          showDeepLinkSettingsError("save Supabase credentials", outcome.error);
        }
        return;
      }
    }
    return;
  }
  // dyad://dyad-pro-return?key=123&budget_reset_at=2025-05-26T16:31:13.492000Z&max_budget=100
  if (parsed.hostname === "dyad-pro-return") {
    const apiKey = parsed.searchParams.get("key");
    if (!apiKey) {
      dialog.showErrorBox("Invalid URL", "Expected key");
      return;
    }
    try {
      handleDyadProReturn({
        apiKey,
      });
    } catch (error) {
      showDeepLinkSettingsError("save Dyad Pro settings", error);
      return;
    }
    // Send message to renderer to trigger re-render
    mainWindow?.webContents.send("deep-link-received", {
      type: parsed.hostname,
    });
    return;
  }
  // Fired by the OAuth callback page to hand focus back to Dyad
  // after consent. Tokens land via the loopback listener; focusing
  // the window is the only side-effect needed here.
  if (parsed.hostname === "mcp-oauth-return") {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    return;
  }
  // dyad://add-mcp-server?name=Chrome%20DevTools&config=eyJjb21tYW5kIjpudWxsLCJ0eXBlIjoic3RkaW8ifQ%3D%3D
  if (parsed.hostname === "add-mcp-server") {
    const name = parsed.searchParams.get("name");
    const config = parsed.searchParams.get("config");
    if (!name || !config) {
      dialog.showErrorBox("Invalid URL", "Expected name and config");
      return;
    }

    try {
      const decodedConfigJson = atob(config);
      const decodedConfig = JSON.parse(decodedConfigJson);
      const parsedConfig = AddMcpServerConfigSchema.parse(decodedConfig);

      mainWindow?.webContents.send("deep-link-received", {
        type: parsed.hostname,
        payload: {
          name,
          config: parsedConfig,
        } as AddMcpServerPayload,
      });
    } catch (error) {
      logger.error("Failed to parse add-mcp-server deep link:", error);
      dialog.showErrorBox(
        "Invalid MCP Server Configuration",
        "The deep link contains malformed configuration data. Please check the URL and try again.",
      );
    }
    return;
  }
  // dyad://add-prompt?data=<base64-encoded-json>
  if (parsed.hostname === "add-prompt") {
    const data = parsed.searchParams.get("data");
    if (!data) {
      dialog.showErrorBox("Invalid URL", "Expected data parameter");
      return;
    }

    try {
      const decodedJson = atob(data);
      const decoded = JSON.parse(decodedJson);
      const parsedData = AddPromptDataSchema.parse(decoded);

      mainWindow?.webContents.send("deep-link-received", {
        type: parsed.hostname,
        payload: parsedData as AddPromptPayload,
      });
    } catch (error) {
      logger.error("Failed to parse add-prompt deep link:", error);
      dialog.showErrorBox(
        "Invalid Prompt Data",
        "The deep link contains malformed data. Please check the URL and try again.",
      );
    }
    return;
  }
  dialog.showErrorBox("Invalid deep link URL", url);
}

// Report unexpected utility process deaths (tsc worker, code explorer).
// These do not take down the app, so we can report them right away.
// Skip clean-exit and killed: routine teardown stops these workers with
// kill(), and reporting that would flood telemetry with non-crashes.
app.on("child-process-gone", (_event, details) => {
  // Log GPU process deaths for observability. With --in-process-gpu, the GPU
  // process should not exist, so any GPU-type death means the flag didn't
  // take effect. Log it for diagnostics.
  if (details.type === "GPU" && !isAppQuitting) {
    if (details.reason !== "clean-exit" && details.reason !== "killed") {
      logger.error(
        "GPU process gone:",
        details.reason,
        "exitCode=",
        details.exitCode,
      );
      sendTelemetryEvent("gpu_process:crash_detected", {
        error: true,
        reason: details.reason,
        exit_code: details.exitCode,
        process_name: details.name,
      });
    }
    return;
  }
  if (details.type !== "Utility" || isAppQuitting) {
    return;
  }
  if (details.reason === "clean-exit" || details.reason === "killed") {
    return;
  }
  logger.error(
    "Utility process gone:",
    details.serviceName,
    details.reason,
    "exitCode=",
    details.exitCode,
  );
  sendTelemetryEvent("utility_process:crash_detected", {
    // Mark as error so renderer PostHog before_send sampling does not
    // drop 90% of events for non-Pro users (see src/renderer.tsx).
    error: true,
    reason: details.reason,
    exit_code: details.exitCode,
    service_name: details.serviceName,
    process_name: details.name,
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  const shouldQuit = shouldQuitAfterAllWindowsClosed(
    process.platform,
    isAppQuitting,
  );
  logLifecycle("app:window-all-closed", { shouldQuit });
  if (shouldQuit) {
    app.quit();
  }
});

// Clear the crash sentinel as early as possible on clean exit so that slow
// cleanup in will-quit cannot race against OS-imposed termination timeouts
// (e.g. Windows WM_ENDSESSION) and leave the sentinel behind as a false positive.
const handleMcpBeforeQuit = createMcpBeforeQuitHandler({
  quit: () => {
    logLifecycle("app:quit-resume");
    appRelaunchRequest.finish({
      currentArgs: process.argv.slice(1),
      relaunch: (options) => {
        logLifecycle("app:relaunch", {
          argumentCount: options?.args?.length ?? 0,
        });
        app.relaunch(options);
      },
      quit: () => {
        logLifecycle("app:quit-reentered");
        app.quit();
      },
    });
  },
  cleanup: async () => {
    await Promise.all([
      observeLifecycleCleanup("mcp-clients", () =>
        disposeMcpClientsForShutdown(),
      ),
      observeLifecycleCleanup("mcp-oauth", () => disposeMcpOAuthForShutdown()),
      observeLifecycleCleanup("connection-flows", () =>
        disposeConnectionFlowsForShutdown(),
      ),
      observeLifecycleCleanup("remote-machine-host", () =>
        remoteMachineHost.dispose(),
      ),
    ]);
  },
});

app.on("before-quit", (event) => {
  logLifecycle("app:before-quit", {
    defaultPreventedBeforeHandler: event.defaultPrevented,
  });
  isAppQuitting = true;
  clearCrashSentinel();
  handleMcpBeforeQuit(event);
  logLifecycle("app:before-quit-handler-complete", {
    defaultPreventedAfterHandler: event.defaultPrevented,
  });
});

// IMPORTANT: This handler must be synchronous because Electron's EventEmitter
// does not await async callbacks — the returned Promise would be silently ignored.
app.on("will-quit", () => {
  logLifecycle("app:will-quit");
  logger.info("App is quitting");

  // Close the SQLite database to ensure WAL checkpoint finalization
  try {
    closeDatabase();
  } catch (error) {
    logger.error("Error closing database during quit:", error);
  }

  // Stop the garbage collection timer
  stopAppGarbageCollection();

  // Synchronously send kill signals to all running apps (fire-and-forget).
  // We cannot use async/await here because Electron won't wait for it.
  stopAllAppsSync();

  // Stop performance monitoring and capture final metrics
  stopPerformanceMonitoring();

  // Stop the chat-search index maintenance timers
  stopChatSearchIndexer();
});

app.on("quit", (_event, exitCode) => {
  logLifecycle("app:quit", { exitCode });
});

app.on("activate", () => {
  const activationContext = {
    isAppQuitting,
    hasCreatedInitialWindow,
    openWindowCount: BrowserWindow.getAllWindows().length,
  };
  const shouldRequestRelaunch =
    shouldRequestRelaunchOnActivate(activationContext);
  const shouldCreateWindow = shouldCreateWindowOnActivate(activationContext);
  logLifecycle("app:activate", {
    shouldRequestRelaunch,
    shouldCreateWindow,
  });
  if (shouldRequestRelaunch) {
    requestRelaunchAfterQuit();
  }
  if (isAppQuitting) return;

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (shouldCreateWindow) {
    const descriptor = lastClosedWindowSession ?? {
      windowSessionId: PRIMARY_WINDOW_SESSION_ID,
    };
    lastClosedWindowSession = undefined;
    createWindow(descriptor);
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
