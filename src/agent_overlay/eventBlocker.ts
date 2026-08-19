/**
 * Event Blocker — Prevents user input during agent autonomous operations
 *
 * Ported from Comet.app events.js pattern.
 * Intercepts mouse, keyboard, touch, and pointer events during agent tasks.
 * Uses CSS cursor override and event capture phase blocking.
 */

const BLOCKED_EVENTS = [
  "click",
  "dblclick",
  "mousedown",
  "mouseup",
  "mouseenter",
  "mouseleave",
  "mousemove",
  "mouseout",
  "mouseover",
  "mousewheel",
  "wheel",
  "touchstart",
  "touchend",
  "touchmove",
  "touchcancel",
  "keydown",
  "keyup",
  "keypress",
  "beforeinput",
  "input",
  "textInput",
  "compositionstart",
  "compositionend",
  "compositionupdate",
  "pointercancel",
  "pointerdown",
  "pointerenter",
  "pointerleave",
  "pointermove",
  "pointerout",
  "pointerover",
  "pointerrawupdate",
  "pointerup",
  "drag",
  "dragend",
  "dragenter",
  "dragleave",
  "dragover",
  "dragstart",
  "drop",
  "selectstart",
  "contextmenu",
  "change",
  "beforetoggle",
  "submit",
  "reset",
] as const;

export interface EventBlockerOptions {
  /** Allow events on elements matching this selector */
  allowSelector?: string;
  /** Custom cursor during blocking */
  cursor?: string;
  /** Callback when an event is blocked */
  onBlocked?: (event: Event) => void;
}

export class EventBlocker {
  private blocked = false;
  private styleEl: HTMLStyleElement | null = null;
  private listeners: Array<{ event: string; handler: EventListener; element: EventTarget }> = [];
  private options: EventBlockerOptions;
  private allowSelector: string;

  constructor(options: EventBlockerOptions = {}) {
    this.options = options;
    this.allowSelector = options.allowSelector || "[data-agent-overlay]";
  }

  start(): void {
    if (this.blocked) return;
    this.blocked = true;

    // Inject cursor override style
    this.styleEl = document.createElement("style");
    this.styleEl.textContent = `
      html body *,
      html body *::before,
      html body *::after {
        cursor: ${this.options.cursor || "progress"} !important;
      }
      html body ${this.allowSelector},
      html body ${this.allowSelector} * {
        cursor: pointer !important;
      }
    `;
    document.head.appendChild(this.styleEl);

    // Block all events in capture phase
    for (const eventType of BLOCKED_EVENTS) {
      const handler = (e: Event) => {
        if (!this.blocked || !e.isTrusted) return;

        // Allow events on overlay controls
        const path = e.composedPath();
        const allowEl = path.find(
          (el) =>
            el instanceof HTMLElement &&
            (el.hasAttribute("data-agent-overlay") ||
              el.closest(this.allowSelector))
        );
        if (allowEl) return;

        e.stopImmediatePropagation();
        e.preventDefault();
        this.options.onBlocked?.(e);
      };

      document.addEventListener(eventType, handler, { capture: true, passive: false });
      this.listeners.push({ event: eventType, handler, element: document });
    }
  }

  stop(): void {
    if (!this.blocked) return;
    this.blocked = false;

    // Remove cursor style
    this.styleEl?.remove();
    this.styleEl = null;

    // Remove all listeners
    for (const { event, handler, element } of this.listeners) {
      element.removeEventListener(event, handler, true);
    }
    this.listeners = [];
  }

  isBlocking(): boolean {
    return this.blocked;
  }

  destroy(): void {
    this.stop();
  }
}

/**
 * Global singleton for event blocking during agent operations
 */
let globalBlocker: EventBlocker | null = null;

export function startEventBlocking(options?: EventBlockerOptions): EventBlocker {
  if (!globalBlocker) {
    globalBlocker = new EventBlocker(options);
  }
  globalBlocker.start();
  return globalBlocker;
}

export function stopEventBlocking(): void {
  globalBlocker?.stop();
}

export function isEventBlocking(): boolean {
  return globalBlocker?.isBlocking() ?? false;
}
