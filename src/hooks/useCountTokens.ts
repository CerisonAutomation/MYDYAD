import { type TokenCountResult, ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

export function useCountTokens(chatId: number | null, input = "") {
  const queryClient = useQueryClient();

  // Debounce input so we don't call the token counting IPC on every keystroke.
  const [debouncedInput, setDebouncedInput] = useState(input);

  useEffect(() => {
    // If there's no chat, don't bother debouncing
    if (chatId === null) {
      setDebouncedInput(input);
      return;
    }

    const handle = setTimeout(() => {
      setDebouncedInput(input);
    }, 1_000);

    return () => clearTimeout(handle);
  }, [chatId, input]);

  const {
    data: result = null,
    isLoading: loading,
    error,
    refetch,
  } = useQuery<TokenCountResult | null>({
    queryKey: queryKeys.tokenCount.forChat({ chatId, input: debouncedInput }),
    queryFn: async () => {
      if (chatId === null) return null;
      return ipc.chat.countTokens({
        chatId,
        input: debouncedInput,
      });
    },
    placeholderData: keepPreviousData,
    enabled: chatId !== null,
  });

  // For imperative invalidation (e.g., after streaming completes)
  const invalidateTokenCount = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.tokenCount.all });
  }, [queryClient]);

  return {
    result,
    loading,
    error,
    refetch,
    invalidateTokenCount,
  };
}
