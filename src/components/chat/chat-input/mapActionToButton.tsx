import { Button } from "@/components/ui/button";
import type { SuggestedAction } from "@/lib/schemas";
import {
  SummarizeInNewChatButton,
  RefactorFileButton,
  WriteCodeProperlyButton,
  RebuildButton,
  RestartButton,
  RefreshButton,
  KeepGoingButton,
  AddTypeScriptButton,
} from "./SuggestionButtons";

export function mapActionToButton(action: SuggestedAction) {
  switch (action.id) {
    case "summarize-in-new-chat":
      return <SummarizeInNewChatButton />;
    case "refactor-file":
      return <RefactorFileButton path={action.path} />;
    case "write-code-properly":
      return <WriteCodeProperlyButton />;
    case "rebuild":
      return <RebuildButton />;
    case "restart":
      return <RestartButton />;
    case "refresh":
      return <RefreshButton />;
    case "keep-going":
      return <KeepGoingButton />;
    case "add-typescript":
      return <AddTypeScriptButton />;
    default:
      console.error(`Unsupported action: ${action.id}`);
      return (
        <Button variant="outline" size="sm" disabled key={action.id}>
          Unsupported: {action.id}
        </Button>
      );
  }
}
