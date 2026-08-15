/**
 * DOM Manipulator Tool — Game-Changing Feature
 *
 * Provides direct DOM manipulation capabilities with:
 * - CSS injection and style modification
 * - Element creation and removal
 * - Attribute manipulation
 * - Event simulation
 * - Layout debugging (box model, grid, flexbox)
 * - Accessibility tree inspection
 * - Performance profiling
 */

import { z } from "zod";
import log from "electron-log";
import {
  ToolDefinition,
  AgentContext,
  escapeXmlAttr,
  escapeXmlContent,
} from "../types";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getPage } from "../browser_session";

const logger = log.scope("dom_manipulator");

// ============================================================================
// Schema — All possible DOM operations
// ============================================================================

const injectStyleAction = z.object({
  action: z.literal("inject_style"),
  css: z.string().describe("CSS rules to inject"),
  selector: z
    .string()
    .optional()
    .describe("Optional: scope CSS to this selector"),
});

const modifyElementAction = z.object({
  action: z.literal("modify_element"),
  selector: z.string().describe("CSS selector for target element"),
  attributes: z
    .record(z.string(), z.string())
    .optional()
    .describe("Attributes to set/remove (prefix with - to remove)"),
  styles: z
    .record(z.string(), z.string())
    .optional()
    .describe("Inline styles to apply"),
  text: z.string().optional().describe("Set text content"),
  html: z.string().optional().describe("Set innerHTML (use carefully)"),
});

const createElementAction = z.object({
  action: z.literal("create_element"),
  tag: z.string().describe("HTML tag name"),
  attributes: z
    .record(z.string(), z.string())
    .optional()
    .describe("Element attributes"),
  styles: z.record(z.string(), z.string()).optional().describe("Inline styles"),
  text: z.string().optional().describe("Text content"),
  parent_selector: z
    .string()
    .optional()
    .describe("Parent element selector (default: document.body)"),
  position: z
    .enum(["before", "after", "prepend", "append"])
    .optional()
    .describe("Insertion position (default: append)"),
  reference_selector: z
    .string()
    .optional()
    .describe("Reference element for before/after positions"),
});

const removeElementAction = z.object({
  action: z.literal("remove_element"),
  selector: z.string().describe("CSS selector for element to remove"),
});

const simulateEventAction = z.object({
  action: z.literal("simulate_event"),
  selector: z.string().describe("CSS selector for target element"),
  event_type: z
    .enum([
      "click",
      "dblclick",
      "mousedown",
      "mouseup",
      "mousemove",
      "mouseenter",
      "mouseleave",
      "keydown",
      "keyup",
      "keypress",
      "focus",
      "blur",
      "input",
      "change",
      "submit",
    ])
    .describe("Event type to simulate"),
  event_data: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Additional event data"),
});

const analyzeLayoutAction = z.object({
  action: z.literal("analyze_layout"),
  selector: z.string().describe("CSS selector for element to analyze"),
  show_grid: z
    .boolean()
    .optional()
    .describe("Show grid overlay (for grid containers)"),
  show_flexbox: z.boolean().optional().describe("Show flexbox overlay"),
  show_box_model: z
    .boolean()
    .optional()
    .describe("Show box model visualization"),
});

const inspectAccessibilityAction = z.object({
  action: z.literal("inspect_accessibility"),
  selector: z
    .string()
    .optional()
    .describe("Optional: scope to specific element"),
  include_aria: z
    .boolean()
    .optional()
    .describe("Include ARIA attributes in output"),
});

const profilePerformanceAction = z.object({
  action: z.literal("profile_performance"),
  selector: z
    .string()
    .optional()
    .describe("Optional: scope to specific element"),
});

const querySelectorAllAction = z.object({
  action: z.literal("query_selector_all"),
  selector: z.string().describe("CSS selector to query"),
  attributes: z.array(z.string()).optional().describe("Attributes to extract"),
});

const getXPathAction = z.object({
  action: z.literal("get_xpath"),
  selector: z.string().describe("CSS selector"),
});

