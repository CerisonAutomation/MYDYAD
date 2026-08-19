import { createRoute } from "@tanstack/react-router";
import ChatPage from "../pages/chat";
import { chatSearchSchema } from "./chatSearchSchema";
import { rootRoute } from "./root";

// Re-exported for convenience; the canonical definition (and the one the hybrid
// test harness imports, to avoid pulling in ChatPage/Monaco) lives in
// ./chatSearchSchema.
export { chatSearchSchema };

export const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat",
  component: ChatPage,
  validateSearch: chatSearchSchema,
});
