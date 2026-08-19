import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useNavigate } from "@tanstack/react-router";
import { useSetAtom } from "jotai";

export function useOpenApp() {
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const navigate = useNavigate();

  return (appId: number) => {
    setSelectedAppId(appId);
    setSelectedChatId(null);
    navigate({ to: "/app-details", search: { appId } });
  };
}