const getComputedStylesAction = z.object({
  action: z.literal("get_computed_styles"),
  selector: z.string().describe("CSS selector"),
  properties: z
    .array(z.string())
    .optional()
    .describe("Specific properties (default: all visible)"),
});

const domManipulatorSchema = z.discriminatedUnion("action", [
  injectStyleAction,
  modifyElementAction,
  createElementAction,
  removeElementAction,
  simulateEventAction,
  analyzeLayoutAction,
  inspectAccessibilityAction,
  profilePerformanceAction,
  querySelectorAllAction,
  getXPathAction,
  getComputedStylesAction,
]);

// ============================================================================
// Action Executors
// ============================================================================

async function executeInjectStyle(
  page: any,
  args: z.infer<typeof injectStyleAction>,
): Promise<string> {
  const { css, selector } = args;

  await page.evaluate(
    ({ css, selector }: { css: string; selector?: string }) => {
      const style = document.createElement("style");
      style.setAttribute("data-dyad-injected", "true");
      style.textContent = selector ? `${selector} { ${css} }` : css;
      document.head.appendChild(style);
    },
    { css, selector },
  );

  return `Injected ${css.length} chars of CSS${selector ? ` scoped to ${selector}` : " globally"}`;
}

async function executeModifyElement(
  page: any,
  args: z.infer<typeof modifyElementAction>,
): Promise<string> {
  const { selector, attributes, styles, text, html } = args;

  const result = await page.evaluate(
    ({
      selector,
      attributes,
      styles,
      text,
      html,
    }: {
      selector: string;
      attributes?: Record<string, string>;
      styles?: Record<string, string>;
      text?: string;
      html?: string;
    }) => {
      const element = document.querySelector(selector);
      if (!element) return { error: `No element found: ${selector}` };

      // Apply attributes
      if (attributes) {
        for (const [key, value] of Object.entries(attributes)) {
          if (key.startsWith("-")) {
            element.removeAttribute(key.slice(1));
          } else {
            element.setAttribute(key, value);
          }
        }
      }

      // Apply styles
      if (styles) {
        for (const [property, value] of Object.entries(styles)) {
          (element as HTMLElement).style.setProperty(property, value);
        }
      }

      // Apply text
      if (text !== undefined) {
        element.textContent = text;
      }

      // Apply HTML (careful!)
      if (html !== undefined) {
        element.innerHTML = html;
      }

      return { success: true, tag: element.tagName.toLowerCase() };
    },
    { selector, attributes, styles, text, html },
  );

  if (result.error) throw new DyadError(result.error, DyadErrorKind.NotFound);
  return `Modified <${result.tag}> at ${selector}`;
}

async function executeCreateElement(
  page: any,
  args: z.infer<typeof createElementAction>,
): Promise<string> {
  const {
    tag,
    attributes,
    styles,
    text,
    parent_selector,
    position,
    reference_selector,
  } = args;

  const result = await page.evaluate(
    ({
      tag,
      attributes,
      styles,
      text,
      parent_selector,
      position,
      reference_selector,
    }: {
      tag: string;
      attributes?: Record<string, string>;
      styles?: Record<string, string>;
      text?: string;
      parent_selector?: string;
      position?: string;
      reference_selector?: string;
    }) => {
      const parent = parent_selector
        ? document.querySelector(parent_selector)
        : document.body;
      if (!parent) return { error: `No parent found: ${parent_selector}` };

      const element = document.createElement(tag);

      // Apply attributes
      if (attributes) {
        for (const [key, value] of Object.entries(attributes)) {
          element.setAttribute(key, value);
        }
      }

      // Apply styles
      if (styles) {
        for (const [property, value] of Object.entries(styles)) {
          (element as HTMLElement).style.setProperty(property, value);
        }
      }

      // Apply text
      if (text !== undefined) {
        element.textContent = text;
        n;
      }

      // Insert element
      if (position && reference_selector) {
        const ref = document.querySelector(reference_selector);
        if (ref) {
          switch (position) {
            case "before":
              ref.parentNode?.insertBefore(element, ref);
              break;
            case "after":
              ref.parentNode?.insertBefore(element, ref.nextSibling);
              break;
            case "prepend":
              ref.insertBefore(element, ref.firstChild);
              break;
            case "append":
              ref.appendChild(element);
              break;
          }
        } else {
          parent.appendChild(element);
        }
      } else {
        parent.appendChild(element);
      }

      return { success: true, tag: element.tagName.toLowerCase() };
    },
    {
      tag,
      attributes,
      styles,
      text,
      parent_selector,
      position,
      reference_selector,
    },
  );

  if (result.error) throw new DyadError(result.error, DyadErrorKind.NotFound);
  return `Created <${tag}> element`;
}

