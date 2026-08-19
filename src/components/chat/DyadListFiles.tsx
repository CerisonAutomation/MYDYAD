import { FolderOpen } from "lucide-react";
import type React from "react";
import { useState } from "react";
import {
  DyadBadge,
  DyadCard,
  DyadCardContent,
  DyadCardHeader,
  DyadExpandIcon,
  DyadStateIndicator,
} from "./DyadCardPrimitives";
import type { CustomTagState } from "./stateTypes";
import { useAutoCollapse } from "./useAutoCollapse";

interface DyadListFilesProps {
  node: {
    properties: {
      directory?: string;
      recursive?: string;
      include_ignored?: string;
      state?: CustomTagState;
      appName?: string;
    };
  };
  children: React.ReactNode;
}

export function DyadListFiles({ node, children }: DyadListFilesProps) {
  const { directory, recursive, include_ignored, state, appName } =
    node.properties;
  const isLoading = state === "pending";
  const isRecursive = recursive === "true";
  const isIncludeIgnored = include_ignored === "true";
  const content = typeof children === "string" ? children : "";
  const [isExpanded, setIsExpanded] = useState(false);
  useAutoCollapse(state, setIsExpanded);

  const title = directory ? directory : "List Files";

  return (
    <DyadCard
      state={state}
      accentColor="slate"
      isExpanded={isExpanded}
      onClick={() => setIsExpanded(!isExpanded)}
      data-testid="dyad-list-files"
    >
      <DyadCardHeader icon={<FolderOpen size={15} />} accentColor="slate">
        <span className="font-medium text-sm text-foreground truncate">
          {title}
        </span>
        {appName && <DyadBadge color="sky">{appName}</DyadBadge>}
        {isRecursive && <DyadBadge color="slate">recursive</DyadBadge>}
        {isIncludeIgnored && (
          <DyadBadge color="slate">include ignored</DyadBadge>
        )}
        {isLoading && (
          <DyadStateIndicator state="pending" pendingLabel="Listing..." />
        )}
        <div className="ml-auto">
          <DyadExpandIcon isExpanded={isExpanded} />
        </div>
      </DyadCardHeader>
      <DyadCardContent isExpanded={isExpanded}>
        {content && (
          <div className="p-3 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-muted/20 rounded-lg">
            {content}
          </div>
        )}
      </DyadCardContent>
    </DyadCard>
  );
}
