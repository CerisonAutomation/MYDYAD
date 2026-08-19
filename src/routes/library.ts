import LibraryHomePage from "@/pages/library-home";
import { Route } from "@tanstack/react-router";
import { rootRoute } from "./root";

export const libraryRoute = new Route({
  getParentRoute: () => rootRoute,
  path: "/library",
  component: LibraryHomePage,
});
