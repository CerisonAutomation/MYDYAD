import { ProviderSettingsPage } from "@/components/settings/ProviderSettingsPage";
import { rootRoute } from "@/routes/root";
import { createRoute } from "@tanstack/react-router";

interface ProviderSettingsParams {
  provider: string;
}

export const providerSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/providers/$provider",
  params: {
    parse: (params: { provider: string }): ProviderSettingsParams => ({
      provider: params.provider,
    }),
  },
  component: function ProviderSettingsRouteComponent() {
    const { provider } = providerSettingsRoute.useParams();

    return <ProviderSettingsPage provider={provider} />;
  },
});
