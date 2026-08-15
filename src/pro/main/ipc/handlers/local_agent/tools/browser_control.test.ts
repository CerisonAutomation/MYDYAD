import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { AgentContext } from "./types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";

// ---------------------------------------------------------------------------
// Mock Playwright — must be set up before importing the tools under test.
// vi.hoisted ensures these are available inside vi.mock factory functions,
// which are hoisted above the variable declarations.
// ---------------------------------------------------------------------------

const {
  mockGoto,
  mockTitle,
  mockElementClick,
  mockElementFill,
  mockElementTextContent,
  mockElementScreenshot,
  mockPageScreenshot,
  mockPageDollar,
  mockMouseWheel,
  mockPageWaitForTimeout,
  mockPageWaitForSelector,
  mockPageEvaluate,
  mockPageSetViewportSize,
  mockContextClose,
  mockBrowserClose,
  mockNewPage,
  mockNewContext,
  mockLaunch,
  mockFsMkdir,
  mockFsWriteFile,
  mockFsReaddir,
  mockFsUnlink,
} = vi.hoisted(() => ({
  mockGoto: vi.fn(),
  mockTitle: vi.fn().mockResolvedValue("Test Page"),
  mockElementClick: vi.fn(),
  mockElementFill: vi.fn(),
  mockElementTextContent: vi.fn().mockResolvedValue("Hello world"),
  mockElementScreenshot: vi.fn().mockResolvedValue(Buffer.from("png-data")),
  mockPageScreenshot: vi.fn().mockResolvedValue(Buffer.from("png-data")),
  mockPageDollar: vi.fn(),
  mockMouseWheel: vi.fn(),
  mockPageWaitForTimeout: vi.fn(),
  mockPageWaitForSelector: vi.fn(),
  mockPageEvaluate: vi.fn(),
  mockPageSetViewportSize: vi.fn().mockResolvedValue(undefined),
  mockContextClose: vi.fn().mockResolvedValue(undefined),
  mockBrowserClose: vi.fn().mockResolvedValue(undefined),
  mockNewPage: vi.fn(),
  mockNewContext: vi.fn(),
  mockLaunch: vi.fn(),
  mockFsMkdir: vi.fn().mockResolvedValue(undefined),
  mockFsWriteFile: vi.fn().mockResolvedValue(undefined),
  mockFsReaddir: vi.fn().mockResolvedValue([]),
  mockFsUnlink: vi.fn().mockResolvedValue(undefined),
}));

// Set up mock return values after hoisted declarations are available
mockNewPage.mockResolvedValue({
  goto: mockGoto,
  title: mockTitle,
  $: mockPageDollar,
  screenshot: mockPageScreenshot,
  mouse: { wheel: mockMouseWheel },
  waitForTimeout: mockPageWaitForTimeout,
  waitForSelector: mockPageWaitForSelector,
  waitForLoadState: vi.fn().mockResolvedValue(undefined),
  evaluate: mockPageEvaluate,
  viewportSize: vi.fn().mockReturnValue({ width: 1280, height: 720 }),
  setViewportSize: mockPageSetViewportSize,
  isClosed: vi.fn().mockReturnValue(false),
});

mockNewContext.mockResolvedValue({
  newPage: mockNewPage,
  close: mockContextClose,
  pages: vi.fn().mockReturnValue([]),
});

mockLaunch.mockResolvedValue({
  newPage: mockNewPage,
  newContext: mockNewContext,
  close: mockBrowserClose,
  isConnected: vi.fn().mockReturnValue(true),
  on: vi.fn(),
});

vi.mock("playwright", () => ({
  chromium: { launch: mockLaunch },
}));

// Mock fs for screenshot saving
vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: mockFsMkdir,
    writeFile: mockFsWriteFile,
    readdir: mockFsReaddir,
    unlink: mockFsUnlink,
  },
  mkdir: mockFsMkdir,
  writeFile: mockFsWriteFile,
  readdir: mockFsReaddir,
  unlink: mockFsUnlink,
}));

// ---------------------------------------------------------------------------
// Imports under test (after mocks are in place)
// ---------------------------------------------------------------------------

import { browserControlTool } from "./browser_control";
import { takeScreenshotTool } from "./take_screenshot";
import { domSnapshotTool } from "./dom_snapshot";
import { resetPreviewProbeCache } from "./browser_session";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockContext(overrides?: Partial<AgentContext>): AgentContext {
  return {
    event: {} as any,
    appId: 1,
    appPath: "/tmp/test-app",
    referencedApps: new Map(),
    chatId: 1,
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    neonProjectId: null,
    neonActiveBranchId: null,
    frameworkType: null,
    messageId: 1,
    isSharedModulesChanged: false,
    sharedServerModulePaths: [],
    pendingFunctionDeploys: [],
    todos: [],
    dyadRequestId: "test-req",
    fileEditTracker: {},
    isDyadPro: false,
    testingEnabled: false,
    testRunAttempts: new Map(),
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
    requireConsent: vi.fn().mockResolvedValue(true),
    appendUserMessage: vi.fn(),
    onUpdateTodos: vi.fn(),
    ...overrides,
  } as AgentContext;
}

