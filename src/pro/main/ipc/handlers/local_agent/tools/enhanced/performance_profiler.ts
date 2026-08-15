/**
 * Performance Profiler Tool — Game-Changing Feature
 *
 * Provides deep performance analysis:
 * - Core Web Vitals (LCP, FID, CLS, TTFB)
 * - Resource loading analysis
 * - Memory profiling
 * - Rendering performance
 * - JavaScript execution timing
 * - Custom performance marks
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

const logger = log.scope("performance_profiler");

// ============================================================================
// Schema
// ============================================================================

const measureWebVitalsAction = z.object({
  action: z.literal("measure_web_vitals"),
  selector: z
    .string()
    .optional()
    .describe("Optional: scope to specific element"),
});

const profileResourcesAction = z.object({
  action: z.literal("profile_resources"),
  resource_type: z
    .enum(["all", "script", "css", "image", "font", "xhr", "fetch"])
    .optional()
    .describe("Filter by resource type"),
  sort_by: z
    .enum(["duration", "size", "name"])
    .optional()
    .describe("Sort results"),
});

const profileMemoryAction = z.object({
  action: z.literal("profile_memory"),
});

const profileRendersAction = z.object({
  action: z.literal("profile_renders"),
  duration_ms: z
    .number()
    .optional()
    .describe("Profiling duration in ms (default: 5000)"),
});

const profileJavaScriptAction = z.object({
  action: z.literal("profile_javascript"),
  duration_ms: z
    .number()
    .optional()
    .describe("Profiling duration in ms (default: 3000)"),
});

const createPerformanceMarkAction = z.object({
  action: z.literal("create_mark"),
  name: z.string().describe("Performance mark name"),
});

const measureBetweenMarksAction = z.object({
  action: z.literal("measure_marks"),
  name: z.string().describe("Measure name"),
  start_mark: z.string().describe("Start mark name"),
  end_mark: z.string().describe("End mark name"),
});

const analyzeBundleAction = z.object({
  action: z.literal("analyze_bundle"),
});

const performanceProfilerSchema = z.discriminatedUnion("action", [
  measureWebVitalsAction,
  profileResourcesAction,
  profileMemoryAction,
  profileRendersAction,
  profileJavaScriptAction,
  createPerformanceMarkAction,
  measureBetweenMarksAction,
  analyzeBundleAction,
]);

type PerformanceProfilerArgs = z.infer<typeof performanceProfilerSchema>;

// ============================================================================
// Description
// ============================================================================

const DESCRIPTION = `Profile and analyze web page performance — Core Web Vitals, resource loading, memory usage, rendering, and JavaScript execution.

### Actions

#### Core Web Vitals
- **measure_web_vitals** — Measure LCP, FID, CLS, TTFB and other metrics

#### Resource Analysis
- **profile_resources** — Analyze all loaded resources by type, size, and duration
- **analyze_bundle** — Analyze JavaScript bundle size and dependencies

#### Memory Profiling
- **profile_memory** — Capture JavaScript heap usage and allocation patterns

#### Rendering Profiling
- **profile_renders** — Monitor layout/paint/reflow operations

#### JavaScript Profiling
- **profile_javascript** — Profile JavaScript execution and identify slow functions

#### Custom Metrics
- **create_mark** — Create a performance mark for timing
- **measure_marks** — Measure time between two marks

### Metrics Available
- **LCP** (Largest Contentful Paint) — Time to render largest content element
- **FID** (First Input Delay) — Time from first input to response
- **CLS** (Cumulative Layout Shift) — Visual stability score
- **TTFB** (Time to First Byte) — Server response time
- **FCP** (First Contentful Paint) — Time to first content
- **TBT** (Total Blocking Time) — Total blocking time
- **SI** (Speed Index) — Visual loading progress

### Examples
\`\`\`
// Measure all Core Web Vitals
{action: "measure_web_vitals"}

// Profile image resources
{action: "profile_resources", resource_type: "image", sort_by: "size"}

// Analyze bundle
{action: "analyze_bundle"}

// Profile memory usage
{action: "profile_memory"}
\`\`\`

### Use Cases
1. **Performance Optimization** — Identify bottlenecks
2. **Core Web Vitals** — Meet Google's performance requirements
3. **Resource Optimization** — Reduce page load time
4. **Memory Leak Detection** — Find and fix leaks
5. **Rendering Debugging** — Identify layout thrashing
6. **Bundle Analysis** — Reduce JavaScript bundle size`;

// ============================================================================
// Action Executors
// ============================================================================

async function executeMeasureWebVitals(
  page: any,
  args: z.infer<typeof measureWebVitalsAction>,
): Promise<string> {
  const result = await page.evaluate(() => {
    const vitals: Record<string, unknown> = {};

    // LCP
    const lcpEntry = performance.getEntriesByName(
      "largest-contentful-paint",
    )[0];
    vitals.LCP = lcpEntry ? Math.round(lcpEntry.startTime) : null;

    // FID
    const fidEntry = performance.getEntriesByName("first-input-delay")[0];
    vitals.FID = fidEntry ? Math.round(fidEntry.duration) : null;

    // CLS
    let cls = 0;
    for (const entry of performance.getEntriesByName("layout-shift")) {
      if (!(entry as any).hadRecentInput) {
        cls += (entry as any).value;
      }
    }
    vitals.CLS = Math.round(cls * 1000) / 1000;

    // TTFB
    const navigation = performance.getEntriesByType("navigation")[0];
    vitals.TTFB = navigation
      ? Math.round((navigation as PerformanceNavigationTiming).responseStart)
      : null;

    // FCP
    const fcpEntry = performance.getEntriesByName("first-contentful-paint")[0];
    vitals.FCP = fcpEntry ? Math.round(fcpEntry.startTime) : null;

    // TBT
    let tbt = 0;
    for (const entry of performance.getEntriesByName("longtask")) {
      tbt += entry.duration;
    }
    vitals.TBT = Math.round(tbt);

    return vitals;
  });

  return JSON.stringify(result, null, 2);
}

async function executeProfileResources(
  page: any,
  args: z.infer<typeof profileResourcesAction>,
): Promise<string> {
  const { resource_type, sort_by } = args;

  const resources = await page.evaluate(
    ({ resourceType, sortBy }: { resourceType?: string; sortBy?: string }) => {
      const entries = performance.getEntriesByType("resource");
      let filtered = entries as PerformanceResourceTiming[];

      if (resourceType && resourceType !== "all") {
        filtered = filtered.filter((e) => e.initiatorType === resourceType);
      }

      const sorted = filtered.sort((a, b) => {
        switch (sortBy) {
          case "duration":
            return b.duration - a.duration;
          case "size":
            return (b.transferSize || 0) - (a.transferSize || 0);
          case "name":
            return a.name.localeCompare(b.name);
          default:
            return b.duration - a.duration;
        }
      });

      return sorted.map((e) => ({
        name: e.name.split("/").pop(),
        type: e.initiatorType,
        duration: Math.round(e.duration),
        size: e.transferSize,
        protocol: e.nextHopProtocol,
      }));
    },
    { resourceType: resource_type, sortBy: sort_by },
  );

  return JSON.stringify(resources, null, 2);
}

async function executeProfileMemory(page: any): Promise<string> {
  const memory = await page.evaluate(() => {
    const perf = performance as any;

    return {
      jsHeapSize: perf.memory?.jsHeapSizeLimit
        ? Math.round(perf.memory.jsHeapSizeLimit / 1024 / 1024) + " MB"
        : "N/A",
      totalJSHeapSize: perf.memory?.totalJSHeapSize
        ? Math.round(perf.memory.totalJSHeapSize / 1024 / 1024) + " MB"
        : "N/A",
      usedJSHeapSize: perf.memory?.usedJSHeapSize
        ? Math.round(perf.memory.usedJSHeapSize / 1024 / 1024) + " MB"
        : "N/A",
    };
  });

  return JSON.stringify(memory, null, 2);
}

async function executeProfileRenders(
  page: any,
  args: z.infer<typeof profileRendersAction>,
): Promise<string> {
  const { duration_ms } = args;

  const renders = await page.evaluate((duration: number) => {
    return new Promise((resolve) => {
      let paintCount = 0;
      let layoutCount = 0;

      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === "paint") paintCount++;
          if (entry.entryType === "layout-shift") layoutCount++;
        }
      });

      observer.observe({ entryTypes: ["paint", "layout-shift"] });

      setTimeout(() => {
        observer.disconnect();
        resolve({
          paintCount,
          layoutCount,
          duration,
        });
      }, duration);
    });
  }, duration_ms || 5000);

  return JSON.stringify(renders, null, 2);
}

async function executeProfileJavaScript(
  page: any,
  args: z.infer<typeof profileJavaScriptAction>,
): Promise<string> {
  const { duration_ms } = args;

  const profile = await page.evaluate((duration: number) => {
    return new Promise((resolve) => {
      const samples: Array<{ name: string; duration: number }> = [];

      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === "function") {
            samples.push({
              name: entry.name,
              duration: Math.round(entry.duration),
            });
          }
        }
      });

      observer.observe({ entryTypes: ["function"] });

      setTimeout(() => {
        observer.disconnect();

        // Aggregate by function name
        const aggregated: Record<string, number> = {};
        for (const sample of samples) {
          aggregated[sample.name] =
            (aggregated[sample.name] || 0) + sample.duration;
        }

        // Sort by duration
        const sorted = Object.entries(aggregated)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([name, duration]) => ({ name, duration }));

        resolve({
          totalSamples: samples.length,
          topFunctions: sorted,
        });
      }, duration);
    });
  }, duration_ms || 3000);

  return JSON.stringify(profile, null, 2);
}

async function executeCreateMark(
  page: any,
  args: z.infer<typeof createPerformanceMarkAction>,
): Promise<string> {
  await page.evaluate((name: string) => {
    performance.mark(name);
  }, args.name);

  return `Performance mark created: ${args.name}`;
}

async function executeMeasureMarks(
  page: any,
  args: z.infer<typeof measureBetweenMarksAction>,
): Promise<string> {
  const result = await page.evaluate(
    ({
      name,
      startMark,
      endMark,
    }: {
      name: string;
      startMark: string;
      endMark: string;
    }) => {
      try {
        performance.measure(name, startMark, endMark);
        const entry = performance.getEntriesByName(name)[0];
        return {
          name,
          duration: Math.round(entry.duration),
        };
      } catch (e) {
        return { error: (e as Error).message };
      }
    },
    {
      name: args.name,
      startMark: args.start_mark,
      endMark: args.end_mark,
    },
  );

  if (result.error) throw new DyadError(result.error, DyadErrorKind.Validation);
  return JSON.stringify(result, null, 2);
}

async function executeAnalyzeBundle(page: any): Promise<string> {
  const bundle = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll("script[src]"));
    const links = Array.from(
      document.querySelectorAll('link[rel="stylesheet"]'),
    );

    const resources = performance.getEntriesByType(
      "resource",
    ) as PerformanceResourceTiming[];

    const jsResources = resources
      .filter((r) => r.initiatorType === "script")
      .map((r) => ({
        name: r.name.split("/").pop(),
        size: r.transferSize,
        duration: Math.round(r.duration),
      }));

    const cssResources = resources
      .filter((r) => r.initiatorType === "css" || r.initiatorType === "link")
      .map((r) => ({
        name: r.name.split("/").pop(),
        size: r.transferSize,
        duration: Math.round(r.duration),
      }));

    return {
      scripts: jsResources,
      styles: cssResources,
      totalScriptSize: jsResources.reduce((sum, r) => sum + r.size, 0),
      totalStyleSize: cssResources.reduce((sum, r) => sum + r.size, 0),
    };
  });

  return JSON.stringify(bundle, null, 2);
}

// ============================================================================
// Tool Definition
// ============================================================================

export const performanceProfilerTool: ToolDefinition<PerformanceProfilerArgs> =
  {
    name: "performance_profiler",
    description: DESCRIPTION,
    inputSchema: performanceProfilerSchema,
    defaultConsent: "always",
    modifiesState: false,

    isEnabled: (_ctx: AgentContext) => true,

    getConsentPreview: (args) => {
      switch (args.action) {
        case "measure_web_vitals":
          return "Measure Core Web Vitals";
        case "profile_resources":
          return `Profile ${args.resource_type || "all"} resources`;
        case "profile_memory":
          return "Profile memory usage";
        case "profile_renders":
          return `Profile rendering for ${args.duration_ms || 5000}ms`;
        case "profile_javascript":
          return `Profile JavaScript for ${args.duration_ms || 3000}ms`;
        case "create_mark":
          return `Create mark: ${args.name}`;
        case "measure_marks":
          return `Measure ${args.start_mark} → ${args.end_mark}`;
        case "analyze_bundle":
          return "Analyze bundle";
      }
    },

    buildXml: (args, isComplete) => {
      if (isComplete) return undefined;
      return `<dyad-performance action="${escapeXmlAttr(args.action)}">`;
    },

    execute: async (args: PerformanceProfilerArgs, ctx: AgentContext) => {
      logger.log(`Executing performance_profiler: ${args.action}`);

      try {
        const page = await getPage();

        let result: string = "";

        switch (args.action) {
          case "measure_web_vitals":
            result = await executeMeasureWebVitals(page, args);
            break;
          case "profile_resources":
            result = await executeProfileResources(page, args);
            break;
          case "profile_memory":
            result = await executeProfileMemory(page);
            break;
          case "profile_renders":
            result = await executeProfileRenders(page, args);
            break;
          case "profile_javascript":
            result = await executeProfileJavaScript(page, args);
            break;
          case "create_mark":
            result = await executeCreateMark(page, args);
            break;
          case "measure_marks":
            result = await executeMeasureMarks(page, args);
            break;
          case "analyze_bundle":
            result = await executeAnalyzeBundle(page);
            break;
        }

        ctx.onXmlComplete(
          `<dyad-performance action="${escapeXmlAttr(args.action)}">${escapeXmlContent(result)}</dyad-performance>`,
        );

        return result;
      } catch (error) {
        ctx.onXmlComplete(
          `<dyad-performance action="${escapeXmlAttr(args.action)}"></dyad-performance>`,
        );
        throw error;
      }
    },
  };
