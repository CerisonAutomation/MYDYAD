import MediaPage from "@/pages/media";
import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const mediaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/library/media",
  component: MediaPage,
});
