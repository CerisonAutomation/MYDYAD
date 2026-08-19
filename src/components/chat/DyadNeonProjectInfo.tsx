import type React from "react";
import { DyadDbProjectInfo } from "./DyadDbProjectInfo";
import type { CustomTagState } from "./stateTypes";

interface DyadNeonProjectInfoProps {
  node: {
    properties: {
      state?: CustomTagState;
    };
  };
  children: React.ReactNode;
}

export function DyadNeonProjectInfo(props: DyadNeonProjectInfoProps) {
  return <DyadDbProjectInfo provider="Neon" {...props} />;
}
