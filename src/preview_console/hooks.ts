import { useAppRunRemoteManager } from "@/app_run/AppRunRemoteProvider";
import {
  useKeyedController,
  useKeyedMachineSelector,
} from "@/state_machines/react";

export function useConsoleEntries(appId: number | null) {
  const manager = useAppRunRemoteManager();
  const entries = useKeyedController(manager.previewConsole, appId ?? -1);
  return appId === null ? [] : entries;
}

export function useLatestConsoleEntry(appId: number | null) {
  const manager = useAppRunRemoteManager();
  return useKeyedMachineSelector(
    manager.previewConsole,
    appId ?? -1,
    (entries) => (appId === null ? undefined : entries.at(-1)),
  );
}
