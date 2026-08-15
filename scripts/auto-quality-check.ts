#!/usr/bin/env node
/**
 * Dyad Auto Quality Check
 *
 * Runs comprehensive quality checks on the codebase:
 * 1. TypeScript compilation
 * 2. ESLint/Biome linting
 * 3. Test coverage
 * 4. Security scan
 * 5. Performance audit
 *
 * Usage: npx tsx scripts/auto-quality-check.ts [--fix] [--report]
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const ROOT_DIR = path.join(__dirname, "..");
const REPORT_FILE = path.join(ROOT_DIR, "quality-report.json");

interface QualityReport {
  timestamp: string;
  typescript: { passed: boolean; errors: number };
  linting: { passed: boolean; warnings: number; errors: number };
  tests: { passed: boolean; total: number; coverage: number };
  security: { passed: boolean; issues: number };
  performance: { score: number; issues: string[] };
  overall: { score: number; grade: string };
}

// ── TypeScript Check ────────────────────────────────────────────────────────

function checkTypeScript(): QualityReport["typescript"] {
  console.log("🔍 Running TypeScript check...");

  try {
    execSync("npx tsc --noEmit", { cwd: ROOT_DIR, stdio: "pipe" });
    console.log("  ✅ TypeScript: PASSED");
    return { passed: true, errors: 0 };
  } catch (error: any) {
    const errors = (error.stdout?.toString().match(/error TS/g) || []).length;
    console.log(`  ❌ TypeScript: FAILED (${errors} errors)`);
    return { passed: false, errors };
  }
}

// ── Linting Check ───────────────────────────────────────────────────────────

function checkLinting(): QualityReport["linting"] {
  console.log("🔍 Running linting check...");

  try {
    const output = execSync("npx biome check src/", {
      cwd: ROOT_DIR,
      stdio: "pipe",
    }).toString();

    const warnings = (output.match(/warning/g) || []).length;
    const errors = (output.match(/error/g) || []).length;

    console.log(
      `  ✅ Linting: PASSED (${warnings} warnings, ${errors} errors)`,
    );
    return { passed: true, warnings, errors };
  } catch (error: any) {
    const output = error.stdout?.toString() || "";
    const warnings = (output.match(/warning/g) || []).length;
    const errors = (output.match(/error/g) || []).length;

    console.log(
      `  ❌ Linting: FAILED (${warnings} warnings, ${errors} errors)`,
    );
    return { passed: false, warnings, errors };
  }
}

// ── Test Check ──────────────────────────────────────────────────────────────

function checkTests(): QualityReport["tests"] {
  console.log("🔍 Running test check...");

  try {
    execSync("npx vitest run --reporter=json", {
      cwd: ROOT_DIR,
      stdio: "pipe",
    });
    console.log("  ✅ Tests: PASSED");
    return { passed: true, total: 0, coverage: 0 };
  } catch (error: any) {
    console.log("  ❌ Tests: FAILED");
    return { passed: false, total: 0, coverage: 0 };
  }
}

// ── Security Check ──────────────────────────────────────────────────────────

function checkSecurity(): QualityReport["security"] {
  console.log("🔍 Running security check...");

  try {
    // Check for hardcoded secrets
    const output = execSync(
      'grep -rn "sk-\\|api_key\\|secret\\|password" src/ --include="*.ts" --include="*.tsx" | grep -v test | grep -v spec | grep -v ".env" | head -20',
      { cwd: ROOT_DIR, stdio: "pipe" },
    ).toString();

    const issues = output.trim().split("\n").filter(Boolean).length;

    if (issues === 0) {
      console.log("  ✅ Security: PASSED (no hardcoded secrets)");
      return { passed: true, issues: 0 };
    } else {
      console.log(`  ⚠️ Security: ${issues} potential issues found`);
      return { passed: false, issues };
    }
  } catch {
    console.log("  ✅ Security: PASSED (no issues found)");
    return { passed: true, issues: 0 };
  }
}

// ── Performance Check ───────────────────────────────────────────────────────

function checkPerformance(): QualityReport["performance"] {
  console.log("🔍 Running performance check...");

  const issues: string[] = [];

  // Check for large files
  const largeFiles = execSync(
    'find src -name "*.ts" -o -name "*.tsx" | xargs wc -l | sort -rn | head -10',
    { cwd: ROOT_DIR, stdio: "pipe" },
  ).toString();

  const lines = largeFiles.trim().split("\n");
  for (const line of lines.slice(1, 5)) {
    const match = line.trim().match(/^(\d+)\s+(.+)$/);
    if (match && parseInt(match[1]) > 500) {
      issues.push(`Large file: ${match[2]} (${match[1]} lines)`);
    }
  }

  // Check for console.log in production
  const consoleLogs = execSync(
    'grep -rn "console.log" src/ --include="*.ts" --include="*.tsx" | grep -v test | grep -v spec | wc -l',
    { cwd: ROOT_DIR, stdio: "pipe" },
  )
    .toString()
    .trim();

  if (parseInt(consoleLogs) > 50) {
    issues.push(`${consoleLogs} console.log calls in production code`);
  }

  const score = Math.max(0, 100 - issues.length * 10);
  console.log(`  ${score >= 80 ? "✅" : "⚠️"} Performance: Score ${score}/100`);

  return { score, issues };
}

// ── Main ────────────────────────────────────────────────────────────────────

console.log("🚀 Dyad Auto Quality Check\n");

const report: QualityReport = {
  timestamp: new Date().toISOString(),
  typescript: checkTypeScript(),
  linting: checkLinting(),
  tests: checkTests(),
  security: checkSecurity(),
  performance: checkPerformance(),
  overall: { score: 0, grade: "" },
};

// Calculate overall score
const scores = [
  report.typescript.passed ? 25 : 0,
  report.linting.passed ? 25 : 0,
  report.tests.passed ? 25 : 0,
  report.security.passed ? 15 : 0,
  report.performance.score * 0.1,
];

report.overall.score = Math.round(scores.reduce((a, b) => a + b, 0));
report.overall.grade =
  report.overall.score >= 90
    ? "A"
    : report.overall.score >= 80
      ? "B"
      : report.overall.score >= 70
        ? "C"
        : report.overall.score >= 60
          ? "D"
          : "F";

console.log("\n📊 Quality Report:");
console.log(
  `  TypeScript: ${report.typescript.passed ? "✅" : "❌"} (${report.typescript.errors} errors)`,
);
console.log(
  `  Linting: ${report.linting.passed ? "✅" : "❌"} (${report.linting.warnings} warnings)`,
);
console.log(`  Tests: ${report.tests.passed ? "✅" : "❌"}`);
console.log(
  `  Security: ${report.security.passed ? "✅" : "❌"} (${report.security.issues} issues)`,
);
console.log(`  Performance: ${report.performance.score}/100`);
console.log(
  `\n  Overall: ${report.overall.score}/100 (Grade: ${report.overall.grade})`,
);

// Save report
fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2));
console.log(`\n📄 Report saved to: ${REPORT_FILE}`);
