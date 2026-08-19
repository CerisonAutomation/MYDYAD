import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { type Theme, themesData } from "@/shared/themes";
import { useQuery } from "@tanstack/react-query";

export function useThemes() {
  const query = useQuery({
    queryKey: queryKeys.themes.all,
    queryFn: async (): Promise<Theme[]> => {
      return ipc.template.getThemes();
    },
    placeholderData: themesData,
    meta: {
      showErrorToast: true,
    },
  });

  return {
    themes: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
