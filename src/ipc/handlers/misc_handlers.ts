import { notifyRendererErrorToastListenerReady } from "@/main/settings";
import { miscContracts } from "../types/misc";
import { createTypedHandler } from "./base";

export function registerMiscHandlers() {
  createTypedHandler(miscContracts.rendererErrorToastReady, async (event) => {
    notifyRendererErrorToastListenerReady(event.sender);
  });
}
