import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import type { ProposalResult } from "@/lib/schemas";
import { useQuery } from "@tanstack/react-query";

export function useProposal(chatId?: number | undefined) {
  const {
    data: proposalResult,
    isLoading,
    error,
    refetch: refreshProposal,
  } = useQuery<ProposalResult | null, Error>({
    queryKey: queryKeys.proposals.detail({ chatId }),
    queryFn: async (): Promise<ProposalResult | null> => {
      if (chatId === undefined) {
        return null;
      }
      return ipc.proposal.getProposal({ chatId });
    },
    enabled: chatId !== undefined,
    meta: { showErrorToast: true },
  });

  return {
    proposalResult,
    isLoading,
    error,
    refreshProposal,
  };
}
