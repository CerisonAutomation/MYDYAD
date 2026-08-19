import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useQuery } from "@tanstack/react-query";

export function useGithubRepos({ enabled }: { enabled: boolean }) {
  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.github.repos,
    queryFn: () => ipc.github.listRepos(),
    enabled,
    meta: { showErrorToast: true },
  });

  return {
    repos: data ?? [],
    loading: isLoading,
    error,
  };
}
