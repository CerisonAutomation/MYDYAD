import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useQuery } from "@tanstack/react-query";

export function useAppVersion() {
  const { data } = useQuery({
    queryKey: queryKeys.instructions.appVersion,
    queryFn: async () => {
      const result = await ipc.instructions.getAppVersion();
      return result.version;
    },
    staleTime: Number.POSITIVE_INFINITY, // App version never changes during a session
  });

  return data ?? null;
}
