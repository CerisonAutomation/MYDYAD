import { createRoute } from "@tanstack/react-router";
import { z } from "zod";
import HomePage from "../pages/home";
import { rootRoute } from "./root";
export const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
  validateSearch: z.object({
    appId: z.number().optional(),
  }),
});
