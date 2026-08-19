import { createRoute } from "@tanstack/react-router";
import AppDetailsPage from "../pages/app-details";
import { appDetailsSearchSchema } from "./appDetailsSearchSchema";
import { rootRoute } from "./root";

export const appDetailsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/app-details",
  component: AppDetailsPage,
  validateSearch: appDetailsSearchSchema,
});
