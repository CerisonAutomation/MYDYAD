import { describe, it, expect } from "vitest";
import { isPrivateIp, assertNotPrivateIp } from "./network_utils";

describe("isPrivateIp", () => {
  // Blocked addresses
  it.each([
    "localhost",
    "0.0.0.0",
    "127.0.0.1",
    "10.0.0.1",
    "10.255.255.255",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254", // cloud metadata
    "::1",
    "fe80::1",
    "fc00::1",
    "fd00::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:192.168.1.1",
  ])("blocks %s", (host) => {
    expect(isPrivateIp(host)).toBe(true);
  });

  // Allowed addresses
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "93.184.216.34",
    "example.com",
    "google.com",
    "2001:4860:4860::8888",
    "2606:4700:4700::1111",
  ])("allows %s", (host) => {
    expect(isPrivateIp(host)).toBe(false);
  });

  it("blocks empty string", () => {
    expect(isPrivateIp("")).toBe(true);
  });
});

describe("assertNotPrivateIp", () => {
  it("throws DyadError for private URLs", () => {
    expect(() => assertNotPrivateIp("http://localhost:3000/api")).toThrow(
      "not allowed",
    );
  });

  it("throws DyadError for cloud metadata URLs", () => {
    expect(() =>
      assertNotPrivateIp("http://169.254.169.254/latest/meta-data/"),
    ).toThrow("not allowed");
  });

  it("throws DyadError for invalid URLs", () => {
    expect(() => assertNotPrivateIp("not-a-url")).toThrow("Invalid URL");
  });

  it("does not throw for public URLs", () => {
    expect(() => assertNotPrivateIp("https://example.com")).not.toThrow();
  });
});