function resetMocks(): void {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  resetPreviewProbeCache();
  // Re-establish default mock return values after clearAllMocks
  mockGoto.mockResolvedValue({ status: () => 200 });
  mockTitle.mockResolvedValue("Test Page");
  mockPageDollar.mockResolvedValue({
    click: mockElementClick,
    fill: mockElementFill,
    textContent: mockElementTextContent,
    screenshot: mockElementScreenshot,
  });
  mockPageScreenshot.mockResolvedValue(Buffer.from("png-data"));
  mockElementScreenshot.mockResolvedValue(Buffer.from("png-data"));
  mockPageSetViewportSize.mockResolvedValue(undefined);
  mockLaunch.mockResolvedValue({
    newPage: mockNewPage,
    newContext: mockNewContext,
    close: mockBrowserClose,
    isConnected: vi.fn().mockReturnValue(true),
    on: vi.fn(),
  });
  mockFsMkdir.mockResolvedValue(undefined);
  mockFsWriteFile.mockResolvedValue(undefined);
}

// ============================================================================
// browser_control tool
// ============================================================================

describe("browserControlTool", () => {
  beforeEach(resetMocks);

  // --- Tool metadata ---

  describe("tool metadata", () => {
    it("has correct name", () => {
      expect(browserControlTool.name).toBe("browser_control");
    });

    it("has a non-empty description", () => {
      expect(browserControlTool.description).toBeTruthy();
      expect(browserControlTool.description.length).toBeGreaterThan(20);
    });

    it("does not modify state", () => {
      expect(browserControlTool.modifiesState).toBe(false);
    });

    it("uses 'always' consent by default", () => {
      expect(browserControlTool.defaultConsent).toBe("always");
    });

    it("is enabled in any context", () => {
      const ctx = createMockContext();
      expect(browserControlTool.isEnabled!(ctx)).toBe(true);
    });
  });

  // --- Schema validation ---

  describe("schema validation", () => {
    it("accepts a valid navigate action", () => {
      const result = browserControlTool.inputSchema.safeParse({
        action: "navigate",
        url: "https://example.com",
      });
      expect(result.success).toBe(true);
    });

    it("accepts a valid click action", () => {
      const result = browserControlTool.inputSchema.safeParse({
        action: "click",
        selector: "button.submit",
      });
      expect(result.success).toBe(true);
    });

    it("accepts a click action with optional wait_ms", () => {
      const result = browserControlTool.inputSchema.safeParse({
        action: "click",
        selector: "#login",
        wait_ms: 1000,
      });
      expect(result.success).toBe(true);
    });

    it("accepts a valid type action", () => {
      const result = browserControlTool.inputSchema.safeParse({
        action: "type",
        selector: "input[name='email']",
        text: "user@example.com",
      });
      expect(result.success).toBe(true);
    });

    it("rejects type action missing text", () => {
      const result = browserControlTool.inputSchema.safeParse({
        action: "type",
        selector: "input",
      });
      expect(result.success).toBe(false);
    });

    it("accepts a valid scroll action", () => {
      const result = browserControlTool.inputSchema.safeParse({
        action: "scroll",
        direction: "down",
      });
      expect(result.success).toBe(true);
    });

    it("accepts scroll with custom amount", () => {
      const result = browserControlTool.inputSchema.safeParse({
        action: "scroll",
        direction: "up",
        amount: 1000,
      });
      expect(result.success).toBe(true);
    });

    it("rejects scroll with invalid direction", () => {
      const result = browserControlTool.inputSchema.safeParse({
        action: "scroll",
        direction: "diagonal",
      });
      expect(result.success).toBe(false);
    });

    it("accepts a valid screenshot action", () => {
      const result = browserControlTool.inputSchema.safeParse({
        action: "screenshot",
      });
      expect(result.success).toBe(true);
    });

    it("accepts screenshot with full_page flag", () => {
      const result = browserControlTool.inputSchema.safeParse({
        action: "screenshot",
        full_page: true,
      });
      expect(result.success).toBe(true);
    });

    it("accepts a valid get_text action", () => {
      const result = browserControlTool.inputSchema.safeParse({
        action: "get_text",
        selector: "h1",
      });
      expect(result.success).toBe(true);
    });

    it("accepts a valid wait_for action", () => {
      const result = browserControlTool.inputSchema.safeParse({
        action: "wait_for",
        selector: ".loaded",
      });
      expect(result.success).toBe(true);
    });

    it("accepts wait_for with custom timeout", () => {
      const result = browserControlTool.inputSchema.safeParse({
        action: "wait_for",
        selector: "#content",
        timeout_ms: 5000,
      });
      expect(result.success).toBe(true);
    });

    it("rejects an unknown action", () => {
      const result = browserControlTool.inputSchema.safeParse({
        action: "hover",
      });
      expect(result.success).toBe(false);
    });

    it("accepts navigate without url (preview fallback)", () => {
      const result = browserControlTool.inputSchema.safeParse({
        action: "navigate",
      });
      expect(result.success).toBe(true);
    });
  });

  // --- Consent preview ---

  describe("getConsentPreview", () => {
    it("returns navigate preview", () => {
      const preview = browserControlTool.getConsentPreview!({
        action: "navigate",
        url: "https://example.com",
      } as any);
      expect(preview).toContain("Navigate");
      expect(preview).toContain("https://example.com");
    });

    it("returns click preview", () => {
      const preview = browserControlTool.getConsentPreview!({
        action: "click",
        selector: "button.submit",
      } as any);
      expect(preview).toContain("Click");
      expect(preview).toContain("button.submit");
    });

    it("returns screenshot preview", () => {
      const preview = browserControlTool.getConsentPreview!({
        action: "screenshot",
        full_page: false,
      } as any);
      expect(preview).toContain("screenshot");
    });

    it("returns full-page screenshot preview", () => {
      const preview = browserControlTool.getConsentPreview!({
        action: "screenshot",
        full_page: true,
      } as any);
      expect(preview).toContain("full-page");
    });
  });

  // --- BuildXml ---

  describe("buildXml", () => {
    it("returns undefined when isComplete is true", () => {
      const xml = browserControlTool.buildXml!(
        { action: "navigate", url: "https://example.com" },
        true,
      );
      expect(xml).toBeUndefined();
    });

    it("builds navigate XML", () => {
      const xml = browserControlTool.buildXml!(
        { action: "navigate", url: "https://example.com" },
        false,
      );
      expect(xml).toContain("dyad-browser");
      expect(xml).toContain('action="navigate"');
      expect(xml).toContain("https://example.com");
    });

    it("builds click XML", () => {
      const xml = browserControlTool.buildXml!(
        { action: "click", selector: "button" },
        false,
      );
      expect(xml).toContain('action="click"');
      expect(xml).toContain("button");
    });

    it("builds screenshot XML", () => {
      const xml = browserControlTool.buildXml!({ action: "screenshot" }, false);
      expect(xml).toContain('action="screenshot"');
    });
  });

  // --- Execute: navigate ---

  describe("execute: navigate", () => {
    it("navigates successfully and returns status + title", async () => {
      const ctx = createMockContext();
      const result = await browserControlTool.execute(
        { action: "navigate", url: "https://example.com" },
        ctx,
      );

      expect(mockLaunch).toHaveBeenCalledOnce();
      expect(mockGoto).toHaveBeenCalledWith("https://example.com", {
        waitUntil: "domcontentloaded",
        timeout: 15_000,
      });
      expect(result).toContain("200");
      expect(result).toContain("Test Page");
      // Shared session persists — browser is NOT closed per invocation.
      expect(mockBrowserClose).not.toHaveBeenCalled();
    });

    it("rejects invalid URL", async () => {
      const ctx = createMockContext();
      await expect(
        browserControlTool.execute(
          { action: "navigate", url: "not-a-url" },
          ctx,
        ),
      ).rejects.toThrow("Invalid URL");
      // Browser is launched before URL validation in this tool's execute flow,
      // so we just verify the error was thrown correctly.
    });

    it("rejects non-http protocol", async () => {
      const ctx = createMockContext();
      await expect(
        browserControlTool.execute(
          { action: "navigate", url: "file:///etc/passwd" },
          ctx,
        ),
      ).rejects.toThrow("Unsupported URL scheme");
    });

    it("keeps the shared browser session on error", async () => {
      mockGoto.mockRejectedValueOnce(new Error("Navigation failed"));
      const ctx = createMockContext();

      await expect(
        browserControlTool.execute(
          { action: "navigate", url: "https://example.com" },
          ctx,
        ),
      ).rejects.toThrow();

      // Errors do not tear down the shared session — the browser stays alive
      // for the next tool call (idle sweep + app quit handle cleanup).
      expect(mockBrowserClose).not.toHaveBeenCalled();
    });

    it("calls onXmlStream and onXmlComplete", async () => {
      const ctx = createMockContext();
      await browserControlTool.execute(
        { action: "navigate", url: "https://example.com" },
        ctx,
      );

      expect(ctx.onXmlStream).toHaveBeenCalledWith(
        expect.stringContaining("navigate"),
      );
      expect(ctx.onXmlComplete).toHaveBeenCalledWith(
        expect.stringContaining("dyad-browser"),
      );
    });
  });

  // --- Execute: click ---

  describe("execute: click", () => {
    it("clicks an element successfully", async () => {
      const ctx = createMockContext();
      const result = await browserControlTool.execute(
        { action: "click", selector: "button.submit" },
        ctx,
      );

      expect(mockPageDollar).toHaveBeenCalledWith("button.submit");
      expect(mockElementClick).toHaveBeenCalledOnce();
      expect(result).toContain("button.submit");
    });

    it("throws DyadError when selector not found", async () => {
      mockPageDollar.mockResolvedValueOnce(null);
      const ctx = createMockContext();

      await expect(
        browserControlTool.execute(
          { action: "click", selector: ".nonexistent" },
          ctx,
        ),
      ).rejects.toThrow(DyadError);
    });

    it("waits after click when wait_ms is provided", async () => {
      const ctx = createMockContext();
      await browserControlTool.execute(
        { action: "click", selector: "button", wait_ms: 500 },
        ctx,
      );

      expect(mockPageWaitForTimeout).toHaveBeenCalledWith(500);
    });
  });

  // --- Execute: type ---

  describe("execute: type", () => {
    it("types into an element", async () => {
      const ctx = createMockContext();
      const result = await browserControlTool.execute(
        { action: "type", selector: "input#email", text: "test@test.com" },
        ctx,
      );

      expect(mockElementFill).toHaveBeenCalledWith("test@test.com");
      expect(result).toContain("input#email");
    });

    it("throws DyadError when selector not found", async () => {
      mockPageDollar.mockResolvedValueOnce(null);
      const ctx = createMockContext();

      await expect(
        browserControlTool.execute(
          { action: "type", selector: ".missing", text: "hi" },
          ctx,
        ),
      ).rejects.toThrow(DyadError);
    });
  });

  // --- Execute: scroll ---

  describe("execute: scroll", () => {
    it("scrolls down", async () => {
      const ctx = createMockContext();
      const result = await browserControlTool.execute(
        { action: "scroll", direction: "down" },
        ctx,
      );

      expect(mockMouseWheel).toHaveBeenCalledWith(0, 500);
      expect(result).toContain("down");
    });

    it("scrolls with custom amount", async () => {
      const ctx = createMockContext();
      await browserControlTool.execute(
        { action: "scroll", direction: "up", amount: 1000 },
        ctx,
      );

      expect(mockMouseWheel).toHaveBeenCalledWith(0, -1000);
    });

    it("scrolls left", async () => {
      const ctx = createMockContext();
      await browserControlTool.execute(
        { action: "scroll", direction: "left" },
        ctx,
      );

      expect(mockMouseWheel).toHaveBeenCalledWith(-500, 0);
    });
  });

  // --- Execute: get_text ---

  describe("execute: get_text", () => {
    it("returns trimmed text content", async () => {
      mockElementTextContent.mockResolvedValueOnce("  Hello world  ");
      const ctx = createMockContext();
      const result = await browserControlTool.execute(
        { action: "get_text", selector: "h1" },
        ctx,
      );

      expect(result).toBe("Hello world");
    });

    it("throws DyadError when selector not found", async () => {
      mockPageDollar.mockResolvedValueOnce(null);
      const ctx = createMockContext();

      await expect(
        browserControlTool.execute(
          { action: "get_text", selector: ".missing" },
          ctx,
        ),
      ).rejects.toThrow(DyadError);
    });

    it("throws DyadError when textContent is null", async () => {
      mockPageDollar.mockResolvedValueOnce({
        textContent: vi.fn().mockResolvedValueOnce(null),
      });
      const ctx = createMockContext();

      await expect(
        browserControlTool.execute({ action: "get_text", selector: "h1" }, ctx),
      ).rejects.toThrow(DyadError);
    });
  });

  // --- Execute: wait_for ---

  describe("execute: wait_for", () => {
    it("resolves when selector appears", async () => {
      const ctx = createMockContext();
      const result = await browserControlTool.execute(
        { action: "wait_for", selector: ".loaded" },
        ctx,
      );

      expect(mockPageWaitForSelector).toHaveBeenCalledWith(".loaded", {
        timeout: 10000,
      });
      expect(result).toContain(".loaded");
    });

    it("uses custom timeout", async () => {
      const ctx = createMockContext();
      await browserControlTool.execute(
        { action: "wait_for", selector: "#data", timeout_ms: 3000 },
        ctx,
      );

      expect(mockPageWaitForSelector).toHaveBeenCalledWith("#data", {
        timeout: 3000,
      });
    });

    it("throws DyadError on timeout", async () => {
      mockPageWaitForSelector.mockRejectedValueOnce(
        new Error("Timeout waiting"),
      );
      const ctx = createMockContext();

      await expect(
        browserControlTool.execute(
          { action: "wait_for", selector: ".never" },
          ctx,
        ),
      ).rejects.toThrow(DyadError);
    });
  });
});

