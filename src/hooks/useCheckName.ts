import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useQuery } from "@tanstack/react-query";

export const useCheckName = (appName: string) => {
  return useQuery({
    queryKey: queryKeys.appName.check({ name: appName }),
    queryFn: async () => {
      const result = await ipc.app.checkAppName({ appName });
      return result;
    },
    enabled: !!appName && !!appName.trim(),
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    retry: false,
  });
};
