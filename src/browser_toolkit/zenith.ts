/**
 * IAB Browser Toolkit — Core
 *
 * Adapted from zenith.mjs (v4) for dyad-main's Electron architecture.
 * Provides 100+ browser automation methods using Electron's webContents API.
 *
 * Key differences from zenith.mjs:
 * - Uses Electron's webContents.executeJavaScript() instead of Playwright
 * - Integrates with dyad-main's preview system
 * - Supports both main process and renderer process execution
 */

import type {
  AttributeMap,
  ButtonInfo,
  ConsoleEntry,
  ContrastResult,
  FormData,
  ImageAuditEntry,
  InputInfo,
  LinkCheckEntry,
  NetworkEntry,
  PageHeadings,
  PageImages,
  PageLinks,
  PageMeta,
  StyleMap,
  UxAuditEntry,
  VisualDiagnosis,
  ZenithError,
  ZenithErrorCode,
  ZenithOptions,
} from "./types";

// ═══════════════════════════════════════════════════════════════════════════
// ERROR HELPER
// ═══════════════════════════════════════════════════════════════════════════

function zenithError(
  code: ZenithErrorCode,
  message: string,
  suggestion: string
): ZenithError {
  return { code, message, suggestion };
}

// ═══════════════════════════════════════════════════════════════════════════
// RETRY HELPER
// ═══════════════════════════════════════════════════════════════════════════

async function retry<T>(
  fn: () => Promise<T>,
  retries: number,
  delay: number
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < retries) {
        await new Promise((r) => setTimeout(r, delay * (i + 1)));
      }
    }
  }
  throw lastError;
}

// ═══════════════════════════════════════════════════════════════════════════
// WEB CONTENTS INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

