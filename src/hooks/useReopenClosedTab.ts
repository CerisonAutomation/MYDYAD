import { closedTabHistoryAtom, popClosedTabAtom } from "@/atoms/chatAtoms";
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback } from "react";
import { useSelectChat } from "./useSelectChat";

export function useReopenClosedTab() {
  const closedTabHistory = useAtomValue(closedTabHistoryAtom);
  const popClosedTab = useSetAtom(popClosedTabAtom);
  const { selectChat } = useSelectChat();

  const reopenClosedTab = useCallback(() => {
    const record = popClosedTab();
    if (!record) return;
    selectChat({
      chatId: record.chatId,
      appId: record.appId,
    });
  }, [popClosedTab, selectChat]);

  return {
    reopenClosedTab,
    hasClosedTabs: closedTabHistory.length > 0,
    lastClosedTab: closedTabHistory[0] ?? null,
  };
}
