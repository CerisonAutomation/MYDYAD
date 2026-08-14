/**
 * Zenith Oracle MCP Configuration
 *
 * Optimal configuration for all 25 canonical Dyad XML tools
 * organized into 7 tiers of capability.
 */

// ============================================================================
// Tier Definitions
// ============================================================================

export const TIER_7_REASONING = ["sequential_thinking", "symbol_ops"] as const;

export const TIER_6_INTELLIGENCE = [
  "code_context",
  "context_optimize",
  "smart_context",
] as const;

export const TIER_5_ANALYSIS = [
  "code_smells",
  "complexity",
  "security_scan",
  "perf_audit",
  "dead_code",
  "test_gaps",
  "hotspots",
  "architecture_map",
] as const;

export const TIER_4_REVIEW = [
  "review_pr",
  "diff_impact",
  "action_plan",
  "test_plan",
] as const;

export const TIER_3_OPERATIONS = [
  "api_extract",
  "dep_audit",
  "license_check",
  "repo_pulse",
] as const;

export const TIER_2_INTEGRATION = [
  "onboarding_brief",
  "crawl4ai",
  "local_transcribe",
] as const;

export const TIER_1_CORE = [
  "writeFile",
  "searchReplace",
  "grep",
  "readFile",
  "listFiles",
  "gitStatus",
  "gitDiff",
  "gitLog",
  "webSearch",
  "webFetch",
  "runTests",
  "runTypeChecks",
] as const;

// ============================================================================
// Tool Configurations
// ============================================================================

export interface ToolConfig {
  name: string;
  tier: number;
  tokenBudget: number;
  requiresConsent: boolean;
  isReadOnly: boolean;
  parallelizable: string[];
  dependsOn: string[];
  description: string;
}

