/**
 * Browser Toolkit — Diagnostics
 *
 * Pre-built diagnostic bundles for common QA workflows.
 */

export interface DiagnosticBundle {
  name: string;
  description: string;
  tools: string[];
}

export const DIAGNOSTIC_BUNDLES: Record<string, DiagnosticBundle> = {
  "accessibility-quick": {
    name: "Accessibility Quick Check",
    description: "Fast accessibility scan — contrast, images, links, forms",
    tools: ["contrast", "images", "links", "ux"],
  },
  "full-audit": {
    name: "Full Page Audit",
    description: "Comprehensive audit — all diagnostic tools",
    tools: ["console", "network", "contrast", "images", "links", "ux", "visual"],
  },
  "performance": {
    name: "Performance Check",
    description: "Network analysis and visual diagnostics",
    tools: ["network", "visual"],
  },
  "seo-basics": {
    name: "SEO Basics",
    description: "Headings, links, images, and meta info",
    tools: ["links", "images", "ux", "visual"],
  },
  "form-audit": {
    name: "Form Audit",
    description: "Check all forms for labels, accessibility, and structure",
    tools: ["ux", "contrast"],
  },
  "visual-check": {
    name: "Visual Check",
    description: "Viewport, responsive, and layout diagnostics",
    tools: ["visual", "contrast"],
  },
};

export function getDiagnosticBundle(name: string): DiagnosticBundle | null {
  return DIAGNOSTIC_BUNDLES[name] || null;
}

export function listDiagnosticBundles(): DiagnosticBundle[] {
  return Object.values(DIAGNOSTIC_BUNDLES);
}
