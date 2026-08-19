import LibraryPage from "@/pages/library";
import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const promptsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/library/prompts",
  component: LibraryPage,
});
