import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  extractImageMarkersFromStep,
  loadImagesFromMarkers,
} from "./local_agent_handler";
import type { AgentContext } from "./tools/types";

// 1x1 transparent PNG
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function makeContext(appPath: string): AgentContext {
  return {
    appPath,
    referencedApps: new Map(),
  } as unknown as AgentContext;
}

describe("extractImageMarkersFromStep", () => {
  it("extracts [Image: ...] markers from string tool outputs", () => {
    const markers = extractImageMarkersFromStep({
      toolResults: [
        { output: "Screenshot saved to: .dyad/screenshot/a.png" },
        { output: "[Image: .dyad/screenshot/a.png]" },
        { output: "[Image: attachments:pic.png] and [Image: shot2.png]" },
        { output: 42 }, // non-string output is skipped
        { output: "[Image: x.png (in app: Other)]" },
      ],
    });
    expect(markers).toEqual([
      ".dyad/screenshot/a.png",
      "attachments:pic.png",
      "shot2.png",
      "x.png (in app: Other)",
    ]);
  });

  it("returns [] when no markers exist", () => {
    expect(extractImageMarkersFromStep({ toolResults: [] })).toEqual([]);
    expect(extractImageMarkersFromStep({})).toEqual([]);
  });
});

describe("loadImagesFromMarkers", () => {
  let testDir: string;
  let ctx: AgentContext;

  beforeEach(async () => {
    testDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "img-inject-test-"),
    );
    await fs.promises.mkdir(path.join(testDir, ".dyad", "screenshot"), {
      recursive: true,
    });
    await fs.promises.writeFile(
      path.join(testDir, ".dyad", "screenshot", "shot.png"),
      PNG_BYTES,
    );
    ctx = makeContext(testDir);
  });

  afterEach(async () => {
    await fs.promises.rm(testDir, { recursive: true, force: true });
  });

  it("loads a png marker into an image-url data URL part", async () => {
    const parts = await loadImagesFromMarkers(
      [".dyad/screenshot/shot.png"],
      ctx,
    );
    expect(parts).toHaveLength(1);
    expect(parts[0].type).toBe("image-url");
    expect(parts[0].url.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("dedupes repeated markers for the same file", async () => {
    const parts = await loadImagesFromMarkers(
      [".dyad/screenshot/shot.png", ".dyad/screenshot/shot.png"],
      ctx,
    );
    expect(parts).toHaveLength(1);
  });

  it("skips missing files and non-image files", async () => {
    const parts = await loadImagesFromMarkers(
      [".dyad/screenshot/missing.png", "README.txt"],
      ctx,
    );
    expect(parts).toHaveLength(0);
  });

  it("caps the number of injected images", async () => {
    for (let i = 0; i < 6; i += 1) {
      await fs.promises.writeFile(
        path.join(testDir, ".dyad", "screenshot", `s${i}.png`),
        PNG_BYTES,
      );
    }
    const parts = await loadImagesFromMarkers(
      Array.from({ length: 6 }, (_, i) => `.dyad/screenshot/s${i}.png`),
      ctx,
    );
    expect(parts.length).toBeLessThanOrEqual(4);
  });

  it("resolves cross-app markers via referencedApps", async () => {
    const otherDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), "img-inject-other-"),
    );
    await fs.promises.writeFile(path.join(otherDir, "shot.png"), PNG_BYTES);
    const ctx2 = makeContext(testDir);
    ctx2.referencedApps.set("other", otherDir);
    const parts = await loadImagesFromMarkers(
      ["shot.png (in app: Other)"],
      ctx2,
    );
    expect(parts).toHaveLength(1);
    await fs.promises.rm(otherDir, { recursive: true, force: true });
  });
});
