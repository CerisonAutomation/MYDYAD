import { Search } from "lucide-react";
import type React from "react";
import type { ReactNode } from "react";
import { useState } from "react";
import { CodeHighlight } from "./CodeHighlight";
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

interface DyadGrepProps {
  children?: ReactNode;
  node?: {
    properties?: {
      state?: CustomTagState;
      query?: string;
      include?: string;
      exclude?: string;
      "case-sensitive"?: string;
      count?: string;
      total?: string;
      truncated?: string;
      appName?: string;
    };
  };
}

export const DyadGrep: React.FC<DyadGrepProps> = ({ children, node }) => {
  const [isContentVisible, setIsContentVisible] = useState(false);

  const state = node?.properties?.state as CustomTagState;
  useAutoCollapse(state, setIsContentVisible);
  const inProgress = state === "pending";
  const aborted = state === "aborted";

  const query = node?.properties?.query || "";
  const includePattern = node?.properties?.include || "";
  const excludePattern = node?.properties?.exclude || "";
  const caseSensitive = node?.properties?.["case-sensitive"] === "true";
  const count = node?.properties?.count || "";
  const total = node?.properties?.total || "";
  const truncated = node?.properties?.truncated === "true";
  const appName = node?.properties?.appName || "";

  let description = `"${query}"`;
  if (includePattern) {
    description += ` in ${includePattern}`;
  }
  if (excludePattern) {
    description += ` excluding ${excludePattern}`;
  }
  if (caseSensitive) {
    description += " (case-sensitive)";
  }

  const resultSummary = count
    ? truncated && total
      ? `${count} of ${total} matches`
      : `${count} match${count === "1" ? "" : "es"}`
    : "";

  return (
    <DyadCard
      state={state}
      accentColor="violet"
      onClick={() => setIsContentVisible(!isContentVisible)}
      isExpanded={isContentVisible}
      data-testid="dyad-grep"
    >
      <DyadCardHeader icon={<Search size={15} />} accentColor="violet">
        <DyadBadge color="violet">GREP</DyadBadge>
        {appName && <DyadBadge color="sky">{appName}</DyadBadge>}
        <span className="font-medium text-sm text-foreground truncate">
          {description}
        </span>
        {resultSummary && (
          <span className="text-xs text-muted-foreground shrink-0">
            ({resultSummary})
          </span>
        )}
        {inProgress && (
          <DyadStateIndicator
            state="pending"
            pendingLabel={
              total
                ? `Scanning ${count || "0"} of ${total} files...`
                : count
                  ? `Scanning ${count} files...`
                  : "Searching..."
            }
          />
        )}
        {aborted && (
          <DyadStateIndicator state="aborted" abortedLabel="Did not finish" />
        )}
        <div className="ml-auto">
          <DyadExpandIcon isExpanded={isContentVisible} />
        </div>
      </DyadCardHeader>
      <DyadCardContent isExpanded={isContentVisible}>
        <div className="text-xs" onClick={(e) => e.stopPropagation()}>
          <CodeHighlight className="language-log">{children}</CodeHighlight>
        </div>
      </DyadCardContent>
    </DyadCard>
  );
};
