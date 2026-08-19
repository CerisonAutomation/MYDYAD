import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { type ProblemReport, ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useQuery } from "@tanstack/react-query";

export function useCheckProblems(appId: number | null) {
  const {
    data: problemReport,
    isLoading: isChecking,
    error,
    refetch: checkProblems,
  } = useQuery<ProblemReport, Error>({
    queryKey: queryKeys.problems.byApp({ appId }),
    queryFn: async (): Promise<ProblemReport> => {
      if (!appId) {
        throw new DyadError("App ID is required", DyadErrorKind.Validation);
      }
      return ipc.misc.checkProblems({ appId });
    },
    enabled: false,
    // DO NOT SHOW ERROR TOAST.
  });

  return {
    problemReport,
    isChecking,
    error,
    checkProblems,
  };
}