async function executeRemoveElement(
  page: any,
  args: z.infer<typeof removeElementAction>,
): Promise<string> {
  const { selector } = args;

  const result = await page.evaluate((selector: string) => {
    const element = document.querySelector(selector);
    if (!element) return { error: `No element found: ${selector}` };
    const tag = element.tagName.toLowerCase();
    element.remove();
    return { success: true, tag };
  }, selector);

  if (result.error) throw new DyadError(result.error, DyadErrorKind.NotFound);
  return `Removed <${result.tag}> from ${selector}`;
}

async function executeSimulateEvent(
  page: any,
  args: z.infer<typeof simulateEventAction>,
): Promise<string> {
  const { selector, event_type, event_data } = args;

  const result = await page.evaluate(
    ({
      selector,
      eventType,
      eventData,
    }: {
      selector: string;
      eventType: string;
      eventData?: Record<string, unknown>;
    }) => {
      const element = document.querySelector(selector);
      if (!element) return { error: `No element found: ${selector}` };

      const event = new Event(eventType, {
        bubbles: true,
        cancelable: true,
        ...eventData,
      });

      element.dispatchEvent(event);
      return { success: true, tag: element.tagName.toLowerCase() };
    },
    { selector, eventType: event_type, eventData: event_data },
  );

  if (result.error) throw new DyadError(result.error, DyadErrorKind.NotFound);
  return `Dispatched ${event_type} event on <${result.tag}>`;
}

async function executeAnalyzeLayout(
  page: any,
  args: z.infer<typeof analyzeLayoutAction>,
): Promise<string> {
  const { selector, show_grid, show_flexbox, show_box_model } = args;

  const result = await page.evaluate(
    ({
      selector,
      showGrid,
      showFlexbox,
      showBoxModel,
    }: {
      selector: string;
      showGrid?: boolean;
      showFlexbox?: boolean;
      showBoxModel?: boolean;
    }) => {
      const element = document.querySelector(selector);
      if (!element) return { error: `No element found: ${selector}` };

      const computed = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      const analysis: Record<string, unknown> = {
        tag: element.tagName.toLowerCase(),
        dimensions: {
          width: rect.width,
          height: rect.height,
          top: rect.top,
          left: rect.left,
        },
        boxModel: {
          content: {
            width: computed.getPropertyValue("width"),
            height: computed.getPropertyValue("height"),
          },
          padding: {
            top: computed.getPropertyValue("padding-top"),
            right: computed.getPropertyValue("padding-right"),
            bottom: computed.getPropertyValue("padding-bottom"),
            left: computed.getPropertyValue("padding-left"),
          },
          margin: {
            top: computed.getPropertyValue("margin-top"),
            right: computed.getPropertyValue("margin-right"),
            bottom: computed.getPropertyValue("margin-bottom"),
            left: computed.getPropertyValue("margin-left"),
          },
          border: {
            width: computed.getPropertyValue("border-width"),
            style: computed.getPropertyValue("border-style"),
            color: computed.getPropertyValue("border-color"),
          },
        },
        display: computed.getPropertyValue("display"),
        position: computed.getPropertyValue("position"),
        overflow: computed.getPropertyValue("overflow"),
      };

      if (showGrid && computed.display === "grid") {
        analysis.grid = {
          templateColumns: computed.getPropertyValue("grid-template-columns"),
          templateRows: computed.getPropertyValue("grid-template-rows"),
          gap: computed.getPropertyValue("gap"),
        };
      }

      if (showFlexbox && computed.display === "flex") {
        analysis.flexbox = {
          direction: computed.getPropertyValue("flex-direction"),
          justify: computed.getPropertyValue("justify-content"),
          align: computed.getPropertyValue("align-items"),
          wrap: computed.getPropertyValue("flex-wrap"),
          gap: computed.getPropertyValue("gap"),
        };
      }

      return { success: true, analysis };
    },
    {
      selector,
      showGrid: show_grid,
      showFlexbox: show_flexbox,
      showBoxModel: show_box_model,
    },
  );

  if (result.error) throw new DyadError(result.error, DyadErrorKind.NotFound);
  return JSON.stringify(result.analysis, null, 2);
}

