import { FileEdit } from "lucide-react";
import type React from "react";
import type { ReactNode } from "react";
import {
  DyadBadge,
  DyadCard,
  DyadCardHeader,
  DyadDescription,
  DyadFilePath,
} from "./DyadCardPrimitives";
import type { CustomTagState, DyadTagNode } from "./stateTypes";

interface DyadRenameProps {
  children?: ReactNode;
  node?: DyadTagNode;
  from?: string;
  to?: string;
}

export const DyadRename: React.FC<DyadRenameProps> = ({
  children,
  node,
  from: fromProp,
  to: toProp,
}) => {
  const from = fromProp || node?.properties?.from || "";
  const to = toProp || node?.properties?.to || "";
  const state = node?.properties?.state as CustomTagState;

  const fromFileName = from ? from.split("/").pop() : "";
  const toFileName = to ? to.split("/").pop() : "";

  const displayTitle =
    fromFileName && toFileName
      ? `${fromFileName} → ${toFileName}`
      : fromFileName || toFileName || "";

  return (
    <DyadCard accentColor="amber" state={state}>
      <DyadCardHeader icon={<FileEdit size={15} />} accentColor="amber">
        {displayTitle && (
          <span className="font-medium text-sm text-foreground truncate">
            {displayTitle}
          </span>
        )}
        <DyadBadge color="amber">Rename</DyadBadge>
      </DyadCardHeader>
      {from && <DyadFilePath path={`From: ${from}`} />}
      {to && <DyadFilePath path={`To: ${to}`} />}
      {children && <DyadDescription>{children}</DyadDescription>}
    </DyadCard>
  );
};
