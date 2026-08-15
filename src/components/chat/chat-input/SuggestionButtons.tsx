import type React from "react";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useStreamChat } from "@/hooks/useStreamChat";
import { useAtomValue } from "jotai";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useRunApp } from "@/hooks/useRunApp";
import { usePostHog } from "posthog-js/react";
import { useSummarizeInNewChat } from "../SummarizeInNewChatButton";

export function SuggestionButton({
  children,
  onClick,
  tooltipText,
}: {
  onClick: () => void;
  children: React.ReactNode;
  tooltipText: string | string[];
}) {
  const { isStreaming } = useStreamChat();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            disabled={isStreaming}
            variant="outline"
            size="sm"
            onClick={onClick}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent>
        {Array.isArray(tooltipText)
          ? tooltipText.map((line) => <div key={line}>{line}</div>)
          : tooltipText}
      </TooltipContent>
    </Tooltip>
  );
}

export function SummarizeInNewChatButton() {
  const { t } = useTranslation("chat");
  const { handleSummarize } = useSummarizeInNewChat();
  return (
    <SuggestionButton
      onClick={handleSummarize}
      tooltipText={t("summarizeNewChatTip")}
    >
      {t("summarizeToNewChat")}
    </SuggestionButton>
  );
}

export function RefactorFileButton({ path }: { path: string }) {
  const { t } = useTranslation("chat");
  const chatId = useAtomValue(selectedChatIdAtom);
  const { streamMessage } = useStreamChat();
  const onClick = () => {
    if (!chatId) {
      console.error("No chat id found");
      return;
    }
    streamMessage({
      prompt: t("refactorFile", { path }),
      chatId,
      redo: false,
    });
  };
  return (
    <SuggestionButton
      onClick={onClick}
      tooltipText={[t("refactorDescription"), path]}
    >
      <span className="max-w-[180px] overflow-hidden whitespace-nowrap text-ellipsis">
        {t("refactorFile", { path: path.split("/").slice(-2).join("/") })}
      </span>
    </SuggestionButton>
  );
}

export function WriteCodeProperlyButton() {
  const { t } = useTranslation("chat");
  const chatId = useAtomValue(selectedChatIdAtom);
  const { streamMessage } = useStreamChat();
  const onClick = () => {
    if (!chatId) {
      console.error("No chat id found");
      return;
    }
    streamMessage({
      prompt: `Write the code in the previous message in the correct format using \`<dyad-write>\` tags!`,
      chatId,
      redo: false,
    });
  };
  return (
    <SuggestionButton
      onClick={onClick}
      tooltipText={t("writeCodeProperlyDescription")}
    >
      {t("writeCodeProperly")}
    </SuggestionButton>
  );
}

export function RebuildButton() {
  const { t } = useTranslation("chat");
  const { restartApp } = useRunApp();
  const posthog = usePostHog();
  const selectedAppId = useAtomValue(selectedAppIdAtom);

  const onClick = useCallback(async () => {
    if (!selectedAppId) return;

    posthog.capture("action:rebuild");
    await restartApp({ removeNodeModules: true });
  }, [selectedAppId, posthog, restartApp]);

  return (
    <SuggestionButton
      onClick={onClick}
      tooltipText={t("rebuildAppDescription")}
    >
      {t("rebuildApp")}
    </SuggestionButton>
  );
}

export function RestartButton() {
  const { t } = useTranslation("chat");
  const { restartApp } = useRunApp();
  const posthog = usePostHog();
  const selectedAppId = useAtomValue(selectedAppIdAtom);

  const onClick = useCallback(async () => {
    if (!selectedAppId) return;

    posthog.capture("action:restart");
    await restartApp();
  }, [selectedAppId, posthog, restartApp]);

  return (
    <SuggestionButton
      onClick={onClick}
      tooltipText={t("restartAppDescription")}
    >
      {t("restartApp")}
    </SuggestionButton>
  );
}

export function RefreshButton() {
  const { t } = useTranslation("chat");
  const { refreshAppIframe } = useRunApp();
  const posthog = usePostHog();

  const onClick = useCallback(() => {
    posthog.capture("action:refresh");
    refreshAppIframe();
  }, [posthog, refreshAppIframe]);

  return (
    <SuggestionButton
      onClick={onClick}
      tooltipText={t("refreshAppDescription")}
    >
      {t("refreshApp")}
    </SuggestionButton>
  );
}

export function KeepGoingButton() {
  const { t } = useTranslation("chat");
  const { streamMessage } = useStreamChat();
  const chatId = useAtomValue(selectedChatIdAtom);
  const onClick = () => {
    if (!chatId) {
      console.error("No chat id found");
      return;
    }
    streamMessage({
      prompt: "Keep going",
      chatId,
    });
  };
  return (
    <SuggestionButton onClick={onClick} tooltipText={t("keepGoing")}>
      {t("keepGoing")}
    </SuggestionButton>
  );
}

export function AddTypeScriptButton() {
  const { t } = useTranslation("chat");
  const { streamMessage } = useStreamChat();
  const chatId = useAtomValue(selectedChatIdAtom);
  const onClick = () => {
    if (!chatId) {
      console.error("No chat id found");
      return;
    }
    streamMessage({
      prompt:
        "Add TypeScript to this project: install `typescript` as a dev dependency and create a lenient tsconfig (`allowJs: true`, `strict: false`) so existing JavaScript keeps working.",
      chatId,
    });
  };
  return (
    <SuggestionButton onClick={onClick} tooltipText={t("addTypeScript")}>
      {t("addTypeScript")}
    </SuggestionButton>
  );
}
