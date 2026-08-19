#!/usr/bin/env node
/**
 * Inject a prompt into Dyad's agent chat using the running dev instance.
 * Connects to the Vite dev server's renderer and uses IPC to send the prompt.
 *
 * Usage: node scripts/inject-fyk-prompt.mjs "Your prompt here" [--app-id=1]
 */

import { chromium } from "playwright";
import path from "path";

const PROMPT = process.argv[2];
const APP_ID_ARG = process.argv.find(a => a.startsWith("--app-id="));

if (!PROMPT) {
  console.error("Usage: node scripts/inject-fyk-prompt.mjs \"Your prompt here\" [--app-id=1]");
  process.exit(1);
}

const APP_ID = APP_ID_ARG ? parseInt(APP_ID_ARG.split("=")[1]) : 1;

async function main() {
  console.log(`Connecting to Dyad dev server on port 5173...`);

  // Connect to the running Vite dev server
  const browser = await chromium.connectOverCDP("http://127.0.0.1:5173");
  const contexts = browser.contexts();
  console.log(`Found ${contexts.length} browser context(s)`);

  // Find the Dyad renderer page
  let targetPage = null;
  for (const ctx of contexts) {
    for (const page of ctx.pages()) {
      const url = page.url();
      console.log(`  Page: ${url}`);
      if (url.includes("5173") || url.includes("localhost")) {
        targetPage = page;
      }
    }
  }

  if (!targetPage) {
    console.error("Could not find Dyad renderer page");
    await browser.close();
    process.exit(1);
  }

  console.log(`Found Dyad page: ${targetPage.url()}`);

  // Check if electron IPC is available
  const hasIpc = await targetPage.evaluate(() => {
    return typeof (window as any).electron?.ipcRenderer?.invoke === "function";
  });

  if (!hasIpc) {
    console.error("Electron IPC not available on this page. Are you connected to the Dyad renderer?");
    await browser.close();
    process.exit(1);
  }

  console.log("Electron IPC available. Sending prompt to agent...");

  // First, create a chat for the app if needed
  const chatResult = await targetPage.evaluate(async (appId) => {
    const ipc = (window as any).electron.ipcRenderer;
    try {
      const result = await ipc.invoke("create-chat", { appId });
      return { success: true, chatId: result.chatId || result.id };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, APP_ID);

  console.log("Chat creation result:", JSON.stringify(chatResult));

  if (!chatResult.success) {
    console.error("Failed to create chat:", chatResult.error);
    await browser.close();
    process.exit(1);
  }

  const chatId = chatResult.chatId;
  console.log(`Chat ID: ${chatId}. Sending prompt to agent...`);

  // Send the prompt via chat:stream
  const streamResult = await targetPage.evaluate(async ({ chatId, prompt, appId }) => {
    const ipc = (window as any).electron.ipcRenderer;

    return new Promise((resolve) => {
      const chunks = [];
      let completed = false;
      const timeout = setTimeout(() => {
        if (!completed) {
          completed = true;
          resolve({
            success: true,
            partial: chunks.join(""),
            timedOut: true
          });
        }
      }, 300_000); // 5 minute timeout

      // Listen for streaming chunks
      ipc.on("chat:response:chunk", (_event: any, data: any) => {
        if (data.chatId === chatId && data.text) {
          chunks.push(data.text);
          process.stdout.write(`\r[${chunks.join("").length} chars] Streaming...`);
        }
      });

      // Listen for completion
      ipc.on("chat:response:end", (_event: any, data: any) => {
        if (data.chatId === chatId && !completed) {
          completed = true;
          clearTimeout(timeout);
          resolve({
            success: !data.wasCancelled,
            response: chunks.join(""),
            wasCancelled: data.wasCancelled
          });
        }
      });

      // Listen for errors
      ipc.on("chat:response:error", (_event: any, data: any) => {
        if (data.chatId === chatId && !completed) {
          completed = true;
          clearTimeout(timeout);
          resolve({
            success: false,
            error: data.error || "Unknown error",
            response: chunks.join("")
          });
        }
      });

      // Send the prompt
      ipc.invoke("chat:stream", {
        chatId,
        prompt,
        appId
      }).catch((err: any) => {
        if (!completed) {
          completed = true;
          clearTimeout(timeout);
          resolve({
            success: false,
            error: err.message,
            response: chunks.join("")
          });
        }
      });
    });
  }, { chatId, prompt: PROMPT, appId: APP_ID });

  console.log("\n\n=== AGENT RESPONSE ===");
  if (streamResult.response) {
    console.log(streamResult.response);
  }
  if (streamResult.error) {
    console.error("Error:", streamResult.error);
  }
  if (streamResult.timedOut) {
    console.log("(Response timed out after 5 minutes)");
  }
  console.log("=== END RESPONSE ===");

  await browser.close();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
