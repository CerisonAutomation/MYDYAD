import { useQuery } from "@tanstack/react-query";
import { type UserBudgetInfo } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";

/**
 * useUserBudgetInfo — BYOK build: always returns unlimited budget.
 * Every feature that checks userBudget gets a truthy object.
 * No Dyad hosted engine / subscription check needed.
 */
const UNLIMITED_BUDGET: UserBudgetInfo = {
  usedCredits: 0,
  totalCredits: 999999,
  budgetResetDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  redactedUserId: "byok-local",
  isTrial: false,
};

export function useUserBudgetInfo({
  enabled = true,
}: { enabled?: boolean } = {}) {
  const { data, isLoading, error, isFetching, refetch } = useQuery<
    UserBudgetInfo | null,
    Error,
    UserBudgetInfo | null
  >({
    queryKey: queryKeys.userBudget.info,
    queryFn: async () => UNLIMITED_BUDGET,
    enabled,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
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
