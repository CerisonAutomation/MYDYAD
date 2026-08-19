import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { type BranchResult, ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useQuery } from "@tanstack/react-query";

export function useCurrentBranch(appId: number | null) {
  const {
    data: branchInfo,
    isLoading,
    refetch: refetchBranchInfo,
  } = useQuery<BranchResult, Error>({
    queryKey: queryKeys.branches.current({ appId }),
    queryFn: async (): Promise<BranchResult> => {
      if (appId === null) {
        // This case should ideally be handled by the `enabled` option
        // but as a safeguard, and to ensure queryFn always has a valid appId if called.
        throw new DyadError(
          "appId is null, cannot fetch current branch.",
          DyadErrorKind.External,
        );
      }
      return ipc.version.getCurrentBranch({ appId });
    },
    enabled: appId !== null,
    meta: { showErrorToast: true },
  });

  return {
    branchInfo,
    isLoading,
    refetchBranchInfo,
  };
}
