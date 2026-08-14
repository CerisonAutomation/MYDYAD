import { ContextFilesPicker } from "./ContextFilesPicker";
import { ModelPicker } from "./ModelPicker";
import { Agent2ModeSelector } from "./ProModeSelector";
import { ChatModeSelector } from "./ChatModeSelector";

export function ChatInputControls({
  showContextFilesPicker = false,
}: {
  showContextFilesPicker?: boolean;
}) {
  return (
    <div className="flex items-center">
      <ChatModeSelector />
      <div className="w-1.5"></div>
      <ModelPicker />
      <Agent2ModeSelector />
      {showContextFilesPicker && <ContextFilesPicker />}
    </div>
  );
}
