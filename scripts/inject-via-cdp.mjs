#!/usr/bin/env node
/**
 * Inject a prompt into Dyad's agent chat via CDP (Chrome DevTools Protocol).
 * Connects to the running Electron renderer and uses IPC to send the prompt.
 *
 * Usage: node scripts/inject-via-cdp.mjs "Your prompt here" [--chat-id=N] [--app-id=N]
 */

import { chromium } from "playwright";

const PROMPT = process.argv[2];
const chatIdArg = process.argv.find(a => a.startsWith("--chat-id="));
const appIdArg = process.argv.find(a => a.startsWith("--app-id="));

if (!PROMPT) {
  console.error("Usage: node scripts/inject-via-cdp.mjs \"Your prompt here\" [--chat-id=N] [--app-id=N]");
  process.exit(1);
}

const CHAT_ID = chatIdArg ? parseInt(chatIdArg.split("=")[1]) : undefined;
const APP_ID = appIdArg ? parseInt(appIdArg.split("=")[1]) : 1;

async function main() {
  console.log("Connecting to Dyad via CDP on port 9223...");

  const browser = await chromium.connectOverCDP("http://127.0.0.1:9223");
  const contexts = browser.contexts();
  console.log(`Found ${contexts.length} context(s)`);

  let targetPage = null;
  for (const ctx of contexts) {
    for (const page of ctx.pages()) {
      const url = page.url();
      console.log(`  Page: ${url}`);
      if (url.includes("chat") || url.includes("517") || url.includes("localhost") || url.includes("127.0.0.1") || url.includes("file:///")) {
        targetPage = page;
      }
    }
  }

  if (!targetPage) {
    console.error("No Dyad renderer page found");
    await browser.close();
    process.exit(1);
  }

  console.log(`Connected to: ${targetPage.url()}`);

  // Check IPC availability
  const hasIpc = await targetPage.evaluate(() => {
    return !!(window.electron && window.electron.ipcRenderer && window.electron.ipcRenderer.invoke);
  });
  console.log(`Electron IPC available: ${hasIpc}`);

  if (!hasIpc) {
    console.error("Electron IPC not available on this page");
    await browser.close();
    process.exit(1);
  }

  // Get or create chat
  let chatId = CHAT_ID;
  if (!chatId) {
    console.log("Creating new chat for app", APP_ID);
    const result = await targetPage.evaluate(async (appId) => {
      const ipc = window.electron.ipcRenderer;
      try {
        const res = await ipc.invoke("create-chat", { appId });
        return { ok: true, id: res?.chatId ?? res?.id };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }, APP_ID);

    if (!result.ok) {
      console.error("Failed to create chat:", result.error);
      await browser.close();
      process.exit(1);
    }
    chatId = result.id;
    console.log(`Created chat ID: ${chatId}`);
  } else {
    console.log(`Using existing chat ID: ${chatId}`);
  }

  // Send prompt via chat:stream
  console.log(`\nSending prompt to agent (chat ${chatId})...`);
  console.log(`Prompt: "${PROMPT.substring(0, 100)}${PROMPT.length > 100 ? '...' : ''}"\n`);

  const response = await targetPage.evaluate(async ({ chatId, prompt, appId }) => {
    const ipc = window.electron.ipcRenderer;

    return new Promise((resolve) => {
      const chunks = [];
      let done = false;
      const timeout = setTimeout(() => {
        if (!done) {
          done = true;
          resolve({ ok: true, text: chunks.join(""), timedOut: true });
        }
      }, 300_000);

      ipc.on("chat:response:chunk", (_, data) => {
        if (data.chatId === chatId && data.text) {
          chunks.push(data.text);
        }
      });

      ipc.on("chat:response:end", (_, data) => {
        if (data.chatId === chatId && !done) {
          done = true;
          clearTimeout(timeout);
          resolve({ ok: !data.wasCancelled, text: chunks.join(""), wasCancelled: data.wasCancelled });
        }
      });

      ipc.on("chat:response:error", (_, data) => {
        if (data.chatId === chatId && !done) {
          done = true;
          clearTimeout(timeout);
          resolve({ ok: false, text: chunks.join(""), error: data.error });
        }
      });

      ipc.invoke("chat:stream", { chatId, prompt, appId }).catch((e) => {
        if (!done) {
          done = true;
          clearTimeout(timeout);
          resolve({ ok: false, text: chunks.join(""), error: e.message });
        }
      });
    });
  }, { chatId, prompt: PROMPT, appId: APP_ID });

  console.log("=== AGENT RESPONSE ===");
  console.log(response.text || "(no text)");
  if (response.error) console.error("Error:", response.error);
  if (response.timedOut) console.log("(timed out after 5 min)");
  console.log("=== END ===");

  await browser.close();
}

main().catch(e => { console.error("Fatal:", e); process.exit(1); });
