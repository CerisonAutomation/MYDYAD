import { describe, expect, it } from "vitest";
import { PromoMessage, usePromoMessage } from "./PromoMessage";

describe("PromoMessage", () => {
  it("usePromoMessage always returns not visible", () => {
    const result = usePromoMessage(1);
    expect(result.visible).toBe(false);
    expect(result.seed).toBe(0);
  });

  it("PromoMessage renders null", () => {
    // PromoMessage is disabled - component returns null
    // Just verify it doesn't throw
    const element = PromoMessage({ seed: 42 });
    expect(element).toBeNull();
  });
});