async function executeInspectAccessibility(
  page: any,
  args: z.infer<typeof inspectAccessibilityAction>,
): Promise<string> {
  const { selector, include_aria } = args;

  const result = await page.evaluate(
    ({
      selector,
      includeAria,
    }: {
      selector?: string;
      includeAria?: boolean;
    }) => {
      const root = selector ? document.querySelector(selector) : document.body;
      if (!root) return { error: `No element found: ${selector}` };

      const accessibilityTree: Record<string, unknown>[] = [];

      function walk(el: Element, depth: number): void {
        if (depth > 10) return;

        const role = el.getAttribute("role");
        const ariaLabel = el.getAttribute("aria-label");
        const ariaLabelledBy = el.getAttribute("aria-labelledby");
        const ariaDescribedBy = el.getAttribute("aria-describedby");
        const tabindex = el.getAttribute("tabindex");
        const tagName = el.tagName.toLowerCase();

        // Skip hidden elements
        if (el.getAttribute("aria-hidden") === "true") return;
        if ((el as HTMLElement).style?.display === "none") return;
        if ((el as HTMLElement).style?.visibility === "hidden") return;

        const node: Record<string, unknown> = {
          tag: tagName,
          role,
          accessibleName: ariaLabel || el.textContent?.trim().slice(0, 50),
        };

        if (includeAria) {
          node.ariaLabelledBy = ariaLabelledBy;
          node.ariaDescribedBy = ariaDescribedBy;
          node.tabindex = tabindex;
          node.disabled = (el as HTMLInputElement).disabled;
          node.readOnly = (el as HTMLInputElement).readOnly;
        }

        accessibilityTree.push(node);

        for (const child of Array.from(el.children)) {
          walk(child, depth + 1);
        }
      }

      walk(root, 0);
      return { success: true, tree: accessibilityTree };
    },
    { selector, includeAria: include_aria },
  );

  if (result.error) throw new DyadError(result.error, DyadErrorKind.NotFound);
  return JSON.stringify(result.tree, null, 2);
}

async function executeProfilePerformance(
  page: any,
  args: z.infer<typeof profilePerformanceAction>,
): Promise<string> {
  const { selector } = args;

  const result = await page.evaluate((selector?: string) => {
    const elements = selector
      ? Array.from(document.querySelectorAll(selector))
      : Array.from(document.body.children);

    const metrics: Record<string, unknown>[] = [];

    for (const el of elements) {
      const rect = el.getBoundingClientRect();
      const computed = window.getComputedStyle(el);

      metrics.push({
        tag: el.tagName.toLowerCase(),
        className: el.className.toString().slice(0, 50),
        dimensions: {
          width: rect.width,
          height: rect.height,
          area: rect.width * rect.height,
        },
        paint: {
          background:
            computed.getPropertyValue("background-color") !==
            "rgba(0, 0, 0, 0)",
          boxShadow: computed.getPropertyValue("box-shadow") !== "none",
          borderRadius: computed.getPropertyValue("border-radius") !== "0px",
        },
        complexity: {
          children: el.children.length,
          depth: Array.from(el.querySelectorAll("*")).length,
        },
      });
    }

    return { success: true, metrics };
  }, selector);

  return JSON.stringify(result.metrics, null, 2);
}

