import { Globe } from "lucide-react";
import type React from "react";
import { useEffect, useState } from "react";
import {
  DyadBadge,
  DyadCard,
  DyadCardContent,
  DyadCardHeader,
  DyadExpandIcon,
  DyadStateIndicator,
} from "./DyadCardPrimitives";
import { VanillaMarkdownParser } from "./VanillaMarkdownParser";
import type { CustomTagState, DyadTagNode } from "./stateTypes";

interface DyadWebSearchResultProps {
  node?: DyadTagNode;
  children?: React.ReactNode;
}

export const DyadWebSearchResult: React.FC<DyadWebSearchResultProps> = ({
  children,
  node,
}) => {
  const state = node?.properties?.state as CustomTagState;
  const inProgress = state === "pending";
  const [isExpanded, setIsExpanded] = useState(inProgress);

  useEffect(() => {
    if (!inProgress && isExpanded) {
      setIsExpanded(false);
    }
  }, [inProgress]);

  return (
    <DyadCard
      state={state}
      accentColor="blue"
      onClick={() => setIsExpanded(!isExpanded)}
      isExpanded={isExpanded}
    >
      <DyadCardHeader icon={<Globe size={15} />} accentColor="blue">
        <DyadBadge color="blue">Web Search Result</DyadBadge>
        {inProgress && (
          <DyadStateIndicator state="pending" pendingLabel="Loading..." />
        )}
        <div className="ml-auto">
          <DyadExpandIcon isExpanded={isExpanded} />
        </div>
      </DyadCardHeader>
      <DyadCardContent isExpanded={isExpanded}>
        <div className="text-sm text-muted-foreground">
          {typeof children === "string" ? (
            <VanillaMarkdownParser content={children} />
          ) : (
            children
          )}
        </div>
      </DyadCardContent>
    </DyadCard>
  );
};
