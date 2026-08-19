import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useQuery } from "@tanstack/react-query";

export function useSystemPlatform() {
  const { data } = useQuery({
    queryKey: queryKeys.instructions.platform,
    queryFn: () => ipc.instructions.getSystemPlatform(),
    staleTime: Number.POSITIVE_INFINITY, // Platform never changes during a session
  });

  return data ?? null;
}
