import { createRoute } from "@tanstack/react-router";
import AppsPage from "../pages/apps";
import { rootRoute } from "./root";

export const appsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/apps",
  component: AppsPage,
});
