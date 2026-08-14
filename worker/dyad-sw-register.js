/**
 * dyad-sw-register.js – Service Worker registration script
 * This script is injected into the HTML to register the Service Worker
 * and forward messages to the parent window
 */

(function () {
  // Check if Service Workers are supported
  if (!("serviceWorker" in navigator)) {
    console.warn("[Dyad] Service Workers are not supported in this browser");
    return;
  }

  // Register the Service Worker
  navigator.serviceWorker
    .register("/dyad-sw.js", { scope: "/" })
    .then((registration) => {
      console.log("[Dyad] Service Worker registered:", registration.scope);

      // Handle updates
      registration.addEventListener("updatefound", () => {
        console.log("[Dyad] Service Worker update found");
      });
    })
    .catch((error) => {
      console.error("[Dyad] Service Worker registration failed:", error);
    });

  // Listen for messages from the Service Worker
  navigator.serviceWorker.addEventListener("message", (event) => {
    // Forward all messages to the parent window
    try {
      // eslint-disable-next-line no-undef -- DYAD_PARENT_ORIGIN is injected by the proxy server at script injection time
      const targetOrigin =
        typeof DYAD_PARENT_ORIGIN !== "undefined" ? DYAD_PARENT_ORIGIN : "*";
      window.parent.postMessage(event.data, targetOrigin);
    } catch (e) {
      console.error("[Dyad] Failed to forward message to parent:", e);
    }
  });

  // Also listen for messages from the active Service Worker controller
  if (navigator.serviceWorker.controller) {
    console.log("[Dyad] Service Worker controller already active");
  }
})();
