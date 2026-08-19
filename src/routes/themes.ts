import ThemesPage from "@/pages/themes";
import { createRoute } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const themesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/library/themes",
  component: ThemesPage,
});
