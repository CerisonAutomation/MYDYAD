/**
 * Lock-in tests for the 2026-08-15 quality pass:
 * security_pentest precision, WCAG color contrast, diff_impact ref
 * validation, and complexity-aware code review scoring.
 */
import { describe, it, expect } from "vitest";
import { findFindingsInContent } from "./security_pentest";
import { contrastRatio } from "./color_contrast";
import { isValidGitRef } from "./diff_impact";
import { calculateScore } from "./code_review_bot";
import type { ReviewComment } from "./code_review_bot";

describe("security_pentest precision", () => {
  it("does NOT flag `../` relative imports as path traversal", () => {
    const source = `export * from "../../drizzle/schema";\nimport { router } from "../trpc";\n`;
    const findings = findFindingsInContent(source, "src/app/page.tsx");
    const traversal = findings.filter((f) => f.id === "PATH-TRAVERSAL");
    expect(traversal).toHaveLength(0);
  });

  it("does NOT flag static query strings as SQL injection", () => {
    const source = `db.query("SELECT * FROM users WHERE id = 1");\n`;
    const findings = findFindingsInContent(source, "src/lib/db.ts");
    expect(findings.filter((f) => f.id === "SQL-INJECTION")).toHaveLength(0);
  });

  it("flags interpolated query strings as SQL injection", () => {
    const source = "db.query(`SELECT * FROM users WHERE id = ${userId}`);";
    const findings = findFindingsInContent(source, "src/lib/db.ts");
    const sql = findings.filter((f) => f.id === "SQL-INJECTION");
    expect(sql).toHaveLength(1);
    expect(sql[0].severity).toBe("high");
  });

  it("does NOT flag static innerHTML assignments as XSS", () => {
    const source = 'el.innerHTML = "<b>static</b>";';
    const findings = findFindingsInContent(source, "src/components/x.tsx");
    expect(findings.filter((f) => f.id === "XSS-REFLECTED")).toHaveLength(0);
  });

  it("flags innerHTML assigned from a variable", () => {
    const source = "el.innerHTML = userInput;";
    const findings = findFindingsInContent(source, "src/components/x.tsx");
    expect(findings.filter((f) => f.id === "XSS-REFLECTED")).toHaveLength(1);
  });

  it("flags hardcoded secrets but downgrades test files", () => {
    const source = 'const API_KEY = "sk-super-secret-value-123";';
    const real = findFindingsInContent(source, "src/lib/client.ts");
    const test = findFindingsInContent(source, "src/lib/client.test.ts", true);
    expect(real.filter((f) => f.id === "HARDCODED-SECRET")[0].severity).toBe(
      "critical",
    );
    expect(test.filter((f) => f.id === "HARDCODED-SECRET")[0].severity).toBe(
      "critical", // critical stays critical even in tests
    );
  });

  it("dedupes: one finding per (check, file) even with many matches", () => {
    const source = Array.from(
      { length: 20 },
      () => "const x = Math.random();",
    ).join("\n");
    const findings = findFindingsInContent(source, "src/lib/rand.ts");
    expect(findings.filter((f) => f.id === "INSECURE-RANDOM")).toHaveLength(1);
  });
});

describe("color_contrast WCAG ratios", () => {
  it("black on white ≈ 21:1 (passes AA + AAA)", () => {
    const ratio = contrastRatio("#000000", "#ffffff");
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThan(20.9);
    expect(ratio!).toBeGreaterThanOrEqual(7); // AAA
  });

  it("#777 on #fff fails AA for normal text (4.5:1)", () => {
    const ratio = contrastRatio("#777777", "#ffffff");
    expect(ratio!).toBeLessThan(4.5);
    expect(ratio!).toBeGreaterThanOrEqual(3); // passes large-text AA
  });

  it("#999 on #fff fails AA for normal text", () => {
    const ratio = contrastRatio("#999999", "#ffffff");
    expect(ratio!).toBeLessThan(4.5);
    expect(ratio!).toBeGreaterThan(2.8);
  });

  it("accepts rgb() and named colors", () => {
    expect(contrastRatio("rgb(0, 0, 0)", "white")).toBeGreaterThan(20.9);
  });

  it("returns null for unparseable colors", () => {
    expect(contrastRatio("var(--fg)", "#fff")).toBeNull();
  });
});

describe("diff_impact ref validation", () => {
  it("accepts its own documented default HEAD~1", () => {
    expect(isValidGitRef("HEAD~1")).toBe(true);
  });
  it("accepts common rev syntax", () => {
    expect(isValidGitRef("HEAD^")).toBe(true);
    expect(isValidGitRef("main")).toBe(true);
    expect(isValidGitRef("8c5f89998543e91c82482433364329333c670ce5")).toBe(
      true,
    );
    expect(isValidGitRef("origin/feature-branch~3")).toBe(true);
  });
  it("rejects injection attempts", () => {
    expect(isValidGitRef("HEAD; rm -rf /")).toBe(false);
    expect(isValidGitRef("$(whoami)")).toBe(false);
    expect(isValidGitRef("--help")).toBe(true); // harmless single argv element
  });
});

describe("code_review_bot complexity-aware scoring", () => {
  const comment = (severity: ReviewComment["severity"]): ReviewComment => ({
    line: 1,
    severity,
    category: "readability",
    message: "x",
    suggestion: "y",
  });

  it("starts at 100 for a clean short file", () => {
    expect(calculateScore([], { lineCount: 40 })).toBe(100);
  });

  it("deducts for long files", () => {
    expect(calculateScore([], { lineCount: 600 })).toBe(95);
    expect(calculateScore([], { lineCount: 1200 })).toBe(90);
  });

  it("deducts extra for complexity comments", () => {
    const complexity: ReviewComment = {
      line: 5,
      severity: "warning",
      category: "complexity",
      message: "Deep nesting",
      suggestion: "Extract",
    };
    expect(calculateScore([complexity], { lineCount: 50 })).toBe(93);
  });

  it("a 1000-line high-complexity file can never score 100", () => {
    const score = calculateScore([comment("error"), comment("warning")], {
      lineCount: 1100,
    });
    expect(score).toBeLessThan(85);
  });
});
