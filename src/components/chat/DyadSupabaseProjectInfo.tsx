import type React from "react";
import { DyadDbProjectInfo } from "./DyadDbProjectInfo";
import type { CustomTagState } from "./stateTypes";

interface DyadSupabaseProjectInfoProps {
  node: {
    properties: {
      state?: CustomTagState;
    };
  };
  children: React.ReactNode;
}

export function DyadSupabaseProjectInfo(props: DyadSupabaseProjectInfoProps) {
  return <DyadDbProjectInfo provider="Supabase" {...props} />;
}
