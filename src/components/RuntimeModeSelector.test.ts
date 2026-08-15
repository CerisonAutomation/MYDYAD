import { describe, expect, it } from "vitest";
import { shouldShowCloudSandboxOption } from "./RuntimeModeSelector";

describe("shouldShowCloudSandboxOption", () => {
  it("always returns false — cloud sandbox removed", () => {
    expect(
      shouldShowCloudSandboxOption({
        runtimeMode: "host",
        cloudSandboxExperimentEnabled: false,
      }),
    ).toBe(false);
  });

  it("returns false even when experiment is enabled", () => {
    expect(
      shouldShowCloudSandboxOption({
        runtimeMode: "host",
        cloudSandboxExperimentEnabled: true,
      }),
    ).toBe(false);
  });
});