async function executeQuerySelectorAll(
  page: any,
  args: z.infer<typeof querySelectorAllAction>,
): Promise<string> {
  const { selector, attributes } = args;

  const result = await page.evaluate(
    ({ selector, attributes }: { selector: string; attributes?: string[] }) => {
      const elements = Array.from(document.querySelectorAll(selector));

      return {
        count: elements.length,
        elements: elements.map((el) => {
          const attrs: Record<string, string> = {};
          if (attributes) {
            for (const attr of attributes) {
              const value = el.getAttribute(attr);
              if (value) attrs[attr] = value;
            }
          } else {
            for (const attr of Array.from(el.attributes)) {
              attrs[attr.name] = attr.value;
            }
          }
          return {
            tag: el.tagName.toLowerCase(),
            text: el.textContent?.trim().slice(0, 100),
            ...attrs,
          };
        }),
      };
    },
    { selector, attributes },
  );

  return JSON.stringify(result, null, 2);
}

async function executeGetXPath(
  page: any,
  args: z.infer<typeof getXPathAction>,
): Promise<string> {
  const { selector } = args;

  const result = await page.evaluate((selector: string) => {
    const element = document.querySelector(selector);
    if (!element) return { error: `No element found: ${selector}` };

    function getXPath(el: Element): string {
      if (el === document.body) return "/html/body";

      const parent = el.parentNode;
      if (!parent) return "";

      const siblings = Array.from(parent.children);
      const index = siblings.indexOf(el) + 1;

      return `${getXPath(parent as Element)}/${el.tagName.toLowerCase()}[${index}]`;
    }

    return { xpath: getXPath(element) };
  }, selector);

  if (result.error) throw new DyadError(result.error, DyadErrorKind.NotFound);
  return `XPath: ${result.xpath}`;
}

async function executeGetComputedStyles(
  page: any,
  args: z.infer<typeof getComputedStylesAction>,
): Promise<string> {
  const { selector, properties } = args;

  const result = await page.evaluate(
    ({ selector, properties }: { selector: string; properties?: string[] }) => {
      const element = document.querySelector(selector);
      if (!element) return { error: `No element found: ${selector}` };

      const computed = window.getComputedStyle(element);
      const styles: Record<string, string> = {};

      const defaultProperties = [
        "display",
        "position",
        "width",
        "height",
        "margin",
        "padding",
        "border",
        "background",
        "color",
        "font",
        "text-align",
        "z-index",
        "opacity",
        "visibility",
        "overflow",
        "flex-direction",
        "justify-content",
        "align-items",
        "gap",
        "grid-template-columns",
        "grid-template-rows",
      ];

      const props = properties || defaultProperties;

      for (const prop of props) {
        const value = computed.getPropertyValue(prop);
        if (value) styles[prop] = value;
      }

      return { styles };
    },
    { selector, properties },
  );

  if (result.error) throw new DyadError(result.error, DyadErrorKind.NotFound);
  return JSON.stringify(result.styles, null, 2);
}

type DomManipulatorArgs = z.infer<typeof domManipulatorSchema>;

// ============================================================================
// Description
// ============================================================================

const DESCRIPTION = `Directly manipulate and inspect the DOM of a live page — inject styles, modify elements, simulate events, analyze layouts, and profile performance. This is a power tool for UI debugging and rapid prototyping.

### Actions

#### Style & Layout
- **inject_style** — Inject arbitrary CSS rules into the page
- **analyze_layout** — Visualize box model, grid, and flexbox layouts
- **get_computed_styles** — Read computed CSS values for an element

#### Element Manipulation
- **modify_element** — Change attributes, styles, text, or HTML of an element
- **create_element** — Create and insert new DOM elements
- **remove_element** — Remove elements from the DOM

#### Querying
- **query_selector_all** — Query elements and extract attributes
- **get_xpath** — Convert CSS selector to XPath
- **inspect_accessibility** — Inspect accessibility tree and ARIA attributes

#### Events
- **simulate_event** — Dispatch DOM events (click, input, focus, etc.)

#### Performance
- **profile_performance** — Measure element render performance

### Game-Changing Use Cases
1. **Rapid UI Prototyping** — Inject styles to test design changes instantly
2. **Layout Debugging** — Visualize grid/flexbox gaps and alignment issues
3. **Accessibility Auditing** — Check ARIA labels and keyboard navigation
4. **Performance Profiling** — Identify slow-rendering elements
5. **Dynamic Content Testing** — Create/remove elements to test edge cases
6. **Event Testing** — Simulate complex user interactions

### Examples
\`\`\`
// Inject a debugging border
{action: "inject_style", css: "*, *::before, *::after { outline: 1px solid red !important; }"}

// Add a banner element
{action: "create_element", tag: "div", styles: {position: "fixed", top: "0", background: "blue", color: "white", padding: "10px"}, text: "Debug Mode", parent_selector: "body"}

// Analyze grid layout
{action: "analyze_layout", selector: ".grid-container", show_grid: true}

// Get accessibility tree
{action: "inspect_accessibility", include_aria: true}
\`\`\`

### Notes
- Changes are applied to the live page DOM
- Style injections persist until page reload
- Use with caution — this modifies the live page state
- For read-only inspection, prefer dom_snapshot or read_page`;

