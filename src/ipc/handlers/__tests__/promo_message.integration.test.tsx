import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PromoMessage } from "@/components/chat/PromoMessage";

describe("promo message (integration)", () => {
  it("PromoMessage renders nothing when disabled", () => {
    const { container } = render(<PromoMessage seed={42} />);
    expect(container.innerHTML).toBe("");
  });
});