export const TOOL_CONFIGS: Record<string, ToolConfig> = {
  // Tier 7: Reasoning (God Mode)
  sequential_thinking: {
    name: "sequential_thinking",
    tier: 7,
    tokenBudget: 2000,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: [],
    dependsOn: [],
    description: "Multi-step reasoning with revision/branching",
  },
  symbol_ops: {
    name: "symbol_ops",
    tier: 7,
    tokenBudget: 1500,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: ["code_context"],
    dependsOn: [],
    description: "LSP-powered semantic symbol operations",
  },

  // Tier 6: Intelligence (Oracle)
  code_context: {
    name: "code_context",
    tier: 6,
    tokenBudget: 4000,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: ["symbol_ops"],
    dependsOn: [],
    description: "Semantic code search using local BM25/TF-IDF",
  },
  context_optimize: {
    name: "context_optimize",
    tier: 6,
    tokenBudget: 4000,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: [],
    dependsOn: ["code_context"],
    description: "Token-budgeted, goal-aware file ranking",
  },
  smart_context: {
    name: "smart_context",
    tier: 6,
    tokenBudget: 3000,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: [],
    dependsOn: ["context_optimize"],
    description: "Goal-aware file selection with heuristics",
  },

  // Tier 5: Analysis (Expert)
  code_smells: {
    name: "code_smells",
    tier: 5,
    tokenBudget: 2000,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: ["security_scan", "complexity", "dead_code", "test_gaps"],
    dependsOn: [],
    description: "20+ code smell detection with severity scores",
  },
  complexity: {
    name: "complexity",
    tier: 5,
    tokenBudget: 3000,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: ["code_smells", "security_scan"],
    dependsOn: [],
    description: "Cyclomatic + cognitive complexity analysis",
  },
  security_scan: {
    name: "security_scan",
    tier: 5,
    tokenBudget: 2000,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: ["code_smells", "complexity"],
    dependsOn: [],
    description: "SQL injection, XSS, secrets, vulnerabilities",
  },
  perf_audit: {
    name: "perf_audit",
    tier: 5,
    tokenBudget: 2500,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: ["security_scan", "dep_audit"],
    dependsOn: [],
    description: "N+1 queries, sync I/O, memory leaks",
  },
  dead_code: {
    name: "dead_code",
    tier: 5,
    tokenBudget: 2000,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: ["code_smells", "test_gaps"],
    dependsOn: [],
    description: "Unused exports, variables, imports",
  },
  test_gaps: {
    name: "test_gaps",
    tier: 5,
    tokenBudget: 2000,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: ["dead_code", "code_smells"],
    dependsOn: [],
    description: "Test coverage gaps detection",
  },
  hotspots: {
    name: "hotspots",
    tier: 5,
    tokenBudget: 1500,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: ["repo_pulse"],
    dependsOn: [],
    description: "PageRank + git churn hotspot detection",
  },
  architecture_map: {
    name: "architecture_map",
    tier: 5,
    tokenBudget: 3000,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: [],
    dependsOn: ["hotspots"],
    description: "Module dependency graph with Mermaid",
  },

  // Tier 4: Review (Master)
  review_pr: {
    name: "review_pr",
    tier: 4,
    tokenBudget: 6000,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: ["diff_impact"],
    dependsOn: [],
    description: "PR code review with findings",
  },
  diff_impact: {
    name: "diff_impact",
    tier: 4,
    tokenBudget: 4000,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: ["review_pr"],
    dependsOn: [],
    description: "Diff blast radius analysis",
  },
  action_plan: {
    name: "action_plan",
    tier: 4,
    tokenBudget: 3000,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: [],
    dependsOn: ["code_smells", "security_scan", "complexity"],
    description: "Prioritized fix plan",
  },
  test_plan: {
    name: "test_plan",
    tier: 4,
    tokenBudget: 4000,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: [],
    dependsOn: ["test_gaps"],
    description: "Test generation for untested code",
  },

  // Tier 3: Operations (Warrior)
  api_extract: {
    name: "api_extract",
    tier: 3,
    tokenBudget: 3000,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: ["dep_audit", "license_check"],
    dependsOn: [],
    description: "REST/GraphQL endpoint extraction",
  },
  dep_audit: {
    name: "dep_audit",
    tier: 3,
    tokenBudget: 2000,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: ["api_extract", "license_check"],
    dependsOn: [],
    description: "Dependency vulnerability audit",
  },
  license_check: {
    name: "license_check",
    tier: 3,
    tokenBudget: 1500,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: ["dep_audit", "api_extract"],
    dependsOn: [],
    description: "License compatibility check",
  },
  repo_pulse: {
    name: "repo_pulse",
    tier: 3,
    tokenBudget: 2000,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: ["hotspots"],
    dependsOn: [],
    description: "Project health metrics",
  },

  // Tier 2: Integration (Sage)
  onboarding_brief: {
    name: "onboarding_brief",
    tier: 2,
    tokenBudget: 3000,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: ["crawl4ai"],
    dependsOn: [],
    description: "Developer onboarding guide",
  },
  crawl4ai: {
    name: "crawl4ai",
    tier: 2,
    tokenBudget: 2000,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: ["onboarding_brief"],
    dependsOn: [],
    description: "Web → clean markdown for RAG",
  },
  local_transcribe: {
    name: "local_transcribe",
    tier: 2,
    tokenBudget: 1000,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: [],
    dependsOn: [],
    description: "Voice-to-text via provider API",
  },
  local_lazy_edits: {
    name: "local_lazy_edits",
    tier: 2,
    tokenBudget: 2000,
    requiresConsent: false,
    isReadOnly: true,
    parallelizable: [],
    dependsOn: [],
    description: "Optimize edits to search-replace diffs",
  },
};

// ============================================================================
// Preset Configurations
// ============================================================================

