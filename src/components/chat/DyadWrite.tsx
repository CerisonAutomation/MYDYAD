import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useAtomValue } from "jotai";
import { Edit, GitCompareArrows, Pencil, X } from "lucide-react";
import type React from "react";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { FileEditor } from "../preview_panel/FileEditor";
import { CodeHighlight } from "./CodeHighlight";
import {
  DyadCard,
  DyadCardContent,
  DyadCardHeader,
  DyadDescription,
  DyadExpandIcon,
  DyadStateIndicator,
} from "./DyadCardPrimitives";
import type { CustomTagState, DyadTagNode } from "./stateTypes";
import { useAutoCollapse } from "./useAutoCollapse";

interface DyadWriteProps {
  children?: ReactNode;
  node?: DyadTagNode;
  path?: string;
  description?: string;
}

export const DyadWrite: React.FC<DyadWriteProps> = ({
  children,
  node,
  path: pathProp,
  description: descriptionProp,
}) => {
  const [isContentVisible, setIsContentVisible] = useState(false);

  const path = pathProp || node?.properties?.path || "";
  const description = descriptionProp || node?.properties?.description || "";
  const state = node?.properties?.state as CustomTagState;
  useAutoCollapse(state, setIsContentVisible);

  const aborted = state === "aborted";
  const appId = useAtomValue(selectedAppIdAtom);
  const [isEditing, setIsEditing] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const inProgress = state === "pending";

  const diffLines = useMemo(() => {
    if (typeof children !== "string") return null;
    return children.split("\n");
  }, [children]);

  const handleCancel = () => {
    setIsEditing(false);
  };

  const handleEdit = () => {
    setIsEditing(true);
    setIsContentVisible(true);
  };

  const fileName = path ? path.split("/").pop() : "";

  return (
    <DyadCard
      state={state}
      accentColor="blue"
      onClick={() => setIsContentVisible(!isContentVisible)}
      isExpanded={isContentVisible}
    >
      <DyadCardHeader icon={<Pencil size={15} />} accentColor="blue">
        <div className="min-w-0 truncate">
          {fileName && (
            <span className="font-medium text-sm text-foreground truncate block">
              {fileName}
            </span>
          )}
          {path && (
            <span className="text-[11px] text-muted-foreground truncate block">
              {path}
            </span>
          )}
        </div>
        {inProgress && (
          <DyadStateIndicator state="pending" pendingLabel="Writing..." />
        )}
        {aborted && (
          <DyadStateIndicator state="aborted" abortedLabel="Did not finish" />
        )}
        <div className="ml-auto flex items-center gap-1">
          {!inProgress && (
            <>
              {isEditing ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCancel();
                  }}
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded transition-colors cursor-pointer"
                >
                  <X size={14} />
                  Cancel
                </button>
              ) : (
                <>
                  {state === "finished" &&
                    diffLines &&
                    diffLines.length > 0 && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowDiff(!showDiff);
                          if (!showDiff) setIsContentVisible(true);
                        }}
                        className={`flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors cursor-pointer ${
                          showDiff
                            ? "text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <GitCompareArrows size={14} />
                        {showDiff ? "Hide Diff" : "Show Diff"}
                      </button>
                    )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleEdit();
                    }}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded transition-colors cursor-pointer"
                  >
                    <Edit size={14} />
                    Edit
                  </button>
                </>
              )}
            </>
          )}
          <DyadExpandIcon isExpanded={isContentVisible} />
        </div>
      </DyadCardHeader>
      {description && (
        <DyadDescription>
          <span className={!isContentVisible ? "line-clamp-2" : undefined}>
            <span className="font-medium">Summary: </span>
            {description}
          </span>
        </DyadDescription>
      )}
      <DyadCardContent isExpanded={isContentVisible}>
        <div
          className="text-xs cursor-text"
          onClick={(e) => e.stopPropagation()}
        >
          {isEditing ? (
            <div className="h-96 min-h-96 border border-border rounded-lg overflow-hidden">
              <FileEditor appId={appId ?? null} filePath={path} />
            </div>
          ) : showDiff && diffLines ? (
            <div className="rounded-lg border border-border overflow-hidden font-mono text-[11px] leading-5">
              {diffLines.map((line, i) => (
                <div
                  key={i}
                  className="flex items-stretch border-b border-border/40 last:border-b-0"
                >
                  <span className="w-8 shrink-0 text-right pr-2 text-muted-foreground/50 select-none bg-muted/30">
                    {i + 1}
                  </span>
                  <span className="w-5 shrink-0 text-center text-green-600 dark:text-green-400 font-bold select-none">
                    +
                  </span>
                  <span className="flex-1 whitespace-pre overflow-x-auto px-2 bg-green-50/50 dark:bg-green-950/20 text-foreground">
                    {line}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <CodeHighlight className="language-typescript">
              {children}
            </CodeHighlight>
          )}
        </div>
      </DyadCardContent>
    </DyadCard>
  );
};
