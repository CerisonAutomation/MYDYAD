import { createRouter } from "@tanstack/react-router";
import { appDetailsRoute } from "./routes/app-details";
import { appsRoute } from "./routes/apps";
import { chatRoute } from "./routes/chat";
import { homeRoute } from "./routes/home";
import { libraryRoute } from "./routes/library";
import { mediaRoute } from "./routes/media";
import { pluginDetailRoute } from "./routes/plugin-detail";
import { pluginsRoute } from "./routes/plugins";
import { promptsRoute } from "./routes/prompts";
import { rootRoute } from "./routes/root";
import { settingsRoute } from "./routes/settings";
import { providerSettingsRoute } from "./routes/settings/providers/$provider";
import { templatesRoute } from "./routes/templates";
import { themesRoute } from "./routes/themes";

// Lazy-loaded route components for code splitting
// Each page becomes a separate chunk, reducing initial bundle size
const lazyRoutes = {
  templates: templatesRoute,
  plugins: pluginsRoute,
  pluginDetail: pluginDetailRoute,
  library: libraryRoute,
  apps: appsRoute,
  themes: themesRoute,
  prompts: promptsRoute,
  media: mediaRoute,
};

const routeTree = rootRoute.addChildren([
  homeRoute,
  lazyRoutes.templates,
  lazyRoutes.plugins,
  lazyRoutes.pluginDetail,
  lazyRoutes.library,
  lazyRoutes.apps,
  lazyRoutes.themes,
  lazyRoutes.prompts,
  lazyRoutes.media,
  chatRoute,
  appDetailsRoute,
  settingsRoute.addChildren([providerSettingsRoute]),
]);

import { useNavigate } from "@tanstack/react-router";
// src/components/NotFoundRedirect.tsx
import * as React from "react";
import { ErrorBoundary } from "./components/ErrorBoundary";

export function NotFoundRedirect() {
  const navigate = useNavigate();

  React.useEffect(() => {
    // Navigate to the main route ('/') immediately on mount
    // 'replace: true' prevents the invalid URL from being added to browser history
    navigate({ to: "/", replace: true });
  }, [navigate]); // Dependency array ensures this runs only once

  // Optionally render null or a loading indicator while redirecting
  // The redirect is usually very fast, so null is often fine.
  return null;
  // Or: return <div>Redirecting...</div>;
}

export const router = createRouter({
  routeTree,
  defaultNotFoundComponent: NotFoundRedirect,
  defaultErrorComponent: ErrorBoundary,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
