import { Database } from "lucide-react";
import type React from "react";
import {
  DyadBadge,
  DyadCard,
  DyadCardHeader,
  DyadStateIndicator,
} from "./DyadCardPrimitives";
import type { CustomTagState } from "./stateTypes";

interface DyadDatabaseSchemaProps {
  node: {
    properties: {
      state?: CustomTagState;
    };
  };
  children: React.ReactNode;
}

export function DyadDatabaseSchema({
  node,
  children,
}: DyadDatabaseSchemaProps) {
  const { state } = node.properties;
  const isLoading = state === "pending";
  const content = typeof children === "string" ? children : "";

  return (
    <DyadCard state={state} accentColor="teal">
      <DyadCardHeader icon={<Database size={15} />} accentColor="teal">
        <DyadBadge color="teal">Database Schema</DyadBadge>
        {isLoading && <DyadStateIndicator state="pending" />}
      </DyadCardHeader>
      {content && (
        <div className="px-3 pb-3">
          <div className="p-3 text-xs font-mono whitespace-pre-wrap max-h-60 overflow-y-auto bg-muted/20 rounded-lg">
            {content}
          </div>
        </div>
      )}
    </DyadCard>
  );
}
