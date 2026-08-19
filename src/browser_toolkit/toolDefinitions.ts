/**
 * Consolidated Browser Tools — Tool Definitions
 *
 * Merged from Claude Code, Comet, and ZCode into 22 unified tools.
 * Based on the audit in comet-browser/COMPARISON.md.
 *
 * These definitions follow MCP-compatible schema format.
 */

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
  default?: unknown;
  required?: boolean;
}

export interface ToolDefinition {
  name: string;
  category: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, ToolParameter>;
    required?: string[];
  };
}

export const TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  // ─────────────────────────────────────────────────────────────────────
  // Navigation
  // ─────────────────────────────────────────────────────────────────────
  navigate: {
    name: "navigate",
    category: "navigation",
    description:
      "Navigate to a URL or go back/forward in history. Supports waitUntil for load states.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "URL to navigate to. Use 'back' or 'forward' for history navigation.",
        },
        waitUntil: {
          type: "string",
          enum: ["load", "domcontentloaded", "networkidle"],
          default: "load",
          description: "Wait for this load state before returning.",
        },
      },
      required: ["url"],
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // Reading & Content
  // ─────────────────────────────────────────────────────────────────────
  read_page: {
    name: "read_page",
    category: "reading",
    description:
      "Read page content. Returns text, links, images, and headings.",
    inputSchema: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["text", "links", "images", "headings", "all"],
          default: "all",
          description: "What content to extract.",
        },
        maxChars: {
          type: "number",
          default: 50000,
          description: "Maximum characters for text content.",
        },
      },
    },
  },

  find: {
    name: "find",
    category: "reading",
    description:
      "Find elements using text search. Returns element info with bounding box.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Text to search for in the page.",
        },
        all: {
          type: "boolean",
          default: false,
          description: "Return all matches (up to 20) instead of just the first.",
        },
      },
      required: ["query"],
    },
  },

  get_page_text: {
    name: "get_page_text",
    category: "reading",
    description: "Extract plain text from the page, prioritizing article content.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "Optional CSS selector to extract text from specific element.",
        },
      },
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // Mouse/Keyboard Automation
  // ─────────────────────────────────────────────────────────────────────
  computer: {
    name: "computer",
    category: "automation",
    description:
      "Mouse/keyboard automation. Supports click, type, scroll, and more.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: [
            "left_click",
            "right_click",
            "double_click",
            "triple_click",
            "type",
            "key",
            "screenshot",
            "scroll",
            "scroll_to",
            "hover",
            "middle_click",
          ],
          description: "Action to perform.",
        },
        selector: {
          type: "string",
          description:
            "CSS selector or text to find element. Required for click/type actions.",
        },
        text: {
          type: "string",
          description: "Text to type (for 'type' action).",
        },
        key: {
          type: "string",
          description: "Key to press (for 'key' action). E.g., 'Enter', 'Tab', 'Escape'.",
        },
        x: {
          type: "number",
          description: "X coordinate for coordinate-based actions.",
        },
        y: {
          type: "number",
          description: "Y coordinate for coordinate-based actions.",
        },
        direction: {
          type: "string",
          enum: ["up", "down"],
          description: "Scroll direction (for 'scroll' action).",
        },
        amount: {
          type: "number",
          default: 3,
          description: "Scroll amount in notches.",
        },
      },
      required: ["action"],
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // Form Interaction
  // ─────────────────────────────────────────────────────────────────────
  form_input: {
    name: "form_input",
    category: "forms",
    description: "Set a form field value by selector.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for the input element.",
        },
        value: {
          type: "string",
          description: "Value to set.",
        },
      },
      required: ["selector", "value"],
    },
  },

  fill_form: {
    name: "fill_form",
    category: "forms",
    description: "Fill an entire form with multiple values at once.",
    inputSchema: {
      type: "object",
      properties: {
        formSelector: {
          type: "string",
          description: "CSS selector for the form element.",
        },
        values: {
          type: "object",
          description: "Map of field names to values.",
        },
      },
      required: ["formSelector", "values"],
    },
  },

  submit_form: {
    name: "submit_form",
    category: "forms",
    description: "Submit a form by selector.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for the form element.",
        },
      },
      required: ["selector"],
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // Tab Management
  // ─────────────────────────────────────────────────────────────────────
  tabs: {
    name: "tabs",
    category: "tabs",
    description: "List all open tabs.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  open_tab: {
    name: "open_tab",
    category: "tabs",
    description: "Open a new tab with a URL.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to open.",
        },
      },
      required: ["url"],
    },
  },

  close_tab: {
    name: "close_tab",
    category: "tabs",
    description: "Close a tab by ID.",
    inputSchema: {
      type: "object",
      properties: {
        tabId: {
          type: "number",
          description: "Tab ID to close.",
        },
      },
      required: ["tabId"],
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // Element Inspection
  // ─────────────────────────────────────────────────────────────────────
  inspect: {
    name: "inspect",
    category: "inspection",
    description: "Inspect an element's attributes, styles, and bounding box.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector for the element.",
        },
      },
      required: ["selector"],
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // Diagnostics
  // ─────────────────────────────────────────────────────────────────────
  console_messages: {
    name: "console_messages",
    category: "diagnostics",
    description: "Get console messages from the page.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  network_analysis: {
    name: "network_analysis",
    category: "diagnostics",
    description: "Analyze network requests made by the page.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  contrast_check: {
    name: "contrast_check",
    category: "diagnostics",
    description: "Check color contrast ratios for accessibility.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  image_audit: {
    name: "image_audit",
    category: "diagnostics",
    description: "Audit images for alt text, format, and accessibility.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  link_check: {
    name: "link_check",
    category: "diagnostics",
    description: "Check all links on the page for validity.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  ux_audit: {
    name: "ux_audit",
    category: "diagnostics",
    description: "Run a UX audit checking forms, links, headings, and accessibility.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  visual_diagnosis: {
    name: "visual_diagnosis",
    category: "diagnostics",
    description: "Visual diagnosis of page layout, viewport, and responsive design.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  // ─────────────────────────────────────────────────────────────────────
  // Batch Operations
  // ─────────────────────────────────────────────────────────────────────
  browser_batch: {
    name: "browser_batch",
    category: "batch",
    description:
      "Execute multiple browser actions sequentially with error handling.",
    inputSchema: {
      type: "object",
      properties: {
        actions: {
          type: "array",
          description: "Array of action objects to execute sequentially.",
        },
        stopOnError: {
          type: "boolean",
          default: true,
          description: "Stop execution if an action fails.",
        },
      },
      required: ["actions"],
    },
  },
};

// ─────────────────────────────────────────────────────────────────────
// Tool Categories
// ─────────────────────────────────────────────────────────────────────

export const TOOL_CATEGORIES = {
  navigation: {
    label: "Navigation",
    tools: ["navigate"],
  },
  reading: {
    label: "Reading & Content",
    tools: ["read_page", "find", "get_page_text"],
  },
  automation: {
    label: "Mouse/Keyboard",
    tools: ["computer"],
  },
  forms: {
    label: "Form Interaction",
    tools: ["form_input", "fill_form", "submit_form"],
  },
  tabs: {
    label: "Tab Management",
    tools: ["tabs", "open_tab", "close_tab"],
  },
  inspection: {
    label: "Element Inspection",
    tools: ["inspect"],
  },
  diagnostics: {
    label: "Diagnostics",
    tools: [
      "console_messages",
      "network_analysis",
      "contrast_check",
      "image_audit",
      "link_check",
      "ux_audit",
      "visual_diagnosis",
    ],
  },
  batch: {
    label: "Batch Operations",
    tools: ["browser_batch"],
  },
};

// ─────────────────────────────────────────────────────────────────────
// Source Attribution
// ─────────────────────────────────────────────────────────────────────

export const TOOL_SOURCES = {
  navigate: "Claude Code + ZCode",
  read_page: "Claude Code + Comet + ZCode",
  find: "Claude Code + ZCode",
  get_page_text: "Claude Code + Comet + ZCode",
  computer: "Claude Code + Comet + ZCode",
  form_input: "Claude Code + ZCode",
  fill_form: "ZCode",
  submit_form: "ZCode",
  tabs: "Claude Code + Comet + ZCode",
  open_tab: "Claude Code + ZCode",
  close_tab: "Claude Code + ZCode",
  inspect: "ZCode",
  console_messages: "ZCode",
  network_analysis: "ZCode",
  contrast_check: "ZCode",
  image_audit: "ZCode",
  link_check: "ZCode",
  ux_audit: "ZCode",
  visual_diagnosis: "ZCode",
  browser_batch: "Claude Code + Comet",
};
