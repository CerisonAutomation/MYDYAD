import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { integrationProviderSelectionAtom } from "@/atoms/integrationAtoms";
import { ipc } from "@/ipc/types";
import { showUserInputNotification } from "@/lib/userInputNotification";
import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef } from "react";
import { useSettings } from "./useSettings";

/**
 * Shows integration notifications from the generic user-input protocol and
 * clears UI-only provider choices when the request settles.
 */
export function useIntegrationEvents() {
  const setIntegrationProviderSelection = useSetAtom(
    integrationProviderSelectionAtom,
  );
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const queryClient = useQueryClient();
  const { settings } = useSettings();

  const selectedAppIdRef = useRef(selectedAppId);
  const settingsRef = useRef(settings);
  selectedAppIdRef.current = selectedAppId;
  settingsRef.current = settings;

  useEffect(() => {
    const unsubscribeRequested = ipc.events.userInput.onRequested(
      (descriptor) => {
        if (descriptor.kind !== "integration") return;
        showUserInputNotification({
          appId: selectedAppIdRef.current,
          queryClient,
          settings: settingsRef.current,
          body: "Database integration setup needs your input",
          requireInteraction: true,
        });
      },
    );
    const unsubscribeSettled = ipc.events.userInput.onSettled(
      ({ requestId }) => {
        setIntegrationProviderSelection((prev) => {
          if (!prev.has(requestId)) return prev;
          const next = new Map(prev);
          next.delete(requestId);
          return next;
        });
      },
    );
    return () => {
      unsubscribeRequested();
      unsubscribeSettled();
    };
  }, [setIntegrationProviderSelection, queryClient]);
}