// ============================================================================
// Tool Definition
// ============================================================================

export const domManipulatorTool: ToolDefinition<DomManipulatorArgs> = {
  name: "dom_manipulator",
  description: DESCRIPTION,
  inputSchema: domManipulatorSchema,
  defaultConsent: "ask",
  modifiesState: true,

  isEnabled: (_ctx: AgentContext) => true,

  getConsentPreview: (args) => {
    switch (args.action) {
      case "inject_style":
        return `Inject CSS into page`;
      case "modify_element":
        return `Modify element at ${args.selector}`;
      case "create_element":
        return `Create <${args.tag}> element`;
      case "remove_element":
        return `Remove element at ${args.selector}`;
      case "simulate_event":
        return `Simulate ${args.event_type} on ${args.selector}`;
      case "analyze_layout":
        return `Analyze layout at ${args.selector}`;
      case "inspect_accessibility":
        return args.selector
          ? `Inspect accessibility at ${args.selector}`
          : "Inspect accessibility tree";
      case "profile_performance":
        return args.selector
          ? `Profile performance at ${args.selector}`
          : "Profile page performance";
      case "query_selector_all":
        return `Query ${args.selector}`;
      case "get_xpath":
        return `Get XPath for ${args.selector}`;
      case "get_computed_styles":
        return `Get computed styles for ${args.selector}`;
    }
  },

  buildXml: (args, isComplete) => {
    if (isComplete) return undefined;
    return `<dyad-dom action="${escapeXmlAttr(args.action)}">`;
  },

  execute: async (args: DomManipulatorArgs, ctx: AgentContext) => {
    logger.log(`Executing dom_manipulator: ${args.action}`);

    try {
      const page = await getPage();

      let result: string = "";

      switch (args.action) {
        case "inject_style":
          result = await executeInjectStyle(page, args);
          break;
        case "modify_element":
          result = await executeModifyElement(page, args);
          break;
        case "create_element":
          result = await executeCreateElement(page, args);
          break;
        case "remove_element":
          result = await executeRemoveElement(page, args);
          break;
        case "simulate_event":
          result = await executeSimulateEvent(page, args);
          break;
        case "analyze_layout":
          result = await executeAnalyzeLayout(page, args);
          break;
        case "inspect_accessibility":
          result = await executeInspectAccessibility(page, args);
          break;
        case "profile_performance":
          result = await executeProfilePerformance(page, args);
          break;
        case "query_selector_all":
          result = await executeQuerySelectorAll(page, args);
          break;
        case "get_xpath":
          result = await executeGetXPath(page, args);
          break;
        case "get_computed_styles":
          result = await executeGetComputedStyles(page, args);
          break;
      }

      ctx.onXmlComplete(
        `<dyad-dom action="${escapeXmlAttr(args.action)}">${escapeXmlContent(result)}</dyad-dom>`,
      );

      return result;
    } catch (error) {
      ctx.onXmlComplete(
        `<dyad-dom action="${escapeXmlAttr(args.action)}"></dyad-dom>`,
      );
      throw error;
    }
  },
};
