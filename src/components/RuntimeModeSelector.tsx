import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { SettingField } from "@/components/settings/SettingField";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCurrentAppUrl } from "@/hooks/useAppRun";
import { useSettings } from "@/hooks/useSettings";
import type { RuntimeMode2 } from "@/lib/schemas";
import { showError } from "@/lib/toast";
import { useAtomValue } from "jotai";
import { useState } from "react";
import { useTranslation } from "react-i18next";

/** Cloud sandbox removed — always returns false. Kept for backward compatibility. */
export function shouldShowCloudSandboxOption(_input: {
  runtimeMode: string;
  cloudSandboxExperimentEnabled: boolean;
}): boolean {
  return false;
}

export function RuntimeModeSelector() {
  const { settings, updateSettings } = useSettings();
  const { t } = useTranslation(["settings", "common"]);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const currentAppUrl = useCurrentAppUrl(selectedAppId);
  const [pendingRuntimeMode, setPendingRuntimeMode] =
    useState<RuntimeMode2 | null>(null);
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);

  if (!settings) {
    return null;
  }

  const isDockerMode = settings?.runtimeMode2 === "docker";

  const applyRuntimeModeChange = async (value: RuntimeMode2) => {
    try {
      await updateSettings({ runtimeMode2: value });
    } catch (error: any) {
      showError(`Failed to update runtime mode: ${error.message}`);
    }
  };

  const handleRuntimeModeChange = (value: RuntimeMode2) => {
    if (currentAppUrl.appUrl && value !== (settings.runtimeMode2 ?? "host")) {
      setPendingRuntimeMode(value);
      setIsConfirmDialogOpen(true);
      return;
    }

    void applyRuntimeModeChange(value);
  };

  return (
    <div className="space-y-3">
      <SettingField
        htmlFor="runtime-mode"
        label={t("general.runtimeMode")}
        description={t("general.runtimeModeDescription")}
      >
        <Select
          value={settings.runtimeMode2 ?? "host"}
          onValueChange={(v) => v && handleRuntimeModeChange(v)}
        >
          <SelectTrigger
            className="w-full sm:w-[240px]"
            id="runtime-mode"
            aria-describedby="runtime-mode-description"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="host">Local (default)</SelectItem>
            <SelectItem value="docker">Colima (recommended)</SelectItem>
          </SelectContent>
        </Select>
      </SettingField>
      {isDockerMode && (
        <div className="text-sm text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 p-2 rounded">
          ⚠️ Container mode requires Colima or Docker Desktop to be installed
          and running. Install with:{" "}
          <code className="bg-amber-100 dark:bg-amber-800 px-1 rounded">
            brew install colima docker
          </code>
          Start with:{" "}
          <code className="bg-amber-100 dark:bg-amber-800 px-1 rounded">
            colima start --cpu 4 --memory 8 --disk 20 --vm-type vz --mount-type
            virtiofs
          </code>
        </div>
      )}
      <AlertDialog
        open={isConfirmDialogOpen}
        onOpenChange={(open) => {
          setIsConfirmDialogOpen(open);
          if (!open) {
            setPendingRuntimeMode(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("general.runtimeModeSwitchTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("general.runtimeModeSwitchDescription")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common:cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!pendingRuntimeMode) {
                  return;
                }
                void applyRuntimeModeChange(pendingRuntimeMode);
              }}
            >
              {t("general.runtimeModeSwitchAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