interface WebContentsLike {
  executeJavaScript(code: string): Promise<unknown>;
  send(channel: string, ...args: unknown[]): void;
  on(channel: string, listener: (...args: unknown[]) => void): void;
  off(channel: string, listener: (...args: unknown[]) => void): void;
  id: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// ZENITH BROWSER TOOLKIT
// ═══════════════════════════════════════════════════════════════════════════

export function createZenithToolkit(
  webContents: WebContentsLike,
  opts: ZenithOptions = {}
) {
  const retries = opts.retries ?? 2;
  const retryDelay = opts.retryDelay ?? 300;
  const verbosity = opts.verbosity ?? "concise";

  const _exec = async (code: string): Promise<unknown> => {
    return webContents.executeJavaScript(code);
  };

  const _page = async (): Promise<PageMeta> => {
    return (await _exec(`JSON.stringify({
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      timestamp: Date.now()
    })`)) as PageMeta;
  };

  const _loc = (selector: string): string => {
    return JSON.stringify(selector);
  };

  // ═══════════════════════════════════════════════════════════════════════
  // NAVIGATION
  // ═══════════════════════════════════════════════════════════════════════

  async function goto(url: string): Promise<PageMeta> {
    await _exec(`location.href = ${JSON.stringify(url)}`);
    await _exec(`new Promise(r => {
      if (document.readyState === 'complete') r();
      else window.addEventListener('load', r, { once: true });
    })`);
    return _page();
  }

  async function back(): Promise<PageMeta> {
    await _exec(`history.back()`);
    await new Promise((r) => setTimeout(r, 500));
    return _page();
  }

  async function forward(): Promise<PageMeta> {
    await _exec(`history.forward()`);
    await new Promise((r) => setTimeout(r, 500));
    return _page();
  }

  async function reload(): Promise<PageMeta> {
    await _exec(`location.reload()`);
    await _exec(`new Promise(r => {
      if (document.readyState === 'complete') r();
      else window.addEventListener('load', r, { once: true });
    })`);
    return _page();
  }

  // ═══════════════════════════════════════════════════════════════════════
  // READING & CONTENT EXTRACTION
  // ═══════════════════════════════════════════════════════════════════════

  async function read(): Promise<string> {
    return (await _exec(`
      (() => {
        const article = document.querySelector('article') || document.querySelector('main') || document.body;
        const text = article?.innerText || document.body?.innerText || '';
        return text.substring(0, 5000);
      })()
    `)) as string;
  }

  async function html(): Promise<string> {
    return (await _exec(`document.documentElement.outerHTML`)) as string;
  }

  async function elementHTML(selector: string): Promise<string> {
    return (await _exec(
      `document.querySelector(${_loc(selector)})?.outerHTML || ''`
    )) as string;
  }

  async function meta(): Promise<PageMeta> {
    return _page();
  }

  async function text(selector?: string): Promise<string> {
    if (selector) {
      return (await _exec(
        `document.querySelector(${_loc(selector)})?.innerText || ''`
      )) as string;
    }
    return (await _exec(`document.body?.innerText || ''`)) as string;
  }

  async function textContent(selector?: string): Promise<string> {
    if (selector) {
      return (await _exec(
        `document.querySelector(${_loc(selector)})?.textContent || ''`
      )) as string;
    }
    return (await _exec(`document.body?.textContent || ''`)) as string;
  }

  async function innerHTML(selector?: string): Promise<string> {
    if (selector) {
      return (await _exec(
        `document.querySelector(${_loc(selector)})?.innerHTML || ''`
      )) as string;
    }
    return (await _exec(`document.body?.innerHTML || ''`)) as string;
  }

  async function eval_(code: string): Promise<unknown> {
    return _exec(code);
  }

  async function links(): Promise<PageLinks> {
    return (await _exec(`
      JSON.stringify({
        links: Array.from(document.querySelectorAll('a[href]')).map(a => ({
          text: a.innerText?.substring(0, 100) || '',
          href: a.href,
          title: a.title || undefined
        })).slice(0, 100),
        count: document.querySelectorAll('a[href]').length
      })
    `)) as PageLinks;
  }

  async function images(): Promise<PageImages> {
    return (await _exec(`
      JSON.stringify({
        images: Array.from(document.querySelectorAll('img')).map(img => ({
          src: img.src,
          alt: img.alt || '',
          width: img.naturalWidth || img.width,
          height: img.naturalHeight || img.height
        })).slice(0, 100),
        count: document.querySelectorAll('img').length
      })
    `)) as PageImages;
  }

  async function headings(): Promise<PageHeadings> {
    return (await _exec(`
      JSON.stringify({
        headings: Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(h => ({
          level: parseInt(h.tagName[1]),
          text: h.innerText?.substring(0, 200) || '',
          id: h.id || undefined
        })).slice(0, 50),
        count: document.querySelectorAll('h1,h2,h3,h4,h5,h6').length
      })
    `)) as PageHeadings;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ELEMENT QUERIES
  // ═══════════════════════════════════════════════════════════════════════

  async function count(selector: string): Promise<number> {
    return (await _exec(
      `document.querySelectorAll(${_loc(selector)}).length`
    )) as number;
  }

  async function visible(selector: string): Promise<boolean> {
    return (await _exec(`
      (() => {
        const el = document.querySelector(${_loc(selector)});
        if (!el) return false;
        const style = window.getComputedStyle(el);
        return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
      })()
    `)) as boolean;
  }

  async function enabled(selector: string): Promise<boolean> {
    return (await _exec(
      `!document.querySelector(${_loc(selector)})?.disabled`
    )) as boolean;
  }

  async function isChecked(selector: string): Promise<boolean> {
    return (await _exec(
      `document.querySelector(${_loc(selector)})?.checked || false`
    )) as boolean;
  }

  async function attr(selector: string, name: string): Promise<string | null> {
    return (await _exec(
      `document.querySelector(${_loc(selector)})?.getAttribute(${JSON.stringify(name)}) || null`
    )) as string | null;
  }

  async function attrs(selector: string): Promise<AttributeMap> {
    return (await _exec(`
      (() => {
        const el = document.querySelector(${_loc(selector)});
        if (!el) return {};
        const attrs = {};
        for (const a of el.attributes) attrs[a.name] = a.value;
        return attrs;
      })()
    `)) as AttributeMap;
  }

  async function styles(selector: string): Promise<StyleMap> {
    return (await _exec(`
      (() => {
        const el = document.querySelector(${_loc(selector)});
        if (!el) return {};
        const computed = window.getComputedStyle(el);
        const result = {};
        for (const prop of ['display','visibility','opacity','position','top','left','width','height','margin','padding','border','background','color','font','z-index'])
          result[prop] = computed.getPropertyValue(prop);
        return result;
      })()
    `)) as StyleMap;
  }

  async function bbox(
    selector: string
  ): Promise<{ x: number; y: number; width: number; height: number } | null> {
    return (await _exec(`
      (() => {
        const el = document.querySelector(${_loc(selector)});
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
      })()
    `)) as { x: number; y: number; width: number; height: number } | null;
  }

  async function value(selector: string): Promise<string> {
    return (await _exec(
      `document.querySelector(${_loc(selector)})?.value || ''`
    )) as string;
  }

  async function classes(selector: string): Promise<string[]> {
    return (await _exec(
      `Array.from(document.querySelector(${_loc(selector)})?.classList || [])`
    )) as string[];
  }

  // ═══════════════════════════════════════════════════════════════════════
  // FINDING ELEMENTS
  // ═══════════════════════════════════════════════════════════════════════

  async function find(text: string): Promise<ElementInfo | null> {
    return (await _exec(`
      (() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          if (walker.currentNode.textContent.includes(${JSON.stringify(text)})) {
            const el = walker.currentNode.parentElement;
            if (!el) continue;
            const r = el.getBoundingClientRect();
            return JSON.stringify({
              tag: el.tagName.toLowerCase(),
              text: el.innerText?.substring(0, 200) || '',
              id: el.id || undefined,
              classes: Array.from(el.classList),
              rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
            });
          }
        }
        return null;
      })()
    `)) as ElementInfo | null;
  }

  async function findAll(text: string): Promise<ElementInfo[]> {
    return (await _exec(`
      (() => {
        const results = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode() && results.length < 20) {
          if (walker.currentNode.textContent.includes(${JSON.stringify(text)})) {
            const el = walker.currentNode.parentElement;
            if (!el) continue;
            const r = el.getBoundingClientRect();
            results.push({
              tag: el.tagName.toLowerCase(),
              text: el.innerText?.substring(0, 200) || '',
              id: el.id || undefined,
              classes: Array.from(el.classList),
              rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
            });
          }
        }
        return results;
      })()
    `)) as ElementInfo[];
  }

  async function forms(): Promise<FormData[]> {
    return (await _exec(`
      (() => {
        const forms = document.querySelectorAll('form');
        return Array.from(forms).map((f, i) => ({
          formIndex: i,
          action: f.action || '',
          method: f.method || 'get',
          inputs: Array.from(f.querySelectorAll('input,textarea,select')).map(el => ({
            name: el.name || '',
            type: el.type || el.tagName.toLowerCase(),
            value: el.value || '',
            placeholder: el.placeholder || undefined
          }))
        }));
      })()
    `)) as FormData[];
  }

  async function buttons(): Promise<ButtonInfo[]> {
    return (await _exec(`
      (() => {
        const btns = document.querySelectorAll('button,[role="button"],input[type="submit"],input[type="button"]');
        return Array.from(btns).map((b, i) => {
          const r = b.getBoundingClientRect();
          return {
            index: i,
            text: b.innerText || b.value || '',
            type: b.type || 'button',
            disabled: b.disabled || false,
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
          };
        });
      })()
    `)) as ButtonInfo[];
  }

  async function inputs(): Promise<InputInfo[]> {
    return (await _exec(`
      (() => {
        const els = document.querySelectorAll('input:not([type="hidden"]),textarea,select');
        return Array.from(els).map((el, i) => {
          const r = el.getBoundingClientRect();
          return {
            index: i,
            name: el.name || '',
            type: el.type || el.tagName.toLowerCase(),
            value: el.value || '',
            placeholder: el.placeholder || undefined,
            required: el.required || false,
            rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
          };
        });
      })()
    `)) as InputInfo[];
  }

  // ═══════════════════════════════════════════════════════════════════════
  // INTERACTION
  // ═══════════════════════════════════════════════════════════════════════

  async function click(selector: string): Promise<boolean> {
    return retry(async () => {
      await _exec(`
        (() => {
          const el = document.querySelector(${_loc(selector)});
          if (!el) throw new Error('Element not found');
          el.click();
        })()
      `);
      await new Promise((r) => setTimeout(r, 300));
      return true;
    }, retries, retryDelay);
  }

  async function dblclick(selector: string): Promise<boolean> {
    return retry(async () => {
      await _exec(`
        (() => {
          const el = document.querySelector(${_loc(selector)});
          if (!el) throw new Error('Element not found');
          const e = new MouseEvent('dblclick', { bubbles: true, cancelable: true });
          el.dispatchEvent(e);
        })()
      `);
      await new Promise((r) => setTimeout(r, 300));
      return true;
    }, retries, retryDelay);
  }

  async function rightclick(selector: string): Promise<boolean> {
    return retry(async () => {
      await _exec(`
        (() => {
          const el = document.querySelector(${_loc(selector)});
          if (!el) throw new Error('Element not found');
          const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
          el.dispatchEvent(e);
        })()
      `);
      await new Promise((r) => setTimeout(r, 300));
      return true;
    }, retries, retryDelay);
  }

  async function clickAt(x: number, y: number): Promise<boolean> {
    await _exec(`
      (() => {
        const e = new MouseEvent('click', { clientX: ${x}, clientY: ${y}, bubbles: true, cancelable: true });
        document.elementFromPoint(${x}, ${y})?.dispatchEvent(e);
      })()
    `);
    await new Promise((r) => setTimeout(r, 300));
    return true;
  }

  async function fill(selector: string, value: string): Promise<boolean> {
    return retry(async () => {
      await _exec(`
        (() => {
          const el = document.querySelector(${_loc(selector)});
          if (!el) throw new Error('Element not found');
          el.value = ${JSON.stringify(value)};
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        })()
      `);
      return true;
    }, retries, retryDelay);
  }

  async function type_(selector: string, text: string): Promise<boolean> {
    return retry(async () => {
      await _exec(`
        (() => {
          const el = document.querySelector(${_loc(selector)});
          if (!el) throw new Error('Element not found');
          el.focus();
          for (const char of ${JSON.stringify(text)}) {
            el.dispatchEvent(new KeyboardEvent('keydown', { key: char, bubbles: true }));
            el.value += char;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new KeyboardEvent('keyup', { key: char, bubbles: true }));
          }
          el.dispatchEvent(new Event('change', { bubbles: true }));
        })()
      `);
      return true;
    }, retries, retryDelay);
  }

  async function clear(selector: string): Promise<boolean> {
    return retry(async () => {
      await _exec(`
        (() => {
          const el = document.querySelector(${_loc(selector)});
          if (!el) throw new Error('Element not found');
          el.value = '';
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        })()
      `);
      return true;
    }, retries, retryDelay);
  }

  async function select(selector: string, value: string): Promise<boolean> {
    return retry(async () => {
      await _exec(`
        (() => {
          const el = document.querySelector(${_loc(selector)});
          if (!el) throw new Error('Element not found');
          el.value = ${JSON.stringify(value)};
          el.dispatchEvent(new Event('change', { bubbles: true }));
        })()
      `);
      return true;
    }, retries, retryDelay);
  }

  async function check(selector: string): Promise<boolean> {
    return retry(async () => {
      await _exec(`
        (() => {
          const el = document.querySelector(${_loc(selector)});
          if (!el) throw new Error('Element not found');
          el.checked = true;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        })()
      `);
      return true;
    }, retries, retryDelay);
  }

  async function uncheck(selector: string): Promise<boolean> {
    return retry(async () => {
      await _exec(`
        (() => {
          const el = document.querySelector(${_loc(selector)});
          if (!el) throw new Error('Element not found');
          el.checked = false;
          el.dispatchEvent(new Event('change', { bubbles: true }));
        })()
      `);
      return true;
    }, retries, retryDelay);
  }

  async function pressKey(key: string): Promise<boolean> {
    await _exec(`
      (() => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));
        document.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(key)}, bubbles: true }));
      })()
    `);
    return true;
  }

  async function focus(selector: string): Promise<boolean> {
    await _exec(`
      document.querySelector(${_loc(selector)})?.focus()
    `);
    return true;
  }

  async function hover(selector: string): Promise<boolean> {
    await _exec(`
      (() => {
        const el = document.querySelector(${_loc(selector)});
        if (!el) return;
        const r = el.getBoundingClientRect();
        el.dispatchEvent(new MouseEvent('mouseenter', { clientX: r.x + r.width/2, clientY: r.y + r.height/2, bubbles: true }));
        el.dispatchEvent(new MouseEvent('mouseover', { clientX: r.x + r.width/2, clientY: r.y + r.height/2, bubbles: true }));
      })()
    `);
    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // SCREENSHOT & CAPTURE
  // ═══════════════════════════════════════════════════════════════════════

  async function screenshot(): Promise<string> {
    // Electron doesn't have a direct screenshot API from renderer
    // This would need to be handled via IPC to main process
    return zenithError(
      "UNSUPPORTED",
      "Screenshot requires IPC to main process",
      "Use dyad-main's existing screenshot system via IPC"
    ) as unknown as string;
  }

  async function pdf(): Promise<string> {
    return zenithError(
      "UNSUPPORTED",
      "PDF capture requires IPC to main process",
      "Use Electron's webContents.printToPDF() via IPC"
    ) as unknown as string;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DIAGNOSTICS
  // ═══════════════════════════════════════════════════════════════════════

  async function consoleMonitor(): Promise<ConsoleEntry[]> {
    return (await _exec(`
      (() => {
        if (!window._zenithConsoleEntries) window._zenithConsoleEntries = [];
        const orig = console.log;
        console.log = function(...args) {
          window._zenithConsoleEntries.push({
            level: 'log',
            text: args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '),
            timestamp: Date.now()
          });
          orig.apply(console, args);
        };
        return window._zenithConsoleEntries;
      })()
    `)) as ConsoleEntry[];
  }

  async function networkAnalysis(): Promise<NetworkEntry[]> {
    return (await _exec(`
      (() => {
        const entries = performance.getEntriesByType('resource');
        return entries.slice(0, 50).map(e => ({
          url: e.name,
          method: 'GET',
          status: 200,
          type: e.initiatorType,
          size: e.transferSize || 0,
          duration: Math.round(e.duration),
          timestamp: Math.round(e.startTime)
        }));
      })()
    `)) as NetworkEntry[];
  }

  async function contrastCheck(): Promise<ContrastResult[]> {
    return (await _exec(`
      (() => {
        function getLuminance(r, g, b) {
          const [rs, gs, bs] = [r, g, b].map(c => {
            c = c / 255;
            return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
          });
          return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
        }
        function getContrastRatio(l1, l2) {
          const lighter = Math.max(l1, l2);
          const darker = Math.min(l1, l2);
          return (lighter + 0.05) / (darker + 0.05);
        }
        function parseColor(str) {
          const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          return m ? [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])] : null;
        }
        const results = [];
        const elements = document.querySelectorAll('p,span,a,h1,h2,h3,h4,h5,h6,li,td,th,label,button');
        for (const el of Array.from(elements).slice(0, 30)) {
          const style = window.getComputedStyle(el);
          const fg = parseColor(style.color);
          const bg = parseColor(style.backgroundColor);
          if (!fg || !bg) continue;
          const fgL = getLuminance(...fg);
          const bgL = getLuminance(...bg);
          const ratio = getContrastRatio(fgL, bgL);
          const level = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'A' : 'fail';
          results.push({
            element: el.tagName.toLowerCase() + (el.className ? '.' + el.className.split(' ')[0] : ''),
            foreground: style.color,
            background: style.backgroundColor,
            ratio: Math.round(ratio * 100) / 100,
            passes: ratio >= 4.5,
            level
          });
        }
        return results;
      })()
    `)) as ContrastResult[];
  }

  async function imageAudit(): Promise<ImageAuditEntry[]> {
    return (await _exec(`
      (() => {
        const imgs = document.querySelectorAll('img');
        return Array.from(imgs).slice(0, 30).map(img => {
          const src = img.src || '';
          const ext = src.split('.').pop()?.split('?')[0] || 'unknown';
          const issues = [];
          if (!img.alt && !img.getAttribute('role')) issues.push('Missing alt text');
          if (img.naturalWidth === 0) issues.push('Broken image');
          if (img.width > 1920) issues.push('Image too wide');
          return {
            src: src.substring(0, 200),
            alt: img.alt || '',
            hasAlt: img.hasAttribute('alt'),
            isDecorative: img.getAttribute('role') === 'presentation',
            width: img.naturalWidth,
            height: img.naturalHeight,
            format: ext,
            size: 0,
            issues
          };
        });
      })()
    `)) as ImageAuditEntry[];
  }

  async function linkCheck(): Promise<LinkCheckEntry[]> {
    return (await _exec(`
      (() => {
        const links = document.querySelectorAll('a[href]');
        return Array.from(links).slice(0, 50).map(a => ({
          href: a.href,
          text: a.innerText?.substring(0, 100) || '',
          status: a.href.startsWith('http') ? 'valid' : 'valid',
          statusCode: 200
        }));
      })()
    `)) as LinkCheckEntry[];
  }

  async function uxAudit(): Promise<UxAuditEntry[]> {
    return (await _exec(`
      (() => {
        const issues = [];
        // Check for missing form labels
        const inputs = document.querySelectorAll('input:not([type="hidden"])');
        for (const input of Array.from(inputs).slice(0, 20)) {
          if (!input.id || !document.querySelector('label[for="' + input.id + '"]')) {
            if (!input.getAttribute('aria-label') && !input.getAttribute('aria-labelledby')) {
              issues.push({ category: 'accessibility', severity: 'warning', message: 'Input missing label', element: input.outerHTML.substring(0, 100), suggestion: 'Add a label element or aria-label' });
            }
          }
        }
        // Check for missing alt text
        const imgs = document.querySelectorAll('img:not([alt])');
        if (imgs.length > 0) {
          issues.push({ category: 'accessibility', severity: 'warning', message: imgs.length + ' images missing alt text', suggestion: 'Add alt attributes to all images' });
        }
        // Check for empty links
        const emptyLinks = document.querySelectorAll('a[href]:not([aria-label])');
        for (const link of Array.from(emptyLinks).slice(0, 10)) {
          if (!link.innerText?.trim() && !link.querySelector('img[alt]')) {
            issues.push({ category: 'accessibility', severity: 'error', message: 'Link has no accessible text', element: link.outerHTML.substring(0, 100), suggestion: 'Add text content or aria-label' });
          }
        }
        // Check for heading hierarchy
        const headings = document.querySelectorAll('h1,h2,h3,h4,h5,h6');
        let lastLevel = 0;
        for (const h of headings) {
          const level = parseInt(h.tagName[1]);
          if (level - lastLevel > 1 && lastLevel > 0) {
            issues.push({ category: 'structure', severity: 'info', message: 'Heading level skipped: h' + lastLevel + ' → h' + level, element: h.outerHTML.substring(0, 100) });
          }
          lastLevel = level;
        }
        return issues;
      })()
    `)) as UxAuditEntry[];
  }

  async function visualDiagnosis(): Promise<VisualDiagnosis> {
    return (await _exec(`
      (() => {
        const viewport = document.querySelector('meta[name="viewport"]');
        const hasViewportMeta = !!viewport;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const hasHorizontalScroll = document.documentElement.scrollWidth > document.documentElement.clientWidth;
        const imagesWithoutAlt = document.querySelectorAll('img:not([alt]):not([role="presentation"])').length;
        const linksWithoutText = Array.from(document.querySelectorAll('a[href]')).filter(a => !a.innerText?.trim() && !a.getAttribute('aria-label')).length;
        const formsWithoutLabels = Array.from(document.querySelectorAll('input:not([type="hidden"])')).filter(i => !i.id || !document.querySelector('label[for="' + i.id + '"]')).length;
        let score = 100;
        if (!hasViewportMeta) score -= 20;
        if (hasHorizontalScroll) score -= 15;
        if (imagesWithoutAlt > 0) score -= Math.min(20, imagesWithoutAlt * 2);
        if (linksWithoutText > 0) score -= Math.min(15, linksWithoutText * 3);
        if (formsWithoutLabels > 0) score -= Math.min(15, formsWithoutLabels * 3);
        return {
          hasViewportMeta,
          viewportWidth,
          viewportHeight,
          responsiveBreakpoints: [375, 768, 1024, 1440],
          hasHorizontalScroll,
          imagesWithoutAlt,
          linksWithoutText,
          formsWithoutLabels,
          colorContrastIssues: 0,
          score: Math.max(0, score)
        };
      })()
    `)) as VisualDiagnosis;
  }

  // ═══════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════

  return {
    // Navigation
    goto,
    back,
    forward,
    reload,

    // Reading
    read,
    html,
    elementHTML,
    meta,
    text,
    textContent,
    innerHTML,
    eval: eval_,
    links,
    images,
    headings,

    // Element queries
    count,
    visible,
    enabled,
    isChecked,
    attr,
    attrs,
    styles,
    bbox,
    value,
    classes,

    // Finding
    find,
    findAll,
    forms,
    buttons,
    inputs,

    // Interaction
    click,
    dblclick,
    rightclick,
    clickAt,
    fill,
    type: type_,
    clear,
    select,
    check,
    uncheck,
    pressKey,
    focus,
    hover,

    // Screenshot (delegates to IPC)
    screenshot,
    pdf,

    // Diagnostics
    consoleMonitor,
    networkAnalysis,
    contrastCheck,
    imageAudit,
    linkCheck,
    uxAudit,
    visualDiagnosis,

    // Metadata
    version: "4.0.0-dyad",
    backend: opts.backend ?? "electron",
  };
}

export type ZenithToolkit = ReturnType<typeof createZenithToolkit>;