// ============================================================================
// take_screenshot tool
// ============================================================================

describe("takeScreenshotTool", () => {
  beforeEach(resetMocks);

  // --- Tool metadata ---

  describe("tool metadata", () => {
    it("has correct name", () => {
      expect(takeScreenshotTool.name).toBe("take_screenshot");
    });

    it("has a non-empty description", () => {
      expect(takeScreenshotTool.description).toBeTruthy();
      expect(takeScreenshotTool.description.length).toBeGreaterThan(20);
    });

    it("does not modify state", () => {
      expect(takeScreenshotTool.modifiesState).toBe(false);
    });

    it("uses 'always' consent by default", () => {
      expect(takeScreenshotTool.defaultConsent).toBe("always");
    });

    it("is enabled in any context", () => {
      const ctx = createMockContext();
      expect(takeScreenshotTool.isEnabled!(ctx)).toBe(true);
    });
  });

  // --- Schema validation ---

  describe("schema validation", () => {
    it("accepts empty args (no URL = preview panel)", () => {
      const result = takeScreenshotTool.inputSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts a valid URL", () => {
      const result = takeScreenshotTool.inputSchema.safeParse({
        url: "https://example.com",
      });
      expect(result.success).toBe(true);
    });

    it("accepts all optional fields", () => {
      const result = takeScreenshotTool.inputSchema.safeParse({
        url: "https://example.com",
        full_page: true,
        width: 1920,
        height: 1080,
        selector: ".hero",
      });
      expect(result.success).toBe(true);
    });

    it("accepts app_name field", () => {
      const result = takeScreenshotTool.inputSchema.safeParse({
        url: "https://example.com",
        app_name: "my-app",
      });
      expect(result.success).toBe(true);
    });

    it("rejects non-string url", () => {
      const result = takeScreenshotTool.inputSchema.safeParse({
        url: 12345,
      });
      expect(result.success).toBe(false);
    });
  });

  // --- Consent preview ---

  describe("getConsentPreview", () => {
    it("shows URL when provided", () => {
      const preview = takeScreenshotTool.getConsentPreview!({
        url: "https://example.com",
      } as any);
      expect(preview).toContain("https://example.com");
    });

    it("shows preview panel message when no URL", () => {
      const preview = takeScreenshotTool.getConsentPreview!({} as any);
      expect(preview).toContain("preview panel");
    });
  });

  // --- BuildXml ---

  describe("buildXml", () => {
    it("returns undefined when isComplete is true", () => {
      const xml = takeScreenshotTool.buildXml!({ url: "https://x.com" }, true);
      expect(xml).toBeUndefined();
    });

    it("builds XML with URL", () => {
      const xml = takeScreenshotTool.buildXml!(
        { url: "https://example.com" },
        false,
      );
      expect(xml).toContain("dyad-screenshot");
      expect(xml).toContain("https://example.com");
    });

    it("builds XML without URL", () => {
      const xml = takeScreenshotTool.buildXml!({}, false);
      expect(xml).toContain("dyad-screenshot");
      expect(xml).not.toContain("url=");
    });
  });

  // --- Execute ---

  describe("execute", () => {
    it("takes a screenshot of a URL and saves it", async () => {
      const ctx = createMockContext();
      const result = await takeScreenshotTool.execute(
        { url: "https://example.com" },
        ctx,
      );

      expect(result).toContain("Screenshot saved to:");
      expect(result).toContain(".dyad/screenshot/screenshot-");
    });

    it("uses the running app's preview URL when no URL is provided", async () => {
      // Pre-flight probe: stub fetch so the preview proxy appears reachable.
      const fetchStub = vi.fn().mockResolvedValue({ status: 200 });
      vi.stubGlobal("fetch", fetchStub);
      try {
        const ctx = createMockContext();
        const result = await takeScreenshotTool.execute({}, ctx);

        // appId 1 → proxy port 42101
        expect(fetchStub).toHaveBeenCalledWith(
          "http://localhost:42101",
          expect.objectContaining({ signal: expect.any(AbortSignal) }),
        );
        expect(mockGoto).toHaveBeenCalledWith(
          "http://localhost:42101",
          expect.objectContaining({ waitUntil: "domcontentloaded" }),
        );
        expect(result).toContain("Screenshot saved to:");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("passes viewport dimensions to the page viewport", async () => {
      const ctx = createMockContext();
      await takeScreenshotTool.execute(
        {
          url: "https://example.com",
          width: 1920,
          height: 1080,
        },
        ctx,
      );

      expect(mockPageSetViewportSize).toHaveBeenCalledWith({
        width: 1920,
        height: 1080,
      });
    });

    it("does not resize the viewport when dimensions are not specified", async () => {
      const ctx = createMockContext();
      await takeScreenshotTool.execute({ url: "https://example.com" }, ctx);

      expect(mockPageSetViewportSize).not.toHaveBeenCalled();
    });

    it("passes fullPage option to page screenshot", async () => {
      const ctx = createMockContext();
      await takeScreenshotTool.execute(
        { url: "https://example.com", full_page: true },
        ctx,
      );

      expect(mockPageScreenshot).toHaveBeenCalledWith(
        expect.objectContaining({ fullPage: true }),
      );
    });

    it("takes element screenshot when selector is provided", async () => {
      const ctx = createMockContext();
      await takeScreenshotTool.execute(
        {
          url: "https://example.com",
          selector: ".hero",
        },
        ctx,
      );

      expect(mockPageDollar).toHaveBeenCalledWith(".hero");
      expect(mockElementScreenshot).toHaveBeenCalled();
      expect(mockPageScreenshot).not.toHaveBeenCalled();
    });

    it("throws DyadError when element selector is not found", async () => {
      // Persistent null across retries so the final error is the DyadError
      // (the retry helper treats "selector" errors as retryable).
      mockPageDollar.mockResolvedValue(null);
      const ctx = createMockContext();

      await expect(
        takeScreenshotTool.execute(
          { url: "https://example.com", selector: ".nonexistent" },
          ctx,
        ),
      ).rejects.toThrow(DyadError);
    });

    it("calls onXmlStream and onXmlComplete", async () => {
      const ctx = createMockContext();
      await takeScreenshotTool.execute({ url: "https://example.com" }, ctx);

      expect(ctx.onXmlStream).toHaveBeenCalledWith(
        expect.stringContaining("dyad-screenshot"),
      );
      expect(ctx.onXmlComplete).toHaveBeenCalledWith(
        expect.stringContaining("dyad-screenshot"),
      );
    });
  });
});

// ============================================================================
// dom_snapshot tool
// ============================================================================

describe("domSnapshotTool", () => {
  beforeEach(resetMocks);

  // --- Tool metadata ---

  describe("tool metadata", () => {
    it("has correct name", () => {
      expect(domSnapshotTool.name).toBe("dom_snapshot");
    });

    it("has a non-empty description", () => {
      expect(domSnapshotTool.description).toBeTruthy();
      expect(domSnapshotTool.description.length).toBeGreaterThan(20);
    });

    it("does not modify state", () => {
      expect(domSnapshotTool.modifiesState).toBe(false);
    });

    it("uses 'always' consent by default", () => {
      expect(domSnapshotTool.defaultConsent).toBe("always");
    });

    it("is enabled in any context", () => {
      const ctx = createMockContext();
      expect(domSnapshotTool.isEnabled!(ctx)).toBe(true);
    });
  });

  // --- Schema validation ---

  describe("schema validation", () => {
    it("accepts empty args", () => {
      const result = domSnapshotTool.inputSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts a valid URL", () => {
      const result = domSnapshotTool.inputSchema.safeParse({
        url: "https://example.com",
      });
      expect(result.success).toBe(true);
    });

    it("accepts all optional fields", () => {
      const result = domSnapshotTool.inputSchema.safeParse({
        url: "https://example.com",
        selector: "#app",
        include_styles: true,
        max_depth: 5,
        app_name: "my-app",
      });
      expect(result.success).toBe(true);
    });

    it("rejects max_depth below 1", () => {
      const result = domSnapshotTool.inputSchema.safeParse({
        url: "https://example.com",
        max_depth: 0,
      });
      expect(result.success).toBe(false);
    });

    it("rejects max_depth above 50", () => {
      const result = domSnapshotTool.inputSchema.safeParse({
        url: "https://example.com",
        max_depth: 51,
      });
      expect(result.success).toBe(false);
    });

    it("accepts max_depth at boundaries (1 and 50)", () => {
      expect(
        domSnapshotTool.inputSchema.safeParse({
          url: "https://example.com",
          max_depth: 1,
        }).success,
      ).toBe(true);
      expect(
        domSnapshotTool.inputSchema.safeParse({
          url: "https://example.com",
          max_depth: 50,
        }).success,
      ).toBe(true);
    });

    it("rejects non-integer max_depth", () => {
      const result = domSnapshotTool.inputSchema.safeParse({
        url: "https://example.com",
        max_depth: 3.5,
      });
      expect(result.success).toBe(false);
    });
  });

  // --- Consent preview ---

  describe("getConsentPreview", () => {
    it("includes URL in preview", () => {
      const preview = domSnapshotTool.getConsentPreview!({
        url: "https://example.com",
      } as any);
      expect(preview).toContain("DOM snapshot");
      expect(preview).toContain("https://example.com");
    });

    it("includes selector in preview", () => {
      const preview = domSnapshotTool.getConsentPreview!({
        url: "https://example.com",
        selector: "#app",
      } as any);
      expect(preview).toContain("#app");
    });

    it("omits URL and selector when not provided", () => {
      const preview = domSnapshotTool.getConsentPreview!({} as any);
      expect(preview).toContain("DOM snapshot");
    });
  });

  // --- BuildXml ---

  describe("buildXml", () => {
    it("returns undefined when isComplete is true", () => {
      const xml = domSnapshotTool.buildXml!({ url: "https://x.com" }, true);
      expect(xml).toBeUndefined();
    });

    it("emits a tag even when no url or app_name (preview panel)", () => {
      const xml = domSnapshotTool.buildXml!({}, false);
      expect(xml).toContain("dyad-dom-snapshot");
    });

    it("builds XML with URL", () => {
      const xml = domSnapshotTool.buildXml!(
        { url: "https://example.com" },
        false,
      );
      expect(xml).toContain("dyad-dom-snapshot");
      expect(xml).toContain("https://example.com");
    });

    it("builds XML with app_name", () => {
      const xml = domSnapshotTool.buildXml!({ app_name: "my-app" }, false);
      expect(xml).toContain("dyad-dom-snapshot");
      expect(xml).toContain("my-app");
    });
  });

  // --- Execute ---

  describe("execute", () => {
    it("captures DOM snapshot from a URL", async () => {
      const mockDomTree = {
        tag: "html",
        id: undefined,
        classes: [],
        text: undefined,
        children: [
          {
            tag: "body",
            text: "Hello",
            children: [],
          },
        ],
      };

      mockPageEvaluate.mockResolvedValueOnce({
        tree: mockDomTree,
        nodeCount: 3,
        finalUrl: "https://example.com",
      });

      const ctx = createMockContext();
      const result = await domSnapshotTool.execute(
        { url: "https://example.com" },
        ctx,
      );

      expect(mockGoto).toHaveBeenCalledWith("https://example.com", {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      expect(result).toContain("DOM Snapshot captured successfully");
      expect(result).toContain("https://example.com");
      expect(result).toContain("Nodes: 3");
    });

    it("uses the running app's preview URL when no URL is provided", async () => {
      const fetchStub = vi.fn().mockResolvedValue({ status: 200 });
      vi.stubGlobal("fetch", fetchStub);
      try {
        mockPageEvaluate.mockResolvedValueOnce({
          tree: { tag: "html", children: [] },
          nodeCount: 1,
          finalUrl: "http://localhost:42101",
        });

        const ctx = createMockContext();
        const result = await domSnapshotTool.execute({}, ctx);

        expect(fetchStub).toHaveBeenCalledWith(
          "http://localhost:42101",
          expect.anything(),
        );
        expect(mockGoto).toHaveBeenCalledWith(
          "http://localhost:42101",
          expect.objectContaining({ waitUntil: "domcontentloaded" }),
        );
        expect(result).toContain("DOM Snapshot captured successfully");
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it("rejects invalid URL", async () => {
      const ctx = createMockContext();
      await expect(
        domSnapshotTool.execute({ url: "not-a-url" }, ctx),
      ).rejects.toThrow("Invalid URL");
      expect(mockLaunch).not.toHaveBeenCalled();
    });

    it("rejects non-http protocol", async () => {
      const ctx = createMockContext();
      await expect(
        domSnapshotTool.execute({ url: "ftp://example.com" }, ctx),
      ).rejects.toThrow("Unsupported URL scheme");
    });

    it("rejects private IPs (SSRF protection)", async () => {
      const ctx = createMockContext();
      await expect(
        domSnapshotTool.execute({ url: "http://localhost:3000" }, ctx),
      ).rejects.toThrow("not allowed");
      expect(mockLaunch).not.toHaveBeenCalled();
    });

    it("passes selector to page.evaluate", async () => {
      mockPageEvaluate.mockResolvedValueOnce({
        tree: { tag: "div", text: "content", children: [] },
        nodeCount: 1,
        finalUrl: "https://example.com",
      });

      const ctx = createMockContext();
      await domSnapshotTool.execute(
        { url: "https://example.com", selector: "#app" },
        ctx,
      );

      expect(mockPageEvaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ selector: "#app" }),
      );
    });

    it("passes include_styles to page.evaluate", async () => {
      mockPageEvaluate.mockResolvedValueOnce({
        tree: { tag: "html", children: [] },
        nodeCount: 1,
        finalUrl: "https://example.com",
      });

      const ctx = createMockContext();
      await domSnapshotTool.execute(
        { url: "https://example.com", include_styles: true },
        ctx,
      );

      expect(mockPageEvaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ includeStyles: true }),
      );
    });

    it("caps max_depth at 50 even if higher value provided", async () => {
      mockPageEvaluate.mockResolvedValueOnce({
        tree: { tag: "html", children: [] },
        nodeCount: 1,
        finalUrl: "https://example.com",
      });

      const ctx = createMockContext();
      await domSnapshotTool.execute(
        { url: "https://example.com", max_depth: 100 },
        ctx,
      );

      // max_depth is capped to 50 via Math.min
      expect(mockPageEvaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ maxDepth: 50 }),
      );
    });

    it("uses default max_depth of 10 when not specified", async () => {
      mockPageEvaluate.mockResolvedValueOnce({
        tree: { tag: "html", children: [] },
        nodeCount: 1,
        finalUrl: "https://example.com",
      });

      const ctx = createMockContext();
      await domSnapshotTool.execute({ url: "https://example.com" }, ctx);

      expect(mockPageEvaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ maxDepth: 10 }),
      );
    });

    it("keeps the shared browser session after success", async () => {
      mockPageEvaluate.mockResolvedValueOnce({
        tree: { tag: "html", children: [] },
        nodeCount: 1,
        finalUrl: "https://example.com",
      });

      const ctx = createMockContext();
      await domSnapshotTool.execute({ url: "https://example.com" }, ctx);

      // Shared session persists — browser is NOT closed per invocation.
      expect(mockBrowserClose).not.toHaveBeenCalled();
    });

    it("keeps the shared browser session after error", async () => {
      mockPageEvaluate.mockRejectedValueOnce(new Error("Evaluate failed"));
      const ctx = createMockContext();

      await expect(
        domSnapshotTool.execute({ url: "https://example.com" }, ctx),
      ).rejects.toThrow();

      expect(mockBrowserClose).not.toHaveBeenCalled();
    });

    it("wraps navigation errors as DyadError External", async () => {
      mockGoto.mockRejectedValueOnce(new Error("net::ERR_NAME_NOT_RESOLVED"));
      const ctx = createMockContext();

      await expect(
        domSnapshotTool.execute({ url: "https://example.com" }, ctx),
      ).rejects.toThrow(DyadError);
    });

    it("calls onXmlStream and onXmlComplete", async () => {
      mockPageEvaluate.mockResolvedValueOnce({
        tree: { tag: "html", children: [] },
        nodeCount: 1,
        finalUrl: "https://example.com",
      });

      const ctx = createMockContext();
      await domSnapshotTool.execute({ url: "https://example.com" }, ctx);

      expect(ctx.onXmlStream).toHaveBeenCalled();
      expect(ctx.onXmlComplete).toHaveBeenCalledWith(
        expect.stringContaining("dyad-dom-snapshot"),
      );
    });
  });
});

