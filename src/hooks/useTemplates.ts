import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { type Template, localTemplatesData } from "@/shared/templates";
import { useQuery } from "@tanstack/react-query";

export function useTemplates() {
  const query = useQuery({
    queryKey: queryKeys.templates.all,
    queryFn: async (): Promise<Template[]> => {
      return ipc.template.getTemplates();
    },
    placeholderData: localTemplatesData,
    meta: {
      showErrorToast: true,
    },
  });

  return {
    templates: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
}
