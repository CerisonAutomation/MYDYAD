import { PromoMessage } from "@/components/chat/PromoMessage";
import { render, } from "@testing-library/react";
import { describe, expect, it } from "vitest";

describe("promo message (integration)", () => {
  it("PromoMessage renders nothing when disabled", () => {
    const { container } = render(<PromoMessage seed={42} />);
    expect(container.innerHTML).toBe("");
  });
});
