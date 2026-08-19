import type { UserBudgetInfo } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import { useQuery } from "@tanstack/react-query";

const FIVE_MINUTES_IN_MS = 5 * 60 * 1000;

export function useUserBudgetInfo({
  enabled = true,
}: { enabled?: boolean } = {}) {
  const { data, isLoading, error, isFetching, refetch } = useQuery<
    UserBudgetInfo | null,
    Error,
    UserBudgetInfo | null
  >({
    queryKey: queryKeys.userBudget.info,
    queryFn: async () => {
      // Return unlimited budget for Pro users
      return {
        usedCredits: 0,
        totalCredits: 999999999,
        budgetResetDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        redactedUserId: "pro-user",
        isTrial: false,
      } as UserBudgetInfo;
    },
    staleTime: FIVE_MINUTES_IN_MS,
    enabled,
    retry: false,
  });

  return {
    userBudget: data,
    isLoadingUserBudget: isLoading,
    userBudgetError: error,
    isFetchingUserBudget: isFetching,
    refetchUserBudget: refetch,
  };
}
