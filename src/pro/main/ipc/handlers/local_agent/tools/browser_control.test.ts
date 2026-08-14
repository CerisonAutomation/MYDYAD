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
  mockContextClose,
  mockBrowserClose,
  mockNewPage,
  mockNewContext,
  mockLaunch,
  mockFsMkdir,
  mockFsWriteFile,
} = vi.hoisted(() => ({
  mockGoto: vi.fn(),
  mockTitle: vi.fn().mockResolvedValue("Test Page"),
  mockElementClick: vi.fn(),
  mockElementFill: vi.fn(),
  mockElementTextContent: vi.fn().mockResolvedValue("Hello world"),
  mockElementScreenshot: vi
    .fn()
    .mockResolvedValue(Buffer.from("png-data")),
  mockPageScreenshot: vi
    .fn()
    .mockResolvedValue(Buffer.from("png-data")),
  mockPageDollar: vi.fn(),
  mockMouseWheel: vi.fn(),
  mockPageWaitForTimeout: vi.fn(),
  mockPageWaitForSelector: vi.fn(),
  mockPageEvaluate: vi.fn(),
  mockContextClose: vi.fn().mockResolvedValue(undefined),
  mockBrowserClose: vi.fn().mockResolvedValue(undefined),
  mockNewPage: vi.fn(),
  mockNewContext: vi.fn(),
  mockLaunch: vi.fn(),
  mockFsMkdir: vi.fn().mockResolvedValue(undefined),
  mockFsWriteFile: vi.fn().mockResolvedValue(undefined),
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
  evaluate: mockPageEvaluate,
});

mockNewContext.mockResolvedValue({
  newPage: mockNewPage,
  close: mockContextClose,
});

mockLaunch.mockResolvedValue({
  newPage: mockNewPage,
  newContext: mockNewContext,
  close: mockBrowserClose,
});

vi.mock("playwright", () => ({
  chromium: { launch: mockLaunch },
}));

// Mock fs for screenshot saving
vi.mock("node:fs/promises", () => ({
  default: {
    mkdir: mockFsMkdir,
    writeFile: mockFsWriteFile,
  },
  mkdir: mockFsMkdir,
  writeFile: mockFsWriteFile,
}));

// ---------------------------------------------------------------------------
// Imports under test (after mocks are in place)
// ---------------------------------------------------------------------------

import { browserControlTool } from "./browser_control";
import { takeScreenshotTool } from "./take_screenshot";
import { domSnapshotTool } from "./dom_snapshot";

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
  mockLaunch.mockResolvedValue({
    newPage: mockNewPage,
    newContext: mockNewContext,
    close: mockBrowserClose,
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

    it("rejects navigate without url", () => {
      const result = browserControlTool.inputSchema.safeParse({
        action: "navigate",
      });
      expect(result.success).toBe(false);
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
      const xml = browserControlTool.buildXml!(
        { action: "screenshot" },
        false,
      );
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
      });
      expect(result).toContain("200");
      expect(result).toContain("Test Page");
      expect(mockBrowserClose).toHaveBeenCalledOnce();
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

    it("closes browser even on error", async () => {
      mockGoto.mockRejectedValueOnce(new Error("Navigation failed"));
      const ctx = createMockContext();

      await expect(
        browserControlTool.execute(
          { action: "navigate", url: "https://example.com" },
          ctx,
        ),
      ).rejects.toThrow();

      expect(mockBrowserClose).toHaveBeenCalledOnce();
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
        browserControlTool.execute(
          { action: "get_text", selector: "h1" },
          ctx,
        ),
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

      expect(mockLaunch).toHaveBeenCalled();
      expect(result).toContain("Screenshot saved to:");
      expect(result).toContain(".dyad/media/screenshot-");
    });

    it("throws when no URL is provided (preview not yet supported)", async () => {
      const ctx = createMockContext();
      await expect(takeScreenshotTool.execute({}, ctx)).rejects.toThrow(
        "Preview panel screenshot is not yet supported",
      );
    });

    it("passes viewport dimensions to browser context", async () => {
      const ctx = createMockContext();
      await takeScreenshotTool.execute(
        {
          url: "https://example.com",
          width: 1920,
          height: 1080,
        },
        ctx,
      );

      expect(mockNewContext).toHaveBeenCalledWith({
        viewport: { width: 1920, height: 1080 },
      });
    });

    it("uses default viewport when not specified", async () => {
      const ctx = createMockContext();
      await takeScreenshotTool.execute(
        { url: "https://example.com" },
        ctx,
      );

      expect(mockNewContext).toHaveBeenCalledWith({
        viewport: { width: 1280, height: 720 },
      });
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
      mockPageDollar.mockResolvedValueOnce(null);
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
      await takeScreenshotTool.execute(
        { url: "https://example.com" },
        ctx,
      );

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
      const xml = domSnapshotTool.buildXml!(
        { url: "https://x.com" },
        true,
      );
      expect(xml).toBeUndefined();
    });

    it("returns undefined when no url or app_name", () => {
      const xml = domSnapshotTool.buildXml!({}, false);
      expect(xml).toBeUndefined();
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
      const xml = domSnapshotTool.buildXml!(
        { app_name: "my-app" },
        false,
      );
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

      expect(mockLaunch).toHaveBeenCalled();
      expect(mockGoto).toHaveBeenCalledWith("https://example.com", {
        waitUntil: "networkidle",
        timeout: 30_000,
      });
      expect(result).toContain("DOM Snapshot captured successfully");
      expect(result).toContain("https://example.com");
      expect(result).toContain("Nodes: 3");
    });

    it("throws when no URL is provided", async () => {
      const ctx = createMockContext();
      await expect(domSnapshotTool.execute({}, ctx)).rejects.toThrow(
        "No URL provided",
      );
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
      await domSnapshotTool.execute(
        { url: "https://example.com" },
        ctx,
      );

      expect(mockPageEvaluate).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({ maxDepth: 10 }),
      );
    });

    it("closes browser in finally block on success", async () => {
      mockPageEvaluate.mockResolvedValueOnce({
        tree: { tag: "html", children: [] },
        nodeCount: 1,
        finalUrl: "https://example.com",
      });

      const ctx = createMockContext();
      await domSnapshotTool.execute(
        { url: "https://example.com" },
        ctx,
      );

      expect(mockBrowserClose).toHaveBeenCalledOnce();
    });

    it("closes browser in finally block on error", async () => {
      mockPageEvaluate.mockRejectedValueOnce(new Error("Evaluate failed"));
      const ctx = createMockContext();

      await expect(
        domSnapshotTool.execute({ url: "https://example.com" }, ctx),
      ).rejects.toThrow();

      expect(mockBrowserClose).toHaveBeenCalledOnce();
    });

    it("wraps navigation errors as DyadError External", async () => {
      mockGoto.mockRejectedValueOnce(
        new Error("net::ERR_NAME_NOT_RESOLVED"),
      );
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
      await domSnapshotTool.execute(
        { url: "https://example.com" },
        ctx,
      );

      expect(ctx.onXmlStream).toHaveBeenCalled();
      expect(ctx.onXmlComplete).toHaveBeenCalledWith(
        expect.stringContaining("dyad-dom-snapshot"),
      );
    });
  });
});