// ============================================================================
// Regression tests — fixes from the omni-audit (shared-session era)
// ============================================================================

describe("browser_control regressions", () => {
  beforeEach(resetMocks);

  it("batch coerces string-serialized steps and executes them", async () => {
    const ctx = createMockContext();
    mockPageDollar.mockResolvedValue({
      click: mockElementClick,
      fill: mockElementFill,
      textContent: mockElementTextContent,
      screenshot: mockElementScreenshot,
    });

    const result = await browserControlTool.execute(
      {
        action: "batch",
        steps: JSON.stringify([
          { action: "click", params: { selector: "button.submit" } },
          { action: "get_text", params: { selector: ".result" } },
        ]),
      } as any,
      ctx,
    );

    // Both steps executed (previously the loop indexed the raw string,
    // so string steps ran against characters instead of actions).
    expect(result).toContain("[1/2] click");
    expect(result).toContain("[2/2] get_text");
    expect(mockElementClick).toHaveBeenCalledOnce();
  });

  it("batch navigate step defaults to the preview URL", async () => {
    const fetchStub = vi.fn().mockResolvedValue({ status: 200 });
    vi.stubGlobal("fetch", fetchStub);
    try {
      const ctx = createMockContext();

      const result = await browserControlTool.execute(
        {
          action: "batch",
          steps: [{ action: "navigate", params: {} }],
        } as any,
        ctx,
      );

      expect(mockGoto).toHaveBeenCalledWith(
        "http://localhost:42101",
        expect.objectContaining({ waitUntil: "domcontentloaded" }),
      );
      expect(result).toContain("[1/1] navigate");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("click by ref stamps the element and clicks it", async () => {
    const ctx = createMockContext();
    mockPageEvaluate.mockResolvedValue(undefined);
    mockPageDollar.mockResolvedValue({
      click: mockElementClick,
      fill: mockElementFill,
      textContent: mockElementTextContent,
      screenshot: mockElementScreenshot,
    });

    const result = await browserControlTool.execute(
      { action: "click", ref: 3, wait_ms: 0 },
      ctx,
    );

    expect(mockPageEvaluate).toHaveBeenCalled(); // stamping pass
    expect(mockPageDollar).toHaveBeenCalledWith('[data-dyad-ref="3"]');
    expect(mockElementClick).toHaveBeenCalledOnce();
    expect(result).toContain('data-dyad-ref="3"');
  });

  it("click without selector or ref is a validation error", async () => {
    const ctx = createMockContext();
    await expect(
      browserControlTool.execute({ action: "click" } as any, ctx),
    ).rejects.toThrow("selector");
  });

  it("navigate omits double navigation (goto called once)", async () => {
    const ctx = createMockContext();
    await browserControlTool.execute(
      { action: "navigate", url: "https://example.com" },
      ctx,
    );
    expect(mockGoto).toHaveBeenCalledTimes(1);
  });

  it("take_screenshot rejects selector + full_page combination", async () => {
    const ctx = createMockContext();
    await expect(
      takeScreenshotTool.execute(
        { url: "https://example.com", selector: ".hero", full_page: true },
        ctx,
      ),
    ).rejects.toThrow("Cannot combine");
  });

  it("take_screenshot prunes old screenshots after saving", async () => {
    mockFsReaddir.mockResolvedValue([
      "screenshot-1000-aaaa.png",
      "screenshot-1001-bbbb.png",
      "screenshot-1002-cccc.png",
    ]);
    const ctx = createMockContext();
    await takeScreenshotTool.execute({ url: "https://example.com" }, ctx);

    expect(mockFsReaddir).toHaveBeenCalled();
  });

  it("visual tools refuse to run when the dev server is down", async () => {
    // Probe fails fast (connection refused) and no app process is tracked.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("fetch failed")),
    );
    try {
      const ctx = createMockContext();
      await expect(domSnapshotTool.execute({}, ctx)).rejects.toThrow(
        /dev server is NOT running|preview proxy .* unreachable/,
      );
      // The page was never navigated — the check is a true pre-flight.
      expect(mockGoto).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("visual tools proceed when the dev server is up", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ status: 200 }));
    try {
      mockPageEvaluate.mockResolvedValueOnce({
        tree: { tag: "html", children: [] },
        nodeCount: 1,
        finalUrl: "http://localhost:42101",
      });

      const ctx = createMockContext();
      const result = await domSnapshotTool.execute({}, ctx);
      expect(result).toContain("DOM Snapshot captured successfully");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