export const PRESETS = {
  quick_scan: {
    name: "Quick Scan",
    description: "Fast analysis with minimal token usage",
    tools: ["code_smells", "security_scan", "hotspots"],
    totalTokens: 5500,
    estimatedTime: "30 seconds",
  },
  deep_analysis: {
    name: "Deep Analysis",
    description: "Thorough codebase analysis",
    tools: [
      "code_smells",
      "complexity",
      "security_scan",
      "dead_code",
      "test_gaps",
      "perf_audit",
      "architecture_map",
      "dep_audit",
      "license_check",
    ],
    totalTokens: 19500,
    estimatedTime: "2 minutes",
  },
  production_readiness: {
    name: "Production Readiness",
    description: "Complete audit before deployment",
    tools: [
      "sequential_thinking",
      "code_smells",
      "complexity",
      "security_scan",
      "perf_audit",
      "test_gaps",
      "dep_audit",
      "license_check",
      "architecture_map",
      "repo_pulse",
      "action_plan",
    ],
    totalTokens: 25000,
    estimatedTime: "3 minutes",
  },
  code_review: {
    name: "Code Review",
    description: "Comprehensive PR review",
    tools: [
      "sequential_thinking",
      "code_smells",
      "security_scan",
      "complexity",
      "review_pr",
      "action_plan",
    ],
    totalTokens: 16500,
    estimatedTime: "1 minute",
  },
  refactoring: {
    name: "Refactoring",
    description: "Safe refactoring workflow",
    tools: [
      "sequential_thinking",
      "hotspots",
      "architecture_map",
      "dead_code",
      "complexity",
      "test_gaps",
      "diff_impact",
    ],
    totalTokens: 15500,
    estimatedTime: "1.5 minutes",
  },
  new_feature: {
    name: "New Feature",
    description: "Feature development workflow",
    tools: [
      "sequential_thinking",
      "onboarding_brief",
      "code_context",
      "smart_context",
      "symbol_ops",
      "api_extract",
      "test_plan",
    ],
    totalTokens: 18500,
    estimatedTime: "2 minutes",
  },
  debugging: {
    name: "Debugging",
    description: "Systematic bug investigation",
    tools: [
      "sequential_thinking",
      "repo_pulse",
      "diff_impact",
      "code_context",
      "perf_audit",
      "security_scan",
    ],
    totalTokens: 15000,
    estimatedTime: "1 minute",
  },
};

// ============================================================================
// Parallel Execution Groups
// ============================================================================

export const PARALLEL_GROUPS = {
  analysis: {
    name: "Analysis Group",
    tools: [
      "code_smells",
      "security_scan",
      "complexity",
      "dead_code",
      "test_gaps",
    ],
    maxConcurrent: 5,
  },
  operations: {
    name: "Operations Group",
    tools: ["api_extract", "dep_audit", "license_check", "repo_pulse"],
    maxConcurrent: 4,
  },
  review: {
    name: "Review Group",
    tools: ["review_pr", "diff_impact"],
    maxConcurrent: 2,
  },
  intelligence: {
    name: "Intelligence Group",
    tools: ["code_context", "symbol_ops"],
    maxConcurrent: 2,
  },
};

// ============================================================================
// Export Functions
// ============================================================================

export function getToolsByTier(tier: number): string[] {
  return Object.entries(TOOL_CONFIGS)
    .filter(([, config]) => config.tier === tier)
    .map(([name]) => name);
}

export function getToolsByPreset(preset: keyof typeof PRESETS): string[] {
  return PRESETS[preset]?.tools || [];
}

export function getToolConfig(toolName: string): ToolConfig | undefined {
  return TOOL_CONFIGS[toolName];
}

export function getParallelGroup(
  groupName: keyof typeof PARALLEL_GROUPS,
): string[] {
  return PARALLEL_GROUPS[groupName]?.tools || [];
}

export function estimateTokens(tools: string[]): number {
  return tools.reduce((sum, tool) => {
    const config = TOOL_CONFIGS[tool];
    return sum + (config?.tokenBudget || 2000);
  }, 0);
}

export function getOptimalSequence(goal: string): string[] {
  const goalLower = goal.toLowerCase();

  if (goalLower.includes("review") || goalLower.includes("pr")) {
    return PRESETS.code_review.tools;
  }
  if (goalLower.includes("refactor")) {
    return PRESETS.refactoring.tools;
  }
  if (goalLower.includes("debug") || goalLower.includes("fix")) {
    return PRESETS.debugging.tools;
  }
  if (goalLower.includes("feature") || goalLower.includes("add")) {
    return PRESETS.new_feature.tools;
  }
  if (goalLower.includes("audit") || goalLower.includes("production")) {
    return PRESETS.production_readiness.tools;
  }
  if (goalLower.includes("quick") || goalLower.includes("fast")) {
    return PRESETS.quick_scan.tools;
  }
  return PRESETS.deep_analysis.tools;
}
